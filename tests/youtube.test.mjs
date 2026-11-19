import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../ui/sources.js", import.meta.url), "utf8");
const watch = await readFile(new URL("../site/watch.js", import.meta.url), "utf8");
const video = "aB1_CD-2345";

test("the library accepts YouTube Music links and opens the selected video by ID", async () => {
  const nodes = new Map(), saved = new Map(), opened = [];
  const element = () => ({children: [], value: "", append(...v){this.children.push(...v);},
    replaceChildren(...v){this.children=v;}, setAttribute(){}});
  const el = id => { if (!nodes.has(id)) nodes.set(id,element()); return nodes.get(id); };
  vm.runInNewContext(source,{URL,el,document:{createElement:element},
    localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
    native:{openYouTube:id=>opened.push(id)}});
  const submit = url => {
    el("youtube-url").value=url;el("youtube-name").value="Demo";
    el("youtube-form").onsubmit({preventDefault(){}});
  };
  submit("https://music.youtube.com/watch?v="+video);
  submit("https://youtu.be/"+video);
  submit("https://music.youtube.com.invalid/watch?v=BBBBBBBBBBB");
  assert.deepEqual(JSON.parse(saved.get("youtube-library")),[{id:video,title:"Demo"}]);
  await el("youtube-list").children[0].children[0].onclick();
  assert.deepEqual(opened,[video]);
});

test("the hosted player sends only a validated ID to the embed and removes it in background", () => {
  function render(search) {
    const root={childElementCount:0,append(frame){this.frame=frame;this.childElementCount=1;},
      replaceChildren(){this.frame=null;this.childElementCount=0;}};
    const doc={hidden:false,getElementById:id=>id==="video-frame"?root:{},createElement:()=>({}),
      addEventListener(name,f){this.visibility=f;}};
    vm.runInNewContext(watch,{document:doc,location:{search,origin:"https://veluna.siloneedsleep.xyz"},URLSearchParams});
    return {doc,root};
  }
  const {doc,root}=render("?v="+video);
  assert.equal(new URL(root.frame.src).pathname,"/embed/"+video);
  assert.equal(new URL(root.frame.src).hostname,"www.youtube-nocookie.com");
  doc.hidden=true;doc.visibility();assert.equal(root.childElementCount,0);
  doc.hidden=false;doc.visibility();assert.equal(root.childElementCount,1);
  assert.equal(render("?v=../watch").root.childElementCount,0);
});

test("velunaYtm searches tracks with variant badges, formats stream quality, queues playback, and stores synced lyrics", async () => {
  const nodes = new Map(), saved = new Map(), queued = [];
  const element = tag => ({
    tag,
    children: [],
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    append(...v) { this.children.push(...v); },
    replaceChildren(...v) { this.children = v; },
    setAttribute() {}
  });
  const el = id => { if (!nodes.has(id)) nodes.set(id, element("div")); return nodes.get(id); };
  const ctx = {
    URL,
    el,
    document: { createElement: element },
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    native: {
      ytmSearch: (q, f) => JSON.stringify({
        query: q,
        tracks: [
          {
            video_id: video,
            title: "Demo Song",
            artist_text: "Demo Artist",
            recording_kind: "original",
            recording_label: "Bản gốc",
            duration_text: "3:30",
            album: { id: "MPREb_123", name: "Demo Album" },
            artists: [{ id: "UC123", name: "Demo Artist" }]
          },
          {
            video_id: "xY9_ZZ-1122",
            title: "Demo Song (Live)",
            artist_text: "Demo Artist",
            recording_kind: "live",
            recording_label: "Live",
            duration_text: "4:12"
          }
        ],
        videos: [],
        albums: [],
        artists: []
      }),
      ytmStream: () => JSON.stringify({
        video_id: video,
        url: "https://example.googlevideo.com/videoplayback",
        codec: "opus",
        bitrate: 140000,
        bitrate_kbps: 140,
        sample_rate: 48000,
        expires_at: 1900000000
      }),
      ytmLyrics: () => JSON.stringify({
        video_id: video,
        source_provider: "lrclib",
        has_time_sync: true,
        has_word_sync: false,
        synced_lrc: "[00:01.00] Hello YouTube Music\n",
        plain_lyrics: "Hello YouTube Music",
        lines: []
      }),
      ytmAddOrPlay: (json, startIndex, playNow) => queued.push({ list: JSON.parse(json), startIndex, playNow })
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx);

  el("ytm-query").value = "Demo Song";
  el("ytm-filter").value = "songs";
  await el("ytm-search-form").onsubmit({ preventDefault() {} });
  assert.equal(el("ytm-results").children.length, 3);
  assert.match(el("ytm-results").children[1].children[1].textContent, /YouTube Music · Bản gốc/);
  assert.match(el("ytm-results").children[2].children[1].textContent, /YouTube Music · Live/);

  const streamInfo = await ctx.velunaYtm.stream(video, false);
  assert.equal(ctx.velunaYtm.formatQuality(streamInfo), "OPUS · 140 kb/s · 48 kHz");

  el("ytm-results").children[1].children[2].onclick();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].startIndex, 0);
  assert.equal(queued[0].playNow, true);
  assert.equal(queued[0].list[0].id, "ytmusic://" + video);

  await ctx.velunaYtm.ensureLyrics("ytmusic://" + video);
  assert.equal(saved.get("lyrics/ytmusic://" + video), "[00:01.00] Hello YouTube Music\n");
});
