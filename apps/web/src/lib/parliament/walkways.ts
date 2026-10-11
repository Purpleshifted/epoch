/**
 * parliament/walkways.ts
 *
 * WALKWAYS (V2): where the flow of people is sustained (path strength ≥ `buildAt`, flow.ts), the path is BUILT — a
 * walkway like a light bridge. The strong path cells are read as LINES (their centre lines, pathLines), and along
 * every straight stretch of a line goes a SLAB with thickness, as wide as the path there; a FENCE (posts and a rail)
 * along its edges; PIERS at its joints and every `pierSpacing`, reaching down into the earlier ground; MASTS every
 * `mastSpacing` with WIRES down to the deck (a cable-stayed look).
 *
 * Like the pipes (water.ts) a walkway is laid only when the walked network CHANGES (strong path cells appear or go by
 * `change` of themselves), at most every `minGapSlots`, and stays in its layer — so the layers show the built paths
 * of their time. Cells on which a building already stands are not trodden (flow: the building came first), so no
 * deck runs through a building. Human traces: achromatic. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, flowP, flowTracks, stayShares, type FlowConfig } from "./flow";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";

export interface WalkConfig {
  enabled: boolean;
  /** Path strength from which a path is built. */
  buildAt: number;
  /** A walkway is laid anew when the strong path cells changed by this share of themselves… */
  change: number;
  /** …but not more often than every this many slots. */
  minGapSlots: number;
  /** Deck width (world) and thickness (world). */
  deckWidth: number;
  deckThick: number;
  /** Fence height (world). */
  fenceHeight: number;
  /** Piers every this far (world) and at the joints, reaching this many slots down. */
  pierSpacing: number;
  pierDepth: number;
  /** Masts every this far (world), this many slots high, with wires down to the deck. 0 = none. */
  mastSpacing: number;
  mastHeight: number;
}

export const DEFAULT_WALK: WalkConfig = {
  enabled: true,
  buildAt: 0.6,
  change: 0.2,
  minGapSlots: 3,
  deckWidth: 0.8,
  deckThick: 0.14,
  fenceHeight: 0.35,
  pierSpacing: 3,
  pierDepth: 3,
  mastSpacing: 8,
  mastHeight: 2.5,
};

/** Built walkways: boxes [x, y, z, sx, sy, sz, yaw] × n (deck, fence, piers, masts) and wires [ax, ay, az, bx, by, bz] × n. */
export interface Walkways {
  boxes: Float32Array;
  wires: Float32Array;
  /** Slots in which walkways were laid. */
  layers: number[];
}

export const NO_WALKWAYS: Walkways = { boxes: new Float32Array(0), wires: new Float32Array(0), layers: [] };

export interface WalkOptions {
  secPerUnit: number;
  unit: number;
  flow: FlowConfig;
  tNow: number;
}

/** The walkways of the history. */
export function walkways(events: readonly PEvent[], seeds: readonly Seed[], cfg: WalkConfig, opts: WalkOptions): Walkways {
  if (!cfg.enabled) return NO_WALKWAYS;
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  if (!pres.length) return NO_WALKWAYS;
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // a cell is not trodden once a building stands on it (first comes first)
  const born = new Map<string, number>();
  for (const s of seeds) {
    const k = cellKey(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE));
    born.set(k, Math.min(born.get(k) ?? Infinity, s.t0));
  }
  const tracks = [...flowTracks(pres, stayShares(pres, opts.flow), (k) => born.get(k))];
  const cells = tracks.map(([key]) => key.split(",").map(Number) as [number, number]);
  const tau = opts.flow.tauSec;
  const spu = opts.secPerUnit;
  const gc = new Float64Array(tracks.length), gq = new Float64Array(tracks.length), at = new Float64Array(tracks.length), next = new Int32Array(tracks.length);

  const boxes: number[] = [];
  const wires: number[] = [];
  const layers: number[] = [];
  let laid: Set<string> | null = null;
  let laidK = -Infinity;
  const kFirst = Math.floor(pres[0].s / spu), kLast = Math.floor(opts.tNow / spu);
  for (let k = kFirst; k <= kLast; k++) {
    const t = k * spu;
    // strong path cells at t, with their walking direction (the decayed mean axis)
    const strong = new Map<string, { cx: number; cz: number; dx: number; dz: number }>();
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
      if (flowP(Math.hypot(gc[i], gq[i]), opts.flow) < cfg.buildAt) continue;
      const th = Math.atan2(gq[i], gc[i]) / 2;
      strong.set(tracks[i][0], { cx: cells[i][0], cz: cells[i][1], dx: Math.cos(th), dz: Math.sin(th) });
    }
    if (!strong.size) continue;
    // CHANGE: laid anew only when the strong cells changed enough, and not too often
    let diff = 0;
    if (laid) {
      for (const key of strong.keys()) if (!laid.has(key)) diff++;
      for (const key of laid) if (!strong.has(key)) diff++;
    }
    if (laid && (diff / Math.max(1, strong.size) < cfg.change || k - laidK < cfg.minGapSlots)) continue;
    laid = new Set(strong.keys());
    laidK = k;
    layers.push(k);
    layWalkway(strong, k, cfg, opts.unit, boxes, wires);
  }
  return { boxes: Float32Array.from(boxes), wires: Float32Array.from(wires), layers };
}

