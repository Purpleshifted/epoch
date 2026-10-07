/**
 * parliament/seeds.ts
 *
 * The bridge between WHAT VISITORS DID (the folded world) and WHAT GETS GENERATED (parts, later textures,
 * later plants). Pure and seeded: the same log gives the same parts in every view.
 *
 *   events ──foldWorld──▶ Snapshot.slabs ──seedsFromSnapshot──▶ Seed ──recipe[material]──▶ Box[] (parts)
 *
 * A SEED is a place in spacetime where enough visitors gathered (fold.ts decides that: ≥ minVisitors
 * distinct visitors, per-visitor capped). It carries:
 *   x, z          where (cell centre)
 *   t0 … t1       when it exists (bornS … lastS, exhibition seconds; the time axis is Y)
 *   spans         when somebody was actually around inside t0 … t1; the EMPTY TIME between spans stays empty
 *   mass          how much was put in (≥ 1: 1 + extra per visitor beyond the threshold)
 *   id            hash of (cell, birth): the seed number for every random choice below
 *   material      what it is made of; chosen by the ROLE that produced it
 *
 * A RECIPE turns a seed into PARTS — a small grammar, not a pile of equal boxes:
 *   plinth     the foundation slab laid at the seed's birth
 *   basement   a block hanging under the plinth, dug into earlier time
 *   pile       thin piles hanging under the plinth (drawn lengths: nothing below — ground or older structure — is
 *              treated as a support)
 *   mass       the bulk, one or more per slot. Sizes are TRUNCATED PARETO: few huge, many small (scale hierarchy);
 *              some are long bars. Each hangs from its slot's ceiling down into its run (never below the run start).
 *              A big mass is not one box but a BUNDLE OF SLATS inside its bounds: hanging vertical sticks of ragged
 *              length, or stacked horizontal rows with stepped ends
 *   drip       thin sticks hanging under slabs and horizontal-slat masses, never below the run start
 *   slab       thin wide floor plates, cantilevered past the masses: at the start of every run of presence and
 *              every `slab.every` slots inside it — time reads as strata
 *   STEEL (never in empty time):
 *   column     thin vertical members under each slab inside a run, down to the previous slab of that run
 *   beam       long horizontal members, now and then, on the grid or at any angle, slightly askew
 *   brace      diagonal members, leaning 20–65° from the vertical, kept inside their run
 * Adding another role later = one entry in MATERIAL_OF_ROLE and one recipe (or only new numbers for an existing one).
 *
 * Parts live in a 3D world: x, z = the ground, y = TIME (y = t / secPerUnit · unit). Only the time slots in which
 * somebody was around get parts: empty time is left empty, for natural matter (only a foundation reaches below its
 * own birth).
 * Every part depends only on its own slot and on what lies BEFORE it in time, so what has been built never moves
 * as the seed keeps growing. Parts never wear away here: wear belongs to the Top (future) view (fold with
 * `withoutWear` for this one).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { hash2 } from "./nature";
import type { RoleId, Slab, Snapshot } from "./types";

export type MaterialId = "concrete";

export const MATERIAL_OF_ROLE: Partial<Record<RoleId, MaterialId>> = {
  worker: "concrete",
};

export interface Seed {
  /** Integer seed number. */
  id: number;
  material: MaterialId;
  role: RoleId;
  x: number;
  z: number;
  /** Exhibition seconds. */
  t0: number;
  t1: number;
  /** [from, to] exhibition seconds in which somebody was around; absent = one span t0 … t1. */
  spans?: [number, number][];
  mass: number;
}

export type PartKind = "mass" | "slab" | "drip" | "column" | "beam" | "brace" | "plinth" | "basement" | "pile";
export const PART_KINDS: readonly PartKind[] = ["mass", "slab", "drip", "column", "beam", "brace", "plinth", "basement", "pile"];
export const STEEL: ReadonlySet<PartKind> = new Set(["column", "beam", "brace"]);
/** Foundation parts: the only ones that reach below the seed's birth. */
export const FOUNDATION: ReadonlySet<PartKind> = new Set(["basement", "pile"]);

/**
 * One part: a box (a pile is drawn as a cylinder in the same bounds). Most are axis-aligned; a steel member may be
 * rotated: first `tilt` about Z (0 = upright, π/2 = lying along x), then `yaw` about Y (three.js Euler order "YZX").
 * Its length is then sy.
 */
export interface Box {
  kind: PartKind;
  seed: number;
  material: MaterialId;
  /** Centre; y is the time axis. */
  x: number;
  y: number;
  z: number;
  /** Full sizes. */
  sx: number;
  sy: number;
  sz: number;
  /** 0..1 stable random value for tone / texture choice. */
  tone: number;
  /** 0 at the first storey of its seed, 1 at the last. */
  along: number;
  /** The time slot the part was built in (the foundation: the birth slot). */
  slot: number;
  yaw?: number;
  tilt?: number;
  /** Drips only: the floor of their run (wear may lengthen them, never below this). */
  floorY?: number;
}

