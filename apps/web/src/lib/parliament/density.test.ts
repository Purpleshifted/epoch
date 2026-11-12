import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY, DensityField, levelOf, type DensityConfig } from "./density";
import { DEFAULT_BOXES, DEFAULT_VARIETY, boxesOfSeed, buildKeep, districtOf } from "./seeds";
import type { PEvent } from "./types";

const CFG: DensityConfig = { ...DEFAULT_DENSITY };
/** `n` people standing within half a metre of (x, z) from `s0` for `sec` seconds, one sample a second each. */
function crowd(n: number, x: number, z: number, s0: number, sec: number, tag = "a"): PEvent[] {
  const out: PEvent[] = [];
  for (let t = 0; t < sec; t++) for (let i = 0; i < n; i++) out.push({ id: `${tag}${i}:${t}`, o: `${tag}${i}`, r: "worker", k: "p", x: x + (i % 3) * 0.2, z: z + (i % 2) * 0.2, s: s0 + t });
  return out;
}
const fieldOf = (events: PEvent[], cfg = CFG) => {
  const f = new DensityField(cfg);
  for (const e of events) f.add(e);
  return f;
};

describe("density: buildings from the density of spacetime", () => {
  it("levelOf: nothing under four visitors or under the first threshold, then one level per factor", () => {
    const by = (amounts: number[]) => new Map(amounts.map((a, i) => [i, a] as const));
    expect(levelOf(by([20, 20, 20]), CFG)).toBe(0); // three people, however long
    expect(levelOf(by([5, 5, 5, 5]), CFG)).toBe(0); // four, but 20 < 40
    expect(levelOf(by([10, 10, 10, 10]), CFG)).toBe(1);
    expect(levelOf(by([20, 20, 20, 20]), CFG)).toBe(2);
    expect(levelOf(by([99, 99, 99, 99]), CFG)).toBe(2); // each capped at 20: one herd never passes level 2
    expect(levelOf(by([20, 20, 20, 20, 20, 20, 20, 20]), CFG)).toBe(3);
    expect(levelOf(by([1, 20, 20, 20]), CFG)).toBe(0); // the fourth only passed by
  });

  it("three people never build; five standing twenty seconds do — at once, where and when they stood", () => {
    expect(fieldOf(crowd(3, 10, 10, 400, 60)).seeds().length).toBe(0);
    const f = fieldOf(crowd(5, 10, 10, 400, 20));
    const seeds = f.seeds();
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(Math.hypot(s.x - 10, s.z - 10)).toBeLessThan(CFG.radius + 1.5);
      expect(s.t0).toBeGreaterThanOrEqual(400 - CFG.timeSec * CFG.down - CFG.slotSec);
      expect(s.t1).toBeLessThanOrEqual(420 + CFG.timeSec + CFG.slotSec);
      expect(s.spans!.length).toBeGreaterThanOrEqual(1);
      expect(s.who!.length).toBeGreaterThanOrEqual(CFG.minVisitors);
    }
  });

  it("between two thresholds nothing changes: the same seeds, the same version", () => {
    const f = fieldOf(crowd(5, 0, 0, 200, 14));
    const before = f.seeds(), v = f.version;
    // one more second of the same five: no cell-slot crosses a threshold
    for (const e of crowd(5, 0, 0, 214, 1, "a")) f.add(e);
    expect(f.version).toBe(v);
    expect(f.seeds()).toBe(before);
  });

  it("is a sum: the order of the samples does not matter", () => {
    const ev = [...crowd(5, 3, -4, 300, 30), ...crowd(4, 5, -4, 520, 25, "b")];
    const a = fieldOf(ev);
    const b = fieldOf([...ev].reverse());
    const flat = (f: DensityField) => f.seeds().map((s) => `${s.id}:${s.mass}:${JSON.stringify(s.spans)}`).sort();
    expect(flat(b)).toEqual(flat(a));
  });

  it("written deep in the block later: the cell keeps its id (its parts are not reshuffled) and gains the slots below", () => {
    const f = fieldOf(crowd(5, 0, 0, 1000, 20));
    const top = f.seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    for (const e of crowd(5, 0, 0, 300, 20, "c")) f.add(e);
    const both = f.seeds().find((s) => s.id === top.id)!;
    expect(both).toBeDefined();
    expect(both.t0).toBeLessThan(top.t0);
    expect(both.spans!.length).toBe(2);
  });

  it("down 0: a presence weighs on its own time and later, never on the slots before it", () => {
    const f = fieldOf(crowd(6, 0, 0, 405, 30), { ...CFG, down: 0 });
    for (const s of f.seeds()) expect(s.t0).toBeGreaterThanOrEqual(400);
    expect(f.seeds().length).toBeGreaterThan(0);
  });

  it("buildKeep: the foundation at once, then beams, slabs, masses, drips — complete `buildSlots` above the beginning", () => {
    for (const k of ["basement", "pile", "plinth", "column"] as const) expect(buildKeep(k, 0, 3)).toBe(1);
    for (const k of ["beam", "brace", "slab", "mass", "drip"] as const) expect(buildKeep(k, 0, 3)).toBe(0);
    expect(buildKeep("beam", 1, 3)).toBeGreaterThan(0);
    expect(buildKeep("mass", 1, 3)).toBe(0);
    expect(buildKeep("mass", 2, 3)).toBeGreaterThan(0);
    for (const k of ["beam", "slab", "mass", "drip"] as const) expect(buildKeep(k, 3, 3)).toBe(1);
    expect(buildKeep("drip", 0, 0)).toBe(1); // 0 = everything at once
  });

  it("the order of building is the time axis: no mass in a building's first slot, everything `buildSlots` above it", () => {
    const f = fieldOf(crowd(6, 0, 0, 400, 200));
    const seed = f.seeds().reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a));
    const box = { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec };
    const first = Math.floor(seed.t0 / CFG.slotSec);
    const plain = boxesOfSeed(seed, box), built = boxesOfSeed(seed, { ...box, buildSlots: 3 });
    expect(built.length).toBeLessThan(plain.length);
    expect(built.some((b) => b.slot === first && (b.kind === "mass" || b.kind === "slab" || b.kind === "drip"))).toBe(false);
    const count = (list: typeof plain, k: number) => list.filter((b) => b.slot === k).length;
    for (let k = first + 3; k <= first + 5; k++) expect(count(built, k)).toBe(count(plain, k));
    expect(boxesOfSeed(seed, { ...box, buildSlots: 0 }).length).toBe(plain.length);
  });

  it("empty time: a short pause is one building, a longer one starts another — its order of building from the beginning", () => {
    // two stays at the same place, far apart in time
    const ev = [...crowd(6, 0, 0, 200, 30), ...crowd(6, 0, 0, 900, 30, "b")];
    const two = fieldOf(ev).seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    expect(two.spans!.length).toBe(2);
    const one = fieldOf(ev, { ...CFG, gapSec: 2000 }).seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    expect(one.spans!.length).toBe(1);
    // the second building's first slot is a beginning again: no masses there
    const box = { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, buildSlots: 3 };
    const again = Math.floor(two.spans![1][0] / CFG.slotSec);
    expect(boxesOfSeed(two, box).some((b) => b.slot === again && b.kind === "mass")).toBe(false);
  });

  it("districts: one district's buildings share an angle and a character; districts differ; nothing is lost or made", () => {
    const v = { ...DEFAULT_VARIETY };
    const a = districtOf(1, 1, v), a2 = districtOf(1.5, 0.5, v);
    expect(a2).toEqual(a);
    const angles = new Set<string>(), chars = new Set<string>();
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const d = districtOf(i * 14, j * 14, v);
      angles.add(d.angle.toFixed(3));
      chars.add(d.character);
      expect(Math.abs(d.angle)).toBeLessThanOrEqual(v.angle + 1e-9);
    }
    expect(angles.size).toBeGreaterThan(20);
    expect(chars.size).toBe(4);
    expect(Math.abs(districtOf(40, 40, { ...v, angleStep: Math.PI / 12 }).angle % (Math.PI / 12))).toBeLessThan(1e-9);
    // a seed's parts: with no lean, the same parts — only turned and resized
    const f = fieldOf(crowd(5, 30, 30, 400, 30));
    const seed = f.seeds()[0];
    const plain = boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec });
    const turned = boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, variety: { ...v, character: 0 } });
    expect(turned.length).toBe(plain.length);
    const d = districtOf(seed.x, seed.z, v);
    if (d.angle) expect(turned.some((b, i) => Math.abs(b.x - plain[i].x) > 1e-6 || (b.yaw ?? 0) !== (plain[i].yaw ?? 0))).toBe(true);
    // with a lean some kinds thin out, none is added
    expect(boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, variety: { ...v, character: 1 } }).length).toBeLessThanOrEqual(plain.length);
  });

  it("others at the same place and time raise the level, and with it the mass", () => {
    const one = fieldOf(crowd(5, 0, 0, 400, 40));
    const two = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b")]);
    const mass = (f: DensityField) => Math.max(...f.seeds().map((s) => s.mass));
    expect(mass(two)).toBeGreaterThan(mass(one));
  });
});
