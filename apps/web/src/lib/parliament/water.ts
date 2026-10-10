/**
 * parliament/water.ts
 *
 * WATER as what the ground can no longer take: rain runs off where people sealed it (buildings, paved paths) —
 * the rational method's Q = C · i · A, with C ≈ 0.9 on roofs and paving and ≈ 0.1 on vegetation — and urban
 * streams respond to the SEALED SHARE of their surroundings (the Impervious Cover Model: impacted from ~10 %, past
 * ~25 % buried in pipes; "urban stream burial").
 *
 *   EPOCHS       the drainage is laid out anew every `everySlots` slots, at the epoch's start time t
 *   SEALED       a cell is sealed at t when a building stands on it (its seed was born by t) or a path is paved on
 *                it (path strength ≥ `pathAt`, flow.ts); its SEALED SHARE is the sealed fraction within
 *                `imperviousRadius` cells
 *   SOURCES      every building in use at t (used within `persistSec`) sheds its runoff (its area), from the edge of
 *                its block
 *   NETWORK      dense buildings within `quarterGap` of each other form a QUARTER with one sewer network: a TRUNK
 *                from the quarter's nearest building to the outfall, then LATERALS from every other building to the
 *                network (nearest to the outfall first) — so the pipes join the buildings into one tree
 *   ROUTE        a route drains to the nearest OPEN ground (trunk) or to the network (laterals) (sealed share < `openShare`, not sealed): the cheapest
 *                way over the grid — along the paths (sewers run under streets), joining the pipes already laid,
 *                never through a building that stands (past buildings are gone round). Right angles only, or 45°
 *                too (`diagonal`); straight runs, bends at the cells where the direction changes
 *   PIPE / OPEN  a building in a sealed quarter (the mean sealed share over its cells ≥ `burial`) drains through a
 *                PIPE all the way to the outlet (a storm sewer and its outfall): buried, drawn as straight grey
 *                conduits — the whole network of an epoch at the epoch's slot, so every layer of the timespace
 *                shows the sewers of its time beside its buildings, and keeps them (a technofossil). From the outfall — or right
 *                from its edge, for a building in open land — the water runs as an OPEN stream (a clear channel in
 *                the vegetation, lined with wetland) for `streamLength` before it soaks away
 *   SIZE         a pipe's or stream's flow is the runoff of everything upstream: trunks thicker than branches
 *
 * The open water is not drawn itself: its course is a channel in the vegetation (no points within `channel`/2),
 * lined with WETLAND vegetation (waterField → natureHistory.waterBoost, waterDistance → naturePoints.water), and
 * parts near it corrode faster (WearConfig.water). Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, flowLevel, flowP, flowTracks, stayShares, type FlowConfig, type Track } from "./flow";
import { hash2 } from "./nature";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";

export interface WaterConfig {
  enabled: boolean;
  /** Seeds within this many cells belong to the same building. */
  join: number;
  /** The drainage is laid out anew every this many slots. */
  everySlots: number;
  /** Cells around a cell over which its sealed share is taken. */
  imperviousRadius: number;
  /** Sealed share from which water runs in a pipe. */
  burial: number;
  /** Sealed share below which the ground takes the water again (an outlet). */
  openShare: number;
  /** Path strength from which a path counts as paved (sealed). */
  pathAt: number;
  /** 0 = right angles only; > 0 = 45° steps allowed, costing 1 + (1 − diagonal) more. */
  diagonal: number;
  /** World length an open stream runs on beyond its outlet. */
  streamLength: number;
  /** Seconds a building keeps shedding water after it was last used. */
  persistSec: number;
  /** How far an open stream bends sideways (× cell). */
  meander: number;
  /** Width of the clear channel an open stream keeps in the vegetation (world). */
  channel: number;
  /** Reach of an open stream's influence on vegetation and parts (world). */
  radius: number;
  /** Vegetation density added right at the water (fades to 0 at `radius`). */
  vegBoost: number;
  /** Share of the vegetation at the water that is wetland (coloured as such), fading to 0 at `radius`. */
  wetShare: number;
  /** Parts at the open water age × (1 + corrode) while exposed (fades with distance). */
  corrode: number;
  /** Radius (world) of a pipe carrying one building's runoff; × √(flow / that). */
  pipeRadius: number;
  /** Dense buildings within this distance (world) share one sewer network and outfall (a quarter). */
  quarterGap: number;
}

