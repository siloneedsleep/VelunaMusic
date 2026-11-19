package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.JSONArray;
import org.json.JSONObject;

final class TrackEqualizer implements Player.Listener, SharedPreferences.OnSharedPreferenceChangeListener {
    private static final double[] BAND_FREQS_HZ = {
        32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0
    };
    private final Context context;
    private final SharedPreferences prefs;
    private final ExoPlayer player;
    private Equalizer effect;
    private LoudnessEnhancer loudness;
    private int session;

    TrackEqualizer(Context context, ExoPlayer audio) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences("sound", 0);
        this.player = audio;
        this.prefs.registerOnSharedPreferenceChangeListener(this);
        this.player.addListener(this);
        apply();
    }

    private void releaseEq() {
        if (effect != null) {
            try { effect.release(); } catch (RuntimeException ignored) {}
            effect = null;
        }
    }

    private void releaseLoudness() {
        if (loudness != null) {
            try { loudness.release(); } catch (RuntimeException ignored) {}
            loudness = null;
        }
    }

    private void release() {
        releaseEq();
        releaseLoudness();
    }

    private double[] readBands10() {
        String raw = prefs.getString("bands10", "");
        if (raw != null && !raw.isEmpty()) {
            try {
                JSONArray arr = new JSONArray(raw);
                if (arr.length() == 10) {
                    double[] out = new double[10];
                    for (int i = 0; i < 10; i++) {
                        double v = arr.optDouble(i, 0.0);
                        if (!Double.isFinite(v)) v = 0.0;
                        out[i] = Math.max(-12.0, Math.min(12.0, v));
                    }
                    return out;
                }
            } catch (Exception ignored) {}
        }
        int bass = prefs.getInt("bass", 0);
        int mid = prefs.getInt("mid", 0);
        int high = prefs.getInt("high", 0);
        return new double[] { bass, bass, bass, mid, mid, mid, mid, high, high, high };
    }

    private static double interpolateGainDb(double[] bands10, double freqHz) {
        if (freqHz <= BAND_FREQS_HZ[0]) return bands10[0];
        if (freqHz >= BAND_FREQS_HZ[9]) return bands10[9];
        double logF = Math.log(freqHz);
        for (int i = 0; i < 9; i++) {
            if (freqHz >= BAND_FREQS_HZ[i] && freqHz <= BAND_FREQS_HZ[i + 1]) {
                double logA = Math.log(BAND_FREQS_HZ[i]);
                double logB = Math.log(BAND_FREQS_HZ[i + 1]);
                double t = (logF - logA) / Math.max(1e-6, logB - logA);
                return bands10[i] + (bands10[i + 1] - bands10[i]) * t;
            }
        }
        return 0.0;
    }

    private int computeLoudnessGainMb() {
        int baseGainMb = prefs.getInt("normalizeGainMb", 150);
        MediaItem current = player.getCurrentMediaItem();
        String vid = MediaHelpers.extractYtmVideoId(current);
        if (vid != null) {
            JSONObject meta = PlaybackService.getCachedStreamMeta(context, vid);
            if (meta != null && meta.has("loudness_db") && !meta.isNull("loudness_db")) {
                double ldb = meta.optDouble("loudness_db", Double.NaN);
                if (Double.isFinite(ldb)) {
                    int compensated = (int) Math.round(-ldb * 100.0);
                    return Math.max(-600, Math.min(600, compensated));
                }
            }
        }
        return Math.max(-600, Math.min(600, baseGainMb));
    }

    void apply() {
        int next = player.getAudioSessionId();
        if (session != next) {
            release();
            session = next;
        }
        if (next <= 0) {
            release();
            return;
        }

        boolean eqEnabled = prefs.getBoolean("enabled", false);
        boolean normEnabled = prefs.getBoolean("normalize", false);

        if (eqEnabled) {
            try {
                if (effect == null) effect = new Equalizer(0, next);
                double[] bands10 = readBands10();
                double maxBoost = 0.0;
                for (double v : bands10) maxBoost = Math.max(maxBoost, v);
                double headroom = maxBoost * 0.45;
                short[] range = effect.getBandLevelRange();
                short count = effect.getNumberOfBands();
                for (short band = 0; band < count; band++) {
                    double hz = Math.max(20.0, effect.getCenterFreq(band) / 1000.0);
                    double db = interpolateGainDb(bands10, hz) - headroom;
                    short mb = (short) Math.max(range[0], Math.min(range[1], Math.round(db * 100.0)));
                    effect.setBandLevel(band, mb);
                }
                effect.setEnabled(true);
                prefs.edit().putString("result", "EQ 10 dải tần đang hoạt động.").apply();
            } catch (RuntimeException unavailable) {
                releaseEq();
                prefs.edit().putString("result", "Đường âm thanh này chưa hỗ trợ EQ.").apply();
            }
        } else {
            releaseEq();
        }

        if (normEnabled) {
            try {
                if (loudness == null) loudness = new LoudnessEnhancer(next);
                int targetMb = computeLoudnessGainMb();
                loudness.setTargetGain(Math.max(0, targetMb));
                loudness.setEnabled(true);
            } catch (RuntimeException unavailable) {
                releaseLoudness();
            }
        } else {
            releaseLoudness();
        }
    }

    @Override public void onAudioSessionIdChanged(int id) { apply(); }
    @Override public void onMediaItemTransition(MediaItem item, int reason) { apply(); }
    @Override public void onSharedPreferenceChanged(SharedPreferences p, String key) {
        if (!"result".equals(key)) apply();
    }

    void close() {
        prefs.unregisterOnSharedPreferenceChangeListener(this);
        player.removeListener(this);
        release();
    }
}
