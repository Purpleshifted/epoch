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

// ── STAGE 2: SIMILAR WALKS ARE ONE PATH ─────────────────────────────────────────────────────────────────────────────
//
// (the artist, 2026-11-12: "이제 유사도 판정해서 한 길로 묶는 거 적용하자")
//
// A LEG is one walk of one walker, from where it set off to where it stopped. Two legs are SIMILAR when they go the
// same way between the same two places — in either direction, at whatever times: similarity = how parallel they are
// × how close their ends are (1 = the same line, 0 = an end further than `radius` from the other's, or at right
// angles). A leg joins the most similar ROUTE there is if that is at least `threshold`, else it begins a route of its
// own. Every leg of a route is then drawn ON the route's line (pulled there by `strength`), each still at its own
// time: a way gone again and again stands in the block as one sheet of threads instead of a haze, and its `weight`
// (how many legs it has) is how bright it is.

export interface BundleOptions extends TrailOptions {
  /** A leg shorter than this (world units, end to end) is not a way anywhere: drawn as it is. */
  minLeg: number;
  /** Ends further apart than this are different places. */
  radius: number;
  /** The similarity (0..1) from which a leg belongs to a route. */
  threshold: number;
  /** Only legs within this many seconds of a route's own times join it (0 = whenever). */
  windowSec: number;
  /** 0..1: how far a leg is pulled onto its route's line (0 = as walked, 1 = on the line). */
  strength: number;
  /** Legs of a route at which it is at its brightest. */
  full: number;
}

export const DEFAULT_BUNDLE = { minLeg: 3, radius: 4, threshold: 0.4, windowSec: 0, strength: 1, full: 6 };

interface Pt {
  x: number;
  z: number;
  s: number;
}
interface Leg {
  o: string;
  pts: Pt[];
  /** Length along the walk, and each point's share of it. */
  len: number;
  at: number[];
}
interface Route {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  n: number;
  sMin: number;
  sMax: number;
}

/** The walks of everybody as legs: runs of walking steps, cut where somebody stood, paused or crossed the world's edge. */
export function legsOf(events: readonly Pick<PEvent, "o" | "x" | "z" | "s" | "k">[], o: TrailOptions): Leg[] {
  const by = new Map<string, Pt[]>();
  for (const e of events) {
    if (e.k !== undefined && e.k !== "p") continue;
    const l = by.get(e.o);
    if (l) l.push(e);
    else by.set(e.o, [e]);
  }
  const legs: Leg[] = [];
  for (const [owner, l] of by) {
    l.sort((a, b) => a.s - b.s);
    let cur: Pt[] = [];
    const close = () => {
      if (cur.length >= 2) {
        const at = [0];
        let len = 0;
        for (let i = 1; i < cur.length; i++) at.push((len += Math.hypot(cur[i].x - cur[i - 1].x, cur[i].z - cur[i - 1].z)));
        legs.push({ o: owner, pts: cur, len, at: at.map((d) => (len > 0 ? d / len : 0)) });
      }
      cur = [];
    };
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      const dt = b.s - a.s, d = Math.hypot(b.x - a.x, b.z - a.z);
      if (dt <= 0 || dt > o.maxGapSec || d < o.minStep || d > wrapDist(a.x, a.z, b.x, b.z) + 1e-6) {
        close();
        continue;
      }
      if (!cur.length) cur.push(a);
      cur.push(b);
    }
    close();
  }
  // a fixed order, whatever order the samples came in: the routes are the same
  return legs.sort((p, q) => p.pts[0].s - q.pts[0].s || (p.o < q.o ? -1 : p.o > q.o ? 1 : 0));
}

/** How similar a leg from (ax, az) to (bx, bz) is to a route, as walked (the caller tries it reversed too). */
function similar(ax: number, az: number, bx: number, bz: number, r: Route, R: number): number {
  const dA = Math.hypot(ax - r.ax, az - r.az);
  if (dA >= R) return 0;
  const dB = Math.hypot(bx - r.bx, bz - r.bz);
  if (dB >= R) return 0;
  const ux = bx - ax, uz = bz - az, vx = r.bx - r.ax, vz = r.bz - r.az;
  const cos = (ux * vx + uz * vz) / Math.max(1e-9, Math.hypot(ux, uz) * Math.hypot(vx, vz));
  return Math.max(0, cos) * Math.sqrt((1 - dA / R) * (1 - dB / R));
}

