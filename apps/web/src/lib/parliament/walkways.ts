/**
 * parliament/walkways.ts
 *
 * WALKWAYS (V2): BUILDINGS are the places; a walkway is a LINK between two of them, built where people keep walking
 * from one to the other. So a walkway never comes before its buildings — it needs both to stand.
 *
 *   TRODDEN      the ground keeps how trodden it is (flow.ts: treads along each move, fading with regrowth `tauSec`,
 *                counting only movement along one axis); its path strength p = 1 − e^(−G/unit) is read per cell
 *   ROUTE        from each building, the cheapest way over the grid to the buildings it can reach directly (a route
 *                stops at the first building it meets, so links join neighbours, not across others): cheap on
 *                trodden ground (cost 0.15 + 2·(1 − p)²), never through a building
 *   LINK         a route is built when the ground along it is trodden on average to `buildAt` (the flow between
 *                the two is sustained) and it is no longer than `maxSpan`
 *   SHAPE        a link's route is straightened into a few stretches (Douglas–Peucker, `straighten` world); along
 *                each a SLAB with thickness, wider where more people walk; a FENCE along its edges (rails, posts);
 *                PIERS at its joints and every `pierSpacing`, reaching down into the earlier ground; MASTS every
 *                `mastSpacing` with WIRES down to the deck
 *   LAYERS       laid anew only when the links CHANGE (a link appears or goes, by `change` of them), at most every
 *                `minGapSlots`; each layer stays where it was laid. Human traces: achromatic (colours in the view).
 *
 * Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, flowP, flowTracks, stayShares, type FlowConfig } from "./flow";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";
import { buildingsOf } from "./water";

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
  /** How far (world) a route may stray from a straight stretch before it bends (larger = fewer, longer slabs). */
  straighten: number;
  /** Deck thickness and least width (world); `widthByFlow` × p more where more people walk. */
  deckThick: number;
  deckWidth: number;
  widthByFlow: number;
  /** Fence: height, post spacing, rail and post thickness (world); 0 height = none. */
  fenceHeight: number;
  postSpacing: number;
  railThick: number;
  postThick: number;
  /** Piers: spacing (world, 0 = none), depth (slots), thickness (world). */
  pierSpacing: number;
  pierDepth: number;
  pierThick: number;
  /** A later layer joins the layers below it (still walked: same link) laid within this many slots, by shafts. */
  joinSlots: number;
  /** Fine grid (world) of the walkway's footprint, covered by blocks: smaller = finer outline, more blocks. */
  grain: number;
  /** Masts: spacing (world, 0 = none), height (slots), thickness (world), wires each side. */
  mastSpacing: number;
  mastHeight: number;
  mastThick: number;
  wiresPerSide: number;
}

export const DEFAULT_WALK: WalkConfig = {
  enabled: true,
  buildAt: 0.45,
  maxSpan: 40,
  join: 1,
  change: 0.2,
  minGapSlots: 3,
  straighten: 0.9,
  deckThick: 0.14,
  deckWidth: 0.7,
  widthByFlow: 0.6,
  fenceHeight: 0.35,
  postSpacing: 0.8,
  railThick: 0.025,
  postThick: 0.025,
  pierSpacing: 3,
  pierDepth: 3,
  pierThick: 0.1,
  mastSpacing: 8,
  mastHeight: 2.5,
  mastThick: 0.06,
  wiresPerSide: 2,
  joinSlots: 20,
  grain: 0.3,
};

/** One layer of walkways. Boxes [x, y, z, sx, sy, sz, yaw] × n — DECK slabs and FRAME (rails, posts, piers, masts) apart, for their materials — and wires [a, b] × n. */
export interface WalkLayer {
  k: number;
  deck: number[];
  frame: number[];
  wires: number[];
  /** Links in this layer ("a-b" building ids). */
  links: string[];
  /** Where each link meets its buildings (both ends): later layers rise from here to join it. */
  anchors: { key: string; x: number; z: number }[];
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
  /** Layers laid up to slot `upToK` stay as they were (only later ones are laid by this call). */
  frozen?: { layers: readonly WalkLayer[]; upToK: number };
}

/** Cells of room around the buildings in which routes may run. */
const MARGIN = 8;

