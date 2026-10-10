import { describe, expect, it } from "vitest";
import { DEFAULT_BUNDLE, DEFAULT_FLOW, DEFAULT_WATER, bundleDensity, bundleTrips, fossilCasts, threadLines, tripsOf, type PEvent, type Seed } from "./index";

const SPU = 20;
const seed = (id: number, x: number, z: number): Seed => ({ id, material: "concrete", role: "worker", x, z, t0: 0, t1: 2000, mass: 3 }) as Seed;
// two buildings 20 apart (A around x = 0, B around x = 20), each a few seeds
const seeds = [seed(1, 0.6, 0.6), seed(2, 1.8, 0.6), seed(3, 20.4, 0.6), seed(4, 21.6, 0.6)];
const opts = { secPerUnit: SPU, unit: 1, flow: DEFAULT_FLOW, water: DEFAULT_WATER, maxTripSec: 120, room: 3.6, minDist: 2.5, k0: 0, k1: 1000, max: 2000 };

/** Person o: stays at A, walks to B (1 unit/s, with a little sideways wander), stays at B, walks back, … */
function commuter(o: string, t0: number, rounds: number, lane: number): PEvent[] {
  const out: PEvent[] = [];
  let t = t0;
  const push = (x: number, z: number) => out.push({ id: `${o}:${t}`, o, r: "worker", k: "p", x, z, s: t++ });
  for (let r = 0; r < rounds; r++) {
    const [from, to] = r % 2 ? [21, 1] : [1, 21];
    for (let i = 0; i < 15; i++) push(from + Math.sin(i) * 0.05, 0.6);
    for (let x = from; to > from ? x <= to : x >= to; x += to > from ? 1 : -1) push(x, 0.6 + lane + Math.sin(x * 0.7) * 0.4);
    for (let i = 0; i < 15; i++) push(to + Math.sin(i) * 0.05, 0.6);
  }
  return out;
}

describe("threads: trips between buildings, bundled", () => {
  const evs = [...commuter("a", 0, 4, 2), ...commuter("b", 7, 4, -2), ...commuter("c", 13, 4, 3)];

  it("a trip runs from a stay in one building to the next stay in another, rising by the time it took", () => {
    const trips = tripsOf(evs, seeds, opts);
    expect(trips.length).toBeGreaterThanOrEqual(6);
    for (const t of trips) {
      expect(t.a).not.toBe(t.b);
      const n = t.pts.length / 3;
      expect(t.pts[(n - 1) * 3 + 1]).toBeGreaterThan(t.pts[1]); // later = higher
    }
    expect(tripsOf(evs, seeds, opts)).toEqual(trips); // deterministic
  });

  it("no building at the stays, no trip; too slow, no trip", () => {
    expect(tripsOf(evs, [seed(9, 60, 60)], opts)).toHaveLength(0);
    expect(tripsOf(evs, seeds, { ...opts, maxTripSec: 5 })).toHaveLength(0);
  });

  it("bundling draws the threads of the same pair together, ends held", () => {
    const trips = tripsOf(evs, seeds, opts);
    const raw = bundleTrips(trips, { ...DEFAULT_BUNDLE, cycles: 0 });
    const bun = bundleTrips(trips, DEFAULT_BUNDLE);
    const n = DEFAULT_BUNDLE.points;
    const spread = (T: Float32Array[]) => {
      // sideways spread (z) at the middle point, over all threads
      const zs = T.map((t) => t[Math.floor(n / 2) * 3 + 2]);
      const m = zs.reduce((a, b) => a + b, 0) / zs.length;
      return Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / zs.length);
    };
    expect(spread(bun)).toBeLessThan(spread(raw) * 0.8);
    for (let i = 0; i < raw.length; i++) {
      for (const p of [0, n - 1]) for (let c = 0; c < 3; c++) expect(bun[i][p * 3 + c]).toBeCloseTo(raw[i][p * 3 + c], 6);
    }
    const L = threadLines(bun);
    expect(L.position.length).toBe(bun.length * (n - 1) * 6);
  });

  it("FOSSIL: only bundles of enough threads become casts; a lone thread leaves nothing", () => {
    const trips = tripsOf(evs, seeds, opts);
    const bun = bundleTrips(trips, DEFAULT_BUNDLE);
    const dens = bundleDensity(bun, 0.6);
    const casts = fossilCasts(bun, dens, 2, 0.08);
    expect(casts.length % 7).toBe(0);
    expect(casts.length).toBeGreaterThan(0);
    const lone = tripsOf(commuter("z", 0, 2, 0), seeds, opts).slice(0, 1);
    const lb = bundleTrips(lone, DEFAULT_BUNDLE);
    expect(fossilCasts(lb, bundleDensity(lb, 0.6), 2, 0.08).length).toBe(0);
  });
});
