import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const code=await readFile(new URL("../ui/remote.js",import.meta.url),"utf8");
const configContext={window:{}};vm.runInNewContext(await readFile(new URL("../ui/cloud-config.js",import.meta.url),"utf8"),configContext);
const config=configContext.window.velunaCloud;
function device({WebSocket,auth,id,listen}) {
  const nodes=new Map(),keys=new Map(),actions=["play","pause","next","previous","select"].map(command=>({dataset:{command}}));
  function el(name) {
    if(!nodes.has(name))nodes.set(name,{value:"",open:name==="account-dialog",max:120,
      replaceChildren(...items){this.items=items;this.value=(items.find(o=>o.selected) || items[0])?.value || "";},
      querySelectorAll:()=>actions});
    return nodes.get(name);
  }
  const audio={paused:true,volume:1,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};
  const env={WebSocket,config,crypto:webcrypto,URL,Date,setTimeout,clearTimeout,setInterval,clearInterval,tracks:[{id:"music",title:"Demo"}],
    native:null,audio,selected:"music",playOrder:()=>["music"],el,window:{addEventListener(){}},
    Option:class{constructor(text,value,_default,selected){Object.assign(this,{text,value,selected});}},
    document:{hidden:false,body:{dataset:{playing:"false"}},addEventListener(){}},
    localStorage:{getItem:k=>keys.get(k),setItem:(k,v)=>keys.set(k,v)}};
  if(listen)keys.set("remote/"+auth.id,"1");
  vm.createContext(env);vm.runInContext(code,env);
  const remote=env.playerRemote({config,device:()=>({device_id:id,label:id}),session:()=>auth,refresh:async()=>{}});
  remote.update();return {el,actions,audio,close(){auth=null;remote.update();}};
}
function memorySocket(){
  const sockets=new Set();
  return class {
    constructor(){this.readyState=1;sockets.add(this);queueMicrotask(()=>this.onopen?.());}
    close(){this.readyState=3;sockets.delete(this);}
    send(str){const m=JSON.parse(str);
      if(m.event==="phx_join"){this.topic=m.topic;queueMicrotask(()=>this.onmessage({data:JSON.stringify({...m,event:"phx_reply",payload:{status:"ok"}})}));}
      if(m.event==="broadcast")for(const ws of sockets){if(ws!==this && ws.topic===m.topic)queueMicrotask(()=>ws.onmessage({data:str}));}
    }
  };
}
async function until(check,timeout=12000){
  const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error("Remote operation timed out");await new Promise(r=>setTimeout(r,30));}
}
async function exercise(WebSocket,auth){
  const pc=device({WebSocket,auth,id:"receiver",listen:true}),phone=device({WebSocket,auth,id:"sender",listen:false});
  try{
    await until(()=>phone.el("remote-device").value==="receiver");
    assert.equal(phone.el("remote-queue").items[0].text,"Demo");
    phone.actions[0].onclick();await until(()=>!pc.audio.paused && phone.el("remote-status").textContent==="Máy phát đã thực hiện.");
    phone.actions[1].onclick();await until(()=>pc.audio.paused && phone.el("remote-status").textContent==="Máy phát đã thực hiện.");
    phone.el("remote-volume").onchange({target:{value:43}});
    await until(()=>pc.audio.volume===.43 && phone.el("remote-status").textContent==="Máy phát đã thực hiện.");
  }finally{phone.close();pc.close();}
}
test("remote selects a listening device, reads its queue and acknowledges playback and volume",async()=>{
  await exercise(memorySocket(),{id:"fixture",access:"fixture",expires:Date.now()+3600000});
});
test("live Supabase private broadcast and account isolation",{skip:!process.env.VELUNA_QA_ACCOUNTS},async()=>{
  const accounts=JSON.parse(process.env.VELUNA_QA_ACCOUNTS);
  async function login(q){
    const r=await fetch(config.url+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:config.publishableKey,"Content-Type":"application/json"},body:JSON.stringify({email:q.email,password:q.pw})});
    assert.equal(r.status,200);const data=await r.json();
    return {id:data.user.id,access:data.access_token,expires:Date.now()+data.expires_in*1000};
  }
  const [a,b]=await Promise.all(accounts.map(login));await exercise(WebSocket,a);
  const address=new URL("/realtime/v1/websocket",config.url);
  address.protocol="wss:";address.searchParams.set("apikey",config.publishableKey);address.searchParams.set("vsn","1.0.0");
  const ws=new WebSocket(address);
  try {
    let denied=false,allowed=false;
    ws.onopen=()=>ws.send(JSON.stringify({topic:"realtime:veluna-remote-"+a.id,event:"phx_join",ref:"1",
      payload:{access_token:b.access,config:{private:true,broadcast:{ack:false,self:false},postgres_changes:[]}}}));
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.event==="phx_reply"){
      denied=m.payload.status==="error";allowed=m.payload.status==="ok";}};
    await until(()=>denied || allowed);assert.equal(denied,true);
  }finally{ws.close();}
});


test("live durable command survives reconnect and remains private to the account",{skip:!process.env.VELUNA_QA_ACCOUNTS},async()=>{
  const accounts=JSON.parse(process.env.VELUNA_QA_ACCOUNTS);
  async function client(account){
    const headers={apikey:config.publishableKey,"Content-Type":"application/json"};
    const login=await fetch(config.url+"/auth/v1/token?grant_type=password",{method:"POST",headers,body:JSON.stringify({email:account.email,password:account.pw})});
    assert.equal(login.status,200);
    headers.Authorization="Bearer "+(await login.json()).access_token;
    return async(path,body)=>{
      const res=await fetch(config.url+"/rest/v1/"+path,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined});
      assert.ok(res.ok,"Cloud request failed with "+res.status);
      const raw=await res.text();return raw?JSON.parse(raw):null;
    };
  }
  const [request,other]=await Promise.all(accounts.map(client)),id=webcrypto.randomUUID();
  const [sender,recipient]=[webcrypto.randomUUID(),webcrypto.randomUUID()];
  const rows=[{device_id:sender,label:"QA PC",platform:"windows"},{device_id:recipient,label:"QA phone",platform:"android"}];
  await request("veluna_devices",rows);
  const op={p_id:id,p_sender:sender,p_recipient:recipient,p_instance:webcrypto.randomUUID(),p_version:webcrypto.randomUUID(),
    p_action:"move",p_value:1,p_destination:0,p_deadline:new Date(Date.now()+60000).toISOString()};
  await request("rpc/veluna_command",op);await request("rpc/veluna_command",op);
  const filter="veluna_commands?select=id,result&id=eq."+id;
  assert.equal((await request(filter+"&expires_at=gt.now")).length,1);
  assert.deepEqual(await other(filter),[]);
  await request("rpc/veluna_command_ack",{p_id:id,p_recipient:recipient,p_result:""});
  assert.equal((await request(filter))[0].result,"");
});
