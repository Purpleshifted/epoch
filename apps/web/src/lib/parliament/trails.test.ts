import { describe, expect, it } from "vitest";
import { DEFAULT_BUNDLE, DEFAULT_TRAILS, bundleTrails, trailSegments } from "./trails";

const O = { ...DEFAULT_TRAILS, secPerUnit: 20, unit: 1 };
const ev = (o: string, x: number, z: number, s: number) => ({ o, x, z, s, k: "p" as const });

describe("trails: every walk as a thread through the block", () => {
  it("a walk is a slanted line: where and when to where and when (time as height)", () => {
    const seg = trailSegments([ev("a", 0, 0, 100), ev("a", 2, 0, 101)], O);
    expect([...seg]).toEqual([0, 5, 0, 2, 101 / 20, 0].map((v) => Math.fround(v)));
  });
  it("standing is not a walk; a pause is not one walk; whoever it is, in whatever order the samples come", () => {
    expect(trailSegments([ev("a", 0, 0, 100), ev("a", 0.1, 0, 101)], O).length).toBe(0);
    expect(trailSegments([ev("a", 0, 0, 100), ev("a", 2, 0, 110)], O).length).toBe(0);
    expect(trailSegments([ev("a", 0, 0, 100), ev("b", 2, 0, 101)], O).length).toBe(0);
    expect(trailSegments([ev("a", 2, 0, 101), ev("a", 0, 0, 100)], O).length).toBe(6);
  });
  it("a step over the world's edge is not drawn across the map", () => {
    expect(trailSegments([ev("a", 95, 0, 100), ev("a", -95, 0, 101)], O).length).toBe(0);
  });
});

describe("trails: similar walks are one path", () => {
  const B = { ...O, ...DEFAULT_BUNDLE };
  /** A straight walk from (x0, z0) to (x1, z1), 2 units a second, from time s0. */
  const walk = (o: string, x0: number, z0: number, x1: number, z1: number, s0: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2);
    return Array.from({ length: n + 1 }, (_, i) => ev(o, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, s0 + i));
  };
  const grounds = (b: { position: Float32Array }) => {
    const out = new Set<string>();
    for (let i = 0; i < b.position.length; i += 3) out.add(`${b.position[i].toFixed(2)},${b.position[i + 2].toFixed(2)}`);
    return out;
  };

  it("two walks the same way between the same places, at different times, lie on one line — each at its own time", () => {
    const b = bundleTrails([...walk("a", 0, 0, 20, 0, 100), ...walk("b", 0, 1.5, 20, 1.5, 700)], B);
    expect(b.legs).toBe(2);
    expect(b.routes).toBe(1);
    expect(b.bundled).toBe(2);
    // on the line: every point at the route's z (the mean of the two, 0.75)
    for (let i = 2; i < b.position.length; i += 3) expect(b.position[i]).toBeCloseTo(0.75, 4);
    // the times are their own
    const ys = [...b.position].filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(5, 4);
    expect(Math.max(...ys)).toBeCloseTo(710 / 20, 4);
    expect(b.weight[0]).toBeCloseTo(2 / DEFAULT_BUNDLE.full, 5);
  });

  it("the other way along the same road is the same path; a walk elsewhere or across it is not", () => {
    const road = walk("a", 0, 0, 20, 0, 100);
    expect(bundleTrails([...road, ...walk("b", 20, 1, 0, 1, 300)], B).routes).toBe(1);
    expect(bundleTrails([...road, ...walk("b", 0, 30, 20, 30, 300)], B).routes).toBe(2);
    expect(bundleTrails([...road, ...walk("b", 10, -10, 10, 10, 300)], B).routes).toBe(2);
  });

  it("a threshold nobody reaches, or no pull: the walks as they were", () => {
    const evs = [...walk("a", 0, 0, 20, 0, 100), ...walk("b", 0, 1.5, 20, 1.5, 700)];
    const raw = trailSegments(evs, O);
    const apart = bundleTrails(evs, { ...B, threshold: 1.01 });
    expect(apart.bundled).toBe(0);
    expect(grounds(apart)).toEqual(grounds({ position: raw }));
    expect(grounds(bundleTrails(evs, { ...B, strength: 0 }))).toEqual(grounds({ position: raw }));
  });

  it("a window in time: only walks near each other in time are one path", () => {
    const evs = [...walk("a", 0, 0, 20, 0, 100), ...walk("b", 0, 1, 20, 1, 700), ...walk("c", 0, 0.5, 20, 0.5, 130)];
    expect(bundleTrails(evs, { ...B, windowSec: 60 }).routes).toBe(2);
    expect(bundleTrails(evs, B).routes).toBe(1);
  });

  it("is the same whatever order the samples come in, and brighter the more walks a path has", () => {
    const evs = [0, 1, 2, 3, 4, 5, 6].flatMap((i) => walk(`w${i}`, 0, i * 0.3, 20, i * 0.3, 100 + i * 50));
    const a = bundleTrails(evs, B), b = bundleTrails([...evs].reverse(), B);
    expect([...b.position]).toEqual([...a.position]);
    expect(Math.max(...a.weight)).toBe(1);
  });
});
