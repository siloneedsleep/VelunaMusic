package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONException;
import org.json.JSONObject;

public final class PlaybackService extends MediaSessionService implements android.content.SharedPreferences.OnSharedPreferenceChangeListener {
    private static final String STREAM_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    private static final ConcurrentHashMap<String, JSONObject> YTM_STREAM_CACHE = new ConcurrentHashMap<>();

    static String extractYtmVideoId(Uri uri, String mediaId) {
        if (uri != null && "ytmusic".equals(uri.getScheme())) {
            String host = uri.getHost();
            if (host == null || host.isEmpty()) {
                String ssp = uri.getSchemeSpecificPart();
                if (ssp != null) host = ssp.replaceFirst("^/+", "");
            }
            if (host != null && host.matches("[A-Za-z0-9_-]{11}")) return host;
        }
        if (mediaId != null && mediaId.startsWith("ytmusic://")) {
            String rest = mediaId.substring("ytmusic://".length());
            if (rest.matches("[A-Za-z0-9_-]{11}")) return rest;
        }
        return null;
    }

    static void invalidateYtmStream(String videoId) {
        if (videoId != null) YTM_STREAM_CACHE.remove(videoId);
    }

    static JSONObject getCachedStreamMeta(Context ctx, String videoId) {
        if (videoId == null) return null;
        JSONObject cached = YTM_STREAM_CACHE.get(videoId);
        if (cached != null) return cached;
        if (ctx == null) return null;
        String raw = ctx.getSharedPreferences("player", 0).getString("ytm_stream_" + videoId, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException ignored) {
            return null;
        }
    }

    static JSONObject resolveYtmStream(Context ctx, String videoId, boolean forceRefresh) throws IOException {
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) {
            throw new IOException("Invalid YouTube Music videoId");
        }
        long nowSec = System.currentTimeMillis() / 1000L;
        if (!forceRefresh) {
            JSONObject cached = YTM_STREAM_CACHE.get(videoId);
            if (cached != null && nowSec + 90L < cached.optLong("expires_at", 0L)) {
                return cached;
            }
        }
        String raw = forceRefresh ? MainActivity.ytmRefreshStream(videoId) : MainActivity.ytmResolveStream(videoId, false);
        try {
            JSONObject info = new JSONObject(raw);
            if (info.has("error") || info.optString("url", "").isEmpty()) {
                throw new IOException(info.optString("error", "Stream resolve failed"));
            }
            YTM_STREAM_CACHE.put(videoId, info);
            if (ctx != null) {
                JSONObject meta = new JSONObject()
                    .put("video_id", videoId)
                    .put("codec", info.optString("codec"))
                    .put("container", info.optString("container"))
                    .put("mime_type", info.optString("mime_type"))
                    .put("itag", info.optInt("itag"))
                    .put("bitrate", info.optLong("bitrate"))
                    .put("bitrate_kbps", info.optInt("bitrate_kbps"))
                    .put("sample_rate", info.optInt("sample_rate"))
                    .put("channels", info.optInt("channels"))
                    .put("duration_ms", info.optLong("duration_ms"))
                    .put("expires_at", info.optLong("expires_at"))
                    .put("client_used", info.optString("client_used"))
                    .put("title", info.optString("title"))
                    .put("author", info.optString("author"));
                ctx.getSharedPreferences("player", 0).edit()
                    .putString("ytm_stream_" + videoId, meta.toString())
                    .apply();
            }
            return info;
        } catch (JSONException e) {
            throw new IOException("Invalid stream JSON", e);
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    static MediaSource.Factory buildMediaSourceFactory(Context context) {
        final Context appCtx = context.getApplicationContext();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(STREAM_USER_AGENT)
            .setAllowCrossProtocolRedirects(true);
        DataSource.Factory upstream = new DefaultDataSource.Factory(appCtx, http);
        ResolvingDataSource.Factory resolving = new ResolvingDataSource.Factory(upstream, dataSpec -> {
            String videoId = extractYtmVideoId(dataSpec.uri, dataSpec.key);
            if (videoId != null && dataSpec.uri != null && "ytmusic".equals(dataSpec.uri.getScheme())) {
                JSONObject info = resolveYtmStream(appCtx, videoId, false);
                return dataSpec.buildUpon()
                    .setUri(Uri.parse(info.optString("url")))
                    .setKey(videoId)
                    .build();
            }
            if (dataSpec.uri != null && dataSpec.uri.getHost() != null
                && dataSpec.uri.getHost().endsWith("googlevideo.com")) {
                String exp = dataSpec.uri.getQueryParameter("expire");
                if (exp != null && dataSpec.key != null && dataSpec.key.matches("[A-Za-z0-9_-]{11}")) {
                    try {
                        long expiresAt = Long.parseLong(exp);
                        if ((System.currentTimeMillis() / 1000L) + 30L >= expiresAt) {
                            JSONObject refreshed = resolveYtmStream(appCtx, dataSpec.key, true);
                            return dataSpec.buildUpon()
                                .setUri(Uri.parse(refreshed.optString("url")))
                                .build();
                        }
                    } catch (NumberFormatException ignored) { }
                }
            }
            return dataSpec;
        });
        return new DefaultMediaSourceFactory(resolving);
    }

    private MediaSession session;
    private AutoMix mixer;
    private RemotePlayback remote;
    private PlaybackJournal journal;
    void playerChanged(){if(remote!=null)remote.attach();if(journal!=null)journal.attach(session.getPlayer());}
    private final android.os.Handler scheduler=new android.os.Handler(android.os.Looper.getMainLooper());
    private android.content.SharedPreferences options;
    private final Runnable sleep=()->{
        if(session!=null)session.getPlayer().pause();
        options.edit().remove("sleep").apply();
    };
    @Override public void onSharedPreferenceChanged(android.content.SharedPreferences prefs,String key) {
        if("remoteIdentity".equals(key) && remote!=null)remote.configure();
        if(!"sleep".equals(key))return;
        scheduler.removeCallbacks(sleep);
        long deadline=prefs.getLong("sleep",0);
        if(deadline>0)scheduler.postDelayed(sleep,Math.max(0,deadline-System.currentTimeMillis()));
    }

    @OptIn(markerClass = UnstableApi.class)
    @Override public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build();
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(buildMediaSourceFactory(this))
            .setAudioAttributes(attributes, true).setHandleAudioBecomingNoisy(true).build();
        session = new MediaSession.Builder(this, player).build();
        options=getSharedPreferences("player",0);
        player.setRepeatMode(options.getInt("repeat",0));
        options.registerOnSharedPreferenceChangeListener(this);
        onSharedPreferenceChanged(options,"sleep");
        mixer = new AutoMix(this, session, player);
        journal = new PlaybackJournal(this,player);
        remote = new RemotePlayback(this,session);
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }

    @Override public void onDestroy() {
        PlayerWidget.display(this,null);
        options.unregisterOnSharedPreferenceChangeListener(this);scheduler.removeCallbacks(sleep);
        if (session != null) {
            remote.close();journal.close();mixer.close();
            session.getPlayer().release();
            session.release();
        }
        super.onDestroy();
    }
}
