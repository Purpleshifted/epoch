/**
 * parliament/threads.ts
 *
 * THREADS between buildings (V2): every TRIP — somebody staying in one PLACE, leaving, and first staying again in
 * another — drawn as its actual course. A place is a part (`room` × `room`) of a building, so threads run between
 * buildings and also tie the masses of one building together (ref 9705); trips shorter than `minDist` do not count.
 * Drawn as its actual course through the timespace (x, z; y = time), so it rises by the time it
 * took. Threads are then BUNDLED (force-directed edge bundling, Holten & van Wijk 2009): their points are drawn
 * towards the corresponding points of compatible threads (similar direction, length and place), the ends held, so
 * the trips between the same buildings gather into fibres that tie the masses together (refs 9705, 9722, 9666).
 * Threads are drawn for the recent past only (the present of the movement). What stays is FOSSIL: where enough
 * threads gathered into one bundle (bundle density ≥ a threshold), the bundle becomes a solid cast in its layer — a
 * path's fossil, like a trace fossil's burrow cast in a bedding plane; thin, lone threads leave nothing.
 *
 * Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, stayShares, type FlowConfig } from "./flow";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";
import { buildingsOf, type WaterConfig } from "./water";

export interface TripOptions {
  secPerUnit: number;
  unit: number;
  /** How stays are told from moves (flow.stayShares). */
  flow: FlowConfig;
  /** How seeds are grouped into buildings (water.buildingsOf: `join`). */
  water: WaterConfig;
  /** A trip takes at most this long (s); longer is not one trip. */
  maxTripSec: number;
  /** Size (world) of the places a building is divided into. */
  room: number;
  /** Least distance (world) between the two stays of a trip. */
  minDist: number;
  /** Only trips touching slots [k0, k1]. */
  k0: number;
  k1: number;
  /** At most this many trips (the latest kept). */
  max: number;
}

export interface Trip {
  o: string;
  /** Places it went from / to (ids). */
  a: number;
  b: number;
  /** Slot in which it set off. */
  k: number;
  /** Its course: x, y, z per point (y = time). */
  pts: Float32Array;
}

/** A sample further from the previous one of the same person than this (s) breaks what they were doing. */
const GAP_SEC = 10;
/** Stay share from which a sample counts as being IN a place. */
const STAY = 0.5;

