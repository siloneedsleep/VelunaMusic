package xyz.siloneedsleep.veluna;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.audiofx.Equalizer;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

final class TrackEqualizer implements Player.Listener, SharedPreferences.OnSharedPreferenceChangeListener {
    private final SharedPreferences prefs;
    private final ExoPlayer player;
    private Equalizer effect;
    private int session;
    TrackEqualizer(Context context,ExoPlayer audio){
        prefs=context.getSharedPreferences("sound",0);player=audio;
        prefs.registerOnSharedPreferenceChangeListener(this);player.addListener(this);apply();
    }
    private void release(){if(effect!=null){effect.release();effect=null;}}
    private void apply(){
        int next=player.getAudioSessionId();
        if(session!=next){release();session=next;}
        if(!prefs.getBoolean("enabled",false) || next<=0){release();return;}
        try{
            if(effect==null)effect=new Equalizer(0,next);
            int bass=prefs.getInt("bass",0),mid=prefs.getInt("mid",0),high=prefs.getInt("high",0);
            int headroom=Math.max(0,Math.max(bass,Math.max(mid,high)));
            short[] range=effect.getBandLevelRange();
            for(short band=0;band<effect.getNumberOfBands();band++){
                int hz=effect.getCenterFreq(band)/1000;
                int db=hz<=350?bass:hz>=3000?high:mid;
                effect.setBandLevel(band,(short)Math.max(range[0],Math.min(range[1],100*(db-headroom))));
            }
            effect.setEnabled(true);prefs.edit().putString("result","EQ đang áp dụng cho nhạc trên máy.").apply();
        }catch(RuntimeException unavailable){
            release();prefs.edit().putString("result","Đường âm thanh này chưa hỗ trợ EQ.").apply();
        }
    }
    @Override public void onAudioSessionIdChanged(int id){apply();}
    @Override public void onSharedPreferenceChanged(SharedPreferences p,String key){if(!"result".equals(key))apply();}
    void close(){prefs.unregisterOnSharedPreferenceChangeListener(this);player.removeListener(this);release();}
}
