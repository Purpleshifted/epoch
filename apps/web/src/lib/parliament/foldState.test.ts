/**
 * The incremental fold (foldState.ts) must give the SAME ground as the batch fold (fold.ts) over the same events —
 * fed in arrival order, with bots ahead of and behind the viewer in assigned time, a viewer whose region moves, an
 * owner who turns up behind the frontier, the history window moving on, and the world's edge.
 */
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW } from "./flow";
import { foldWorld } from "./fold";
import { FoldState, StressState } from "./foldState";
import { DEFAULT_NATURE, hash2, stressMap } from "./nature";
import { DEFAULT_FOLD, type FoldConfig, type PEvent, type Snapshot } from "./types";
import { WORLD_HALF } from "./world";

const V2: FoldConfig = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };

interface Owner {
  id: string;
  /** Assigned time = wall time + offset. */
  offset: number;
  /** Wall time at which this owner starts emitting. */
  from: number;
  /** Where they are at wall time w (world coordinates, may run over the edge). */
  at: (w: number) => [number, number];
}

/** Stays of a few seconds around `c`, then a walk to the next place: what a bot does. */
const wander =
  (seed: number, cx: number, cz: number, reach: number): Owner["at"] =>
  (w) => {
    const seg = Math.floor(w / 20);
    const stay = hash2(seed, seg, 3) < 0.6;
    const ax = cx + (hash2(seed, seg, 1) - 0.5) * reach;
    const az = cz + (hash2(seed, seg, 2) - 0.5) * reach;
    if (stay) return [ax + Math.sin(w) * 0.05, az];
    const bx = cx + (hash2(seed, seg + 1, 1) - 0.5) * reach;
    const bz = cz + (hash2(seed, seg + 1, 2) - 0.5) * reach;
    const t = (w % 20) / 20;
    return [ax + (bx - ax) * t, az + (bz - az) * t];
  };

/** Three people who stand together (a building), two shuttles (a path), two over the world's edge. */
function crowd(): Owner[] {
  const owners: Owner[] = [];
  for (let i = 0; i < 3; i++) owners.push({ id: `bot${i}`, offset: [-24, 0, 17][i], from: 0, at: wander(i, 2, 1, 2.5) });
  for (let i = 3; i < 6; i++) owners.push({ id: `bot${i}`, offset: [-9, 6, -30][i - 3], from: 0, at: wander(i, 9, -4, 7) });
  owners.push({ id: "walker1", offset: 3, from: 0, at: (w) => [-6 + (w % 40 < 20 ? w % 20 : 20 - (w % 20)), 6] });
  owners.push({ id: "walker2", offset: -12, from: 0, at: (w) => [-6 + (w % 40 < 20 ? w % 20 : 20 - (w % 20)), 6.3] });
  // at the edge: they stand on both sides of it and walk over it
  for (let i = 0; i < 3; i++) owners.push({ id: `edge${i}`, offset: [-5, 2, 9][i], from: 0, at: wander(20 + i, WORLD_HALF, -3, 3) });
  owners.push({ id: "crosser", offset: 0, from: 0, at: (w) => [WORLD_HALF - 4 + ((w * 0.8) % 8), -2] });
  // a human who turns up late with an assigned time far behind the viewer
  owners.push({ id: "latecomer", offset: -80, from: 200, at: wander(40, 3, 2, 2) });
  return owners;
}

