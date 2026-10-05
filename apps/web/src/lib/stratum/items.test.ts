import { describe, expect, it } from "vitest";
import {
  ITEMS,
  LAYER_SHARE,
  MATERIALS,
  NATURALS,
  NATURAL_BY_ID,
  NATURAL_CAL,
  PASSES_PER_CROSSING,
  PASSES_PER_DEPOSIT,
  TAU_FAUNA,
  TAU_FLORA,
  aliveShare,
  cellKey,
  itemById,
  mulberry32,
  naturalCountInCell,
  naturalItemsAround,
  naturalItemsInCell,
  resolveNatural,
  sampleItem,
  type DepositRecord,
  type StepRecord,
} from "./index";

describe("catalogue v2 items", () => {
  it("has unique ids and only known materials", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const i of ITEMS) expect(MATERIALS[i.material], i.id).toBeDefined();
    for (const n of NATURALS) expect(MATERIALS[n.material], n.id).toBeDefined();
  });

  it("priors sum to 1 and each layer carries exactly its LAYER_SHARE", () => {
    expect(ITEMS.reduce((s, i) => s + i.prior, 0)).toBeCloseTo(1, 6);
    for (const layer of ["A", "B", "C"] as const) {
      const sum = ITEMS.filter((i) => i.layer === layer).reduce((s, i) => s + i.prior, 0);
      expect(sum).toBeCloseTo(LAYER_SHARE[layer], 3);
    }
    expect(LAYER_SHARE.A + LAYER_SHARE.B + LAYER_SHARE.C).toBeCloseTo(1, 12);
  });

  it("has the documented size: 106 JRC items, 32 electronics, 10 anthropogenic organics", () => {
    expect(ITEMS.filter((i) => i.layer === "A")).toHaveLength(106);
    expect(ITEMS.filter((i) => i.layer === "B")).toHaveLength(32);
    expect(ITEMS.filter((i) => i.layer === "C")).toHaveLength(10);
  });

  it("every item has at least one sprite variant", () => {
    for (const i of ITEMS) expect(i.variants, i.id).toBeGreaterThanOrEqual(1);
  });

  it("sampleItem covers the whole range and reproduces the layer shares", () => {
    expect(sampleItem(0)).toBe(ITEMS[0]);
    expect(sampleItem(0.999999999)).toBe(ITEMS[ITEMS.length - 1]);
    const rnd = mulberry32(7);
    const n = 100000;
    const count = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < n; i++) count[sampleItem(rnd()).layer]++;
    expect(count.A / n).toBeCloseTo(LAYER_SHARE.A, 1);
    expect(count.B / n).toBeCloseTo(LAYER_SHARE.B, 1);
    expect(count.C / n).toBeCloseTo(LAYER_SHARE.C, 1);
  });

  it("anthropogenic organics keep their identity: chicken bone is a bone, food waste is soft", () => {
    expect(itemById("chicken_bone").material).toBe("bone");
    expect(itemById("food_waste").material).toBe("soft_organic");
    expect(itemById("food_waste").layer).toBe("C");
  });

  it("natural stock shares sum to 1 and are split into flora and fauna", () => {
    expect(NATURALS.reduce((s, n) => s + n.share, 0)).toBeCloseTo(1, 12);
    expect(NATURALS.some((n) => n.group === "flora")).toBe(true);
    expect(NATURALS.some((n) => n.group === "fauna")).toBe(true);
    expect(NATURAL_BY_ID.get("leaf")?.group).toBe("flora");
  });
});

