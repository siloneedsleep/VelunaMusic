(() => {
  const dialog = el("nearby-dialog"), drop = el("nearby-drop"), status = el("nearby-status");
  let invitation = "", approval = "", target = native?.nearbyDestination() || "";
  let queue = [], sending = false, suppressClick = false;
  function announce(text) { status.textContent=text; if (!dialog.open) msg(text); }
  function failure(e) { announce(e.message || String(e)); }
  function drawCode(rows) {
    const canvas=el("nearby-qr"), ctx=canvas.getContext("2d"), grid=rows.length, unit=5;
    canvas.width=canvas.height=(grid+8)*unit;
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#061831";
    rows.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect((x+4)*unit,(y+4)*unit,unit,unit);}));
  }
  function pump() {
    if(sending || !queue.length)return;
    const job=queue.shift();sending=true;
    el("nearby-progress").hidden=false;el("nearby-progress").value=0;
    announce("Đang gửi "+(tracks.find(t=>t.id===job.id)?.title || "bài hát")+"…");
    native.nearbySend(job.id,job.action);
  }
  function enqueue(ids) {
    if(!target){announce("Quét mã từ PC trước khi gửi.");return;}
    const action=el("nearby-action").value;
    queue.push(...ids.map(id=>({id,action})));pump();
  }
  async function received({id,action}) {
    const previous=playOrder().slice();
    tracks=await desktop.invoke("library");
    if(!tracks.some(t=>t.id===id))return;
    if(action==="save") {
      // Keep the current playback order separate from the newly imported library.
      if(previous.length)albumQueue=previous;
    } else {
      const order=previous.filter(x=>x!==id);
      const insert=action==="next" || action==="now" ? Math.max(0,order.indexOf(selected)+1) : order.length;
      order.splice(insert,0,id); albumQueue=order;
      if(action==="now")loadTrack(id,true);
    }
    draw();el("nearby-progress").hidden=true;
    announce("Đã nhận "+tracks.find(t=>t.id===id).title);
  }
  window.onVelunaNearby=(event,data)=>{
    if(event==="pair") {
      approval=data.id;el("nearby-confirm").hidden=false;el("nearby-phone-name").textContent=data.device+" muốn ghép đôi.";
      if(!dialog.open)dialog.showModal();
    } else if(event==="paired") {
      target=data;el("nearby-target").textContent=target?"PC đã ghép đôi · "+target:"Chưa ghép đôi PC.";announce(el("nearby-target").textContent);
    } else if(event==="progress") {
      el("nearby-progress").hidden=false;el("nearby-progress").value=Number(data);
    } else if(event==="received") received(data).catch(failure);
    else if(event==="sent"){el("nearby-progress").value=100;announce("PC đã nhận "+data);}
    else if(event==="idle"){sending=false;pump();}
    else if(event==="error"){queue=[];sending=false;el("nearby-progress").hidden=true;announce(data);}
    else if(event==="status")announce(data);
  };
  el("nearby").onclick=async()=>{
    el("nearby-pc").hidden=!desktop;el("nearby-phone").hidden=!native;dialog.showModal();
    try {
      if(native){
        target=native.nearbyDestination();native.nearbyDiscover(true);
        el("nearby-target").textContent=target?"PC đã ghép đôi · "+target:"Chưa ghép đôi PC.";
        el("nearby-tracks").replaceChildren(...tracks.map(t=>new Option(t.title,t.id,false,t.id===selected)));
      } else {
        const ips=await desktop.invoke("nearby_interfaces");
        el("nearby-ip").replaceChildren(...ips.map(ip=>new Option(ip,ip)));
        el("nearby-start").disabled=!ips.length;
        if(!ips.length)announce("Kết nối PC vào Wi-Fi hoặc Ethernet để nhận nhạc.");
      }
    }catch(e){failure(e);}
  };
  el("nearby-close").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>{if(native)native.nearbyDiscover(false);});
  el("nearby-start").onclick=async()=>{
    try{const data=await desktop.invoke("nearby_start",{ip:el("nearby-ip").value});
      invitation=data.link;drawCode(data.qr);el("nearby-invitation").hidden=false;el("nearby-stop").hidden=false;
      el("nearby-start").textContent="Hiện mã ghép đôi";announce("Đang nhận qua LAN tại "+data.address);
    }catch(e){failure(e);}
  };
  async function stop() {
    await desktop.invoke("nearby_stop");invitation="";approval="";
    for(const id of ["nearby-invitation","nearby-confirm","nearby-stop","nearby-progress"])el(id).hidden=true;
    el("nearby-start").textContent="Bật nhận nhạc";announce("Đã dừng nhận.");
  }
  el("nearby-stop").onclick=()=>stop().catch(failure);
  el("nearby-copy").onclick=()=>navigator.clipboard.writeText(invitation).then(()=>announce("Đã sao chép mã.")).catch(failure);
  for(const [id,accept] of [["nearby-accept",true],["nearby-deny",false]])el(id).onclick=async()=>{
    try{await desktop.invoke("nearby_decide",{id:approval,accept});}catch(e){failure(e);}
    approval="";el("nearby-confirm").hidden=true;
  };
  el("nearby-forget").onclick=async()=>{
    try{if(native){queue=[];native.nearbyForget();}else{await stop();await desktop.invoke("nearby_forget");announce("Đã xóa ghép đôi trên PC.");}}catch(e){failure(e);}
  };
  el("nearby-scan").onclick=()=>native.nearbyScan();
  el("nearby-pair").onclick=()=>{const box=el("nearby-code");native.nearbyPair(box.value.trim());box.value="";};
  el("nearby-send").onclick=()=>enqueue(Array.from(el("nearby-tracks").selectedOptions,o=>o.value));
  el("nearby-cancel").onclick=()=>{queue=[];native.nearbyCancel();};
  if(!native)return;
  let press=null;
  const list=el("list");
  function clearPress(){if(press)clearTimeout(press.timer);press=null;drop.hidden=true;drop.classList.remove("over");}
  list.addEventListener("pointerdown",e=>{
    const row=e.target.closest(".track-drag")?.closest("[data-track-id]");if(!row || !target)return;
    clearPress();const p={id:row.dataset.trackId,x:e.clientX,y:e.clientY,pointer:e.pointerId,active:false};
    p.timer=setTimeout(()=>{if(press!==p)return;p.active=true;drop.hidden=false;
      list.setPointerCapture(p.pointer);navigator.vibrate?.(30);},360);press=p;
  });
  list.addEventListener("pointermove",e=>{
    if(!press || e.pointerId!==press.pointer)return;
    if(!press.active){if(Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)clearPress();return;}
    e.preventDefault();drop.classList.toggle("over",drop.contains(document.elementFromPoint(e.clientX,e.clientY)));
  });
  list.addEventListener("pointerup",e=>{
    if(press?.active){suppressClick=true;const at=document.elementFromPoint(e.clientX,e.clientY);if(drop.contains(at))enqueue([press.id]);setTimeout(()=>suppressClick=false,250);}
    clearPress();
  });
  list.addEventListener("pointercancel",clearPress);
  list.addEventListener("click",e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
})();
