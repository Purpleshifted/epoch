/**
 * parliament/shards.ts
 *
 * The Side view's "architecture" as a COLLAGE OF PLANAR FRAGMENTS (reference: FELD, "Extracts of
 * Local Distance": abstract architectural collages built from fragmented photographs).
 *
 * The fold decides WHERE concrete is (slab cells) and how intact it still is; this module only
 * decides what it LOOKS like. It is pure and seeded by cell positions, so every client draws the
 * same collage from the same log.
 *
 *   cluster   8-connected group of solid slab cells = one "building"
 *   fin       standing concrete plane over a cell (rhythm of vertical slabs)
 *   plate     thin horizontal storey plate, cantilevered off-centre
 *   panel     large leaning light-metal plane (per cluster)
 *   strut     long thin black rod; some radiate from one knot near the cluster centre
 *   ground    thin dark stroke where a slab (or just its footprint) stands
 *
 * Each fragment gets a random `life` in 0..1 and is drawn only while life < intact (the
 * cluster's mean h/raw), so wear makes fragments fall away one by one instead of shrinking.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import type { Slab } from "./types";

export interface ShardConfig {
  /** Multiplies the number of fins and plates per cell. */
  density: number;
  /** Multiplies the number of leaning panels per cluster. */
  panels: number;
  /** Multiplies the number of black struts per cluster. */
  struts: number;
}

export const DEFAULT_SHARDS: ShardConfig = { density: 1, panels: 1, struts: 1 };

export type ShardKind =
  | "fin"
  | "plate"
  | "panel"
  | "strut"
  | "ground"
  // plan (Top) view: flat fragments lying in the ground plane, seen from above
  | "roof"
  | "setback"
  | "shadow"
  | "beam"
  | "axis"
  | "path";

export interface Shard {
  kind: ShardKind;
  /** Four corners (bl, br, tr, tl) as x, y, z * 4. */
  p: number[];
  /** 0..1 brightness (struts ~0.04). */
  tone: number;
}

const SOLID = 0.15;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function rng(seed: number): () => number {
  let i = 0;
  return () => hash2(seed | 0, i++, 77);
}

/** A (possibly tapered, sheared, tilted) quad standing on y0, base centre at (cx, z). */
function quad(cx: number, y0: number, z: number, w: number, h: number, shear: number, topScale: number, tilt: number): number[] {
  const hw = w / 2;
  const pts: [number, number][] = [
    [-hw, 0],
    [hw, 0],
    [hw * topScale + shear, h],
    [-hw * topScale + shear, h],
  ];
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const out: number[] = [];
  for (const [x, y] of pts) out.push(cx + x * c - y * s, Math.max(0, y0 + x * s + y * c), z);
  return out;
}

/** A thin rod between two points in the x/y plane at depth z. */
function strut(x0: number, y0: number, x1: number, y1: number, z: number, t: number): number[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2);
  const ny = (dx / len) * (t / 2);
  const y = (v: number) => Math.max(0, v);
  return [x0 + nx, y(y0 + ny), z, x0 - nx, y(y0 - ny), z, x1 - nx, y(y1 - ny), z, x1 + nx, y(y1 + ny), z];
}

interface Cluster {
  cells: Slab[];
}

function clusters(slabs: Slab[]): Cluster[] {
  const solid = slabs.filter((s) => s.h >= SOLID).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const idx = new Map<string, number>();
  solid.forEach((s, i) => idx.set(s.key, i));
  const parent = solid.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  solid.forEach((s, i) => {
    const [cx, cz] = s.key.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const j = idx.get(`${cx + dx},${cz + dz}`);
        if (j !== undefined) parent[find(i)] = find(j);
      }
    }
  });
  const groups = new Map<number, Slab[]>();
  solid.forEach((s, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(s);
  });
  return [...groups.values()].map((cells) => ({ cells }));
}

