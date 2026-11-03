import { describe, expect, it } from "vitest";
import { matte } from "./shotMatte";

function pixel(black: number[], white: number[]): number[] {
  const out = new Uint8ClampedArray([...black, 255]);
  matte(out, new Uint8ClampedArray([...white, 255]));
  return [...out];
}

describe("matte", () => {
  it("keeps what lets nothing through as it is", () => {
    expect(pixel([40, 90, 200], [40, 90, 200])).toEqual([40, 90, 200, 255]);
  });

  it("takes away what is only background", () => {
    expect(pixel([0, 0, 0], [255, 255, 255])).toEqual([0, 0, 0, 0]);
  });

  it("finds the colour of what is half there", () => {
    // 200 at half over black is 100, over white 227.5
    const [r, , , a] = pixel([100, 100, 100], [228, 228, 228]);
    expect(a).toBeCloseTo(127, 0);
    expect(r).toBeGreaterThanOrEqual(199);
    expect(r).toBeLessThanOrEqual(201);
  });

  it("does not take noise for transparency beyond opaque", () => {
    expect(pixel([100, 100, 100], [98, 98, 98])[3]).toBe(255);
  });
});
