/**
 * daydreamSolo.ts — THE DAYDREAM'S FIRST SECONDS ARE MINE ALONE (the artist, 2026-11-28: "백일몽 처음 10-20초 정도는 다른
 * 봇들도 안 보이고 인터랙션도 끊겨야 경험 취지랑 맞는듯"). When the future arrives (lib/sound/futureCue's `arrive`), for
 * SOLO.sec seconds the others are not drawn and nothing passes between us; then they come back.
 *
 *   the others     PointPeople fades every one of them out by `soloShow()` (all its ways of drawing a person), and
 *                  FramePeopleLayer its boxes and lines with them
 *   nobody asks    the record opens no question and closes an open one (SessionHud → WitnessLog.setQuiet), its cue,
 *                  hold and bubble go (PointPeople), and its voice (RoleField)
 *   I answer none  SPACE and the phone's button do nothing (SessionHud)
 *
 * The lab's look only (mobileLab.newLook): the exhibition's personal view never hears the cue here. No React, no state
 * but the two times; whoever wants the edges listens with onSolo.
 */

import { onFutureCue } from "@/lib/sound/futureCue";
import { newLook } from "./mobileLab";

/** How long it lasts (s — the knob, bot (present) › 말 걸기), and its fades out and back (s). */
export const SOLO = { sec: 15, outSec: 1.2, backSec: 3 };

/** performance.now() ms: the fade out began, the others come back. */
const st = { from: -1e12, until: -1e12 };
const listeners = new Set<(on: boolean) => void>();
let endTimer: ReturnType<typeof setTimeout> | null = null;

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

function tell(on: boolean): void {
  for (const fn of listeners) {
    try {
      fn(on);
    } catch {
      /* a listener's trouble is its own */
    }
  }
}

/** Its edges: true as it begins, false as the others start to come back. */
export function onSolo(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Nothing passes between the others and me now. */
export function soloOn(nowMs = performance.now()): boolean {
  return nowMs < st.until;
}

/** How much of the others shows now: 1 as ever … 0 gone. */
export function soloShow(nowMs = performance.now()): number {
  if (nowMs < st.until) return 1 - smooth((nowMs - st.from) / (SOLO.outSec * 1000));
  return smooth((nowMs - st.until) / (SOLO.backSec * 1000));
}

/** The future has arrived (or the lab's test): alone for `sec` from now. */
export function beginSolo(sec = SOLO.sec): void {
  if (typeof window === "undefined" || !(sec > 0)) return;
  const now = performance.now();
  const was = soloOn(now);
  // (one already under way, or still coming back, goes on from where it is: nobody flashes back in)
  st.from = now - (1 - soloShow(now)) * SOLO.outSec * 1000;
  st.until = now + sec * 1000;
  if (endTimer) clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    endTimer = null;
    tell(false);
  }, sec * 1000);
  if (!was) tell(true);
}

if (typeof window !== "undefined") {
  onFutureCue((c) => {
    if (c.kind === "arrive" && newLook()) beginSolo();
  });
  // (a handle for the headless checks)
  if (process.env.NODE_ENV === "development") (window as unknown as { __daydreamSolo?: unknown }).__daydreamSolo = { begin: beginSolo, on: soloOn, show: soloShow };
}
