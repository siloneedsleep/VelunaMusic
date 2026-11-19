package xyz.siloneedsleep.veluna;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;

public final class PlayerWidget extends AppWidgetProvider {
    private static final String PREFIX="xyz.siloneedsleep.veluna.widget.";
    private static final int FLAGS=PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;

    static void display(Context context, Player player) {
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        int[] ids=manager.getAppWidgetIds(new ComponentName(context,PlayerWidget.class));
        if(ids.length==0)return;
        String title="VelunaMusic";
        if(player!=null && player.getMediaMetadata().title!=null)title=player.getMediaMetadata().title.toString();
        boolean playing=player!=null && player.isPlaying();
        context.getSharedPreferences("widget",0).edit().putString("title",title).putBoolean("playing",playing).apply();
        update(context,manager,ids,title,playing);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids) {
        android.content.SharedPreferences last=context.getSharedPreferences("widget",0);
        update(context,manager,ids,last.getString("title","VelunaMusic"),last.getBoolean("playing",false));
    }
    private static void update(Context c,AppWidgetManager manager,int[] ids,String title,boolean playing) {
        RemoteViews view=new RemoteViews(c.getPackageName(),R.layout.player_widget);
        view.setTextViewText(R.id.widget_title,title);view.setTextViewText(R.id.widget_toggle,playing?"Ⅱ":"▶");
        view.setOnClickPendingIntent(R.id.widget_title,PendingIntent.getActivity(c,40,new Intent(c,MainActivity.class),FLAGS));
        int[] buttons={R.id.widget_previous,R.id.widget_toggle,R.id.widget_next};String[] commands={"previous","toggle","next"};
        for(int i=0;i<commands.length;i++)view.setOnClickPendingIntent(buttons[i],PendingIntent.getBroadcast(c,41+i,
            new Intent(c,PlayerWidget.class).setAction(PREFIX+commands[i]),FLAGS));
        manager.updateAppWidget(ids,view);
    }
    @Override public void onReceive(Context context,Intent intent) {
        super.onReceive(context,intent);String action=intent.getAction();
        if(action==null || !action.startsWith(PREFIX))return;
        PendingResult pending=goAsync();
        Context application=context.getApplicationContext();
        SessionToken token=new SessionToken(application,new ComponentName(application,PlaybackService.class));
        ListenableFuture<MediaController> connection;
        try {
            connection=new MediaController.Builder(application,token).buildAsync();
        } catch (RuntimeException unavailable) {
            pending.finish();
            return;
        }
        connection.addListener(()->{
            try {
                MediaController p=connection.get();
                switch(action.substring(PREFIX.length())){
                    case "previous":if(p.hasPreviousMediaItem())p.seekToPreviousMediaItem();break;
                    case "next":if(p.hasNextMediaItem())p.seekToNextMediaItem();break;
                    case "toggle":
                        if(p.isPlaying())p.pause();
                        else if(p.getMediaItemCount()>0){p.prepare();p.play();}
                        else application.startActivity(new Intent(application,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        break;
                    default:break;
                }
            }catch(Exception ignored){}
            finally{MediaController.releaseFuture(connection);pending.finish();}
        },ContextCompat.getMainExecutor(application));
    }
}