/** Every trip between two different buildings, in time order. */
export function tripsOf(events: readonly PEvent[], seeds: readonly Seed[], opts: TripOptions): Trip[] {
  if (!seeds.length) return [];
  // which building each cell (and the ring around its seeds) belongs to — a stay at a building's edge is in it
  const place = new Map<string, number>();
  for (const b of buildingsOf(seeds, opts.water)) {
    for (const s of b.seeds) {
      const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = cellKey(cx + dx, cz + dz);
        if (!place.has(k) || (dx === 0 && dz === 0)) place.set(k, b.id);
      }
    }
  }
  const pres = events.filter((e) => e.k === "p");
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stay = stayShares(pres, opts.flow);
  const byOwner = new Map<string, number[]>();
  for (let i = 0; i < pres.length; i++) {
    const l = byOwner.get(pres[i].o);
    if (l) l.push(i);
    else byOwner.set(pres[i].o, [i]);
  }
  const yOf = (s: number) => (s / opts.secPerUnit) * opts.unit;
  // a place: a building and the room of it the stay is in
  const R = Math.max(CELL_SIZE, opts.room);
  const placeIds = new Map<string, number>();
  const placeOf = (b: number, x: number, z: number) => {
    const k = `${b}:${Math.floor(x / R)},${Math.floor(z / R)}`;
    let id = placeIds.get(k);
    if (id === undefined) {
      id = placeIds.size;
      placeIds.set(k, id);
    }
    return id;
  };
  const trips: (Trip & { s0: number })[] = [];
  for (const [o, list] of byOwner) {
    let at: number | undefined; // building of the last stay
    let from = -1; // index (in list) of the last stay sample there
    for (let n = 0; n < list.length; n++) {
      const e = pres[list[n]];
      if (n > 0 && e.s - pres[list[n - 1]].s > GAP_SEC) at = undefined; // away: no trip across the gap
      if (stay[list[n]] < STAY) continue;
      const bld = place.get(cellKey(Math.floor(e.x / CELL_SIZE), Math.floor(e.z / CELL_SIZE)));
      if (bld === undefined) continue;
      const b = placeOf(bld, e.x, e.z);
      const f = from >= 0 ? pres[list[from]] : null;
      if (at !== undefined && b !== at && f && e.s - f.s <= opts.maxTripSec && Math.hypot(e.x - f.x, e.z - f.z) >= opts.minDist) {
        const s0 = pres[list[from]].s;
        const k0 = Math.floor(s0 / opts.secPerUnit), k1 = Math.floor(e.s / opts.secPerUnit);
        if (k1 >= opts.k0 && k0 <= opts.k1) {
          const pts = new Float32Array((n - from + 1) * 3);
          for (let m = from; m <= n; m++) {
            const q = pres[list[m]];
            pts[(m - from) * 3] = q.x;
            pts[(m - from) * 3 + 1] = yOf(q.s);
            pts[(m - from) * 3 + 2] = q.z;
          }
          trips.push({ o, a: at, b, pts, s0, k: k0 });
        }
      }
      // staying on in the same place moves the trip's start to the latest stay there; a hop too short is not a trip
      if (at === undefined || b === at || !f || Math.hypot(e.x - f.x, e.z - f.z) >= opts.minDist) {
        at = b;
        from = n;
      }
    }
  }
  trips.sort((p, q) => p.s0 - q.s0 || (p.o < q.o ? -1 : p.o > q.o ? 1 : 0));
  return trips.slice(Math.max(0, trips.length - opts.max)).map(({ o, a, b, pts, k }) => ({ o, a, b, pts, k }));
}

/** A polyline resampled to `n` points evenly along its length. */
function resample(p: Float32Array, n: number): Float32Array {
  const m = p.length / 3;
  const out = new Float32Array(n * 3);
  if (m === 1) {
    for (let i = 0; i < n; i++) out.set(p.subarray(0, 3), i * 3);
    return out;
  }
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
  const L = cum[m - 1] || 1;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (L * i) / (n - 1);
    while (j < m - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = p[j * 3 + c] + (p[j * 3 + 3 + c] - p[j * 3 + c]) * t;
  }
  return out;
}

export interface BundleOptions {
  /** Points per thread. */
  points: number;
  /** Bundling cycles (0 = the threads as walked); each halves the step and the iterations. */
  cycles: number;
  /** Spring stiffness holding a thread to its own course. */
  stiffness: number;
  /** Least compatibility (0..1) for two threads to attract. */
  compat: number;
  /** At most this many partners per thread (the most compatible). */
  partners: number;
}

export const DEFAULT_BUNDLE: BundleOptions = { points: 12, cycles: 4, stiffness: 0.1, compat: 0.55, partners: 24 };

/** How much two threads (resampled) should bundle: direction × scale × position (FDEB); trips between the same
 * pair of buildings at least 0.9. Also whether they run the other way (then point i meets point n − 1 − i). */
function compatibility(P: Float32Array, Q: Float32Array, n: number, samePair: boolean): { c: number; flip: boolean } {
  const end = (n - 1) * 3;
  const px = P[end] - P[0], py = P[end + 1] - P[1], pz = P[end + 2] - P[2];
  const qx = Q[end] - Q[0], qy = Q[end + 1] - Q[1], qz = Q[end + 2] - Q[2];
  const lp = Math.hypot(px, py, pz) || 1e-6, lq = Math.hypot(qx, qy, qz) || 1e-6;
  const dot = (px * qx + py * qy + pz * qz) / (lp * lq);
  const ca = Math.abs(dot);
  const lavg = (lp + lq) / 2;
  const cs = 2 / (lavg / Math.min(lp, lq) + Math.max(lp, lq) / lavg);
  const mx = (P[0] + P[(n - 1) * 3] - Q[0] - Q[(n - 1) * 3]) / 2;
  const my = (P[1] + P[(n - 1) * 3 + 1] - Q[1] - Q[(n - 1) * 3 + 1]) / 2;
  const mz = (P[2] + P[(n - 1) * 3 + 2] - Q[2] - Q[(n - 1) * 3 + 2]) / 2;
  const cp = lavg / (lavg + Math.hypot(mx, my, mz));
  const c = ca * cs * cp;
  return { c: samePair ? Math.max(c, 0.9) : c, flip: dot < 0 };
}

