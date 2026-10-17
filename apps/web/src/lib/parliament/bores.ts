/**
 * parliament/bores.ts — BOREHOLES: where cars pass many times, the sediment under the road is drilled.
 *
 * Every ENTRY of a car into a ground cell is one pass: between two consecutive samples of a car (≤ MAX_STEP_SEC
 * apart) the cells it crossed (flow.ts treadCells) minus the one it started in; standing still, or crawling about
 * inside one cell, is no pass. The `passes`-th pass of a cell opens a BORE there: from that moment (s) a vertical
 * void at (x, z) down through every older layer — a core sample pulled out of the ground. The 3D timespace and the
 * side section draw it (achromatic, like every human trace); here only where and when. Pure.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { MAX_STEP_SEC, cellKey, treadCells } from "./flow";
import type { PEvent } from "./types";
import { wrapDelta } from "./world";

export interface BoreConfig {
  /** Car passes of a cell that open a bore under it. */
  passes: number;
}

export const DEFAULT_BORE: BoreConfig = { passes: 12 };

export interface Bore {
  key: string;
  /** Cell centre. */
  x: number;
  z: number;
  /** When the bore opened (assigned seconds): the `passes`-th pass. */
  s: number;
  /** Passes so far (≥ cfg.passes). */
  n: number;
}

/** Per cell, the times at which a car entered it (sorted), from the car presence events up to `sView`. */
export function carPasses(events: readonly PEvent[], sView = Infinity): Map<string, number[]> {
  const byCar = new Map<string, PEvent[]>();
  for (const e of events) {
    if (e.r !== "car" || e.k !== "p" || e.s > sView) continue;
    const list = byCar.get(e.o);
    if (list) list.push(e);
    else byCar.set(e.o, [e]);
  }
  const passes = new Map<string, number[]>();
  for (const list of byCar.values()) {
    list.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1], e = list[i];
      if (e.s - p.s > MAX_STEP_SEC) continue;
      const dx = wrapDelta(e.x - p.x);
      const dz = wrapDelta(e.z - p.z);
      if (Math.hypot(dx, dz) < 1e-6) continue;
      const cells = treadCells(p.x, p.z, dx, dz);
      for (let k = 1; k < cells.length; k++) {
        const key = cellKey(cells[k][0], cells[k][1]);
        const t = passes.get(key);
        if (t) t.push(e.s);
        else passes.set(key, [e.s]);
      }
    }
  }
  for (const t of passes.values()) t.sort((a, b) => a - b);
  return passes;
}

/** The bores open at `sView`, oldest first. */
export function bores(events: readonly PEvent[], cfg: BoreConfig = DEFAULT_BORE, sView = Infinity): Bore[] {
  const need = Math.max(1, Math.round(cfg.passes));
  const out: Bore[] = [];
  for (const [key, t] of carPasses(events, sView)) {
    if (t.length < need) continue;
    const [cx, cz] = key.split(",").map(Number);
    out.push({ key, x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, s: t[need - 1], n: t.length });
  }
  out.sort((a, b) => a.s - b.s || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
