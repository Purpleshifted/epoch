/**
 * stratum/field.ts
 *
 * The shared ground that every view reads: a flat list of scatter records and a pure
 * function that resolves each record's fate at a given moment. No rendering.
 *
 * Burial is an emergent property of the *crowd*, not of the item: an item is buried
 * when later visitors scatter things on the same cell. Nobody chooses what survives.
 */

import { hash01 } from "./rng";
import { sampleItem, itemById, type ItemDef } from "./items";
import { isLagerstatte, burialTime, fateOf, type Fate } from "./taphonomy";
import type { GeoClockConfig } from "./geoClock";
import type { MaterialId } from "./materials";

/** Edge length of a ground cell in world units (same as the old star-cluster cell). */
export const CELL_SIZE = 1.2;

/** Persisted scatter record. Compact on purpose: it is kept in localStorage. */
export interface DepositRecord {
  id: string;
  /** Catalogue v2 item id (see items.ts). */
  item: string;
  /** Sprite variant of the item, 0-based. */
  variant: number;
  material: MaterialId;
  x: number;
  y: number;
  z: number;
  /** Exhibition seconds when scattered. */
  t: number;
  /** Visitor id (or bot id). */
  owner: string;
}

/** v2: records carry `item` + `variant` (v1 stored a JRC `rank`; those records are ignored). */
export const LS_DEPOSITS_KEY = "anthropocene:deposits:v2";
export const LS_EPOCH_KEY = "anthropocene:epoch:v1";

export function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

/** Make a new record. `u` picks the item from the catalogue prior unless `item` is given. */
export function makeDeposit(args: {
  id: string;
  u: number;
  x: number;
  y: number;
  z: number;
  t: number;
  owner: string;
  item?: ItemDef;
}): DepositRecord {
  const it = args.item ?? sampleItem(args.u);
  const variant = Math.min(it.variants - 1, Math.floor(hash01(args.id, "variant") * it.variants));
  return { id: args.id, item: it.id, variant, material: it.material, x: args.x, y: args.y, z: args.z, t: args.t, owner: args.owner };
}

/** The catalogue item a record refers to. */
export function itemOf(rec: Pick<DepositRecord, "item">): ItemDef {
  return itemById(rec.item);
}

/**
 * What is still here around (x, z): number of non-vanished items per catalogue item id
 * within `radius`. Buried and fossil items count: they are part of what the visitor
 * inherits. Vanished items do not: what decays is not inherited. This survivorship
 * bias is what lets the composition drift toward durable material.
 */
export function localSurvivors(
  resolved: readonly { rec: DepositRecord; fate: Fate }[],
  x: number,
  z: number,
  radius: number,
): Map<string, number> {
  const r2 = radius * radius;
  const out = new Map<string, number>();
  for (const { rec, fate } of resolved) {
    if (fate.stage === "vanished") continue;
    const dx = rec.x - x;
    const dz = rec.z - z;
    if (dx * dx + dz * dz <= r2) out.set(rec.item, (out.get(rec.item) ?? 0) + 1);
  }
  return out;
}



export interface ResolvedDeposit {
  rec: DepositRecord;
  fate: Fate;
  /** Exhibition second at which it became buried, or null. */
  buriedAt: number | null;
}

/**
 * Resolve the fate of every record at exhibition second `now`.
 * Deterministic: same records and `now` -> same result in every view.
 */
export function resolveField(
  records: readonly DepositRecord[],
  now: number,
  clock?: GeoClockConfig,
): ResolvedDeposit[] {
  // Group by cell, ascending in time.
  const cells = new Map<string, DepositRecord[]>();
  for (const r of records) {
    const k = cellKey(r.x, r.z);
    const list = cells.get(k);
    if (list) list.push(r);
    else cells.set(k, [r]);
  }
  for (const list of cells.values()) list.sort((a, b) => a.t - b.t);

  const out: ResolvedDeposit[] = [];
  for (const [k, list] of cells) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.t > now) continue; // not scattered yet
      const later: number[] = [];
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].t <= now) later.push(list[j].t);
      }
      const buriedAt = burialTime(r.id, later);
      const lager = buriedAt != null && isLagerstatte(k, buriedAt);
      const fate = fateOf(
        { id: r.id, material: r.material, depositedAt: r.t },
        { now, buriedAt, lagerstatte: lager, clock },
      );
      out.push({ rec: r, fate, buriedAt });
    }
  }
  return out;
}
