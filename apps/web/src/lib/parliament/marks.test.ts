import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_HALF, catmullRom, concreteLines, otherMarks, pathChains, type Other, type PathCell, type Slab } from "./index";

const centre = (cx: number, cz: number): [number, number] => [(cx + 0.5) * CELL_SIZE, (cz + 0.5) * CELL_SIZE];
const path = (cx: number, cz: number, p = 0.6): PathCell => ({ key: `${cx},${cz}`, x: centre(cx, cz)[0], z: centre(cx, cz)[1], p, visits: 10 });
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

  it("catmull-rom: passes through the points, keeps the ends, closes a loop", () => {
    const pts: [number, number][] = [[0, 0], [1, 1], [2, 0], [3, 1]];
    const c = catmullRom(pts, 4);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([3, 1]);
    expect(c.length).toBe(3 * 4 + 1);
    expect(c[4]).toEqual([1, 1]);
    const loop = catmullRom([[0, 0], [2, 0], [2, 2], [0, 2]], 2, true);
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(catmullRom([[1, 1]], 4)).toEqual([[1, 1]]);
  });

  it("chains: a straight run is one chain, a cross is four meeting at the centre, a diagonal is one chain, a ring is a loop", () => {
    const line = [-3, -2, -1, 0, 1, 2, 3].map((i) => path(i, 0));
    const one = pathChains(line, me, 30, 0.3, 2);
    expect(one.length).toBe(1);
    expect(one[0].pts[0][0]).toBeCloseTo(centre(-3, 0)[0]);
    expect(one[0].pts[one[0].pts.length - 1][0]).toBeCloseTo(centre(3, 0)[0]);
    expect(one[0].loop).toBe(false);
    const cross = [...line, ...[-3, -2, -1, 1, 2, 3].map((i) => path(0, i))];
    const four = pathChains(cross, me, 30, 0.3, 2);
    expect(four.length).toBe(4);
    for (const ch of four) {
      const ends = [ch.pts[0], ch.pts[ch.pts.length - 1]];
      expect(ends.some(([x, z]) => Math.abs(x - centre(0, 0)[0]) < 1e-6 && Math.abs(z - centre(0, 0)[1]) < 1e-6)).toBe(true);
    }
    const diag = [0, 1, 2, 3, 4].map((i) => path(i, i));
    expect(pathChains(diag, me, 30, 0.3, 2).length).toBe(1);
    const ring = [path(0, 0), path(1, 0), path(2, 0), path(2, 1), path(2, 2), path(1, 2), path(0, 2), path(0, 1)];
    const loops = pathChains(ring, me, 30, 0.3, 2);
    expect(loops.length).toBe(1);
    expect(loops[0].loop).toBe(true);
    // a weak cell breaks a chain in two; cells beyond the radius are not part of it
    expect(pathChains([...line.filter((q) => q.key !== "0,0"), path(0, 0, 0.1)], me, 30, 0.3, 2).length).toBe(2);
    expect(pathChains(line, me, 2, 0.3, 2)[0].pts.length).toBeLessThan(one[0].pts.length);
  });
});
