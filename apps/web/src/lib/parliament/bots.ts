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
  /**
   * MOVING FLOCKS (the artist, 2026-11-01 evening): each flock stays at a place this many minutes on average, then the
   * whole flock moves to a new place — the bots leaving one by one over `overlapSec`, so the old place and the new one
   * are both in use for a while (a building still counts its visitors of the last minutes). 0 / absent = the flocks keep
   * their places (the old behaviour).
   */
  stayMin?: number;
  /** Seconds over which a flock's bots leave for the new place (staggered). */
  overlapSec?: number;
  /**
   * With moving flocks: how many places a flock keeps coming back to, always in the same order, as a flyway has its
   * stopovers (the artist, 2026-11-09: a place is what is returned to, a species what returns). 0 = somewhere new each time.
   */
  stopovers?: number;
  /**
   * FLOCK CHARACTER (0 = all the same, the old behaviour … 1 = very different): per flock, by its own hash, how close
   * the bots keep (wander radius ×0.4 … ×1.8), how much they walk, and — with moving flocks — how long it stays at a
   * place (×0.5 … ×2): a close, staying flock builds a tall narrow tower; a loose, restless one leaves wide low ones.
   */
  character?: number;
}

export const ONE_FLOCK: Flock = { groups: 1, spread: 0 };
/** Flock.stopovers on the wall, and for the bots that go on with no wall open, when nothing has been saved. */
export const STOPOVERS_DEFAULT = 5;

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

/**
 * Where each bot's count stood. A world that runs for weeks would otherwise count every segment from the start again, for
 * every bot at every sample; the sum is the same, added up in the same order.
 */
const walkedSoFar = new Map<number, { segLen: number; walkShare: number; s: number; walked: number }>();

/** Seconds of the walking segments of bot i before `sec` (bots alternate walking and standing still). */
export function walkedSeconds(i: number, sec: number, segLen: number, walkShare: number): number {
  const s = Math.floor(sec / segLen);
  let m = walkedSoFar.get(i);
  if (!m || m.segLen !== segLen || m.walkShare !== walkShare || m.s > s) {
    m = { segLen, walkShare, s: 0, walked: 0 };
    walkedSoFar.set(i, m);
  }
  for (let k = m.s; k < s; k++) if (hash2(i, k, 83) < walkShare) m.walked += segLen;
  m.s = s;
  return hash2(i, s, 83) < walkShare ? m.walked + (sec - s * segLen) : m.walked;
}

/** Where bot i is heading at wall time `wallMs` (botActor's parts): from flock centre A to B (m = 0 … 1), plus its own
 * wandering offset. Away from a migration A = B and m = 1. */
export interface BotPlan {
  /** The migration this belongs to (its epoch index), for caching a route per migration. */
  ep: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  m: number;
  ox: number;
  oz: number;
  s: number;
}

/** A flock's character (Flock.character): multipliers on the wander radius and the stay, a shift of the walking share. */
function flockCharacter(g: number, c: number): { r: number; walk: number; stay: number } {
  if (!(c > 0)) return { r: 1, walk: 0, stay: 1 };
  return { r: 1 + c * (hash2(g, 1, 131) * 1.4 - 0.6), walk: c * (hash2(g, 2, 131) - 0.5) * 0.4, stay: 1 + c * (hash2(g, 3, 131) * 1.5 - 0.5) };
}

/**
 * Centre of flock g at `sec` for a bot that leaves `delay` seconds after the flock's move begins (Flock.stayMin): the
 * flock's n-th place is drawn from its own hash within the spread; between places the bot walks over in ~12 s.
 * Without stayMin it is flockCentre (fixed places).
 */
