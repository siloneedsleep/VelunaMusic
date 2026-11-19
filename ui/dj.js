(() => {
  const endpoints = {
    openai:"https://api.openai.com/v1/chat/completions",
    openrouter:"https://openrouter.ai/api/v1/chat/completions"
  };
  const defaults = {enabled:false,style:"gentle",provider:"local",model:"",limit:10,seconds:0};
  let settings = {...defaults};
  try { Object.assign(settings, JSON.parse(localStorage.getItem("dj-settings") || "{}")); } catch {}
  let pair = "", plan = null, generation = 0, used = 0, fading = null, timer = 0;
  let upcoming = null, preload = null;
  const measurements = new Map();
  const info = text => { el("dj-status").textContent = text; };
  const nextId = () => { const order=playOrder(), i=order.indexOf(selected), repeat=el("repeat-mode").value;
    if(i<0 || repeat==="one")return null;return order[i+1] || (repeat==="all" && order.length>1 ? order[0] : null); };
  function validDuration(value) { return typeof value === "number" && Number.isFinite(value) && value>0; }
  function options(a,b) {
    if (settings.style === "album") return [0];
    const cap = Math.min(12, validDuration(a.duration)?a.duration/3:3, validDuration(b.duration)?b.duration/3:3);
    const bpm = a.outro?.bpm && b.intro?.bpm ? Math.min(a.outro.bpm,b.intro.bpm) : 0;
    const bars = bpm ? 240/bpm : 2;
    const times = settings.style === "party" ? [2*bars,bars,4*bars] : [bars,1,2*bars];
    return [...new Set(times.map(t=>Math.round(Math.min(t,cap)*1000)))];
  }
  async function measure(id) {
    if (!measurements.has(id)) {
      const computation=native?nativeTransfer("analyzeTrack",id):desktop.invoke("analyze_audio",{id});
      measurements.set(id,computation);
      computation.catch(()=>measurements.delete(id));
      if(measurements.size>80) measurements.delete(measurements.keys().next().value);
    }
    return measurements.get(id);
  }
  function setPlan(from,to,ms,method) {
    plan = {from,to,ms}; if(native) native.setMix(settings.enabled && settings.style!=="album",from,to,ms,Number(settings.seconds)||0);
    info(method+" · "+(ms/1000).toFixed(1)+" giây");
  }
  async function prepare() {
    const from=selected, to=nextId();
    const key=JSON.stringify([from,to,settings.style,settings.provider,settings.model,settings.seconds]);
    if (!settings.enabled || !from || !to) {
      if(pair){pair="";plan=null;++generation;}
      return;
    }
    if(key===pair) return;
    pair=key; upcoming=null; const turn=++generation;
    const fresh=()=>turn===generation && pair===key && settings.enabled;
    const manual=Number(settings.seconds) || 0;
    const basic=settings.style==="album"?0:(manual || 2)*1000;
    setPlan(from,to,basic,manual?"Chuyển bài cố định":"AutoMix trên máy");
    if(!basic || manual) return;
    try {
      const [a,b]=await Promise.all([measure(from),measure(to)]);
      if(!fresh() || fading) return;
      const choices=options(a,b);
      setPlan(from,to,choices[0],"AutoMix trên máy");
      const endpoint=endpoints[settings.provider];
      if(!endpoint || !settings.model || used>=settings.limit) return;
      upcoming=async()=>{
        if(!fresh() || fading || used>=settings.limit)return;
        try {
          const secret=await window.velunaVault.read("dj-"+settings.provider);
          if(!secret || !fresh()) return;
          ++used;
          const response=await fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(9000),
            headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
            body:JSON.stringify({model:settings.model,max_tokens:40,messages:[
              {role:"system",content:'Choose one transition for two local music tracks. Respond only with JSON {"option":index} using a zero-based index from the supplied overlap durations. Low confidence means the tempo may be wrong.'},
              {role:"user",content:JSON.stringify({outro:a.outro,intro:b.intro,style:settings.style,overlap_ms:choices})}
            ]})});
          if(!response.ok) throw Error("Nhà cung cấp trả về HTTP "+response.status);
          const body=await response.json();
          const result=JSON.parse(body.choices?.[0]?.message?.content ?? "");
          if(!Number.isInteger(result.option) || result.option<0 || result.option>=choices.length) throw Error("Lựa chọn không hợp lệ");
          if(fresh() && !fading) setPlan(from,to,choices[result.option],"AI DJ");
        } catch(e) { if(fresh()) info("Đang dùng AutoMix trên máy · "+(e.message || String(e))); }
      };
    } catch(e) { if(fresh()) info("Đang dùng AutoMix trên máy · "+(e.message || String(e))); }
  }
  function stopFade() {
    clearInterval(timer);
    if(preload){const held=preload.audio;preload=null;held.removeAttribute("src");held.load();}
    if(!fading) return;
    const {incoming,outgoing,volume}=fading; fading=null;
    window.velunaSound?.detach(incoming);
    incoming.pause(); incoming.removeAttribute("src"); incoming.load(); outgoing.volume=volume;
  }
  function finish() {
    if(!fading || !fading.started) return false;
    const {incoming,outgoing,volume,to}=fading; fading=null; clearInterval(timer);
    outgoing.onended=outgoing.onpause=outgoing.ontimeupdate=outgoing.onplay=outgoing.onerror=outgoing.onloadedmetadata=null;
    window.velunaSound?.detach(outgoing);
    outgoing.pause(); outgoing.removeAttribute("src");outgoing.load();
    audio=incoming; audio.volume=volume; selected=to; bindAudio(audio); draw(); savePosition();
    position(audio.currentTime,audio.duration,!audio.paused); pair=""; prepare(); return true;
  }
  async function tick() {
    if(native || fading || !settings.enabled || !plan?.ms || audio.paused || !Number.isFinite(audio.duration)) return;
    if(selected!==plan.from || nextId()!==plan.to) return;
    const duration=Math.min(plan.ms/1000,audio.duration/3);
    const remaining=audio.duration-audio.currentTime;
    if(remaining>duration || remaining<=0.08)return;
    if(preload?.id!==plan.to){
      if(preload){preload.audio.removeAttribute("src");preload.audio.load();}
      const preview=new Audio();preview.crossOrigin="anonymous";preview.preload="metadata";
      preload={id:plan.to,audio:preview};preview.src=desktop.convertFileSrc(plan.to);
    }
    const incoming=preload.audio, outgoing=audio;
    if(incoming.error){stopFade();plan=null;return;}
    if(!Number.isFinite(incoming.duration) || remaining>incoming.duration/3)return;
    preload=null;window.velunaSound?.attach(incoming);
    const transition={outgoing,incoming,to:plan.to,volume:outgoing.volume,started:false};
    fading=transition; incoming.volume=0;
    try {
      await incoming.play(); if(fading!==transition)return;
      transition.started=true;const start=outgoing.currentTime,span=Math.max(.01,outgoing.duration-start);
      const fadeStep=()=>{
        if(fading!==transition)return;
        const t=Math.min(1,Math.max(0,(outgoing.currentTime-start)/span));
        outgoing.volume=transition.volume*(1-t); incoming.volume=transition.volume*t;
        if(t>=1 || outgoing.ended)finish();
      };
      timer=setInterval(fadeStep,50); fadeStep();
    } catch { if(fading===transition){stopFade();plan=null;} }
  }
  function nearingEnd(time,duration,playing) {
    const remaining=duration-time;
    if(!playing || !upcoming || !Number.isFinite(remaining) || remaining>45 || remaining<3 || fading)return;
    const select=upcoming;upcoming=null;return select();
  }
  window.velunaDJ={prepare,tick,stopFade,finish,nearingEnd,measure};
  window.onVelunaAlbum = ids => {
    if(!ids?.length) return;
    albumQueue=ids; pair=""; el("dj-dialog").close();
    loadTrack(ids[0],true);
  };
  el("dj-folder").onclick=async()=>{
    if(native){native.pickAlbum();return;}
    try {const [all,ids]=await desktop.invoke("pick_album"); tracks=all;draw();if(ids.length)window.onVelunaAlbum(ids);else info("Chưa chọn được bài trong thư mục.");}
    catch(e){info(String(e));}
  };
  el("dj").onclick=()=>{
    el("dj-enabled").checked=settings.enabled;el("dj-style").value=settings.style;
    el("mix-seconds").value=String(settings.seconds || 0);
    el("dj-provider").value=settings.provider;el("dj-model").value=settings.model;el("dj-limit").value=settings.limit;
    el("dj-key").value=""; el("dj-ai").hidden=settings.provider==="local";el("dj-dialog").showModal();window.velunaLibrary?.prepareAlbums();
  };
  el("dj-provider").onchange=e=>{el("dj-ai").hidden=e.target.value==="local";el("dj-key").value="";};
  el("dj-forget").onclick=async()=>{try{await window.velunaVault.write("dj-"+el("dj-provider").value,"");el("dj-key").value="";info("Đã xóa key trên thiết bị.");}catch(e){info(String(e));}};
  async function applySettings(album){
    try {
      const seconds=Number(el("mix-seconds").value) || 0;
      const provider=el("dj-provider").value,model=el("dj-model").value.trim();
      if(!seconds && provider!=="local" && !model) throw Error("Nhập ID model của nhà cung cấp.");
      const key=el("dj-key").value.trim();
      if(provider!=="local" && key) await window.velunaVault.write("dj-"+provider,key);
      if(!seconds && provider!=="local" && !await window.velunaVault.read("dj-"+provider)) throw Error("Nhập API key để bật AI DJ.");
      settings={enabled:el("dj-enabled").checked,style:el("dj-style").value,provider,model,seconds,
        limit:Math.min(100,Math.max(1,Math.floor(Number(el("dj-limit").value)||10)))};
      localStorage.setItem("dj-settings",JSON.stringify(settings));el("dj-key").value="";
      generation++;pair="";plan=null;stopFade();
      if(native)native.setMix(settings.enabled && settings.style!=="album","","",0,seconds);
      info("Đã lưu cài đặt DJ.");
      if(album?.length)playTrackQueue(album);
      prepare();el("dj-dialog").close();
    } catch(e){info(e.message || String(e));}
  }
  el("dj-save").onclick=()=>applySettings();
  el("dj-play-album").onclick=()=>{
    const queue=window.velunaLibrary.orderedAlbum(el("dj-album").value);
    if(queue.length)applySettings(queue);
  };
  el("dj-close").onclick=()=>{el("dj-key").value="";el("dj-dialog").close();};
  el("dj-dialog").addEventListener("close",()=>{el("dj-key").value="";});
  if(settings.enabled)prepare();
})();
