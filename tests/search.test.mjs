import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const utilsCode = await readFile(new URL("../ui/utils.js", import.meta.url), "utf8");
const libraryCode = await readFile(new URL("../ui/library.js", import.meta.url), "utf8");

function makeClassList() {
  const set = new Set();
  return {
    add(...names) { for (const n of names) set.add(n); },
    remove(...names) { for (const n of names) set.delete(n); },
    toggle(name, force) {
      const next = force === undefined ? !set.has(name) : Boolean(force);
      if (next) set.add(name);
      else set.delete(name);
      return next;
    },
    contains(name) { return set.has(name); }
  };
}

function makeNode(tag = "div", attrs = {}) {
  const listeners = new Map();
  const attrMap = new Map();
  const node = {
    tagName: tag.toUpperCase(),
    id: attrs.id || "",
    className: "",
    textContent: attrs.textContent || "",
    value: attrs.value || "",
    hidden: Boolean(attrs.hidden),
    disabled: false,
    open: false,
    src: "",
    isConnected: true,
    dataset: { ...(attrs.dataset || {}) },
    classList: makeClassList(),
    children: [],
    parentElement: null,
    get childElementCount() { return this.children.length; },
    append(...items) {
      for (const item of items) {
        if (item && typeof item === "object") item.parentElement = this;
        this.children.push(item);
      }
    },
    replaceChildren(...items) {
      this.children = [];
      this.append(...items);
    },
    setAttribute(k, v) { attrMap.set(k, String(v)); },
    getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
    removeAttribute(k) { attrMap.delete(k); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of listeners.get(evt.type) || []) fn(evt);
    },
    querySelectorAll(sel) {
      if (sel === "[data-ytm-filter]") return this.children.filter(c => c.dataset?.ytmFilter);
      if (sel === "img[data-pending]") return [];
      return [];
    },
    focus() {}
  };
  return node;
}

function setupHarness({ initialTracks = [], searchImpl }) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode("div", { id }));
    return nodes.get(id);
  };

  const viewButtons = ["home", "all", "album", "artist", "favorite", "recent", "popular", "queue"].map(v =>
    makeNode("button", { dataset: { view: v }, textContent: v })
  );
  const filterButtons = ["all", "songs", "videos", "albums", "playlists"].map(f =>
    makeNode("button", { dataset: { ytmFilter: f }, textContent: f })
  );
  el("unified-ytm-filters").append(...filterButtons);
  el("unified-search").hidden = true;
  el("unified-detail").hidden = true;
  el("home-shelves").hidden = true;
  el("query-clear").hidden = true;

  for (const name of ["gpl", "font", "icons"]) {
    const details = makeNode("details");
    const pre = el("license-" + name);
    details.append(pre);
  }

  const played = [];
  const queued = [];
  const ytmPlayed = [];
  const ytmEnqueued = [];
  const messages = [];
  let timers = [];
  let nextTimerId = 1;

  const sandbox = {
    window: null,
    el,
    native: null,
    desktop: null,
    tracks: initialTracks,
    albumQueue: [],
    selected: "",
    playOrder() { return sandbox.albumQueue.length ? sandbox.albumQueue : sandbox.tracks.map(t => t.id); },
    loadTrack(id, play) { played.push({ id, play }); },
    playTrackQueue(ids) { queued.push(ids); },
    drawList() {},
    savePosition() {},
    msg(text) { messages.push(text); },
    Option: function(text, value) { return { text, value }; },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      for (const t of timers) if (t.id === id) t.cleared = true;
    },
    addEventListener() {},
    document: {
      hidden: false,
      body: { dataset: {} },
      activeElement: null,
      createElement: tag => makeNode(tag),
      querySelectorAll(sel) {
        if (sel === "[data-view]") return viewButtons;
        return [];
      },
      addEventListener() {}
    },
    velunaYtm: {
      search: searchImpl,
      async playTracks(list, startIndex, playNow) { ytmPlayed.push({ list, startIndex, playNow }); },
      async enqueueTracks(list) { ytmEnqueued.push(list); return list.length; },
      openHomeCollection() {},
      metaForId() { return null; },
      formatQuality() { return ""; }
    }
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(utilsCode, sandbox);
  vm.runInContext(libraryCode, sandbox);
  return {
    sandbox,
    el,
    filterButtons,
    played,
    queued,
    ytmPlayed,
    ytmEnqueued,
    messages,
    flushTimers() {
      const active = timers.filter(t => !t.cleared);
      timers = [];
      for (const t of active) t.fn();
    },
    activeTimerCount() {
      return timers.filter(t => !t.cleared).length;
    }
  };
}

