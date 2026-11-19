package xyz.siloneedsleep.veluna;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class YouTubeActivity extends Activity {
    private WebView player;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        String id=getIntent().getStringExtra("video");
        if(id==null || !id.matches("[A-Za-z0-9_-]{11}")){finish();return;}
        player=new WebView(this);player.getSettings().setJavaScriptEnabled(true);
        player.getSettings().setDomStorageEnabled(true);
        player.getSettings().setAllowFileAccess(false);player.getSettings().setAllowContentAccess(false);
        player.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request) {
                if(!request.isForMainFrame())return false;
                Uri target=request.getUrl();
                if("https".equals(target.getScheme()) && ("www.youtube.com".equals(target.getHost()) || "m.youtube.com".equals(target.getHost()))) {
                    try{startActivity(new Intent(Intent.ACTION_VIEW,target));}catch(android.content.ActivityNotFoundException ignored){}
                }
                return true;
            }
        });
        setContentView(player);player.loadUrl("https://veluna.siloneedsleep.xyz/watch?v="+id);
    }
    @Override protected void onPause(){if(player!=null){player.evaluateJavascript("document.querySelector('iframe')?.remove()",null);player.onPause();}super.onPause();}
    @Override protected void onResume(){super.onResume();if(player!=null){player.onResume();player.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))",null);}}
    @Override protected void onDestroy(){if(player!=null)player.destroy();super.onDestroy();}
}
