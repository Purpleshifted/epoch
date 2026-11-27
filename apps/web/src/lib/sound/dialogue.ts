/**
 * sound/dialogue.ts — ASKING AND ANSWERING AS COUNTERPOINT (the artist, 2026-11-27: "대화응답 할 때나 말 걸어올 때 …
 * 대위적으로 얽혀들면서 음악적 확장이 일어난다는 확신을 지금보다 좀 분명히"; docs/sound-logic.md §13d). Pure: notes in,
 * notes out. Nothing here changes a motif — a voice's contour and rhythm cell (its identity) stay; only where its notes
 * sit (by octaves), how a phrase ends, and which step a note lands on when two lines play at once.
 *
 *   TWO PLACES    the two lines of a dialogue sit at least an octave apart: the other's line moves by octaves.
 *   THE QUESTION  the asker's phrase ends on an OPEN note above the one before it (the key's 2nd or 5th): a half cadence.
 *   THE ANSWER    my phrase ends on the key's TONIC, at or below the note before it: closed.
 *   INTERLOCK     a note of the other's that falls on a step of mine moves to the next free step: the two lines mesh
 *                 like gears, and together make a busier rhythm than either alone.
 */

import type { WorldKey } from "./harmony";
import type { MotifNote } from "./motif";

/** The range a moved line must stay in (MIDI): G2 … E6. */
export const DIALOGUE_LO = 43;
export const DIALOGUE_HI = 88;

const mean = (ns: readonly MotifNote[]): number => ns.reduce((s, n) => s + n.pitch, 0) / ns.length;
const pc = (p: number): number => ((p % 12) + 12) % 12;

/** Every note `semis` semitones away (the colour of each note, its cents, kept). */
export function shiftNotes(ns: readonly MotifNote[], semis: number): MotifNote[] {
  if (!semis) return ns.slice();
  const k = Math.pow(2, semis / 12);
  return ns.map((n) => ({ ...n, pitch: n.pitch + semis, freq: n.freq * k }));
}

/**
 * How far (semitones, a multiple of 12, or 0) `theirs` moves so the two lines' centres are at least an octave apart,
 * staying inside lo … hi: away from mine first (up when theirs is the higher one), else the other way, else two octaves.
 * `mineOffset` = my register knob (motifTranspose), applied to my notes later in the instrument.
 */
export function apartShift(mine: readonly MotifNote[], theirs: readonly MotifNote[], mineOffset = 0, lo = DIALOGUE_LO, hi = DIALOGUE_HI): number {
  if (!mine.length || !theirs.length) return 0;
  const a = mean(mine) + mineOffset;
  const b = mean(theirs);
  if (Math.abs(b - a) >= 12) return 0;
  let tlo = Infinity;
  let thi = -Infinity;
  for (const n of theirs) {
    tlo = Math.min(tlo, n.pitch);
    thi = Math.max(thi, n.pitch);
  }
  const away = b >= a ? 12 : -12;
  for (const s of [away, -away, 2 * away, -2 * away]) if (tlo + s >= lo && thi + s <= hi && Math.abs(b + s - a) >= 12) return s;
  return 0;
}

/** The octave beside a line (+12 or −12) on the side of `toward`'s centre, inside lo … hi; 0 when neither fits. */
export function octaveToward(ns: readonly MotifNote[], toward: number, lo = DIALOGUE_LO, hi = DIALOGUE_HI): number {
  if (!ns.length) return 0;
  const first = toward >= mean(ns) ? 12 : -12;
  for (const s of [first, -first]) if (ns.every((n) => n.pitch + s >= lo && n.pitch + s <= hi)) return s;
  return 0;
}

function retuneLast(ns: readonly MotifNote[], pitch: number): MotifNote[] {
  const out = ns.slice();
  const i = out.length - 1;
  const n = out[i];
  out[i] = { ...n, pitch, freq: n.freq * Math.pow(2, (pitch - n.pitch) / 12) };
  return out;
}

/** The phrase as a QUESTION: its last note moved to the nearest open note — the key's 2nd or 5th — above the note before it. */
export function endOpen(ns: readonly MotifNote[], key: WorldKey): MotifNote[] {
  if (ns.length < 2) return ns.slice();
  const open = new Set([pc(key.root + key.mode.intervals[1]), pc(key.root + key.mode.intervals[4])]);
  let p = ns[ns.length - 2].pitch + 1;
  while (!open.has(pc(p))) p++;
  return retuneLast(ns, p);
}

/** The phrase as an ANSWER: its last note on the key's tonic, at or below the note before it (falling, closed). */
export function endClosed(ns: readonly MotifNote[], key: WorldKey): MotifNote[] {
  if (!ns.length) return [];
  let p = ns.length >= 2 ? ns[ns.length - 2].pitch : ns[0].pitch;
  while (pc(p) !== pc(key.root)) p--;
  return retuneLast(ns, p);
}

/**
 * `theirs` meshed with `mine` on a bar of `steps`: a note of theirs on a step mine already sounds moves to the next free
 * step (in order, never before its own previous note); a note with no free step left is dropped. Each kept note is held
 * to its own line's next onset (85 %, as realize() does).
 */
export function interlock(mine: readonly MotifNote[], theirs: readonly MotifNote[], steps = 8): MotifNote[] {
  const taken = new Set(mine.map((n) => Math.round(n.at * steps)));
  const placed: { n: MotifNote; s: number }[] = [];
  let last = -1;
  for (const n of [...theirs].sort((x, y) => x.at - y.at)) {
    let s = Math.max(Math.round(n.at * steps), last + 1);
    while (s < steps && taken.has(s)) s++;
    if (s >= steps) break;
    placed.push({ n, s });
    taken.add(s);
    last = s;
  }
  return placed.map(({ n, s }, i) => {
    const next = i + 1 < placed.length ? placed[i + 1].s : steps;
    return { ...n, at: s / steps, len: ((next - s) / steps) * 0.85 };
  });
}

/** A question's bars from the one it opened on: even = the asker calls, odd = left empty (the visitor's turn). */
export const callsOn = (k: number): boolean => k % 2 === 0;
