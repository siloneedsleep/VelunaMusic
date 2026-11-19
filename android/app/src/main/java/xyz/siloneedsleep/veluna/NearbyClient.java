package xyz.siloneedsleep.veluna;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.*;
import org.json.*;

final class NearbyClient {
    interface Listener { void event(String type, Object value); }
    private static final long LIMIT = 512L*1024*1024;
    private final Activity activity;
    private final Listener listener;
    private final SecretStore secrets;
    private final SharedPreferences prefs;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile Socket active;
    private volatile boolean cancelled;
    private final NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;

    NearbyClient(Activity app,SecretStore secrets,Listener listener) {
        activity=app;this.secrets=secrets;this.listener=listener;
        prefs=app.getSharedPreferences("nearby",Context.MODE_PRIVATE);
        nsd=(NsdManager)app.getSystemService(Context.NSD_SERVICE);
    }
    private void report(String event,Object value){activity.runOnUiThread(()->{if(!activity.isDestroyed())listener.event(event,value);});}
    private static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
    private static InetAddress local(String host) throws IOException {
        if(host==null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}"))throw new IOException("Địa chỉ PC không hợp lệ.");
        InetAddress ip=InetAddress.getByName(host);
        if(!(ip instanceof Inet4Address) || !(ip.isSiteLocalAddress() || ip.isLinkLocalAddress()))throw new IOException("PC phải có địa chỉ LAN.");
        return ip;
    }
    private interface Work {void run() throws Exception;}
    private void submit(Work work){
        if(!busy.compareAndSet(false,true)){report("status","Đang có một lượt truyền.");return;}
        cancelled=false;
        worker.execute(()->{try{work.run();}catch(Exception e){
            String m=e.getMessage();report("error",cancelled?"Đã hủy.":m==null?"Không kết nối được PC.":m);
        }finally{Socket s=active;active=null;if(s!=null)try{s.close();}catch(IOException ignored){}busy.set(false);report("idle","");}});
    }
    private static SSLContext pinned(String pin) throws Exception {
        X509TrustManager trust=new X509TrustManager(){
            public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
            public void checkClientTrusted(X509Certificate[] c,String auth)throws CertificateException{throw new CertificateException();}
            public void checkServerTrusted(X509Certificate[] chain,String auth)throws CertificateException{
                try{
                    if(chain==null || chain.length==0 || !hex(MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded())).equals(pin))
                        throw new CertificateException("Danh tính PC khác với lúc ghép đôi.");
                }catch(NoSuchAlgorithmException e){throw new CertificateException(e);}
            }
        };
        SSLContext context=SSLContext.getInstance("TLS");context.init(null,new TrustManager[]{trust},new SecureRandom());return context;
    }
    private SSLSocket connect(String host,int port,String pin) throws Exception {
        if(port<1 || port>65535 || !pin.matches("[0-9a-f]{64}"))throw new IOException("Thông tin PC không hợp lệ.");
        InetAddress ip=local(host);
        Socket socket=new Socket();active=socket;
        if(cancelled)throw new InterruptedIOException();
        socket.connect(new InetSocketAddress(ip,port),7000);
        SSLSocket ssl=(SSLSocket)pinned(pin).getSocketFactory().createSocket(socket,host,port,true);
        ssl.setSoTimeout(75000);ssl.startHandshake();return ssl;
    }
    private static void header(DataOutputStream out,JSONObject message)throws Exception{
        byte[] bytes=message.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>8192)throw new IOException();
        out.writeInt(bytes.length);out.write(bytes);out.flush();
    }
    private static JSONObject response(DataInputStream in)throws Exception{
        int n=in.readInt();if(n<=0 || n>8192)throw new IOException("PC trả về dữ liệu không hợp lệ.");
        byte[] bytes=new byte[n];in.readFully(bytes);
        JSONObject msg=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        if(!msg.optBoolean("ok"))throw new IOException(msg.optString("message","PC từ chối."));return msg;
    }
    String destination(){return prefs.getString("host","");}
    void pair(String text){submit(()->{
        Uri uri=Uri.parse(text.trim());String pin=uri.getQueryParameter("pin"),token=uri.getQueryParameter("token");
        if(!"veluna-pair".equals(uri.getScheme()) || uri.getUserInfo()!=null || pin==null || token==null || !token.matches("[a-zA-Z0-9_-]{43}"))
            throw new IOException("Mã ghép đôi không hợp lệ.");
        byte[] random=new byte[32];new SecureRandom().nextBytes(random);
        String key=Base64.encodeToString(random,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
        try(SSLSocket ssl=connect(uri.getHost(),uri.getPort(),pin)){
            DataOutputStream out=new DataOutputStream(ssl.getOutputStream());
            header(out,new JSONObject().put("kind","pair").put("device",Build.MODEL).put("token",token).put("key",key));
            report("status","Chờ bấm Chấp nhận trên PC.");
            response(new DataInputStream(ssl.getInputStream()));
            if(cancelled)throw new InterruptedIOException();
            if(!secrets.write("lan-peer",key))throw new IOException("Không lưu được khóa ghép đôi.");
            prefs.edit().putString("host",uri.getHost()).putInt("port",uri.getPort()).putString("pin",pin).apply();
            report("paired",destination());
        }
    });}
    void send(String id,String title,String action){submit(()->{
        String host=destination(),key=secrets.read("lan-peer");
        if(host.isEmpty() || key.isEmpty())throw new IOException("Ghép đôi với PC trước.");
        String videoId=PlaybackService.extractYtmVideoId(Uri.parse(id), id);
        if(videoId!=null){
            try(SSLSocket ssl=connect(host,prefs.getInt("port",0),prefs.getString("pin",""))){
                header(new DataOutputStream(ssl.getOutputStream()),new JSONObject().put("kind","reference")
                    .put("key",key).put("video_id",videoId).put("name",title).put("action",action));
                if(!response(new DataInputStream(ssl.getInputStream())).optBoolean("ok"))throw new IOException("PC chưa nhận bài.");
                report("sent",title);
            }
            return;
        }
        Uri file=Uri.parse(id);long size=0;MessageDigest sha=MessageDigest.getInstance("SHA-256");byte[] buf=new byte[65536];
        try(InputStream in=activity.getContentResolver().openInputStream(file)){
            if(in==null)throw new IOException("Không đọc được bài đã chọn.");
            for(int n;(n=in.read(buf))!=-1;){if(cancelled)throw new InterruptedIOException();size+=n;if(size>LIMIT)throw new IOException("File vượt quá 512 MiB.");sha.update(buf,0,n);}
        }
        if(size==0)throw new IOException("File trống.");
        String digest=hex(sha.digest());
        try(SSLSocket ssl=connect(host,prefs.getInt("port",0),prefs.getString("pin",""));
            InputStream media=activity.getContentResolver().openInputStream(file)){
            if(media==null)throw new IOException("Không mở được file.");
            DataOutputStream out=new DataOutputStream(new BufferedOutputStream(ssl.getOutputStream(),65536));
            DataInputStream in=new DataInputStream(ssl.getInputStream());
            header(out,new JSONObject().put("kind","send").put("key",key).put("size",size).put("name",title).put("action",action).put("digest",digest));
            if(!response(in).optBoolean("ready"))throw new IOException("PC chưa sẵn sàng.");
            int n;long sent=0,last=0;
            while((n=media.read(buf))!=-1){
                if(cancelled)throw new InterruptedIOException();sent+=n;if(sent>size)throw new IOException("File đã đổi.");
                out.write(buf,0,n);
                if(SystemClock.elapsedRealtime()-last>450){report("progress",100*sent/size);last=SystemClock.elapsedRealtime();}
            }
            if(sent!=size)throw new IOException("Kích thước file đã đổi.");out.flush();
            if(!digest.equals(response(in).optString("digest")))throw new IOException("PC chưa xác nhận file.");
            report("sent",title);
        }
    });}
    void cancel(){
        cancelled=true;
        Socket transport=active;
        if(transport==null)return;
        // Closing the underlying TCP socket unblocks a TLS handshake or read on the transfer worker.
        new Thread(()->{try{transport.close();}catch(IOException ignored){}}, "Veluna-LAN-cancel").start();
    }
    void forget(){cancel();stopDiscovery();prefs.edit().clear().apply();try{secrets.write("lan-peer","");}catch(Exception ignored){}report("paired","");}
    void discover(){
        if(nsd==null || discovery!=null || destination().isEmpty())return;
        NsdManager.DiscoveryListener session=new NsdManager.DiscoveryListener(){
            public void onDiscoveryStarted(String type){}
            public void onDiscoveryStopped(String type){}
            public void onStartDiscoveryFailed(String type,int error){activity.runOnUiThread(()->{if(discovery==this)stopDiscovery();});}
            public void onStopDiscoveryFailed(String type,int error){}
            public void onServiceLost(NsdServiceInfo info){}
            public void onServiceFound(NsdServiceInfo info){
                String pin=prefs.getString("pin","");
                if(pin.length()!=64 || !info.getServiceName().startsWith("VelunaMusic-"+pin.substring(0,10)))return;
                try{nsd.resolveService(info,new NsdManager.ResolveListener(){
                    public void onResolveFailed(NsdServiceInfo info,int error){}
                    public void onServiceResolved(NsdServiceInfo found){
                        byte[] value=found.getAttributes().get("pin");InetAddress ip=found.getHost();
                        if(value==null || ip==null || !pin.equals(new String(value,StandardCharsets.US_ASCII)) || !(ip instanceof Inet4Address) || !(ip.isSiteLocalAddress() || ip.isLinkLocalAddress()))return;
                        activity.runOnUiThread(()->{
                            if(discovery==null || !pin.equals(prefs.getString("pin","")))return;
                            prefs.edit().putString("host",ip.getHostAddress()).putInt("port",found.getPort()).apply();report("paired",destination());
                        });
                    }
                });}catch(RuntimeException ignored){}
            }
        };
        discovery=session;
        try{nsd.discoverServices("_velunamusic._tcp.",NsdManager.PROTOCOL_DNS_SD,session);}catch(RuntimeException e){discovery=null;}
    }
    void stopDiscovery(){if(discovery!=null){try{nsd.stopServiceDiscovery(discovery);}catch(RuntimeException ignored){}discovery=null;}}
    void close(){cancel();stopDiscovery();worker.shutdownNow();}
}
