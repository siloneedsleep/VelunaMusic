(() => {
  const defaults={tint:"#19374f",text:"#ecf6ff",opacity:78,blur:12,border:24,radius:16,highlight:8,shadow:18};
  const seed={app:defaults,header:{opacity:42},track:{opacity:0,border:10,blur:0,radius:9},button:{opacity:80,radius:10,blur:0},input:{opacity:70,blur:0,radius:8}};
  const presets={clear:{opacity:22,blur:4,border:35},frost:{opacity:65,blur:20,border:34},dark:{tint:"#0d1d30",opacity:90,blur:10,border:20},solid:{opacity:100,blur:0,border:16}};
  const selectors={app:"body",header:"header",library:".collection",player:"aside",dialog:"dialog",button:"button:not(.row)",input:"input,select,textarea",track:".row",lyrics:"#lyrics-lines",drop:"#nearby-drop",playlist:"#playlist-panel",notice:"#upgrade",transport:".transport button"};
  const fields=Object.keys(defaults), history=[], future=[];
  const upper={opacity:100,blur:30,border:100,radius:42,highlight:100,shadow:100};
  const clone=x=>JSON.parse(JSON.stringify(x));
  const initial=()=>({surfaces:{app:{...defaults}},scale:100,motion:true,level:"balanced",position:"center",shade:60});
  let theme={...initial(),surfaces:clone(seed),motion:!matchMedia("(prefers-reduced-motion: reduce)").matches};
  function sanitize(input) {
    const result=initial();
    if(!input || typeof input!=="object")return result;
    for(const scope of Object.keys(selectors)){
      const source=input.surfaces?.[scope];if(!source || typeof source!=="object")continue;
      const dest=result.surfaces[scope]||{};
      for(const field of fields){
        if((field==="tint" || field==="text") && /^#[a-f0-9]{6}$/i.test(source[field]))dest[field]=source[field];
        if(field in upper && Number.isFinite(source[field]))dest[field]=Math.max(0,Math.min(upper[field],Math.round(source[field])));
      }
      if(Object.keys(dest).length)result.surfaces[scope]=dest;
    }
    if(Number.isFinite(input.scale))result.scale=Math.min(150,Math.max(90,input.scale));
    if(typeof input.motion==="boolean")result.motion=input.motion;
    if(["full","balanced","economy"].includes(input.level))result.level=input.level;
    if(["top","center","bottom"].includes(input.position))result.position=input.position;
    if(Number.isFinite(input.shade))result.shade=Math.max(0,Math.min(95,input.shade));
    return result;
  }
  try{const saved=JSON.parse(localStorage.getItem("glass-theme"));if(saved)theme=sanitize(saved);}catch{}
  const sheet=document.createElement("style");document.head.append(sheet);
  function render(){
    let css="";
    for(const [scope,props] of Object.entries(theme.surfaces)){
      css+=selectors[scope]+"{"+Object.entries(props).map(([k,v])=>"--glass-"+k+":"+v).join(";")+"}";
    }
    sheet.textContent=css;
    document.body.style.setProperty("--type-scale",theme.scale/100);
    document.body.dataset.motion=theme.motion?"on":"off";
    document.body.dataset.intensity=el("motion-level").value=theme.level;
    document.body.style.backgroundPosition=el("back-position").value=theme.position;
    document.body.style.setProperty("--back-shade",theme.shade+"%");el("back-shade").value=theme.shade;
    const scope=el("glass-scope").value;
    const style={...defaults,...theme.surfaces.app,...theme.surfaces[scope]};
    for(const field of fields)el("glass-"+field).value=style[field];
    el("theme-scale").value=theme.scale;el("theme-motion").checked=theme.motion;
    el("theme-undo").disabled=!history.length;el("theme-redo").disabled=!future.length;
  }
  function remember(){history.push(clone(theme));if(history.length>40)history.shift();future.length=0;}
  function save(){localStorage.setItem("glass-theme",JSON.stringify(theme));render();}
  function change(fn){remember();fn();save();}
  function edit(data){const scope=el("glass-scope").value;Object.assign(theme.surfaces[scope]||={},data);}
  for(const field of fields){
    const control=el("glass-"+field);
    let editing=false;
    control.oninput=()=>{if(!editing){remember();editing=true;}edit({[field]:field in upper?+control.value:control.value});el("glass-preset").value="";render();};
    control.onchange=()=>{editing=false;save();};
  }
  el("glass-scope").onchange=()=>{el("glass-preset").value="";render();};
  el("glass-preset").onchange=e=>{const preset=presets[e.target.value];if(preset)change(()=>edit(preset));};
  el("theme-scale").onchange=e=>change(()=>theme.scale=+e.target.value);
  el("theme-motion").onchange=e=>change(()=>theme.motion=e.target.checked);
  el("motion-level").onchange=e=>change(()=>theme.level=e.target.value);
  el("back-position").onchange=e=>change(()=>theme.position=e.target.value);
  el("back-shade").onchange=e=>change(()=>theme.shade=+e.target.value);
  el("theme-export").onclick=()=>{const box=el("theme-data");box.value=JSON.stringify(theme,null,2);box.focus();box.select();el("theme-data-status").textContent="Đã chọn dữ liệu giao diện để sao chép.";};
  el("theme-import").onclick=()=>{try{const raw=JSON.parse(el("theme-data").value);
    if(!raw || typeof raw.surfaces!=="object" || !raw.surfaces?.app)throw Error();
    change(()=>theme=sanitize(raw));el("theme-data-status").textContent="Đã nhập giao diện.";
  }catch{el("theme-data-status").textContent="Dữ liệu giao diện không hợp lệ.";}};
  el("theme-inherit").onclick=()=>change(()=>{const scope=el("glass-scope").value;if(scope==="app")theme.surfaces.app={...defaults};else delete theme.surfaces[scope];});
  for (const [id,from,to] of [["theme-undo",history,future],["theme-redo",future,history]]){
    el(id).onclick=()=>{if(!from.length)return;to.push(clone(theme));theme=from.pop();save();};
  }
  window.velunaTheme={export:()=>clone(theme),apply:incoming=>change(()=>theme=sanitize(incoming))};render();
})();
