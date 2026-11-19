package xyz.siloneedsleep.veluna;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import java.util.ArrayList;

final class AutoMix implements Player.Listener, SharedPreferences.OnSharedPreferenceChangeListener {
    private final PlaybackService service;
    private final MediaSession session;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer main, incoming;
    private TrackEqualizer mainEq,incomingEq;
    private long width, started;
    private int sourceIndex;
    private float volume;
    private final Runnable prepare = this::prepareNext;
    private final Runnable ramp = this::fade;
    AutoMix(PlaybackService service, MediaSession session, ExoPlayer main) {
        this.service=service; this.session=session; this.main=main;
        mainEq=new TrackEqualizer(service,main);
        prefs=service.getSharedPreferences("dj",0);
        prefs.registerOnSharedPreferenceChangeListener(this); main.addListener(this); schedule();
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
        long ms=planned ? prefs.getLong("width",2000) : 2000;
        return Math.min(Math.min(Math.max(0,ms),12000),Math.max(0,main.getDuration()/3));
    }
    private void schedule() {
        handler.removeCallbacks(prepare);
        if (!main.isPlaying() || incoming!=null) return;
        width=width();
        if (width<=0) return;
        long wait=main.getDuration()-main.getCurrentPosition()-width-1200;
        handler.postDelayed(prepare,Math.max(0,wait));
    }
    private void prepareNext() {
        int next=main.getNextMediaItemIndex();
        if (!main.isPlaying() || next==C.INDEX_UNSET || width()<=0) return;
        width=width();
        ArrayList<MediaItem> items=new ArrayList<>();
        for (int i=0; i<main.getMediaItemCount(); i++) items.add(main.getMediaItemAt(i));
        incoming=new ExoPlayer.Builder(service).setAudioAttributes(attributes(),false).setHandleAudioBecomingNoisy(true).build();
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
            started=SystemClock.elapsedRealtime(); width=Math.max(100,Math.min(width,main.getDuration()-main.getCurrentPosition()-120));
            incoming.play();
        }
        float progress=Math.min(1f,(float)(SystemClock.elapsedRealtime()-started)/width);
        main.setVolume(volume*(1-progress)); incoming.setVolume(volume*progress);
        if (progress<1f) {handler.postDelayed(ramp,40);return;}
        ExoPlayer old=main; old.removeListener(this); old.pause();
        main=incoming; incoming=null;
        mainEq.close();mainEq=incomingEq;incomingEq=null;
        main.setAudioAttributes(attributes(),true); main.setVolume(volume);
        session.setPlayer(main); old.release(); main.addListener(this); schedule();
    }
    private void cancelFade() {
        handler.removeCallbacks(ramp);
        if (incoming!=null) {incomingEq.close();incomingEq=null;incoming.release(); incoming=null; main.setVolume(volume);}
    }
    @Override public void onEvents(Player p,Player.Events events) {
        if(events.containsAny(Player.EVENT_MEDIA_METADATA_CHANGED,Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_MEDIA_ITEM_TRANSITION))
            PlayerWidget.display(service,p);
        if (events.containsAny(Player.EVENT_TIMELINE_CHANGED,Player.EVENT_POSITION_DISCONTINUITY,
            Player.EVENT_IS_PLAYING_CHANGED,Player.EVENT_PLAYBACK_STATE_CHANGED,Player.EVENT_REPEAT_MODE_CHANGED)) {
            cancelFade(); schedule();
        }
    }
    @Override public void onSharedPreferenceChanged(SharedPreferences p,String name) {
        if (!p.getBoolean("enabled",false)) cancelFade();
        if (incoming==null) schedule();
    }
    void close() {
        prefs.unregisterOnSharedPreferenceChangeListener(this);
        main.removeListener(this); handler.removeCallbacks(prepare); cancelFade();
        mainEq.close();
    }
}
