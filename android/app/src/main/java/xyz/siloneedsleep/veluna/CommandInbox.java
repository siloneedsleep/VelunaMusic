package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.json.JSONArray;
import org.json.JSONObject;

final class CommandInbox implements AutoCloseable {
  private final Context app;
  private final Function<JSONObject, String> execute;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile int generation;
  private boolean busy, again;
  CommandInbox(Context app, Function<JSONObject, String> execute) {
    this.app = app;
    this.execute = execute;
  }
  void disconnect() {
    generation++;
    busy = again = false;
    main.removeCallbacksAndMessages(null);
  }
  void update(String user, String device) {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    int turn = generation;
    worker.execute(() -> {
      int delay = 0;
      try {
        JSONObject session = CloudSession.session(app);
        if (turn != generation || !user.equals(session.getJSONObject("user").getString("id")))
          return;
        String token = session.getString("access_token");
        JSONArray rows =
            new JSONArray(CloudSession.request("/rest/v1/veluna_commands?select=*&recipient=eq."
                    + device + "&result=is.null&expires_at=gt.now&order=created_at,id&limit=32",
                token, null));
        for (int i = 0; i < rows.length() && turn == generation; i++) {
          JSONObject row = rows.getJSONObject(i);
          CompletableFuture<String> result = new CompletableFuture<>();
          main.post(() -> {
            try {
              if (turn != generation
                  || java.time.Instant.parse(row.getString("expires_at")).toEpochMilli()
                      <= System.currentTimeMillis())
                result.complete("Lệnh đã hết hạn.");
              else
                result.complete(execute.apply(row.put("from", row.getString("sender"))));
            } catch (Exception e) {
              result.completeExceptionally(e);
            }
          });
          String error = result.get(8, TimeUnit.SECONDS);
          if (turn != generation)
            return;
          CloudSession.request("/rest/v1/rpc/veluna_command_ack", token,
              MediaHelpers.jsonObj(
                  "p_id", row.getString("id"), "p_recipient", device, "p_result", error));
        }
        if (rows.length() == 32)
          delay = 1;
      } catch (Exception e) {
        delay = 10000;
      } finally {
        int next = delay;
        main.post(() -> {
          if (turn != generation)
            return;
          busy = false;
          if (again) {
            again = false;
            update(user, device);
          } else if (next > 0)
            main.postDelayed(() -> {
              if (turn == generation)
                update(user, device);
            }, next);
        });
      }
    });
  }
  @Override
  public void close() {
    disconnect();
    worker.shutdownNow();
  }
}
