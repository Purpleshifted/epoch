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
 *   p      desire paths, the fold's rule: entries counted per cell, (1 − e^(−n/pathVisits)) · e^(−age/tauPathYears)
 *   sealed a slab stands on the cell: from the seed's birth for as long as its height (the fold's wear,
 *          raw · e^(−age/tauSlabYears), age in model years since the last presence) stays ≥ SEAL_H
 *
 * The mean over a slot is the average of the slot's start and end. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { grassDensity, hash2, type NatureConfig } from "./nature";
import { seedAgeYears, type Box, type Seed } from "./seeds";
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
}

const EMPTY: NatureHistory = { x0: 0, z0: 0, nx: 0, nz: 0, k0: 0, nk: 0, V: new Float32Array(0) };

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

  const S = new Float64Array(nc2);
  const visitsN = new Float64Array(nc2);
  const visitsLast = new Float64Array(nc2).fill(-1);
  const lastCell = new Map<string, number>();
  const n = Math.ceil(nc.lingerRadius / CELL_SIZE);
  const fall = Math.exp(-spu / nc.recoverSec);
  const out = new Float32Array((k1 - k0 + 1) * nc2);
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
        if (visitsN[c] > 0) {
          p = (1 - Math.exp(-visitsN[c] / fold.pathVisits)) * Math.exp(-Math.max(0, yEnd - geoYears(visitsLast[c])) / fold.tauPathYears);
          if (p < MIN_PATH) p = 0;
        }
        const list = sealers.get(c);
        const sealed = !!list && list.some((sd) => sealsAt(sd, tEnd, fold.tauSlabYears));
        const ix = x0 + i;
        const iz = z0 + j;
        const a = grassDensity(ix, iz, Sstart[c], p, sealed, nc);
        const b = grassDensity(ix, iz, S[c], p, sealed, nc);
        out[base + c] = (a + b) / 2;
      }
    }
  }
  return { x0, z0, nx, nz, k0, nk: k1 - k0 + 1, V: out };
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
export const NATURE_KIND = { soil: 0, grass: 1, herb: 2, dry: 3, moss: 4, woody: 5, buried: 6 } as const;

export interface NaturePointOptions {
  /** World size of a time slot (y). */
  unit: number;
  /** Points per (cell, slot) at density 1. */
  perSlot: number;
  /** BURIAL: (cell, slot) lies under concrete laid later — its points become a dark, compressed layer. */
  buried?: (ix: number, iz: number, k: number) => boolean;
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
export function naturePointLoad(h: NatureHistory, kFrom: number, kTo: number, perSlot: number): number {
  const a = Math.max(kFrom, h.k0) - h.k0;
  const b = Math.min(kTo, h.k0 + h.nk - 1) - h.k0;
  let sum = 0;
  for (let i = a * h.nx * h.nz; i < (b + 1) * h.nx * h.nz; i++) sum += h.V[i];
  return sum * perSlot;
}

/**
 * The points of slots [kFrom, kTo]: round(V · perSlot) per (cell, slot), hashed (deterministic) inside the cell and
 * low in the slot — ground cover, with a few taller stems. Where V is low (worn, sealed) more of them are bare soil.
 */
export function naturePoints(h: NatureHistory, kFrom: number, kTo: number, opts: NaturePointOptions): NaturePoints {
  const a = Math.max(kFrom, h.k0);
  const b = Math.min(kTo, h.k0 + h.nk - 1);
  const pos: number[] = [];
  const kind: number[] = [];
  const shade: number[] = [];
  for (let k = a; k <= b; k++) {
    const base = (k - h.k0) * h.nx * h.nz;
    for (let j = 0; j < h.nz; j++) {
      for (let i = 0; i < h.nx; i++) {
        const v = h.V[base + j * h.nx + i];
        const want = v * opts.perSlot;
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
          const stem = h3(ix, iz, k, s + 4) < 0.08;
          const yy = under ? 0.2 * ry : stem ? 0.2 + 0.75 * ry : 0.55 * Math.pow(ry, 2.2);
          pos.push((ix + rx) * CELL_SIZE, (k + yy) * opts.unit, (iz + rz) * CELL_SIZE);
          const soil = 0.15 + 0.6 * (1 - v);
          if (under) kind.push(NATURE_KIND.buried);
          else kind.push(rk < soil ? NATURE_KIND.soil : rk < soil + 0.12 ? NATURE_KIND.dry : h3(ix, iz, k, s + 5) < 0.6 ? NATURE_KIND.grass : NATURE_KIND.herb);
          shade.push(h3(ix, iz, k, s + 6));
        }
      }
    }
  }
  return { count: kind.length, position: Float32Array.from(pos), kind: Uint8Array.from(kind), shade: Float32Array.from(shade) };
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
  const R = new Map<number, number>();
  for (const sd of seeds) R.set(sd.id, reclaimShare(seedAgeYears(sd, tNow), cfg.tauReclaimYears));
  const standing = new Set(worn);
  const pos: number[] = [];
  const kind: number[] = [];
  const shade: number[] = [];
  const cell2 = CELL_SIZE * CELL_SIZE;
  for (const b of built) {
    if (b.tilt || !(b.kind === "mass" || b.kind === "slab" || b.kind === "plinth")) continue;
    const r = R.get(b.seed) ?? 0;
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