/** Half of a part's vertical extent (accounts for tilt). */
export function halfHeight(b: Box): number {
  if (!b.tilt) return b.sy / 2;
  return (Math.abs(Math.cos(b.tilt)) * b.sy + Math.abs(Math.sin(b.tilt)) * Math.max(b.sx, b.sz)) / 2;
}

export interface BoxConfig {
  /** Exhibition seconds per time slot (one storey of the column). */
  secPerUnit: number;
  /** World height of one slot. */
  unit: number;
  /** Multiplies every footprint. */
  width: number;
  /** Multiplies how many masses each slot gets. */
  density: number;
  /** Safety cap: only the latest this-many slots of a seed are generated. */
  maxSlots: number;
  /** Replaces the material's recipe (the 3D view's Leva knobs); absent = RECIPES[seed.material]. */
  recipe?: Recipe;
  /**
   * TIME ERROR: every part (but the foundation) is moved along the time axis by up to ± this many slots (fixed per
   * part) — the layers are not cut to the second. It never leaves its run (not below the run's start, not above its
   * own slot's top: so nothing moves when the run grows, and nothing enters empty time).
   */
  timeJitter?: number;
}

export const DEFAULT_BOXES: BoxConfig = { secPerUnit: 30, unit: 1, width: 1, density: 1, maxSlots: 200, timeJitter: 0.35 };

/**
 * Per-material numbers. Footprints and widths are in cells (CELL_SIZE); heights, thicknesses, depths and spans
 * are in slots (× unit). [a, b] ranges are drawn log-uniformly unless said otherwise.
 */
export interface Recipe {
  mass: {
    /** Footprint (√(sx·sz)) range, drawn from a Pareto truncated to [min, max]. */
    footprint: [number, number];
    /** Pareto exponent: smaller = more huge masses. */
    alpha: number;
    height: [number, number];
    /** Plan proportions sx:sz up to aspect:1 either way. */
    aspect: number;
    /** Chance that a mass is a long bar, `bar` times longer along one side. */
    barChance: number;
    bar: number;
    /** How far a mass may sit from the seed centre. */
    scatter: number;
    /** Extra masses per slot per unit of (mass - 1). */
    perMass: number;
    maxPerSlot: number;
    /** Footprint grows by this fraction per unit of (mass - 1). */
    growth: number;
  };
  slab: { every: number; thick: [number, number]; footprint: [number, number]; cantilever: number };
  column: { width: [number, number]; count: [number, number] };
  /** Horizontal steel: `chance` per slot; length in cells; `onGrid` = share aligned to x or z; `skew` = most tilt off level (rad). */
  beam: { chance: number; length: [number, number]; width: [number, number]; onGrid: number; skew: number; scatter: number };
  /** Diagonal steel: `chance` per slot; length in slots; tilt from the vertical (rad, uniform). */
  brace: { chance: number; length: [number, number]; width: [number, number]; tilt: [number, number]; scatter: number };
  /**
   * Masses with √(sx·sz) ≥ minFootprint (cells) become slat bundles. Slat width in cells, widened so a mass never
   * has more than maxPerMass slats; each slat is kept with `density`. `vertical` = share of hanging-stick bundles
   * (the rest are horizontal rows); a hanging stick is at least `shortest` of the mass height.
   */
  slat: { enabled: boolean; minFootprint: number; width: [number, number]; density: number; maxPerMass: number; vertical: number; shortest: number };
  /** Under slabs and horizontal-slat masses: perArea drips per cell² (at most max); length in slots, Pareto(alpha). */
  drip: { perArea: number; max: number; length: [number, number]; alpha: number; width: [number, number] };
  plinth: { footprint: [number, number]; thick: [number, number] };
  /** footprint: fraction of the plinth's. */
  basement: { footprint: [number, number]; depth: [number, number] };
  /** Piles hang under the plinth: count (rounded), width in cells, depth in slots. */
  pile: { count: [number, number]; width: [number, number]; depth: [number, number] };
}

export const RECIPES: Record<MaterialId, Recipe> = {
  concrete: {
    mass: { footprint: [0.3, 4], alpha: 1.15, height: [0.25, 2.6], aspect: 2.2, barChance: 0.15, bar: 3, scatter: 0.7, perMass: 0.6, maxPerSlot: 6, growth: 0.12 },
    slab: { every: 4, thick: [0.07, 0.14], footprint: [1.4, 4.2], cantilever: 1.1 },
    column: { width: [0.07, 0.13], count: [2, 4] },
    beam: { chance: 0.4, length: [1.2, 6], width: [0.05, 0.11], onGrid: 0.5, skew: 0.12, scatter: 1.2 },
    brace: { chance: 0.3, length: [0.8, 3.2], width: [0.05, 0.1], tilt: [0.35, 1.13], scatter: 1.1 },
    slat: { enabled: true, minFootprint: 0.8, width: [0.12, 0.3], density: 0.8, maxPerMass: 48, vertical: 0.45, shortest: 0.35 },
    drip: { perArea: 1.2, max: 14, length: [0.15, 2.5], alpha: 1.3, width: [0.04, 0.1] },
    plinth: { footprint: [1.8, 3.2], thick: [0.22, 0.4] },
    basement: { footprint: [0.45, 0.85], depth: [0.8, 2.6] },
    pile: { count: [2, 5], width: [0.06, 0.12], depth: [0.4, 2.5] },
  },
};

