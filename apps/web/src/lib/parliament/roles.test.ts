/**
 * What each role does to the ground (flow.ts treadOf, nature.ts wearOf, seeds.ts MATERIAL_OF_DEATH): the batch fold
 * and the growing fold agree on it.
 */
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { CAT_TREAD, DEFAULT_FLOW, treadOf } from "./flow";
import { foldWorld } from "./fold";
import { FoldState, StressState } from "./foldState";
import { DEFAULT_NATURE, stressMap, wearOf } from "./nature";
import { seedsFromDeaths } from "./seeds";
import { DEFAULT_FOLD, type FoldConfig, type PEvent, type RoleId } from "./types";

const V2: FoldConfig = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };
const ev = (o: string, r: RoleId, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
const sorted = (e: PEvent[]) => [...e].sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
/** Back and forth along x ∈ [a, b] at z, one sample per second. */
function shuttle(o: string, r: RoleId, a: number, b: number, z: number, t0: number, secs: number, speed = 1): PEvent[] {
  const out: PEvent[] = [];
  const L = b - a;
  for (let t = 0; t < secs; t++) {
    const d = (t * speed) % (2 * L);
    out.push(ev(o, r, d < L ? a + d : b - (d - L), z, t0 + t));
  }
  return out;
}
function stand(o: string, r: RoleId, x: number, z: number, t0: number, secs: number): PEvent[] {
  return Array.from({ length: secs }, (_, t) => ev(o, r, x + Math.sin(t) * 0.05, z, t0 + t));
}
const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
const pAt = (events: PEvent[], s: number, k: string) => foldWorld(events, s, V2).paths.find((p) => p.key === k)?.p ?? 0;

describe("roles on the ground", () => {
  it("tread weights: worker 1, car carTread, cat faint, tree and the V1 roles nothing; wear: worker 1, car carWear, the rest nothing", () => {
    expect(treadOf("worker", DEFAULT_FLOW)).toBe(1);
    expect(treadOf("car", DEFAULT_FLOW)).toBe(3);
    expect(treadOf("car", { ...DEFAULT_FLOW, carTread: 5 })).toBe(5);
    expect(treadOf("cat", DEFAULT_FLOW)).toBe(CAT_TREAD);
    expect(treadOf("tree", DEFAULT_FLOW)).toBe(0);
    expect(treadOf("shepherd", DEFAULT_FLOW)).toBe(0);
    expect(wearOf("worker", DEFAULT_NATURE)).toBe(1);
    expect(wearOf("car", DEFAULT_NATURE)).toBe(4);
    expect(wearOf("cat", DEFAULT_NATURE)).toBe(0);
    expect(wearOf("tree", DEFAULT_NATURE)).toBe(0);
  });

  it("a car treads a road where a worker leaves a path, a cat only a trail, a tree nothing", () => {
    const at = key(10, 5);
    const t = 60;
    const worker = sorted(shuttle("w", "worker", 0, 20, 5, 0, t));
    const car = sorted(shuttle("c", "car", 0, 20, 5, 0, t));
    const cat = sorted(shuttle("k", "cat", 0, 20, 5, 0, t));
    const tree = sorted(shuttle("t", "tree", 0, 20, 5, 0, t));
    const pw = pAt(worker, t, at), pc = pAt(car, t, at), pk = pAt(cat, t, at), pt = pAt(tree, t, at);
    expect(pw).toBeGreaterThan(0.1);
    expect(pc).toBeGreaterThan(pw);
    expect(pk).toBeGreaterThan(0);
    expect(pk).toBeLessThan(pw);
    expect(pt).toBe(0);
    // the car's road is the worker's path trodden three times as hard: the same G × 3
    const gw = -Math.log(1 - pw), gc = -Math.log(1 - pc);
    expect(gc / gw).toBeCloseTo(3, 1);
  });

  it("only workers build: three cars standing together put up no concrete; three workers do", () => {
    const cars = sorted(["a", "b", "c"].flatMap((o) => stand(o, "car", 2, 2, 0, 200)));
    expect(foldWorld(cars, 200, V2).slabs).toEqual([]);
    const workers = sorted(["a", "b", "c"].flatMap((o) => stand(o, "worker", 2, 2, 0, 200)));
    expect(foldWorld(workers, 200, V2).slabs.length).toBeGreaterThan(0);
  });

  it("a path knows its line: a road along x has axis 0 and agreeing treads; two crossing roads disagree", () => {
    const t = 60;
    const road = sorted(shuttle("c", "car", 0, 20, 5, 0, t));
    const cell = foldWorld(road, t, V2).paths.find((p) => p.key === key(10, 5))!;
    expect(cell.axis).toBeCloseTo(0, 2);
    expect(cell.align).toBeGreaterThan(0.95);
    // a second car shuttles along z through the same cell: the flows cancel on a line (p ~ 0) but the cell stays trodden (level)
    const alongZ = Array.from({ length: t }, (_, i) => {
      const d = i % 40;
      return ev("d", "car", 10.6, d < 20 ? -5 + d : 15 - (d - 20), i);
    });
    const across = sorted([...road, ...alongZ]);
    const x = foldWorld(across, t, V2).paths.find((p) => p.key === key(10, 5))!;
    expect(x).toBeDefined();
    expect(x.align!).toBeLessThan(0.5);
    expect(x.p).toBeLessThan(cell.p);
    expect(x.level!).toBeGreaterThan(cell.p * 0.9);
    expect(cell.level!).toBeCloseTo(cell.p, 2);
  });

  it("the growing fold agrees with the batch fold on cars and cats", () => {
    const t = 120;
    const all = sorted([
      ...shuttle("w", "worker", 0, 20, 5, 0, t),
      ...shuttle("v", "car", 0, 20, 8, 3, t),
      ...shuttle("k", "cat", 0, 20, 11, 6, t),
      ...["a", "b", "c"].flatMap((o) => stand(o, "worker", 2, -4, 0, t)),
      ...["x", "y", "z"].flatMap((o) => stand(o, "car", -6, -4, 0, t)),
    ]);
    const st = new FoldState(V2);
    for (const e of all) st.add(e);
    for (const s of [40, 80, t]) {
      const batch = foldWorld(all, s, V2);
      const grown = st.snapshot(s);
      expect(grown.slabs.map((x) => x.key)).toEqual(batch.slabs.map((x) => x.key));
      expect(grown.paths.length).toBe(batch.paths.length);
      for (let i = 0; i < batch.paths.length; i++) {
        expect(grown.paths[i].key).toBe(batch.paths[i].key);
        expect(grown.paths[i].p).toBeCloseTo(batch.paths[i].p, 3);
        expect(grown.paths[i].level!).toBeCloseTo(batch.paths[i].level!, 3);
        expect(grown.paths[i].align!).toBeCloseTo(batch.paths[i].align!, 3);
        expect(Math.abs(Math.sin(grown.paths[i].axis! - batch.paths[i].axis!))).toBeLessThan(1e-3);
      }
    }
  });

  it("a car wears the vegetation carWear times a worker, a cat and a tree not at all; the stress state agrees", () => {
    const t = 30;
    const worker = sorted(stand("w", "worker", 4, 4, 0, t));
    const car = sorted(stand("c", "car", 4, 4, 0, t));
    const cat = sorted(stand("k", "cat", 4, 4, 0, t));
    const at = key(4, 4);
    const sw = stressMap(worker, t, DEFAULT_NATURE).get(at)!, sc = stressMap(car, t, DEFAULT_NATURE).get(at)!;
    expect(sc / sw).toBeCloseTo(4, 3);
    expect(stressMap(cat, t, DEFAULT_NATURE).get(at)).toBeUndefined();
    const st = new StressState(DEFAULT_NATURE);
    for (const e of [...car, ...cat]) st.add(e);
    expect(st.at(t).get(at)!).toBeCloseTo(sc, 3);
  });

  it("a car's death leaves a wreck seed at the spot, in its one time slot; a worker's leaves nothing", () => {
    const events: PEvent[] = [
      ev("c", "car", 3.3, -2.1, 50),
      { id: "c:x", o: "c", r: "car", k: "x", x: 3.3, z: -2.1, s: 61 },
      { id: "w:x", o: "w", r: "worker", k: "x", x: 0, z: 0, s: 70 },
    ];
    const seeds = seedsFromDeaths(events);
    expect(seeds.length).toBe(1);
    expect(seeds[0]).toMatchObject({ material: "wreck", role: "car", x: 3.3, z: -2.1, t0: 61, t1: 61, mass: 1 });
    expect(seedsFromDeaths(events, 60)).toEqual([]);
    // the end event shapes no ground
    expect(foldWorld(events, 100, V2).paths).toEqual([]);
  });
});
