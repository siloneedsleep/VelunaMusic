"use strict";

function playerRemote({config,session,device,refresh,request,onHandoff,onPeersChange}) {
  const picker=el("remote-device"), opt=el("remote-listen"), queue=el("remote-queue");
  const peers=new Map(), seen=new Map(), pending=new Map();
  const status=s=>{el("remote-status").textContent=s;if(el("connect-status"))el("connect-status").textContent=s;};
  let socket=null, owner="", topic="", joined=false, sequence=0, heart=0, reconnect=0, token="";
  let incarnation="", queueVersion="", previousOrder=null, retry=1000, changed=0, lastState="";
  const me=()=>device().device_id;
  const service=typeof native!=="undefined" && native?.remoteSettings;
  const listens=()=>opt.checked && !service;
  let conflict=null;
  const mailbox=request && remoteMailbox({request,owner:()=>owner,device:me,status,
    canReceive:listens,execute:m=>listens()?execute(m):null,
    renderConflict(op){conflict=op;el("remote-conflict").hidden=false;status("Hàng chờ trên máy phát đã đổi.");}});
  function wanted(){return session() && (listens() || (!document.hidden && (el("account-dialog").open || el("connect-dialog")?.open)));}
  function rememberPeers(){
    if(mailbox && owner)localStorage.setItem("remote-peers/"+owner,JSON.stringify([...peers].filter(([,p])=>p.durable).slice(-16)));
  }
  function sendFrame(event,payload,channel=topic){
    if(socket?.readyState!==1)return;
    socket.send(JSON.stringify({topic:channel,event,payload,ref:String(++sequence)}));
  }
  function broadcast(type,data={}){
    if(joined)sendFrame("broadcast",{type:"broadcast",event:"player",payload:{...data,type,from:me(),sent:Date.now()}});
  }
  function snapshot(){
    const order=playOrder();
    if(!previousOrder || order.length!==previousOrder.length || order.some((v,i)=>v!==previousOrder[i])){
      previousOrder=order.slice();queueVersion=crypto.randomUUID();
    }
    const titles=new Map(tracks.map(t=>[t.id,t.title]));
    const sec=native?(Number(el("seek")?.value)||0):(Number(audio.currentTime)||0);
    const dur=!native && Number.isFinite(audio.duration)?audio.duration:(Number(el("seek")?.max)||0);
    const playing=document.body.dataset.playing==="true";
    const repeatVal=el("repeat-mode")?.value || "off";
    const shuffled=Boolean(window.velunaListening?.isShuffled?.());
    return {durable:!!mailbox,instance:incarnation,label:device().label,platform:device().platform || (native?"android":"windows"),
      version:queueVersion,playing,isPlaying:playing,trackId:selected||"",positionMs:Math.round(sec*1000),updatedAt:Date.now(),
      title:titles.get(selected)||"",seconds:sec,duration:dur,
      volume:native?native.playerVolume():Math.round(audio.volume*100),index:order.indexOf(selected),currentIndex:order.indexOf(selected),
      shuffle:shuffled,repeat:repeatVal,
      queue:order.slice(0,300).map(id=>(titles.get(id)||"").slice(0,160))};
  }
  function announce(to){if(listens() && joined)broadcast("state",{to,state:snapshot()});}
  function playbackChanged(){
    if(!listens() || !joined || changed)return;
    changed=setTimeout(()=>{changed=0;if(!listens() || !joined)return;
      const state=snapshot(), key=JSON.stringify([state.version,state.index,state.title,state.playing,state.volume,state.shuffle,state.repeat]);
      if(key!==lastState){lastState=key;broadcast("state",{state});}
    },180);
  }
  function render(){
    const previous=picker.value;
    picker.replaceChildren(...[...peers].map(([id,p])=>new Option(p.label+(p.offline?" · ngoại tuyến":""),id,false,id===previous)));
    const p=peers.get(picker.value);el("remote-controls").hidden=!p;
    if(p){
      el("remote-seek").max=p.duration;el("remote-seek").value=p.seconds;
      el("remote-volume").value=p.volume;queue.replaceChildren(...p.queue.map((v,i)=>new Option(v,String(i),false,i===p.index)));
    }
    onPeersChange?.([...peers.entries()].map(([id,peer])=>({id,...peer})), picker.value);
  }
  function disconnect(){
    clearTimeout(changed);clearTimeout(reconnect);clearInterval(heart);reconnect=heart=changed=0;joined=false;lastState="";
    if(socket){const old=socket;socket=null;old.onclose=null;old.close();}
    for(const v of pending.values())clearTimeout(v.timer);
    pending.clear();for(const p of peers.values())p.offline=true;render();
  }
  function update(){
    const auth=session();
    if(owner!==(auth?.id || "")){
      disconnect();peers.clear();seen.clear();mailbox?.reset();conflict=null;el("remote-conflict").hidden=true;
      owner=auth?.id || "";incarnation=crypto.randomUUID();
      if(owner && mailbox)try{for(const [id,p] of JSON.parse(localStorage.getItem("remote-peers/"+owner)||"[]"))peers.set(id,{...p,offline:true});}catch{}
      render();opt.checked=!!owner && localStorage.getItem("remote/"+owner)==="1";
    }
    if(service)native.remoteSettings(owner,me(),device().label,!!auth && opt.checked);
    if(!wanted()){if(socket || reconnect)disconnect();return;}
    if(socket){
      if(joined && token!==auth.access){token=auth.access;sendFrame("access_token",{access_token:token});}
      if(joined && (el("account-dialog").open || el("connect-dialog")?.open))broadcast("discover");
      return;
    }
    clearTimeout(reconnect);reconnect=0;
    const url=new URL("/realtime/v1/websocket",config.url);url.protocol="wss:";url.searchParams.set("apikey",config.publishableKey);url.searchParams.set("vsn","1.0.0");
    const ws=new WebSocket(url);socket=ws;topic="realtime:veluna-remote-"+owner;
    ws.onopen=()=>{if(ws!==socket)return;token=session().access;
      sendFrame("phx_join",{config:{private:true,broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:mailbox?[
        {event:"UPDATE",schema:"public",table:"veluna_commands",filter:"sender=eq."+me()},
        ...(listens()?[{event:"INSERT",schema:"public",table:"veluna_commands",filter:"recipient=eq."+me()},
          {event:"*",schema:"public",table:"veluna_handoff",filter:"user_id=eq."+owner}]:[])]:[]},access_token:token});};
    ws.onmessage=async event=>{
      if(ws!==socket || !wanted())return;
      try{
        const msg=JSON.parse(event.data);if(msg.topic!==topic)return;
        if(msg.event==="phx_reply" && !joined){
          if(msg.payload.status!=="ok"){status("Chưa kết nối được điều khiển từ xa.");ws.close();return;}
          joined=true;retry=1000;broadcast("discover");announce();mailbox?.sync();if(listens())onHandoff?.();
          heart=setInterval(()=>{
            if(!wanted()){update();return;}
            sendFrame("heartbeat",{},"phoenix");
            if(session().expires<Date.now()+90000)refresh().catch(()=>ws.close());
          },25000);
        } else if(msg.event==="broadcast" && msg.payload?.event==="player")await receive(msg.payload.payload,ws);
        else if(msg.event==="postgres_changes"){
          if(msg.payload?.data?.table==="veluna_handoff")onHandoff?.();
          else mailbox?.sync();
        }
        else if(msg.event==="phx_error" || msg.event==="phx_close")ws.close();
      }catch(e){if(ws===socket)status(e.message || "Lỗi điều khiển.");}
    };
    ws.onerror=()=>{if(ws===socket)status("Không kết nối được kênh điều khiển.");};
    ws.onclose=()=>{if(ws!==socket)return;disconnect();if(wanted()){reconnect=setTimeout(update,retry);retry=Math.min(retry*2,30000);}};
  }
  async function receive(m,ws){
    if(!m || typeof m.from!=="string" || m.from===me() || (m.to && m.to!==me()) ||
        !Number.isFinite(m.sent) || Math.abs(Date.now()-m.sent)>20000)return;
    if(m.type==="discover"){announce(m.from);return;}
    if(m.type==="offline"){const p=peers.get(m.from);if(p?.durable)p.offline=true;else peers.delete(m.from);render();return;}
    if(m.type==="state"){
      const p=m.state;if(!p || typeof p.instance!=="string" || typeof p.label!=="string" ||
        !Array.isArray(p.queue) || p.queue.length>300 || !p.queue.every(s=>typeof s==="string") ||
        ![p.seconds,p.duration,p.volume,p.index].every(Number.isFinite))return;
      peers.set(m.from,{...p,offline:false});rememberPeers();render();return;
    }
    if(m.type==="ack"){
      const call=pending.get(m.id);if(!call || call.peer!==m.from)return;
      clearTimeout(call.timer);pending.delete(m.id);status(m.ok?"Máy phát đã thực hiện.":String(m.error || "Máy phát từ chối."));return;
    }
    if(m.type!=="command" || !listens() || m.to!==me() || typeof m.id!=="string")return;
    const error=await execute(m);
    if(ws===socket){broadcast("ack",{to:m.from,id:m.id,ok:!error,error});announce(m.from);}
  }
  async function execute(m){
    const key=m.from+"/"+m.id;
    if(seen.has(key))return seen.get(key);
    const promise=apply(m);seen.set(key,promise);
    if(seen.size>256)seen.delete(seen.keys().next().value);
    return promise;
  }
  async function apply(m){
    let error="";
    try{
      const state=snapshot();
      if(m.instance!==incarnation)throw Error("Phiên phát đã đổi.");
      if(!["play","pause","next","previous","seek","volume","select","move","shuffle","repeat"].includes(m.action))throw Error("Lệnh không hợp lệ.");
      if(m.version!==state.version)throw Error("Hàng chờ đã đổi.");
      let value=Number(m.value);
      if(!Number.isFinite(value) || (["move","select"].includes(m.action) && (!Number.isInteger(value) || value<0 || value>=state.queue.length)) ||
        (m.action==="seek" && (value<0 || value>state.duration)) || (m.action==="volume" && (value<0 || value>100)) ||
        (m.action==="repeat" && (!Number.isInteger(value) || value<0 || value>2)))throw Error("Giá trị ngoài phạm vi.");
      if(native)await nativeTransfer("remotePlayer",JSON.stringify({action:m.action,value,destination:m.destination}));
      else {
        const order=playOrder(),i=order.indexOf(selected);
        if(m.action==="play"){if(!selected && order.length)await startTransferredTrack(order[0],true,0);else if(selected)await audio.play();else throw Error("Hàng chờ đang trống.");}
        if(m.action==="move"){
          if(!Number.isInteger(m.destination) || m.destination<0 || m.destination>=state.queue.length)throw Error("Vị trí đích không hợp lệ.");
          const next=order.slice();next.splice(m.destination,0,...next.splice(value,1));
          albumQueue=next;savePosition();window.velunaDJ?.stopFade();window.velunaDJ?.prepare();draw();
        }
        if(m.action==="pause")audio.pause();
        if(m.action==="seek")audio.currentTime=value;
        if(m.action==="volume"){window.velunaDJ?.stopFade();audio.volume=value/100;}
        if(m.action==="shuffle")window.velunaListening?.toggleShuffle?.(value!==0);
        if(m.action==="repeat"){
          const modes=["off","one","all"];
          const modeEl=el("repeat-mode");
          if(modeEl){modeEl.value=modes[value] || "off";modeEl.onchange?.();}
        }
        if(["next","previous","select"].includes(m.action)){
          const target=m.action==="select"?value:i+(m.action==="next"?1:-1);
          if(!order[target])throw Error("Không còn bài theo hướng này.");
          await startTransferredTrack(order[target],true,0);
        }
      }
    }catch(e){error=e.message || String(e);}
    if(!error)announce(m.from);return error;
  }
  function command(action,value=0){
    const peer=picker.value,p=peers.get(peer);if(!p)return;
    const id=crypto.randomUUID();status("Đang chờ "+p.label+"…");
    if(p.durable && mailbox){
      let destination=0;
      if(["up","down"].includes(action)){
        value=Number(queue.value);destination=value+(action==="up"?-1:1);
        if(destination<0 || destination>=p.queue.length){status("Đã ở biên hàng chờ.");return;}
        action="move";
      }
      mailbox.enqueue({id,to:peer,instance:p.instance,version:p.version,action,value,destination});return;
    }
    if(!joined || ["up","down"].includes(action)){status("Máy phát chưa hỗ trợ thao tác này.");return;}
    const timer=setTimeout(()=>{pending.delete(id);peers.delete(peer);render();status("Máy phát chưa xác nhận. Mở ứng dụng trên máy đó.");},10000);
    pending.set(id,{peer,timer});broadcast("command",{id,to:peer,instance:p.instance,version:p.version,action,value});
  }
  if(mailbox){
    const resolve=()=>{if(conflict)mailbox.discard(conflict.id);conflict=null;el("remote-conflict").hidden=true;mailbox.sync();};
    el("remote-reselect").onclick=()=>{if(conflict){picker.value=conflict.to;render();}resolve();queue.focus();};
    el("remote-discard").onclick=resolve;window.addEventListener("online",()=>{update();mailbox.sync();});
  }
  picker.onchange=render;
  for(const button of el("remote-controls").querySelectorAll("[data-command]")){
    button.onclick=()=>command(button.dataset.command,button.dataset.command==="select"?Number(queue.value):0);
  }
  el("remote-seek").onchange=e=>command("seek",Number(e.target.value));
  el("remote-volume").onchange=e=>command("volume",Number(e.target.value));
  opt.onchange=()=>{if(owner)localStorage.setItem("remote/"+owner,opt.checked?"1":"0");if(!opt.checked)broadcast("offline");update();announce();};
  document.addEventListener("visibilitychange",()=>{update();});
  window.addEventListener("pagehide",()=>{if(listens())broadcast("offline");disconnect();});
  window.addEventListener("veluna-library",playbackChanged);window.addEventListener("veluna-playback",playbackChanged);
  render();
  return {
    update,
    command,
    snapshot,
    getPeers:()=>[...peers.entries()].map(([id,p])=>({id,...p})),
    getActivePeer:()=>peers.get(picker.value) ? {id:picker.value,...peers.get(picker.value)} : null,
    selectPeer(id){if(peers.has(id)){picker.value=id;render();return true;}return false;}
  };
}
