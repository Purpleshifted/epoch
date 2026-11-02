/**
 * parliament/marks.ts — the MARKS of the player view (2026-10-28, the artist's direction; Leva 개인뷰 비주얼 ›
 * 표식): what stands in the frame besides the grass, each thing with a shape of its own, tall enough to fill the
 * view. Greys only (human traces). Pure: the components (OtherBoxes, ConcreteLines, PathCurves) only draw these.
 *
 *   others    a box at eye height for every being within the view (brightness fades with the age of their sample)
 *   concrete  a VERTICAL LINE from the ground up through the frame on every sealed slab cell
 *   (paths as floating curves / ribbons were tried on 2026-10-28 and dropped by the artist — git 023ea8c; the
 *   paths stay what they were: the ground's lines and the dust in the grass)
 *
 * Everything is placed at the image nearest the viewer (the world wraps, world.ts).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { Other } from "./witness";
import type { Slab } from "./types";
import { nearestImage, wrapDist } from "./world";

export interface OtherMark {
  /** Their id (the drawing holds each one's place between its rare moves). */
  o: string;
  x: number;
  z: number;
  /** 0 … 1 (fades with the age of the sample). */
  bright: number;
  moving: boolean;
}

/** One box per being within `radius`, nearest first. */
export function otherMarks(far: readonly Other[], me: { x: number; z: number }, radius: number, recentSec: number): OtherMark[] {
  const out: OtherMark[] = [];
  for (const o of far) {
    if (o.dist > radius) continue;
    out.push({ o: o.o, x: nearestImage(o.x, me.x), z: nearestImage(o.z, me.z), bright: Math.exp(-o.ageSec / Math.max(0.1, recentSec)), moving: o.moving });
  }
  return out;
}

export interface ConcreteLine {
  x: number;
  z: number;
  /** The slab's height (units) — the line's grey comes from it. */
  h: number;
  dist: number;
}

/**
 * The concrete as a line drawing: for every side of a cell that stands above its neighbour (or has none), the top edge,
 * the foot and the two verticals, so a building is its outline with a joint at every cell, and flat [x, y, z, x, y, z …]
 * segments come out. Cells are matched by where they stand (the images nearest the viewer, so across the wrap too).
 */
export function outlineSegments(cells: readonly Pick<ConcreteLine, "x" | "z" | "h">[], scale: number): number[] {
  const half = CELL_SIZE / 2;
  const at = new Map<string, number>();
  const keyOf = (x: number, z: number) => `${Math.round(x / CELL_SIZE - 0.5)},${Math.round(z / CELL_SIZE - 0.5)}`;
  const top = (h: number) => Math.max(0.2, h * scale);
  for (const c of cells) at.set(keyOf(c.x, c.z), top(c.h));
  const out: number[] = [];
  const side = (ax: number, az: number, bx: number, bz: number, lo: number, hi: number) => {
    out.push(ax, hi, az, bx, hi, bz, ax, lo, az, bx, lo, bz, ax, lo, az, ax, hi, az, bx, lo, bz, bx, hi, bz);
  };
  for (const c of cells) {
    const hi = top(c.h);
    const x0 = c.x - half, x1 = c.x + half, z0 = c.z - half, z1 = c.z + half;
    const lo = (dx: number, dz: number) => at.get(keyOf(c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE)) ?? 0;
    if (lo(1, 0) < hi) side(x1, z0, x1, z1, lo(1, 0), hi);
    if (lo(-1, 0) < hi) side(x0, z0, x0, z1, lo(-1, 0), hi);
    if (lo(0, 1) < hi) side(x0, z1, x1, z1, lo(0, 1), hi);
    if (lo(0, -1) < hi) side(x0, z0, x1, z0, lo(0, -1), hi);
  }
  return out;
}

/** A vertical line on every sealed slab cell within `radius`, nearest first. */
export function concreteLines(slabs: readonly Slab[], me: { x: number; z: number }, radius: number, sealedH: number): ConcreteLine[] {
  const out: ConcreteLine[] = [];
  for (const s of slabs) {
    if (s.h < sealedH) continue;
    const dist = wrapDist(s.x, s.z, me.x, me.z);
    if (dist > radius) continue;
    out.push({ x: nearestImage(s.x, me.x), z: nearestImage(s.z, me.z), h: s.h, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
