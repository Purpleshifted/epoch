/**
 * parliament/natureHistory.ts
 *
 * The vegetation of the player view, accumulated per TIME SLOT, for the 3D timespace (y = time).
 *
 * For every ground cell of the world extent and every slot k, V(c, k) is the mean vegetation density during that
 * slot, from exactly the terms of the player view (nature.ts / grassDensity):
 *
 *   V(c,k) = mean over the slot of  baseGrass(c) · exp(−S) · (1 − pathBite·p) · (sealed ? sealedLeft : 1)
 *
 *   S      worker stress, carried slot to slot: S_end(k) = S_end(k−1)·exp(−slot/recoverSec) + this slot's doses
 *          (same kernel and decay as stressMap, so S_end(k) equals stressMap at the slot's end)
 *   p      desire paths, the fold's rule: entries counted per cell, (1 − e^(−n/pathVisits)) · e^(−age/tauPathYears);
 *          V2 (fold.flow): the ground trodden by sustained flow (flow.ts), not trodden where a slab already stands
 *   sealed a slab stands on the cell: from the seed's birth for as long as its height (the fold's wear,
 *          raw · e^(−age/tauSlabYears), age in model years since the last presence) stays ≥ SEAL_H
 *
 * The mean over a slot is the average of the slot's start and end. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { cellKey, flowLevel, flowP, flowTracks, stayShares } from "./flow";
import { grassDensity, hash2, type NatureConfig } from "./nature";
import { partAgeYears, seedAgeYears, type Box, type Seed } from "./seeds";
import type { FoldConfig, PEvent } from "./types";

/** A slab at least this high seals its cell (same as the player view). */
export const SEAL_H = 0.15;
/** The fold drops paths below this. */
const MIN_PATH = 0.05;
/** The extent never grows beyond this many cells per side (keeps the grid bounded). */
export const MAX_EXTENT_CELLS = 160;

export interface NatureHistory {
  /** Cell index of the extent's first column / row. */
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** First slot and number of slots. */
  k0: number;
  nk: number;
  /** V[(k − k0)·nx·nz + j·nx + i] for cell (x0 + i, z0 + j). */
  V: Float32Array;
  /** Desire-path strength p (0..1) at the end of each slot, same layout as V. */
  P: Float32Array;
}

export interface NatureHistoryInput {
  events: readonly PEvent[];
  /** Seeds of the history view (folded without wear: `mass` is the raw height). */
  seeds: readonly Seed[];
  secPerUnit: number;
  /** Slots k0 … k1 (inclusive) are returned. */
  k0: number;
  k1: number;
  /** Cells added around the bounding box of all presence. */
  margin: number;
  nature: NatureConfig;
  fold: FoldConfig;
  /** Vegetation added near water (waterField × vegBoost) per (cell, slot); not on sealed cells. */
  waterBoost?: (ix: number, iz: number, k: number) => number;
}

const EMPTY: NatureHistory = { x0: 0, z0: 0, nx: 0, nz: 0, k0: 0, nk: 0, V: new Float32Array(0), P: new Float32Array(0) };

/** Whether a seed's slab still seals its cell at exhibition time t (the fold's wear). */
function sealsAt(seed: Seed, t: number, tauSlabYears: number): boolean {
  if (t < seed.t0) return false;
  const spans = seed.spans && seed.spans.length ? seed.spans : [[seed.t0, seed.t1] as [number, number]];
  let last = seed.t0;
  for (const [a, b] of spans) {
    if (a > t) break;
    last = Math.max(last, Math.min(b, t));
  }
  const age = Math.max(0, geoYears(t) - geoYears(last));
  return seed.mass * Math.exp(-age / tauSlabYears) >= SEAL_H;
}

