import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, FOUNDATION, MATERIAL_OF_ROLE, PART_KINDS, RECIPES, STEEL, boxesOfSeed, halfHeight, foldWorld, generateBoxes, occupiedSlots, seedsFromSnapshot, withoutWear, type Box, type PEvent, type Seed } from "./index";

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

  it("a seed does not appear before it was born; only its foundation reaches below, and not further than a pile", () => {
    const bs = boxesOfSeed(seed({ t0: 300, t1: 400 }));
    const birthY = (300 / DEFAULT_BOXES.secPerUnit) * DEFAULT_BOXES.unit;
    const bottom = (b: Box) => b.y - halfHeight(b);
    expect(Math.min(...bs.filter((b) => !FOUNDATION.has(b.kind)).map(bottom))).toBeGreaterThanOrEqual(birthY - 1e-9);
    expect(Math.min(...bs.map(bottom))).toBeGreaterThanOrEqual(birthY - RECIPES.concrete.pile.depth[1] * DEFAULT_BOXES.unit - 1e-9);
  });

  it("more mass → more masses; sizes vary", () => {
    const masses = (m: number) => boxesOfSeed(seed({ t0: 0, t1: 600, mass: m })).filter((b) => b.kind === "mass");
    expect(masses(6).length).toBeGreaterThan(masses(1).length);
    expect(new Set(masses(6).map((b) => b.sx.toFixed(3))).size).toBeGreaterThan(5);
  });

  it("scale hierarchy: masses span an order of magnitude, few are huge and most are small", () => {
    const ms = boxesOfSeed(seed({ t0: 0, t1: 3000, mass: 4 })).filter((b) => b.kind === "mass");
    const f = ms.map((b) => Math.sqrt(b.sx * b.sz)).sort((a, b) => a - b);
    expect(f[f.length - 1] / f[0]).toBeGreaterThan(8);
    const median = f[Math.floor(f.length / 2)];
    expect(median).toBeLessThan((f[0] + f[f.length - 1]) / 4);
  });

  it("steel runs every way: upright columns, (nearly) level beams, leaning braces", () => {
    const steel = boxesOfSeed(seed({ t0: 0, t1: 3000, mass: 3 })).filter((b) => STEEL.has(b.kind));
    const lean = (b: Box) => Math.abs(b.tilt ?? 0); // 0 = upright, π/2 = level
    expect(steel.filter((b) => b.kind === "column").every((b) => lean(b) === 0)).toBe(true);
    const beams = steel.filter((b) => b.kind === "beam");
    expect(beams.length).toBeGreaterThan(5);
    for (const b of beams) expect(Math.abs(lean(b) - Math.PI / 2)).toBeLessThanOrEqual(RECIPES.concrete.beam.skew + 1e-9);
    expect(beams.some((b) => Math.abs(lean(b) - Math.PI / 2) > 0.02)).toBe(true); // some askew
    expect(new Set(beams.map((b) => (b.yaw ?? 0).toFixed(3))).size).toBeGreaterThan(2); // not only on the grid
    const braces = steel.filter((b) => b.kind === "brace");
    expect(braces.length).toBeGreaterThan(5);
    for (const b of braces) expect(lean(b)).toBeGreaterThan(0.3);
  });

  it("every part stays inside its run: between the run start and its slot's ceiling", () => {
    const s = seed({ t0: 0, t1: 600, spans: [[0, 200], [400, 600]], mass: 3 });
    const u = DEFAULT_BOXES.unit;
    const spu = DEFAULT_BOXES.secPerUnit;
    const runs = [[0, Math.floor(200 / spu)], [Math.floor(400 / spu), Math.floor(600 / spu)]];
    for (const b of boxesOfSeed(s).filter((b) => !FOUNDATION.has(b.kind))) {
      const lo = b.y - halfHeight(b);
      const hi = b.y + halfHeight(b);
      expect(runs.some(([a, z]) => lo >= a * u - 1e-6 && hi <= (z + 1) * u + 1e-6)).toBe(true);
    }
  });

  it("a long life has every kind of part: foundation, masses, slabs, steel", () => {
    const kinds = new Set(boxesOfSeed(seed({ t0: 600, t1: 1200, mass: 3 })).map((b) => b.kind));
    for (const k of PART_KINDS) expect(kinds.has(k)).toBe(true);
  });

  it("maxSlots bounds the work for very long lives", () => {
    const bs = generateBoxes([seed({ t0: 0, t1: 1e6, mass: 6 })], { ...DEFAULT_BOXES, maxSlots: 50 });
    const rc = RECIPES.concrete;
    expect(bs.filter((b) => b.kind === "mass").length).toBeLessThanOrEqual(50 * rc.mass.maxPerSlot);
    expect(bs.length).toBeLessThanOrEqual(50 * (rc.mass.maxPerSlot + 1 + rc.column.count[1] + 2));
  });
});