function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 31-bit seed number of a seed born at (cell, t0): chained, so neighbouring cells never collide by construction of the XOR. */
export function seedId(cx: number, cz: number, t0: number): number {
  let h = mix((cx | 0) + 0x9e3779b9);
  h = mix((h + (cz | 0)) | 0);
  h = mix((h + Math.floor(t0)) | 0);
  return h >>> 1;
}

/** Each part family has its own salt, so adding draws to one never shifts another. */
const SALT = { mass: 77, slab: 78, found: 79, steel: 80, slat: 81, drip: 82 } as const;
/** Sub-stream index of a slot's slab (masses use 0 … maxPerSlot-1). */
const SLAB_SUB = 15;

function stream(seed: number, slot: number, salt: number): () => number {
  let i = 0;
  const base = Math.floor(hash2(seed | 0, slot | 0, salt) * 1e9);
  return () => hash2(base, i++, 131);
}

const logIn = (u: number, [a, b]: [number, number]) => a * Math.pow(b / a, u);
/** Pareto(alpha) truncated to [a, b], by inverse CDF. */
const paretoIn = (u: number, [a, b]: [number, number], alpha: number) => a / Math.pow(1 - u * (1 - Math.pow(a / b, alpha)), 1 / alpha);
const intIn = (u: number, [a, b]: [number, number]) => a + Math.min(b - a, Math.floor(u * (b - a + 1)));

/** Every slab is a seed of its role's material; slabs only exist for roles that have one (worker → concrete). */
export function seedsFromSnapshot(snap: Pick<Snapshot, "slabs">, role: RoleId = "worker"): Seed[] {
  const material = MATERIAL_OF_ROLE[role];
  if (!material) return [];
  return snap.slabs.map((s: Slab) => {
    const [cx, cz] = s.key.split(",").map(Number);
    const seed: Seed = { id: seedId(cx, cz, s.bornS), material, role, x: s.x, z: s.z, t0: s.bornS, t1: s.lastS, mass: s.raw };
    if (s.spans) seed.spans = s.spans;
    return seed;
  });
}

/**
 * The time slots of a seed that get parts: every slot that one of its spans touches (ascending), at most the latest
 * `maxSlots`. A slot in which nobody was around is EMPTY TIME and gets nothing.
 */
export function occupiedSlots(seed: Seed, cfg: BoxConfig = DEFAULT_BOXES): number[] {
  const spans = seed.spans && seed.spans.length ? seed.spans : [[seed.t0, seed.t1] as [number, number]];
  const slots: number[] = [];
  let prev = -Infinity;
  for (const [a, b] of spans) {
    const lo = Math.max(Math.floor(Math.max(a, seed.t0) / cfg.secPerUnit), prev + 1);
    const hi = Math.floor(Math.min(b, seed.t1) / cfg.secPerUnit);
    for (let k = lo; k <= hi; k++) slots.push(k);
    if (hi >= lo) prev = hi;
  }
  return slots.length > cfg.maxSlots ? slots.slice(slots.length - cfg.maxSlots) : slots;
}

/** Consecutive occupied slots grouped into runs of presence: [first, last] slot. */
function runsOf(slots: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const k of slots) {
    const r = runs[runs.length - 1];
    if (r && k === r[1] + 1) r[1] = k;
    else runs.push([k, k]);
  }
  return runs;
}

/**
 * The parts of one seed. Each slot draws from its own random streams (one per part family), so the column only grows
 * upwards. Nothing reaches below y = 0 (before the epoch).
 */