export function natureHistory(input: NatureHistoryInput): NatureHistory {
  const { events, seeds, secPerUnit: spu, nature: nc, fold } = input;
  const k0 = Math.max(0, Math.floor(input.k0));
  const k1 = Math.floor(input.k1);
  if (k1 < k0 || !(spu > 0)) return EMPTY;

  // worker presence, in the fold's order
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!pres.length) return EMPTY;

  // extent: bounding box of all presence + margin (bounded)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const e of pres) {
    const cx = Math.floor(e.x / CELL_SIZE);
    const cz = Math.floor(e.z / CELL_SIZE);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;
  }
  const m = Math.max(0, Math.round(input.margin));
  let x0 = minX - m;
  let z0 = minZ - m;
  let nx = maxX - minX + 1 + 2 * m;
  let nz = maxZ - minZ + 1 + 2 * m;
  if (nx > MAX_EXTENT_CELLS) {
    x0 += Math.floor((nx - MAX_EXTENT_CELLS) / 2);
    nx = MAX_EXTENT_CELLS;
  }
  if (nz > MAX_EXTENT_CELLS) {
    z0 += Math.floor((nz - MAX_EXTENT_CELLS) / 2);
    nz = MAX_EXTENT_CELLS;
  }
  const nc2 = nx * nz;
  const inGrid = (cx: number, cz: number) => cx >= x0 && cx < x0 + nx && cz >= z0 && cz < z0 + nz;
  const idx = (cx: number, cz: number) => (cz - z0) * nx + (cx - x0);

  // sealing: a seed seals its own cell
  const sealers = new Map<number, Seed[]>();
  for (const sd of seeds) {
    const cx = Math.floor(sd.x / CELL_SIZE);
    const cz = Math.floor(sd.z / CELL_SIZE);
    if (!inGrid(cx, cz)) continue;
    const i = idx(cx, cz);
    const list = sealers.get(i);
    if (list) list.push(sd);
    else sealers.set(i, [sd]);
  }

  // V2: paths from sustained flow; a seed's cell is not trodden from its birth on
  const flow = fold.flow?.enabled ? fold.flow : null;
  let tread: ReturnType<typeof flowTracks> | null = null;
  if (flow) {
    const born = new Map<string, number>();
    for (const sd of seeds) {
      const key = cellKey(Math.floor(sd.x / CELL_SIZE), Math.floor(sd.z / CELL_SIZE));
      born.set(key, Math.min(born.get(key) ?? Infinity, sd.t0));
    }
    tread = flowTracks(pres, stayShares(pres, flow), (k) => born.get(k));
  }

  const S = new Float64Array(nc2);
  const visitsN = new Float64Array(nc2);
  const visitsLast = new Float64Array(nc2).fill(-1);
  const lastCell = new Map<string, number>();
  const n = Math.ceil(nc.lingerRadius / CELL_SIZE);
  const fall = Math.exp(-spu / nc.recoverSec);
  const out = new Float32Array((k1 - k0 + 1) * nc2);
  const pathOut = new Float32Array((k1 - k0 + 1) * nc2);
  const Sstart = new Float64Array(nc2);

  const kFirst = Math.min(k0, Math.floor(pres[0].s / spu));
  let ei = 0;
  // events before kFirst cannot exist (kFirst ≤ the first event's slot)
  for (let k = kFirst; k <= k1; k++) {
    const tEnd = (k + 1) * spu;
    const emit = k >= k0;
    if (emit) {
      // stress at the slot's start (carried from the previous slot's end); paths and seal are taken at its end
      for (let i = 0; i < nc2; i++) Sstart[i] = S[i];
    }
    for (let i = 0; i < nc2; i++) S[i] *= fall;
    for (; ei < pres.length && pres[ei].s < tEnd; ei++) {
      const e = pres[ei];
      const cx0 = Math.floor(e.x / CELL_SIZE);
      const cz0 = Math.floor(e.z / CELL_SIZE);
      // a visit = entering a cell
      const vk = inGrid(cx0, cz0) ? idx(cx0, cz0) : -1;
      if (lastCell.get(e.o) !== vk) {
        lastCell.set(e.o, vk);
        if (vk >= 0) {
          visitsN[vk]++;
          visitsLast[vk] = e.s;
        }
      }
      const decay = Math.exp(-(tEnd - e.s) / nc.recoverSec);
      for (let dx = -n; dx <= n; dx++) {
        for (let dz = -n; dz <= n; dz++) {
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          if (!inGrid(cx, cz)) continue;
          const d = Math.hypot((cx + 0.5) * CELL_SIZE - e.x, (cz + 0.5) * CELL_SIZE - e.z);
          if (d >= nc.lingerRadius) continue;
          S[idx(cx, cz)] += nc.dose * (1 - d / nc.lingerRadius) * decay;
        }
      }
    }
    if (!emit) continue;

    const yEnd = geoYears(tEnd);
    const base = (k - k0) * nc2;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        let p = 0;
        if (flow && tread) {
          p = flowP(flowLevel(tread.get(cellKey(x0 + i, z0 + j)), tEnd, flow.tauSec), flow);
          if (p < MIN_PATH) p = 0;
        } else if (visitsN[c] > 0) {
          p = (1 - Math.exp(-visitsN[c] / fold.pathVisits)) * Math.exp(-Math.max(0, yEnd - geoYears(visitsLast[c])) / fold.tauPathYears);
          if (p < MIN_PATH) p = 0;
        }
        const list = sealers.get(c);
        const sealed = !!list && list.some((sd) => sealsAt(sd, tEnd, fold.tauSlabYears));
        const ix = x0 + i;
        const iz = z0 + j;
        const a = grassDensity(ix, iz, Sstart[c], p, sealed, nc);
        const b = grassDensity(ix, iz, S[c], p, sealed, nc);
        out[base + c] = Math.min(1, (a + b) / 2 + (!sealed && input.waterBoost ? input.waterBoost(ix, iz, k) : 0));
        pathOut[base + c] = p;
      }
    }
  }
  return { x0, z0, nx, nz, k0, nk: k1 - k0 + 1, V: out, P: pathOut };
}

