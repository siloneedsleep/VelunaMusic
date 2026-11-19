"use strict";
const el = id => document.getElementById(id);
const native = window.VelunaAndroid;
const desktop = window.__TAURI__?.core;
let audio = el("audio");
let albumQueue = [];
function playOrder() {
  return albumQueue.length ? albumQueue : tracks.map(t=>t.id);
}
let tracks = [], selected = "", pendingUpdate = "", newSeek = null;
const msg = text => { el("message").textContent = text; };
const fmt = s => Number.isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
const saved = () => { try {return JSON.parse(localStorage.getItem("session")) || {};} catch {return {};} };
function drawList() {
  const fragment = document.createDocumentFragment();
  const query = el("query").value.toLocaleLowerCase();
  for (const track of (window.velunaLibrary?.rows(query) ?? tracks.filter(t => t.title.toLocaleLowerCase().includes(query)))) {
    const row = document.createElement("button");
    row.className="row"; row.setAttribute("aria-current", String(track.id === selected));
    row.textContent=track.title; row.setAttribute("aria-label",track.title);
    if(track.subtitle){const detail=document.createElement("small");detail.textContent=track.subtitle;row.append(detail);}
    row.dataset.trackId=track.id;
    if(native) {
      const handle=document.createElement("span");
      handle.className="track-drag";handle.title="Giữ và kéo sang PC";handle.textContent="⠿";
      row.append(handle);
    }
    if(window.velunaLibrary?.queue()){
      const item=document.createElement("div"); item.className="queue-item"; item.append(row);
      const order=playOrder(), index=track.queueIndex;
      for(const [step,text] of [[-1,"↑"],[1,"↓"]]){
        const target=index+step, button=document.createElement("button");
        button.type="button";button.textContent=text;button.disabled=target<0 || target>=order.length;
        button.setAttribute("aria-label",(step<0?"Đưa lên: ":"Đưa xuống: ")+track.title);
        button.dataset.queueIndex=index;button.dataset.queueTarget=target;
        item.append(button);
      }
      fragment.append(item);
    } else fragment.append(row);
  }
  if (!fragment.childNodes.length) {
    const p=document.createElement("p"); p.textContent = tracks.length ? (window.velunaLibrary?.empty() || "Không tìm thấy bài phù hợp.") : "Thêm file nhạc từ thiết bị để bắt đầu nghe."; fragment.append(p);
  }
  el("list").replaceChildren(fragment);
}
el("list").addEventListener("click",e=>{
  const move=e.target.closest("button[data-queue-index]");
  if(move){
    const from=Number(move.dataset.queueIndex),to=Number(move.dataset.queueTarget),next=playOrder().slice();
    if(move.disabled || !next[from] || !next[to])return;
    const id=next[from];[next[from],next[to]]=[next[to],next[from]];
    albumQueue=next;if(native)native.reorderQueue(JSON.stringify(next));else savePosition();
    window.velunaDJ?.stopFade();window.velunaDJ?.prepare();drawList();
    Array.from(el("list").querySelectorAll(".row")).find(row=>row.dataset.trackId===id)?.focus();return;
  }
  const row=e.target.closest("[data-track-id]");if(row)loadTrack(row.dataset.trackId,true);
});
const coverPaletteCache = new Map();
function toHex(r, g, b) {
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function clearCoverPalette() {
  document.body?.style?.removeProperty("--cover-bg-1");
  document.body?.style?.removeProperty("--cover-bg-2");
  document.body?.style?.removeProperty("--cover-accent");
}
function applyCoverPalette(imgEl) {
  if (document.hidden || !window.velunaTheme?.isDynamicCoverEnabled?.() || !imgEl?.src || imgEl.src.endsWith("/icon.png") || !imgEl.complete || !imgEl.naturalWidth) {
    clearCoverPalette();
    return;
  }
  let palette = coverPaletteCache.get(imgEl.src);
  if (!palette) {
    try {
      const c = document.createElement("canvas");
      c.width = 16; c.height = 16;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(imgEl, 0, 0, 16, 16);
      const data = g.getImageData(0, 0, 16, 16).data;
      let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i], gr = data[i + 1], b = data[i + 2];
        const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
        const lum = (max + min) / 510;
        const sat = max === min ? 0 : (max - min) / (max + min);
        const w = 0.35 + sat * 1.6 + (lum > 0.12 && lum < 0.88 ? 0.5 : 0);
        rSum += r * w; gSum += gr * w; bSum += b * w; weightSum += w;
      }
      if (!weightSum) { clearCoverPalette(); return; }
      const avgR = rSum / weightSum, avgG = gSum / weightSum, avgB = bSum / weightSum;
      palette = {
        bg1: toHex(avgR * 0.58 + 14, avgG * 0.58 + 20, avgB * 0.58 + 34),
        bg2: toHex(avgR * 0.32 + 8, avgG * 0.32 + 16, avgB * 0.32 + 30),
        accent: toHex(avgR * 0.85 + 38, avgG * 0.85 + 38, avgB * 0.85 + 42)
      };
      if (coverPaletteCache.size > 40) coverPaletteCache.delete(coverPaletteCache.keys().next().value);
      coverPaletteCache.set(imgEl.src, palette);
    } catch {
      clearCoverPalette();
      return;
    }
  }
  document.body?.style?.setProperty("--cover-bg-1", palette.bg1);
  document.body?.style?.setProperty("--cover-bg-2", palette.bg2);
  document.body?.style?.setProperty("--cover-accent", palette.accent);
}
function canAnimateMotion() {
  return !document.hidden
    && document.body?.dataset?.motion !== "off"
    && !["reduced", "economy"].includes(document.body?.dataset?.intensity)
    && (typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches);
}
function transitionCover(fromEl, toEl, updateFn, focusTarget) {
  for (const node of [el("cover"), el("mini-cover"), ...document.querySelectorAll("[data-vt-hero]")]) {
    if (node) { node.style.viewTransitionName = ""; node.removeAttribute("data-vt-hero"); }
  }
  if (!document.startViewTransition || !canAnimateMotion() || !fromEl || !toEl || fromEl === toEl) {
    updateFn?.();
    focusTarget?.focus?.({ preventScroll: true });
    return Promise.resolve();
  }
  fromEl.style.viewTransitionName = "cover-hero";
  fromEl.setAttribute("data-vt-hero", "1");
  const vt = document.startViewTransition(() => {
    fromEl.style.viewTransitionName = "";
    fromEl.removeAttribute("data-vt-hero");
    updateFn?.();
    toEl.style.viewTransitionName = "cover-hero";
    toEl.setAttribute("data-vt-hero", "1");
  });
  return vt.finished.finally(() => {
    fromEl.style.viewTransitionName = "";
    toEl.style.viewTransitionName = "";
    fromEl.removeAttribute("data-vt-hero");
    toEl.removeAttribute("data-vt-hero");
    focusTarget?.focus?.({ preventScroll: true });
  });
}
window.velunaMotion = { canAnimate: canAnimateMotion, transitionCover, applyCoverPalette, clearCoverPalette };

