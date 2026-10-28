/**
 * parliament/stakes.ts — STAKES in the ground (the player view; Leva 개인뷰 비주얼 › 막대): thin markers that tell
 * the walker where the others are, where paths meet, and where the buildings stand — things the player view does
 * not otherwise show (docs/direction-2026-10-10.md §1 gave none of them; the artist asked for versions to compare,
 * 2026-10-20). Greys only: a human trace. Computed every fold from the record's `far` list (witness.ts) and the
 * world snapshot; the markers are drawn by components/parliament/Stakes.tsx. Pure.
 *
 *   others     one stake per being within the view; its brightness fades with the age of their last sample, a
 *              moving one blinks (the drawing's job)
 *   junctions  a path cell (p ≥ pathP) with at least `minNeighbours` path cells among its four neighbours: where
 *              routes meet; height grows with the path's strength
 *   buildings  the sealed slabs clustered by adjacency (four neighbours); one stake at each cluster's centre, its
 *              height with the tallest slab
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { PathCell, Slab, Snapshot } from "./types";
import type { Other } from "./witness";
import { nearestImage, wrapCell, wrapDist } from "./world";

export type StakeKind = "other" | "junction" | "building";

export interface Stake {
  /** Where it stands: the image nearest the viewer (world). */
  x: number;
  z: number;
  /** Height (world) and grey level (0 … 1). */
  h: number;
  bright: number;
  kind: StakeKind;
  moving: boolean;
}

export interface StakesConfig {
  others: boolean;
  junctions: boolean;
  buildings: boolean;
  /** The stakes' base height (world) and brightness. */
  height: number;
  bright: number;
  /** Another's stake fades over this many seconds since their last sample. */
  recentSec: number;
  /** Path cells among the four neighbours that make a junction (3 = a T or a crossing). */
  minNeighbours: number;
  pathP: number;
  sealedH: number;
  maxJunctions: number;
  maxBuildings: number;
  /** Stakes in all, nearest first. */
  cap: number;
}

export const DEFAULT_STAKES: StakesConfig = {
  others: true,
  junctions: false,
  buildings: false,
  height: 0.9,
  bright: 0.7,
  recentSec: 10,
  minNeighbours: 3,
  pathP: 0.3,
  sealedH: 0.15,
  maxJunctions: 40,
  maxBuildings: 20,
  cap: 128,
};

export interface Junction {
  x: number;
  z: number;
  p: number;
  /** Path cells among the four neighbours. */
  n: number;
}

/**
 * Where paths meet: path cells with at least `minNeighbours` path cells among their FOUR neighbours (a straight
 * run has two, a corner two, a T three, a crossing four; the fold's paths are orthogonally connected staircases).
 */
export function pathJunctions(paths: readonly PathCell[], minP: number, minNeighbours: number): Junction[] {
  const at = new Map<string, PathCell>();
  for (const q of paths) if (q.p >= minP) at.set(q.key, q);
  const out: Junction[] = [];
  for (const q of at.values()) {
    const [cx, cz] = q.key.split(",").map(Number);
    let n = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (at.has(`${wrapCell(cx + dx)},${wrapCell(cz + dz)}`)) n++;
    }
    if (n >= minNeighbours) out.push({ x: q.x, z: q.z, p: q.p, n });
  }
  return out;
}

export interface SlabCluster {
  /** The centre (canonical world) of the cluster's cells, its tallest slab, and how many cells. */
  x: number;
  z: number;
  h: number;
  n: number;
}

/** The sealed slabs grouped by adjacency (four neighbours): the buildings. */
export function slabClusters(slabs: readonly Slab[], sealedH: number): SlabCluster[] {
  const list = slabs.filter((s) => s.h >= sealedH);
  const index = new Map<string, number>();
  list.forEach((s, i) => index.set(s.key, i));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  list.forEach((s, i) => {
    const [cx, cz] = s.key.split(",").map(Number);
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ]) {
      const j = index.get(`${wrapCell(cx + dx)},${wrapCell(cz + dz)}`);
      if (j === undefined) continue;
      const a = find(i), b = find(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  const groups = new Map<number, Slab[]>();
  list.forEach((s, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });
  const out: SlabCluster[] = [];
  for (const g of groups.values()) {
    // the centre, unwrapped around the first cell (a building across the world's edge is one)
    const ox = g[0].x, oz = g[0].z;
    let sx = 0, sz = 0, h = 0;
    for (const s of g) {
      sx += nearestImage(s.x, ox);
      sz += nearestImage(s.z, oz);
      if (s.h > h) h = s.h;
    }
    out.push({ x: sx / g.length, z: sz / g.length, h, n: g.length });
  }
  return out;
}

export interface StakesInputs {
  me: { x: number; z: number };
  /** Everyone within the view (witness.ts observe().far). */
  far: readonly Other[];
  snap: Snapshot | null;
  /** The view radius (world): nothing beyond it. */
  radius: number;
  cfg?: StakesConfig;
}

/** The stakes to drive into the ground now, nearest first, at most `cap`. */
export function stakesOf(inp: StakesInputs): Stake[] {
  const cfg = inp.cfg ?? DEFAULT_STAKES;
  const { me, far, snap, radius } = inp;
  const near = (x: number, z: number) => wrapDist(x, z, me.x, me.z);
  const place = (x: number, z: number): [number, number] => [nearestImage(x, me.x), nearestImage(z, me.z)];
  const out: { s: Stake; d: number }[] = [];
  if (cfg.others) {
    for (const o of far) {
      if (o.dist > radius) continue;
      const [x, z] = place(o.x, o.z);
      out.push({ s: { x, z, h: cfg.height, bright: cfg.bright * Math.exp(-o.ageSec / Math.max(0.1, cfg.recentSec)), kind: "other", moving: o.moving }, d: o.dist });
    }
  }
  if (cfg.junctions && snap) {
    const js = pathJunctions(snap.paths, cfg.pathP, cfg.minNeighbours)
      .map((j) => ({ j, d: near(j.x, j.z) }))
      .filter((e) => e.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, cfg.maxJunctions);
    for (const { j, d } of js) {
      const [x, z] = place(j.x, j.z);
      out.push({ s: { x, z, h: cfg.height * (0.5 + 0.5 * Math.min(1, j.p)), bright: cfg.bright * 0.8, kind: "junction", moving: false }, d });
    }
  }
  if (cfg.buildings && snap) {
    const bs = slabClusters(snap.slabs, cfg.sealedH)
      .map((b) => ({ b, d: near(b.x, b.z) }))
      .filter((e) => e.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, cfg.maxBuildings);
    for (const { b, d } of bs) {
      const [x, z] = place(b.x, b.z);
      out.push({ s: { x, z, h: cfg.height * (0.6 + 0.9 * Math.min(1, b.h / 2)), bright: cfg.bright * 0.6, kind: "building", moving: false }, d });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, cfg.cap).map((e) => e.s);
}

/** A cell's centre (world) from its indices — for tests and callers that only have keys. */
export const cellCentre = (cx: number, cz: number): [number, number] => [(cx + 0.5) * CELL_SIZE, (cz + 0.5) * CELL_SIZE];
