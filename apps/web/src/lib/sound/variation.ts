/**
 * sound/variation.ts — my motif VARIES through the others (docs/sound-logic.md §6).
 *
 * Someone who stays within earshot for a while gets into my motif: the longer and the closer, the more of their
 * contour and rhythm my cycle borrows (`blend`). This is the always-available, deterministic variation. When the
 * Magenta models are loaded (magenta.ts, optional: network + a few MB), a PHRASE (4 cycles = 2 bars of 16th steps)
 * is instead interpolated between the two motifs in MusicVAE's latent space, or improvised by MusicRNN over the
 * chords of the ground when I follow a path — both come back as the same `Phrase` shape and replace the next cycles.
 *
 * Pure. Phrases are MIDI steps (0 = rest / hold), 8 steps per cycle, 32 steps per phrase.
 */

import { hashString, rng, type Motif } from "./motif";

export const STEPS_PER_CYCLE = 8;
export const CYCLES_PER_PHRASE = 4;
export const PHRASE_STEPS = STEPS_PER_CYCLE * CYCLES_PER_PHRASE;

/** A phrase: per 16th step the MIDI pitch that STARTS there, or 0 for no new note (rest / the previous note holds). */
export type Phrase = number[];

/**
 * A motif with `amount` (0..1) of another's contour and rhythm mixed in: per note position the other's degree with
 * probability `amount`; above 0.5 the other's rhythm cell too. Deterministic per cycle.
 */
export function blend(mine: Motif, theirs: Motif, amount: number, cycle: number): Motif {
  if (amount <= 0 || theirs.id === mine.id) return mine;
  const r = rng(hashString(`${mine.id}~${theirs.id}#${cycle}`));
  // whose rhythm cell (and so how many notes): theirs once they are more than half in
  const cell = amount > 0.5 ? theirs : mine;
  const n = cell.semis.length;
  const semis: number[] = [];
  for (let i = 0; i < n; i++) {
    const own = mine.semis[i % mine.semis.length];
    const other = theirs.semis[i % theirs.semis.length];
    semis.push(r() < amount ? other : own);
  }
  return { ...mine, semis, onsets: cell.onsets.slice() };
}

/** The pitches a cycle of realized notes puts on the 8-step grid (one cycle of a phrase). */
export function cycleToSteps(notes: readonly { at: number; pitch: number }[], steps = STEPS_PER_CYCLE): number[] {
  const out = new Array<number>(steps).fill(0);
  for (const n of notes) {
    const s = Math.min(steps - 1, Math.round(n.at * steps));
    out[s] = n.pitch;
  }
  return out;
}

/** Notes of one cycle of a phrase (steps `from` … `from + 8`): onsets on the grid, each held to the next onset. */
export function stepsToCycle(phrase: Phrase, from: number, steps = STEPS_PER_CYCLE): { at: number; len: number; pitch: number }[] {
  const out: { at: number; len: number; pitch: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const p = phrase[from + i] ?? 0;
    if (p <= 0) continue;
    let next = steps;
    for (let j = i + 1; j < steps; j++) if ((phrase[from + j] ?? 0) > 0) { next = j; break; }
    out.push({ at: i / steps, len: ((next - i) / steps) * 0.85, pitch: p });
  }
  return out;
}

/** Shift a pitch by octaves into [lo, hi] (Magenta's melody models take MIDI 48 … 83). */
export function intoRange(pitch: number, lo = 48, hi = 83): number {
  let p = pitch;
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}
