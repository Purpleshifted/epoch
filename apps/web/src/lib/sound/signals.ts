/**
 * sound/signals.ts — what the PLAYER hears, folded from the same event log the ground is folded from.
 *
 * The personal view does not get less information than the global view, it gets a different KIND
 * (docs/direction-2026-10-10.md §1): now, here, by the senses. So these signals are all local to the visitor
 * and their moment: how fast they walk, whether they stay, who is within earshot and where, how trodden the
 * ground under their feet is, whether concrete is near (sound goes dull), how much vegetation is around.
 *
 * Pure: everything is computed from the visitor's position, the event log, the fold snapshot and the stress map.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { grassDensity, wrapCell, wrapDelta, wrapDist, type NatureConfig, type PEvent, type Slab, type Snapshot } from "@/lib/parliament";

export interface SignalConfig {
  /** How far (world) other people can be heard. */
  hearRadius: number;
  /** A person whose last sample is older than this (s) has gone quiet. */
  recentSec: number;
  /** STAY: over the last `staySec` seconds the visitor stayed within `stayRadius` (world) → 1; twice it → 0. */
  stayRadius: number;
  staySec: number;
  /** Concrete this close (world, from the slab's cell centre) makes the sound dull; at 0 fully. */
  sealRadius: number;
  /** A path this close (world) counts as under my feet (v4 A4d: the heartbeat was too strict on the exact cell). */
  pathRadius: number;
  /** My weight on a building's cell (worker·s) from which I count as building it. */
  buildFrom: number;
}

export const DEFAULT_SIGNALS: SignalConfig = {
  hearRadius: 12,
  recentSec: 4,
  stayRadius: 1.5,
  staySec: 6,
  sealRadius: 3,
  pathRadius: 2.5,
  buildFrom: 2,
};

export interface Neighbour {
  o: string;
  /** World distance. */
  dist: number;
  /** World bearing from the visitor, atan2(dx, dz). */
  angle: number;
  bot: boolean;
}

export interface PersonalSignals {
  /** Where I am (world). */
  x: number;
  z: number;
  /** World units per second. */
  speed: number;
  /** 0 (walking) … 1 (staying). */
  stay: number;
  /** People within earshot, nearest first. */
  neighbours: Neighbour[];
  /** 0..1 how formed the path under the visitor's feet is. */
  pathP: number;
  /** 0..1 how close concrete is (1 = standing on it). */
  sealed: number;
  /** 0..1 vegetation around the visitor (3 × 3 cells). */
  grass: number;
  /** The building whose zone I am in or nearest to (v4 A4), or null when none is within reach. */
  building?: BuildingSignal | null;
  /** Keys of the sealed slabs within 2 × sealRadius. */
  nearSlabs?: string[];
  /**
   * The others I am REALLY building with (v4 A4d): contributors of the sealed slabs near me on which my own weight
   * has counted (≥ buildFrom worker·s), nearest slab first, each once. Empty = my presence is not in any building.
   */
  coBuilders?: string[];
  /** My largest weight on those slabs (0 when none). */
  myBuild?: number;
}

/** A BUILDING: sealed slabs that touch, as one; its harmonic zone grows with its mass (tonality.ts). */
export interface BuildingSignal {
  /** Its lowest cell key (stable while it stands). */
  id: string;
  /** Centre of mass (world). */
  x: number;
  z: number;
  /** My distance to the centre (world). */
  dist: number;
  /** Radius of its zone (world): 6 + 0.4·√mass, at most 14. */
  radius: number;
  /** Σ raw heights of its slabs. */
  mass: number;
  /** Who built it: every contributor and their weight, summed over its cells, heaviest first. */
  who: { o: string; amount: number }[];
}

export const ZONE_BASE = 8;
export const ZONE_PER_SQRT_MASS = 0.6;
export const ZONE_MAX = 18;

/** The buildings of a snapshot: sealed slabs joined by 4-neighbourhood (the world wraps). */
export function buildingsOf(slabs: readonly Slab[], sealH = 0.15): BuildingSignal[] {
  const sealed = slabs.filter((s) => s.h >= sealH);
  const idx = new Map<string, number>();
  sealed.forEach((s, i) => idx.set(s.key, i));
  const parent = sealed.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sealed.length; i++) {
    const [cx, cz] = sealed[i].key.split(",").map(Number);
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const j = idx.get(`${wrapCell(cx + dx)},${wrapCell(cz + dz)}`);
      if (j !== undefined) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Slab[]>();
  for (let i = 0; i < sealed.length; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(sealed[i]);
    else groups.set(r, [sealed[i]]);
  }
  const out: BuildingSignal[] = [];
  for (const g of groups.values()) {
    let mass = 0;
    // the centre, the short way round the world: offsets from the first slab
    const ax = g[0].x, az = g[0].z;
    let sx = 0, sz = 0;
    const amounts = new Map<string, number>();
    let id = g[0].key;
    for (const s of g) {
      mass += s.raw;
      sx += wrapDelta(s.x - ax) * s.raw;
      sz += wrapDelta(s.z - az) * s.raw;
      if (s.key < id) id = s.key;
      for (const w of s.who ?? []) amounts.set(w.o, (amounts.get(w.o) ?? 0) + w.amount);
    }
    const x = ax + sx / Math.max(1e-9, mass);
    const z = az + sz / Math.max(1e-9, mass);
    const who = [...amounts].map(([o, amount]) => ({ o, amount })).sort((a, b) => b.amount - a.amount || (a.o < b.o ? -1 : 1));
    out.push({ id, x, z, dist: 0, radius: Math.min(ZONE_MAX, ZONE_BASE + ZONE_PER_SQRT_MASS * Math.sqrt(mass)), mass, who });
  }
  return out;
}