/** Path strength at world (x, z) in slot k, interpolated between cell centres (0 outside the history). */
export function pathAt(h: NatureHistory, x: number, z: number, k: number): number {
  const kk = k - h.k0;
  if (kk < 0 || kk >= h.nk || !h.P.length) return 0;
  const fx = x / CELL_SIZE - 0.5 - h.x0, fz = z / CELL_SIZE - 0.5 - h.z0;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const base = kk * h.nx * h.nz;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= h.nx || j >= h.nz ? 0 : h.P[base + j * h.nx + i]);
  const a = at(i0, j0) + (at(i0 + 1, j0) - at(i0, j0)) * tx;
  const b = at(i0, j0 + 1) + (at(i0 + 1, j0 + 1) - at(i0, j0 + 1)) * tx;
  return a + (b - a) * tz;
}

/** V of cell (ix, iz) in slot k, or null outside the history. */
export function natureAt(h: NatureHistory, ix: number, iz: number, k: number): number | null {
  const i = ix - h.x0;
  const j = iz - h.z0;
  const kk = k - h.k0;
  if (i < 0 || j < 0 || kk < 0 || i >= h.nx || j >= h.nz || kk >= h.nk) return null;
  return h.V[kk * h.nx * h.nz + j * h.nx + i];
}

/** What a nature point is (the renderer picks the colour). */
export const NATURE_KIND = { soil: 0, grass: 1, herb: 2, dry: 3, moss: 4, woody: 5, buried: 6, humus: 7, peat: 8, trodden: 9, wet: 10, channel: 11 } as const;

