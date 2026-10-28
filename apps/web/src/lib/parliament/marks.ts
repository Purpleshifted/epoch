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

import type { Other } from "./witness";
import type { Slab } from "./types";
import { nearestImage, wrapDist } from "./world";

export interface OtherMark {
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
    out.push({ x: nearestImage(o.x, me.x), z: nearestImage(o.z, me.z), bright: Math.exp(-o.ageSec / Math.max(0.1, recentSec)), moving: o.moving });
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
