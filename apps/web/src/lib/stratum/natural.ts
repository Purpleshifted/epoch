/**
 * stratum/natural.ts
 *
 * The natural stock: what the ground holds before visitors arrive, and how walking
 * wears it down. Pure and deterministic, no rendering.
 *
 *  - Every ground cell holds 0–2 natural items, chosen by a hash of the cell, so every
 *    view sees the same ground and nothing has to be stored.
 *  - Visitors do not scatter them. A natural item is displaced when the load on its
 *    cell reaches its personal threshold:
 *        load h = PASSES_PER_CROSSING · (visitor crossings) + PASSES_PER_DEPOSIT · (deposits)
 *        alive  while  h < −τ · r · ln u      (u fixed per item, so P(alive) = exp(−h / (τ r)))
 *    τ is the group's scale (flora / fauna), r the item's relative resistance.
 *  - Once displaced the item is dead matter and follows the normal taphonomy
 *    (taphonomy.ts): leaves vanish within days, bone / tooth / shell stay if buried.
 *    Nothing grows back within a run.
 *
 * Calibration (docs/catalogue-v2.md §5): τ_flora anchors on Cole 1995 (~50 passes for
 * ~half the cover, numbers from a search summary), τ_fauna on Bar-On et al. 2018
 * (plants ÷2, wild mammals ÷6 for the same load). Everything else is EST.
 */

import { CELL_SIZE, GroundStore, type DepositRecord, type StepRecord } from "./field";
import { NATURALS, NATURAL_CAL, type NaturalDef } from "./items";
import { hash01 } from "./rng";
import { coverNeeded, fateOf, isLagerstatte, type Fate } from "./taphonomy";
import type { GeoClockConfig } from "./geoClock";

export const PASSES_PER_CROSSING = NATURAL_CAL.passesPerCrossing;
export const PASSES_PER_DEPOSIT = NATURAL_CAL.passesPerDeposit;
export const TAU_FLORA = NATURAL_CAL.tauFlora;
export const TAU_FAUNA = NATURAL_CAL.tauFauna;

export interface NaturalItem {
  id: string;
  def: NaturalDef;
  variant: number;
  cell: string;
  x: number;
  z: number;
  /** Load (in passes) at which this item is displaced. */
  threshold: number;
}

const NATURAL_CUMULATIVE: readonly number[] = (() => {
  let acc = 0;
  return NATURALS.map((n) => (acc += n.share));
})();

function pickNatural(u: number): NaturalDef {
  for (let i = 0; i < NATURAL_CUMULATIVE.length; i++) if (u < NATURAL_CUMULATIVE[i]) return NATURALS[i];
  return NATURALS[NATURALS.length - 1];
}

/** How many natural items a cell holds: 0 (35 %), 1 (40 %), 2 (25 %). Mean 0.9. */
export function naturalCountInCell(cx: number, cz: number): number {
  const u = hash01(`${cx},${cz}`, "ncount");
  return u < 0.35 ? 0 : u < 0.75 ? 1 : 2;
}

export function naturalItemsInCell(cx: number, cz: number): NaturalItem[] {
  const n = naturalCountInCell(cx, cz);
  const cell = `${cx},${cz}`;
  const out: NaturalItem[] = [];
  for (let i = 0; i < n; i++) {
    const id = `n:${cell}:${i}`;
    const def = pickNatural(hash01(id, "ntype"));
    const u = Math.max(0.02, hash01(id, "nthr"));
    const tau = def.group === "flora" ? TAU_FLORA : TAU_FAUNA;
    out.push({
      id,
      def,
      variant: Math.min(def.variants - 1, Math.floor(hash01(id, "nvar") * def.variants)),
      cell,
      x: (cx + hash01(id, "nx")) * CELL_SIZE,
      z: (cz + hash01(id, "nz")) * CELL_SIZE,
      threshold: -tau * def.resist * Math.log(u),
    });
  }
  return out;
}