export interface NaturePointOptions {
  /** World size of a time slot (y). */
  unit: number;
  /** Points per (cell, slot) at density 1. */
  perSlot: number;
  /**
   * DENSITY FLOOR: cells thinner than this have no points (fading in over DENSITY_BAND above it), so only the dense
   * vegetation shows and the buildings' structure reads through; per slot when a function (it may rise with age).
   * 0 / absent = every cell by its density.
   */
  cut?: number | ((k: number) => number);
  /** BURIAL: (cell, slot) lies under concrete laid later — its points become a dark, compressed layer. */
  buried?: (ix: number, iz: number, k: number) => boolean;
  /**
   * SEDIMENT: a slot's vegetation turns into humus, then peat, and compacts toward the slot's floor as it ages:
   * share q = 1 − e^(−A/tauYears), A = model years since the slot's end (× timeScale) at tNow.
   */
  sediment?: { tNow: number; secPerUnit: number; timeScale: number; tauYears: number; jitter?: number; /** Typical depth (slots) at which a layer begins to rot (seeds.rotOnsetSlots). */ graceSlots?: number };
  /** Share of a slot's points that are drawn (0..1), e.g. 1 − fused weight: fused layers are drawn as one mass. */
  thin?: (k: number) => number;
  /** Share of a cell's points in a slot that are drawn (0..1): where mass has formed, no vegetation points. */
  thinCell?: (ix: number, iz: number, k: number) => number;
  /** TIME ERROR (as BoxConfig.timeJitter): points spill up to ± this many slots beyond their slot (never below 0). */
  timeJitter?: number;
  /**
   * PATHS as holes: where the path strength (interpolated between cell centres) reaches `hole`, no vegetation point;
   * on the rim (from 0.3 · hole) the points are trodden-aside ground lying low (grey: a human trace), with `berm`
   * extra ones heaped up.
   */
  paths?: { hole: number; berm: number };
  /**
   * WATER: no points within `half` of a course (the channel stays clear); beyond it, wetland vegetation — a share
   * `share` at the bank, fading to 0 at `radius`.
   */
  water?: { dist: (x: number, z: number, k: number) => number; half: number; radius: number; share: number; near?: (ix: number, iz: number, k: number) => number };
  /**
   * FOSSIL TRACES (V2): in slots whose density floor has reached `from` (their vegetation is gone or going), what
   * paths and waterways left stays in the stratum — a path as a thin compacted lamina of trodden ground (grey,
   * flat, `per` points per cell at full strength, where the path strength reaches `hole`), a waterway as a
   * paleochannel: a pale lens of sand along its course, thickest in the middle (needs `water`). Human traces:
   * achromatic.
   */
  fossil?: { from: number; per: number; hole: number };
}

/** The sediment share of slot k (0 fresh … 1 fully turned to sediment). */
export function sedimentShare(k: number, sed: NonNullable<NaturePointOptions["sediment"]>): number {
  const laid = Math.min(sed.tNow, (k + 1 + (sed.graceSlots ?? 0)) * sed.secPerUnit);
  const A = Math.max(0, geoYears(sed.tNow) - geoYears(laid)) * sed.timeScale;
  return 1 - Math.exp(-A / sed.tauYears);
}

export interface NaturePoints {
  count: number;
  /** x, y, z per point. */
  position: Float32Array;
  /** NATURE_KIND per point. */
  kind: Uint8Array;
  /** 0..1 shade variation per point. */
  shade: Float32Array;
}

const h3 = (a: number, b: number, c: number, salt: number) => hash2((a * 73856093) ^ (c * 19349663), (b * 83492791) ^ (c * 2654435761), salt);

/** Expected number of points of slots [kFrom, kTo] (for budgeting). */
export function naturePointLoad(h: NatureHistory, kFrom: number, kTo: number, perSlot: number, cut?: (k: number) => number): number {
  const a = Math.max(kFrom, h.k0) - h.k0;
  const b = Math.min(kTo, h.k0 + h.nk - 1) - h.k0;
  const n2 = h.nx * h.nz;
  let sum = 0;
  for (let k = a; k <= b; k++) {
    const c = cut ? cut(k + h.k0) : 0;
    if (c >= 1) continue;
    for (let i = k * n2; i < (k + 1) * n2; i++) sum += c > 0 ? h.V[i] * densityFloor(h.V[i], c) : h.V[i];
  }
  return sum * perSlot;
}

