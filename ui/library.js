"use strict";

(() => {
  const buttons = [...document.querySelectorAll("[data-view]")];
  const picker = el("library-group"), cover = el("cover"), heart = el("now-favorite");
  const tags = new Map();
  let view = "all", scanning = false, group = "", coverId, coverData = null, lastStarted = "";
  let history = new Map();
  try { history = new Map(JSON.parse(localStorage.getItem("play-history") || "[]")); } catch {}
  const grouped = () => view === "album" || view === "artist";
  const label = t => tags.get(t.id)?.title || t.title;
  const indexing = () => grouped() || view === "home" || el("dj-dialog").open;
  const albumKey = tag => tag?.album ? JSON.stringify([tag.album,tag.album_artist || ""]) : "";
  const groupOf = t => view === "album" ? albumKey(tags.get(t.id)) : tags.get(t.id)?.artist || "";
  const groupName = value => view !== "album" ? value : JSON.parse(value).filter(Boolean).join(" · ");

  function record(id) {
    if (!id || lastStarted === id) return;
    lastStarted = id;
    const previous = history.get(id);
    history.delete(id);
    history.set(id, {count:(previous?.count || 0) + 1, time:Date.now()});
    if (history.size > 5000) history.delete(history.keys().next().value);
    try { localStorage.setItem("play-history", JSON.stringify([...history])); } catch {}
    if (view === "popular" || view === "recent") drawList();
    if (view === "home") shelves();
  }
  function nativeHistory() {
    if (!native?.playHistory) return;
    try { history = new Map(Object.entries(JSON.parse(native.playHistory()))); } catch {}
  }
  async function read(id, artwork) {
    if (native) return nativeTransfer(artwork ? "readCover" : "readTags", id);
    if (desktop && id.startsWith("ytmusic://")){
      const meta=window.velunaYtm?.metaForId(id) || tracks.find(t=>t.id===id) || {};
      return {...meta,cover:artwork?meta.thumbnail:null};
    }
    if (desktop) return desktop.invoke("media_tags", {id,artwork});
  }
  function orderedAlbum(key){
    return tracks.filter(t=>key && albumKey(tags.get(t.id))===key).sort((a,b)=>{
      const first=tags.get(a.id),second=tags.get(b.id);
      return (first.disc || 1)-(second.disc || 1) || (first.track ?? Number.MAX_SAFE_INTEGER)-(second.track ?? Number.MAX_SAFE_INTEGER);
    }).map(t=>t.id);
  }
  function albumChoices() {
    if(!el("dj-dialog").open)return;
    const choose=el("dj-album"),previous=choose.value;
    const keys=[...new Set(tracks.map(t=>albumKey(tags.get(t.id))).filter(Boolean))];
    const name=key=>JSON.parse(key).filter(Boolean).join(" · ");
    keys.sort((a,b)=>name(a).localeCompare(name(b),"vi"));
    choose.replaceChildren(new Option("Chọn album",""),...keys.map(k=>new Option(name(k),k)));
    if(keys.includes(previous))choose.value=previous;
    el("dj-play-album").disabled=scanning || !choose.value;
  }
  function groupChoices() {
    if (!grouped()) return;
    const values = [...new Set(tracks.map(groupOf).filter(Boolean))].sort((a,b)=>groupName(a).localeCompare(groupName(b),"vi"));
    if (!values.includes(group)) group = "";
    picker.replaceChildren(new Option("Tất cả", ""), ...values.map(value=>new Option(groupName(value),value)));
    picker.value = group;
    el("group-play").disabled=scanning || !group;
  }
  async function scan() {
    if (scanning || !indexing() || document.hidden) return;
    scanning = true;
    el("dj-play-album").disabled=true;el("group-play").disabled=true;
    try {
      let n=0;
      for (const track of tracks) {
        if (document.hidden || !indexing()) break;
        if (tags.has(track.id)) continue;
        try { tags.set(track.id, (await read(track.id,false)) || {}); }
        catch { tags.set(track.id,{}); }
        if (++n % 12 === 0 && grouped() && !document.hidden) { groupChoices(); drawList(); }
      }
    } finally { scanning = false; groupChoices(); albumChoices(); shelves(); drawList(); }
  }
  const home=el("home-shelves"), artCache=new Map();
  let shelfKey="", loadingCovers=false;
  async function visibleCovers(){
    if(loadingCovers || view!=="home" || document.hidden)return;
    loadingCovers=true;
    try {
      while(view==="home" && !document.hidden) {
        const node=[...home.querySelectorAll("img[data-pending]")].find(img=>{
          const box=img.getBoundingClientRect();return box.right>=0 && box.left<innerWidth && box.bottom>=0 && box.top<innerHeight+100;
        });
        if(!node)break;
        const id=node.dataset.pending;delete node.dataset.pending;
        let image=artCache.get(id);
        if(image===undefined){
          try{image=(await read(id,true))?.cover || null;}catch{image=null;}
          if(artCache.size>=6)artCache.delete(artCache.keys().next().value);
          artCache.set(id,image);
        }
        if(node.isConnected && image)node.src=image;
      }
    } finally { loadingCovers=false; }
  }
  function shelves(){
    home.hidden=view!=="home";
    if(home.hidden){if(shelfKey){home.replaceChildren();shelfKey="";}return;}
    const recent=tracks.filter(t=>history.has(t.id)).sort((a,b)=>history.get(b.id).time-history.get(a.id).time).slice(0,8);
    const albums=new Map();
    for(const t of tracks){const key=albumKey(tags.get(t.id));if(key && !albums.has(key))albums.set(key,t);if(albums.size===12)break;}
    const albumsList=[...albums].map(([key,t])=>({id:t.id,title:tags.get(t.id).album,sub:tags.get(t.id).album_artist || tags.get(t.id).artist,key}));
    const recentList=recent.map(t=>({id:t.id,title:label(t),sub:tags.get(t.id)?.artist}));
    const next=JSON.stringify([recentList,albumsList]);
    if(shelfKey===next)return;
    home.replaceChildren();shelfKey=next;
    for(const [name,items] of [["Nghe gần đây",recentList],["Album trong thư viện",albumsList]]){
      if(!items.length)continue;
      const title=document.createElement("h2"),rail=document.createElement("div");
      title.textContent=name;rail.className="album-strip";rail.addEventListener("scroll",visibleCovers,{passive:true});
      for(const item of items){
        const button=document.createElement("button"),image=document.createElement("img"),caption=document.createElement("b");
        button.className="album-card";image.src="icon.png";image.alt="";image.dataset.pending=item.id;caption.textContent=item.title;
        button.append(image,caption);
        if(item.sub){const by=document.createElement("small");by.textContent=item.sub;button.append(by);}
        button.onclick=()=>{
          if(!item.key){
            if(window.velunaMotion?.transitionCover)window.velunaMotion.transitionCover(image,cover,()=>loadTrack(item.id,true),el("title"));
            else loadTrack(item.id,true);
            return;
          }
          select(buttons.find(b=>b.dataset.view==="album"),item.key);
        };
        rail.append(button);
      }
      home.append(title,rail);
    }
    visibleCovers();
  }
  window.addEventListener("scroll",visibleCovers,{passive:true});
  window.addEventListener("resize",visibleCovers,{passive:true});
  function syncYtmTags() {
    for (const t of tracks) {
      if (t.source !== "ytmusic" && !String(t.id || "").startsWith("ytmusic://")) continue;
      const existing = tags.get(t.id) || {};
      const cached = window.velunaYtm?.metaForId?.(t.id) || {};
      const albumName = typeof t.album === "object" && t.album ? (t.album.name || "") : (t.album || cached.album || existing.album || "");
      tags.set(t.id, {
        ...existing,
        ...cached,
        title: t.title || cached.title || existing.title,
        artist: t.artist || t.artist_text || cached.artist || existing.artist || "",
        album: albumName,
        source: "ytmusic",
        recording_kind: t.recording_kind || cached.recording_kind || existing.recording_kind || "original",
        recording_label: t.recording_label || cached.recording_label || existing.recording_label || "Bản gốc",
        codec: t.codec || cached.codec || existing.codec,
        bitrate: t.bitrate || cached.bitrate || existing.bitrate,
        bitrate_kbps: t.bitrate_kbps || cached.bitrate_kbps || existing.bitrate_kbps,
        sample_rate: t.sample_rate || cached.sample_rate || existing.sample_rate,
        expires_at: t.expires_at || cached.expires_at || existing.expires_at,
        cover: t.thumbnail || cached.thumbnail || existing.cover
      });
    }
  }
  function showTrack() {
    const current = tracks.find(t=>t.id===selected);
    const meta = tags.get(selected);
    el("title").textContent = current ? label(current) : "Chọn một bài hát";
    const ytmBadge = meta?.source === "ytmusic"
      ? ["YouTube Music", meta.recording_label, window.velunaYtm?.formatQuality?.(meta)].filter(Boolean).join(" · ")
      : "";
    el("now-artist").textContent = current ? [meta?.artist, meta?.album, ytmBadge].filter(Boolean).join(" · ") : "";
    if (typeof updateNowBadges === "function") updateNowBadges(current, meta);
  }
  async function artwork(id) {
    coverData = null; cover.src = "icon.png";
    if (el("mini-cover")) el("mini-cover").src = "icon.png";
    window.velunaMotion?.clearCoverPalette?.();
    if (!id) return;
    const directCover = tags.get(id)?.cover;
    if (directCover) {
      coverData = directCover;
      cover.src = coverData;
      if (el("mini-cover")) el("mini-cover").src = coverData;
      window.velunaMotion?.applyCoverPalette?.(cover);
    }
    try {
      const data = await read(id,true);
      if (!data || id!==selected || id!==coverId) return;
      const {cover:image,...text} = data;
      tags.set(id,{...(tags.get(id) || {}), ...text});
      coverData = image || directCover || null;
      if (coverData) {
        cover.src = coverData;
        if (el("mini-cover")) el("mini-cover").src = coverData;
        window.velunaMotion?.applyCoverPalette?.(cover);
      }
      showTrack(); groupChoices(); drawList();
    } catch {}
  }
  cover.onerror = () => { if (coverData) {coverData=null;cover.src="icon.png";} };
  function favoritesChanged() {
    heart.disabled = !selected;
    heart.setAttribute("aria-pressed", String(!!window.velunaFavorites?.ids().has(selected)));
    if (view === "favorite") drawList();
  }
  heart.onclick = async () => {
    heart.disabled = true;
    try { await window.velunaFavorites?.toggle(tracks.find(t=>t.id===selected)); }
    catch (error) { msg(error.message || String(error)); }
    finally { favoritesChanged(); }
  };
  function rows(query) {
    let result = tracks;
    if (view==="queue") {
      const known = new Map(tracks.map(t=>[t.id,t]));
      result = playOrder().map((id,queueIndex)=>({...known.get(id),queueIndex})).filter(t=>t.id);
    } else if (view==="favorite") {
      const ids=window.velunaFavorites?.ids() || new Set(); result=tracks.filter(t=>ids.has(t.id));
    } else if (view==="recent" || view==="popular") {
      result=tracks.filter(t=>history.has(t.id)).sort((a,b)=>{
        const left=history.get(a.id), right=history.get(b.id);
        return (view==="popular" ? right.count-left.count : 0) || right.time-left.time;
      });
    } else if (grouped() && group) result = tracks.filter(t=>groupOf(t)===group);
    return result.map(t=>{
      const meta=tags.get(t.id);
      const ytmMeta=meta?.source==="ytmusic" || String(t.id).startsWith("ytmusic://")
        ? ["YouTube Music", meta?.recording_label, window.velunaYtm?.formatQuality?.(meta)].filter(Boolean).join(" · ")
        : "";
      const subtitle=view==="popular" ? history.get(t.id).count+" lượt phát" : [meta?.artist,meta?.album,ytmMeta].filter(Boolean).join(" · ");
      return {id:t.id,title:label(t),subtitle,queueIndex:t.queueIndex};
    }).filter(t=>!query || (t.title+" "+t.subtitle).toLocaleLowerCase().includes(query));
  }
  function refresh() {
    syncYtmTags(); favoritesChanged(); showTrack();
    if (selected!==coverId && !document.hidden) { coverId=selected; artwork(selected); }
    if (["home","popular","recent"].includes(view)) nativeHistory();
    shelves();
    if (indexing()) {groupChoices();scan();}
  }
  function select(button, initialGroup="") {
    view=button.dataset.view; group=initialGroup;
    for(const item of buttons)item.setAttribute("aria-pressed",String(item===button));
    el("library-heading").textContent=button.textContent;
    el("group-picker").hidden=!grouped();
    el("group-label").textContent=view==="album"?"Album":"Nghệ sĩ";
    refresh();drawList();
  }
  buttons.forEach(button=>button.onclick=()=>select(button));
  picker.onchange=()=>{group=picker.value;el("group-play").disabled=scanning || !group;drawList();};
  el("group-play").onclick=()=>playTrackQueue(view==="album" ? orderedAlbum(group) : tracks.filter(t=>group && groupOf(t)===group).map(t=>t.id));
  el("dj-album").onchange=e=>{el("dj-play-album").disabled=scanning || !e.target.value;};
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
  for(const [name,path] of [["gpl","GPL-3.0.txt"],["font","Poppins-OFL.txt"],["icons","Material-Apache-2.0.txt"]]){
    const output=el("license-"+name);
    output.parentElement.addEventListener("toggle",async event=>{
      if(!event.target.open || output.textContent)return;
      try {const r=await fetch("simpmusic/"+path);if(!r.ok)throw Error();output.textContent=await r.text();}
      catch {output.textContent="Không mở được giấy phép.";}
    });
  }
  window.velunaLibrary={refresh,rows,record,favoritesChanged,orderedAlbum,prepareAlbums(){albumChoices();scan();},queue:()=>view==="queue",
    newPlay:()=>{ lastStarted=""; },
    empty:()=>el("query").value?"Không tìm thấy bài phù hợp.":view==="favorite"?"Chọn trái tim trên trình phát để lưu bài yêu thích.":view==="recent" || view==="popular"?"Các bài đã phát trên thiết bị sẽ xuất hiện ở đây.":"Chưa có bài trong mục này."};
  refresh();drawList();
})();
