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

export type ScenarioKind = "slab" | "path" | "pipe" | "veg";

export interface Scenario {
  kind: ScenarioKind;
  /** How many bots the script moves (bot0 … bot{count-1}). */
  count: number;
  /** Where bot i is at second `sec` of the scenario, or null while it is away. */
  at(i: number, sec: number): { x: number; z: number } | null;
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

const SLAB_PLACES: [number, number][] = [
  [0, 0],
  [9, 4],
  [-8, 6],
];

export const SCENARIOS: Record<ScenarioKind, Scenario> = {
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
