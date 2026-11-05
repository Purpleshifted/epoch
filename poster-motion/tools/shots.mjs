#!/usr/bin/env node
// A series of screenshots of one page in a headless (muted) Chrome: [GPU=1] [PORT=9341] node tools/shots.mjs <url> <outPrefix> <sec,sec,...> [w=1280] [h=720]
// → <outPrefix>_<sec>.png at each second after the page was opened. GPU=1 = the machine's GPU (ANGLE Metal), as bake.mjs.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
const [url, out, secs = "10", W = "1280", H = "720"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = +(process.env.PORT || 9341);
const udd = process.env.UDD || fs.mkdtempSync(path.join(os.tmpdir(), "shots-chrome-")); // UDD=… reuses a profile (its localStorage: the world) across runs
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`, "--force-device-scale-factor=1", `--user-data-dir=${udd}`, "--no-first-run", ...(process.env.GPU ? [] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--disable-background-timer-throttling", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now(); await send("Page.navigate", { url });
// KEYS="3:Space,8:Enter,12:W+5,30:X+1.2" — at second t press a key; "Key+seconds" holds it that long (a walk, the stop)
const KEYCODES = { Space: 32, Enter: 13, W: 87, A: 65, S: 83, D: 68, X: 88 };
const keyEv = (type, key) => send("Input.dispatchKeyEvent", { type, key: key === "Space" ? " " : key.length === 1 ? key.toLowerCase() : key, code: key === "Space" ? "Space" : key.length === 1 ? `Key${key}` : key, windowsVirtualKeyCode: KEYCODES[key] ?? 0, nativeVirtualKeyCode: KEYCODES[key] ?? 0 });
const plan = [];
for (const k of (process.env.KEYS || "").split(",").filter(Boolean)) { const [at, spec] = k.split(":"); const [key, hold] = spec.split("+"); plan.push({ at: +at, key, hold: hold ? +hold : 0 }); }
for (const s of secs.split(",").map(Number)) plan.push({ at: s, shot: true });
plan.sort((a, b) => a.at - b.at);
for (const step of plan) { const dt = t0 + step.at * 1000 - Date.now(); if (dt > 0) await sleep(dt);
  if (step.shot) { fs.writeFileSync(`${out}_${step.at}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); console.log(`${out}_${step.at}.png`); continue; }
  await keyEv("keyDown", step.key); if (step.hold > 0) await sleep(step.hold * 1000); else await sleep(60); await keyEv("keyUp", step.key); console.log(`key ${step.key}${step.hold ? ` held ${step.hold}s` : ""} at ${step.at}s`); }
ws.close(); chrome.kill();
