package xyz.siloneedsleep.veluna;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONException;

final class AutoMix implements Player.Listener, SharedPreferences.OnSharedPreferenceChangeListener {
    private final PlaybackService service;
    private final MediaSession session;
    private final SharedPreferences prefs;
    private final SharedPreferences sound;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService retryExecutor = Executors.newSingleThreadExecutor();
    private ExoPlayer main, incoming;
    private TrackEqualizer mainEq,incomingEq;
    private long width, started;
    private int sourceIndex;
    private float volume;
    private String countedId = "";
    private String lastRetriedVideoId = "";
    private int retryCount = 0;
    private boolean closed;
    private void recordStart(Player player) {
        MediaItem item = player.getCurrentMediaItem();
        if (!player.isPlaying() || item == null || item.mediaId.equals(countedId)) return;
        countedId = item.mediaId;
        SharedPreferences store = service.getSharedPreferences("player", 0);
        try {
            JSONObject history = new JSONObject(store.getString("play-history", "{}"));
            JSONObject previous = history.optJSONObject(countedId);
            history.put(countedId, new JSONObject().put("count",previous == null ? 1 : previous.optLong("count")+1)
                .put("time",System.currentTimeMillis()));
            if (history.length()>5000) {
                long oldest=Long.MAX_VALUE; String remove=null;
                for (java.util.Iterator<String> keys=history.keys();keys.hasNext();) {
                    String key=keys.next(); long time=history.getJSONObject(key).optLong("time");
                    if (time<oldest) {oldest=time;remove=key;}
                }
                if (remove!=null) history.remove(remove);
            }
            store.edit().putString("play-history",history.toString()).apply();
        } catch (JSONException ignored) {}
    }
    private final Runnable prepare = this::prepareNext;
    private final Runnable ramp = this::fade;
    private final Runnable preResolveTask = this::preResolveNextTrack;
    private String lastPreResolvedKey = "";
    AutoMix(PlaybackService service, MediaSession session, ExoPlayer main) {
        this.service=service; this.session=session; this.main=main;
        mainEq=PlaybackService.attachAudioEffects(service,main);
        prefs=service.getSharedPreferences("dj",0);
        sound=service.getSharedPreferences("sound",0);
        prefs.registerOnSharedPreferenceChangeListener(this);
        sound.registerOnSharedPreferenceChangeListener(this);
        updateOffload();main.addListener(this); schedule(); schedulePreResolve();
    }
    private void updateOffload() {
        boolean processing=prefs.getBoolean("enabled",false) || sound.getBoolean("enabled",false) || sound.getBoolean("normalize",false) || incoming!=null;
        MediaHelpers.setAudioOffload(main, processing);
    }
    static AudioAttributes attributes() {
        return MediaHelpers.musicAudioAttributes();
    }
    private long width() {
        int next=main.getNextMediaItemIndex();
        MediaItem current=main.getCurrentMediaItem();
        if (!prefs.getBoolean("enabled",false) || current==null || next==C.INDEX_UNSET || main.getRepeatMode()==Player.REPEAT_MODE_ONE) return 0;
        boolean planned=current.mediaId.equals(prefs.getString("from","")) &&
            main.getMediaItemAt(next).mediaId.equals(prefs.getString("to",""));
        int fixed=prefs.getInt("fixed",0);
        long ms=planned ? prefs.getLong("width",4000) : fixed>0 ? fixed*1000L : 4000;
        return Math.min(Math.min(Math.max(0,ms),30000),Math.max(0,main.getDuration()/3));
    }
    private long cueInMs(int nextIndex) {
        MediaItem current=main.getCurrentMediaItem();
        if (current==null || nextIndex==C.INDEX_UNSET) return 0;
        boolean planned=current.mediaId.equals(prefs.getString("from","")) &&
            main.getMediaItemAt(nextIndex).mediaId.equals(prefs.getString("to",""));
        if (!planned) return 0;
        return Math.max(0L, Math.min(4000L, prefs.getLong("cueInMs", 0L)));
    }
    private void preResolveNextTrack() {
        if (closed || main==null || !main.isPlaying()) return;
        int next=main.getNextMediaItemIndex();
        if (next==C.INDEX_UNSET || next>=main.getMediaItemCount()) return;
        MediaItem cur=main.getCurrentMediaItem();
        MediaItem nextItem=main.getMediaItemAt(next);
        String nextVideoId=MediaHelpers.extractYtmVideoId(nextItem);
        if (nextVideoId==null) return;
        String key=(cur==null?"":cur.mediaId)+"->"+nextVideoId;
        if (key.equals(lastPreResolvedKey)) return;
        lastPreResolvedKey=key;
        PlaybackService.preResolveYtmStream(service, nextVideoId);
    }
    private void schedulePreResolve() {
        handler.removeCallbacks(preResolveTask);
        if (closed || main==null || !main.isPlaying() || main.getPlaybackState()!=Player.STATE_READY) return;
        int next=main.getNextMediaItemIndex();
        if (next==C.INDEX_UNSET) return;
        long dur=main.getDuration();
        long pos=main.getCurrentPosition();
        long delayMs=(dur>0 && dur-pos<=25_000L) ? 0L : 3000L;
        handler.postDelayed(preResolveTask, delayMs);
    }
    private void schedule() {
        handler.removeCallbacks(prepare);
        if (!main.isPlaying() || incoming!=null) return;
        width=width();
        if (width<=0) return;
        long wait=main.getDuration()-main.getCurrentPosition()-width-2500;
        handler.postDelayed(prepare,Math.max(0,wait));
    }
    @OptIn(markerClass = UnstableApi.class)
    private void prepareNext() {
        int next=main.getNextMediaItemIndex();
        if (!main.isPlaying() || next==C.INDEX_UNSET || width()<=0) return;
        width=width();
        long cueIn=cueInMs(next);
        preResolveNextTrack();
        ArrayList<MediaItem> items=new ArrayList<>();
        for (int i=0; i<main.getMediaItemCount(); i++) items.add(main.getMediaItemAt(i));
        incoming=MediaHelpers.buildExoPlayer(service, false);
        MediaHelpers.setAudioOffload(incoming, true);
        incomingEq=PlaybackService.attachAudioEffects(service,incoming);
        incoming.setVolume(0f); incoming.setMediaItems(items,next,cueIn); incoming.prepare();
        incoming.setRepeatMode(main.getRepeatMode());
        incoming.setShuffleModeEnabled(main.getShuffleModeEnabled());
        volume=main.getVolume()>0f ? main.getVolume() : 1f; sourceIndex=main.getCurrentMediaItemIndex(); started=0;
        updateOffload();
        handler.postDelayed(ramp,Math.max(0,main.getDuration()-main.getCurrentPosition()-width));
    }
    private void fade() {
        if (incoming==null || !main.isPlaying() || main.getCurrentMediaItemIndex()!=sourceIndex) {cancelFade();return;}
        if (incoming.getPlayerError()!=null || incoming.getPlaybackState()==Player.STATE_ENDED) {cancelFade();return;}
        if (incoming.getPlaybackState()!=Player.STATE_READY) {handler.postDelayed(ramp,40);return;}
        if (started==0) {
            long remaining=main.getDuration()-main.getCurrentPosition();
            long nextDuration=incoming.getDuration();
            if(nextDuration>0)width=Math.min(width,nextDuration/3);
            if(width<100 || remaining<120){cancelFade();return;}
            if(remaining>width+120){handler.postDelayed(ramp,remaining-width);return;}
            started=SystemClock.elapsedRealtime(); width=Math.max(100,Math.min(width,remaining-120));
            incoming.play();
        }
        float progress=Math.min(1f,Math.max(0f,(float)(SystemClock.elapsedRealtime()-started)/width));
        double angle=(Math.PI*0.5)*progress;
        float outGain=(float)Math.cos(angle);
        float inGain=(float)Math.sin(angle);
        main.setVolume(volume*outGain); incoming.setVolume(volume*inGain);
        if (progress<1f) {handler.postDelayed(ramp,20);return;}
        ExoPlayer old=main; old.removeListener(this); old.pause();
        main=incoming; incoming=null;
        mainEq.close();mainEq=incomingEq;incomingEq=null;
        main.setAudioAttributes(attributes(),true); main.setVolume(volume);
        updateOffload();
        session.setPlayer(main); service.playerChanged(); old.release(); main.addListener(this);
        countedId=""; lastPreResolvedKey=""; recordStart(main); schedule(); schedulePreResolve();
    }
    private void cancelFade() {
        handler.removeCallbacks(ramp);
        handler.removeCallbacks(prepare);
        if (incoming!=null) {
            incoming.pause();
            incomingEq.close();incomingEq=null;
            incoming.release(); incoming=null;
            main.setVolume(volume>0f ? volume : 1f);
            updateOffload();
        }
    }
    @Override public void onEvents(Player p,Player.Events events) {
        if(events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) { countedId=""; lastPreResolvedKey=""; retryCount=0; }
        if(events.contains(Player.EVENT_IS_PLAYING_CHANGED) && p.isPlaying()) retryCount=0;
        recordStart(p);
        if(events.containsAny(Player.EVENT_MEDIA_METADATA_CHANGED,Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_MEDIA_ITEM_TRANSITION))
            PlayerWidget.display(service,p);
        if (events.containsAny(Player.EVENT_TIMELINE_CHANGED,Player.EVENT_POSITION_DISCONTINUITY,
            Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_PLAYBACK_STATE_CHANGED,Player.EVENT_REPEAT_MODE_CHANGED,
            Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED)) {
            cancelFade(); schedule(); schedulePreResolve();
        }
    }
    @Override public void onPlayerError(PlaybackException error) {
        if (main == null) return;
        MediaItem current = main.getCurrentMediaItem();
        if (current == null) return;
        String videoId = MediaHelpers.extractYtmVideoId(current);
        if (videoId == null) return;
        if (!videoId.equals(lastRetriedVideoId)) {
            lastRetriedVideoId = videoId;
            retryCount = 0;
        }
        if (retryCount >= 2) return;
        retryCount++;
        final ExoPlayer target = main;
        final int idx = target.getCurrentMediaItemIndex();
        final long pos = Math.max(0L, target.getCurrentPosition());
        retryExecutor.execute(() -> {
            try {
                PlaybackService.invalidateYtmStream(videoId);
                PlaybackService.resolveYtmStream(service, videoId, true);
                handler.post(() -> {
                    if (!closed && target == main && target.getCurrentMediaItemIndex()==idx && target.getCurrentMediaItem()!=null && videoId.equals(PlaybackService.extractYtmVideoId(null,target.getCurrentMediaItem().mediaId))) {
                        target.seekTo(idx, pos);
                        target.prepare();
                    }
                });
            } catch (Exception ignored) { }
        });
    }
    @Override public void onSharedPreferenceChanged(SharedPreferences p,String name) {
        if (p==sound) {
            if ("enabled".equals(name) || "normalize".equals(name)) updateOffload();
            return;
        }
        if (!prefs.getBoolean("enabled",false)) cancelFade();
        if ("enabled".equals(name)) updateOffload();
        if (incoming==null) schedule();
    }
    void close() {
        closed=true;
        prefs.unregisterOnSharedPreferenceChangeListener(this);
        sound.unregisterOnSharedPreferenceChangeListener(this);
        main.removeListener(this); handler.removeCallbacks(prepare); handler.removeCallbacks(preResolveTask); cancelFade();
        retryExecutor.shutdownNow();
        mainEq.close();
    }
}
