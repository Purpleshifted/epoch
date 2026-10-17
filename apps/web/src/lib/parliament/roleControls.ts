/**
 * parliament/roleControls.ts — how each role moves and looks in the player view (V2). Kept simple: one body model per
 * role; the same keys (W/S/A/D) and mouse mean something different for each.
 *
 *   WORKER      walks: forward, sidestep, a slow step back (the controls as they were)
 *   STREET CAT  low and quick: darts off and stops short, sidesteps freely, looks around fast; the eye sits low
 *   CAR         drives: W throttle, S brake / reverse; no sidestep, the mouse does not turn it; slow to pick up, long
 *               to roll out. ON RAILS: on a road (trodden ground, PathCell.p ≥ ROAD_P) its heading is drawn to the
 *               road's line (PathCell.axis) by how much the treads agree on it (align), so A/D only steer at
 *               crossings and off the road; speed by how formed the road is, full on sealed ground; off the road it
 *               CRAWLS (× crawl) — and scars the grass (nature.ts wearOf) and treads a new road (flow.ts treadOf)
 *   TREE        rooted: the keys only sway it (it springs back to where it stands), it looks around slowly, and its eye
 *               rises over the lifespan (it grows)
 *
 * The end of the lifespan (session.ts `hindrance`) slows and drops the input of every role alike.
 * Pure: `stepBody` advances a body by one frame.
 */

import type { RoleId } from "./types";
import type { Surface } from "./witness";

export type MotionKind = "walk" | "drive" | "rooted";

export interface RoleMotion {
  kind: MotionKind;
  /** Top speeds (world units/s): forward, sidestep (walk only), backward. */
  fwd: number;
  side: number;
  back: number;
  /** × how quickly the body follows the input (the drag from 점성). drive: picking up speed. */
  response: number;
  /** drive: × that drag while no key is held (rolling out) … */
  coast?: number;
  /** … and while the input works against the motion (braking). */
  brake?: number;
  /** drive: turn rate (rad/s) once rolling at half the top speed or more; none at a standstill. */
  steer?: number;
  /** drive: × top speed off the road (open ground). */
  crawl?: number;
  /** drive: how fast (1/s) the heading is drawn to the road's line when the treads fully agree on it. */
  rail?: number;
  /** rooted: how far the keys sway it (world units). */
  sway?: number;
}

/** A path at least this formed is a ROAD (witness.ts: TRODDEN GROUND) … */
export const ROAD_P = 0.3;
/** … and from here on a car runs at full speed. */
export const FULL_ROAD_P = 0.8;

/** The ground under a body (from the fold's PathCell / Slab at its cell). */
export interface Ground {
  surface: Surface;
  /** 0..1 how formed the path under it is (0 = open ground). */
  p: number;
  /** The path's line and how much the treads agree on it (PathCell.axis / align); absent off the road. */
  axis?: number;
  align?: number;
}

export interface RoleLook {
  /** × mouse sensitivity, left–right (0 = the mouse does not turn it) and up–down. */
  yaw: number;
  pitch: number;
  /** Camera pitch range (rad above the horizon). */
  pitchMin: number;
  pitchMax: number;
}

export interface RoleCamera {
  /** × camera distance (Leva camDist). */
  dist: number;
  /** Extra height of the eye above the orbit (world units). */
  lift: number;
  /** rooted: the distance grows by × (1 + grow) over the lifespan. */
  grow?: number;
}

export interface RoleControl {
  motion: RoleMotion;
  look: RoleLook;
  cam: RoleCamera;
  /** What the keys do, as dry machine text (HUD). */
  hint: string;
}

const WORKER: RoleControl = {
  motion: { kind: "walk", fwd: 7, side: 4.5, back: 2.8, response: 1 },
  look: { yaw: 1, pitch: 1, pitchMin: 0.05, pitchMax: 1.2 },
  cam: { dist: 1, lift: 0.4 },
  hint: "W A S D  WALK · MOUSE  LOOK",
};

export const ROLE_CONTROLS: Record<RoleId, RoleControl> = {
  worker: WORKER,
  cat: {
    motion: { kind: "walk", fwd: 10, side: 7, back: 3, response: 2.5 },
    look: { yaw: 1.4, pitch: 1, pitchMin: 0.02, pitchMax: 0.5 },
    cam: { dist: 0.4, lift: 0.1 },
    hint: "W A S D  MOVE · MOUSE  LOOK",
  },
  car: {
    motion: {
      kind: "drive",
      fwd: 14,
      side: 0,
      back: 4,
      response: 0.22,
      coast: 0.06,
      brake: 0.9,
      steer: 1.6,
      crawl: 0.08,
      rail: 4,
    },
    look: { yaw: 0, pitch: 0.6, pitchMin: 0.12, pitchMax: 0.7 },
    cam: { dist: 1.3, lift: 0.6 },
    hint: "W  THROTTLE · S  BRAKE · A D  STEER",
  },
  tree: {
    motion: { kind: "rooted", fwd: 0, side: 0, back: 0, response: 0.5, sway: 0.35 },
    look: { yaw: 0.35, pitch: 0.35, pitchMin: 0.3, pitchMax: 1.2 },
    cam: { dist: 0.6, lift: 0.4, grow: 2 },
    hint: "ROOTED · MOUSE  LOOK",
  },
  // V1 roles: they walk like the worker
  shepherd: WORKER,
  wolf: WORKER,
  warrior: WORKER,
};

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading (rad): forward = (sin, cos). The mouse turns it (walk, rooted), A/D steer it (drive). */
  yaw: number;
  /** rooted: where it stands (set on the first step). */
  hx?: number;
  hz?: number;
}

