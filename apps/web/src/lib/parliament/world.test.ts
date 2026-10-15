import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_CELLS, WORLD_HALF, WORLD_SIZE, nearestImage, wrapCell, wrapCoord, wrapDelta, wrapDist, wrapEvent } from "./world";

describe("world: finite and wrapping", () => {
  it("is a whole number of cells across, centred on the origin", () => {
    expect(WORLD_SIZE).toBeCloseTo(WORLD_CELLS * CELL_SIZE);
    expect(wrapCell(Math.floor(-WORLD_HALF / CELL_SIZE))).toBe(-WORLD_CELLS / 2);
    expect(wrapCell(Math.floor((WORLD_HALF - 1e-6) / CELL_SIZE))).toBe(WORLD_CELLS / 2 - 1);
  });

  it("coordinates come back canonical: walk off one edge, come in from the other", () => {
    expect(wrapCoord(0)).toBe(0);
    expect(wrapCoord(WORLD_HALF)).toBe(-WORLD_HALF);
    expect(wrapCoord(-WORLD_HALF)).toBe(-WORLD_HALF);
    expect(wrapCoord(WORLD_HALF + 3)).toBeCloseTo(-WORLD_HALF + 3);
    expect(wrapCoord(-WORLD_HALF - 3)).toBeCloseTo(WORLD_HALF - 3);
    expect(wrapCoord(5 * WORLD_SIZE + 7)).toBeCloseTo(7);
  });

  it("distances take the short way round", () => {
    expect(wrapDelta(WORLD_SIZE - 2)).toBeCloseTo(-2);
    expect(wrapDelta(-(WORLD_SIZE - 2))).toBeCloseTo(2);
    expect(wrapDist(WORLD_HALF - 1, 0, -WORLD_HALF + 1, 0)).toBeCloseTo(2);
    expect(wrapDist(10, 10, -10, -10)).toBeCloseTo(Math.hypot(20, 20));
  });

  it("cells wrap and the nearest image is drawn beside the viewer", () => {
    expect(wrapCell(WORLD_CELLS / 2)).toBe(-WORLD_CELLS / 2);
    expect(wrapCell(-WORLD_CELLS / 2 - 1)).toBe(WORLD_CELLS / 2 - 1);
    expect(wrapCell(3 * WORLD_CELLS + 5)).toBe(5);
    expect(nearestImage(-WORLD_HALF + 1, WORLD_HALF - 1)).toBeCloseTo(WORLD_HALF + 1);
  });

  it("wrapEvent keeps a canonical event as the same object", () => {
    const e = { id: "a", x: 3, z: -4 };
    expect(wrapEvent(e)).toBe(e);
    expect(wrapEvent({ id: "b", x: WORLD_HALF + 1, z: 0 }).x).toBeCloseTo(-WORLD_HALF + 1);
  });
});
