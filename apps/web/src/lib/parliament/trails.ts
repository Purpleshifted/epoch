/**
 * parliament/trails.ts — THE PATHS, STAGE 1 (the artist, 2026-11-12: "이제 슬슬 길 시작하자"): every walk as a thread
 * through the block. A walk is what it is in spacetime — a slanted line from where and when somebody was to where and
 * when they were a second later. A herd moving on is a strand of such threads; a way taken again and again, at
 * whatever times, is a curtain of them. Nothing is decided yet about what a path BECOMES (a trodden floor, a bridge
 * between buildings): this only shows the movement the next stage will be made of.
 *
 * Pure: the log's events in, line segments out (x, y = time as height, z — two points each).
 */

import type { PEvent } from "./types";
import { wrapDist } from "./world";

export interface TrailOptions {
  /** Seconds of one slot of the time axis, and the world height of a slot. */
  secPerUnit: number;
  unit: number;
  /** A step shorter than this (world units between two samples) is standing, not walking. */
  minStep: number;
  /** Two samples further apart in time than this (s) are not one walk. */
  maxGapSec: number;
}

export const DEFAULT_TRAILS = { minStep: 0.6, maxGapSec: 3 };

/** The walks in `events` as line segments: 6 numbers each (x1, y1, z1, x2, y2, z2). */
export function trailSegments(events: readonly Pick<PEvent, "o" | "x" | "z" | "s" | "k">[], o: TrailOptions): Float32Array {
  const by = new Map<string, { x: number; z: number; s: number }[]>();
  for (const e of events) {
    if (e.k !== undefined && e.k !== "p") continue;
    const l = by.get(e.o);
    if (l) l.push(e);
    else by.set(e.o, [e]);
  }
  const out: number[] = [];
  const h = o.unit / Math.max(1e-6, o.secPerUnit);
  for (const l of by.values()) {
    l.sort((a, b) => a.s - b.s);
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      const dt = b.s - a.s;
      if (dt <= 0 || dt > o.maxGapSec) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      // a step across the world's edge is short round the torus but long on the map: not drawn
      if (d < o.minStep || d > wrapDist(a.x, a.z, b.x, b.z) + 1e-6) continue;
      out.push(a.x, a.s * h, a.z, b.x, b.s * h, b.z);
    }
  }
  return Float32Array.from(out);
}
