/**
 * parliament/seeds.ts
 *
 * The bridge between WHAT VISITORS DID (the folded world) and WHAT GETS GENERATED (boxes, later textures,
 * later plants). Pure and seeded: the same log gives the same boxes in every view.
 *
 *   events ──foldWorld──▶ Snapshot.slabs ──seedsFromSnapshot──▶ Seed ──recipe[material]──▶ Box[]
 *
 * A SEED is a place in spacetime where enough visitors gathered (fold.ts decides that: ≥ minVisitors
 * distinct visitors, per-visitor capped). It carries:
 *   x, z          where (cell centre)
 *   t0 … t1       when it exists (bornS … lastS, exhibition seconds; the time axis is Y)
 *   mass          how much was put in (≥ 1: 1 + extra per visitor beyond the threshold)
 *   id            hash of (cell, birth): the seed number for every random choice below
 *   material      what it is made of; chosen by the ROLE that produced it
 *
 * A RECIPE turns a seed into boxes. Adding another role later = one entry in MATERIAL_OF_ROLE and one
 * recipe (or only new numbers for an existing one); nothing else in the pipeline changes.
 *
 * Boxes live in a 3D world: x, z = the ground, y = TIME (y = t / secPerUnit · unit). A seed that existed from
 * t0 to t1 is a column of boxes of different sizes spread over that range of y. Boxes never wear away here:
 * wear belongs to the Top (future) view.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
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
  mass: number;
}

export interface Box {
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
}

export interface BoxConfig {
  /** Exhibition seconds per time slot (one storey of the column). */
  secPerUnit: number;
  /** World height of one slot. */
  unit: number;
  /** Multiplies the footprint of the boxes. */
  width: number;
  /** Multiplies how many boxes each slot gets. */
  density: number;
  /** Safety cap: only the latest this-many slots of a seed are generated. */
  maxSlots: number;
}

export const DEFAULT_BOXES: BoxConfig = { secPerUnit: 30, unit: 1, width: 1, density: 1, maxSlots: 200 };

/** Per-material numbers. Footprints are in cells (CELL_SIZE). */
export interface Recipe {
  /** Footprint of a box in cells, [min, max]. */
  footprint: [number, number];
  /** Height of a box in slots, [min, max]; may overlap the neighbouring slots. */
  height: [number, number];
  /** How far a box may sit from the seed centre, in cells. */
  scatter: number;
  /** Extra boxes per slot per unit of (mass - 1). */
  perMass: number;
  /** Most boxes in a slot. */
  maxPerSlot: number;
}

export const RECIPES: Record<MaterialId, Recipe> = {
  concrete: { footprint: [0.6, 2.0], height: [0.5, 1.6], scatter: 0.9, perMass: 0.55, maxPerSlot: 4 },
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

function stream(seed: number, slot: number): () => number {
  let i = 0;
  const base = Math.floor(hash2(seed | 0, slot | 0, 77) * 1e9);
  return () => hash2(base, i++, 131);
}

/** Every slab is a seed of its role's material; slabs only exist for roles that have one (worker → concrete). */
export function seedsFromSnapshot(snap: Pick<Snapshot, "slabs">, role: RoleId = "worker"): Seed[] {
  const material = MATERIAL_OF_ROLE[role];
  if (!material) return [];
  return snap.slabs.map((s: Slab) => {
    const [cx, cz] = s.key.split(",").map(Number);
    return { id: seedId(cx, cz, s.bornS), material, role, x: s.x, z: s.z, t0: s.bornS, t1: s.lastS, mass: s.raw };
  });
}

/** The boxes of one seed. Each time slot is generated from its own random stream, so the column only grows upwards. */
export function boxesOfSeed(seed: Seed, cfg: BoxConfig = DEFAULT_BOXES): Box[] {
  const rc = RECIPES[seed.material];
  const first = Math.floor(seed.t0 / cfg.secPerUnit);
  const last = Math.floor(seed.t1 / cfg.secPerUnit);
  const from = Math.max(first, last - cfg.maxSlots + 1);
  const out: Box[] = [];
  const span = Math.max(1, last - first);
  for (let k = from; k <= last; k++) {
    const r = stream(seed.id, k);
    // all draws are made for the maximum, so the number of boxes never shifts the others' values
    const extraDraw = r();
    const per: number[][] = [];
    for (let i = 0; i < rc.maxPerSlot; i++) per.push([r(), r(), r(), r(), r(), r()]);
    const want = 1 + (seed.mass - 1) * rc.perMass * cfg.density + extraDraw * 0.5 * cfg.density;
    const n = Math.max(1, Math.min(rc.maxPerSlot, Math.floor(want)));
    for (let i = 0; i < n; i++) {
      const [u0, u1, u2, u3, u4, u5] = per[i];
      const fx = (rc.footprint[0] + u0 * (rc.footprint[1] - rc.footprint[0])) * CELL_SIZE * cfg.width;
      const fz = (rc.footprint[0] + u1 * (rc.footprint[1] - rc.footprint[0])) * CELL_SIZE * cfg.width;
      const hh = (rc.height[0] + u2 * (rc.height[1] - rc.height[0])) * cfg.unit;
      const jx = (u3 - 0.5) * 2 * rc.scatter * CELL_SIZE;
      const jz = (u4 - 0.5) * 2 * rc.scatter * CELL_SIZE;
      // the first box of a slot stands on the slot's floor; others float a little (they are stacked fragments)
      const y0 = k * cfg.unit + (i === 0 ? 0 : u5 * 0.5 * cfg.unit);
      out.push({ seed: seed.id, material: seed.material, x: seed.x + jx, y: y0 + hh / 2, z: seed.z + jz, sx: fx, sy: hh, sz: fz, tone: u5, along: (k - first) / span });
    }
  }
  return out;
}

export function generateBoxes(seeds: readonly Seed[], cfg: BoxConfig = DEFAULT_BOXES): Box[] {
  const out: Box[] = [];
  for (const s of seeds) out.push(...boxesOfSeed(s, cfg));
  return out;
}
