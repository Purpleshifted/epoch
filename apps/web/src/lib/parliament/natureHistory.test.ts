import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FOLD, DEFAULT_NATURE, NATURE_KIND, baseGrass, burialOf, generateBoxes, reclaimPoints, reclaimShare, sedimentShare, wearParts, foldWorld, grassDensity, natureAt, natureHistory, naturePointLoad, naturePoints, pathAt, seedsFromSnapshot, stressMap, withoutWear, type PEvent } from "./index";

const SPU = 30;
/** Visitor `o` standing at (x, z) from s0 for `secs` seconds (one sample per second, a little off the slot grid). */
const stand = (o: string, x: number, z: number, s0: number, secs: number): PEvent[] =>
  Array.from({ length: secs }, (_, i) => ({ id: `${o}:${s0}:${i}`, o, r: "worker" as const, k: "p" as const, x, z, s: s0 + i + 0.37 }));

const run = (events: PEvent[], k0: number, k1: number, margin = 6, seeds = seedsFromSnapshot(foldWorld(events, 1e9, withoutWear(DEFAULT_FOLD)))) =>
  natureHistory({ events, seeds, secPerUnit: SPU, k0, k1, margin, nature: DEFAULT_NATURE, fold: DEFAULT_FOLD });

const cellOf = (v: number) => Math.floor(v / CELL_SIZE);

describe("natureHistory: vegetation per cell and time slot", () => {
  const lone = stand("a", 0.6, 0.6, 60, 60); // slots 2–4

  it("is deterministic", () => {
    expect(run(lone, 0, 20)).toEqual(run(lone, 0, 20));
  });

  it("cells nobody came near keep their base density", () => {
    const h = run(lone, 0, 10, 8);
    const far = [h.x0, h.z0]; // a corner of the extent, 8 cells away
    for (let k = 0; k <= 10; k++) expect(natureAt(h, far[0], far[1], k)).toBeCloseTo(baseGrass(far[0], far[1]), 6); // Float32
  });

  it("lingering wears it down in those slots, and it recovers afterwards", () => {
    const h = run(lone, 0, 30);
    const c = [cellOf(0.6), cellOf(0.6)] as const;
    const before = natureAt(h, c[0], c[1], 1)!;
    const during = natureAt(h, c[0], c[1], 4)!;
    const later = natureAt(h, c[0], c[1], 30)!;
    expect(during).toBeLessThan(before * 0.6);
    expect(later).toBeGreaterThan(during);
  });

  it("the carried stress equals stressMap at the slot's start and end", () => {
    const k = 3;
    const h = run(lone, k, k);
    const c = [cellOf(0.6), cellOf(0.6)] as const;
    const key = `${c[0]},${c[1]}`;
    const path = foldWorld(lone, (k + 1) * SPU, DEFAULT_FOLD).paths.find((p) => p.key === key)?.p ?? 0;
    const g = (t: number) => grassDensity(c[0], c[1], stressMap(lone, t, DEFAULT_NATURE).get(key) ?? 0, path, false, DEFAULT_NATURE);
    expect(natureAt(h, c[0], c[1], k)).toBeCloseTo((g(k * SPU) + g((k + 1) * SPU)) / 2, 6);
  });

  it("a slab seals its cell (≤ sealedLeft · base) while it stands — also after the crowd has gone", () => {
    const crowd = [...stand("a", 0.6, 0.6, 0, 90), ...stand("b", 0.6, 0.6, 0, 90), ...stand("c", 0.6, 0.6, 0, 90)];
    const seeds = seedsFromSnapshot(foldWorld(crowd, 1e9, withoutWear(DEFAULT_FOLD)));
    const slab = seeds.find((s) => cellOf(s.x) === 0 && cellOf(s.z) === 0)!;
    expect(slab).toBeDefined();
    // slot 7 (210–240 s): the crowd left at 90 s, the stress has mostly faded, the slab (worn ~e^-1) still stands
    const k = 7;
    const sealedV = natureAt(run(crowd, 0, 8, 6, seeds), 0, 0, k)!;
    const openV = natureAt(run(crowd, 0, 8, 6, []), 0, 0, k)!;
    expect(sealedV).toBeLessThanOrEqual(DEFAULT_NATURE.sealedLeft * baseGrass(0, 0) + 1e-6);
    expect(openV).toBeGreaterThan(DEFAULT_NATURE.sealedLeft * baseGrass(0, 0) * 2);
  });

  it("an empty log or an empty slot range gives nothing", () => {
    expect(run([], 0, 10).V.length).toBe(0);
    expect(run(lone, 5, 4).V.length).toBe(0);
  });
});

