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
 *                what is NEW — a link already drawn and still walked (same place: both ends where its ends are) is not
 *                drawn again.
 *   IN USE       a drawn link stays in use while it is seen walked, with gaps of at most `grace` slots; unseen longer,
 *                it is gone for good: if people take it again, it is a new walkway (drawn whole, no ramp).
 *   CHANGE       a new link that runs mostly (`minorShare`) along living lines laid within `reach` slots below is a
 *                change of them: only its departing stretches are drawn, RAMPING up from the line they leave. A new
 *                link mostly elsewhere is a walkway of its own, drawn whole and flat. Lines older than `reach` are
 *                past: nothing joins them.
 *   RE-SURFACING a link in use whose line is older than `resurface` slots is laid again (whole, flat) — a walkway used
 *                for long stays in time as surfaces stacked at that interval, and its changes always have a line
 *                within reach to branch off.
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
  /** Least run (world) of a ramp. */
  rampLength: number;
  /** Smoothing passes of the route (Chaikin; 0 = cell to cell). */
  smooth: number;
  /** How far back (slots) a new line may join a line below; 0 = the present thickness (WalkOptions.present). Older
   *  lines are past: nothing joins them. */
  reach: number;
  /** A link unseen for at most this many slots is still the same link in use; longer, it is gone, and if it comes
   *  back it is a NEW link (drawn whole, no ramp). */
  grace: number;
  /** A new link is a CHANGE of the walkways below (only its departing stretches drawn, ramped up from them) when at
   *  least this share of it runs along living lines; otherwise it is a new walkway, drawn whole without a ramp. */
  minorShare: number;
  /** RE-SURFACING: a link still in use whose line is older than this (slots; 0 = `reach`) is laid again at the next
   *  layer (whole, flat), so a long-used walkway stays in time as surfaces stacked at this interval. Off when < 0. */
  resurface: number;
}

export const DEFAULT_WALK: WalkConfig = {
  enabled: true,
  buildAt: 0.45,
  maxSpan: 40,
  join: 1,
  change: 0.2,
  minGapSlots: 3,
  rampLength: 3,
  smooth: 2,
  reach: 0,
  grace: 3,
  minorShare: 0.6,
  resurface: 0,
};

/** One layer of walkways: the lines of its new links. */
export interface WalkLayer {
  k: number;
  /** Links in use at this moment ("a-b" building ids) — drawn here or still standing below. */
  links: string[];
  /** Links drawn in this layer (the new ones, the changes and the re-surfaced). */
  drawn: string[];
  /** Of `drawn`, the links laid again (re-surfacing) — a walkway in use for long, not a change. */
  resurfaced: string[];
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
  /** The present thickness (slots): `reach` = 0 means this (default 18). */
  present?: number;
}

/** A drawn link still in use: its layer, its two ends, its line, and the last slot it was seen walked. */
type Link = { key: string; flat: [number, number][]; a: [number, number]; b: [number, number] };
type Alive = { k: number; a: [number, number]; b: [number, number]; flat: [number, number][]; seen: number };

/** Two links are the same when both ends lie within this (world). */
const MATCH = CELL_SIZE * 2.5;
/** A new link ramps up from a living link's end within this (world). */
const RAMP_REACH = CELL_SIZE * 4;
/** A stretch of a new link within this (world) of a living line runs along it: already there, not drawn. */
const COVER = CELL_SIZE * 1.5;