/** The building I am deepest in (or nearest to) within `reach` of its zone edge, with my distance to it. */
export function buildingAround(slabs: readonly Slab[], x: number, z: number, reach = 6, sealH = 0.15): BuildingSignal | null {
  let best: BuildingSignal | null = null;
  let bestOver = Infinity;
  for (const b of buildingsOf(slabs, sealH)) {
    const dist = wrapDist(b.x, b.z, x, z);
    const over = dist - b.radius;
    if (over > reach) continue;
    if (over < bestOver) {
      bestOver = over;
      best = { ...b, dist };
    }
  }
  return best;
}

export interface SignalInputs {
  me: { id: string; x: number; z: number; vx: number; vz: number };
  events: readonly PEvent[];
  /** The visitor's own assigned time. */
  sNow: number;
  snap: Snapshot | null;
  stress: Map<string, number> | null;
  natureCfg: NatureConfig;
  cfg?: SignalConfig;
}

export const isBotId = (o: string) => o.startsWith("bot");

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-9, b - a)));
  return t * t * (3 - 2 * t);
};

export function personalSignals(inp: SignalInputs): PersonalSignals {
  const cfg = inp.cfg ?? DEFAULT_SIGNALS;
  const { me, events, sNow, snap, stress, natureCfg } = inp;

  // who is within earshot: the latest sample of every other person in the last recentSec (not from the future)
  const latest = new Map<string, PEvent>();
  let farthest = 0;
  for (const e of events) {
    if (e.k !== "p" || e.s > sNow) continue;
    if (e.o === me.id) {
      // STAY: how far I got from where I am now over the last staySec
      if (e.s >= sNow - cfg.staySec) {
        const d = wrapDist(e.x, e.z, me.x, me.z);
        if (d > farthest) farthest = d;
      }
      continue;
    }
    if (e.s < sNow - cfg.recentSec) continue;
    const l = latest.get(e.o);
    if (!l || e.s > l.s) latest.set(e.o, e);
  }
  const neighbours: Neighbour[] = [];
  for (const e of latest.values()) {
    const dx = wrapDelta(e.x - me.x), dz = wrapDelta(e.z - me.z);
    const dist = Math.hypot(dx, dz);
    if (dist > cfg.hearRadius) continue;
    neighbours.push({ o: e.o, dist, angle: Math.atan2(dx, dz), bot: isBotId(e.o) });
  }
  neighbours.sort((a, b) => a.dist - b.dist);

  const stay = 1 - smoothstep(cfg.stayRadius, 2 * cfg.stayRadius, farthest);

  // the ground under my feet
  const ix = Math.floor(me.x / CELL_SIZE), iz = Math.floor(me.z / CELL_SIZE);
  const myKey = `${ix},${iz}`;
  let pathP = 0;
  let sealed = 0;
  const pathAt = new Map<string, number>();
  const sealedCells = new Set<string>();
  const nearSlabs: string[] = [];
  const coBuilders: string[] = [];
  let myBuild = 0;
  if (snap) {
    // the path under my feet: the strongest path cell within pathRadius, fading with distance (not only my own cell)
    for (const pc of snap.paths) {
      pathAt.set(pc.key, pc.p);
      const d = wrapDist(pc.x, pc.z, me.x, me.z);
      if (d <= cfg.pathRadius) {
        const w = pc.key === myKey ? 1 : 1 - 0.5 * (d / cfg.pathRadius);
        if (pc.p * w > pathP) pathP = pc.p * w;
      }
    }
    const nearSealed: { d: number; sl: (typeof snap.slabs)[number] }[] = [];
    for (const sl of snap.slabs) {
      if (sl.h < 0.15) continue;
      sealedCells.add(sl.key);
      const d = wrapDist(sl.x, sl.z, me.x, me.z);
      if (d <= 2 * cfg.sealRadius) {
        nearSlabs.push(sl.key);
        nearSealed.push({ d, sl });
      }
      const near = 1 - Math.min(1, Math.max(0, (d - CELL_SIZE * 0.5) / cfg.sealRadius));
      if (near > sealed) sealed = near;
    }
    // whom I am building with: the slabs my weight has counted on, their other contributors
    nearSealed.sort((a, b) => a.d - b.d);
    for (const { sl } of nearSealed) {
      const mine = sl.who?.find((w) => w.o === me.id)?.amount ?? 0;
      if (mine < cfg.buildFrom) continue;
      if (mine > myBuild) myBuild = mine;
      for (const w of sl.who ?? []) if (w.o !== me.id && w.amount > 0 && !coBuilders.includes(w.o)) coBuilders.push(w.o);
    }
  }
  const building = snap ? buildingAround(snap.slabs, me.x, me.z) : null;
  let grass = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const key = `${ix + dx},${iz + dz}`;
      grass += grassDensity(ix + dx, iz + dz, stress?.get(key) ?? 0, pathAt.get(key) ?? 0, sealedCells.has(key), natureCfg);
    }
  }
  grass /= 9;

  return { x: me.x, z: me.z, speed: Math.hypot(me.vx, me.vz), stay, neighbours, pathP, sealed, grass, building, nearSlabs, coBuilders, myBuild };
}
