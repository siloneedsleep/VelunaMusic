package xyz.siloneedsleep.veluna;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
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
    static native String analyzeAudio(int fd);
    private final ArrayList<MediaItem> library = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private MediaController controller;
    private ListenableFuture<MediaController> connection;
    private WebView web;
    private SecretStore secrets;
    private ValueCallback<Uri[]> picture;
    private boolean visible;
    private volatile String spotifyReturn = "";
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!visible || controller == null || !controller.isPlaying()) return;
            call("onVelunaProgress", progress());
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        acceptSpotifyIntent(getIntent());
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
                if (!request.isForMainFrame() && "https".equals(uri.getScheme()) && java.util.Arrays.asList(
                    "vkzrgfiopdnujookplbv.supabase.co","api.openai.com","openrouter.ai","accounts.spotify.com","api.spotify.com").contains(uri.getHost())) return null;
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
            p.put("ready", controller != null && controller.getPlaybackState() == Player.STATE_READY);
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
        } else if (request == 13 && result == RESULT_OK && data != null && data.getData() != null) {
            importAlbum(data.getData());
        } else if (request == 11 && result == RESULT_OK && data != null) {
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) importUri(data.getClipData().getItemAt(i).getUri());
            else importUri(data.getData());
            try { getPreferences(0).edit().putString("tracks", tracks().toString()).apply(); }
            catch (JSONException ignored) { }
            publish();
        }
    }

    private void importAlbum(Uri tree) {
        try { getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (SecurityException e) { message("Không có quyền đọc thư mục."); return; }
        network.execute(() -> {
            ArrayList<MediaItem> album = new ArrayList<>();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE};
            try (Cursor c = getContentResolver().query(children,columns,null,null,null)) {
                while (c != null && c.moveToNext()) {
                    String mime=c.getString(2);
                    if (mime!=null && mime.startsWith("audio/")) album.add(track(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),c.getString(1)));
                }
                album.sort((a,b)->String.valueOf(a.mediaMetadata.title).compareToIgnoreCase(String.valueOf(b.mediaMetadata.title)));
                runOnUiThread(() -> {
                    if (isDestroyed() || controller==null) return;
                    if (album.isEmpty()) {message("Thư mục này chưa có file âm thanh.");return;}
                    JSONArray ids=new JSONArray();
                    for(MediaItem item:album){if(index(item.mediaId)<0) library.add(item); ids.put(item.mediaId);}
                    try {getPreferences(0).edit().putString("tracks",tracks().toString()).apply();} catch(JSONException ignored){}
                    controller.pause(); controller.setMediaItems(album); controller.prepare(); publish(); call("onVelunaAlbum",ids);
                });
            } catch (RuntimeException e) { runOnUiThread(()->message("Không đọc được thư mục này.")); }
        });
    }
    private void acceptSpotifyIntent(Intent intent) {
        Uri uri=intent==null?null:intent.getData();
        if(uri!=null && "velunamusic".equals(uri.getScheme()) && "spotify".equals(uri.getHost()) && "/callback".equals(uri.getPath()) && uri.toString().length()<=4096) spotifyReturn=uri.toString();
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);acceptSpotifyIntent(intent);
        if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('spotify-return'))",null);
    }
    public final class Bridge {
        @JavascriptInterface public String spotifyCallback() {return spotifyReturn;}
        @JavascriptInterface public void openSpotify(String address) {
            Uri uri=Uri.parse(address);
            if(!"https".equals(uri.getScheme()) || uri.getUserInfo()!=null || uri.getPort()!=-1) return;
            boolean allowed=("accounts.spotify.com".equals(uri.getHost()) && "/authorize".equals(uri.getPath())) ||
                "open.spotify.com".equals(uri.getHost()) || ("www.spotify.com".equals(uri.getHost()) && "/account/apps/".equals(uri.getPath()));
            if(allowed)runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException e){message("Thiết bị thiếu trình duyệt để mở Spotify.");}});
        }
        @JavascriptInterface public void pickAlbum() { runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE),13)); }
        @JavascriptInterface public void setMix(boolean enabled, String from, String to, int ms) {
            getSharedPreferences("dj", 0).edit().putBoolean("enabled",enabled)
                .putString("from",from).putString("to",to).putLong("width",Math.max(0,Math.min(12000,ms))).apply();
        }
        @JavascriptInterface public void analyzeTrack(String ticket, String id) { runOnUiThread(() -> {
            if (index(id) < 0) { call("onVelunaTransferReply", ticket, "", "Thiếu file nhạc."); return; }
            network.execute(() -> {
                try (ParcelFileDescriptor descriptor = getContentResolver().openFileDescriptor(Uri.parse(id), "r")) {
                    if (descriptor == null) throw new IOException();
                    String result = analyzeAudio(descriptor.detachFd());
                    if (result == null) throw new IOException();
                    JSONObject analysis = new JSONObject(result);
                    runOnUiThread(() -> call("onVelunaTransferReply", ticket, analysis, ""));
                } catch (Exception e) { runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", "Không phân tích được file.")); }
            });
        }); }
        @JavascriptInterface public void inspectTrack(String ticket, String id) { runOnUiThread(() -> {
            if (index(id) < 0) { call("onVelunaTransferReply", ticket, "", "Thiếu file nhạc."); return; }
            network.execute(() -> {
                try {
                    Uri uri = Uri.parse(id);
                    android.media.MediaMetadataRetriever probe = new android.media.MediaMetadataRetriever();
                    try {
                        probe.setDataSource(MainActivity.this, uri);
                        String duration = probe.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
                        if (duration == null || Long.parseLong(duration) <= 0) throw new IOException();
                    } finally { probe.release(); }
                    java.security.MessageDigest sha = java.security.MessageDigest.getInstance("SHA-256");
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IOException();
                        byte[] block = new byte[65536]; int n;
                        while ((n = in.read(block)) >= 0) sha.update(block, 0, n);
                    }
                    StringBuilder out = new StringBuilder();
                    for (byte b : sha.digest()) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
                    runOnUiThread(() -> call("onVelunaTransferReply", ticket, out.toString(), ""));
                } catch (Exception e) { runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", "Không đọc được file nhạc.")); }
            });
        }); }
        @JavascriptInterface public void pauseForTransfer(String ticket, String id) { runOnUiThread(() -> {
            MediaItem item = controller == null ? null : controller.getCurrentMediaItem();
            if (item == null || !item.mediaId.equals(id)) { call("onVelunaTransferReply", ticket, "", "Bài đang phát đã đổi."); return; }
            JSONObject playback = progress();
            controller.pause(); call("onVelunaTransferReply", ticket, playback, "");
        }); }
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
            int queued=-1;
            for(int n=0; n<controller.getMediaItemCount(); n++) if(id.equals(controller.getMediaItemAt(n).mediaId)){queued=n;break;}
            if(queued>=0) controller.seekTo(queued, Math.max(ms,0));
            else controller.setMediaItems(library,i,Math.max(ms,0));
            controller.prepare(); controller.setPlayWhenReady(play);
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
