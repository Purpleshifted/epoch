#!/usr/bin/env node
// Tiled capture of the lab's column: node capture.mjs <outdir> '<json: {cols,rows,tileW,tileH,pad,pose,pointK,only}>'
// Writes tile_<col>_<row>.png and meta.json; stitch.py joins them with the padding cropped off.
import fs from "node:fs";
const PORT = process.env.CDP_PORT || 9333;
const [outDir, json] = process.argv.slice(2);
const o = JSON.parse(json);
fs.mkdirSync(outDir, { recursive: true });
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let id = 1;
const wait = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) {
    wait.get(m.id)(m);
    wait.delete(m.id);
  }
};
const ev = (expression) =>
  new Promise((ok, no) => {
    const i = id++;
    wait.set(i, (m) => (m.error || m.result?.exceptionDetails ? no(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails).slice(0, 600))) : ok(m.result.result.value)));
    ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const { cols, rows, tileW, tileH, pad, pose, pointK = 1, only } = o;
const stepW = tileW - 2 * pad;
const stepH = tileH - 2 * pad;
const fullW = cols * stepW + 2 * pad;
const fullH = rows * stepH + 2 * pad;
const size = await ev(`(() => { const c = document.querySelector("canvas"); return [c.width, c.height]; })()`);
if (size[0] !== tileW || size[1] !== tileH) throw new Error(`canvas is ${size}, tile wants ${tileW}×${tileH}`);
console.log("full", fullW, fullH, JSON.stringify(await ev(`__tileInit(${JSON.stringify({ fullW, fullH, pose, pointK })})`)));
fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify({ ...o, fullW, fullH, stepW, stepH }));
const t0 = Date.now();
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (only && !only.some(([a, b]) => a === c && b === r)) continue;
    const url = await ev(`__tile(${c * stepW}, ${r * stepH}, ${tileW}, ${tileH}, ${fullW}, ${fullH})`);
    fs.writeFileSync(`${outDir}/tile_${c}_${r}.png`, Buffer.from(url.split(",")[1], "base64"));
    console.log(`tile ${c},${r}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
await ev("__tileDone()");
ws.close();
