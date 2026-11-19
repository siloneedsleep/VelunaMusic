"use strict";

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
    albumQueue=order;if(native)native.reorderQueue(JSON.stringify(order));else savePosition();drawList();
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
  const dialog=el("lyrics-dialog"), reader=el("lyrics-reader");
  let activeWord=-1, delay=0, wake=0, clockTime=0, clockAt=0, advancing=false;
  function visible(){return !document.hidden && (panel.open || dialog.open);}
  function currentTime(){return clockTime+(advancing ? (performance.now()-clockAt)/1000 : 0);}
  function setOffset(value,save) {
    delay=Math.max(-30000,Math.min(30000,Number(value) || 0));
    el("lyrics-offset").textContent=(delay>0?"+":"")+delay+" ms";
    if(save && selected){try{localStorage.setItem("lyrics-offset/"+selected,String(delay));}catch{msg("Không lưu được độ trễ của lời.");}}
  }
  function render() {
    if(!visible() || shown===selected)return;
    shown=selected;highlighted=activeWord=-1;lyrics.replaceChildren();
    const raw=selected && localStorage.getItem("lyrics/"+selected);
    if(selected && String(selected).startsWith("ytmusic://") && !raw) window.velunaYtm?.ensureLyrics?.(selected);
    entries=raw?parseLyrics(raw):[];
    setOffset(selected && localStorage.getItem("lyrics-offset/"+selected),false);
    const fragment=document.createDocumentFragment();
    for(const entry of entries){
      const line=document.createElement("p");
      if(entry.time===null)line.textContent=entry.words;
      else{
        const jump=document.createElement("button");jump.type="button";jump.className="lyric-line";
        if(entry.parts.length)for(const part of entry.parts){const word=document.createElement("span");word.textContent=part.text;jump.append(word);}
        else jump.textContent=entry.words;
        jump.onclick=()=>seekTo(Math.max(0,entry.time+delay/1000));line.append(jump);
      }
      fragment.append(line);
    }
    if(!entries.length){const empty=document.createElement("p");empty.textContent=selected?"Chọn file .lrc hoặc .txt để thêm lời cho bài này.":"Chọn một bài để xem lời.";fragment.append(empty);}
    lyrics.append(fragment);el("lyrics-title").textContent=el("title").textContent;
  }
  function progress(time) {
    clearTimeout(wake);
    if(!visible())return;
    render();if(!entries.length || entries[0].time===null)return;
    const adjusted=time-delay/1000, index=lyricAt(entries,adjusted);
    const reduced=window.velunaTheme?.isMotionReduced?.() || document.body?.dataset?.motion==="off";
    if(index!==highlighted){
      const old=lyrics.children[highlighted];
      old?.removeAttribute("aria-current");
      old?.querySelectorAll(".sung,.sung-past").forEach(n=>{n.classList.remove("sung","sung-past");n.style.removeProperty("--word-fill");});
      highlighted=index;activeWord=-1;
      const line=lyrics.children[index];
      if(line){
        line.setAttribute("aria-current","true");
        const top=Math.max(0,line.offsetTop-(lyrics.clientHeight-line.offsetHeight)/2);
        if(typeof lyrics.scrollTo==="function")lyrics.scrollTo({top,behavior:reduced?"auto":"smooth"});
        else lyrics.scrollTop=top;
      }
    }
    const entry=entries[index], parts=entry?.parts || [];
    const wordSynced=typeof hasWordTiming==="function"?hasWordTiming(entries):parts.length>0;
    const spans=lyrics.children[index]?.firstElementChild?.children;
    if(wordSynced && spans && parts.length){
      const wp=typeof wordProgress==="function"?wordProgress(entry,adjusted):{index:entry?.end!=null && adjusted>=entry.end?-1:lyricAt(parts,adjusted),ratio:1};
      const word=wp.index;
      if(word!==activeWord){
        for(let k=0;k<spans.length;k++){
          spans[k].classList.toggle("sung-past",word>=0 && k<word);
          spans[k].classList.toggle("sung",k===word);
          if(k!==word)spans[k].style.removeProperty("--word-fill");
        }
        activeWord=word;
      }
      if(word>=0 && spans[word]) spans[word].style.setProperty("--word-fill",Math.round(wp.ratio*100)+"%");
      if(advancing && !document.hidden){
        const next=[entries[index+1]?.time,parts[word+1]?.time,entry?.end].filter(t=>t!=null && t>adjusted);
        const stepMs=next.length?Math.max(32,Math.min(180,Math.ceil((Math.min(...next)-adjusted)*1000))):180;
        if(next.length)wake=setTimeout(()=>progress(currentTime()),stepMs);
      }
    }else if(advancing && !document.hidden){
      const nextTime=entries[index+1]?.time;
      if(nextTime!=null && nextTime>adjusted)wake=setTimeout(()=>progress(currentTime()),Math.max(40,Math.ceil((nextTime-adjusted)*1000)));
    }
  }
  function updateOffset(delta){setOffset(delta===null?0:delay+delta,true);progress(currentTime());}
  el("lyrics-earlier").onclick=()=>updateOffset(-100);el("lyrics-later").onclick=()=>updateOffset(100);
  el("lyrics-reset").onclick=()=>updateOffset(null);
  function expand(){if(dialog.open)return;dialog.append(reader);el("lyrics-expand").hidden=true;dialog.showModal();render();progress(currentTime());}
  el("open-lyrics").onclick=()=>{if(!selected || !localStorage.getItem("lyrics/"+selected)){panel.open=true;el("lyrics-file").focus();}else expand();};
  el("lyrics-expand").onclick=expand;el("lyrics-close").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>{panel.append(reader);el("lyrics-expand").hidden=false;progress(currentTime());});
  panel.addEventListener("toggle",()=>progress(currentTime()));
  document.addEventListener("visibilitychange",()=>progress(currentTime()));
  window.addEventListener("veluna-library",()=>{if(shown!==selected && visible()){render();progress(Number(el("seek").value));}});
  el("lyrics-file").onchange=async e=>{
    const file=e.target.files[0],id=selected;e.target.value="";
    if(!file || !id){msg("Chọn bài hát trước khi nhập lời.");return;}
    try{if(file.size>256*1024)throw Error("File lời vượt quá 256 KiB.");
      const raw=await file.text();if(raw.includes("\u0000"))throw Error("Chọn file văn bản UTF-8 hoặc LRC.");
      if(!parseLyrics(raw,true).length)throw Error("File lời đang trống.");
      localStorage.setItem("lyrics/"+id,raw);shown=null;render();progress(currentTime());
    }catch(err){msg(err.message);}
  };
  el("lyrics-clear").onclick=()=>{if(selected){localStorage.removeItem("lyrics/"+selected);localStorage.removeItem("lyrics-offset/"+selected);}shown=null;render();progress(currentTime());};
  const media=!native && navigator.mediaSession;
  el("source-info").onclick=async()=>{
    const id=selected, output=el("source-info-result");
    if(!id){output.textContent="Chọn một file nhạc trước.";return;}
    output.textContent="Đang đọc thông số…";
    try{
      const v=String(id).startsWith("ytmusic://") && !native && window.velunaYtm?.stream
        ? await window.velunaYtm.stream(id,false)
        : await window.velunaDJ.measure(id);
      if(selected!==id){output.textContent="";return;}
      const isYtm=v.source==="ytmusic" || String(id).startsWith("ytmusic://");
      const kbps=v.average_file_kbps || v.bitrate_kbps || (v.bitrate ? Math.round(Number(v.bitrate)/1000) : 0);
      const expText=v.expires_at ? "Hết hạn " + new Date(Number(v.expires_at)*1000).toLocaleTimeString("vi",{hour:"2-digit",minute:"2-digit"}) : "";
      const info=[isYtm && "YouTube Music",v.codec?.toUpperCase(),v.sample_rate && (v.sample_rate/1000)+" kHz",v.bit_depth && v.bit_depth+" bit",
        v.channels && v.channels+" kênh",kbps && (isYtm ? kbps+" kb/s" : "TB toàn file ≈ "+kbps+" kb/s"),expText].filter(Boolean);
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
    clockAt=performance.now();clockTime=Number(time)||0;advancing=!!playing;progress(clockTime);
    if(media && selected){
      media.playbackState=playing?"playing":"paused";
      if(mediaTrack!==selected){mediaTrack=selected;const title=tracks.find(t=>t.id===selected)?.title || "VelunaMusic";
        if(window.MediaMetadata)media.metadata=new MediaMetadata({title,artwork:[{src:new URL("icon.png",location.href).href,type:"image/png"}]});}
    }
  },reloadLyrics(){shown=null;if(visible()){render();progress(currentTime());}}};
})();
