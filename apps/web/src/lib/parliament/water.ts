/**
 * parliament/water.ts
 *
 * WATERWAYS between buildings that the same people built.
 *
 *   BUILDING   seeds (one per cell) that touch (within `join` cells of each other) form one building
 *   BIG        a building is big from the moment one of its seeds' raw height reaches `minRaw` (Seed.growth)
 *   LINK       two big buildings within `reach` of each other are joined by water when one visitor (or bot) helped
 *              build both, and was still at it once both were big:
 *                t = min over shared builders of max(both big, their first contribution to each)
 *              (only if that builder's last contribution to one of them is at or after t)
 *   LIFE       the water flows from t until `persistSec` after both buildings were last used (or until now)
 *   COURSE     a meandering line between the two nearest seeds; the bends drift slowly through time, so stacked
 *              slots read as a twisting sheet in the timespace
 *
 * Effects (through waterField): vegetation is denser along the water, and parts near it corrode faster
 * (WearConfig.water). Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import type { Seed } from "./seeds";

export interface WaterConfig {
  enabled: boolean;
  /** Raw height (steps) a building must reach to be "big". */
  minRaw: number;
  /** Seeds within this many cells belong to the same building. */
  join: number;
  /** Most distance (world) between two buildings that water joins. */
  reach: number;
  /** Least weight (worker·s) for a visitor to count as one of a building's builders. */
  minShare: number;
  /** Seconds the water keeps flowing after both buildings were last used. */
  persistSec: number;
  /** Width of the stream (world). */
  width: number;
  /** How far the course bends sideways (× its length). */
  meander: number;
  /** Reach of the water's influence on vegetation and parts (world). */
  radius: number;
  /** Vegetation density added right at the water (fades to 0 at `radius`). */
  vegBoost: number;
  /** Parts at the water age × (1 + corrode) while exposed (fades with distance). */
  corrode: number;
}

export const DEFAULT_WATER: WaterConfig = {
  enabled: true,
  minRaw: 1.2,
  join: 1,
  reach: 40,
  minShare: 1,
  persistSec: 300,
  width: 0.45,
  meander: 0.18,
  radius: 2.5,
  vegBoost: 0.6,
  corrode: 1.5,
};

export interface Building {
  id: number;
  seeds: Seed[];
  /** When it became big (null = never). */
  bigS: number | null;
  /** Last time anybody used it. */
  lastS: number;
  /** Builder → [first, last] contribution (amount ≥ minShare). */
  builders: Map<string, [number, number]>;
}

export interface WaterLink {
  /** Stable id (from the two buildings' first seeds). */
  id: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Assigned seconds from which / until which it flows. */
  t0: number;
  t1: number;
  /** The builder who joined them. */
  via: string;
}

/** When a seed's raw height first reached `minRaw` (its birth if it started there), or null. */
export function seedBigS(seed: Seed, minRaw: number): number | null {
  if (seed.growth?.length) {
    for (const [s, r] of seed.growth) if (r >= minRaw - 1e-9) return s;
    return null;
  }
  return seed.mass >= minRaw ? seed.t0 : null;
}

/** Seeds grouped into buildings: those within `join` cells of each other (union–find, 8-neighbourhood and more). */
export function buildingsOf(seeds: readonly Seed[], cfg: WaterConfig): Building[] {
  const cellOf = (s: Seed) => [Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE)] as const;
  const parent = seeds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map<string, number[]>();
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    const key = `${cx},${cz}`;
    const l = at.get(key);
    if (l) l.push(i);
    else at.set(key, [i]);
  });
  const J = Math.max(1, Math.round(cfg.join));
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    for (let dx = -J; dx <= J; dx++) {
      for (let dz = -J; dz <= J; dz++) {
        for (const j of at.get(`${cx + dx},${cz + dz}`) ?? []) {
          const a = find(i), b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  });
  const groups = new Map<number, Seed[]>();
  seeds.forEach((s, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(s);
    else groups.set(r, [s]);
  });
  const out: Building[] = [];
  for (const list of groups.values()) {
    let bigS: number | null = null;
    let lastS = -Infinity;
    const builders = new Map<string, [number, number]>();
    for (const s of list) {
      const b = seedBigS(s, cfg.minRaw);
      if (b !== null && (bigS === null || b < bigS)) bigS = b;
      lastS = Math.max(lastS, s.t1);
      for (const c of s.who ?? []) {
        if (c.amount < cfg.minShare) continue;
        const cur = builders.get(c.o);
        builders.set(c.o, cur ? [Math.min(cur[0], c.first), Math.max(cur[1], c.last)] : [c.first, c.last]);
      }
    }
    out.push({ id: Math.min(...list.map((s) => s.id)), seeds: list, bigS, lastS, builders });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The waterways at present time `tNow`. */
export function waterLinks(seeds: readonly Seed[], cfg: WaterConfig, tNow: number): WaterLink[] {
  if (!cfg.enabled) return [];
  const big = buildingsOf(seeds, cfg).filter((b) => b.bigS !== null && b.bigS <= tNow);
  const out: WaterLink[] = [];
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const A = big[i], B = big[j];
      // the two nearest seeds
      let best = Infinity, sa: Seed | null = null, sb: Seed | null = null;
      for (const p of A.seeds) {
        for (const q of B.seeds) {
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          if (d < best) {
            best = d;
            sa = p;
            sb = q;
          }
        }
      }
      if (!sa || !sb || best > cfg.reach) continue;
      // a shared builder still at it once both were big
      let t = Infinity, via = "";
      for (const [o, [fa, la]] of A.builders) {
        const inB = B.builders.get(o);
        if (!inB) continue;
        const [fb, lb] = inB;
        const tl = Math.max(A.bigS!, B.bigS!, fa, fb);
        if (Math.max(la, lb) < tl) continue;
        if (tl < t || (tl === t && o < via)) {
          t = tl;
          via = o;
        }
      }
      if (!(t <= tNow)) continue;
      const end = Math.min(tNow, Math.max(A.lastS, B.lastS) + cfg.persistSec);
      if (end < t) continue;
      out.push({ id: Math.floor(hash2(A.id, B.id, 3) * 1e9), ax: sa.x, az: sa.z, bx: sb.x, bz: sb.z, t0: t, t1: end, via });
    }
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const a = hash2(i, seed, 211), b = hash2(i + 1, seed, 211);
  return a + (b - a) * smooth(t - i);
}

/** The course of a link in slot k: a polyline [x, z, …] from a to b, bending sideways, drifting slowly with k. */
export function waterCourse(l: WaterLink, k: number, cfg: WaterConfig): Float32Array {
  const dx = l.bx - l.ax, dz = l.bz - l.az;
  const len = Math.hypot(dx, dz) || 1e-6;
  const nx = -dz / len, nz = dx / len;
  const n = Math.max(4, Math.ceil(len / 0.5));
  const out = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = Math.sin(Math.PI * t) * (noise1(t * 3 + k * 0.03, l.id % 100003) * 2 - 1) * cfg.meander * len;
    out[i * 2] = l.ax + dx * t + nx * bend;
    out[i * 2 + 1] = l.az + dz * t + nz * bend;
  }
  return out;
}

