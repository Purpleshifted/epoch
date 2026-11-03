#!/usr/bin/env node
// Renders the motion poster to out/motion-poster.mp4 (1080×1920, 30 fps) with a headless Chrome, frame by frame:
// the page is a pure function of time (window.__seek), so every frame is exact.
//   node poster-motion/tools/render.mjs            (FPS=30 DUR=55 STILL=52.5 CHROME=<path> env overrides)
//   STILLS=5,12,20 node poster-motion/tools/render.mjs   (only those frames, as out/still_<t>.png)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FPS = +(process.env.FPS || 30), DUR = +(process.env.DUR || 55), STILL = +(process.env.STILL || 52.5);
const PORT = +(process.env.PORT || 9339);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.resolve(HERE, "../out"), FR = path.join(OUT, "frames");
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "motion-chrome-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", "--allow-file-access-from-files",
  "--window-size=1080,1920", "--force-device-scale-factor=1", `--user-data-dir=${udd}`, "--no-first-run", "--disable-background-timer-throttling", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });
let page;
for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `file://${path.resolve(HERE, "../index.html")}?still=1` });
for (let i = 0; i < 100; i++) { try { if (await ev("!!window.__ready")) break; } catch {} await sleep(200); }
await ev("window.__ready");
const frame = () => ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
const STILLS = (process.env.STILLS || "").split(",").map(Number).filter((x) => !Number.isNaN(x) && process.env.STILLS);
if (STILLS.length) { // stills only: STILLS=5,12,20 node render.mjs → out/still_<t>.png
  for (const t of STILLS) { await ev(`window.__seek(${t})`); await frame();
    fs.writeFileSync(path.join(OUT, `still_${t}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); console.log("still", t); }
  ws.close(); chrome.kill(); process.exit(0);
}
const N = Math.round(DUR * FPS), t0 = Date.now();
for (let i = 0; i < N; i++) {
  await ev(`window.__seek(${(i / FPS).toFixed(5)})`); await frame();
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 94 });
  fs.writeFileSync(path.join(FR, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(r.data, "base64"));
  if (i % 150 === 0) console.log(`frame ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await ev(`window.__seek(${STILL})`); await frame();
fs.writeFileSync(path.join(OUT, "still.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
ws.close(); chrome.kill();
const mp4 = path.join(OUT, "motion-poster.mp4");
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(FR, "f%05d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow", "-movflags", "+faststart", mp4], { stdio: "inherit" });
if (ff.status !== 0) throw new Error("ffmpeg failed");
console.log(mp4, (fs.statSync(mp4).size / 1e6).toFixed(1), "MB");
