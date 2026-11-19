"use strict";

function playlistLibrary(request) {
  const favoriteId = "00000000-0000-4000-8000-000000000002";
  const panel = el("playlist-panel"), choice = el("playlist-select"), local = el("playlist-track");
  const tell = text => {el("playlist-status").textContent = text;};
  let owner, documents = [], active = favoriteId, generation = 0, syncing = false, again = false;
  const storageKey = () => "veluna-playlists/" + (owner || "local");
  const current = () => documents.find(d => d.id === active);
  function newList(id, name, kind = "playlist") {
    return {id,kind,revision:0,dirty:false,payload:{name,items:[],operation:""}};
  }
  function store() { localStorage.setItem(storageKey(), JSON.stringify(documents)); }
  function account(id) {
    if (owner === id) return;
    generation++; owner = id; syncing = again = false; active = favoriteId;
    try { documents = JSON.parse(localStorage.getItem(storageKey())) || []; } catch { documents = []; }
    if (!Array.isArray(documents)) documents = [];
    if (!documents.some(d => d.id === favoriteId)) documents.unshift(newList(favoriteId,"Yêu thích","favorite"));
    render(); if (id) sync();
  }
  function change(doc, items) {
    doc.payload = {...doc.payload,items,operation:crypto.randomUUID()}; doc.dirty = true;
    store(); render(); sync();
  }
  function render() {
    el("playlist-import-local").hidden=!owner || !localStorage.getItem("veluna-playlists/local");
    choice.replaceChildren(...documents.map(d=>new Option(d.payload.name,d.id,false,d.id===active)));
    const before = local.value;
    local.replaceChildren(...tracks.map(t=>new Option(t.title,t.id,false,t.id===(before || selected))));
    const currentDoc = current(), list = el("playlist-items");
    list.replaceChildren();
    for (const [i,entry] of (currentDoc?.payload.items || []).entries()) {
      const li = document.createElement("li");li.append(entry.title+" ");
      const control=(label,action)=>{const button=document.createElement("button");button.textContent=label;
        button.onclick=()=>action().catch(e=>tell(e.message || String(e)));li.append(button);};
      if(i>0)control("Lên",async()=>{
        const next=currentDoc.payload.items.slice(); [next[i],next[i-1]]=[next[i-1],next[i]];change(currentDoc,next);
      });
      control("Xóa",async()=>change(currentDoc,currentDoc.payload.items.filter(item=>item.digest!==entry.digest)));
      control("Ghép với file đã chọn",async()=>{
        const path=local.value;
        if(!path || await inspectTrack(path)!==entry.digest)throw Error("File đã chọn khác nội dung của bài này.");
        localStorage.setItem("veluna-file/"+entry.digest,path);tell("Đã nhận diện file trên máy này.");
      });
      list.append(li);
    }
    el("playlist-conflict").hidden = !currentDoc?.conflict;
    window.velunaLibrary?.favoritesChanged();
  }
  function fromServer(row) {
    const p=row.payload;
    if (!p || typeof p.name!=="string" || !Array.isArray(p.items) || p.items.length>1000 ||
        !p.items.every(t=>t && typeof t.title==="string" && /^(?:[0-9a-f]{64}|ytmusic:\/\/[\w-]{11})$/.test(t.digest))) return null;
    return {id:row.item_id,kind:row.kind,revision:row.revision,dirty:false,
      payload:{name:p.name,items:p.items.map(t=>({title:t.title,digest:t.digest})),operation:p.operation || ""}};
  }
  async function sync() {
    if(!owner || navigator.onLine===false)return;
    if(syncing){again=true;return;}
    syncing=true;const run=generation;
    try {
      let offset=0;
      for(;;) {
        const rows=await request("/rest/v1/veluna_library?kind=in.(playlist,favorite)&deleted=eq.false&select=item_id,kind,payload,revision&order=item_id&limit=100&offset="+offset);
        if(run!==generation)return;
        for(const row of rows) {
          const remote=fromServer(row);if(!remote)continue;
          const existing=documents.find(d=>d.id===remote.id);
          if(!existing)documents.push(remote);
          else if(remote.revision>existing.revision) {
            if(!existing.dirty || existing.payload.operation===remote.payload.operation) {
              Object.assign(existing,remote);delete existing.conflict;
            } else existing.conflict=remote;
          }
        }
        if(rows.length<100)break;offset+=rows.length;
      }
      store();
      for (const doc of documents.filter(d=>d.dirty && !d.conflict)) {
        const payload=doc.payload;
        try {
          const rev=await request("/rest/v1/rpc/veluna_save_item","POST",{p_kind:doc.kind,p_item_id:doc.id,
            p_expected_revision:doc.revision,p_payload:payload,p_deleted:false});
          if(run!==generation)return;
          doc.revision=rev;doc.dirty=doc.payload.operation!==payload.operation;store();
        } catch(e){if(e.code==="40001")again=true;throw e;}
      }
      if(documents.some(d=>d.conflict))tell("Có playlist cần chọn phiên bản.");
      else if(panel.open)tell("Đã đồng bộ playlist và yêu thích.");
    } catch(e){if(run===generation)tell("Đã giữ chỉnh sửa trên máy. "+(e.message || String(e)));}
    finally{if(run===generation){syncing=false;render();if(again){again=false;sync();}}}
  }
  el("playlist-form").onsubmit=e=>{
    e.preventDefault();const name=el("playlist-name").value.trim();if(!name)return;
    const doc=newList(crypto.randomUUID(),name);documents.push(doc);active=doc.id;el("playlist-name").value="";change(doc,[]);
  };
  choice.onchange=()=>{active=choice.value;render();};
  el("playlist-add").onclick=async()=>{
    const track=tracks.find(t=>t.id===local.value),doc=current(),run=generation;if(!track || !doc)return;
    try{
      const digest=await inspectTrack(track.id);if(run!==generation)return;
      if(doc.payload.items.some(t=>t.digest===digest)){tell("Bài này đã có trong playlist.");return;}
      if(doc.payload.items.length>=1000)throw Error("Playlist đã đủ 1.000 bài.");
      localStorage.setItem("veluna-file/"+digest,track.id);change(doc,[...doc.payload.items,{title:track.title.slice(0,160),digest}]);
      tell("Đã thêm "+track.title);
    }catch(e){tell(e.message || String(e));}
  };
  el("playlist-play").onclick=async()=>{
    const doc=current(),run=generation;if(!doc?.payload.items.length){tell("Playlist đang trống.");return;}
    try{
      const ids=[];
      for(const entry of doc.payload.items) {
        if(/^ytmusic:\/\/[\w-]{11}$/.test(entry.digest)){
          if(!tracks.some(t=>t.id===entry.digest))await window.velunaYtm.playTracks([{id:entry.digest,title:entry.title}],0,false);
          ids.push(entry.digest);continue;
        }
        const remembered=localStorage.getItem("veluna-file/"+entry.digest);
        const options=tracks.filter(t=>t.id===remembered || t.title===entry.title);
        let found;
        for(const option of options){if(await inspectTrack(option.id)===entry.digest){found=option.id;break;}}
        if(!found)throw Error("Chọn file trên máy rồi bấm Ghép với file đã chọn cho bài "+entry.title+".");
        ids.push(found);
      }
      if(run!==generation || doc!==current())return;
      albumQueue=ids;if(native)native.playQueue(JSON.stringify(ids));else loadTrack(ids[0],true);
      tell("Đang phát "+doc.payload.name);
    }catch(e){tell(e.message || String(e));}
  };
  function resolve(keepCopy){
    const doc=current();if(!doc?.conflict)return;
    if(keepCopy){const copy=newList(crypto.randomUUID(),doc.payload.name.slice(0,88)+" · Máy này");
      copy.payload.items=doc.payload.items;copy.payload.operation=crypto.randomUUID();copy.dirty=true;documents.push(copy);}
    Object.assign(doc,doc.conflict);delete doc.conflict;store();render();sync();
  }
  el("playlist-remote").onclick=()=>resolve(false);el("playlist-copy").onclick=()=>resolve(true);
  el("playlist-import-local").onclick=()=>{
    if(!owner)return;
    const guest=JSON.parse(localStorage.getItem("veluna-playlists/local") || "[]");
    for(const entry of guest) {
      const existing=documents.find(d=>d.id===entry.id);
      if(existing) {
        const included=new Set(existing.payload.items.map(t=>t.digest));
        const extra=entry.payload.items.filter(t=>!included.has(t.digest));
        if(extra.length)change(existing,[...existing.payload.items,...extra].slice(0,1000));
      } else {
        const copy=newList(entry.id,entry.payload.name,entry.kind);documents.push(copy);change(copy,entry.payload.items);
      }
    }
    tell("Đã nhập các bài từ playlist trên máy.");
  };
  panel.addEventListener("toggle",()=>{if(panel.open){render();sync();}});
  window.addEventListener("online",sync);
  window.addEventListener("veluna-library",()=>{if(panel.open)render();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden && owner)sync();});
  window.velunaFavorites = {
    ids() {
      const items=documents.find(doc=>doc.id===favoriteId)?.payload.items || [];
      return new Set(items.map(item=>localStorage.getItem("veluna-file/"+item.digest)).filter(Boolean));
    },
    async toggle(track) {
      const run=generation, doc=documents.find(item=>item.id===favoriteId);
      if(!doc || !track)return;
      const digest=await inspectTrack(track.id);
      if(run!==generation)return;
      const items=doc.payload.items;
      const exists=items.some(item=>item.digest===digest);
      if(!exists && items.length>=1000)throw Error("Danh sách yêu thích đã đủ 1.000 bài.");
      localStorage.setItem("veluna-file/"+digest,track.id);
      change(doc,exists?items.filter(item=>item.digest!==digest):[...items,{digest,title:track.title.slice(0,160)}]);
    }
  };
  account(null);return {account};
}
