import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../site/release.js", import.meta.url), "utf8");
const base = "https://github.com/siloneedsleep/VelunaMusic/releases/download/v1.0.0/";
const assets = ["VelunaMusic-Android.apk", "VelunaMusic-Windows-x64.exe"].map(name => ({
  name, state: "uploaded", size: 50, browser_download_url: base + name
}));
const release = { tag_name: "v1.0.0", draft: false, prerelease: false, assets };
async function render(status, data) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      removeAttribute() {}, replaceChildren(value) { this.textContent = value; }, append() {}
    });
    return elements.get(id);
  }
  await vm.runInNewContext("(async () => {" + source + "})()", {
    document: { getElementById: element, createElement: element }, AbortSignal,
    fetch: async () => ({status, ok: status === 200, json: async () => data})
  });
  return {windows: element("windows").href, android: element("android").href, status: element("status").textContent};
}

test("downloads point at the two matching assets of the latest stable release", async () => {
  const ui = await render(200, release);
  assert.equal(ui.windows, base + assets[1].name);
  assert.equal(ui.android, base + assets[0].name);
});
test("no release, partial uploads, drafts, prereleases and unexpected URLs keep both downloads closed", async () => {
  for (const changes of [{draft:true}, {prerelease:true}, {assets:assets.slice(0,1)}, {assets:[assets[1], {...assets[0], browser_download_url:"https://example.com/download"}]}]) {
    const ui = await render(200, {...release, ...changes});
    assert.equal(ui.windows, undefined); assert.equal(ui.android, undefined);
  }
  const empty = await render(404, null);
  assert.match(empty.status, /Đang phát triển/);
  assert.equal(empty.android, undefined);
});
