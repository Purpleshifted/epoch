/**
 * parliament/fold.ts
 *
 * Pure fold: events (log) + a viewing time `sView` -> what is on the ground at that moment.
 *
 * WORKER rule (the first role built). Concrete appears where worker presence is DENSE IN
 * SPACETIME, not only at the same moment: every presence sample (x, z, s) counts towards a
 * ground cell with a linear distance kernel inside the spatial radius, and a cell nucleates a
 * slab at the first moment the kernel-weighted presence inside the sliding window
 * (s - windowSec, s] reaches `threshold`. After that each further `pourUnit` raises the slab by
 * one unit. Nothing is counted from after `sView`, so the fold is causal.
 *
 * Wear is measured in MODEL years (geoClock, log-compressed wall time) since the last presence
 * that kept the slab in use. The exposed slab wears faster than the buried footprint, so in a far
 * future only the outline of where people crowded is left.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { DEFAULT_FOLD, type FilterTrace, type FoldConfig, type PEvent, type Slab, type Snapshot } from "./types";

const MIN_FOOT = 0.03;
const MIN_ALPHA = 0.05;
const EPS = 1e-9;

export interface Region {
  x: number;
  z: number;
  r: number;
}

interface Acc {
  cx: number;
  cz: number;
  s: number[];
  w: number[];
}

export function foldWorld(
  events: readonly PEvent[],
  sView: number,
  cfg: FoldConfig = DEFAULT_FOLD,
  region?: Region,
): Snapshot {
  const reach = region ? region.r + cfg.radius : Infinity;
  const vis: PEvent[] = [];
  for (const e of events) {
    if (e.s > sView) continue; // the future of this viewer: invisible
    if (region && Math.hypot(e.x - region.x, e.z - region.z) > reach) continue;
    vis.push(e);
  }
  vis.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // ties by id: same float sums in every view

  const yView = geoYears(sView);
  const filters: FilterTrace[] = [];
  const cells = new Map<string, Acc>();
  const n = Math.ceil(cfg.radius / CELL_SIZE);

  for (const e of vis) {
    if (e.r !== "worker") continue;
    if (e.k === "f") {
      const alpha = Math.exp(-Math.max(0, yView - geoYears(e.s)) / cfg.tauFilterYears);
      if (alpha >= MIN_ALPHA) filters.push({ id: e.id, x: e.x, z: e.z, alpha, s: e.s });
      continue;
    }
    // presence: splat onto the cells whose centre lies inside the spatial radius
    const cx0 = Math.floor(e.x / CELL_SIZE);
    const cz0 = Math.floor(e.z / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        const d = Math.hypot((cx + 0.5) * CELL_SIZE - e.x, (cz + 0.5) * CELL_SIZE - e.z);
        if (d >= cfg.radius) continue;
        const key = `${cx},${cz}`;
        let acc = cells.get(key);
        if (!acc) {
          acc = { cx, cz, s: [], w: [] };
          cells.set(key, acc);
        }
        acc.s.push(e.s);
        acc.w.push(1 - d / cfg.radius);
      }
    }
  }

  const slabs: Slab[] = [];
  for (const [key, acc] of cells) {
    const { s, w } = acc;
    let lo = 0;
    let sum = 0;
    let nuc = -1;
    for (let j = 0; j < s.length; j++) {
      sum += w[j] * cfg.sampleSec;
      while (s[j] - s[lo] >= cfg.windowSec) {
        sum -= w[lo] * cfg.sampleSec;
        lo++;
      }
      if (sum >= cfg.threshold - EPS) {
        nuc = j;
        break;
      }
    }
    if (nuc < 0) continue;

    let mass = sum;
    for (let k = nuc + 1; k < s.length; k++) mass += w[k] * cfg.sampleSec;
    const raw = Math.min(cfg.maxHeight, 1 + Math.max(0, mass - cfg.threshold) / cfg.pourUnit);

    const lastS = s[s.length - 1];
    const age = Math.max(0, yView - geoYears(lastS));
    const foot = Math.exp(-age / cfg.tauFootprintYears);
    if (foot < MIN_FOOT) continue;
    const h = raw * Math.exp(-age / cfg.tauSlabYears);
    slabs.push({
      key,
      x: (acc.cx + 0.5) * CELL_SIZE,
      z: (acc.cz + 0.5) * CELL_SIZE,
      h,
      foot,
      bornS: s[nuc],
      lastS,
    });
  }
  slabs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { slabs, filters };
}

/** Latest event time in the log (0 for an empty log). */
export function latestS(events: readonly PEvent[]): number {
  let m = 0;
  for (const e of events) if (e.s > m) m = e.s;
  return m;
}
