import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_WATER, buildingsOf, drainage, pipeParts, pipeSegments, straightRuns, waterDistance, waterField, type PEvent, type Seed } from "./index";

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

  it("the pipes join a quarter's buildings into ONE network that reaches every building and ends at one outfall", () => {
    const seeds = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const d = drainage([], seeds, DEFAULT_WATER, opts);
    const first = Math.min(...d.pipes.map((p) => p.k));
    const runs = d.pipes.filter((p) => p.k === first && p.k0 === undefined);
    // the runs of one epoch form one connected graph (ends meet ends or lie on other runs)
    const key = (x: number, z: number) => `${cellOf(x)},${cellOf(z)}`;
    const cells = (p: (typeof runs)[number]) => {
      const out: string[] = [];
      const n = Math.max(1, Math.round(Math.hypot(p.bx - p.ax, p.bz - p.az) / CELL_SIZE));
      for (let i = 0; i <= n; i++) out.push(key(p.ax + ((p.bx - p.ax) * i) / n, p.az + ((p.bz - p.az) * i) / n));
      return out;
    };
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const at = new Map<string, number>();
    runs.forEach((p, i) => {
      for (const c of cells(p)) {
        const j = at.get(c);
        if (j !== undefined) parent[find(i)] = find(j);
        else at.set(c, i);
      }
    });
    expect(new Set(runs.map((_, i) => find(i))).size).toBe(1);
    // every building touches the network (a pipe cell next to one of its cells)
    const net = new Set(at.keys());
    for (const [id0] of [[1], [100], [200]]) {
      const bs = seeds.filter((s) => s.id >= id0 && s.id < id0 + 99);
      const touches = bs.some((s) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => net.has(`${cellOf(s.x) + dx},${cellOf(s.z) + dz}`)));
      expect(touches).toBe(true);
    }
    // the trunk carries more than a lateral
    expect(Math.max(...runs.map((p) => p.flow))).toBeGreaterThan(Math.min(...runs.map((p) => p.flow)));
  });

  it("laid anew only when something changes: a still quarter keeps one layer, a new building adds one at its time", () => {
    const still = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const layers = (seeds: Seed[]) => new Set(drainage([], seeds, { ...DEFAULT_WATER, relay: -1 }, opts).pipes.filter((p) => p.k0 === undefined).map((p) => p.k));
    expect(layers(still).size).toBe(1);
    const later = [...still, ...block(300, 8, 8, 5, 5, 300)]; // a fourth block from t = 300 (slot 15)
    const ks = layers(later);
    expect(ks.size).toBe(2);
    expect(ks.has(15)).toBe(true);
  });

  it("pipes lie buried: pipeDepth slots below the slot they were laid in", () => {
    const d = drainage([], [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)], DEFAULT_WATER, opts);
    const segs = pipeSegments(d.pipes, 1, { ...DEFAULT_WATER, pipeDepth: 2 });
    for (let i = 0; i < d.pipes.length; i++) expect(segs[i * 7 + 1]).toBeCloseTo(d.pipes[i].k - 2, 6);
  });

  it("what was laid stays: later changes lay new layers on top, the kept pipes are not redrawn", () => {
    const first = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const a = drainage([], first, DEFAULT_WATER, opts);
    const kept = { pipes: a.pipes, streams: a.streams, upToK: 20 };
    // a new block next to the others (from t = 300 = slot 15, before upToK): it would change the old routes
    const more = [...first, ...block(300, 8, 8, 5, 5, 300)];
    const b = drainage([], more, DEFAULT_WATER, { ...opts, frozen: kept });
    for (const p of a.pipes) expect(b.pipes).toContainEqual(p);
    expect(b.pipes.filter((p) => p.k <= 20)).toHaveLength(a.pipes.length);
  });

  it("MANHOLES: where a new network runs through the old one still in use, a vertical shaft joins them", () => {
    const later = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5), ...block(300, 8, 8, 5, 5, 300)];
    const d = drainage([], later, DEFAULT_WATER, opts);
    const risers = d.pipes.filter((p) => p.k0 !== undefined);
    expect(risers.length).toBeGreaterThan(0);
    for (const r of risers) {
      expect(r.k0!).toBeLessThan(r.k);
      expect(r.ax).toBe(r.bx);
      expect(r.az).toBe(r.bz);
    }
    const segs = pipeSegments(risers, 1, DEFAULT_WATER);
    expect(segs[4]).toBeGreaterThan(segs[1]); // runs up from the older network
  });

  it("a later network draws only what is new: pipes already there (still in use) are not drawn again", () => {
    const later = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5), ...block(300, 8, 8, 5, 5, 300)];
    const d = drainage([], later, DEFAULT_WATER, opts);
    const runs = d.pipes.filter((p) => p.k0 === undefined);
    const ks = [...new Set(runs.map((p) => p.k))].sort((a, b) => a - b);
    expect(ks.length).toBeGreaterThanOrEqual(2);
    const cellsOf = (p: (typeof runs)[number]) => {
      const out: string[] = [];
      const n = Math.max(1, Math.round(Math.hypot(p.bx - p.ax, p.bz - p.az) / CELL_SIZE));
      for (let i = 0; i <= n; i++) out.push(`${cellOf(p.ax + ((p.bx - p.ax) * i) / n)},${cellOf(p.az + ((p.bz - p.az) * i) / n)}`);
      return out;
    };
    const first = new Set(runs.filter((p) => p.k === ks[0]).flatMap(cellsOf));
    // a later run shares with the first network at most the cell it branches from (each end)
    for (const p of runs.filter((r) => r.k === ks[1])) expect(cellsOf(p).filter((c) => first.has(c)).length).toBeLessThanOrEqual(2);
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

  it("old pipes corrode: their decay comes from the layer's age and thins the wall", () => {
    const seeds = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
    const d = drainage([], seeds, DEFAULT_WATER, opts);
    const fresh = pipeParts(d.pipes, 1, DEFAULT_WATER, 0);
    const old = pipeParts(d.pipes, 1, DEFAULT_WATER, 0, () => 0.8);
    const r = (c: Float32Array) => c[6], dec = (c: Float32Array) => c[7];
    expect(dec(fresh.live.cylinders)).toBe(0);
    expect(dec(old.live.cylinders)).toBeCloseTo(0.8, 6);
    expect(r(old.live.cylinders)).toBeLessThan(r(fresh.live.cylinders));
  });
});

