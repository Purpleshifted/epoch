/**
 * parliament/flow.ts
 *
 * PATHS as SUSTAINED FLOW (V2), after the active-walker model of human trail systems (Helbing, Keltsch & Molnár,
 * Nature 1997): the ground keeps how trodden it is, every step treads it a little more, and when nobody walks it the
 * vegetation grows back. Only a flow that keeps going beats the regrowth and stays a path.
 *
 *   STAY / MOVE   every worker sample is split by what that person did around it, in space AND time: if within
 *                 ±staySec they stayed within stayRadius, it is a STAY (it builds, fold.ts); otherwise a MOVE (it
 *                 treads the ground; only `moveShare` of it still builds). Smooth in between.
 *   TRODDEN G     a move treads every cell along the segment from that person's previous sample (not only the cell
 *                 it lands in), by the distance walked (one crossing of a cell ≈ 1). Only FLOW counts: each tread
 *                 carries its axis (a route walked both ways is one axis), and G is the length of the decayed sum
 *                 G(cell, t) = | Σ amount · e^(−(t − s)/tauSec) · (cos 2θ, sin 2θ) |, so treads along one line add
 *                 up and milling around in a place cancels out. Path strength p = 1 − e^(−G/unit).
 *   FIRST COMES   a cell that is already a path (p ≥ blockAt) when a slab would nucleate there gets no slab — the
 *   FIRST         building moves aside; a cell on which a slab already stands is not trodden (concrete is not a path)
 *                 and bots walk around it — the path detours.
 *   BUNDLING      bots are drawn towards trodden ground (flowSteer): walking where others walked, their straight
 *                 crossings merge into a few trunks (Frei Otto's wool threads). Players see the paths in their grass.
 *
 * Pure and deterministic. Off (FoldConfig.flow absent or disabled) everything is as in V1.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { PEvent } from "./types";

export interface FlowConfig {
  enabled: boolean;
  /** STAY: within ±staySec the person stayed within this distance (world). */
  stayRadius: number;
  staySec: number;
  /** Share of a MOVE sample that still builds (keeps the buildings about as they were). */
  moveShare: number;
  /** e-folding time (exhibition seconds) with which trodden ground grows back once nobody walks it. */
  tauSec: number;
  /** Trodden-ness G at which a path is 63 % formed. */
  unit: number;
  /** Path strength at which a cell can no longer get a slab (the path came first). > 1 = never blocks. */
  blockAt: number;
  /** BOTS: how far (world) a bot is drawn towards trodden ground at most. 0 = not at all. */
  pull: number;
}

export const DEFAULT_FLOW: FlowConfig = {
  enabled: true,
  stayRadius: 1.5,
  staySec: 6,
  moveShare: 0.5,
  tauSec: 300,
  unit: 3,
  blockAt: 0.5,
  pull: 1.6,
};

/** BOTS sense trodden ground this many cells around them. */
const SENSE = 2;

/** Samples further apart than this (s) are not one walk (a pause, a jump): nothing is trodden between them. */
const MAX_STEP_SEC = 3;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-9, b - a)));
  return t * t * (3 - 2 * t);
};

