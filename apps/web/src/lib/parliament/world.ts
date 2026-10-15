/**
 * parliament/world.ts
 *
 * The world is FINITE: a square of WORLD_CELLS × WORLD_CELLS ground cells that wraps around like a torus — walk
 * off one edge and you come in from the opposite one, so the ground cannot grow without end however far anyone
 * walks (the player walks ~7 units/s; the ground people share is a few dozen units across).
 *
 *   - every STORED coordinate is canonical: x, z ∈ [−WORLD_HALF, WORLD_HALF)  (wrapCoord; log.ts applies it on load,
 *     RoleField when it emits, the player when they move)
 *   - every DISTANCE is the shortest way round (wrapDelta, wrapDist): fold, flow, stress, who is near, what I hear
 *   - every CELL INDEX is canonical (wrapCell): a presence near the edge splats onto the cells across it
 *   - the GLOBAL views draw the square as it is (a building on the edge shows on both edges, like a map)
 *   - the PLAYER view draws the nearest image of everything around them (nearestImage), so the edge is seamless
 *
 * The size is the one knob: WORLD_CELLS. It is also the most the nature history grid can hold (natureHistory.ts),
 * so the global history never clips.
 */

import { CELL_SIZE } from "@/lib/stratum/field";

/** Cells per side. 160 cells × 1.2 = 192 world units: ~27 s edge to edge at full walking speed. */
export const WORLD_CELLS = 160;
export const WORLD_SIZE = WORLD_CELLS * CELL_SIZE;
export const WORLD_HALF = WORLD_SIZE / 2;
const HALF_CELLS = WORLD_CELLS / 2;

/** Canonical coordinate: [−WORLD_HALF, WORLD_HALF). */
export function wrapCoord(v: number): number {
  return v - WORLD_SIZE * Math.floor((v + WORLD_HALF) / WORLD_SIZE);
}

/** The shortest signed difference round the torus: (−WORLD_HALF, WORLD_HALF]. */
export function wrapDelta(d: number): number {
  return d - WORLD_SIZE * Math.round(d / WORLD_SIZE);
}

/** Shortest distance between two points. */
export function wrapDist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(wrapDelta(ax - bx), wrapDelta(az - bz));
}

/** Canonical cell index: [−WORLD_CELLS/2, WORLD_CELLS/2). */
export function wrapCell(c: number): number {
  return ((((c + HALF_CELLS) % WORLD_CELLS) + WORLD_CELLS) % WORLD_CELLS) - HALF_CELLS;
}

/** The image of coordinate `v` nearest to `around` (for drawing around a viewer who stands near the edge). */
export function nearestImage(v: number, around: number): number {
  return around + wrapDelta(v - around);
}

/** The same event with canonical coordinates (the same object when it already is). */
export function wrapEvent<T extends { x: number; z: number }>(e: T): T {
  const x = wrapCoord(e.x);
  const z = wrapCoord(e.z);
  return x === e.x && z === e.z ? e : { ...e, x, z };
}
