/**
 * parliament/nature.ts
 *
 * The "default accumulated nature" of the player view: vegetation as a DENSITY per ground cell
 * (rendered as a point cloud). Formulas here are PLACEHOLDERS chosen for the look; the
 * literature-backed laws (docs/urban-*-research.md) can replace them later without touching the
 * renderer, because everything goes through `grassDensity`.
 *
 *   G(cell) = min(1, G0(cell) + T(cell)) · exp(−S(cell)) · (1 − pathBite·p(cell)) · (sealed ? sealedLeft : 1)
 *
 * G0   base density: smooth noise (patches of meadow / bare ground), deterministic.
 * T    sowing: every seed event (k = "s", a TREE's scattering) adds `sowDose · w(d)` to the cells within
 *      `sowRadius` and fades with e-folding time `sowSec` (long): new plants, which still wear (S), are
 *      bitten by paths and buried by concrete like the rest.
 * S    stress: every worker presence sample (x, z, s) adds `dose · w(d)` to the cells within
 *      `lingerRadius` (w = linear kernel), and that dose fades with e-folding time `recoverSec`.
 *      A worker who lingers digs S up, so G falls; when they leave, S decays and G recovers.
 *      Other roles by their weight (wearOf): a car `carWear` times a worker (it scars the ground it
 *      crawls over off the road), a street cat and a tree nothing.
 * p    desire-path formation from the fold (cells crossed many times).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { PEvent, RoleId } from "./types";
import { wrapCell, wrapDist } from "./world";

export interface NatureConfig {
  /** World-unit radius within which a lingering worker wears the vegetation down. */
  lingerRadius: number;
  /** Stress added per presence sample at distance 0. */
  dose: number;
  /** e-folding time (assigned seconds) with which stress fades once the worker has gone. */
  recoverSec: number;
  /** How much a fully formed path removes vegetation (0..1). */
  pathBite: number;
  /** Fraction of vegetation left on a concrete-sealed cell. */
  sealedLeft: number;
  /** Candidate points per cell at density 1. */
  pointsPerCell: number;
  /** How hard a CAR wears the vegetation, relative to a worker (absent = DEFAULT_CAR_WEAR). */
  carWear?: number;
  /** A TREE's seed (event k = "s"): world radius it greens, density it adds at its centre, e-folding time (s) it lasts. */
  sowRadius?: number;
  sowDose?: number;
  sowSec?: number;
}

export const DEFAULT_SOW = { sowRadius: 1.8, sowDose: 0.5, sowSec: 900 };

/**
 * One source of per-cell sums (stressMap / StressState): which events, their weight by role, the kernel radius,
 * the dose at the centre and the e-folding time. Stress (wear) and sowing are the two sources.
 */
export interface SumSource {
  kind: "p" | "s";
  weight: (role: RoleId) => number;
  radius: number;
  dose: number;
  tau: number;
}

/** The wear of presence: a worker 1, a car carWear, the rest nothing. */
export const stressSource = (cfg: NatureConfig): SumSource => ({ kind: "p", weight: (r) => wearOf(r, cfg), radius: cfg.lingerRadius, dose: cfg.dose, tau: cfg.recoverSec });
/** The greening of seeds: a tree's only. */
export const sowSource = (cfg: NatureConfig): SumSource => ({
  kind: "s",
  weight: (r) => (r === "tree" ? 1 : 0),
  radius: cfg.sowRadius ?? DEFAULT_SOW.sowRadius,
  dose: cfg.sowDose ?? DEFAULT_SOW.sowDose,
  tau: cfg.sowSec ?? DEFAULT_SOW.sowSec,
});

export const DEFAULT_CAR_WEAR = 4;

/** How hard `role` wears the vegetation, relative to a worker; 0 = not at all. */
export function wearOf(role: RoleId, cfg: NatureConfig): number {
  switch (role) {
    case "worker":
      return 1;
    case "car":
      return cfg.carWear ?? DEFAULT_CAR_WEAR;
    default:
      return 0;
  }
}

export const DEFAULT_NATURE: NatureConfig = {
  lingerRadius: 3.5,
  dose: 0.12,
  recoverSec: 45,
  carWear: DEFAULT_CAR_WEAR,
  ...DEFAULT_SOW,
  pathBite: 0.95,
  sealedLeft: 0.05,
  pointsPerCell: 28,
};

/** Deterministic 0..1 hash of two integers (+ salt). */
export function hash2(ix: number, iz: number, salt = 0): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function valueNoise(x: number, z: number, salt = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0, salt);
  const b = hash2(x0 + 1, z0, salt);
  const c = hash2(x0, z0 + 1, salt);
  const d = hash2(x0 + 1, z0 + 1, salt);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Base vegetation density of a cell before anyone has walked on it: 0.2 .. 1. */
export function baseGrass(ix: number, iz: number): number {
  const n = 0.65 * valueNoise(ix / 7, iz / 7, 11) + 0.35 * valueNoise(ix / 2.5, iz / 2.5, 23);
  return 0.2 + 0.8 * Math.min(1, Math.max(0, (n - 0.25) / 0.5));
}

export interface StressRegion {
  x: number;
  z: number;
  r: number;
}

/**
 * Worker-induced stress per cell at viewing time `sView`. Only events with s <= sView count
 * (same causality as the fold). Returns Map "ix,iz" -> S (>= 0).
 */
export function stressMap(events: readonly PEvent[], sView: number, cfg: NatureConfig, region?: StressRegion): Map<string, number> {
  return sumMap(events, sView, stressSource(cfg), region);
}

/** The sowing per cell ("cx,cz" → T) at `sView`: what the trees' seeds have added. */
export function sowMap(events: readonly PEvent[], sView: number, cfg: NatureConfig, region?: StressRegion): Map<string, number> {
  return sumMap(events, sView, sowSource(cfg), region);
}

/** A per-cell sum of one source's events, each a linear kernel of its radius, decayed from its time to `sView`. */
export function sumMap(events: readonly PEvent[], sView: number, src: SumSource, region?: StressRegion): Map<string, number> {
  const out = new Map<string, number>();
  const n = Math.ceil(src.radius / CELL_SIZE);
  const reach = region ? region.r + src.radius : Infinity;
  for (const e of events) {
    if (e.k !== src.kind || e.s > sView) continue;
    const w = src.weight(e.r);
    if (w <= 0) continue;
    const decay = Math.exp(-(sView - e.s) / src.tau) * w;
    if (decay < 0.01) continue;
    if (region && wrapDist(e.x, e.z, region.x, region.z) > reach) continue;
    const cx0 = Math.floor(e.x / CELL_SIZE);
    const cz0 = Math.floor(e.z / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const d = Math.hypot((cx0 + dx + 0.5) * CELL_SIZE - e.x, (cz0 + dz + 0.5) * CELL_SIZE - e.z);
        if (d >= src.radius) continue;
        const key = `${wrapCell(cx0 + dx)},${wrapCell(cz0 + dz)}`;
        out.set(key, (out.get(key) ?? 0) + src.dose * (1 - d / src.radius) * decay);
      }
    }
  }
  return out;
}

/** Vegetation density of one cell (0..1): the base plus what was sown, worn by stress, bitten by paths, buried by concrete. */
export function grassDensity(ix: number, iz: number, stress: number, pathP: number, sealed: boolean, cfg: NatureConfig, sow = 0): number {
  const g = Math.min(1, baseGrass(ix, iz) + sow) * Math.exp(-stress) * (1 - cfg.pathBite * pathP);
  return sealed ? g * cfg.sealedLeft : g;
}
