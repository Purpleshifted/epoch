/**
 * stratum/geoClock.ts
 *
 * Maps wall-clock seconds since an item was deposited to *simulated* years.
 * Log-like compression: the first seconds already age an item noticeably, and the
 * whole exhibition run spans `maxYears`. This is a design choice (label as EST.).
 *
 *   years(t) = 10^(a · log10(1 + t)) − 1,   a = log10(1 + maxYears) / log10(1 + T)
 *
 * With T = 8 h and maxYears = 1e6:   10 s ≈ 25 y · 100 s ≈ 500 y · 1 h ≈ 6e4 y.
 */

export interface GeoClockConfig {
  /** Wall-clock length of the exhibition run, seconds. */
  exhibitionSeconds: number;
  /** Simulated years reached at the end of the run. */
  maxYears: number;
}

export const DEFAULT_CLOCK: GeoClockConfig = {
  exhibitionSeconds: 8 * 3600,
  maxYears: 1e6,
};

const A_DEFAULT = Math.log10(1 + DEFAULT_CLOCK.maxYears) / Math.log10(1 + DEFAULT_CLOCK.exhibitionSeconds);

export function geoYears(elapsedSeconds: number, cfg: GeoClockConfig = DEFAULT_CLOCK): number {
  const t = Math.max(0, elapsedSeconds);
  const a = cfg === DEFAULT_CLOCK ? A_DEFAULT : Math.log10(1 + cfg.maxYears) / Math.log10(1 + cfg.exhibitionSeconds);
  // 10^(a·log10(1+t)) = (1+t)^a
  return Math.pow(1 + t, a) - 1;
}

/** Depth in the stratum column for a given simulated age: log10 of years (>= 0). */
export function depthOfYears(years: number): number {
  return Math.log10(1 + Math.max(0, years));
}

/** Inverse of geoYears: wall-clock seconds after which an item is `years` simulated years old. */
export function secondsForYears(years: number, cfg: GeoClockConfig = DEFAULT_CLOCK): number {
  const a = Math.log10(1 + cfg.maxYears) / Math.log10(1 + cfg.exhibitionSeconds);
  return Math.pow(10, Math.log10(1 + Math.max(0, years)) / a) - 1;
}
