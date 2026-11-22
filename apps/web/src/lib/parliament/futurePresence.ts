/**
 * parliament/futurePresence.ts — THE FUTURE UNDER THE VISITOR'S FEET (the artist, 2026-11-22: "현재 행동하고 interact
 * 하되, 그로 인한 미래의 변형을 실시간으로 느낄 수 있게"). The wall infers the layer of what is found after the people
 * are gone (futureVillage.ts inferFuture) in its worker, off the whole block; the personal view has no worker and no
 * block — it has its own log (the visitor's samples and what the bot server writes within 40 world units of them).
 * So the same inference is run HERE, small: a density field (density.ts) fed from that log, read at the visitor's own
 * slot, the layer's buildings put through the column's generator (seeds.ts boxesOfSeed) and taken apart by the same
 * rules the wall uses (spaceModel.computeFuture: what stands on the ground goes first, what is under it stays; a
 * building left before the end is stripped) — and given back as a few flat arrays the personal view draws in its own
 * language (black, white, one green): the edges of what is left, the mounds and the dark earth, the plants.
 *
 * Pure: a function of the field, the visitor and the knobs. The cost is measured by the caller (markSpan "future").
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { DensityField } from "./density";
import { DEFAULT_FUTURE, inferFuture, type FutureConfig } from "./futureVillage";
import { hash2 } from "./nature";
import { PART_KINDS, RECIPES, boxesOfSeed, halfHeight, type Box, type BoxConfig, type PartKind, type Seed } from "./seeds";
import { wrapDelta } from "./world";

const CELL = CELL_SIZE;

/** What the personal view asks of the layer (its Leva folder: FuturePresence.tsx). */
export interface PresenceConfig {
  /** Slots of the visitor's top the change is read from (the wall's 변화를 읽는 범위). */
  band: number;
  /** How far gone what is found is (the wall's 얼마나 삭았나). */
  ruin: number;
  /** World height of one slot of a remain (the wall's unit is 1; the remains here stand on the visitor's ground). */
  unit: number;
  /** Only cells within this of the visitor are read (world; 0 = every cell the log holds). */
  radius: number;
  /** The most buildings whose parts are made in one reading (the nearest first). */
  maxBuildings: number;
  /** A building left before the end: how far its body is stripped (0 … 1). */
  strip: number;
  /** How far steel and piles hold (0 … 1). */
  lastSteel: number;
  lastPile: number;
  /** The visitor's own cells that are not building: given back as traces (what one alone leaves). */
  traces: boolean;
}

export const DEFAULT_PRESENCE: PresenceConfig = { band: 12, ruin: 0.5, unit: 0.6, radius: 0, maxBuildings: 120, strip: 0.4, lastSteel: 0.6, lastPile: 0.8, traces: true };

export interface PresenceResult {
  /** The slot read. */
  k: number;
  /** The edges of the parts that are left: [x, y, z, x, y, z] a segment (y from the visitor's ground). */
  edges: Float32Array;
  /** How many buildings were read, how many parts are left of them, how many went. */
  n: { buildings: number; kept: number; gone: number; cells: number; mine: number };
  /** [x, z, score ≥ 1, own] a mound; [x, z, score < 1, own] a patch of dark earth (futureVillage.ts deposit). */
  mounds: Float32Array;
  stains: Float32Array;
  /** Grass and scrub as clouds for the GPU (futureVillage.ts plantClouds: 12 a cloud; foot in slots). */
  plantClouds: Float32Array;
  /** The trees' points: [x, y (slots), z, shade, wild] each. */
  vegTree: Float32Array;
  /**
   * THE VISITOR'S OWN TRACES: [x, z, their weight 0 … 1 (against the threshold), 1 = the cell is building and would not
   * be without them (decisive) · 0 = not building (what one alone leaves) · 0.5 = building, among others] a cell.
   */
  traces: Float32Array;
  /** Milliseconds this reading took. */
  ms: number;
}

/** When a kind of part that stands on the ground goes, 0 (first) … 1 (last) — the wall's order (spaceModel FUTURE_GO). */
const FUTURE_GO: Record<string, number> = { drip: 0, mass: 0.2, slab: 0.5, beam: 0.7, brace: 0.7, column: 1 };
const STEEL_KINDS: ReadonlySet<string> = new Set(["column", "beam", "brace"]);
const BODY: ReadonlySet<string> = new Set(["mass", "slab", "beam", "brace", "drip"]);

const EMPTY = new Float32Array(0);

