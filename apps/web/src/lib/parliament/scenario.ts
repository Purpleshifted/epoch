/**
 * parliament/scenario.ts — SCRIPTED CROWDS for the presentation site (2026-11-04): one rule at a time, in a world of
 * its own (the lab with `?scenario=`). A script says where bot i stands at second `sec` of the scenario, or null while
 * it is away; the lab emits these as ordinary presence events, and the fold does the rest by its own rules. World
 * units. The fold's thresholds set the pace (types.ts DEFAULT_FOLD, flow.ts DEFAULT_FLOW, water.ts DEFAULT_WATER,
 * nature.ts DEFAULT_NATURE):
 *
 *   slab   four people stay in one place: presence within radius 3 reaches the threshold (36) in about nine seconds,
 *          then every 15 more pours one unit of height; after a minute they move on and do it again
 *   path   two people walk between two places, again and again: the trodden ground hardens past p ≥ 0.3 and a
 *          path is paved where the traffic keeps up
 *   pipe   three small groups stay close together and two people walk between them: slabs, then paved paths,
 *          until the quarter's sealed share passes 25 % and its drainage is laid in pipes
 *   veg    six people wander one patch for a minute, then leave for good: the grass goes, then comes back
 *
 * Pure and deterministic: the same (i, sec) always gives the same place.
 */

export type ScenarioKind = "slab" | "path" | "pipe" | "veg" | "all";

/** Where the camera is at a second of the scenario (`?cam=shot`): on its sphere around the look point, lifted from the present. */
export interface ShotPose {
  dist: number;
  polar: number;
  lift: number;
  lookX: number;
  lookZ: number;
}

export interface Scenario {
  kind: ScenarioKind;
  /** How many bots the script moves (bot0 … bot{count-1}). */
  count: number;
  /** Where bot i is at second `sec` of the scenario, or null while it is away. */
  at(i: number, sec: number): { x: number; z: number } | null;
  /** The clock's rate at second `sec` (world seconds), when the scenario sets its own pace. */
  rate?(sec: number): number;
  /** The camera at second `sec`, when the scenario carries its own shot (`?cam=shot`). */
  cam?(sec: number): ShotPose;
}

