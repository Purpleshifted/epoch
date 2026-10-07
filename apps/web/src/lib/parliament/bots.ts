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

/** Smooth 1D value noise, 0..1. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, seed, 71), b = hash2(i + 1, seed, 71);
  return a + (b - a) * u;
}

/** Seconds of the walking segments of bot i before `sec` (bots alternate walking and standing still). */
function walkedSeconds(i: number, sec: number, segLen: number, walkShare: number): number {
  const s = Math.floor(sec / segLen);
  let walked = 0;
  for (let k = 0; k < s; k++) if (hash2(i, k, 83) < walkShare) walked += segLen;
  if (hash2(i, s, 83) < walkShare) walked += sec - s * segLen;
  return walked;
}

/**
 * Bot i at wall time `wallMs`, a pure function of (wallMs − startMs) so a throttled tab emits the same samples:
 *   WALK / STAND   it alternates walking and standing still (segments of 6–24 s, 45–80 % walking: its character)
 *   WANDER         while walking it follows its own noise path around its flock's centre (radius 1.5–4)
 *   MIGRATE        every 1–3 min it may move on to another flock, walking over in ~12 s
 * It lives around the player's time slot (see Flock.timeSpread; some a little ahead, invisible to the player at first).
 */
export function botActor(i: number, role: RoleId, wallMs: number, startMs: number, epochMs: number, playerOffset: number, flock: Flock = ONE_FLOCK): Actor {
  const groups = Math.max(1, Math.round(flock.groups));
  const sec = Math.max(0, (wallMs - startMs) / 1000);
  // character
  const wanderR = 1.5 + 2.5 * hash2(i, 1, 91);
  const walkShare = 0.45 + 0.35 * hash2(i, 2, 91);
  const segLen = 6 + 18 * hash2(i, 3, 91);
  const period = 60 + 120 * hash2(i, 4, 91);
  // flock of an epoch: mostly its own, sometimes another
  const flockOf = (ep: number) => (ep < 0 || hash2(i, ep, 97) < 0.65 ? i % groups : Math.floor(hash2(i, ep, 101) * groups) % groups);
  const ep = Math.floor(sec / period);
  const [ax, az] = flockCentre(flockOf(ep - 1), groups, flock.spread, sec);
  const [bx, bz] = flockCentre(flockOf(ep), groups, flock.spread, sec);
  const tr = Math.min(1, (sec - ep * period) / 12);
  const m = ep === 0 ? 1 : tr * tr * (3 - 2 * tr);
  const cx = ax + (bx - ax) * m, cz = az + (bz - az) * m;
  // its own path, advanced only while walking
  const p = walkedSeconds(i, sec, segLen, walkShare) * 0.07;
  const ox = (noise1(p, i * 2 + 1) * 2 - 1) * wanderR + (noise1(p * 2.7, i * 2 + 5) * 2 - 1) * 0.6;
  const oz = (noise1(p, i * 2 + 2) * 2 - 1) * wanderR + (noise1(p * 2.7, i * 2 + 6) * 2 - 1) * 0.6;
  const off = Math.max(0, flock.timeSpread !== undefined ? playerOffset + botTimeOffset(i, startMs, flock.timeSpread) : playerOffset - 20 + ((i * 7) % 25));
  return { o: `bot${i}`, r: role, x: cx + ox, z: cz + oz, s: sessionSeconds(wallMs, epochMs, off) };
}
