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
import androidx.media3.common.TrackSelectionParameters.AudioOffloadPreferences;
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
    AutoMix(PlaybackService service, MediaSession session, ExoPlayer main) {
        this.service=service; this.session=session; this.main=main;
        mainEq=new TrackEqualizer(service,main);
        prefs=service.getSharedPreferences("dj",0);
        sound=service.getSharedPreferences("sound",0);
        prefs.registerOnSharedPreferenceChangeListener(this);
        sound.registerOnSharedPreferenceChangeListener(this);
        updateOffload();main.addListener(this); schedule();
    }
    private void updateOffload() {
        boolean processing=prefs.getBoolean("enabled",false) || sound.getBoolean("enabled",false);
        int mode=processing ? AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED
            : AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_ENABLED;
        if(main.getTrackSelectionParameters().audioOffloadPreferences.audioOffloadMode==mode) return;
        AudioOffloadPreferences preference=new AudioOffloadPreferences.Builder().setAudioOffloadMode(mode).build();
        main.setTrackSelectionParameters(main.getTrackSelectionParameters().buildUpon()
            .setAudioOffloadPreferences(preference).build());
    }
    static AudioAttributes attributes() {
        return new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build();
    }
    private long width() {
        int next=main.getNextMediaItemIndex();
        MediaItem current=main.getCurrentMediaItem();
        if (!prefs.getBoolean("enabled",false) || current==null || next==C.INDEX_UNSET || main.getRepeatMode()==Player.REPEAT_MODE_ONE) return 0;
        boolean planned=current.mediaId.equals(prefs.getString("from","")) &&
            main.getMediaItemAt(next).mediaId.equals(prefs.getString("to",""));
        int fixed=prefs.getInt("fixed",0);
        long ms=planned ? prefs.getLong("width",2000) : fixed>0 ? fixed*1000L : 2000;
        return Math.min(Math.min(Math.max(0,ms),30000),Math.max(0,main.getDuration()/3));
    }
    private void schedule() {
        handler.removeCallbacks(prepare);
        if (!main.isPlaying() || incoming!=null) return;
        width=width();
        if (width<=0) return;
        long wait=main.getDuration()-main.getCurrentPosition()-width-1200;
        handler.postDelayed(prepare,Math.max(0,wait));
    }
    @OptIn(markerClass = UnstableApi.class)
    private void prepareNext() {
        int next=main.getNextMediaItemIndex();
        if (!main.isPlaying() || next==C.INDEX_UNSET || width()<=0) return;
        width=width();
        ArrayList<MediaItem> items=new ArrayList<>();
        for (int i=0; i<main.getMediaItemCount(); i++) items.add(main.getMediaItemAt(i));
        incoming=new ExoPlayer.Builder(service)
            .setMediaSourceFactory(PlaybackService.buildMediaSourceFactory(service))
            .setAudioAttributes(attributes(),false).setHandleAudioBecomingNoisy(true).build();
        incomingEq=new TrackEqualizer(service,incoming);
        incoming.setVolume(0); incoming.setMediaItems(items,next,0); incoming.prepare();
        incoming.setRepeatMode(main.getRepeatMode());
        volume=main.getVolume(); sourceIndex=main.getCurrentMediaItemIndex(); started=0;
        handler.postDelayed(ramp,Math.max(0,main.getDuration()-main.getCurrentPosition()-width));
    }
    private void fade() {
        if (incoming==null || !main.isPlaying() || main.getCurrentMediaItemIndex()!=sourceIndex) {cancelFade();return;}
        if (incoming.getPlayerError()!=null || incoming.getPlaybackState()==Player.STATE_ENDED) {cancelFade();return;}
        if (incoming.getPlaybackState()!=Player.STATE_READY) {handler.postDelayed(ramp,60);return;}
        if (started==0) {
            long remaining=main.getDuration()-main.getCurrentPosition();
            long nextDuration=incoming.getDuration();
            if(nextDuration>0)width=Math.min(width,nextDuration/3);
            if(width<100 || remaining<120){cancelFade();return;}
            if(remaining>width+120){handler.postDelayed(ramp,remaining-width);return;}
            started=SystemClock.elapsedRealtime(); width=Math.max(100,Math.min(width,remaining-120));
            incoming.play();
        }
        float progress=Math.min(1f,(float)(SystemClock.elapsedRealtime()-started)/width);
        main.setVolume(volume*(1-progress)); incoming.setVolume(volume*progress);
        if (progress<1f) {handler.postDelayed(ramp,40);return;}
        ExoPlayer old=main; old.removeListener(this); old.pause();
        main=incoming; incoming=null;
        mainEq.close();mainEq=incomingEq;incomingEq=null;
        main.setAudioAttributes(attributes(),true); main.setVolume(volume);
        session.setPlayer(main); service.playerChanged(); old.release(); main.addListener(this); countedId=""; recordStart(main); schedule();
    }
    private void cancelFade() {
        handler.removeCallbacks(ramp);
        if (incoming!=null) {incomingEq.close();incomingEq=null;incoming.release(); incoming=null; main.setVolume(volume);}
    }
    @Override public void onEvents(Player p,Player.Events events) {
        if(events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) { countedId=""; retryCount=0; }
        if(events.contains(Player.EVENT_IS_PLAYING_CHANGED) && p.isPlaying()) retryCount=0;
        recordStart(p);
        if(events.containsAny(Player.EVENT_MEDIA_METADATA_CHANGED,Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_MEDIA_ITEM_TRANSITION))
            PlayerWidget.display(service,p);
        if (events.containsAny(Player.EVENT_TIMELINE_CHANGED,Player.EVENT_POSITION_DISCONTINUITY,
            Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_PLAYBACK_STATE_CHANGED,Player.EVENT_REPEAT_MODE_CHANGED)) {
            cancelFade(); schedule();
        }
    }
    @Override public void onPlayerError(PlaybackException error) {
        if (main == null) return;
        MediaItem current = main.getCurrentMediaItem();
        if (current == null) return;
        String videoId = PlaybackService.extractYtmVideoId(
            current.localConfiguration == null ? null : current.localConfiguration.uri,
            current.mediaId
        );
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
            if ("enabled".equals(name)) updateOffload();
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
        main.removeListener(this); handler.removeCallbacks(prepare); cancelFade();
        retryExecutor.shutdownNow();
        mainEq.close();
    }
}
