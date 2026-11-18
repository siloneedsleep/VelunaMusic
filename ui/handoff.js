"use strict";
const pendingNativeCalls = new Map();
window.onVelunaTransferReply = (ticket, result, error) => {
  const cb = pendingNativeCalls.get(ticket);
  if (cb) cb(result, error);
};
function nativeTransfer(method, id) {
  return new Promise((resolve, reject) => {
    const ticket = crypto.randomUUID();
    const timeout = setTimeout(() => finish(null, "Thiết bị phản hồi quá chậm."), 60000);
    function finish(result, error) {
      clearTimeout(timeout); pendingNativeCalls.delete(ticket);
      if (error) reject(Error(error)); else resolve(result);
    }
    pendingNativeCalls.set(ticket, finish);
    try { native[method](ticket, id); } catch (e) { finish(null, e.message); }
  });
}
async function inspectTrack(id) {
  if (native) return nativeTransfer("inspectTrack", id);
  const probe = new Audio();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Đọc file quá lâu.")), 10000);
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        if (Number.isFinite(probe.duration) && probe.duration > 0) resolve();
        else reject(Error("File thiếu thời lượng."));
      };
      probe.onerror = () => { clearTimeout(timer); reject(Error("Không mở được file ở thiết bị này.")); };
      probe.preload = "metadata"; probe.src = desktop.convertFileSrc(id);
    });
    return await desktop.invoke("track_digest", {id});
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute("src"); probe.load(); }
}
function accountHandoff({request, deviceId, tell, active}) {
  const panel = el("transfer"), choices = el("transfer-track"), accept = el("accept-transfer");
  let source = null, target = null, offer = null, timer = 0, polling = false, epoch = 0;

  function clear() {
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
    if (!document.hidden && active() && (source || target || el("account-dialog").open)) timer = setTimeout(poll, ms);
  }
  function renderOffer(row) {
    if (offer?.transfer_id === row.transfer_id && !panel.hidden) return;
    offer = row; panel.hidden = false; el("transfer-title").textContent = row.title;
    choices.replaceChildren();
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
      const digest = await inspectTrack(id);
      if (turn !== epoch || offer !== row) return;
      if (digest !== row.digest) throw Error("Nội dung hai file khác nhau. Máy gửi vẫn phát.");
      target = {transfer:row.transfer_id, id, started:false};
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
    const item = tracks.find(t => t.id === selected);
    if (!item) throw Error("Chọn một bài hát trước khi chuyển thiết bị.");
    if (source || target) throw Error("Đang chuyển một phiên khác.");
    const turn = epoch;
    const digest = await inspectTrack(item.id);
    if (turn !== epoch || selected !== item.id) throw Error("Bài hoặc tài khoản đã đổi.");
    const id = crypto.randomUUID();
    await request("/rest/v1/rpc/veluna_offer","POST",{
      p_id:id,p_source:deviceId(),p_target:to,p_digest:digest,p_title:item.title.slice(0,512)
    });
    source = {transfer:id,id:item.id,snapshot:null};
    tell("Mở Tài khoản trên máy nhận và chọn file để tiếp tục."); schedule(250);
  }
  async function poll() {
    if (polling || !active() || document.hidden) return;
    const turn = epoch;
    polling = true;
    try {
      const rows = await request("/rest/v1/veluna_handoff?select=*");
      if (turn !== epoch) return;
      const row = rows[0], me = deviceId();
      if (!row || row.phase === "cancelled" || row.phase === "received" || Date.parse(row.expires_at) < Date.now()) {
        if (source || target || offer) tell(row?.phase === "received" ? "Đã chuyển phiên nghe." : "Phiên chuyển đã đóng.");
        source = target = offer = null; panel.hidden = true; return;
      }
      if (row.source_device === me && row.phase === "ready" && source?.transfer === row.transfer_id) {
        if (source.id !== selected) { await advance(row.transfer_id,"cancelled"); tell("Bài đã đổi, đã hủy chuyển."); return; }
        if (!source.snapshot) {
          if (native) source.snapshot = await nativeTransfer("pauseForTransfer",source.id);
          else { source.snapshot = {time:audio.currentTime,playing:!audio.paused}; audio.pause(); }
        }
        await advance(row.transfer_id,"released",source.snapshot);
        tell("Đã gửi vị trí phát. Đang chờ máy nhận.");
      } else if (row.target_device === me && row.phase === "offered" && !target) {
        renderOffer(row);
      } else if (row.target_device === me && row.phase === "released" && target?.transfer === row.transfer_id) {
        if (!target.started) {
          await startTransferredTrack(target.id,row.playing,row.position_ms / 1000);
          target.started = true;
        }
        await advance(row.transfer_id,"received"); panel.hidden = true; tell("Đã nhận phiên nghe.");
      }
    } catch (e) { if (turn === epoch) tell(e.message || String(e)); }
    finally { polling = false; schedule(source || target ? 1750 : 9000); }
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer); if (!document.hidden) schedule(150);
  });
  return {open() { schedule(50); }, close() { if (!source && !target) clearTimeout(timer); }, clear, send};
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
      loadTrack(id,false,time);
    });
    if (play) await audio.play();
  }
}
