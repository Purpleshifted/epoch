import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_HALF, concreteLines, otherMarks, type Other, type Slab } from "./index";

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
