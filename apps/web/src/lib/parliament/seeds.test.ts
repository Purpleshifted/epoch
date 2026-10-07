import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, FOUNDATION, MATERIAL_OF_ROLE, PART_KINDS, RECIPES, STEEL, boxesOfSeed, halfHeight, wearModel, wearParts, foldWorld, generateBoxes, occupiedSlots, seedsFromSnapshot, withoutWear, type Box, type PEvent, type Seed } from "./index";

const C = 1.2;
const stand = (o: string, x: number, z: number, s0: number, n: number): PEvent[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${o}:${s0}:${i}`, o, r: "worker" as const, k: "p" as const, x, z, s: s0 + i }));
const crowd = (n: number, s0: number, secs: number, gap = 0): PEvent[] => Array.from({ length: n }, (_, i) => stand(`w${i}`, C / 2, C / 2, s0 + i * gap, secs)).flat();

/** Masses as single boxes (slat bundles off): for tests about the masses themselves. */
const SOLID = { ...DEFAULT_BOXES, timeJitter: 0, recipe: { ...RECIPES.concrete, slat: { ...RECIPES.concrete.slat, enabled: false } } };
/** Default parts without the time error: for tests comparing two generations geometrically. */
const NOJIT = { ...DEFAULT_BOXES, timeJitter: 0 };

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
    const masses = (m: number) => boxesOfSeed(seed({ t0: 0, t1: 600, mass: m }), SOLID).filter((b) => b.kind === "mass");
    expect(masses(6).length).toBeGreaterThan(masses(1).length);
    expect(new Set(masses(6).map((b) => b.sx.toFixed(3))).size).toBeGreaterThan(5);
  });

  it("scale hierarchy: masses span an order of magnitude, few are huge and most are small", () => {
    const ms = boxesOfSeed(seed({ t0: 0, t1: 3000, mass: 4 }), SOLID).filter((b) => b.kind === "mass");
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
    expect(bs.filter((b) => b.kind === "mass").length).toBeLessThanOrEqual(50 * rc.mass.maxPerSlot * rc.slat.maxPerMass);
    expect(bs.length).toBeLessThanOrEqual(50 * (rc.mass.maxPerSlot * (rc.slat.maxPerMass + rc.drip.max) + 1 + rc.drip.max + rc.column.count[1] + 2));
  });
});

describe("seeds: slat bundles and drips", () => {
  const s = seed({ t0: 0, t1: 1500, mass: 4 });
  const contains = (o: Box, b: Box) =>
    b.x - b.sx / 2 >= o.x - o.sx / 2 - 1e-9 && b.x + b.sx / 2 <= o.x + o.sx / 2 + 1e-9 &&
    b.y - b.sy / 2 >= o.y - o.sy / 2 - 1e-9 && b.y + b.sy / 2 <= o.y + o.sy / 2 + 1e-9 &&
    b.z - b.sz / 2 >= o.z - o.sz / 2 - 1e-9 && b.z + b.sz / 2 <= o.z + o.sz / 2 + 1e-9;

  it("big masses become bundles of slats, each inside the mass it replaces, at most maxPerMass per mass", () => {
    const solid = boxesOfSeed(s, SOLID).filter((b) => b.kind === "mass");
    const slats = boxesOfSeed(s, NOJIT).filter((b) => b.kind === "mass");
    expect(slats.length).toBeGreaterThan(solid.length * 3);
    for (const b of slats) expect(solid.some((o) => contains(o, b))).toBe(true);
    expect(slats.length).toBeLessThanOrEqual(solid.length * RECIPES.concrete.slat.maxPerMass);
  });

  it("both bundle kinds occur: hanging sticks (tall, thin) and horizontal rows (long, flat)", () => {
    const slats = boxesOfSeed(s).filter((b) => b.kind === "mass");
    expect(slats.some((b) => b.sy > 3 * Math.max(b.sx, b.sz))).toBe(true);
    expect(slats.some((b) => Math.max(b.sx, b.sz) > 3 * b.sy)).toBe(true);
  });

  it("is deterministic", () => {
    expect(boxesOfSeed(s)).toEqual(boxesOfSeed(s));
  });

  it("drips hang under slabs and rows, and stay inside the run", () => {
    const drips = boxesOfSeed(s).filter((b) => b.kind === "drip");
    expect(drips.length).toBeGreaterThan(0);
    for (const d of drips) {
      expect(d.y - d.sy / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(d.sy).toBeLessThanOrEqual(RECIPES.concrete.drip.length[1] * DEFAULT_BOXES.unit + 1e-9);
    }
  });
});

describe("seeds: generation cache", () => {
  const seeds = [seed({ id: 1, t0: 0, t1: 300, mass: 3 }), seed({ id: 2, t0: 420, t1: 600, x: 1.8 })];

  it("a warm cache gives exactly what a fresh generation gives", () => {
    const cache = new Map();
    const cold = generateBoxes(seeds, DEFAULT_BOXES, cache);
    expect(cold).toEqual(generateBoxes(seeds));
    expect(generateBoxes(seeds, DEFAULT_BOXES, cache)).toEqual(cold);
  });

  it("a grown seed, a changed config or a vanished seed is not served stale", () => {
    const cache = new Map();
    generateBoxes(seeds, DEFAULT_BOXES, cache);
    const grown = [seeds[0], { ...seeds[1], t1: 900 }];
    expect(generateBoxes(grown, DEFAULT_BOXES, cache)).toEqual(generateBoxes(grown));
    const wide = { ...DEFAULT_BOXES, width: 1.5 };
    expect(generateBoxes(grown, wide, cache)).toEqual(generateBoxes(grown, wide));
    generateBoxes([seeds[0]], wide, cache);
    expect([...cache.keys()]).toEqual([1]);
  });
});

describe("seeds: recipe override (the 3D view's Leva knobs)", () => {
  const rc = RECIPES.concrete;
  const s = seed({ t0: 0, t1: 600, mass: 3 });
  const beams = (chance: number) => boxesOfSeed(s, { ...DEFAULT_BOXES, recipe: { ...rc, beam: { ...rc.beam, chance } } }).filter((b) => b.kind === "beam");

  it("beam chance 0 → no beams; 1 → a beam in every occupied slot", () => {
    expect(beams(0)).toHaveLength(0);
    expect(beams(1)).toHaveLength(occupiedSlots(s).length);
  });

  it("column count range is honoured (fractional Leva values are rounded)", () => {
    const cols = boxesOfSeed(s, { ...DEFAULT_BOXES, recipe: { ...rc, column: { ...rc.column, count: [0, 0.2] } } }).filter((b) => b.kind === "column");
    expect(cols).toHaveLength(0);
  });
});

describe("seeds: foundations", () => {
  const birthY = (t0: number) => Math.floor(t0 / DEFAULT_BOXES.secPerUnit) * DEFAULT_BOXES.unit;

  const rc = RECIPES.concrete;
  const piles = (s: Seed, cfg = DEFAULT_BOXES) => boxesOfSeed(s, cfg).filter((b) => b.kind === "pile");

  it("piles hang from the plinth with drawn lengths — nothing below is a support", () => {
    const s = seed({ t0: 900, t1: 960 });
    const y0 = birthY(900);
    const ps = piles(s);
    expect(ps.length).toBeGreaterThanOrEqual(rc.pile.count[0]);
    expect(ps.length).toBeLessThanOrEqual(rc.pile.count[1]);
    for (const p of ps) {
      expect(p.y + p.sy / 2).toBeCloseTo(y0, 9);
      expect(p.sy).toBeLessThanOrEqual(rc.pile.depth[1] * DEFAULT_BOXES.unit + 1e-9);
    }
    // an older seed right below changes nothing
    const alone = generateBoxes([s]).filter((b) => b.kind === "pile");
    const onTop = generateBoxes([s, seed({ id: 1, t0: 600, t1: 870, mass: 4 })]).filter((b) => b.kind === "pile" && b.seed === s.id);
    expect(onTop).toEqual(alone);
  });

  it("nothing reaches below y = 0 (before the epoch)", () => {
    for (const t0 of [0, 10, 31, 45, 70]) {
      for (const b of boxesOfSeed(seed({ id: 7 + t0, t0, t1: t0 + 60 }))) expect(b.y - halfHeight(b)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("pile count 0 → no piles", () => {
    expect(piles(seed({ t0: 900, t1: 960 }), { ...DEFAULT_BOXES, recipe: { ...rc, pile: { ...rc.pile, count: [0, 0] } } })).toHaveLength(0);
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

describe("wear: the fold's slab wear carried onto the parts", () => {
  const W = { tauSlabYears: DEFAULT_FOLD.tauSlabYears, tauFootprintYears: DEFAULT_FOLD.tauFootprintYears };
  const seeds = Array.from({ length: 12 }, (_, i) => seed({ id: 1000 + i, x: 0.6 + i * 6, t0: 0, t1: 300, mass: 3 }));
  const parts = generateBoxes(seeds);
  const at = (tNow: number) => wearParts(parts, seeds, tNow, W);
  const key = (b: Box) => `${b.kind}:${b.seed}:${b.x.toFixed(4)}:${(b.y + b.sy / 2).toFixed(4)}:${b.z.toFixed(4)}`;
  const share = (list: Box[], pred: (b: Box) => boolean) => list.filter(pred).length / parts.filter(pred).length;

  it("at the last presence nothing is worn", () => {
    expect(at(300)).toEqual(parts);
  });

  it("monotone: what has gone stays gone", () => {
    const t1 = new Set(at(320).map(key));
    for (const b of at(340)) if (b.kind !== "drip") expect(t1.has(key(b))).toBe(true);
  });

  it("thin and exposed goes first: steel before masses, masses before slabs", () => {
    const w = at(320);
    const steel = share(w, (b) => STEEL.has(b.kind));
    const mass = share(w, (b) => b.kind === "mass");
    const slab = share(w, (b) => b.kind === "slab");
    expect(steel).toBeLessThan(mass);
    expect(mass).toBeLessThan(slab);
  });

  it("foundations outlast the rest", () => {
    const w = at(600);
    expect(share(w, (b) => b.kind === "plinth")).toBeGreaterThan(share(w, (b) => b.kind === "mass") + 0.3);
  });

  it("columns fall with their slab", () => {
    const w = at(330);
    const slabs = new Set(w.filter((b) => b.kind === "slab").map((b) => `${b.seed}:${b.along}`));
    for (const c of w.filter((b) => b.kind === "column")) expect(slabs.has(`${c.seed}:${c.along}`)).toBe(true);
  });

  it("drips grow with age but never below their run", () => {
    const young = parts.filter((b) => b.kind === "drip");
    const old = at(310).filter((b) => b.kind === "drip");
    expect(old.length).toBeGreaterThan(0);
    for (const d of old) {
      expect(d.y - d.sy / 2).toBeGreaterThanOrEqual((d.floorY ?? 0) - 1e-9);
      const was = young.find((y) => y.seed === d.seed && Math.abs(y.x - d.x) < 1e-9 && Math.abs(y.z - d.z) < 1e-9)!;
      expect(d.sy).toBeGreaterThanOrEqual(was.sy - 1e-9);
    }
    expect(old.some((d) => d.sy > (young.find((y) => y.seed === d.seed && Math.abs(y.x - d.x) < 1e-9 && Math.abs(y.z - d.z) < 1e-9)!.sy) + 1e-6)).toBe(true);
  });

  it("once the footprint is worn only plinth and basement remain", () => {
    const kinds = new Set(at(3000).map((b) => b.kind));
    expect(kinds.has("plinth")).toBe(true);
    for (const k of kinds) expect(["plinth", "basement"]).toContain(k); // born at t = 0: no room for a basement here
  });

  it("does not change its (cached) input", () => {
    const copy = JSON.stringify(parts);
    at(400);
    expect(JSON.stringify(parts)).toBe(copy);
  });
});

describe("strata: every layer ages from its own slot", () => {
  const spu = DEFAULT_BOXES.secPerUnit;
  const live = seed({ id: 4242, t0: 0, t1: 3000, mass: 4 }); // still in use at tNow = 3000
  const parts = boxesOfSeed(live);
  const W = { tauSlabYears: DEFAULT_FOLD.tauSlabYears, tauFootprintYears: DEFAULT_FOLD.tauFootprintYears, secPerUnit: spu, timeScale: 0.02 };
  const share = (list: Box[], pred: (b: Box) => boolean) => list.filter(pred).length / Math.max(1, parts.filter(pred).length);

  it("a seed still in use is worn at its bottom and fresh at its top", () => {
    const w = wearParts(parts, [live], 3000, W);
    const low = (b: Box) => b.kind === "mass" && b.slot < 30;
    const high = (b: Box) => b.kind === "mass" && b.slot >= 90;
    expect(share(w, low)).toBeLessThan(share(w, high));
    expect(share(w, high)).toBeGreaterThan(0.75); // thin slats near the top are already a little worn
    // without strata the whole seed is as new as its last presence
    expect(wearParts(parts, [live], 3000, { ...W, secPerUnit: undefined })).toEqual(parts);
  });

  it("the steel / concrete lives decide which goes first", () => {
    const steelLasts = wearParts(parts, [live], 3000, { ...W, steelLife: 3, concreteLife: 0.5 });
    const isSteel = (b: Box) => STEEL.has(b.kind) && b.slot < 60;
    const isMass = (b: Box) => b.kind === "mass" && b.slot < 60;
    expect(share(steelLasts, isSteel)).toBeGreaterThan(share(steelLasts, isMass));
    const steelGoes = wearParts(parts, [live], 3000, { ...W, steelLife: 0.1, concreteLife: 2 });
    expect(share(steelGoes, isSteel)).toBeLessThan(share(steelGoes, isMass));
  });
});

describe("burial and vegetation change how fast a layer weathers", () => {
  const spu = DEFAULT_BOXES.secPerUnit;
  const tall = seed({ id: 777, t0: 0, t1: 3000, mass: 4 }); // built on for 100 slots: its low layers are covered
  const parts = boxesOfSeed(tall);
  const base = { tauSlabYears: DEFAULT_FOLD.tauSlabYears, tauFootprintYears: DEFAULT_FOLD.tauFootprintYears, secPerUnit: spu, timeScale: 0.02 };
  const lowMass = (b: Box) => b.kind === "mass" && b.slot < 40;
  const count = (list: Box[]) => list.filter(lowMass).length;

  it("covered layers wear much more slowly", () => {
    const open = wearParts(parts, [tall], 3000, base);
    const covered = wearParts(parts, [tall], 3000, { ...base, coverSlots: 2, buriedSlow: 50 });
    expect(count(covered)).toBeGreaterThan(count(open));
  });

  it("vegetation around a part makes it wear faster while exposed", () => {
    const bare = wearParts(parts, [tall], 3000, { ...base, natureAccel: 2, veg: () => 0 });
    const green = wearParts(parts, [tall], 3000, { ...base, natureAccel: 2, veg: () => 1 });
    expect(count(green)).toBeLessThan(count(bare));
    expect(bare).toEqual(wearParts(parts, [tall], 3000, base));
  });
});

describe("error margins: layers are not cut to the second, nor weathered in lockstep", () => {
  const s = seed({ id: 31, t0: 0, t1: 900, mass: 4 });
  it("parts are spread along the time axis, still inside their run and never above their own slot", () => {
    const parts = boxesOfSeed(s);
    const flat = boxesOfSeed(s, NOJIT);
    const moved = parts.filter((b, i) => Math.abs(b.y - flat[i].y) > 1e-6);
    expect(moved.length).toBeGreaterThan(parts.length / 3);
    for (const b of parts.filter((b) => !FOUNDATION.has(b.kind))) expect(b.y + halfHeight(b)).toBeLessThanOrEqual((b.slot + 1) * DEFAULT_BOXES.unit + 1e-9);
  });

  it("parts of the same layer age differently", () => {
    const parts = boxesOfSeed(s, NOJIT).filter((b) => b.kind === "mass" && b.slot === 10);
    const W = { tauSlabYears: DEFAULT_FOLD.tauSlabYears, tauFootprintYears: DEFAULT_FOLD.tauFootprintYears, secPerUnit: DEFAULT_BOXES.secPerUnit, timeScale: 0.05 };
    const even = wearModel([s], 3000, W);
    const jit = wearModel([s], 3000, { ...W, ageJitter: 0.5 });
    expect(new Set(parts.map((b) => even.age(b).toFixed(6))).size).toBe(1);
    expect(new Set(parts.map((b) => jit.age(b).toFixed(6))).size).toBeGreaterThan(1);
    for (const b of parts) expect(Math.abs(jit.age(b) / even.age(b) - 1)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});
