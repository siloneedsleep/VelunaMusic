package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.system.Os;
import android.system.OsConstants;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;

final class TrackReadiness {
  static String identify(Context app, String id) throws Exception {
    Uri uri = Uri.parse(id);
    if (PlaybackService.extractYtmVideoId(uri, id) != null)
      return id;
    if (!"content".equals(uri.getScheme()))
      throw new IOException("Unknown media source");
    try (ParcelFileDescriptor fd = app.getContentResolver().openFileDescriptor(uri, "r")) {
      if (fd == null)
        throw new IOException("Media unavailable");
      Os.lseek(fd.getFileDescriptor(), 0, OsConstants.SEEK_SET);
      MediaMetadataRetriever probe = new MediaMetadataRetriever();
      try {
        probe.setDataSource(fd.getFileDescriptor());
        if (Long.parseLong(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))
            <= 0)
          throw new IOException("Invalid duration");
      } finally {
        probe.release();
      }
    }
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    try (InputStream in = app.getContentResolver().openInputStream(uri)) {
      if (in == null)
        throw new IOException("Media unavailable");
      byte[] block = new byte[65536];
      int n;
      while ((n = in.read(block)) != -1) {
        if (Thread.currentThread().isInterrupted())
          throw new IOException("Cancelled");
        hash.update(block, 0, n);
      }
    }
    char[] digits = "0123456789abcdef".toCharArray(), out = new char[64];
    int i = 0;
    for (byte b : hash.digest()) {
      out[i++] = digits[(b & 255) >>> 4];
      out[i++] = digits[b & 15];
    }
    return new String(out);
  }
  private TrackReadiness() {}
}