export function buildShards(slabs: Slab[], heightUnit: number, cfg: ShardConfig = DEFAULT_SHARDS): Shard[] {
  const out: Shard[] = [];
  const C = CELL_SIZE;

  // thin dark ground strokes: where a slab (or only its footprint) stands
  for (const s of slabs) out.push({ kind: "ground", p: quad(s.x, 0, s.z, C * 0.96, 0.05, 0, 1, 0), tone: 0.06 });

  for (const cl of clusters(slabs)) {
    const cells = cl.cells;
    const n = cells.length;
    const [mcx, mcz] = cells[0].key.split(",").map(Number);
    const r = rng(Math.floor(hash2(mcx, mcz, 5) * 1e9));
    const intact = cells.reduce((a, s) => a + (s.raw > 0 ? s.h / s.raw : 0), 0) / n;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxH = 0;
    for (const s of cells) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
      maxH = Math.max(maxH, s.h * heightUnit);
    }
    const midX = (minX + maxX) / 2;

    // per cell: fins and storey plates
    for (const s of cells) {
      const H = s.h * heightUnit;
      const nFin = Math.max(1, Math.round(cfg.density * (1 + r() * 1.2 + (s.h >= 3 ? 1 : 0))));
      for (let k = 0; k < nFin; k++) {
        const life = r();
        const w = C * (0.35 + r() * 0.6);
        const x = s.x + (r() - 0.5) * C * 0.9;
        const z = s.z + (r() - 0.5) * C * 0.9;
        const h = H * (0.7 + r() * 0.65);
        const shear = (r() - 0.5) * w * 0.9;
        const top = 0.6 + r() * 0.6;
        const tone = 0.62 + r() * 0.32;
        if (life < intact) out.push({ kind: "fin", p: quad(x, 0, z, w, h, shear, top, (r() - 0.5) * 0.06), tone });
      }
      const levels = Math.ceil(s.h - 1e-6);
      for (let l = 0; l < levels; l++) {
        const life = r();
        const present = r() < clamp(0.65 * cfg.density, 0, 1);
        const w = C * (1 + r() * 2);
        const x = s.x + (r() - 0.5) * C * 2.4;
        const z = s.z + (r() - 0.5) * C * 0.9;
        const y = l * heightUnit + (r() - 0.5) * heightUnit * 0.2;
        const thick = heightUnit * (0.08 + r() * 0.12);
        const tone = 0.8 + r() * 0.18;
        if (present && life < intact) out.push({ kind: "plate", p: quad(x, y, z, w, thick, 0, 1, (r() - 0.5) * 0.04), tone });
      }
    }

    if (n < 2) continue;

    // per cluster: leaning panels
    const nPanel = Math.round(cfg.panels * clamp(n / 2, 1, 14));
    for (let k = 0; k < nPanel; k++) {
      const life = r();
      const w = C * (1.5 + r() * 2.5);
      const x = midX + (r() - 0.5) * (maxX - minX + C * 2);
      const z = minZ + r() * (maxZ - minZ + C) - C / 2;
      const h = Math.max(heightUnit, maxH) * (0.6 + r() * 0.7);
      const tilt = (r() - 0.5) * 0.9;
      const shear = (r() - 0.5) * w;
      const top = 0.5 + r() * 0.7;
      const tone = 0.74 + r() * 0.24;
      if (life < intact) out.push({ kind: "panel", p: quad(x, 0, z, w, h, shear, top, tilt), tone });
    }

    // per cluster: black struts, some radiating from one knot
    const nStrut = Math.round(cfg.struts * clamp(n / 3, 1, 10));
    const kx = midX + (r() - 0.5) * C * 2;
    const ky = Math.max(heightUnit, maxH) * (0.45 + r() * 0.2);
    const kz = (minZ + maxZ) / 2;
    for (let k = 0; k < nStrut; k++) {
      const life = r();
      const t = 0.05 + r() * 0.08;
      const len = C * (2 + r() * 4);
      const a = r() * Math.PI;
      const radiate = r() < 0.6;
      let x0: number, y0: number, x1: number, y1: number;
      if (radiate) {
        x0 = kx - Math.cos(a) * len * 0.5;
        y0 = ky - Math.sin(a) * len * 0.5;
        x1 = kx + Math.cos(a) * len * 0.5;
        y1 = ky + Math.sin(a) * len * 0.5;
      } else {
        x0 = midX + (r() - 0.5) * (maxX - minX + C * 3);
        y0 = 0;
        x1 = x0 + (r() - 0.5) * C * 8;
        y1 = Math.max(heightUnit, maxH) * (0.8 + r() * 0.7);
      }
      const z = kz + (r() - 0.5) * (maxZ - minZ + C);
      if (life < intact) out.push({ kind: "strut", p: strut(x0, y0, x1, y1, z, t), tone: 0.04 });
    }
  }
  return out;
}

/** A rotated rectangle lying in the ground plane at height y (corners bl, br, tr, tl; CCW in x/z). */
function rect(cx: number, cz: number, w: number, d: number, ang: number, y: number): number[] {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const hw = w / 2;
  const hd = d / 2;
  const out: number[] = [];
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) out.push(cx + x * c - z * s, y, cz + x * s + z * c);
  return out;
}

/** Hard cast shadow of a rectangle along v: one parallelogram per edge facing the light-away side. */
function shadowOf(r: number[], vx: number, vz: number, y: number): number[][] {
  const res: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ax = r[i * 3], az = r[i * 3 + 2], bx = r[j * 3], bz = r[j * 3 + 2];
    const nx = bz - az; // outward normal of a CCW edge (ex, ez) is (ez, -ex)
    const nz = -(bx - ax);
    if (nx * vx + nz * vz > 0) res.push([ax, y, az, bx, y, bz, bx + vx, y, bz + vz, ax + vx, y, az + vz]);
  }
  return res;
}