export const DEFAULT_WATER: WaterConfig = {
  enabled: true,
  join: 1,
  everySlots: 10,
  imperviousRadius: 3,
  burial: 0.25,
  openShare: 0.1,
  pathAt: 0.35,
  diagonal: 0,
  streamLength: 8,
  persistSec: 300,
  meander: 0.18,
  channel: 0.9,
  radius: 2.5,
  vegBoost: 1,
  wetShare: 1,
  corrode: 1.5,
  pipeRadius: 0.06,
  quarterGap: 10,
};

export interface Building {
  id: number;
  seeds: Seed[];
  /** First birth and last use of its seeds (exhibition seconds). */
  t0: number;
  lastS: number;
}

/** Seeds grouped into buildings: those within `join` cells of each other (union–find). */
export function buildingsOf(seeds: readonly Seed[], cfg: Pick<WaterConfig, "join">): Building[] {
  const cellOf = (s: Seed) => [Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE)] as const;
  const parent = seeds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map<string, number[]>();
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    const key = cellKey(cx, cz);
    const l = at.get(key);
    if (l) l.push(i);
    else at.set(key, [i]);
  });
  const J = Math.max(1, Math.round(cfg.join));
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    for (let dx = -J; dx <= J; dx++) {
      for (let dz = -J; dz <= J; dz++) {
        for (const j of at.get(cellKey(cx + dx, cz + dz)) ?? []) {
          const a = find(i), b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  });
  const groups = new Map<number, Seed[]>();
  seeds.forEach((s, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(s);
    else groups.set(r, [s]);
  });
  const out: Building[] = [];
  for (const list of groups.values()) {
    out.push({ id: Math.min(...list.map((s) => s.id)), seeds: list, t0: Math.min(...list.map((s) => s.t0)), lastS: Math.max(...list.map((s) => s.t1)) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** A pipe run: straight from a to b (world x, z), laid in slot k, carrying `flow` (buildings' runoff, in cells). */
export interface PipeRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  k: number;
  flow: number;
}

/** The water of the whole history. */
export interface Drainage {
  /** Open streams per slot: their courses (polylines [x, z, …] in world). */
  streams: Map<number, Float32Array[]>;
  /** Every pipe run, at the slot it was laid. */
  pipes: PipeRun[];
}

export const NO_DRAINAGE: Drainage = { streams: new Map(), pipes: [] };

export interface DrainageOptions {
  secPerUnit: number;
  /** How stays are told from moves when paths are read from the movement (flow.ts). */
  flow: FlowConfig;
  /** Present (exhibition seconds): the last epoch ends here. */
  tNow: number;
}

/** Cells of room around everything (sources, buildings) in which routes may run. */
const MARGIN = 10;
/** Walking costs over the grid: under a path, along an existing pipe, elsewhere. */
const COST_PATH = 0.3;
const COST_PIPE = 0.12;
const COST_GROUND = 1;

/**
 * The drainage of the history: per epoch, the sealed ground, each source's route to open ground (cheapest over the
 * grid, along paths and existing pipes, round standing buildings), split into PIPE runs (sealed share ≥ burial) and
 * OPEN streams (the rest, and `streamLength` beyond the outlet). Pipes, once laid, stay (they are reused and cheap).
 */
export function drainage(events: readonly PEvent[], seeds: readonly Seed[], cfg: WaterConfig, opts: DrainageOptions): Drainage {
  if (!cfg.enabled || !seeds.length) return NO_DRAINAGE;
  const spu = opts.secPerUnit;
  const every = Math.max(1, Math.round(cfg.everySlots));
  // paths from the movement (the same rule for V1 and V2: water reads paths, it does not make them)
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tracks: Map<string, Track> = pres.length ? flowTracks(pres, stayShares(pres, opts.flow)) : new Map();

  // the grid: everything any building touches, with margin
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of seeds) {
    const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz);
    maxZ = Math.max(maxZ, cz);
  }
  const x0 = minX - MARGIN, z0 = minZ - MARGIN;
  const nx = maxX - minX + 1 + 2 * MARGIN, nz = maxZ - minZ + 1 + 2 * MARGIN;
  const n = nx * nz;
  const idx = (cx: number, cz: number) => (cz - z0) * nx + (cx - x0);
  const centre = (c: number): [number, number] => [(x0 + (c % nx) + 0.5) * CELL_SIZE, (z0 + Math.floor(c / nx) + 0.5) * CELL_SIZE];

  const buildings = buildingsOf(seeds, cfg);
  const piped = new Uint8Array(n); // cells a pipe has been laid through (persist)

  const streams = new Map<number, Float32Array[]>();
  const pipes: PipeRun[] = [];

  const kLast = Math.floor(opts.tNow / spu);
  const kFirst = Math.floor(Math.min(...buildings.map((b) => b.t0)) / spu);
  for (let e = Math.floor(kFirst / every) * every; e <= kLast; e += every) {
    const t = e * spu;
    // sealed ground at t: standing buildings and paved paths
    const sealed = new Uint8Array(n);
    const block = new Int32Array(n).fill(-1); // building on the cell (impassable)
    for (const b of buildings) {
      for (const s of b.seeds) {
        if (s.t0 > t) continue;
        const c = idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE));
        sealed[c] = 1;
        block[c] = b.id;
      }
    }
    const path = new Uint8Array(n);
    for (const [key, tr] of tracks) {
      const [cx, cz] = key.split(",").map(Number);
      if (cx < x0 || cz < z0 || cx >= x0 + nx || cz >= z0 + nz) continue;
      if (flowP(flowLevel(tr, t, opts.flow.tauSec), opts.flow) >= cfg.pathAt) {
        const c = idx(cx, cz);
        path[c] = 1;
        sealed[c] = 1;
      }
    }
    // sealed share (box sum over the radius, via a summed-area table)
    const R = Math.max(1, Math.round(cfg.imperviousRadius));
    const sat = new Float64Array((nx + 1) * (nz + 1));
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) sat[(j + 1) * (nx + 1) + i + 1] = sealed[j * nx + i] + sat[j * (nx + 1) + i + 1] + sat[(j + 1) * (nx + 1) + i] - sat[j * (nx + 1) + i];
    const share = new Float32Array(n);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = Math.max(0, i - R), b = Math.min(nx - 1, i + R), c = Math.max(0, j - R), d = Math.min(nz - 1, j + R);
      const sum = sat[(d + 1) * (nx + 1) + b + 1] - sat[c * (nx + 1) + b + 1] - sat[(d + 1) * (nx + 1) + a] + sat[c * (nx + 1) + a];
      share[j * nx + i] = sum / ((b - a + 1) * (d - c + 1));
    }
    // sources: buildings in use
    const live = buildings.filter((b) => b.t0 <= t && b.lastS + cfg.persistSec >= t).sort((p, q) => q.seeds.length - p.seeds.length || p.id - q.id);
    if (!live.length) continue;
    const isOpen = (c: number) => !sealed[c] && share[c] < cfg.openShare;
    const meanShare = (b: Building) => b.seeds.reduce((a, s) => a + share[idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE))], 0) / b.seeds.length;
    const dense = live.filter((b) => meanShare(b) >= cfg.burial);
    const sparse = live.filter((b) => meanShare(b) < cfg.burial);
    const courses: Float32Array[] = [];
    const pipeEdges = new Set<string>(); // this epoch's runs "a>b" (cell indices), each drawn once

    // QUARTERS: dense buildings near each other share one sewer network and one outfall
    for (const quarter of quartersOf(dense, cfg.quarterGap)) {
      const down = new Int32Array(n).fill(-2); // network: the next cell towards the outfall (−1 = the outfall)
      const inNet = (c: number) => down[c] !== -2;
      const routes: number[][] = [];
      const entry = new Map<number, number>(); // building → the cell its water enters the network at
      // the trunk: from the quarter's nearest building edge to open ground
      const trunk = routeOut(quarter, block, path, piped, nx, nz, idx, cfg, isOpen);
      if (!trunk) continue;
      for (let i = 0; i < trunk.cells.length; i++) down[trunk.cells[i]] = i + 1 < trunk.cells.length ? trunk.cells[i + 1] : -1;
      routes.push(trunk.cells);
      entry.set(trunk.from, trunk.cells[0]);
      // laterals: every other building to the network, nearest to the outfall first
      const [ox, oz] = centre(trunk.cells[trunk.cells.length - 1]);
      const rest = quarter
        .filter((b) => b.id !== trunk.from)
        .map((b) => ({ b, d: Math.min(...b.seeds.map((s) => Math.hypot(s.x - ox, s.z - oz))) }))
        .sort((p, q) => p.d - q.d || p.b.id - q.b.id);
      for (const { b } of rest) {
        const lat = routeOut([b], block, path, piped, nx, nz, idx, cfg, inNet);
        if (!lat) continue;
        for (let i = 0; i + 1 < lat.cells.length; i++) down[lat.cells[i]] = lat.cells[i + 1];
        routes.push(lat.cells);
        entry.set(b.id, lat.cells[0]);
      }
      // flow: every building's runoff, down the network to the outfall
      const flowAt = new Float32Array(n);
      for (const b of quarter) {
        let c = entry.get(b.id) ?? -1;
        for (let guard = 0; c >= 0 && guard < n; guard++) {
          flowAt[c] += b.seeds.length;
          c = down[c];
        }
      }
      for (const r of routes) {
        for (const c of r) piped[c] = 1;
        for (const [a2, z2] of straightRuns(r, nx)) {
          const key = `${a2}>${z2}`;
          if (pipeEdges.has(key) || pipeEdges.has(`${z2}>${a2}`)) continue;
          pipeEdges.add(key);
          const [ax, az] = centre(a2), [bx, bz] = centre(z2);
          pipes.push({ ax, az, bx, bz, k: e, flow: Math.max(flowAt[a2], flowAt[z2], 1) });
        }
      }
      // the outfall: the water comes out into the open and runs on
      courses.push(openCourse([trunk.cells[trunk.cells.length - 1]], share, nx, nz, centre, cfg, quarter[0].id, e));
    }
    // buildings in open land: an open stream from their edge
    for (const b of sparse) {
      const r = routeOut([b], block, path, piped, nx, nz, idx, cfg, isOpen);
      if (r) courses.push(openCourse(r.cells, share, nx, nz, centre, cfg, b.id, e));
    }
    for (let k = e; k < e + every; k++) if (courses.length) streams.set(k, courses);
  }
  return { streams, pipes };
}

