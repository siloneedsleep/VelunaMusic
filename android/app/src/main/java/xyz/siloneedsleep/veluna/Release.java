package xyz.siloneedsleep.veluna;

import org.json.*;
import java.io.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;

final class Release {
    private static final String ASSET = "VelunaMusic-Android.apk";
    final String tag, url, digest;
    final long size;

    private Release(String tag, String url, String digest, long size) {
        this.tag = tag; this.url = url; this.digest = digest; this.size = size;
    }
    private static HttpsURLConnection open(String url) throws IOException {
        HttpsURLConnection c = (HttpsURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(12000); c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "VelunaMusic-Android");
        return c;
    }
    static Release latest() throws Exception {
        HttpsURLConnection c = open("https://api.github.com/repos/siloneedsleep/VelunaMusic/releases/latest");
        try {
            if (c.getResponseCode() == 404) return null;
            try (InputStream stream = c.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] block = new byte[8192]; int n;
                while ((n = stream.read(block)) != -1) {
                    if (bytes.size() + n > 2 * 1024 * 1024) throw new IOException();
                    bytes.write(block, 0, n);
                }
                JSONObject release = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
                String tag = release.getString("tag_name");
                if (release.getBoolean("draft") || release.getBoolean("prerelease") || !MainActivity.newerRelease(BuildConfig.VERSION_NAME, tag)) return null;
                String url = "https://github.com/siloneedsleep/VelunaMusic/releases/download/" + tag + "/" + ASSET;
                JSONArray assets = release.getJSONArray("assets");
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    long size = a.optLong("size");
                    String digest = a.optString("digest");
                    if (ASSET.equals(a.optString("name")) && "uploaded".equals(a.optString("state")) && url.equals(a.optString("browser_download_url"))
                        && size > 0 && size <= 256L * 1024 * 1024 && digest.matches("sha256:[0-9a-f]{64}")) return new Release(tag, url, digest.substring(7), size);
                }
                throw new IOException("Missing verified Android asset");
            }
        } finally { c.disconnect(); }
    }
    File download(File cacheDir) throws Exception {
        File dir = new File(cacheDir, "updates"); Files.createDirectories(dir.toPath());
        File temp = File.createTempFile("update-", ".part", dir);
        HttpsURLConnection c = open(url);
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            long count = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(temp)) {
                byte[] block = new byte[65536]; int n;
                while ((n = in.read(block)) != -1) {
                    count += n; if (count > size) throw new IOException();
                    sha.update(block, 0, n); out.write(block, 0, n);
                }
            }
            StringBuilder sum = new StringBuilder();
            for (byte b : sha.digest()) sum.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            if (count != size || !digest.equals(sum.toString())) throw new IOException("APK verification failed");
            File apk = new File(dir, "VelunaMusic.apk");
            Files.move(temp.toPath(), apk.toPath(), StandardCopyOption.REPLACE_EXISTING);
            return apk;
        } finally { c.disconnect(); temp.delete(); }
    }
}
