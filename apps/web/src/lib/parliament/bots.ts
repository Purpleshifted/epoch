/**
 * parliament/bots.ts
 *
 * Debug bots and the wall-clock sampler that drives every emitter.
 *
 * Why this is not in useFrame: requestAnimationFrame stops completely in a hidden tab, so a player tab that
 * emitted from useFrame went silent the moment you switched to /global/space to look at it — the bots never
 * reached `minVisitors` and no concrete was ever generated. Emission is now a function of WALL TIME only:
 * whenever a tick arrives (however late), every sample that fell due since the last one is emitted with its
 * own wall time. A throttled tab produces exactly the same events, only in bursts.
 */

import { sessionSeconds } from "./clock";
import { hash2 } from "./nature";
import type { RoleId } from "./types";

/** Most samples one tick may backfill (a tab frozen for longer than this skips the older part). */
export const MAX_CATCH_UP = 300;

/**
 * Wall times (ms) of the fixed-period samples that are due in (lastMs, nowMs].
 * At most `maxCatchUp` samples are returned: after a long freeze only the latest ones.
 */
export function dueSamples(lastMs: number, nowMs: number, periodMs: number, maxCatchUp = MAX_CATCH_UP): number[] {
  if (!(periodMs > 0) || nowMs < lastMs + periodMs) return [];
  const n = Math.floor((nowMs - lastMs) / periodMs);
  const skip = Math.max(0, n - Math.max(1, maxCatchUp));
  const out: number[] = [];
  for (let k = skip + 1; k <= n; k++) out.push(lastMs + k * periodMs);
  return out;
}

export interface Actor {
  o: string;
  r: RoleId;
  x: number;
  z: number;
  s: number;
}

/**
 * How the bots spread over the ground: `groups` flocks (bot i belongs to flock i % groups), whose centres sit
 * `spread` world units apart (sunflower layout around the origin) and wander slowly (about spread/4, a few minutes
 * per loop), so concrete appears in several places and moves on. groups 1, spread 0 = everybody around the origin.
 */
export interface Flock {
  groups: number;
  spread: number;
  /**
   * TIME: each bot's assigned time is the player's ± a random share of this width (seconds), drawn once per bot when
   * the bots are switched on — the same rule for all of them. Absent = the old fixed −20 … +4 s pattern.
   */
  timeSpread?: number;
}

export const ONE_FLOCK: Flock = { groups: 1, spread: 0 };

/** Centre of flock g at `sec` seconds after the bots were switched on. */
export function flockCentre(g: number, groups: number, spread: number, sec: number): [number, number] {
  if (!(spread > 0)) return [0, 0];
  const a = g * 2.399963 + 0.7;
  const r = spread * Math.sqrt((g + 0.5) / Math.max(1, groups));
  const d = spread * 0.25;
  const w1 = (2 * Math.PI) / (180 + 37 * g);
  const w2 = (2 * Math.PI) / (240 + 23 * g);
  return [Math.cos(a) * r + Math.sin(sec * w1 + g) * d, Math.sin(a) * r + Math.cos(sec * w2 + 2 * g) * d];
}

/** Bot i's time offset relative to the player (seconds): uniform in ±timeSpread/2, fixed while the bots are on. */
export function botTimeOffset(i: number, startMs: number, timeSpread: number): number {
  return (hash2(i, Math.floor(startMs / 1000) % 1_000_003, 61) - 0.5) * timeSpread;
}

/**
 * Bot i at wall time `wallMs`: circles its flock's centre on one of four radii, and lives around the player's time
 * slot (a random time within ±timeSpread/2 of it; some a little ahead, so they are invisible to the player at first).
 * `startMs` is when the bots were switched on; their motion depends only on (wallMs - startMs).
 */
export function botActor(i: number, role: RoleId, wallMs: number, startMs: number, epochMs: number, playerOffset: number, flock: Flock = ONE_FLOCK): Actor {
  const groups = Math.max(1, Math.round(flock.groups));
  const g = i % groups;
  const j = Math.floor(i / groups); // place within the flock
  const sec = (wallMs - startMs) / 1000;
  const [cx, cz] = flockCentre(g, groups, flock.spread, sec);
  const R = 1 + (j % 4) * 1.1;
  const w = (0.18 + 0.05 * (j % 4)) * (j % 2 ? 1 : -1);
  const a = sec * w + i * 2.399963;
  const off = Math.max(0, flock.timeSpread !== undefined ? playerOffset + botTimeOffset(i, startMs, flock.timeSpread) : playerOffset - 20 + ((i * 7) % 25));
  return { o: `bot${i}`, r: role, x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, s: sessionSeconds(wallMs, epochMs, off) };
}
