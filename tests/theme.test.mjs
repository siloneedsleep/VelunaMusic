import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

const themeJs = await readFile(new URL("../ui/theme.js", import.meta.url), "utf8");

test("Liquid Glass supports 4 presets, reduced motion toggle, dynamic cover toggle, and power/hidden states", async () => {
  const nodes = new Map(), saved = new Map(), listeners = {};
  const presetBtns = ["clear", "frost", "dark", "solid"].map(name => ({
    dataset: { glassPreset: name },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }
  }));
  const el = id => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        value: id === "glass-scope" ? "app" : "",
        checked: true,
        disabled: false,
        textContent: "",
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }
      });
    }
    return nodes.get(id);
  };
  let batteryObj = { charging: true, listeners: {}, addEventListener(n, fn) { this.listeners[n] = fn; } };
  const bodyProps = new Map();
  const body = {
    dataset: {},
    style: {
      setProperty(k, v) { bodyProps.set(k, v); },
      removeProperty(k) { bodyProps.delete(k); }
    }
  };
  const doc = {
    hidden: false,
    body,
    head: { append() {} },
    createElement: () => ({ textContent: "" }),
    querySelectorAll: sel => sel === "[data-glass-preset]" ? presetBtns : [],
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const ctx = {
    el,
    document: doc,
    matchMedia: () => ({ matches: false }),
    navigator: { getBattery: async () => batteryObj },
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) }
  };
  ctx.window = ctx;
  vm.runInNewContext(themeJs, ctx);
  await new Promise(r => setImmediate(r));

  assert.deepEqual([...ctx.velunaTheme.presets()], ["clear", "frost", "dark", "solid"]);
  for (const preset of ["clear", "frost", "dark", "solid"]) {
    ctx.velunaTheme.setPreset(preset);
    assert.equal(body.dataset.preset, preset);
    const activeBtn = presetBtns.find(b => b.dataset.glassPreset === preset);
    assert.equal(activeBtn.attrs["aria-pressed"], "true");
  }

  el("motion-toggle").onclick();
  assert.equal(body.dataset.motion, "off");
  assert.equal(el("motion-toggle").attrs["aria-pressed"], "true");
  el("motion-toggle").onclick();
  assert.equal(body.dataset.motion, "on");

  batteryObj.charging = false;
  batteryObj.listeners.chargingchange();
  assert.equal(body.dataset.power, "battery");

  doc.hidden = true;
  listeners.visibilitychange();
  assert.equal(body.dataset.windowState, "hidden");
});

test("Connect sheet, Spotify Desktop High-Density Dark Glass, and mobile layout markup and CSS tokens are present", async () => {
  const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../ui/theme.css", import.meta.url), "utf8");
  const playerCss = await readFile(new URL("../ui/player.css", import.meta.url), "utf8");

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<dialog id="connect-dialog"[^>]*closedby="any"/);
  assert.match(html, /<header class="app-topbar">[\s\S]*id="query"[\s\S]*<\/header>/);
  assert.match(html, /<dialog id="prefs"[\s\S]*id="motion-toggle"[\s\S]*<\/dialog>/);
  assert.match(html, /<details id="lyrics-panel" class="listening" open>/);
  for (const id of [
    "nav-back",
    "nav-forward",
    "connect-open",
    "topbar-eq",
    "now-panel-toggle",
    "now-panel-close",
    "account-avatar-label",
    "mobile-more",
    "mobile-bottom-nav",
    "mini-connect",
    "mini-progress-fill",
    "now-shuffle",
    "now-repeat",
    "now-device-pill",
    "now-sheet-close",
    "now-up-next",
    "now-up-next-list",
    "now-up-next-all",
    "home-quick-grid",
    "library-filter-bar",
    "library-layout-toggle"
  ]) {
    assert.ok(html.includes('id="' + id + '"'), "Missing element id=" + id + " in ui/index.html");
  }

  assert.match(playerCss, /--bg-canvas:#070a10/);
  assert.match(playerCss, /--bg-rail:#090d16/);
  assert.match(playerCss, /--bg-surface:#0e1422/);
  assert.match(playerCss, /rgba\(255,255,255,\.06\)/);
  assert.match(playerCss, /text-wrap:balance/);
  assert.match(css, /@media\(min-width:769px\)\{[\s\S]*body:not\(\.platform-android\) #mini-bar\{display:none!important\}/);
  assert.match(css, /grid-template-columns:220px minmax\(0,1fr\) 300px/);
  assert.match(css, /scrollbar-color:var\(--scrollbar-thumb\) var\(--scrollbar-track\)/);
  assert.match(css, /@supports not \(scrollbar-color:auto\)/);
  assert.match(css, /\.card-play-fab\{/);
  assert.match(css, /\.album-card:focus-within \.card-play-fab/);
  assert.match(css, /scroll-padding-bottom:calc\(136px \+ var\(--safe-bottom-inset\)\)/);
  assert.match(css, /\.up-next-card\{/);
  assert.match(playerCss, /--surface-canvas:var\(--bg-canvas\)/);
  assert.match(playerCss, /--glass-sheet-bg:/);
  assert.match(playerCss, /--radius-sheet:20px/);
  assert.match(css, /\.connect-sheet(?:,\.eq-sheet)?\{[^}]*transition-property:opacity,transform,display,overlay/);
  assert.match(css, /transition-behavior:allow-discrete/);
  assert.match(css, /@starting-style\{/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.match(css, /body\.platform-android\b/);
  assert.match(css, /--safe-top-inset/);
  assert.match(css, /--safe-bottom-inset/);
});