function flockPlace(g: number, groups: number, flock: Flock, sec: number, delay: number): [number, number] {
  const stayMin = flock.stayMin ?? 0;
  if (!(stayMin > 0) || !(flock.spread > 0)) return flockCentre(g, groups, flock.spread, sec);
  const stay = stayMin * 60 * flockCharacter(g, flock.character ?? 0).stay;
  const u = sec - delay + hash2(g, 4, 131) * stay;
  const n = Math.floor(u / stay);
  const stops = Math.round(flock.stopovers ?? 0);
  const place = (nth: number): [number, number] => {
    if (nth <= 0) return flockCentre(g, groups, flock.spread, sec);
    const k = stops > 0 ? ((nth - 1) % stops) + 1 : nth;
    const a = hash2(g * 977 + k, 5, 131) * Math.PI * 2;
    const r = flock.spread * Math.sqrt(hash2(g * 977 + k, 6, 131));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const [ax, az] = place(n - 1), [bx, bz] = place(n);
  const tr = Math.min(1, Math.max(0, (u - n * stay) / 12));
  const m = tr * tr * (3 - 2 * tr);
  return [ax + (bx - ax) * m, az + (bz - az) * m];
}

export function botPlan(i: number, wallMs: number, startMs: number, epochMs: number, playerOffset: number, flock: Flock = ONE_FLOCK): BotPlan {
  const groups = Math.max(1, Math.round(flock.groups));
  const sec = Math.max(0, (wallMs - startMs) / 1000);
  const ch = flockCharacter(i % groups, flock.character ?? 0);
  // character (its own, then its flock's)
  const wanderR = (1.5 + 2.5 * hash2(i, 1, 91)) * ch.r;
  const walkShare = Math.max(0.15, Math.min(0.9, 0.45 + 0.35 * hash2(i, 2, 91) + ch.walk));
  const segLen = 6 + 18 * hash2(i, 3, 91);
  const period = 60 + 120 * hash2(i, 4, 91);
  // flock of an epoch: mostly its own, sometimes another
  const flockOf = (ep: number) => (ep < 0 || hash2(i, ep, 97) < 0.65 ? i % groups : Math.floor(hash2(i, ep, 101) * groups) % groups);
  const ep = Math.floor(sec / period);
  // with moving flocks each bot leaves for the new place a little later than the last (staggered over overlapSec)
  const delay = (flock.stayMin ?? 0) > 0 ? hash2(i, 7, 131) * Math.max(0, flock.overlapSec ?? 60) : 0;
  const [ax, az] = flockPlace(flockOf(ep - 1), groups, flock, sec, delay);
  const [bx, bz] = flockPlace(flockOf(ep), groups, flock, sec, delay);
  const tr = Math.min(1, (sec - ep * period) / 12);
  const m = ep === 0 ? 1 : tr * tr * (3 - 2 * tr);
  // its own path, advanced only while walking
  const p = walkedSeconds(i, sec, segLen, walkShare) * 0.07;
  const ox = (noise1(p, i * 2 + 1) * 2 - 1) * wanderR + (noise1(p * 2.7, i * 2 + 5) * 2 - 1) * 0.6;
  const oz = (noise1(p, i * 2 + 2) * 2 - 1) * wanderR + (noise1(p * 2.7, i * 2 + 6) * 2 - 1) * 0.6;
  const off = Math.max(0, flock.timeSpread !== undefined ? playerOffset + botTimeOffset(i, startMs, flock.timeSpread) : playerOffset - 20 + ((i * 7) % 25));
  return { ep, ax, az, bx, bz, m, ox, oz, s: sessionSeconds(wallMs, epochMs, off) };
}

/**
 * Bot i at wall time `wallMs`, a pure function of (wallMs − startMs) so a throttled tab emits the same samples:
 *   WALK / STAND   it alternates walking and standing still (segments of 6–24 s, 45–80 % walking: its character)
 *   WANDER         while walking it follows its own noise path around its flock's centre (radius 1.5–4)
 *   MIGRATE        every 1–3 min it may move on to another flock, walking over in ~12 s
 * It lives around the player's time slot (see Flock.timeSpread; some a little ahead, invisible to the player at first).
 */
export function botActor(i: number, role: RoleId, wallMs: number, startMs: number, epochMs: number, playerOffset: number, flock: Flock = ONE_FLOCK): Actor {
  const b = botPlan(i, wallMs, startMs, epochMs, playerOffset, flock);
  const cx = b.ax + (b.bx - b.ax) * b.m, cz = b.az + (b.bz - b.az) * b.m;
  return { o: `bot${i}`, r: role, x: cx + b.ox, z: cz + b.oz, s: b.s };
}

/** A bot asked to stay is held no longer than this from now (s), whatever a phone says. */
export const ASK_STAY_MAX_SEC = 15;

/**
 * ASKED TO STAY (the artist, 2026-11-10: "I walk to a bot and it has moved on; whoever speaks to me must not walk away" —
 * "only the one who speaks, for a while, to give the visitor time to respond"): a bot whose question to a visitor is
 * open (`until`, told by that visitor's phone over the marker relay) stays where it was last, and goes back to its
 * flock's plan when the time is up. Nobody else is held.
 */
export function stayWhileAsked(plan: { x: number; z: number }, last: { x: number; z: number } | undefined, until: number | undefined, now: number): { x: number; z: number } {
  return last && until !== undefined && now < Math.min(until, now + ASK_STAY_MAX_SEC) ? last : plan;
}
