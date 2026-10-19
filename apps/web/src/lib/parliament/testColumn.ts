/**
 * parliament/testColumn.ts
 *
 * WORK MODE: a whole column at once. For adjusting the look of the strata one needs every stage in view — buildings,
 * gathering, growths, fusion, resin — which otherwise takes the history window's length (20 minutes, or minutes at
 * a fast time rate) to accumulate, and is lost on every reload. `seedTestColumn` writes a bot crowd's log for the
 * last `seconds` of world time straight into the shared storage (the same bots as the player tab's, without the
 * steering over the folded ground) and moves the epoch so that the world's present is the end of it; every open
 * view folds it at once. The shared world is replaced (it is a new epoch).
 */

import { botActor, type Flock } from "./bots";
import { LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_KEEP_FROM_KEY, LS_PARLIAMENT_EPOCH_KEY, keepWindowSec } from "./log";
import type { PEvent } from "./types";
import { worldNow } from "./worldClock";

export interface TestColumnOptions {
  /** World seconds of history to write (default: the history window). */
  seconds?: number;
  bots?: number;
  flock?: Flock;
  /** Samples per second per bot. */
  sampleSec?: number;
}

/** The crowd's events for `seconds` of world time (assigned times 0 … seconds). Pure. */
export function buildTestColumn(opts: TestColumnOptions = {}): PEvent[] {
  const seconds = Math.max(60, Math.round(opts.seconds ?? keepWindowSec()));
  const bots = Math.max(1, Math.round(opts.bots ?? 13));
  const flock = opts.flock ?? { groups: 3, spread: 20, timeSpread: 60 };
  const period = Math.max(0.25, opts.sampleSec ?? 1);
  const start = 1_800_000_000_000;
  const out: PEvent[] = [];
  for (let s = 0; s <= seconds; s += period) {
    for (let i = 0; i < bots; i++) {
      const a = botActor(i, "worker", start + s * 1000, start, start, 60, flock);
      if (a.s < 0) continue;
      out.push({ id: `tc${i}:${s}`, o: `bot${i}`, r: a.r, k: "p", x: Math.round(a.x * 100) / 100, z: Math.round(a.z * 100) / 100, s: Math.round(a.s * 100) / 100 });
    }
  }
  return out;
}

/** Replaces the shared world with a test column (a new epoch whose present is the end of the written history). */
export function seedTestColumn(opts: TestColumnOptions = {}): PEvent[] {
  const events = buildTestColumn(opts);
  const end = events.length ? events[events.length - 1].s : 0;
  const epoch = String(Math.round(worldNow() - end * 1000));
  try {
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, epoch);
    localStorage.setItem(LS_EVENTS_EPOCH_KEY, epoch);
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(events));
    localStorage.setItem(LS_KEEP_FROM_KEY, String(end - keepWindowSec()));
  } catch {
    /* storage unavailable: the views get it through the log only */
  }
  return events;
}
