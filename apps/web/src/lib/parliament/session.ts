/**
 * parliament/session.ts — one visitor's session in the player view (V2): which role they are given, how long they
 * may stay, and how the end makes itself felt.
 *
 *   IDLE      nobody has touched the screen yet: the ground runs on (bots), the visitor leaves nothing
 *   NOTICE … CHOOSE   the frame before a life (intake.ts): what this is, a consent with only yes, the headset, a choice
 *   DRAW      the role slot spins through the roles and stops on the one drawn at random (`reelAt`) — the choice
 *             made before is not looked at (intake.ts `verdictOf` only says whether it happened to agree)
 *   VERDICT   requested / assigned, for a few seconds
 *   LIVE      the lifespan runs; in its last `warnSec` the cursor blinks faster, the sound goes dull and the
 *             controls stop answering properly (`lifeAt`, `hindrance`)
 *   ENDED     the lifespan is over: the visitor is taken off the ground, a dry end screen; SPACE starts the next
 *             session (a new visitor and a new draw)
 *
 * Pure: everything is a function of the elapsed seconds (and a few random numbers drawn once per session).
 */

import { hash2 } from "./nature";
import type { RoleId } from "./types";

/**
 * IDLE → the steps before the draw (intake.ts: NOTICE → CONSENT → HEADSET → CHOOSE) → DRAW → VERDICT → LIVE → ENDED.
 * The visitor is only present (traces, sound, controls) while LIVE; every other phase is dark and silent.
 */
export type SessionPhase = "idle" | "notice" | "consent" | "headset" | "choose" | "draw" | "verdict" | "live" | "ended";

/** The roles a session can be given (V2). */
export const SESSION_ROLES: readonly RoleId[] = ["worker", "cat", "car", "tree"];

/** How a role is written on screen (machine text, upper case). */
export const ROLE_TAG: Record<RoleId, string> = {
  worker: "WORKER",
  cat: "STREET CAT",
  car: "CAR",
  tree: "TREE",
  shepherd: "SHEPHERD",
  wolf: "WOLF",
  warrior: "WARRIOR",
};

/** u in [0,1) → one of `roles`, uniformly. */
export function assignRole(u: number, roles: readonly RoleId[] = SESSION_ROLES): RoleId {
  const n = roles.length;
  return roles[Math.min(n - 1, Math.max(0, Math.floor(u * n)))];
}

// ── the role slot ────────────────────────────────────────────────────────────

export interface ReelPlan {
  /** The labels the reel passes, in order; the last one is the drawn role. */
  labels: string[];
  /** Seconds the reel runs (it decelerates over all of it). */
  spinSec: number;
  /** When the last label comes up (s). */
  stopAt: number;
  /** After the stop, the label blinks this long (s), then holds. */
  flashSec: number;
}

/** Ease-out the reel follows: position (in labels) at t / spinSec. */
const reelPos = (f: number, last: number) => last * (1 - Math.pow(1 - Math.min(1, Math.max(0, f)), 3));

/**
 * A reel that runs through `roles` in a fixed order (like the strip of a slot machine), fast at first, slowing down,
 * and stops on `target` (drawn beforehand with assignRole). `frames` labels pass in all (more = faster at the start).
 */
export function planReel(target: RoleId, roles: readonly RoleId[] = SESSION_ROLES, spinSec = 3.2, frames = 26, flashSec = 0.7): ReelPlan {
  const n = roles.length;
  const ti = Math.max(0, roles.indexOf(target));
  const N = Math.max(2, Math.round(frames));
  // start so that frame N-1 lands on the target
  const start = (((ti - (N - 1)) % n) + n) % n;
  const labels: string[] = [];
  for (let k = 0; k < N; k++) labels.push(ROLE_TAG[roles[(start + k) % n]]);
  // the last label comes up where the (rounded) position reaches N-1: (1-f)^3 = 0.5 / (N-1)
  const stopAt = spinSec * (1 - Math.cbrt(0.5 / (N - 1)));
  return { labels, spinSec, stopAt, flashSec };
}

