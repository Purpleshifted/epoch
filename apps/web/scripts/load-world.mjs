/**
 * How many visitors the shared world's network carries (docs/shared-world-plan.md "동시접속 시험"). Each simulated phone
 * does over the wire what a phone's WorldAgent (serverWorld.ts) and MarkerSender (markerRelay.ts) do, all of them walking
 * all the time, which is the worst case. Nothing is drawn: a phone's and a wall's own calculation is not measured here.
 *
 *   node apps/web/scripts/load-world.mjs relay wss://….workers.dev test-load 5,15,30,60 20
 *   WORLD_COOKIE=… node apps/web/scripts/load-world.mjs http https://<preview> test-load 5,15,30 30
 *   WORLD_COOKIE=… node apps/web/scripts/load-world.mjs clear https://<preview> test-load
 *
 * Test worlds only: production answers 400 to them, and the exhibition's world must not fill with these events. Every
 * relay message counts against the account's free daily requests (100,000 if one message is one request), so count first.
 * All of it runs from this one machine, so the machine's network is part of what is measured (`loop` says when its own
 * Node was the one falling behind), and Vercel's defence starts refusing this one address at about 30 requests/s: past
 * that, `http` measures the defence and not the server. load-world-browsers.mjs does the same with real browsers.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { monitorEventLoopDelay } from "node:perf_hooks";

const [mode, base, world, stagesText = "5", secText = "20"] = process.argv.slice(2);
if (!mode || !base || !world) throw new Error("usage: load-world.mjs relay|http|clear <base> <world> [stages] [seconds]");
if (!/^test-[a-z0-9-]{1,24}$/.test(world)) throw new Error("test worlds only");
const stages = stagesText.split(",").map(Number);
const seconds = Number(secText);
const out = process.env.LOAD_OUT;
const RAMP_SEC = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);
const spread = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: pick(s, 0.5), p95: pick(s, 0.95), p99: pick(s, 0.99), max: s.length ? s[s.length - 1] : null };
};
const ms = (v) => (v === null ? "-" : `${Math.round(v)}`);
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const loopP99 = () => {
  const v = loop.percentile(99) / 1e6;
  loop.reset();
  return Math.round(v);
};

function report(results) {
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------------------------- the relay

const ORIGIN = "http://localhost:3017";
const SEND_MS = 125; // RELAY_SEND_MS
const PING_MS = 5000;
const MAX_BUFFERED = 1024;

function openSocket(as) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/${world}?as=${as}`, { headers: { origin: ORIGIN } });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`${as}: could not connect`));
  });
}

/** What the relay answers one more socket: 101, or 503 when the room is full. */
function probeSocket() {
  return new Promise((resolve) => {
    const u = new URL(`${base.replace(/^wss/, "https")}/${world}?as=phone`);
    const req = httpsRequest(u, { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), origin: ORIGIN } });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", (e) => resolve(`error ${e.message}`));
    req.setTimeout(10_000, () => {
      req.destroy();
      resolve("timeout");
    });
    req.end();
  });
}

