import { describe, expect, it } from "vitest";
import { DEFAULT_TRAILS, trailSegments } from "./trails";

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