describe("natural stock", () => {
  it("is deterministic: the same cell always holds the same things", () => {
    const a = naturalItemsInCell(3, -4).map((i) => `${i.id}:${i.def.id}:${i.variant}:${i.x.toFixed(6)}`);
    const b = naturalItemsInCell(3, -4).map((i) => `${i.id}:${i.def.id}:${i.variant}:${i.x.toFixed(6)}`);
    expect(a).toEqual(b);
  });

  it("holds 0–2 items per cell, 0.9 on average, and places each inside its cell", () => {
    let total = 0;
    const cells = 2000;
    for (let i = 0; i < cells; i++) {
      const cx = (i % 50) - 25;
      const cz = Math.floor(i / 50) - 20;
      const n = naturalCountInCell(cx, cz);
      expect(n).toBeLessThanOrEqual(2);
      total += n;
      for (const it of naturalItemsInCell(cx, cz)) expect(cellKey(it.x, it.z)).toBe(`${cx},${cz}`);
    }
    expect(total / cells).toBeGreaterThan(0.8);
    expect(total / cells).toBeLessThan(1.0);
  });

  it("naturalItemsAround returns only items inside the radius", () => {
    const items = naturalItemsAround(5, 5, 6);
    expect(items.length).toBeGreaterThan(5);
    for (const it of items) expect(Math.hypot(it.x - 5, it.z - 5)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it("without any visitor everything is alive", () => {
    const items = naturalItemsAround(0, 0, 20);
    const res = resolveNatural(items, [], [], 1000);
    expect(aliveShare(res)).toBe(1);
    expect(res.every((r) => r.fate === null && r.displacedAt === null)).toBe(true);
  });

  const stepsEverywhere = (items: ReturnType<typeof naturalItemsAround>, crossings: number): StepRecord[] => {
    const cells = [...new Set(items.map((i) => i.cell))];
    const out: StepRecord[] = [];
    for (const c of cells) for (let k = 0; k < crossings; k++) out.push({ id: `${c}:${k}`, c, t: k, o: "v" });
    return out;
  };

  it("more walking leaves fewer alive; the loss is monotone in the number of crossings", () => {
    const items = naturalItemsAround(0, 0, 25);
    let prev = 1.01;
    for (const crossings of [0, 1, 3, 6, 12]) {
      const share = aliveShare(resolveNatural(items, [], stepsEverywhere(items, crossings), 100));
      expect(share).toBeLessThanOrEqual(prev);
      prev = share;
    }
    expect(prev).toBeLessThan(0.5);
  });

  it("calibration: at the reference load (τ_flora·ln2 passes) flora fall to about a half, fauna to about a sixth", () => {
    const items = naturalItemsAround(0, 0, 40);
    const crossings = Math.round((TAU_FLORA * Math.log(2)) / PASSES_PER_CROSSING); // ≈ 5
    const res = resolveNatural(items, [], stepsEverywhere(items, crossings), 100);
    const flora = aliveShare(res, "flora");
    const fauna = aliveShare(res, "fauna");
    expect(flora).toBeGreaterThan(0.45);
    expect(flora).toBeLessThan(0.75);
    expect(fauna).toBeGreaterThan(0.08);
    expect(fauna).toBeLessThan(0.3);
    expect(fauna).toBeLessThan(flora);
  });

  it("the calibration constants follow the documented anchors", () => {
    expect(TAU_FLORA).toBeCloseTo(50 / Math.log(2), 1);
    expect(TAU_FAUNA).toBeCloseTo((TAU_FLORA * Math.log(2)) / Math.log(6), 1);
    expect(NATURAL_CAL.passesPerCrossing).toBe(PASSES_PER_CROSSING);
    expect(PASSES_PER_DEPOSIT).toBeLessThan(PASSES_PER_CROSSING);
  });

  it("deposits wear the ground too, but less than a crossing", () => {
    const items = naturalItemsAround(0, 0, 25);
    const cells = [...new Set(items.map((i) => i.cell))];
    const mkDep = (c: string, k: number): DepositRecord => {
      const [cx, cz] = c.split(",").map(Number);
      return { id: `d${c}:${k}`, item: "glass_bottle", variant: 0, material: "glass", x: (cx + 0.5) * 1.2, y: 0, z: (cz + 0.5) * 1.2, t: k, owner: "o" };
    };
    const deps = cells.flatMap((c) => [0, 1, 2, 3, 4, 5].map((k) => mkDep(c, k)));
    const steps = stepsEverywhere(items, 6);
    const none = aliveShare(resolveNatural(items, [], [], 100));
    const byDeposit = aliveShare(resolveNatural(items, deps, [], 100));
    const byStep = aliveShare(resolveNatural(items, [], steps, 100));
    expect(byDeposit).toBeLessThan(none);
    expect(byStep).toBeLessThan(byDeposit);
  });

  it("events in the future do not displace anything yet", () => {
    const items = naturalItemsAround(0, 0, 15);
    const steps = stepsEverywhere(items, 20).map((s) => ({ ...s, t: s.t + 500 }));
    expect(aliveShare(resolveNatural(items, [], steps, 100))).toBe(1);
  });

  it("displaced matter follows taphonomy: soft remains vanish quickly, a tooth does not", () => {
    const items = naturalItemsAround(0, 0, 60);
    const heavy = stepsEverywhere(items, 200).map((s) => ({ ...s, t: s.t * 0.005 })); // all displaced within ~1 s
    const res = resolveNatural(items, [], heavy, 20);
    const soft = res.filter((r) => !r.alive && r.item.def.material === "soft_organic");
    const teeth = res.filter((r) => !r.alive && r.item.def.material === "tooth");
    expect(soft.length).toBeGreaterThan(20);
    expect(soft.every((r) => r.fate!.stage === "vanished")).toBe(true);
    expect(teeth.length).toBeGreaterThan(0);
    expect(teeth.every((r) => r.fate!.stage !== "vanished")).toBe(true);
  });
});