describe("naturePoints: the point cloud of a slot range", () => {
  const h = run(stand("a", 0.6, 0.6, 60, 60), 0, 12);
  const opts = { unit: 1, perSlot: 6 };

  it("is deterministic, and every point lies in its cell × slot box", () => {
    const pts = naturePoints(h, 0, 12, opts);
    expect(naturePoints(h, 0, 12, opts)).toEqual(pts);
    expect(pts.count).toBeGreaterThan(0);
    for (let i = 0; i < pts.count; i++) {
      const y = pts.position[i * 3 + 1];
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(13 * opts.unit);
    }
  });

  it("the count follows V · perSlot (the budget estimate is close)", () => {
    const pts = naturePoints(h, 0, 12, opts);
    const load = naturePointLoad(h, 0, 12, opts.perSlot);
    expect(Math.abs(pts.count - load) / load).toBeLessThan(0.05);
  });

  it("chunks add up to the whole", () => {
    const whole = naturePoints(h, 0, 12, opts).count;
    expect(naturePoints(h, 0, 5, opts).count + naturePoints(h, 6, 12, opts).count).toBe(whole);
  });
});

describe("reclaim and burial", () => {
  const W = { tauSlabYears: DEFAULT_FOLD.tauSlabYears, tauFootprintYears: DEFAULT_FOLD.tauFootprintYears };
  const seeds = Array.from({ length: 6 }, (_, i) => ({ id: 500 + i, material: "concrete" as const, role: "worker" as const, x: 0.6 + i * 6, z: 0.6, t0: 300, t1: 600, mass: 3 }));
  const built = generateBoxes(seeds);
  const cfg = { tauReclaimYears: 300, perArea: 10, unit: 1 };

  it("nothing grows on a ruin that was just left", () => {
    expect(reclaimPoints(built, built, seeds, 600, cfg).count).toBe(0);
  });

  it("the longer abandoned, the more overgrown (standing parts only)", () => {
    const a = reclaimPoints(built, built, seeds, 605, cfg).count;
    const b = reclaimPoints(built, built, seeds, 640, cfg).count;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it("plants sit on top faces, and succession moves from moss to woody growth", () => {
    const young = reclaimPoints(built, built, seeds, 603, cfg);
    const old = reclaimPoints(built, built, seeds, 900, cfg);
    const share = (p: ReturnType<typeof reclaimPoints>, k: number) => p.kind.filter((x) => x === k).length / Math.max(1, p.count);
    expect(share(young, NATURE_KIND.moss)).toBeGreaterThan(0.9);
    expect(share(old, NATURE_KIND.woody)).toBeGreaterThan(0.2);
    expect(reclaimShare(1e9, 300)).toBeCloseTo(1, 9);
  });

  it("eroded parts leave gaps where things grow", () => {
    const worn = wearParts(built, seeds, 640, W);
    const withGaps = reclaimPoints(built, worn, seeds, 640, cfg);
    expect(withGaps.count).toBeGreaterThan(0);
  });

  it("burial marks only the slots just below a birth, under its footprint", () => {
    const buried = burialOf(seeds, SPU, 3);
    const b = Math.floor(300 / SPU); // birth slot 10
    expect(buried(0, 0, b - 1)).toBe(true);
    expect(buried(0, 0, b - 3)).toBe(true);
    expect(buried(0, 0, b - 4)).toBe(false);
    expect(buried(0, 0, b)).toBe(false);
    expect(buried(3, 0, b - 1)).toBe(false); // between seeds (cells 0 and 5)
    const h = run(stand("a", 0.6, 0.6, 200, 20), 0, 12);
    const pts = naturePoints(h, 0, 12, { unit: 1, perSlot: 6, buried });
    for (let i = 0; i < pts.count; i++) {
      if (pts.kind[i] !== NATURE_KIND.buried) continue;
      const k = Math.floor(pts.position[i * 3 + 1]);
      expect(k).toBeGreaterThanOrEqual(b - 3);
      expect(k).toBeLessThan(b);
    }
    expect(pts.kind.some((k) => k === NATURE_KIND.buried)).toBe(true);
  });
});

describe("sediment: old vegetation turns to humus and peat, and compacts", () => {
  const sed = { tNow: 3000, secPerUnit: SPU, timeScale: 0.02, tauYears: 600 };
  it("older slots are more sediment than recent ones", () => {
    expect(sedimentShare(5, sed)).toBeGreaterThan(sedimentShare(90, sed));
    expect(sedimentShare(99, sed)).toBeLessThan(0.05);
  });
  it("points of old slots are mostly humus/peat and sit lower in their slot", () => {
    const events = stand("a", 30, 30, 2950, 40); // far from the cells we look at: no stress there
    const h = natureHistory({ events, seeds: [], secPerUnit: SPU, k0: 0, k1: 99, margin: 30, nature: DEFAULT_NATURE, fold: DEFAULT_FOLD });
    const pts = naturePoints(h, 0, 99, { unit: 1, perSlot: 4, sediment: sed });
    const stats = (lo: number, hi: number) => {
      let n = 0, sedN = 0, y = 0;
      for (let i = 0; i < pts.count; i++) {
        const py = pts.position[i * 3 + 1];
        const k = Math.floor(py);
        if (k < lo || k > hi) continue;
        n++;
        y += py - k;
        if (pts.kind[i] === NATURE_KIND.humus || pts.kind[i] === NATURE_KIND.peat) sedN++;
      }
      return { sed: sedN / n, y: y / n };
    };
    const old = stats(0, 10);
    const young = stats(90, 99);
    expect(old.sed).toBeGreaterThan(0.5);
    expect(young.sed).toBeLessThan(0.1);
    expect(old.y).toBeLessThan(young.y);
  });
});

describe("vegetation points have no bands at the slot floors", () => {
  it("points fill their slot evenly (no pile-up at the floor) and spill over it with the time error", () => {
    const h = run(stand("a", 30, 30, 0, 5), 0, 20, 30); // a far visitor: these cells are untouched
    const pts = naturePoints(h, 0, 20, { unit: 1, perSlot: 6, timeJitter: 0.35 });
    const frac: number[] = [];
    for (let i = 0; i < pts.count; i++) frac.push(pts.position[i * 3 + 1] % 1);
    const low = frac.filter((f) => f < 0.25).length / frac.length;
    expect(low).toBeLessThan(0.35); // was ~0.75 when points settled at the floor
    expect(low).toBeGreaterThan(0.15);
  });
});

describe("paths: holes in the vegetation with a heaped rim", () => {
  // three walkers crossing x = 0.6 … 4.2 along z = 0.6, back and forth: the row of cells z = 0 becomes a path
  const walk: PEvent[] = [];
  for (const o of ["a", "b", "c"]) {
    for (let i = 0; i < 120; i++) {
      const t = i % 8 < 4 ? i % 8 : 8 - (i % 8);
      walk.push({ id: `${o}:w${i}`, o, r: "worker", k: "p", x: 0.6 + t * 1.2, z: 0.6, s: i + 0.37 + (o === "b" ? 0.1 : o === "c" ? 0.2 : 0) });
    }
  }
  const h = run(walk, 0, 5, 6, []);

  it("the path field is strongest on the walked row", () => {
    expect(pathAt(h, 2.4, 0.6, 3)).toBeGreaterThan(pathAt(h, 2.4, 4.2, 3) + 0.2);
  });

  it("no vegetation on the path, low soil heaped beside it", () => {
    const opts = { unit: 1, perSlot: 12, paths: { hole: 0.3, berm: 2 } };
    const pts = naturePoints(h, 3, 4, opts);
    for (let i = 0; i < pts.count; i++) {
      const [x, y, z] = [pts.position[i * 3], pts.position[i * 3 + 1], pts.position[i * 3 + 2]];
      expect(pathAt(h, x, z, Math.floor(y))).toBeLessThan(0.3 + 0.15); // (jittered rim points may lean in a little)
    }
    const plain = naturePoints(h, 3, 4, { unit: 1, perSlot: 12 });
    const trodden = (p: typeof pts) => p.kind.filter((k) => k === NATURE_KIND.trodden).length;
    expect(trodden(pts)).toBeGreaterThan(0);
    expect(trodden(plain)).toBe(0);
  });
});

describe("wetland: vegetation along waterways", () => {
  it("only cells near water get wetland points, more the nearer", () => {
    const h = run(stand("a", 30, 30, 0, 5), 0, 3, 30);
    const wet = (ix: number) => (ix === h.x0 + 2 ? 0.9 : ix === h.x0 + 3 ? 0.3 : 0);
    const pts = naturePoints(h, 0, 3, { unit: 1, perSlot: 12, wet: (ix) => wet(ix) });
    const by = new Map<number, [number, number]>();
    for (let i = 0; i < pts.count; i++) {
      const ix = Math.floor(pts.position[i * 3] / CELL_SIZE);
      const [n, w] = by.get(ix) ?? [0, 0];
      by.set(ix, [n + 1, w + (pts.kind[i] === NATURE_KIND.wet ? 1 : 0)]);
    }
    const share = (ix: number) => { const [n, w] = by.get(ix) ?? [1, 0]; return w / n; };
    expect(share(h.x0 + 2)).toBeGreaterThan(0.6);
    expect(share(h.x0 + 3)).toBeLessThan(share(h.x0 + 2));
    expect(share(h.x0 + 3)).toBeGreaterThan(0);
    expect(share(h.x0 + 6)).toBe(0);
  });
});
