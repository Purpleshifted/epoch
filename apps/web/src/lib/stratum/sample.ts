/**
 * stratum/sample.ts
 *
 * Draws what a visitor scatters. The visitor does not choose: the item is sampled
 * from the real-world frequency of the catalogue (JRC European beach litter 2016).
 */

import { CATALOGUE, CATALOGUE_TOTAL_PERCENT, type CatalogueEntry } from "./catalogue";

const CUMULATIVE: readonly number[] = (() => {
  let acc = 0;
  return CATALOGUE.map((c) => (acc += c.percent / CATALOGUE_TOTAL_PERCENT));
})();

/** `u` in [0,1): uniform random number. Returns a catalogue entry weighted by frequency. */
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
 * Pólya-urn draw with a prior pseudo-count (Dirichlet-multinomial).
 *
 *   p(item) = ( k · prior(item) + survivors(item) ) / ( k + survivors_total )
 *
 * `survivors` maps catalogue rank -> number of items of that type that are still
 * present near the visitor (not vanished). With no survivors the draw equals the
 * catalogue prior; the more has accumulated, the more the local composition
 * dominates (weight of the ground = n / (n + k)). `fieldWeights` returns the
 * unnormalised weights so the rule is testable exactly.
 */
export function fieldWeights(survivors: ReadonlyMap<number, number>, k: number): number[] {
  const kk = Math.max(0, k);
  return CATALOGUE.map((c) => kk * (c.percent / CATALOGUE_TOTAL_PERCENT) + (survivors.get(c.rank) ?? 0));
}

export function sampleFromField(u: number, survivors: ReadonlyMap<number, number>, k: number): CatalogueEntry {
  const w = fieldWeights(survivors, k);
  let total = 0;
  for (const x of w) total += x;
  if (total <= 0) return sampleEntry(u);
  let target = Math.min(Math.max(u, 0), 1 - Number.EPSILON) * total;
  for (let i = 0; i < w.length; i++) {
    target -= w[i];
    if (target < 0) return CATALOGUE[i];
  }
  return CATALOGUE[CATALOGUE.length - 1];
}
