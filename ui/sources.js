(() => {
  const rootObj = typeof window !== "undefined" ? window : globalThis;
  const key = "youtube-library";
  const trackMetaCache = new Map();
  const lyricsInFlight = new Set();
  const lyricsMetaCache = new Map();
  let items = [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(raw)) items = raw.filter(x => typeof x.title === "string" && /^[\w-]{11}$/.test(x.id));
  } catch {}

  function videoId(value) {
    if (typeof value !== "string") return "";
    if (value.startsWith("ytmusic://")) {
      const bare = value.slice("ytmusic://".length);
      return /^[\w-]{11}$/.test(bare) ? bare : "";
    }
    if (/^[\w-]{11}$/.test(value.trim())) return value.trim();
    let url;
    try { url = new URL(value); } catch { return ""; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    let id = "";
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|live)\/[\w-]{11}$/.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : "";
  }

  function formatQuality(track) {
    if (!track) return "";
    const codec = track.codec ? String(track.codec).toUpperCase() : "";
    const kbps = Number(track.bitrate_kbps) || (track.bitrate ? Math.round(Number(track.bitrate) / 1000) : 0);
    const rate = Number(track.sample_rate) ? (Number(track.sample_rate) / 1000) + " kHz" : "";
    return [codec, kbps ? kbps + " kb/s" : "", rate].filter(Boolean).join(" · ");
  }

  function sourceBadge(track) {
    if (!track) return "";
    const id = String(track.id || track.path || track.uri || "");
    if (track.source === "ytmusic" || id.startsWith("ytmusic://")) return "YouTube Music";
    return "";
  }

  function normalizeYtmTrack(t) {
    const vid = videoId(t.video_id || t.id || t.uri || "");
    const id = "ytmusic://" + vid;
    const artist = t.artist || t.artist_text || (Array.isArray(t.artists) ? t.artists.map(a => a.name).filter(Boolean).join(", ") : "");
    const album = typeof t.album === "object" && t.album ? (t.album.name || "") : (t.album || "");
    const thumbnail = t.thumbnail || (Array.isArray(t.thumbnails) && t.thumbnails.length ? t.thumbnails[t.thumbnails.length - 1] : "");
    const out = {
      ...t,
      id,
      video_id: vid,
      uri: id,
      source: "ytmusic",
      artist,
      artist_text: artist,
      album,
      album_id: typeof t.album === "object" && t.album ? (t.album.id || "") : (t.album_id || ""),
      artist_id: Array.isArray(t.artists) && t.artists[0]?.id ? t.artists[0].id : (t.artist_id || ""),
      thumbnail,
      recording_kind: t.recording_kind || "original",
      recording_label: t.recording_label || "Bản gốc"
    };
    const prev = trackMetaCache.get(id);
    trackMetaCache.set(id, prev ? { ...prev, ...out } : out);
    return trackMetaCache.get(id);
  }

  function invokeYtm(nativeMethod, tauriCommand, desktopArgs, ...nativeArgs) {
    if (typeof native !== "undefined" && native && typeof native[nativeMethod] === "function") {
      if (typeof nativeTransfer === "function") return nativeTransfer(nativeMethod, ...nativeArgs);
      const raw = native[nativeMethod](...nativeArgs);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed?.error) throw Error(parsed.error);
      return Promise.resolve(parsed);
    }
    if (typeof desktop !== "undefined" && desktop && typeof desktop.invoke === "function") {
      return desktop.invoke(tauriCommand, desktopArgs);
    }
    return Promise.reject(Error("YouTube Music backend chưa sẵn sàng trên thiết bị này."));
  }

  async function search(query, filter = "all") {
    const q = String(query || "").trim();
    if (!q) return { query: "", tracks: [], videos: [], albums: [], artists: [] };
    const res = await invokeYtm("ytmSearch", "ytm_search", { query: q, filter }, q, filter);
    for (const t of res?.tracks || []) normalizeYtmTrack(t);
    for (const v of res?.videos || []) normalizeYtmTrack(v);
    return res;
  }

  async function home(params = "", continuation = "") {
    const p = String(params || "").trim();
    const c = String(continuation || "").trim();
    const res = await invokeYtm(
      "ytmHome",
      "ytmusic_home",
      { params: p || null, continuation: c || null },
      p,
      c
    );
    for (const shelf of res?.shelves || []) {
      for (const item of shelf?.items || []) {
        if (item && (item.type === "song" || item.type === "video")) {
          const vid = videoId(item.video_id || item.id || "");
          if (vid) {
            normalizeYtmTrack({
              ...item,
              video_id: vid,
              id: "ytmusic://" + vid,
              artist_text: item.artist || item.subtitle || ""
            });
          }
        }
      }
    }
    return {
      chips: Array.isArray(res?.chips) ? res.chips : [],
      shelves: Array.isArray(res?.shelves) ? res.shelves : [],
      continuation: res?.continuation || null
    };
  }

  async function stream(vidOrUri, forceRefresh = false) {
    const vid = videoId(vidOrUri);
    if (!vid) throw Error("Mã video không hợp lệ.");
    const info = await invokeYtm(
      "ytmStream",
      "ytm_stream",
      { videoId: vid, forceRefresh: !!forceRefresh },
      vid,
      !!forceRefresh
    );
    return rememberStream(vid, info);
  }

  function rememberStream(vid, info) {
    const id = "ytmusic://" + vid;
    const prev = trackMetaCache.get(id) || {id, video_id:vid, source:"ytmusic"};
    const {codec, container, bitrate, bitrate_kbps, sample_rate, expires_at} = info;
    const meta = {...prev, codec, container, bitrate, bitrate_kbps, sample_rate, expires_at,
      title:prev.title || info.title || vid, artist:prev.artist || info.author || ""};
    trackMetaCache.set(id, meta);
    if (typeof tracks !== "undefined") {
      const target = tracks.find(x => x.id === id);
      if (target) Object.assign(target, meta);
      rootObj.velunaLibrary?.refresh?.();
    }
    return info;
  }

  async function refreshStream(value) {
    const vid = videoId(value);
    if (!vid) throw Error("Mã video không hợp lệ.");
    return rememberStream(vid, await invokeYtm("ytmRefreshStream","ytm_refresh_stream",{videoId:vid},vid));
  }

  async function album(browseId) {
    const res = await invokeYtm("ytmAlbum", "ytm_album", { browseId }, browseId);
    for (const t of res?.tracks || []) normalizeYtmTrack(t);
    return res;
  }

  async function artist(browseId) {
    const res = await invokeYtm("ytmArtist", "ytm_artist", { browseId }, browseId);
    for (const t of [...(res?.top_songs || []), ...(res?.videos || []), ...(res?.live_performances || [])]) {
      normalizeYtmTrack(t);
    }
    return res;
  }

  async function lyrics(trackOrId) {
    const meta = typeof trackOrId === "string"
      ? ((typeof tracks !== "undefined" && Array.isArray(tracks) ? tracks.find(t => t.id === trackOrId) : null) || trackMetaCache.get(trackOrId) || { id: trackOrId })
      : trackOrId;
    const vid = meta.video_id || videoId(meta.id || "");
    if (!vid) throw Error("Thiếu mã bài hát để tải lời.");
    const trackId = "ytmusic://" + vid;
    const title = meta.title || "";
    const artistName = meta.artist || meta.artist_text || "";
    const durationSec = Number(meta.duration_sec) || 0;
    const res = await invokeYtm(
      "ytmLyrics",
      "ytm_lyrics",
      { videoId: vid, title, artist: artistName, durationSec },
      vid,
      title,
      artistName,
      durationSec
    );
    const rawText = res?.synced_lrc || res?.plain_lyrics || "";
    if (rawText) {
      try { localStorage.setItem("lyrics/" + trackId, rawText); } catch {}
      lyricsMetaCache.set(trackId, { provider: res.source_provider, has_time_sync: !!res.has_time_sync, has_word_sync: !!res.has_word_sync });
      rootObj.velunaListening?.reloadLyrics?.();
      if (typeof rootObj.dispatchEvent === "function" && typeof CustomEvent === "function") {
        rootObj.dispatchEvent(new CustomEvent("veluna-ytm-lyrics", { detail: { id: trackId, lyrics: res } }));
      }
    }
    return res;
  }

  async function ensureLyrics(trackId) {
    if (!trackId || !String(trackId).startsWith("ytmusic://")) return null;
    try {
      if (localStorage.getItem("lyrics/" + trackId)) return null;
    } catch {}
    if (lyricsInFlight.has(trackId)) return null;
    lyricsInFlight.add(trackId);
    try {
      return await lyrics(trackId);
    } catch {
      return null;
    } finally {
      lyricsInFlight.delete(trackId);
    }
  }

  async function playTracks(list, startIndex = 0, playNow = true) {
    const normalized = (list || []).map(normalizeYtmTrack).filter(t => t.video_id);
    if (!normalized.length) return;
    if (typeof native !== "undefined" && native && typeof native.ytmAddOrPlay === "function") {
      native.ytmAddOrPlay(JSON.stringify(normalized), startIndex, !!playNow);
      if (playNow && normalized[startIndex]) ensureLyrics(normalized[startIndex].id);
      return;
    }
    if (typeof native !== "undefined" && native && typeof native.openYouTube === "function" && playNow && normalized[startIndex]) {
      native.openYouTube(normalized[startIndex].video_id);
      return;
    }
    if (typeof tracks !== "undefined" && Array.isArray(tracks)) {
      if (typeof desktop !== "undefined" && desktop) {
        await desktop.invoke("save_online_tracks",{items:normalized.map(({id,title})=>({id,title:title || id}))});
        if (playNow) albumQueue=normalized.map(t=>t.id);
      }
      for (const item of normalized) {
        if (!tracks.some(x => x.id === item.id)) tracks.push(item);
      }
      if (typeof draw === "function") draw();
      if (playNow && normalized[startIndex] && typeof loadTrack === "function") {
        loadTrack(normalized[startIndex].id, true);
      }
    }
  }

  async function enqueueTracks(list) {
    const normalized = (list || []).map(normalizeYtmTrack).filter(t => t.video_id);
    if (!normalized.length) return 0;
    await playTracks(normalized, 0, false);
    if (typeof albumQueue !== "undefined" && Array.isArray(albumQueue) && albumQueue.length) {
      for (const item of normalized) {
        if (!albumQueue.includes(item.id)) albumQueue.push(item.id);
      }
      if (typeof draw === "function") draw();
    }
    return normalized.length;
  }

  async function openHomeCollection(item, container) {
    const panel = container || el("home-detail");
    if (!panel || !item) return;
    const browseId = item.browse_id || item.id || "";
    if (!browseId) return;

    const head = document.createElement("div");
    head.className = "home-detail-head";
    const info = document.createElement("div");
    info.className = "home-detail-meta";
    const heading = document.createElement("h3");
    heading.textContent = item.title || "Đang tải danh sách…";
    const sub = document.createElement("p");
    sub.textContent = "Đang tải danh sách bài hát…";
    info.append(heading, sub);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Đóng";
    closeBtn.onclick = () => {
      panel.hidden = true;
      panel.replaceChildren();
    };
    head.append(info, closeBtn);

    panel.replaceChildren(head);
    panel.hidden = false;

    try {
      const res = await album(browseId);
      const list = Array.isArray(res?.tracks) ? res.tracks : [];
      panel.replaceChildren();

      const loadedHead = document.createElement("div");
      loadedHead.className = "home-detail-head";

      const art = document.createElement("img");
      art.className = "home-detail-cover";
      art.src = (Array.isArray(res?.thumbnails) && res.thumbnails.length ? res.thumbnails[res.thumbnails.length - 1] : "") || item.thumbnail || "icon.png";
      art.alt = "";
      art.onerror = () => { art.src = "icon.png"; };

      const meta = document.createElement("div");
      meta.className = "home-detail-meta";
      const h3 = document.createElement("h3");
      h3.textContent = res?.title || item.title || browseId;
      const desc = document.createElement("p");
      const artistText = Array.isArray(res?.artists) ? res.artists.map(a => a.name).filter(Boolean).join(", ") : "";
      const kindLabel = item.type === "album" ? "Album" : "Playlist";
      desc.textContent = [kindLabel, artistText || item.artist || item.subtitle, list.length + " bài"].filter(Boolean).join(" · ");
      meta.append(h3, desc);

      const actions = document.createElement("div");
      actions.className = "home-detail-actions";

      const playAll = document.createElement("button");
      playAll.type = "button";
      playAll.className = "primary-action";
      playAll.textContent = "Phát ngay";
      playAll.disabled = !list.length;
      playAll.onclick = () => playTracks(list, 0, true).catch(e => { if (typeof msg === "function") msg(String(e)); });

      const queueAll = document.createElement("button");
      queueAll.type = "button";
      queueAll.textContent = "+ Thêm vào hàng chờ";
      queueAll.disabled = !list.length;
      queueAll.onclick = async () => {
        try {
          const added = await enqueueTracks(list);
          if (typeof msg === "function") msg("Đã thêm " + added + " bài vào hàng chờ.");
        } catch (e) {
          if (typeof msg === "function") msg(String(e));
        }
      };

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Đóng";
      dismiss.onclick = () => {
        panel.hidden = true;
        panel.replaceChildren();
      };
      actions.append(playAll, queueAll, dismiss);
      loadedHead.append(art, meta, actions);
      panel.append(loadedHead);

      const rowsWrap = document.createElement("div");
      rowsWrap.className = "home-detail-tracks";
      if (list.length) {
        list.forEach((tr, idx) => rowsWrap.append(createTrackRow(tr, list, idx)));
      } else {
        const empty = document.createElement("p");
        empty.textContent = "Không tìm thấy bài hát trong danh sách này.";
        rowsWrap.append(empty);
      }
      panel.append(rowsWrap);
    } catch (e) {
      sub.textContent = "Không tải được danh sách: " + (e?.message || String(e));
    }
  }

  function createTrackRow(track, sectionList, idx) {
    const norm = normalizeYtmTrack(track);
    const wrap = document.createElement("div");
    wrap.className = "ytm-item row";
    const info = document.createElement("span");
    const badgeText = [sourceBadge(norm), norm.recording_label, norm.duration_text, formatQuality(norm)].filter(Boolean).join(" · ");
    info.textContent = norm.title + (norm.artist ? " — " + norm.artist : "");
    const metaSmall = document.createElement("small");
    metaSmall.textContent = badgeText;
    wrap.append(info, metaSmall);

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.textContent = "Phát";
    playBtn.onclick = () => playTracks(sectionList, idx, true).catch(e=>msg(String(e)));
    wrap.append(playBtn);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Thư viện";
    addBtn.onclick = async () => {
      try{await playTracks([norm],0,false);}catch(e){msg(String(e));return;}
      el("ytm-status").textContent = "Đã thêm \"" + norm.title + "\" vào thư viện.";
    };
    wrap.append(addBtn);

    if (norm.album_id) {
      const albBtn = document.createElement("button");
      albBtn.type = "button";
      albBtn.textContent = "Album";
      albBtn.onclick = () => openAlbumDetail(norm.album_id);
      wrap.append(albBtn);
    }
    if (norm.artist_id) {
      const artBtn = document.createElement("button");
      artBtn.type = "button";
      artBtn.textContent = "Nghệ sĩ";
      artBtn.onclick = () => openArtistDetail(norm.artist_id);
      wrap.append(artBtn);
    }
    return wrap;
  }

  function renderSearchResults(res) {
    const container = el("ytm-results");
    container.replaceChildren();
    const groups = [
      ["Bài hát", res?.tracks || []],
      ["Video âm nhạc", res?.videos || []]
    ];
    let count = 0;
    for (const [heading, list] of groups) {
      if (!list.length) continue;
      count += list.length;
      const h = document.createElement("h3");
      h.textContent = heading;
      container.append(h);
      list.forEach((item, idx) => container.append(createTrackRow(item, list, idx)));
    }
    if ((res?.albums || []).length) {
      count += res.albums.length;
      const h = document.createElement("h3");
      h.textContent = "Album";
      container.append(h);
      for (const alb of res.albums) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "row";
        btn.textContent = alb.title + (alb.year ? " (" + alb.year + ")" : "");
        btn.onclick = () => openAlbumDetail(alb.browse_id);
        container.append(btn);
      }
    }
    if ((res?.artists || []).length) {
      count += res.artists.length;
      const h = document.createElement("h3");
      h.textContent = "Nghệ sĩ";
      container.append(h);
      for (const art of res.artists) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "row";
        btn.textContent = art.name + (art.subscribers ? " · " + art.subscribers : "");
        btn.onclick = () => openArtistDetail(art.browse_id);
        container.append(btn);
      }
    }
    el("ytm-status").textContent = count ? "Tìm thấy " + count + " kết quả trên YouTube Music." : "Không tìm thấy kết quả phù hợp.";
  }

  async function openAlbumDetail(browseId) {
    const detail = el("ytm-detail");
    const status = el("ytm-status");
    status.textContent = "Đang tải chi tiết album…";
    try {
      const res = await album(browseId);
      detail.replaceChildren();
      detail.hidden = false;
      const header = document.createElement("h3");
      header.textContent = res.title + (res.year ? " (" + res.year + ")" : "");
      const playAll = document.createElement("button");
      playAll.type = "button";
      playAll.textContent = "Phát cả album";
      playAll.onclick = () => playTracks(res.tracks || [], 0, true);
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "Đóng chi tiết";
      closeBtn.onclick = () => { detail.hidden = true; detail.replaceChildren(); };
      detail.append(header, playAll, closeBtn);
      (res.tracks || []).forEach((tr, idx) => detail.append(createTrackRow(tr, res.tracks, idx)));
      status.textContent = "Album: " + res.title + " (" + (res.tracks?.length || 0) + " bài)";
    } catch (e) {
      status.textContent = e.message || String(e);
    }
  }

  async function openArtistDetail(browseId) {
    const detail = el("ytm-detail");
    const status = el("ytm-status");
    status.textContent = "Đang tải thông tin nghệ sĩ…";
    try {
      const res = await artist(browseId);
      detail.replaceChildren();
      detail.hidden = false;
      const header = document.createElement("h3");
      header.textContent = res.name + (res.subscribers ? " · " + res.subscribers : "");
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "Đóng chi tiết";
      closeBtn.onclick = () => { detail.hidden = true; detail.replaceChildren(); };
      detail.append(header, closeBtn);
      const sections = [
        ["Bài hát nổi bật", res.top_songs || []],
        ["Biểu diễn Live", res.live_performances || []],
        ["Video", res.videos || []]
      ];
      for (const [labelText, list] of sections) {
        if (!list.length) continue;
        const sub = document.createElement("h4");
        sub.textContent = labelText;
        detail.append(sub);
        list.forEach((tr, idx) => detail.append(createTrackRow(tr, list, idx)));
      }
      for (const alb of [...(res.albums || []), ...(res.singles || [])]) {
        const albBtn = document.createElement("button");
        albBtn.type = "button";
        albBtn.className = "row";
        albBtn.textContent = "Album: " + alb.title + (alb.year ? " (" + alb.year + ")" : "");
        albBtn.onclick = () => openAlbumDetail(alb.browse_id);
        detail.append(albBtn);
      }
      status.textContent = "Nghệ sĩ: " + res.name;
    } catch (e) {
      status.textContent = e.message || String(e);
    }
  }

  async function play(id) {
    try {
      if ((typeof native !== "undefined" && native?.ytmAddOrPlay) || (typeof tracks !== "undefined" && typeof desktop !== "undefined" && desktop)) {
        const existing = items.find(x => x.id === id);
        await playTracks([{ id: "ytmusic://" + id, video_id: id, title: existing?.title || ("YouTube Music · " + id) }], 0, true);
      } else if (typeof native !== "undefined" && native) {
        native.openYouTube(id);
      } else {
        if (typeof audio !== "undefined" && audio) audio.pause();
        await desktop.invoke("open_youtube", { id });
      }
    } catch (e) {
      if (typeof msg === "function") msg(String(e));
    }
  }

  function render() {
    const list = el("youtube-list");
    list.replaceChildren();
    for (const item of items) {
      const line = document.createElement("div");
      const go = document.createElement("button");
      const remove = document.createElement("button");
      go.textContent = item.title;
      go.onclick = () => play(item.id);
      remove.textContent = "Xóa";
      remove.setAttribute("aria-label", "Xóa " + item.title);
      remove.onclick = () => {
        items = items.filter(x => x.id !== item.id);
        localStorage.setItem(key, JSON.stringify(items));
        render();
      };
      line.append(go, remove);
      list.append(line);
    }
  }

  el("youtube-form").onsubmit = e => {
    e.preventDefault();
    const box = el("youtube-url"), id = videoId(box.value.trim());
    if (!id) {
      el("youtube-status").textContent = "Nhập liên kết video từ YouTube hoặc YouTube Music.";
      return;
    }
    const title = el("youtube-name").value.trim() || "YouTube · " + id;
    items = [{ id, title }, ...items.filter(x => x.id !== id)];
    localStorage.setItem(key, JSON.stringify(items));
    render();
    box.value = "";
    el("youtube-name").value = "";
    el("youtube-status").textContent = "Đã thêm vào thư viện YouTube.";
  };

  el("ytm-search-form").onsubmit = async e => {
    e.preventDefault();
    const q = el("ytm-query").value.trim();
    const filter = el("ytm-filter").value || "all";
    if (!q) return;
    el("ytm-status").textContent = "Đang tìm trên YouTube Music…";
    try {
      const res = await search(q, filter);
      renderSearchResults(res);
    } catch (err) {
      el("ytm-status").textContent = err.message || String(err);
    }
  };

  render();

  rootObj.velunaYtm = {
    videoId,
    sourceBadge,
    formatQuality,
    search,
    home,
    stream,
    refreshStream,
    album,
    artist,
    lyrics,
    ensureLyrics,
    playTracks,
    enqueueTracks,
    openAlbumDetail,
    openArtistDetail,
    openHomeCollection,
    renderSearchResults,
    metaForId: id => trackMetaCache.get(id),
    lyricsMetaForId: id => lyricsMetaCache.get(id)
  };
})();
