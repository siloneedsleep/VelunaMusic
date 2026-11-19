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
test("mailbox tracks pendingCount and persists durable shuffle and repeat operations",async()=>{
  const storage=new Map(), sent=[];
  const ctx=vm.createContext({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  vm.runInContext(code,ctx);
  let online=false;
  const client=ctx.remoteMailbox({owner:()=>"user",device:()=>"phone",status(){},renderConflict(){},
    async request(_path,_m,body){
      if(!online)throw Error("offline");
      if(body){sent.push({id:body.p_id,action:body.p_action,value:body.p_value});return;}
      return [{result:""}];
    }});
  client.enqueue({id:"op-shuffle",to:"pc",instance:"inst",version:"v1",action:"shuffle",value:1,destination:0});
  client.enqueue({id:"op-repeat",to:"pc",instance:"inst",version:"v1",action:"repeat",value:2,destination:0});
  assert.equal(client.pendingCount(),2);
  online=true;
  await client.sync();
  await client.sync();
  assert.deepEqual(sent,[{id:"op-shuffle",action:"shuffle",value:1},{id:"op-repeat",action:"repeat",value:2}]);
  assert.equal(client.pendingCount(),0);
});
