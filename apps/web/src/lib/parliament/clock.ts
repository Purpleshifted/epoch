/**
 * parliament/clock.ts
 *
 * Every visitor is assigned a personal offset when they arrive; their assigned time is
 * "seconds since the exhibition epoch + offset". Later arrivals tend to be later (the offset is
 * drawn from a window, so neighbours in arrival order can swap), and the visitor's time keeps
 * flowing while they are in the ground.
 */

import { geoYears, secondsForYears } from "@/lib/stratum/geoClock";

/** Width (s) of the window an arriving visitor's offset is drawn from. */
export const OFFSET_WINDOW_SEC = 120;

/** u in [0,1) -> offset in [0, windowSec). */
export function pickOffset(u: number, windowSec = OFFSET_WINDOW_SEC): number {
  return Math.max(0, u) * windowSec;
}

/** Assigned exhibition seconds of a visitor at wall-clock `nowMs`. */
export function sessionSeconds(nowMs: number, epochMs: number, offsetSec: number): number {
  return (nowMs - epochMs) / 1000 + offsetSec;
}

/**
 * The assigned time that lies `horizonYears` model years after the latest event: the "future"
 * the Top view shows, in which slabs have worn away and only the footprints are left.
 */
export function horizonSeconds(latestS: number, horizonYears: number): number {
  return secondsForYears(geoYears(Math.max(0, latestS)) + Math.max(0, horizonYears));
}