/**
 * A building's way out to open ground: Dijkstra from the free cells around its block (multi-source) to the first
 * cell that is open (sealed share < openShare, not sealed) — cheap under paths and along laid pipes, never through
 * a standing building; right angles, or also 45° (`diagonal` > 0). Cell indices from the building's edge outwards.
 */
function routeOut(
  from: readonly Building[],
  block: Int32Array,
  path: Uint8Array,
  piped: Uint8Array,
  nx: number,
  nz: number,
  idx: (cx: number, cz: number) => number,
  cfg: WaterConfig,
  isGoal: (c: number) => boolean,
): { cells: number[]; from: number } | null {
  const n = nx * nz;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap: number[] = [];
  const push = (v: number) => {
    heap.push(v);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  // the block's edge: free cells next to it — those on a path (or touching one) if any: a building drains into the
  // sewer under its street, not out of its back
  const edge = new Set<number>();
  const owner = new Map<number, number>(); // edge cell → its building
  for (const b of from) {
    for (const s of b.seeds) {
      const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = idx(cx + dx, cz + dz);
        if (c < 0 || c >= n || block[c] >= 0) continue;
        edge.add(c);
        if (!owner.has(c)) owner.set(c, b.id);
      }
    }
  }
  const onStreet = [...edge].filter((c) => {
    if (path[c]) return true;
    const i = c % nx, j = (c - i) / nx;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
      const ii = i + di, jj = j + dj;
      return ii >= 0 && jj >= 0 && ii < nx && jj < nz && path[jj * nx + ii] === 1;
    });
  });
  for (const c of onStreet.length ? onStreet : edge) {
    dist[c] = 0;
    push(c);
  }
  const steps: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  if (cfg.diagonal > 0) {
    const d = Math.SQRT2 * (1 + (1 - Math.min(1, cfg.diagonal)));
    steps.push([1, 1, d], [1, -1, d], [-1, 1, d], [-1, -1, d]);
  }
  let goal = -1;
  while (heap.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (isGoal(u)) {
      goal = u;
      break;
    }
    const ui = u % nx, uj = (u - ui) / nx;
    for (const [di, dj, len] of steps) {
      const vi = ui + di, vj = uj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi;
      if (done[v] || block[v] >= 0) continue;
      // no corner cutting past a building on a diagonal
      if (di && dj && (block[uj * nx + vi] >= 0 || block[vj * nx + ui] >= 0)) continue;
      const cost = piped[v] ? COST_PIPE : path[v] ? COST_PATH : COST_GROUND;
      const dd = dist[u] + len * cost;
      if (dd < dist[v]) {
        dist[v] = dd;
        prev[v] = u;
        push(v);
      }
    }
  }
  if (goal < 0) return null;
  const out: number[] = [];
  for (let v = goal; v >= 0; v = prev[v]) out.push(v);
  out.reverse();
  return { cells: out, from: owner.get(out[0]) ?? from[0].id };
}

