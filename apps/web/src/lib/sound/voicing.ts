/**
 * sound/voicing.ts — VOICE LEADING for the pad and the patch's harmony layer (docs/sound-logic.md §13i). Pure.
 *
 * The artist, 2026-11-28: "화성에서 화성으로 이어질 때 영 어색한 경우가 있음". One cause: the pad's voices took the new
 * chord slot by slot (root to root, third to third, each at 48 + its class) and glided there — on a chromatic change
 * four sines swooped up to a major seventh and crossed. Here each voice goes to the NEAREST tone of the new chord:
 * common tones stay where they are, the rest move a step or two; every tone of the chord is sounded, within a window.
 */

/** The window the upper voices stay in (MIDI): C3 … B4. */
export const VOICE_LO = 48;
export const VOICE_HI = 71;

/** The pitch of class `c` nearest to `p`, inside [lo, hi]. */
export function nearestOfClass(p: number, c: number, lo = VOICE_LO, hi = VOICE_HI): number {
  const cls = ((c % 12) + 12) % 12;
  let best = -1;
  let bestD = Infinity;
  for (let q = lo; q <= hi; q++) {
    if (((q % 12) + 12) % 12 !== cls) continue;
    const d = Math.abs(q - p);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** A first voicing (nothing to lead from): the chord's tones closed upward from C3. */
export function closeVoicing(classes: readonly number[], n = 4): number[] {
  const out = classes.slice(0, n).map((c) => VOICE_LO + (((c % 12) + 12) % 12));
  while (out.length < n && out.length) out.push(out[0] + 12);
  return out.sort((a, b) => a - b);
}

/**
 * `n` upper voices for a chord of `classes`, led from `prev` (the last bar's voices): each voice takes a class, every
 * class is sounded at least once, and of all such ways the one with the least total motion wins (two voices on one
 * pitch cost extra). Common tones therefore hold, the rest move by the smallest steps.
 */
export function voiceLead(prev: readonly number[] | null | undefined, classes: readonly number[], n = 4): number[] {
  const cls = classes.slice(0, n);
  if (!cls.length) return prev ? prev.slice() : [];
  if (!prev || prev.length !== n) return closeVoicing(cls, n);
  const m = cls.length;
  let best: number[] = closeVoicing(cls, n);
  let bestCost = Infinity;
  const total = m ** n;
  for (let code = 0; code < total; code++) {
    let x = code;
    let usedMask = 0;
    const cand: number[] = [];
    let cost = 0;
    for (let v = 0; v < n; v++) {
      const ci = x % m;
      x = Math.floor(x / m);
      usedMask |= 1 << ci;
      const p = nearestOfClass(prev[v], cls[ci]);
      cand.push(p);
      cost += Math.abs(p - prev[v]);
    }
    if (usedMask !== (1 << m) - 1) continue;
    if (new Set(cand).size < cand.length) cost += 6;
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return best;
}