/**
 * The points of slots [kFrom, kTo]: round(V · perSlot) per (cell, slot), hashed (deterministic) inside the cell and
 * low in the slot — ground cover, with a few taller stems. Where V is low (worn, sealed) more of them are bare soil.
 */
/** Width of the fade-in above the density floor. */
export const DENSITY_BAND = 0.15;

/** 0 below `cut`, rising smoothly to 1 at cut + DENSITY_BAND. */
export function densityFloor(v: number, cut: number): number {
  const t = Math.max(0, Math.min(1, (v - cut) / DENSITY_BAND));
  return t * t * (3 - 2 * t);
}

export function naturePoints(h: NatureHistory, kFrom: number, kTo: number, opts: NaturePointOptions): NaturePoints {
  const a = Math.max(kFrom, h.k0);
  const b = Math.min(kTo, h.k0 + h.nk - 1);
  const pos: number[] = [];
  const kind: number[] = [];
  const shade: number[] = [];
  for (let k = a; k <= b; k++) {
    const base = (k - h.k0) * h.nx * h.nz;
    const q = opts.sediment ? sedimentShare(k, opts.sediment) : 0;
    const keepShare = opts.thin ? Math.max(0, Math.min(1, opts.thin(k))) : 1;
    if (keepShare <= 0) continue;
    const cutK = typeof opts.cut === "function" ? opts.cut(k) : (opts.cut ?? 0);
    const fossilSlot = !!opts.fossil && cutK >= opts.fossil.from;
    if (fossilSlot) fossilTraces(h, k, base, opts, pos, kind, shade);
    if (cutK >= 1) continue;
    for (let j = 0; j < h.nz; j++) {
      for (let i = 0; i < h.nx; i++) {
        const v0 = h.V[base + j * h.nx + i];
        const v = cutK > 0 ? v0 * densityFloor(v0, cutK) : v0;
        const want = v * opts.perSlot * keepShare * (opts.thinCell ? opts.thinCell(h.x0 + i, h.z0 + j, k) : 1);
        const ix = h.x0 + i;
        const iz = h.z0 + j;
        const n = Math.floor(want) + (h3(ix, iz, k, 1) < want - Math.floor(want) ? 1 : 0);
        const under = !!opts.buried && n > 0 && opts.buried(ix, iz, k);
        for (let p = 0; p < n; p++) {
          const s = p * 7 + 11;
          const rx = h3(ix, iz, k, s);
          const rz = h3(ix, iz, k, s + 1);
          const ry = h3(ix, iz, k, s + 2);
          const rk = h3(ix, iz, k, s + 3);
          // each point's own share: the same slot does not turn to sediment in lockstep
          const qp = opts.sediment?.jitter ? Math.min(1, Math.max(0, q + (h3(ix, iz, k, s + 9) - 0.5) * opts.sediment.jitter)) : q;
          const sed = !under && h3(ix, iz, k, s + 7) < qp;
          // spread through the whole slot (no band at the slot's floor) and spilling over it by the time error;
          // only compaction presses old matter down, and buried matter lies flat
          const J = opts.timeJitter ?? 0;
          const spill = J > 0 ? (h3(ix, iz, k, s + 10) - 0.5) * 2 * J : 0;
          const yy = under ? 0.2 * ry : (ry + spill) * (1 - 0.6 * q);
          const px = (ix + rx) * CELL_SIZE, pz = (iz + rz) * CELL_SIZE;
          let wetShare = 0;
          if (opts.water && !under) {
            const d = opts.water.dist(px, pz, k);
            if (d < opts.water.half) continue; // the channel: clear
            wetShare = d < opts.water.radius ? opts.water.share * (1 - (d - opts.water.half) / Math.max(1e-6, opts.water.radius - opts.water.half)) : 0;
          }
          if (opts.paths && !under) {
            const pf = pathAt(h, px, pz, k);
            if (pf >= opts.paths.hole) continue; // the path itself: bare
            if (pf >= opts.paths.hole * 0.3) {
              // the rim: soil pushed aside by feet, lying low, heaped a little more the closer to the path
              const rim = pf / opts.paths.hole;
              const extra = Math.floor(opts.paths.berm * rim + h3(ix, iz, k, s + 11));
              for (let e = 0; e <= extra; e++) {
                const jx = e ? (h3(ix, iz, k, s + 12 + e) - 0.5) * 0.3 : 0;
                const jz = e ? (h3(ix, iz, k, s + 20 + e) - 0.5) * 0.3 : 0;
                pos.push(px + jx, Math.max(0, (k + (ry + spill) * 0.35) * opts.unit), pz + jz);
                kind.push(NATURE_KIND.trodden);
                shade.push(h3(ix, iz, k, s + 36 + e));
              }
              continue;
            }
          }
          pos.push(px, Math.max(0, (k + yy) * opts.unit), pz);
          const soil = 0.15 + 0.6 * (1 - v);
          if (under) kind.push(NATURE_KIND.buried);
          else if (sed) kind.push(q > 0.6 && h3(ix, iz, k, s + 8) < q ? NATURE_KIND.peat : NATURE_KIND.humus);
          else if (wetShare > 0 && h3(ix, iz, k, s + 13) < wetShare) kind.push(NATURE_KIND.wet);
          else kind.push(rk < soil ? NATURE_KIND.soil : rk < soil + 0.12 ? NATURE_KIND.dry : h3(ix, iz, k, s + 5) < 0.6 ? NATURE_KIND.grass : NATURE_KIND.herb);
          shade.push(h3(ix, iz, k, s + 6));
        }
      }
    }
  }
  return { count: kind.length, position: Float32Array.from(pos), kind: Uint8Array.from(kind), shade: Float32Array.from(shade) };
}

