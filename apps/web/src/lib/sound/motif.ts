/**
 * sound/motif.ts — the visitor's SIGNATURE (graduation_exhibition_spec §3.1; docs/sound-logic.md §4).
 *
 * On arrival every visitor (or bot) is given a leitmotif: a REGISTER (where their voice sits), a SHAPE of 3–5 notes
 * as REAL INTERVALS in semitones (the motif's true identity, the way a composer remembers a theme), a RHYTHM CELL
 * (which of the cycle's 8 steps they sound on) and a micro-tonal COLOUR (a few cents off, constant). Density (notes)
 * and tempo (cycle speed) differ per signature. Everything is a pure function of the visitor id, so the same person
 * sounds the same in every view and on every tab; the global drone takes the PARTIAL (`partialOf`) of the same motif.
 *
 * In a KEY the shape is rendered as a TONAL ANSWER (harmony.ts): semitones and whole tones are traded within the
 * line of "still the same motif" — every direction, every step / skip / leap kept — so one motif can move into
 * any key or chord and stay recognisable, which is what the fusion of the two harmony modes rests on.
 *
 * Pure and deterministic. No Web Audio here (engine.ts).
 */

import { pullToChord, scaleClasses, snapToClasses, tonalAnswer, type Key, type PlaceChord } from "./harmony";

export interface MotifConfig {
  /** Register: MIDI pitch of the motif's first note, drawn uniformly (D3 … D5). */
  baseLo: number;
  baseHi: number;
  /** Notes in the motif (inclusive). */
  notesMin: number;
  notesMax: number;
  /** Steps of the rhythm grid in one cycle. */
  steps: number;
  /** The cell lives in the first `cellSpan` steps of the cycle; the rest is a rest (the artist, 2026-10-15: a motif
   *  spread over the whole bar was too long to feel like a name — a short figure and a pause is one). */
  cellSpan: number;
  /** The last note of the cell is held at most this many steps (so the rest after it is heard). */
  lastHold: number;
  /** Constant micro-tonal colour of a voice: ± this many cents. */
  colourCents: number;
  /** Extra wobble (cents) of a ROUGH voice (crossing vegetation), per note. */
  freeCents: number;
  /** Length (s) of one cycle at 60 BPM (see cycleSeconds). */
  cycleSec: number;
  /** Per-signature tempo scale range (log-uniform): 1 / tempoRange … tempoRange. */
  tempoRange: number;
  /** How many notes of a rendered motif may stay chromatic (outside the key) to keep its shape. */
  chromaticBudget: number;
}

export const DEFAULT_MOTIF: MotifConfig = {
  baseLo: 50,
  baseHi: 74,
  notesMin: 2,
  notesMax: 4,
  steps: 8,
  cellSpan: 6,
  lastHold: 2,
  colourCents: 12,
  freeCents: 35,
  cycleSec: 2,
  tempoRange: 1.33,
  chromaticBudget: 1,
};

