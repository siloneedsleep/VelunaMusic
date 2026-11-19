import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const utilsJs = await readFile(new URL("../ui/utils.js", import.meta.url), "utf8");
const sourcesJs = await readFile(new URL("../ui/sources.js", import.meta.url), "utf8");
const playerJs = await readFile(new URL("../ui/player.js", import.meta.url), "utf8");
const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");

test("Smart Offline Cache downloads track + playlist, prioritizes 0ms local playback when offline, and deletes cached copy", async () => {
  const vid1 = "aB1_CD-2345";
  const vid2 = "xY9_ZZ-1122";
  const nodes = new Map();
  const saved = new Map();
  const calls = [];
  const tracks = [];
  const element = () => ({
    children: [],
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    attrs: {},
    append(...v) { this.children.push(...v); },
    replaceChildren(...v) { this.children = v; },
    setAttribute(k, v) { this.attrs[k] = String(v); }
  });
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  let networkOnline = true;
  const ctx = {
    URL,
    el,
    tracks,
    albumQueue: [],
    draw() {},
    msg() {},
    document: { createElement: element },
    localStorage: {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, String(v))
    },
    desktop: {
      convertFileSrc: p => "asset://localhost/" + p.replace(/\\/g, "/"),
      async invoke(cmd, args) {
        calls.push({ cmd, args });
        if (cmd === "offline_download") {
          return {
            video_id: args.videoId,
            id: "ytmusic://" + args.videoId,
            title: args.title || args.videoId,
            artist: args.artist || "Veluna Artist",
            album: args.album || "",
            codec: "opus",
            container: "webm",
            bitrate_kbps: 140,
            sample_rate: 48000,
            loudness_db: -2.0,
            duration_sec: 200,
            audio_path: "C:/AppData/offline/" + args.videoId + ".webm",
            cover_path: "C:/AppData/offline/" + args.videoId + ".jpg",
            lyrics: "[00:02.00] Cached Offline Lyric\n",
            size_bytes: 2048000,
            downloaded_at: 1700000000
          };
        }
        if (cmd === "offline_delete") return true;
        if (cmd === "save_online_tracks") return null;
        if (cmd === "ytm_stream") {
          if (!networkOnline) throw new Error("Network offline");
          return {
            video_id: args.videoId,
            url: "http://127.0.0.1:4555/tok/" + args.videoId,
            codec: "opus",
            container: "webm",
            bitrate: 140000,
            bitrate_kbps: 140,
            sample_rate: 48000,
            expires_at: 1999999999
          };
        }
        return null;
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(utilsJs, ctx);
  vm.runInContext(sourcesJs, ctx);

  await ctx.velunaYtm.downloadTrack({
    id: "ytmusic://" + vid1,
    video_id: vid1,
    title: "Offline Track One",
    artist: "Artist One"
  });

  assert.equal(ctx.velunaYtm.isOffline(vid1), true);
  assert.equal(ctx.velunaYtm.sourceBadge({ id: "ytmusic://" + vid1 }), "Đã tải về · Offline");
  assert.equal(saved.get("lyrics/ytmusic://" + vid1), "[00:02.00] Cached Offline Lyric\n");

  networkOnline = false;
  const beforeStreamCalls = calls.filter(c => c.cmd === "ytm_stream").length;
  const streamInfo = await ctx.velunaYtm.stream("ytmusic://" + vid1, false);
  assert.equal(streamInfo.offline, true);
  assert.match(streamInfo.url, /^asset:\/\/localhost\/C:\/AppData\/offline\/aB1_CD-2345\.webm$/);
  assert.equal(calls.filter(c => c.cmd === "ytm_stream").length, beforeStreamCalls);

  const count = await ctx.velunaYtm.downloadPlaylist([
    { video_id: vid1, title: "Already Cached" },
    { video_id: vid2, title: "Second Track" }
  ]);
  assert.equal(count, 1);
  assert.equal(ctx.velunaYtm.isOffline(vid2), true);

  await ctx.velunaYtm.deleteOffline(vid1);
  assert.equal(ctx.velunaYtm.isOffline(vid1), false);
  assert.equal(ctx.velunaYtm.sourceBadge({ id: "ytmusic://" + vid1 }), "YouTube Music");

  networkOnline = true;
  const onlineStream = await ctx.velunaYtm.stream("ytmusic://" + vid1, false);
  assert.equal(Boolean(onlineStream.offline), false);
  assert.match(onlineStream.url, /^http:\/\/127\.0\.0\.1:4555/);
});

test("Spotify desktop keyboard shortcuts control playback, search, seek, volume, mute, and lyrics while ignoring text inputs", () => {
  const nodes = new Map();
  const saved = new Map();
  const listeners = new Map();
  let playClicks = 0;
  let queryFocused = 0;
  let querySelected = 0;
  const audioEl = {
    src: "asset://track-1.mp3",
    volume: 0.5,
    muted: false,
    paused: true,
    currentTime: 30,
    duration: 180,
    load() {},
    pause() { this.paused = true; },
    async play() { this.paused = false; },
    addEventListener() {}
  };
  const makeNode = id => {
    const attrs = new Map();
    const classes = new Set();
    return {
      id,
      value: id === "repeat-mode" ? "off" : (id === "seek" ? "30" : ""),
      max: id === "seek" ? "180" : "0",
      textContent: "",
      src: "",
      open: id === "lyrics-panel",
      hidden: false,
      disabled: false,
      checked: false,
      dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, f) { if (f === undefined ? !classes.has(c) : f) classes.add(c); else classes.delete(c); },
        contains(c) { return classes.has(c); }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) || null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener() {},
      dispatchEvent() {},
      replaceChildren() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() { if (id === "query") queryFocused++; },
      select() { if (id === "query") querySelected++; },
      click() {
        if (id === "play") {
          playClicks++;
          this.onclick?.();
        }
      }
    };
  };
  const getEl = id => {
    if (id === "audio") return audioEl;
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  const doc = {
    hidden: false,
    activeElement: null,
    body: {
      dataset: {},
      classList: { add() {}, contains() { return false; } },
      style: { setProperty() {}, removeProperty() {} }
    },
    getElementById: getEl,
    createElement: tag => makeNode(tag),
    createDocumentFragment: () => ({ childNodes: [], append(n) { this.childNodes.push(n); } }),
    querySelectorAll: () => [],
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    }
  };
  const ctx = {
    document: doc,
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, String(v)),
      removeItem: k => saved.delete(k)
    },
    addEventListener() {},
    dispatchEvent() {},
    setInterval() { return 1; },
    matchMedia: () => ({ matches: false }),
    __TAURI__: {
      core: {
        convertFileSrc: p => "asset://" + p,
        async invoke() { return []; }
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(utilsJs, ctx);
  vm.runInContext(playerJs, ctx);

  vm.runInContext(`
    tracks = [{ id: "track-1.mp3", title: "One" }, { id: "track-2.mp3", title: "Two" }];
    selected = "track-1.mp3";
    audio.currentTime = 30;
    audio.duration = 180;
    window.velunaShortcuts.setPlayerVolume(0.5, false);
  `, ctx);

  const fireKey = opts => {
    let prevented = false;
    const ev = {
      key: "",
      code: "",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      target: { tagName: "BODY", isContentEditable: false, closest: () => null },
      preventDefault() { prevented = true; this.defaultPrevented = true; },
      ...opts
    };
    const handled = ctx.velunaShortcuts.handleKeydown(ev);
    return { handled, prevented };
  };

  assert.equal(fireKey({ key: " ", code: "Space" }).handled, true);
  assert.equal(playClicks, 1);

  const inputTarget = { tagName: "INPUT", isContentEditable: false, closest: sel => sel.includes("input") ? {} : null };
  assert.equal(fireKey({ key: " ", code: "Space", target: inputTarget }).handled, false);
  assert.equal(playClicks, 1);
  assert.equal(fireKey({ key: "/", target: inputTarget }).handled, false);

  assert.equal(fireKey({ key: "k", ctrlKey: true, target: inputTarget }).handled, true);
  assert.equal(queryFocused, 1);
  assert.equal(querySelected, 1);

  assert.equal(fireKey({ key: "/" }).handled, true);
  assert.equal(queryFocused, 2);

  assert.equal(fireKey({ key: "ArrowRight", shiftKey: true }).handled, true);
  assert.equal(audioEl.currentTime, 40);
  assert.equal(fireKey({ key: "ArrowLeft", shiftKey: true }).handled, true);
  assert.equal(audioEl.currentTime, 30);

  assert.equal(fireKey({ key: "ArrowUp", ctrlKey: true }).handled, true);
  assert.equal(audioEl.volume, 0.55);
  assert.equal(fireKey({ key: "ArrowDown", ctrlKey: true }).handled, true);
  assert.equal(audioEl.volume, 0.5);

  assert.equal(fireKey({ key: "m" }).handled, true);
  assert.equal(audioEl.muted, true);
  assert.equal(audioEl.volume, 0);
  assert.equal(fireKey({ key: "M" }).handled, true);
  assert.equal(audioEl.muted, false);
  assert.equal(audioEl.volume, 0.5);

  assert.equal(fireKey({ key: "ArrowRight", ctrlKey: true }).handled, true);
  assert.equal(vm.runInContext("selected", ctx), "track-2.mp3");
  assert.equal(fireKey({ key: "ArrowLeft", ctrlKey: true }).handled, true);
  assert.equal(vm.runInContext("selected", ctx), "track-1.mp3");

  const lyricsPanel = getEl("lyrics-panel");
  assert.equal(lyricsPanel.open, true);
  assert.equal(fireKey({ key: "L", altKey: true, shiftKey: true }).handled, true);
  assert.equal(lyricsPanel.open, false);
  doc.body.dataset.rightCollapsed = "true";
  assert.equal(fireKey({ key: "l", altKey: true, shiftKey: true }).handled, true);
  assert.equal(doc.body.dataset.rightCollapsed, undefined);
  assert.equal(lyricsPanel.open, true);
});

test("Offline UI controls and Android/Windows offline backend hooks are present", async () => {
  assert.match(html, /id="now-offline"/);
  assert.match(html, /id="now-offline-remove"/);
  assert.match(html, /simpmusic\/download\.svg/);

  const offlineJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/OfflineStore.java", import.meta.url), "utf8");
  const playbackJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/PlaybackService.java", import.meta.url), "utf8");
  const mainActivityJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/MainActivity.java", import.meta.url), "utf8");
  const proguard = await readFile(new URL("../android/app/proguard-rules.pro", import.meta.url), "utf8");
  const gradle = await readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8");
  const cargoToml = await readFile(new URL("../Cargo.toml", import.meta.url), "utf8");
  assert.match(offlineJava, /new File\(context\.getApplicationContext\(\)\.getFilesDir\(\), "offline"\)/);
  assert.match(offlineJava, /isContainedFile/);
  assert.match(playbackJava, /OfflineStore\.findAudioFile/);
  assert.match(mainActivityJava, /offlineList\(/);
  assert.match(mainActivityJava, /offlineDownload\(/);
  assert.match(mainActivityJava, /offlineDelete\(/);
  assert.match(proguard, /@android\.webkit\.JavascriptInterface/);
  assert.match(proguard, /xyz\.siloneedsleep\.veluna\.MainActivity/);
  assert.match(proguard, /native <methods>/);
  assert.match(gradle, /minifyEnabled true/);
  assert.match(gradle, /proguard-rules\.pro/);
  assert.match(cargoToml, /\[profile\.release\][\s\S]*lto = "thin"[\s\S]*codegen-units = 1[\s\S]*strip = true/);
});
