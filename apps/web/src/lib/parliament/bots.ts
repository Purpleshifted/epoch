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
 * Bot i at wall time `wallMs`: circles the origin on one of four radii, and lives in nearly the same time slot
 * as the player (some a little ahead, so they are invisible to the player at first).
 * `startMs` is when the bots were switched on; their motion depends only on (wallMs - startMs).
 */
export function botActor(i: number, role: RoleId, wallMs: number, startMs: number, epochMs: number, playerOffset: number): Actor {
  const R = 1 + (i % 4) * 1.1;
  const w = (0.18 + 0.05 * (i % 4)) * (i % 2 ? 1 : -1);
  const a = ((wallMs - startMs) / 1000) * w + i * 2.399963;
  const off = Math.max(0, playerOffset - 20 + ((i * 7) % 25));
  return { o: `bot${i}`, r: role, x: Math.cos(a) * R, z: Math.sin(a) * R, s: sessionSeconds(wallMs, epochMs, off) };
}
