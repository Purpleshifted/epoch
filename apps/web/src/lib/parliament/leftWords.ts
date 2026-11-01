/**
 * parliament/leftWords.ts — where the lives that are over left their word (the artist, 2026-11-01: "ㅇㅇㅇㅇ가 남긴 말
 * 발견"): one place per ended visitor, read from the event log; the bots do not die, so they leave none. The place is
 * where they stayed longest, or where they ended when they never stayed. Only what the log still holds (the history
 * window). Read-only: it changes neither the ground nor the sound.
 *
 * Pure and deterministic.
 */

import type { PEvent } from "./types";
import { wrapDist } from "./world";

export interface LeftWord {
  /** Who left it. */
  o: string;
  x: number;
  z: number;
}

export interface LeftWordConfig {
  /** Silent for this long (s, assigned time) = that life is over. */
  goneSec: number;
  /** Samples within this of the first one are one stay (world). */
  stayRadius: number;
  /** A stay shorter than this (s) is no place: the word stays where the life ended. */
  minStaySec: number;
}

export const DEFAULT_LEFT_WORDS: LeftWordConfig = { goneSec: 10, stayRadius: 1.5, minStaySec: 5 };

export function leftWords(events: readonly PEvent[], meId: string, sNow: number, cfg: LeftWordConfig = DEFAULT_LEFT_WORDS, alive?: ReadonlySet<string>): LeftWord[] {
  const byOwner = new Map<string, PEvent[]>();
  for (const e of events) {
    if (e.k !== "p" || e.o === meId || e.s > sNow || e.o.startsWith("bot") || alive?.has(e.o)) continue;
    const list = byOwner.get(e.o);
    if (list) list.push(e);
    else byOwner.set(e.o, [e]);
  }
  const out: LeftWord[] = [];
  for (const [o, samples] of byOwner) {
    samples.sort((a, b) => a.s - b.s);
    const last = samples[samples.length - 1];
    if (sNow - last.s < cfg.goneSec) continue;
    let best = last;
    let bestSec = cfg.minStaySec;
    let start = 0;
    for (let i = 1; i <= samples.length; i++) {
      if (i < samples.length && wrapDist(samples[i].x, samples[i].z, samples[start].x, samples[start].z) <= cfg.stayRadius) continue;
      const sec = samples[i - 1].s - samples[start].s;
      if (sec >= bestSec) {
        bestSec = sec;
        best = samples[start];
      }
      start = i;
    }
    out.push({ o, x: best.x, z: best.z });
  }
  return out;
}
