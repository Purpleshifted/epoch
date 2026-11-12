import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY, DensityField, levelOf, type DensityConfig } from "./density";
import { DEFAULT_BOXES, DEFAULT_LEVEL_MIX, boxesOfSeed, levelKeep } from "./seeds";
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

  it("levelKeep: a share of 1 is always all, 0 never; below the full level a small share thins fastest", () => {
    expect(levelKeep(1, 1, 3)).toBe(1);
    expect(levelKeep(0, 5, 3)).toBe(0);
    expect(levelKeep(0.5, 3, 3)).toBe(0.5);
    expect(levelKeep(0.5, 9, 3)).toBe(0.5);
    expect(levelKeep(0.5, 1, 3)).toBeCloseTo(0.125);
    expect(levelKeep(0.9, 1, 3)).toBeGreaterThan(levelKeep(0.5, 1, 3) * 4);
    expect(levelKeep(0.5, 0, 3)).toBe(0);
  });

  it("what a level builds, by shares: a rising level only adds parts; a share of 0 leaves a family out", () => {
    const THIN = { ...DEFAULT_LEVEL_MIX, column: 0.7, beam: 0.7, brace: 0.7, mass: 0.5, drip: 0.3, basement: 0.6, pile: 0.6, full: 3 };
    const boxOf = (mix: Partial<typeof DEFAULT_LEVEL_MIX>) => ({ ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, levelMix: { ...THIN, ...mix } });
    const many = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b"), ...crowd(5, 0, 0, 400, 40, "c")]);
    const seed = many.seeds().reduce((a, b) => (Math.max(...b.levels!.values()) > Math.max(...a.levels!.values()) ? b : a));
    const all = boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec }).length;
    const kept = boxesOfSeed(seed, boxOf({})).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(all);
    // the defaults keep everything the grammar makes: the look before the shares
    expect(boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, levelMix: DEFAULT_LEVEL_MIX }).length).toBe(all);
    expect(boxesOfSeed(seed, boxOf({ mass: 0 })).some((b) => b.kind === "mass")).toBe(false);
    // the same seed one level lower everywhere: what it keeps is part of what it kept
    const lower = { ...seed, levels: new Map([...seed.levels!].map(([k, l]) => [k, Math.max(1, l - 1)] as const)) };
    const at = (b: { kind: string; slot: number; x: number; y: number; z: number }) => `${b.kind}:${b.slot}:${b.x.toFixed(3)}:${b.y.toFixed(3)}:${b.z.toFixed(3)}`;
    const high = new Set(boxesOfSeed(seed, boxOf({})).map(at));
    for (const b of boxesOfSeed(lower, boxOf({}))) expect(high.has(at(b))).toBe(true);
  });

  it("others at the same place and time raise the level, and with it the mass", () => {
    const one = fieldOf(crowd(5, 0, 0, 400, 40));
    const two = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b")]);
    const mass = (f: DensityField) => Math.max(...f.seeds().map((s) => s.mass));
    expect(mass(two)).toBeGreaterThan(mass(one));
  });
});
