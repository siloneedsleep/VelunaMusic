(() => {
  const key="youtube-library";
  let items=[];
  try {const raw=JSON.parse(localStorage.getItem(key)||"[]");if(Array.isArray(raw))items=raw.filter(x=>typeof x.title==="string" && /^[\w-]{11}$/.test(x.id));}catch{}
  function videoId(value) {
    let url;try{url=new URL(value);}catch{return "";}
    if(url.protocol!=="https:" || url.username || url.password || url.port)return "";
    let id="";
    if(url.hostname==="youtu.be")id=url.pathname.slice(1);
    else if(["youtube.com","www.youtube.com","music.youtube.com","m.youtube.com"].includes(url.hostname)){
      if(url.pathname==="/watch")id=url.searchParams.get("v");
      else if(/^\/(shorts|live)\/[\w-]{11}$/.test(url.pathname))id=url.pathname.split("/")[2];
    }
    return /^[\w-]{11}$/.test(id||"")?id:"";
  }
  async function play(id){
    try{if(native)native.openYouTube(id);else{audio.pause();await desktop.invoke("open_youtube",{id});}}
    catch(e){msg(String(e));}
  }
  function render(){
    const list=el("youtube-list");list.replaceChildren();
    for(const item of items){
      const line=document.createElement("div"),go=document.createElement("button"),remove=document.createElement("button");
      go.textContent=item.title;go.onclick=()=>play(item.id);remove.textContent="Xóa";remove.setAttribute("aria-label","Xóa "+item.title);
      remove.onclick=()=>{items=items.filter(x=>x.id!==item.id);localStorage.setItem(key,JSON.stringify(items));render();};
      line.append(go,remove);list.append(line);
    }
  }
  el("youtube-form").onsubmit=e=>{
    e.preventDefault();const box=el("youtube-url"),id=videoId(box.value.trim());
    if(!id){el("youtube-status").textContent="Nhập liên kết video từ YouTube hoặc YouTube Music.";return;}
    const title=el("youtube-name").value.trim()||"YouTube · "+id;
    items=[{id,title},...items.filter(x=>x.id!==id)];localStorage.setItem(key,JSON.stringify(items));render();
    box.value="";el("youtube-name").value="";el("youtube-status").textContent="Đã thêm vào thư viện YouTube.";
  };
  render();
})();
