import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const code=await readFile(new URL("../ui/dj.js",import.meta.url),"utf8");
function player({failure=false,album=false,seconds=0}={}) {
  const elements=new Map(), plans=[], requests=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);};
  const settings={enabled:true,style:album?"album":"party",provider:"openai",model:"fixture",limit:1,seconds};
  const localFiles=["private/path/a","private/path/b","private/path/c"];
  const spectrum={duration:120,intro:{bpm:120,confidence:.8,rms:.2},outro:{bpm:120,confidence:.7,rms:.21}};
  const window={velunaVault:{read:async()=>"fake-test-key"}};
  const ui={localStorage:{getItem:()=>JSON.stringify(settings)},el,window,selected:localFiles[0],playOrder:()=>localFiles,
    native:{setMix(...p){plans.push(p);}},nativeTransfer:async()=>spectrum,AbortSignal,
    fetch:async(url,init)=>{requests.push([url,init]);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({option:failure?99:1})}}]})};}};
  vm.createContext(ui);vm.runInContext(code,ui);
  return {ui,window,el,plans,requests,localFiles};
}
test("AI receives measured features and can only select a locally bounded plan",async()=>{
  const p=player();
  await new Promise(resolve=>setImmediate(resolve));
  await p.window.velunaDJ.nearingEnd(10,120,true);
  assert.equal(p.requests.length,0);
  await p.window.velunaDJ.nearingEnd(100,120,true);
  assert.equal(p.requests.length,1);
  const data=p.requests[0][1].body;
  for(const path of p.localFiles)assert.ok(!data.includes(path));
  assert.ok(data.includes("overlap_ms"));assert.equal(p.plans.at(-1)[3],2000);
  assert.match(p.el("dj-status").textContent,/AI DJ/);
  p.ui.selected=p.localFiles[1];await p.window.velunaDJ.prepare();assert.equal(p.requests.length,1);
});
test("invalid model choice falls back and album mode has zero overlap",async()=>{
  const failed=player({failure:true}),album=player({album:true});
  await new Promise(resolve=>setImmediate(resolve));
  await failed.window.velunaDJ.nearingEnd(100,120,true);
  assert.match(failed.el("dj-status").textContent,/AutoMix/);
  assert.equal(failed.plans.at(-1)[3],4000);assert.equal(album.plans.at(-1)[3],0);assert.equal(album.requests.length,0);
});

test("fixed overlap reaches the native mixer and skips remote planning",async()=>{
  const p=player({seconds:30});await new Promise(resolve=>setImmediate(resolve));
  await p.window.velunaDJ.nearingEnd(100,120,true);
  assert.deepEqual(p.plans.at(-1),[true,p.localFiles[0],p.localFiles[1],30000,30]);
  assert.equal(p.requests.length,0);
});

function desktopDeckPlayer({enabled=true,seconds=4,tracksList=["ytmusic://aB1_CD-2345","ytmusic://xY9_ZZ-1122","ytmusic://kL3_MN-9988"]}={}) {
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{value:id==="repeat-mode"?"off":"",textContent:"",addEventListener(){}});return elements.get(id);};
  const createdAudio=[];
  class FakeAudio {
    constructor() {
      this.src=""; this.crossOrigin=""; this.preload=""; this.volume=1;
      this.currentTime=0; this.duration=120; this.paused=true; this.ended=false;
      this.readyState=4; this.error=null; this.loadCalls=0; this.playCalls=0; this.pauseCalls=0;
      createdAudio.push(this);
    }
    load() {
      this.loadCalls++;
      if (this.src && typeof this.onloadedmetadata==="function") this.onloadedmetadata();
      if (this.src && typeof this.oncanplay==="function") this.oncanplay();
    }
    async play() { this.playCalls++; this.paused=false; }
    pause() { this.pauseCalls++; this.paused=true; }
    removeAttribute(name) { if (name==="src") this.src=""; }
  }
  const deckA=new FakeAudio();
  deckA.src="http://127.0.0.1:4000/tok/aB1_CD-2345";
  deckA.paused=false;
  const resolvedStreams=[];
  const transitions=[];
  const attached=[];
  const detached=[];
  let rafQueue=[];
  let nextRaf=1;
  const settings={enabled,style:"gentle",provider:"local",model:"",limit:5,seconds};
  const windowObj={
    velunaYtm:{
      async stream(id, force) {
        resolvedStreams.push({id,force});
        return {url:"http://127.0.0.1:4000/tok/"+id.slice(10),expires_at:Math.floor(Date.now()/1000)+3600,duration_ms:120000};
      }
    },
    velunaSound:{
      attach(a){attached.push(a);},
      detach(a){detached.push(a);}
    },
    velunaMotion:{
      onTrackTransition(id,t){transitions.push({id,t});}
    }
  };
  const ui={
    Audio:FakeAudio,
    localStorage:{getItem:()=>JSON.stringify(settings),setItem(){}},
    el,
    window:windowObj,
    document:{hidden:false},
    native:null,
    desktop:{convertFileSrc:p=>"asset://"+p},
    audio:deckA,
    selected:tracksList[0],
    tracks:tracksList.map(id=>({id,title:id})),
    albumQueue:[],
    playOrder:()=>tracksList,
    bindAudio(){},
    draw(){},
    savePosition(){},
    position(){},
    msg(){},
    requestAnimationFrame(fn){const id=nextRaf++;rafQueue.push({id,fn,cancelled:false});return id;},
    cancelAnimationFrame(id){for(const r of rafQueue)if(r.id===id)r.cancelled=true;},
    setInterval, clearInterval, Date, Math, Promise
  };
  vm.createContext(ui);
  vm.runInContext(code,ui);
  return {
    ui,
    window:windowObj,
    deckA,
    createdAudio,
    resolvedStreams,
    transitions,
    attached,
    detached,
    stepRaf() {
      const pending=rafQueue.filter(r=>!r.cancelled);
      rafQueue=[];
      for(const r of pending)r.fn();
    }
  };
}

