package xyz.siloneedsleep.veluna;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

public final class PlaybackService extends MediaSessionService implements android.content.SharedPreferences.OnSharedPreferenceChangeListener {
    private MediaSession session;
    private AutoMix mixer;
    private final android.os.Handler scheduler=new android.os.Handler(android.os.Looper.getMainLooper());
    private android.content.SharedPreferences options;
    private final Runnable sleep=()->{
        if(session!=null)session.getPlayer().pause();
        options.edit().remove("sleep").apply();
    };
    @Override public void onSharedPreferenceChanged(android.content.SharedPreferences prefs,String key) {
        if(!"sleep".equals(key))return;
        scheduler.removeCallbacks(sleep);
        long deadline=prefs.getLong("sleep",0);
        if(deadline>0)scheduler.postDelayed(sleep,Math.max(0,deadline-System.currentTimeMillis()));
    }

    @Override public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build();
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setAudioAttributes(attributes, true).setHandleAudioBecomingNoisy(true).build();
        session = new MediaSession.Builder(this, player).build();
        options=getSharedPreferences("player",0);
        player.setRepeatMode(options.getInt("repeat",0));
        options.registerOnSharedPreferenceChangeListener(this);
        onSharedPreferenceChanged(options,"sleep");
        mixer = new AutoMix(this, session, player);
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }

    @Override public void onDestroy() {
        PlayerWidget.display(this,null);
        options.unregisterOnSharedPreferenceChangeListener(this);scheduler.removeCallbacks(sleep);
        if (session != null) {
            mixer.close();
            session.getPlayer().release();
            session.release();
        }
        super.onDestroy();
    }
}
