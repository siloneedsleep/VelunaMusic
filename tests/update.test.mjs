import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const utilsCode = await readFile(new URL("../ui/utils.js", import.meta.url), "utf8");
const libraryCode = await readFile(new URL("../ui/library.js", import.meta.url), "utf8");
const releaseWorkflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");

function makeNode(id = "") {
  const attrs = new Map();
  return {
    id,
    hidden: id === "update-banner",
    disabled: false,
    textContent: "",
    href: "",
    value: "",
    open: false,
    dataset: {},
    children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) || null; },
    removeAttribute(k) { attrs.delete(k); },
    addEventListener() {},
    append(...c) { this.children.push(...c); },
    replaceChildren(...c) { this.children = c; },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
}

function createUpdateEnv({ isAndroid = false, appVersion = "0.1.0", fetchImpl }) {
  const nodes = new Map();
  const storage = new Map();
  const messages = [];
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  const viewButtons = ["home", "all", "album", "artist", "favorite", "recent", "popular", "queue"].map(v => {
    const btn = makeNode();
    btn.dataset.view = v;
    btn.textContent = v;
    return btn;
  });
  for (const name of ["gpl", "font", "icons"]) {
    const p = makeNode();
    el("license-" + name).parentElement = p;
  }
  const env = {
    el,
    native: isAndroid ? {} : null,
    desktop: null,
    tracks: [],
    albumQueue: [],
    selected: "",
    fetch: fetchImpl,
    AbortSignal,
    Date,
    navigator: { userAgent: isAndroid ? "Mozilla/5.0 Android" : "Mozilla/5.0 Windows NT 10.0" },
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    drawList() {},
    msg: t => messages.push(t),
    Option: function(text, value) { return { text, value }; },
    document: {
      hidden: false,
      body: { dataset: { appVersion } },
      createElement: () => makeNode(),
      querySelector: () => null,
      querySelectorAll: sel => (sel === "[data-view]" ? viewButtons : []),
      addEventListener() {}
    },
    addEventListener() {}
  };
  env.window = env;
  vm.createContext(env);
  vm.runInContext(utilsCode, env);
  vm.runInContext(libraryCode, env);
  return { env, el, storage, messages };
}

test("GitHub Actions release workflow builds Windows, Android, checksums, and publishes release", () => {
  assert.match(releaseWorkflow, /tags:\s*\n\s*-\s*'v\*'/);
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /build-windows:[\s\S]*runs-on:\s*windows-latest/);
  assert.match(releaseWorkflow, /cargo build --release --locked --features custom-protocol -p velunamusic/);
  assert.match(releaseWorkflow, /VelunaMusic-\$tag-windows-x64\.exe/);
  assert.match(releaseWorkflow, /\.sha256/);
  assert.match(releaseWorkflow, /build-android:[\s\S]*runs-on:\s*ubuntu-latest/);
  assert.match(releaseWorkflow, /java-version:\s*17/);
  assert.match(releaseWorkflow, /aarch64-linux-android/);
  assert.match(releaseWorkflow, /assembleRelease/);
  assert.match(releaseWorkflow, /assembleDebug/);
  assert.match(releaseWorkflow, /VelunaMusic-\$\{RELEASE_TAG\}-android\.apk/);
  assert.match(releaseWorkflow, /publish-release:[\s\S]*needs:\s*\[build-windows,\s*build-android\]/);
  assert.match(releaseWorkflow, /SHA256SUMS\.txt/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(indexHtml, /connect-src[^"]*https:\/\/api\.github\.com/);
});

test("in-app update checker caches for 6 hours, picks platform binary, and renders update banner", async () => {
  let fetchCalls = 0;
  const tag = "v1.0.2";
  const base = "https://github.com/siloneedsleep/VelunaMusic/releases/download/" + tag + "/";
  const releasePayload = {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      { name: "VelunaMusic-v1.0.2-windows-x64.exe", state: "uploaded", size: 12000000, browser_download_url: base + "VelunaMusic-v1.0.2-windows-x64.exe" },
      { name: "VelunaMusic-v1.0.2-android.apk", state: "uploaded", size: 15000000, browser_download_url: base + "VelunaMusic-v1.0.2-android.apk" }
    ]
  };
  const win = createUpdateEnv({
    isAndroid: false,
    appVersion: "0.1.0",
    fetchImpl: async url => {
      fetchCalls++;
      assert.equal(url, "https://api.github.com/repos/siloneedsleep/VelunaMusic/releases/latest");
      return { ok: true, status: 200, json: async () => releasePayload };
    }
  });

  assert.equal(win.env.velunaUpdates.isNewerRelease("0.1.0", "v1.0.2"), true);
  assert.equal(win.env.velunaUpdates.isNewerRelease("1.0.2", "v1.0.2"), false);
  assert.equal(win.env.velunaUpdates.isNewerRelease("1.0.2", "v1.0.3-beta.1"), false);

  const first = await win.env.velunaUpdates.check(false);
  assert.equal(fetchCalls, 1);
  assert.equal(first.available, true);
  assert.equal(first.fromCache, false);
  assert.equal(win.el("update-banner").hidden, false);
  assert.equal(win.el("update-download-link").href, base + "VelunaMusic-v1.0.2-windows-x64.exe");

  const second = await win.env.velunaUpdates.check(false);
  assert.equal(fetchCalls, 1);
  assert.equal(second.fromCache, true);

  win.el("update-dismiss").onclick();
  assert.equal(win.el("update-banner").hidden, true);

  const manual = await win.env.velunaUpdates.check(true);
  assert.equal(fetchCalls, 2);
  assert.equal(manual.fromCache, false);
  assert.equal(win.el("update-banner").hidden, false);

  const android = createUpdateEnv({
    isAndroid: true,
    appVersion: "0.1.0",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => releasePayload })
  });
  await new Promise(r => setImmediate(r));
  assert.equal(android.el("update-download-link").href, base + "VelunaMusic-v1.0.2-android.apk");
  assert.match(android.el("update-download-link").textContent, /\.apk/);
});