describe("pipes join only what is still in use (reach, re-laying)", () => {
  const quarter = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5)];
  const later = [...quarter, ...block(300, 8, 8, 5, 5, 300)]; // a fourth block from slot 15
  const laid = (pipes: { k: number; k0?: number }[]) => [...new Set(pipes.filter((p) => p.k0 === undefined).map((p) => p.k))].sort((a, b) => a - b);

  it("a network in use is laid again every `relay` slots", () => {
    const ks = laid(drainage([], quarter, { ...DEFAULT_WATER, relay: 8 }, opts).pipes);
    expect(ks.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ks.length; i++) expect(ks[i] - ks[i - 1]).toBeGreaterThanOrEqual(8);
  });

  it("a manhole joins only pipes laid within `reach`; older ones are past and the network there is laid anew", () => {
    const near = drainage([], later, { ...DEFAULT_WATER, relay: -1, reach: 40 }, opts);
    const risers = near.pipes.filter((p) => p.k0 !== undefined);
    for (const r of risers) expect(r.k - r.k0!).toBeLessThanOrEqual(40);
    const far = drainage([], later, { ...DEFAULT_WATER, relay: -1, reach: 3 }, opts);
    for (const r of far.pipes.filter((p) => p.k0 !== undefined)) expect(r.k - r.k0!).toBeLessThanOrEqual(3);
    // with nothing to join, the later network is laid whole: more pipe at its slot than when it joins the old one
    const at15 = (d: typeof near) => d.pipes.filter((p) => p.k === 15 && p.k0 === undefined).length;
    expect(at15(far)).toBeGreaterThan(at15(near));
  });
});

describe("pipes as plumbing (the wrapper)", () => {
  it("every run a straight cylinder on its axis (right angles kept), a fitting at every bend, manholes upright with covers", () => {
    const seeds = [...block(1, 0, 0, 6, 6), ...block(100, 8, 0, 5, 6), ...block(200, 0, 8, 6, 5), ...block(300, 8, 8, 5, 5, 300)];
    const d = drainage([], seeds, DEFAULT_WATER, opts);
    const m = pipeParts(d.pipes, 1, DEFAULT_WATER, 20);
    const cyl = [...m.live.cylinders, ...m.kept.cylinders];
    expect(cyl.length / 8).toBeGreaterThanOrEqual(d.pipes.length);
    for (let i = 0; i < cyl.length; i += 8) {
      const [ax, ay, az, bx, by, bz, r] = cyl.slice(i, i + 8);
      // along one axis only: x, z or y (a shaft / cover)
      expect([ax !== bx, az !== bz, ay !== by].filter(Boolean)).toHaveLength(1);
      expect(r).toBeGreaterThan(0);
    }
    // right-angle bends are elbows (quarter tori) with both arms horizontal and orthogonal
    const elb = [...m.live.elbows, ...m.kept.elbows];
    expect(elb.length).toBeGreaterThan(0);
    for (let i = 0; i < elb.length; i += 11) {
      const [, , , ax, ay, az, bx, by, bz, r] = elb.slice(i, i + 11);
      expect(Math.abs(ay) + Math.abs(by)).toBeLessThan(1e-6);
      expect(Math.abs(ax * bx + az * bz)).toBeLessThan(0.05);
      expect(r).toBeGreaterThan(0);
    }
    // at least one shaft and one cover per manhole (collars come on top)
    const risers = d.pipes.filter((p) => p.k0 !== undefined).length;
    const upright = cyl.length / 8 - d.pipes.filter((p) => p.k0 === undefined).length;
    expect(upright).toBeGreaterThanOrEqual(risers * 2);
  });
});
