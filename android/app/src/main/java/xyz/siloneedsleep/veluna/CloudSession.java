package xyz.siloneedsleep.veluna;

import android.content.Context;
import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

final class CloudSession {
  static final OkHttpClient HTTP =
      new OkHttpClient.Builder().callTimeout(18, java.util.concurrent.TimeUnit.SECONDS).build();
  private static final MediaType JSON = MediaType.get("application/json");
  private static JSONObject cached;
  private static long expires;

  static synchronized boolean replace(SecretStore vault, String token) throws Exception {
    cached = null;
    return vault.write("account", token);
  }

  static synchronized JSONObject session(Context context) throws Exception {
    if (cached != null && System.currentTimeMillis() + 90000 < expires)
      return cached;
    SecretStore vault = new SecretStore(context);
    String refresh = vault.read("account");
    if (refresh.isEmpty())
      throw new IOException("Signed out");
    JSONObject next = new JSONObject(request("/auth/v1/token?grant_type=refresh_token", null,
        new JSONObject().put("refresh_token", refresh)));
    if (!vault.write("account", next.getString("refresh_token")))
      throw new IOException("Account storage unavailable");
    expires = System.currentTimeMillis() + next.getLong("expires_in") * 1000;
    cached = next;
    return next;
  }

  static String request(String path, String access, JSONObject body) throws IOException {
    Request.Builder builder = new Request.Builder()
                                  .url(BuildConfig.CLOUD_URL + path)
                                  .header("apikey", BuildConfig.CLOUD_KEY);
    if (access != null)
      builder.header("Authorization", "Bearer " + access);
    if (body != null)
      builder.post(RequestBody.create(body.toString(), JSON));
    try (Response response = HTTP.newCall(builder.build()).execute()) {
      if (!response.isSuccessful() || response.body() == null)
        throw new IOException("Cloud request failed (" + response.code() + ")");
      return response.body().string();
    }
  }

  private CloudSession() {}
}
