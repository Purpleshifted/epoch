/**
 * EROSION IN THE BLOCK (the artist, 2026-11-12: "침식 ㄱ").
 *
 * The block is fixed (times 0 … its height) and it is looked at from its top. So erosion is not a clock: it is a
 * PLACE in the block. How much of a part is gone is a pure function of
 *
 *   - how far below the top its slot lies (as a share of the block's height), and
 *   - how little its cell-slot was lived in (Seed.gather, density.ts liveAt): what was built but not lived in is
 *     where the plants gather, and they pull the erosion up towards the top.
 *
 * WHAT goes first is the order of building, read backwards (seeds.ts BUILD_FROM): the drips and the masses, then the
 * slabs, the beams, and the skeleton last — and in patches rather than part by part (a smooth noise over the ground
 * and the slots), so a building loses a corner, not a sprinkle.
 *
 * Nothing here changes while nobody writes near a part: a part's threshold is fixed, its depth is fixed, and the
 * unlived share is read in quarters — so a part goes (or comes back) only when a quarter is crossed.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { PART_KINDS, type Box, type PartKind, type Seed } from "./seeds";

export interface ErodeConfig {
  /** The block's top (the observation plane), in slots. */
  topSlot: number;
  /** Nothing erodes above this depth (share of the block's height below the top, 0 … 1). */
  start: number;
  /** Erosion is complete at this depth (share of the block's height; > start). */
  full: number;
  /** How much of what stands may go where erosion is complete (0 … 1; 1 = everything). */
  amount: number;
  /** The unlived share (0 … 1) counts as this much more depth (share of the block's height). */
  vegPull: number;
  /** 0 = every kind of part alike; 1 = strictly the order of building backwards (the skeleton last). */
  order: number;
  /** 0 = part by part; 1 = whole patches together. */
  patch: number;
  /** The patches' size (cells on the ground; half as many slots in time). */
  grain: number;
  /** What stands in eroded places is this much darker at full erosion (0 = no shading). */
  shade: number;
  /** Plants gather where it erodes: this much of the erosion is added to a part's gathering (0 = not tied). */
  feed: number;
}

export const DEFAULT_ERODE: Omit<ErodeConfig, "topSlot"> = { start: 0.15, full: 0.9, amount: 0.75, vegPull: 0.3, order: 0.6, patch: 0.6, grain: 4, shade: 0.25, feed: 0.6 };

/** When a kind goes, 0 (first) … 1 (last): the order of building backwards (seeds.ts BUILD_FROM). */
const GO_AT: Record<PartKind, number> = { drip: 0, mass: 0.3, slab: 0.55, beam: 0.75, brace: 0.75, column: 1, plinth: 1, basement: 1, pile: 1 };

/** How eroded the place of a slot is, 0 … 1, by its depth below the top and its unlived share (0 … 1). */
export function erosionAt(slot: number, gather: number, cfg: ErodeConfig): number {
  if (!(cfg.topSlot > 0)) return 0;
  const depth = (cfg.topSlot - (slot + 0.5)) / cfg.topSlot + cfg.vegPull * gather;
  const e = (depth - cfg.start) / Math.max(1e-6, cfg.full - cfg.start);
  const c = e <= 0 ? 0 : e >= 1 ? 1 : e;
  return c * c * (3 - 2 * c);
}

/** Smooth noise 0 … 1 over the ground (cells / grain) and the slots (slots / (grain / 2)). */
function patchNoise(b: Box, grain: number): number {
  const g = Math.max(1, grain) * CELL_SIZE;
  const gk = Math.max(1, grain / 2);
  const fx = b.x / g, fz = b.z / g, fk = b.slot / gk;
  const ix = Math.floor(fx), iz = Math.floor(fz), ik = Math.floor(fk);
  const sm = (t: number) => t * t * (3 - 2 * t);
  const ux = sm(fx - ix), uz = sm(fz - iz), uk = sm(fk - ik);
  let n = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dz = (c >> 1) & 1, dk = (c >> 2) & 1;
    n += hash2(ix + dx, iz + dz, (ik + dk) * 31 + 7717) * (dx ? ux : 1 - ux) * (dz ? uz : 1 - uz) * (dk ? uk : 1 - uk);
  }
  // an average of hashes crowds round the middle: spread it back out
  return Math.min(1, Math.max(0, (n - 0.5) * 2.2 + 0.5));
}

/** A part's own threshold, 0 … 1 (fixed): it is gone where erosion × amount is above it. */
export function erodeThreshold(b: Box, cfg: Pick<ErodeConfig, "order" | "patch" | "grain">): number {
  const own = hash2(Math.round(b.x * 997) ^ b.seed, Math.round(b.z * 991) ^ Math.round(b.y * 983), PART_KINDS.indexOf(b.kind) + 4099);
  const p = Math.min(1, Math.max(0, cfg.patch));
  const h = p > 0 ? own * (1 - p) + patchNoise(b, cfg.grain) * p : own;
  const o = Math.min(1, Math.max(0, cfg.order));
  return h * (1 - o) + (GO_AT[b.kind] * 0.75 + h * 0.25) * o;
}

export interface Erosion {
  /** How eroded the part's place is (0 … 1). */
  at(b: Box): number;
  /** Whether the part is gone. */
  gone(b: Box): boolean;
}

/** The erosion of the seeds' parts under `cfg` (thresholds are cached per part in `memo`, which belongs to one cfg). */
export function erosion(seeds: readonly Seed[], cfg: ErodeConfig, memo: WeakMap<Box, number> = new WeakMap()): Erosion {
  const gather = new Map<number, ReadonlyMap<number, number> | undefined>();
  for (const s of seeds) gather.set(s.id, s.gather);
  const at = (b: Box) => erosionAt(b.slot, gather.get(b.seed)?.get(b.slot) ?? 0, cfg);
  const amount = Math.min(1, Math.max(0, cfg.amount));
  return {
    at,
    gone(b) {
      const e = at(b) * amount;
      if (e <= 0) return false;
      let th = memo.get(b);
      if (th === undefined) memo.set(b, (th = erodeThreshold(b, cfg)));
      return th < e;
    },
  };
}
