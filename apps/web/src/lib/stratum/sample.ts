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
