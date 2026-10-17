/**
 * parliament/intake.ts — the frame around one life in the player view (V2): the steps before the role is drawn (the
 * notices, a consent with only yes, the headset, a choice the slot then ignores), the verdict after the draw, the ways
 * a life ends, and the cause of death written on the end screen.
 *
 * Pure: functions of elapsed seconds, key codes and the session's record. The state machine is
 * components/parliament/useLifeSession.ts; the words are script.ts; the rules are in docs/session-logic.md.
 */

import { SESSION_ROLES } from "./session";
import type { RoleId } from "./types";
import type { Surface } from "./witness";

// ── timing ───────────────────────────────────────────────────────────────────

/** A notice page's lines come on one after another, this many seconds apart (hard cuts, no typing effect). */
export const NOTICE_LINE_SEC = 0.6;
/** The verdict (requested / assigned) stays this long before the life begins. */
export const VERDICT_SEC = 4;
/** No input for this long before the life (notices, consent, headset, choice): back to the title screen. */
export const IDLE_AFTER_SEC = 45;
/** The end screen, once SPACE is allowed, returns to the title screen by itself after this long. */
export const END_RETURN_SEC = 90;
/** Two gestures closer than this count as one (a tap fires pointerdown and touchend; a held key repeats). */
export const GESTURE_GAP_MS = 300;

// ── the steps before the draw ────────────────────────────────────────────────

export const INTAKE_PHASES = ["notice", "consent", "headset", "choose"] as const;
export type IntakePhase = (typeof INTAKE_PHASES)[number];

/** The step after `p`; after the choice comes the draw. */
export function nextIntake(p: IntakePhase): IntakePhase | "draw" {
  const i = INTAKE_PHASES.indexOf(p);
  return i < 0 || i === INTAKE_PHASES.length - 1 ? "draw" : INTAKE_PHASES[i + 1];
}

/** How many of a page's `total` lines are up `elapsedSec` after the page began (the first at once). */
export function linesShown(total: number, elapsedSec: number, lineSec = NOTICE_LINE_SEC): number {
  if (total <= 0) return 0;
  const n = Math.floor(Math.max(0, elapsedSec) / Math.max(0.001, lineSec)) + 1;
  return Math.min(total, n);
}

/** All of a page's lines are up: a gesture may turn the page. */
export function pageDone(total: number, elapsedSec: number, lineSec = NOTICE_LINE_SEC): boolean {
  return linesShown(total, elapsedSec, lineSec) >= total;
}

/** The role a key chooses on the choice screen: 1 … 4 (main row or numpad) in the order of the roles; null = none. */
export function roleForKey(code: string, roles: readonly RoleId[] = SESSION_ROLES): RoleId | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < roles.length ? roles[i] : null;
}

/** Move the highlight on the choice screen; from nothing highlighted (-1), right goes to the first, left to the last. */
export function moveCursor(cursor: number, dir: -1 | 1, n: number): number {
  if (n <= 0) return -1;
  if (cursor < 0) return dir > 0 ? 0 : n - 1;
  return (((cursor + dir) % n) + n) % n;
}

// ── the verdict ──────────────────────────────────────────────────────────────

export type Verdict = "lucky" | "unlucky";

/** The slot does not look at the choice: the verdict only says whether it happened to agree. */
export function verdictOf(wanted: RoleId | null, drawn: RoleId): Verdict {
  return wanted !== null && wanted === drawn ? "lucky" : "unlucky";
}

// ── how a life ends ──────────────────────────────────────────────────────────

/** `lifespan`: the lifespan ran out. `self`: the visitor stopped living (worker only), and it succeeded. */
export type EndedBy = "lifespan" | "self";

/** B — stopping living (worker only): the visitor holds a key this long … */
export const HOLD_SEC = 3;
/** … then may try again this long after a failed attempt. */
export const COOLDOWN_SEC = 20;
/** The hint for it only appears this long into the life. */
export const HINT_AFTER_SEC = 20;
/** The line after a failed attempt stays this long (s). */
export const FAIL_MSG_SEC = 4;

/** Whether an attempt to stop living succeeds: u in [0,1) against the success probability p. */
export function attemptEnd(u: number, p: number): boolean {
  const q = Math.min(1, Math.max(0, p));
  return q > 0 && u < q;
}

