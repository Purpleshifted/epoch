#!/usr/bin/env node
// A series of screenshots of one page in a headless (muted) Chrome: [GPU=1] [PORT=9341] node tools/shots.mjs <url> <outPrefix> <sec,sec,...> [w=1280] [h=720]
// → <outPrefix>_<sec>.png at each second after the page was opened. GPU=1 = the machine's GPU (ANGLE Metal), as bake.mjs.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
const [url, out, secs = "10", W = "1280", H = "720"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = +(process.env.PORT || 9341);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "shots-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`, "--force-device-scale-factor=1", `--user-data-dir=${udd}`, "--no-first-run", ...(process.env.GPU ? [] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--disable-background-timer-throttling", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now(); await send("Page.navigate", { url });
for (const s of secs.split(",").map(Number)) { const dt = t0 + s * 1000 - Date.now(); if (dt > 0) await sleep(dt);
  fs.writeFileSync(`${out}_${s}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); console.log(`${out}_${s}.png`); }
ws.close(); chrome.kill();
