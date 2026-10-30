/**
 * parliament/session.ts — one visitor's session in the player view (V2): which role they are given, how long they
 * may stay, and how the end makes itself felt.
 *
 *   IDLE      nobody has touched the screen yet: the ground runs on (bots), the visitor leaves nothing
 *   NOTICE … HEADSET   the frame before a life (intake.ts): what this is, a consent with only yes, the headset
 *   LIVE      the life begins at once after the headset — every visitor is the worker (2026-10-20: the choice, the
 *             slot and the verdict were taken out; only the worker has an effect on the ground). The lifespan runs;
 *             in its last `warnSec` the cursor blinks faster, the sound goes dull and the controls stop answering
 *             properly (`lifeAt`, `hindrance`)
 *   ENDED     the lifespan is over: the visitor is taken off the ground, a dry end screen; SPACE starts the next
 *             session (a new visitor)
 *
 * Pure: everything is a function of the elapsed seconds (and a few random numbers drawn once per session).
 */

import { hash2 } from "./nature";
import type { RoleId } from "./types";

/**
 * IDLE → the steps before the life (intake.ts: NOTICE → CONSENT → HEADSET) → LIVE → ENDED.
 * The visitor is only present (traces, sound, controls) while LIVE; every other phase is dark and silent.
 */
export type SessionPhase = "idle" | "notice" | "consent" | "headset" | "live" | "ended";

/** The roles of the V2 world: the visitor is always the worker; the bots take these in turn ("섞어서"). */
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
  /** The chance that a worker's attempt to stop living (intake.ts) succeeds — alone … */
  selfP?: number;
  /** … multiplied by this for every other being near at the time (intake.ts selfChance). */
  selfNearFactor?: number;
  /** The notices before a life: seconds between one line coming on and the next (intake.ts NOTICE_LINE_SEC). */
  noticeLineSec?: number;
  /** Stopping living (intake.ts has the defaults): how long X is held … */
  holdSec?: number;
  /** … from how many seconds into the life it is on offer (and the first banner comes) … */
  hintAfterSec?: number;
  /** … how often the banner returns, and for how long … */
  hintPeriodSec?: number;
  hintShowSec?: number;
  /** … and in how many last seconds of the life it is withdrawn. */
  stopLastSec?: number;
}

export const DEFAULT_LIFE: LifeConfig = { lifeSec: 180, warnSec: 40, endHoldSec: 3, rate: 1, selfP: 0.35 };

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
