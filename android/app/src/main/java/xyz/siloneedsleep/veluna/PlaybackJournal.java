package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class PlaybackJournal implements Player.Listener {
  private final SharedPreferences store;
  private Player player;
  PlaybackJournal(Context context, Player player) {
    store = context.getSharedPreferences("MainActivity", 0);
    try {
      LinkedHashMap<String, MediaItem> items = new LinkedHashMap<>();
      JSONArray library = new JSONArray(store.getString("tracks", "[]"));
      for (int i = 0; i < library.length(); i++) {
        JSONObject entry = library.getJSONObject(i);
        String id = entry.getString("id");
        items.put(id, MainActivity.buildMediaItem(Uri.parse(id), entry));
      }
      JSONArray queue = new JSONArray(store.getString("lastQueue", "[]"));
      ArrayList<MediaItem> order = new ArrayList<>();
      for (int i = 0; i < queue.length(); i++) {
        String id = queue.optString(i);
        MediaItem item = items.get(id);
        if (item == null && PlaybackService.extractYtmVideoId(Uri.parse(id), id) != null)
          item = MainActivity.buildMediaItem(Uri.parse(id), new JSONObject().put("title", id));
        if (item != null)
          order.add(item);
      }
      if (order.isEmpty())
        order.addAll(items.values());
      String selected = store.getString("lastId", "");
      int index = 0;
      while (index < order.size() && !order.get(index).mediaId.equals(selected)) index++;
      if (!order.isEmpty())
        player.setMediaItems(order, index < order.size() ? index : 0,
            index < order.size() ? store.getLong("lastMs", 0) : 0);
    } catch (JSONException ignored) {
    }
    attach(player);
  }
  void attach(Player next) {
    if (player != null)
      player.removeListener(this);
    player = next;
    player.addListener(this);
  }
  void save() {
    save(player, store);
  }
  static void save(Player player, SharedPreferences store) {
    MediaItem current = player.getCurrentMediaItem();
    if (current == null)
      return;
    JSONArray queue = new JSONArray();
    for (int i = 0; i < player.getMediaItemCount(); i++)
      queue.put(player.getMediaItemAt(i).mediaId);
    store.edit()
        .putString("lastQueue", queue.toString())
        .putString("lastId", current.mediaId)
        .putLong("lastMs", Math.max(0, player.getCurrentPosition()))
        .apply();
  }
  @Override
  public void onEvents(Player p, Player.Events events) {
    if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION,
            Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_POSITION_DISCONTINUITY))
      save();
  }
  void close() {
    save();
    player.removeListener(this);
  }
}
