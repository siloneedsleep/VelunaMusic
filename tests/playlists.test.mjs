import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";

const code=await readFile(new URL("../ui/playlists.js",import.meta.url),"utf8");
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function device(db,path) {
  const nodes=new Map(), storage=new Map(), callbacks={}, plays=[];
  const element=()=>({value:"",children:[],open:true,
    addEventListener(name,fn){this[name]=fn;},append(...v){this.children.push(...v);},
    replaceChildren(...v){this.children=v;this.value=(v.find(n=>n.selected) || v[0])?.value || "";}});
  const el=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const env={el,crypto:webcrypto,tracks:[{id:path,title:"Track"}],selected:path,native:null,albumQueue:[],
    inspectTrack:async()=> "3".repeat(64),loadTrack:(id)=>plays.push(id),navigator:{onLine:true},
    Option:class {constructor(title,value,unused,selected){Object.assign(this,{title,value,selected});}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    window:{addEventListener(name,fn){callbacks[name]=fn;}},document:{createElement:element,addEventListener(){}}};
  vm.createContext(env);vm.runInContext(code,env);
  const api=env.playlistLibrary(async(route,method,body)=>{
    if(!method)return Array.from(db.values(),structuredCloneSafe);
    const previous=db.get(body.p_item_id),revision=previous?.revision || 0;
    if(revision!==body.p_expected_revision)throw Object.assign(Error("conflict"),{code:"40001"});
    db.set(body.p_item_id,{item_id:body.p_item_id,kind:body.p_kind,payload:structuredCloneSafe(body.p_payload),revision:revision+1});
    return revision+1;
  });
  function structuredCloneSafe(x){return JSON.parse(JSON.stringify(x));}
  return {api,env,el,storage,callbacks,plays};
}
test("offline playlists sync by content digest and play the matching file on another machine",async()=>{
  const db=new Map(),a=device(db,"C:/music/a.wav"),b=device(db,"content://fixture/17");
  a.api.account("owner");await pause();a.env.navigator.onLine=false;
  a.el("playlist-name").value="Road";a.el("playlist-form").onsubmit({preventDefault(){}});
  await a.el("playlist-add").onclick();assert.equal(db.size,0);
  a.env.navigator.onLine=true;await a.callbacks.online();assert.equal(db.size,1);
  const row=[...db.values()][0];assert.equal(row.payload.name,"Road");
  assert.ok(!JSON.stringify(row.payload).includes("C:/"));
  b.api.account("owner");await pause();b.el("playlist-select").value=row.item_id;b.el("playlist-select").onchange();
  await b.el("playlist-play").onclick();assert.deepEqual(b.plays,["content://fixture/17"]);
  b.api.account(null);assert.equal(b.el("playlist-select").children.length,1);
});
test("concurrent offline edits can preserve both copies",async()=>{
  const db=new Map(),a=device(db,"A.wav"),b=device(db,"B.wav");
  a.api.account("owner");await pause();a.el("playlist-name").value="Study";a.el("playlist-form").onsubmit({preventDefault(){}});
  await pause();const row=[...db.values()][0];b.api.account("owner");await pause();
  b.el("playlist-select").value=row.item_id;b.el("playlist-select").onchange();
  b.env.navigator.onLine=false;await b.el("playlist-add").onclick();await a.el("playlist-add").onclick();await pause();
  b.env.navigator.onLine=true;await b.callbacks.online();assert.equal(b.el("playlist-conflict").hidden,false);
  b.el("playlist-copy").onclick();await pause();assert.equal(db.size,2);
  assert.equal(b.el("playlist-conflict").hidden,true);
});
