package xyz.siloneedsleep.veluna;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class OfflineStore {
    private static final Object LOCK = new Object();
    private static final long MAX_AUDIO_BYTES = 256L * 1024L * 1024L;
    private static final long MAX_COVER_BYTES = 10L * 1024L * 1024L;

    private OfflineStore() {}

    private static File dir(Context context) {
        File out = new File(context.getApplicationContext().getFilesDir(), "offline");
        if (!out.exists()) out.mkdirs();
        return out;
    }

    private static File indexFile(Context context) {
        return new File(dir(context), "index.json");
    }

    private static boolean validId(String videoId) {
        return videoId != null && videoId.matches("[A-Za-z0-9_-]{11}");
    }

    private static boolean isContainedFile(Context context, String rawPath) {
        if (rawPath == null || rawPath.isEmpty() || rawPath.contains("..") || rawPath.indexOf('\0') >= 0) {
            return false;
        }
        try {
            String rootCanon = dir(context).getCanonicalPath();
            File candidate = new File(rawPath);
            String fileCanon = candidate.getCanonicalPath();
            return fileCanon.startsWith(rootCanon + File.separator) && candidate.isFile();
        } catch (IOException ignored) {
            return false;
        }
    }

    private static String safeExt(String container, String codec) {
        String c = container == null ? "" : container.trim().toLowerCase(java.util.Locale.ROOT);
        if ("webm".equals(c) || "m4a".equals(c) || "ogg".equals(c) || "opus".equals(c) || "mp3".equals(c)) return c;
        if ("mp4".equals(c)) return "m4a";
        return codec != null && codec.toLowerCase(java.util.Locale.ROOT).contains("opus") ? "webm" : "m4a";
    }

    private static JSONArray readIndex(Context context) {
        File idx = indexFile(context);
        if (!idx.isFile()) return new JSONArray();
        try {
            byte[] raw = Files.readAllBytes(idx.toPath());
            return new JSONArray(new String(raw, StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static void writeIndex(Context context, JSONArray array) throws IOException {
        File idx = indexFile(context);
        File tmp = new File(idx.getParentFile(), "index.json.part");
        Files.write(tmp.toPath(), array.toString().getBytes(StandardCharsets.UTF_8));
        Files.move(tmp.toPath(), idx.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    static JSONArray list(Context context) {
        synchronized (LOCK) {
            JSONArray raw = readIndex(context);
            JSONArray clean = new JSONArray();
            boolean changed = false;
            for (int i = 0; i < raw.length(); i++) {
                JSONObject item = raw.optJSONObject(i);
                if (item == null) {
                    changed = true;
                    continue;
                }
                String vid = item.optString("video_id", "");
                String path = item.optString("audio_path", "");
                if (!validId(vid) || !isContainedFile(context, path)) {
                    changed = true;
                    continue;
                }
                clean.put(item);
            }
            if (changed) {
                try { writeIndex(context, clean); } catch (IOException ignored) {}
            }
            return clean;
        }
    }

    static JSONObject getEntry(Context context, String videoId) {
        if (!validId(videoId)) return null;
        JSONArray all = list(context);
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && videoId.equals(item.optString("video_id"))) return item;
        }
        return null;
    }

    static File findAudioFile(Context context, String videoId) {
        JSONObject entry = getEntry(context, videoId);
        if (entry == null) return null;
        String path = entry.optString("audio_path", "");
        return isContainedFile(context, path) ? new File(path) : null;
    }

    private static void downloadUrlToFile(String url, File dest, long maxBytes) throws IOException {
        HttpsURLConnection conn = (HttpsURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("User-Agent", "VelunaMusic-Android");
        File tmp = new File(dest.getParentFile(), dest.getName() + ".part");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            long total = 0L;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[32768];
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > maxBytes) throw new IOException("Offline file exceeds limit");
                    out.write(buf, 0, n);
                }
            }
            if (total <= 0L) throw new IOException("Empty offline download");
            Files.move(tmp.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } finally {
            conn.disconnect();
            if (tmp.exists()) tmp.delete();
        }
    }

    static JSONObject download(Context context, JSONObject request) throws IOException, JSONException {
        String videoId = request.optString("video_id", "");
        if (!validId(videoId)) throw new IOException("Mã bài hát không hợp lệ.");
        JSONObject stream = PlaybackService.resolveYtmStream(context, videoId, false);
        String streamUrl = stream.optString("url", "");
        if (streamUrl.isEmpty()) throw new IOException("Không lấy được nguồn tải âm thanh.");

        String codec = stream.optString("codec", "opus");
        String container = stream.optString("container", "webm");
        String ext = safeExt(container, codec);
        File root = dir(context);
        File audioFile = new File(root, videoId + "." + ext);
        downloadUrlToFile(streamUrl, audioFile, MAX_AUDIO_BYTES);

        String coverPath = "";
        String thumbUrl = request.optString("thumbnail", "");
        if (!thumbUrl.startsWith("https://")) {
            thumbUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
        }
        try {
            File coverFile = new File(root, videoId + ".jpg");
            downloadUrlToFile(thumbUrl, coverFile, MAX_COVER_BYTES);
            coverPath = coverFile.getAbsolutePath();
        } catch (IOException ignored) {}

        String title = request.optString("title", "").trim();
        if (title.isEmpty()) title = stream.optString("title", videoId);
        String artist = request.optString("artist", "").trim();
        if (artist.isEmpty()) artist = stream.optString("author", "");
        String album = request.optString("album", "").trim();
        long durationSec = stream.optLong("duration_ms", 0L) / 1000L;

        String lyricsText = request.optString("lyrics", "").trim();
        if (lyricsText.isEmpty()) {
            try {
                JSONObject lyr = new JSONObject(MainActivity.ytmLyrics(videoId, title, artist, durationSec));
                lyricsText = lyr.optString("synced_lrc", lyr.optString("plain_lyrics", "")).trim();
            } catch (Exception ignored) {}
        }
        String lyricsPath = "";
        if (!lyricsText.isEmpty()) {
            File lrcFile = new File(root, videoId + ".lrc");
            Files.write(lrcFile.toPath(), lyricsText.getBytes(StandardCharsets.UTF_8));
            lyricsPath = lrcFile.getAbsolutePath();
        }

        JSONObject entry = MediaHelpers.jsonObj(
            "video_id", videoId,
            "id", "ytmusic://" + videoId,
            "title", title,
            "artist", artist,
            "album", album,
            "codec", codec,
            "container", container,
            "bitrate_kbps", stream.optInt("bitrate_kbps", 0),
            "sample_rate", stream.optInt("sample_rate", 48000),
            "loudness_db", stream.has("loudness_db") && !stream.isNull("loudness_db") ? stream.optDouble("loudness_db") : JSONObject.NULL,
            "duration_sec", durationSec > 0 ? durationSec : JSONObject.NULL,
            "audio_path", audioFile.getAbsolutePath(),
            "cover_path", coverPath.isEmpty() ? JSONObject.NULL : coverPath,
            "lyrics_path", lyricsPath.isEmpty() ? JSONObject.NULL : lyricsPath,
            "lyrics", lyricsText.isEmpty() ? JSONObject.NULL : lyricsText,
            "size_bytes", audioFile.length(),
            "downloaded_at", System.currentTimeMillis() / 1000L
        );

        synchronized (LOCK) {
            JSONArray existing = readIndex(context);
            JSONArray next = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject row = existing.optJSONObject(i);
                if (row == null) continue;
                if (videoId.equals(row.optString("video_id"))) {
                    String oldAudio = row.optString("audio_path", "");
                    if (!oldAudio.isEmpty() && !oldAudio.equals(audioFile.getAbsolutePath())) {
                        new File(oldAudio).delete();
                    }
                    continue;
                }
                next.put(row);
            }
            next.put(entry);
            writeIndex(context, next);
        }
        return entry;
    }

    static boolean delete(Context context, String videoId) {
        if (!validId(videoId)) return false;
        synchronized (LOCK) {
            JSONArray existing = readIndex(context);
            JSONArray next = new JSONArray();
            boolean removed = false;
            for (int i = 0; i < existing.length(); i++) {
                JSONObject row = existing.optJSONObject(i);
                if (row == null) continue;
                if (videoId.equals(row.optString("video_id"))) {
                    removed = true;
                    String audioPath = row.optString("audio_path", "");
                    String coverPath = row.optString("cover_path", "");
                    String lrcPath = row.optString("lyrics_path", "");
                    if (isContainedFile(context, audioPath)) new File(audioPath).delete();
                    if (isContainedFile(context, coverPath)) new File(coverPath).delete();
                    if (isContainedFile(context, lrcPath)) new File(lrcPath).delete();
                    continue;
                }
                next.put(row);
            }
            if (removed) {
                try { writeIndex(context, next); } catch (IOException ignored) {}
            }
            return removed;
        }
    }
}
