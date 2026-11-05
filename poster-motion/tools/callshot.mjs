// Stages one real call in the personal view: a second same-origin tab writes a visitor standing beside "me" into the shared log.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
const OUT=process.argv[2], ORIGIN="https://homo-inventus-lab.vercel.app", URL_=ORIGIN+"/v2/mobile?ui=0&lang=ko", PORT=9372, W=1280, H=720;
const udd=fs.mkdtempSync(path.join(os.tmpdir(),"call-chrome-"));
const chrome=spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless=new",`--remote-debugging-port=${PORT}`,"--mute-audio","--hide-scrollbars",`--window-size=${W},${H}`,"--force-device-scale-factor=2",`--user-data-dir=${udd}`,"--use-angle=metal","--enable-gpu-rasterization","--ignore-gpu-blocklist","--autoplay-policy=no-user-gesture-required","about:blank"],{stdio:"ignore"});
process.on("exit",()=>{try{chrome.kill()}catch{}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const list=async()=>(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let pg; for(let i=0;i<100;i++){try{pg=(await list()).find(t=>t.type==="page");if(pg)break}catch{} await sleep(200)}
function conn(t){const ws=new WebSocket(t.webSocketDebuggerUrl);let id=1;const w=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id)}};
  return new Promise(ok=>{ws.onopen=()=>ok((method,params={})=>new Promise((res,rej)=>{const i=id++;w.set(i,m=>m.error?rej(new Error(m.error.message)):res(m.result));ws.send(JSON.stringify({id:i,method,params}))}))})}
const A=await conn(pg);
await A("Page.enable"); await A("Emulation.setDeviceMetricsOverride",{width:W,height:H,deviceScaleFactor:2,mobile:false}); await A("Page.navigate",{url:URL_});
const key=async(k,holdMs=0)=>{const d={key:k===" "?" ":k,code:k===" "?"Space":k==="Enter"?"Enter":`Key${k.toUpperCase()}`,windowsVirtualKeyCode:k===" "?32:k==="Enter"?13:k.toUpperCase().charCodeAt(0)};await A("Input.dispatchKeyEvent",{type:"keyDown",...d});if(holdMs)await sleep(holdMs);await A("Input.dispatchKeyEvent",{type:"keyUp",...d})};
const text=async()=>(await A("Runtime.evaluate",{expression:"document.body.innerText",returnByValue:true})).result.value||"";
const shot=async n=>{fs.writeFileSync(`${OUT}/${n}.png`,Buffer.from((await A("Page.captureScreenshot",{format:"png"})).data,"base64"));console.log(n)};
const t0=Date.now(); const at=async s=>{const d=t0+s*1000-Date.now();if(d>0)await sleep(d)};
for(const [s,k] of [[6," "],[13," "],[20," "],[25," "],[30," "],[37,"Enter"]]){await at(s);await key(k);}
await at(42); await A("Runtime.evaluate",{expression:`document.head.insertAdjacentHTML("beforeend","<style>.hud-blink{animation:none!important;opacity:1!important}</style>")`}); await shot("00_live"); await key("w",2500);
const res=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(ORIGIN+"/robots.txt")}`,{method:"PUT"}); const bT=await res.json(); const B=await conn(bT); await sleep(2000); await A("Page.bringToFront");
const FAKE=`(function(){const K="anthropocene:parliament:v1",ME="anthropocene:parliament:me";window.__n=window.__n||0;const me=localStorage.getItem(ME);const a=JSON.parse(localStorage.getItem(K)||"[]");const mine=a.filter(e=>e.o===me).sort((x,y)=>x.s-y.s).pop();if(!mine)return "no me "+me+" "+a.length;
 window.__last=window.__last||{s:mine.s,t:Date.now()};if(mine.s!==window.__last.s)window.__last={s:mine.s,t:Date.now()};const s=mine.s+(Date.now()-window.__last.t)/1000;
 a.push({id:"call"+(++window.__n)+"_"+Date.now(),o:"v_caller01",r:mine.r,k:"p",x:mine.x+0.9,z:mine.z+0.3,s});localStorage.setItem(K,JSON.stringify(a));const T=Object.keys(localStorage).find(k=>/token/i.test(k));if(T)localStorage.setItem(T,"t"+Date.now());return T+" "+a.length+" "+s})()`;
let opened=false,answered=false,i=0; const end=Date.now()+70000;
while(Date.now()<end){const r=await B("Runtime.evaluate",{expression:FAKE,returnByValue:true}); if(i%5===0)console.log("fake",r.result.value);
  const tx=await text(); if(i%4===0)console.log(JSON.stringify(tx.slice(-160)));
  if(!opened&&/SPACE — 응답/.test(tx)){opened=true;await sleep(1000);await shot("10_call");await sleep(1500);await shot("11_call");await key(" ");await sleep(1200);await shot("20_answered");await sleep(2500);await shot("21_answered");answered=true;break}
  i++;await sleep(1000)}
if(!answered){await shot("99_end");console.log("NO CALL",(await text()).slice(-400))}
process.exit(0);
