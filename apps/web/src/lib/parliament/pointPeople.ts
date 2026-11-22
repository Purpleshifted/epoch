/**
 * parliament/pointPeople.ts — PEOPLE AS POINT SILHOUETTES (the artist, 2026-11-22: the personal view should feel like a
 * 길거리, "사람의 현실성이라기보단 풍경 같은 거 다 포함해서"; the references: criswvr Synthetic Urban 9, vinils' 4D captures —
 * a passer-by is a few hundred grey points in the shape of a walking body, not a square).
 *
 * Pure: a WALK CYCLE baked as points. A body of `height` metres faces +z; `frames` moments of one stride (left heel
 * strike → left heel strike) are sampled, each as the same `points` points: point i always sits on the same spot of the
 * same limb, so the GPU can blend two neighbouring frames (PointPeople.tsx reads the result as a float texture, one
 * row a frame). The walk is a PROCEDURAL skeleton — sine hips and shoulders, a knee that folds in the swing, a foot
 * that lifts, a small bob — no motion-capture file (one may replace `jointsAt` later; the layout stays).
 *
 * Points are handed out in a LOW-DISCREPANCY order over the limbs: any prefix of the point list is still a whole body
 * (a phone draws the first 200 of the 480 and loses detail, not a leg).
 */

import { hash2 } from "./nature";

export interface BodyConfig {
  /** Points a body is made of (all frames the same). */
  points: number;
  /** Moments of one stride. */
  frames: number;
  /** Height of the body (world units = metres). */
  height: number;
  /** Which hashed scatter of points on the limbs. */
  seed: number;
}

export const DEFAULT_BODY: BodyConfig = { points: 480, frames: 16, height: 1.7, seed: 1 };

/** Where the body's points go, and the share of the points each part gets (sums to 1). */
const PARTS = [
  { id: "head", share: 0.09 },
  { id: "torso", share: 0.3 },
  { id: "armUL", share: 0.06 },
  { id: "armUR", share: 0.06 },
  { id: "armLL", share: 0.05 },
  { id: "armLR", share: 0.05 },
  { id: "thighL", share: 0.1 },
  { id: "thighR", share: 0.1 },
  { id: "shinL", share: 0.08 },
  { id: "shinR", share: 0.08 },
  { id: "footL", share: 0.015 },
  { id: "footR", share: 0.015 },
] as const;
type PartId = (typeof PARTS)[number]["id"];

type V3 = [number, number, number];

/** The joints of a 1.7 m body at `phase` (0 … 1 of a stride), facing +z, the feet on y = 0. */
export interface Joints {
  pelvis: V3;
  shoulders: V3;
  head: V3;
  hipL: V3;
  hipR: V3;
  kneeL: V3;
  kneeR: V3;
  ankleL: V3;
  ankleR: V3;
  toeL: V3;
  toeR: V3;
  shL: V3;
  shR: V3;
  elbowL: V3;
  elbowR: V3;
  wristL: V3;
  wristR: V3;
}

const TAU = Math.PI * 2;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** A limb of length L hanging from `from`, swung forward (+z) by `angle` radians. */
const hang = (from: V3, L: number, angle: number): V3 => add(from, [0, -L * Math.cos(angle), L * Math.sin(angle)]);

/** `phi` wrapped into 0 … 2π. */
const wrap = (phi: number): number => ((phi % TAU) + TAU) % TAU;

/**
 * One leg at `phi` (radians; its thigh is forward-most at π/2 = heel strike, back-most at 3π/2 = toe-off). The knee
 * folds in the swing (the thigh coming forward, most as it passes under the body) and never quite locks in the stance;
 * the heel lifts towards toe-off and the toes hang in the swing.
 */
function leg(hip: V3, phi: number, thigh: number, shin: number, step = 0.4) {
  const theta = step * Math.sin(phi); // thigh forward (+) / back (−)
  const swing = Math.max(0, Math.sin(phi + 1.3)); // 1 in mid-swing, 0 through the stance
  const knee = 0.08 + 0.8 * Math.pow(swing, 1.6);
  const k = hang(hip, thigh, theta);
  const a0 = hang(k, shin, theta - knee);
  // the heel lifts through the last part of the stance (π → 3π/2), then the swing's own lift takes over
  const w = wrap(phi);
  const push = w > Math.PI && w < 1.5 * Math.PI + 0.35 ? Math.pow(Math.min(1, (w - Math.PI) / (0.5 * Math.PI)), 2) : 0;
  const a: V3 = [a0[0], a0[1] + 0.035 * push, a0[2]];
  // the foot: flat in the stance, toes down in the swing, up on the heel at push-off
  const toe: V3 = add(a, [0, -0.04 + 0.03 * swing - 0.03 * push, 0.2 - 0.05 * swing]);
  return { knee: k, ankle: a, toe };
}