export interface Motif {
  id: string;
  /** MIDI pitch of the first note (the register). */
  base: number;
  /** Hz of the register note: the "centroid" the spec speaks of; the global partial is derived from it. */
  centroid: number;
  /** The shape: semitones from the register note, in order (the first is 0). This is the identity. */
  semis: number[];
  /** Step (0 … steps−1) each note sounds on, strictly increasing, the first at 0. */
  onsets: number[];
  steps: number;
  /** Micro-tonal colour (cents), constant for this voice. */
  colour: number;
  /** Per-signature tempo scale (1 = the configured cycle). */
  tempoScale: number;
  /** 0..1 timbre character (0 = dark / sine-like, 1 = brighter). */
  timbre: number;
  cycleSec: number;
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic PRNG, 0..1. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiToHz = (midi: number, cents = 0): number => 440 * Math.pow(2, (midi - 69) / 12 + cents / 1200);

/** The signature of one visitor id. Same id, same motif, always. */
export function makeMotif(id: string, cfg: MotifConfig = DEFAULT_MOTIF): Motif {
  const r = rng(hashString(id));
  const base = cfg.baseLo + Math.floor(r() * (cfg.baseHi - cfg.baseLo + 1));
  // how many notes: the middle count most often (2–4 → 3 half the time), never outside the range
  const span = cfg.notesMax - cfg.notesMin;
  const u0 = r();
  const n = span <= 0 ? cfg.notesMin : cfg.notesMin + (u0 < 0.3 ? 0 : u0 < 0.8 ? Math.min(span, 1) : span);
  // the shape: a walk in real intervals — mostly steps (1–2), some skips (3–4), now and then a leap (5–7) —
  // mostly within an octave, never the same note twice in a row
  const semis = [0];
  let p = 0;
  for (let i = 1; i < n; i++) {
    const u = r();
    const size = u < 0.55 ? 1 + Math.floor(r() * 2) : u < 0.88 ? 3 + Math.floor(r() * 2) : 5 + Math.floor(r() * 3);
    const up = p <= -4 ? true : p >= 9 ? false : r() < 0.55;
    p += up ? size : -size;
    semis.push(p);
  }
  // rhythm cell: n distinct steps inside the first cellSpan steps of the grid, the first on the downbeat; the rest of
  // the cycle is a rest — the figure is short enough to be heard whole, like a name
  const pool = Array.from({ length: Math.max(n - 1, Math.min(cfg.cellSpan, cfg.steps) - 1) }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const onsets = [0, ...pool.slice(0, n - 1)].sort((a, b) => a - b);
  const colour = (r() * 2 - 1) * cfg.colourCents;
  const tempoScale = Math.exp((r() * 2 - 1) * Math.log(cfg.tempoRange));
  const timbre = r();
  return { id, base, centroid: midiToHz(base), semis, onsets, steps: cfg.steps, colour, tempoScale, timbre, cycleSec: cfg.cycleSec };
}

export interface MotifNote {
  /** Onset within the cycle, 0..1. */
  at: number;
  /** Length as a share of the cycle (0..1). */
  len: number;
  /** MIDI pitch played (after the key and the chord). */
  pitch: number;
  freq: number;
  /** Whether the chord pulled this note onto a chord tone. */
  locked: boolean;
}

/**
 * One cycle of the motif made real in a KEY, and against a CHORD:
 *   1. TONAL ANSWER: the shape (real intervals) is laid on the key's scale, trading semitones for whole tones only
 *      where the motif still reads as itself (directions and step / skip / leap classes kept; up to
 *      `chromaticBudget` notes may stay outside the key when the shape needs them).
 *   2. CHORD PULL: with probability `lock` a note on a STRONG beat (step 0 or 4 of 8) is moved to the nearest chord
 *      tone — only if that keeps the shape too; weak-beat notes stay as passing tones. That is how a composer makes
 *      a theme fit a progression: chord tones on the beat, the rest passes.
 *   3. ROUGH: an unstable voice (crossing vegetation) wobbles by `freeCents`.
 * `cycle` indexes the cycle so the choices differ from cycle to cycle but are reproducible.
 */
export function realize(m: Motif, key: Key, chord: PlaceChord | null, lock: number, cycle: number, cfg: MotifConfig = DEFAULT_MOTIF, rough = 1 - lock): MotifNote[] {
  const r = rng(hashString(`${m.id}#${cycle}`));
  const n = m.semis.length;
  const answered = tonalAnswer(m.semis, m.base, key, cfg.chromaticBudget);
  const strong = m.onsets.map((o) => o % (m.steps / 2) === 0);
  const { pitches, locked } = chord && lock > 0 ? pullToChord(answered, strong, chord.classes, lock, r) : { pitches: answered, locked: answered.map(() => false) };
  return pitches.map((pitch, i) => {
    const wobble = rough * cfg.freeCents * (r() * 2 - 1);
    const next = i + 1 < n ? m.onsets[i + 1] : Math.min(m.steps, m.onsets[i] + cfg.lastHold);
    return { at: m.onsets[i] / m.steps, len: ((next - m.onsets[i]) / m.steps) * 0.85, pitch, freq: midiToHz(pitch, m.colour + wobble), locked: locked[i] };
  });
}

export interface RealizeOpts {
  /** The last pitch of my previous bar: the first note of this one anchors on a chord tone near it (a SEQUENCE). */
  anchor?: number | null;
  /** Notes that may stay outside the key (harmony's tension and the roughness open it; 1 by default). */
  chromaticBudget?: number;
  /** PASSING TONES: a leap of a fifth or more with room before the next onset is filled with a scale tone. */
  passing?: boolean;
  /** A FULL cadence: the last note lands on the tonic or the third. */
  cadence?: "none" | "half" | "full";
  /** Anchor even when the walk does not conform (the chord just changed: the motif follows it anyway). */
  forceAnchor?: boolean;
}

/**
 * ANCHOR (the sequence technique): the base of the motif shifted by at most a fourth so that its first note (the
 * scale tone nearest the base) is a CHORD tone, preferring the smallest shift and the pitch nearest `anchor`
 * (where my previous bar ended): the motif moves with the progression instead of sitting on its register.
 */
export function anchorBase(m: Motif, key: Key, chord: PlaceChord, anchor: number | null): number {
  const scale = scaleClasses(key);
  let best = m.base;
  let bestCost = Infinity;
  for (let s = -5; s <= 5; s++) {
    const first = snapToClasses(m.base + s, scale);
    const onChord = chord.classes.includes(((first % 12) + 12) % 12);
    const cost = Math.abs(s) + (onChord ? 0 : 20) + (anchor != null ? 0.4 * Math.abs(first - anchor) : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = m.base + s;
    }
  }
  return best;
}

/**
 * `realize` with the harmony's say (docs/sound-plan-hybrid-2026-10-15.md §3): anchored on a chord tone when the walk
 * conforms (lock ≥ 0.3), a chromatic budget from the tension, passing tones when asked, the cadence landing. The
 * identity stays: directions and interval classes of the shape, the rhythm cell, the colour.
 */
export function realizeIn(m: Motif, key: Key, chord: PlaceChord | null, lock: number, cycle: number, rough: number, opts: RealizeOpts = {}, cfg: MotifConfig = DEFAULT_MOTIF): MotifNote[] {
  const base = chord && (lock >= 0.3 || opts.forceAnchor) ? anchorBase(m, key, chord, opts.anchor ?? null) : m.base;
  const mm = base === m.base ? m : { ...m, base };
  const c = opts.chromaticBudget != null ? { ...cfg, chromaticBudget: opts.chromaticBudget } : cfg;
  let notes = realize(mm, key, chord, lock, cycle, c, rough);
  if (opts.passing && notes.length >= 2) {
    const scale = scaleClasses(key);
    const out: MotifNote[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      out.push(n);
      const nx = notes[i + 1];
      if (!nx) continue;
      const gapSteps = Math.round((nx.at - n.at) * m.steps);
      if (Math.abs(nx.pitch - n.pitch) < 5 || gapSteps < 2) continue;
      const midStep = Math.floor((n.at + nx.at) * 0.5 * m.steps);
      const mid = snapToClasses(Math.round((n.pitch + nx.pitch) / 2), scale);
      if (mid === n.pitch || mid === nx.pitch) continue;
      const at = midStep / m.steps;
      out[out.length - 1] = { ...n, len: Math.min(n.len, (at - n.at) * 0.85) };
      out.push({ at, len: (nx.at - at) * 0.85, pitch: mid, freq: midiToHz(mid, m.colour), locked: false });
    }
    notes = out;
  }
  if (opts.cadence === "full" && notes.length) {
    const last = notes[notes.length - 1];
    const landing = [key.root, (key.root + key.mode.intervals[2]) % 12];
    const to = snapToClasses(last.pitch, landing);
    notes[notes.length - 1] = { ...last, pitch: to, freq: midiToHz(to, m.colour), locked: true };
  }
  return notes;
}

/**
 * Seconds of one cycle when the visitor's state asks for `bpm`: the configured cycle is what 60 BPM means, so a
 * still visitor (40 BPM) hears a 3 s cycle and a running one (140 BPM) a 0.86 s cycle, scaled by the signature.
 */
export function cycleSeconds(m: Motif, bpm: number): number {
  return (m.cycleSec * 60) / Math.max(1, bpm) / m.tempoScale;
}

/**
 * GLOBAL view: a person is one low partial — their register `octavesDown` octaves lower. All the partials of all
 * the people together are the ground drone (concept.md §4, acoustic stratigraphy).
 */
export function partialOf(m: Motif, octavesDown = 3): number {
  return m.centroid / Math.pow(2, octavesDown);
}
