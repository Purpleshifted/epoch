/**
 * parliament/botGround.ts — WHAT THE BOTS KNOW OF THE GROUND besides how trodden it is (which they read from the fold,
 * flow.ts — the same trodden ground the walkways are judged on: one world, one measure).
 *
 * `built`: where it is built, as the wall makes its buildings (a copy of the wall's density field on the main thread,
 * fed with the same samples; the wall's own lives in its worker). The bots go round what is built, or stop at it
 * (lifecycle.ts meetStay). `trail`: how much they keep to trodden ground (0 = not at all, 1 = as the flow rules say).
 * Set by the wall's view, read by useGlobalBots.
 */

import type { PEvent } from "./types";

export const botGround: {
  built: { levelAt(cx: number, cz: number, k: number): number; add(e: Pick<PEvent, "o" | "x" | "z" | "s" | "k">): void; eachShare(cb: (cx: number, cz: number, k: number, share: number) => void): void } | null;
  /** Seconds of one slot of the time axis (to read `built` at a bot's own time). */
  slotSec: number;
  trail: number;
  /** What the wall itself shows as built (spaceModel PartsResult.cells) and when it came (performance.now(), ms): the
   *  vegetation gives way to this — to the buildings that are there, not to the density they will come of. */
  shown: Float32Array | null;
  shownAt: number;
  /** Where the block's top is now (seconds of its time axis) and how fast it rises (lifecycle.ts shift; 0 = it
   *  stands): set by the bots, read by the wall. null = no bots running here. `stood`: how far the top would have
   *  risen while its rise was stopped (rise.ts; seconds of the axis, as `top`) — what the ages go on by meanwhile
   *  (erode.ts stood). */
  window: (() => { top: number; shift: number; tail: number; stood?: number }) | null;
} = { built: null, slotSec: 20, trail: 1, shown: null, shownAt: 0, window: null };