export function boxesOfSeed(seed: Seed, cfg: BoxConfig = DEFAULT_BOXES): Box[] {
  const rc = cfg.recipe ?? RECIPES[seed.material];
  const u = cfg.unit;
  const W = CELL_SIZE * cfg.width;
  const birth = Math.floor(seed.t0 / cfg.secPerUnit);
  const first = birth;
  const last = Math.floor(seed.t1 / cfg.secPerUnit);
  const span = Math.max(1, last - first);
  const grow = 1 + rc.mass.growth * Math.max(0, seed.mass - 1);
  const out: Box[] = [];
  const push = (kind: PartKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, tone: number, k: number, yaw?: number, tilt?: number) => {
    const b: Box = { kind, seed: seed.id, material: seed.material, x, y, z, sx, sy, sz, tone, along: Math.max(0, (k - first) / span), slot: k };
    if (tilt) {
      b.yaw = yaw ?? 0;
      b.tilt = tilt;
    }
    out.push(b);
  };

  /** Thin sticks hanging under a part whose underside is at yBottom, never below `floor` (the run start). */
  const drips = (x: number, z: number, sx: number, sz: number, yBottom: number, floor: number, k: number, sub: number, tone: number) => {
    const room = yBottom - floor;
    if (room < 0.03 * u) return;
    const r = stream(seed.id, k * 16 + sub, SALT.drip);
    const n = Math.min(rc.drip.max, Math.round((rc.drip.perArea * sx * sz) / (W * W)));
    for (let i = 0; i < n; i++) {
      const [d0, d1, d2, d3] = [r(), r(), r(), r()];
      const len = Math.min(paretoIn(d2, rc.drip.length, rc.drip.alpha) * u, room);
      const w = logIn(d3, rc.drip.width) * W;
      if (len > 0.03 * u) {
        push("drip", x + (d0 - 0.5) * 0.95 * sx, yBottom - len / 2, z + (d1 - 0.5) * 0.95 * sz, w, len, w, tone, k);
        out[out.length - 1].floorY = floor;
      }
    }
  };

  /**
   * One mass: a single box, or (big enough) a bundle of slats inside the same bounds. Returns true for a
   * horizontal bundle (those get drips underneath).
   */
  const massOrSlats = (x: number, yTop: number, z: number, sx: number, h: number, sz: number, tone: number, k: number, sub: number): boolean => {
    const sl = rc.slat;
    if (!sl.enabled || Math.sqrt(sx * sz) < sl.minFootprint * W) {
      push("mass", x, yTop - h / 2, z, sx, h, sz, tone, k);
      return false;
    }
    const r = stream(seed.id, k * 16 + sub, SALT.slat);
    const orient = r();
    const max = Math.max(1, Math.round(sl.maxPerMass));
    const c = Math.max(logIn(r(), sl.width) * W, Math.sqrt((sx * sz) / max));
    const before = out.length;
    if (orient < sl.vertical) {
      // hanging sticks on a grid over the footprint, ragged bottoms
      let nx = Math.max(1, Math.round(sx / c));
      let nz = Math.max(1, Math.round(sz / c));
      while (nx * nz > max) {
        if (nx >= nz) nx--;
        else nz--;
      }
      const cx = sx / nx;
      const cz = sz / nz;
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const [keep, l, j] = [r(), r(), r()];
          if (keep >= sl.density) continue;
          const jit = j * Math.min(0.06 * u, h * 0.1);
          const len = (h - jit) * (sl.shortest + (1 - sl.shortest) * Math.pow(l, 0.4));
          push("mass", x - sx / 2 + (a + 0.5) * cx, yTop - jit - len / 2, z - sz / 2 + (b + 0.5) * cz, cx * 0.92, len, cz * 0.92, tone, k);
        }
      }
      if (out.length === before) push("mass", x, yTop - h / 2, z, cx * 0.92, h, cz * 0.92, tone, k);
      return false;
    }
    // stacked horizontal rows along the longer-drawn axis A, stepped ends
    const alongX = orient < sl.vertical + (1 - sl.vertical) / 2;
    const sA = alongX ? sx : sz;
    const sB = alongX ? sz : sx;
    let ny = Math.max(1, Math.round(h / c));
    let nb = Math.max(1, Math.round(sB / c));
    while (ny * nb > max) {
      if (ny >= nb) ny--;
      else nb--;
    }
    const ty = h / ny;
    const wb = sB / nb;
    for (let j = 0; j < ny; j++) {
      for (let m = 0; m < nb; m++) {
        const [keep, lf, off] = [r(), r(), r()];
        if (keep >= sl.density) continue;
        const frac = 0.55 + 0.45 * lf;
        const a = (off - 0.5) * (1 - frac) * sA;
        const b = -sB / 2 + (m + 0.5) * wb;
        const y = yTop - (j + 0.5) * ty;
        if (alongX) push("mass", x + a, y, z + b, frac * sA, ty * 0.9, wb * 0.92, tone, k);
        else push("mass", x + b, y, z + a, wb * 0.92, ty * 0.9, frac * sA, tone, k);
      }
    }
    if (out.length === before) push("mass", x, yTop - h / 2, z, sx, ty * 0.9, sz, tone, k);
    return true;
  };

  const slots = occupiedSlots(seed, cfg);
  const runs = runsOf(slots);

  // ── foundation: plinth at birth, basement and piles below it ──
  if (slots[0] === birth) {
    const r = stream(seed.id, birth, SALT.found);
    const [a0, a1, a2, a3, a4, a5, a6, a7] = [r(), r(), r(), r(), r(), r(), r(), r()];
    const pileCount: [number, number] = [Math.round(rc.pile.count[0]), Math.round(rc.pile.count[1])];
    const piles: number[][] = [];
    for (let i = 0; i < pileCount[1]; i++) piles.push([r(), r(), r(), r()]);
    const px = logIn(a0, rc.plinth.footprint) * W * grow;
    const pz = logIn(a1, rc.plinth.footprint) * W * grow;
    const th = logIn(a2, rc.plinth.thick) * u;
    const y0 = birth * u;
    push("plinth", seed.x, y0 + th / 2, seed.z, px, th, pz, a7, birth);

    const bDepth = Math.min(logIn(a4, rc.basement.depth) * u, y0);
    if (bDepth > 0.1 * u) {
      push("basement", seed.x, y0 - bDepth / 2, seed.z, px * logIn(a3, rc.basement.footprint), bDepth, pz * logIn(a5, rc.basement.footprint), a6, birth);
    }

    const n = intIn(a6, pileCount);
    for (let i = 0; i < n; i++) {
      const [p0, p1, p2, p3] = piles[i];
      const x = seed.x + (p0 - 0.5) * 0.88 * px;
      const z = seed.z + (p1 - 0.5) * 0.88 * pz;
      const d = Math.min(logIn(p2, rc.pile.depth) * u, y0);
      const w = logIn(p3, rc.pile.width) * W;
      if (d > 0.05 * u) push("pile", x, y0 - d / 2, z, w, d, w, p3, birth);
    }
  }

  for (const [runStart, runEnd] of runs) {
    for (let k = runStart; k <= runEnd; k++) {
      // ── masses: Pareto-sized, hanging from the slot's ceiling, never below the run start ──
      const r = stream(seed.id, k, SALT.mass);
      // all draws are made for the maximum, so the number of masses never shifts the others' values
      const extraDraw = r();
      const per: number[][] = [];
      for (let i = 0; i < rc.mass.maxPerSlot; i++) per.push([r(), r(), r(), r(), r(), r(), r(), r()]);
      const want = 1 + (seed.mass - 1) * rc.mass.perMass * cfg.density + extraDraw * 0.8 * cfg.density;
      const n = Math.max(1, Math.min(rc.mass.maxPerSlot, Math.floor(want)));
      const top = (k + 1) * u;
      const floor = runStart * u;
      for (let i = 0; i < n; i++) {
        const [u0, u1, u2, u3, u4, u5, u6] = per[i];
        const f = paretoIn(u0, rc.mass.footprint, rc.mass.alpha) * W * grow;
        const asp = Math.sqrt(Math.pow(rc.mass.aspect, 2 * u1 - 1));
        let sx = f * asp;
        let sz = f / asp;
        if (u6 < rc.mass.barChance) {
          if (u1 < 0.5) sx *= rc.mass.bar;
          else sz *= rc.mass.bar;
        }
        const h = Math.min(logIn(u2, rc.mass.height) * u, top - floor);
        const jx = (u3 - 0.5) * 2 * rc.mass.scatter * CELL_SIZE;
        const jz = (u4 - 0.5) * 2 * rc.mass.scatter * CELL_SIZE;
        if (massOrSlats(seed.x + jx, top, seed.z + jz, sx, h, sz, u5, k, i)) drips(seed.x + jx, seed.z + jz, sx, sz, top - h, floor, k, i, u5);
      }

      // ── steel beam and brace: now and then, inside the run (between its start and this slot's ceiling) ──
      const st = stream(seed.id, k, SALT.steel);
      const bm = [st(), st(), st(), st(), st(), st(), st(), st(), st()];
      const br = [st(), st(), st(), st(), st(), st(), st(), st()];
      if (bm[0] < rc.beam.chance) {
        const len = logIn(bm[1], rc.beam.length) * W;
        const w = logIn(bm[2], rc.beam.width) * W;
        const yaw = bm[3] < rc.beam.onGrid ? (bm[4] < 0.5 ? 0 : Math.PI / 2) : bm[4] * Math.PI;
        let tilt = Math.PI / 2 + (bm[5] - 0.5) * 2 * rc.beam.skew;
        // too askew for the room it has: lay it level
        if (Math.abs(Math.cos(tilt)) * len + w > top - floor) tilt = Math.PI / 2;
        const hh = (Math.abs(Math.cos(tilt)) * len + w) / 2;
        const y = Math.min(top - hh, Math.max(floor + hh, k * u + (0.15 + 0.8 * bm[6]) * u));
        const x = seed.x + (bm[7] - 0.5) * 2 * rc.beam.scatter * CELL_SIZE;
        const z = seed.z + (bm[8] - 0.5) * 2 * rc.beam.scatter * CELL_SIZE;
        push("beam", x, y, z, w, len, w, bm[6], k, yaw, tilt);
      }
      if (br[0] < rc.brace.chance) {
        const tilt = rc.brace.tilt[0] + br[1] * (rc.brace.tilt[1] - rc.brace.tilt[0]);
        const w = logIn(br[2], rc.brace.width) * W;
        // shortened if its vertical extent would not fit between the run start and this slot's ceiling
        const len = Math.min(logIn(br[3], rc.brace.length) * u, (top - floor - Math.sin(tilt) * w) / Math.cos(tilt));
        const hh = (Math.cos(tilt) * len + Math.sin(tilt) * w) / 2;
        if (len > 0.1 * u) {
          const y = Math.max(floor + hh, top - hh - br[4] * 0.3 * u);
          const x = seed.x + (br[5] - 0.5) * 2 * rc.brace.scatter * CELL_SIZE;
          const z = seed.z + (br[6] - 0.5) * 2 * rc.brace.scatter * CELL_SIZE;
          push("brace", x, y, z, w, len, w, br[4], k, br[7] * Math.PI * 2, tilt);
        }
      }

      // ── slab (+ columns under it): at the start of every run but the birth one, and every `every` slots ──
      if (k === birth || (k - runStart) % rc.slab.every !== 0) continue;
      const s = stream(seed.id, k, SALT.slab);
      const [s0, s1, s2, s3, s4, s5, s6] = [s(), s(), s(), s(), s(), s(), s()];
      const colCount: [number, number] = [Math.round(rc.column.count[0]), Math.round(rc.column.count[1])];
      const cols: number[][] = [];
      for (let i = 0; i < colCount[1]; i++) cols.push([s(), s()]);
      const th = logIn(s0, rc.slab.thick) * u;
      const sx = logIn(s1, rc.slab.footprint) * W;
      const sz = logIn(s2, rc.slab.footprint) * W;
      const cx = seed.x + (s3 - 0.5) * 2 * rc.slab.cantilever * CELL_SIZE;
      const cz = seed.z + (s4 - 0.5) * 2 * rc.slab.cantilever * CELL_SIZE;
      const y0 = k * u;
      push("slab", cx, y0 + th / 2, cz, sx, th, sz, s5, k);
      drips(cx, cz, sx, sz, y0, runStart * u, k, SLAB_SUB, s5);

      // down to the previous slab of the run; a slab at the start of a run has none (no steel in empty time)
      if (k === runStart) continue;
      const len = y0 - Math.max(runStart, k - rc.slab.every) * u;
      if (!(len > 0.05 * u)) continue;
      const nc = intIn(s6, colCount);
      for (let i = 0; i < nc; i++) {
        const [c0, c1] = cols[i];
        const corner = (i + Math.floor(s6 * 4)) % 4;
        const inset = 0.08 + 0.17 * c0;
        const x = cx + (corner & 1 ? 1 : -1) * (0.5 - inset) * sx;
        const z = cz + (corner & 2 ? 1 : -1) * (0.5 - inset) * sz;
        const w = logIn(c1, rc.column.width) * W;
        push("column", x, y0 - len / 2, z, w, len, w, c1, k);
      }
    }
  }

  // ── time error: each part moves along the time axis by a fixed random amount, between its run's start and its own
  //    slot's top (bounds that never change as the seed grows) ──
  const J = cfg.timeJitter ?? 0;
  if (J > 0) {
    const runOf = new Map<number, [number, number]>();
    for (const r of runs) for (let k = r[0]; k <= r[1]; k++) runOf.set(k, r);
    for (const b of out) {
      if (FOUNDATION.has(b.kind) || b.kind === "plinth") continue;
      const run = runOf.get(b.slot);
      if (!run) continue;
      const hh = halfHeight(b);
      const lo = run[0] * u + hh, hi = (b.slot + 1) * u - hh;
      if (hi <= lo) continue;
      const dy = (hash2(Math.round(b.x * 1009) ^ b.seed, Math.round(b.z * 1013), b.slot * 17 + PART_KINDS.indexOf(b.kind) + 3) - 0.5) * 2 * J * u;
      b.y = Math.min(hi, Math.max(lo, b.y + dy));
    }
  }
  return out;
}