/** All natural items whose position lies within `radius` of (x, z). */
export function naturalItemsAround(x: number, z: number, radius: number): NaturalItem[] {
  const c0x = Math.floor((x - radius) / CELL_SIZE);
  const c1x = Math.floor((x + radius) / CELL_SIZE);
  const c0z = Math.floor((z - radius) / CELL_SIZE);
  const c1z = Math.floor((z + radius) / CELL_SIZE);
  const r2 = radius * radius;
  const out: NaturalItem[] = [];
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      for (const it of naturalItemsInCell(cx, cz)) {
        const dx = it.x - x;
        const dz = it.z - z;
        if (dx * dx + dz * dz <= r2) out.push(it);
      }
    }
  }
  return out;
}

export interface ResolvedNatural {
  item: NaturalItem;
  /** Still part of the living ground. */
  alive: boolean;
  /** Exhibition second at which it was displaced, or null if alive. */
  displacedAt: number | null;
  /** Fate of the dead matter after displacement (null while alive). */
  fate: Fate | null;
}

/**
 * Resolve the natural items at exhibition second `now` against a GroundStore.
 * Events after `now` are ignored. `wear` scales the load: 1 is the calibrated
 * reference, larger values make a small crowd wear the ground down faster (a demo /
 * tuning knob, since the real number of visitors is not known in advance).
 */
export function resolveNaturalIn(
  items: readonly NaturalItem[],
  store: GroundStore,
  now: number,
  clock?: GeoClockConfig,
  wear = 1,
): ResolvedNatural[] {
  const wStep = PASSES_PER_CROSSING * wear;
  const wDep = PASSES_PER_DEPOSIT * wear;
  const out: ResolvedNatural[] = [];
  const cache = new Map<string, { steps: number[]; deps: number[] }>();
  for (const item of items) {
    let cell = cache.get(item.cell);
    if (!cell) {
      cell = { steps: store.stepTimes(item.cell), deps: store.depositTimes(item.cell) };
      cache.set(item.cell, cell);
    }
    const { steps, deps } = cell;
    // walk both sorted lists in time order until the load reaches the threshold
    let h = 0;
    let displacedAt: number | null = null;
    let i = 0;
    let j = 0;
    while (true) {
      const ts = i < steps.length && steps[i] <= now ? steps[i] : Infinity;
      const td = j < deps.length && deps[j] <= now ? deps[j] : Infinity;
      if (ts === Infinity && td === Infinity) break;
      let t: number;
      if (ts <= td) { h += wStep; t = ts; i++; }
      else { h += wDep; t = td; j++; }
      if (h >= item.threshold) { displacedAt = t; break; }
    }
    if (displacedAt == null) {
      out.push({ item, alive: true, displacedAt: null, fate: null });
      continue;
    }
    // deposits after the displacement bury the dead matter
    const need = coverNeeded(item.id);
    let seen = 0;
    let buriedAt: number | null = null;
    for (let k = 0; k < deps.length && deps[k] <= now; k++) {
      if (deps[k] > displacedAt && ++seen === need) { buriedAt = deps[k]; break; }
    }
    const lager = buriedAt != null && isLagerstatte(item.cell, buriedAt);
    const fate = fateOf(
      { id: item.id, material: item.def.material, depositedAt: displacedAt },
      { now, buriedAt, lagerstatte: lager, clock },
    );
    out.push({ item, alive: false, displacedAt, fate });
  }
  return out;
}

/** Convenience for tests and one-off use: builds a store from plain record lists. */
export function resolveNatural(
  items: readonly NaturalItem[],
  deposits: readonly DepositRecord[],
  steps: readonly StepRecord[],
  now: number,
  clock?: GeoClockConfig,
  wear = 1,
): ResolvedNatural[] {
  const store = new GroundStore();
  for (const d of deposits) store.addDeposit(d);
  for (const s of steps) store.addStep(s);
  return resolveNaturalIn(items, store, now, clock, wear);
}

/** Share of natural items still alive, by group (for tests and for the debug HUD). */
export function aliveShare(resolved: readonly ResolvedNatural[], group?: "flora" | "fauna"): number {
  let n = 0;
  let alive = 0;
  for (const r of resolved) {
    if (group && r.item.def.group !== group) continue;
    n++;
    if (r.alive) alive++;
  }
  return n === 0 ? 1 : alive / n;
}
