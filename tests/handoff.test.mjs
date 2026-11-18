import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";

const code=await readFile(new URL("../ui/handoff.js",import.meta.url),"utf8");
function devices() {
  const db={row:null,changes:[]};
  function client(id) {
    const nodes=new Map(), tasks=new Map(); let seq=0;
    const el=name=>{
      if(!nodes.has(name)) nodes.set(name,{open:true,hidden:true,value:"",replaceChildren(){this.value="";},add(o){if(!this.value)this.value=o.value;}});
      return nodes.get(name);
    };
    const state={selected:"file-"+id,playing:id==="source",time:17.3,digest:"1".repeat(64)};
    const ui={window:{},document:{hidden:false,addEventListener(){}},el,crypto:{randomUUID},
      tracks:[{id:state.selected,title:"01 Local Track"}],selected:state.selected,
      native:false,Option:class{constructor(title,value){this.value=value;}},setTimeout(fn){tasks.set(++seq,fn);return seq;},
      clearTimeout(i){tasks.delete(i);},audio:{get paused(){return !state.playing;},get currentTime(){return state.time;},pause(){state.playing=false;}}};
    vm.createContext(ui);vm.runInContext(code,ui);
    ui.inspectTrack=async()=>state.digest;
    ui.startTransferredTrack=async(file,playing,time)=>{assert.equal(file,state.selected);state.playing=playing;state.time=time;};
    const handoff=ui.accountHandoff({deviceId:()=>id,active:()=>true,tell(msg){state.message=msg;},
      async request(path,_method,args){
        if(path.endsWith("veluna_offer")){
          db.row={transfer_id:args.p_id,source_device:args.p_source,target_device:args.p_target,title:args.p_title,
            digest:args.p_digest,phase:"offered",expires_at:new Date(Date.now()+180000).toISOString()};
        }else if(path.endsWith("veluna_advance")){
          assert.equal(args.p_id,db.row.transfer_id);
          db.changes.push(args.p_phase);db.row.phase=args.p_phase;
          if(args.p_phase==="released"){db.row.position_ms=args.p_position;db.row.playing=args.p_playing;}
        }else return db.row?[{...db.row}]:[];
      }});
    return {handoff,state,el,step:async()=>{const pending=[...tasks.values()];tasks.clear();for(const run of pending)await run();}};
  }
  return {db,source:client("source"),target:client("target")};
}
test("source keeps playing until the receiving device verifies the file and accepts",async()=>{
  const {source,target,db}=devices();
  await source.handoff.send("target");target.handoff.open();await target.step();
  target.state.digest="2".repeat(64);await target.el("accept-transfer").onclick();
  assert.equal(db.row.phase,"offered");assert.equal(source.state.playing,true);
  target.state.digest="1".repeat(64);await target.el("accept-transfer").onclick();
  assert.equal(db.row.phase,"ready");assert.equal(source.state.playing,true);
  await source.step();assert.equal(source.state.playing,false);assert.equal(db.row.position_ms,17300);
  await target.step();assert.equal(target.state.playing,true);assert.equal(target.state.time,17.3);
  assert.deepEqual(db.changes,["ready","released","received"]);
});
test("declining the handoff leaves the source untouched",async()=>{
  const {source,target,db}=devices();
  await source.handoff.send("target");target.handoff.open();await target.step();
  await target.el("decline-transfer").onclick();await source.step();
  assert.equal(db.row.phase,"cancelled");assert.equal(source.state.playing,true);assert.equal(target.state.playing,false);
});