/** Dense buildings grouped into QUARTERS: those whose seeds come within `gap` (world) of each other. */
function quartersOf(bs: readonly Building[], gap: number): Building[][] {
  const parent = bs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      let near = false;
      for (const p of bs[i].seeds) {
        for (const q of bs[j].seeds) if (Math.hypot(p.x - q.x, p.z - q.z) <= gap) {
          near = true;
          break;
        }
        if (near) break;
      }
      if (near) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, Building[]>();
  bs.forEach((b, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(b);
    else groups.set(r, [b]);
  });
  return [...groups.values()];
}

/** A cell route as straight runs: [first cell, last cell] of every stretch in one direction. */
export function straightRuns(route: readonly number[], nx: number): [number, number][] {
  const runs: [number, number][] = [];
  if (route.length < 2) return runs;
  const dir = (a: number, b: number) => `${(b % nx) - (a % nx)},${Math.floor(b / nx) - Math.floor(a / nx)}`;
  let start = route[0];
  let d = dir(route[0], route[1]);
  for (let i = 1; i < route.length - 1; i++) {
    const dn = dir(route[i], route[i + 1]);
    if (dn !== d) {
      runs.push([start, route[i]]);
      start = route[i];
      d = dn;
    }
  }
  runs.push([start, route[route.length - 1]]);
  return runs;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const a = hash2(i, seed, 211), b = hash2(i + 1, seed, 211);
  return a + (b - a) * smooth(t - i);
}