const h = (a: number, b: number): number => {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = ((x ^ (x >> 13)) * 1274126177) | 0;
  return ((x ^ (x >> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** From a to b over `dur` seconds starting at `t0`, eased; before t0 at a, after t0+dur at b. */
const walk = (a: [number, number], b: [number, number], t0: number, dur: number, sec: number): [number, number] => {
  const m = smooth((sec - t0) / dur);
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
};
/** A small standing drift so a stay is not one frozen point. */
const breathe = (i: number, sec: number, r = 0.15): [number, number] => [Math.sin(sec * 0.31 + i * 1.7) * r, Math.cos(sec * 0.27 + i * 2.3) * r];

/**
 * Back and forth between a and b at a steady pace (world/s), `dwell` seconds at each end; `phase` 0–1 shifts where in
 * the round trip it starts. A steady pace treads every cell of the way alike (an eased walk lingers at the ends, so the
 * ends get trodden and the middle hardly).
 */
const shuttle = (a: [number, number], b: [number, number], speed: number, dwell: number, t: number, phase = 0): [number, number] => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), leg = d / speed, cyc = 2 * (leg + dwell);
  let u = ((((t / cyc + phase) % 1) + 1) % 1) * cyc;
  if (u < leg) { const m = u / leg; return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m]; }
  u -= leg; if (u < dwell) return [b[0], b[1]];
  u -= dwell; if (u < leg) { const m = u / leg; return [b[0] + (a[0] - b[0]) * m, b[1] + (a[1] - b[1]) * m]; }
  return [a[0], a[1]];
};
/** Around a place: a ring position for bot i (so several can stay in one place without standing in one point). */
const around = (p: [number, number], i: number, sec: number, d = 0.6): { x: number; z: number } => {
  const ang = i * 2.4 + 0.6; const [bx, bz] = breathe(i, sec);
  return { x: p[0] + Math.cos(ang) * d + bx, z: p[1] + Math.sin(ang) * d + bz };
};
/** Interpolation between keyframes [sec, ...values], eased; before the first / after the last it holds. */
const keyed = (keys: number[][], sec: number): number[] => {
  if (sec <= keys[0][0]) return keys[0].slice(1);
  for (let k = 1; k < keys.length; k++) {
    if (sec <= keys[k][0]) { const a = keys[k - 1], b = keys[k], m = smooth((sec - a[0]) / (b[0] - a[0])); return a.slice(1).map((v, j) => v + (b[j + 1] - v) * m); }
  }
  return keys[keys.length - 1].slice(1);
};

const SLAB_PLACES: [number, number][] = [
  [0, 0],
  [9, 4],
  [-8, 6],
];

/**
 * ALL IN ONE SHOT (the artist, 2026-11-04 evening: the cuts between scenes were awkward — one crowd, one scenario, one
 * camera): ten people gather at P0 (a slab in seconds), three move on to P1 and two keep walking between (a walkway is
 * laid along the trodden way — the wall draws a path as a line only between buildings; on bare ground it is a gap in
 * the grass), three more settle at P2 with a third walker (pipes once the quarter is sealed), then at 200 s everyone
 * leaves — the grass comes back — and the clock runs ×20: the strata sink and fossilise under the camera, which pulls
 * back and tilts to look beneath the ground. World seconds throughout.
 */
const P0: [number, number] = [0, 0], P1: [number, number] = [12, 3], P2: [number, number] = [2, -11];
const T_LEAVE = 200, T_GONE = 216;
const far = (i: number): [number, number] => [Math.cos(i * 1.3) * 45, Math.sin(i * 1.3) * 45];
function allPos(i: number, sec: number): { x: number; z: number } {
  const pt = (p: [number, number]) => ({ x: p[0], z: p[1] });
  const ring = (p: [number, number], k: number): [number, number] => [p[0] + Math.cos(k * 2.4 + 0.6) * 0.6, p[1] + Math.sin(k * 2.4 + 0.6) * 0.6];
  switch (i) {
    case 0: return around(P0, i, sec);
    case 1: case 2: case 3:
      if (sec < 90) return around(P0, i, sec);
      if (sec < 100) return pt(walk(ring(P0, i), ring(P2, i), 90, 10, sec));
      return around(P2, i, sec);
    case 4: return sec < 25 ? around(P0, i, sec) : pt(shuttle(P0, P1, 1.6, 1.5, sec - 25, 0));
    case 5:
      if (sec < 25) return around(P0, i, sec);
      if (sec < 100) return pt(shuttle(P0, P1, 1.6, 1.5, sec - 25, 0.5));
      return pt(shuttle(P0, P2, 1.6, 1.5, sec - 100, 0));
    case 6: case 7: case 8:
      if (sec < 30) return around(P0, i, sec);
      if (sec < 40) return pt(walk(ring(P0, i), ring(P1, i), 30, 10, sec));
      return around(P1, i, sec);
    default:
      if (sec < 40) return around(P0, i, sec);
      if (sec < 60) return pt(walk(ring(P0, i), P1, 40, 20, sec));
      return pt(shuttle(P1, P2, 1.6, 1.5, sec - 60, 0.3));
  }
}
const ALL: Scenario = {
  kind: "all",
  count: 10,
  at(i, sec) {
    if (sec >= T_GONE) return null;
    if (sec >= T_LEAVE) { const p = allPos(i, T_LEAVE); const [x, z] = walk([p.x, p.z], far(i), T_LEAVE, T_GONE - T_LEAVE, sec); return { x, z }; }
    return allPos(i, sec);
  },
  rate: (sec) => (sec < T_GONE ? 3 : sec < 260 ? 6 : 20),
  cam(sec) {
    // [sec, dist, polar, lift, lookX, lookZ]: close on the first slab, out to the three places, then (the clock ×20)
    // back and down to the strata beneath
    const [dist, polar, lift, lookX, lookZ] = keyed([
      [0, 14, 50, 0, 0, 0],
      [30, 14, 50, 0, 0, 0],
      [70, 32, 56, 0, 5, -3],
      [200, 34, 56, 0, 5, -3],
      [262, 44, 62, -3, 5, -3],
      [700, 52, 72, -7, 5, -3],
      [1600, 60, 78, -9, 5, -3],
    ], sec);
    return { dist, polar, lift, lookX, lookZ };
  },
};

export const SCENARIOS: Record<ScenarioKind, Scenario> = {
  all: ALL,
  slab: {
    kind: "slab",
    count: 4,
    at(i, sec) {
      // a minute in each place, twelve seconds walking to the next
      const period = 72, k = Math.floor(sec / period) % SLAB_PLACES.length, t = sec - Math.floor(sec / period) * period;
      const from = SLAB_PLACES[(k + SLAB_PLACES.length - 1) % SLAB_PLACES.length], to = SLAB_PLACES[k];
      const [cx, cz] = sec < period ? to : walk(from, to, 0, 12, t);
      const ang = (i / 4) * Math.PI * 2 + 0.6, d = 0.55;
      const [bx, bz] = breathe(i, sec);
      return { x: cx + Math.cos(ang) * d + bx, z: cz + Math.sin(ang) * d + bz };
    },
  },
  path: {
    kind: "path",
    count: 2,
    at(i, sec) {
      // back and forth between A and B, thirteen seconds a leg, the two a half leg apart; a little to the side each
      const A: [number, number] = [-9, 0], B: [number, number] = [9, 0];
      const leg = 13, p = sec / leg + i * 0.5, n = Math.floor(p), f = p - n;
      const [a, b] = n % 2 === 0 ? [A, B] : [B, A];
      const m = smooth(f);
      const side = (i === 0 ? 1 : -1) * 0.35 + Math.sin(sec * 0.9 + i) * 0.12;
      return { x: a[0] + (b[0] - a[0]) * m, z: a[1] + (b[1] - a[1]) * m + side };
    },
  },
  pipe: {
    kind: "pipe",
    count: 11,
    at(i, sec) {
      // three groups of three stay; two walk between the groups
      const G: [number, number][] = [
        [0, 0],
        [7, 5],
        [-6, 6],
      ];
      if (i < 9) {
        const g = Math.floor(i / 3), j = i % 3;
        const ang = (j / 3) * Math.PI * 2 + g, d = 0.6;
        const [bx, bz] = breathe(i, sec);
        return { x: G[g][0] + Math.cos(ang) * d + bx, z: G[g][1] + Math.sin(ang) * d + bz };
      }
      const [a, b] = i === 9 ? [G[0], G[1]] : [G[1], G[2]];
      const leg = 11, p = sec / leg + (i - 9) * 0.5, n = Math.floor(p), m = smooth(p - n);
      const [from, to] = n % 2 === 0 ? [a, b] : [b, a];
      return { x: from[0] + (to[0] - from[0]) * m + 0.3, z: from[1] + (to[1] - from[1]) * m - 0.3 };
    },
  },
  veg: {
    kind: "veg",
    count: 6,
    at(i, sec) {
      // a minute of wandering one patch, fifteen seconds of leaving, then away until the scene repeats (200 s)
      const t = sec % 200;
      const spot = (s: number): [number, number] => [Math.sin(s * 0.23 + i * 1.1) * 2.6 + Math.sin(s * 0.07 + i) * 0.8, Math.cos(s * 0.19 + i * 0.7) * 2.6 + Math.cos(s * 0.05 + i * 2) * 0.8];
      if (t < 60) {
        const [x, z] = spot(t);
        return { x, z };
      }
      if (t < 75) {
        const ang = h(i, 3) * Math.PI * 2;
        const [x, z] = walk(spot(60), [Math.cos(ang) * 40, Math.sin(ang) * 40], 60, 15, t);
        return { x, z };
      }
      return null;
    },
  },
};

/** The scenario an address asked for, or null. */
export function scenarioOf(name: string | null | undefined): Scenario | null {
  if (!name) return null;
  return (SCENARIOS as Record<string, Scenario | undefined>)[name] ?? null;
}
