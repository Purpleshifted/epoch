import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY, DensityField, levelOf, type DensityConfig } from "./density";
import { DEFAULT_BOXES, DEFAULT_LEVEL_FROM, boxesOfSeed } from "./seeds";
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

  it("what a level builds: a slot at level 1 gets plates only, more families as the level rises", () => {
    const kindsAt = (f: DensityField) => {
      const kinds = new Set<string>();
      const box = { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, levelFrom: DEFAULT_LEVEL_FROM };
      for (const s of f.seeds()) for (const b of boxesOfSeed(s, box)) {
        kinds.add(b.kind);
        // nothing above what its own slot's level allows
        const lv = s.levels!.get(b.slot) ?? 0;
        if (b.kind === "mass") expect(lv).toBeGreaterThanOrEqual(DEFAULT_LEVEL_FROM.mass);
        if (b.kind === "column" || b.kind === "beam" || b.kind === "brace") expect(lv).toBeGreaterThanOrEqual(DEFAULT_LEVEL_FROM.frame);
      }
      return kinds;
    };
    const one = fieldOf(crowd(5, 0, 0, 400, 14));
    expect(Math.max(...one.seeds().flatMap((s) => [...s.levels!.values()]))).toBe(1);
    expect(kindsAt(one).has("mass")).toBe(false);
    const many = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b"), ...crowd(5, 0, 0, 400, 40, "c")]);
    expect(Math.max(...many.seeds().flatMap((s) => [...s.levels!.values()]))).toBeGreaterThanOrEqual(3);
    expect(kindsAt(many).has("mass")).toBe(true);
  });

  it("others at the same place and time raise the level, and with it the mass", () => {
    const one = fieldOf(crowd(5, 0, 0, 400, 40));
    const two = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b")]);
    const mass = (f: DensityField) => Math.max(...f.seeds().map((s) => s.mass));
    expect(mass(two)).toBeGreaterThan(mass(one));
  });
});
