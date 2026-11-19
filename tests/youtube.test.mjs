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
