/**
 * The shared world's server under real browsers from one address, as phones on one Wi-Fi would be (docs/shared-world-plan.md
 * "동시접속 시험"). One headless Chrome holds an isolated context per visitor: its own cache, cookies and connections, so
 * each sends what one phone sends and no more. load-world.mjs `http` is cheaper but all its visitors share one client.
 * Each page does what WorldAgent (serverWorld.ts) does, walking all the time. It stops at the first refusals and then
 * looks at how a page gets back in. Test worlds only. Nothing is drawn and the app's own files are not loaded.
 *
 *   WORLD_COOKIE=… node apps/web/scripts/load-world-browsers.mjs https://<preview> test-load 5,10,15,30 40
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

const [base, world, stagesText = "5,10", secText = "40"] = process.argv.slice(2);
if (!base || !world) throw new Error("usage: load-world-browsers.mjs <base> <world> [stages] [seconds]");
if (!/^test-[a-z0-9-]{1,24}$/.test(world)) throw new Error("test worlds only");
const stages = stagesText.split(",").map(Number);
const seconds = Number(secText);
const cookie = process.env.WORLD_COOKIE;
const out = process.env.LOAD_OUT;
const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const JOIN_GAP_MS = 400;
/** This is an 8 GB machine that other sessions work on too. */
const MAX_LOAD = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One visitor, in its page. The same timers and the same requests as WorldAgent with an httpTransport. */
const agent = (o, wall) => `(() => {
  const W = ${JSON.stringify(world)}, O = location.origin, WALL = ${wall};
  const TICK = 500, SEND = 2000, STATE = 10000, CLOCK = 60000, TIMEOUT = 8000, RETRY = 5000, CH = 2000, GR = 1500;
  let kinds = {}, refused = 0, first = null, offset = 0, best = Infinity, state = null, cur = null, need = true, wc = 0, wt = 0;
  let nr = 0, ns = 0, nst = 0, nc = 0, br = false, bs = false, bst = false, seq = 0, last = 0, joined = null, behind = 0;
  const born = Date.now(), srv = () => Date.now() + offset, closed = (t) => Math.floor((t - GR) / CH) - 1;
  let x = Math.random() * 160, z = Math.random() * 160;
  async function call(name, path, init) {
    const k = kinds[name] || (kinds[name] = { ms: [], st: {}, ca: {}, bytes: 0 });
    const c = new AbortController(), to = setTimeout(() => c.abort(), TIMEOUT), t0 = performance.now();
    try {
      const r = await fetch(O + path, { ...init, signal: c.signal });
      const text = await r.text();
      k.ms.push(Math.round(performance.now() - t0));
      k.bytes += text.length;
      k.st[r.status] = (k.st[r.status] || 0) + 1;
      const ca = r.headers.get("x-vercel-cache") || "none";
      k.ca[ca] = (k.ca[ca] || 0) + 1;
      if (r.status === 403 || r.status === 429) {
        refused++;
        first = first || { at: Date.now(), kind: name, mitigated: r.headers.get("x-vercel-mitigated"), retry: r.headers.get("retry-after") };
      }
      return { status: r.status, text };
    } catch (e) {
      const key = e.name === "AbortError" ? "timeout" : "network";
      k.st[key] = (k.st[key] || 0) + 1;
      throw e;
    } finally {
      clearTimeout(to);
    }
  }
  async function clock() {
    nc = Date.now() + CLOCK;
    try {
      const t0 = Date.now(), r = await call("now", "/api/now", { cache: "no-store" }), rtt = Date.now() - t0;
      if (r.status === 200 && rtt < best) { best = rtt; offset = JSON.parse(r.text).now - (t0 + rtt / 2); }
    } catch {}
  }
  async function rs() {
    bst = true;
    nst = Date.now() + STATE;
    try {
      const r = await call("state", "/api/world?world=" + W);
      if (r.status === 200) { const st = JSON.parse(r.text).state; if (st && (!state || st.rev >= state.rev)) state = st; }
      else nst = Date.now() + RETRY;
    } catch { nst = Date.now() + RETRY; } finally { bst = false; }
  }
  async function flush(t) {
    bs = true;
    ns = t + SEND;
    const n = WALL ? 38 : Math.max(1, Math.round((t - last) / 1000));
    last = t;
    const s = (srv() - state.epochMs) / 1000, ev = [];
    for (let i = 0; i < n; i++) {
      x = (x + 2) % 160; z = (z + 1) % 160;
      const who = WALL ? "b_" + (i % 19) : ${JSON.stringify(o)};
      ev.push({ id: who + ":" + t + ":" + seq++, o: who, r: WALL ? "worker" : "tree", k: "p", x: x - 80, z: z - 80, s });
    }
    try {
      const r = await call("post", "/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ world: W, epoch: state.epochMs, events: ev, ...(WALL ? { host: ${JSON.stringify(o)} } : {}) }) });
      if (r.status !== 200) ns = Date.now() + RETRY;
    } catch { ns = Date.now() + RETRY; } finally { bs = false; }
  }
  async function read() {
    const target = closed(srv() - 150);
    if (!need && (cur === null || cur >= target)) return;
    br = true;
    try {
      if (need) {
        const r = await call("window", "/api/events?world=" + W + "&epoch=" + state.epochMs + "&window=1" + (wc ? "&cursor=" + wc : ""));
        if (r.status === 200) {
          const a = JSON.parse(r.text);
          if (!wc) wt = a.to;
          if (a.next !== null) wc = a.next;
          else { need = false; cur = wt; joined = Date.now() - born; }
        } else nr = Date.now() + RETRY;
      } else {
        const from = cur + 1, to = Math.min(target, from + 149);
        const r = await call("range", "/api/events?world=" + W + "&epoch=" + state.epochMs + "&from=" + from + "&to=" + to);
        if (r.status === 200) cur = to;
        else if (r.status !== 425) nr = Date.now() + RETRY;
      }
    } catch { nr = Date.now() + RETRY; } finally { br = false; }
  }
  function tick() {
    const t = Date.now();
    if (t >= nc) clock();
    if (t >= nst && !bst) rs();
    if (t >= ns && !bs && state) flush(t);
    if (t >= nr && !br && state) read();
    if (cur !== null && !need) behind = Math.max(behind, (srv() - (cur + 1) * CH) / 1000);
  }
  window.__take = () => { const o = { kinds, refused, first, joined, behind }; kinds = {}; behind = 0; return JSON.stringify(o); };
  window.__stop = () => clearInterval(window.__timer);
  (async () => {
    ${wall ? "" : 'await Promise.allSettled([call("presets", "/api/presets?page=/v2/mobile"), call("presets", "/api/presets?page=/v2/global/space")]);'}
    for (let i = 0; i < 3; i++) await clock();
    await rs();
    last = Date.now();
    await new Promise((r) => setTimeout(r, Math.random() * TICK));
    window.__timer = setInterval(tick, TICK);
  })();
})();`;

