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
import { villageSites, type HerdConfig } from "./lifecycle";
import { nearestOnBorder, villageBorders } from "./villageBorders";

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
  /** THE POINT CLOUD (the excavators' moment — FuturePresence.tsx): points per square world unit of a part's surface;
   *  0 = none made. */
  surface?: number;
  /** The most points on one part's surface (absent = 160), and on all the parts' surfaces of one reading (absent =
   *  60 000; the scan's residue raises both with its 부재 점 수). */
  surfaceCap?: number;
  surfaceMax?: number;
  /** Plants over the ground nobody kept (futureVillage.ts ground.density: the wild forest), 0 … 1; absent = none. */
  wild?: number;
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
  /** THE PARTS AS POINTS on their surfaces: [x, y, z, shade 0 … 1] each (y from the visitor's ground; empty unless
   *  PresenceConfig.surface). */
  surface: Float32Array;
  /** Which part each surface point is on (0 … parts − 1; a part's points come one after another), and per part how
   *  long it lasts: 1 = steel or a pile (what holds longest), 0 = the rest (the scan's residue — FutureResidue.tsx). */
  surfacePart: Uint32Array;
  partSteel: Uint8Array;
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

/** Points on a box's six faces, as many as its area × `perArea` (3 … 160), each [x, y, z, shade]. */
function pushSurface(out: number[], b: Box, dy: number, perArea: number, capPer = 160): void {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = axes(b);
  const A = [b.sy * b.sz, b.sx * b.sz, b.sx * b.sy];
  const total = 2 * (A[0] + A[1] + A[2]);
  const n = Math.max(3, Math.min(capPer, Math.round(total * perArea)));
  const base = (Math.round(b.x * 977) ^ b.seed) | 0, base2 = (Math.round(b.z * 971) ^ Math.round(b.y * 967)) | 0;
  // (concrete lighter, steel darker; each part its own tone)
  const shade = (STEEL_KINDS.has(b.kind) ? 0.45 : 0.6) + 0.3 * b.tone;
  for (let i = 0; i < n; i++) {
    const f = hash2(base, base2 ^ (i * 7919), 811) * (A[0] + A[1] + A[2]);
    const side = hash2(base, base2 ^ (i * 7919), 812) < 0.5 ? -0.5 : 0.5;
    const u = hash2(base, base2 ^ (i * 7919), 813) - 0.5, v = hash2(base, base2 ^ (i * 7919), 814) - 0.5;
    const [l0, l1, l2] = f < A[0] ? [side, u, v] : f < A[0] + A[1] ? [u, side, v] : [u, v, side];
    out.push(b.x + ax * l0 + bx * l1 + cx * l2, b.y + dy + ay * l0 + by * l1 + cy * l2, b.z + az * l0 + bz * l1 + cz * l2, shade);
  }
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
  const edges: number[] = [], surface: number[] = [], surfacePart: number[] = [], partSteel: number[] = [];
  const perArea = Math.max(0, cfg.surface ?? 0);
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
    for (const b of keptHere) {
      pushEdges(edges, b, -footY);
      if (perArea > 0 && surface.length < (cfg.surfaceMax ?? 60000) * 4) {
        const from = surface.length / 4;
        pushSurface(surface, b, -footY, perArea, cfg.surfaceCap ?? 160);
        for (let i = from; i < surface.length / 4; i++) surfacePart.push(partSteel.length);
        partSteel.push(STEEL_KINDS.has(b.kind) || b.kind === "pile" ? 1 : 0);
      }
    }
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
  let clouds = plan.plantClouds ? Float32Array.from(plan.plantClouds) : EMPTY;
  for (let o = 2; o < clouds.length; o += 12) clouds[o] = 0;
  // THE GROUND NOBODY KEPT, ROUND THE VISITOR (PresenceConfig.wild): after the people, plants take every free cell —
  // also where nothing was ever built (the wall's inference makes nothing of a ground without buildings). Within R of
  // the visitor only; not on what is left of a building, not on the visitor's own cells (they are dark earth).
  let trees = plan.vegTree ?? EMPTY;
  const wild = Math.max(0, Math.min(1, cfg.wild ?? 0));
  if (wild > 0 && R > 0) {
    const taken = new Set<number>();
    for (const b of plan.buildings) taken.add(b.cx * 65536 + b.cz);
    for (let o = 0; o + 3 < traces.length; o += 4) taken.add(Math.floor(traces[o] / CELL) * 65536 + Math.floor(traces[o + 1] / CELL));
    const extra: number[] = [], treePts: number[] = [];
    const c0x = Math.floor(at.x / CELL), c0z = Math.floor(at.z / CELL), rc = Math.ceil(R / CELL);
    for (let dz = -rc; dz <= rc; dz++) {
      for (let dx = -rc; dx <= rc; dx++) {
        if ((dx * dx + dz * dz) * CELL * CELL > R * R) continue;
        const cx = c0x + dx, cz = c0z + dz;
        if (taken.has(cx * 65536 + cz)) continue;
        const h1 = hash2(cx, cz, 9301);
        if (h1 >= wild * 0.55) continue;
        const x = (cx + hash2(cx, cz, 9302)) * CELL, z = (cz + hash2(cx, cz, 9303)) * CELL;
        const u = hash2(cx, cz, 9304), own = hash2(cx, cz, 9305);
        if (u < 0.08) {
          // a tree: a stem and a crown of points (slots above the ground)
          const tall = 1.2 + 1.2 * hash2(cx, cz, 9306), crown = 0.6 + 0.8 * hash2(cx, cz, 9307);
          for (let i = 0; i < 10; i++) treePts.push(x, (tall * i) / 10, z, 0.15, 1);
          for (let i = 0; i < 60; i++) {
            const a = hash2(cx * 31 + i, cz, 9308) * Math.PI * 2, c = hash2(cx, cz * 31 + i, 9309) * 2 - 1, q = Math.sqrt(1 - c * c), rr = Math.cbrt(hash2(cx + i, cz - i, 9310));
            treePts.push(x + Math.cos(a) * q * rr * crown * CELL, tall + c * rr * crown * 0.8, z + Math.sin(a) * q * rr * crown * CELL, 0.25 + 0.4 * hash2(i, cx, 9311), 1);
          }
        }
        const scrub = u < 0.45;
        // (a meadow flowers here and there: most where grass meets scrub — futureVillage.ts F3)
        const fl = !scrub && hash2(cx, cz, 9313) < 0.4 ? 0.4 + 0.6 * hash2(cx, cz, 9314) : 0;
        extra.push(x, z, 0, (0.6 + 0.9 * hash2(cx, cz, 9312)) * CELL, scrub ? 0.12 + 0.2 * own : 0.03 + 0.05 * own, scrub ? 1 : 0, fl, 0, 1, own, 1, 0);
      }
    }
    if (extra.length) {
      const all2 = new Float32Array(clouds.length + extra.length);
      all2.set(clouds);
      all2.set(extra, clouds.length);
      clouds = all2;
    }
    if (treePts.length) {
      const t2 = new Float32Array(trees.length + treePts.length);
      t2.set(trees);
      t2.set(treePts, trees.length);
      trees = t2;
    }
  }
  return {
    k: K,
    edges: Float32Array.from(edges),
    n: { buildings: buildings.length, kept, gone, cells: seeds.length, mine },
    mounds: plan.mounds,
    stains: plan.stains,
    plantClouds: clouds,
    vegTree: trees,
    traces: Float32Array.from(traces),
    surface: Float32Array.from(surface),
    surfacePart: Uint32Array.from(surfacePart),
    partSteel: Uint8Array.from(partSteel),
    ms: Math.round((performance.now() - t0) * 10) / 10,
  };
}

