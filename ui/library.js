"use strict";

(() => {
  const buttons = [...document.querySelectorAll("[data-view]")];
  const picker = el("library-group"), cover = el("cover"), heart = el("now-favorite");
  const tags = new Map();
  let view = "all", scanning = false, group = "", coverId, coverData = null, lastStarted = "";
  let history = new Map();
  try { history = new Map(JSON.parse(localStorage.getItem("play-history") || "[]")); } catch {}
  const grouped = () => view === "album" || view === "artist";
  const isHomeLike = () => view === "home" || view === "discover";
  const label = t => tags.get(t.id)?.title || t.title;
  const indexing = () => grouped() || isHomeLike() || el("dj-dialog").open;
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
    const currentTrack = tracks.find(t => t.id === id);
    if (currentTrack) window.velunaHistorySync?.record?.(currentTrack);
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
  const home=el("home-shelves"), homeQuick=el("home-quick-grid"), homeMoods=el("home-moods"), homeDetail=el("home-detail"), homeYtm=el("home-ytm"), homeLocal=el("home-local"), artCache=new Map();
  let shelfKey="", quickKey="", loadingCovers=false, homeTopFilter="all";
  let homeMoodList=[], activeMoodParams="", homeLoaded=false, homeInFlight=false, homeReqSeq=0, homeLoadingMore=false;
  const homeFeedCache=new Map();
  let libFilter="all", libGridMode=localStorage.getItem("veluna-lib-grid")==="1";

  function reducedMotion() {
    if (document.body?.dataset?.motion === "off") return true;
    if (document.body?.dataset?.intensity === "reduced" || document.body?.dataset?.intensity === "economy") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function homeTypeLabel(kind) {
    if (kind === "video") return "Video";
    if (kind === "album") return "Album";
    if (kind === "playlist") return "Playlist";
    return "Bài hát";
  }

  function renderMoodChips() {
    if (!homeMoods) return;
    homeMoods.replaceChildren();
    if (!homeMoodList.length) {
      homeMoods.hidden = true;
      return;
    }
    homeMoods.hidden = false;
    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "mood-chip";
    allChip.textContent = "Tất cả";
    allChip.setAttribute("aria-pressed", String(activeMoodParams === ""));
    allChip.onclick = () => {
      if (activeMoodParams === "" && homeFeedCache.has("")) return;
      activeMoodParams = "";
      renderMoodChips();
      loadYtmHome("", false);
    };
    homeMoods.append(allChip);

    for (const chip of homeMoodList) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mood-chip";
      btn.textContent = chip.label;
      btn.setAttribute("aria-pressed", String(activeMoodParams === chip.params));
      btn.onclick = () => {
        activeMoodParams = activeMoodParams === chip.params ? "" : chip.params;
        renderMoodChips();
        loadYtmHome(activeMoodParams, false);
      };
      homeMoods.append(btn);
    }
  }

  function renderHomeSkeleton() {
    if (!homeYtm) return;
    homeYtm.replaceChildren();
    homeYtm.setAttribute("aria-busy", "true");
    for (let s = 0; s < 2; s++) {
      const wrap = document.createElement("div");
      wrap.className = "home-shelf home-skeleton";
      wrap.setAttribute("aria-hidden", "true");
      const titleBar = document.createElement("div");
      titleBar.className = "skeleton-title";
      const strip = document.createElement("div");
      strip.className = "album-strip";
      for (let i = 0; i < 5; i++) {
        const card = document.createElement("div");
        card.className = "album-card home-skeleton-card";
        const box = document.createElement("div");
        box.className = "skeleton-box";
        const line1 = document.createElement("div");
        line1.className = "skeleton-line";
        const line2 = document.createElement("div");
        line2.className = "skeleton-line is-short";
        card.append(box, line1, line2);
        strip.append(card);
      }
      wrap.append(titleBar, strip);
      homeYtm.append(wrap);
    }
  }

  function wireShelfCarousel(track, prevBtn, nextBtn, statusEl, totalSlides) {
    let lastAnnounced = "";
    let settleTimer = 0;
    let userScrolled = false;

    const slideStep = () => {
      const first = track.firstElementChild;
      if (!first) return Math.max(160, Math.round(track.clientWidth * 0.8));
      const rect = first.getBoundingClientRect();
      const perCard = rect.width > 0 ? rect.width + 12 : 160;
      const visibleCount = Math.max(1, Math.floor((track.clientWidth || perCard) / perCard));
      return Math.round(perCard * Math.max(1, visibleCount - 0.25));
    };

    const syncControls = (announce) => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const atStart = track.scrollLeft <= 2;
      const atEnd = maxScroll <= 2 || track.scrollLeft >= maxScroll - 2;
      const prevFocused = document.activeElement === prevBtn;
      const nextFocused = document.activeElement === nextBtn;
      prevBtn.disabled = atStart;
      nextBtn.disabled = atEnd;
      if (atStart && prevFocused && !nextBtn.disabled) nextBtn.focus();
      if (atEnd && nextFocused && !prevBtn.disabled) prevBtn.focus();

      if (announce && statusEl && totalSlides > 0) {
        const first = track.firstElementChild;
        const cardW = first?.getBoundingClientRect?.().width || 160;
        const idx = Math.min(totalSlides, Math.max(1, Math.round(track.scrollLeft / (cardW + 12)) + 1));
        const text = "Mục " + idx + " trên " + totalSlides;
        if (text !== lastAnnounced) {
          lastAnnounced = text;
          statusEl.textContent = text;
        }
      }
    };

    const scrollByDir = (dir) => {
      userScrolled = true;
      const behavior = reducedMotion() ? "auto" : "smooth";
      if (typeof track.scrollBy === "function") {
        track.scrollBy({ left: dir * slideStep(), behavior });
      } else {
        track.scrollLeft += dir * slideStep();
      }
      if (behavior === "auto") syncControls(true);
    };

    prevBtn.onclick = () => scrollByDir(-1);
    nextBtn.onclick = () => scrollByDir(1);

    const onSettled = () => {
      syncControls(userScrolled);
      userScrolled = false;
    };

    if ("onscrollend" in window) {
      track.addEventListener("scroll", () => { userScrolled = true; }, { passive: true });
      track.addEventListener("scrollend", onSettled, { passive: true });
    } else {
      track.addEventListener("scroll", () => {
        userScrolled = true;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(onSettled, 140);
      }, { passive: true });
    }

    syncControls(false);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => syncControls(false));
    }
  }

  function renderYtmHome(data) {
    if (!homeYtm) return;
    homeYtm.replaceChildren();
    homeYtm.removeAttribute("aria-busy");
    const shelvesList = Array.isArray(data?.shelves) ? data.shelves : [];
    if (!shelvesList.length) {
      const note = document.createElement("div");
      note.className = "home-offline-note";
      const txt = document.createElement("span");
      txt.textContent = "Chưa có đề xuất YouTube Music cho mục này.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Tải lại";
      retry.onclick = () => loadYtmHome(activeMoodParams, true);
      note.append(txt, retry);
      homeYtm.append(note);
      return;
    }

    for (const shelf of shelvesList) {
      const items = Array.isArray(shelf.items) ? shelf.items : [];
      if (!items.length) continue;

      const section = document.createElement("section");
      section.className = "home-shelf";
      section.setAttribute("aria-roledescription", "carousel");
      section.setAttribute("aria-label", shelf.title);

      const head = document.createElement("div");
      head.className = "home-shelf-head";
      const heading = document.createElement("h2");
      heading.textContent = shelf.title;

      const controls = document.createElement("div");
      controls.className = "home-shelf-controls";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "shelf-nav-btn";
      prevBtn.dataset.direction = "previous";
      prevBtn.setAttribute("aria-label", "Cuộn trái " + shelf.title);
      prevBtn.textContent = "‹";

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "shelf-nav-btn";
      nextBtn.dataset.direction = "next";
      nextBtn.setAttribute("aria-label", "Cuộn phải " + shelf.title);
      nextBtn.textContent = "›";
      controls.append(prevBtn, nextBtn);
      head.append(heading, controls);

      const track = document.createElement("div");
      track.className = "album-strip ytm-carousel-track";
      track.tabIndex = 0;
      track.setAttribute("role", "group");
      track.setAttribute("aria-label", shelf.title);

      const playable = items.filter(x => x.type === "song" || x.type === "video");

      items.forEach((item, idx) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "album-card ytm-home-card";
        card.setAttribute("role", "group");
        card.setAttribute("aria-roledescription", "slide");
        card.setAttribute("aria-label", (idx + 1) + " trên " + items.length + ": " + item.title);

        const media = document.createElement("div");
        media.className = "ytm-card-media";
        const image = window.velunaUtils.applyCoverFallback(document.createElement("img"), item.thumbnail);

        const kindChip = document.createElement("span");
        kindChip.className = "ytm-card-type";
        kindChip.textContent = homeTypeLabel(item.type);
        const playFab = document.createElement("span");
        playFab.className = "card-play-fab";
        playFab.setAttribute("aria-hidden", "true");
        media.append(image, kindChip, playFab);

        const caption = document.createElement("b");
        caption.textContent = item.title;
        card.append(media, caption);

        const subText = item.subtitle || item.artist || "";
        if (subText) {
          const by = document.createElement("small");
          by.textContent = subText;
          card.append(by);
        }

        card.onclick = () => {
          if (item.type === "song" || item.type === "video") {
            const startIdx = Math.max(0, playable.findIndex(x => x.id === item.id));
            const runPlay = () => window.velunaYtm?.playTracks?.(playable, startIdx, true)
              ?.catch?.(e => { if (typeof msg === "function") msg(String(e)); });
            if (window.velunaMotion?.transitionCover) {
              window.velunaMotion.transitionCover(image, cover, runPlay, el("title"));
            } else {
              runPlay();
            }
          } else {
            window.velunaYtm?.openHomeCollection?.(item, homeDetail);
          }
        };
        track.append(card);
      });

      const status = document.createElement("p");
      status.className = "visually-hidden";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      section.append(head, track, status);
      homeYtm.append(section);
      wireShelfCarousel(track, prevBtn, nextBtn, status, items.length);
    }

    if (data?.continuation) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "home-more-btn";
      moreBtn.textContent = homeLoadingMore ? "Đang tải thêm…" : "Tải thêm đề xuất";
      moreBtn.disabled = homeLoadingMore;
      moreBtn.onclick = async () => {
        if (homeLoadingMore) return;
        homeLoadingMore = true;
        moreBtn.disabled = true;
        moreBtn.textContent = "Đang tải thêm…";
        try {
          const more = await window.velunaYtm.home("", data.continuation);
          const merged = {
            chips: data.chips,
            shelves: [...shelvesList],
            continuation: more?.continuation || null
          };
          for (const sh of more?.shelves || []) {
            if (!merged.shelves.some(existing => existing.title === sh.title)) {
              merged.shelves.push(sh);
            }
          }
          homeFeedCache.set(activeMoodParams, merged);
          if (view === "home") renderYtmHome(merged);
        } catch {
          moreBtn.disabled = false;
          moreBtn.textContent = "Thử tải thêm lại";
        } finally {
          homeLoadingMore = false;
        }
      };
      homeYtm.append(moreBtn);
    }
  }

  function renderHomeOffline() {
    if (!homeYtm) return;
    homeYtm.replaceChildren();
    homeYtm.removeAttribute("aria-busy");
    const note = document.createElement("div");
    note.className = "home-offline-note";
    const text = document.createElement("span");
    text.textContent = "Đang ngoại tuyến — hiển thị thư viện cục bộ.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Thử lại";
    retry.onclick = () => loadYtmHome(activeMoodParams, true);
    note.append(text, retry);
    homeYtm.append(note);
  }

  async function loadYtmHome(params = activeMoodParams, force = false) {
    if (!isHomeLike() || !homeYtm) return;
    if (typeof window.velunaYtm?.home !== "function") {
      if (homeMoods) homeMoods.hidden = true;
      homeYtm.replaceChildren();
      return;
    }
    const cacheKey = String(params || "");
    if (!force && homeFeedCache.has(cacheKey)) {
      const cached = homeFeedCache.get(cacheKey);
      renderMoodChips();
      renderYtmHome(cached);
      return;
    }
    const reqId = ++homeReqSeq;
    homeInFlight = true;
    if (homeDetail && !homeDetail.hidden && force) {
      homeDetail.hidden = true;
      homeDetail.replaceChildren();
    }
    renderHomeSkeleton();
    try {
      const data = await window.velunaYtm.home(cacheKey, "");
      if (reqId !== homeReqSeq) return;
      if (Array.isArray(data?.chips) && data.chips.length && (!homeMoodList.length || cacheKey === "")) {
        homeMoodList = data.chips;
      }
      homeFeedCache.set(cacheKey, data);
      homeLoaded = true;
      if (!isHomeLike()) return;
      renderMoodChips();
      renderYtmHome(data);
    } catch {
      if (reqId !== homeReqSeq || !isHomeLike()) return;
      renderMoodChips();
      renderHomeOffline();
    } finally {
      if (reqId === homeReqSeq) homeInFlight = false;
    }
  }

  async function visibleCovers(){
    const searching = isUnifiedSearchActive();
    if(loadingCovers || (!searching && !isHomeLike()) || document.hidden)return;
    const scope = searching ? unifiedLocalList : home;
    if(!scope || typeof scope.querySelectorAll !== "function")return;
    loadingCovers=true;
    try {
      while((isUnifiedSearchActive() || isHomeLike()) && !document.hidden) {
        const activeScope = isUnifiedSearchActive() ? unifiedLocalList : home;
        if(!activeScope || typeof activeScope.querySelectorAll !== "function")break;
        const node=[...activeScope.querySelectorAll("img[data-pending]")].find(img=>{
          const box=img.getBoundingClientRect ? img.getBoundingClientRect() : {right:1,left:0,bottom:1,top:0};
          return box.right>=0 && box.left<(typeof innerWidth==="number"?innerWidth:1920) && box.bottom>=0 && box.top<(typeof innerHeight==="number"?innerHeight:1080)+100;
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
  const isDummyTrack = t => window.velunaUtils.isDummyTrack(t);
  function renderQuickGrid(){
    if(!homeQuick)return;
    const searching = isUnifiedSearchActive();
    if(searching || view!=="home"){homeQuick.hidden=true;return;}
    const tiles=[];
    const seenIds=new Set();
    const realTracks=tracks.filter(t=>!isDummyTrack(t));
    const savedPlaylists=(window.velunaPlaylists?.list?.() || []).filter(p=>p.count>0);
    for(const pl of savedPlaylists.slice(0,3)){
      tiles.push({kind:"playlist",id:"pl:"+pl.id,playlistId:pl.id,title:pl.name,sub:pl.count+" bài",cover:""});
      seenIds.add("pl:"+pl.id);
    }
    const recentTracks=realTracks.filter(t=>history.has(t.id)).sort((a,b)=>history.get(b.id).time-history.get(a.id).time);
    for(const t of recentTracks){
      if(tiles.length>=6)break;
      if(seenIds.has(t.id))continue;
      const meta=tags.get(t.id) || {};
      tiles.push({kind:"track",id:t.id,title:label(t),sub:meta.artist || "",cover:meta.cover || t.thumbnail || ""});
      seenIds.add(t.id);
    }
    if(tiles.length<6){
      for(const t of realTracks){
        if(tiles.length>=6)break;
        if(seenIds.has(t.id))continue;
        const meta=tags.get(t.id) || {};
        tiles.push({kind:"track",id:t.id,title:label(t),sub:meta.artist || "",cover:meta.cover || t.thumbnail || ""});
        seenIds.add(t.id);
      }
    }
    if(!tiles.length){homeQuick.hidden=true;homeQuick.replaceChildren();quickKey="";return;}
    homeQuick.hidden=false;
    const nextKey=JSON.stringify(tiles.map(t=>[t.id,t.title,t.sub,t.cover]));
    if(quickKey===nextKey)return;
    quickKey=nextKey;
    homeQuick.replaceChildren();
    for(const tile of tiles){
      const btn=document.createElement("button");
      btn.type="button";
      btn.className="quick-tile";
      const img = window.velunaUtils.applyCoverFallback(document.createElement("img"), tile.cover);
      if(tile.kind==="track" && !tile.cover)img.dataset.pending=tile.id;
      const text=document.createElement("span");
      text.className="quick-tile-text";
      const strong=document.createElement("strong");
      strong.textContent=tile.title;
      text.append(strong);
      if(tile.sub){const sm=document.createElement("small");sm.textContent=tile.sub;text.append(sm);}
      const playDot=document.createElement("span");
      playDot.className="quick-play-fab";
      playDot.setAttribute("aria-hidden","true");
      btn.append(img,text,playDot);
      btn.onclick=()=>{
        if(tile.kind==="playlist"){window.velunaPlaylists?.playById?.(tile.playlistId);return;}
        if(window.velunaMotion?.transitionCover)window.velunaMotion.transitionCover(img,cover,()=>loadTrack(tile.id,true),el("title"));
        else loadTrack(tile.id,true);
      };
      homeQuick.append(btn);
    }
  }
  function shelves(){
    const searching = isUnifiedSearchActive();
    home.hidden = searching || !isHomeLike();
    const target = homeLocal || home;
    renderQuickGrid();
    if(home.hidden){if(shelfKey && !searching){target.replaceChildren();shelfKey="";}return;}
    const realTracks=tracks.filter(t=>!isDummyTrack(t));
    const recent=realTracks.filter(t=>history.has(t.id)).sort((a,b)=>history.get(b.id).time-history.get(a.id).time).slice(0,8);
    const albums=new Map();
    for(const t of realTracks){const key=albumKey(tags.get(t.id));if(key && !albums.has(key))albums.set(key,t);if(albums.size===12)break;}
    const albumsList=[...albums].map(([key,t])=>({id:t.id,title:tags.get(t.id).album,sub:tags.get(t.id).album_artist || tags.get(t.id).artist,key}));
    const recentList=recent.map(t=>({id:t.id,title:label(t),sub:tags.get(t.id)?.artist}));
    const next=JSON.stringify([recentList,albumsList]);
    if(shelfKey===next)return;
    target.replaceChildren();shelfKey=next;
    let renderedCount=0;
    for(const [name,items] of [["Nghe gần đây",recentList],["Album trong thư viện",albumsList]]){
      if(!items.length)continue;
      renderedCount++;
      const title=document.createElement("h2"),rail=document.createElement("div");
      title.textContent=name;rail.className="album-strip";rail.addEventListener("scroll",visibleCovers,{passive:true});
      for(const item of items){
        const button=document.createElement("button"),media=document.createElement("div"),image=document.createElement("img"),fab=document.createElement("span"),caption=document.createElement("b");
        button.type="button";button.className="album-card";
        media.className="ytm-card-media";
        image.src="icon.png";image.alt="";image.dataset.pending=item.id;
        fab.className="card-play-fab";fab.setAttribute("aria-hidden","true");
        media.append(image,fab);
        caption.textContent=item.title;
        button.append(media,caption);
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
      target.append(title,rail);
    }
    if(homeLocal)homeLocal.hidden=renderedCount===0;
    visibleCovers();
  }
  window.addEventListener("scroll",visibleCovers,{passive:true});
  window.addEventListener("resize",visibleCovers,{passive:true});
  document.querySelector?.(".collection")?.addEventListener?.("scroll",visibleCovers,{passive:true});
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
  const unifiedPanel = el("unified-search");
  const unifiedDetail = el("unified-detail");
  const unifiedLocalSec = el("unified-local");
  const unifiedLocalCount = el("unified-local-count");
  const unifiedLocalList = el("unified-local-list");
  const unifiedYtmCount = el("unified-ytm-count");
  const unifiedYtmList = el("unified-ytm-list");
  const unifiedYtmFilters = el("unified-ytm-filters");
  const queryInput = el("query");
  const queryClearBtn = el("query-clear");
  const listEl = el("list");
  let searchSeqId = 0, ytmSearchFilter = "all", lastUnifiedQuery = "";
  const debouncedYtmSearch = window.velunaUtils.debounce((q, filter, seq) => runYtmUnifiedSearch(q, filter, seq, false), 350);
  const ytmSearchCache = new Map();

  const normalizeSearchText = value => window.velunaUtils.normalizeSearchText(value);

  function isUnifiedSearchActive() {
    return Boolean(unifiedPanel && queryInput && String(queryInput.value || "").trim().length > 0);
  }

  function searchLocal(rawQuery) {
    const nq = normalizeSearchText(rawQuery);
    if (!nq) return { tracks: [], albums: [], artists: [], total: 0 };
    const matchedTracks = [];
    const albumMap = new Map();
    const artistMap = new Map();

    for (const t of tracks) {
      const meta = tags.get(t.id) || {};
      const title = label(t);
      const artist = meta.artist || t.artist || t.artist_text || "";
      const albumName = typeof meta.album === "object" && meta.album ? (meta.album.name || "") : (meta.album || (typeof t.album === "string" ? t.album : "") || "");
      const hay = normalizeSearchText([title, artist, albumName].join(" "));
      if (hay.includes(nq)) {
        const isYtm = meta.source === "ytmusic" || String(t.id).startsWith("ytmusic://");
        matchedTracks.push({
          id: t.id,
          title,
          artist,
          album: albumName,
          subtitle: [artist, albumName].filter(Boolean).join(" · "),
          cover: meta.cover || t.thumbnail || "",
          sourceLabel: isYtm ? "YT Music · Đã lưu" : "Thiết bị",
          duration_text: meta.duration_text || t.duration_text || ""
        });
      }

      const aKey = albumKey(meta);
      if (aKey) {
        const albTitle = meta.album || "";
        const albArtist = meta.album_artist || artist;
        if (normalizeSearchText(albTitle + " " + albArtist).includes(nq)) {
          if (!albumMap.has(aKey)) {
            albumMap.set(aKey, {
              key: aKey,
              title: albTitle,
              artist: albArtist,
              cover: meta.cover || "",
              sampleId: t.id,
              trackIds: []
            });
          }
          albumMap.get(aKey).trackIds.push(t.id);
        }
      }

      if (artist && normalizeSearchText(artist).includes(nq)) {
        const artKey = normalizeSearchText(artist);
        if (!artistMap.has(artKey)) {
          artistMap.set(artKey, { name: artist, trackIds: [] });
        }
        artistMap.get(artKey).trackIds.push(t.id);
      }
    }

    const matchedAlbums = [...albumMap.values()].slice(0, 10);
    const matchedArtists = [...artistMap.values()].slice(0, 8);
    return {
      tracks: matchedTracks,
      albums: matchedAlbums,
      artists: matchedArtists,
      total: matchedTracks.length + matchedAlbums.length + matchedArtists.length
    };
  }

  function enqueueLocalIds(ids) {
    const clean = (ids || []).filter(Boolean);
    if (!clean.length) return 0;
    const base = typeof playOrder === "function" ? playOrder().slice() : tracks.map(t => t.id);
    let added = 0;
    for (const id of clean) {
      if (!base.includes(id)) {
        base.push(id);
        added++;
      }
    }
    if (typeof albumQueue !== "undefined") {
      albumQueue = base;
    }
    if (typeof native !== "undefined" && native?.reorderQueue) {
      try { native.reorderQueue(JSON.stringify(base)); } catch {}
    } else if (typeof savePosition === "function") {
      try { savePosition(); } catch {}
    }
    if (typeof msg === "function") {
      msg(added ? "Đã thêm " + added + " bài vào hàng chờ." : "Bài đã có trong hàng chờ.");
    }
    return added;
  }

  const createSearchCard = opts => window.velunaUtils.createTrackCard(opts);

  function renderLocalSearchSection(localRes) {
    if (!unifiedLocalList || !unifiedLocalCount) return;
    unifiedLocalCount.textContent = String(localRes.total);
    unifiedLocalList.replaceChildren();
    unifiedLocalSec?.classList?.toggle("is-empty", localRes.total === 0);

    if (localRes.total === 0) {
      const hint = document.createElement("p");
      hint.className = "search-empty-hint";
      hint.textContent = "Không có bài nội bộ khớp từ khóa.";
      unifiedLocalList.append(hint);
      return;
    }

    for (const item of localRes.tracks) {
      const isYtmTrack = String(item.id).startsWith("ytmusic://");
      const cachedOffline = isYtmTrack && Boolean(window.velunaYtm?.isOffline?.(item.id));
      const { row, img } = createSearchCard({
        title: item.title,
        subtitle: item.subtitle,
        duration: item.duration_text,
        coverUrl: item.cover || artCache.get(item.id) || "",
        sourceBadgeText: item.sourceLabel,
        isOffline: cachedOffline,
        onPlay: () => {
          const go = () => loadTrack(item.id, true);
          if (window.velunaMotion?.transitionCover) window.velunaMotion.transitionCover(img, cover, go, el("title"));
          else go();
        },
        onDownload: isYtmTrack ? async () => {
          try {
            if (window.velunaYtm?.isOffline?.(item.id)) await window.velunaYtm.deleteOffline(item.id);
            else await window.velunaYtm?.downloadTrack?.(item.id);
          } catch (e) { if (typeof msg === "function") msg(e?.message || String(e)); }
        } : null,
        onQueue: () => enqueueLocalIds([item.id])
      });
      if (!item.cover) img.dataset.pending = item.id;
      unifiedLocalList.append(row);
    }

    for (const alb of localRes.albums) {
      const { row } = createSearchCard({
        title: alb.title,
        subtitle: [alb.artist, alb.trackIds.length + " bài"].filter(Boolean).join(" · "),
        coverUrl: alb.cover || "",
        sourceBadgeText: "Thiết bị",
        variantText: "Album",
        onPlay: () => {
          const ordered = orderedAlbum(alb.key);
          playTrackQueue(ordered.length ? ordered : alb.trackIds);
        },
        onQueue: () => {
          const ordered = orderedAlbum(alb.key);
          enqueueLocalIds(ordered.length ? ordered : alb.trackIds);
        }
      });
      unifiedLocalList.append(row);
    }

    for (const art of localRes.artists) {
      const { row } = createSearchCard({
        title: art.name,
        subtitle: art.trackIds.length + " bài trong thư viện",
        sourceBadgeText: "Thiết bị",
        variantText: "Nghệ sĩ",
        onPlay: () => playTrackQueue(art.trackIds),
        onQueue: () => enqueueLocalIds(art.trackIds)
      });
      unifiedLocalList.append(row);
    }
    visibleCovers();
  }

  function renderYtmSearchSkeleton() {
    if (!unifiedYtmList || !unifiedYtmCount) return;
    unifiedYtmCount.textContent = "…";
    unifiedYtmList.replaceChildren();
    unifiedYtmList.setAttribute("aria-busy", "true");
    for (let i = 0; i < 4; i++) {
      const sk = document.createElement("div");
      sk.className = "search-row search-skeleton-row";
      sk.setAttribute("aria-hidden", "true");
      const box = document.createElement("div");
      box.className = "skeleton-box search-skeleton-thumb";
      const lines = document.createElement("div");
      lines.className = "search-skeleton-lines";
      const l1 = document.createElement("div");
      l1.className = "skeleton-line";
      const l2 = document.createElement("div");
      l2.className = "skeleton-line is-short";
      lines.append(l1, l2);
      sk.append(box, lines);
      unifiedYtmList.append(sk);
    }
  }

  function renderYtmSearchOffline(queryText, filter) {
    if (!unifiedYtmList || !unifiedYtmCount) return;
    unifiedYtmList.removeAttribute("aria-busy");
    unifiedYtmCount.textContent = "0";
    unifiedYtmList.replaceChildren();
    const note = document.createElement("div");
    note.className = "home-offline-note";
    const text = document.createElement("span");
    text.textContent = "Không thể kết nối YouTube Music (đang ngoại tuyến). Kết quả trong thư viện phía trên vẫn khả dụng.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Thử lại";
    retry.onclick = () => {
      const seq = ++searchSeqId;
      runYtmUnifiedSearch(queryText, filter, seq, true);
    };
    note.append(text, retry);
    unifiedYtmList.append(note);
  }

  function renderYtmSearchSection(res, filter) {
    if (!unifiedYtmList || !unifiedYtmCount) return;
    unifiedYtmList.removeAttribute("aria-busy");
    unifiedYtmList.replaceChildren();

    const songItems = filter === "all" || filter === "songs" ? (res?.tracks || []) : [];
    const videoItems = filter === "all" || filter === "videos" ? (res?.videos || []) : [];
    const albumItems = filter === "all" || filter === "albums" ? (res?.albums || []) : [];
    const playlistItems = filter === "all" || filter === "playlists" ? (res?.playlists || []) : [];
    const total = songItems.length + videoItems.length + albumItems.length + playlistItems.length;
    unifiedYtmCount.textContent = String(total);

    if (total === 0) {
      const hint = document.createElement("p");
      hint.className = "search-empty-hint";
      hint.textContent = "Không tìm thấy kết quả phù hợp trên YouTube Music.";
      unifiedYtmList.append(hint);
      return;
    }

    const addTrackGroup = (list, isVideo) => {
      list.forEach((tr, idx) => {
        const thumb = tr.thumbnail || (Array.isArray(tr.thumbnails) && tr.thumbnails.length ? tr.thumbnails[tr.thumbnails.length - 1] : "");
        const artistName = tr.artist || tr.artist_text || (Array.isArray(tr.artists) ? tr.artists.map(a => a.name).filter(Boolean).join(", ") : "");
        const variant = isVideo ? "Video" : (tr.recording_label || "");
        const vid = tr.video_id || tr.id || "";
        const cachedOffline = Boolean(window.velunaYtm?.isOffline?.(vid));
        const { row, img } = createSearchCard({
          title: tr.title,
          subtitle: artistName,
          duration: tr.duration_text || "",
          coverUrl: thumb,
          sourceBadgeText: "YT Music",
          variantText: variant,
          isOffline: cachedOffline,
          onPlay: () => {
            const go = () => window.velunaYtm?.playTracks?.(list, idx, true)
              ?.catch?.(e => { if (typeof msg === "function") msg(String(e)); });
            if (window.velunaMotion?.transitionCover) window.velunaMotion.transitionCover(img, cover, go, el("title"));
            else go();
          },
          onDownload: async () => {
            try {
              if (window.velunaYtm?.isOffline?.(vid)) await window.velunaYtm.deleteOffline(vid);
              else await window.velunaYtm?.downloadTrack?.(tr);
            } catch (e) { if (typeof msg === "function") msg(e?.message || String(e)); }
          },
          onQueue: async () => {
            try {
              const count = await window.velunaYtm?.enqueueTracks?.([tr]);
              if (typeof msg === "function") msg(count ? "Đã thêm \"" + tr.title + "\" vào hàng chờ." : "Không thể thêm vào hàng chờ.");
            } catch (e) {
              if (typeof msg === "function") msg(String(e));
            }
          }
        });
        unifiedYtmList.append(row);
      });
    };

    addTrackGroup(songItems, false);
    addTrackGroup(videoItems, true);

    for (const alb of albumItems) {
      const thumb = Array.isArray(alb.thumbnails) && alb.thumbnails.length ? alb.thumbnails[alb.thumbnails.length - 1] : "";
      const artistName = Array.isArray(alb.artists) ? alb.artists.map(a => a.name).filter(Boolean).join(", ") : "";
      const itemObj = {
        id: alb.browse_id,
        browse_id: alb.browse_id,
        title: alb.title,
        artist: artistName,
        subtitle: [artistName, alb.year].filter(Boolean).join(" · "),
        thumbnail: thumb,
        type: "album"
      };
      const openAlb = () => window.velunaYtm?.openHomeCollection?.(itemObj, unifiedDetail);
      const { row } = createSearchCard({
        title: alb.title,
        subtitle: itemObj.subtitle,
        coverUrl: thumb,
        sourceBadgeText: "YT Music",
        variantText: "Album",
        onPlay: openAlb,
        onQueue: openAlb,
        queueLabel: "Xem bài"
      });
      unifiedYtmList.append(row);
    }

    for (const pl of playlistItems) {
      const thumb = Array.isArray(pl.thumbnails) && pl.thumbnails.length ? pl.thumbnails[pl.thumbnails.length - 1] : "";
      const itemObj = {
        id: pl.browse_id,
        browse_id: pl.browse_id,
        title: pl.title,
        artist: pl.author || "",
        subtitle: [pl.author, pl.track_count_text].filter(Boolean).join(" · "),
        thumbnail: thumb,
        type: "playlist"
      };
      const openPl = () => window.velunaYtm?.openHomeCollection?.(itemObj, unifiedDetail);
      const { row } = createSearchCard({
        title: pl.title,
        subtitle: itemObj.subtitle,
        coverUrl: thumb,
        sourceBadgeText: "YT Music",
        variantText: "Playlist",
        onPlay: openPl,
        onQueue: openPl,
        queueLabel: "Xem bài"
      });
      unifiedYtmList.append(row);
    }
  }

  async function runYtmUnifiedSearch(queryText, filter, seq, force = false) {
    if (seq !== searchSeqId) return null;
    if (typeof window.velunaYtm?.search !== "function") {
      renderYtmSearchOffline(queryText, filter);
      return null;
    }
    const cacheKey = filter + "\0" + normalizeSearchText(queryText);
    if (!force && ytmSearchCache.has(cacheKey)) {
      const cached = ytmSearchCache.get(cacheKey);
      if (seq === searchSeqId) renderYtmSearchSection(cached, filter);
      return cached;
    }
    renderYtmSearchSkeleton();
    try {
      const res = await window.velunaYtm.search(queryText, filter);
      if (seq !== searchSeqId) return null;
      if (queryInput && String(queryInput.value || "").trim() !== queryText) return null;
      if (ytmSearchCache.size >= 32) ytmSearchCache.delete(ytmSearchCache.keys().next().value);
      ytmSearchCache.set(cacheKey, res);
      renderYtmSearchSection(res, filter);
      return res;
    } catch {
      if (seq !== searchSeqId) return null;
      if (queryInput && String(queryInput.value || "").trim() !== queryText) return null;
      renderYtmSearchOffline(queryText, filter);
      return null;
    }
  }

  function resetUnifiedSearch() {
    debouncedYtmSearch.cancel();
    searchSeqId++;
    lastUnifiedQuery = "";
    if (queryClearBtn) queryClearBtn.hidden = true;
    if (unifiedPanel) unifiedPanel.hidden = true;
    if (unifiedDetail) { unifiedDetail.hidden = true; unifiedDetail.replaceChildren(); }
    if (unifiedLocalList) unifiedLocalList.replaceChildren();
    if (unifiedYtmList) { unifiedYtmList.removeAttribute("aria-busy"); unifiedYtmList.replaceChildren(); }
    if (listEl) listEl.hidden = false;
    if (el("group-picker")) el("group-picker").hidden = !grouped();
    shelves();
    syncLibraryFilterBar();
    syncMobileTabs();
    drawList();
  }

  function onSearchInput(immediateYtm = false) {
    const raw = String(queryInput?.value || "");
    const trimmed = raw.trim();
    debouncedYtmSearch.cancel();
    const seq = ++searchSeqId;
    if (queryClearBtn) queryClearBtn.hidden = !raw.length;

    if (!trimmed) {
      resetUnifiedSearch();
      return seq;
    }

    if (unifiedPanel) {
      if (lastUnifiedQuery !== trimmed && unifiedDetail) {
        unifiedDetail.hidden = true;
        unifiedDetail.replaceChildren();
      }
      lastUnifiedQuery = trimmed;
      unifiedPanel.hidden = false;
      if (home) home.hidden = true;
      if (el("group-picker")) el("group-picker").hidden = true;
      if (listEl) listEl.hidden = true;
      syncLibraryFilterBar();
      syncMobileTabs();

      renderLocalSearchSection(searchLocal(trimmed));

      const cacheKey = ytmSearchFilter + "\0" + normalizeSearchText(trimmed);
      if (immediateYtm || ytmSearchCache.has(cacheKey)) {
        runYtmUnifiedSearch(trimmed, ytmSearchFilter, seq, false);
      } else {
        renderYtmSearchSkeleton();
        debouncedYtmSearch.call(trimmed, ytmSearchFilter, seq);
      }
    } else {
      drawList();
    }
    return seq;
  }

  function setYtmSearchFilter(nextFilter) {
    const valid = ["all", "songs", "videos", "albums", "playlists"];
    ytmSearchFilter = valid.includes(nextFilter) ? nextFilter : "all";
    if (unifiedYtmFilters) {
      for (const btn of unifiedYtmFilters.querySelectorAll?.("[data-ytm-filter]") || []) {
        btn.setAttribute("aria-pressed", String(btn.dataset.ytmFilter === ytmSearchFilter));
      }
    }
    if (unifiedDetail) { unifiedDetail.hidden = true; unifiedDetail.replaceChildren(); }
    if (isUnifiedSearchActive()) onSearchInput(true);
  }

  if (queryInput) {
    queryInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.isComposing || event.keyCode === 229) return;
        onSearchInput(true);
      }
    });
  }
  if (queryClearBtn) {
    queryClearBtn.onclick = () => {
      if (queryInput) { queryInput.value = ""; queryInput.focus?.(); }
      resetUnifiedSearch();
    };
  }
  if (unifiedYtmFilters) {
    for (const btn of unifiedYtmFilters.querySelectorAll?.("[data-ytm-filter]") || []) {
      btn.onclick = () => setYtmSearchFilter(btn.dataset.ytmFilter);
    }
  }

  const navStack = ["all"];
  let navPos = 0;
  function syncNavButtons() {
    const back = el("nav-back"), fwd = el("nav-forward");
    if (back) back.disabled = navPos <= 0 && !isUnifiedSearchActive();
    if (fwd) fwd.disabled = navPos >= navStack.length - 1;
  }
  function syncMobileTabs() {
    const tabs = [...(document.querySelectorAll?.("[data-mobile-tab]") || [])];
    if (!tabs.length) return;
    const activeTab = isUnifiedSearchActive() || document.body?.dataset?.mobileSearch === "true"
      ? "search"
      : (isHomeLike() ? "home" : "library");
    for (const tab of tabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.mobileTab === activeTab));
    }
  }
  function renderLibraryPlaylists() {
    const grid = el("library-playlists-grid");
    if (!grid) return;
    const show = !isUnifiedSearchActive() && !isHomeLike() && (view === "playlists" || libFilter === "playlist");
    grid.hidden = !show;
    if (listEl && !isUnifiedSearchActive()) listEl.hidden = show || isHomeLike();
    if (!show) return;
    grid.replaceChildren();
    const items = (window.velunaPlaylists?.list?.() || []).filter(pl => pl.count > 0 || pl.kind !== "favorite" || tracks.length > 0);
    for (const pl of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-tile lib-playlist-card";
      const img = document.createElement("img");
      img.src = "icon.png";
      img.alt = "";
      const txt = document.createElement("span");
      txt.className = "quick-tile-text";
      const name = document.createElement("strong");
      name.textContent = pl.name;
      const meta = document.createElement("small");
      meta.textContent = pl.count + " bài" + (pl.kind === "favorite" ? " · Yêu thích" : "");
      txt.append(name, meta);
      btn.append(img, txt);
      btn.onclick = () => window.velunaPlaylists?.playById?.(pl.id);
      grid.append(btn);
    }
    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "lib-playlist-manage";
    manageBtn.textContent = "Quản lý / Tạo playlist mới";
    manageBtn.onclick = () => {
      const panel = el("playlist-panel");
      if (panel) { panel.open = true; panel.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" }); }
    };
    grid.append(manageBtn);
  }
  function syncLibraryFilterBar() {
    const hideLib = isUnifiedSearchActive() || isHomeLike();
    const bar = el("library-filter-bar");
    if (bar) bar.hidden = hideLib;
    if (el("add")) el("add").hidden = isHomeLike();
    for (const srcPanel of document.querySelectorAll?.(".source-library") || []) {
      srcPanel.hidden = isHomeLike();
    }
    const chips = el("library-filter-chips")?.querySelectorAll?.("[data-lib-filter]") || [];
    for (const chip of chips) {
      chip.setAttribute("aria-pressed", String(chip.dataset.libFilter === libFilter));
    }
    const toggleBtn = el("library-layout-toggle");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-pressed", String(libGridMode));
      const glyph = toggleBtn.querySelector?.(".glyph");
      if (glyph?.style?.setProperty) glyph.style.setProperty("--glyph", libGridMode ? "url(simpmusic/list.svg)" : "url(simpmusic/grid.svg)");
    }
    listEl?.classList?.toggle?.("is-grid", libGridMode && view !== "queue");
    renderLibraryPlaylists();
    syncNavButtons();
  }
  function applyLibraryFilter(nextFilter) {
    libFilter = nextFilter;
    if (nextFilter === "artist") {
      const btn = buttons.find(b => b.dataset.view === "artist");
      if (btn) { select(btn); return; }
    } else if (nextFilter === "album") {
      const btn = buttons.find(b => b.dataset.view === "album");
      if (btn) { select(btn); return; }
    } else if (nextFilter === "playlist") {
      const btn = buttons.find(b => b.dataset.view === "playlists");
      if (btn) { select(btn); return; }
    } else if (nextFilter === "all" || nextFilter === "downloaded") {
      if (view !== "all") {
        view = "all";
        group = "";
        for (const item of buttons) item.setAttribute("aria-pressed", String(item.dataset.view === "all"));
        el("library-heading").textContent = "Thư viện";
        el("group-picker").hidden = true;
      }
    }
    syncLibraryFilterBar();
    drawList();
  }

  function rows(query) {
    const nq = normalizeSearchText(query);
    const hasRealTracks = tracks.some(t => !isDummyTrack(t));
    let result = (!hasRealTracks && !nq.includes("veluna qa")) ? tracks.filter(t => !isDummyTrack(t)) : tracks;
    if (view==="queue") {
      const known = new Map(tracks.map(t=>[t.id,t]));
      result = playOrder().map((id,queueIndex)=>({...known.get(id),queueIndex})).filter(t=>t.id);
    } else if (view==="favorite") {
      const ids=window.velunaFavorites?.ids() || new Set(); result=result.filter(t=>ids.has(t.id));
    } else if (view==="recent" || view==="popular") {
      result=result.filter(t=>history.has(t.id)).sort((a,b)=>{
        const left=history.get(a.id), right=history.get(b.id);
        return (view==="popular" ? right.count-left.count : 0) || right.time-left.time;
      });
    } else if (grouped() && group) result = result.filter(t=>groupOf(t)===group);
    else if (view==="all" && libFilter==="downloaded") result = result.filter(t=>!String(t.id).startsWith("ytmusic://") || window.velunaYtm?.isOffline?.(t.id));
    return result.map(t=>{
      const meta=tags.get(t.id);
      const isOffline = Boolean(window.velunaYtm?.isOffline?.(t.id));
      const ytmMeta=meta?.source==="ytmusic" || String(t.id).startsWith("ytmusic://")
        ? [isOffline ? "Đã tải về" : "YouTube Music", meta?.recording_label, window.velunaYtm?.formatQuality?.(meta)].filter(Boolean).join(" · ")
        : "";
      const subtitle=view==="popular" ? history.get(t.id).count+" lượt phát" : [meta?.artist,meta?.album,ytmMeta].filter(Boolean).join(" · ");
      return {id:t.id,title:label(t),subtitle,queueIndex:t.queueIndex,offline:isOffline};
    }).filter(t=>!nq || normalizeSearchText(t.title+" "+t.subtitle).includes(nq));
  }
  function renderUpNext() {
    const list = el("now-up-next-list");
    if (!list) return;
    const order = typeof playOrder === "function" ? playOrder() : tracks.map(t => t.id);
    const byId = new Map(tracks.map(t => [t.id, t]));
    const repeatMode = el("repeat-mode")?.value || "off";
    const idx = selected ? order.indexOf(selected) : -1;
    const upcomingIds = [];
    if (order.length) {
      if (idx >= 0) {
        for (let i = idx + 1; i < order.length && upcomingIds.length < 5; i++) upcomingIds.push(order[i]);
        if (repeatMode === "all" && order.length > 1) {
          for (let i = 0; i < idx && upcomingIds.length < 5; i++) upcomingIds.push(order[i]);
        }
      } else {
        for (let i = 0; i < order.length && upcomingIds.length < 5; i++) upcomingIds.push(order[i]);
      }
    }
    const items = upcomingIds.map(id => byId.get(id)).filter(t => t && !isDummyTrack(t));
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "up-next-empty";
      empty.textContent = selected ? "Đã đến cuối hàng chờ hiện tại." : "Chọn một bài hát để xem hàng chờ tiếp theo.";
      list.append(empty);
      return;
    }
    for (const track of items) {
      const meta = tags.get(track.id) || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "up-next-row";
      const img = window.velunaUtils.applyCoverFallback(
        document.createElement("img"),
        meta.cover || track.thumbnail || artCache.get(track.id)
      );
      const txt = document.createElement("span");
      txt.className = "up-next-meta";
      const strong = document.createElement("strong");
      strong.textContent = label(track);
      const small = document.createElement("small");
      small.textContent = meta.artist || track.artist || track.artist_text || (String(track.id).startsWith("ytmusic://") ? "YouTube Music" : "Thiết bị");
      txt.append(strong, small);
      btn.append(img, txt);
      btn.onclick = () => loadTrack(track.id, true);
      list.append(btn);
    }
  }
  if (el("now-up-next-all")) {
    el("now-up-next-all").onclick = () => {
      if (document.body?.dataset) delete document.body.dataset.nowOpen;
      const queueBtn = buttons.find(b => b.dataset.view === "queue");
      if (queueBtn) select(queueBtn);
    };
  }
  function refresh() {
    syncYtmTags(); favoritesChanged(); showTrack();
    if (selected!==coverId && !document.hidden) { coverId=selected; artwork(selected); }
    if (["home","discover","popular","recent"].includes(view)) nativeHistory();
    shelves();
    syncLibraryFilterBar();
    syncMobileTabs();
    renderUpNext();
    if (isUnifiedSearchActive()) {
      renderLocalSearchSection(searchLocal(queryInput.value));
    } else if (isHomeLike() && !document.hidden) {
      if (!homeLoaded && !homeInFlight) loadYtmHome(activeMoodParams, false);
      else if (homeLoaded && homeYtm && !homeYtm.childElementCount) loadYtmHome(activeMoodParams, false);
    }
    if (indexing()) {groupChoices();scan();}
  }
  function select(button, initialGroup="", fromHistory=false) {
    if (!button) return;
    const nextView = button.dataset.view;
    if (!fromHistory && nextView && navStack[navPos] !== nextView) {
      navStack.splice(navPos + 1);
      navStack.push(nextView);
      if (navStack.length > 30) navStack.shift();
      navPos = navStack.length - 1;
    }
    view=nextView; group=initialGroup;
    if (view==="album") libFilter="album";
    else if (view==="artist") libFilter="artist";
    else if (view==="playlists") libFilter="playlist";
    else if (view==="all" && !["all","downloaded","playlist"].includes(libFilter)) libFilter="all";
    else if (!["all","album","artist","playlists"].includes(view)) libFilter="all";
    if (document.body?.dataset) delete document.body.dataset.mobileSearch;
    for(const item of buttons)item.setAttribute("aria-pressed",String(item===button));
    el("library-heading").textContent=button.textContent;
    if (queryInput && queryInput.value) {
      queryInput.value = "";
      resetUnifiedSearch();
    }
    el("group-picker").hidden=!grouped();
    el("group-label").textContent=view==="album"?"Album":"Nghệ sĩ";
    refresh();drawList();
  }
  buttons.forEach(button=>button.onclick=()=>select(button));
  if (el("nav-back")) {
    el("nav-back").onclick = () => {
      if (isUnifiedSearchActive()) {
        if (queryInput) queryInput.value = "";
        resetUnifiedSearch();
        return;
      }
      if (navPos > 0) {
        navPos--;
        const targetBtn = buttons.find(b => b.dataset.view === navStack[navPos]);
        if (targetBtn) select(targetBtn, "", true);
      }
    };
  }
  if (el("nav-forward")) {
    el("nav-forward").onclick = () => {
      if (navPos < navStack.length - 1) {
        navPos++;
        const targetBtn = buttons.find(b => b.dataset.view === navStack[navPos]);
        if (targetBtn) select(targetBtn, "", true);
      }
    };
  }
  if (el("home-avatar")) el("home-avatar").onclick = () => el("account")?.click();
  for (const pill of el("home-top-pills")?.querySelectorAll?.("[data-home-pill]") || []) {
    pill.onclick = () => {
      homeTopFilter = pill.dataset.homePill || "all";
      for (const p of el("home-top-pills").querySelectorAll("[data-home-pill]")) {
        p.setAttribute("aria-pressed", String(p === pill));
      }
      if (homeTopFilter === "moods") {
        if (!homeLoaded && !homeInFlight) loadYtmHome(activeMoodParams, false);
        homeMoods?.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
      }
      if (homeMoods && homeMoodList.length) homeMoods.hidden = homeTopFilter === "music";
    };
  }
  for (const chip of el("library-filter-chips")?.querySelectorAll?.("[data-lib-filter]") || []) {
    chip.onclick = () => applyLibraryFilter(chip.dataset.libFilter || "all");
  }
  if (el("library-layout-toggle")) {
    el("library-layout-toggle").onclick = () => {
      libGridMode = !libGridMode;
      try { localStorage.setItem("veluna-lib-grid", libGridMode ? "1" : "0"); } catch {}
      syncLibraryFilterBar();
    };
  }
  for (const tab of document.querySelectorAll?.("[data-mobile-tab]") || []) {
    tab.onclick = () => {
      const target = tab.dataset.mobileTab;
      if (document.body?.dataset) delete document.body.dataset.nowOpen;
      if (target === "home") {
        if (document.body?.dataset) delete document.body.dataset.mobileSearch;
        select(buttons.find(b => b.dataset.view === "home"));
      } else if (target === "search") {
        if (document.body?.dataset) document.body.dataset.mobileSearch = "true";
        if (view === "home") {
          const libBtn = buttons.find(b => b.dataset.view === "all");
          if (libBtn) select(libBtn);
          if (document.body?.dataset) document.body.dataset.mobileSearch = "true";
        }
        syncMobileTabs();
        queryInput?.focus?.();
        queryInput?.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      } else {
        if (document.body?.dataset) delete document.body.dataset.mobileSearch;
        libFilter = "all";
        select(buttons.find(b => b.dataset.view === "all"));
      }
    };
  }
  window.addEventListener?.("veluna-playlists-change", () => {
    quickKey = "";
    if (view === "home") renderQuickGrid();
    if (libFilter === "playlist") renderLibraryPlaylists();
  });
  window.addEventListener?.("veluna-offline-change", () => {
    if (isUnifiedSearchActive()) {
      renderLocalSearchSection(searchLocal(queryInput.value));
      const cacheKey = ytmSearchFilter + "\0" + normalizeSearchText(queryInput.value);
      if (ytmSearchCache.has(cacheKey)) renderYtmSearchSection(ytmSearchCache.get(cacheKey), ytmSearchFilter);
    }
    drawList();
  });
  picker.onchange=()=>{group=picker.value;el("group-play").disabled=scanning || !group;drawList();};
  el("group-play").onclick=()=>playTrackQueue(view==="album" ? orderedAlbum(group) : tracks.filter(t=>group && groupOf(t)===group).map(t=>t.id));
  el("dj-album").onchange=e=>{el("dj-play-album").disabled=scanning || !e.target.value;};
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
  for(const [name,path] of [["gpl","GPL-3.0.txt"],["font","Poppins-OFL.txt"],["icons","Material-Apache-2.0.txt"]]){
    const output=el("license-"+name);
    output?.parentElement?.addEventListener("toggle",async event=>{
      if(!event.target.open || output.textContent)return;
      try {const r=await fetch("simpmusic/"+path);if(!r.ok)throw Error();output.textContent=await r.text();}
      catch {output.textContent="Không mở được giấy phép.";}
    });
  }
  const UPDATE_ENDPOINT = "https://api.github.com/repos/siloneedsleep/VelunaMusic/releases/latest";
  const UPDATE_CACHE_KEY = "veluna-update-cache";
  const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  let updateInFlight = false;

  function currentAppVersion() {
    return String(document.body?.dataset?.appVersion || "0.1.0").trim();
  }

  function isNewerRelease(current, candidateTag) {
    const curMatch = String(current || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
    const candMatch = String(candidateTag || "").trim().match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!curMatch || !candMatch) return false;
    for (let i = 1; i <= 3; i++) {
      const a = Number(curMatch[i]), b = Number(candMatch[i]);
      if (b !== a) return b > a;
    }
    return false;
  }

  function pickPlatformAsset(release, isAndroid) {
    const tag = String(release?.tag_name || "");
    const prefix = "https://github.com/siloneedsleep/VelunaMusic/releases/download/" + tag + "/";
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const valid = assets.filter(a =>
      a && typeof a.name === "string"
      && typeof a.browser_download_url === "string"
      && a.browser_download_url.startsWith(prefix)
      && (a.state === undefined || a.state === "uploaded")
      && (a.size === undefined || Number(a.size) > 0)
    );
    const preferredNames = isAndroid
      ? ["VelunaMusic-" + tag + "-android.apk", "VelunaMusic-Android.apk"]
      : ["VelunaMusic-" + tag + "-windows-x64.exe", "VelunaMusic-Windows-x64.exe"];
    for (const name of preferredNames) {
      const exact = valid.find(a => a.name === name);
      if (exact) return { name: exact.name, url: exact.browser_download_url, ext: isAndroid ? ".apk" : ".exe" };
    }
    const ext = isAndroid ? ".apk" : ".exe";
    const byExt = valid.find(a => a.name.toLowerCase().endsWith(ext));
    if (byExt) return { name: byExt.name, url: byExt.browser_download_url, ext };
    return {
      name: tag,
      url: "https://github.com/siloneedsleep/VelunaMusic/releases/tag/" + encodeURIComponent(tag),
      ext
    };
  }

  function renderUpdateBanner(info) {
    const banner = el("update-banner");
    const textEl = el("update-banner-text");
    const linkEl = el("update-download-link");
    if (!banner || !textEl || !linkEl) return;
    if (!info || !info.available) {
      banner.hidden = true;
      return;
    }
    textEl.textContent = "Có bản cập nhật mới: VelunaMusic " + info.tag;
    linkEl.href = info.url;
    linkEl.textContent = "Tải " + info.tag + " (" + info.ext + ")";
    banner.hidden = false;
  }

  function readUpdateCache(nowMs = Date.now()) {
    try {
      const parsed = JSON.parse(localStorage.getItem(UPDATE_CACHE_KEY) || "null");
      if (parsed && Number.isFinite(parsed.checkedAt) && (nowMs - parsed.checkedAt) < UPDATE_CACHE_TTL_MS) {
        return parsed;
      }
    } catch {}
    return null;
  }

  async function checkForUpdates(manual = false) {
    const statusEl = el("update-status");
    const checkBtn = el("check");
    const isAndroid = Boolean(native) || (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || ""));
    const nowMs = Date.now();

    if (!manual) {
      const cached = readUpdateCache(nowMs);
      if (cached) {
        const available = Boolean(cached.tag && isNewerRelease(currentAppVersion(), cached.tag));
        renderUpdateBanner(available ? { ...cached, available } : null);
        return { ...cached, available, fromCache: true };
      }
    }

    if (updateInFlight) return null;
    if (typeof fetch !== "function") return null;
    updateInFlight = true;
    if (checkBtn) checkBtn.disabled = true;
    if (manual && statusEl) statusEl.textContent = "Đang kiểm tra bản phát hành mới nhất…";

    try {
      const opts = { headers: { Accept: "application/vnd.github+json" } };
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        opts.signal = AbortSignal.timeout(10000);
      }
      const res = await fetch(UPDATE_ENDPOINT, opts);
      let record = { checkedAt: nowMs, tag: "", url: "", ext: isAndroid ? ".apk" : ".exe", available: false };
      if (res.status === 404) {
        try { localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(record)); } catch {}
        renderUpdateBanner(null);
        if (manual) {
          const text = "Đang dùng bản mới nhất hiện có (" + currentAppVersion() + ").";
          if (statusEl) statusEl.textContent = text;
          msg(text);
        }
        return { ...record, fromCache: false };
      }
      if (!res.ok) throw Error("HTTP " + res.status);
      const release = await res.json();
      const eligible = Boolean(release && !release.draft && !release.prerelease && isNewerRelease(currentAppVersion(), release.tag_name));
      if (eligible) {
        const picked = pickPlatformAsset(release, isAndroid);
        record = { checkedAt: nowMs, tag: release.tag_name, url: picked.url, name: picked.name, ext: picked.ext, available: true };
      } else {
        record = { checkedAt: nowMs, tag: String(release?.tag_name || ""), url: "", ext: isAndroid ? ".apk" : ".exe", available: false };
      }
      try { localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(record)); } catch {}
      renderUpdateBanner(record.available ? record : null);
      if (manual) {
        const text = record.available
          ? "Đã có VelunaMusic " + record.tag + ". Nhấn tải ngay trên thanh thông báo."
          : "Đang dùng bản mới nhất hiện có (" + currentAppVersion() + ").";
        if (statusEl) statusEl.textContent = text;
        msg(text);
      }
      return { ...record, fromCache: false };
    } catch (err) {
      if (manual) {
        const text = "Chưa kiểm tra được cập nhật lúc này.";
        if (statusEl) statusEl.textContent = text;
        msg(text);
      }
      return { available: false, error: err?.message || String(err), fromCache: false };
    } finally {
      updateInFlight = false;
      if (checkBtn) checkBtn.disabled = false;
    }
  }

  if (el("update-dismiss")) {
    el("update-dismiss").onclick = () => {
      if (el("update-banner")) el("update-banner").hidden = true;
    };
  }
  if (el("check")) {
    el("check").onclick = () => { checkForUpdates(true); };
  }
  window.velunaUpdates = {
    check: checkForUpdates,
    isNewerRelease,
    pickPlatformAsset,
    clearCache() { try { localStorage.removeItem(UPDATE_CACHE_KEY); } catch {} }
  };
  if (typeof fetch === "function" && (native || desktop)) {
    checkForUpdates(false);
  }
  window.velunaLibrary={refresh,rows,record,favoritesChanged,orderedAlbum,renderUpNext,prepareAlbums(){albumChoices();scan();},queue:()=>view==="queue",
    openView(name){const b=buttons.find(x=>x.dataset.view===name);if(b)select(b);},
    normalizeSearchText,searchLocal,onSearchInput,setYtmSearchFilter,resetUnifiedSearch,getSearchSeqId:()=>searchSeqId,
    newPlay:()=>{ lastStarted=""; },
    empty:()=>el("query").value?"Không tìm thấy bài phù hợp.":view==="favorite"?"Chọn trái tim trên trình phát để lưu bài yêu thích.":view==="recent" || view==="popular"?"Các bài đã phát trên thiết bị sẽ xuất hiện ở đây.":libFilter==="downloaded"?"Chưa có file nhạc nội bộ trên thiết bị.":"Chưa có bài trong mục này."};
  refresh();drawList();
})();
