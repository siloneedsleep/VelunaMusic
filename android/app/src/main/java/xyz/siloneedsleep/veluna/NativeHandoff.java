package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import java.io.IOException;
import java.time.Instant;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

@OptIn(markerClass = UnstableApi.class)
final class NativeHandoff implements AutoCloseable {
  private final Context app;
  private final MediaSession session;
  private final SharedPreferences journal;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private volatile int generation;
  private boolean busy, again;
  private String owner = "", device = "";
  private final Runnable retry = () -> update(owner, device);
  NativeHandoff(Context app, MediaSession session) {
    this.app = app;
    this.session = session;
    journal = app.getSharedPreferences("handoff-journal", 0);
  }
  void disconnect() {
    generation++;
    owner = device = "";
    busy = again = false;
    main.removeCallbacks(retry);
  }
  void update(String user, String target) {
    if (user.isEmpty())
      return;
    owner = user;
    device = target;
    main.removeCallbacks(retry);
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    int turn = generation;
    worker.execute(() -> {
      long delay = 0;
      try {
        delay = step(user, target, turn);
      } catch (Exception e) {
        delay = 10000;
      }
      long next = delay;
      main.post(() -> {
        if (turn != generation)
          return;
        busy = false;
        if (again) {
          again = false;
          update(user, target);
        } else if (next > 0)
          main.postDelayed(retry, next);
      });
    });
  }
  private <T> T onPlayer(int turn, Callable<T> operation) throws Exception {
    CompletableFuture<T> result = new CompletableFuture<>();
    main.post(() -> {
      try {
        check(turn);
        result.complete(operation.call());
      } catch (Exception e) {
        result.completeExceptionally(e);
      }
    });
    return result.get(10, TimeUnit.SECONDS);
  }
  private void check(int turn) throws IOException {
    if (turn != generation)
      throw new IOException("Session changed");
  }
  private JSONObject saved(String key) throws Exception {
    return new JSONObject(journal.getString(key, "{}"));
  }
  private void save(String key, JSONObject value) throws IOException {
    if (!journal.edit().putString(key, value.toString()).commit())
      throw new IOException("Storage unavailable");
  }
  private void advance(String token, String transfer, String me, String phase, JSONObject playback,
      int turn) throws Exception {
    check(turn);
    CloudSession.request("/rest/v1/rpc/veluna_advance", token,
        RemotePlayback.obj("p_id", transfer, "p_device", me, "p_phase", phase, "p_position",
            playback.optLong("position"), "p_playing", playback.optBoolean("playing")));
  }
  private long step(String user, String me, int turn) throws Exception {
    JSONObject auth = CloudSession.session(app);
    check(turn);
    if (!user.equals(auth.getJSONObject("user").getString("id")))
      return 0;
    String token = auth.getString("access_token");
    JSONArray rows =
        new JSONArray(CloudSession.request("/rest/v1/veluna_handoff?select=*", token, null));
    check(turn);
    String originKey = "origin/" + user, targetKey = "target/" + user;
    JSONObject origin = saved(originKey), target = saved(targetKey);
    JSONObject row = rows.optJSONObject(0);
    String transfer = row == null ? "" : row.getString("transfer_id"),
           phase = row == null ? "" : row.getString("phase");
    boolean expired =
        row == null || !Instant.parse(row.getString("expires_at")).isAfter(Instant.now());
    if (origin.has("position") && transfer.equals(origin.optString("transfer"))
        && ("cancelled".equals(phase) || (expired && "ready".equals(phase)))) {
      onPlayer(turn, () -> {
        Player p = session.getPlayer();
        MediaItem item = p.getCurrentMediaItem();
        if (origin.optBoolean("playing") && item != null
            && item.mediaId.equals(origin.optString("media"))
            && Math.abs(p.getCurrentPosition() - origin.optLong("position")) < 1500)
          p.play();
        return null;
      });
    }
    if (expired || "received".equals(phase) || "cancelled".equals(phase)) {
      if (transfer.equals(origin.optString("transfer")))
        journal.edit().remove(originKey).apply();
      if (transfer.equals(target.optString("transfer")))
        journal.edit().remove(targetKey).apply();
      return 0;
    }
    long untilExpiry = Math.max(500,
        Instant.parse(row.getString("expires_at")).toEpochMilli() - System.currentTimeMillis()
            + 300);
    if (me.equals(row.getString("source_device")) && transfer.equals(origin.optString("transfer"))
        && "ready".equals(phase)) {
      JSONObject snapshot = onPlayer(turn, () -> {
        Player p = session.getPlayer();
        MediaItem active = p.getCurrentMediaItem();
        if (active == null || !active.mediaId.equals(origin.getString("media")))
          return null;
        if (!origin.has("position")) {
          origin.put("position", p.getCurrentPosition()).put("playing", p.getPlayWhenReady());
          save(originKey, origin);
        }
        p.pause();
        return origin;
      });
      advance(token, transfer, me, snapshot == null ? "cancelled" : "released", origin, turn);
      return untilExpiry;
    }
    if (!me.equals(row.getString("target_device")))
      return untilExpiry;
    if ("offered".equals(phase)) {
      MediaItem item = find(row, turn);
      if (item == null || !ready(item, turn)) {
        advance(token, transfer, me, "cancelled", target, turn);
        return 0;
      }
      check(turn);
      save(targetKey, RemotePlayback.obj("transfer", transfer, "media", item.mediaId));
      advance(token, transfer, me, "ready", target, turn);
    } else if ("released".equals(phase) && transfer.equals(target.optString("transfer"))) {
      if (!target.optBoolean("started")) {
        String id = target.getString("media");
        boolean started = start(item(id, row.getString("title")), row, turn);
        if (!started) {
          advance(token, transfer, me, "cancelled", target, turn);
          return 0;
        }
        check(turn);
        target.put("started", true);
        save(targetKey, target);
      }
      advance(token, transfer, me, "received", target, turn);
    }
    return untilExpiry;
  }
  private static MediaItem item(String id, String title) {
    return new MediaItem.Builder()
        .setUri(id)
        .setMediaId(id)
        .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
        .build();
  }
  private MediaItem find(JSONObject row, int turn) throws Exception {
    String digest = row.getString("digest"), title = row.getString("title");
    if (PlaybackService.extractYtmVideoId(Uri.parse(digest), digest) != null)
      return item(digest, title);
    JSONArray local =
        new JSONArray(app.getSharedPreferences("MainActivity", 0).getString("tracks", "[]"));
    for (int pass = 0; pass < 2; pass++)
      for (int i = 0; i < local.length(); i++) {
        check(turn);
        JSONObject t = local.getJSONObject(i);
        String id = t.getString("id");
        if (!id.startsWith("content:")
            || t.optString("title").equalsIgnoreCase(title) != (pass == 0))
          continue;
        try {
          if (TrackReadiness.identify(app, id).equals(digest))
            return item(id, t.optString("title", title));
        } catch (IOException ignored) {
        }
      }
    return null;
  }
  private boolean ready(MediaItem item, int turn) throws Exception {
    ExoPlayer probe = onPlayer(turn,
        ()
            -> new ExoPlayer.Builder(app)
                   .setMediaSourceFactory(PlaybackService.buildMediaSourceFactory(app))
                   .build());
    try {
      return awaitReady(probe, item, 0, false, turn);
    } finally {
      main.post(probe::release);
    }
  }
  private boolean start(MediaItem item, JSONObject row, int turn) throws Exception {
    Player player = onPlayer(turn, session::getPlayer);
    long basePos = Math.max(0L, row.getLong("position_ms"));
    boolean play = row.getBoolean("playing");
    long compensated = basePos;
    if (play && row.has("updated_at") && !row.isNull("updated_at")) {
      try {
        long delta = System.currentTimeMillis() - Instant.parse(row.getString("updated_at")).toEpochMilli();
        if (delta > 0 && delta <= 15_000L) compensated += delta;
      } catch (Exception ignored) { }
    }
    return awaitReady(player, item, compensated, play, turn);
  }
  private boolean awaitReady(Player player, MediaItem item, long position, boolean play, int turn)
      throws Exception {
    CompletableFuture<Boolean> result = new CompletableFuture<>();
    Player.Listener listener = new Player.Listener() {
      @Override
      public void onEvents(Player p, Player.Events events) {
        if (turn != generation || p.getPlayerError() != null) {
          result.complete(false);
          return;
        }
        if (p.getPlaybackState() == Player.STATE_READY && p.isCurrentMediaItemSeekable()
            && p.getCurrentMediaItem() != null
            && item.mediaId.equals(p.getCurrentMediaItem().mediaId) && (!play || p.isPlaying()))
          result.complete(true);
      }
      @Override
      public void onPlayerError(PlaybackException error) {
        result.complete(false);
      }
    };
    try {
      onPlayer(turn, () -> {
        player.addListener(listener);
        int index = -1;
        for (int i = 0; i < player.getMediaItemCount(); i++)
          if (item.mediaId.equals(player.getMediaItemAt(i).mediaId)) {
            index = i;
            break;
          }
        if (index < 0) {
          index = player.getMediaItemCount();
          player.addMediaItem(item);
        }
        player.seekTo(index, position);
        player.setPlayWhenReady(play);
        player.prepare();
        return null;
      });
      return result.get(25, TimeUnit.SECONDS);
    } catch (java.util.concurrent.TimeoutException e) {
      result.complete(false);
      return false;
    } finally {
      main.post(() -> {
        player.removeListener(listener);
        if (play && !result.getNow(false) && player.getCurrentMediaItem() != null
            && item.mediaId.equals(player.getCurrentMediaItem().mediaId))
          player.pause();
      });
    }
  }
  @Override
  public void close() {
    disconnect();
    worker.shutdownNow();
  }
}