/** Samples in ARRIVAL order (wall seconds): everyone emits once a second. */
function arrivals(owners: Owner[], wallEnd: number): { w: number; e: PEvent }[] {
  const out: { w: number; e: PEvent }[] = [];
  for (let w = 0; w < wallEnd; w++) {
    for (const o of owners) {
      if (w < o.from) continue;
      const [x, z] = o.at(w);
      out.push({ w, e: { id: `${o.id}:${w}`, o: o.id, r: "worker", k: "p", x, z, s: w + o.offset } });
    }
  }
  return out;
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function expectSame(got: Snapshot, want: Snapshot, label: string, tol = 1e-6) {
  expect(got.slabs.map((s) => s.key), `${label}: slab keys`).toEqual(want.slabs.map((s) => s.key));
  for (let i = 0; i < want.slabs.length; i++) {
    const a = got.slabs[i], b = want.slabs[i];
    for (const f of ["h", "raw", "foot", "bornS", "lastS"] as const) expect(near(a[f], b[f]), `${label}: slab ${b.key}.${f} ${a[f]} vs ${b[f]}`).toBe(true);
    expect(a.who!.map((w) => w.o), `${label}: slab ${b.key} who`).toEqual(b.who!.map((w) => w.o));
    for (let k = 0; k < b.who!.length; k++) {
      expect(near(a.who![k].amount, b.who![k].amount), `${label}: slab ${b.key} who[${k}].amount`).toBe(true);
      expect(a.who![k].first).toBe(b.who![k].first);
      expect(a.who![k].last).toBe(b.who![k].last);
    }
    expect(a.spans, `${label}: slab ${b.key} spans`).toEqual(b.spans);
    expect(a.growth!.length, `${label}: slab ${b.key} growth length`).toBe(b.growth!.length);
    for (let k = 0; k < b.growth!.length; k++) {
      expect(a.growth![k][0]).toBe(b.growth![k][0]);
      expect(near(a.growth![k][1], b.growth![k][1])).toBe(true);
    }
  }
  expect(got.paths.map((p) => p.key), `${label}: path keys`).toEqual(want.paths.map((p) => p.key));
  for (let i = 0; i < want.paths.length; i++) {
    expect(near(got.paths[i].p, want.paths[i].p, tol), `${label}: path ${want.paths[i].key}.p ${got.paths[i].p} vs ${want.paths[i].p}`).toBe(true);
    expect(got.paths[i].visits, `${label}: path ${want.paths[i].key}.visits`).toBe(want.paths[i].visits);
  }
}

function runAgainstBatch(cfg: FoldConfig, wallEnd: number, every: number, viewerOffset = 0) {
  const owners = crowd();
  const feed = arrivals(owners, wallEnd);
  const state = new FoldState(cfg, { inactiveTicks: 30 });
  const seen: PEvent[] = [];
  let k = 0;
  let checks = 0;
  for (let w = 1; w <= wallEnd; w++) {
    while (k < feed.length && feed[k].w < w) {
      state.add(feed[k].e);
      seen.push(feed[k].e);
      k++;
    }
    if (w % every !== 0) continue;
    const sView = w - 0.5 + viewerOffset;
    const got = state.snapshot(sView);
    const want = foldWorld(seen, sView, cfg);
    expectSame(got, want, `w=${w}`);
    checks++;
  }
  return { state, seen, checks };
}

describe("foldState: the same ground as the batch fold, grown instead of refolded", () => {
  it("V2 (flow): buildings, paths, the edge, bots ahead and behind, a latecomer", () => {
    const { state, seen, checks } = runAgainstBatch(V2, 420, 7);
    expect(checks).toBeGreaterThan(50);
    const want = foldWorld(seen, 419.5, V2);
    expect(want.slabs.length, "the crowd built something").toBeGreaterThan(0);
    expect(want.paths.length, "the walkers wore a path").toBeGreaterThan(0);
    expect(want.slabs.some((s) => Math.abs(Math.abs(s.x) - WORLD_HALF) < 6), "something stands by the edge").toBe(true);
    // the latecomer's arrival forced a rebuild, but only once
    expect(state.stats.rebuilds).toBeGreaterThanOrEqual(1);
    expect(state.stats.rebuilds).toBeLessThanOrEqual(2);
  });

  it("V1 (no flow): desire paths by visits", () => {
    const { checks } = runAgainstBatch(DEFAULT_FOLD, 240, 6);
    expect(checks).toBeGreaterThan(30);
  });

  it("the viewer's region reads only the cells around them, with the same values", () => {
    const { state, seen } = runAgainstBatch(V2, 180, 60);
    const sView = 179.5;
    const region = { x: 3, z: 0, r: 10 };
    const got = state.snapshot(sView, region);
    const whole = foldWorld(seen, sView, V2);
    const reach = region.r + V2.radius;
    const inside = (c: { x: number; z: number }) => Math.hypot(c.x - region.x, c.z - region.z) <= reach;
    expectSame(got, { slabs: whole.slabs.filter(inside), paths: whole.paths.filter(inside) }, "region");
    expect(got.slabs.length).toBeLessThan(whole.slabs.length);
  });

  it("the viewer's time going backwards (a new session) rebuilds, then goes on", () => {
    const { state, seen } = runAgainstBatch(V2, 150, 50);
    expectSame(state.snapshot(100), foldWorld(seen, 100, V2), "back to 100");
    expectSame(state.snapshot(149.5), foldWorld(seen, 149.5, V2), "forward again");
  });

  it("forgetting the oldest events (the history window) matches a log that forgot them", () => {
    const { state, seen } = runAgainstBatch(V2, 300, 50);
    const cut = 120;
    state.dropBefore(cut);
    const kept = seen.filter((e) => e.s >= cut);
    // not to the last digit: on the pruned log the batch fold recomputes the stay shares of the first staySec after
    // the cut without their look-back (a few treads of a 20-minute-old second); the state keeps what it knew
    expectSame(state.snapshot(299.5), foldWorld(kept, 299.5, V2), "after the cut", 1e-2);
  });

  it("stress: the same per-cell values as stressMap (within the batch's own 1 % truncation)", () => {
    const owners = crowd();
    const feed = arrivals(owners, 240);
    const st = new StressState(DEFAULT_NATURE);
    const seen: PEvent[] = [];
    let k = 0;
    for (let w = 1; w <= 240; w++) {
      while (k < feed.length && feed[k].w < w) st.add(feed[k++].e), seen.push(feed[k - 1].e);
      if (w % 30) continue;
      const sView = w - 0.5;
      const got = st.at(sView);
      const want = stressMap(seen, sView, DEFAULT_NATURE);
      for (const [key, S] of want) {
        const g = got.get(key) ?? 0;
        expect(Math.abs(g - S) <= 0.02 * Math.max(1, S), `w=${w} ${key}: ${g} vs ${S}`).toBe(true);
      }
    }
    // a sample from behind the viewer's time is simply added
    const late: PEvent = { id: "late", o: "latecomer", r: "worker", k: "p", x: 3, z: 2, s: 200 };
    st.add(late);
    seen.push(late);
    const got = st.at(239.5);
    const want = stressMap(seen, 239.5, DEFAULT_NATURE);
    const key = `${Math.floor(3 / CELL_SIZE)},${Math.floor(2 / CELL_SIZE)}`;
    expect(Math.abs((got.get(key) ?? 0) - (want.get(key) ?? 0))).toBeLessThan(0.02 * Math.max(1, want.get(key) ?? 0));
  });
});