export const cellKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Indices of `pres` per owner, each in time order (pres is sorted by s). */
function byOwner(pres: readonly PEvent[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (let i = 0; i < pres.length; i++) {
    const l = m.get(pres[i].o);
    if (l) l.push(i);
    else m.set(pres[i].o, [i]);
  }
  return m;
}

/**
 * STAY share (0 = moving … 1 = staying) of every sample of `pres` (sorted by s): how far the same person got from
 * it within ±staySec — 1 up to stayRadius, 0 from twice it.
 */
export function stayShares(pres: readonly PEvent[], cfg: FlowConfig): Float32Array {
  const out = new Float32Array(pres.length);
  for (const list of byOwner(pres).values()) {
    let lo = 0, hi = 0;
    for (let a = 0; a < list.length; a++) {
      const e = pres[list[a]];
      while (pres[list[lo]].s < e.s - cfg.staySec) lo++;
      while (hi + 1 < list.length && pres[list[hi + 1]].s <= e.s + cfg.staySec) hi++;
      let r = 0;
      for (let b = lo; b <= hi; b++) {
        const f = pres[list[b]];
        const d = Math.hypot(f.x - e.x, f.z - e.z);
        if (d > r) r = d;
      }
      out[list[a]] = 1 - smoothstep(cfg.stayRadius, 2 * cfg.stayRadius, r);
    }
  }
  return out;
}

/** The treads of one cell, in time order: when, how much, and along which axis (cos 2θ, sin 2θ). */
export interface Track {
  s: number[];
  a: number[];
  c: number[];
  q: number[];
}

/**
 * Every MOVE treads the cells along its segment (from the same person's previous sample), by its move share. A cell
 * whose slab already stands at that moment (`sealedFrom` ≤ s) is not trodden.
 */
export function flowTracks(
  pres: readonly PEvent[],
  stay: Float32Array,
  sealedFrom?: (key: string) => number | undefined,
): Map<string, Track> {
  const tracks = new Map<string, Track>();
  const last = new Map<string, number>();
  const seen = new Set<string>();
  for (let i = 0; i < pres.length; i++) {
    const e = pres[i];
    const pi = last.get(e.o);
    last.set(e.o, i);
    if (pi === undefined) continue;
    const p = pres[pi];
    if (e.s - p.s > MAX_STEP_SEC) continue;
    const m = 1 - (stay[i] + stay[pi]) / 2;
    if (m <= 0.01) continue;
    const len = Math.hypot(e.x - p.x, e.z - p.z);
    if (len < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(len / (CELL_SIZE * 0.5)));
    // the segment's axis (doubled angle: there and back is the same route)
    const th = Math.atan2(e.z - p.z, e.x - p.x);
    const c2 = Math.cos(2 * th), s2 = Math.sin(2 * th);
    seen.clear();
    const touched: string[] = [];
    for (let t = 0; t <= steps; t++) {
      const x = p.x + ((e.x - p.x) * t) / steps, z = p.z + ((e.z - p.z) * t) / steps;
      const key = cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
      if (seen.has(key)) continue;
      seen.add(key);
      touched.push(key);
    }
    // the walked distance, shared by the cells it crossed (in cell widths: crossing one cell ≈ 1)
    const amount = (m * len) / CELL_SIZE / touched.length;
    for (const key of touched) {
      const born = sealedFrom?.(key);
      if (born !== undefined && born <= e.s) continue; // concrete: not trodden
      const tr = tracks.get(key);
      if (tr) {
        tr.s.push(e.s);
        tr.a.push(amount);
        tr.c.push(c2);
        tr.q.push(s2);
      } else tracks.set(key, { s: [e.s], a: [amount], c: [c2], q: [s2] });
    }
  }
  return tracks;
}

/** Trodden-ness G (flow along one axis) of a track at time t (treads after t do not count). */
export function flowLevel(tr: Track | undefined, t: number, tauSec: number): number {
  if (!tr || !tr.s.length) return 0;
  // last tread at or before t
  let lo = 0, hi = tr.s.length - 1;
  if (tr.s[0] > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr.s[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  let gc = 0, gq = 0;
  for (let i = lo; i >= 0; i--) {
    const age = t - tr.s[i];
    if (age > tauSec * 8) break;
    const w = tr.a[i] * Math.exp(-age / tauSec);
    gc += w * tr.c[i];
    gq += w * tr.q[i];
  }
  return Math.hypot(gc, gq);
}

/** Path strength (0..1) from trodden-ness. */
export function flowP(g: number, cfg: FlowConfig): number {
  return 1 - Math.exp(-g / Math.max(1e-6, cfg.unit));
}

/**
 * BOTS: where a bot at (x, z) actually walks — drawn up the slope of the (blurred over ±SENSE cells) trodden ground by at most
 * `pull`, and out of cells on which a building stands (to the nearest free cell centre).
 */
export function flowSteer(
  level: (cx: number, cz: number) => number,
  x: number,
  z: number,
  cfg: FlowConfig,
  blocked?: (cx: number, cz: number) => boolean,
): [number, number] {
  const C = CELL_SIZE;
  let nx = x, nz = z;
  if (cfg.pull > 0) {
    // sensed over a few cells around: a bot notices a path SENSE cells away
    const R = SENSE;
    const blur = (wx: number, wz: number) => {
      const cx = Math.floor(wx / C), cz = Math.floor(wz / C);
      let s = 0;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) s += level(cx + dx, cz + dz);
      return s / ((2 * R + 1) * (2 * R + 1));
    };
    const gx = (blur(x + R * C, z) - blur(x - R * C, z)) / (2 * R * C);
    const gz = (blur(x, z + R * C) - blur(x, z - R * C)) / (2 * R * C);
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-6) {
      const amount = cfg.pull * Math.tanh((gl * C * 2) / Math.max(1e-6, cfg.unit));
      nx += (gx / gl) * amount;
      nz += (gz / gl) * amount;
    }
  }
  if (blocked && blocked(Math.floor(nx / C), Math.floor(nz / C))) {
    const cx = Math.floor(nx / C), cz = Math.floor(nz / C);
    let best: [number, number] | null = null, bd = Infinity;
    for (let r = 1; r <= 3 && !best; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || blocked(cx + dx, cz + dz)) continue;
        const px = (cx + dx + 0.5) * C, pz = (cz + dz + 0.5) * C;
        const d = Math.hypot(px - nx, pz - nz);
        if (d < bd) {
          bd = d;
          best = [px, pz];
        }
      }
    }
    if (best) [nx, nz] = best;
  }
  return [nx, nz];
}

/** What bots walk on: trodden-ness G per cell key, and the cells buildings stand on. */
export interface FlowGround {
  level: (key: string) => number;
  built: (key: string) => boolean;
}

