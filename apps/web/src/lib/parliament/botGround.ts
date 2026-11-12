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
} = { built: null, slotSec: 20, trail: 1 };
