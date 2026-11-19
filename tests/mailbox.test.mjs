import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const code=await readFile(new URL("../ui/remote-mailbox.js",import.meta.url),"utf8");

test("offline edits retain their operation ID and expose a version conflict after reconnect",async()=>{
  const storage=new Map(), sent=[],conflicts=[];
  const ctx=vm.createContext({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  vm.runInContext(code,ctx);
  let online=false;
  const make=()=>ctx.remoteMailbox({owner:()=>"user",device:()=>"source",status(){},renderConflict(op){conflicts.push(op.id);},
    async request(path,_m,body){
      if(!online)throw Error("offline");
      if(body){sent.push(body.p_id);return;}
      return [{result:"Hàng chờ đã đổi."}];
    }});
  let client=make();
  client.enqueue({id:"operation",to:"peer",instance:"session",version:"before",action:"move",value:0,destination:1});
  await client.sync();client.reset();client=make();online=true;await client.sync();await client.sync();
  assert.deepEqual(sent,["operation"]);assert.ok(conflicts.includes("operation"));
  client.discard("operation");assert.deepEqual(JSON.parse(storage.get("remote-operations/user")),[]);
});