type Strong = Map<string, { cx: number; cz: number; dx: number; dz: number }>;

/**
 * The CENTRE LINES of the strong path cells: the cells thinned to a one-cell skeleton (Zhang–Suen), traced into
 * chains between junctions and ends, simplified (Douglas–Peucker, `eps` world) — polylines [x, z, half-width] × n in
 * world, the half-width from the distance to the path's edge.
 */
export function pathLines(cells: Iterable<[number, number]>, eps = CELL_SIZE * 0.7): Float32Array[] {
  const list = [...cells];
  if (!list.length) return [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of list) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  const x0 = minX - 1, z0 = minZ - 1, nx = maxX - minX + 3, nz = maxZ - minZ + 3;
  const img = new Uint8Array(nx * nz);
  for (const [x, z] of list) img[(z - z0) * nx + (x - x0)] = 1;
  // distance to the edge (chessboard), for the deck's width
  const dt = new Float32Array(nx * nz);
  for (let i = 0; i < img.length; i++) dt[i] = img[i] ? 1e9 : 0;
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const c = j * nx + i;
    if (dt[c]) dt[c] = Math.min(dt[c], dt[c - 1] + 1, dt[c - nx] + 1, dt[c - nx - 1] + 1, dt[c - nx + 1] + 1);
  }
  for (let j = nz - 2; j >= 1; j--) for (let i = nx - 2; i >= 1; i--) {
    const c = j * nx + i;
    if (dt[c]) dt[c] = Math.min(dt[c], dt[c + 1] + 1, dt[c + nx] + 1, dt[c + nx + 1] + 1, dt[c + nx - 1] + 1);
  }
  // Zhang–Suen thinning
  const P = (i: number, j: number) => img[j * nx + i];
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      const del: number[] = [];
      for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
        if (!P(i, j)) continue;
        const nb = [P(i, j - 1), P(i + 1, j - 1), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), P(i - 1, j + 1), P(i - 1, j), P(i - 1, j - 1)];
        const B = nb.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let q = 0; q < 8; q++) if (!nb[q] && nb[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? nb[0] * nb[2] * nb[4] || nb[2] * nb[4] * nb[6] : nb[0] * nb[2] * nb[6] || nb[0] * nb[4] * nb[6]) continue;
        del.push(j * nx + i);
      }
      for (const c of del) img[c] = 0;
      if (del.length) changed = true;
    }
  }
  // trace chains between nodes (ends / junctions) over the skeleton's 8-neighbourhood
  // neighbours on the skeleton: the four sides, and a diagonal only where neither side between is set (so a corner
  // is a bend, not a junction)
  const nbrs = (c: number) => {
    const out: number[] = [];
    for (const d of [-nx, nx, -1, 1]) if (img[c + d]) out.push(c + d);
    for (const [dz, dx] of [[-nx, -1], [-nx, 1], [nx, -1], [nx, 1]]) if (img[c + dz + dx] && !img[c + dz] && !img[c + dx]) out.push(c + dz + dx);
    return out;
  };
  const seen = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const chains: number[][] = [];
  const walk = (start: number, first: number) => {
    const chain = [start, first];
    seen.add(edgeKey(start, first));
    let cur = first;
    for (;;) {
      const nb = nbrs(cur);
      if (nb.length !== 2) break;
      const nxt = nb.find((v) => !seen.has(edgeKey(cur, v)));
      if (nxt === undefined) break;
      seen.add(edgeKey(cur, nxt));
      chain.push(nxt);
      cur = nxt;
    }
    chains.push(chain);
  };
  for (let c = 0; c < img.length; c++) {
    if (!img[c]) continue;
    const nb = nbrs(c);
    if (nb.length === 2) continue;
    if (nb.length === 0) {
      chains.push([c]);
      continue;
    }
    for (const v of nb) if (!seen.has(edgeKey(c, v))) walk(c, v);
  }
  for (let c = 0; c < img.length; c++) {
    if (!img[c]) continue;
    for (const v of nbrs(c)) if (!seen.has(edgeKey(c, v))) walk(c, v); // loops
  }
  const toWorld = (c: number) => {
    const i = c % nx, j = (c - i) / nx;
    return [(x0 + i + 0.5) * CELL_SIZE, (z0 + j + 0.5) * CELL_SIZE, Math.max(0.5, dt[c] - 0.5) * CELL_SIZE] as [number, number, number];
  };
  return chains.map((ch) => Float32Array.from(simplify(ch.map(toWorld), eps).flat()));
}

