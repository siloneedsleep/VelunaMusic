(() => {
  const defaults={tint:"#19374f",opacity:78,blur:12,border:24,radius:16};
  const seed={app:defaults,header:{opacity:42},track:{opacity:0,border:10,blur:0,radius:9},button:{opacity:80,radius:10,blur:0},input:{opacity:70,blur:0,radius:8}};
  const presets={clear:{opacity:22,blur:4,border:35},frost:{opacity:65,blur:20,border:34},dark:{tint:"#0d1d30",opacity:90,blur:10,border:20},solid:{opacity:100,blur:0,border:16}};
  const selectors={app:"body",header:"header",library:".collection",player:"aside",dialog:"dialog",button:"button:not(.row)",input:"input,select",track:".row"};
  const fields=Object.keys(defaults), history=[], future=[];
  const upper={opacity:100,blur:30,border:100,radius:42};
  const clone=x=>JSON.parse(JSON.stringify(x));
  let theme={surfaces:clone(seed),scale:100,motion:!matchMedia("(prefers-reduced-motion: reduce)").matches};
  const initial=()=>({surfaces:{app:{...defaults}},scale:100,motion:true});
  function sanitize(input) {
    const result=initial();
    if(!input || typeof input!=="object")return result;
    for(const scope of Object.keys(selectors)){
      const source=input.surfaces?.[scope];if(!source || typeof source!=="object")continue;
      const dest=result.surfaces[scope]||{};
      for(const field of fields){
        if(field==="tint" && /^#[a-f0-9]{6}$/i.test(source.tint))dest.tint=source.tint;
        if(field!=="tint" && Number.isFinite(source[field]))dest[field]=Math.max(0,Math.min(upper[field],Math.round(source[field])));
      }
      if(Object.keys(dest).length)result.surfaces[scope]=dest;
    }
    if(Number.isFinite(input.scale))result.scale=Math.min(150,Math.max(90,input.scale));
    if(typeof input.motion==="boolean")result.motion=input.motion;
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
    control.oninput=()=>{if(!editing){remember();editing=true;}edit({[field]:field==="tint"?control.value:+control.value});el("glass-preset").value="";render();};
    control.onchange=()=>{editing=false;save();};
  }
  el("glass-scope").onchange=()=>{el("glass-preset").value="";render();};
  el("glass-preset").onchange=e=>{const preset=presets[e.target.value];if(preset)change(()=>edit(preset));};
  el("theme-scale").onchange=e=>change(()=>theme.scale=+e.target.value);
  el("theme-motion").onchange=e=>change(()=>theme.motion=e.target.checked);
  el("theme-inherit").onclick=()=>change(()=>{const scope=el("glass-scope").value;if(scope==="app")theme.surfaces.app={...defaults};else delete theme.surfaces[scope];});
  for (const [id,from,to] of [["theme-undo",history,future],["theme-redo",future,history]]){
    el(id).onclick=()=>{if(!from.length)return;to.push(clone(theme));theme=from.pop();save();};
  }
  window.velunaTheme={export:()=>clone(theme),apply:incoming=>change(()=>theme=sanitize(incoming))};render();
})();
