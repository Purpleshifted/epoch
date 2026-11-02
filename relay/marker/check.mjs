/**
 * A walker and a wall on this machine, through the relay: same clock, so the one-way time needs no correction.
 *
 *   node relay/marker/check.mjs ws://localhost:8787 test-relay [seconds]
 *   node relay/marker/check.mjs wss://….workers.dev test-relay [seconds]
 *
 * This measures the relay's own path from here, not a phone's: that is `__relay.status()` on a wall.
 */

const [base, room = "test-relay", seconds = "20"] = process.argv.slice(2);
if (!base) throw new Error("which relay?");
// the relay takes only its own pages' sockets
const headers = { origin: "http://localhost:3017" };

const open = (as) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/${room}?as=${as}`, { headers });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`${as}: could not connect`));
  });
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const line = (name, v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? `${name}: ${s.length} · p50 ${pct(s, 0.5).toFixed(0)} ms · p95 ${pct(s, 0.95).toFixed(0)} ms · max ${s[s.length - 1].toFixed(0)} ms` : `${name}: none`;
};

const opened = performance.now();
const wall = await open("wall");
const walker = await open("phone");
console.log(`connected in ${(performance.now() - opened).toFixed(0)} ms`);

const oneWay = [];
const rtt = [];
let sentAt = 0;
let sent = 0;
wall.onmessage = (m) => {
  if (m.data === "pong") {
    rtt.push(performance.now() - sentAt);
    return;
  }
  oneWay.push(performance.now() - JSON.parse(m.data).at);
};

const poses = setInterval(() => {
  sent++;
  walker.send(JSON.stringify({ o: "v_check", x: 0, z: 0, s: 0, y: 0, e: 0, t: Date.now(), r: 0, at: performance.now() }));
}, 250);
const pings = setInterval(() => {
  sentAt = performance.now();
  wall.send("ping");
}, 2000);

await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
clearInterval(poses);
clearInterval(pings);
await new Promise((r) => setTimeout(r, 1000));
console.log(`sent ${sent}, heard ${oneWay.length}`);
console.log(line("walker → relay → wall", oneWay));
console.log(line("wall ping round trip", rtt));
walker.close();
wall.close();
process.exit(0);