/** FOSSIL TRACES of slot k (see NaturePointOptions.fossil): appended to pos / kind / shade. */
function fossilTraces(h: NatureHistory, k: number, base: number, opts: NaturePointOptions, pos: number[], kind: number[], shade: number[]): void {
  const f = opts.fossil!;
  const w = opts.water;
  for (let j = 0; j < h.nz; j++) {
    for (let i = 0; i < h.nx; i++) {
      const ix = h.x0 + i, iz = h.z0 + j;
      // the path's lamina: trodden ground pressed flat at the slot's floor
      const p = h.P[base + j * h.nx + i];
      if (p >= f.hole) {
        const want = p * f.per;
        const n = Math.floor(want) + (h3(ix, iz, k, 51) < want - Math.floor(want) ? 1 : 0);
        for (let e = 0; e < n; e++) {
          const s = 60 + e * 5;
          pos.push((ix + h3(ix, iz, k, s)) * CELL_SIZE, (k + 0.08 * h3(ix, iz, k, s + 1)) * opts.unit, (iz + h3(ix, iz, k, s + 2)) * CELL_SIZE);
          kind.push(NATURE_KIND.trodden);
          shade.push(0.3 + 0.7 * h3(ix, iz, k, s + 3));
        }
      }
      // the paleochannel: a lens of pale sand along the course
      if (w && w.near && w.near(ix, iz, k) > 0.4) {
        for (let e = 0; e < f.per; e++) {
          const s = 90 + e * 5;
          const px = (ix + h3(ix, iz, k, s)) * CELL_SIZE, pz = (iz + h3(ix, iz, k, s + 1)) * CELL_SIZE;
          const d = w.dist(px, pz, k);
          if (d >= w.half) continue;
          const depth = 1 - d / Math.max(1e-6, w.half);
          pos.push(px, (k + 0.35 * depth * h3(ix, iz, k, s + 2)) * opts.unit, pz);
          kind.push(NATURE_KIND.channel);
          shade.push(0.4 + 0.6 * depth * h3(ix, iz, k, s + 3));
        }
      }
    }
  }
}

