/**
 * spacetime/legacy/worldline.ts
 *
 * LEGACY — observer-plane "worldline tilt" (φ, β).
 *
 * The visitor's session was assigned a direction φ and a speed β; each recorded
 * object's worldline then leaned from its birth point as
 *     tip = (x + cos φ · β · τ,  τ · scale,  z + sin φ · β · τ)
 * That was part of the star/spacetime metaphor (archive/spacetime-stars) and is
 * NOT part of the technofossil-stratum design.
 *
 * Kept (switched off) because it might come back: if the phone is connected,
 * the accelerometer could drive β (movement speed) and the device heading φ.
 * To re-enable, flip WORLDLINE_ENABLED. Nothing else needs to change; data that
 * carries creatorPhi / creatorBeta is still recorded.
 *
 * Related legacy code: ./useSessionAngle.ts (session φ/β assignment).
 */

import type { StarBody } from "../types";

export const WORLDLINE_ENABLED = false;

/** φ/β of the observer that created a star. β = 0 when the legacy tilt is off. */
export function starPhiBeta(s: StarBody, fallbackBeta = 0.3): { phi: number; beta: number } {
  if (!WORLDLINE_ENABLED) return { phi: 0, beta: 0 };
  return {
    phi: s.creatorPhi ?? s.creatorAngle ?? 0,
    beta: s.creatorBeta ?? fallbackBeta,
  };
}

/** Side-view vertical lean per unit x. 0 when the legacy tilt is off. */
export function sideTilt(s: StarBody, tiltScale: number): number {
  if (!WORLDLINE_ENABLED) return 0;
  return Math.sin(s.creatorAngle ?? 0) * tiltScale;
}
