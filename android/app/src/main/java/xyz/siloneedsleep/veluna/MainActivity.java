package xyz.siloneedsleep.veluna;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.*;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.media3.common.*;
import androidx.media3.session.*;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.*;
import java.io.*;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static { System.loadLibrary("veluna_core"); }
    static native boolean newerRelease(String installed, String tag);
    private final ArrayList<MediaItem> library = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private MediaController controller;
    private ListenableFuture<MediaController> connection;
    private WebView web;
    private SecretStore secrets;
    private ValueCallback<Uri[]> picture;
    private boolean visible;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!visible || controller == null || !controller.isPlaying()) return;
            call("onVelunaProgress", progress());
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        readLibrary();
        secrets = new SecretStore(this);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        WebViewAssetLoader local = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && WebViewAssetLoader.DEFAULT_DOMAIN.equals(uri.getHost()))
                    return local.shouldInterceptRequest(uri);
                if ("https".equals(uri.getScheme()) && "vkzrgfiopdnujookplbv.supabase.co".equals(uri.getHost())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) { publish(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> reply, FileChooserParams params) {
                if (picture != null) picture.onReceiveValue(null);
                picture = reply;
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), 12);
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "VelunaAndroid");
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        setContentView(web);
        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        connection = new MediaController.Builder(this, token).buildAsync();
        connection.addListener(() -> {
            if (isDestroyed()) return;
            try {
                controller = connection.get();
                if (controller.getMediaItemCount() == 0 && !library.isEmpty()) {
                    int i = index(getPreferences(0).getString("lastId", ""));
                    controller.setMediaItems(library, Math.max(i, 0), getPreferences(0).getLong("lastMs", 0));
                }
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player p, Player.Events events) { publish(); }
                    @Override public void onPlayerError(PlaybackException e) { message("Không đọc được bài đã chọn."); }
                });
                publish();
            } catch (Exception e) { message("Không thể kết nối trình phát."); }
        }, ContextCompat.getMainExecutor(this));
    }

    private void readLibrary() {
        try {
            JSONArray list = new JSONArray(getPreferences(0).getString("tracks", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i);
                library.add(track(Uri.parse(item.getString("id")), item.getString("title")));
            }
        } catch (JSONException ignored) { }
    }
    private MediaItem track(Uri uri, String title) {
        return new MediaItem.Builder().setUri(uri).setMediaId(uri.toString())
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build()).build();
    }
    private int index(String id) {
        for (int i = 0; i < library.size(); i++) if (library.get(i).mediaId.equals(id)) return i;
        return -1;
    }
    private JSONArray tracks() throws JSONException {
        JSONArray result = new JSONArray();
        for (MediaItem item : library) result.put(new JSONObject().put("id", item.mediaId).put("title", String.valueOf(item.mediaMetadata.title)));
        return result;
    }
    private JSONObject progress() {
        JSONObject p = new JSONObject();
        try {
            p.put("time", controller == null ? 0 : Math.max(0, controller.getCurrentPosition()) / 1000.0);
            p.put("duration", controller == null ? 0 : Math.max(0, controller.getDuration()) / 1000.0);
            p.put("playing", controller != null && controller.isPlaying());
        } catch (JSONException ignored) { }
        return p;
    }
    private void publish() {
        handler.removeCallbacks(tick);
        if (!visible) return;
        try {
            JSONObject state = progress().put("tracks", tracks());
            MediaItem item = controller == null ? null : controller.getCurrentMediaItem();
            state.put("id", item == null ? "" : item.mediaId);
            call("onVelunaState", state);
            if (controller != null && controller.isPlaying()) handler.postDelayed(tick, 1000);
        } catch (JSONException ignored) { }
    }
    private void call(String name, Object... args) {
        if (isDestroyed()) return;
        String json = new JSONArray(java.util.Arrays.asList(args)).toString();
        web.evaluateJavascript("window." + name + "?.apply(null," + json + ")", null);
    }
    private void message(String s) { call("onVelunaMessage", s); }
    @Override protected void onStart() { super.onStart(); visible = true; publish(); }
    @Override protected void onStop() {
        visible = false; handler.removeCallbacks(tick);
        if (controller != null && controller.getCurrentMediaItem() != null) getPreferences(0).edit()
            .putString("lastId", controller.getCurrentMediaItem().mediaId).putLong("lastMs", controller.getCurrentPosition()).apply();
        super.onStop();
    }
    @Override protected void onDestroy() {
        if (connection != null) MediaController.releaseFuture(connection);
        if (picture != null) picture.onReceiveValue(null);
        network.shutdownNow();
        web.removeJavascriptInterface("VelunaAndroid"); web.destroy();
        super.onDestroy();
    }
    private void importUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || index(uri.toString()) >= 0) return;
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String title = "Audio";
            try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) title = c.getString(0);
            }
            MediaItem item = track(uri, title);
            library.add(item);
            if (controller != null) controller.addMediaItem(item);
        } catch (RuntimeException e) { message("Thiết bị chưa cấp quyền đọc file."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 12 && picture != null) {
            picture.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            picture = null;
        } else if (request == 11 && result == RESULT_OK && data != null) {
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) importUri(data.getClipData().getItemAt(i).getUri());
            else importUri(data.getData());
            try { getPreferences(0).edit().putString("tracks", tracks().toString()).apply(); }
            catch (JSONException ignored) { }
            publish();
        }
    }

    public final class Bridge {
        @JavascriptInterface public String readSecret(String slot) {
            try { return secrets.read(slot); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public boolean writeSecret(String slot, String value) {
            try { return secrets.write(slot, value); } catch (Exception e) { return false; }
        }
        @JavascriptInterface public void pick() { runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), 11)); }
        @JavascriptInterface public void refresh() { runOnUiThread(MainActivity.this::publish); }
        @JavascriptInterface public void select(String id, boolean play, long ms) { runOnUiThread(() -> {
            int i = index(id);
            if (controller == null || i < 0) return;
            controller.seekTo(i, Math.max(ms, 0)); controller.prepare(); controller.setPlayWhenReady(play);
        }); }
        @JavascriptInterface public void toggle() { runOnUiThread(() -> {
            if (controller == null) return;
            if (controller.isPlaying()) controller.pause();
            else { controller.prepare(); controller.play(); }
        }); }
        @JavascriptInterface public void seek(long ms) { runOnUiThread(() -> { if (controller != null) controller.seekTo(Math.max(ms, 0)); }); }
        @JavascriptInterface public void checkUpdate(boolean manual) { network.execute(() -> {
            try {
                Release release = Release.latest();
                runOnUiThread(() -> {
                    if (release != null) call("onVelunaUpdate", release.tag, "");
                    else if (manual) message("Đang dùng bản mới nhất hiện có.");
                });
            } catch (Exception e) { if (manual) runOnUiThread(() -> message("Chưa thể kiểm tra bản cập nhật.")); }
        }); }
        @JavascriptInterface public void installUpdate(String version) { runOnUiThread(() -> {
            if (!getPackageManager().canRequestPackageInstalls()) {
                call("onVelunaUpdate", "", "Cho phép cài đặt rồi nhấn Tải và cài đặt lần nữa.");
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                return;
            }
            network.execute(() -> {
                try {
                    Release r = Release.latest();
                    if (r == null || !r.tag.equals(version)) throw new IOException();
                    File apk = r.download(getCacheDir());
                    runOnUiThread(() -> {
                        if (isDestroyed()) return;
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".updates", apk);
                        try { startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                            call("onVelunaUpdate", "", "");
                        } catch (ActivityNotFoundException e) { call("onVelunaUpdate", "", "Thiết bị thiếu trình cài đặt APK."); }
                    });
                } catch (Exception e) { runOnUiThread(() -> call("onVelunaUpdate", "", "Tải hoặc xác minh bản cập nhật thất bại.")); }
            });
        }); }
    }
}