/** One arm at `phi` (opposite to the leg of the same side): the elbow bends more as the arm comes forward. */
function arm(sh: V3, phi: number, upper: number, fore: number, swing = 0.3) {
  const alpha = swing * Math.sin(phi);
  const e = hang(sh, upper, alpha);
  const w = hang(e, fore, alpha + 0.35 + 0.3 * Math.max(0, Math.sin(phi)));
  return { elbow: e, wrist: w };
}

/** A point `d` across the body (x), turned by `yaw` about the vertical. */
const across = (c: V3, d: number, yaw: number): V3 => add(c, [d * Math.cos(yaw), 0, -d * Math.sin(yaw)]);

/**
 * The joints at `phase` (0 … 1), for a 1.7 m body (scaled by the caller). Besides the legs and arms: the pelvis turns
 * with the legs and sways towards the standing leg, the shoulders turn against it, the trunk leans a little forward,
 * the head rides steadier than the pelvis.
 */
/**
 * A WAY OF WALKING (the artist, 2026-11-22 night: "걷거나 하는 제스처도 다양해야 할듯. 지금보다 훨씬 더"): the stride's
 * amplitudes, the lean, the bounce — and `wave`, which is not a walk at all: standing, one arm raised and waving (the one
 * who asks me something: "말 걸 때도 지금 걷는거랑 동작이 같으니 와닿지 않아").
 */
export interface WalkStyle {
  /** The thigh's swing (rad), the arms' swing (rad), the trunk's forward lean (m), the bounce (m). */
  step: number;
  swing: number;
  lean: number;
  bob: number;
  /** Standing and waving instead of walking. */
  wave?: boolean;
}

export const WALK_STYLES: readonly WalkStyle[] = [
  { step: 0.4, swing: 0.3, lean: 0.035, bob: 0.02 }, // the plain walk
  { step: 0.5, swing: 0.45, lean: 0.08, bob: 0.03 }, // a hurried, leaning stride
  { step: 0.3, swing: 0.15, lean: 0.0, bob: 0.012 }, // a short, quiet step, arms still
  { step: 0.36, swing: 0.55, lean: -0.02, bob: 0.028 }, // a loose, swinging walk, a little back
];
export const WAVE_STYLE: WalkStyle = { step: 0, swing: 0, lean: 0.02, bob: 0, wave: true };

export function jointsAt(phase: number, style: WalkStyle = WALK_STYLES[0]): Joints {
  const phi = phase * TAU;
  const bob = style.bob * Math.cos(2 * phi); // highest twice a stride, at mid-stance
  const sway = (style.wave ? 0.006 : 0.018) * Math.sin(phi + 0.6); // the weight over the standing leg
  const pelvisYaw = (style.wave ? 0 : 0.13) * Math.sin(phi); // the left hip forward with the left leg
  const shoulderYaw = (style.wave ? 0.04 : -0.09) * Math.sin(phi); // against it
  const pelvis: V3 = [sway, 0.95 + bob, 0];
  const shoulders: V3 = [sway * 0.4, 1.45 + bob * 0.8, style.lean];
  const head: V3 = [sway * 0.2, 1.59 + bob * 0.5, style.lean + 0.01];
  const hipL = across(add(pelvis, [0, -0.02, 0]), -0.1, pelvisYaw);
  const hipR = across(add(pelvis, [0, -0.02, 0]), 0.1, pelvisYaw);
  const L = leg(hipL, phi, 0.44, 0.44, style.step);
  const R = leg(hipR, phi + Math.PI, 0.44, 0.44, style.step);
  const shL = across(shoulders, -0.19, shoulderYaw);
  const shR = across(shoulders, 0.19, shoulderYaw);
  if (style.wave) {
    // the wave: the right arm up and swinging from the elbow twice a cycle, the left hanging, the head a touch up
    const elbowR: V3 = add(shR, [0.1, 0.27, 0.08]);
    const wristR: V3 = add(elbowR, [0.18 * Math.sin(2 * phi), 0.24, 0.02]);
    const elbowL: V3 = add(shL, [0, -0.3, 0.02]);
    const wristL: V3 = add(elbowL, [0, -0.27, 0.04]);
    const feetL = leg(hipL, 0.3, 0.44, 0.44, 0.12), feetR = leg(hipR, 0.3 + Math.PI, 0.44, 0.44, 0.12);
    return { pelvis, shoulders, head: [head[0], head[1] + 0.01, head[2]], hipL, hipR, kneeL: feetL.knee, kneeR: feetR.knee, ankleL: feetL.ankle, ankleR: feetR.ankle, toeL: feetL.toe, toeR: feetR.toe, shL, shR, elbowL, elbowR, wristL, wristR };
  }
  const AL = arm(shL, phi + Math.PI, 0.3, 0.27, style.swing);
  const AR = arm(shR, phi, 0.3, 0.27, style.swing);
  return { pelvis, shoulders, head, hipL, hipR, kneeL: L.knee, kneeR: R.knee, ankleL: L.ankle, ankleR: R.ankle, toeL: L.toe, toeR: R.toe, shL, shR, elbowL: AL.elbow, elbowR: AR.elbow, wristL: AL.wrist, wristR: AR.wrist };
}

