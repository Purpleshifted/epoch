/**
 * parliament/nature.ts
 *
 * The "default accumulated nature" of the player view: vegetation as a DENSITY per ground cell
 * (rendered as a point cloud). Formulas here are PLACEHOLDERS chosen for the look; the
 * literature-backed laws (docs/urban-*-research.md) can replace them later without touching the
 * renderer, because everything goes through `grassDensity`.
 *
 *   G(cell) = G0(cell) · exp(−S(cell)) · (1 − pathBite·p(cell)) · (sealed ? sealedLeft : 1)
 *
 * G0   base density: smooth noise (patches of meadow / bare ground), deterministic.
 * S    stress: every worker presence sample (x, z, s) adds `dose · w(d)` to the cells within
 *      `lingerRadius` (w = linear kernel), and that dose fades with e-folding time `recoverSec`.
 *      A worker who lingers digs S up, so G falls; when they leave, S decays and G recovers.
 * p    desire-path formation from the fold (cells crossed many times).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { PEvent } from "./types";

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
}

export const DEFAULT_NATURE: NatureConfig = {
  lingerRadius: 3.5,
  dose: 0.12,
  recoverSec: 45,
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
export function stressMap(
  events: readonly PEvent[],
  sView: number,
  cfg: NatureConfig,
  region?: StressRegion,
): Map<string, number> {
  const out = new Map<string, number>();
  const n = Math.ceil(cfg.lingerRadius / CELL_SIZE);
  const reach = region ? region.r + cfg.lingerRadius : Infinity;
  for (const e of events) {
    if (e.r !== "worker" || e.k !== "p" || e.s > sView) continue;
    const decay = Math.exp(-(sView - e.s) / cfg.recoverSec);
    if (decay < 0.01) continue;
    if (region && Math.hypot(e.x - region.x, e.z - region.z) > reach) continue;
    const cx0 = Math.floor(e.x / CELL_SIZE);
    const cz0 = Math.floor(e.z / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        const d = Math.hypot((cx + 0.5) * CELL_SIZE - e.x, (cz + 0.5) * CELL_SIZE - e.z);
        if (d >= cfg.lingerRadius) continue;
        const key = `${cx},${cz}`;
        out.set(key, (out.get(key) ?? 0) + cfg.dose * (1 - d / cfg.lingerRadius) * decay);
      }
    }
  }
  return out;
}

/** Vegetation density of one cell (0..1). */
export function grassDensity(ix: number, iz: number, stress: number, pathP: number, sealed: boolean, cfg: NatureConfig): number {
  const g = baseGrass(ix, iz) * Math.exp(-stress) * (1 - cfg.pathBite * pathP);
  return sealed ? g * cfg.sealedLeft : g;
}
