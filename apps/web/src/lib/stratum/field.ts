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
import { coverNeeded, isLagerstatte, fateOf, type Fate } from "./taphonomy";
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

/** A visitor entered a ground cell. Persisted (compact) so every view can read it. */
export interface StepRecord {
  id: string;
  /** Cell key (see cellKey). */
  c: string;
  /** Exhibition seconds. */
  t: number;
  /** Visitor id (or bot id). */
  o: string;
}

export const LS_STEPS_KEY = "anthropocene:steps:v1";

/**
 * Fate of the deposits of ONE cell. `list` is sorted by time. Burial needs the n-th
 * later deposit, which in a sorted list is simply the element n places ahead: O(m).
 */
function resolveCell(
  key: string,
  list: readonly DepositRecord[],
  now: number,
  clock: GeoClockConfig | undefined,
  out: ResolvedDeposit[],
): void {
  // deposits that already happened (list is sorted: a prefix)
  let visible = list.length;
  while (visible > 0 && list[visible - 1].t > now) visible--;
  for (let i = 0; i < visible; i++) {
    const r = list[i];
    const need = coverNeeded(r.id);
    const buriedAt = i + need < visible ? list[i + need].t : null;
    const lager = buriedAt != null && isLagerstatte(key, buriedAt);
    const fate = fateOf(
      { id: r.id, material: r.material, depositedAt: r.t },
      { now, buriedAt, lagerstatte: lager, clock },
    );
    out.push({ rec: r, fate, buriedAt });
  }
}

/**
 * The shared ground, indexed by cell and updated incrementally. Views (and later the
 * server) add records as they arrive and resolve only the cells they need, instead of
 * re-sorting every record ever scattered several times a second.
 */
export class GroundStore {
  private dep = new Map<string, DepositRecord[]>();
  private stp = new Map<string, number[]>();
  private depIds = new Set<string>();
  private stpIds = new Set<string>();
  private unsortedDep = new Set<string>();
  private unsortedStp = new Set<string>();
  /** Bumps whenever something is added; lets callers skip work when nothing changed. */
  version = 0;

  get depositCount(): number { return this.depIds.size; }
  get stepCount(): number { return this.stpIds.size; }
  hasDeposit(id: string): boolean { return this.depIds.has(id); }
  hasStep(id: string): boolean { return this.stpIds.has(id); }

  /** Returns false if the id is already known. */
  addDeposit(rec: DepositRecord): boolean {
    if (this.depIds.has(rec.id)) return false;
    this.depIds.add(rec.id);
    const k = cellKey(rec.x, rec.z);
    const list = this.dep.get(k);
    if (list) {
      if (list.length && list[list.length - 1].t > rec.t) this.unsortedDep.add(k);
      list.push(rec);
    } else this.dep.set(k, [rec]);
    this.version++;
    return true;
  }

  addStep(s: StepRecord): boolean {
    if (this.stpIds.has(s.id)) return false;
    this.stpIds.add(s.id);
    const list = this.stp.get(s.c);
    if (list) {
      if (list.length && list[list.length - 1] > s.t) this.unsortedStp.add(s.c);
      list.push(s.t);
    } else this.stp.set(s.c, [s.t]);
    this.version++;
    return true;
  }

  private sortedDeposits(k: string): DepositRecord[] {
    const list = this.dep.get(k) ?? [];
    if (this.unsortedDep.delete(k)) list.sort((a, b) => a.t - b.t);
    return list;
  }

  /** Sorted times of the deposits on a cell. */
  depositTimes(k: string): number[] {
    return this.sortedDeposits(k).map((r) => r.t);
  }

  /** Sorted times of the visitor crossings of a cell. */
  stepTimes(k: string): number[] {
    const list = this.stp.get(k) ?? [];
    if (this.unsortedStp.delete(k)) list.sort((a, b) => a - b);
    return list;
  }

  /** Keys of the cells (that hold deposits) whose area touches the circle (x, z, radius). */
  cellsNear(x: number, z: number, radius: number): string[] {
    const c0x = Math.floor((x - radius) / CELL_SIZE);
    const c1x = Math.floor((x + radius) / CELL_SIZE);
    const c0z = Math.floor((z - radius) / CELL_SIZE);
    const c1z = Math.floor((z + radius) / CELL_SIZE);
    const out: string[] = [];
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = `${cx},${cz}`;
        if (this.dep.has(k)) out.push(k);
      }
    }
    return out;
  }

  resolveCells(keys: Iterable<string>, now: number, clock?: GeoClockConfig): ResolvedDeposit[] {
    const out: ResolvedDeposit[] = [];
    for (const k of keys) {
      if (this.dep.has(k)) resolveCell(k, this.sortedDeposits(k), now, clock, out);
    }
    return out;
  }

  /** Everything within `radius` of (x, z) (whole cells, so burial stays correct). */
  resolveNear(x: number, z: number, radius: number, now: number, clock?: GeoClockConfig): ResolvedDeposit[] {
    return this.resolveCells(this.cellsNear(x, z, radius), now, clock);
  }

  resolveAll(now: number, clock?: GeoClockConfig): ResolvedDeposit[] {
    return this.resolveCells(this.dep.keys(), now, clock);
  }

  allDeposits(): DepositRecord[] {
    const out: DepositRecord[] = [];
    for (const list of this.dep.values()) for (const r of list) out.push(r);
    return out;
  }

  /** Crossing times per cell (sorted lazily by stepTimes). Ids and owners are not kept here. */
  stepCells(): ReadonlyMap<string, number[]> {
    return this.stp;
  }
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
  const store = new GroundStore();
  for (const r of records) store.addDeposit(r);
  return store.resolveAll(now, clock);
}
