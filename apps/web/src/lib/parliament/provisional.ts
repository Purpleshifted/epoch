/**
 * parliament/provisional.ts — a person's parts on the wall AT ONCE (the artist, 2026-11-10: "elsewhere 20 s steps are
 * fine; copy part of the rule out as a rule of its own that gives a person provisional parts").
 *
 * The building rule (fold.ts) stays as it is: it needs the person's samples (one a second), their weight to reach the
 * threshold (2 s at best) and a round of the wall's computing. This is a small copy of its heart, run on the wall's own
 * frames from where the person's marker stands: while someone (never a bot) stands still, every cell within the rule's
 * radius gathers their time, the nearer the faster, and a cell that has gathered `afterSec` gets a provisional part
 * that grows for `growSec`. It is display only: nothing enters the record. When the rule itself builds on a cell
 * (spaceModel handsOf says so) the provisional part there is gone for good; a cell the person has left without the
 * rule ever building is gone after PROVISIONAL_HOLD_SEC.
 */

import { CELL_SIZE } from "@/lib/stratum/field";

export interface ProvisionalConfig {
  /** The rule's presence radius (world). */
  radius: number;
  /** A cell has a part once it has gathered this much of someone's standing (s at the centre; further out it takes longer). */
  afterSec: number;
  /** … which is full height this many seconds later. */
  growSec: number;
}

export interface ProvisionalCell {
  x: number;
  z: number;
  /** Seconds of standing gathered (weighted by nearness). */
  got: number;
  /** When it last gathered (s, the caller's clock). */
  fed: number;
  /** The rule has built here: nothing provisional is shown on it any more. */
  real: boolean;
  /** The height of the present of whoever stands here (world y). */
  top: number;
}

export const PROVISIONAL_HOLD_SEC = 8;
/** A part starts at this share of its full height. */
const START = 0.2;

export const cellKeyAt = (x: number, z: number): string => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;

/** One frame of someone standing at (x, z): the cells round them gather `dt`, the nearer the more. */
export function gatherStanding(cells: Map<string, ProvisionalCell>, x: number, z: number, top: number, dt: number, now: number, cfg: ProvisionalConfig): void {
  const ci = Math.floor(x / CELL_SIZE), cj = Math.floor(z / CELL_SIZE);
  const n = Math.ceil(cfg.radius / CELL_SIZE);
  for (let di = -n; di <= n; di++) {
    for (let dj = -n; dj <= n; dj++) {
      const cx = (ci + di + 0.5) * CELL_SIZE, cz = (cj + dj + 0.5) * CELL_SIZE;
      const d = Math.hypot(cx - x, cz - z);
      if (d > cfg.radius) continue;
      const key = `${ci + di},${cj + dj}`;
      let c = cells.get(key);
      if (!c) {
        c = { x: cx, z: cz, got: 0, fed: now, real: false, top };
        cells.set(key, c);
      }
      c.got += dt * (1 - (d / cfg.radius) ** 2);
      c.fed = now;
      c.top = top;
    }
  }
}

/** The rule has built on these places: their provisional parts step back. */
export function markBuilt(cells: Map<string, ProvisionalCell>, built: Iterable<{ x: number; z: number }>): void {
  for (const b of built) {
    const c = cells.get(cellKeyAt(b.x, b.z));
    if (c) c.real = true;
  }
}

/** Forgets what was left a while ago; returns the parts to draw now: [x, z, top, height (0 … 1 of a full part)] each. */
export function provisionalParts(cells: Map<string, ProvisionalCell>, now: number, cfg: ProvisionalConfig): { x: number; z: number; top: number; h: number }[] {
  const out: { x: number; z: number; top: number; h: number }[] = [];
  for (const [key, c] of cells) {
    if (now - c.fed > PROVISIONAL_HOLD_SEC) {
      cells.delete(key);
      continue;
    }
    if (c.real || c.got < cfg.afterSec) continue;
    out.push({ x: c.x, z: c.z, top: c.top, h: Math.min(1, START + ((1 - START) * (c.got - cfg.afterSec)) / Math.max(0.01, cfg.growSec)) });
  }
  return out;
}
