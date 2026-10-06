import { describe, it, expect } from "vitest";
import { generateDemo } from "./demo";
import { GroundStore } from "./field";
import { geoYears, secondsForYears } from "./geoClock";

describe("secondsForYears", () => {
  it("inverts geoYears", () => {
    for (const y of [1, 100, 1e4, 1e6]) expect(geoYears(secondsForYears(y))).toBeCloseTo(y, 3);
  });
});

describe("generateDemo", () => {
  const a = generateDemo({ visitors: 12, span: 300, seed: 7 });

  it("is deterministic", () => {
    const b = generateDemo({ visitors: 12, span: 300, seed: 7 });
    expect(b.deposits.length).toBe(a.deposits.length);
    expect(b.deposits[10]).toEqual(a.deposits[10]);
  });

  it("produces deposits and steps with unique ids inside the span", () => {
    expect(a.deposits.length).toBeGreaterThan(100);
    expect(a.steps.length).toBeGreaterThan(100);
    expect(new Set(a.deposits.map((d) => d.id)).size).toBe(a.deposits.length);
    expect(a.deposits.every((d) => d.t >= 0 && d.t <= 300)).toBe(true);
  });

  it("older deposits end up buried or gone, newer ones fresh", () => {
    const store = new GroundStore();
    for (const d of a.deposits) store.addDeposit(d);
    const res = store.resolveAll(300);
    const stages = new Set(res.map((r) => r.fate.stage));
    expect(stages.size).toBeGreaterThan(1);
  });
});