/**
 * An open stream: the open part of a route, then on down the falling sealed share for `streamLength` (it soaks
 * away), as a meandering polyline through the cell centres (corners rounded).
 */
function openCourse(route: number[], share: Float32Array, nx: number, nz: number, centre: (c: number) => [number, number], cfg: WaterConfig, id: number, e: number): Float32Array {
  const cells = route.slice();
  // on, away from the sealed ground
  let cur = cells[cells.length - 1];
  let left = cfg.streamLength / CELL_SIZE;
  const seen = new Set(cells);
  while (left > 0) {
    const ci = cur % nx, cj = Math.floor(cur / nx);
    let best = -1, bs = Infinity;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const vi = ci + di, vj = cj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi;
      if (seen.has(v)) continue;
      const s = share[v] + hash2(v, e, 5) * 0.02;
      if (s < bs) {
        bs = s;
        best = v;
      }
    }
    if (best < 0) break;
    cells.push(best);
    seen.add(best);
    cur = best;
    left -= 1;
  }
  const pts: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = centre(cells[i]);
    const b = (noise1(i * 0.5 + e * 0.03, id % 100003) * 2 - 1) * cfg.meander * CELL_SIZE * 2;
    pts.push(x + b, z - b);
  }
  // round the corners (Chaikin, once), ends kept
  if (pts.length < 6) return Float32Array.from(pts);
  const q: number[] = [pts[0], pts[1]];
  for (let k = 0; k + 3 < pts.length; k += 2) q.push(0.75 * pts[k] + 0.25 * pts[k + 2], 0.75 * pts[k + 1] + 0.25 * pts[k + 3], 0.25 * pts[k] + 0.75 * pts[k + 2], 0.25 * pts[k + 1] + 0.75 * pts[k + 3]);
  q.push(pts[pts.length - 2], pts[pts.length - 1]);
  return Float32Array.from(q);
}