/** Parts of a seed kept between calls of generateBoxes (by seed id), valid while their key is unchanged. */
export type PartsCache = Map<number, { key: string; parts: Box[] }>;

/**
 * All parts, seed by seed (in order of birth). With a `cache`, a seed whose slots, mass and config are unchanged
 * reuses its parts (slat bundles make the part count large, and the view regenerates twice a second).
 */
export function generateBoxes(seeds: readonly Seed[], cfg: BoxConfig = DEFAULT_BOXES, cache?: PartsCache): Box[] {
  const order = [...seeds].sort((a, b) => a.t0 - b.t0 || a.id - b.id);
  const cfgKey = cache ? JSON.stringify(cfg) : "";
  const live = new Set<number>();
  const out: Box[] = [];
  for (const s of order) {
    let parts: Box[];
    if (cache) {
      const slots = occupiedSlots(s, cfg);
      const key = `${s.t0}:${slots[0]}:${slots[slots.length - 1]}:${slots.length}:${s.spans?.length ?? 0}:${s.mass}:${cfgKey}`;
      const hit = cache.get(s.id);
      if (hit && hit.key === key) parts = hit.parts;
      else {
        parts = boxesOfSeed(s, cfg);
        cache.set(s.id, { key, parts });
      }
      live.add(s.id);
    } else parts = boxesOfSeed(s, cfg);
    for (const b of parts) out.push(b);
  }
  if (cache) for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  return out;
}

