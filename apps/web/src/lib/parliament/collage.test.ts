import { describe, expect, it } from "vitest";
import { DEFAULT_COLLAGE, buildCollage, type Slab } from "./index";

const C = 1.2;
const cell = (cx: number, cz: number, h: number, raw = h): Slab => ({
  key: `${cx},${cz}`,
  x: (cx + 0.5) * C,
  z: (cz + 0.5) * C,
  h,
  raw,
  foot: 1,
  bornS: 0,
  lastS: 0,
});
const row = (n: number, h = 3): Slab[] => Array.from({ length: n }, (_, i) => cell(i, 0, h));
const ASP = [0.5, 1, 1.4, 0.8];

describe("collage (photo fragments)", () => {
  it("is deterministic and every placement is finite", () => {
    expect(buildCollage(row(6), 1, "side", ASP)).toEqual(buildCollage(row(6), 1, "side", ASP));
    for (const view of ["side", "top"] as const) {
      for (const p of buildCollage(row(6, 5), 1, view, ASP)) {
        for (const v of [p.x, p.y, p.z, p.w, p.h, p.rot]) expect(Number.isFinite(v)).toBe(true);
        expect(p.frag).toBeGreaterThanOrEqual(0);
        expect(p.frag).toBeLessThan(ASP.length);
        expect(p.w).toBeGreaterThan(0);
        expect(p.h).toBeGreaterThan(0);
      }
    }
  });

  it("gives nothing without fragments or without solid slabs", () => {
    expect(buildCollage(row(4), 1, "side", [])).toEqual([]);
    expect(buildCollage([cell(0, 0, 0.05, 3)], 1, "side", ASP)).toEqual([]);
  });

  it("side pictures follow the unworn height; wear removes pictures but never resizes the survivors", () => {
    const full = buildCollage(row(8), 1, "side", ASP);
    const worn = buildCollage(row(8).map((s) => ({ ...s, h: s.raw * 0.5 })), 1, "side", ASP);
    expect(worn.length).toBeLessThanOrEqual(full.length);
    for (const p of worn) expect(full.some((q) => q.frag === p.frag && Math.abs(q.h - p.h) < 1e-9)).toBe(true);
  });

  it("wear is monotone", () => {
    const n = (k: number) => buildCollage(row(8).map((s) => ({ ...s, h: s.raw * k })), 1, "top", ASP).length;
    expect(n(1)).toBeGreaterThanOrEqual(n(0.6));
    expect(n(0.6)).toBeGreaterThanOrEqual(n(0.2));
  });

  it("density scales the count, scale scales the size", () => {
    const a = buildCollage(row(8), 1, "side", ASP, DEFAULT_COLLAGE);
    const b = buildCollage(row(8), 1, "side", ASP, { density: 2.5, scale: 1 });
    expect(b.length).toBeGreaterThan(a.length);
    const big = buildCollage(row(8), 1, "side", ASP, { density: 1, scale: 2 });
    expect(big[0].h).toBeCloseTo(a[0].h * 2, 6);
  });
});
