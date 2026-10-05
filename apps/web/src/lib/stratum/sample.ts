/**
 * stratum/sample.ts
 *
 * Draws what a visitor scatters. The visitor does not choose: the item is sampled
 * from the catalogue (layer prior × frequency, then shifted by what survives on the
 * ground, see `sampleFromField`). `sampleEntry` is the v1 draw over the JRC top 50,
 * kept for the legacy tests.
 */

import { CATALOGUE, CATALOGUE_TOTAL_PERCENT, type CatalogueEntry } from "./catalogue";
import { ITEMS, sampleItem, type ItemDef } from "./items";

const CUMULATIVE: readonly number[] = (() => {
  let acc = 0;
  return CATALOGUE.map((c) => (acc += c.percent / CATALOGUE_TOTAL_PERCENT));
})();

/** v1 (legacy): `u` in [0,1): uniform random number. Returns a JRC top-50 entry weighted by frequency. */
export function sampleEntry(u: number): CatalogueEntry {
  const x = Math.min(Math.max(u, 0), 1 - Number.EPSILON);
  let lo = 0;
  let hi = CUMULATIVE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CUMULATIVE[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return CATALOGUE[lo];
}

/**
 * Pólya-urn draw with a prior pseudo-count (Dirichlet-multinomial), over catalogue v2.
 *
 *   p(item) = ( k · prior(item) + survivors(item) ) / ( k + survivors_total )
 *
 * `survivors` maps item id -> number of items of that type that are still present
 * near the visitor (not vanished). With no survivors the draw equals the catalogue
 * prior (layer share × frequency); the more has accumulated, the more the local
 * composition dominates (weight of the ground = n / (n + k)). `fieldWeights` returns
 * the unnormalised weights, indexed like ITEMS, so the rule is testable exactly.
 * Natural stock is not part of the draw: only what visitors scattered is inherited.
 */
export function fieldWeights(survivors: ReadonlyMap<string, number>, k: number): number[] {
  const kk = Math.max(0, k);
  return ITEMS.map((it) => kk * it.prior + (survivors.get(it.id) ?? 0));
}

export function sampleFromField(u: number, survivors: ReadonlyMap<string, number>, k: number): ItemDef {
  const w = fieldWeights(survivors, k);
  let total = 0;
  for (const x of w) total += x;
  if (total <= 0) return sampleItem(u);
  let target = Math.min(Math.max(u, 0), 1 - Number.EPSILON) * total;
  for (let i = 0; i < w.length; i++) {
    target -= w[i];
    if (target < 0) return ITEMS[i];
  }
  return ITEMS[ITEMS.length - 1];
}

