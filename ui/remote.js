"use strict";

function playerRemote({config,session,device,refresh}) {
  const picker=el("remote-device"), opt=el("remote-listen"), queue=el("remote-queue");
  const peers=new Map(), seen=new Set(), pending=new Map();
  const status=s=>{el("remote-status").textContent=s;};
  let socket=null, owner="", topic="", joined=false, sequence=0, heart=0, reconnect=0, token="";
  let incarnation="", queueVersion="", previousOrder=null, retry=1000, changed=0, lastState="";
  const me=()=>device().device_id;
  function wanted(){return session() && !document.hidden && (opt.checked || el("account-dialog").open);}
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
    return {instance:incarnation,label:device().label,version:queueVersion,playing:document.body.dataset.playing==="true",
      title:titles.get(selected)||"",seconds:Number(el("seek").value)||0,duration:Number(el("seek").max)||0,
      volume:native?native.playerVolume():Math.round(audio.volume*100),index:order.indexOf(selected),
      queue:order.slice(0,300).map(id=>(titles.get(id)||"").slice(0,160))};
  }
  function announce(to){if(opt.checked && joined)broadcast("state",{to,state:snapshot()});}
  function playbackChanged(){
    if(!opt.checked || !joined || changed)return;
    changed=setTimeout(()=>{changed=0;if(!opt.checked || !joined)return;
      const state=snapshot(), key=JSON.stringify([state.version,state.index,state.title,state.playing,state.volume]);
      if(key!==lastState){lastState=key;broadcast("state",{state});}
    },180);
  }
  function render(){
    const previous=picker.value;
    picker.replaceChildren(...[...peers].map(([id,p])=>new Option(p.label,id,false,id===previous)));
    const p=peers.get(picker.value);el("remote-controls").hidden=!p;
    if(!p)return;
    el("remote-seek").max=p.duration;el("remote-seek").value=p.seconds;
    el("remote-volume").value=p.volume;queue.replaceChildren(...p.queue.map((v,i)=>new Option(v,String(i),false,i===p.index)));
  }
  function disconnect(){
    clearTimeout(changed);clearTimeout(reconnect);clearInterval(heart);reconnect=heart=changed=0;joined=false;lastState="";
    if(socket){const old=socket;socket=null;old.onclose=null;old.close();}
    for(const v of pending.values())clearTimeout(v.timer);
    pending.clear();peers.clear();seen.clear();render();
  }
  function update(){
    const auth=session();
    if(owner!==(auth?.id || "")){
      disconnect();owner=auth?.id || "";opt.checked=!!owner && localStorage.getItem("remote/"+owner)==="1";
    }
    if(!wanted()){if(socket || reconnect)disconnect();return;}
    if(socket){
      if(joined && token!==auth.access){token=auth.access;sendFrame("access_token",{access_token:token});}
      if(joined && el("account-dialog").open)broadcast("discover");
      return;
    }
    clearTimeout(reconnect);reconnect=0;
    const url=new URL("/realtime/v1/websocket",config.url);url.protocol="wss:";url.searchParams.set("apikey",config.publishableKey);url.searchParams.set("vsn","1.0.0");
    const ws=new WebSocket(url);socket=ws;topic="realtime:veluna-remote-"+owner;incarnation=crypto.randomUUID();
    ws.onopen=()=>{if(ws!==socket)return;token=session().access;
      sendFrame("phx_join",{config:{private:true,broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[]},access_token:token});};
    ws.onmessage=async event=>{
      if(ws!==socket || !wanted())return;
      try{
        const msg=JSON.parse(event.data);if(msg.topic!==topic)return;
        if(msg.event==="phx_reply" && !joined){
          if(msg.payload.status!=="ok"){status("Chưa kết nối được điều khiển từ xa.");ws.close();return;}
          joined=true;retry=1000;broadcast("discover");announce();
          heart=setInterval(()=>{
            if(!wanted()){update();return;}
            sendFrame("heartbeat",{},"phoenix");
            if(session().expires<Date.now()+90000)refresh().catch(()=>ws.close());
          },25000);
        } else if(msg.event==="broadcast" && msg.payload?.event==="player")await receive(msg.payload.payload,ws);
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
    if(m.type==="offline"){peers.delete(m.from);render();return;}
    if(m.type==="state"){
      const p=m.state;if(!p || typeof p.instance!=="string" || typeof p.label!=="string" ||
        !Array.isArray(p.queue) || p.queue.length>300 || !p.queue.every(s=>typeof s==="string") ||
        ![p.seconds,p.duration,p.volume,p.index].every(Number.isFinite))return;
      peers.set(m.from,p);render();return;
    }
    if(m.type==="ack"){
      const call=pending.get(m.id);if(!call || call.peer!==m.from)return;
      clearTimeout(call.timer);pending.delete(m.id);status(m.ok?"Máy phát đã thực hiện.":String(m.error || "Máy phát từ chối."));return;
    }
    if(m.type!=="command" || !opt.checked || m.instance!==incarnation || typeof m.id!=="string" ||
        seen.has(m.id) || !["play","pause","next","previous","seek","volume","select"].includes(m.action))return;
    seen.add(m.id);if(seen.size>128)seen.delete(seen.values().next().value);
    let error="";
    try{
      const state=snapshot();
      if(m.version!==state.version)throw Error("Hàng chờ đã đổi.");
      let value=Number(m.value);
      if(!Number.isFinite(value) || (m.action==="select" && (!Number.isInteger(value) || value<0 || value>=state.queue.length)) ||
        (m.action==="seek" && (value<0 || value>state.duration)) || (m.action==="volume" && (value<0 || value>100)))throw Error("Giá trị ngoài phạm vi.");
      if(native)await nativeTransfer("remotePlayer",JSON.stringify({action:m.action,value}));
      else {
        const order=playOrder(),i=order.indexOf(selected);
        if(m.action==="play"){if(!selected && order.length)await startTransferredTrack(order[0],true,0);else if(selected)await audio.play();else throw Error("Hàng chờ đang trống.");}
        if(m.action==="pause")audio.pause();
        if(m.action==="seek")audio.currentTime=value;
        if(m.action==="volume"){window.velunaDJ?.stopFade();audio.volume=value/100;}
        if(["next","previous","select"].includes(m.action)){
          const target=m.action==="select"?value:i+(m.action==="next"?1:-1);
          if(!order[target])throw Error("Không còn bài theo hướng này.");
          await startTransferredTrack(order[target],true,0);
        }
      }
    }catch(e){error=e.message || String(e);}
    if(ws===socket){broadcast("ack",{to:m.from,id:m.id,ok:!error,error});announce(m.from);}
  }
  function command(action,value=0){
    const peer=picker.value,p=peers.get(peer);if(!joined || !p)return;
    const id=crypto.randomUUID();status("Đang chờ "+p.label+"…");
    const timer=setTimeout(()=>{pending.delete(id);peers.delete(peer);render();status("Máy phát chưa xác nhận. Mở ứng dụng trên máy đó.");},10000);
    pending.set(id,{peer,timer});broadcast("command",{id,to:peer,instance:p.instance,version:p.version,action,value});
  }
  picker.onchange=render;
  for(const button of el("remote-controls").querySelectorAll("[data-command]")){
    button.onclick=()=>command(button.dataset.command,button.dataset.command==="select"?Number(queue.value):0);
  }
  el("remote-seek").onchange=e=>command("seek",Number(e.target.value));
  el("remote-volume").onchange=e=>command("volume",Number(e.target.value));
  opt.onchange=()=>{if(owner)localStorage.setItem("remote/"+owner,opt.checked?"1":"0");if(!opt.checked)broadcast("offline");update();announce();};
  document.addEventListener("visibilitychange",()=>{if(document.hidden)broadcast("offline");update();});
  window.addEventListener("pagehide",()=>{broadcast("offline");disconnect();});
  window.addEventListener("veluna-library",playbackChanged);window.addEventListener("veluna-playback",playbackChanged);
  render();return {update};
}
