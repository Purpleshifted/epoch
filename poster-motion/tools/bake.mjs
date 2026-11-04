#!/usr/bin/env node
// Bakes a live view into a looping video: a headless (muted) Chrome shows the URL, frames are captured for `seconds`
// with their real timestamps, and ffmpeg turns them into an H.264 mp4 (and a poster jpeg) under assets/.
//   node tools/bake.mjs <url> <name> [seconds=60] [warmupSec=20] [w=1920] [h=860] [outW=1280]
//   → assets/<name>.mp4, assets/<name>.jpg (the first frame)
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn, spawnSync } from "node:child_process";
const [url, name, secondsS = "60", warmupS = "20", W = "1920", H = "860", OUTW = "1280"] = process.argv.slice(2);
if (!url || !name) { console.error("usage: bake.mjs <url> <name> [seconds] [warmupSec] [w] [h] [outW]"); process.exit(1); }
const HERE = path.dirname(new URL(import.meta.url).pathname), ASSETS = path.resolve(HERE, "../assets");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `bake-${name}-`)), FR = path.join(TMP, "frames"); fs.mkdirSync(FR);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = +(process.env.PORT || 9343);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "bake-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`, "--force-device-scale-factor=1", `--user-data-dir=${udd}`, "--no-first-run", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling", "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); if (page) break; } catch {} await sleep(200); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 30 }); await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, no) => { const i = id++; wait.set(i, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
console.log(`warming up ${warmupS} s …`); await sleep(+warmupS * 1000);
const t0 = Date.now(), times = []; let i = 0;
while (Date.now() - t0 < +secondsS * 1000) {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  fs.writeFileSync(path.join(FR, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(r.data, "base64"));
  times.push((Date.now() - t0) / 1000); i++;
  if (i % 100 === 0) console.log(`${i} frames · ${times[i - 1].toFixed(0)} s · ${(i / times[i - 1]).toFixed(1)} fps`);
}
ws.close(); chrome.kill();
// a concat list with each frame's real duration, so the video keeps real time whatever the capture rate was
const list = [];
for (let k = 0; k < i; k++) { const d = (k + 1 < i ? times[k + 1] : +secondsS) - times[k]; list.push(`file '${path.join(FR, `f${String(k).padStart(5, "0")}.jpg`)}'`, `duration ${Math.max(0.01, d).toFixed(4)}`); }
list.push(`file '${path.join(FR, `f${String(i - 1).padStart(5, "0")}.jpg`)}'`);
fs.writeFileSync(path.join(TMP, "list.txt"), list.join("\n"));
fs.mkdirSync(ASSETS, { recursive: true });
const mp4 = path.join(ASSETS, `${name}.mp4`), jpg = path.join(ASSETS, `${name}.jpg`);
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(TMP, "list.txt"), "-vf", `scale=${OUTW}:-2,fps=24`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "slow", "-movflags", "+faststart", "-an", mp4], { stdio: "inherit" });
if (ff.status !== 0) throw new Error("ffmpeg failed");
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(FR, "f00000.jpg"), "-vf", `scale=${OUTW}:-2`, "-q:v", "4", jpg], { stdio: "inherit" });
console.log(`${mp4} ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB · ${i} frames over ${secondsS} s (${(i / +secondsS).toFixed(1)} fps captured)`);
fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(udd, { recursive: true, force: true });
