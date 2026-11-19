const base = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Cache-Control":"no-store"
};
function reply(status:number, data:unknown) {
  return Response.json(data,{status,headers:cors});
}
Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return reply(405,{message:"POST required"});
  const authorization=req.headers.get("authorization") || "";
  if(!authorization.startsWith("Bearer ")) return reply(401,{message:"VelunaMusic sign-in required"});
  try {
    const auth=await fetch(base+"/auth/v1/user",{headers:{apikey:publicKey,authorization},signal:AbortSignal.timeout(8000)});
    if(!auth.ok)return reply(401,{message:"VelunaMusic session expired"});
    const user=await auth.json();
    const payload=await req.json();
    const token=payload?.access_token;
    if(typeof token!=="string" || token.length<10 || token.length>4096)return reply(400,{message:"Invalid Spotify token"});
    const spotify=await fetch("https://api.spotify.com/v1/me",{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(8000)});
    if(!spotify.ok)return reply(spotify.status===403?403:spotify.status===429?429:401,{
      message:spotify.status===403?"Spotify chưa cấp quyền cho tài khoản này trong Development Mode.":spotify.status===429?"Spotify đang giới hạn yêu cầu.":"Spotify chưa xác nhận hồ sơ."
    });
    const profile=await spotify.json();
    if(typeof profile.id!=="string" || !profile.id || profile.id.length>256) return reply(502,{message:"Spotify profile unavailable"});
    const display=typeof profile.display_name==="string" && profile.display_name.trim()?profile.display_name.slice(0,256):profile.id;
    const record={user_id:user.id,spotify_id:profile.id,display_name:display,linked_at:new Date().toISOString()};
    const saved=await fetch(base+"/rest/v1/veluna_spotify_links?on_conflict=user_id",{
      method:"POST",headers:{apikey:serverKey,Authorization:"Bearer "+serverKey,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates"},
      body:JSON.stringify(record),signal:AbortSignal.timeout(8000)
    });
    if(!saved.ok)return reply(503,{message:"Không lưu được liên kết. Thử lại."});
    return reply(200,{spotify_id:record.spotify_id,display_name:display});
  } catch {return reply(503,{message:"Không thể xác minh liên kết Spotify lúc này."});}
});
