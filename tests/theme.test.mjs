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