/** Which part point `i` of `n` belongs to: the golden-ratio sequence over the parts' shares (any prefix is a whole body). */
export function partOf(i: number): PartId {
  const u = (i * 0.6180339887498949) % 1;
  let acc = 0;
  for (const p of PARTS) {
    acc += p.share;
    if (u < acc) return p.id;
  }
  return PARTS[PARTS.length - 1].id;
}

/** A point on the surface of a limb between `a` and `b`: `t` along it, `ang` round it, radii across (x) and in depth (z). */
function onLimb(a: V3, b: V3, t: number, ang: number, rx: number, rz: number, out: Float32Array, o: number): void {
  // the limb's own frame: along it, and two directions round it (the limbs swing in the y–z plane, so x is always across)
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const ax = dx / len, ay = dy / len, az = dz / len;
  // n1 = across (x), n2 = axis × n1 (in the y–z plane)
  const n2x = ay * 0 - az * 0, n2y = az * 1 - ax * 0, n2z = ax * 0 - ay * 1; // axis × (1,0,0)
  const n2l = Math.hypot(n2x, n2y, n2z) || 1;
  const c = Math.cos(ang), s = Math.sin(ang);
  out[o] = a[0] + ax * len * t + rx * c * 1 + (rz * s * n2x) / n2l;
  out[o + 1] = a[1] + ay * len * t + (rz * s * n2y) / n2l;
  out[o + 2] = a[2] + az * len * t + (rz * s * n2z) / n2l;
}

/**
 * The stride as points: a Float32Array of frames × points × 4 (x, y, z, 1), frame-major, the body `cfg.height` tall
 * (the skeleton is 1.7 m and scaled). The fourth channel is 1 for every point (room for a weight later).
 */
export function bakeWalk(cfg: BodyConfig = DEFAULT_BODY): Float32Array {
  const { points: n, frames, height, seed } = cfg;
  const out = new Float32Array(frames * n * 4);
  const k = height / 1.7;
  // each point's place on its part is fixed: the same (t, ang, r) in every frame
  const part: PartId[] = new Array(n);
  const T = new Float32Array(n), A = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    part[i] = partOf(i);
    T[i] = hash2(i, seed, 11);
    A[i] = hash2(i, seed, 23) * TAU;
    R[i] = 0.75 + 0.25 * hash2(i, seed, 37); // a little inside the surface, so the silhouette is not a hollow shell
  }
  const tmp = new Float32Array(3);
  for (let f = 0; f < frames; f++) {
    const J = jointsAt(f / frames);
    for (let i = 0; i < n; i++) {
      const o = (f * n + i) * 4;
      const t = T[i], ang = A[i], r = R[i];
      switch (part[i]) {
        case "head": {
          // an ellipsoid round the head's centre: a little taller than wide
          const u = 2 * t - 1, phi = ang, s = Math.sqrt(Math.max(0, 1 - u * u));
          tmp[0] = J.head[0] + 0.085 * r * s * Math.cos(phi);
          tmp[1] = J.head[1] + 0.11 * r * u;
          tmp[2] = J.head[2] + 0.095 * r * s * Math.sin(phi);
          break;
        }
        case "torso": {
          // an elliptic column from the pelvis to the shoulders, narrower at the waist
          const y = t;
          const waist = 1 - 0.18 * Math.sin(Math.PI * y);
          const rx = (0.15 + 0.05 * y) * waist * r, rz = 0.1 * waist * r;
          onLimb(J.pelvis, J.shoulders, y, ang, rx, rz, tmp, 0);
          break;
        }
        case "armUL":
          onLimb(J.shL, J.elbowL, t, ang, 0.05 * r, 0.05 * r, tmp, 0);
          break;
        case "armUR":
          onLimb(J.shR, J.elbowR, t, ang, 0.05 * r, 0.05 * r, tmp, 0);
          break;
        case "armLL":
          onLimb(J.elbowL, J.wristL, t, ang, 0.04 * r, 0.04 * r, tmp, 0);
          break;
        case "armLR":
          onLimb(J.elbowR, J.wristR, t, ang, 0.04 * r, 0.04 * r, tmp, 0);
          break;
        case "thighL":
          onLimb(J.hipL, J.kneeL, t, ang, (0.08 - 0.02 * t) * r, (0.08 - 0.02 * t) * r, tmp, 0);
          break;
        case "thighR":
          onLimb(J.hipR, J.kneeR, t, ang, (0.08 - 0.02 * t) * r, (0.08 - 0.02 * t) * r, tmp, 0);
          break;
        case "shinL":
          onLimb(J.kneeL, J.ankleL, t, ang, (0.06 - 0.02 * t) * r, (0.06 - 0.02 * t) * r, tmp, 0);
          break;
        case "shinR":
          onLimb(J.kneeR, J.ankleR, t, ang, (0.06 - 0.02 * t) * r, (0.06 - 0.02 * t) * r, tmp, 0);
          break;
        case "footL":
          onLimb(J.ankleL, J.toeL, t, ang, 0.045 * r, 0.03 * r, tmp, 0);
          break;
        case "footR":
          onLimb(J.ankleR, J.toeR, t, ang, 0.045 * r, 0.03 * r, tmp, 0);
          break;
      }
      out[o] = tmp[0] * k;
      out[o + 1] = Math.max(0, tmp[1]) * k;
      out[o + 2] = tmp[2] * k;
      out[o + 3] = 1;
    }
  }
  return out;
}

