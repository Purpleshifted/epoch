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
import { hashString, rng, type MotifNote } from "./motif";

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
 * `mineOffset` = my register knob (motifTranspose), applied to my notes later in the instrument. `gap`: how close the
 * centres may be before theirs moves (12 = an octave apart always; smaller lets them share the register — the artist,
 * 2026-11-27: "같은 음역대에 좀 겹치면 어때"; 0 = never moved).
 */
export function apartShift(mine: readonly MotifNote[], theirs: readonly MotifNote[], mineOffset = 0, gap = 12, lo = DIALOGUE_LO, hi = DIALOGUE_HI): number {
  if (!mine.length || !theirs.length || gap <= 0) return 0;
  const a = mean(mine) + mineOffset;
  const b = mean(theirs);
  if (Math.abs(b - a) >= gap) return 0;
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
 * to its own line's next onset (85 %, as realize() does). `avoid` (0 … 1): the chance each such note steps aside — 1 =
 * always (gears), smaller lets them sound together on one step (the artist, 2026-11-27: "꼭 대위적으로 서로 피해갈 이유는
 * 없음"); drawn from `seed`, so the same bar meshes the same way every time it is planned.
 */
export function interlock(mine: readonly MotifNote[], theirs: readonly MotifNote[], steps = 8, avoid = 1, seed = 0): MotifNote[] {
  const taken = new Set(mine.map((n) => Math.round(n.at * steps)));
  const r = rng(hashString(`interlock#${seed}`));
  const placed: { n: MotifNote; s: number }[] = [];
  let last = -1;
  for (const n of [...theirs].sort((x, y) => x.at - y.at)) {
    let s = Math.max(Math.round(n.at * steps), last + 1);
    if (r() < avoid) while (s < steps && taken.has(s)) s++;
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

// ── THE ENSEMBLE (building together, §13e): several lines at once, each its own place, meshed, landing together ──

/** Each note held to the line's next onset (85 %, as realize() does), the last to the bar's end. */
function holdToNext(ns: readonly MotifNote[]): MotifNote[] {
  return ns.map((n, i) => ({ ...n, len: ((i + 1 < ns.length ? ns[i + 1].at : 1) - n.at) * 0.85 }));
}

/** A line entering `shift` of the bar late, its tail wrapped to the bar's head (a canon's entry on a repeating bar). */
export function rotate(ns: readonly MotifNote[], shift = 0.5, steps = 8): MotifNote[] {
  const moved = ns.map((n) => ({ ...n, at: (Math.round(((n.at + shift) % 1) * steps) % steps) / steps })).sort((a, b) => a.at - b.at);
  const out: MotifNote[] = [];
  for (const n of moved) if (!out.length || out[out.length - 1].at !== n.at) out.push(n);
  return holdToNext(out);
}

/**
 * Where (by octaves) a line sits among `lines` already placed: the first of 0, +12, −12, +24, −24 whose centre is at
 * least `gap` semitones from every placed line's centre, inside lo … hi; else the one farthest from its nearest.
 */
export function placeApart(lines: readonly (readonly MotifNote[])[], l: readonly MotifNote[], gap = 9, lo = DIALOGUE_LO, hi = DIALOGUE_HI): number {
  if (!l.length) return 0;
  const centres = lines.filter((x) => x.length).map(mean);
  const c = mean(l);
  let tlo = Infinity;
  let thi = -Infinity;
  for (const n of l) {
    tlo = Math.min(tlo, n.pitch);
    thi = Math.max(thi, n.pitch);
  }
  let best = 0;
  let bestD = -Infinity;
  for (const s of [0, 12, -12, 24, -24]) {
    if (tlo + s < lo || thi + s > hi) continue;
    const d = centres.length ? Math.min(...centres.map((x) => Math.abs(c + s - x))) : Infinity;
    if (d >= gap) return s;
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * A BASS under the lines: a line's first two notes on the downbeat and the half bar (an ostinato — the floor the
 * ensemble stands on), moved down by octaves until it sits under every placed note (a fifth of room), not below `lo`.
 */
export function bassUnder(lines: readonly (readonly MotifNote[])[], l: readonly MotifNote[], lo = 36): MotifNote[] {
  if (!l.length) return [];
  const a = l[0];
  const b = l[1] ?? l[0];
  let floor = Infinity;
  for (const x of lines) for (const n of x) floor = Math.min(floor, n.pitch);
  const two = [
    { ...a, at: 0, len: 0.45 },
    { ...b, at: 0.5, len: 0.45 },
  ];
  let s = 0;
  const top = Math.max(a.pitch, b.pitch);
  const bottom = Math.min(a.pitch, b.pitch);
  while (Number.isFinite(floor) && top + s > floor - 7 && bottom + s - 12 >= lo) s -= 12;
  return shiftNotes(two, s);
}

/** The ARRIVAL: a line's first note on the downbeat with everyone's, the rest meshed into what is already there. */
export function landWith(placed: readonly MotifNote[], l: readonly MotifNote[], steps = 8, avoid = 1, seed = 0): MotifNote[] {
  if (!l.length) return [];
  const rest = interlock(placed, l.slice(1), steps, avoid, seed);
  return [{ ...l[0], at: 0, len: ((rest[0]?.at ?? 1) - 0) * 0.85 }, ...rest];
}
