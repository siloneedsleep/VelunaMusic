package xyz.siloneedsleep.veluna;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LibraryPlaybackTest {
    private final Instrumentation device = InstrumentationRegistry.getInstrumentation();

    private static File wave(Context context) throws Exception {
        File file = File.createTempFile("veluna-playback-", ".wav", context.getCacheDir());
        byte[] samples = new byte[8000 * 2 * 20];
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(samples.length+36);
        header.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16);
        header.putShort((short)1).putShort((short)1).putInt(8000).putInt(16000);
        header.putShort((short)2).putShort((short)16);
        header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples.length);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(header.array());out.write(samples);
        }
        return file;
    }
    private String js(Activity activity, String script) throws Exception {
        ArrayBlockingQueue<String> reply = new ArrayBlockingQueue<>(1);
        device.runOnMainSync(()->{
            ViewGroup content=activity.findViewById(android.R.id.content);
            ((WebView)content.getChildAt(0)).evaluateJavascript(script, reply::offer);
        });
        return reply.poll(5, TimeUnit.SECONDS);
    }
    private void until(Activity activity, String script) throws Exception {
        long deadline=SystemClock.elapsedRealtime()+25000;
        while(SystemClock.elapsedRealtime()<deadline) {
            if("true".equals(js(activity,script)))return;
            SystemClock.sleep(200);
        }
        fail("Timed out waiting for "+script+"; app status: "+js(activity,"document.querySelector('#message')?.textContent"));
    }
    @Test public void playsFromTheWebViewThroughMedia3AndReadsTagsThroughRust() throws Exception {
        Context ctx=device.getTargetContext();
        File media=wave(ctx);
        String id=Uri.fromFile(media).toString();
        SharedPreferences prefs=ctx.getSharedPreferences("MainActivity",Context.MODE_PRIVATE);
        String oldTracks=prefs.getString("tracks","[]");
        JSONArray library=new JSONArray(oldTracks).put(new JSONObject().put("id",id).put("title","Veluna QA track"));
        prefs.edit().putString("tracks",library.toString()).commit();
        Activity activity=null;
        try {
            Intent launch=new Intent(ctx,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=device.startActivitySync(launch);
            until(activity,"typeof window.velunaLibrary==='object' && Boolean(document.querySelector('#list .row'))");
            js(activity,"document.querySelector('#list .row').click()");
            until(activity,"document.body.dataset.playing==='true' && Number(document.querySelector('#seek').max)>=19");
            js(activity,"nativeTransfer('readTags',selected).then(v=>window.qaTags=v).catch(()=>{})");
            until(activity,"Boolean(window.qaTags && Object.hasOwn(window.qaTags,'artist'))");
            js(activity,"document.querySelector('[data-view=recent]').click()");
            until(activity,"document.querySelector('#list .row')?.textContent.includes('Veluna QA track')===true");
            assertEquals("true",js(activity,"parseLyrics('[00:00]<00:00>Veluna <00:01>Music',true)[0].parts.length===2"));
            js(activity,"document.querySelector('#play').click()");
            until(activity,"document.body.dataset.playing==='false'");
        } finally {
            if(activity!=null){Activity opened=activity;device.runOnMainSync(opened::finish);}
            prefs.edit().putString("tracks",oldTracks).commit();
            media.delete();
        }
    }
}
