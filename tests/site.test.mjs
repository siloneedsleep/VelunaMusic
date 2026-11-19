import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();

function readUtf8(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      for (const name of names) set.add(name);
    },
    remove(...names) {
      for (const name of names) set.delete(name);
    },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) {
          set.delete(name);
          return false;
        }
        set.add(name);
        return true;
      }
      if (force) set.add(name);
      else set.delete(name);
      return Boolean(force);
    },
    contains(name) {
      return set.has(name);
    },
    values() {
      return [...set];
    }
  };
}

function makeElement(tag = "div", attrs = {}) {
  const listeners = new Map();
  const classNames = attrs.class ? attrs.class.split(/\s+/).filter(Boolean) : [];
  const dataset = { ...(attrs.dataset || {}) };
  const attrMap = new Map(Object.entries(attrs.raw || {}));
  const styleProps = new Map();
  return {
    tagName: tag.toUpperCase(),
    id: attrs.id || "",
    href: attrs.href || "",
    textContent: attrs.textContent || "",
    hidden: false,
    dataset,
    classList: makeClassList(classNames),
    children: [],
    style: {
      width: "",
      setProperty(k, v) {
        styleProps.set(k, v);
      },
      getPropertyValue(k) {
        return styleProps.get(k) || "";
      }
    },
    setAttribute(k, v) {
      attrMap.set(k, String(v));
      if (k === "href") this.href = String(v);
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    },
    getAttribute(k) {
      if (attrMap.has(k)) return attrMap.get(k);
      if (k === "href") return this.href;
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        if (camel in this.dataset) return this.dataset[camel];
      }
      return null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
    },
    closest() {
      return null;
    }
  };
}

