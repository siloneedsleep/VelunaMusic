(() => {
  const defaults = { tint: "#19374f", text: "#ecf6ff", opacity: 78, blur: 12, border: 24, radius: 16, highlight: 8, shadow: 18 };
  const seed = { app: defaults, header: { opacity: 42 }, track: { opacity: 0, border: 10, blur: 0, radius: 9 }, button: { opacity: 80, radius: 10, blur: 0 }, input: { opacity: 70, blur: 0, radius: 8 } };
  const presets = {
    clear: { tint: "#1d4260", opacity: 24, blur: 6, border: 36, highlight: 14, shadow: 16 },
    frost: { tint: "#1b3c57", opacity: 62, blur: 20, border: 34, highlight: 12, shadow: 22 },
    dark: { tint: "#0b1929", opacity: 90, blur: 10, border: 18, highlight: 6, shadow: 28 },
    solid: { tint: "#122538", opacity: 100, blur: 0, border: 22, highlight: 4, shadow: 24 }
  };
  const selectors = {
    app: "body", header: "header", library: ".collection", rail: ".library-rail", player: "aside",
    dialog: "dialog", button: "button:not(.row):not(.mini-main)", input: "input,select,textarea", track: ".row",
    lyrics: "#lyrics-lines", drop: "#nearby-drop", playlist: "#playlist-panel", notice: "#upgrade", transport: ".transport button"
  };
  const fields = Object.keys(defaults), history = [], future = [];
  const upper = { opacity: 100, blur: 30, border: 100, radius: 42, highlight: 100, shadow: 100 };
  const clone = x => JSON.parse(JSON.stringify(x));
  const systemReduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const initial = () => ({
    surfaces: { app: { ...defaults } },
    preset: "frost",
    scale: 100,
    motion: !systemReduced,
    level: systemReduced ? "reduced" : "balanced",
    dynamicCover: true,
    batterySaver: true,
    position: "center",
    shade: 60
  });
  let theme = { ...initial(), surfaces: clone(seed) };
  let onBattery = false;

  function sanitize(input) {
    const result = initial();
    if (!input || typeof input !== "object") return result;
    for (const scope of Object.keys(selectors)) {
      const source = input.surfaces?.[scope];
      if (!source || typeof source !== "object") continue;
      const dest = result.surfaces[scope] || {};
      for (const field of fields) {
        if ((field === "tint" || field === "text") && /^#[a-f0-9]{6}$/i.test(source[field])) dest[field] = source[field];
        if (field in upper && Number.isFinite(source[field])) dest[field] = Math.max(0, Math.min(upper[field], Math.round(source[field])));
      }
      if (Object.keys(dest).length) result.surfaces[scope] = dest;
    }
    if (typeof input.preset === "string" && (input.preset === "" || input.preset in presets)) result.preset = input.preset;
    if (Number.isFinite(input.scale)) result.scale = Math.min(150, Math.max(90, input.scale));
    if (typeof input.motion === "boolean") result.motion = input.motion;
    if (["full", "balanced", "economy", "reduced"].includes(input.level)) result.level = input.level;
    if (typeof input.dynamicCover === "boolean") result.dynamicCover = input.dynamicCover;
    if (typeof input.batterySaver === "boolean") result.batterySaver = input.batterySaver;
    if (["top", "center", "bottom"].includes(input.position)) result.position = input.position;
    if (Number.isFinite(input.shade)) result.shade = Math.max(0, Math.min(95, input.shade));
    return result;
  }

  try { const saved = JSON.parse(localStorage.getItem("glass-theme")); if (saved) theme = sanitize(saved); } catch {}
  const sheet = typeof document !== "undefined" && document.createElement ? document.createElement("style") : null;
  if (sheet && document.head) document.head.append(sheet);

  function presetButtons() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return [];
    return [...document.querySelectorAll("[data-glass-preset]")];
  }

  function render() {
    let css = "";
    for (const [scope, props] of Object.entries(theme.surfaces)) {
      css += selectors[scope] + "{" + Object.entries(props).map(([k, v]) => "--glass-" + k + ":" + v).join(";") + "}";
    }
    if (sheet) sheet.textContent = css;
    const body = document.body;
    const reduced = !theme.motion || theme.level === "reduced" || theme.level === "economy";
    if (body) {
      body.style.setProperty("--type-scale", theme.scale / 100);
      body.dataset.motion = reduced ? "off" : "on";
      body.dataset.intensity = theme.level;
      body.dataset.preset = theme.preset || "";
      body.dataset.coverBg = theme.dynamicCover ? "on" : "off";
      body.dataset.power = (onBattery && theme.batterySaver) ? "battery" : "ac";
      body.dataset.windowState = typeof document !== "undefined" && document.hidden ? "hidden" : "visible";
      body.style.backgroundPosition = theme.position;
      body.style.setProperty("--back-shade", theme.shade + "%");
      if (!theme.dynamicCover) {
        body.style.removeProperty("--cover-bg-1");
        body.style.removeProperty("--cover-bg-2");
        body.style.removeProperty("--cover-accent");
      }
    }
    el("motion-level").value = theme.level;
    el("back-position").value = theme.position;
    el("back-shade").value = theme.shade;
    el("glass-preset").value = theme.preset || "";
    const toggleBtn = el("motion-toggle");
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", String(reduced));
    const coverCheck = el("dynamic-cover-bg");
    if (coverCheck) coverCheck.checked = !!theme.dynamicCover;
    const batteryCheck = el("battery-saver");
    if (batteryCheck) batteryCheck.checked = !!theme.batterySaver;
    for (const btn of presetButtons()) {
      btn.setAttribute("aria-pressed", String(btn.dataset.glassPreset === theme.preset));
    }
    const scope = el("glass-scope").value || "app";
    const style = { ...defaults, ...theme.surfaces.app, ...theme.surfaces[scope] };
    for (const field of fields) el("glass-" + field).value = style[field];
    el("theme-scale").value = theme.scale;
    el("theme-motion").checked = theme.motion;
    el("theme-undo").disabled = !history.length;
    el("theme-redo").disabled = !future.length;
  }

  function remember() { history.push(clone(theme)); if (history.length > 40) history.shift(); future.length = 0; }
  function save() { try { localStorage.setItem("glass-theme", JSON.stringify(theme)); } catch {} render(); }
  function change(fn) { remember(); fn(); save(); }
  function edit(data) { const scope = el("glass-scope").value || "app"; Object.assign(theme.surfaces[scope] ||= {}, data); }
  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;
    change(() => {
      edit(preset);
      if ((el("glass-scope").value || "app") === "app") theme.preset = name;
    });
  }

  for (const field of fields) {
    const control = el("glass-" + field);
    let editing = false;
    control.oninput = () => {
      if (!editing) { remember(); editing = true; }
      edit({ [field]: field in upper ? +control.value : control.value });
      theme.preset = "";
      el("glass-preset").value = "";
      render();
    };
    control.onchange = () => { editing = false; save(); };
  }
  el("glass-scope").onchange = () => { el("glass-preset").value = theme.preset || ""; render(); };
  el("glass-preset").onchange = e => applyPreset(e.target.value);
  for (const btn of presetButtons()) {
    btn.onclick = () => applyPreset(btn.dataset.glassPreset);
  }
  el("theme-scale").onchange = e => change(() => theme.scale = +e.target.value);
  el("theme-motion").onchange = e => change(() => {
    theme.motion = e.target.checked;
    if (theme.motion && theme.level === "reduced") theme.level = "balanced";
  });
  el("motion-level").onchange = e => change(() => {
    theme.level = e.target.value;
    theme.motion = theme.level !== "reduced";
  });
  el("motion-toggle").onclick = () => change(() => {
    const currentlyReduced = !theme.motion || theme.level === "reduced";
    if (currentlyReduced) { theme.motion = true; theme.level = "balanced"; }
    else { theme.motion = false; theme.level = "reduced"; }
  });
  el("dynamic-cover-bg").onchange = e => change(() => theme.dynamicCover = !!e.target.checked);
  el("battery-saver").onchange = e => change(() => theme.batterySaver = !!e.target.checked);
  el("back-position").onchange = e => change(() => theme.position = e.target.value);
  el("back-shade").onchange = e => change(() => theme.shade = +e.target.value);
  el("theme-export").onclick = () => { const box = el("theme-data"); box.value = JSON.stringify(theme, null, 2); box.focus?.(); box.select?.(); el("theme-data-status").textContent = "Đã chọn dữ liệu giao diện để sao chép."; };
  el("theme-import").onclick = () => {
    try {
      const raw = JSON.parse(el("theme-data").value);
      if (!raw || typeof raw.surfaces !== "object" || !raw.surfaces?.app) throw Error();
      change(() => theme = sanitize(raw));
      el("theme-data-status").textContent = "Đã nhập giao diện.";
    } catch { el("theme-data-status").textContent = "Dữ liệu giao diện không hợp lệ."; }
  };
  el("theme-inherit").onclick = () => change(() => { const scope = el("glass-scope").value || "app"; if (scope === "app") theme.surfaces.app = { ...defaults }; else delete theme.surfaces[scope]; });
  for (const [id, from, to] of [["theme-undo", history, future], ["theme-redo", future, history]]) {
    el(id).onclick = () => { if (!from.length) return; to.push(clone(theme)); theme = from.pop(); save(); };
  }

  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    navigator.getBattery().then(battery => {
      const syncBattery = () => {
        onBattery = !battery.charging;
        render();
      };
      syncBattery();
      battery.addEventListener?.("chargingchange", syncBattery);
      battery.addEventListener?.("levelchange", syncBattery);
    }).catch(() => {});
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", render);
  }

  const rootObj = typeof window !== "undefined" ? window : globalThis;
  rootObj.velunaTheme = {
    export: () => clone(theme),
    apply: incoming => change(() => theme = sanitize(incoming)),
    setPreset: applyPreset,
    presets: () => Object.keys(presets),
    isMotionReduced: () => !theme.motion || theme.level === "reduced" || theme.level === "economy",
    isDynamicCoverEnabled: () => !!theme.dynamicCover,
    isPowerSaving: () => (onBattery && theme.batterySaver) || (typeof document !== "undefined" && !!document.hidden)
  };
  render();
})();
