"use strict";
const spotifyClientId="5c7ac46186014cc3b27dc59cd371d4da";
const spotifyRedirect="https://veluna.siloneedsleep.xyz/callback";
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function parseSpotifyReturn(input) {
  if(!input || input.length>4096)return null;
  let u;try{u=new URL(input);}catch{return null;}
  if (u.username || u.password || u.port || u.hash || u.pathname!=="/callback") return null;
  if (!(u.protocol==="velunamusic:" && u.hostname==="spotify") && u.origin!=="https://veluna.siloneedsleep.xyz") return null;
  const state=u.searchParams.get("state"),code=u.searchParams.get("code"),error=u.searchParams.get("error");
  if(!/^[A-Za-z0-9_-]{43}$/.test(state||"") || u.searchParams.getAll("state").length!==1) return null;
  if(error==="access_denied")return {state,error};
  return code && code.length<=2048 && u.searchParams.getAll("code").length===1 ? {state,code} : null;
}
function spotifySettings({request, user, perform}) {
  let linked=null, busy=false;
  const tell = s => {el("spotify-status").textContent=s;};
  const open = url => native?native.openSpotify(url):desktop.invoke("open_spotify",{url});
  const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
  async function view() {
    const uid=user(); if(!uid)return;
    const rows=await request("/rest/v1/veluna_spotify_links?select=spotify_id,display_name");
    if(uid!==user())return;
    linked=rows[0]||null;render();
  }
  function render(){
    el("spotify-profile").textContent=linked?.display_name||"Chưa liên kết";
    el("spotify-unlink").hidden=!linked;el("spotify-open").hidden=!linked;
  }
  async function start() {
    if(!user())return;
    const verifier=random(),state=random();
    const challenge=base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));
    await window.velunaVault.write("spotify-pending",JSON.stringify({state,verifier,uid:user(),created:Date.now()}));
    const url=new URL("https://accounts.spotify.com/authorize");
    url.search=new URLSearchParams({client_id:spotifyClientId,response_type:"code",redirect_uri:spotifyRedirect,
      state,code_challenge:challenge,code_challenge_method:"S256",scope:"user-read-private",show_dialog:"true"}).toString();
    await open(url.href);tell("Hoàn tất đăng nhập Spotify trong trình duyệt rồi quay lại ứng dụng.");
  }
  async function complete(raw,manual=false) {
    if(busy || !user())return;
    const result=parseSpotifyReturn(raw);
    if(!result){if(manual)tell("Liên kết quay lại không hợp lệ.");return;}
    busy=true;
    try {
      const pending=JSON.parse(await window.velunaVault.read("spotify-pending")||"null");
      if(!pending || pending.state!==result.state || pending.uid!==user() || Date.now()-pending.created>600000){
        if(manual)tell("Phiên liên kết không khớp hoặc đã hết hạn.");return;
      }
      if(result.error){await window.velunaVault.write("spotify-pending","");tell("Đã hủy liên kết Spotify.");return;}
      const body=new URLSearchParams({grant_type:"authorization_code",code:result.code,redirect_uri:spotifyRedirect,client_id:spotifyClientId,code_verifier:pending.verifier});
      const res=await fetch("https://accounts.spotify.com/api/token",{method:"POST",body,redirect:"error",signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw Error("Spotify từ chối mã đăng nhập. Mở một phiên liên kết mới.");
      const tokens=await res.json();
      if(typeof tokens.access_token!=="string" || !tokens.access_token)throw Error("Spotify chưa cấp quyền truy cập.");
      if(user()!==pending.uid)return;
      const profile=await request("/functions/v1/spotify-link","POST",{access_token:tokens.access_token});
      if(user()!==pending.uid)return;
      await window.velunaVault.write("spotify-pending","");
      linked=profile;render();tell("Đã liên kết tài khoản Spotify.");
    } catch(e){tell(e.message||String(e));}
    finally {busy=false;el("spotify-return-url").value="";}
  }
  async function readReturn(){
    if(!user() || busy)return;
    try {const raw=native?native.spotifyCallback():await desktop.invoke("spotify_callback"); if(raw)await complete(raw);}
    catch(e){tell(e.message||String(e));}
  }
  el("spotify-link").onclick=()=>perform(start);
  el("spotify-paste").onclick=()=>complete(el("spotify-return-url").value.trim(),true);
  el("spotify-unlink").onclick=()=>perform(async()=>{
    if(!user())return;
    await request("/rest/v1/veluna_spotify_links?user_id=eq."+encodeURIComponent(user()),"DELETE");
    await window.velunaVault.write("spotify-pending","");
    linked=null;render();tell("Đã gỡ liên kết trong VelunaMusic. Có thể thu hồi quyền ở mục Ứng dụng được cấp quyền của Spotify.");
  });
  el("spotify-open").onclick=()=>open("https://open.spotify.com/");
  el("spotify-permissions").onclick=()=>open("https://www.spotify.com/account/apps/");
  window.addEventListener("spotify-return",readReturn);window.addEventListener("focus",readReturn);
  return {async show(){await view();await readReturn();},async clear(){linked=null;render();tell("");await window.velunaVault.write("spotify-pending","");}};
}
