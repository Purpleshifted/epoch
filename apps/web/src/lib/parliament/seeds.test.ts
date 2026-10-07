import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, MATERIAL_OF_ROLE, boxesOfSeed, foldWorld, generateBoxes, occupiedSlots, seedsFromSnapshot, withoutWear, type PEvent, type Seed } from "./index";

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

describe("seeds: empty time stays empty", () => {
  it("a slab's life is split into spans where nobody was around", () => {
    const e = [...crowd(3, 0, 40), ...crowd(3, 1000, 40).map((x) => ({ ...x, id: "b" + x.id }))];
    const slab = foldWorld(e, 2000).slabs.find((s) => s.key === "0,0")!;
    expect(slab.spans).toHaveLength(2);
    expect(slab.spans![0][1]).toBeLessThan(100);
    expect(slab.spans![1][0]).toBeGreaterThanOrEqual(1000);
  });

  it("continuous presence is one span from the birth on", () => {
    const slab = foldWorld(crowd(3, 0, 120), 200).slabs.find((s) => s.key === "0,0")!;
    expect(slab.spans).toEqual([[slab.bornS, slab.lastS]]);
  });

  it("no boxes in the slots between two gatherings", () => {
    const e = [...crowd(3, 0, 40), ...crowd(3, 1000, 40).map((x) => ({ ...x, id: "b" + x.id }))];
    const seeds = seedsFromSnapshot(foldWorld(e, 2000)).filter((s) => s.x === C / 2 && s.z === C / 2);
    const bs = generateBoxes(seeds);
    const spu = DEFAULT_BOXES.secPerUnit;
    const emptyFloor = (100 / spu + 1) * DEFAULT_BOXES.unit; // a slot after the first gathering, plus box overhang
    const emptyCeil = (1000 / spu) * DEFAULT_BOXES.unit;
    expect(bs.length).toBeGreaterThan(0);
    expect(bs.filter((b) => b.y > emptyFloor && b.y < emptyCeil)).toHaveLength(0);
    expect(bs.some((b) => b.y >= emptyCeil)).toBe(true);
  });

  it("a seed without spans (hand-built) still fills t0 … t1", () => {
    expect(occupiedSlots(seed({ t0: 0, t1: 90 }))).toEqual([0, 1, 2, 3]);
    expect(occupiedSlots(seed({ t0: 0, t1: 300, spans: [[0, 10], [250, 300]] }))).toEqual([0, 8, 9, 10]);
  });
});

describe("seeds: the 3D history view folds without wear", () => {
  it("a slab whose footprint has worn away by the latest time still makes its seed", () => {
    const e = crowd(3, 0, 40);
    const late = 100_000;
    expect(foldWorld(e, late).slabs).toHaveLength(0); // the Top (future) view: gone
    const kept = foldWorld(e, late, withoutWear(DEFAULT_FOLD)).slabs.find((s) => s.key === "0,0")!;
    expect(kept).toBeDefined();
    expect(kept.h).toBeCloseTo(kept.raw, 9);
    expect(kept.foot).toBe(1);
    expect(seedsFromSnapshot(foldWorld(e, late, withoutWear(DEFAULT_FOLD))).length).toBe(seedsFromSnapshot(foldWorld(e, 40)).length);
  });
});