/** The fold's wear times (model years), as used by wearParts, and how the 3D view applies them. */
export interface WearConfig {
  tauSlabYears: number;
  tauFootprintYears: number;
  /**
   * STRATA: with secPerUnit given, every part ages from the end of the slot it was built in (deposition), so lower
   * layers are older than the ones above — a seed still in use already weathers at its bottom. Without it, a whole
   * seed ages from its last presence (the fold's slab age).
   */
  secPerUnit?: number;
  /** Multiplies every age (the 3D view's weathering speed; 1 = the Top view's). */
  timeScale?: number;
  /** Life of steel relative to tauSlabYears (default 0.3: bare steel rusts first). */
  steelLife?: number;
  /** Life of concrete slats and masses relative to tauSlabYears, × their thinness factor (default 1). */
  concreteLife?: number;
  /** AGE ERROR: every part's age is × (1 ± this) (fixed per part) — the same layer does not weather in lockstep. */
  ageJitter?: number;
  /**
   * BURIAL (strata only): a part is covered once its seed has built `coverSlots` more slots above it; from then on it
   * ages `buriedSlow` times slower (out of air and light). 0 / absent = never covered.
   */
  coverSlots?: number;
  buriedSlow?: number;
  /**
   * VEGETATION: while exposed, a part ages × (1 + natureAccel · veg(part)) — acids from decay, kept-in moisture, roots.
   * `veg` gives the vegetation density (0..1) around the part.
   */
  natureAccel?: number;
  veg?: (b: Box) => number;
}

