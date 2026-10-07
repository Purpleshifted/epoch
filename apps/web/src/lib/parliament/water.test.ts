import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_WATER, buildingsOf, waterCourse, waterField, waterLinks, waterRibbons, type Seed } from "./index";

const SPU = 30;
/** A seed at cell (cx, cz), alive t0…t1, big from `bigAt` (raw 1 before, 2 after), built by `who`. */
const seed = (id: number, cx: number, cz: number, t0: number, t1: number, bigAt: number | null, who: [string, number, number][]): Seed => ({
  id,
  material: "concrete",
  role: "worker",
  x: (cx + 0.5) * CELL_SIZE,
  z: (cz + 0.5) * CELL_SIZE,
  t0,
  t1,
  mass: bigAt === null ? 1 : 2,
  growth: bigAt === null ? [[t0, 1]] : [[t0, 1], [bigAt, 2]],
  who: who.map(([o, first, last]) => ({ o, first, last, amount: 20 })),
});

describe("waterways: between big buildings that the same people built", () => {
  // building A: two touching cells; building B: 6 cells away; both big, "p" built both
  const A = [seed(1, 0, 0, 0, 400, 100, [["p", 0, 300], ["q", 0, 400]]), seed(2, 1, 0, 10, 400, null, [["q", 10, 400]])];
  const B = [seed(3, 7, 0, 50, 500, 150, [["p", 200, 500], ["r", 50, 500]])];

  it("touching seeds are one building", () => {
    const bs = buildingsOf([...A, ...B], DEFAULT_WATER);
    expect(bs).toHaveLength(2);
    expect(bs[0].seeds).toHaveLength(2);
    expect(bs[0].bigS).toBe(100);
  });

  it("a shared builder joins two big buildings, from when both were big and he had built both", () => {
    const ls = waterLinks([...A, ...B], DEFAULT_WATER, 1000);
    expect(ls).toHaveLength(1);
    expect(ls[0].via).toBe("p");
    expect(ls[0].t0).toBe(200); // B big at 150, but p first built B at 200
    expect(ls[0].t1).toBe(500 + DEFAULT_WATER.persistSec);
    expect(waterLinks([...A, ...B], DEFAULT_WATER, 199)).toHaveLength(0); // not yet
  });

  it("no water without a shared builder, without both being big, or too far apart", () => {
    const B2 = [seed(3, 7, 0, 50, 500, 150, [["r", 50, 500]])];
    expect(waterLinks([...A, ...B2], DEFAULT_WATER, 1000)).toHaveLength(0);
    const Bsmall = [seed(3, 7, 0, 50, 500, null, [["p", 200, 500]])];
    expect(waterLinks([...A, ...Bsmall], DEFAULT_WATER, 1000)).toHaveLength(0);
    expect(waterLinks([...A, ...B], { ...DEFAULT_WATER, reach: 3 }, 1000)).toHaveLength(0); // 7 cells apart
  });

  it("the course runs from one to the other, bends, and the field is 1 at the water", () => {
    const [l] = waterLinks([...A, ...B], DEFAULT_WATER, 1000);
    const c = waterCourse(l, 10, DEFAULT_WATER);
    expect(c[0]).toBeCloseTo(l.ax, 6);
    expect(c[c.length - 2]).toBeCloseTo(l.bx, 6);
    expect(waterCourse(l, 10, DEFAULT_WATER)).toEqual(c);
    expect(waterCourse(l, 60, DEFAULT_WATER)).not.toEqual(c); // drifts through time
    const f = waterField([l], 0, 20, SPU, DEFAULT_WATER);
    const mid = [c[Math.floor(c.length / 4) * 2], c[Math.floor(c.length / 4) * 2 + 1]];
    expect(f(Math.floor(mid[0] / CELL_SIZE), Math.floor(mid[1] / CELL_SIZE), 10)).toBeGreaterThan(0.3);
    expect(f(Math.floor(mid[0] / CELL_SIZE), Math.floor(mid[1] / CELL_SIZE) + 6, 10)).toBe(0);
    expect(f(Math.floor(mid[0] / CELL_SIZE), Math.floor(mid[1] / CELL_SIZE), 2)).toBe(0); // before it flows
  });

  it("ribbons: one strip per flowing slot", () => {
    const [l] = waterLinks([...A, ...B], DEFAULT_WATER, 1000);
    const m = waterRibbons([l], 0, 100, SPU, 1, DEFAULT_WATER);
    expect(m.index.length % 3).toBe(0);
    const ys = new Set<number>();
    for (let i = 1; i < m.position.length; i += 3) ys.add(Math.floor(m.position[i]));
    expect(ys.size).toBe(Math.floor(l.t1 / SPU) - Math.floor(l.t0 / SPU) + 1);
  });
});
