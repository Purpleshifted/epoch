import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  ITEMS,
  MATERIALS,
  MATERIAL_PALETTE_INDEX,
  PALETTE_HEX,
  cellKey,
  dimIndex,
  fieldWeights,
  itemById,
  localSurvivors,
  makeDeposit,
  mulberry32,
  resolveField,
  sampleFromField,
  sampleItem,
  type DepositRecord,
} from "./index";

const rec = (id: string, t: number, x = 0, z = 0, material: DepositRecord["material"] = "glass"): DepositRecord =>
  ({ id, item: "glass_bottle", variant: 0, material, x, y: 0, z, t, owner: "o" });

describe("field", () => {
  it("cellKey groups points within one CELL_SIZE square", () => {
    expect(cellKey(0.1, 0.1)).toBe(cellKey(CELL_SIZE - 0.01, CELL_SIZE - 0.01));
    expect(cellKey(0.1, 0.1)).not.toBe(cellKey(CELL_SIZE + 0.01, 0.1));
    expect(cellKey(-0.1, 0)).not.toBe(cellKey(0.1, 0));
  });

  it("makeDeposit follows the catalogue and never lets the caller pick a material", () => {
    const d = makeDeposit({ id: "a", u: 0, x: 0, y: 0, z: 0, t: 0, owner: "o" });
    expect(d.item).toBe(ITEMS[0].id);
    expect(d.material).toBe(ITEMS[0].material);
    expect(d.variant).toBeGreaterThanOrEqual(0);
    expect(d.variant).toBeLessThan(ITEMS[0].variants);
  });

  it("the sprite variant is deterministic per record id and stays inside the item's variant count", () => {
    for (let i = 0; i < 200; i++) {
      const u = i / 200;
      const a = makeDeposit({ id: `v${i}`, u, x: 0, y: 0, z: 0, t: 0, owner: "o" });
      const b = makeDeposit({ id: `v${i}`, u, x: 5, y: 0, z: 5, t: 9, owner: "p" });
      expect(a.variant).toBe(b.variant);
      expect(a.variant).toBeLessThan(itemById(a.item).variants);
    }
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
  const idx = (id: string) => itemById(id).index;
  const prior = (id: string) => itemById(id).prior;
  const share = (w: number[], id: string) => w[idx(id)] / w.reduce((a, b) => a + b, 0);

  it("with nothing on the ground the weights are exactly the catalogue prior", () => {
    const w = fieldWeights(new Map(), 20);
    for (const it of ITEMS) expect(share(w, it.id)).toBeCloseTo(it.prior, 12);
  });

  it("the ground's weight is n / (n + k): n = k gives (prior + 1) / 2 for the only survivor type", () => {
    const k = 20;
    const w = fieldWeights(new Map([["cap_plastic", k]]), k);
    expect(share(w, "cap_plastic")).toBeCloseTo((prior("cap_plastic") + 1) / 2, 12);
  });

  it("k = 0 draws only what is on the ground; large k hardly moves from the prior", () => {
    const only = new Map([["chicken_bone", 3]]);
    for (let i = 0; i < 50; i++) expect(sampleFromField(i / 50, only, 0).id).toBe("chicken_bone");
    const w = fieldWeights(only, 1e6);
    expect(share(w, "chicken_bone")).toBeCloseTo(prior("chicken_bone"), 4);
  });

  it("an empty ground draws like the plain catalogue prior", () => {
    const rnd = mulberry32(42);
    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const u = rnd();
      if (sampleFromField(u, new Map(), 20).id !== sampleItem(u).id) mismatches++;
    }
    expect(mismatches).toBeLessThanOrEqual(1); // float rounding on a boundary only
  });

  const ground = (): DepositRecord[] => {
    const rs: DepositRecord[] = [];
    for (let i = 0; i < 100; i++) {
      rs.push({ id: `p${i}`, item: "cardboard", variant: 0, material: "paper", x: i * 2, y: 0, z: 0, t: 0, owner: "o" });
      rs.push({ id: `f${i}`, item: "frag_mid", variant: 0, material: "plastic_fragment", x: i * 2, y: 0, z: 5, t: 0, owner: "o" });
    }
    return rs;
  };

  it("localSurvivors ignores vanished items and items outside the radius", () => {
    // paper is gone after ~100 simulated years; a plastic fragment is not.
    const resolved = resolveField(ground(), 30);
    const all = localSurvivors(resolved, 100, 0, 1000);
    expect(all.get("cardboard") ?? 0).toBe(0);
    expect(all.get("frag_mid") ?? 0).toBeGreaterThan(50);
    const near = localSurvivors(resolved, 0, 5, 3);
    expect(near.get("frag_mid") ?? 0).toBeLessThanOrEqual(2);
  });

  it("survivorship drift: what decays is not inherited, so the next draw leans toward the durable", () => {
    const survivors = localSurvivors(resolveField(ground(), 30), 100, 0, 1000);
    const w = fieldWeights(survivors, 20);
    expect(share(w, "cardboard")).toBeLessThan(prior("cardboard"));
    expect(share(w, "frag_mid")).toBeGreaterThan(prior("frag_mid"));
  });
});