export interface MoveKeys {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface StepOpts {
  dt: number;
  /** The drag (1/s) the body follows the input with (점성; already × the hindrance's response). */
  drag: number;
  /** × the speed the input asks for (the hindrance's gain). */
  gain: number;
  /** The ground under it; absent = unknown (a car then crawls as on open ground). */
  ground?: Ground;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** The heading (yaw: forward = (sin, cos)) that runs along a path's line `axis` (atan2(dz, dx)). */
export const yawAlong = (axis: number) => Math.atan2(Math.cos(axis), Math.sin(axis));

/** × top speed a car gets from the ground: full on sealed ground, by how formed the road is, `crawl` off it. */
export function roadSpeed(g: Ground | undefined, crawl: number): number {
  if (g?.surface === "sealed") return 1;
  if (!g || g.p < ROAD_P) return crawl;
  const road = clamp((g.p - ROAD_P) / (FULL_ROAD_P - ROAD_P), 0, 1);
  return crawl + (1 - crawl) * road;
}

/** Advances `b` by one frame of `keys` under the role's motion. */
export function stepBody(b: Body, keys: MoveKeys, m: RoleMotion, o: StepOpts): void {
  const f = keys.fwd ? 1 : 0, bk = keys.back ? 1 : 0, l = keys.left ? 1 : 0, r = keys.right ? 1 : 0;
  const sin = Math.sin(b.yaw), cos = Math.cos(b.yaw);
  const damp = (resp: number) => 1 - Math.exp(-o.drag * resp * o.dt);

  if (m.kind === "drive") {
    const g = o.ground;
    const s = roadSpeed(g, m.crawl ?? 1);
    // speed along the heading only (it does not slide sideways)
    let v = b.vx * sin + b.vz * cos;
    // input against the motion brakes to a stop first; only then does S reverse (or W pull away again)
    const opposing = (f && v < -0.3) || (bk && v > 0.3);
    const target = opposing ? 0 : (f * m.fwd - bk * m.back) * o.gain * s;
    const resp = opposing ? (m.brake ?? m.response) : f || bk ? m.response : (m.coast ?? m.response);
    v += (target - v) * damp(resp);
    // the rail: on a road the heading is drawn to the road's line (the nearer way along it) by how much the treads
    // agree on that line; A/D are free off the road and at crossings (where the treads disagree), nothing on a clean road
    const rail = g && g.p >= ROAD_P && g.axis !== undefined && g.align !== undefined ? clamp(g.align, 0, 1) : 0;
    if (rail > 0 && m.rail) {
      let d = wrapAngle(yawAlong(g!.axis!) - b.yaw);
      if (Math.abs(d) > Math.PI / 2) d = wrapAngle(d + Math.PI);
      b.yaw += d * (1 - Math.exp(-m.rail * rail * o.dt));
    }
    // steering needs speed: none at a standstill, full from half the top speed (as the ground allows); reversing turns the other way
    const roll = clamp(v / (m.fwd * s * 0.5), -1, 1);
    b.yaw -= (r - l) * (m.steer ?? 0) * roll * (1 - rail) * o.dt;
    b.vx = Math.sin(b.yaw) * v;
    b.vz = Math.cos(b.yaw) * v;
    b.x += b.vx * o.dt;
    b.z += b.vz * o.dt;
    return;
  }

  if (m.kind === "rooted") {
    if (b.hx === undefined || b.hz === undefined) {
      b.hx = b.x;
      b.hz = b.z;
    }
    // the keys lean it towards where they point (in the view's frame), at most `sway` away; let go, it springs back
    let ox = sin * (f - bk) - cos * (r - l);
    let oz = cos * (f - bk) + sin * (r - l);
    const len = Math.hypot(ox, oz);
    const k = len > 0 ? ((m.sway ?? 0) * o.gain) / len : 0;
    ox *= k;
    oz *= k;
    const d = damp(m.response);
    b.x += (b.hx + ox - b.x) * d;
    b.z += (b.hz + oz - b.z) * d;
    // the sway is not travel: it stays where it stands (the record says STATIONARY)
    b.vx = 0;
    b.vz = 0;
    return;
  }

  // walk
  const tf = (f * m.fwd - bk * m.back) * o.gain;
  const ts = (r - l) * m.side * o.gain;
  const tvx = sin * tf - cos * ts;
  const tvz = cos * tf + sin * ts;
  const d = damp(m.response);
  b.vx += (tvx - b.vx) * d;
  b.vz += (tvz - b.vz) * d;
  b.x += b.vx * o.dt;
  b.z += b.vz * o.dt;
}

/** The camera distance multiplier of a role at lifespan fraction `frac` (0 … 1): a tree's eye rises as it grows. */
export function camDistOf(c: RoleCamera, frac: number): number {
  return c.dist * (1 + (c.grow ?? 0) * clamp(frac, 0, 1));
}
