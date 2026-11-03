#!/usr/bin/env node
// A tiny Chrome DevTools client for the poster: attaches to the headless Chrome on :9333 and runs one command.
//   node cdp.mjs nav <url>
//   node cdp.mjs size <w> <h> [dpr]
//   node cdp.mjs eval "<js>"           (await works; the value comes back as JSON)
//   node cdp.mjs evalfile <file.js>
//   node cdp.mjs shot <out.png|jpg>    (the page as the browser paints it)
//   node cdp.mjs canvas <out.png>      (the WebGL canvas itself, at its full buffer size)
//   node cdp.mjs pdf <out.pdf> <widthMm> <heightMm> [cssWidthPx]   (cssWidthPx: scale the page to fill the paper)
import fs from "node:fs";

const PORT = process.env.CDP_PORT || 9333;
const [cmd, ...args] = process.argv.slice(2);

async function pageSocket() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = list.find((t) => t.type === "page");
  if (!page) page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  return page.webSocketDebuggerUrl;
}

const ws = new WebSocket(await pageSocket(), { maxPayload: 1 << 30 });
await new Promise((ok, no) => {
  ws.onopen = ok;
  ws.onerror = no;
});
let next = 1;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = next++;
    waiting.set(id, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 590000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

if (cmd === "nav") {
  await send("Page.enable");
  await send("Page.navigate", { url: args[0] });
} else if (cmd === "size") {
  // the window itself: an emulated size would end with this connection
  const { windowId } = await send("Browser.getWindowForTarget");
  await send("Browser.setWindowBounds", { windowId, bounds: { width: +args[0], height: +args[1] } });
} else if (cmd === "eval") {
  console.log(JSON.stringify(await evaluate(args[0]), null, 0));
} else if (cmd === "evalfile") {
  console.log(JSON.stringify(await evaluate(fs.readFileSync(args[0], "utf8")), null, 0));
} else if (cmd === "shot") {
  const jpg = /\.jpe?g$/.test(args[0]);
  const r = await send("Page.captureScreenshot", { format: jpg ? "jpeg" : "png", quality: jpg ? 85 : undefined, captureBeyondViewport: false });
  fs.writeFileSync(args[0], Buffer.from(r.data, "base64"));
  console.log(args[0]);
} else if (cmd === "canvas") {
  const url = await evaluate(`new Promise((ok) => { const c = document.querySelector("canvas"); requestAnimationFrame(() => requestAnimationFrame(() => ok(c.toDataURL("image/png")))); })`);
  fs.writeFileSync(args[0], Buffer.from(url.split(",")[1], "base64"));
  console.log(args[0], (await evaluate(`(() => { const c = document.querySelector("canvas"); return [c.width, c.height]; })()`)).join("×"));
} else if (cmd === "pdf") {
  const mm = (v) => +v / 25.4;
  // optional 4th arg: the page's CSS width in px, so the content is scaled to fill the paper (Chrome lays out at 96 px/in)
  const scale = args[3] ? (mm(args[1]) * 96) / Number(args[3]) : 1;
  const r = await send("Page.printToPDF", { paperWidth: mm(args[1]), paperHeight: mm(args[2]), scale, printBackground: true, preferCSSPageSize: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: "ReturnAsBase64" });
  fs.writeFileSync(args[0], Buffer.from(r.data, "base64"));
  console.log(args[0]);
} else {
  console.error("unknown command", cmd);
  process.exitCode = 1;
}
ws.close();