/**
 * The Top view's collage: the same slab clusters read as a PLAN (references: grey concrete plans with long
 * hard shadows and thin black axis lines). Everything lies in the ground plane, ordered by y so taller
 * parts paint over lower ones; wear removes fragments one by one exactly as in the side collage.
 */
export function buildPlanShards(
  slabs: Slab[],
  paths: { x: number; z: number; p: number }[],
  cfg: ShardConfig = DEFAULT_SHARDS,
): Shard[] {
  const out: Shard[] = [];
  const C = CELL_SIZE;
  const SX = -0.8, SZ = 0.55; // shadow direction (towards the lower left of the sheet)

  for (const p of paths) out.push({ kind: "path", p: rect(p.x, p.z, C * 0.55, C * 0.55, 0, 0.002), tone: 1 - 0.25 * Math.min(1, p.p) });
  // footprint-only cells (worn to the ground): a pale, flat remnant
  for (const s of slabs) if (s.h < SOLID) out.push({ kind: "ground", p: rect(s.x, s.z, C * 0.9, C * 0.9, 0, 0.004), tone: 0.98 });

  for (const cl of clusters(slabs)) {
    const cells = cl.cells;
    const n = cells.length;
    const [mcx, mcz] = cells[0].key.split(",").map(Number);
    const r = rng(Math.floor(hash2(mcx, mcz, 9) * 1e9));
    const intact = cells.reduce((a, s) => a + (s.raw > 0 ? s.h / s.raw : 0), 0) / n;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of cells) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }

    for (const s of cells) {
      const k = 1 + r() * 0.35; // shadow length jitter
      const w = C * (0.8 + r() * 0.5);
      const d = C * (0.8 + r() * 0.5);
      const ox = (r() - 0.5) * C * 0.3;
      const oz = (r() - 0.5) * C * 0.3;
      const ang = r() < 0.2 ? (r() - 0.5) * 0.5 : 0;
      const life = r();
      const y = 0.01 + s.h * 0.05;
      const base = rect(s.x + ox, s.z + oz, w, d, ang, y);
      if (life < intact) {
        const len = s.h * C * 0.5 * k;
        for (const sh of shadowOf(base, SX * len, SZ * len, 0.006 + s.h * 0.002)) out.push({ kind: "shadow", p: sh, tone: 0.5 });
        out.push({ kind: "roof", p: base, tone: clamp(0.62 + s.h * 0.06 + (r() - 0.5) * 0.2, 0.55, 0.98) });
      } else {
        r(); // keep the stream aligned whatever the wear
      }
      const levels = Math.ceil(s.h - 1e-6);
      for (let l = 1; l < levels; l++) {
        const sw = w * (0.35 + r() * 0.4);
        const sd = d * (0.35 + r() * 0.4);
        const dx = (r() - 0.5) * (w - sw);
        const dz = (r() - 0.5) * (d - sd);
        const lf = r();
        const present = r() < 0.7;
        if (present && lf < intact) out.push({ kind: "setback", p: rect(s.x + ox + dx, s.z + oz + dz, sw, sd, ang, y + l * 0.02), tone: clamp(0.8 + l * 0.04, 0.8, 1) });
      }
    }

    if (n < 2) continue;

    // long thin beams/fins crossing the cluster (axis-aligned, as in a plan)
    const nBeam = Math.round(cfg.panels * clamp(n / 2, 1, 12));
    for (let k = 0; k < nBeam; k++) {
      const life = r();
      const vertical = r() < 0.5;
      const len = C * (2.5 + r() * 5);
      const t = C * (0.06 + r() * 0.2);
      const x = minX + r() * (maxX - minX + C) - C / 2;
      const z = minZ + r() * (maxZ - minZ + C) - C / 2;
      const tone = 0.85 + r() * 0.13;
      if (life < intact) {
        const b = rect(x, z, vertical ? t : len, vertical ? len : t, 0, 0.9);
        for (const sh of shadowOf(b, SX * C * 0.4, SZ * C * 0.4, 0.4)) out.push({ kind: "shadow", p: sh, tone: 0.5 });
        out.push({ kind: "beam", p: b, tone });
      }
    }

    // thin black axis lines running out of the cluster
    const nAxis = Math.round(cfg.struts * clamp(n / 3, 1, 10));
    for (let k = 0; k < nAxis; k++) {
      const life = r();
      const vertical = r() < 0.5;
      const len = C * (3 + r() * 12);
      const t = 0.03 + r() * 0.05;
      const x = minX + r() * (maxX - minX + C) - C / 2;
      const z = minZ + r() * (maxZ - minZ + C) - C / 2;
      const off = (r() - 0.3) * len * 0.5;
      if (life < intact) out.push({ kind: "axis", p: vertical ? rect(x, z + off, t, len, 0, 1.2) : rect(x + off, z, len, t, 0, 1.2), tone: 0.04 });
    }
  }
  return out;
}
