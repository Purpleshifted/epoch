/**
 * The tree: seeds (events k = "s") green the ground — in the player view (sowMap / the sowing state) and on the wall
 * (natureHistory) alike; the record notes the scattering; the seeds shape no path and no building.
 */
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW } from "./flow";
import { foldWorld } from "./fold";
import { StressState } from "./foldState";
import { DEFAULT_NATURE, grassDensity, sowMap, sowSource, stressMap } from "./nature";
import { natureHistory } from "./natureHistory";
import { SOW, ROLE_CONTROLS, sowSpots } from "./roleControls";
import { DEFAULT_FOLD, type FoldConfig, type PEvent, type RoleId } from "./types";
import { DEFAULT_WITNESS, WitnessLog, observe } from "./witness";

const V2: FoldConfig = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };
const seed = (o: string, x: number, z: number, s: number, r: RoleId = "tree"): PEvent => ({ id: `${o}:s:${s}`, o, r, k: "s", x, z, s });
const pres = (o: string, r: RoleId, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;

describe("the tree sows", () => {
  it("a seed greens its cell and its neighbours, most at the centre, and lasts (sowSec is long)", () => {
    const ev = [seed("t", 4.2, 4.2, 10)];
    const T = sowMap(ev, 20, DEFAULT_NATURE);
    const at = key(4.2, 4.2);
    expect(T.get(at)!).toBeGreaterThan(0.3);
    expect(T.get(at)!).toBeLessThanOrEqual(DEFAULT_NATURE.sowDose!);
    const next = T.get(key(4.2 + CELL_SIZE, 4.2));
    expect(next).toBeDefined();
    expect(next!).toBeLessThan(T.get(at)!);
    // minutes later most of it is still there
    expect(sowMap(ev, 10 + 300, DEFAULT_NATURE).get(at)! / T.get(at)!).toBeGreaterThan(0.7);
    // nothing before it was thrown, nothing from another role's "seed"
    expect(sowMap(ev, 9, DEFAULT_NATURE).size).toBe(0);
    expect(sowMap([seed("w", 4.2, 4.2, 10, "worker")], 20, DEFAULT_NATURE).size).toBe(0);
    // and no stress from it
    expect(stressMap(ev, 20, DEFAULT_NATURE).size).toBe(0);
  });

  it("the density rises with the sowing, capped at 1, and is still worn, bitten and buried", () => {
    const g0 = grassDensity(3, 3, 0, 0, false, DEFAULT_NATURE);
    const g1 = grassDensity(3, 3, 0, 0, false, DEFAULT_NATURE, 0.4);
    expect(g1).toBeGreaterThan(g0);
    expect(grassDensity(3, 3, 0, 0, false, DEFAULT_NATURE, 5)).toBe(1);
    expect(grassDensity(3, 3, 1, 0, false, DEFAULT_NATURE, 0.4)).toBeLessThan(g1);
    expect(grassDensity(3, 3, 0, 1, false, DEFAULT_NATURE, 0.4)).toBeLessThan(g1);
    expect(grassDensity(3, 3, 0, 0, true, DEFAULT_NATURE, 0.4)).toBeLessThan(g1);
  });

  it("the sowing state agrees with sowMap, and the stress state ignores seeds", () => {
    const ev = [seed("t", 4.2, 4.2, 10), seed("t", 5, 3, 12), seed("t", -30, 7, 14), pres("w", "worker", 4.2, 4.2, 11)];
    const sow = new StressState(DEFAULT_NATURE, sowSource(DEFAULT_NATURE));
    const stress = new StressState(DEFAULT_NATURE);
    for (const e of ev) {
      sow.add(e);
      stress.add(e);
    }
    for (const s of [11, 13, 40]) {
      const batch = sowMap(ev, s, DEFAULT_NATURE);
      const state = sow.at(s);
      expect(state.size).toBe(batch.size);
      for (const [k, v] of batch) expect(state.get(k)!).toBeCloseTo(v, 6);
      const st = stress.at(s);
      expect(st.get(key(4.2, 4.2)) ?? 0).toBeCloseTo(stressMap(ev, s, DEFAULT_NATURE).get(key(4.2, 4.2)) ?? 0, 6);
    }
    expect(stress.at(40).size).toBeGreaterThan(0); // the worker's wear, not the seeds
  });

  it("the wall sees it: the nature history is greener where a tree sowed", () => {
    const workers = [0, 1, 2].flatMap((i) => Array.from({ length: 60 }, (_, t) => pres(`w${i}`, "worker", 20 + i * 0.3, 20, t)));
    const without = natureHistory({ events: workers, seeds: [], secPerUnit: 10, k0: 0, k1: 5, margin: 6, nature: DEFAULT_NATURE, fold: V2 });
    const sown = natureHistory({ events: [...workers, seed("t", 16, 16, 15), seed("t", 16.5, 16, 16)], seeds: [], secPerUnit: 10, k0: 0, k1: 5, margin: 6, nature: DEFAULT_NATURE, fold: V2 });
    const cx = Math.floor(16 / CELL_SIZE), cz = Math.floor(16 / CELL_SIZE);
    const at = (h: typeof without, k: number) => h.V[(k - h.k0) * h.nx * h.nz + (cz - h.z0) * h.nx + (cx - h.x0)];
    expect(at(sown, 0)).toBeCloseTo(at(without, 0), 6); // before the seeds
    expect(at(sown, 3)).toBeGreaterThan(at(without, 3));
    expect(at(sown, 5)).toBeGreaterThan(at(without, 5));
  });

  it("seeds shape no ground: no path, no slab from them", () => {
    const ev = Array.from({ length: 50 }, (_, t) => seed("t", 2 + (t % 5), 2, t));
    const snap = foldWorld(ev, 60, V2);
    expect(snap.paths).toEqual([]);
    expect(snap.slabs).toEqual([]);
  });

  it("a click throws a few seeds ahead, within the fan; the record counts them", () => {
    let i = 0;
    const u = () => ((i++ * 7919) % 1000) / 1000;
    const spots = sowSpots(1, 2, 0, u); // facing +z
    expect(spots.length).toBe(SOW.count);
    for (const sp of spots) {
      const dz = sp.z - 2, dx = sp.x - 1;
      const d = Math.hypot(dx, dz);
      expect(d).toBeGreaterThanOrEqual(SOW.reach - 1e-9);
      expect(d).toBeLessThanOrEqual(SOW.reach + SOW.throw + 1e-9);
      expect(Math.abs(Math.atan2(dx, dz))).toBeLessThanOrEqual(SOW.spread + 1e-9);
    }
    expect(ROLE_CONTROLS.tree.act).toBe("sow");
    expect(ROLE_CONTROLS.worker.act).toBeUndefined();
    const me = { id: "me", x: 0, z: 0, vx: 0, vz: 0 };
    const events = [seed("me", 1, 3, 5), seed("me", 2, 3, 5), seed("me", 1, 4, 5), seed("other", 9, 9, 6)];
    expect(observe({ me, events, sNow: 4, snap: null, t: 4, cfg: DEFAULT_WITNESS }).sown).toBe(0);
    expect(observe({ me, events, sNow: 6, snap: null, t: 6, cfg: DEFAULT_WITNESS }).sown).toBe(3);
    const log = new WitnessLog();
    log.push(observe({ me, events, sNow: 4, snap: null, t: 4, cfg: DEFAULT_WITNESS }));
    const lines = log.push(observe({ me, events, sNow: 6, snap: null, t: 6, cfg: DEFAULT_WITNESS }));
    expect(lines.some((l) => l.includes("SCATTERED SEED · 3"))).toBe(true);
    expect(log.push(observe({ me, events, sNow: 7, snap: null, t: 7, cfg: DEFAULT_WITNESS })).some((l) => l.includes("SCATTERED"))).toBe(false);
  });
});
