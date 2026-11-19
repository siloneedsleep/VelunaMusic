import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const code=await readFile(new URL("../ui/dj.js",import.meta.url),"utf8");
function player({failure=false,album=false}={}) {
  const elements=new Map(), plans=[], requests=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);};
  const settings={enabled:true,style:album?"album":"party",provider:"openai",model:"fixture",limit:1};
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
