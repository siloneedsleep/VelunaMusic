import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const code=await readFile(new URL("../ui/spotify.js",import.meta.url),"utf8");
const page=await readFile(new URL("../site/callback.js",import.meta.url),"utf8");
function fixture() {
  const secrets=new Map(),nodes=new Map(),fetches=[],requests=[];
  let launched=null,uid="fixture-owner";
  const el=id=>{if(!nodes.has(id))nodes.set(id,{value:"",hidden:true});return nodes.get(id);};
  const window={addEventListener(){},velunaVault:{async read(k){return secrets.get(k)||"";},async write(k,v){secrets.set(k,v);}}};
  const ctx=vm.createContext({window,el,crypto:webcrypto,btoa,TextEncoder,URLSearchParams,URL,AbortSignal,
    native:{openSpotify(url){launched=new URL(url);},spotifyCallback(){return "";}},
    async fetch(url,opts){fetches.push([url,opts]);return {ok:true,json:async()=>({access_token:"spotify-test-access"})};}});
  vm.runInContext(code,ctx);
  ctx.spotifySettings({user:()=>uid,perform:async f=>f(),async request(path,method,payload){
    requests.push([path,method,payload]);return {display_name:"Fixture",spotify_id:"fixture"};
  }});
  return {el,secrets,ctx,requests,fetches,launched:()=>launched,user:x=>{uid=x;}};
}
test("Spotify PKCE challenge binds callback to the initiating account and exchanges the code once",async()=>{
  const f=fixture();await f.el("spotify-link").onclick();
  const url=f.launched(),p=JSON.parse(f.secrets.get("spotify-pending"));
  assert.equal(url.origin,"https://accounts.spotify.com");assert.equal(url.searchParams.get("scope"),"user-read-private");
  const hash=Buffer.from(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(p.verifier))).toString("base64url");
  assert.equal(url.searchParams.get("code_challenge"),hash);assert.equal(url.searchParams.get("code_challenge_method"),"S256");
  const callback="velunamusic://spotify/callback?state="+p.state+"&code=fake";
  f.user("different");f.el("spotify-return-url").value=callback;await f.el("spotify-paste").onclick();
  assert.equal(f.fetches.length,0);
  f.user("fixture-owner");f.el("spotify-return-url").value=callback;await f.el("spotify-paste").onclick();
  assert.equal(f.fetches[0][1].body.get("code_verifier"),p.verifier);
  assert.equal(f.requests[0][0],"/functions/v1/spotify-link");assert.equal(f.secrets.get("spotify-pending"),"");
  f.el("spotify-return-url").value=callback;await f.el("spotify-paste").onclick();assert.equal(f.fetches.length,1);
  assert.equal(f.el("spotify-profile").textContent,"Fixture");
});
test("callback page removes the browser query and returns only Spotify's code and state",()=>{
  const qs=new URLSearchParams({state:"x".repeat(43),code:"fixture",next:"https://example.org"}),nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  let cleaned=null;
  vm.runInNewContext(page,{URL,URLSearchParams,location:{search:"?"+qs,pathname:"/callback"},history:{replaceState(a,b,url){cleaned=url;}},document:{getElementById:get}});
  assert.equal(cleaned,"/callback");const url=new URL(get("return-app").href);
  assert.equal(url.protocol,"velunamusic:");assert.equal(url.host,"spotify");assert.ok(!url.searchParams.has("next"));
  const f=fixture();assert.equal(f.ctx.parseSpotifyReturn("https://wrong.example/callback?"+qs),null);
  assert.equal(f.ctx.parseSpotifyReturn(url.href+"&state=duplicate"),null);
});
