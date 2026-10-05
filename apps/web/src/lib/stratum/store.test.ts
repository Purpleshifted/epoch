import { describe, expect, it } from "vitest";
import {
  GroundStore,
  naturalItemsAround,
  aliveShare,
  resolveNaturalIn,
  type DepositRecord,
  type StepRecord,
} from "./index";

const rec = (id: string, t: number, x = 0, z = 0, material: DepositRecord["material"] = "glass"): DepositRecord =>
  ({ id, item: "glass_bottle", variant: 0, material, x, y: 0, z, t, owner: "o" });

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => rec(`g${i}`, i * 0.7, (i % 7) * 1.3 - 4, Math.floor(i / 7) * 0.9 - 3, i % 2 ? "glass" : "paper"));

describe("GroundStore (incremental, per-cell)", () => {
  it("gives the same fates whatever order records arrive in", () => {
    const rs = mk(120);
    const a = new GroundStore();
    rs.forEach((r) => a.addDeposit(r));
    const b = new GroundStore();
    [...rs].reverse().forEach((r) => b.addDeposit(r));
    const f = (s: GroundStore) => s.resolveAll(200).map((r) => `${r.rec.id}:${r.fate.stage}:${r.buriedAt}`).sort();
    expect(f(a)).toEqual(f(b));
  });

  it("ignores duplicate ids", () => {
    const s = new GroundStore();
    expect(s.addDeposit(rec("x", 0))).toBe(true);
    expect(s.addDeposit(rec("x", 5))).toBe(false);
    expect(s.depositCount).toBe(1);
    const st: StepRecord = { id: "s", c: "0,0", t: 1, o: "v" };
    expect(s.addStep(st)).toBe(true);
    expect(s.addStep(st)).toBe(false);
    expect(s.stepCount).toBe(1);
  });

  it("version bumps only when something new is added", () => {
    const s = new GroundStore();
    const v0 = s.version;
    s.addDeposit(rec("a", 0));
    const v1 = s.version;
    s.addDeposit(rec("a", 0));
    expect(v1).toBeGreaterThan(v0);
    expect(s.version).toBe(v1);
  });

  it("resolveNear equals the matching part of resolveAll (whole cells keep burial correct)", () => {
    const s = new GroundStore();
    mk(150).forEach((r) => s.addDeposit(r));
    const all = new Map(s.resolveAll(300).map((r) => [r.rec.id, r.fate.stage]));
    const near = s.resolveNear(0, 0, 3, 300);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(all.size);
    for (const r of near) expect(all.get(r.rec.id)).toBe(r.fate.stage);
  });

  it("a deposit buried by enough later deposits on the same cell reports when", () => {
    const s = new GroundStore();
    s.addDeposit(rec("victim", 0));
    for (let i = 0; i < 80; i++) s.addDeposit(rec(`c${i}`, 1 + i));
    const r = s.resolveAll(500).find((x) => x.rec.id === "victim")!;
    expect(r.buriedAt).not.toBeNull();
    expect(r.buriedAt!).toBeGreaterThan(0);
  });
});

describe("natural wear factor", () => {
  const stepsOn = (cells: string[], n: number) => {
    const s = new GroundStore();
    for (const c of cells) for (let k = 0; k < n; k++) s.addStep({ id: `${c}:${k}`, c, t: k, o: "v" });
    return s;
  };

  it("wear = 1 is the calibrated reference; a larger wear displaces more of the same ground", () => {
    const items = naturalItemsAround(0, 0, 25);
    const store = stepsOn([...new Set(items.map((i) => i.cell))], 2);
    const a1 = aliveShare(resolveNaturalIn(items, store, 100, undefined, 1));
    const a3 = aliveShare(resolveNaturalIn(items, store, 100, undefined, 3));
    const a8 = aliveShare(resolveNaturalIn(items, store, 100, undefined, 8));
    expect(a3).toBeLessThan(a1);
    expect(a8).toBeLessThan(a3);
  });
});
