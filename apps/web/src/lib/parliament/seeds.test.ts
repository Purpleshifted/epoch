import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, MATERIAL_OF_ROLE, boxesOfSeed, foldWorld, generateBoxes, seedsFromSnapshot, type PEvent, type Seed } from "./index";

const C = 1.2;
const stand = (o: string, x: number, z: number, s0: number, n: number): PEvent[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${o}:${s0}:${i}`, o, r: "worker" as const, k: "p" as const, x, z, s: s0 + i }));
const crowd = (n: number, s0: number, secs: number, gap = 0): PEvent[] => Array.from({ length: n }, (_, i) => stand(`w${i}`, C / 2, C / 2, s0 + i * gap, secs)).flat();

const seed = (over: Partial<Seed> = {}): Seed => ({ id: 12345, material: "concrete", role: "worker", x: 0.6, z: 0.6, t0: 0, t1: 0, mass: 1, ...over });

describe("seeds: from the folded world", () => {
  it("one slab is one seed; its time range is its life; the id depends on place and birth", () => {
    const snap = foldWorld(crowd(3, 0, 40, 5), 100);
    const seeds = seedsFromSnapshot(snap);
    expect(seeds).toHaveLength(snap.slabs.length);
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(s.material).toBe("concrete");
      expect(s.t1).toBeGreaterThanOrEqual(s.t0);
    }
    expect(new Set(seeds.map((s) => s.id)).size).toBe(seeds.length);
  });

  it("only roles that have a material make seeds", () => {
    expect(MATERIAL_OF_ROLE.worker).toBe("concrete");
    expect(seedsFromSnapshot(foldWorld(crowd(3, 0, 40), 100), "wolf")).toEqual([]);
  });

  it("a lone visitor makes no seed at all", () => {
    expect(seedsFromSnapshot(foldWorld(stand("a", 0.6, 0.6, 0, 600), 600))).toEqual([]);
  });
});

describe("seeds: boxes", () => {
  it("is deterministic and every box is finite and positive", () => {
    const s = seed({ t0: 0, t1: 300, mass: 3 });
    expect(boxesOfSeed(s)).toEqual(boxesOfSeed(s));
    for (const b of boxesOfSeed(s)) {
      for (const v of [b.x, b.y, b.z, b.sx, b.sy, b.sz, b.tone, b.along]) expect(Number.isFinite(v)).toBe(true);
      expect(b.sx).toBeGreaterThan(0);
      expect(b.sy).toBeGreaterThan(0);
      expect(b.sz).toBeGreaterThan(0);
    }
  });

  it("y is time: a seed that lives longer reaches higher, and the older boxes stay exactly where they were", () => {
    const short = boxesOfSeed(seed({ t0: 0, t1: 60 }));
    const long = boxesOfSeed(seed({ t0: 0, t1: 300 }));
    const top = (bs: ReturnType<typeof boxesOfSeed>) => Math.max(...bs.map((b) => b.y + b.sy / 2));
    expect(top(long)).toBeGreaterThan(top(short) + 3 * DEFAULT_BOXES.unit);
    for (const b of short) expect(long.some((q) => Math.abs(q.x - b.x) < 1e-9 && Math.abs(q.y - b.y) < 1e-9 && Math.abs(q.sx - b.sx) < 1e-9)).toBe(true);
  });

  it("a seed does not appear before it was born", () => {
    const bs = boxesOfSeed(seed({ t0: 300, t1: 400 }));
    expect(Math.min(...bs.map((b) => b.y - b.sy / 2))).toBeGreaterThanOrEqual((300 / DEFAULT_BOXES.secPerUnit - 1) * DEFAULT_BOXES.unit);
  });

  it("more mass → more boxes; sizes vary", () => {
    const thin = boxesOfSeed(seed({ t0: 0, t1: 600, mass: 1 }));
    const thick = boxesOfSeed(seed({ t0: 0, t1: 600, mass: 6 }));
    expect(thick.length).toBeGreaterThan(thin.length);
    expect(new Set(thick.map((b) => b.sx.toFixed(3))).size).toBeGreaterThan(5);
  });

  it("maxSlots bounds the work for very long lives", () => {
    const bs = generateBoxes([seed({ t0: 0, t1: 1e6, mass: 6 })], { ...DEFAULT_BOXES, maxSlots: 50 });
    expect(bs.length).toBeLessThanOrEqual(50 * 4);
  });
});