async function relayRun() {
  const where = await (await fetch(`${base.replace(/^wss/, "https")}/where/${world}`)).text();
  console.log(`room ${world}: ${where.trim()}`);
  const results = { mode, world, where: where.trim(), stages: [] };
  const counters = { sent: 0, skipped: 0, closed: 0 };
  let delays = [];
  let heard = 0;
  let from = Infinity;
  let until = Infinity;
  const onWall = (m) => {
    if (m.data === "pong") return;
    const t = JSON.parse(m.data).t;
    delays.push(Date.now() - t);
    // only what was sent inside the measured time counts as heard, or the end of each stage reads as a loss
    if (t >= from && t <= until) heard++;
  };
  const walls = [await openSocket("wall"), await openSocket("wall")];
  walls.forEach((w) => {
    w.onmessage = onWall;
    w.onclose = () => counters.closed++;
  });
  const phones = [];
  const timers = [];
  const addPhone = async (i) => {
    const ws = await openSocket("phone");
    ws.onclose = () => counters.closed++;
    const o = `v_load${i}`;
    let x = Math.random() * 160;
    let z = Math.random() * 160;
    const start = Math.random() * SEND_MS;
    timers.push(
      setTimeout(() => {
        timers.push(
          setInterval(() => {
            if (ws.readyState !== 1) return;
            if (ws.bufferedAmount > MAX_BUFFERED) {
              counters.skipped++;
              return;
            }
            x += 0.4;
            z += 0.2;
            ws.send(JSON.stringify({ o, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, s: 1234.5, y: 1.23, e: 1793628673591, t: Date.now(), r: 180 }));
            counters.sent++;
          }, SEND_MS),
        );
      }, start),
    );
    timers.push(setInterval(() => ws.readyState === 1 && ws.send("ping"), PING_MS));
    phones.push(ws);
  };
  for (const n of stages) {
    const adding = n - phones.length;
    const opened = [];
    for (let i = phones.length; i < n; i++) {
      const t0 = Date.now();
      await addPhone(i);
      opened.push(Date.now() - t0);
      await sleep((RAMP_SEC * 1000) / Math.max(1, adding));
    }
    const before = { ...counters };
    delays = [];
    heard = 0;
    loopP99();
    until = Infinity;
    from = Date.now();
    await sleep(seconds * 1000);
    until = Date.now();
    const sent = counters.sent - before.sent;
    const elapsed = (until - from) / 1000;
    await sleep(1500); // what was sent last is still on its way
    const expected = sent * walls.length;
    const row = {
      phones: n,
      seconds: elapsed,
      sent,
      perSec: Math.round((sent / elapsed) * 10) / 10,
      deliveredPct: expected ? Math.round((1000 * heard) / expected) / 10 : null,
      skipped: counters.skipped - before.skipped,
      closed: counters.closed - before.closed,
      delay: spread(delays),
      connectMs: spread(opened),
      loopP99: loopP99(),
    };
    results.stages.push(row);
    console.log(`${String(n).padStart(4)} phones · ${row.perSec}/s · delivered ${row.deliveredPct}% · skipped ${row.skipped} · closed ${row.closed} · delay p50 ${ms(row.delay.p50)} p95 ${ms(row.delay.p95)} p99 ${ms(row.delay.p99)} max ${ms(row.delay.max)} · connect p95 ${ms(row.connectMs.p95)} · loop p99 ${row.loopP99} ms`);
    report(results);
  }
  timers.forEach(clearInterval);
  // the room's own limit: what the next sockets are told
  const refused = [];
  for (let i = phones.length + walls.length; i < 67; i++) {
    if (i < 64) {
      await addPhone(i);
      timers.forEach(clearInterval);
      refused.push({ socket: i + 1, answer: 101 });
    } else {
      refused.push({ socket: i + 1, answer: await probeSocket() });
    }
  }
  results.cap = refused;
  console.log(`sockets past the stages: ${refused.map((r) => `#${r.socket} ${r.answer}`).join(", ")}`);
  [...phones, ...walls].forEach((w) => {
    w.onclose = null;
    w.close();
  });
  console.log(`messages sent in all: ${counters.sent}`);
  results.totalSent = counters.sent;
  report(results);
}

// ---------------------------------------------------------------------------------------------- the server

const TICK_MS = 500;
const SEND_EVERY_MS = 2000;
const STATE_EVERY_MS = 10_000;
const CLOCK_EVERY_MS = 60_000;
const READ_MARGIN_MS = 150;
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_MS = 5000;
const CHUNK_MS = 2000;
const CLOSE_GRACE_MS = 1500;
const MAX_RANGE_CHUNKS = 150;
const BOT_EVENTS_PER_POST = 38; // 19 bots, one sample a second

const lastClosed = (t) => Math.floor((t - CLOSE_GRACE_MS) / CHUNK_MS) - 1;
const chunkEnd = (c) => (c + 1) * CHUNK_MS;
const cookie = process.env.WORLD_COOKIE;
const agentName = process.env.LOAD_UA;
const refusals = [];
const w = encodeURIComponent(world);

/** After a refusal: how long it lasts here and on `also` (one request every 3 s). */
async function timeRefusal(also) {
  const t0 = Date.now();
  const look = async (url, headers) => {
    try {
      return (await fetch(url, { headers, signal: AbortSignal.timeout(8000) })).status;
    } catch {
      return "none";
    }
  };
  const seen = [];
  while (Date.now() - t0 < 120_000) {
    const here = await look(`${base}/api/now`, { ...(cookie ? { cookie } : {}), ...(agentName ? { "user-agent": agentName } : {}) });
    const there = also ? await look(`${also}/api/now`, agentName ? { "user-agent": agentName } : {}) : null;
    seen.push({ sec: Math.round((Date.now() - t0) / 1000), here, there });
    console.log(`  +${seen[seen.length - 1].sec} s: here ${here}${also ? `, ${also} ${there}` : ""}`);
    if (here === 200 && seen.filter((s) => s.here === 200).length >= 3) break;
    await sleep(3000);
  }
  return seen;
}

function newStats() {
  return { kinds: new Map(), joins: [], sentToWall: [], lag: [] };
}
let stats = newStats();
let offsetMs = 0;
let stopping = false;
let recent = { n: 0, bad: 0, refused: 0 };
const serverNow = () => Date.now() + offsetMs;

function kindOf(name) {
  let k = stats.kinds.get(name);
  if (!k) {
    k = { ms: [], status: {}, cache: {}, bytes: 0, missBytes: 0 };
    stats.kinds.set(name, k);
  }
  return k;
}

async function call(name, path, init) {
  const k = kindOf(name);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  const t0 = performance.now();
  recent.n++;
  try {
    const r = await fetch(base + path, { ...init, signal: ctl.signal, headers: { ...(init?.headers ?? {}), ...(cookie ? { cookie } : {}), ...(agentName ? { "user-agent": agentName } : {}) } });
    const text = await r.text();
    k.ms.push(performance.now() - t0);
    if ((r.status === 403 || r.status === 429) && refusals.length < 3) refusals.push({ at: new Date().toISOString(), kind: name, status: r.status, headers: Object.fromEntries(r.headers), body: text.slice(0, 1500), bytes: text.length });
    k.status[r.status] = (k.status[r.status] ?? 0) + 1;
    const cache = r.headers.get("x-vercel-cache") ?? "none";
    k.cache[cache] = (k.cache[cache] ?? 0) + 1;
    k.bytes += text.length;
    if (cache !== "HIT" && cache !== "STALE") k.missBytes += text.length;
    if (r.status >= 500 || r.status === 404) recent.bad++;
    if (r.status === 403 || r.status === 429) recent.refused++;
    return { status: r.status, text };
  } catch (e) {
    const key = e.name === "AbortError" ? "timeout" : "network";
    k.status[key] = (k.status[key] ?? 0) + 1;
    recent.bad++;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const acked = { n: 0 };
const seen = new Set();

class Agent {
  constructor(o, wall) {
    this.o = o;
    this.wall = wall;
    this.state = null;
    this.cursor = null;
    this.needWindow = true;
    this.windowCursor = 0;
    this.windowTo = 0;
    this.nextRead = 0;
    this.nextSend = 0;
    this.nextState = 0;
    this.nextClock = 0;
    this.busyRead = this.busySend = this.busyState = false;
    this.seq = 0;
    this.lastEmit = 0;
    this.x = Math.random() * 160;
    this.z = Math.random() * 160;
    this.t0 = Date.now();
    this.joined = false;
    this.timer = null;
  }

  async begin() {
    if (!this.wall) {
      // the page's first requests: the saved values of this page and of the wall (ServerPresetsGate)
      await Promise.allSettled([call("presets", "/api/presets?page=/v2/mobile"), call("presets", "/api/presets?page=/v2/global/space")]);
    }
    for (let i = 0; i < 3; i++) await this.clock();
    await this.refreshState().catch(() => {});
    this.lastEmit = Date.now();
    await sleep(Math.random() * TICK_MS);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async clock() {
    this.nextClock = Date.now() + CLOCK_EVERY_MS;
    try {
      const t0 = Date.now();
      const r = await call("now", "/api/now", { cache: "no-store" });
      const rtt = Date.now() - t0;
      const best = JSON.parse(r.text).now - (t0 + rtt / 2);
      if (rtt < (Agent.bestRtt ?? Infinity)) {
        Agent.bestRtt = rtt;
        offsetMs = best;
      }
    } catch {
      /* the next minute */
    }
  }

  async refreshState() {
    this.busyState = true;
    this.nextState = Date.now() + STATE_EVERY_MS;
    try {
      const r = await call("state", `/api/world?world=${w}`);
      const st = JSON.parse(r.text).state;
      if (st && (!this.state || st.rev >= this.state.rev)) this.state = st;
    } catch (e) {
      this.nextState = Date.now() + RETRY_MS;
      throw e;
    } finally {
      this.busyState = false;
    }
  }

  tick() {
    if (stopping && !this.wall) return;
    const t = Date.now();
    if (t >= this.nextClock) void this.clock();
    if (t >= this.nextState && !this.busyState) void this.refreshState().catch(() => {});
    if (t >= this.nextSend && !this.busySend && this.state && !stopping) void this.flush(t);
    if (t >= this.nextRead && !this.busyRead && this.state) void this.read(t);
    if (this.cursor !== null) stats.lag.push({ wall: this.wall, sec: (serverNow() - chunkEnd(this.cursor)) / 1000 });
  }

  makeEvents(t) {
    const n = this.wall ? BOT_EVENTS_PER_POST : Math.max(1, Math.round((t - this.lastEmit) / 1000));
    this.lastEmit = t;
    const s = (serverNow() - this.state.epochMs) / 1000;
    const events = [];
    for (let i = 0; i < n; i++) {
      this.x = (this.x + 2) % 160;
      this.z = (this.z + 1) % 160;
      const o = this.wall ? `b_${i % 19}` : this.o;
      events.push({ id: `${o}:${t}:${this.seq++}`, o, r: this.wall ? "worker" : "tree", k: "p", x: this.x - 80, z: this.z - 80, s });
    }
    return events;
  }

  async flush(t) {
    this.busySend = true;
    this.nextSend = t + SEND_EVERY_MS;
    const events = this.makeEvents(t);
    try {
      const r = await call("post", "/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ world, epoch: this.state.epochMs, events, ...(this.wall ? { host: this.o } : {}) }),
      });
      if (r.status === 200 && !this.wall) acked.n += events.length;
    } catch {
      this.nextSend = Date.now() + RETRY_MS;
    } finally {
      this.busySend = false;
    }
  }

  deliver(events) {
    if (!this.wall) return;
    const now = Date.now();
    for (const e of events) {
      if (!e.o.startsWith("v_") || seen.has(e.id)) continue;
      seen.add(e.id);
      stats.sentToWall.push(now - Number(e.id.split(":")[1]));
    }
  }

  async read(t) {
    const target = lastClosed(serverNow() - READ_MARGIN_MS);
    if (!this.needWindow && (this.cursor === null || this.cursor >= target)) return;
    this.busyRead = true;
    try {
      if (this.needWindow) {
        const r = await call("window", `/api/events?world=${w}&epoch=${this.state.epochMs}&window=1${this.windowCursor ? `&cursor=${this.windowCursor}` : ""}`);
        if (r.status === 200) {
          const a = JSON.parse(r.text);
          if (this.windowCursor === 0) this.windowTo = a.to;
          this.deliver(a.events);
          if (a.next !== null) {
            this.windowCursor = a.next;
          } else {
            this.needWindow = false;
            this.cursor = this.windowTo;
            if (!this.joined) {
              this.joined = true;
              stats.joins.push(Date.now() - this.t0);
            }
          }
        }
      } else {
        const from = this.cursor + 1;
        const to = Math.min(target, from + MAX_RANGE_CHUNKS - 1);
        const r = await call("range", `/api/events?world=${w}&epoch=${this.state.epochMs}&from=${from}&to=${to}`);
        if (r.status === 200) {
          this.deliver(JSON.parse(r.text).events);
          this.cursor = to;
        }
      }
    } catch {
      this.nextRead = Date.now() + RETRY_MS;
    } finally {
      this.busyRead = false;
    }
  }
}

function summarize(n, sec) {
  const kinds = {};
  for (const [name, k] of stats.kinds) {
    kinds[name] = { ...spread(k.ms), perSec: Math.round((k.ms.length / sec) * 10) / 10, status: k.status, cache: k.cache, bytes: k.bytes, missBytes: k.missBytes };
  }
  const lags = stats.lag.filter((l) => !l.wall).map((l) => l.sec);
  const wallLags = stats.lag.filter((l) => l.wall).map((l) => l.sec);
  return { visitors: n, sec, kinds, sentToWall: spread(stats.sentToWall), lag: spread(lags), wallLag: spread(wallLags), joins: spread(stats.joins), loopP99: loopP99() };
}

function printRow(r) {
  console.log(`\n=== ${r.visitors} visitors, ${r.sec} s, this machine's loop p99 ${r.loopP99} ms`);
  for (const [name, k] of Object.entries(r.kinds)) {
    console.log(`  ${name.padEnd(8)} ${String(k.perSec).padStart(6)}/s  p50 ${ms(k.p50).padStart(5)}  p95 ${ms(k.p95).padStart(5)}  max ${ms(k.max).padStart(5)} ms  ${JSON.stringify(k.status)}  ${JSON.stringify(k.cache)}  ${Math.round(k.bytes / 1024)} KB (miss ${Math.round(k.missBytes / 1024)} KB)`);
  }
  console.log(`  post → wall read  p50 ${ms(r.sentToWall.p50)}  p95 ${ms(r.sentToWall.p95)}  max ${ms(r.sentToWall.max)} ms (${r.sentToWall.n} events)`);
  console.log(`  behind: visitors p50 ${r.lag.p50?.toFixed(1)}  p95 ${r.lag.p95?.toFixed(1)}  max ${r.lag.max?.toFixed(1)} s · wall p95 ${r.wallLag.p95?.toFixed(1)} s · joined ${r.joins.n}, p50 ${ms(r.joins.p50)} p95 ${ms(r.joins.p95)} ms`);
}

async function httpRun() {
  const results = { mode, base, world, stages: [] };
  const wall = new Agent("h_load", true);
  await wall.begin();
  console.log(`world ${world}: epoch ${wall.state?.epochMs}, clock ${Math.round(offsetMs)} ms against the server`);
  const visitors = [];
  let aborted = null;
  const watch = setInterval(() => {
    if (recent.refused >= 5) aborted = `refused ${recent.refused} times in 5 s`;
    else if (recent.n >= 20 && recent.bad / recent.n > 0.3) aborted = `${recent.bad} of ${recent.n} failed in 5 s`;
    recent = { n: 0, bad: 0, refused: 0 };
  }, 5000);
  for (const n of stages) {
    if (aborted) break;
    const adding = n - visitors.length;
    for (let i = visitors.length; i < n && !aborted; i++) {
      const v = new Agent(`v_load${i}`, false);
      visitors.push(v);
      void v.begin();
      await sleep((RAMP_SEC * 1000) / Math.max(1, adding));
    }
    await sleep(2000); // the first answers of the last to come
    stats = newStats();
    loopP99();
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000 && !aborted) await sleep(250);
    const row = summarize(n, Math.round((Date.now() - t0) / 100) / 10);
    results.stages.push(row);
    printRow(row);
    report(results);
    if (aborted) console.log(`\nSTOPPED: ${aborted}`);
  }
  clearInterval(watch);
  // nobody sends any more; the wall reads what is left, and what the server said it took must all come back
  stopping = true;
  visitors.forEach((v) => v.stop());
  if (aborted) {
    wall.stop();
    results.refusals = refusals;
    results.refusalLasted = await timeRefusal(process.env.LOAD_ALSO);
  } else {
    await sleep(10_000);
    wall.stop();
  }
  results.events = { acked: acked.n, readByWall: seen.size };
  results.aborted = aborted;
  console.log(`\nevents the server accepted ${acked.n}, read back by the wall ${seen.size} (requests still on their way when this stopped count on one side only)`);
  report(results);
}

async function clearRun() {
  const r = await call("clear", "/api/world", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ world, op: "clear" }) });
  console.log(`clear: ${r.status} ${r.text.slice(0, 200)}`);
}

const run = { relay: relayRun, http: httpRun, clear: clearRun }[mode];
if (!run) throw new Error(`no mode ${mode}`);
await run();
process.exit(0);
