"use strict";

// Adapted from SimpMusic v2.6.0, utils/UserLrc.kt (GPL-3.0). See THIRD_PARTY.md.
function parseLyrics(input, strict = false) {
  const raw = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const result = [], plain = [];
  let offset = 0;
  function time(stamp) {
    const match = /^(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?$/.exec(stamp);
    return match ? Number(match[1])*60000 + Number(match[2])*1000 + Number((match[3] || "").padEnd(3,"0")) : null;
  }
  function invalid(line) {
    if (strict) throw Error("Mốc thời gian chưa đúng ở dòng "+line+".");
  }
  for (const [i,original] of raw.entries()) {
    const text=original.trim(), tag=/^\[([A-Za-z#][^:\]]*):(.*)\]$/.exec(text);
    if (tag) {
      if (tag[1].toLowerCase()==="offset") {
        if (/^[+-]?\d{1,9}$/.test(tag[2].trim())) offset=Number(tag[2]);
        else invalid(i+1);
      }
      continue;
    }
    let rest=text;
    const stamps=[];
    while (true) {
      const match=/^\[(\d[\d:.]*)\]\s*/.exec(rest);
      if (!match) break;
      const ms=time(match[1]);
      if(ms===null)invalid(i+1);else stamps.push(ms);
      rest=rest.slice(match[0].length);
    }
    if(!stamps.length){if(text)plain.push({words:text,time:null,parts:[],line:i+1});continue;}
    const markers=[...rest.matchAll(/<(\d[\d:.]*)>/g)];
    const parts=[];
    let end=null;
    if(markers.length) {
      if(stamps.length>1)invalid(i+1);
      const before=rest.slice(0,markers[0].index);
      if(before)parts.push({ms:stamps[0],text:before});
      let last=parts.length?stamps[0]:-1;
      for(const [j,m] of markers.entries()){
        const ms=time(m[1]);
        if(ms===null || ms<last){invalid(i+1);continue;}
        last=ms;
        const word=rest.slice(m.index+m[0].length,markers[j+1]?.index);
        if(word)parts.push({ms,text:word});else if(j===markers.length-1)end=ms;
      }
    }
    for(const ms of stamps)result.push({ms,words:parts.length?parts.map(p=>p.text).join(""):rest.replace(/<\d[\d:.]*>/g,"") || "♫",parts,end});
  }
  if (!result.length)return plain;
  if (plain.length && strict)throw Error("Thiếu mốc thời gian ở dòng "+plain[0].line+".");
  const shift=ms=>Math.max(0,ms-offset)/1000;
  return result.map(line=>({time:shift(line.ms),words:line.words,end:line.end===null?null:shift(line.end),
    parts:line.parts.map(p=>({time:shift(p.ms),text:p.text}))})).sort((a,b)=>a.time-b.time);
}

function lyricAt(entries,time) {
  let low=0,high=entries.length;
  while(low<high){const mid=(low+high)>>>1;if(entries[mid].time<=time)low=mid+1;else high=mid;}
  return low-1;
}

function hasWordTiming(entries) {
  if (!Array.isArray(entries) || !entries.length) return false;
  let found=false;
  for (const entry of entries) {
    if (!Array.isArray(entry?.parts) || !entry.parts.length) continue;
    let prev=-1;
    for (const part of entry.parts) {
      if (typeof part?.time!=="number" || !Number.isFinite(part.time) || part.time<prev) return false;
      prev=part.time;
    }
    found=true;
  }
  return found;
}

function wordProgress(entry, time) {
  const parts=entry?.parts;
  if (!Array.isArray(parts) || !parts.length) return {index:-1,ratio:0};
  if (entry.end!=null && time>=entry.end) return {index:-1,ratio:1};
  const idx=lyricAt(parts, time);
  if (idx<0) return {index:-1,ratio:0};
  const start=parts[idx].time;
  const nextTime=parts[idx+1]?.time ?? entry.end;
  if (typeof nextTime!=="number" || nextTime<=start) return {index:idx,ratio:1};
  const ratio=Math.max(0, Math.min(1, (time-start)/(nextTime-start)));
  return {index:idx,ratio};
}