/** The fold's footprint threshold. */
const MIN_FOOT = 0.03;

export function partHash(b: Box): number {
  return hash2(Math.round(b.x * 997) ^ b.seed, Math.round(b.z * 991) ^ Math.round(b.y * 983), PART_KINDS.indexOf(b.kind) + 17);
}

/** How much longer than tau a part lasts (thin and exposed < 1). */
export function wearFactor(b: Box, cfg: Pick<WearConfig, "steelLife" | "concreteLife"> = {}): number {
  if (STEEL.has(b.kind)) return cfg.steelLife ?? 0.3;
  const life = cfg.concreteLife ?? 1;
  if (b.kind === "drip") return 0.3 * life;
  if (b.kind === "slab") return 1.2 * life;
  const thin = Math.min(b.sx, b.sy, b.sz) / CELL_SIZE;
  return (0.3 + 0.9 * Math.min(1, thin)) * life;
}

export function seedAgeYears(seed: Seed, tNow: number): number {
  return Math.max(0, geoYears(Math.max(tNow, seed.t1)) - geoYears(seed.t1));
}

/**
 * The age of a part in model years at tNow (× timeScale): since the end of its slot (STRATA, with secPerUnit), or
 * since its seed's last presence.
 */
export function partAgeYears(b: Box, seedAge: ReadonlyMap<number, number>, tNow: number, cfg: Pick<WearConfig, "secPerUnit" | "timeScale">): number {
  const scale = cfg.timeScale ?? 1;
  if (cfg.secPerUnit && cfg.secPerUnit > 0) {
    const laid = Math.min(tNow, (b.slot + 1) * cfg.secPerUnit);
    return Math.max(0, geoYears(tNow) - geoYears(laid)) * scale;
  }
  return (seedAge.get(b.seed) ?? 0) * scale;
}

/**
 * WEAR of the parts at the view's present `tNow` — the fold's slab wear, carried onto the procedural parts.
 *
 * Ages are in MODEL years (partAgeYears): by default a seed's age since its last presence (the fold's `age`, same
 * taus); with cfg.secPerUnit, each part's age since its own slot (STRATA: lower = older). Like real weathering:
 *   thin and exposed goes first   survival P = e^(−A / (tau · f)); f = steelLife for steel, for slats and masses
 *                                 0.3 … 1.2 by their thinnest side (× concreteLife), 1.2 for slabs; foundations use
 *                                 tauFootprintYears
 *   what is held goes with it     columns fall with the slab of their slot; beams and braces go once fewer than
 *                                 30 % of the seed's masses stand
 *   leaching                      drips grow (calcite under concrete): × (1 + A / tauSlabYears), never below their run
 *   outline only                  once the footprint is worn (foot < MIN_FOOT, as in the fold) only plinth and
 *                                 basement remain
 * Removal is a fixed per-part hash against P, so as A grows the same parts go first (nothing flickers). Returns a new
 * array; the input (possibly cached) is not changed.
 */
