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
  const home=el("home-shelves"), homeMoods=el("home-moods"), homeDetail=el("home-detail"), homeYtm=el("home-ytm"), homeLocal=el("home-local"), artCache=new Map();
  let shelfKey="", loadingCovers=false;
  let homeMoodList=[], activeMoodParams="", homeLoaded=false, homeInFlight=false, homeReqSeq=0, homeLoadingMore=false;
  const homeFeedCache=new Map();

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
        const image = document.createElement("img");
        image.src = item.thumbnail || "icon.png";
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.onerror = () => { image.src = "icon.png"; };

        const kindChip = document.createElement("span");
        kindChip.className = "ytm-card-type";
        kindChip.textContent = homeTypeLabel(item.type);
        media.append(image, kindChip);

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
    if (view !== "home" || !homeYtm) return;
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
      if (view !== "home") return;
      renderMoodChips();
      renderYtmHome(data);
    } catch {
      if (reqId !== homeReqSeq || view !== "home") return;
      renderMoodChips();
      renderHomeOffline();
    } finally {
      if (reqId === homeReqSeq) homeInFlight = false;
    }
  }

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
    const target = homeLocal || home;
    if(home.hidden){if(shelfKey){target.replaceChildren();shelfKey="";}return;}
    const recent=tracks.filter(t=>history.has(t.id)).sort((a,b)=>history.get(b.id).time-history.get(a.id).time).slice(0,8);
    const albums=new Map();
    for(const t of tracks){const key=albumKey(tags.get(t.id));if(key && !albums.has(key))albums.set(key,t);if(albums.size===12)break;}
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
      target.append(title,rail);
    }
    if(homeLocal)homeLocal.hidden=renderedCount===0;
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
    if (view==="home" && !document.hidden) {
      if (!homeLoaded && !homeInFlight) loadYtmHome(activeMoodParams, false);
      else if (homeLoaded && homeYtm && !homeYtm.childElementCount) loadYtmHome(activeMoodParams, false);
    }
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