/** A stride's length (world units) for a body of `height`: how far one goes per cycle of the walk texture. */
export function strideLength(height: number): number {
  return 1.35 * (height / 1.7);
}

/** The phase (0 … 1) nearest to `phase` at which the legs are together (a standing body): 0 or ½. */
export function standingPhase(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return Math.abs(p - 0.5) < 0.25 ? 0.5 : p < 0.5 ? 0 : 1;
}

/**
 * One person's motion between the sparse samples the record gives (the bot server writes a sample every half second or
 * so, the fold reads them every half second): the body eases to its latest sample with a top speed and an acceleration,
 * turns to face where it goes, and its stride phase advances with its speed — standing, the legs come together.
 * Mutates `s`; returns nothing. Pure of everything but `s`.
 */
export interface PersonMotion {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (radians; forward = (sin h, cos h), the controller's convention). */
  heading: number;
  /** Stride phase 0 … 1 (wraps). */
  phase: number;
  /** Where the record last put them. */
  tx: number;
  tz: number;
}

export interface MotionConfig {
  /** Top speed on the way to a sample (world/s; a bot walks about 2.2). */
  maxSpeed: number;
  /** How quickly the speed follows (1/s). */
  accel: number;
  /** Seconds in which the body would reach its sample at a steady pace (the ease). */
  reachSec: number;
  /** A sample farther than this is a cut (a wrap, a new life): the body jumps. */
  snapDist: number;
  /** Turning rate (rad/s). */
  turnRate: number;
  /** Below this speed the body stands (the stride settles). */
  standBelow: number;
  stride: number;
  /** The legs never cycle faster than this (strides/s): past it the body glides rather than scurries. */
  maxCadence: number;
}

export const DEFAULT_MOTION: MotionConfig = { maxSpeed: 2.6, accel: 5, reachSec: 0.45, snapDist: 8, turnRate: 5, standBelow: 0.18, stride: strideLength(1.7), maxCadence: 2.2 };

export function stepPerson(s: PersonMotion, dt: number, cfg: MotionConfig = DEFAULT_MOTION): void {
  const dx = s.tx - s.x, dz = s.tz - s.z;
  const d = Math.hypot(dx, dz);
  if (d > cfg.snapDist) {
    s.x = s.tx;
    s.z = s.tz;
    s.vx = s.vz = 0;
    return;
  }
  // the wanted velocity: there in reachSec, capped; nothing when there
  let wx = 0, wz = 0;
  if (d > 0.03) {
    const want = Math.min(cfg.maxSpeed, d / cfg.reachSec);
    wx = (dx / d) * want;
    wz = (dz / d) * want;
  }
  const k = 1 - Math.exp(-cfg.accel * dt);
  s.vx += (wx - s.vx) * k;
  s.vz += (wz - s.vz) * k;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const speed = Math.hypot(s.vx, s.vz);
  if (speed > cfg.standBelow) {
    // face the way they go, turning the short way round
    const want = Math.atan2(s.vx, s.vz);
    let diff = want - s.heading;
    diff = ((diff + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const maxTurn = cfg.turnRate * dt;
    s.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
    s.phase = (s.phase + Math.min(cfg.maxCadence, speed / cfg.stride) * dt) % 1;
  } else {
    // standing: the legs come together at the nearest such moment of the stride
    const target = standingPhase(s.phase);
    s.phase += (target - s.phase) * Math.min(1, 6 * dt);
    if (s.phase >= 1) s.phase -= 1;
  }
}
