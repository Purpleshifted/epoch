import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  CATALOGUE,
  CATALOGUE_TOTAL_PERCENT,
  MATERIALS,
  MATERIAL_PALETTE_INDEX,
  PALETTE_HEX,
  cellKey,
  dimIndex,
  fieldWeights,
  localSurvivors,
  makeDeposit,
  mulberry32,
  resolveField,
  sampleEntry,
  sampleFromField,
  type DepositRecord,
} from "./index";

const rec = (id: string, t: number, x = 0, z = 0, material: DepositRecord["material"] = "glass"): DepositRecord =>
  ({ id, rank: 1, material, x, y: 0, z, t, owner: "o" });

describe("field", () => {
  it("cellKey groups points within one CELL_SIZE square", () => {
    expect(cellKey(0.1, 0.1)).toBe(cellKey(CELL_SIZE - 0.01, CELL_SIZE - 0.01));
    expect(cellKey(0.1, 0.1)).not.toBe(cellKey(CELL_SIZE + 0.01, 0.1));
    expect(cellKey(-0.1, 0)).not.toBe(cellKey(0.1, 0));
  });

  it("makeDeposit follows the catalogue and never lets the caller pick a material", () => {
    const d = makeDeposit({ id: "a", u: 0, x: 0, y: 0, z: 0, t: 0, owner: "o" });
    expect(d.rank).toBe(1);
    expect(d.material).toBe(CATALOGUE[0].material);
  });

  it("records from the future are not resolved yet", () => {
    expect(resolveField([rec("a", 100)], 50)).toHaveLength(0);
    expect(resolveField([rec("a", 100)], 100)).toHaveLength(1);
  });

  it("an item alone on its cell is never buried", () => {
    const [r] = resolveField([rec("a", 0)], 3600);
    expect(r.buriedAt).toBeNull();
    expect(r.fate.buried).toBe(false);
  });

  it("many later deposits on the same cell bury it, nothing on another cell does", () => {
    const base = rec("victim", 0);
    const same = Array.from({ length: 60 }, (_, i) => rec(`s${i}`, 10 + i));
    const other = Array.from({ length: 60 }, (_, i) => rec(`o${i}`, 10 + i, 50, 50));
    const buried = resolveField([base, ...same], 600).find(r => r.rec.id === "victim")!;
    const free = resolveField([base, ...other], 600).find(r => r.rec.id === "victim")!;
    expect(buried.fate.buried).toBe(true);
    expect(free.fate.buried).toBe(false);
  });

  it("is deterministic and independent of input order", () => {
    const rs = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, i * 3, (i % 3) * 0.2, 0, i % 2 ? "glass" : "paper"));
    const a = resolveField(rs, 900).map(r => `${r.rec.id}:${r.fate.stage}`).sort();
    const b = resolveField([...rs].reverse(), 900).map(r => `${r.rec.id}:${r.fate.stage}`).sort();
    expect(a).toEqual(b);
  });

  it("a crowd buries more than a lone visitor would: buried share grows with density", () => {
    const share = (n: number) => {
      const rs = Array.from({ length: n }, (_, i) => rec(`d${i}`, i, 0, 0, "plastic_rigid"));
      const out = resolveField(rs, n + 5);
      return out.filter(r => r.fate.buried).length / out.length;
    };
    expect(share(40)).toBeGreaterThan(share(4));
  });
});

describe("palette", () => {
  it("has 16 distinct colours and a mapping for every material", () => {
    expect(PALETTE_HEX).toHaveLength(16);
    expect(new Set(PALETTE_HEX).size).toBe(16);
    for (const id of Object.keys(MATERIALS)) {
      const i = MATERIAL_PALETTE_INDEX[id as keyof typeof MATERIAL_PALETTE_INDEX];
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(16);
    }
  });
  it("dimIndex stays inside the palette and never brightens", () => {
    for (let i = 0; i < 16; i++) {
      const d = dimIndex(i);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(16);
    }
    expect(dimIndex(15)).toBe(7);
    expect(dimIndex(11)).toBe(3);
  });
});

describe("inheritance (Pólya urn with prior pseudo-count)", () => {
  const prior = (rank: number) => CATALOGUE[rank - 1].percent / CATALOGUE_TOTAL_PERCENT;
  const share = (w: number[], rank: number) => w[rank - 1] / w.reduce((a, b) => a + b, 0);

  it("with nothing on the ground the weights are exactly the catalogue prior", () => {
    const w = fieldWeights(new Map(), 20);
    for (const c of CATALOGUE) expect(share(w, c.rank)).toBeCloseTo(prior(c.rank), 12);
  });

  it("the ground's weight is n / (n + k): n = k gives (prior + 1) / 2 for the only survivor type", () => {
    const k = 20;
    const w = fieldWeights(new Map([[7, k]]), k);
    expect(share(w, 7)).toBeCloseTo((prior(7) + 1) / 2, 12);
  });

  it("k = 0 draws only what is on the ground; large k hardly moves from the prior", () => {
    const only = new Map([[5, 3]]);
    for (let i = 0; i < 50; i++) expect(sampleFromField(i / 50, only, 0).rank).toBe(5);
    const w = fieldWeights(only, 1e6);
    expect(share(w, 5)).toBeCloseTo(prior(5), 4);
  });

  it("an empty ground draws like the plain catalogue", () => {
    const rnd = mulberry32(42);
    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const u = rnd();
      if (sampleFromField(u, new Map(), 20).rank !== sampleEntry(u).rank) mismatches++;
    }
    expect(mismatches).toBeLessThanOrEqual(1); // float rounding on a boundary only
  });

  it("localSurvivors ignores vanished items and items outside the radius", () => {
    // rank 23 is paper (gone after ~100 simulated years); rank 1 is a plastic fragment.
    const rs: DepositRecord[] = [];
    for (let i = 0; i < 100; i++) {
      rs.push({ id: `p${i}`, rank: 23, material: "paper", x: i * 2, y: 0, z: 0, t: 0, owner: "o" });
      rs.push({ id: `f${i}`, rank: 1, material: "plastic_fragment", x: i * 2, y: 0, z: 5, t: 0, owner: "o" });
    }
    const resolved = resolveField(rs, 30);
    const all = localSurvivors(resolved, 100, 0, 1000);
    expect(all.get(23) ?? 0).toBe(0);
    expect(all.get(1) ?? 0).toBeGreaterThan(50);
    const near = localSurvivors(resolved, 0, 5, 3);
    expect(near.get(1) ?? 0).toBeLessThanOrEqual(2);
  });

  it("survivorship drift: what decays is not inherited, so the next draw leans toward the durable", () => {
    const rs: DepositRecord[] = [];
    for (let i = 0; i < 100; i++) {
      rs.push({ id: `p${i}`, rank: 23, material: "paper", x: i * 2, y: 0, z: 0, t: 0, owner: "o" });
      rs.push({ id: `f${i}`, rank: 1, material: "plastic_fragment", x: i * 2, y: 0, z: 5, t: 0, owner: "o" });
    }
    const survivors = localSurvivors(resolveField(rs, 30), 100, 0, 1000);
    const w = fieldWeights(survivors, 20);
    expect(share(w, 23)).toBeLessThan(prior(23));
    expect(share(w, 1)).toBeGreaterThan(prior(1));
  });
});