describe("seeds: foundations", () => {
  const birthY = (t0: number) => Math.floor(t0 / DEFAULT_BOXES.secPerUnit) * DEFAULT_BOXES.unit;

  it("piles land on what is below when they can reach it", () => {
    const s = seed({ t0: 900, t1: 960 });
    const floor = birthY(900) - 2;
    const piles = boxesOfSeed(s, DEFAULT_BOXES, () => floor).filter((b) => b.kind === "pile");
    expect(piles.length).toBeGreaterThanOrEqual(RECIPES.concrete.pile.count[0]);
    for (const p of piles) expect(p.y - p.sy / 2).toBeCloseTo(floor, 9);
  });

  it("piles dangle when there is nothing within reach", () => {
    const s = seed({ t0: 9000, t1: 9060 });
    const y0 = birthY(9000);
    const piles = boxesOfSeed(s).filter((b) => b.kind === "pile");
    expect(piles.length).toBeGreaterThan(0);
    for (const p of piles) {
      expect(p.y + p.sy / 2).toBeCloseTo(y0, 9);
      expect(p.sy).toBeLessThanOrEqual(RECIPES.concrete.pile.depth[1] * DEFAULT_BOXES.unit + 1e-9);
    }
  });

  it("a seed born on top of an older one rests its piles on the older parts (generateBoxes)", () => {
    const old = seed({ id: 1, t0: 0, t1: 300, mass: 4 });
    const young = seed({ id: 2, t0: 420, t1: 480 });
    const all = generateBoxes([young, old]);
    const y0 = birthY(420);
    const bearing = all.filter((b) => b.seed === old.id && (b.kind === "mass" || b.kind === "slab" || b.kind === "plinth" || b.kind === "basement"));
    const piles = all.filter((b) => b.seed === young.id && b.kind === "pile");
    expect(piles.length).toBeGreaterThan(0);
    let landed = 0;
    for (const p of piles) {
      let below = 0;
      for (const b of bearing) {
        const top = b.y + b.sy / 2;
        if (top <= y0 + 1e-6 && Math.abs(p.x - b.x) <= b.sx / 2 && Math.abs(p.z - b.z) <= b.sz / 2) below = Math.max(below, top);
      }
      const bottom = p.y - p.sy / 2;
      if (y0 - below <= RECIPES.concrete.pile.depth[1] * DEFAULT_BOXES.unit) {
        expect(bottom).toBeCloseTo(below, 6);
        landed++;
      } else expect(bottom).toBeGreaterThan(below);
    }
    expect(landed).toBeGreaterThan(0);
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

  it("nothing at all — not even steel — in the slots between two gatherings", () => {
    const e = [...crowd(3, 0, 40), ...crowd(3, 1000, 40).map((x) => ({ ...x, id: "b" + x.id }))];
    const seeds = seedsFromSnapshot(foldWorld(e, 2000)).filter((s) => s.x === C / 2 && s.z === C / 2);
    const bs = generateBoxes(seeds);
    const spu = DEFAULT_BOXES.secPerUnit;
    const emptyFloor = (100 / spu + 1) * DEFAULT_BOXES.unit; // a slot after the first gathering, plus overhang
    const emptyCeil = Math.floor(1000 / spu) * DEFAULT_BOXES.unit; // floor of the slot the second gathering starts in
    expect(bs.length).toBeGreaterThan(0);
    expect(bs.filter((b) => b.y + halfHeight(b) > emptyFloor && b.y - halfHeight(b) < emptyCeil - 1e-6)).toHaveLength(0);
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