// ------------------------------------------------------------------------------------------------ Chrome

const profile = mkdtempSync(join(tmpdir(), "worldload-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--user-agent=${UA}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const cleanUp = async () => {
  const gone = new Promise((r) => chrome.once("exit", r));
  chrome.kill("SIGKILL");
  await Promise.race([gone, sleep(3000)]);
  // its helpers may still be writing for a moment
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
};
const wsUrl = await new Promise((resolve, reject) => {
  let text = "";
  chrome.stderr.on("data", (d) => {
    text += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("Chrome did not start")), 20_000);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

async function openVisitor(o, wall) {
  const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  if (cookie) {
    const i = cookie.indexOf("=");
    await send("Network.enable", {}, sessionId);
    await send("Network.setCookie", { name: cookie.slice(0, i), value: cookie.slice(i + 1), domain: new URL(base).hostname, path: "/", secure: true, httpOnly: true }, sessionId);
  }
  await send("Page.navigate", { url: `${base}/api/now` }, sessionId);
  await sleep(150);
  await send("Runtime.evaluate", { expression: agent(o, wall) }, sessionId);
  return { o, sessionId, targetId, wall };
}

const evaluate = async (v, expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }, v.sessionId)).result?.value;
const pick = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null);

function merge(takes, sec) {
  const kinds = {};
  let behindMax = 0;
  const behinds = [];
  const joins = [];
  let first = null;
  for (const t of takes) {
    if (!t) continue;
    if (t.first && (!first || t.first.at < first.at)) first = t.first;
    if (t.joined) joins.push(t.joined);
    behinds.push(t.behind);
    behindMax = Math.max(behindMax, t.behind);
    for (const [name, k] of Object.entries(t.kinds)) {
      const m = kinds[name] ?? (kinds[name] = { ms: [], st: {}, ca: {}, bytes: 0 });
      m.ms.push(...k.ms);
      m.bytes += k.bytes;
      for (const [a, b] of Object.entries(k.st)) m.st[a] = (m.st[a] ?? 0) + b;
      for (const [a, b] of Object.entries(k.ca)) m.ca[a] = (m.ca[a] ?? 0) + b;
    }
  }
  const row = { kinds: {}, first, behindMax, behindP50: pick(behinds.sort((a, b) => a - b), 0.5), joins: pick(joins.sort((a, b) => a - b), 0.5) };
  let all = 0;
  for (const [name, k] of Object.entries(kinds)) {
    k.ms.sort((a, b) => a - b);
    all += k.ms.length;
    row.kinds[name] = { perSec: Math.round((k.ms.length / sec) * 10) / 10, p50: pick(k.ms, 0.5), p95: pick(k.ms, 0.95), max: k.ms[k.ms.length - 1] ?? null, st: k.st, ca: k.ca, kb: Math.round(k.bytes / 1024) };
  }
  row.perSec = Math.round((all / sec) * 10) / 10;
  return row;
}

