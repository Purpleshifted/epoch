/**
 * parliament/visitorAlign.ts
 *
 * THE WALL LINES UP WITH THE VISITOR (someone's feedback, relayed by the artist, 2026-11-02: rather than elaborate camera
 * moves, once a visitor plays and their marker is up, the wall's direction and the phone's movement should line up, so
 * "what I do is reflected there" is unmistakable). Only the direction turns and the look point drifts after the marker:
 * the distance and the height angle stay as saved, the wall keeps seeing the world from far away.
 *
 * Direction: the visitor's direction of travel, from their presence samples (the log carries positions only). Forward on
 * the phone (sin yaw, cos yaw) is then "up" on the wall: the camera stands opposite the direction of travel. Standing
 * still keeps the last direction; turning on the spot is not seen.
 *
 * One camera, so one visitor at a time: whoever moved first holds it; while others are moving too it passes on after
 * `holdSec`; a visitor who has not moved for `idleSec` lets it go. Bots never hold it. Owners already in the log when the
 * view opens count only once they send something new.
 *
 * Moves are critically damped (no jump in speed at either end), because samples arrive in steps: one a second from a tab,
 * a few seconds' worth at once through the server. Pure and unit-tested; the camera work is in StageCamera.
 */

import { wrapDelta } from "./world";

export interface AlignConfig {
  /** A visitor who has not moved for this long lets the camera go. */
  idleSec: number;
  /** With others moving too, the camera passes on after this long. */
  holdSec: number;
  /** Time constant of turning to the direction of travel (seconds). */
  turnSec: number;
  /** Fastest turn (degrees a second): a visitor turning back must not whirl a whole wall. */
  maxDegPerSec: number;
  /** Time constant of the look point following the marker (seconds); 0 = the look point stays. */
  lookSec: number;
}

export const DEFAULT_ALIGN: AlignConfig = { idleSec: 20, holdSec: 30, turnSec: 2.5, maxDegPerSec: 30, lookSec: 3 };

/** Distance (world units) a visitor must cover before it counts as movement with a direction: samples wobble below it. */
export const MIN_STEP = 1.5;
/** A visitor unheard of for this many `idleSec` is forgotten. */
const FORGET_IDLES = 10;
const DEG = Math.PI / 180;

export interface VisitorTrack {
  id: string;
  /** Where the latest sample is. */
  x: number;
  z: number;
  /** Where the last counted movement ended. */
  ax: number;
  az: number;
  /** Radians, as the phone's yaw (forward = sin, cos); null until they have moved. */
  heading: number | null;
  /** Wall ms: the last counted movement, the last sample, the first movement, the last time it held the camera. */
  movedAt: number;
  heardAt: number;
  startedAt: number;
  heldAt: number;
}

interface EventLike {
  id: string;
  o: string;
  k: string;
  x: number;
  z: number;
}

export function isBotId(id: string): boolean {
  return id.startsWith("bot");
}

/** Who holds the wall's camera, from the log's new events. */
export class VisitorTracker {
  readonly tracks = new Map<string, VisitorTrack>();
  holder: VisitorTrack | null = null;
  /** Wall ms the holder took the camera. */
  heldSince = 0;
  /** Moving visitors other than the holder. */
  waiting = 0;
  private lastId: string | null = null;
  private primed = false;

  /** The log in arrival order; call it often, only what is new is read. */
  feed(events: readonly EventLike[], nowMs: number): void {
    const n = events.length;
    if (!this.primed) {
      this.primed = true;
      this.lastId = n ? events[n - 1].id : null;
      return;
    }
    if (!n) {
      this.lastId = null;
      return;
    }
    if (events[n - 1].id === this.lastId) return;
    let start = n;
    while (start > 0 && events[start - 1].id !== this.lastId) start--;
    // the last one seen is gone (a new world): everything now in the log is old news, as when the view opened
    if (start === 0 && this.lastId !== null) {
      this.lastId = events[n - 1].id;
      return;
    }
    for (let i = start; i < n; i++) {
      const e = events[i];
      if (e.k !== "p" || isBotId(e.o)) continue;
      this.sample(e, nowMs);
    }
    this.lastId = events[n - 1].id;
  }

