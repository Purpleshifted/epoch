import { describe, expect, it } from "vitest";
import { DEFAULT_ERODE, erodeThreshold, erosion, erosionAt, pipeErosion, type ErodeConfig } from "./erode";
import type { Box, Seed } from "./seeds";

const cfg: ErodeConfig = { ...DEFAULT_ERODE, topSlot: 40 };
const box = (kind: Box["kind"], slot: number, x = 0, z = 0, seed = 1): Box => ({ kind, seed, material: "concrete" as Box["material"], x, y: slot + 0.5, z, sx: 1, sy: 1, sz: 1, tone: 0.5, along: 0, slot });

describe("erosion in the block", () => {
  it("is nothing at the top and grows with depth", () => {
    expect(erosionAt(39, 0, cfg)).toBe(0);
    let last = 0;
    for (let k = 39; k >= 0; k--) {
      const e = erosionAt(k, 0, cfg);
      expect(e).toBeGreaterThanOrEqual(last);
      last = e;
    }
    expect(last).toBeGreaterThan(0.9);
  });

  it("comes sooner where the place was not lived in", () => {
    expect(erosionAt(30, 1, cfg)).toBeGreaterThan(erosionAt(30, 0, cfg));
    expect(erosionAt(30, 0.5, cfg)).toBeGreaterThan(erosionAt(30, 0.25, cfg));
  });

  it("is off without a top", () => {
    expect(erosionAt(0, 1, { ...cfg, topSlot: 0 })).toBe(0);
  });

  it("takes the order of building backwards: drips before the skeleton", () => {
    const strict = { ...cfg, order: 1, patch: 0 };
    for (let i = 0; i < 50; i++) {
      expect(erodeThreshold(box("drip", 5, i * 1.3, i * 0.7), strict)).toBeLessThan(erodeThreshold(box("column", 5, i * 1.3, i * 0.7), strict));
    }
  });

  it("keeps thresholds in 0 … 1 and removes more parts the deeper they lie", () => {
    const seeds = [{ id: 1, gather: new Map([[35, 1]]) } as unknown as Seed];
    const er = erosion(seeds, { ...cfg, amount: 1 });
    const gone = (slot: number) => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const b = box(i % 2 ? "mass" : "slab", slot, (i % 20) * 1.2, Math.floor(i / 20) * 1.2);
        const th = erodeThreshold(b, cfg);
        expect(th).toBeGreaterThanOrEqual(0);
        expect(th).toBeLessThanOrEqual(1);
        if (er.gone(b)) n++;
      }
      return n;
    };
    expect(gone(39)).toBe(0);
    expect(gone(2)).toBeGreaterThan(gone(20));
    expect(gone(20)).toBeGreaterThan(0);
    // the unlived slot near the top erodes although its depth alone would not
    expect(gone(35)).toBeGreaterThan(0);
  });
});

describe("the pipes erode too", () => {
  const runs = Array.from({ length: 400 }, (_, i) => [((i * 37) % 97) * 1.2, ((i * 53) % 89) * 1.2] as const);
  const goneAt = (slot: number, c = cfg) => runs.filter(([x, z]) => pipeErosion(x, z, slot, c) >= 1).length;

  it("nothing near the top, more gone the deeper, holes before a run goes", () => {
    expect(runs.every(([x, z]) => pipeErosion(x, z, 39, cfg) === 0)).toBe(true);
    expect(goneAt(2)).toBeGreaterThan(goneAt(20));
    expect(goneAt(20)).toBeGreaterThanOrEqual(goneAt(34));
    expect(goneAt(2)).toBeGreaterThan(0);
    // a run that still lies deep carries how near it is to going (0 … 1)
    const deep = runs.map(([x, z]) => pipeErosion(x, z, 2, cfg)).filter((e) => e < 1);
    expect(deep.length).toBeGreaterThan(0);
    for (const e of deep) expect(e).toBeGreaterThan(0);
  });

  it("is a place, not a clock: the same run, the same answer; no amount, nothing goes", () => {
    for (const [x, z] of runs.slice(0, 20)) expect(pipeErosion(x, z, 5, cfg)).toBe(pipeErosion(x, z, 5, cfg));
    expect(goneAt(2, { ...cfg, amount: 0 })).toBe(0);
  });
});

