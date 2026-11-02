import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_HALF, concreteLines, otherMarks, outlineSegments, type Other, type Slab } from "./index";

const centre = (cx: number, cz: number): [number, number] => [(cx + 0.5) * CELL_SIZE, (cz + 0.5) * CELL_SIZE];
const slab = (cx: number, cz: number, h = 1): Slab => ({ key: `${cx},${cz}`, x: centre(cx, cz)[0], z: centre(cx, cz)[1], h, raw: h, foot: 1, bornS: 0, lastS: 10 });
const other = (o: string, x: number, z: number, ageSec = 0): Other => ({ o, r: "worker", x, z, dist: Math.hypot(x, z), bearing: "N", moving: false, ageSec });
const me = { x: 0, z: 0 };

describe("the marks", () => {
  it("others: one box each within the view, fading with age", () => {
    const m = otherMarks([other("a", 2, 0), other("b", 10, 0, 10), other("c", 30, 0)], me, 24, 10);
    expect(m.length).toBe(2);
    expect(m[0].bright).toBeCloseTo(1);
    expect(m[1].bright).toBeCloseTo(Math.exp(-1));
  });

  it("concrete: a line on every sealed cell within the view, nearest first, across the world's edge too", () => {
    const l = concreteLines([slab(5, 0), slab(1, 0), slab(0, 3, 0.05), slab(40, 40)], me, 24, 0.15);
    expect(l.map((c) => c.x)).toEqual([centre(1, 0)[0], centre(5, 0)[0]]);
    const edge = concreteLines([slab(79, 0)], { x: -WORLD_HALF + 1, z: 0 }, 24, 0.15);
    expect(edge.length).toBe(1);
    expect(edge[0].x).toBeLessThan(-WORLD_HALF); // placed at the image next to the viewer, not 190 units away
  });
});

describe("the concrete as a line drawing", () => {
  const cell = (cx: number, cz: number, h: number) => ({ x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, h });
  const segs = (list: ReturnType<typeof cell>[], scale = 1) => outlineSegments(list, scale).length / 6;

  it("one cell: four sides, four segments each", () => {
    expect(segs([cell(0, 0, 2)])).toBe(16);
    const all = outlineSegments([cell(0, 0, 2)], 1.5);
    expect(Math.max(...all.filter((_, i) => i % 3 === 1))).toBe(3); // the height × scale
    expect(Math.min(...all.filter((_, i) => i % 3 === 1))).toBe(0); // down to the ground
  });
  it("two cells of one height share no wall; a lower neighbour leaves the step", () => {
    expect(segs([cell(0, 0, 2), cell(1, 0, 2)])).toBe(24); // six outer sides
    const steps = outlineSegments([cell(0, 0, 2), cell(1, 0, 1)], 1);
    const y = steps.filter((_, i) => i % 3 === 1);
    expect(y).toContain(1); // the step between them starts at the lower one's top
    expect(steps.length / 6).toBe(28); // the higher cell's four sides, the lower one's three
  });
});