/** Douglas–Peucker on [x, z, w] points (x, z only), ends kept. */
function simplify(pts: [number, number, number][], eps: number): [number, number, number][] {
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
 * One layer of walkways (slot k): along every centre line of the strong paths, a SLAB with thickness per straight
 * stretch (as wide as the path there), a FENCE along both its edges, PIERS at its joints and every `pierSpacing`
 * reaching down `pierDepth` slots, MASTS every `mastSpacing` with WIRES down to the deck on both sides.
 */
function layWalkway(strong: Strong, k: number, cfg: WalkConfig, unit: number, boxes: number[], wires: number[]): void {
  const y = k * unit + cfg.deckThick / 2;
  const top = y + cfg.deckThick / 2;
  for (const line of pathLines([...strong.values()].map((c) => [c.cx, c.cz] as [number, number]))) {
    const m = line.length / 3;
    if (m < 2) continue;
    for (let p = 0; p + 1 < m; p++) {
      const ax = line[p * 3], az = line[p * 3 + 1], bx = line[p * 3 + 3], bz = line[p * 3 + 4];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len, uz = dz / len;
      const yaw = -Math.atan2(uz, ux);
      const w = Math.min(cfg.deckWidth * 2, Math.max(cfg.deckWidth, line[p * 3 + 2] + line[p * 3 + 5]));
      // the slab, a little longer so the joints close
      boxes.push((ax + bx) / 2, y, (az + bz) / 2, len + w * 0.5, cfg.deckThick, w, yaw);
      // the fence on both edges: a rail and posts
      for (const side of [-1, 1]) {
        const ox = -uz * side * w * 0.5, oz = ux * side * w * 0.5;
        if (cfg.fenceHeight > 0) {
          boxes.push((ax + bx) / 2 + ox, top + cfg.fenceHeight, (az + bz) / 2 + oz, len, 0.025, 0.025, yaw);
          const posts = Math.max(1, Math.round(len / 0.8));
          for (let q = 0; q <= posts; q++) {
            const t = q / posts;
            boxes.push(ax + dx * t + ox, top + cfg.fenceHeight / 2, az + dz * t + oz, 0.025, cfg.fenceHeight, 0.025, 0);
          }
        }
      }
      // piers: at the joint, and along long stretches
      if (cfg.pierSpacing > 0) {
        const d = cfg.pierDepth * unit;
        const n = Math.max(1, Math.round(len / cfg.pierSpacing));
        for (let q = p === 0 ? 0 : 1; q <= n; q++) {
          const t = q / n;
          boxes.push(ax + dx * t, y - d / 2, az + dz * t, 0.1, d, 0.1, yaw);
        }
      }
      // masts along the stretch, wires to the deck on both sides
      if (cfg.mastSpacing > 0 && len >= cfg.mastSpacing * 0.5) {
        const mh = cfg.mastHeight * unit;
        const n = Math.max(1, Math.floor(len / cfg.mastSpacing));
        for (let q = 0; q < n; q++) {
          const t = (q + 0.5) / n;
          const mx = ax + dx * t, mz = az + dz * t;
          boxes.push(mx, top + mh / 2, mz, 0.06, mh, 0.06, 0);
          for (const s of [-1, -0.5, 0.5, 1]) {
            const r = (s * cfg.mastSpacing) / 2;
            const ex = mx + ux * r, ez = mz + uz * r;
            const along = (ex - ax) * ux + (ez - az) * uz;
            if (along < 0 || along > len) continue;
            wires.push(mx, top + mh, mz, ex, top, ez);
          }
        }
      }
    }
  }
}