/** The walkways of the history. */
export function walkways(events: readonly PEvent[], seeds: readonly Seed[], cfg: WalkConfig, opts: WalkOptions): Walkways {
  if (!cfg.enabled || !seeds.length) return opts.frozen ? { layers: [...opts.frozen.layers] } : NO_WALKWAYS;
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  if (!pres.length) return NO_WALKWAYS;
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
    // the buildings standing at t: the places
    const up = seeds.filter((s) => s.t0 <= t);
    // the routes only change when the buildings or the trodden ground (coarsely) do: reuse them otherwise
    let sig = `${up.length}:`;
    for (let c = 0; c < n; c++) if (P[c] > 0.05) sig += `${c}.${Math.round(P[c] * 8)},`;
    if (sig !== lastSig) {
      lastSig = sig;
      const standing = buildingsOf(up, cfg);
      links = standing.length >= 2 ? linksAt(standing, P, nx, nz, idx, cfg) : new Map();
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
    if (opts.frozen && k <= opts.frozen.upToK) continue; // kept as it was
    const centre = (c: number): [number, number] => [(x0 + (c % nx) + 0.5) * CELL_SIZE, (z0 + Math.floor(c / nx) + 0.5) * CELL_SIZE];
    const below = [...(opts.frozen?.layers ?? []), ...layers].filter((l) => l.k < k && k - l.k <= cfg.joinSlots);
    layers.push(layLayer([...links.entries()].map(([key, l]) => ({ key, route: l.cells.map(centre), p: l.p })), k, cfg, opts.unit, below));
  }
  return { layers: opts.frozen ? [...opts.frozen.layers, ...layers] : layers };
}

/**
 * The LINKS between standing buildings at one moment: from each building, a Dijkstra over the grid (cheap on trodden
 * ground, never through a building) that stops at the first building it meets in every direction; a route is a
 * link if the ground along it is trodden to `buildAt` on average and it is at most `maxSpan` long. Keyed "a-b".
 */
function linksAt(buildings: readonly ReturnType<typeof buildingsOf>[number][], P: Float32Array, nx: number, nz: number, idx: (cx: number, cz: number) => number, cfg: WalkConfig): Map<string, { cells: number[]; p: number }> {
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
        if (done[v] || owner[v] >= 0) continue;
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

/** Douglas–Peucker on [x, z] points, ends kept. */
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, bz - az) || 1e-9;
  let best = -1, bd = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  if (bd <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, best + 1), eps).slice(0, -1), ...simplify(pts.slice(best), eps)];
}

/**
 * One layer of walkways (slot k). First a PRE-LAYER: the walkway's footprint on a fine grid (`grain`) — every link's
 * straightened route with its width (wider where more people walk), all links in one mask, so where they meet they
 * are one floor. Then the VISUAL WRAPPER: the mask covered by blocks (greedy: each block the largest rectangle of
 * the mask left), a FENCE only along the mask's outline (so a junction stays open), PIERS along the routes, MASTS
 * and WIRES. Layers below laid within `joinSlots` whose link is still walked are joined by SHAFTS at its ends.
 */