/**
 * The weathering of single parts at tNow: age (model years, with strata / burial / vegetation as configured) and
 * survival probability P = e^(−A / (tau · f)). wearParts decides removal with it; decay = 1 − P drives what grows on
 * and what becomes of a part (fuse.ts).
 */
export function wearModel(seeds: readonly Seed[], tNow: number, cfg: WearConfig): { age: (b: Box) => number; survival: (b: Box) => number } {
  const ages = new Map<number, number>();
  const topSlot = new Map<number, number>();
  for (const s of seeds) {
    ages.set(s.id, seedAgeYears(s, tNow));
    if (cfg.secPerUnit) topSlot.set(s.id, Math.floor(s.t1 / cfg.secPerUnit));
  }
  const spu = cfg.secPerUnit ?? 0;
  const cover = cfg.coverSlots ?? 0;
  const slow = Math.max(1, cfg.buriedSlow ?? 1);
  const accel = cfg.natureAccel ?? 0;
  const yNow = geoYears(tNow);
  const jit = cfg.ageJitter ?? 0;
  const spread = (b: Box) => (jit > 0 ? Math.max(0, 1 + jit * (hash2(Math.round(b.x * 733) ^ b.seed, Math.round(b.y * 739) ^ Math.round(b.z * 743), 29) - 0.5) * 2) : 1);
  const age = (b: Box) => spread(b) * baseAge(b);
  const baseAge = (b: Box) => {
    if (!(spu > 0) || (cover <= 0 && !(accel > 0 && cfg.veg))) return partAgeYears(b, ages, tNow, cfg);
    // strata with burial / vegetation: exposed from the end of its slot until covered, then slowed
    const laid = Math.min(tNow, (b.slot + 1) * spu);
    const top = topSlot.get(b.seed) ?? b.slot;
    const tCover = cover > 0 && top >= b.slot + cover ? Math.min(tNow, (b.slot + cover + 1) * spu) : tNow;
    const exposed = Math.max(0, geoYears(tCover) - geoYears(laid)) * (1 + (accel > 0 && cfg.veg ? accel * cfg.veg(b) : 0));
    const buried = Math.max(0, yNow - geoYears(tCover)) / slow;
    return (exposed + buried) * (cfg.timeScale ?? 1);
  };
  const survival = (b: Box) => {
    const A = age(b);
    if (A <= 0) return 1;
    const tau = FOUNDATION.has(b.kind) || b.kind === "plinth" ? cfg.tauFootprintYears : cfg.tauSlabYears * wearFactor(b, cfg);
    return Math.exp(-A / tau);
  };
  return { age, survival };
}

export function wearParts(parts: readonly Box[], seeds: readonly Seed[], tNow: number, cfg: WearConfig): Box[] {
  const wm = wearModel(seeds, tNow, cfg);
  const ageOf = wm.age;
  const survives = (b: Box, A: number) => {
    const tau = FOUNDATION.has(b.kind) || b.kind === "plinth" ? cfg.tauFootprintYears : cfg.tauSlabYears * wearFactor(b, cfg);
    return partHash(b) < Math.exp(-A / tau);
  };

  // pass 1: what stands on its own; slabs that stand (by seed and slot); share of standing masses per seed
  const slabUp = new Set<string>();
  const massAll = new Map<number, number>();
  const massUp = new Map<number, number>();
  for (const b of parts) {
    const A = ageOf(b);
    if (b.kind === "slab" && survives(b, A)) slabUp.add(`${b.seed}:${b.along}`);
    if (b.kind === "mass") {
      massAll.set(b.seed, (massAll.get(b.seed) ?? 0) + 1);
      if (survives(b, A)) massUp.set(b.seed, (massUp.get(b.seed) ?? 0) + 1);
    }
  }

  const out: Box[] = [];
  for (const b of parts) {
    const A = ageOf(b);
    if (A <= 0) {
      out.push(b);
      continue;
    }
    if (Math.exp(-A / cfg.tauFootprintYears) < MIN_FOOT) {
      if (b.kind === "plinth" || b.kind === "basement") out.push(b);
      continue;
    }
    if (!survives(b, A)) continue;
    if (b.kind === "column" && !slabUp.has(`${b.seed}:${b.along}`)) continue;
    if ((b.kind === "beam" || b.kind === "brace") && (massUp.get(b.seed) ?? 0) < 0.3 * (massAll.get(b.seed) ?? 0)) continue;
    if (b.kind === "drip") {
      const top = b.y + b.sy / 2;
      const len = Math.min(b.sy * (1 + A / cfg.tauSlabYears), top - (b.floorY ?? top - b.sy));
      out.push({ ...b, y: top - len / 2, sy: len });
      continue;
    }
    out.push(b);
  }
  return out;
}
