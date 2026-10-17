import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { bores, carPasses } from "./bores";
import type { PEvent, RoleId } from "./types";
import { WORLD_HALF } from "./world";

const ev = (o: string, r: RoleId, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
/** A car driving along x from a to b at z, one sample per second from t0 (there and back `trips` times). */
function drive(o: string, a: number, b: number, z: number, t0: number, trips: number, speed = 4, role: RoleId = "car"): PEvent[] {
  const out: PEvent[] = [];
  const L = b - a;
  const secs = Math.ceil((2 * L * trips) / speed);
  for (let t = 0; t <= secs; t++) {
    const d = (t * speed) % (2 * L);
    out.push(ev(o, role, d < L ? a + d : b - (d - L), z, t0 + t));
  }
  return out;
}
const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;

describe("bores: cars drill the sediment under the road", () => {
  it("counts a pass per entry into a cell, not per sample; standing and crawling inside one cell is no pass", () => {
    const one = drive("c1", 0, 12, 0.6, 0, 1);
    const passes = carPasses(one);
    // one trip there and back enters each cell on the way twice (the ends once or twice)
    const mid = passes.get(key(6, 0.6))!;
    expect(mid.length).toBe(2);
    const still: PEvent[] = Array.from({ length: 30 }, (_, t) => ev("c2", "car", 20 + Math.sin(t) * 0.01, 0.6, t));
    expect(carPasses(still).size).toBe(0);
    const crawl: PEvent[] = Array.from({ length: 10 }, (_, t) => ev("c3", "car", 30.1 + t * 0.05, 0.6, t)); // 0.5 units inside one cell
    expect(carPasses(crawl).size).toBe(0);
  });

  it("only cars count; a bore opens at the Nth pass and says when", () => {
    const walkers = drive("w", 0, 12, 0.6, 0, 10, 4, "worker");
    expect(bores(walkers, { passes: 3 })).toEqual([]);
    const cars = drive("c", 0, 12, 0.6, 100, 10, 4);
    const b = bores(cars, { passes: 6 });
    expect(b.length).toBeGreaterThan(0);
    const mid = b.find((x) => x.key === key(6, 0.6))!;
    expect(mid).toBeDefined();
    expect(mid.n).toBeGreaterThanOrEqual(6);
    expect(mid.s).toBe(carPasses(cars).get(mid.key)![5]);
    // before the 6th pass there is no bore there
    expect(bores(cars, { passes: 6 }, mid.s - 1).find((x) => x.key === mid.key)).toBeUndefined();
    expect(bores(cars, { passes: 6 }, mid.s).find((x) => x.key === mid.key)).toBeDefined();
    // oldest first
    for (let i = 1; i < b.length; i++) expect(b[i].s).toBeGreaterThanOrEqual(b[i - 1].s);
  });

  it("a gap longer than a step is not a drive between the samples", () => {
    const jump: PEvent[] = [ev("j", "car", 0, 0.6, 0), ev("j", "car", 12, 0.6, 10)];
    expect(carPasses(jump).size).toBe(0);
  });

  it("drives over the world's edge count on the short way round", () => {
    const edge: PEvent[] = [ev("e", "car", WORLD_HALF - 1, 0.6, 0), ev("e", "car", -WORLD_HALF + 1, 0.6, 1)];
    const passes = carPasses(edge);
    expect(passes.size).toBeGreaterThan(0);
    expect(passes.size).toBeLessThan(5); // ~2 units, not the whole world
  });
});