test("site CNAME, HTML structure, CSP compliance, and CSS tokens", () => {
  const cname = readUtf8("site/CNAME").trim();
  assert.equal(cname, "veluna.siloneedsleep.xyz");

  const html = readUtf8("site/index.html");
  assert.match(html, /id="status"/);
  assert.match(html, /id="android"/);
  assert.match(html, /id="windows"/);
  assert.match(html, /<script src="\/release\.js" type="module"><\/script>/);
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.match(html, /\/artwork\.webp/);
  assert.match(html, /THIRD_PARTY\.md/);
  assert.match(html, /@siloneedsleep/);

  assert.equal(/\sstyle="/i.test(html), false);

  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length >= 2);
  for (const [, attrs, body] of inlineScripts) {
    assert.match(attrs, /\bsrc="/i);
    assert.equal(body.trim(), "");
  }

  const faqMatch = html.match(/<section[^>]*id="faq"[^>]*>([\s\S]*?)<\/section>/i);
  assert.ok(faqMatch, "missing #faq section");
  const detailsMatches = faqMatch[1].match(/<details\b/gi) || [];
  assert.equal(detailsMatches.length, 5);

  const summaryMatches = [...faqMatch[1].matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)];
  assert.equal(summaryMatches.length, 5);
  for (const [, summaryInner] of summaryMatches) {
    assert.equal(/<h[1-6]\b/i.test(summaryInner), false);
  }

  for (const preset of ["clear", "frost", "dark", "solid"]) {
    assert.ok(html.includes(`data-showcase-preset="${preset}"`), `missing preset ${preset}`);
  }

  const css = readUtf8("site/style.css");
  assert.match(css, /\.return-page\b/);
  assert.match(css, /\.video-page\b/);
  assert.match(css, /\.video-page iframe\b/);
  assert.match(css, /\.cta\b/);
  assert.match(css, /backdrop-filter:/);
  assert.match(css, /interpolate-size:\s*allow-keywords/);
  assert.match(css, /::details-content/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("site/app.js handles i18n, OS detection, glass presets, and word-timed lyrics without reload", () => {
  const code = readUtf8("site/app.js");

  const ids = new Map([
    ["announce-tag", makeElement("span", { id: "announce-tag" })],
    ["nav-toggle", makeElement("button", { id: "nav-toggle" })],
    ["primary-nav", makeElement("nav", { id: "primary-nav" })],
    ["lang-toggle", makeElement("button", { id: "lang-toggle", textContent: "EN" })],
    ["hero-cta", makeElement("a", { id: "hero-cta", href: "#downloads" })],
    ["hero-cta-label", makeElement("span", { id: "hero-cta-label" })],
    ["hero-version", makeElement("span", { id: "hero-version" })],
    ["mockup-stage", makeElement("div", { id: "mockup-stage" })],
    ["showcase-stage", makeElement("div", { id: "showcase-stage", dataset: { preset: "frost" } })],
    ["showcase-metrics", makeElement("span", { id: "showcase-metrics" })],
    ["showcase-play", makeElement("button", { id: "showcase-play" })],
    ["showcase-clock", makeElement("span", { id: "showcase-clock" })],
    ["showcase-progress", makeElement("div", { id: "showcase-progress" })],
    ["status", makeElement("p", { id: "status", textContent: "" })],
    ["android", makeElement("a", { id: "android", href: "https://example.test/VelunaMusic-Android.apk", raw: { "aria-disabled": "false" } })],
    ["windows", makeElement("a", { id: "windows", href: "https://example.test/VelunaMusic-Windows-x64.exe", raw: { "aria-disabled": "false" } })]
  ]);

  const presetButtons = ["clear", "frost", "dark", "solid"].map((p) =>
    makeElement("button", {
      dataset: { showcasePreset: p },
      class: p === "frost" ? "is-active" : "",
      raw: { "aria-pressed": p === "frost" ? "true" : "false" }
    })
  );

  const i18nElements = [
    makeElement("span", { dataset: { i18n: "hero.titleA" } }),
    makeElement("span", { dataset: { i18n: "hero.ctaFallback" } }),
    makeElement("a", { dataset: { i18nAria: "nav.menu" } })
  ];

  const lyricWords = [
    makeElement("span", { class: "w", dataset: { start: "0", end: "1.5" } }),
    makeElement("span", { class: "w", dataset: { start: "1.5", end: "3.0" } })
  ];
  const lyricLine = makeElement("p", { class: "lyric-demo-line" });
  lyricLine.querySelectorAll = (sel) => (sel === ".w" ? lyricWords : []);

  const revealElements = [makeElement("div", { class: "reveal" })];

  const storage = new Map();
  const docElement = makeElement("html");
  docElement.lang = "vi";
  const bodyEl = makeElement("body");

  const headerEl = makeElement("header", { class: "site-header" });

  const doc = {
    documentElement: docElement,
    body: bodyEl,
    hidden: false,
    getElementById(id) {
      return ids.get(id) || null;
    },
    querySelector(sel) {
      if (sel === ".site-header") return headerEl;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "[data-i18n]") return i18nElements;
      if (sel === "[data-i18n-aria]") return i18nElements;
      if (sel === "[data-showcase-preset]") return presetButtons;
      if (sel === ".lyric-demo-line") return [lyricLine];
      if (sel === ".reveal") return revealElements;
      return [];
    },
    addEventListener() {}
  };

  let ua = "Mozilla/5.0 (Linux; Android 15; Pixel 9)";
  const sandbox = {
    window: null,
    document: doc,
    navigator: {
      get userAgent() {
        return ua;
      },
      platform: "Linux armv8l"
    },
    localStorage: {
      getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
      setItem(k, v) {
        storage.set(k, String(v));
      }
    },
    matchMedia() {
      return {
        matches: true,
        addEventListener() {}
      };
    },
    IntersectionObserver: class {
      observe() {}
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    Date,
    Math
  };
  sandbox.window = sandbox;

  vm.runInNewContext(code, sandbox);

  const api = sandbox.velunaSite;
  assert.ok(api, "velunaSite global should be exposed");
  assert.equal(api.detectOs(), "android");
  assert.equal(ids.get("hero-cta").getAttribute("href"), "https://example.test/VelunaMusic-Android.apk");

  ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  api.setLanguage("en");
  assert.equal(docElement.lang, "en");
  assert.equal(storage.get("veluna-site-lang"), "en");
  assert.equal(ids.get("hero-cta").getAttribute("href"), "https://example.test/VelunaMusic-Windows-x64.exe");

  api.setLanguage("vi");
  assert.equal(docElement.lang, "vi");

  for (const preset of ["clear", "frost", "dark", "solid"]) {
    api.setPreset(preset);
    assert.equal(api.getPreset(), preset);
    assert.equal(ids.get("showcase-stage").dataset.preset, preset);
    assert.ok(ids.get("showcase-metrics").textContent.length > 0);
  }

  api.renderShowcaseTimeline(2.0);
  assert.equal(lyricWords[0].classList.contains("is-past"), true);
  assert.equal(lyricWords[1].classList.contains("is-active"), true);
});
