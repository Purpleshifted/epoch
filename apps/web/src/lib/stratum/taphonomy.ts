/**
 * stratum/taphonomy.ts
 *
 * Pure fate logic: what happens to a deposited item as time passes.
 * Replaces the stellar mass / phase logic. No rendering, no Math.random().
 *
 * Stages:  fresh -> weathered -> fragmented            (exposed on the surface)
 *          buried -> compressed                        (covered by later deposits)
 *          fossil                                      (permanent)   |   vanished
 *
 * Model (all numbers are EST., see ./materials):
 *  - Exposed lifetime L is log-uniform inside the material's persistence range,
 *    chosen deterministically from the item id.
 *  - Burial: an item is buried once `needed` LATER deposits landed on its cell.
 *    `needed` is drawn per item (mean ~ BURIAL_MEAN_COVER). Burial slows decay by
 *    BURIED_DECAY_FACTOR.
 *  - Fossilisation: after MINERALISE_YEARS of burial, a per-item roll against the
 *    material's fossilPotential decides if it becomes permanent. Unburied items
 *    never fossilise (taphonomy: burial is the gate).
 *  - Exceptional preservation (Lagerstatte): a rare per-cell, per-period event that
 *    makes every item buried in it permanent, regardless of material.
 */

import { geoYears, type GeoClockConfig, DEFAULT_CLOCK } from "./geoClock";
import { hash01 } from "./rng";
import { BURIED_DECAY_FACTOR, MATERIALS, MINERALISE_YEARS, type MaterialId } from "./materials";

export type Stage =
  | "fresh"
  | "weathered"
  | "fragmented"
  | "buried"
  | "compressed"
  | "fossil"
  | "vanished";

export interface Deposit {
  id: string;
  material: MaterialId;
  /** Wall-clock seconds (exhibition clock) when it was scattered. */
  depositedAt: number;
}

export interface Fate {
  stage: Stage;
  /** Effective decay as a fraction of lifetime (>= 1 means gone unless fossil). */
  decay: number;
  buried: boolean;
  /** Permanent: survives into the deepest strata / the far-future top view. */
  permanent: boolean;
  lifeYears: number;
  ageYears: number;
}

/** Mean number of later deposits needed to bury an item. EST. */
export const BURIAL_MEAN_COVER = 3;

/** Exposed lifetime in years: log-uniform inside the material range, per item. */
export function lifetimeYears(d: Deposit): number {
  const [lo, hi] = MATERIALS[d.material].persistenceYears;
  const u = hash01(d.id, "life");
  return lo * Math.pow(hi / lo, u);
}

/** Number of later deposits on the same cell required to bury this item (>= 1). */
export function coverNeeded(id: string, meanCover = BURIAL_MEAN_COVER): number {
  const u = hash01(id, "bury");
  return Math.max(1, Math.ceil(-meanCover * Math.log(1 - u)));
}

/**
 * Time (exhibition seconds) at which the item became buried, or null if it is not
 * buried (yet). `laterDepositTimes` = deposit times of OTHER items in the same
 * cell that were scattered AFTER this one, ascending.
 */
export function burialTime(id: string, laterDepositTimes: readonly number[]): number | null {
  const n = coverNeeded(id);
  return laterDepositTimes.length >= n ? laterDepositTimes[n - 1] : null;
}

/** Rare exceptional-preservation event for a cell in a given time period. */
export function isLagerstatte(
  cellKey: string,
  atSeconds: number,
  opts: { periodSeconds?: number; probability?: number } = {},
): boolean {
  const period = opts.periodSeconds ?? 900;
  const p = opts.probability ?? 0.02;
  return hash01(`${cellKey}:${Math.floor(atSeconds / period)}`, "lagerstatte") < p;
}

export interface FateContext {
  /** Exhibition seconds "now". */
  now: number;
  /** See burialTime(). null = not buried. */
  buriedAt: number | null;
  /** True if the item's cell was hit by an exceptional-preservation event. */
  lagerstatte?: boolean;
  clock?: GeoClockConfig;
}

export function fateOf(d: Deposit, ctx: FateContext): Fate {
  const clock = ctx.clock ?? DEFAULT_CLOCK;
  const mat = MATERIALS[d.material];
  const lifeYears = lifetimeYears(d);
  const ageYears = geoYears(ctx.now - d.depositedAt, clock);

  const buried = ctx.buriedAt != null && ctx.buriedAt <= ctx.now;
  let exposedYears = ageYears;
  let buriedYears = 0;
  if (buried) {
    exposedYears = geoYears((ctx.buriedAt as number) - d.depositedAt, clock);
    buriedYears = Math.max(0, ageYears - exposedYears);
  }
  const effectiveYears = exposedYears + BURIED_DECAY_FACTOR * buriedYears;
  const decay = effectiveYears / lifeYears;

  // Permanence: only buried items can fossilise (or be saved by a Lagerstatte).
  const mineralised = buried && buriedYears >= MINERALISE_YEARS;
  const fossilRoll = hash01(d.id, "fossil") < mat.fossilPotential;
  const permanent = mineralised && (fossilRoll || ctx.lagerstatte === true);

  let stage: Stage;
  if (permanent) stage = "fossil";
  else if (decay >= 1) stage = "vanished";
  else if (buried) stage = mineralised ? "compressed" : "buried";
  else if (decay < 0.15) stage = "fresh";
  else if (decay < 0.5) stage = "weathered";
  else stage = "fragmented";

  return { stage, decay, buried, permanent, lifeYears, ageYears };
}
