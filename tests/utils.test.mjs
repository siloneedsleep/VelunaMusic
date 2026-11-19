import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const utilsJs = await readFile(new URL("../ui/utils.js", import.meta.url), "utf8");

function createUtilsHarness({ native = null, desktop = null } = {}) {
  const ctx = {
    URL,
    native,
    desktop,
    setTimeout,
    clearTimeout,
    document: {
      body: { dataset: {} },
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          className: "",
          textContent: "",
          src: "",
          alt: "",
          attrs: {},
          children: [],
          setAttribute(k, v) { this.attrs[k] = String(v); },
          append(...nodes) { this.children.push(...nodes); }
        };
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(utilsJs, ctx);
  return ctx.velunaUtils;
}

test("velunaUtils formats time, normalizes Vietnamese text, extracts video IDs, and filters dummy tracks", () => {
  const u = createUtilsHarness();
  assert.equal(u.formatTime(0), "0:00");
  assert.equal(u.formatTime(125), "2:05");
  assert.equal(u.formatTime(NaN), "0:00");

  assert.equal(u.normalizeSearchText("  Đêm Khuya — Lạc Trôi  "), "dem khuya — lac troi");
  assert.equal(u.videoId("ytmusic://aB1_CD-2345"), "aB1_CD-2345");
  assert.equal(u.videoId("https://music.youtube.com/watch?v=aB1_CD-2345"), "aB1_CD-2345");
  assert.equal(u.videoId("https://youtu.be/aB1_CD-2345"), "aB1_CD-2345");
  assert.equal(u.videoId("https://evil.example/watch?v=aB1_CD-2345"), "");

  assert.equal(u.isDummyTrack({ title: "Veluna QA Sample" }), true);
  assert.equal(u.isDummyTrack({ title: "Veluna LAN test track" }), true);
  assert.equal(u.isDummyTrack({ title: "Nơi Này Có Anh" }), false);
});

test("velunaUtils debounce, fallback image, track card builder, dialog helpers, and bridge dispatch work cleanly", async () => {
  const invoked = [];
  const u = createUtilsHarness({
    desktop: {
      async invoke(cmd, args) {
        invoked.push({ cmd, args });
        return { ok: true };
      }
    }
  });

  let calls = 0;
  const debounced = u.debounce(() => { calls++; }, 15);
  debounced.call();
  debounced.call();
  await new Promise(r => setTimeout(r, 35));
  assert.equal(calls, 1);
  debounced.call();
  debounced.cancel();
  await new Promise(r => setTimeout(r, 35));
  assert.equal(calls, 1);

  const img = { src: "", alt: "bad" };
  u.applyCoverFallback(img, "https://example.com/art.jpg");
  assert.equal(img.src, "https://example.com/art.jpg");
  img.onerror();
  assert.equal(img.src, "icon.png");

  let played = false;
  let queued = false;
  const { row } = u.createTrackCard({
    title: "Song A",
    subtitle: "Artist B",
    duration: "3:40",
    coverUrl: "",
    sourceBadgeText: "YT Music",
    variantText: "Live",
    onPlay: () => { played = true; },
    onQueue: () => { queued = true; }
  });
  row.children[0].onclick();
  row.children[1].onclick();
  assert.equal(played, true);
  assert.equal(queued, true);

  const dialog = { open: false, dataset: {}, showModal() { this.open = true; }, close() { this.open = false; } };
  u.openDialog(dialog);
  assert.equal(dialog.open, true);
  u.closeDialog(dialog);
  assert.equal(dialog.open, false);

  const res = await u.callBridge({
    nativeMethod: "ytmSearch",
    tauriCommand: "ytmusic_search",
    desktopArgs: { query: "lofi" }
  });
  assert.equal(res.ok, true);
  assert.equal(invoked[0].cmd, "ytmusic_search");
});
