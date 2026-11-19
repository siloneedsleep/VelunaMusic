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
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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
    static native String readMediaTags(int fd, boolean artwork);
    static native String ytmSearch(String query, String filter);
    static native String ytmResolveStream(String videoId, boolean forceRefresh);
    static native String ytmRefreshStream(String videoId);
    static native String ytmAlbum(String browseId);
    static native String ytmArtist(String browseId);
    static native String ytmHome(String params, String continuation);
    static native String ytmLyrics(String videoId, String title, String artist, long durationSec);
    private final ArrayList<MediaItem> library = new ArrayList<>();
    private final java.util.concurrent.ConcurrentHashMap<String, JSONObject> ytmMeta = new java.util.concurrent.ConcurrentHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private MediaController controller;
    private Runnable pendingSelection;
    private ListenableFuture<MediaController> connection;
    private WebView web;
    private SecretStore secrets;
    private NearbyClient nearby;
    private ValueCallback<Uri[]> picture;
    private boolean visible;
    private volatile int streamVolume=100;
    private volatile String spotifyReturn = "";
    private int safeTopDp = 0, safeBottomDp = 0;

    private void pushSafeInsets() {
        if (web == null || isDestroyed()) return;
        String js = "document.documentElement.style.setProperty('--safe-top','" + safeTopDp + "px');"
            + "document.documentElement.style.setProperty('--safe-bottom','" + safeBottomDp + "px');";
        web.evaluateJavascript(js, null);
    }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!visible || controller == null || !controller.isPlaying()) return;
            call("onVelunaProgress", progress());
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(0x00000000);
        getWindow().setNavigationBarColor(0x00000000);
        acceptSpotifyIntent(getIntent());
        readLibrary();
        secrets = new SecretStore(this);
        nearby = new NearbyClient(this,secrets,(type,value)->call("onVelunaNearby",type,value));
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
                    "api.github.com","vkzrgfiopdnujookplbv.supabase.co","api.openai.com","openrouter.ai","accounts.spotify.com","api.spotify.com",
                    "lh3.googleusercontent.com","i.ytimg.com","yt3.ggpht.com","yt3.googleusercontent.com").contains(uri.getHost())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) { pushSafeInsets(); publish(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> reply, FileChooserParams params) {
                if (picture != null) picture.onReceiveValue(null);
                picture = reply;
                boolean images=java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(type->type.startsWith("image/"));
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(images?"image/*":"*/*").addCategory(Intent.CATEGORY_OPENABLE), 12);
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "VelunaAndroid");
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        setContentView(web);
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            float density = Math.max(1f, getResources().getDisplayMetrics().density);
            safeTopDp = Math.round(bars.top / density);
            safeBottomDp = Math.round(bars.bottom / density);
            pushSafeInsets();
            return insets;
        });
        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        connection = new MediaController.Builder(this, token).buildAsync();
        connection.addListener(() -> {
            if (isDestroyed()) return;
            try {
                controller = connection.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player p, Player.Events events) { publish(); }
                    @Override public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                        publish();
                        call("onVelunaTrackTransition", mediaItem == null ? "" : mediaItem.mediaId, reason);
                    }
                    @Override public void onPlayerError(PlaybackException e) {
                        MediaItem cur = controller == null ? null : controller.getCurrentMediaItem();
                        String vid = cur == null ? null : PlaybackService.extractYtmVideoId(
                            cur.localConfiguration == null ? null : cur.localConfiguration.uri, cur.mediaId);
                        message(vid != null ? "Đang làm mới luồng phát YouTube Music." : "Không đọc được bài đã chọn.");
                    }
                });
                Runnable selection=pendingSelection;
                pendingSelection=null;
                if(selection!=null)selection.run();
                publish();
            } catch (Exception e) {pendingSelection=null;message("Không thể kết nối trình phát."); }
        }, ContextCompat.getMainExecutor(this));
    }

    private void readLibrary() {
        try {
            JSONArray list = new JSONArray(getPreferences(0).getString("tracks", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i);
                String id = item.getString("id");
                if (id.startsWith("ytmusic://")) ytmMeta.put(id, item);
                library.add(buildMediaItem(Uri.parse(id), item));
            }
        } catch (JSONException ignored) { }
    }
    static MediaItem buildMediaItem(Uri uri, JSONObject item) {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .setTitle(item.optString("title", "Audio"));
        String artist = item.optString("artist", item.optString("artist_text", ""));
        if (!artist.isEmpty()) md.setArtist(artist);
        String album = item.optString("album", "");
        if (!album.isEmpty()) md.setAlbumTitle(album);
        String thumb = item.optString("thumbnail", "");
        if (!thumb.isEmpty()) md.setArtworkUri(Uri.parse(thumb));
        return new MediaItem.Builder().setUri(uri).setMediaId(uri.toString())
            .setMediaMetadata(md.build()).build();
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
        for (MediaItem item : library) {
            JSONObject row = new JSONObject();
            JSONObject meta = ytmMeta.get(item.mediaId);
            if (meta != null) {
                for (java.util.Iterator<String> it = meta.keys(); it.hasNext(); ) {
                    String k = it.next();
                    row.put(k, meta.get(k));
                }
            }
            row.put("id", item.mediaId);
            row.put("title", String.valueOf(item.mediaMetadata.title));
            if (item.mediaId.startsWith("ytmusic://")) {
                row.put("source", "ytmusic");
                String vid = item.mediaId.substring("ytmusic://".length());
                row.put("video_id", vid);
                JSONObject streamMeta = PlaybackService.getCachedStreamMeta(this, vid);
                if (streamMeta != null) {
                    row.put("codec", streamMeta.optString("codec"));
                    row.put("container", streamMeta.optString("container"));
                    row.put("bitrate", streamMeta.optLong("bitrate"));
                    row.put("bitrate_kbps", streamMeta.optInt("bitrate_kbps"));
                    row.put("sample_rate", streamMeta.optInt("sample_rate"));
                    row.put("expires_at", streamMeta.optLong("expires_at"));
                }
            }
            result.put(row);
        }
        return result;
    }
    private JSONObject normalizeYtmEntry(JSONObject raw) throws JSONException {
        String vid = raw.optString("video_id", "");
        if (vid.isEmpty()) {
            String rawId = raw.optString("id", "");
            if (rawId.startsWith("ytmusic://")) vid = rawId.substring("ytmusic://".length());
            else if (rawId.matches("[a-zA-Z0-9_-]{11}")) vid = rawId;
        }
        if (!vid.matches("[a-zA-Z0-9_-]{11}")) throw new JSONException("Invalid video_id");
        String uriStr = "ytmusic://" + vid;
        String title = raw.optString("title", "YouTube Music · " + vid);
        String artist = raw.optString("artist", raw.optString("artist_text", ""));
        String albumName = "";
        Object albObj = raw.opt("album");
        if (albObj instanceof JSONObject) albumName = ((JSONObject) albObj).optString("name", "");
        else if (albObj instanceof String) albumName = (String) albObj;
        String thumb = raw.optString("thumbnail", "");
        if (thumb.isEmpty()) {
            JSONArray thumbs = raw.optJSONArray("thumbnails");
            if (thumbs != null && thumbs.length() > 0) thumb = thumbs.optString(thumbs.length() - 1, "");
        }
        JSONObject out = new JSONObject();
        out.put("id", uriStr);
        out.put("video_id", vid);
        out.put("source", "ytmusic");
        out.put("title", title);
        out.put("artist", artist);
        out.put("album", albumName);
        if (raw.has("duration_sec") && !raw.isNull("duration_sec")) out.put("duration_sec", raw.optLong("duration_sec"));
        if (!thumb.isEmpty()) out.put("thumbnail", thumb);
        if (raw.has("recording_kind")) out.put("recording_kind", raw.optString("recording_kind", "original"));
        if (raw.has("recording_label")) out.put("recording_label", raw.optString("recording_label", "Bản gốc"));
        return out;
    }
    private void upsertYtmTracks(JSONArray list, int startIndex, boolean playNow) {
        if (isDestroyed() || list == null || list.length() == 0) return;
        ArrayList<MediaItem> queue = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            try {
                JSONObject meta = normalizeYtmEntry(list.getJSONObject(i));
                String id = meta.getString("id");
                ytmMeta.put(id, meta);
                MediaItem mi = buildMediaItem(Uri.parse(id), meta);
                int at = index(id);
                if (at >= 0) library.set(at, mi);
                else library.add(mi);
                queue.add(mi);
            } catch (JSONException ignored) { }
        }
        if (queue.isEmpty()) return;
        try { getPreferences(0).edit().putString("tracks", tracks().toString()).apply(); } catch (JSONException ignored) { }
        if (playNow && controller == null) {
            pendingSelection=()->{controller.setMediaItems(queue,Math.max(0,Math.min(startIndex,queue.size()-1)),0L);
                controller.prepare();controller.play();};
        } else if (playNow) {
            int bounded = Math.max(0, Math.min(startIndex, queue.size() - 1));
            controller.setMediaItems(queue, bounded, 0L);
            controller.prepare();
            controller.play();
        }
        publish();
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
            if(controller!=null)streamVolume=Math.round(controller.getVolume()*100);
            if(controller!=null){
                boolean added=false;
                for(int n=0;n<controller.getMediaItemCount();n++){
                    MediaItem incoming=controller.getMediaItemAt(n);
                    if(incoming.mediaId.startsWith("ytmusic://") && !ytmMeta.containsKey(incoming.mediaId)){
                        JSONObject row=normalizeYtmEntry(new JSONObject().put("id",incoming.mediaId)
                            .put("title",String.valueOf(incoming.mediaMetadata.title)));
                        ytmMeta.put(incoming.mediaId,row);library.add(incoming);added=true;
                    }
                }
                if(added)getPreferences(0).edit().putString("tracks",tracks().toString()).apply();
            }
            JSONObject state = progress().put("tracks", tracks());
            if(controller!=null) {
                JSONArray queue=new JSONArray();
                for(int n=0;n<controller.getMediaItemCount();n++)queue.put(controller.getMediaItemAt(n).mediaId);
                state.put("queue",queue);
            }
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
        nearby.stopDiscovery();
        visible = false; handler.removeCallbacks(tick);

        if(controller!=null)PlaybackJournal.save(controller,getPreferences(0));
        super.onStop();
    }
    @Override protected void onDestroy() {
        nearby.close();
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
        com.google.zxing.integration.android.IntentResult scan=com.google.zxing.integration.android.IntentIntegrator.parseActivityResult(request,result,data);
        if(scan!=null){if(scan.getContents()!=null) nearby.pair(scan.getContents());return;}
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
        @JavascriptInterface public void setEqualizer(boolean enabled,int bass,int mid,int high){
            if(Math.abs((long)bass)>6 || Math.abs((long)mid)>6 || Math.abs((long)high)>6)return;
            runOnUiThread(()->{
                android.content.SharedPreferences prefs=getSharedPreferences("sound",0);
                JSONArray bands=new JSONArray();
                for(int v:new int[]{bass,bass,bass,mid,mid,mid,mid,high,high,high})bands.put(v);
                prefs.edit().putBoolean("enabled",enabled).putInt("bass",bass).putInt("mid",mid).putInt("high",high)
                    .putString("bands10",bands.toString()).apply();
                call("onVelunaSoundStatus",enabled?prefs.getString("result","EQ sẽ áp dụng khi bắt đầu phát."):"Đã tắt EQ.");
            });
        }
        @JavascriptInterface public void setEqualizer10(boolean enabled,String bandsJson,boolean normalize,int targetGainMb){
            runOnUiThread(()->{
                try{
                    JSONArray parsed=new JSONArray(bandsJson);
                    if(parsed.length()!=10)return;
                    JSONArray clean=new JSONArray();
                    for(int i=0;i<10;i++){
                        double v=parsed.optDouble(i,0.0);
                        if(!Double.isFinite(v))v=0.0;
                        clean.put(Math.max(-12.0,Math.min(12.0,v)));
                    }
                    int clampedGain=Math.max(-600,Math.min(600,targetGainMb));
                    android.content.SharedPreferences prefs=getSharedPreferences("sound",0);
                    prefs.edit().putBoolean("enabled",enabled).putString("bands10",clean.toString())
                        .putBoolean("normalize",normalize).putInt("normalizeGainMb",clampedGain).apply();
                    call("onVelunaSoundStatus",enabled || normalize ? prefs.getString("result","EQ 10 dải tần đang áp dụng.") : "Đã tắt EQ và chuẩn hóa âm lượng.");
                }catch(Exception ignored){}
            });
        }
        @JavascriptInterface public int playerVolume(){return streamVolume;}
        @JavascriptInterface public void remotePlayer(String ticket,String json){runOnUiThread(()->{
            try{
                if(controller==null)throw new IllegalStateException("Máy phát chưa sẵn sàng.");
                RemotePlayback.apply(controller,new JSONObject(json));
                publish();call("onVelunaTransferReply",ticket,true,"");
            }catch(Exception e){call("onVelunaTransferReply",ticket,false,e.getMessage()==null?"Lệnh không hợp lệ.":e.getMessage());}
        });}
        @JavascriptInterface public void repeat(int mode) {
            if(mode<0 || mode>2)return;
            getSharedPreferences("player",0).edit().putInt("repeat",mode).apply();
            runOnUiThread(()->{if(controller!=null)controller.setRepeatMode(mode);});
        }
        @JavascriptInterface public void setShuffle(boolean enabled) {
            getSharedPreferences("player",0).edit().putBoolean("shuffle",enabled).apply();
            runOnUiThread(()->{if(controller!=null)controller.setShuffleModeEnabled(enabled);});
        }
        @JavascriptInterface public String deviceName() {
            String m = Build.MODEL;
            return (m == null || m.trim().isEmpty()) ? "Android" : m.trim();
        }
        @JavascriptInterface public void sleepUntil(long time) {
            long now=System.currentTimeMillis();
            if(time==0 || (time>=now && time<=now+3600000L+1000))
                getSharedPreferences("player",0).edit().putLong("sleep",time).apply();
        }
        @JavascriptInterface public void reorderQueue(String json) { runOnUiThread(()->{
            if(controller==null)return;
            try {
                JSONArray ids=new JSONArray(json);
                if(ids.length()!=controller.getMediaItemCount())return;
                for(int target=0;target<ids.length();target++) {
                    String id=ids.getString(target);
                    for(int pos=target;pos<ids.length();pos++)if(controller.getMediaItemAt(pos).mediaId.equals(id)){
                        if(pos!=target)controller.moveMediaItem(pos,target);break;
                    }
                }
                publish();
            }catch(JSONException e){message("Hàng chờ không hợp lệ.");}
        });}
        @JavascriptInterface public void playQueue(String json) { runOnUiThread(() -> {
            if (controller == null) { message("Trình phát đang khởi động."); return; }
            try {
                JSONArray ids = new JSONArray(json);
                if (ids.length() == 0 || ids.length() > 1000) return;
                ArrayList<MediaItem> queue = new ArrayList<>();
                for (int i=0; i<ids.length(); i++) {
                    int at=index(ids.getString(i));
                    if (at<0) {message("Một bài trong playlist đã rời thư viện."); return;}
                    queue.add(library.get(at));
                }
                controller.setMediaItems(queue); controller.prepare(); controller.play(); publish();
            } catch (JSONException invalid) {message("Playlist không hợp lệ.");}
        }); }
        @JavascriptInterface public void openYouTube(String id) {
            if (id == null || !id.matches("[a-zA-Z0-9_-]{11}")) return;
            runOnUiThread(() -> {
                try {
                    String trackId = "ytmusic://" + id;
                    JSONObject initial = ytmMeta.get(trackId);
                    if (initial == null) {
                        initial = new JSONObject()
                            .put("id", trackId)
                            .put("video_id", id)
                            .put("title", "YouTube Music · " + id)
                            .put("source", "ytmusic");
                    }
                    upsertYtmTracks(new JSONArray().put(initial), 0, controller != null);
                    if (controller == null) pendingSelection = () -> selectTrack(trackId, true, 0L);
                    final JSONObject snapshot = initial;
                    network.execute(() -> {
                        try {
                            JSONObject stream = PlaybackService.resolveYtmStream(MainActivity.this, id, false);
                            JSONObject enriched = new JSONObject(snapshot.toString());
                            String t = stream.optString("title", "");
                            String a = stream.optString("author", "");
                            if (!t.isEmpty()) enriched.put("title", t);
                            if (!a.isEmpty()) enriched.put("artist", a);
                            long durMs = stream.optLong("duration_ms", 0L);
                            if (durMs > 0L) enriched.put("duration_sec", durMs / 1000L);
                            runOnUiThread(() -> upsertYtmTracks(new JSONArray().put(enriched), 0, false));
                        } catch (Exception ignored) { }
                    });
                } catch (JSONException ignored) { }
            });
        }
        private void runYtmTask(String ticket, java.util.concurrent.Callable<String> task) {
            network.execute(() -> {
                try {
                    String raw = task.call();
                    JSONObject obj = new JSONObject(raw);
                    String err = obj.optString("error", "");
                    runOnUiThread(() -> {
                        if (!err.isEmpty()) call("onVelunaTransferReply", ticket, "", err);
                        else call("onVelunaTransferReply", ticket, obj, "");
                    });
                } catch (Exception e) {
                    String msgText = e.getMessage() == null ? "Lỗi kết nối YouTube Music." : e.getMessage();
                    runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", msgText));
                }
            });
        }
        @JavascriptInterface public void ytmSearch(String ticket, String query, String filter) {
            runYtmTask(ticket, () -> MainActivity.ytmSearch(query, filter == null ? "all" : filter));
        }
        @JavascriptInterface public void ytmStream(String ticket, String videoId, boolean forceRefresh) {
            runYtmTask(ticket, () -> {
                JSONObject info = PlaybackService.resolveYtmStream(MainActivity.this, videoId, forceRefresh);
                return info.toString();
            });
        }
        @JavascriptInterface public void ytmRefreshStream(String ticket, String videoId) {
            runYtmTask(ticket, () -> {
                PlaybackService.invalidateYtmStream(videoId);
                JSONObject info = PlaybackService.resolveYtmStream(MainActivity.this, videoId, true);
                return info.toString();
            });
        }
        @JavascriptInterface public void ytmAlbum(String ticket, String browseId) {
            runYtmTask(ticket, () -> MainActivity.ytmAlbum(browseId));
        }
        @JavascriptInterface public void ytmArtist(String ticket, String browseId) {
            runYtmTask(ticket, () -> MainActivity.ytmArtist(browseId));
        }
        @JavascriptInterface public void ytmHome(String ticket, String params, String continuation) {
            runYtmTask(ticket, () -> MainActivity.ytmHome(params == null ? "" : params, continuation == null ? "" : continuation));
        }
        @JavascriptInterface public void ytmLyrics(String ticket, String videoId, String title, String artist, long durationSec) {
            runYtmTask(ticket, () -> MainActivity.ytmLyrics(videoId, title, artist, durationSec));
        }
        @JavascriptInterface public void offlineList(String ticket) {
            network.execute(() -> {
                JSONArray items = OfflineStore.list(MainActivity.this);
                runOnUiThread(() -> call("onVelunaTransferReply", ticket, items, ""));
            });
        }
        @JavascriptInterface public void offlineDownload(String ticket, String metaJson) {
            network.execute(() -> {
                try {
                    JSONObject entry = OfflineStore.download(MainActivity.this, new JSONObject(metaJson));
                    runOnUiThread(() -> call("onVelunaTransferReply", ticket, entry, ""));
                } catch (Exception e) {
                    String msgText = e.getMessage() == null ? "Không tải được bài hát ngoại tuyến." : e.getMessage();
                    runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", msgText));
                }
            });
        }
        @JavascriptInterface public void offlineDelete(String ticket, String videoId) {
            network.execute(() -> {
                boolean removed = OfflineStore.delete(MainActivity.this, videoId);
                runOnUiThread(() -> call("onVelunaTransferReply", ticket, removed, ""));
            });
        }
        @JavascriptInterface public void ytmAddOrPlay(String tracksJson, int startIndex, boolean playNow) {
            runOnUiThread(() -> {
                try {
                    JSONArray list = new JSONArray(tracksJson);
                    upsertYtmTracks(list, startIndex, playNow);
                } catch (JSONException e) {
                    message("Danh sách YouTube Music không hợp lệ.");
                }
            });
        }
        @JavascriptInterface public String nearbyDestination(){return nearby.destination();}
        @JavascriptInterface public void nearbyDiscover(boolean on){runOnUiThread(()->{if(on)nearby.discover();else nearby.stopDiscovery();});}
        @JavascriptInterface public void nearbyScan(){runOnUiThread(()->new com.google.zxing.integration.android.IntentIntegrator(MainActivity.this)
            .setDesiredBarcodeFormats(com.google.zxing.integration.android.IntentIntegrator.QR_CODE).setPrompt("Quét mã trên PC chạy VelunaMusic").setBeepEnabled(false).initiateScan());}
        @JavascriptInterface public void nearbyPair(String text){nearby.pair(text);}
        @JavascriptInterface public void nearbySend(String id,String action){runOnUiThread(()->{
            int i=index(id);if(i<0){call("onVelunaNearby","error","Bài đã rời khỏi thư viện.");return;}
            nearby.send(id,String.valueOf(library.get(i).mediaMetadata.title),action);
        });}
        @JavascriptInterface public void nearbyForget(){runOnUiThread(nearby::forget);}
        @JavascriptInterface public void nearbyCancel(){nearby.cancel();}
        @JavascriptInterface public String spotifyCallback() {return spotifyReturn;}
        @JavascriptInterface public void openSpotify(String address) {
            Uri uri=Uri.parse(address);
            if(!"https".equals(uri.getScheme()) || uri.getUserInfo()!=null || uri.getPort()!=-1) return;
            boolean allowed=("accounts.spotify.com".equals(uri.getHost()) && "/authorize".equals(uri.getPath())) ||
                "open.spotify.com".equals(uri.getHost()) || ("www.spotify.com".equals(uri.getHost()) && "/account/apps/".equals(uri.getPath()));
            if(allowed)runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException e){message("Thiết bị thiếu trình duyệt để mở Spotify.");}});
        }
        @JavascriptInterface public void pickAlbum() { runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE),13)); }
        @JavascriptInterface public void setMix(boolean enabled, String from, String to, int ms, int fixedSeconds) {
            setMixPlan(enabled, from, to, ms, fixedSeconds, 0L);
        }
        @JavascriptInterface public void setMixPlan(boolean enabled, String from, String to, int ms, int fixedSeconds, long cueInMs) {
            getSharedPreferences("dj", 0).edit().putBoolean("enabled",enabled)
                .putString("from",from).putString("to",to).putInt("fixed", Math.max(0,Math.min(30,fixedSeconds)))
                .putLong("width",Math.max(0,Math.min(30000,ms)))
                .putLong("cueInMs",Math.max(0L,Math.min(4000L,cueInMs))).apply();
        }
        @JavascriptInterface public String playHistory() {
            return getSharedPreferences("player",0).getString("play-history","{}");
        }
        @JavascriptInterface public void readTags(String ticket, String id) { readAudio(ticket,id,false,false); }
        @JavascriptInterface public void readCover(String ticket, String id) { readAudio(ticket,id,false,true); }
        @JavascriptInterface public void analyzeTrack(String ticket, String id) { readAudio(ticket,id,true,false); }
        private void readAudio(String ticket, String id, boolean analyze, boolean artwork) { runOnUiThread(() -> {
            if (id != null && id.startsWith("ytmusic://")) {
                final String videoId = id.substring("ytmusic://".length());
                final JSONObject meta = ytmMeta.get(id);
                network.execute(() -> {
                    try {
                        if (analyze) {
                            JSONObject stream = PlaybackService.getCachedStreamMeta(MainActivity.this, videoId);
                            if (stream == null) stream = PlaybackService.resolveYtmStream(MainActivity.this, videoId, false);
                            JSONObject analysis = new JSONObject()
                                .put("source", "ytmusic")
                                .put("video_id", videoId)
                                .put("codec", stream.optString("codec", "opus"))
                                .put("container", stream.optString("container", "webm"))
                                .put("sample_rate", stream.optInt("sample_rate", 48000))
                                .put("channels", stream.optInt("channels", 2))
                                .put("bitrate", stream.optLong("bitrate", 128000L))
                                .put("average_file_kbps", stream.optInt("bitrate_kbps", 128))
                                .put("expires_at", stream.optLong("expires_at", 0L))
                                .put("duration", stream.optLong("duration_ms", 0L) / 1000.0)
                                .put("intro", new JSONObject().put("bpm", 120))
                                .put("outro", new JSONObject().put("bpm", 120));
                            runOnUiThread(() -> call("onVelunaTransferReply", ticket, analysis, ""));
                        } else {
                            JSONObject tagsObj = new JSONObject()
                                .put("source", "ytmusic")
                                .put("title", meta != null ? meta.optString("title", videoId) : videoId)
                                .put("artist", meta != null ? meta.optString("artist", "") : "")
                                .put("album", meta != null ? meta.optString("album", "YouTube Music") : "YouTube Music")
                                .put("recording_kind", meta != null ? meta.optString("recording_kind", "original") : "original")
                                .put("recording_label", meta != null ? meta.optString("recording_label", "Bản gốc") : "Bản gốc");
                            if (artwork && meta != null && !meta.optString("thumbnail", "").isEmpty()) {
                                tagsObj.put("cover", meta.optString("thumbnail"));
                            }
                            runOnUiThread(() -> call("onVelunaTransferReply", ticket, tagsObj, ""));
                        }
                    } catch (Exception e) {
                        runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", "Không đọc được thông tin YouTube Music."));
                    }
                });
                return;
            }
            if (index(id) < 0) { call("onVelunaTransferReply", ticket, "", "Thiếu file nhạc."); return; }
            network.execute(() -> {
                try (ParcelFileDescriptor descriptor = getContentResolver().openFileDescriptor(Uri.parse(id), "r")) {
                    if (descriptor == null) throw new IOException();
                    String result = analyze ? analyzeAudio(descriptor.detachFd()) : readMediaTags(descriptor.detachFd(), artwork);
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
                    String digest=TrackReadiness.identify(MainActivity.this,id);
                    if(digest.startsWith("ytmusic://"))PlaybackService.resolveYtmStream(MainActivity.this,digest.substring(10),false);
                    runOnUiThread(() -> call("onVelunaTransferReply",ticket,digest,""));
                } catch (Exception e) { runOnUiThread(() -> call("onVelunaTransferReply", ticket, "", "Không đọc được file nhạc.")); }
            });
        }); }
        @JavascriptInterface public void pauseForTransfer(String ticket, String id) { runOnUiThread(() -> {
            MediaItem item = controller == null ? null : controller.getCurrentMediaItem();
            if (item == null || !item.mediaId.equals(id)) { call("onVelunaTransferReply", ticket, "", "Bài đang phát đã đổi."); return; }
            JSONObject playback = progress();
            controller.pause(); call("onVelunaTransferReply", ticket, playback, "");
        }); }
        @JavascriptInterface public void accountSession(String ticket) {
            network.execute(()->{
                try {
                    JSONObject session=CloudSession.session(MainActivity.this);
                    runOnUiThread(()->call("onVelunaTransferReply",ticket,session,""));
                } catch(Exception e){runOnUiThread(()->call("onVelunaTransferReply",ticket,null,"Không thể kết nối tài khoản."));}
            });
        }
        @JavascriptInterface public void handoffOrigin(String owner,String transfer,String media) {
            getSharedPreferences("handoff-journal",0).edit().putString("origin/"+owner,
                RemotePlayback.obj("transfer",transfer,"media",media).toString()).apply();
        }
        @JavascriptInterface public void remoteSettings(String user,String device,String label,boolean enabled) {
            android.content.SharedPreferences prefs=getSharedPreferences("player",0);
            String identity="";
            if(enabled)try{
                identity=new JSONObject().put("user",java.util.UUID.fromString(user)).put("device",java.util.UUID.fromString(device))
                    .put("label",label.substring(0,Math.min(80,label.length()))).toString();
            }catch(Exception ignored){}
            prefs.edit().putString("remoteIdentity",identity).apply();
        }
        @JavascriptInterface public String readSecret(String slot) {
            if ("lan-peer".equals(slot)) return "";
            try { return secrets.read(slot); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public boolean writeSecret(String slot, String value) {
            if ("lan-peer".equals(slot)) return false;
            try { return "account".equals(slot) ? CloudSession.replace(secrets,value) : secrets.write(slot, value); } catch (Exception e) { return false; }
        }
        @JavascriptInterface public void pick() { runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), 11)); }
        @JavascriptInterface public void refresh() { runOnUiThread(MainActivity.this::publish); }
        @JavascriptInterface public void select(String id, boolean play, long ms) {
            runOnUiThread(()->{
                if(index(id)<0)return;
                Runnable selection=()->selectTrack(id,play,ms);
                if(controller==null)pendingSelection=selection;
                else selection.run();
            });
        }
        private void selectTrack(String id, boolean play, long ms) {
            int i=index(id);
            if(i<0)return;
            int queued=-1;
            for(int n=0;n<controller.getMediaItemCount();n++) {
                if(id.equals(controller.getMediaItemAt(n).mediaId)){queued=n;break;}
            }
            if(queued>=0)controller.seekTo(queued,Math.max(ms,0));
            else controller.setMediaItems(library,i,Math.max(ms,0));
            controller.prepare();controller.setPlayWhenReady(play);
        }
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