function sourceBadge(track) {
  return track ? (window.velunaYtm?.sourceBadge(track) || "Thiết bị") : "";
}
function fmtQuality(track) { return window.velunaYtm?.formatQuality(track) || ""; }
function updateNowBadges(track, meta) {
  const merged = { ...(meta || {}), ...(track || {}) };
  const sBadge = el("now-source-badge");
  const qBadge = el("now-quality-badge");
  const sLabel = selected ? sourceBadge(merged) : "";
  const qLabel = selected ? fmtQuality(merged) : "";
  if (sBadge) { sBadge.hidden = !sLabel; sBadge.textContent = sLabel; }
  if (qBadge) { qBadge.hidden = !qLabel; qBadge.textContent = qLabel; }
  const miniBar = el("mini-bar");
  const miniTitle = el("mini-title");
  const miniMeta = el("mini-meta");
  const miniCover = el("mini-cover");
  if (miniBar) miniBar.hidden = !selected;
  if (miniTitle) miniTitle.textContent = merged.title || "Chọn một bài hát";
  if (miniMeta) miniMeta.textContent = [merged.artist || merged.artist_text, sLabel, qLabel].filter(Boolean).join(" · ");
  if (miniCover && el("cover")?.src && miniCover.src !== el("cover").src) miniCover.src = el("cover").src;
}
function draw() {
  const current = tracks.find(t => t.id === selected);
  el("title").textContent = current?.title || "Chọn một bài hát";
  if (String(selected || "").startsWith("ytmusic://")) window.velunaYtm?.ensureLyrics?.(selected);
  window.velunaLibrary?.refresh(); drawList();
  updateNowBadges(current);
  window.dispatchEvent(new Event("veluna-library"));
}
function position(time, duration, playing) {
  window.velunaDJ?.nearingEnd(time,duration,playing);
  window.velunaListening?.progress(time,playing);
  const playback=String(!!playing);
  if(document.body.dataset.playing!==playback){document.body.dataset.playing=playback;window.dispatchEvent(new Event("veluna-playback"));}
  el("seek").max=Number.isFinite(duration) ? duration : 0;
  if (document.activeElement !== el("seek")) el("seek").value = time || 0;
  el("elapsed").textContent=fmt(time); el("duration").textContent=fmt(duration);
  el("play").setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
  if (el("mini-play")) el("mini-play").setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
  if(playing && !native)window.velunaLibrary?.record(selected);
}
function savePosition() { if (!native && (selected || albumQueue.length)) localStorage.setItem("session", JSON.stringify({id:selected,time:audio.currentTime || 0,queue:albumQueue})); }
let selectionGeneration=0, streamRetry=0, playbackIntent=false;
async function loadTrack(id, play, time=0, officialFallback=true) {
  if (!tracks.some(t=>t.id===id)) return;
  const turn=++selectionGeneration;streamRetry=0;playbackIntent=play;
  window.velunaDJ?.stopFade();
  if (albumQueue.length && !albumQueue.includes(id)) albumQueue=[];
  if(play)window.velunaLibrary?.newPlay();
  selected=id; draw(); window.velunaDJ?.prepare();
  if (String(id).startsWith("ytmusic://")) window.velunaYtm?.ensureLyrics?.(id);
  if (native) {native.select(id,play,Math.floor(time*1000)); return;}
  if (String(id).startsWith("ytmusic://") && window.velunaYtm?.stream) {
    audio.pause();
    try {
      const info = await window.velunaYtm.stream(id, false);
      if (turn!==selectionGeneration) return;
      newSeek = time; audio.src = info.url; audio.load();
      if (play) audio.play().catch(e=>msg(e.message));
    } catch (e) {
      if(turn!==selectionGeneration)return;
      msg(e.message || String(e));
      if(play && officialFallback)await desktop.invoke("open_youtube",{id:window.velunaYtm.videoId(id)}).catch(err=>msg(String(err)));
      if(!officialFallback)throw e;
    }
    return;
  }
  if (!desktop) return;
  newSeek=time; audio.src=desktop.convertFileSrc(id); audio.load();
  if (play) audio.play().catch(e=>msg(e.message));
}
function playTrackQueue(ids) {
  if (!ids.length) return;
  if(native && ids.length>1000){msg("Hàng chờ Android hỗ trợ tối đa 1.000 bài.");return;}
  albumQueue=ids.slice();
  if(native)native.playQueue(JSON.stringify(ids));else loadTrack(ids[0],true);
}
function skip(step, ended=false) {
  const order=playOrder(), repeat=el("repeat-mode").value;
  if(ended && repeat==="one" && selected){loadTrack(selected,true);return;}
  let i=order.indexOf(selected)+step;
  if(repeat==="all" && order.length)i=(i+order.length)%order.length;
  if(order[i])loadTrack(order[i],true);
}
window.onVelunaState = state => {
  tracks=state.tracks || []; if(Array.isArray(state.queue))albumQueue=state.queue;
  selected=state.id || ""; draw(); position(state.time,state.duration,state.playing);
  window.velunaDJ?.prepare();
  window.dispatchEvent(new CustomEvent("veluna-player",{detail:state}));
};
window.onVelunaProgress = state => position(state.time, state.duration, state.playing);
window.onVelunaUpdate = (version,error) => {
  el("install").disabled=false;
  if(error) { msg(error); return; }
  if(!version) return;
  pendingUpdate=version; el("version").textContent="VelunaMusic " + version;
  if(!el("upgrade").open) el("upgrade").showModal();
};
window.onVelunaMessage=msg;
async function check(manual=false) {
  try {
    if(native){native.checkUpdate(manual);return;}
    const v=await desktop.invoke("check_update"); if(v) window.onVelunaUpdate(v); else if(manual) msg("Đang dùng bản mới nhất hiện có.");
  } catch(e) {if(manual) msg("Chưa kiểm tra được cập nhật. "+e);}
}
el("install").onclick=async()=>{
  el("install").disabled=true;
  try {if(native) native.installUpdate(pendingUpdate); else await desktop.invoke("install_update",{version:pendingUpdate});}
  catch(e){msg(String(e));el("install").disabled=false;}
};
el("later").onclick=()=>el("upgrade").close();
el("add").onclick=async()=>{if(native){native.pick();return;}el("add").disabled=true;try{tracks=await desktop.invoke("add_music");draw();}catch(e){msg(String(e));}finally{el("add").disabled=false;}};
el("query").oninput=drawList;
el("prev").onclick=()=>skip(-1);el("next").onclick=()=>skip(1);
el("play").onclick=()=>{if(!selected) {if(tracks[0]) loadTrack(tracks[0].id,true);return;}if(native) native.toggle();else if(audio.paused) audio.play().catch(e=>msg(e.message));else {playbackIntent=false;audio.pause();}};
function seekTo(time) {
  window.velunaDJ?.stopFade();
  if(native)native.seek(Math.round(time*1000));else if(audio.src)audio.currentTime=time;
}
el("seek").onchange=e=>seekTo(Number(e.target.value));
function bindAudio(player) {
  player.onloadedmetadata=()=>{if(newSeek!==null && Number.isFinite(player.duration))player.currentTime=Math.min(newSeek,player.duration);newSeek=null;};
  player.ontimeupdate=()=>{if(!document.hidden)position(player.currentTime,player.duration,!player.paused);
    else window.velunaDJ?.nearingEnd(player.currentTime,player.duration,!player.paused);window.velunaDJ?.tick();};
  player.onplay=()=>{playbackIntent=true;window.velunaSound?.wake();savePosition();position(player.currentTime,player.duration,true);window.velunaDJ?.prepare();};
  player.onpause=()=>{if(!player.ended)window.velunaDJ?.stopFade();window.velunaSound?.sleep();savePosition();position(player.currentTime,player.duration,false);};
  player.onended=()=>{if(!window.velunaDJ?.finish())skip(1,true);};
  player.onerror=async()=>{
    if(!native && String(selected).startsWith("ytmusic://") && window.velunaYtm?.refreshStream){
      const retrying=selected,turn=selectionGeneration,time=player.currentTime, resume=playbackIntent;
      if(streamRetry++>=1 || player!==audio){msg("Nguồn phát chưa sẵn sàng.");return;}
      try{
        const info=await window.velunaYtm.refreshStream(retrying);
        if(turn===selectionGeneration && player===audio && info?.url){newSeek=time;player.src=info.url;player.load();if(resume)player.play().catch(e=>msg(e.message));return;}
      }catch{}
    }
    msg("Không đọc được file này. Kiểm tra định dạng và vị trí file.");
  };
}
bindAudio(audio);
document.addEventListener("visibilitychange",()=>{if(document.hidden)savePosition();else if(native)native.refresh();else position(audio.currentTime,audio.duration,!audio.paused);});
window.addEventListener("pagehide",savePosition);
el("settings").onclick=()=>el("prefs").showModal();el("done").onclick=()=>el("prefs").close();
el("check").onclick=()=>{el("prefs").close();check(true);};
const applyColor=c=>{document.body.style.setProperty("--accent",c);el("color").value=c;};
applyColor(localStorage.getItem("color") || "#83d8ff");
el("color").oninput=e=>{applyColor(e.target.value);localStorage.setItem("color",e.target.value);};
function applyBackground(data){document.body.style.backgroundImage=data?'linear-gradient(rgb(6 21 41 / var(--back-shade,60%)),rgb(6 21 41 / var(--back-shade,60%))),url("'+data+'")':"";}
applyBackground(localStorage.getItem("background"));
el("background").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{const bitmap=await createImageBitmap(file);const canvas=document.createElement("canvas");const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const data=canvas.toDataURL("image/jpeg",.78);localStorage.setItem("background",data);applyBackground(data);}catch{msg("Không lưu được ảnh nền.");}
};
el("reset").onclick=()=>{localStorage.removeItem("background");applyBackground("");};
if(el("mini-play"))el("mini-play").onclick=()=>el("play").click();
if(el("mini-next"))el("mini-next").onclick=()=>skip(1);
if(el("mini-expand"))el("mini-expand").onclick=()=>{
  transitionCover(el("mini-cover"),el("cover"),()=>{
    delete document.body.dataset.mini;
    el("collapse-mini")?.setAttribute("aria-pressed","false");
    el("now-playing")?.scrollIntoView?.({behavior:canAnimateMotion()?"smooth":"auto",block:"nearest"});
  },el("title"));
};
if(el("collapse-mini"))el("collapse-mini").onclick=()=>{
  const activeMini=document.body.dataset.mini==="true";
  if(activeMini){
    transitionCover(el("mini-cover"),el("cover"),()=>{
      delete document.body.dataset.mini;
      el("collapse-mini").setAttribute("aria-pressed","false");
    },el("title"));
  }else{
    transitionCover(el("cover"),el("mini-cover"),()=>{
      document.body.dataset.mini="true";
      el("collapse-mini").setAttribute("aria-pressed","true");
    },el("mini-expand"));
  }
};
if(el("mini-bar")){
  const trackTouch=e=>{
    const r=el("mini-bar").getBoundingClientRect();
    if(r.width>0 && r.height>0){
      el("mini-bar").style.setProperty("--touch-x",Math.max(0,Math.min(100,((e.clientX-r.left)/r.width)*100))+"%");
      el("mini-bar").style.setProperty("--touch-y",Math.max(0,Math.min(100,((e.clientY-r.top)/r.height)*100))+"%");
    }
  };
  const bar=el("mini-bar");
  const clearPress=()=>bar.classList.remove("is-pressed");
  bar.addEventListener("pointerdown",e=>{bar.classList.add("is-pressed");trackTouch(e);},{passive:true});
  bar.addEventListener("pointermove",trackTouch,{passive:true});
  bar.addEventListener("pointerup",clearPress,{passive:true});
  bar.addEventListener("pointercancel",clearPress,{passive:true});
  bar.addEventListener("pointerleave",clearPress,{passive:true});
}
el("cover")?.addEventListener("load",()=>{
  if(el("mini-cover") && el("cover").src) el("mini-cover").src=el("cover").src;
  applyCoverPalette(el("cover"));
});
el("dynamic-cover-bg")?.addEventListener("change",()=>applyCoverPalette(el("cover")));
document.addEventListener("DOMContentLoaded",async()=>{try{if(native){native.refresh();}else if(desktop){tracks=await desktop.invoke("library");const old=saved();
  if(Array.isArray(old.queue)){const known=new Set(tracks.map(t=>t.id));albumQueue=old.queue.filter(id=>known.has(id));}
  if(old.id)loadTrack(old.id,false,old.time);draw();}if(native || desktop){check();setInterval(()=>{if(!document.hidden)check();},6*3600*1000);}}catch(e){msg(String(e));}},{once:true});
