"use strict";

(() => {
  const bands=["bass","mid","high"], profiles=["speaker","headphones","bluetooth"], graph=new WeakMap();
  let selectedProfile=localStorage.getItem("sound-profile") || "speaker", opts={}, context=null, gain=null, filters=[], sink="";
  if(!profiles.includes(selectedProfile))selectedProfile="speaker";
  const status=s=>{el("sound-status").textContent=s;};
  function read() {
    let v={};try{v=JSON.parse(localStorage.getItem("sound/"+selectedProfile)) || {};}catch{}
    opts={enabled:v.enabled===true};
    for(const band of bands)opts[band]=Number.isFinite(v[band])?Math.min(6,Math.max(-6,v[band])):0;
    el("sound-profile").value=selectedProfile;el("sound-enabled").checked=opts.enabled;
    for(const band of bands){el("sound-"+band).value=opts[band];el("sound-"+band+"-value").textContent=opts[band]+" dB";}
  }
  function attach(player) {
    if(!context || graph.has(player))return;
    const source=context.createMediaElementSource(player);
    source.connect(filters[0]);graph.set(player,source);
  }
  function detach(player){const source=graph.get(player);if(source){source.disconnect();graph.delete(player);}}
  async function apply() {
    if(native){native.setEqualizer(opts.enabled,...bands.map(b=>opts[b]));return;}
    if(!context && opts.enabled){
      context=new AudioContext();gain=context.createGain();gain.connect(context.destination);
      filters=[["lowshelf",180],["peaking",1000],["highshelf",4000]].map(([type,hz])=>{
        const f=context.createBiquadFilter();f.type=type;f.frequency.value=hz;return f;});
      filters[0].connect(filters[1]);filters[1].connect(filters[2]);filters[2].connect(gain);attach(audio);
      if(sink && context.setSinkId)await context.setSinkId(sink);
    }
    if(!context)return;
    for(let i=0;i<bands.length;i++)filters[i].gain.setTargetAtTime(opts.enabled?opts[bands[i]]:0,context.currentTime,.02);
    const boost=opts.enabled?Math.max(0,...bands.map(b=>opts[b])):0;
    gain.gain.setTargetAtTime(10**(-boost/20),context.currentTime,.02);
    if(!audio.paused)await context.resume();
  }
  function save() {
    opts.enabled=el("sound-enabled").checked;
    for(const band of bands){opts[band]=Number(el("sound-"+band).value);el("sound-"+band+"-value").textContent=opts[band]+" dB";}
    localStorage.setItem("sound/"+selectedProfile,JSON.stringify(opts));
    apply().catch(e=>status(e.message));
  }
  read();
  el("sound-profile").onchange=e=>{selectedProfile=e.target.value;localStorage.setItem("sound-profile",selectedProfile);read();apply().catch(e=>status(e.message));};
  el("sound-enabled").onchange=save;for(const band of bands)el("sound-"+band).onchange=save;
  const output=el("sound-output");
  if(desktop && navigator.mediaDevices?.selectAudioOutput && audio.setSinkId){
    output.hidden=false;output.onclick=async()=>{try{
      const d=await navigator.mediaDevices.selectAudioOutput();
      if(context){if(!context.setSinkId)throw Error("Đầu ra EQ dùng thiết bị mặc định của Windows.");await context.setSinkId(d.deviceId);}
      await audio.setSinkId(d.deviceId);sink=d.deviceId;status(d.label || "Đã chọn thiết bị phát.");
    }catch(e){status(e.message);}};
  }
  window.velunaSound={attach(player){attach(player);if(sink && player.setSinkId)player.setSinkId(sink).catch(e=>status(e.message));},
    detach,wake(){if(context)context.resume().catch(e=>status(e.message));else if(opts.enabled)apply().catch(e=>status(e.message));},
    sleep(){if(context && audio.paused)context.suspend().catch(()=>{});}};
  window.onVelunaSoundStatus=status;
})();