/** Whether a seed has parts in slot k: one of its spans (somebody around) touches the slot. */
function occupies(s: Seed, k: number, spu: number): boolean {
  const spans = s.spans && s.spans.length ? s.spans : [[s.t0, s.t1] as [number, number]];
  for (const [a, b] of spans) if (Math.floor(Math.max(a, s.t0) / spu) <= k && k <= Math.floor(Math.min(b, s.t1) / spu)) return true;
  return false;
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
  let laidK = -Infinity;
  let alive: Alive[] = [];
  let died = 0;
  const reach = cfg.reach > 0 ? cfg.reach : (opts.present ?? 18);
  const grace = Math.max(0, cfg.grace);
  const resurfaceEvery = cfg.resurface < 0 ? 0 : cfg.resurface > 0 ? cfg.resurface : reach;
  const kFirst = Math.floor(Math.min(...seeds.map((s) => s.t0)) / spu), kLast = Math.floor(opts.tNow / spu);
  const P = new Float32Array(n);
  let lastSig = "";
  let now: Link[] = [];
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
    // only seeds with parts in this slot (not in empty time): a walkway arrives where there is something to arrive at
    const up = seeds.filter((s) => occupies(s, k, spu));
    // the routes only change when the buildings, the obstacles or the trodden ground (coarsely) do
    let sig = `${up.length}:${nb}:`;
    for (let c = 0; c < n; c++) if (P[c] > 0.05 || blocked[c]) sig += `${c}.${Math.round(P[c] * 8)}${blocked[c] ? "b" : ""},`;
    if (sig !== lastSig) {
      lastSig = sig;
      const standing = buildingsOf(up, cfg);
      const links = standing.length >= 2 ? linksAt(standing, P, blocked, nx, nz, idx, cfg) : new Map<string, { cells: number[]; p: number }>();
      // links as they lie: smooth lines with their two ends
      now = [...links.entries()].map(([key, l]) => {
        const flat = chaikin(l.cells.map(centre), Math.max(0, Math.round(cfg.smooth)));
        return { key, flat, a: flat[0], b: flat[flat.length - 1] };
      });
    }
    // a link is the SAME as one already drawn when its two ends lie where that one's do (by place, not by building
    // id — ids change as buildings grow); a drawn link stays alive while it is seen walked (gaps up to `grace` slots)
    const same = (x: { a: [number, number]; b: [number, number] }, y: { a: [number, number]; b: [number, number] }) => {
      const d = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      return (d(x.a, y.a) <= MATCH && d(x.b, y.b) <= MATCH) || (d(x.a, y.b) <= MATCH && d(x.b, y.a) <= MATCH);
    };
    const matchOf = new Map<string, Alive>();
    const fresh = now.filter((l) => {
      const m = alive.find((al) => same(l, al));
      if (m) {
        m.seen = k;
        matchOf.set(l.key, m);
      }
      return !m;
    });
    // gone: unseen for longer than `grace` — never joined again (if it comes back, it is new)
    const gone = alive.filter((al) => k - al.seen > grace);
    if (gone.length) {
      alive = alive.filter((al) => k - al.seen <= grace);
      died += gone.length;
    }
    // RE-SURFACING: links in use whose line has grown older than the interval
    const old = resurfaceEvery > 0 ? now.filter((l) => matchOf.has(l.key) && k - matchOf.get(l.key)!.k >= resurfaceEvery) : [];
    // CHANGE: laid when links appeared or went (by `change` of them, not too often), or when one is re-surfaced
    const diff = fresh.length + died;
    const changed = diff > 0 && (laidK === -Infinity || (diff / Math.max(1, now.length) >= cfg.change && k - laidK >= cfg.minGapSlots));
    if (!changed && !old.length) continue;
    laidK = k;
    died = 0;
    const layer: WalkLayer = { k, links: now.map((l) => l.key), drawn: [], resurfaced: [], anchors: [], lines: [] };
    // the re-surfaced first (whole, flat, at this height): changes of this layer join them
    for (const l of old) {
      const al = matchOf.get(l.key)!;
      Object.assign(al, { k, a: l.a, b: l.b, flat: l.flat });
      layLink(layer, l, opts.unit, k, null);
      layer.resurfaced.push(l.key);
    }
    if (changed) {
      // what may be joined: lines laid within `reach` below (or just re-surfaced here); older ones are past
      const joinable = alive.filter((al) => al.k <= k && k - al.k <= reach);
      for (const l of fresh) layLink(layer, l, opts.unit, k, { lines: joinable, cfg });
      for (const l of fresh) alive.push({ k, a: l.a, b: l.b, flat: l.flat, seen: k });
    }
    if (opts.frozen && k <= opts.frozen.upToK) continue; // below the present: kept as it was
    if (layer.drawn.length || changed) layers.push(layer);
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
 * Lays one link's line into a layer (slot k, smoothed, at the layer's height). With `join` (the living lines within
 * reach), the link is checked against them: when at least `minorShare` of it runs along them it is a CHANGE — only
 * its departing stretches are drawn, each end RAMPING up from the living line it leaves (over `rampLength`); otherwise
 * it is a new walkway, drawn whole and flat. Without `join` (re-surfacing) it is drawn whole and flat.
 */