test("unified search matches Vietnamese local library instantly and filters accents", () => {
  const harness = setupHarness({
    initialTracks: [
      { id: "file:///1.mp3", title: "Cơn Mưa Ngang Qua", artist: "Sơn Tùng M-TP", album: "M-TP Album" },
      { id: "file:///2.mp3", title: "Đêm Đông", artist: "Mỹ Tâm", album: "Tâm 9" }
    ],
    searchImpl: () => new Promise(() => {})
  });

  const { sandbox, el } = harness;
  assert.equal(sandbox.velunaLibrary.normalizeSearchText("Đêm Mưa · Sơn Tùng"), "dem mua · son tung");

  el("query").value = "son tung";
  sandbox.velunaLibrary.onSearchInput(false);

  assert.equal(el("unified-search").hidden, false);
  assert.equal(el("list").hidden, true);
  assert.equal(el("unified-local-count").textContent, "2");
  assert.equal(el("unified-local-list").children.length, 2);
  assert.equal(el("unified-ytm-count").textContent, "…");
  assert.equal(harness.activeTimerCount(), 1);

  el("unified-local-list").children[0].children[0].onclick();
  assert.equal(harness.played.length, 1);
  assert.equal(harness.played[0].id, "file:///1.mp3");

  el("unified-local-list").children[0].children[1].onclick();
  assert.equal(harness.messages.length, 1);
});

test("unified search guards against out-of-order YT Music responses and query clear via searchSeqId", async () => {
  const calls = [];
  const harness = setupHarness({
    initialTracks: [
      { id: "file:///a.mp3", title: "Cobalt Night", artist: "Local Artist" }
    ],
    searchImpl: (q, filter) => new Promise((resolve, reject) => {
      calls.push({ q, filter, resolve, reject });
    })
  });

  const { sandbox, el } = harness;
  el("query").value = "lofi";
  const seq1 = sandbox.velunaLibrary.onSearchInput(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, "lofi");

  el("query").value = "cobalt";
  const seq2 = sandbox.velunaLibrary.onSearchInput(true);
  assert.ok(seq2 > seq1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].q, "cobalt");

  calls[1].resolve({
    query: "cobalt",
    tracks: [{ video_id: "aB1_CD-2345", title: "Cobalt Stream", artist_text: "YT Artist", duration_text: "3:12", recording_label: "Bản gốc" }],
    videos: [],
    albums: [],
    playlists: []
  });
  await new Promise(r => setImmediate(r));
  assert.equal(el("unified-ytm-count").textContent, "1");
  assert.equal(el("unified-ytm-list").children[0].children[0].children[1].children[0].textContent, "Cobalt Stream");

  calls[0].resolve({
    query: "lofi",
    tracks: [{ video_id: "zZ9_YY-8888", title: "Stale Lofi Result", artist_text: "Old Artist" }],
    videos: [],
    albums: [],
    playlists: []
  });
  await new Promise(r => setImmediate(r));
  assert.equal(el("unified-ytm-count").textContent, "1");
  assert.equal(el("unified-ytm-list").children[0].children[0].children[1].children[0].textContent, "Cobalt Stream");

  el("query").value = "playlist test";
  sandbox.velunaLibrary.onSearchInput(false);
  assert.equal(harness.activeTimerCount(), 1);
  el("query").value = "";
  sandbox.velunaLibrary.onSearchInput(false);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(el("unified-search").hidden, true);
  assert.equal(el("list").hidden, false);
});

test("unified search respects IME Enter guard, filter chips, and offline fallback without breaking local results", async () => {
  const calls = [];
  const harness = setupHarness({
    initialTracks: [
      { id: "file:///v.mp3", title: "Việt Nam Ơi", artist: "Minh Beta" }
    ],
    searchImpl: (q, filter) => {
      calls.push({ q, filter });
      return Promise.reject(new Error("Offline"));
    }
  });

  const { sandbox, el, filterButtons } = harness;
  el("query").value = "viet nam";
  sandbox.velunaLibrary.onSearchInput(false);
  assert.equal(calls.length, 0);

  el("query").dispatchEvent({ type: "keydown", key: "Enter", isComposing: true, keyCode: 229, preventDefault() {} });
  assert.equal(calls.length, 0);

  el("query").dispatchEvent({ type: "keydown", key: "Enter", isComposing: false, keyCode: 13, preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter, "all");
  await new Promise(r => setImmediate(r));

  assert.equal(el("unified-local-count").textContent, "1");
  assert.equal(el("unified-ytm-count").textContent, "0");
  assert.match(el("unified-ytm-list").children[0].children[0].textContent, /ngoại tuyến/);

  filterButtons[4].onclick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].filter, "playlists");
  assert.equal(filterButtons[4].getAttribute("aria-pressed"), "true");
});
