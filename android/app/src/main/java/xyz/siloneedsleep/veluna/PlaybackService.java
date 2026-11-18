package xyz.siloneedsleep.veluna;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

public final class PlaybackService extends MediaSessionService {
    private MediaSession session;

    @Override public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build();
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setAudioAttributes(attributes, true).setHandleAudioBecomingNoisy(true).build();
        session = new MediaSession.Builder(this, player).build();
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }

    @Override public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
        }
        super.onDestroy();
    }
}
