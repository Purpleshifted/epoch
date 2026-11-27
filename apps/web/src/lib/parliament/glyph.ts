/**
 * parliament/glyph.ts — a being's melody WRITTEN DOWN (the artist, 2026-11-01: the melody is the identity): the motif
 * every id already has (lib/sound/motif.ts, a pure function of the id) as a small score, the 8 steps of its bar across
 * and 8 rows of pitch, each note a bar as long as it lasts; a high voice sits high in the box. Read-only: nothing here
 * changes the sound.
 *
 *   glyphOf(id)          the dots of a being's melody as it is now (its newest word once it has answered — learnWords)
 *   birthGlyphOf(id)     the dots of the melody it was born with
 *   newWordOf(a, b, s)   the dots of a's melody with some of b's in it (sound/variation.ts blend, for display)
 *   rhythmOf(id)         which of the 8 steps it sounds on: how its square blinks
 *   individualNo(id)     the four digits the record calls it by ("개체 0417")
 *
 * Pure and deterministic.
 */

import { hashString, makeMotif, type Motif } from "@/lib/sound/motif";
import { blend } from "@/lib/sound/variation";

export const GLYPH_COLS = 8;
export const GLYPH_ROWS = 8;

export interface GlyphDot {
  col: number;
  row: number;
  /** Steps until the next note (the melody as a shape: each note lasts until the next). */
  len: number;
}

const REGISTER_LO = 50;
const REGISTER_SPAN = 24;

/** The dots of a motif: rows count from the top; a contour wider than the box is squeezed into it. */
export function glyphDots(m: Pick<Motif, "base" | "degrees" | "onsets">): GlyphDot[] {
  const hi = Math.max(...m.degrees);
  const lo = Math.min(...m.degrees);
  const spread = hi - lo;
  const scale = spread > GLYPH_ROWS - 1 ? (GLYPH_ROWS - 1) / spread : 1;
  const height = Math.round(spread * scale);
  const high = Math.min(1, Math.max(0, (m.base - REGISTER_LO) / REGISTER_SPAN));
  const top = Math.round((GLYPH_ROWS - 1 - height) * (1 - high));
  return m.onsets.map((col, i) => ({ col, row: top + Math.round((hi - m.degrees[i]) * scale), len: (m.onsets[i + 1] ?? GLYPH_COLS) - col }));
}

const glyphs = new Map<string, GlyphDot[]>();

// ── A BEING'S CURRENT WORD (the artist, 2026-11-27: "모두 반영되도록" — sound-logic §13d) ──
// An answer gives the answerer a new word (newWordMotifOf), and from then on that word is their melody: what their
// voice sings, how their square blinks, the glyph the wall and the record draw. The seed head the answer leaves (a
// `k = "s"` event) carries whom they answered and the word's seed (PEvent.to / .seed, written on the redesigned
// personal view only), so every page that reads the log learns it (learnWords) — the same browser's wall included.
// The newest answer wins. Before any answer, and for every id without one, the word IS the id's own melody.

const words = new Map<string, { s: number; to: string; seed: number }>();
const wordMotifs = new Map<string, Motif>();
let wordsSeen = 0;

/** Learn the answers in `events` (their seed heads): each answerer's newest word. Cheap to call on every fold. */
export function learnWords(events: Iterable<{ k: string; o: string; s: number; to?: string; seed?: number }>): void {
  for (const e of events) {
    if (e.k !== "s" || typeof e.to !== "string" || !Number.isFinite(e.seed)) continue;
    const had = words.get(e.o);
    if (had && had.s >= e.s) continue;
    words.set(e.o, { s: e.s, to: e.to, seed: e.seed! });
    wordMotifs.delete(e.o);
    glyphs.delete(e.o);
    rhythms.delete(e.o);
    wordsSeen++;
  }
}

/** Changes whenever a word is learnt: for what is cached outside this module (a texture, a memo). */
export const wordsVersion = (): number => wordsSeen;

/** Which word an id speaks now: "" = its own melody; else whom it answered and the seed (a cache key). */
export function wordKeyOf(id: string): string {
  const w = words.get(id);
  return w ? `${w.to}~${w.seed}` : "";
}

/** The melody an id has NOW: the word its newest answer gave, else its own (makeMotif). */
export function wordMotifOf(id: string): Motif {
  let m = wordMotifs.get(id);
  if (!m) {
    const w = words.get(id);
    m = w ? newWordMotifOf(id, w.to, w.seed) : makeMotif(id);
    wordMotifs.set(id, m);
  }
  return m;
}

/** The dots of a being's melody as it is NOW (its newest word, else its own). */
export function glyphOf(id: string): GlyphDot[] {
  let g = glyphs.get(id);
  if (!g) {
    g = glyphDots(wordMotifOf(id));
    glyphs.set(id, g);
  }
  return g;
}

const births = new Map<string, GlyphDot[]>();

/** The dots of the melody a being was BORN with — the record's "고유 어휘", whatever it has become since. */
export function birthGlyphOf(id: string): GlyphDot[] {
  let g = births.get(id);
  if (!g) {
    g = glyphDots(makeMotif(id));
    births.set(id, g);
  }
  return g;
}

const sameDots = (a: readonly GlyphDot[], b: readonly GlyphDot[]) => a.length === b.length && a.every((d, i) => d.col === b[i].col && d.row === b[i].row);

/**
 * a's melody after a long contact with b: a mix that is neither's own (the amounts the sound passes through while two
 * stay close). `seed` picks which mix; a seed whose mix comes out as a's own moves on to the next.
 */
export function newWordOf(a: string, b: string, seed: number): GlyphDot[] {
  return glyphDots(newWordMotifOf(a, b, seed));
}

/** The new word as a melody (what newWordOf writes down): the answer plays it back (the artist, 2026-11-10). */
export function newWordMotifOf(a: string, b: string, seed: number): Motif {
  const mine = makeMotif(a);
  const theirs = makeMotif(b);
  const own = glyphDots(mine);
  const other = glyphDots(theirs);
  for (let k = 0; k < 16; k++) {
    const mixed = blend(mine, theirs, k < 8 ? 0.45 : 0.7, seed + k);
    const dots = glyphDots(mixed);
    if (!sameDots(dots, own) && !sameDots(dots, other)) return mixed;
  }
  return mine;
}

const rhythms = new Map<string, boolean[]>();

/** The steps a being's melody sounds on (its newest word's, once it has answered someone). */
export function rhythmOf(id: string): boolean[] {
  let r = rhythms.get(id);
  if (!r) {
    const m = wordMotifOf(id);
    r = Array.from({ length: m.steps }, (_, i) => m.onsets.includes(i));
    rhythms.set(id, r);
  }
  return r;
}

/** Four digits from an id (bots and visitors alike), the same in every view. */
export function individualNo(id: string): string {
  return String(hashString(id) % 10000).padStart(4, "0");
}

/** The step of the shared bar (8 steps, 2 s) at a moment in ms: every square on the screen keeps this time. */
export const STEP_MS = 250;
export const stepAt = (ms: number): number => Math.floor(ms / STEP_MS) % GLYPH_COLS;
