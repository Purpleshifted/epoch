/**
 * parliament/tilt.ts — a phone as the controller (V2 player view): the visitor walks by tilting it and turns by
 * tipping it sideways. Pure: DeviceOrientation angles in, a walking input out. The hook that reads the sensor is
 * components/parliament/useTilt.ts.
 *
 *   beta   front-back tilt (deg): 0 = flat, face up; 90 = upright. Held in the hand it sits around 40–70, so the
 *          angle at which the life began is taken as neutral; tipping the top AWAY (beta down) walks forward
 *   gamma  left-right tilt (deg, positive = right side down): turns, like the mouse
 * Portrait only for now.
 */

/** Within this many degrees of neutral nothing happens (the hand is never still). */
export const TILT_DEAD_DEG = 4;
/** This many degrees from neutral is full speed / full turn. */
export const TILT_FULL_DEG = 22;
/** Turn rate at full sideways tilt (rad/s). */
export const TILT_TURN_RATE = 1.5;

export interface TiltInput {
  /** -1 … 1: forward (+) / backward (−). */
  fwd: number;
  /** -1 … 1: turn right (+) / left (−). */
  turn: number;
}

/** Dead zone then linear to full, clamped: deg → -1 … 1. */
export function tiltAxis(deg: number, dead = TILT_DEAD_DEG, full = TILT_FULL_DEG): number {
  const a = Math.abs(deg);
  if (!(a > dead)) return 0;
  const v = Math.min(1, (a - dead) / Math.max(0.001, full - dead));
  return deg < 0 ? -v : v;
}

/** The walking input for the phone's angles against the neutral front-back angle. */
export function tiltToInput(beta: number, gamma: number, neutralBeta: number): TiltInput {
  return { fwd: tiltAxis(neutralBeta - beta), turn: tiltAxis(gamma) };
}

/** Whether this is a phone-like device: a coarse pointer (touch) and no fine one. */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
}