/**
 * Nearness to open water per (cell, slot) within [k0, k1]: 1 at a course, 0 at `radius`. Returns a lookup
 * (ix, iz, k) → 0..1.
 */
export function waterField(d: Drainage, k0: number, k1: number, cfg: WaterConfig): (ix: number, iz: number, k: number) => number {
  const key3 = (ix: number, iz: number, k: number) => (k * 4096 + (ix + 2048)) * 4096 + (iz + 2048);
  const m = new Map<number, number>();
  const R = Math.max(0.1, cfg.radius);
  const r = Math.ceil(R / CELL_SIZE);
  for (const [k, courses] of d.streams) {
    if (k < k0 || k > k1) continue;
    for (const c of courses) {
      for (let p = 0; p < c.length; p += 2) {
        const x = c[p], z = c[p + 1];
        const cx0 = Math.floor(x / CELL_SIZE), cz0 = Math.floor(z / CELL_SIZE);
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const ix = cx0 + dx, iz = cz0 + dz;
            const dd = Math.hypot((ix + 0.5) * CELL_SIZE - x, (iz + 0.5) * CELL_SIZE - z);
            if (dd >= R) continue;
            const key = key3(ix, iz, k);
            const w = 1 - dd / R;
            if (w > (m.get(key) ?? 0)) m.set(key, w);
          }
        }
      }
    }
  }
  return (ix, iz, k) => m.get(key3(ix, iz, k)) ?? 0;
}

/**
 * Distance (world) from (x, z) to the nearest open stream in slot k, within [k0, k1]; Infinity where none is near.
 * Courses are sampled every ~0.25 and bucketed, so a lookup checks only nearby samples.
 */
export function waterDistance(d: Drainage, k0: number, k1: number, cfg: WaterConfig): (x: number, z: number, k: number) => number {
  const B = Math.max(CELL_SIZE, cfg.radius);
  const key3 = (bx: number, bz: number, k: number) => (k * 4096 + (bx + 2048)) * 4096 + (bz + 2048);
  const buckets = new Map<number, number[]>();
  for (const [k, courses] of d.streams) {
    if (k < k0 || k > k1) continue;
    for (const c of courses) {
      for (let p = 0; p + 2 < c.length; p += 2) {
        const xa = c[p], za = c[p + 1], xb = c[p + 2], zb = c[p + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(xb - xa, zb - za) / 0.25));
        for (let s = 0; s <= steps; s++) {
          const x = xa + ((xb - xa) * s) / steps, z = za + ((zb - za) * s) / steps;
          const key = key3(Math.floor(x / B), Math.floor(z / B), k);
          const list = buckets.get(key);
          if (list) list.push(x, z);
          else buckets.set(key, [x, z]);
        }
      }
    }
  }
  return (x, z, k) => {
    const bx = Math.floor(x / B), bz = Math.floor(z / B);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = buckets.get(key3(bx + dx, bz + dz, k));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) {
          const dd = Math.hypot(list[i] - x, list[i + 1] - z);
          if (dd < best) best = dd;
        }
      }
    }
    return best;
  };
}

/** Pipe runs as cylinders: [ax, ay, az, bx, by, bz, radius] × n, at their slot's floor. */
export function pipeSegments(pipes: readonly PipeRun[], unit: number, cfg: WaterConfig): Float32Array {
  const out = new Float32Array(pipes.length * 7);
  pipes.forEach((p, i) => {
    const y = p.k * unit + 0.05;
    out.set([p.ax, y, p.az, p.bx, y, p.bz, cfg.pipeRadius * Math.sqrt(Math.max(1, p.flow))], i * 7);
  });
  return out;
}
