package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.TrackSelectionParameters.AudioOffloadPreferences;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.JSONException;
import org.json.JSONObject;

final class MediaHelpers {
    private MediaHelpers() {}

    static AudioAttributes musicAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
    }

    @OptIn(markerClass = UnstableApi.class)
    static ExoPlayer buildExoPlayer(Context context, boolean handleAudioFocus) {
        return new ExoPlayer.Builder(context)
            .setMediaSourceFactory(PlaybackService.buildMediaSourceFactory(context))
            .setLoadControl(PlaybackService.buildLoadControl())
            .setAudioAttributes(musicAudioAttributes(), handleAudioFocus)
            .setHandleAudioBecomingNoisy(true)
            .build();
    }

    static void setAudioOffload(ExoPlayer player, boolean disabled) {
        int mode = disabled
            ? AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED
            : AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_ENABLED;
        if (player.getTrackSelectionParameters().audioOffloadPreferences.audioOffloadMode == mode) return;
        AudioOffloadPreferences pref = new AudioOffloadPreferences.Builder()
            .setAudioOffloadMode(mode)
            .build();
        player.setTrackSelectionParameters(
            player.getTrackSelectionParameters().buildUpon().setAudioOffloadPreferences(pref).build()
        );
    }

    static String extractYtmVideoId(MediaItem item) {
        if (item == null) return null;
        return extractYtmVideoId(
            item.localConfiguration == null ? null : item.localConfiguration.uri,
            item.mediaId
        );
    }

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

    static JSONObject jsonObj(Object... pairs) {
        JSONObject out = new JSONObject();
        try {
            for (int i = 0; i < pairs.length; i += 2) {
                out.put((String) pairs[i], pairs[i + 1]);
            }
        } catch (JSONException e) {
            throw new IllegalArgumentException(e);
        }
        return out;
    }

    static JSONObject streamMetaSnapshot(String videoId, JSONObject info) throws JSONException {
        return new JSONObject()
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
            .put("loudness_db", info.has("loudness_db") && !info.isNull("loudness_db") ? info.optDouble("loudness_db") : JSONObject.NULL)
            .put("expires_at", info.optLong("expires_at"))
            .put("client_used", info.optString("client_used"))
            .put("title", info.optString("title"))
            .put("author", info.optString("author"));
    }
}
