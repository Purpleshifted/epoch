#!/usr/bin/env node
// One screenshot of a page in a headless (muted) Chrome: node tools/shot.mjs <url> <out.png> [waitMs=4000] [w=1920] [h=1080]
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
const [url, out, waitMs = "4000", W = "1920", H = "1080"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = 9341;
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "shot-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${W},${H}`, "--force-device-scale-factor=1", `--user-data-dir=${udd}`, "--no-first-run", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url }); await sleep(+waitMs);
fs.writeFileSync(out, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
console.log(out); ws.close(); chrome.kill();
