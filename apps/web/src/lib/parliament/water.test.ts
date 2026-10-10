import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_WATER, buildingsOf, drainage, pipeSegments, straightRuns, waterDistance, waterField, type PEvent, type Seed } from "./index";

const SPU = 20;
/** A seed on cell (cx, cz), born t0, used until t1. */
const seed = (id: number, cx: number, cz: number, t0 = 0, t1 = 600): Seed => ({ id, material: "concrete", role: "worker", x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, t0, t1, mass: 2 }) as Seed;
/** A dense block of w × d cells at (cx, cz). */
const block = (id0: number, cx: number, cz: number, w: number, d: number, t0 = 0): Seed[] => {
  const out: Seed[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push(seed(id0 + i * d + j, cx + i, cz + j, t0));
  return out;
};
const opts = { secPerUnit: SPU, flow: DEFAULT_FLOW, tNow: 600 };
const cellOf = (v: number) => Math.floor(v / CELL_SIZE);

describe("water from sealed ground: open streams, buried pipes", () => {
  it("touching seeds are one building", () => {
    const bs = buildingsOf([...block(1, 0, 0, 2, 1), seed(9, 7, 0)], DEFAULT_WATER);
    expect(bs).toHaveLength(2);
    expect(bs[0].seeds).toHaveLength(2);
  });

  it("a dense quarter drains through pipes — straight runs at right angles — that never cross a standing building", () => {
    const seeds = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const d = drainage([], seeds, DEFAULT_WATER, opts);
    expect(d.pipes.length).toBeGreaterThan(0);
    const built = new Set(seeds.map((s) => `${cellOf(s.x)},${cellOf(s.z)}`));
    for (const p of d.pipes) {
      expect(p.ax === p.bx || p.az === p.bz).toBe(true); // right angles only
      // along the run, every cell centre is free of buildings
      const n = Math.max(1, Math.round(Math.hypot(p.bx - p.ax, p.bz - p.az) / CELL_SIZE));
      for (let i = 0; i <= n; i++) {
        const x = p.ax + ((p.bx - p.ax) * i) / n, z = p.az + ((p.bz - p.az) * i) / n;
        expect(built.has(`${cellOf(x)},${cellOf(z)}`)).toBe(false);
      }
    }
    // and the water comes out in the open further on
    expect(d.streams.size).toBeGreaterThan(0);
    const segs = pipeSegments(d.pipes, 1, DEFAULT_WATER);
    expect(segs.length).toBe(d.pipes.length * 7);
  });

  it("a lone small building in open land sheds an open stream, no pipe", () => {
    const d = drainage([], [seed(1, 0, 0)], DEFAULT_WATER, opts);
    expect(d.pipes).toHaveLength(0);
    expect(d.streams.size).toBeGreaterThan(0);
    const near = waterField(d, 0, 30, DEFAULT_WATER);
    const dist = waterDistance(d, 0, 30, DEFAULT_WATER);
    const [k, courses] = [...d.streams][0];
    const c = courses[0];
    expect(near(cellOf(c[0]), cellOf(c[1]), k)).toBeGreaterThan(0.5);
    expect(dist(c[0], c[1], k)).toBeLessThan(0.3);
  });

  it("45° steps only when allowed", () => {
    const seeds = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const runs = (diagonal: number) => drainage([], seeds, { ...DEFAULT_WATER, diagonal }, opts).pipes;
    expect(runs(0).every((p) => p.ax === p.bx || p.az === p.bz)).toBe(true);
    const diag = runs(1);
    expect(diag.length).toBeGreaterThan(0);
  });

  it("pipes run under the paths: a paved path through the quarter carries the pipe", () => {
    const seeds = [...block(1, 0, 0, 5, 12), ...block(100, 7, 0, 5, 12)]; // two blocks with a street (cells x = 5, 6) between
    const walk: PEvent[] = [];
    for (let t = 0; t < 500; t++) {
      const d = (t * 1.2) % 40;
      walk.push({ id: `w${t % 3}:${t}`, o: `w${t % 3}`, r: "worker", k: "p", x: 6.6, z: d < 20 ? d - 2 : 38 - d, s: t });
    }
    const d = drainage(walk, seeds, DEFAULT_WATER, opts);
    const onStreet = d.pipes.filter((p) => cellOf(p.ax) >= 5 && cellOf(p.ax) <= 6 && cellOf(p.bx) >= 5 && cellOf(p.bx) <= 6);
    expect(onStreet.length).toBeGreaterThan(0);
  });

  it("straight runs: a route breaks only where its direction changes", () => {
    const nx = 10;
    const route = [0, 1, 2, 12, 22, 23];
    expect(straightRuns(route, nx)).toEqual([[0, 2], [2, 22], [22, 23]]);
  });

  it("off: no water", () => {
    expect(drainage([], block(1, 0, 0, 6, 6), { ...DEFAULT_WATER, enabled: false }, opts).pipes).toHaveLength(0);
  });
});
