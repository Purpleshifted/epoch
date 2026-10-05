import { describe, expect, it } from "vitest";
import {
  CATALOGUE,
  CATALOGUE_TOTAL_PERCENT,
  MATERIALS,
  BURIED_DECAY_FACTOR,
  burialTime,
  coverNeeded,
  depthOfYears,
  fateOf,
  geoYears,
  hash01,
  isLagerstatte,
  lifetimeYears,
  mulberry32,
  sampleEntry,
  type Deposit,
  type MaterialId,
  type Stage,
} from "./index";

const EXHIBITION_END = 8 * 3600;
const ids = (n: number, prefix = "item") => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
const dep = (id: string, material: MaterialId, depositedAt = 0): Deposit => ({ id, material, depositedAt });

describe("hash01", () => {
  it("is deterministic and within [0,1)", () => {
    expect(hash01("a", "x")).toBe(hash01("a", "x"));
    expect(hash01("a", "x")).not.toBe(hash01("a", "y"));
    for (const id of ids(2000)) {
      const u = hash01(id, "t");
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
  it("is roughly uniform", () => {
    const mean = ids(20000).reduce((s, id) => s + hash01(id, "u"), 0) / 20000;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });
});

describe("catalogue (JRC 2016, Annex II Table A1)", () => {
  it("has 50 unique ranks and codes", () => {
    expect(CATALOGUE).toHaveLength(50);
    expect(CATALOGUE.map((c) => c.rank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(CATALOGUE.map((c) => c.code)).size).toBe(50);
  });
  it("percentages are descending and every material is defined", () => {
    for (let i = 1; i < CATALOGUE.length; i++) {
      expect(CATALOGUE[i].percent).toBeLessThanOrEqual(CATALOGUE[i - 1].percent);
    }
    for (const c of CATALOGUE) expect(MATERIALS[c.material]).toBeDefined();
  });
  it("sums to ~93 % and the top ten to ~68 % (the report's text says 63 %, its table 68 %)", () => {
    expect(CATALOGUE_TOTAL_PERCENT).toBeCloseTo(93.05, 1);
    const top10 = CATALOGUE.slice(0, 10).reduce((s, c) => s + c.percent, 0);
    expect(top10).toBeCloseTo(68.09, 1);
  });
  it("plastic-like items are ~84 % of the catalogue weight, as the JRC reports for all items", () => {
    const plasticLike = (m: MaterialId) => m.startsWith("plastic_") || m === "acetate_filter";
    const share = CATALOGUE.filter((c) => plasticLike(c.material)).reduce((s, c) => s + c.percent, 0) / CATALOGUE_TOTAL_PERCENT;
    expect(share).toBeGreaterThan(0.8);
    expect(share).toBeLessThan(0.88);
  });
});

describe("sampleEntry", () => {
  it("covers both ends of the range", () => {
    expect(sampleEntry(0).rank).toBe(1);
    expect(sampleEntry(0.999999999).rank).toBe(50);
  });
  it("reproduces catalogue frequencies", () => {
    const rnd = mulberry32(42);
    const N = 100_000;
    const counts = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const r = sampleEntry(rnd()).rank;
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const expected1 = CATALOGUE[0].percent / CATALOGUE_TOTAL_PERCENT;
    expect((counts.get(1) ?? 0) / N).toBeGreaterThan(expected1 - 0.006);
    expect((counts.get(1) ?? 0) / N).toBeLessThan(expected1 + 0.006);
    expect(counts.size).toBeGreaterThan(45);
  });
});

describe("geoClock", () => {
  it("starts at 0, is monotonic, and ends at maxYears", () => {
    expect(geoYears(0)).toBe(0);
    let prev = -1;
    for (const t of [0, 1, 10, 100, 1000, 10_000, EXHIBITION_END]) {
      const y = geoYears(t);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    expect(geoYears(EXHIBITION_END)).toBeGreaterThan(0.99e6);
    expect(geoYears(EXHIBITION_END)).toBeLessThan(1.01e6);
  });
  it("matches the documented anchor points", () => {
    expect(geoYears(10)).toBeGreaterThan(15);
    expect(geoYears(10)).toBeLessThan(35);
    expect(geoYears(100)).toBeGreaterThan(400);
    expect(geoYears(100)).toBeLessThan(600);
  });
  it("depth is log10(1+years)", () => {
    expect(depthOfYears(0)).toBe(0);
    expect(depthOfYears(999)).toBeCloseTo(3, 5);
  });
});

describe("lifetimeYears", () => {
  it("stays inside the material's persistence range", () => {
    for (const m of Object.keys(MATERIALS) as MaterialId[]) {
      const [lo, hi] = MATERIALS[m].persistenceYears;
      for (const id of ids(300, m)) {
        const L = lifetimeYears(dep(id, m));
        expect(L).toBeGreaterThanOrEqual(lo);
        expect(L).toBeLessThanOrEqual(hi * 1.0000001);
      }
    }
  });
});

describe("burial", () => {
  it("needs at least one later deposit, mean ~3.5", () => {
    const needed = ids(20000).map((id) => coverNeeded(id));
    expect(Math.min(...needed)).toBeGreaterThanOrEqual(1);
    const mean = needed.reduce((s, n) => s + n, 0) / needed.length;
    expect(mean).toBeGreaterThan(3.2);
    expect(mean).toBeLessThan(3.9);
  });
  it("burialTime is null until enough later deposits exist, then the n-th one", () => {
    const id = "probe";
    const n = coverNeeded(id);
    const later = Array.from({ length: n + 2 }, (_, i) => 10 + i * 5);
    expect(burialTime(id, later.slice(0, n - 1))).toBeNull();
    expect(burialTime(id, later)).toBe(later[n - 1]);
  });
});

describe("lagerstatte", () => {
  it("is rare (~2 % per cell-period) and deterministic", () => {
    const N = 20000;
    let hits = 0;
    for (let i = 0; i < N; i++) if (isLagerstatte(`cell_${i}`, 0)) hits++;
    expect(hits / N).toBeGreaterThan(0.015);
    expect(hits / N).toBeLessThan(0.025);
    expect(isLagerstatte("c", 5)).toBe(isLagerstatte("c", 5));
  });
});

describe("fateOf — exposed items", () => {
  it("is deterministic", () => {
    const d = dep("same", "plastic_rigid");
    const ctx = { now: 500, buriedAt: null };
    expect(fateOf(d, ctx)).toEqual(fateOf(d, ctx));
  });

  it("paper is gone long before glass: rank order of persistence", () => {
    const now = 120; // ~630 simulated years
    const paper = ids(200, "p").map((id) => fateOf(dep(id, "paper"), { now, buriedAt: null }));
    const glass = ids(200, "g").map((id) => fateOf(dep(id, "glass"), { now, buriedAt: null }));
    expect(paper.every((f) => f.stage === "vanished")).toBe(true);
    expect(glass.every((f) => f.stage !== "vanished")).toBe(true);
  });

  it("never fossilises without burial, even for glass at the end of the run", () => {
    const fates = ids(500, "g").map((id) => fateOf(dep(id, "glass"), { now: EXHIBITION_END, buriedAt: null }));
    expect(fates.some((f) => f.permanent)).toBe(false);
  });

  it("decay never goes backwards and stages only progress", () => {
    const order: Stage[] = ["fresh", "weathered", "fragmented", "vanished"];
    for (const id of ids(100, "mono")) {
      const d = dep(id, "plastic_film");
      let prevDecay = -1;
      let prevIdx = 0;
      for (const now of [0, 1, 3, 10, 30, 100, 300, 1000, 5000, EXHIBITION_END]) {
        const f = fateOf(d, { now, buriedAt: null });
        expect(f.decay).toBeGreaterThanOrEqual(prevDecay);
        const idx = order.indexOf(f.stage);
        expect(idx).toBeGreaterThanOrEqual(prevIdx);
        prevDecay = f.decay;
        prevIdx = idx;
      }
    }
  });
});

describe("fateOf — burial and fossilisation", () => {
  it("buried glass becomes permanent at about its fossilPotential", () => {
    const N = 3000;
    const fates = ids(N, "g").map((id) => fateOf(dep(id, "glass"), { now: EXHIBITION_END, buriedAt: 1 }));
    const frac = fates.filter((f) => f.permanent).length / N;
    expect(frac).toBeGreaterThan(MATERIALS.glass.fossilPotential - 0.04);
    expect(frac).toBeLessThan(MATERIALS.glass.fossilPotential + 0.04);
    expect(fates.filter((f) => f.permanent).every((f) => f.stage === "fossil")).toBe(true);
  });

  it("buried paper almost never survives, unless a Lagerstatte preserves it", () => {
    const N = 3000;
    const plain = ids(N, "pp").map((id) => fateOf(dep(id, "paper"), { now: EXHIBITION_END, buriedAt: 1 }));
    expect(plain.filter((f) => f.permanent).length / N).toBeLessThan(0.05);
    const saved = ids(200, "pl").map((id) =>
      fateOf(dep(id, "paper"), { now: EXHIBITION_END, buriedAt: 1, lagerstatte: true }),
    );
    expect(saved.every((f) => f.permanent && f.stage === "fossil")).toBe(true);
  });

  it("burial slows decay", () => {
    const d = dep("slow", "plastic_rigid");
    const now = 600;
    const open = fateOf(d, { now, buriedAt: null });
    const buried = fateOf(d, { now, buriedAt: 1 });
    expect(buried.buried).toBe(true);
    expect(buried.decay).toBeLessThan(open.decay);
    expect(BURIED_DECAY_FACTOR).toBeLessThan(1);
  });

  it("a future burial time does not bury yet", () => {
    const f = fateOf(dep("later", "glass"), { now: 10, buriedAt: 500 });
    expect(f.buried).toBe(false);
  });

  it("burial alone is not fossilisation: young buried items are just 'buried'", () => {
    const f = fateOf(dep("young", "glass"), { now: 2, buriedAt: 1 });
    expect(f.stage).toBe("buried");
    expect(f.permanent).toBe(false);
  });
});