function layLayer(links: { key: string; route: [number, number][]; p: number }[], k: number, cfg: WalkConfig, unit: number, below: readonly WalkLayer[]): WalkLayer {
  const out: WalkLayer = { k, deck: [], frame: [], wires: [], links: links.map((l) => l.key), anchors: [] };
  const y = k * unit + cfg.deckThick / 2;
  const top = y + cfg.deckThick / 2;
  const g = Math.max(0.05, cfg.grain);
  const lines = links.map((l) => ({ ...l, line: simplify(l.route, cfg.straighten), w: cfg.deckWidth + cfg.widthByFlow * l.p }));
  // PRE-LAYER: the footprint
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { line, w } of lines) for (const [x, z] of line) {
    minX = Math.min(minX, x - w);
    maxX = Math.max(maxX, x + w);
    minZ = Math.min(minZ, z - w);
    maxZ = Math.max(maxZ, z + w);
  }
  if (!Number.isFinite(minX)) return out;
  const gx0 = Math.floor(minX / g), gz0 = Math.floor(minZ / g);
  const gw = Math.ceil(maxX / g) - gx0 + 1, gd = Math.ceil(maxZ / g) - gz0 + 1;
  const mask = new Uint8Array(gw * gd);
  for (const { line, w } of lines) {
    for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = line[q], [bx, bz] = line[q + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const i0 = Math.floor((Math.min(ax, bx) - w) / g) - gx0, i1 = Math.ceil((Math.max(ax, bx) + w) / g) - gx0;
      const j0 = Math.floor((Math.min(az, bz) - w) / g) - gz0, j1 = Math.ceil((Math.max(az, bz) + w) / g) - gz0;
      for (let j = Math.max(0, j0); j <= Math.min(gd - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(gw - 1, i1); i++) {
          const px = (gx0 + i + 0.5) * g, pz = (gz0 + j + 0.5) * g;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
          if (Math.hypot(px - ax - dx * t, pz - az - dz * t) <= w / 2) mask[j * gw + i] = 1;
        }
      }
    }
  }
  // WRAPPER: blocks, greedy (largest rectangles first along the rows)
  const used = new Uint8Array(gw * gd);
  for (let j = 0; j < gd; j++) {
    for (let i = 0; i < gw; i++) {
      if (!mask[j * gw + i] || used[j * gw + i]) continue;
      let w = 1;
      while (i + w < gw && mask[j * gw + i + w] && !used[j * gw + i + w]) w++;
      let d = 1;
      grow: while (j + d < gd) {
        for (let q = 0; q < w; q++) if (!mask[(j + d) * gw + i + q] || used[(j + d) * gw + i + q]) break grow;
        d++;
      }
      for (let jj = 0; jj < d; jj++) for (let q = 0; q < w; q++) used[(j + jj) * gw + i + q] = 1;
      out.deck.push((gx0 + i + w / 2) * g, y, (gz0 + j + d / 2) * g, w * g, cfg.deckThick, d * g, 0);
    }
  }
  // FENCE along the outline only: runs of boundary edges, rails and posts
  if (cfg.fenceHeight > 0) {
    const m = (i: number, j: number) => i >= 0 && j >= 0 && i < gw && j < gd && mask[j * gw + i] === 1;
    const rail = (x: number, z: number, len: number, yaw: number) => out.frame.push(x, top + cfg.fenceHeight, z, len, cfg.railThick, cfg.railThick, yaw);
    const posts = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / Math.max(0.1, cfg.postSpacing)));
      for (let q = 0; q <= n; q++) out.frame.push(ax + ((bx - ax) * q) / n, top + cfg.fenceHeight / 2, az + ((bz - az) * q) / n, cfg.postThick, cfg.fenceHeight, cfg.postThick, 0);
    };
    // edges along x (between rows j−1 and j), then along z (between columns i−1 and i)
    for (let j = 0; j <= gd; j++) {
      let run = -1;
      for (let i = 0; i <= gw; i++) {
        const edge = i < gw && m(i, j) !== m(i, j - 1);
        if (edge && run < 0) run = i;
        if (!edge && run >= 0) {
          const ax = (gx0 + run) * g, bx = (gx0 + i) * g, z = (gz0 + j) * g;
          rail((ax + bx) / 2, z, bx - ax, 0);
          posts(ax, z, bx, z);
          run = -1;
        }
      }
    }
    for (let i = 0; i <= gw; i++) {
      let run = -1;
      for (let j = 0; j <= gd; j++) {
        const edge = j < gd && m(i, j) !== m(i - 1, j);
        if (edge && run < 0) run = j;
        if (!edge && run >= 0) {
          const az = (gz0 + run) * g, bz = (gz0 + j) * g, x = (gx0 + i) * g;
          rail(x, (az + bz) / 2, bz - az, Math.PI / 2);
          posts(x, az, x, bz);
          run = -1;
        }
      }
    }
  }
  for (const { key, line } of lines) {
    // piers along the route (at its joints and every `pierSpacing`), masts and wires
    for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = line[q], [bx, bz] = line[q + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len, uz = dz / len;
      if (cfg.pierSpacing > 0) {
        const d = cfg.pierDepth * unit;
        const n = Math.max(1, Math.round(len / cfg.pierSpacing));
        for (let i = q === 0 ? 0 : 1; i <= n; i++) out.frame.push(ax + (dx * i) / n, y - d / 2, az + (dz * i) / n, cfg.pierThick, d, cfg.pierThick, 0);
      }
      if (cfg.mastSpacing > 0 && len >= cfg.mastSpacing * 0.5) {
        const mh = cfg.mastHeight * unit;
        const n = Math.max(1, Math.floor(len / cfg.mastSpacing));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const mx = ax + dx * t, mz = az + dz * t;
          out.frame.push(mx, top + mh / 2, mz, cfg.mastThick, mh, cfg.mastThick, 0);
          for (let s = 1; s <= cfg.wiresPerSide; s++) {
            for (const dir of [-1, 1]) {
              const r = (dir * s * cfg.mastSpacing) / (2 * cfg.wiresPerSide);
              const along = t * len + r;
              if (along < 0 || along > len) continue;
              out.wires.push(mx, top + mh, mz, mx + ux * r, top, mz + uz * r);
            }
          }
        }
      }
    }
    // the ends (at the buildings): anchors for later layers; shafts down to the layers below still walking this link
    for (const [x, z] of [line[0], line[line.length - 1]]) {
      out.anchors.push({ key, x, z });
      const old = below.filter((l) => l.links.includes(key));
      if (!old.length) continue;
      const lowest = Math.min(...old.map((l) => l.k));
      const yb = lowest * unit + cfg.deckThick;
      const h = y - yb;
      if (h > 1e-3) out.frame.push(x, yb + h / 2, z, cfg.pierThick * 2.5, h, cfg.pierThick * 2.5, 0);
    }
  }
  return out;
}

/** All layers as flat arrays for drawing. */
export function walkArrays(w: Walkways): { deck: Float32Array; frame: Float32Array; wires: Float32Array } {
  let nd = 0, nf = 0, nw = 0;
  for (const l of w.layers) {
    nd += l.deck.length;
    nf += l.frame.length;
    nw += l.wires.length;
  }
  const deck = new Float32Array(nd), frame = new Float32Array(nf), wires = new Float32Array(nw);
  let a = 0, b = 0, c = 0;
  for (const l of w.layers) {
    deck.set(l.deck, a);
    frame.set(l.frame, b);
    wires.set(l.wires, c);
    a += l.deck.length;
    b += l.frame.length;
    c += l.wires.length;
  }
  return { deck, frame, wires };
}
