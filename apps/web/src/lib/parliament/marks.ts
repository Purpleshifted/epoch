/**
 * parliament/marks.ts — the MARKS of the player view (2026-10-28, the artist's direction; Leva 개인뷰 비주얼 ›
 * 표식): what stands in the frame besides the grass, each thing with a shape of its own, tall enough to fill the
 * view. Greys only (human traces). Pure: the components (OtherBoxes, ConcreteLines, PathCurves) only draw these.
 *
 *   others    a box at eye height for every being within the view (brightness fades with the age of their sample)
 *   concrete  a VERTICAL LINE from the ground up through the frame on every sealed slab cell
 *   paths     the path cells joined into CHAINS (where routes meet, the chains meet) and smoothed into curves
 *             (Catmull-Rom), to float a little below eye height as HORIZONTAL CURVES
 *
 * Everything is placed at the image nearest the viewer (the world wraps, world.ts).
 */

import type { Other } from "./witness";
import type { PathCell, Slab } from "./types";
import { nearestImage, wrapCell, wrapDist } from "./world";

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

export interface Chain {
  /** The smoothed curve (world x, z), in order. */
  pts: [number, number][];
  /** Mean path strength of its cells. */
  p: number;
  /** Whether it closes on itself. */
  loop: boolean;
}

/**
 * Uniform Catmull-Rom through `pts` (tension 0.5), `per` samples a span; a closed curve wraps round. Two points
 * give a straight line; one point itself.
 */
export function catmullRom(pts: readonly [number, number][], per = 4, loop = false): [number, number][] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const at = (i: number) => (loop ? pts[((i % n) + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  const out: [number, number][] = [];
  const spans = loop ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  if (loop) out.push(out[0]);
  else out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/**
 * The path cells (p ≥ minP, within `radius`) joined into chains along their neighbours — orthogonal neighbours, and
 * a diagonal only where no orthogonal route joins the two cells (so a slanted path is one chain, not a ladder).
 * A chain runs from a cell that is an end or a meeting point (degree ≠ 2) to the next such cell; what is left
 * (degree 2 everywhere) is a loop. Each chain is then smoothed (catmullRom) with `per` samples a cell.
 */
export function pathChains(paths: readonly PathCell[], me: { x: number; z: number }, radius: number, minP: number, per = 4): Chain[] {
  const cells = new Map<string, PathCell>();
  for (const q of paths) if (q.p >= minP && wrapDist(q.x, q.z, me.x, me.z) <= radius) cells.set(q.key, q);
  const keyOf = (cx: number, cz: number) => `${wrapCell(cx)},${wrapCell(cz)}`;
  const has = (cx: number, cz: number) => cells.has(keyOf(cx, cz));
  const nbrs = new Map<string, string[]>();
  for (const [key, q] of cells) {
    const [cx, cz] = key.split(",").map(Number);
    void q;
    const list: string[] = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (has(cx + dx, cz + dz)) list.push(keyOf(cx + dx, cz + dz));
    }
    for (const [dx, dz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      if (has(cx + dx, cz + dz) && !has(cx + dx, cz) && !has(cx, cz + dz)) list.push(keyOf(cx + dx, cz + dz));
    }
    nbrs.set(key, list);
  }
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const used = new Set<string>();
  const chains: Chain[] = [];
  const centre = (key: string): [number, number] => {
    const q = cells.get(key)!;
    return [nearestImage(q.x, me.x), nearestImage(q.z, me.z)];
  };
  const walk = (start: string, next: string): string[] => {
    const seq = [start];
    let prev = start, cur = next;
    used.add(edgeKey(prev, cur));
    for (;;) {
      seq.push(cur);
      const list = nbrs.get(cur)!;
      if (list.length !== 2) break;
      const on = list[0] === prev ? list[1] : list[0];
      if (used.has(edgeKey(cur, on))) break;
      used.add(edgeKey(cur, on));
      prev = cur;
      cur = on;
    }
    return seq;
  };
  const finish = (seq: string[], loop: boolean) => {
    const pts = seq.map(centre);
    const p = seq.reduce((s, k) => s + cells.get(k)!.p, 0) / seq.length;
    chains.push({ pts: catmullRom(loop ? pts.slice(0, -1) : pts, per, loop), p, loop });
  };
  // from the ends and the meeting points
  for (const [key, list] of nbrs) {
    if (list.length === 2) continue;
    for (const nb of list) {
      if (used.has(edgeKey(key, nb))) continue;
      finish(walk(key, nb), false);
    }
  }
  // what is left are loops
  for (const [key, list] of nbrs) {
    if (list.length !== 2) continue;
    for (const nb of list) {
      if (used.has(edgeKey(key, nb))) continue;
      const seq = walk(key, nb);
      finish(seq, seq[seq.length - 1] === key);
    }
  }
  return chains;
}