function layLink(out: WalkLayer, link: Link, unit: number, k: number, join: { lines: readonly Alive[]; cfg: WalkConfig } | null): void {
  const { key, flat } = link;
  if (flat.length < 2) return;
  const y = k * unit;
  const [ia, ib] = key.split("-").map(Number);
  out.drawn.push(key);
  out.anchors.push({ key, building: ia, x: flat[0][0], z: flat[0][1] }, { key, building: ib, x: flat[flat.length - 1][0], z: flat[flat.length - 1][1] });
  const flatLine = () => {
    const line = new Float32Array(flat.length * 3);
    flat.forEach(([x, z], q) => line.set([x, y, z], q * 3));
    out.lines.push(line);
  };
  if (!join || !join.lines.length) return flatLine();
  // the nearest point on a living line (and its height)
  const onLiving = (x: number, z: number, reach: number) => {
    let best: { x: number; z: number; y: number } | null = null, bd = reach;
    for (const al of join.lines) {
      for (let i = 0; i + 1 < al.flat.length; i++) {
        const [ax, az] = al.flat[i], [bx, bz] = al.flat[i + 1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) {
          bd = d;
          best = { x: px, z: pz, y: al.k * unit };
        }
      }
    }
    return best;
  };
  const covered = flat.map(([x, z]) => onLiving(x, z, COVER) !== null);
  const share = covered.filter(Boolean).length / covered.length;
  // mostly elsewhere: a new walkway of its own, not a change of the ones below
  if (share < join.cfg.minorShare) return flatLine();
  const ramp = Math.max(1e-3, join.cfg.rampLength);
  for (let i = 0; i < flat.length; ) {
    if (covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < flat.length && !covered[j + 1]) j++;
    // the stretch with one point of the shared corridor on each side (where it branches off)
    const s0 = Math.max(0, i - 1), s1 = Math.min(flat.length - 1, j + 1);
    const run = flat.slice(s0, s1 + 1);
    i = j + 1;
    if (run.length < 2) continue;
    // each end joins the living line it branches off
    const a = onLiving(run[0][0], run[0][1], RAMP_REACH);
    const b = onLiving(run[run.length - 1][0], run[run.length - 1][1], RAMP_REACH);
    const pts: [number, number][] = [...(a ? [[a.x, a.z] as [number, number]] : []), ...run, ...(b ? [[b.x, b.z] as [number, number]] : [])];
    const cum = [0];
    for (let q = 1; q < pts.length; q++) cum.push(cum[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
    const L = cum[cum.length - 1];
    const line = new Float32Array(pts.length * 3);
    pts.forEach(([x, z], q) => {
      let yy = y;
      if (a) yy = Math.min(yy, a.y + (y - a.y) * Math.min(1, cum[q] / ramp));
      if (b) yy = Math.min(yy, b.y + (y - b.y) * Math.min(1, (L - cum[q]) / ramp));
      line.set([x, yy, z], q * 3);
    });
    out.lines.push(line);
  }
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
