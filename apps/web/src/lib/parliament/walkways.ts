/**
 * parliament/walkways.ts
 *
 * WALKWAYS (V2) — the PRE-LAYER as lines. BUILDINGS are the places; a walkway is a LINK between two of them, laid
 * where people keep walking from one to the other, so it never comes before its buildings.
 *
 *   TRODDEN      the ground keeps how trodden it is (flow.ts: treads along each move, fading with regrowth, counting
 *                only movement along one axis); path strength p = 1 − e^(−G/unit) per cell
 *   ROUTE        from each building, the cheapest way over the grid to the buildings it reaches directly (a route stops
 *                at the first building it meets): cheap on trodden ground, never through a standing building nor a
 *                pipe running at the walkway's height
 *   LINK         built when the ground along the route is trodden to `buildAt` on average (sustained flow), at most
 *                `maxSpan` long
 *   LINE         the route as a smooth line (Chaikin, `smooth` passes) at its layer's height
 *   LAYERS       a layer is laid when the links change (by `change` of them, at most every `minGapSlots`); it draws only
 *                its NEW links — a link drawn below within `joinSlots` and still walked stands as it is, and a new link
 *                starting at one of its buildings RAMPS up from its end (the line's height rising over `rampLength`).
 *                Layers within the present thickness are drawn anew with every call (they follow the trodden ground as
 *                it is now); only those below it are kept (WalkOptions.frozen).
 *
 * Pure and deterministic. The visual wrapper (a deck around the lines) comes later.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, flowP, flowTracks, stayShares, type FlowConfig } from "./flow";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";
import { buildingsOf, type PipeRun } from "./water";

export interface WalkConfig {
  enabled: boolean;
  /** Mean path strength along a route from which the link is built (sustained flow). */
  buildAt: number;
  /** Longest link (world). */
  maxSpan: number;
  /** Seeds within this many cells are one building. */
  join: number;
  /** Laid anew when this share of the links changed… */
  change: number;
  /** …but not more often than every this many slots. */
  minGapSlots: number;
  /** A link drawn within this many slots below and still walked is not drawn again; new links ramp up from it. */
  joinSlots: number;
  /** Least run (world) of a ramp. */
  rampLength: number;
  /** Smoothing passes of the route (Chaikin; 0 = cell to cell). */
  smooth: number;
}

export const DEFAULT_WALK: WalkConfig = {
  enabled: true,
  buildAt: 0.45,
  maxSpan: 40,
  join: 1,
  change: 0.2,
  minGapSlots: 3,
  joinSlots: 20,
  rampLength: 3,
  smooth: 2,
};

/** One layer of walkways: the lines of its new links. */
export interface WalkLayer {
  k: number;
  /** Links in use at this moment ("a-b" building ids) — drawn here or still standing below. */
  links: string[];
  /** Links drawn in this layer (the new ones). */
  drawn: string[];
  /** Where each drawn link meets its buildings: later new links ramp up from here. */
  anchors: { key: string; building: number; x: number; z: number }[];
  /** One polyline [x, y, z, …] per drawn link (ramps included). */
  lines: Float32Array[];
}

export interface Walkways {
  layers: WalkLayer[];
}

export const NO_WALKWAYS: Walkways = { layers: [] };

export interface WalkOptions {
  secPerUnit: number;
  unit: number;
  flow: FlowConfig;
  tNow: number;
  /** Pipes (water.ts): a walkway does not run where a pipe lies at its height. */
  pipes?: { runs: readonly PipeRun[]; depth: number };
  /** Layers laid up to slot `upToK` (below the present) stay as they were; later ones are drawn by this call. */
  frozen?: { layers: readonly WalkLayer[]; upToK: number };
}

/** Cells of room around the buildings in which routes may run. */
const MARGIN = 8;

