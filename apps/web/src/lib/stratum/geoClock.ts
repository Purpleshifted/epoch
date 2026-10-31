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
 *
 * SATURATION (2026-11-01): the curve is superlinear in absolute time — the same twenty seconds weighed twice as many
 * years in an eight-hour-old world as in a one-hour-old one, and eight times as many after a fortnight, so a wall
 * left running for days melted a building right after it was built (the artist: "if it runs too long the buildings
 * vanish"). From `saturateSeconds` (the end of the run, 8 h) on the curve continues as a STRAIGHT LINE with the slope it had there: the first
 * hours look as they always did, and after that every twenty seconds is worth the same years, however long the world
 * has been running. The inverse (secondsForYears) follows the same two pieces.
 */

export interface GeoClockConfig {
  /** Wall-clock length of the exhibition run, seconds. */
  exhibitionSeconds: number;
  /** Simulated years reached at the end of the run. */
  maxYears: number;
  /** From here on the curve is a straight line with the slope it has at this point (Infinity = never). */
  saturateSeconds?: number;
}

export const DEFAULT_CLOCK: GeoClockConfig = {
  exhibitionSeconds: 8 * 3600,
  maxYears: 1e6,
  saturateSeconds: 8 * 3600,
};

function exponentOf(cfg: GeoClockConfig): number {
  return Math.log10(1 + cfg.maxYears) / Math.log10(1 + cfg.exhibitionSeconds);
}

const A_DEFAULT = exponentOf(DEFAULT_CLOCK);

/** The curve's value and slope at the saturation point (years, years per second). */
function saturation(cfg: GeoClockConfig, a: number): { s: number; y: number; slope: number } {
  const s = cfg.saturateSeconds ?? Infinity;
  if (!Number.isFinite(s)) return { s: Infinity, y: Infinity, slope: 0 };
  return { s, y: Math.pow(1 + s, a) - 1, slope: a * Math.pow(1 + s, a - 1) };
}

const SAT_DEFAULT = saturation(DEFAULT_CLOCK, A_DEFAULT);

export function geoYears(elapsedSeconds: number, cfg: GeoClockConfig = DEFAULT_CLOCK): number {
  const t = Math.max(0, elapsedSeconds);
  const a = cfg === DEFAULT_CLOCK ? A_DEFAULT : exponentOf(cfg);
  const sat = cfg === DEFAULT_CLOCK ? SAT_DEFAULT : saturation(cfg, a);
  if (t > sat.s) return sat.y + sat.slope * (t - sat.s);
  // 10^(a·log10(1+t)) = (1+t)^a
  return Math.pow(1 + t, a) - 1;
}

/** Depth in the stratum column for a given simulated age: log10 of years (>= 0). */
export function depthOfYears(years: number): number {
  return Math.log10(1 + Math.max(0, years));
}

/** Inverse of geoYears: wall-clock seconds after which an item is `years` simulated years old. */
export function secondsForYears(years: number, cfg: GeoClockConfig = DEFAULT_CLOCK): number {
  const a = cfg === DEFAULT_CLOCK ? A_DEFAULT : exponentOf(cfg);
  const sat = cfg === DEFAULT_CLOCK ? SAT_DEFAULT : saturation(cfg, a);
  const y = Math.max(0, years);
  if (y > sat.y) return sat.s + (y - sat.y) / sat.slope;
  return Math.pow(10, Math.log10(1 + y) / a) - 1;
}