/**
 * WHERE THE FUTURE'S WATER RUNS NEAR A PLACE (the encounter's sound — FutureEncounter.tsx): the wall's courses run along
 * the borders between the villages alive at a time (water.ts bordersAt, villageBorders.ts); the phone has no courses,
 * but the villages follow from the world's epoch and the herds' setup (lifecycle.ts villageSites). The distance (world)
 * from (x, z) to the nearest border alive at block time `s`; Infinity when there are no villages or only one.
 */
export function waterDistance(epochMs: number, herd: HerdConfig | null, s: number, x: number, z: number): number {
  if (!herd || !herd.villages) return Infinity;
  const sites = villageSites(epochMs, herd, s + 1);
  const alive: { i: number; x: number; z: number }[] = [];
  let groundR = 1;
  sites.forEach((q, i) => {
    if (q.from <= s && s < q.to) alive.push({ i, x: q.x, z: q.z });
    groundR = Math.max(groundR, Math.hypot(q.x, q.z) + Math.max(1, herd.villages!.radius * (q.ch?.size ?? 1)) * 1.3);
  });
  if (alive.length < 2) return Infinity;
  let best = Infinity;
  for (const b of villageBorders(alive, groundR)) best = Math.min(best, nearestOnBorder(b, x, z).d);
  return best;
}

/** The PartKind list, for whoever colours the edges by kind later. */
export type { PartKind };
