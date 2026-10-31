/**
 * parliament/worldClock.ts
 *
 * The WORLD CLOCK every tab of the parliament runs on, in place of the wall clock: it can run faster (a time rate,
 * for watching layers age quickly while testing). It is shared through localStorage as an anchor
 * { r: wall ms, v: world ms, rate }: world ms = v + (wall ms − r) · rate. Changing the rate re-anchors at the current
 * world time, so world time never jumps, and every tab (player tabs, their bots, the views) reads the same one.
 * Without an anchor the world clock is the wall clock.
 */

export const LS_TIME_RATE_KEY = "anthropocene:parliament:time-rate:v1";
/** Fastest rate the slider offers (more makes the event log outgrow its window within seconds). */
export const MAX_TIME_RATE = 40;
/** Slowest: 0 = the world clock stands still (for adjusting the look of a moment; nothing is sampled meanwhile). */
export const MIN_TIME_RATE = 0;

interface Anchor {
  r: number;
  v: number;
  rate: number;
}

/** How often (wall ms) the anchor is read again from storage: other tabs change it. */
const READ_EVERY_MS = 200;
let cached: { at: number; a: Anchor | null } | null = null;

function readAnchor(): Anchor | null {
  const now = Date.now();
  if (cached && now - cached.at < READ_EVERY_MS) return cached.a;
  let a: Anchor | null = null;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LS_TIME_RATE_KEY);
    const o = raw ? (JSON.parse(raw) as Partial<Anchor>) : null;
    if (o && Number.isFinite(o.r) && Number.isFinite(o.v) && Number.isFinite(o.rate) && o.rate! >= 0) a = o as Anchor;
  } catch {
    a = null;
  }
  cached = { at: now, a };
  return a;
}

/** World ms now (the wall clock, × the time rate since it was set). */
export function worldNow(): number {
  const a = readAnchor();
  const now = Date.now();
  return a ? a.v + (now - a.r) * a.rate : now;
}

/** The current time rate (1 = real time, 0 = standing still). */
export function timeRate(): number {
  return readAnchor()?.rate ?? 1;
}

/** A clock a view runs on: the shared world clock, or a local one (the lab's: this tab only). */
export interface Clock {
  now(): number;
  rate(): number;
  setRate(rate: number): void;
}

/** The shared world clock as a Clock. */
export const sharedClock: Clock = { now: () => worldNow(), rate: () => timeRate(), setRate: (r) => setTimeRate(r) };

/** A clock of this tab only (nothing shared): the same anchor arithmetic, in memory; starts at `rate`. */
export function makeLocalClock(rate = 1): Clock {
  let a: Anchor = { r: Date.now(), v: Date.now(), rate: Math.max(MIN_TIME_RATE, Math.min(MAX_TIME_RATE, rate)) };
  const now = () => a.v + (Date.now() - a.r) * a.rate;
  return {
    now,
    rate: () => a.rate,
    setRate: (r) => {
      const rr = Math.max(MIN_TIME_RATE, Math.min(MAX_TIME_RATE, Math.round(r * 100) / 100));
      if (rr === a.rate) return;
      a = { r: Date.now(), v: now(), rate: rr };
    },
  };
}

/** Sets the time rate for every tab, from the current world time on. */
export function setTimeRate(rate: number): void {
  const r = Math.max(MIN_TIME_RATE, Math.min(MAX_TIME_RATE, Math.round(rate * 100) / 100));
  if (r === timeRate()) return;
  const a: Anchor = { r: Date.now(), v: worldNow(), rate: r };
  try {
    localStorage.setItem(LS_TIME_RATE_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: this tab only */
  }
  cached = { at: a.r, a };
}
