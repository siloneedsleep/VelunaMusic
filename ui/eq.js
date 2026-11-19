"use strict";

(() => {
  const STORAGE_KEY = "veluna-eq-v1";
  const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const BAND_LABELS = ["32Hz", "64Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz"];
  const PRESETS = {
    flat: { label: "Mặc định", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    bass: { label: "Tăng Bass", bands: [6, 5, 4, 2, 0, 0, 0, 1, 1, 0] },
    vocal: { label: "Giọng hát", bands: [-2, -1, 0, 2, 4, 4, 3, 2, 0, -1] },
    electronic: { label: "Điện tử", bands: [5, 4, 2, 0, -1, 1, 2, 4, 5, 4] },
    acoustic: { label: "Acoustic", bands: [2, 2, 1, 1, 2, 1, 2, 3, 2, 1] },
    latenight: { label: "Đêm khuya", bands: [-2, -1, 0, 1, 2, 2, 1, 0, -1, -2] }
  };

  const root = typeof window !== "undefined" ? window : globalThis;
  const byId = id => (typeof el === "function" ? el(id) : (typeof document !== "undefined" ? document.getElementById(id) : null));
  const hasNative = () => typeof native !== "undefined" && Boolean(native);

  function clampGain(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(Math.max(-12, Math.min(12, n)) * 2) / 2;
  }

  function formatDb(db) {
    const rounded = Math.round(Number(db || 0) * 10) / 10;
    const prefix = rounded > 0 ? "+" : "";
    return prefix + (Math.abs(rounded % 1) < 1e-6 ? rounded.toFixed(0) : rounded.toFixed(1)) + " dB";
  }

  function computeNormalizationGainDb(loudnessDb, fallbackRms) {
    if (loudnessDb !== null && loudnessDb !== undefined && loudnessDb !== "") {
      const ldb = Number(loudnessDb);
      if (Number.isFinite(ldb)) {
        return Math.round(Math.max(-12, Math.min(6, -ldb)) * 10) / 10;
      }
    }
    if (fallbackRms !== null && fallbackRms !== undefined && fallbackRms !== "") {
      const rms = Number(fallbackRms);
      if (Number.isFinite(rms) && rms > 0) {
        const gain = 20 * Math.log10(0.2 / rms);
        return Math.round(Math.max(-12, Math.min(6, gain)) * 10) / 10;
      }
    }
    return 0;
  }

  function threeBandToTen(bass, mid, high) {
    const b = clampGain(bass);
    const m = clampGain(mid);
    const h = clampGain(high);
    return [b, b, b, clampGain((b + m) / 2), m, m, clampGain((m + h) / 2), h, h, h];
  }

  function matchPreset(bands) {
    for (const [key, def] of Object.entries(PRESETS)) {
      if (def.bands.every((v, i) => Math.abs(v - bands[i]) < 0.01)) return key;
    }
    return "custom";
  }

  function readState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {}
    const bands = Array.isArray(raw?.bands) && raw.bands.length === BANDS.length
      ? raw.bands.map(clampGain)
      : PRESETS.flat.bands.slice();
    const preset = typeof raw?.preset === "string" && (raw.preset === "custom" || PRESETS[raw.preset])
      ? raw.preset
      : matchPreset(bands);
    return {
      enabled: raw?.enabled === true,
      normalize: raw?.normalize === true,
      preset,
      bands
    };
  }

  let state = readState();
  let context = null;
  let preGain = null;
  let filters = [];
  let compressor = null;
  let sink = "";
  let currentTrackId = "";
  let currentTrackNormDb = 0;
  let lastStatus = "";
  const knownDecks = new Set();
  const sources = new WeakMap();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: state.enabled,
        normalize: state.normalize,
        preset: state.preset,
        bands: state.bands
      }));
    } catch {}
  }

  function setStatus(text) {
    lastStatus = text || "";
    const eqStatus = byId("eq-status");
    if (eqStatus) eqStatus.textContent = lastStatus;
    const soundStatus = byId("sound-status");
    if (soundStatus) soundStatus.textContent = lastStatus;
  }

  function setParam(param, value, now) {
    if (!param) return;
    if (typeof param.setTargetAtTime === "function") {
      param.setTargetAtTime(value, now, 0.02);
    } else {
      param.value = value;
    }
  }

  function connectDeck(player) {
    if (!player || !context || !preGain || sources.has(player)) return;
    if (typeof context.createMediaElementSource !== "function") return;
    const src = context.createMediaElementSource(player);
    src.connect(preGain);
    sources.set(player, src);
  }

  function hasActiveDeck() {
    if (typeof audio !== "undefined" && audio && !audio.paused) return true;
    for (const deck of knownDecks) {
      if (deck && !deck.paused) return true;
    }
    return false;
  }

  async function ensureGraph() {
    if (hasNative()) return false;
    if (context) return true;
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    if (typeof AudioCtx !== "function") return false;
    context = new AudioCtx();
    preGain = context.createGain();
    filters = BANDS.map(hz => {
      const f = context.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = hz;
      f.Q.value = 1.41;
      f.gain.value = 0;
      return f;
    });
    compressor = context.createDynamicsCompressor();
    preGain.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(compressor);
    compressor.connect(context.destination);

    if (typeof audio !== "undefined" && audio) knownDecks.add(audio);
    for (const deck of knownDecks) connectDeck(deck);
    if (sink && typeof context.setSinkId === "function") {
      await context.setSinkId(sink);
    }
    return true;
  }

  function activeStatusSummary() {
    const parts = [];
    if (state.enabled) {
      const label = PRESETS[state.preset]?.label || "Tùy chỉnh";
      parts.push("EQ 10 dải: " + label);
    }
    if (state.normalize) {
      parts.push("Chuẩn hóa " + formatDb(currentTrackNormDb));
    }
    return parts.length ? parts.join(" · ") : "EQ và chuẩn hóa âm lượng đang tắt.";
  }

  async function apply() {
    const maxBoost = state.enabled ? Math.max(0, ...state.bands) : 0;
    const headroomDb = maxBoost * 0.45;
    const normDb = state.normalize ? currentTrackNormDb : 0;
    const totalPreDb = normDb - headroomDb;

    if (hasNative()) {
      if (typeof native.setEqualizer10 === "function") {
        const gainMb = state.normalize
          ? Math.round((currentTrackNormDb !== 0 ? currentTrackNormDb : 1.5) * 100)
          : 0;
        native.setEqualizer10(state.enabled, JSON.stringify(state.bands), state.normalize, gainMb);
      } else if (typeof native.setEqualizer === "function") {
        const avg = (a, b) => Math.round(state.bands.slice(a, b).reduce((s, v) => s + v, 0) / (b - a));
        native.setEqualizer(state.enabled, avg(0, 3), avg(3, 7), avg(7, 10));
      }
      setStatus(activeStatusSummary());
      syncUi();
      return;
    }

    if (!context && (state.enabled || state.normalize)) {
      await ensureGraph();
    }
    if (!context) {
      setStatus(activeStatusSummary());
      syncUi();
      return;
    }

    const now = context.currentTime || 0;
    for (let i = 0; i < filters.length; i++) {
      setParam(filters[i].gain, state.enabled ? state.bands[i] : 0, now);
    }
    setParam(preGain.gain, Math.pow(10, totalPreDb / 20), now);

    if (compressor) {
      let threshold = 0;
      let knee = 0;
      let ratio = 1;
      let attack = 0.005;
      let release = 0.15;
      if (state.enabled && state.preset === "latenight") {
        threshold = -24;
        knee = 20;
        ratio = 6;
        attack = 0.005;
        release = 0.16;
      } else if (state.normalize) {
        threshold = -14;
        knee = 18;
        ratio = 4;
        attack = 0.005;
        release = 0.15;
      } else if (state.enabled) {
        threshold = -10;
        knee = 14;
        ratio = 4;
        attack = 0.003;
        release = 0.12;
      }
      setParam(compressor.threshold, threshold, now);
      setParam(compressor.knee, knee, now);
      setParam(compressor.ratio, ratio, now);
      setParam(compressor.attack, attack, now);
      setParam(compressor.release, release, now);
    }

    if (hasActiveDeck() && context.state !== "running" && typeof context.resume === "function") {
      await context.resume();
    }
    setStatus(activeStatusSummary());
    syncUi();
  }

  function attach(player) {
    if (!player) return;
    knownDecks.add(player);
    if (context) connectDeck(player);
    if (sink && typeof player.setSinkId === "function") {
      player.setSinkId(sink).catch(e => setStatus(e?.message || String(e)));
    }
  }

  function detach(player) {
    if (!player) return;
    knownDecks.delete(player);
    const src = sources.get(player);
    if (src) {
      try { src.disconnect(); } catch {}
      sources.delete(player);
    }
  }

  function wake() {
    if (hasNative()) return;
    if (context) {
      if (typeof context.resume === "function") {
        context.resume().catch(e => setStatus(e?.message || String(e)));
      }
    } else if (state.enabled || state.normalize) {
      apply().catch(e => setStatus(e?.message || String(e)));
    }
  }

  function sleep() {
    if (hasNative() || !context) return;
    if (!hasActiveDeck() && typeof context.suspend === "function") {
      context.suspend().catch(() => {});
    }
  }

  async function setSink(deviceId) {
    if (context) {
      if (typeof context.setSinkId !== "function") {
        throw Error("Đầu ra EQ dùng thiết bị mặc định của Windows.");
      }
      await context.setSinkId(deviceId);
    }
    if (typeof audio !== "undefined" && audio && typeof audio.setSinkId === "function") {
      await audio.setSinkId(deviceId);
    }
    for (const deck of knownDecks) {
      if (deck && deck !== audio && typeof deck.setSinkId === "function") {
        await deck.setSinkId(deviceId);
      }
    }
    sink = deviceId;
  }

  function syncSliderVisual(input, value) {
    if (!input) return;
    const min = input.min !== undefined && input.min !== "" ? input.min : "-12";
    const max = input.max !== undefined && input.max !== "" ? input.max : "12";
    input.value = String(value);
    input.style?.setProperty("--attr-min", String(min));
    input.style?.setProperty("--attr-max", String(max));
    input.style?.setProperty("--control-value", String(value));
    input.setAttribute?.("aria-valuetext", formatDb(value));
  }

  function syncUi() {
    const enabledToggle = byId("eq-enabled");
    if (enabledToggle) enabledToggle.checked = state.enabled;
    const normToggle = byId("eq-normalize");
    if (normToggle) normToggle.checked = state.normalize;

    const normBadge = byId("eq-norm-gain");
    if (normBadge) {
      normBadge.textContent = state.normalize ? formatDb(currentTrackNormDb) : "Tắt";
    }

    const active = state.enabled || state.normalize;
    for (const btnId of ["eq-open", "topbar-eq"]) {
      const btn = byId(btnId);
      if (btn) {
        btn.setAttribute?.("aria-pressed", String(active));
        btn.classList?.toggle("is-active", active);
      }
    }

    const presetsWrap = byId("eq-presets");
    if (presetsWrap && typeof presetsWrap.querySelectorAll === "function") {
      for (const btn of presetsWrap.querySelectorAll("[data-eq-preset]")) {
        const isCurrent = btn.dataset?.eqPreset === state.preset;
        btn.setAttribute?.("aria-pressed", String(isCurrent));
      }
    }

    const bandsWrap = byId("eq-bands");
    if (bandsWrap && typeof bandsWrap.querySelectorAll === "function") {
      for (const input of bandsWrap.querySelectorAll("input[data-band]")) {
        const idx = Number(input.dataset?.band);
        if (!Number.isInteger(idx) || idx < 0 || idx >= BANDS.length) continue;
        const val = state.bands[idx];
        syncSliderVisual(input, val);
        input.disabled = !state.enabled;
        const readout = byId("eq-band-value-" + idx);
        if (readout) readout.textContent = formatDb(val);
      }
    }
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    saveState();
    return apply();
  }

  function setNormalize(normalize) {
    state.normalize = Boolean(normalize);
    saveState();
    return apply();
  }

  function applyPreset(presetKey) {
    const def = PRESETS[presetKey];
    if (!def) return Promise.resolve();
    state.preset = presetKey;
    state.bands = def.bands.slice();
    if (presetKey !== "flat") state.enabled = true;
    saveState();
    return apply();
  }

  function setBand(index, value) {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= BANDS.length) return Promise.resolve();
    state.bands[idx] = clampGain(value);
    state.preset = matchPreset(state.bands);
    if (!state.enabled && Math.abs(state.bands[idx]) > 0) state.enabled = true;
    saveState();
    return apply();
  }

  function reset() {
    state.preset = "flat";
    state.bands = PRESETS.flat.bands.slice();
    saveState();
    return apply();
  }

  function applyThreeBand(enabled, bass, mid, high) {
    state.enabled = Boolean(enabled);
    state.bands = threeBandToTen(bass, mid, high);
    state.preset = matchPreset(state.bands);
    saveState();
    return apply();
  }

  function resolveTrackLoudness(trackId, explicitLoudnessDb) {
    if (explicitLoudnessDb !== null && explicitLoudnessDb !== undefined && Number.isFinite(Number(explicitLoudnessDb))) {
      return computeNormalizationGainDb(explicitLoudnessDb, null);
    }
    const id = trackId || currentTrackId;
    if (!id) return 0;
    const ytmMeta = root.velunaYtm?.metaForId?.(id);
    if (ytmMeta && ytmMeta.loudness_db !== undefined && ytmMeta.loudness_db !== null) {
      return computeNormalizationGainDb(ytmMeta.loudness_db, null);
    }
    if (typeof tracks !== "undefined" && Array.isArray(tracks)) {
      const entry = tracks.find(t => t && t.id === id);
      if (entry) {
        return computeNormalizationGainDb(entry.loudness_db, entry.rms);
      }
    }
    return 0;
  }

  function updateTrackLoudness(trackId, explicitLoudnessDb) {
    if (trackId) currentTrackId = trackId;
    const nextDb = resolveTrackLoudness(currentTrackId, explicitLoudnessDb);
    const changed = Math.abs(nextDb - currentTrackNormDb) > 0.05;
    currentTrackNormDb = nextDb;
    syncUi();
    if (state.normalize && (changed || context || hasNative())) {
      return apply();
    }
    return Promise.resolve();
  }

  function open() {
    const dialog = byId("eq-dialog");
    if (!dialog) return;
    syncUi();
    root.velunaUtils.openDialog(dialog);
  }

  function close() {
    root.velunaUtils.closeDialog(byId("eq-dialog"));
  }

  function bindDialog() {
    const dialog = byId("eq-dialog");
    const openBtn = byId("eq-open");
    if (openBtn) openBtn.onclick = open;
    const topbarEqBtn = byId("topbar-eq");
    if (topbarEqBtn) topbarEqBtn.onclick = open;
    const prefsOpenBtn = byId("prefs-open-eq");
    if (prefsOpenBtn) {
      prefsOpenBtn.onclick = () => {
        root.velunaUtils.closeDialog(byId("prefs"));
        open();
      };
    }
    const closeBtn = byId("eq-close");
    if (closeBtn) closeBtn.onclick = close;
    root.velunaUtils.bindLightDismiss(dialog);

    const enabledToggle = byId("eq-enabled");
    if (enabledToggle) {
      enabledToggle.onchange = () => setEnabled(enabledToggle.checked).catch(e => setStatus(e?.message || String(e)));
    }
    const normToggle = byId("eq-normalize");
    if (normToggle) {
      normToggle.onchange = () => setNormalize(normToggle.checked).catch(e => setStatus(e?.message || String(e)));
    }
    const resetBtn = byId("eq-reset");
    if (resetBtn) {
      resetBtn.onclick = () => reset().catch(e => setStatus(e?.message || String(e)));
    }

    const presetsWrap = byId("eq-presets");
    if (presetsWrap && typeof presetsWrap.querySelectorAll === "function") {
      for (const btn of presetsWrap.querySelectorAll("[data-eq-preset]")) {
        btn.onclick = () => applyPreset(btn.dataset.eqPreset).catch(e => setStatus(e?.message || String(e)));
      }
    }

    const bandsWrap = byId("eq-bands");
    if (bandsWrap && typeof bandsWrap.querySelectorAll === "function") {
      for (const input of bandsWrap.querySelectorAll("input[data-band]")) {
        const idx = Number(input.dataset?.band);
        const onChange = () => {
          setBand(idx, input.value).catch(e => setStatus(e?.message || String(e)));
        };
        input.oninput = onChange;
        input.onchange = onChange;
      }
    }
  }

  if (typeof audio !== "undefined" && audio) knownDecks.add(audio);
  bindDialog();
  syncUi();
  if (hasNative() && (state.enabled || state.normalize)) {
    apply().catch(() => {});
  }

  root.velunaEQ = {
    BANDS: BANDS.slice(),
    BAND_LABELS: BAND_LABELS.slice(),
    PRESETS,
    getState: () => ({
      enabled: state.enabled,
      normalize: state.normalize,
      preset: state.preset,
      bands: state.bands.slice(),
      normGainDb: currentTrackNormDb,
      hasContext: Boolean(context),
      deckCount: knownDecks.size
    }),
    attach,
    detach,
    wake,
    sleep,
    setSink,
    setEnabled,
    setNormalize,
    applyPreset,
    setBand,
    reset,
    applyThreeBand,
    updateTrackLoudness,
    computeNormalizationGainDb,
    open,
    close
  };

  root.velunaSound = {
    attach,
    detach,
    wake,
    sleep,
    setSink,
    applyThreeBand
  };

  root.onVelunaSoundStatus = setStatus;
})();