/** How far a hold that began at `startMs` has got by `nowMs` (0 … 1; 1 = the attempt is made). */
export function holdProgress(nowMs: number, startMs: number, holdSec = HOLD_SEC): number {
  return Math.min(1, Math.max(0, (nowMs - startMs) / 1000 / Math.max(0.001, holdSec)));
}

/** Whether stopping living is on offer: a worker, far enough into the life, and no cooldown running. */
export function stopAllowed(role: RoleId | null, tSec: number, nowMs: number, cooldownUntilMs: number): boolean {
  return role === "worker" && tSec >= HINT_AFTER_SEC && nowMs >= cooldownUntilMs;
}

// ── the cause of death ───────────────────────────────────────────────────────

export type CauseId =
  | "suicide"
  | "overwork"
  | "lonely"
  | "traffic"
  | "illness"
  | "cardiac"
  | "roadkill"
  | "starved"
  | "cold"
  | "captured"
  | "collision"
  | "abandoned"
  | "seized"
  | "scrapped"
  | "felled"
  | "road"
  | "lightning"
  | "withered"
  | "blight";

/** The causes each role can die of (the end screen's words are in script.ts). */
export const CAUSES_OF: Record<RoleId, readonly CauseId[]> = {
  worker: ["suicide", "overwork", "lonely", "traffic", "illness", "cardiac"],
  cat: ["roadkill", "starved", "cold", "captured", "illness"],
  car: ["collision", "abandoned", "seized", "scrapped"],
  tree: ["felled", "road", "lightning", "withered", "blight"],
  shepherd: ["illness"],
  wolf: ["illness"],
  warrior: ["illness"],
};

/** What the record of a life says at its end (witness.ts totals, and how it ended). */
export interface LifeRecord {
  /** The lifespan (s): what the ratios below are over. */
  lifeSec: number;
  /** Seconds the visitor stood still. */
  stillSec: number;
  /** Seconds someone was near. */
  nearSec: number;
  /** How many others came near over the life. */
  met: number;
  /** … by their role. */
  metByRole: Partial<Record<RoleId, number>>;
  /** The ground underfoot at the end. */
  surface: Surface;
  endedBy: EndedBy;
}

/**
 * The cause of death, from what the visitor did: the first rule that fits, from the top; where two causes fit
 * equally, u (drawn once per session) picks. Every answer is in CAUSES_OF[role].
 */
export function causeOfDeath(role: RoleId, rec: LifeRecord, u: number): CauseId {
  if (rec.endedBy === "self") return "suicide";
  const life = Math.max(1, rec.lifeSec);
  const still = Math.min(1, Math.max(0, rec.stillSec) / life);
  const near = Math.min(1, Math.max(0, rec.nearSec) / life);
  const by = (r: RoleId) => rec.metByRole[r] ?? 0;
  const pick = <A extends CauseId, B extends CauseId>(a: A, b: B): A | B => (u < 0.5 ? a : b);
  switch (role) {
    case "worker":
      if (still >= 0.6 && near >= 0.4 && rec.surface === "sealed") return "overwork";
      if (rec.met === 0) return "lonely";
      if (still <= 0.3 && rec.surface === "trodden") return "traffic";
      return pick("illness", "cardiac");
    case "cat":
      if (rec.surface === "trodden" && by("car") >= 1) return "roadkill";
      if (rec.met === 0 && still <= 0.3) return "starved";
      if (rec.surface === "open" && still >= 0.6) return "cold";
      if (by("worker") >= 3) return "captured";
      return "illness";
    case "car":
      if (still <= 0.3 && near >= 0.4) return "collision";
      if (still >= 0.6 && rec.met === 0) return "abandoned";
      if (rec.surface === "sealed" && by("worker") >= 1) return "seized";
      return "scrapped";
    case "tree":
      if (by("worker") >= 3 || rec.surface === "sealed") return "felled";
      if (rec.surface === "trodden") return "road";
      if (rec.surface === "open" && rec.met === 0) return "lightning";
      return pick("withered", "blight");
    default:
      return "illness";
  }
}
