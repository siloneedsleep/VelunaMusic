import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const api = vm.createContext({});
vm.runInContext(await readFile(new URL("../ui/lrc.js",import.meta.url),"utf8"),api);

test("enhanced LRC applies signed offsets to lines, words and explicit endings",()=>{
  const lines=api.parseLyrics("[ar:Band]\n[offset:+250]\n[00:02.5]One <00:03.00>two <00:03.500>three<00:04.0>",true);
  assert.equal(lines.length,1);
  assert.equal(lines[0].time,2.25);
  assert.equal(lines[0].words,"One two three");
  assert.deepEqual(Array.from(lines[0].parts,p=>p.time),[2.25,2.75,3.25]);
  assert.equal(lines[0].end,3.75);
  assert.equal(api.lyricAt(lines[0].parts,2.74),0);
  assert.equal(api.lyricAt(lines[0].parts,2.75),1);
});
test("repeated plain lines stay sorted and invalid word timing gives a line number",()=>{
  const lines=api.parseLyrics("[00:10.05] [00:01.5]Chorus\n[00:03.00]",true);
  assert.deepEqual(Array.from(lines,l=>[l.time,l.words]),[[1.5,"Chorus"],[3,"♫"],[10.05,"Chorus"]]);
  assert.throws(()=>api.parseLyrics("[ti:Test]\n[00:01]<00:02>a<00:01>b",true),/2/);
  assert.throws(()=>api.parseLyrics("[00:02]a\n[00:91]b",true),/2/);
  assert.equal(api.parseLyrics("I <3 music",true)[0].time,null);
});