/**
 * BURIAL: the slots just below each seed's birth, under its footprint (its cell ± `radius`), hold the vegetation the
 * concrete was laid on — drawn as a dark, compressed layer.
 */
export function burialOf(seeds: readonly Seed[], secPerUnit: number, slots: number, radius = 1): (ix: number, iz: number, k: number) => boolean {
  const births = new Map<string, number[]>();
  for (const sd of seeds) {
    const cx = Math.floor(sd.x / CELL_SIZE);
    const cz = Math.floor(sd.z / CELL_SIZE);
    const b = Math.floor(sd.t0 / secPerUnit);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        const list = births.get(key);
        if (list) list.push(b);
        else births.set(key, [b]);
      }
    }
  }
  return (ix, iz, k) => {
    const list = births.get(`${ix},${iz}`);
    return !!list && list.some((b) => k < b && k >= b - slots);
  };
}

export interface ReclaimConfig {
  /** Model years after which (1 − 1/e of) a ruin is overgrown. */
  tauReclaimYears: number;
  /** STRATA (see WearConfig): parts age from their own slot; absent = from their seed's last presence. */
  secPerUnit?: number;
  /** Multiplies every age (as in wearParts). */
  timeScale?: number;
  /**
   * GATHERING (the 3D view): instead of growing with abandonment, points gather on each standing part by this share
   * (0..1, from its corrosion — fuse.gatheringShare) and wrap it: top faces, sides, hanging beneath. Eroded gaps get
   * none (the mass takes their place).
   */
  gathering?: (b: Box) => number;
  /** Points per cell² of upward face at full reclaim. */
  perArea: number;
  /** World size of a time slot (for plant heights). */
  unit: number;
}

/** How overgrown a seed is, 0..1, from its age in model years. */
export function reclaimShare(ageYears: number, tauReclaimYears: number): number {
  return 1 - Math.exp(-Math.max(0, ageYears) / tauReclaimYears);
}

/**
 * RECLAIM: plants on the ruins. For every seed abandoned for A model years (R = reclaimShare), points on the upward
 * faces of its standing masses, slabs and plinth, ∝ R · face area — and in the gaps left by eroded parts (on the
 * floor of where they were). Succession as on real ruins: moss and lichen first, grasses from R > 0.4, woody growth
 * from R > 0.75. `worn` is wearParts(built, …); parts of `built` missing from it have eroded.
 */
export function reclaimPoints(built: readonly Box[], worn: readonly Box[], seeds: readonly Seed[], tNow: number, cfg: ReclaimConfig): NaturePoints {
  const age = new Map<number, number>();
  for (const sd of seeds) age.set(sd.id, seedAgeYears(sd, tNow));
  const standing = new Set(worn);
  const pos: number[] = [];
  const kind: number[] = [];
  const shade: number[] = [];
  const cell2 = CELL_SIZE * CELL_SIZE;
  if (cfg.gathering) return gatherPoints(worn, cfg.gathering, cfg);
  for (const b of built) {
    if (b.tilt || !(b.kind === "mass" || b.kind === "slab" || b.kind === "plinth")) continue;
    const r = reclaimShare(partAgeYears(b, age, tNow, cfg), cfg.tauReclaimYears);
    if (r <= 0) continue;
    const up = standing.has(b);
    // standing: on its top face; eroded: on the floor it left behind (fewer)
    const y0 = up ? b.y + b.sy / 2 : b.y - b.sy / 2;
    const want = r * cfg.perArea * ((b.sx * b.sz) / cell2) * (up ? 1 : 0.6);
    const bx = Math.round(b.x * 1009);
    const bz = Math.round(b.z * 1013);
    const by = Math.round(b.y * 1019) ^ b.seed;
    const n = Math.floor(want) + (h3(bx, bz, by, 3) < want - Math.floor(want) ? 1 : 0);
    for (let p = 0; p < n; p++) {
      const s = p * 5 + 31;
      const rx = h3(bx, bz, by, s) - 0.5;
      const rz = h3(bx, bz, by, s + 1) - 0.5;
      const rk = h3(bx, bz, by, s + 2);
      const rh = h3(bx, bz, by, s + 3);
      let kd: number;
      if (r > 0.75 && rk < 0.35) kd = NATURE_KIND.woody;
      else if (r > 0.4 && rk < 0.75) kd = NATURE_KIND.grass;
      else kd = NATURE_KIND.moss;
      const hgt = kd === NATURE_KIND.woody ? 0.3 + 0.6 * rh : kd === NATURE_KIND.grass ? 0.25 * rh : 0.02 * rh;
      pos.push(b.x + rx * b.sx, y0 + hgt * cfg.unit, b.z + rz * b.sz);
      kind.push(kd);
      shade.push(h3(bx, bz, by, s + 4));
    }
  }
  return { count: kind.length, position: Float32Array.from(pos), kind: Uint8Array.from(kind), shade: Float32Array.from(shade) };
}

