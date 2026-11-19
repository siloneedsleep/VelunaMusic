"use strict";
const pendingNativeCalls = new Map();
window.onVelunaTransferReply = (ticket, result, error) => {
  const cb = pendingNativeCalls.get(ticket);
  if (cb) cb(result, error);
};
function nativeTransfer(method, ...args) {
  return new Promise((resolve, reject) => {
    const ticket = crypto.randomUUID();
    const timeout = setTimeout(() => finish(null, "Thiết bị phản hồi quá chậm."), 60000);
    function finish(result, error) {
      clearTimeout(timeout); pendingNativeCalls.delete(ticket);
      if (error) reject(Error(error)); else resolve(result);
    }
    pendingNativeCalls.set(ticket, finish);
    try { native[method](ticket, ...args); } catch (e) { finish(null, e.message); }
  });
}
async function inspectTrack(id) {
  if (native) return nativeTransfer("inspectTrack", id);
  const online=/^ytmusic:\/\/[\w-]{11}$/.test(id);
  const src=online ? (await window.velunaYtm.stream(id)).url : desktop.convertFileSrc(id);
  const probe=new Audio();
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Không thể xác nhận khả năng tua bài.")),15000);
      const finish=(ok)=>{clearTimeout(timer);ok?resolve():reject(Error("Nguồn phát chưa sẵn sàng."));};
      probe.oncanplay=()=>{if(Number.isFinite(probe.duration) && probe.duration>0 && probe.seekable.length)finish(true);};
      probe.onprogress=probe.oncanplay;
      probe.onerror=()=>finish(false);probe.preload="auto";probe.src=src;
    });
    return online?id:await desktop.invoke("track_digest",{id});
  } finally {probe.oncanplay=probe.onprogress=probe.onerror=null;probe.removeAttribute("src");probe.load();}
}
function accountHandoff({request, deviceId, tell, active, user=()=>""}) {
  const panel = el("transfer"), choices = el("transfer-track"), accept = el("accept-transfer");
  let source = null, target = null, offer = null, timer = 0, polling = false, epoch = 0;

  const nativeOwner=()=>typeof native!=="undefined" && native?.handoffOrigin && el("remote-listen").checked;
  const journal=()=>"handoff/"+user()+"/"+deviceId();
  let restored="",autoChecked="";
  function persist(){if(user() && typeof localStorage!=="undefined")localStorage.setItem(journal(),JSON.stringify({source,target}));}
  function restore(){
    if(!user() || restored===journal() || typeof localStorage==="undefined")return;
    restored=journal();
    try{const state=JSON.parse(localStorage.getItem(restored));source=state?.source || null;target=state?.target || null;}catch{}
  }
  function clear() {
    if(restored && typeof localStorage!=="undefined")localStorage.removeItem(restored);restored=autoChecked="";
    ++epoch; clearTimeout(timer); source = target = offer = null; panel.hidden = true;
  }
  function advance(id, phase, playback = {}) {
    return request("/rest/v1/rpc/veluna_advance", "POST", {
      p_id:id, p_device:deviceId(), p_phase:phase,
      p_position:Math.max(0,Math.round((playback.time || 0)*1000)), p_playing:!!playback.playing
    });
  }
  function schedule(ms = 2500) {
    clearTimeout(timer);
    if(active() && (source || target || (!document.hidden && el("account-dialog").open)))timer=setTimeout(()=>poll(!!(source||target)),ms);
  }
  function renderOffer(row) {
    if (offer?.transfer_id === row.transfer_id && !panel.hidden) return;
    offer = row; panel.hidden = false; el("transfer-title").textContent = row.title;
    choices.replaceChildren();
    if(/^ytmusic:\/\/[\w-]{11}$/.test(row.digest)){
      choices.add(new Option(row.title,row.digest));choices.value=row.digest;accept.disabled=false;
      tell("Xác nhận nguồn nhạc trên thiết bị này.");return;
    }
    const strip = title => title.toLowerCase().replace(/\.[a-z0-9]{1,5}$/,"");
    for (const track of tracks) {
      const option = new Option(track.title,track.id);
      choices.add(option);
      if (strip(row.title) === strip(track.title)) choices.value = track.id;
    }
    accept.disabled = !tracks.length;
    tell(tracks.length ? "Chọn bản nhạc tương ứng để nhận phiên." : "Thêm file này vào thư viện rồi mở lại mục Tài khoản.");
  }
  accept.onclick = async () => {
    if (!offer || !choices.value) return;
    const row = offer, id = choices.value, turn = epoch;
    accept.disabled = true;
    try {
      if(/^ytmusic:\/\/[\w-]{11}$/.test(id) && !tracks.some(t=>t.id===id)){
        await window.velunaYtm.playTracks([{id,title:row.title}],0,false);
      }
      const digest = await inspectTrack(id);
      if (turn !== epoch || offer !== row) return;
      if (digest !== row.digest) throw Error("Nội dung hai file khác nhau. Máy gửi vẫn phát.");
      target = {transfer:row.transfer_id, id, started:false};persist();
      await advance(row.transfer_id,"ready"); panel.hidden = true;
      tell("Đã kiểm tra file. Đang chờ vị trí phát từ máy gửi."); schedule(300);
    } catch (e) { tell(e.message); }
    finally { accept.disabled = false; }
  };
  el("decline-transfer").onclick = async () => {
    if (!offer) return;
    try { await advance(offer.transfer_id,"cancelled"); panel.hidden = true; offer = null; }
    catch (e) { tell(e.message); }
  };
  async function send(to) {
    restore();
    const item = tracks.find(t => t.id === selected);
    if (!item) throw Error("Chọn một bài hát trước khi chuyển thiết bị.");
    if (source || target) throw Error("Đang chuyển một phiên khác.");
    const turn = epoch;
    const digest = await inspectTrack(item.id);
    if (turn !== epoch || selected !== item.id) throw Error("Bài hoặc tài khoản đã đổi.");
    const id = crypto.randomUUID();
    if(nativeOwner())native.handoffOrigin(user(),id,item.id);
    await request("/rest/v1/rpc/veluna_offer","POST",{
      p_id:id,p_source:deviceId(),p_target:to,p_digest:digest,p_title:item.title.slice(0,512)
    });
    source = {transfer:id,id:item.id,snapshot:null};persist();
    tell("Mở Tài khoản trên máy nhận và chọn file để tiếp tục."); schedule(250);
  }
  async function poll(wake=false) {
    if (polling || !active() || (document.hidden && !wake)) return;
    const turn = epoch;
    polling = true;
    try {
      restore();
      const rows = await request("/rest/v1/veluna_handoff?select=*");
      if (turn !== epoch) return;
      const row = rows[0], me = deviceId();
      if(nativeOwner()){
        source=target=offer=null;persist();panel.hidden=true;
        if(row)tell(({received:"Đã nhận phiên nghe.",cancelled:"Đã hủy chuyển phiên."})[row.phase] || "Dịch vụ phát nhạc đang chuyển phiên.");
        return;
      }
      if (!row || row.phase === "cancelled" || row.phase === "received" || Date.parse(row.expires_at) < Date.now()) {
        if((row?.phase==="cancelled" || (row?.phase==="ready" && Date.parse(row.expires_at)<Date.now())) && source?.transfer===row.transfer_id && source?.snapshot?.playing && source.id===selected){
          await startTransferredTrack(source.id,true,source.snapshot.time);
        }
        if (source || target || offer) tell(row?.phase === "received" ? "Đã chuyển phiên nghe." : "Phiên chuyển đã đóng.");
        source = target = offer = null; persist();panel.hidden = true; return;
      }
      if (row.source_device === me && row.phase === "ready" && source?.transfer === row.transfer_id) {
        if (source.id !== selected) { await advance(row.transfer_id,"cancelled"); tell("Bài đã đổi, đã hủy chuyển."); return; }
        if (!source.snapshot) {
          if (native) source.snapshot = await nativeTransfer("pauseForTransfer",source.id);
          else { source.snapshot = {time:audio.currentTime,playing:!audio.paused}; audio.pause(); }
        }
        persist();await advance(row.transfer_id,"released",source.snapshot);
        tell("Đã gửi vị trí phát. Đang chờ máy nhận.");
      } else if (row.target_device === me && row.phase === "offered") {
        if(target?.transfer===row.transfer_id){await advance(row.transfer_id,"ready");return;}
        renderOffer(row);
        if(!native && el("remote-listen").checked && autoChecked!==row.transfer_id){
          autoChecked=row.transfer_id;
          const remembered=localStorage.getItem("veluna-file/"+row.digest);
          const sameTitle=tracks.filter(t=>t.title===row.title);
          const candidate=/^ytmusic:\/\/[\w-]{11}$/.test(row.digest)?row.digest:
            tracks.some(t=>t.id===remembered)?remembered:sameTitle.length===1?sameTitle[0].id:"";
          if(candidate){choices.value=candidate;await accept.onclick();}
        }
      } else if (row.target_device === me && row.phase === "released" && target?.transfer === row.transfer_id) {
        if (!target.started) {
          try{await startTransferredTrack(target.id,row.playing,row.position_ms / 1000);}
          catch(e){await advance(row.transfer_id,"cancelled");throw e;}
          target.started = true;persist();
        }
        await advance(row.transfer_id,"received"); panel.hidden = true; tell("Đã nhận phiên nghe.");
      }
    } catch (e) { if (turn === epoch) tell(e.message || String(e)); }
    finally { polling = false; schedule(source || target ? 1750 : 9000); }
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);schedule(150);
  });
  return {wake:()=>poll(true),open() { schedule(50); }, close() { if (!source && !target) clearTimeout(timer); }, clear, send};
}
async function startTransferredTrack(id, play, time) {
  if (!tracks.some(item => item.id === id)) throw Error("File đã rời khỏi thư viện.");
  if (native) {
    await new Promise((resolve, reject) => {
      let handle;
      const cleanup = () => {clearTimeout(handle);window.removeEventListener("veluna-player", state);};
      function state(e) {
        if (e.detail.id !== id || !e.detail.ready || (play && !e.detail.playing)) return;
        cleanup(); resolve();
      }
      window.addEventListener("veluna-player",state);
      handle = setTimeout(() => {cleanup(); reject(Error("Trình phát Android chưa xác nhận phát."));},12000);
      loadTrack(id,play,time);
    });
  } else {
    await new Promise((resolve,reject) => {
      const cleanup = () => { clearTimeout(timer); audio.removeEventListener("loadedmetadata",ready); audio.removeEventListener("error",fail); };
      const fail = () => {cleanup();reject(Error("Không đọc được bài trên máy nhận."));};
      const ready = () => {cleanup();resolve();};
      const timer = setTimeout(fail,12000);
      audio.addEventListener("loadedmetadata",ready); audio.addEventListener("error",fail);
      loadTrack(id,false,time,false).catch(fail);
    });
    if (play) await audio.play();
  }
}
