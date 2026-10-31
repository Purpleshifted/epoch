/**
 * parliament/cameraShots.ts
 *
 * THE WALL'S AUTOMATIC SHOTS (the artist, 2026-10-31: "not one fixed angle — sometimes the whole fossil, sometimes the
 * view from above"). Pure functions; the exhibition camera (ParliamentSpace's StageCamera) calls `stepShotDriver` every
 * frame and writes the result into OrbitControls. The plan and the reasons: docs/camera-motion.md.
 *
 *   - A shot is a pose RELATIVE TO THE FOLLOWED FOCUS (the present's time height): the distance, the polar angle, where
 *     it looks (x · z), the lift added to the focus height, and a factor on the turn speed. No azimuth per shot: the turn
 *     is one continuous function of time (§3.2) and the shots change the rest.
 *   - The sequence is a cycle: hold(base) → fade → hold(shot 1) → fade → … → hold(last) → fade → the base again. WHERE
 *     in the cycle is decided by the clock (seconds since SHOT_CLOCK_T0), so a reload lands at the same place and
 *     nothing accumulates over hours.
 *   - Blends: a quintic ease (zero speed and zero acceleration at both ends), the distance on a log scale (a constant
 *     zoom rate), the rest linear.
 *   - The driver shows the clock's pose exactly; after a disruption (the first frame after a drag, a stalled frame, the
 *     run switched on) it keeps the camera where it is and lets the difference decay (time constant SETTLE_SEC), so the
 *     landscape never jumps.
 *   - Nothing here allocates per frame: results are written into objects the driver keeps.
 */

/** A pose relative to the followed focus. `turn` multiplies the base turn speed (1 = as the "한 바퀴" setting). */
export interface ShotPose {
  dist: number;
  /** Degrees: 0 = straight above, 90 = the horizon (V2 allows past 90: from below). */
  polar: number;
  lookX: number;
  lookZ: number;
  /** Added to the focus's time height: the target's y. */
  lift: number;
  turn: number;
}

export interface Shot extends ShotPose {
  /** The Leva number (0 = the base pose), for the status line. */
  id: number;
  holdSec: number;
}

export interface Sequence {
  /** The base pose — always in the cycle (the "전시 카메라" sliders). */
  base: Shot;
  /** The extra shots, in order; only the enabled ones (the caller filters). */
  shots: readonly Shot[];
  /** One transition, seconds (shared by every fade). */
  fadeSec: number;
}

/** Where the cycle is: holding `from` (k = 0, to = from) or fading `from` → `to` (k = the eased 0…1). */
export interface Cursor {
  from: number;
  to: number;
  k: number;
  /** Seconds left in this hold or fade. */
  left: number;
  /** The segment's index in the cycle (2i = hold of shot i, 2i + 1 = the fade out of it); −1 = none yet. */
  seg: number;
}

/** 2026-01-01T00:00:00Z in seconds: the sequence's time origin (keeps the clock small for the arithmetic). */
export const SHOT_CLOCK_T0 = 1_767_225_600;
/** Time constant of the catch-up after a disruption, seconds. */
export const SETTLE_SEC = 1.5;
/** A frame longer than this was a stall: the camera stays where it was and catches up (no jump). */
export const STALL_SEC = 0.25;
/** The polar angle is kept off the pole (OrbitControls' up vector is the time axis — at 0 the direction is undefined). */
export const MIN_POLAR_DEG = 0.5;

export const DEG = Math.PI / 180;

/** Seconds on the sequence's clock. */
export function clockSec(nowMs: number): number {
  return nowMs / 1000 - SHOT_CLOCK_T0;
}

export function shotCount(seq: Sequence): number {
  return 1 + seq.shots.length;
}

export function shotOf(seq: Sequence, i: number): Shot {
  return i === 0 ? seq.base : seq.shots[i - 1];
}

/** One cycle, seconds: every hold plus one fade per shot. With no extra shot there is no cycle (the base, held). */
export function cycleSec(seq: Sequence): number {
  const n = shotCount(seq);
  if (n < 2) return Math.max(1, seq.base.holdSec);
  let s = n * Math.max(0, seq.fadeSec);
  for (let i = 0; i < n; i++) s += Math.max(0, shotOf(seq, i).holdSec);
  return Math.max(1, s);
}

