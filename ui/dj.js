(() => {
  const endpoints = {
    openai:"https://api.openai.com/v1/chat/completions",
    openrouter:"https://openrouter.ai/api/v1/chat/completions"
  };
  const defaults = {enabled:false,style:"gentle",provider:"local",model:"",limit:10,seconds:0};
  let settings = {...defaults};
  try { Object.assign(settings, JSON.parse(localStorage.getItem("dj-settings") || "{}")); } catch {}
  let pair = "", plan = null, generation = 0, used = 0, fading = null, timer = 0, rafId = 0;
  let upcoming = null, deckB = null, activeDeckLabel = "A", readyTrackId = "", readySince = 0;
  const measurements = new Map();
  const preResolved = new Map();
  const preResolveInFlight = new Set();
  const info = text => { el("dj-status").textContent = text; };
  const nextId = () => {
    const order = playOrder(), i = order.indexOf(selected), repeat = el("repeat-mode")?.value || "off";
    if (i < 0 || repeat === "one") return null;
    return order[i + 1] || (repeat === "all" && order.length > 1 ? order[0] : null);
  };
  function validDuration(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
  function equalPowerGains(progress) {
    const p = Math.min(1, Math.max(0, Number(progress) || 0));
    const angle = (Math.PI * 0.5) * p;
    return { out: Math.cos(angle), in: Math.sin(angle) };
  }
  function options(a, b) {
    if (settings.style === "album") return [0];
    const cap = Math.min(12, validDuration(a.duration) ? a.duration / 3 : 3, validDuration(b.duration) ? b.duration / 3 : 3);
    const bpm = a.outro?.bpm && b.intro?.bpm ? Math.min(a.outro.bpm, b.intro.bpm) : 0;
    const bars = bpm ? 240 / bpm : 2;
    const times = settings.style === "party" ? [2 * bars, bars, 4 * bars] : [2 * bars, 1.5 * bars, 3 * bars];
    return [...new Set(times.map(t => Math.round(Math.min(t, cap) * 1000)))];
  }
  async function measure(id) {
    if (!measurements.has(id)) {
      const computation = String(id).startsWith("ytmusic://") && !native
        ? window.velunaYtm.stream(id).then(streamInfo => ({
            duration: (streamInfo.duration_ms || 0) / 1000,
            cue_in_ms: 0,
            intro: {},
            outro: {}
          }))
        : (window.velunaUtils?.callBridge
            ? window.velunaUtils.callBridge({ nativeMethod: "analyzeTrack", tauriCommand: "analyze_audio", desktopArgs: { id }, nativeArgs: [id] })
            : (native ? nativeTransfer("analyzeTrack", id) : desktop.invoke("analyze_audio", { id })));
      measurements.set(id, computation);
      computation.catch(() => measurements.delete(id));
      if (measurements.size > 80) measurements.delete(measurements.keys().next().value);
    }
    return measurements.get(id);
  }
  function setPlan(from, to, ms, method, cueInMs = 0) {
    const safeCue = Math.max(0, Math.min(4000, Math.round(Number(cueInMs) || 0)));
    plan = { from, to, ms, cueInMs: safeCue };
    if (native) {
      const enabled = settings.enabled && settings.style !== "album";
      const fixedSec = Number(settings.seconds) || 0;
      if (typeof native.setMixPlan === "function" && safeCue > 0) {
        native.setMixPlan(enabled, from, to, ms, fixedSec, safeCue);
      } else if (typeof native.setMix === "function") {
        native.setMix(enabled, from, to, ms, fixedSec);
      }
    }
    info(method + " · " + (ms / 1000).toFixed(1) + " giây");
  }
  async function preResolveNext(targetId = nextId()) {
    if (!targetId || !String(targetId).startsWith("ytmusic://")) return null;
    if (!window.velunaYtm?.stream) return null;
    const nowSec = Date.now() / 1000;
    const cached = preResolved.get(targetId);
    if (cached && cached.expiresAt > nowSec + 90) return cached;
    if (preResolveInFlight.has(targetId)) return null;
    preResolveInFlight.add(targetId);
    try {
      const force = Boolean(cached && cached.expiresAt <= nowSec + 90);
      const streamInfo = await window.velunaYtm.stream(targetId, force);
      if (streamInfo?.url) {
        const entry = {
          url: streamInfo.url,
          expiresAt: Number(streamInfo.expires_at) || (nowSec + 1800)
        };
        if (preResolved.size > 24) preResolved.delete(preResolved.keys().next().value);
        preResolved.set(targetId, entry);
        return entry;
      }
      return null;
    } catch {
      return null;
    } finally {
      preResolveInFlight.delete(targetId);
    }
  }
  function releaseDeck(elDeck) {
    if (!elDeck) return;
    elDeck.onended = elDeck.onpause = elDeck.ontimeupdate = elDeck.onplay = elDeck.onerror = elDeck.onloadedmetadata = elDeck.oncanplay = null;
    try { window.velunaSound?.detach?.(elDeck); } catch {}
    try { elDeck.pause(); } catch {}
    try { elDeck.removeAttribute?.("src"); } catch {}
    try { elDeck.load?.(); } catch {}
  }
  async function preloadDeckB(toId, cueInMs = 0) {
    if (native || !toId) return null;
    if (deckB && deckB.id === toId && !deckB.audio.error) return deckB;
    if (deckB) {
      releaseDeck(deckB.audio);
      deckB = null;
    }
    const preview = new Audio();
    preview.crossOrigin = "anonymous";
    preview.preload = "auto";
    const entry = {
      id: toId,
      audio: preview,
      cueInMs: Math.max(0, Math.min(4000, Number(cueInMs) || 0)),
      ready: false
    };
    preview.oncanplay = () => { entry.ready = true; };
    preview.onloadedmetadata = () => {
      entry.ready = true;
      if (entry.cueInMs > 0 && Number.isFinite(preview.duration) && entry.cueInMs / 1000 < preview.duration / 3) {
        try { preview.currentTime = entry.cueInMs / 1000; } catch {}
      }
    };
    deckB = entry;
    if (String(toId).startsWith("ytmusic://")) {
      const resolved = await preResolveNext(toId);
      if (deckB !== entry) return null;
      if (!resolved?.url) {
        releaseDeck(preview);
        deckB = null;
        return null;
      }
      preview.src = resolved.url;
    } else if (typeof desktop !== "undefined" && desktop?.convertFileSrc) {
      preview.src = desktop.convertFileSrc(toId);
    } else {
      preview.src = toId;
    }
    try { preview.load?.(); } catch {}
    return entry;
  }
  async function prepare() {
    const from = selected, to = nextId();
    const key = JSON.stringify([from, to, settings.style, settings.provider, settings.model, settings.seconds]);
    if (!settings.enabled || !from || !to) {
      if (pair) { pair = ""; plan = null; ++generation; }
      return;
    }
    if (key === pair) return;
    pair = key; upcoming = null; const turn = ++generation;
    const fresh = () => turn === generation && pair === key && settings.enabled;
    const manual = Number(settings.seconds) || 0;
    const basic = settings.style === "album" ? 0 : (manual || 4) * 1000;
    setPlan(from, to, basic, manual ? "Chuyển bài cố định" : "AutoMix trên máy", 0);
    if (!basic || manual) return;
    try {
      const [a, b] = await Promise.all([measure(from), measure(to)]);
      if (!fresh() || fading) return;
      const choices = options(a, b);
      const cueInMs = Number(b?.cue_in_ms) || 0;
      setPlan(from, to, choices[0], "AutoMix trên máy", cueInMs);
      const endpoint = endpoints[settings.provider];
      if (!endpoint || !settings.model || used >= settings.limit) return;
      upcoming = async () => {
        if (!fresh() || fading || used >= settings.limit) return;
        try {
          const secret = await window.velunaVault.read("dj-" + settings.provider);
          if (!secret || !fresh()) return;
          ++used;
          const response = await fetch(endpoint, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(9000),
            headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: settings.model,
              max_tokens: 40,
              messages: [
                { role: "system", content: 'Choose one transition for two local music tracks. Respond only with JSON {"option":index} using a zero-based index from the supplied overlap durations. Low confidence means the tempo may be wrong.' },
                { role: "user", content: JSON.stringify({ outro: a.outro, intro: b.intro, style: settings.style, overlap_ms: choices }) }
              ]
            })
          });
          if (!response.ok) throw Error("Nhà cung cấp trả về HTTP " + response.status);
          const body = await response.json();
          const result = JSON.parse(body.choices?.[0]?.message?.content ?? "");
          if (!Number.isInteger(result.option) || result.option < 0 || result.option >= choices.length) throw Error("Lựa chọn không hợp lệ");
          if (fresh() && !fading) setPlan(from, to, choices[result.option], "AI DJ", cueInMs);
        } catch (e) { if (fresh()) info("Đang dùng AutoMix trên máy · " + (e.message || String(e))); }
      };
    } catch (e) { if (fresh()) info("Đang dùng AutoMix trên máy · " + (e.message || String(e))); }
  }
  function clearFadeLoops() {
    if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    rafId = 0;
    clearInterval(timer);
    timer = 0;
  }
  function stopFade() {
    clearFadeLoops();
    if (deckB) {
      const held = deckB.audio;
      deckB = null;
      releaseDeck(held);
    }
    if (!fading) return;
    const { incoming, outgoing, volume } = fading;
    fading = null;
    releaseDeck(incoming);
    if (outgoing) outgoing.volume = volume > 0 ? volume : 1;
  }
  function swapToDeck(incoming, outgoing, toId, targetVolume) {
    releaseDeck(outgoing);
    audio = incoming;
    audio.volume = targetVolume > 0 ? targetVolume : 1;
    selected = toId;
    activeDeckLabel = activeDeckLabel === "A" ? "B" : "A";
    readyTrackId = toId;
    readySince = Date.now();
    bindAudio(audio);
    draw();
    window.velunaMotion?.onTrackTransition?.(toId, audio.currentTime || 0);
    savePosition();
    position(audio.currentTime, audio.duration, !audio.paused);
    pair = "";
    prepare();
  }
  function finish() {
    if (!fading || !fading.started) return false;
    const { incoming, outgoing, volume, to } = fading;
    fading = null;
    clearFadeLoops();
    swapToDeck(incoming, outgoing, to, volume);
    return true;
  }
  function handoffGapless() {
    if (native || fading) return false;
    const to = nextId();
    if (!to || !deckB || deckB.id !== to) return false;
    const incoming = deckB.audio;
    if (incoming.error || (!deckB.ready && (incoming.readyState || 0) < 2)) return false;
    deckB = null;
    const outgoing = audio;
    const targetVolume = outgoing?.volume > 0 ? outgoing.volume : 1;
    incoming.volume = targetVolume;
    window.velunaSound?.attach?.(incoming);
    incoming.play?.().catch?.(e => { if (typeof msg === "function") msg(e.message); });
    swapToDeck(incoming, outgoing, to, targetVolume);
    return true;
  }
  async function tick() {
    if (native || fading || !audio || audio.paused || !Number.isFinite(audio.duration)) return;
    const to = nextId();
    if (!to) return;
    const remaining = audio.duration - audio.currentTime;
    const crossfadeActive = Boolean(settings.enabled && settings.style !== "album" && plan?.ms && selected === plan.from && to === plan.to);

    if (!crossfadeActive) {
      if (remaining <= 15 && remaining > 0.05 && deckB?.id !== to) {
        preloadDeckB(to, 0);
      }
      if (remaining <= 0.05) {
        handoffGapless();
      }
      return;
    }

    const fadeSec = Math.min(plan.ms / 1000, audio.duration / 3);
    const preloadWindow = Math.max(15, fadeSec + 3);
    if (remaining <= preloadWindow && deckB?.id !== to) {
      await preloadDeckB(to, plan.cueInMs || 0);
      if (fading || !audio || audio.paused || !Number.isFinite(audio.duration) || selected !== plan?.from || nextId() !== to) return;
    }
    const liveRemaining = audio.duration - audio.currentTime;
    if (liveRemaining > fadeSec || liveRemaining <= 0.05) return;
    if (!deckB || deckB.id !== to) return;

    const incoming = deckB.audio, outgoing = audio;
    if (incoming.error) { stopFade(); plan = null; return; }
    if (!Number.isFinite(incoming.duration) || liveRemaining > incoming.duration / 3) return;

    const cueInSec = (plan.cueInMs || 0) / 1000;
    if (cueInSec > 0 && incoming.currentTime < cueInSec && cueInSec < incoming.duration / 3) {
      try { incoming.currentTime = cueInSec; } catch {}
    }
    deckB = null;
    window.velunaSound?.attach?.(incoming);
    const baseVolume = outgoing.volume > 0 ? outgoing.volume : 1;
    const transition = { outgoing, incoming, to: plan.to, volume: baseVolume, started: false };
    fading = transition;
    incoming.volume = 0;

    try {
      await incoming.play();
      if (fading !== transition) { releaseDeck(incoming); return; }
      transition.started = true;
      const startTime = outgoing.currentTime;
      const startWall = Date.now();
      const spanSec = Math.max(0.05, Math.min(fadeSec, outgoing.duration - startTime));

      const fadeStep = () => {
        if (fading !== transition) return;
        const audioElapsed = outgoing.currentTime - startTime;
        const wallElapsed = (Date.now() - startWall) / 1000;
        const elapsed = Number.isFinite(audioElapsed) && audioElapsed >= 0 ? Math.max(audioElapsed, wallElapsed * 0.95) : wallElapsed;
        const p = Math.min(1, Math.max(0, elapsed / spanSec));
        const gains = equalPowerGains(p);
        outgoing.volume = transition.volume * gains.out;
        incoming.volume = transition.volume * gains.in;
        if (p >= 1 || outgoing.ended) {
          finish();
          return;
        }
        if (typeof requestAnimationFrame === "function" && !(typeof document !== "undefined" && document.hidden)) {
          rafId = requestAnimationFrame(fadeStep);
        } else if (!timer) {
          timer = setInterval(fadeStep, 20);
        }
      };

      if (typeof requestAnimationFrame === "function" && !(typeof document !== "undefined" && document.hidden)) {
        fadeStep();
      } else {
        timer = setInterval(fadeStep, 20);
        fadeStep();
      }
    } catch {
      if (fading === transition) { stopFade(); plan = null; }
    }
  }
  function nearingEnd(time, duration, playing) {
    if (!playing || fading) return;
    if (selected && selected !== readyTrackId) {
      readyTrackId = selected;
      readySince = Date.now();
    }
    const remaining = duration - time;
    const nextTrack = nextId();
    if (nextTrack && String(nextTrack).startsWith("ytmusic://")) {
      const stableReady = readyTrackId === selected && (Date.now() - readySince >= 3000 || time >= 3);
      if (stableReady || (Number.isFinite(remaining) && remaining <= 25 && remaining > 0)) {
        preResolveNext(nextTrack);
      }
    }
    if (!native && nextTrack && Number.isFinite(remaining) && remaining <= 15 && remaining > 0.1 && deckB?.id !== nextTrack) {
      const cueMs = settings.enabled && plan?.to === nextTrack ? (plan.cueInMs || 0) : 0;
      preloadDeckB(nextTrack, cueMs);
    }
    if (!upcoming || !Number.isFinite(remaining) || remaining > 45 || remaining < 3) return;
    const selectPlan = upcoming; upcoming = null; return selectPlan();
  }
  function getState() {
    return {
      activeDeck: activeDeckLabel,
      fading: Boolean(fading),
      fadingTo: fading?.to || null,
      deckBId: deckB?.id || null,
      deckBReady: Boolean(deckB?.ready),
      plan: plan ? { ...plan } : null
    };
  }
  window.velunaDJ = {
    prepare,
    tick,
    stopFade,
    finish,
    nearingEnd,
    measure,
    equalPowerGains,
    preResolveNext,
    preloadDeckB,
    handoffGapless,
    getState
  };
  window.onVelunaAlbum = ids => {
    if (!ids?.length) return;
    albumQueue = ids; pair = ""; el("dj-dialog").close();
    loadTrack(ids[0], true);
  };
  el("dj-folder").onclick = async () => {
    if (native) { native.pickAlbum(); return; }
    try {
      const [all, ids] = await desktop.invoke("pick_album");
      tracks = all; draw();
      if (ids.length) window.onVelunaAlbum(ids); else info("Chưa chọn được bài trong thư mục.");
    } catch (e) { info(String(e)); }
  };
  el("dj").onclick = () => {
    el("dj-enabled").checked = settings.enabled; el("dj-style").value = settings.style;
    el("mix-seconds").value = String(settings.seconds || 0);
    el("dj-provider").value = settings.provider; el("dj-model").value = settings.model; el("dj-limit").value = settings.limit;
    el("dj-key").value = ""; el("dj-ai").hidden = settings.provider === "local"; el("dj-dialog").showModal(); window.velunaLibrary?.prepareAlbums();
  };
  el("dj-provider").onchange = e => { el("dj-ai").hidden = e.target.value === "local"; el("dj-key").value = ""; };
  el("dj-forget").onclick = async () => { try { await window.velunaVault.write("dj-" + el("dj-provider").value, ""); el("dj-key").value = ""; info("Đã xóa key trên thiết bị."); } catch (e) { info(String(e)); } };
  async function applySettings(album) {
    try {
      const seconds = Number(el("mix-seconds").value) || 0;
      const provider = el("dj-provider").value, model = el("dj-model").value.trim();
      if (!seconds && provider !== "local" && !model) throw Error("Nhập ID model của nhà cung cấp.");
      const key = el("dj-key").value.trim();
      if (provider !== "local" && key) await window.velunaVault.write("dj-" + provider, key);
      if (!seconds && provider !== "local" && !await window.velunaVault.read("dj-" + provider)) throw Error("Nhập API key để bật AI DJ.");
      settings = {
        enabled: el("dj-enabled").checked,
        style: el("dj-style").value,
        provider,
        model,
        seconds,
        limit: Math.min(100, Math.max(1, Math.floor(Number(el("dj-limit").value) || 10)))
      };
      localStorage.setItem("dj-settings", JSON.stringify(settings)); el("dj-key").value = "";
      generation++; pair = ""; plan = null; stopFade();
      if (native) native.setMix(settings.enabled && settings.style !== "album", "", "", 0, seconds);
      info("Đã lưu cài đặt DJ.");
      if (album?.length) playTrackQueue(album);
      prepare(); el("dj-dialog").close();
    } catch (e) { info(e.message || String(e)); }
  }
  el("dj-save").onclick = () => applySettings();
  el("dj-play-album").onclick = () => {
    const queue = window.velunaLibrary.orderedAlbum(el("dj-album").value);
    if (queue.length) applySettings(queue);
  };
  el("dj-close").onclick = () => { el("dj-key").value = ""; el("dj-dialog").close(); };
  el("dj-dialog").addEventListener("close", () => { el("dj-key").value = ""; });
  if (settings.enabled) prepare();
})();