/** Cells of room around a migration's bounding box in which its route may wander. */
const ROUTE_MARGIN = 6;
/** Walking a built cell costs this many times more (a route goes round buildings). */
const BUILT_COST = 25;
/** On a full path walking costs 1 / (1 + TRAIL_EASE) (trodden ground is easier). */
const TRAIL_EASE = 2;

/**
 * The route a migration takes from (ax, az) to (bx, bz): the cheapest way over the grid (8 neighbours), where trodden
 * ground is easier and built cells are dear — so routes follow and reinforce each other (bundling) and go round
 * buildings (detour). A polyline from A to B through cell centres.
 */
export function flowRoute(ax: number, az: number, bx: number, bz: number, ground: FlowGround, cfg: FlowConfig): number[] {
  const C = CELL_SIZE;
  const sx = Math.floor(ax / C), sz = Math.floor(az / C), tx = Math.floor(bx / C), tz = Math.floor(bz / C);
  if (sx === tx && sz === tz) return [ax, az, bx, bz];
  const x0 = Math.min(sx, tx) - ROUTE_MARGIN, z0 = Math.min(sz, tz) - ROUTE_MARGIN;
  const nx = Math.abs(tx - sx) + 2 * ROUTE_MARGIN + 1, nz = Math.abs(tz - sz) + 2 * ROUTE_MARGIN + 1;
  const n = nx * nz;
  const cost = new Float32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const key = cellKey(x0 + i, z0 + j);
    const p = flowP(ground.level(key), cfg);
    cost[j * nx + i] = (1 / (1 + TRAIL_EASE * p)) * (ground.built(key) ? BUILT_COST : 1);
  }
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const start = (sz - z0) * nx + (sx - x0), goal = (tz - z0) * nx + (tx - x0);
  dist[start] = 0;
  // binary heap of (dist, node)
  const heap: number[] = [start];
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
  while (heap.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    const ui = u % nx, uj = (u - ui) / nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const vi = ui + di, vj = uj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi;
      if (done[v]) continue;
      const step = (di && dj ? Math.SQRT2 : 1) * (cost[u] + cost[v]) * 0.5;
      const d = dist[u] + step;
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
        push(v);
      }
    }
  }
  const cells: number[] = [];
  for (let v = goal; v >= 0; v = prev[v]) {
    cells.push(v);
    if (v === start) break;
  }
  cells.reverse();
  const out: number[] = [ax, az];
  for (let k = 1; k < cells.length - 1; k++) {
    const i = cells[k] % nx, j = (cells[k] - i) / nx;
    out.push((x0 + i + 0.5) * C, (z0 + j + 0.5) * C);
  }
  out.push(bx, bz);
  return out;
}

/** The point at share m (0 … 1) of a polyline's length. */
export function alongRoute(route: readonly number[], m: number): [number, number] {
  let total = 0;
  for (let k = 2; k < route.length; k += 2) total += Math.hypot(route[k] - route[k - 2], route[k + 1] - route[k - 1]);
  let left = Math.max(0, Math.min(1, m)) * total;
  for (let k = 2; k < route.length; k += 2) {
    const seg = Math.hypot(route[k] - route[k - 2], route[k + 1] - route[k - 1]);
    if (left <= seg || k === route.length - 2) {
      const t = seg > 0 ? Math.min(1, left / seg) : 1;
      return [route[k - 2] + (route[k] - route[k - 2]) * t, route[k - 1] + (route[k + 1] - route[k - 1]) * t];
    }
    left -= seg;
  }
  return [route[route.length - 2], route[route.length - 1]];
}

/** A bot's plan (bots.botPlan), as the flow needs it. */
export interface FlowBotPlan {
  ep: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  m: number;
  ox: number;
  oz: number;
}

/**
 * V2: where bot `id` actually walks. MIGRATING (0 < m < 1 between two flocks) it follows its migration's route
 * (flowRoute, chosen once per migration on the ground as it was then and kept in `routes`), its wandering damped;
 * otherwise it wanders as in V1, drawn a little up trodden ground (flowSteer).
 */
export function steerBot(id: string, b: FlowBotPlan, ground: FlowGround, cfg: FlowConfig, routes: Map<string, number[]>): [number, number] {
  const moving = b.m > 0 && b.m < 1 && Math.hypot(b.bx - b.ax, b.bz - b.az) > CELL_SIZE * 2;
  if (moving) {
    const key = `${id}:${b.ep}`;
    let route = routes.get(key);
    if (!route) {
      route = flowRoute(b.ax, b.az, b.bx, b.bz, ground, cfg);
      routes.set(key, route);
    }
    const [x, z] = alongRoute(route, b.m);
    const damp = 1 - 0.8 * Math.sin(Math.PI * b.m); // continuous at both ends
    return [x + b.ox * damp, z + b.oz * damp];
  }
  const cx = b.ax + (b.bx - b.ax) * b.m, cz = b.az + (b.bz - b.az) * b.m;
  return flowSteer((i, j) => ground.level(cellKey(i, j)), cx + b.ox, cz + b.oz, cfg);
}