  private sample(e: EventLike, nowMs: number): void {
    const t = this.tracks.get(e.o);
    if (!t) {
      this.tracks.set(e.o, { id: e.o, x: e.x, z: e.z, ax: e.x, az: e.z, heading: null, movedAt: -Infinity, heardAt: nowMs, startedAt: Infinity, heldAt: -Infinity });
      return;
    }
    t.x = e.x;
    t.z = e.z;
    t.heardAt = nowMs;
    // round the torus: walking over the world's edge is a small step, not a turn back
    const dx = wrapDelta(e.x - t.ax);
    const dz = wrapDelta(e.z - t.az);
    if (Math.hypot(dx, dz) < MIN_STEP) return;
    t.heading = Math.atan2(dx, dz);
    t.ax = e.x;
    t.az = e.z;
    t.movedAt = nowMs;
    if (t.startedAt === Infinity) t.startedAt = nowMs;
  }

  /** Decides who holds the camera now. */
  update(nowMs: number, cfg: Pick<AlignConfig, "idleSec" | "holdSec">): VisitorTrack | null {
    const idleMs = cfg.idleSec * 1000;
    const moving = (t: VisitorTrack) => t.heading !== null && nowMs - t.movedAt <= idleMs;
    let next: VisitorTrack | null = null;
    let waiting = 0;
    for (const t of this.tracks.values()) {
      if (t === this.holder) continue;
      if (nowMs - t.heardAt > idleMs * FORGET_IDLES) {
        this.tracks.delete(t.id);
        continue;
      }
      if (!moving(t)) continue;
      waiting++;
      // whoever has waited longest: never held before held, then the earliest to start
      if (!next || t.heldAt < next.heldAt || (t.heldAt === next.heldAt && t.startedAt < next.startedAt)) next = t;
    }
    let h = this.holder;
    if (h && !moving(h)) h = null;
    if (h && next && nowMs - this.heldSince >= cfg.holdSec * 1000) {
      h.heldAt = nowMs;
      h = null;
    }
    if (!h && this.holder) this.holder.heldAt = nowMs;
    if (!h && next) {
      h = next;
      this.heldSince = nowMs;
      waiting--;
    }
    this.holder = h;
    this.waiting = waiting;
    return h;
  }
}

/** The camera's azimuth (degrees, position − target = sin az, cos az) that shows a heading as "up": it stands behind. */
export function azimuthBehind(headingRad: number): number {
  return headingRad / DEG + 180;
}

/** The shortest signed way between two angles (degrees): (−180, 180]. */
export function shortestDeg(d: number): number {
  const m = ((d % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
}

export interface Damped {
  value: number;
  speed: number;
}

/** Moves `d` towards `goal`: critically damped, time constant `tau`, at most `maxSpeed`. No allocation. */
export function dampTo(d: Damped, goal: number, tau: number, maxSpeed: number, dt: number): void {
  if (!(tau > 0)) {
    d.value = goal;
    d.speed = 0;
    return;
  }
  const w = 2 / tau;
  const x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const lim = maxSpeed * tau;
  const change = Math.max(-lim, Math.min(lim, d.value - goal));
  const g = d.value - change;
  const t = (d.speed + w * change) * dt;
  d.speed = (d.speed - w * t) * e;
  d.value = g + (change + t) * e;
}

/** What the camera is doing while aligned: the angle and the look point, each with its own speed. */
export interface AlignMotion {
  az: Damped;
  x: Damped;
  z: Damped;
}

export function createAlignMotion(): AlignMotion {
  return { az: { value: 0, speed: 0 }, x: { value: 0, speed: 0 }, z: { value: 0, speed: 0 } };
}

/** Fastest the look point moves (world units a second): a visitor over the world's edge crosses the frame, not jumps. */
const MAX_LOOK_SPEED = 60;

/**
 * One frame. `az` and the look point are where the camera is now; `azGoal` null = no direction to turn to (nobody holds
 * the camera: the turn's speed runs out). The motion's values afterwards are where it should be.
 */
export function stepAlign(m: AlignMotion, az: number, lookX: number, lookZ: number, azGoal: number | null, lookGoalX: number, lookGoalZ: number, cfg: Pick<AlignConfig, "turnSec" | "maxDegPerSec" | "lookSec">, dt: number): void {
  m.az.value = az;
  m.x.value = lookX;
  m.z.value = lookZ;
  // the goal taken the short way round from where the camera is
  dampTo(m.az, azGoal === null ? az : az + shortestDeg(azGoal - az), cfg.turnSec, cfg.maxDegPerSec, dt);
  dampTo(m.x, lookGoalX, cfg.lookSec, MAX_LOOK_SPEED, dt);
  dampTo(m.z, lookGoalZ, cfg.lookSec, MAX_LOOK_SPEED, dt);
}
