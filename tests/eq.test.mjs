import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const utilsJs = await readFile(new URL("../ui/utils.js", import.meta.url), "utf8");
const eqJs = await readFile(new URL("../ui/eq.js", import.meta.url), "utf8");
const soundJs = await readFile(new URL("../ui/sound.js", import.meta.url), "utf8");
const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../ui/theme.css", import.meta.url), "utf8");

function makeParam(initial = 0) {
  return {
    value: initial,
    targets: [],
    setTargetAtTime(val, t, tc) {
      this.value = val;
      this.targets.push({ val, t, tc });
    }
  };
}

function createEqHarness({ nativeBridge = null, initialStorage = {}, ytmMeta = {} } = {}) {
  const saved = new Map(Object.entries(initialStorage));
  const elements = new Map();
  const presetButtons = ["flat", "bass", "vocal", "electronic", "acoustic", "latenight"].map(key => ({
    dataset: { eqPreset: key },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    onclick: null
  }));
  const bandInputs = Array.from({ length: 10 }, (_, idx) => {
    const props = new Map();
    return {
      dataset: { band: String(idx) },
      min: "-12",
      max: "12",
      value: "0",
      disabled: false,
      attrs: {},
      props,
      style: { setProperty(k, v) { props.set(k, v); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      oninput: null,
      onchange: null
    };
  });

  const el = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      const node = {
        id,
        value: id === "sound-profile" ? "speaker" : "0",
        checked: false,
        disabled: false,
        hidden: true,
        open: false,
        textContent: "",
        attrs: {},
        classList: {
          toggle(name, force) {
            if (force) classes.add(name);
            else classes.delete(name);
          },
          has(name) { return classes.has(name); }
        },
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener() {},
        showModal() { this.open = true; },
        close() { this.open = false; },
        querySelectorAll(sel) {
          if (id === "eq-presets" && sel === "[data-eq-preset]") return presetButtons;
          if (id === "eq-bands" && sel === "input[data-band]") return bandInputs;
          return [];
        }
      };
      elements.set(id, node);
    }
    return elements.get(id);
  };

  const createdContexts = [];
  class FakeAudioContext {
    constructor() {
      this.currentTime = 1.25;
      this.state = "suspended";
      this.destination = { kind: "destination" };
      this.connections = [];
      this.filters = [];
      this.gains = [];
      this.compressors = [];
      this.sources = [];
      this.resumes = 0;
      this.suspends = 0;
      this.sinkId = "";
      createdContexts.push(this);
    }
    createGain() {
      const node = {
        kind: "gain",
        gain: makeParam(1),
        connect: target => { this.connections.push([node, target]); }
      };
      this.gains.push(node);
      return node;
    }
    createBiquadFilter() {
      const node = {
        kind: "biquad",
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
        gain: makeParam(0),
        connect: target => { this.connections.push([node, target]); }
      };
      this.filters.push(node);
      return node;
    }
    createDynamicsCompressor() {
      const node = {
        kind: "compressor",
        threshold: makeParam(0),
        knee: makeParam(0),
        ratio: makeParam(1),
        attack: makeParam(0.005),
        release: makeParam(0.15),
        connect: target => { this.connections.push([node, target]); }
      };
      this.compressors.push(node);
      return node;
    }
    createMediaElementSource(mediaEl) {
      const node = {
        kind: "source",
        mediaEl,
        disconnected: false,
        connect: target => { this.connections.push([node, target]); },
        disconnect: () => { node.disconnected = true; }
      };
      this.sources.push(node);
      return node;
    }
    async resume() { this.state = "running"; this.resumes++; }
    async suspend() { this.state = "suspended"; this.suspends++; }
    async setSinkId(id) { this.sinkId = id; }
  }

  const deckA = { name: "deckA", paused: false, sinkId: "", async setSinkId(id) { this.sinkId = id; } };
  const ctx = {
    el,
    audio: deckA,
    native: nativeBridge,
    desktop: null,
    tracks: [],
    navigator: {},
    AudioContext: FakeAudioContext,
    localStorage: {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, String(v))
    },
    velunaYtm: {
      metaForId: id => ytmMeta[id] || null
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(utilsJs, ctx);
  vm.runInContext(eqJs, ctx);
  vm.runInContext(soundJs, ctx);
  return { ctx, el, deckA, saved, createdContexts, presetButtons, bandInputs };
}

test("Desktop 10-band WebAudio DSP chains 10 peaking filters + DynamicsCompressorNode across Deck A and Deck B", async () => {
  const h = createEqHarness();
  assert.equal(h.createdContexts.length, 0);

  await h.ctx.velunaEQ.applyPreset("bass");
  assert.equal(h.createdContexts.length, 1);
  assert.equal(h.el("topbar-eq").attrs["aria-pressed"], "true");
  h.el("topbar-eq").onclick();
  assert.equal(h.el("eq-dialog").open, true);

  const ac = h.createdContexts[0];
  assert.equal(ac.filters.length, 10);
  assert.deepEqual(
    ac.filters.map(f => f.frequency.value),
    [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  );
  assert.ok(ac.filters.every(f => f.type === "peaking" && f.Q.value === 1.41));
  assert.deepEqual(
    ac.filters.map(f => f.gain.value),
    [6, 5, 4, 2, 0, 0, 0, 1, 1, 0]
  );
  assert.equal(ac.compressors.length, 1);
  assert.equal(ac.compressors[0].threshold.value, -10);
  assert.equal(ac.compressors[0].ratio.value, 4);
  assert.ok(ac.gains[0].gain.value < 1, "Bass boost applies headroom attenuation to prevent clipping");
  assert.equal(ac.sources.length, 1);
  assert.equal(ac.sources[0].mediaEl, h.deckA);

  assert.ok(ac.connections.some(([a, b]) => a === ac.gains[0] && b === ac.filters[0]));
  assert.ok(ac.connections.some(([a, b]) => a === ac.filters[9] && b === ac.compressors[0]));
  assert.ok(ac.connections.some(([a, b]) => a === ac.compressors[0] && b === ac.destination));

  const deckB = { name: "deckB", paused: false, async setSinkId() {} };
  h.ctx.velunaSound.attach(deckB);
  assert.equal(h.createdContexts.length, 1, "Deck B shares the single AudioContext");
  assert.equal(ac.sources.length, 2);
  assert.equal(ac.sources[1].mediaEl, deckB);
  assert.ok(ac.connections.some(([a, b]) => a === ac.sources[1] && b === ac.gains[0]));

  h.deckA.paused = true;
  h.ctx.velunaSound.sleep();
  assert.equal(ac.suspends, 0, "AudioContext stays awake while Deck B is still playing");

  deckB.paused = true;
  h.ctx.velunaSound.detach(deckB);
  assert.equal(ac.sources[1].disconnected, true);
  h.ctx.velunaSound.sleep();
  assert.equal(ac.suspends, 1);
});

test("Presets, custom band edits, localStorage persistence, and Reset to 0 dB work end-to-end", async () => {
  const h = createEqHarness();

  for (const key of ["flat", "bass", "vocal", "electronic", "acoustic", "latenight"]) {
    await h.ctx.velunaEQ.applyPreset(key);
    assert.equal(h.ctx.velunaEQ.getState().preset, key);
    const activeBtn = h.presetButtons.find(b => b.dataset.eqPreset === key);
    assert.equal(activeBtn.attrs["aria-pressed"], "true");
  }
  assert.equal(h.createdContexts[0].compressors[0].threshold.value, -24);
  assert.equal(h.createdContexts[0].compressors[0].ratio.value, 6);

  await h.ctx.velunaEQ.setBand(0, 8.5);
  assert.equal(h.ctx.velunaEQ.getState().preset, "custom");
  assert.equal(h.ctx.velunaEQ.getState().bands[0], 8.5);
  assert.equal(h.bandInputs[0].props.get("--control-value"), "8.5");
  assert.equal(h.bandInputs[0].attrs["aria-valuetext"], "+8.5 dB");

  const persisted = h.saved.get("veluna-eq-v1");
  assert.ok(persisted);
  const reloaded = createEqHarness({ initialStorage: { "veluna-eq-v1": persisted } });
  assert.equal(reloaded.ctx.velunaEQ.getState().enabled, true);
  assert.equal(reloaded.ctx.velunaEQ.getState().preset, "custom");
  assert.equal(reloaded.ctx.velunaEQ.getState().bands[0], 8.5);

  await reloaded.ctx.velunaEQ.reset();
  assert.equal(reloaded.ctx.velunaEQ.getState().preset, "flat");
  assert.deepEqual([...reloaded.ctx.velunaEQ.getState().bands], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("Loudness Normalization computes bounded gain from YouTube loudness_db and updates WebAudio preGain", async () => {
  const h = createEqHarness({
    ytmMeta: {
      "ytmusic://loudTrack001": { loudness_db: 4.5 },
      "ytmusic://quietTrack02": { loudness_db: -5.0 }
    }
  });
  assert.equal(h.ctx.velunaEQ.computeNormalizationGainDb(4.5), -4.5);
  assert.equal(h.ctx.velunaEQ.computeNormalizationGainDb(-5.0), 5.0);
  assert.equal(h.ctx.velunaEQ.computeNormalizationGainDb(25), -12);
  assert.equal(h.ctx.velunaEQ.computeNormalizationGainDb(-25), 6);

  await h.ctx.velunaEQ.setNormalize(true);
  await h.ctx.velunaEQ.updateTrackLoudness("ytmusic://loudTrack001");
  const ac = h.createdContexts[0];
  assert.ok(Math.abs(ac.gains[0].gain.value - Math.pow(10, -4.5 / 20)) < 1e-4);
  assert.equal(h.el("eq-norm-gain").textContent, "-4.5 dB");

  await h.ctx.velunaEQ.updateTrackLoudness("ytmusic://quietTrack02");
  assert.ok(Math.abs(ac.gains[0].gain.value - Math.pow(10, 5.0 / 20)) < 1e-4);
  assert.equal(h.el("eq-norm-gain").textContent, "+5 dB");
});

test("Android native bridge forwards 10-band EQ and loudness normalization without creating WebAudio AudioContext", async () => {
  const calls = [];
  const h = createEqHarness({
    nativeBridge: {
      setEqualizer10(enabled, bandsJson, normalize, gainMb) {
        calls.push({ enabled, bands: JSON.parse(bandsJson), normalize, gainMb });
      }
    }
  });

  await h.ctx.velunaEQ.applyPreset("electronic");
  await h.ctx.velunaEQ.setNormalize(true);
  assert.equal(h.createdContexts.length, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].bands, [5, 4, 2, 0, -1, 1, 2, 4, 5, 4]);
  assert.equal(calls[1].enabled, true);
  assert.equal(calls[1].normalize, true);
  assert.equal(calls[1].gainMb, 150);
});

test("Equalizer modal markup, vertical slider CSS compliance, and Android native hooks are intact", async () => {
  assert.match(html, /<script src="eq\.js" defer><\/script>\s*<script src="sound\.js" defer><\/script>/);
  assert.match(html, /id="eq-open"/);
  assert.match(html, /id="prefs-open-eq"/);
  assert.match(html, /<dialog id="eq-dialog" class="eq-sheet" closedby="any"/);
  for (const preset of ["flat", "bass", "vocal", "electronic", "acoustic", "latenight"]) {
    assert.match(html, new RegExp(`data-eq-preset="${preset}"`));
  }
  for (let i = 0; i < 10; i++) {
    assert.match(html, new RegExp(`id="eq-band-${i}"[^>]*type="range"[^>]*data-band="${i}"`));
  }

  assert.match(css, /\.eq-slider\{[\s\S]*writing-mode:vertical-lr;[\s\S]*direction:rtl;/);
  assert.match(css, /@supports not \(opacity:progress\(1,0,100\)\)/);
  assert.doesNotMatch(css, /::-webkit-slider-[a-z-]+,\s*[^\{]*::-moz-range-/);

  const trackEqJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/TrackEqualizer.java", import.meta.url), "utf8");
  const playbackJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/PlaybackService.java", import.meta.url), "utf8");
  const mainActivityJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/MainActivity.java", import.meta.url), "utf8");
  const mediaHelpersJava = await readFile(new URL("../android/app/src/main/java/xyz/siloneedsleep/veluna/MediaHelpers.java", import.meta.url), "utf8");
  assert.match(trackEqJava, /android\.media\.audiofx\.Equalizer/);
  assert.match(trackEqJava, /android\.media\.audiofx\.LoudnessEnhancer/);
  assert.match(trackEqJava, /onMediaItemTransition/);
  assert.match(playbackJava, /attachAudioEffects/);
  assert.match(playbackJava, /MediaHelpers\.streamMetaSnapshot/);
  assert.match(mediaHelpersJava, /loudness_db/);
  assert.match(mainActivityJava, /setEqualizer10\(/);
});