test("equalPowerGains preserves constant acoustic energy across crossfade progress",()=>{
  const p=desktopDeckPlayer();
  const fn=p.window.velunaDJ.equalPowerGains;
  const g0=fn(0);
  assert.ok(Math.abs(g0.out-1)<1e-6 && Math.abs(g0.in)<1e-6);
  for(const x of [0.25,0.5,0.75]) {
    const g=fn(x);
    assert.ok(Math.abs(g.out*g.out+g.in*g.in-1)<1e-6);
  }
  const mid=fn(0.5);
  assert.ok(Math.abs(mid.out-Math.SQRT1_2)<1e-6);
  assert.ok(Math.abs(mid.in-Math.SQRT1_2)<1e-6);
  const g1=fn(1);
  assert.ok(Math.abs(g1.out)<1e-6 && Math.abs(g1.in-1)<1e-6);
  assert.equal(fn(-2).out,1);
  assert.equal(fn(2).in,1);
});

test("gapless mode pre-resolves next YouTube track, pre-buffers Deck B, and swaps seamlessly",async()=>{
  const p=desktopDeckPlayer({enabled:false,seconds:0});
  await p.window.velunaDJ.nearingEnd(98,120,true);
  await new Promise(r=>setImmediate(r));
  assert.equal(p.resolvedStreams.length,1);
  assert.equal(p.resolvedStreams[0].id,"ytmusic://xY9_ZZ-1122");

  await p.window.velunaDJ.nearingEnd(108,120,true);
  await new Promise(r=>setImmediate(r));
  const deckB=p.createdAudio[1];
  assert.ok(deckB);
  assert.equal(deckB.preload,"auto");
  assert.equal(deckB.src,"http://127.0.0.1:4000/tok/xY9_ZZ-1122");
  assert.ok(deckB.loadCalls>=1);
  assert.equal(p.window.velunaDJ.getState().activeDeck,"A");

  p.ui.audio.currentTime=119.97;
  await p.window.velunaDJ.tick();
  assert.equal(p.window.velunaDJ.getState().activeDeck,"B");
  assert.equal(p.ui.audio,deckB);
  assert.equal(p.ui.selected,"ytmusic://xY9_ZZ-1122");
  assert.equal(p.deckA.paused,true);
  assert.equal(p.deckA.src,"");
  assert.equal(p.transitions.length,1);
  assert.equal(p.transitions[0].id,"ytmusic://xY9_ZZ-1122");
});

test("crossfade applies equal-power envelope, swaps Deck A to B, and cancels cleanly on abrupt Next/Seek",async()=>{
  const p=desktopDeckPlayer({enabled:true,seconds:4});
  await new Promise(r=>setImmediate(r));

  p.ui.audio.currentTime=116.0;
  await p.window.velunaDJ.tick();
  await new Promise(r=>setImmediate(r));
  const deckB=p.createdAudio[1];
  assert.ok(deckB);
  assert.equal(p.window.velunaDJ.getState().fading,true);
  assert.equal(deckB.paused,false);

  p.ui.audio.currentTime=118.0;
  p.stepRaf();
  assert.ok(Math.abs(p.deckA.volume-Math.SQRT1_2)<0.05);
  assert.ok(Math.abs(deckB.volume-Math.SQRT1_2)<0.05);

  p.ui.audio.currentTime=120.0;
  p.stepRaf();
  assert.equal(p.window.velunaDJ.getState().fading,false);
  assert.equal(p.window.velunaDJ.getState().activeDeck,"B");
  assert.equal(p.ui.audio,deckB);
  assert.equal(deckB.volume,1);
  assert.equal(p.deckA.paused,true);
  assert.equal(p.deckA.src,"");
  assert.equal(p.transitions.at(-1).id,"ytmusic://xY9_ZZ-1122");

  deckB.currentTime=116.0;
  await p.window.velunaDJ.tick();
  await new Promise(r=>setImmediate(r));
  const deckC=p.createdAudio[2];
  assert.ok(deckC);
  assert.equal(p.window.velunaDJ.getState().fading,true);

  deckB.currentTime=117.5;
  p.stepRaf();
  assert.ok(deckB.volume<1 && deckC.volume>0);

  p.window.velunaDJ.stopFade();
  assert.equal(p.window.velunaDJ.getState().fading,false);
  assert.equal(deckC.paused,true);
  assert.equal(deckC.src,"");
  assert.equal(deckB.volume,1);
});

test("stopFade during async incoming.play() releases stale deck with zero overlapping audio",async()=>{
  const p=desktopDeckPlayer({enabled:true,seconds:4});
  await new Promise(r=>setImmediate(r));
  await p.window.velunaDJ.preloadDeckB("ytmusic://xY9_ZZ-1122",0);
  const deckB=p.createdAudio[1];
  let resolvePlay;
  deckB.play=()=>new Promise(resolve=>{resolvePlay=()=>{deckB.paused=false;resolve();};});

  p.ui.audio.currentTime=117.0;
  const tickPromise=p.window.velunaDJ.tick();
  assert.equal(p.window.velunaDJ.getState().fading,true);

  p.window.velunaDJ.stopFade();
  assert.equal(p.window.velunaDJ.getState().fading,false);
  resolvePlay();
  await tickPromise;

  assert.equal(deckB.paused,true);
  assert.equal(deckB.src,"");
  assert.equal(p.deckA.volume,1);
});
