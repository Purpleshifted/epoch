import { describe, expect, it } from "vitest";
import { DEFAULT_STAKES, cellCentre, pathJunctions, slabClusters, stakesOf, type Other, type PathCell, type Slab } from "./index";

const path = (cx: number, cz: number, p = 0.6): PathCell => ({ key: `${cx},${cz}`, x: cellCentre(cx, cz)[0], z: cellCentre(cx, cz)[1], p, visits: 10 });
const slab = (cx: number, cz: number, h = 1): Slab => ({ key: `${cx},${cz}`, x: cellCentre(cx, cz)[0], z: cellCentre(cx, cz)[1], h, raw: h, foot: 1, bornS: 0, lastS: 10 });
const other = (o: string, x: number, z: number, moving = false, ageSec = 0): Other => ({ o, r: "worker", x, z, dist: Math.hypot(x, z), bearing: "N", moving, ageSec });

describe("stakes in the ground", () => {
  it("a junction is where routes meet: the crossing of a cross, not its arms", () => {
    const cross = [...[-3, -2, -1, 0, 1, 2, 3].map((i) => path(i, 0)), ...[-3, -2, -1, 1, 2, 3].map((i) => path(0, i))];
    const js = pathJunctions(cross, 0.3, 3);
    expect(js.length).toBe(1);
    expect(js[0]).toMatchObject({ x: cellCentre(0, 0)[0], z: cellCentre(0, 0)[1], n: 4 });
    // a weak cell does not count, a straight line has no junction
    expect(pathJunctions([...cross, path(5, 5, 0.1)], 0.3, 3).length).toBe(1);
    expect(pathJunctions([-3, -2, -1, 0, 1, 2, 3].map((i) => path(i, 0)), 0.3, 3).length).toBe(0);
  });

  it("buildings are the sealed slabs by adjacency: the centre, the tallest, the count", () => {
    const bs = slabClusters([slab(0, 0, 1), slab(1, 0, 3), slab(0, 1, 2), slab(10, 10, 1), slab(5, 5, 0.1)], 0.15);
    expect(bs.length).toBe(2); // the low slab is not sealed
    const big = bs.find((b) => b.n === 3)!;
    expect(big.h).toBe(3);
    expect(big.x).toBeCloseTo((cellCentre(0, 0)[0] + cellCentre(1, 0)[0] + cellCentre(0, 1)[0]) / 3);
  });

  it("stakesOf: nearest first, each kind by its switch, capped, the others fading with age", () => {
    const far = [other("bot1", 2, 0), other("bot2", 10, 0, true, 5), other("bot3", 30, 0)];
    const snap = { paths: [...[-3, -2, -1, 0, 1, 2, 3].map((i) => path(i, 0)), ...[-3, -2, -1, 1, 2, 3].map((i) => path(0, i))], slabs: [slab(4, 4), slab(5, 4)] };
    const all = stakesOf({ me: { x: 0, z: 0 }, far, snap, radius: 24, cfg: { ...DEFAULT_STAKES, others: true, junctions: true, buildings: true } });
    expect(all.map((s) => s.kind)).toEqual(["junction", "other", "building", "other"]); // bot3 beyond the view
    expect(all[1].bright).toBeCloseTo(DEFAULT_STAKES.bright);
    expect(all[3].bright).toBeLessThan(DEFAULT_STAKES.bright * 0.7);
    expect(all[3].moving).toBe(true);
    const onlyOthers = stakesOf({ me: { x: 0, z: 0 }, far, snap, radius: 24 });
    expect(onlyOthers.every((s) => s.kind === "other")).toBe(true);
    const capped = stakesOf({ me: { x: 0, z: 0 }, far, snap, radius: 24, cfg: { ...DEFAULT_STAKES, junctions: true, buildings: true, cap: 2 } });
    expect(capped.length).toBe(2);
  });
});
