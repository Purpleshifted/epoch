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
import { grassDensity, type NatureConfig, type PEvent, type Snapshot } from "@/lib/parliament";

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
}

export const DEFAULT_SIGNALS: SignalConfig = {
  hearRadius: 12,
  recentSec: 4,
  stayRadius: 1.5,
  staySec: 6,
  sealRadius: 3,
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
        const d = Math.hypot(e.x - me.x, e.z - me.z);
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
    const dx = e.x - me.x, dz = e.z - me.z;
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
  if (snap) {
    for (const pc of snap.paths) {
      pathAt.set(pc.key, pc.p);
      if (pc.key === myKey) pathP = pc.p;
    }
    for (const sl of snap.slabs) {
      if (sl.h < 0.15) continue;
      sealedCells.add(sl.key);
      const d = Math.hypot(sl.x - me.x, sl.z - me.z);
      const near = 1 - Math.min(1, Math.max(0, (d - CELL_SIZE * 0.5) / cfg.sealRadius));
      if (near > sealed) sealed = near;
    }
  }
  let grass = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const key = `${ix + dx},${iz + dz}`;
      grass += grassDensity(ix + dx, iz + dz, stress?.get(key) ?? 0, pathAt.get(key) ?? 0, sealedCells.has(key), natureCfg);
    }
  }
  grass /= 9;

  return { speed: Math.hypot(me.vx, me.vz), stay, neighbours, pathP, sealed, grass };
}