/** The box's rotation (three.js "YZX": first tilt about Z, then yaw about Y), as its three axes scaled by its sizes. */
function axes(b: Box): [number, number, number, number, number, number, number, number, number] {
  const cy = Math.cos(b.yaw ?? 0), sy = Math.sin(b.yaw ?? 0), cz = Math.cos(b.tilt ?? 0), sz = Math.sin(b.tilt ?? 0);
  return [cy * cz * b.sx, sz * b.sx, -sy * cz * b.sx, -cy * sz * b.sy, cz * b.sy, sy * sz * b.sy, sy * b.sz, 0, cy * b.sz];
}

/** The twelve edges of a box, pushed as segments; `dy` lifts it onto the visitor's ground. */
function pushEdges(out: number[], b: Box, dy: number): void {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = axes(b);
  const P: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const u = (i & 1 ? 0.5 : -0.5), v = (i & 2 ? 0.5 : -0.5), w = (i & 4 ? 0.5 : -0.5);
    P.push([b.x + ax * u + bx * v + cx * w, b.y + dy + ay * u + by * v + cy * w, b.z + az * u + bz * v + cz * w]);
  }
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push(...P[i], ...P[i | bit]);
}

/**
 * One reading of the layer round the visitor. `K` is the slot the layer is read at (the visitor's own, or the newest
 * built near them — FuturePresence.tsx readLatest); `kMe` the visitor's own slot (their traces are read there); `me`
 * their id; `box` the parts' numbers (the wall's, with `unit` from the knobs).
 */