/** GATHERING points: on and around every standing part, ∝ its gathering share · its surface (see ReclaimConfig). */
function gatherPoints(standing: readonly Box[], share: (b: Box) => number, cfg: ReclaimConfig): NaturePoints {
  const pos: number[] = [];
  const kind: number[] = [];
  const shade: number[] = [];
  const cell2 = CELL_SIZE * CELL_SIZE;
  for (const b of standing) {
    if (b.tilt || !(b.kind === "mass" || b.kind === "slab" || b.kind === "plinth")) continue;
    const g = share(b);
    if (g <= 0.005) continue;
    const area = (b.sx * b.sz + (b.sx + b.sz) * b.sy) / cell2;
    const want = g * cfg.perArea * area;
    const bx = Math.round(b.x * 1009), bz = Math.round(b.z * 1013), by = Math.round(b.y * 1019) ^ b.seed;
    const n = Math.floor(want) + (h3(bx, bz, by, 5) < want - Math.floor(want) ? 1 : 0);
    for (let p = 0; p < n; p++) {
      const s = p * 7 + 41;
      const r0 = h3(bx, bz, by, s), r1 = h3(bx, bz, by, s + 1) - 0.5, r2 = h3(bx, bz, by, s + 2) - 0.5;
      const rk = h3(bx, bz, by, s + 3), rh = h3(bx, bz, by, s + 4);
      let x: number, y: number, z: number;
      if (r0 < 0.6) {
        // top: a little above the face (ground cover, a few stems)
        x = b.x + r1 * b.sx;
        z = b.z + r2 * b.sz;
        y = b.y + b.sy / 2 + (rh < 0.1 ? 0.15 + 0.5 * rh : 0.08 * rh) * cfg.unit;
      } else if (r0 < 0.9) {
        // sides: creeping up the walls, just off the face
        const side = Math.floor(h3(bx, bz, by, s + 5) * 4);
        const out = 0.03 + 0.05 * rh;
        y = b.y + r2 * b.sy;
        if (side < 2) {
          x = b.x + (side === 0 ? -1 : 1) * (b.sx / 2 + out);
          z = b.z + r1 * b.sz;
        } else {
          x = b.x + r1 * b.sx;
          z = b.z + (side === 2 ? -1 : 1) * (b.sz / 2 + out);
        }
      } else {
        // hanging beneath
        x = b.x + r1 * b.sx;
        z = b.z + r2 * b.sz;
        y = b.y - b.sy / 2 - 0.3 * rh * cfg.unit;
      }
      pos.push(x, y, z);
      kind.push(rk < 0.45 ? NATURE_KIND.moss : rk < 0.8 ? NATURE_KIND.grass : NATURE_KIND.herb);
      shade.push(h3(bx, bz, by, s + 6));
    }
  }
  return { count: kind.length, position: Float32Array.from(pos), kind: Uint8Array.from(kind), shade: Float32Array.from(shade) };
}