/** The walkways of the history. */
export function walkways(events: readonly PEvent[], seeds: readonly Seed[], cfg: WalkConfig, opts: WalkOptions): Walkways {
  const kept = opts.frozen ? opts.frozen.layers.filter((l) => l.k <= opts.frozen!.upToK) : [];
  if (!cfg.enabled || !seeds.length) return { layers: kept };
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  if (!pres.length) return { layers: kept };
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // a cell is not trodden once a building stands on it (first comes first)
  const born = new Map<string, number>();
  for (const s of seeds) {
    const k = cellKey(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE));
    born.set(k, Math.min(born.get(k) ?? Infinity, s.t0));
  }
  // the grid
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of seeds) {
    const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz);
    maxZ = Math.max(maxZ, cz);
  }
  const x0 = minX - MARGIN, z0 = minZ - MARGIN, nx = maxX - minX + 1 + 2 * MARGIN, nz = maxZ - minZ + 1 + 2 * MARGIN;
  const n = nx * nz;
  const idx = (cx: number, cz: number) => (cz - z0) * nx + (cx - x0);
  const inGrid = (cx: number, cz: number) => cx >= x0 && cz >= z0 && cx < x0 + nx && cz < z0 + nz;
  const centre = (c: number): [number, number] => [(x0 + (c % nx) + 0.5) * CELL_SIZE, (z0 + Math.floor(c / nx) + 0.5) * CELL_SIZE];

  const tracks = [...flowTracks(pres, stayShares(pres, opts.flow), (k) => born.get(k))].filter(([key]) => {
    const [cx, cz] = key.split(",").map(Number);
    return inGrid(cx, cz);
  });
  const tCell = tracks.map(([key]) => {
    const [cx, cz] = key.split(",").map(Number);
    return idx(cx, cz);
  });
  const tau = opts.flow.tauSec;
  const spu = opts.secPerUnit;
  const gc = new Float64Array(tracks.length), gq = new Float64Array(tracks.length), at = new Float64Array(tracks.length), next = new Int32Array(tracks.length);

  const layers: WalkLayer[] = [];
  let laid: Set<string> | null = null;
  let laidK = -Infinity;
  const kFirst = Math.floor(Math.min(...seeds.map((s) => s.t0)) / spu), kLast = Math.floor(opts.tNow / spu);
  const P = new Float32Array(n);
  let lastSig = "";
  let links = new Map<string, { cells: number[]; p: number }>();
  for (let k = kFirst; k <= kLast; k++) {
    const t = k * spu;
    const y = k * opts.unit;
    // trodden ground at t (each track's decayed sum carried forward)
    P.fill(0);
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i][1];
      const dec = Math.exp(-(t - at[i]) / tau);
      gc[i] *= dec;
      gq[i] *= dec;
      at[i] = t;
      while (next[i] < tr.s.length && tr.s[next[i]] <= t) {
        const j = next[i]++;
        const w = tr.a[j] * Math.exp(-(t - tr.s[j]) / tau);
        gc[i] += w * tr.c[j];
        gq[i] += w * tr.q[j];
      }
      P[tCell[i]] = flowP(Math.hypot(gc[i], gq[i]), opts.flow);
    }
    // obstacles at this height: the pipes lying within half a slot of it
    const blocked = new Uint8Array(n);
    let nb = 0;
    for (const r of opts.pipes?.runs ?? []) {
      const ry = (r.k - (opts.pipes?.depth ?? 0)) * opts.unit;
      const near = r.k0 !== undefined ? (r.k0 - (opts.pipes?.depth ?? 0)) * opts.unit - opts.unit / 2 <= y && y <= ry + opts.unit / 2 : Math.abs(ry - y) <= opts.unit / 2;
      if (!near) continue;
      const steps = Math.max(1, Math.round(Math.hypot(r.bx - r.ax, r.bz - r.az) / CELL_SIZE));
      for (let q = 0; q <= steps; q++) {
        const cx = Math.floor((r.ax + ((r.bx - r.ax) * q) / steps) / CELL_SIZE), cz = Math.floor((r.az + ((r.bz - r.az) * q) / steps) / CELL_SIZE);
        if (inGrid(cx, cz) && !blocked[idx(cx, cz)]) {
          blocked[idx(cx, cz)] = 1;
          nb++;
        }
      }
    }
    // the buildings standing at t: the places
    const up = seeds.filter((s) => s.t0 <= t);
    // the routes only change when the buildings, the obstacles or the trodden ground (coarsely) do
    let sig = `${up.length}:${nb}:`;
    for (let c = 0; c < n; c++) if (P[c] > 0.05 || blocked[c]) sig += `${c}.${Math.round(P[c] * 8)}${blocked[c] ? "b" : ""},`;
    if (sig !== lastSig) {
      lastSig = sig;
      const standing = buildingsOf(up, cfg);
      links = standing.length >= 2 ? linksAt(standing, P, blocked, nx, nz, idx, cfg) : new Map();
    }
    if (!links.size) continue;
    // CHANGE: laid anew only when the links changed enough, and not too often
    let diff = 0;
    if (laid) {
      for (const key of links.keys()) if (!laid.has(key)) diff++;
      for (const key of laid) if (!links.has(key)) diff++;
    }
    if (laid && (diff === 0 || diff / Math.max(1, links.size) < cfg.change || k - laidK < cfg.minGapSlots)) continue;
    laid = new Set(links.keys());
    laidK = k;
    if (opts.frozen && k <= opts.frozen.upToK) continue; // below the present: kept as it was
    const below = [...kept, ...layers].filter((l) => l.k < k && k - l.k <= cfg.joinSlots);
    // links drawn below within the present and still walked stand as they are: only the new ones are drawn here
    const standingBelow = new Set(below.flatMap((l) => l.drawn));
    const fresh = [...links.entries()].filter(([key]) => !standingBelow.has(key));
    layers.push(layLines(fresh.map(([key, l]) => ({ key, route: l.cells.map(centre) })), [...links.keys()], k, cfg, opts.unit, below));
  }
  return { layers: [...kept, ...layers] };
}