function print(n, sec, r) {
  console.log(`\n=== ${n} visitors, ${sec} s, ${r.perSec} requests/s, refused ${r.refused}, behind p50 ${r.behindP50?.toFixed(1)} max ${r.behindMax.toFixed(1)} s`);
  for (const [name, k] of Object.entries(r.kinds)) console.log(`  ${name.padEnd(8)} ${String(k.perSec).padStart(6)}/s  p50 ${String(k.p50).padStart(5)}  p95 ${String(k.p95).padStart(5)}  max ${String(k.max).padStart(5)} ms  ${JSON.stringify(k.st)}  ${JSON.stringify(k.ca)}  ${k.kb} KB`);
}

const results = { base, world, stages: [] };
const report = () => out && writeFileSync(out, JSON.stringify(results, null, 2));
try {
  const started = Date.now();
  const wall = await openVisitor("h_load", true);
  const visitors = [wall];
  let stopped = false;
  for (const n of stages) {
    while (visitors.length - 1 < n) {
      visitors.push(await openVisitor(`v_load${visitors.length - 1}`, false));
      await sleep(JOIN_GAP_MS);
    }
    await sleep(2000);
    await Promise.all(visitors.map((v) => evaluate(v, "window.__take()")));
    const t0 = Date.now();
    let refused = 0;
    let takes = [];
    while (Date.now() - t0 < seconds * 1000 && refused < 5) {
      await sleep(3000);
      const now = await Promise.all(visitors.map((v) => evaluate(v, "window.__take()")));
      const parsed = now.map((t) => (t ? JSON.parse(t) : null));
      takes = takes.concat(parsed);
      // each page's count of refusals never goes back to 0
      refused = parsed.reduce((a, t) => a + (t?.refused ?? 0), 0);
    }
    const sec = (Date.now() - t0) / 1000;
    const row = { visitors: n, sec, sinceStart: Math.round((Date.now() - started) / 1000), load: loadavg()[0], ...merge(takes, sec), refused };
    results.stages.push(row);
    print(n, sec, row);
    console.log(`  this machine's load ${row.load.toFixed(1)}, ${row.sinceStart} s since the start`);
    report();
    if (refused >= 5) {
      stopped = true;
      break;
    }
    if (row.load > MAX_LOAD) {
      console.log(`\nstopped: this machine is at load ${row.load.toFixed(1)}`);
      results.stoppedByLoad = row.load;
      break;
    }
  }
  if (stopped) {
    // the defence is on and everybody is still sending: does a page that loads again get through?
    console.log("\nrefused. Loading one page again while the others go on:");
    const v = visitors[1];
    await send("Page.navigate", { url: `${base}/api/now` }, v.sessionId);
    const looks = [];
    for (let i = 0; i < 6; i++) {
      await sleep(3000);
      const p = await send("Runtime.evaluate", { expression: `(async () => { const r = await fetch(location.origin + "/api/now", { cache: "no-store" }); return JSON.stringify({ title: document.title.slice(0, 40), status: r.status, mitigated: r.headers.get("x-vercel-mitigated") }); })()`, awaitPromise: true, returnByValue: true }, v.sessionId).catch(() => null);
      looks.push(p?.result?.value ?? null);
      console.log(`  +${(i + 1) * 3} s: ${looks[looks.length - 1]}`);
    }
    const others = await Promise.all(visitors.slice(2).map((o) => evaluate(o, "window.__take()")));
    const summary = merge(
      others.map((t) => (t ? JSON.parse(t) : null)),
      18,
    );
    console.log(`the others in those 18 s: ${JSON.stringify(Object.fromEntries(Object.entries(summary.kinds).map(([a, b]) => [a, b.st])))}`);
    results.afterRefusal = { looks, others: summary.kinds };
    report();
  }
} finally {
  await cleanUp();
}
process.exit(0);