export function futurePresence(field: DensityField, me: string, K: number, kMe: number, at: { x: number; z: number }, cfg: PresenceConfig, box: BoxConfig): PresenceResult {
  const t0 = performance.now();
  const all = field.seeds();
  const R = Math.max(0, cfg.radius);
  const seeds = R > 0 ? all.filter((s) => Math.hypot(wrapDelta(s.x - at.x), wrapDelta(s.z - at.z)) <= R) : all;
  const fcfg: FutureConfig = {
    ...DEFAULT_FUTURE,
    band: Math.max(4, Math.round(cfg.band)),
    ruin: cfg.ruin,
    margin: 2,
    vegPer: 3,
    spread: 0.5,
    strip: cfg.strip,
    last: { steel: cfg.lastSteel, pile: cfg.lastPile },
    // (the plants as the wall draws them: grass and scrub as clouds on the GPU, the trees' points apart)
    tree: { gpu: true, apart: true, points: true, share: 0.4, at: 1.05, under: 0.5 },
    scrub: { at: 0.6 },
  };
  const plan = inferFuture({ k: K, cells: seeds, pathAt: () => false, streams: new Map(), pipes: [], regions: [], cfg: fcfg });
  // THE BUILDINGS, AS THE WALL MAKES THEM (spaceModel.computeFuture): each a Seed of its own in the slots above K,
  // through the column's generator, its parts taken away by the rules of what is left
  const spu = box.secPerUnit, unit = box.unit;
  const buildings = plan.buildings.slice().sort((p, q) => Math.hypot(wrapDelta(p.from.x - at.x), wrapDelta(p.from.z - at.z)) - Math.hypot(wrapDelta(q.from.x - at.x), wrapDelta(q.from.z - at.z))).slice(0, Math.max(0, Math.round(cfg.maxBuildings)));
  const edges: number[] = [];
  let kept = 0, gone = 0;
  const ruin = Math.max(0, Math.min(1, cfg.ruin));
  const stripMax = Math.max(0, Math.min(1, cfg.strip)), stripHalf = Math.max(3, Math.round(fcfg.band) / 2);
  const lastSteel = Math.max(0, Math.min(1, cfg.lastSteel)), lastPile = Math.max(0, Math.min(1, cfg.lastPile));
  for (const bld of buildings) {
    const sd = bld.from as Seed;
    const rc = box.recipe ?? RECIPES[sd.material];
    const s0 = K + 1, s1 = K + bld.h;
    const mass = sd.masses?.get(K) ?? sd.masses?.get(K - 1) ?? sd.mass;
    const levels = new Map<number, number>(), masses = new Map<number, number>();
    for (let k = s0; k <= s1; k++) {
      levels.set(k, 1);
      masses.set(k, mass);
    }
    const fs: Seed = { ...sd, id: ((bld.cx * 73856093) ^ (bld.cz * 19349663) ^ sd.id) >>> 0, x: (bld.cx + 0.5) * CELL, z: (bld.cz + 0.5) * CELL, t0: s0 * spu, t1: (s1 + 1) * spu - 1, spans: [[s0 * spu, (s1 + 1) * spu - 1]], mass, levels, masses, gather: undefined, who: undefined, growth: undefined };
    const fcfg2: BoxConfig = { ...box, buildSlots: 0, timeJitter: 0, recipe: { ...rc, slat: { ...rc.slat, density: rc.slat.density * 0.5, maxPerMass: Math.min(16, rc.slat.maxPerMass) }, drip: { ...rc.drip, perArea: 0, max: 0 } } };
    const goneTo = Math.max(0, Math.min(1, (1 - bld.left) * (0.4 + 1.2 * ruin)));
    const footY = s0 * unit, spanY = Math.max(1e-6, (s1 + 1 - s0) * unit);
    // (what stands on the ground goes first, what is under it stays — the wall's `under` rule, always on here)
    const rank = (b: Box): number => {
      if (b.kind === "basement" || b.kind === "pile") return 2;
      const own = hash2(Math.round(b.x * 997) ^ b.seed, Math.round(b.z * 991) ^ Math.round(b.y * 983), PART_KINDS.indexOf(b.kind) + 4099);
      if (b.kind === "plinth") return 0.9 + 0.2 * own;
      const up = Math.max(0, Math.min(1, (b.y - footY) / spanY));
      return (FUTURE_GO[b.kind] ?? 0.5) * 0.5 + (1 - up) * 0.3 + own * 0.2;
    };
    const since = bld.since ?? 0;
    const stripTo = since > 0 ? Math.max(goneTo, stripMax * Math.min(1, since / stripHalf)) : goneTo;
    const standing: Box[] = [];
    for (const b of boxesOfSeed(fs, fcfg2)) {
      const lastBy = STEEL_KINDS.has(b.kind) ? lastSteel : b.kind === "pile" ? lastPile : 0;
      const r0 = rank(b), held = r0 + (2 - r0) * lastBy;
      if (held >= (BODY.has(b.kind) ? stripTo : goneTo) * (1 - (STEEL_KINDS.has(b.kind) ? lastSteel : 0))) standing.push(b);
      else gone++;
    }
    // NOTHING HANGS IN THE AIR (the wall's rule): a part stays only on the ground or on a kept part under it
    const tol = 0.15 * unit;
    const ext = (q: Box): [number, number] => (q.tilt ? [Math.max(q.sx, q.sy, q.sz) / 2, Math.max(q.sx, q.sy, q.sz) / 2] : [q.sx / 2, q.sz / 2]);
    const over = (a: Box, q: Box) => {
      const [ax, az] = ext(a), [qx, qz] = ext(q);
      return Math.abs(a.x - q.x) <= ax + qx && Math.abs(a.z - q.z) <= az + qz;
    };
    const bot = (q: Box) => q.y - halfHeight(q), top = (q: Box) => q.y + halfHeight(q);
    const keptHere: Box[] = [];
    for (const a of standing.sort((p, q) => bot(p) - bot(q))) {
      if (bot(a) <= footY + tol || keptHere.some((q) => top(q) >= bot(a) - tol && bot(q) < bot(a) && over(a, q))) keptHere.push(a);
      else gone++;
    }
    for (const b of keptHere) pushEdges(edges, b, -footY);
    kept += keptHere.length;
  }
  // THE VISITOR'S OWN TRACES (the artist's question of 11/16–22: how one's trace and influence read): every cell-slot
  // they put anything into, at their slot or the one below, and what it is there
  const traces: number[] = [];
  let mine = 0;
  if (cfg.traces) {
    const seen = new Set<number>();
    for (const c of field.cellsOf(me)) {
      if (c.k > kMe || c.k < kMe - 1) continue;
      const q = c.cx * 65536 + c.cz;
      if (seen.has(q)) continue;
      seen.add(q);
      if (R > 0 && Math.hypot(wrapDelta((c.cx + 0.5) * CELL - at.x), wrapDelta((c.cz + 0.5) * CELL - at.z)) > R) continue;
      traces.push((c.cx + 0.5) * CELL, (c.cz + 0.5) * CELL, Math.min(1, c.mine / Math.max(1, field.cfg.step)), c.level >= 1 ? (c.decisive ? 1 : 0.5) : 0);
      if (c.level >= 1) mine++;
    }
  }
  // (the plants' feet: on the ground — what they stood on in the wall's reading may be gone here)
  const clouds = plan.plantClouds ? Float32Array.from(plan.plantClouds) : EMPTY;
  for (let o = 2; o < clouds.length; o += 12) clouds[o] = 0;
  return {
    k: K,
    edges: Float32Array.from(edges),
    n: { buildings: buildings.length, kept, gone, cells: seeds.length, mine },
    mounds: plan.mounds,
    stains: plan.stains,
    plantClouds: clouds,
    vegTree: plan.vegTree ?? EMPTY,
    traces: Float32Array.from(traces),
    ms: Math.round((performance.now() - t0) * 10) / 10,
  };
}

/** The PartKind list, for whoever colours the edges by kind later. */
export type { PartKind };
