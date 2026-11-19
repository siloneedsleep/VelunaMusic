package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;
import java.util.LinkedHashMap;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONArray;
import org.json.JSONObject;

final class RemotePlayback implements Player.Listener, AutoCloseable {
  private final Context app;
  private final MediaSession session;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final SharedPreferences prefs;
  private final ConnectivityManager network;
  private final NativeHandoff handoff;
  private final CommandInbox inbox;
  private final java.util.ArrayList<String> queueIds = new java.util.ArrayList<>();
  private final LinkedHashMap<String, String> replies = new LinkedHashMap<>();
  private final ConnectivityManager.NetworkCallback connectivity =
      new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(Network n) {
          main.post(() -> {
            if (enabled())
              restart();
          });
        }
      };
  private final String instance = UUID.randomUUID().toString();
  private final Runnable retry = this::connect;
  private final Runnable announce = () -> announce("");
  private Player observed;
  private String user = "", device = "", label = "", topic = "", version = "";
  private int generation, backoff = 1000, ref;
  private long heartbeatSent;
  private boolean joined, closed;
  private WebSocket socket;
  private final Runnable heartbeat = new Runnable() {
    @Override
    public void run() {
      if (!joined)
        return;
      if (heartbeatSent != 0) {
        restart();
        return;
      }
      heartbeatSent = System.currentTimeMillis();
      frame("phoenix", "heartbeat", new JSONObject());
      main.postDelayed(this, 25000);
    }
  };

  RemotePlayback(Context context, MediaSession session) {
    this.app = context.getApplicationContext();
    this.session = session;
    prefs = app.getSharedPreferences("player", 0);
    network = app.getSystemService(ConnectivityManager.class);
    handoff = new NativeHandoff(app, session);
    inbox = new CommandInbox(app, this::execute);
    network.registerDefaultNetworkCallback(connectivity);
    attach();
    configure();
  }

  void attach() {
    if (observed != null)
      observed.removeListener(this);
    observed = session.getPlayer();
    observed.addListener(this);
    version = "";
  }

  void configure() {
    try {
      JSONObject id = new JSONObject(prefs.getString("remoteIdentity", ""));
      user = id.getString("user");
      device = id.getString("device");
      label = id.getString("label");
    } catch (Exception e) {
      user = device = label = "";
    }
    topic = "realtime:veluna-remote-" + user;
    replies.clear();
    restart();
  }
  private boolean enabled() {
    return !closed && !user.isEmpty();
  }
  private void restart() {
    generation++;
    joined = false;
    heartbeatSent = 0;
    handoff.disconnect();
    inbox.disconnect();
    main.removeCallbacks(heartbeat);
    main.removeCallbacks(retry);
    main.removeCallbacks(announce);
    if (socket != null) {
      socket.cancel();
      socket = null;
    }
    if (enabled())
      main.post(retry);
  }
  private void lost(WebSocket ws) {
    if (ws != socket)
      return;
    socket = null;
    joined = false;
    heartbeatSent = 0;
    main.removeCallbacks(heartbeat);
    if (enabled()) {
      main.removeCallbacks(retry);
      main.postDelayed(retry, backoff);
      backoff = Math.min(60000, backoff * 2);
    }
  }
  private void connect() {
    if (!enabled() || socket != null)
      return;
    final int turn = ++generation;
    final String owner = user;
    worker.execute(() -> {
      try {
        JSONObject credentials = CloudSession.session(app);
        if (!owner.equals(credentials.getJSONObject("user").getString("id")))
          throw new IllegalStateException();
        String access = credentials.getString("access_token");
        long refreshAt = credentials.getLong("expires_at") * 1000L - 60000;
        main.post(() -> {
          if (turn == generation && enabled())
            open(access, refreshAt, turn);
        });
      } catch (Exception e) {
        main.post(() -> {
          if (turn == generation && enabled())
            lost(null);
        });
      }
    });
  }
  private void open(String access, long refreshAt, int turn) {
    String url = BuildConfig.CLOUD_URL.replace("https://", "wss://")
        + "/realtime/v1/websocket?vsn=1.0.0&apikey=" + BuildConfig.CLOUD_KEY;
    socket = CloudSession.HTTP.newWebSocket(
        new Request.Builder().url(url).build(), new WebSocketListener() {
          @Override
          public void onOpen(WebSocket ws, Response response) {
            main.post(() -> {
              if (ws != socket)
                return;
              JSONObject changes = obj("event", "*", "schema", "public", "table", "veluna_handoff",
                  "filter", "user_id=eq." + user);
              frame(topic, "phx_join",
                  obj("config",
                      obj("private", true, "broadcast", obj("ack", false, "self", false),
                          "presence", obj("enabled", false), "postgres_changes",
                          new JSONArray().put(changes).put(
                              obj("event", "INSERT", "schema", "public", "table", "veluna_commands",
                                  "filter", "recipient=eq." + device))),
                      "access_token", access));
              main.postDelayed(() -> {
                if (ws == socket && !joined)
                  ws.cancel();
              }, 15000);
              main.postDelayed(() -> {
                if (turn == generation && ws == socket)
                  restart();
              }, Math.max(1000, refreshAt - System.currentTimeMillis()));
            });
          }
          @Override
          public void onMessage(WebSocket ws, String data) {
            if (data.length() < 196608)
              main.post(() -> {
                if (ws == socket)
                  receive(data);
              });
          }
          @Override
          public void onFailure(WebSocket ws, Throwable error, Response response) {
            main.post(() -> lost(ws));
          }
          @Override
          public void onClosed(WebSocket ws, int code, String reason) {
            main.post(() -> lost(ws));
          }
          @Override
          public void onClosing(WebSocket ws, int code, String reason) {
            ws.close(code, null);
          }
        });
  }
  private void receive(String raw) {
    try {
      JSONObject m = new JSONObject(raw), p = m.getJSONObject("payload");
      String event = m.getString("event");
      if ("phoenix".equals(m.optString("topic"))) {
        if ("phx_reply".equals(event))
          heartbeatSent = 0;
        return;
      }
      if (!topic.equals(m.optString("topic")))
        return;
      if ("phx_reply".equals(event) && !joined) {
        if (!"ok".equals(p.optString("status"))) {
          socket.cancel();
          return;
        }
        joined = true;
        backoff = 1000;
        main.postDelayed(heartbeat, 25000);
        announce("");
        handoff.update(user, device);
        inbox.update(user, device);
      } else if ("phx_close".equals(event) || "phx_error".equals(event)) {
        socket.cancel();
      } else if (joined && "postgres_changes".equals(event)) {
        JSONObject data = p.optJSONObject("data");
        if (data != null && "veluna_commands".equals(data.optString("table")))
          inbox.update(user, device);
        else
          handoff.update(user, device);
      } else if (joined && "broadcast".equals(event) && "player".equals(p.optString("event")))
        handle(p.getJSONObject("payload"));
    } catch (org.json.JSONException ignored) {
    }
  }
  static JSONObject obj(Object... pairs) {
    return MediaHelpers.jsonObj(pairs);
  }
  private void frame(String channel, String event, JSONObject payload) {
    if (socket != null)
      socket.send(
          obj("topic", channel, "event", event, "payload", payload, "ref", Integer.toString(++ref))
              .toString());
  }
  private void broadcast(JSONObject payload) {
    if (!joined)
      return;
    try {
      payload.put("from", device).put("sent", System.currentTimeMillis());
    } catch (org.json.JSONException e) {
      return;
    }
    frame(topic, "broadcast", obj("type", "broadcast", "event", "player", "payload", payload));
  }
  private void announce(String to) {
    if (!joined)
      return;
    Player player = session.getPlayer();
    JSONArray names = new JSONArray();
    syncQueue(player);
    for (int i = 0; i < Math.min(300, player.getMediaItemCount()); i++) {
      CharSequence title = player.getMediaItemAt(i).mediaMetadata.title;
      String name = title == null ? "" : title.toString();
      names.put(name.substring(0, Math.min(160, name.length())));
    }
    MediaItem current = player.getCurrentMediaItem();
    long posMs = Math.max(0L, player.getCurrentPosition());
    String repeatStr = player.getRepeatMode() == Player.REPEAT_MODE_ONE ? "one"
        : player.getRepeatMode() == Player.REPEAT_MODE_ALL ? "all" : "off";
    broadcast(obj("type", "state", "to", to, "state",
        obj("durable", true, "instance", instance, "version", version, "label", label,
            "platform", "android",
            "trackId", current == null ? "" : current.mediaId,
            "positionMs", posMs,
            "isPlaying", player.isPlaying(),
            "updatedAt", System.currentTimeMillis(),
            "currentIndex", player.getCurrentMediaItemIndex(),
            "shuffle", player.getShuffleModeEnabled(),
            "repeat", repeatStr,
            "playing", player.isPlaying(),
            "title", current == null ? "" : String.valueOf(current.mediaMetadata.title),
            "seconds", posMs / 1000.0,
            "duration", Math.max(0, player.getDuration()) / 1000.0,
            "volume", Math.round(player.getVolume() * 100),
            "index", player.getCurrentMediaItemIndex(),
            "queue", names)));
  }
  @Override
  public void onEvents(Player p, Player.Events events) {
    if (events.contains(Player.EVENT_TIMELINE_CHANGED))
      syncQueue(p);
    if (joined) {
      main.removeCallbacks(announce);
      main.postDelayed(announce, 150);
    }
  }
  private void syncQueue(Player p) {
    boolean same = !version.isEmpty() && queueIds.size() == p.getMediaItemCount();
    for (int i = 0; same && i < queueIds.size(); i++)
      same = queueIds.get(i).equals(p.getMediaItemAt(i).mediaId);
    if (same)
      return;
    queueIds.clear();
    for (int i = 0; i < p.getMediaItemCount(); i++) queueIds.add(p.getMediaItemAt(i).mediaId);
    version = UUID.randomUUID().toString();
  }
  private void handle(JSONObject m) throws org.json.JSONException {
    String sender = m.optString("from"), to = m.optString("to"), type = m.optString("type");
    if (sender.isEmpty() || sender.equals(device) || (!to.isEmpty() && !to.equals(device))
        || Math.abs(System.currentTimeMillis() - m.optLong("sent")) > 20000)
      return;
    if ("discover".equals(type)) {
      announce(sender);
      return;
    }
    if (!"command".equals(type) || !device.equals(to) || !instance.equals(m.optString("instance")))
      return;
    String id = m.getString("id");
    if (id.length() > 80 || id.isEmpty())
      return;
    String error = execute(m);
    broadcast(obj("type", "ack", "to", sender, "id", id, "ok", error.isEmpty(), "error", error));
    announce(sender);
  }
  private String execute(JSONObject m) {
    String key = m.optString("from") + "/" + m.optString("id"), error = replies.get(key);
    if (error == null) {
      try {
        if (!instance.equals(m.optString("instance")))
          throw new IllegalArgumentException("Phiên phát đã đổi.");
        syncQueue(session.getPlayer());
        if (!version.equals(m.getString("version")))
          throw new IllegalArgumentException("Hàng chờ đã đổi.");
        apply(session.getPlayer(), m);
        error = "";
      } catch (Exception e) {
        error = e.getMessage() == null ? "Lệnh không hợp lệ." : e.getMessage();
      }
      replies.put(key, error);
      if (replies.size() > 256)
        replies.remove(replies.keySet().iterator().next());
    }
    return error;
  }
  static void apply(Player p, JSONObject command) throws Exception {
    double value = command.getDouble("value");
    if (!Double.isFinite(value))
      throw new IllegalArgumentException();
    int i = (int) value;
    switch (command.getString("action")) {
      case "play":
        if (p.getMediaItemCount() == 0)
          throw new IllegalStateException("Hàng chờ trống.");
        p.prepare();
        p.play();
        break;
      case "pause":
        p.pause();
        break;
      case "volume":
        if (value < 0 || value > 100)
          throw new IllegalArgumentException();
        p.setVolume((float) value / 100);
        break;
      case "seek":
        if (!p.isCurrentMediaItemSeekable() || value < 0 || value * 1000 > p.getDuration())
          throw new IllegalArgumentException();
        p.seekTo((long) (value * 1000));
        break;
      case "next":
        if (!p.hasNextMediaItem())
          throw new IllegalStateException("Đã ở cuối hàng chờ.");
        p.seekToNextMediaItem();
        p.play();
        break;
      case "previous":
        if (!p.hasPreviousMediaItem())
          throw new IllegalStateException("Đã ở đầu hàng chờ.");
        p.seekToPreviousMediaItem();
        p.play();
        break;
      case "select":
        checkIndex(p, i, value);
        p.seekToDefaultPosition(i);
        p.prepare();
        p.play();
        break;
      case "move":
        checkIndex(p, i, value);
        int dest = command.getInt("destination");
        checkIndex(p, dest, command.getDouble("destination"));
        p.moveMediaItem(i, dest);
        break;
      case "shuffle":
        p.setShuffleModeEnabled(value != 0);
        break;
      case "repeat":
        if (i != value || i < 0 || i > 2)
          throw new IllegalArgumentException();
        p.setRepeatMode(i);
        break;
      default:
        throw new IllegalArgumentException("Lệnh không hợp lệ.");
    }
  }
  private static void checkIndex(Player p, int i, double value) {
    if (i != value || i < 0 || i >= p.getMediaItemCount())
      throw new IllegalArgumentException("Vị trí hàng chờ không hợp lệ.");
  }
  @Override
  public void close() {
    closed = true;
    restart();
    main.removeCallbacksAndMessages(null);
    network.unregisterNetworkCallback(connectivity);
    observed.removeListener(this);
    handoff.close();
    inbox.close();
    worker.shutdownNow();
  }
}