/**
 * Force-directed edge bundling of the trips (ends held). Partners are found among threads whose midpoints are near
 * (a spatial hash), at most `partners` each. Returns each thread as `points` points (x, y, z).
 */
export function bundleTrips(trips: readonly Trip[], o: BundleOptions = DEFAULT_BUNDLE): Float32Array[] {
  const n = Math.max(3, o.points);
  const R = trips.map((t) => resample(t.pts, n));
  if (o.cycles <= 0 || R.length < 2) return R;
  // partners: midpoints hashed in buckets of the typical thread length
  const len = R.map((P) => Math.hypot(P[(n - 1) * 3] - P[0], P[(n - 1) * 3 + 1] - P[1], P[(n - 1) * 3 + 2] - P[2]));
  const B = Math.max(CELL_SIZE * 2, len.reduce((a, b) => a + b, 0) / len.length);
  const mid = R.map((P) => [(P[0] + P[(n - 1) * 3]) / 2, (P[1] + P[(n - 1) * 3 + 1]) / 2, (P[2] + P[(n - 1) * 3 + 2]) / 2]);
  const bucket = new Map<string, number[]>();
  const bk = (x: number, y: number, z: number) => `${Math.floor(x / B)},${Math.floor(y / B)},${Math.floor(z / B)}`;
  mid.forEach(([x, y, z], i) => {
    const k = bk(x, y, z);
    const l = bucket.get(k);
    if (l) l.push(i);
    else bucket.set(k, [i]);
  });
  const partners: { j: number; c: number; flip: boolean }[][] = R.map((P, i) => {
    const [x, y, z] = mid[i];
    const cand: { j: number; c: number; flip: boolean }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of bucket.get(bk(x + dx * B, y + dy * B, z + dz * B)) ?? []) {
        if (j === i) continue;
        const same = (trips[i].a === trips[j].a && trips[i].b === trips[j].b) || (trips[i].a === trips[j].b && trips[i].b === trips[j].a);
        const cc = compatibility(P, R[j], n, same);
        if (cc.c >= o.compat) cand.push({ j, ...cc });
      }
    }
    cand.sort((a, b) => b.c - a.c || a.j - b.j);
    return cand.slice(0, o.partners);
  });

  let step = 0.04 * (len.reduce((a, b) => a + b, 0) / len.length);
  let iters = 40;
  const next = R.map((P) => P.slice());
  for (let cyc = 0; cyc < o.cycles; cyc++) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < R.length; i++) {
        const P = R[i];
        const kp = o.stiffness / ((len[i] || 1) * (n - 1));
        for (let p = 1; p < n - 1; p++) {
          let fx = 0, fy = 0, fz = 0;
          // spring to its neighbours on its own thread
          for (const q of [p - 1, p + 1]) {
            fx += kp * (P[q * 3] - P[p * 3]);
            fy += kp * (P[q * 3 + 1] - P[p * 3 + 1]);
            fz += kp * (P[q * 3 + 2] - P[p * 3 + 2]);
          }
          // attraction to the corresponding points of its partners
          for (const { j, c, flip } of partners[i]) {
            const Q = R[j];
            const q = flip ? n - 1 - p : p;
            const dx = Q[q * 3] - P[p * 3], dy = Q[q * 3 + 1] - P[p * 3 + 1], dz = Q[q * 3 + 2] - P[p * 3 + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d < 1e-4) continue;
            const f = c / Math.max(d, 0.25);
            fx += (dx / d) * f;
            fy += (dy / d) * f * 0.5; // time bends less than place
            fz += (dz / d) * f;
          }
          const fl = Math.hypot(fx, fy, fz);
          const s = fl > 1e-9 ? Math.min(step, fl * step) / fl : 0;
          next[i][p * 3] = P[p * 3] + fx * s;
          next[i][p * 3 + 1] = P[p * 3 + 1] + fy * s;
          next[i][p * 3 + 2] = P[p * 3 + 2] + fz * s;
        }
      }
      for (let i = 0; i < R.length; i++) R[i].set(next[i]);
    }
    step /= 2;
    iters = Math.max(4, Math.round(iters / 2));
  }
  return R;
}

