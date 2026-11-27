/**
 * futureCue.ts — WHEN THE FUTURE PASSES ME, said to whoever listens (docs/sound-logic.md §13k — the artist, 2026-11-28:
 * "'미래' 찾아왔을 때 비주얼로 미래 보이는 건 반영됐는데 소리 효과가 없음 … 백일몽이 나를 스쳐가는 느낌처럼"). The scan's
 * residue (FutureResidue.tsx) tells this module, once a frame, whether the future is with me and when it is let go, and
 * each time a part of it is found; out of that come two cues the sound turns into a daydream passing (useSound →
 * SoundEngine.daydream, futureSound.ts's glitter):
 *
 *   arrive   an observer has come to overlap me (or an F, a phone's press) — from the side it stands on; or, when the
 *            future is always there, the first find after a quiet while (a new stretch of what is left), from where
 *            it was found
 *   leave    what was found is let go (the overlap over, its 남는 시간 spent) — off the way the wind blows it
 *
 * No React, no state but the edges; a cue nobody listens to is gone.
 */

export interface FutureCue {
  kind: "arrive" | "leave";
  /** Where it comes from and goes to, −1 (left) … 1 (right) of where I look. */
  panFrom: number;
  panTo: number;
}

const listeners = new Set<(c: FutureCue) => void>();

export function onFutureCue(fn: (c: FutureCue) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function cue(c: FutureCue): void {
  for (const fn of listeners) {
    try {
      fn(c);
    } catch {
      /* a listener's trouble is its own */
    }
  }
}

/** When the future is always there: a find counts as its arrival after this long without any (s)… */
export const QUIET_SEC = 6;
/** …and not sooner than this after the last arrival (s). */
export const COOLDOWN_SEC = 15;

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** The pan of a world direction (dx, dz) for one looking along (fx, fz): −1 left … 1 right. */
export function panOf(dx: number, dz: number, fx: number, fz: number): number {
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return 0;
  // (right of a forward (fx, fz) on the ground is (−fz, fx))
  return clamp1((dx * -fz + dz * fx) / l);
}

/** The edges this module keeps (exported for the tests; one visitor a page). */
export const cueState = { present: false, lastFind: -1e9, lastArrive: -1e9, find: null as { x: number; z: number } | null };

/** A part of the future was found at (x, z) at time `now` (s, the residue's clock). */
export function noteFind(now: number, x: number, z: number): void {
  const quiet = now - cueState.lastFind >= QUIET_SEC;
  cueState.lastFind = now;
  cueState.find = quiet ? { x, z } : cueState.find;
  if (quiet) pendingQuietFind = true;
}
let pendingQuietFind = false;

export interface FutureFrame {
  now: number;
  /** "always" | "press" | "observer" (FutureResidue's showWhen). */
  showWhen: string;
  present: boolean;
  /** Let go this frame (the overlap's 남는 시간 spent). */
  letGo: boolean;
  me: { x: number; z: number };
  /** Where I look, on the ground. */
  fwd: { x: number; z: number };
  /** The observer (or the press's stand-in), where there is one; and the way the wind blows what is let go. */
  obs?: { x: number; z: number } | null;
  blow?: { x: number; z: number } | null;
}

/** Once a frame, after the residue has decided `present` and `letGo`. */
export function futureFrame(f: FutureFrame): void {
  const side = (x: number, z: number) => panOf(x - f.me.x, z - f.me.z, f.fwd.x, f.fwd.z);
  if (f.showWhen === "always") {
    // (a find after a quiet while: a new stretch of what is left comes to me)
    if (pendingQuietFind && cueState.find && f.now - cueState.lastArrive >= COOLDOWN_SEC) {
      const p = side(cueState.find.x, cueState.find.z);
      cueState.lastArrive = f.now;
      cue({ kind: "arrive", panFrom: p, panTo: -p * 0.6 });
    }
  } else if (f.present && !cueState.present) {
    // (an observer has come to overlap me — from its side, passing across)
    const p = f.obs ? side(f.obs.x, f.obs.z) : 0;
    cueState.lastArrive = f.now;
    cue({ kind: "arrive", panFrom: p, panTo: -p * 0.6 });
  }
  if (f.letGo) {
    const to = f.blow ? panOf(f.blow.x, f.blow.z, f.fwd.x, f.fwd.z) : 0;
    cue({ kind: "leave", panFrom: -to * 0.3, panTo: to });
  }
  cueState.present = f.present;
  pendingQuietFind = false;
}