/** Slots in which a link flows. */
export function linkSlots(l: WaterLink, secPerUnit: number): [number, number] {
  return [Math.floor(l.t0 / secPerUnit), Math.floor(l.t1 / secPerUnit)];
}

/**
 * Nearness to water per (cell, slot) within [k0, k1]: 1 at the course, 0 at `radius`. Returns a lookup
 * (ix, iz, k) → 0..1.
 */
export function waterField(links: readonly WaterLink[], k0: number, k1: number, secPerUnit: number, cfg: WaterConfig): (ix: number, iz: number, k: number) => number {
  const m = new Map<string, number>();
  const R = Math.max(0.1, cfg.radius);
  const n = Math.ceil(R / CELL_SIZE);
  for (const l of links) {
    const [a, b] = linkSlots(l, secPerUnit);
    for (let k = Math.max(k0, a); k <= Math.min(k1, b); k++) {
      const c = waterCourse(l, k, cfg);
      for (let p = 0; p < c.length; p += 2) {
        const x = c[p], z = c[p + 1];
        const cx0 = Math.floor(x / CELL_SIZE), cz0 = Math.floor(z / CELL_SIZE);
        for (let dx = -n; dx <= n; dx++) {
          for (let dz = -n; dz <= n; dz++) {
            const ix = cx0 + dx, iz = cz0 + dz;
            const d = Math.hypot((ix + 0.5) * CELL_SIZE - x, (iz + 0.5) * CELL_SIZE - z);
            if (d >= R) continue;
            const key = `${ix},${iz},${k}`;
            const w = 1 - d / R;
            if (w > (m.get(key) ?? 0)) m.set(key, w);
          }
        }
      }
    }
  }
  return (ix, iz, k) => m.get(`${ix},${iz},${k}`) ?? 0;
}

export interface WaterMesh {
  position: Float32Array;
  index: Uint32Array;
}

/** Flat ribbons along the courses, one per flowing slot within [kFrom, kTo], at the slot's floor. */
export function waterRibbons(links: readonly WaterLink[], kFrom: number, kTo: number, secPerUnit: number, unit: number, cfg: WaterConfig): WaterMesh {
  const pos: number[] = [];
  const ind: number[] = [];
  const hw = cfg.width / 2;
  for (const l of links) {
    const [a, b] = linkSlots(l, secPerUnit);
    for (let k = Math.max(kFrom, a); k <= Math.min(kTo, b); k++) {
      const c = waterCourse(l, k, cfg);
      const y = (k + 0.05) * unit;
      const base = pos.length / 3;
      const n = c.length / 2;
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        const tx = c[i1 * 2] - c[i0 * 2], tz = c[i1 * 2 + 1] - c[i0 * 2 + 1];
        const tl = Math.hypot(tx, tz) || 1;
        const ox = (-tz / tl) * hw, oz = (tx / tl) * hw;
        pos.push(c[i * 2] + ox, y, c[i * 2 + 1] + oz, c[i * 2] - ox, y, c[i * 2 + 1] - oz);
        if (i < n - 1) {
          const v = base + i * 2;
          ind.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
  }
  return { position: Float32Array.from(pos), index: Uint32Array.from(ind) };
}