/** Bundled threads as line segments (pairs of points); colour = each thread's brightness (`fade`, default 1) — the
 * material gives the hue and opacity. */
export function threadLines(threads: readonly Float32Array[], fade?: readonly number[]): { position: Float32Array; color: Float32Array } {
  let segs = 0;
  for (const t of threads) segs += t.length / 3 - 1;
  const position = new Float32Array(segs * 6);
  const color = new Float32Array(segs * 6);
  let o = 0;
  threads.forEach((t, i) => {
    const f = fade ? fade[i] : 1;
    for (let p = 0; p + 5 < t.length; p += 3) {
      position.set(t.subarray(p, p + 6), o);
      color.fill(f, o, o + 6);
      o += 6;
    }
  });
  return { position, color };
}

/**
 * BUNDLE DENSITY of every point of every (bundled) thread: how many OTHER threads pass within `radius` of it — 0 for a
 * lone thread, high in a thick bundle.
 */
export function bundleDensity(threads: readonly Float32Array[], radius: number): Float32Array[] {
  const r = Math.max(1e-3, radius);
  const bucket = new Map<string, [number, number][]>();
  const bk = (x: number, y: number, z: number) => `${Math.floor(x / r)},${Math.floor(y / r)},${Math.floor(z / r)}`;
  threads.forEach((t, i) => {
    for (let p = 0; p < t.length; p += 3) {
      const k = bk(t[p], t[p + 1], t[p + 2]);
      const l = bucket.get(k);
      if (l) l.push([i, p]);
      else bucket.set(k, [[i, p]]);
    }
  });
  return threads.map((t, i) => {
    const d = new Float32Array(t.length / 3);
    for (let p = 0; p < t.length; p += 3) {
      const near = new Set<number>();
      const x = t[p], y = t[p + 1], z = t[p + 2];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const [j, q] of bucket.get(bk(x + dx * r, y + dy * r, z + dz * r)) ?? []) {
          if (j === i || near.has(j)) continue;
          const T = threads[j];
          if (Math.hypot(T[q] - x, T[q + 1] - y, T[q + 2] - z) <= r) near.add(j);
        }
      }
      d[p / 3] = near.size;
    }
    return d;
  });
}

/**
 * FOSSIL CASTS: the segments of the threads whose both ends lie in a bundle of at least `minDensity` other threads,
 * packed [ax, ay, az, bx, by, bz, radius] × n — thicker the denser the bundle. Lone and thin threads leave nothing.
 */
export function fossilCasts(threads: readonly Float32Array[], density: readonly Float32Array[], minDensity: number, radius: number): Float32Array {
  const out: number[] = [];
  threads.forEach((t, i) => {
    const d = density[i];
    for (let p = 0; p + 1 < d.length; p++) {
      const m = Math.min(d[p], d[p + 1]);
      if (m < minDensity) continue;
      out.push(t[p * 3], t[p * 3 + 1], t[p * 3 + 2], t[p * 3 + 3], t[p * 3 + 4], t[p * 3 + 5], radius * Math.sqrt(m / Math.max(1, minDensity)));
    }
  });
  return Float32Array.from(out);
}
