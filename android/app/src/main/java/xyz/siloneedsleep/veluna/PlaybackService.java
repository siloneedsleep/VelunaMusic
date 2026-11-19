package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

public final class PlaybackService extends MediaSessionService implements android.content.SharedPreferences.OnSharedPreferenceChangeListener {
    private static final String STREAM_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    private static final ConcurrentHashMap<String, JSONObject> YTM_STREAM_CACHE = new ConcurrentHashMap<>();
    private static final Set<String> PREFETCH_IN_FLIGHT = ConcurrentHashMap.newKeySet();
    private static final ExecutorService PREFETCH_EXECUTOR = Executors.newSingleThreadExecutor();

    static void preResolveYtmStream(Context ctx, String videoId) {
        if (ctx == null || videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) return;
        long nowSec = System.currentTimeMillis() / 1000L;
        JSONObject cached = YTM_STREAM_CACHE.get(videoId);
        if (cached != null && nowSec + 90L < cached.optLong("expires_at", 0L)) return;
        if (!PREFETCH_IN_FLIGHT.add(videoId)) return;
        final Context appCtx = ctx.getApplicationContext();
        PREFETCH_EXECUTOR.execute(() -> {
            try {
                resolveYtmStream(appCtx, videoId, false);
            } catch (Exception ignored) {
            } finally {
                PREFETCH_IN_FLIGHT.remove(videoId);
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    static DefaultLoadControl buildLoadControl() {
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMs(25_000, 60_000, 1_500, 3_000)
            .build();
    }

    static String extractYtmVideoId(Uri uri, String mediaId) {
        return MediaHelpers.extractYtmVideoId(uri, mediaId);
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
                JSONObject meta = MediaHelpers.streamMetaSnapshot(videoId, info);
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
                java.io.File offlineFile = OfflineStore.findAudioFile(appCtx, videoId);
                if (offlineFile != null) {
                    return dataSpec.buildUpon()
                        .setUri(Uri.fromFile(offlineFile))
                        .setKey(videoId)
                        .build();
                }
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

    static TrackEqualizer attachAudioEffects(Context context, ExoPlayer player) {
        return new TrackEqualizer(context, player);
    }

    private MediaSession session;
    private AutoMix mixer;
    private RemotePlayback remote;
    private PlaybackJournal journal;
    void playerChanged(){if(remote!=null)remote.attach();if(journal!=null){journal.attach(session.getPlayer());journal.save();}}
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
        ExoPlayer player = MediaHelpers.buildExoPlayer(this, true);
        session = new MediaSession.Builder(this, player).build();
        options=getSharedPreferences("player",0);
        player.setRepeatMode(options.getInt("repeat",0));
        player.setShuffleModeEnabled(options.getBoolean("shuffle",false));
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
