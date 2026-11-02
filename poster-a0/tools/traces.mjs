// The walking traces themselves: the same bots as the lab's test column (lib/parliament/testColumn.ts), as plan polylines.
import { register } from "node:module";
import { writeFileSync } from "node:fs";
register("./ts-hooks.mjs", import.meta.url);
globalThis.window ??= undefined;
const { buildTestColumn } = await import("../../apps/web/src/lib/parliament/testColumn.ts");
const ev = buildTestColumn({ seconds: 1200, bots: 18, flock: { groups: 5, spread: 44, timeSpread: 150 } });
const byBot = new Map();
for (const e of ev) {
  if (!byBot.has(e.o)) byBot.set(e.o, []);
  byBot.get(e.o).push([e.x, e.z, e.s]);
}
const out = [];
let lo = [1e9, 1e9], hi = [-1e9, -1e9];
for (const [o, pts] of byBot) {
  pts.sort((a, b) => a[2] - b[2]);
  let run = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i && Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 20) {
      if (run.length > 1) out.push({ o, pts: run });
      run = [];
    }
    run.push(p);
    lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
    hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
  }
  if (run.length > 1) out.push({ o, pts: run });
}
writeFileSync(new URL("../data/traces.json", import.meta.url), JSON.stringify(out));
console.log("events", ev.length, "runs", out.length, "x,z", lo, hi);