export interface ReelState {
  label: string;
  /** Index into plan.labels. */
  index: number;
  /** The reel has stopped on the drawn role. */
  stopped: boolean;
  /** Stopped, blinking finished: the role is fixed. */
  settled: boolean;
  /** Whether the label is lit (it blinks three times right after the stop). */
  lit: boolean;
}

export function reelAt(plan: ReelPlan, tSec: number): ReelState {
  const last = plan.labels.length - 1;
  const index = Math.min(last, Math.round(reelPos(tSec / plan.spinSec, last)));
  const stopped = index === last;
  const since = tSec - plan.stopAt;
  const settled = stopped && since >= plan.flashSec;
  const lit = !stopped || settled || Math.floor((Math.max(0, since) / plan.flashSec) * 6) % 2 === 1;
  return { label: plan.labels[index], index, stopped, settled, lit };
}

/** Total seconds of the draw (spin + blink). */
export const reelDuration = (plan: ReelPlan) => plan.stopAt + plan.flashSec;

// ── the lifespan ─────────────────────────────────────────────────────────────

export interface LifeConfig {
  /** Seconds a session lasts once the role is fixed. */
  lifeSec: number;
  /** The last seconds of it in which the end makes itself felt. */
  warnSec: number;
  /** Seconds the end screen stays before SPACE starts the next session. */
  endHoldSec: number;
  /** How fast the lifespan runs against the wall clock (1 = real time; more = for testing the end). */
  rate?: number;
}

export const DEFAULT_LIFE: LifeConfig = { lifeSec: 180, warnSec: 40, endHoldSec: 3, rate: 1 };

export interface LifeState {
  /** 0 (just arrived) … 1 (lifespan used up). */
  frac: number;
  /** Seconds left. */
  left: number;
  /** 0 … 1 over the last warnSec (accelerating: slow at first, then fast). */
  warn: number;
  over: boolean;
}

export function lifeAt(elapsedSec: number, cfg: LifeConfig = DEFAULT_LIFE): LifeState {
  const life = Math.max(1, cfg.lifeSec);
  const e = Math.max(0, elapsedSec);
  const warnSec = Math.min(life, Math.max(0, cfg.warnSec));
  const t = warnSec > 0 ? Math.min(1, Math.max(0, (e - (life - warnSec)) / warnSec)) : e >= life ? 1 : 0;
  return { frac: Math.min(1, e / life), left: Math.max(0, life - e), warn: t * t, over: e >= life };
}

/** The cursor's blink near the end: frequency (Hz) and the share of each cycle it is on. */
export function blinkAt(warn: number, baseHz = 1.2): { hz: number; duty: number } {
  const w = Math.min(1, Math.max(0, warn));
  return { hz: baseHz * (1 + 8 * w), duty: 0.6 - 0.25 * w };
}

/** Smooth 1D value noise, 0..1. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, seed, 131), b = hash2(i + 1, seed, 131);
  return a + (b - a) * u;
}

export interface Hindrance {
  /** Multiplies the speed the input asks for. */
  gain: number;
  /** Multiplies how quickly the body answers the input (the drag). */
  response: number;
  /** Multiplies the mouse-look sensitivity. */
  look: number;
  /** The input is lost right now (it drops out in bursts that grow longer near the end). */
  dropped: boolean;
}

/** How badly the controls answer at warning level `warn` (0 = normally) at time `tSec` (for the dropouts). */
export function hindrance(warn: number, tSec: number): Hindrance {
  const w = Math.min(1, Math.max(0, warn));
  const dropped = w > 0 && noise1(tSec * 2.6, 7) * 0.7 + noise1(tSec * 9.1, 11) * 0.3 < 0.62 * Math.pow(w, 1.3);
  return { gain: 1 - 0.6 * w, response: 1 - 0.8 * w, look: 1 - 0.6 * w, dropped };
}

/** 83 → "01:23" (minutes may exceed 59). */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