/**
 * The LINKS between standing buildings at one moment: from each building, a Dijkstra over the grid (cheap on trodden
 * ground, never through a building) that stops at the first building it meets in every direction; a route is a
 * link if the ground along it is trodden to `buildAt` on average and it is at most `maxSpan` long. Keyed "a-b".
 */
function linksAt(buildings: readonly ReturnType<typeof buildingsOf>[number][], P: Float32Array, blocked: Uint8Array, nx: number, nz: number, idx: (cx: number, cz: number) => number, cfg: WalkConfig): Map<string, { cells: number[]; p: number }> {
  const n = nx * nz;
  const owner = new Int32Array(n).fill(-1); // building on the cell
  const edgeOf = new Int32Array(n).fill(-1); // building whose edge the cell is (first)
  for (const b of buildings) for (const s of b.seeds) owner[idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE))] = b.id;
  const edges = new Map<number, number[]>();
  for (const b of buildings) {
    const list: number[] = [];
    for (const s of b.seeds) {
      const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = idx(cx + dx, cz + dz);
        if (c < 0 || c >= n || owner[c] >= 0) continue;
        list.push(c);
        if (edgeOf[c] < 0) edgeOf[c] = b.id;
      }
    }
    edges.set(b.id, list);
  }
  const cost = (c: number) => 0.15 + 2 * (1 - P[c]) ** 2;
  const out = new Map<string, { cells: number[]; p: number }>();
  const dist = new Float64Array(n);
  const prev = new Int32Array(n);
  const done = new Uint8Array(n);
  const maxCells = cfg.maxSpan / CELL_SIZE;
  for (const a of buildings) {
    dist.fill(Infinity);
    prev.fill(-1);
    done.fill(0);
    const steps = new Uint16Array(n);
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
    for (const c of edges.get(a.id) ?? []) {
      if (dist[c] === 0) continue;
      dist[c] = 0;
      push(c);
    }
    const reached = new Set<number>();
    while (heap.length) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      const b = edgeOf[u];
      if (b >= 0 && b !== a.id) {
        // the first building met this way: a candidate link; do not go on through it
        if (!reached.has(b)) {
          reached.add(b);
          if (a.id < b) {
            const cells: number[] = [];
            for (let v = u; v >= 0; v = prev[v]) cells.push(v);
            cells.reverse();
            const p = cells.reduce((s, c) => s + P[c], 0) / cells.length;
            if (p >= cfg.buildAt && cells.length <= maxCells) out.set(`${a.id}-${b}`, { cells, p });
          }
        }
        continue;
      }
      if (steps[u] > maxCells) continue;
      const ui = u % nx, uj = (u - ui) / nx;
      for (const [di, dj, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]) {
        const vi = ui + di, vj = uj + dj;
        if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
        const v = vj * nx + vi;
        if (done[v] || owner[v] >= 0 || blocked[v]) continue;
        if (di && dj && (owner[uj * nx + vi] >= 0 || owner[vj * nx + ui] >= 0)) continue;
        const d = dist[u] + len * (cost(u) + cost(v)) * 0.5;
        if (d < dist[v]) {
          dist[v] = d;
          prev[v] = u;
          steps[v] = steps[u] + 1;
          push(v);
        }
      }
    }
  }
  return out;
}

