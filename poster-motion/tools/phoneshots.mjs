#!/usr/bin/env node
// Every screen of the deck, as a phone sees it (375×812 @2, touch) or as the stage (1920×1080, with the phone's panel crops
// drawn over it): [MODE=phone|stage] [PORT=9351] [WAIT=7000] [SOFT=1: software GL — the deck's canvas stalls under it] node tools/phoneshots.mjs <baseUrl> <outDir>
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
const [base, outDir] = process.argv.slice(2); const MODE = process.env.MODE || "phone", PORT = +(process.env.PORT || 9351), WAIT = +(process.env.WAIT || 7000);
const STEPS = +(process.env.STEPS || 11), ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(outDir, { recursive: true });
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "phoneshots-"));
const phone = MODE === "phone", W = phone ? 375 : 1920, H = phone ? 812 : 1080, DSF = phone ? 2 : 1;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`, `--force-device-scale-factor=${DSF}`, `--user-data-dir=${udd}`, "--no-first-run", ...(process.env.SOFT ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--disable-background-timer-throttling", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} try { fs.rmSync(udd, { recursive: true, force: true }); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const log=(s)=>process.stderr.write(s+"\n"); const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
log("ws open"); await send("Page.enable"); log("page enabled"); await send("Runtime.enable"); log("runtime enabled");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DSF, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// the phone's panel crops, read from the page source so the overlay follows the deck
const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "index.html"), "utf8");
const pm = src.match(/const PANELS=\[([\s\S]*?)\];[^\n]*\n(?:\/\*\*[^\n]*\n)?function phoneLayout/); const PANELS = pm ? eval("[" + pm[1].replace(/\/\/[^\n]*/g, "") + "]") : [];
await send("Page.navigate", { url: base + (phone ? "" : "?step=0") }); log("navigated"); await sleep(2500);
for (let i = 0; i < STEPS; i++) { if (ONLY && !ONLY.includes(i)) continue;
  if (phone) { await evaluate(`(function(){const p=document.querySelector('.pg[data-step="${i}"]:not([data-notes])'); if(p){p.scrollIntoView({block:'start'});} return scrollY;})()`); }
  else { await evaluate(`window.__go&&window.__go(${i}); document.querySelectorAll('.panelbox').forEach(e=>e.remove()); ${JSON.stringify(PANELS[i] || [])}.forEach(([x,y,w,h],k)=>{const d=document.createElement('div'); d.className='panelbox'; d.style.cssText='position:absolute;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;border:3px solid #ff2d55;box-sizing:border-box;z-index:99;pointer-events:none;font:700 28px monospace;color:#ff2d55;padding:4px'; d.textContent=String(k+1); document.getElementById('stage').appendChild(d);}); 1`); }
  await sleep(WAIT);
  const out = path.join(outDir, `${phone ? "p" : "d"}${i}.png`);
  fs.writeFileSync(out, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); console.log(out); }
ws.close(); chrome.kill();