export interface Bundled {
  /** Line segments (x, y = time as height, z — two points each). */
  position: Float32Array;
  /** Per point: 0 = a walk of its own … 1 = on a route of `full` legs or more. */
  weight: Float32Array;
  legs: number;
  routes: number;
  /** Legs that share a route with at least one other. */
  bundled: number;
}

export function bundleTrails(events: readonly Pick<PEvent, "o" | "x" | "z" | "s" | "k">[], o: BundleOptions): Bundled {
  const legs = legsOf(events, o);
  const R = Math.max(0.01, o.radius);
  const routes: Route[] = [];
  /** Per leg: its route (−1 = none) and whether it runs against the route's direction. */
  const of = new Int32Array(legs.length).fill(-1);
  const against = new Uint8Array(legs.length);
  for (let i = 0; i < legs.length; i++) {
    const g = legs[i];
    const a = g.pts[0], b = g.pts[g.pts.length - 1];
    if (Math.hypot(b.x - a.x, b.z - a.z) < o.minLeg) continue;
    let best = -1, bestSim = Math.max(1e-9, o.threshold), flip = false;
    for (let j = 0; j < routes.length; j++) {
      const r = routes[j];
      if (o.windowSec > 0 && (a.s > r.sMax + o.windowSec || b.s < r.sMin - o.windowSec)) continue;
      const f = similar(a.x, a.z, b.x, b.z, r, R);
      const k = similar(b.x, b.z, a.x, a.z, r, R);
      if (f >= bestSim && f >= k) [best, bestSim, flip] = [j, f, false];
      else if (k >= bestSim) [best, bestSim, flip] = [j, k, true];
    }
    if (best < 0) {
      of[i] = routes.length;
      routes.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, n: 1, sMin: a.s, sMax: b.s });
      continue;
    }
    // the route's ends move towards the newcomer's (the mean of all its legs)
    const r = routes[best];
    const [pa, pb] = flip ? [b, a] : [a, b];
    r.ax += (pa.x - r.ax) / (r.n + 1);
    r.az += (pa.z - r.az) / (r.n + 1);
    r.bx += (pb.x - r.bx) / (r.n + 1);
    r.bz += (pb.z - r.bz) / (r.n + 1);
    r.n++;
    r.sMin = Math.min(r.sMin, a.s);
    r.sMax = Math.max(r.sMax, b.s);
    of[i] = best;
    against[i] = flip ? 1 : 0;
  }
  let nSeg = 0;
  for (const g of legs) nSeg += g.pts.length - 1;
  const position = new Float32Array(nSeg * 6), weight = new Float32Array(nSeg * 2);
  const h = o.unit / Math.max(1e-6, o.secPerUnit);
  const pull = Math.max(0, Math.min(1, o.strength));
  let w = 0, bundled = 0;
  for (let i = 0; i < legs.length; i++) {
    const g = legs[i];
    const r = of[i] >= 0 ? routes[of[i]] : null;
    const shared = !!r && r.n >= 2;
    if (shared) bundled++;
    const wt = shared ? Math.min(1, r!.n / Math.max(2, o.full)) : 0;
    const at = (k: number): [number, number] => {
      const p = g.pts[k];
      if (!shared || pull <= 0) return [p.x, p.z];
      const t = against[i] ? 1 - g.at[k] : g.at[k];
      return [p.x + (r!.ax + (r!.bx - r!.ax) * t - p.x) * pull, p.z + (r!.az + (r!.bz - r!.az) * t - p.z) * pull];
    };
    let [px, pz] = at(0);
    for (let k = 1; k < g.pts.length; k++) {
      const [qx, qz] = at(k);
      position.set([px, g.pts[k - 1].s * h, pz, qx, g.pts[k].s * h, qz], w * 6);
      weight[w * 2] = weight[w * 2 + 1] = wt;
      w++;
      [px, pz] = [qx, qz];
    }
  }
  return { position, weight, legs: legs.length, routes: routes.length, bundled };
}