/** Chaikin corner cutting, `passes` times, ends kept. */
function chaikin(pts: [number, number][], passes: number): [number, number][] {
  let p = pts;
  for (let n = 0; n < passes && p.length >= 3; n++) {
    const q: [number, number][] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * One layer's lines (slot k), for its NEW links: each route smoothed, at the layer's height. Where a link starts (or
 * ends) at a building that a link drawn below (within `joinSlots`, still walked) also reaches, its line begins at
 * that link's end, at that link's height, and RAMPS up to the layer's height over `rampLength`.
 */
function layLines(links: { key: string; route: [number, number][] }[], inUse: string[], k: number, cfg: WalkConfig, unit: number, below: readonly WalkLayer[]): WalkLayer {
  const out: WalkLayer = { k, links: inUse, drawn: links.map((l) => l.key), anchors: [], lines: [] };
  const y = k * unit;
  for (const { key, route } of links) {
    const flat = chaikin(route, Math.max(0, Math.round(cfg.smooth)));
    if (flat.length < 2) continue;
    const [ia, ib] = key.split("-").map(Number);
    out.anchors.push({ key, building: ia, x: flat[0][0], z: flat[0][1] }, { key, building: ib, x: flat[flat.length - 1][0], z: flat[flat.length - 1][1] });
    // the link drawn below nearest to an end at this building, still walked
    const from = (building: number, x: number, z: number) => {
      let best: { x: number; z: number; y: number } | null = null, bd = Infinity;
      for (const l of below) {
        for (const an of l.anchors) {
          if (an.building !== building || !inUse.includes(an.key)) continue;
          const d = Math.hypot(an.x - x, an.z - z);
          if (d < bd) {
            bd = d;
            best = { x: an.x, z: an.z, y: l.k * unit };
          }
        }
      }
      return best;
    };
    const a = from(ia, flat[0][0], flat[0][1]);
    const b = from(ib, flat[flat.length - 1][0], flat[flat.length - 1][1]);
    const pts: [number, number][] = [...(a ? [[a.x, a.z] as [number, number]] : []), ...flat, ...(b ? [[b.x, b.z] as [number, number]] : [])];
    // horizontal distance along the line from each end
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const ramp = Math.max(1e-3, cfg.rampLength);
    const line = new Float32Array(pts.length * 3);
    pts.forEach(([x, z], i) => {
      let yy = y;
      if (a) yy = Math.min(yy, a.y + (y - a.y) * Math.min(1, cum[i] / ramp));
      if (b) yy = Math.min(yy, b.y + (y - b.y) * Math.min(1, (L - cum[i]) / ramp));
      line.set([x, yy, z], i * 3);
    });
    out.lines.push(line);
  }
  return out;
}

/** All layers' lines as segments (pairs of points) for drawing; `live` = laid within the present (from slot `fromK`). */
export function walkSegments(w: Walkways, fromK: number): { live: Float32Array; kept: Float32Array } {
  const live: number[] = [], kept: number[] = [];
  for (const l of w.layers) {
    const to = l.k >= fromK ? live : kept;
    for (const line of l.lines) for (let i = 0; i + 5 < line.length; i += 3) for (let c = 0; c < 6; c++) to.push(line[i + c]);
  }
  return { live: Float32Array.from(live), kept: Float32Array.from(kept) };
}
