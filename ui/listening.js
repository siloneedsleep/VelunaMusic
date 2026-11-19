"use strict";

function parseLyrics(text) {
  const lines=[], offset=Number(text.match(/^\[offset:([+-]?\d+)\]/im)?.[1] || 0)/1000;
  for(const line of text.replace(/^\uFEFF/,"").split(/\r?\n/)) {
    const pattern=/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
    const times=Array.from(line.matchAll(pattern));
    if(!times.length)continue;
    const words=line.replace(pattern,"").trim();
    for(const t of times)lines.push({time:Math.max(0,60*Number(t[1])+Number(t[2])+Number("0."+(t[3] || 0))-offset),words});
  }
  if(lines.length)return lines.sort((a,b)=>a.time-b.time);
  return text.trim().split(/\r?\n/).map(words=>({time:null,words}));
}

(() => {
  const repeat=el("repeat-mode"), minutes=el("sleep-minutes"), lyrics=el("lyrics-lines");
  const panel=lyrics.closest("details");
  let timer=0, shown=null, entries=[], highlighted=-1, mediaTrack=null;
  repeat.value=localStorage.getItem("repeat-mode") || "off";
  repeat.onchange=()=>{
    localStorage.setItem("repeat-mode",repeat.value);
    if(native)native.repeat({off:0,one:1,all:2}[repeat.value]);
    window.velunaDJ?.stopFade();window.velunaDJ?.prepare();
  };
  el("shuffle-queue").onclick=()=>{
    const order=playOrder().slice(), start=order.indexOf(selected);
    if(start>=0)order.splice(start,1);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    if(start>=0)order.unshift(selected);
    albumQueue=order;if(native)native.reorderQueue(JSON.stringify(order));else savePosition();
    window.velunaDJ?.stopFade();window.velunaDJ?.prepare();msg("Đã trộn hàng chờ.");
  };
  function planSleep(deadline,changed) {
    clearTimeout(timer);
    if(changed && native)native.sleepUntil(deadline);
    if(!deadline || deadline<=Date.now()){
      if(deadline && !native)audio.pause();
      localStorage.removeItem("sleep-until");minutes.value="0";el("sleep-status").textContent="";return;
    }
    localStorage.setItem("sleep-until",String(deadline));
    el("sleep-status").textContent="Tạm dừng lúc "+new Date(deadline).toLocaleTimeString("vi",{hour:"2-digit",minute:"2-digit"});
    timer=setTimeout(()=>planSleep(deadline,false),Math.max(1,deadline-Date.now()));
  }
  minutes.onchange=()=>{const n=Number(minutes.value);planSleep(n?Date.now()+60000*n:0,true);};
  const saved=Number(localStorage.getItem("sleep-until")) || 0;
  if(saved>Date.now()){
    const remaining=Math.ceil((saved-Date.now())/60000);
    minutes.value=String([5,15,30,45,60].find(m=>m>=remaining)||60);
  }
  planSleep(saved,false);
  function render() {
    if(!panel.open || shown===selected)return;
    shown=selected;highlighted=-1;lyrics.replaceChildren();
    const raw=selected && localStorage.getItem("lyrics/"+selected);
    entries=raw?parseLyrics(raw):[];
    const fragment=document.createDocumentFragment();
    for(const entry of entries){const line=document.createElement("p");line.textContent=entry.words;fragment.append(line);}
    lyrics.append(fragment);
  }
  function progress(time){
    if(document.hidden || !panel.open)return;
    render();if(!entries.length || entries[0].time===null)return;
    let low=0,high=entries.length;
    while(low<high){const mid=(low+high)>>>1;if(entries[mid].time<=time)low=mid+1;else high=mid;}
    const index=low-1;if(index===highlighted)return;
    lyrics.children[highlighted]?.removeAttribute("aria-current");highlighted=index;
    const line=lyrics.children[index];if(line){line.setAttribute("aria-current","true");lyrics.scrollTop=line.offsetTop-lyrics.offsetTop-lyrics.clientHeight/3;}
  }
  panel.addEventListener("toggle",()=>{render();progress(Number(el("seek").value));});
  el("lyrics-file").onchange=async e=>{
    const file=e.target.files[0],id=selected;e.target.value="";
    if(!file || !id){msg("Chọn bài hát trước khi nhập lời.");return;}
    try{if(file.size>256*1024)throw Error("File lời vượt quá 256 KiB.");
      const raw=await file.text();if(raw.includes("\u0000"))throw Error("Chọn file văn bản UTF-8 hoặc LRC.");
      localStorage.setItem("lyrics/"+id,raw);shown=null;render();progress(Number(el("seek").value));
    }catch(err){msg(err.message);}
  };
  el("lyrics-clear").onclick=()=>{if(selected)localStorage.removeItem("lyrics/"+selected);shown=null;render();};
  const media=!native && navigator.mediaSession;
  el("source-info").onclick=async()=>{
    const id=selected, output=el("source-info-result");
    if(!id){output.textContent="Chọn một file nhạc trước.";return;}
    output.textContent="Đang đọc thông số…";
    try{const v=await window.velunaDJ.measure(id);if(selected!==id){output.textContent="";return;}
      const info=[v.codec?.toUpperCase(),v.sample_rate && (v.sample_rate/1000)+" kHz",v.bit_depth && v.bit_depth+" bit",
        v.channels && v.channels+" kênh",v.average_file_kbps && "TB toàn file ≈ "+v.average_file_kbps+" kb/s"].filter(Boolean);
      output.textContent=info.join(" · ") || "Chưa xác định được thông số.";
    }catch{output.textContent="Không đọc được thông số file.";}
  };
  if(desktop){
    el("window-tools").hidden=false;
    el("mini-player").onclick=async()=>{try{
      const compact=await desktop.invoke("compact_player");document.body.dataset.mini=String(compact);
      el("mini-player").textContent=compact?"Mở rộng":"Thu gọn";
    }catch(error){msg(String(error));}};
    el("tray-player").onclick=()=>desktop.invoke("hide_to_tray").catch(e=>msg(String(e)));
  }
  if(media) {
    const actions={play:()=>selected?audio.play().catch(e=>msg(e.message)):el("play").click(),
      pause:()=>audio.pause(),nexttrack:()=>skip(1),previoustrack:()=>skip(-1),
      seekto:event=>{if(Number.isFinite(event.seekTime) && Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,Math.max(0,event.seekTime));}};
    for(const [action,handler] of Object.entries(actions)){try{media.setActionHandler(action,handler);}catch{}}
  }
  window.velunaListening={progress(time,playing){
    progress(time);
    if(media && selected){
      media.playbackState=playing?"playing":"paused";
      if(mediaTrack!==selected){mediaTrack=selected;const title=tracks.find(t=>t.id===selected)?.title || "VelunaMusic";
        if(window.MediaMetadata)media.metadata=new MediaMetadata({title,artwork:[{src:new URL("icon.png",location.href).href,type:"image/png"}]});}
    }
  }};
})();
