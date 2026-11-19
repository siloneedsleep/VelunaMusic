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
    row.dataset.trackId=track.id; row.onclick=() => loadTrack(track.id, true);
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
        button.onclick=()=>{const next=order.slice();[next[index],next[target]]=[next[target],next[index]];
          albumQueue=next;if(native)native.reorderQueue(JSON.stringify(next));else savePosition();
          window.velunaDJ?.stopFade();window.velunaDJ?.prepare();drawList();
          const rows=Array.from(el("list").querySelectorAll(".row"));rows.find(r=>r.dataset.trackId===track.id)?.focus();};
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
function draw() {
  el("title").textContent=tracks.find(t => t.id === selected)?.title || "Chọn một bài hát";
  window.velunaLibrary?.refresh(); drawList();
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
  if(playing && !native)window.velunaLibrary?.record(selected);
}
function savePosition() { if (!native && (selected || albumQueue.length)) localStorage.setItem("session", JSON.stringify({id:selected,time:audio.currentTime || 0,queue:albumQueue})); }
function loadTrack(id, play, time=0) {
  if (!tracks.some(t=>t.id===id)) return;
  window.velunaDJ?.stopFade();
  if (albumQueue.length && !albumQueue.includes(id)) albumQueue=[];
  if(play)window.velunaLibrary?.newPlay();
  selected=id; draw(); window.velunaDJ?.prepare();
  if (native) {native.select(id,play,Math.floor(time*1000)); return;}
  if (!desktop) return;
  newSeek=time; audio.src=desktop.convertFileSrc(id); audio.load();
  if (play) audio.play().catch(e=>msg(e.message));
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
el("play").onclick=()=>{if(!selected) {if(tracks[0]) loadTrack(tracks[0].id,true);return;}if(native) native.toggle();else if(audio.paused) audio.play().catch(e=>msg(e.message));else audio.pause();};
function seekTo(time) {
  window.velunaDJ?.stopFade();
  if(native)native.seek(Math.round(time*1000));else if(audio.src)audio.currentTime=time;
}
el("seek").onchange=e=>seekTo(Number(e.target.value));
function bindAudio(player) {
  player.onloadedmetadata=()=>{if(newSeek!==null && Number.isFinite(player.duration))player.currentTime=Math.min(newSeek,player.duration);newSeek=null;};
  player.ontimeupdate=()=>{if(!document.hidden)position(player.currentTime,player.duration,!player.paused);
    else window.velunaDJ?.nearingEnd(player.currentTime,player.duration,!player.paused);window.velunaDJ?.tick();};
  player.onplay=()=>{window.velunaSound?.wake();savePosition();position(player.currentTime,player.duration,true);window.velunaDJ?.prepare();};
  player.onpause=()=>{if(!player.ended)window.velunaDJ?.stopFade();window.velunaSound?.sleep();savePosition();position(player.currentTime,player.duration,false);};
  player.onended=()=>{if(!window.velunaDJ?.finish())skip(1,true);};
  player.onerror=()=>msg("Không đọc được file này. Kiểm tra định dạng và vị trí file.");
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
(async()=>{try{if(native){native.refresh();}else if(desktop){tracks=await desktop.invoke("library");const old=saved();
  if(Array.isArray(old.queue)){const known=new Set(tracks.map(t=>t.id));albumQueue=old.queue.filter(id=>known.has(id));}
  if(old.id)loadTrack(old.id,false,old.time);draw();}if(native || desktop){check();setInterval(()=>{if(!document.hidden)check();},6*3600*1000);}}catch(e){msg(String(e));}})();