/** Quintic ease: 6x⁵ − 15x⁴ + 10x³ — zero speed and acceleration at 0 and 1. */
export function ease5(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** ∫₀ˣ ease5 = x⁶ − 3x⁵ + 2.5x⁴ (so the turn's azimuth is a closed form across a fade). */
export function ease5Integral(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 0.5;
  const x4 = x * x * x * x;
  return x4 * (x * (x - 3) + 2.5);
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** Into (−180, 180]. */
export function wrapDeg(d: number): number {
  const w = mod(d + 180, 360) - 180;
  return w === -180 ? 180 : w;
}

/** Where the cycle is at clock second `t`, written into `out`. */
export function locate(seq: Sequence, t: number, out: Cursor): Cursor {
  const n = shotCount(seq);
  if (n < 2) {
    out.from = out.to = 0;
    out.k = 0;
    out.left = Infinity;
    out.seg = 0;
    return out;
  }
  const fade = Math.max(0, seq.fadeSec);
  let u = mod(t, cycleSec(seq));
  for (let i = 0; i < n; i++) {
    const hold = Math.max(0, shotOf(seq, i).holdSec);
    if (u < hold) {
      out.from = out.to = i;
      out.k = 0;
      out.left = hold - u;
      out.seg = 2 * i;
      return out;
    }
    u -= hold;
    if (u < fade) {
      out.from = i;
      out.to = (i + 1) % n;
      out.k = ease5(u / fade);
      out.left = fade - u;
      out.seg = 2 * i + 1;
      return out;
    }
    u -= fade;
  }
  // rounding at the very end of the cycle: the base, about to be held
  out.from = out.to = 0;
  out.k = 0;
  out.left = 0;
  out.seg = 0;
  return out;
}

/** a → b at eased k: the distance on a log scale, the rest linear. */
export function blendPose(a: ShotPose, b: ShotPose, k: number, out: ShotPose): ShotPose {
  if (k <= 0) {
    out.dist = a.dist;
    out.polar = a.polar;
    out.lookX = a.lookX;
    out.lookZ = a.lookZ;
    out.lift = a.lift;
    out.turn = a.turn;
    return out;
  }
  if (k >= 1) {
    out.dist = b.dist;
    out.polar = b.polar;
    out.lookX = b.lookX;
    out.lookZ = b.lookZ;
    out.lift = b.lift;
    out.turn = b.turn;
    return out;
  }
  const da = Math.max(1e-3, a.dist);
  const db = Math.max(1e-3, b.dist);
  out.dist = Math.exp(Math.log(da) + (Math.log(db) - Math.log(da)) * k);
  out.polar = a.polar + (b.polar - a.polar) * k;
  out.lookX = a.lookX + (b.lookX - a.lookX) * k;
  out.lookZ = a.lookZ + (b.lookZ - a.lookZ) * k;
  out.lift = a.lift + (b.lift - a.lift) * k;
  out.turn = a.turn + (b.turn - a.turn) * k;
  return out;
}

/**
 * ∫₀ᵗ (turn factor) dτ, seconds × factor: how far the turn has gone by clock second `t`, whole cycles in closed form
 * and the current one segment by segment (a fade's factor is the eased blend, whose integral is `ease5Integral`).
 */
export function turnIntegral(seq: Sequence, t: number): number {
  const n = shotCount(seq);
  if (n < 2) return t * seq.base.turn;
  const fade = Math.max(0, seq.fadeSec);
  const cycle = cycleSec(seq);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = shotOf(seq, i);
    const b = shotOf(seq, (i + 1) % n);
    total += Math.max(0, a.holdSec) * a.turn + fade * (a.turn + b.turn) * 0.5;
  }
  const cycles = Math.floor(t / cycle);
  let u = t - cycles * cycle;
  let acc = cycles * total;
  for (let i = 0; i < n && u > 0; i++) {
    const a = shotOf(seq, i);
    const b = shotOf(seq, (i + 1) % n);
    const hold = Math.max(0, a.holdSec);
    const h = Math.min(u, hold);
    acc += h * a.turn;
    u -= h;
    if (u <= 0) break;
    if (fade > 0) {
      const s = Math.min(u, fade) / fade;
      acc += fade * (a.turn * s + (b.turn - a.turn) * ease5Integral(s));
      u -= Math.min(u, fade);
    }
  }
  return acc;
}

/** The turn's direction at clock second `t`, degrees in [0, 360): `offsetDeg` + the integral of the factors. */
export function azimuthAt(seq: Sequence, t: number, turnSec: number, dir: 1 | -1, offsetDeg: number): number {
  if (turnSec <= 0) return mod(offsetDeg, 360);
  return mod(offsetDeg + (dir * 360 * turnIntegral(seq, t)) / turnSec, 360);
}

/** A shot's target must not go below the column's bottom (y 0): while the column is shallow the base stands in. */
export function eligible(shot: ShotPose, focusY: number | null): boolean {
  return focusY === null || focusY + shot.lift >= 0;
}

/** The camera on its sphere around the target (the convention of the "현재 시점 가져오기" button: azimuth from +z towards +x). */
export function placeCamera(target: { x: number; y: number; z: number }, dist: number, polarDeg: number, azDeg: number, out: { x: number; y: number; z: number }): void {
  const polar = polarDeg * DEG;
  const az = azDeg * DEG;
  const r = Math.max(1, dist);
  const sp = Math.sin(polar);
  out.x = target.x + r * sp * Math.sin(az);
  out.y = target.y + r * Math.cos(polar);
  out.z = target.z + r * sp * Math.cos(az);
}

/** The camera's pose as it is: the inverse of placeCamera, plus where it looks and its lift above `focusY`. */
export interface CameraState {
  dist: number;
  polar: number;
  az: number;
  lookX: number;
  lookZ: number;
  lift: number;
}

export function cameraStateOf(cam: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, focusY: number | null, fallbackLift: number, out: CameraState): CameraState {
  const dx = cam.x - target.x;
  const dy = cam.y - target.y;
  const dz = cam.z - target.z;
  const r = Math.max(1e-6, Math.hypot(dx, dy, dz));
  out.dist = r;
  out.polar = Math.acos(Math.min(1, Math.max(-1, dy / r))) / DEG;
  out.az = mod(Math.atan2(dx, dz) / DEG, 360);
  out.lookX = target.x;
  out.lookZ = target.z;
  out.lift = focusY === null ? fallbackLift : target.y - focusY;
  return out;
}

/** The driver's state: what it showed, the difference it is still settling, which shots are eligible. */
export interface ShotDriver {
  cursor: Cursor;
  want: ShotPose;
  /** What the camera shows this frame (dist, polar, az in degrees, look, lift). */
  shown: CameraState;
  err: CameraState;
  /** Eligibility (depth) per shot index, latched when the fade into the shot begins. */
  elig: boolean[];
  /** Whether the shot at the cursor's `to` was replaced by the base for depth. */
  fallback: boolean;
  primed: boolean;
}

export function createShotDriver(): ShotDriver {
  return {
    cursor: { from: 0, to: 0, k: 0, left: 0, seg: -1 },
    want: { dist: 1, polar: 90, lookX: 0, lookZ: 0, lift: 0, turn: 1 },
    shown: { dist: 1, polar: 90, az: 0, lookX: 0, lookZ: 0, lift: 0 },
    err: { dist: 0, polar: 0, az: 0, lookX: 0, lookZ: 0, lift: 0 },
    elig: [true, true, true, true, true, true, true, true],
    fallback: false,
    primed: false,
  };
}

export interface StepInput {
  seq: Sequence;
  /** Clock seconds (clockSec). */
  t: number;
  /** Seconds since the previous frame. */
  dt: number;
  turnSec: number;
  dir: 1 | -1;
  /** The "전시 카메라" azimuth: added to the turn. */
  azOffset: number;
  /** The followed focus's time height (null = not known yet). */
  focusY: number | null;
  maxPolar: number;
  /**
   * The camera's actual pose when this frame follows a disruption (a drag ended, the run was switched on, a stall):
   * the driver keeps the camera there and settles towards the clock's pose. Null = nothing happened.
   */
  resyncFrom: CameraState | null;
}

/**
 * One frame: the clock's pose (with the depth fallback latched per segment) plus the settling difference, written into
 * `d.shown`. The first frame snaps (no history to settle from).
 */
export function stepShotDriver(d: ShotDriver, inp: StepInput): CameraState {
  const { seq, t } = inp;
  const c = d.cursor;
  const prevSeg = c.seg;
  locate(seq, t, c);
  const n = shotCount(seq);
  if (c.seg !== prevSeg || n !== d.elig.length) {
    if (d.elig.length < n) for (let i = d.elig.length; i < n; i++) d.elig.push(true);
    if (prevSeg === -1 || c.seg === 0) d.elig[c.from] = eligible(shotOf(seq, c.from), inp.focusY);
    if (c.to !== c.from) d.elig[c.to] = eligible(shotOf(seq, c.to), inp.focusY);
  }
  const base = seq.base;
  const a = d.elig[c.from] !== false ? shotOf(seq, c.from) : base;
  const b = d.elig[c.to] !== false ? shotOf(seq, c.to) : base;
  d.fallback = c.to !== 0 && d.elig[c.to] === false; // the base stands in for itself without a word
  blendPose(a, b, c.k, d.want);
  const az = azimuthAt(seq, t, inp.turnSec, inp.dir, inp.azOffset);
  const w = d.want;
  const e = d.err;
  if (!d.primed) {
    e.dist = e.polar = e.az = e.lookX = e.lookZ = e.lift = 0;
    d.primed = true;
  } else if (inp.resyncFrom) {
    const r = inp.resyncFrom;
    e.dist = r.dist - w.dist;
    e.polar = r.polar - w.polar;
    e.az = wrapDeg(r.az - az);
    e.lookX = r.lookX - w.lookX;
    e.lookZ = r.lookZ - w.lookZ;
    e.lift = inp.focusY === null ? 0 : r.lift - w.lift;
  }
  const s = d.shown;
  s.dist = Math.max(1, w.dist + e.dist);
  s.polar = Math.min(inp.maxPolar, Math.max(MIN_POLAR_DEG, w.polar + e.polar));
  s.az = mod(az + e.az, 360);
  s.lookX = w.lookX + e.lookX;
  s.lookZ = w.lookZ + e.lookZ;
  s.lift = w.lift + e.lift;
  // the difference decays; a long frame (a stall) counts as a short one, so a stall does not wipe the settling
  const decay = Math.exp(-Math.min(inp.dt, 0.1) / SETTLE_SEC);
  e.dist *= decay;
  e.polar *= decay;
  e.az *= decay;
  e.lookX *= decay;
  e.lookZ *= decay;
  e.lift *= decay;
  return s;
}

/** Whether the settling difference is still visible (for tests and the status line). */
export function settled(d: ShotDriver): boolean {
  const e = d.err;
  return Math.abs(e.dist) < 0.05 && Math.abs(e.polar) < 0.05 && Math.abs(e.az) < 0.05 && Math.abs(e.lookX) < 0.05 && Math.abs(e.lookZ) < 0.05 && Math.abs(e.lift) < 0.05;
}

/** The status line on the rehearsal wall: which shot, how long, where next. */
export function shotStatus(seq: Sequence, d: ShotDriver): string {
  const c = d.cursor;
  const name = (i: number): string => {
    const s = shotOf(seq, i);
    return s.id === 0 ? "기본" : `샷 ${s.id}`;
  };
  if (shotCount(seq) < 2) return `자동 운행: ${name(0)}만 (켜진 샷 없음)`;
  const left = `${Math.ceil(c.left)} s`;
  const fb = d.fallback ? " · 바닥이 얕아 기본으로" : "";
  if (c.to === c.from) return `자동 운행: ${name(c.from)} (${left})${fb}`;
  return `자동 운행: ${name(c.from)} → ${name(c.to)} (${left})${fb}`;
}
