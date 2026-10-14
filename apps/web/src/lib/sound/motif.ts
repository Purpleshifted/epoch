/**
 * sound/motif.ts — the visitor's SIGNATURE (graduation_exhibition_spec §3.1, revised 2026-10-14; docs/sound-logic.md §4).
 *
 * On arrival every visitor (or bot) is given a leitmotif: a REGISTER (where their voice sits), a CONTOUR of 3–5
 * scale degrees of the world's shared mode (harmony.ts), a RHYTHM CELL (which of the cycle's 8 steps they sound
 * on) and a micro-tonal COLOUR (a few cents off, constant: the voice stays recognisable). Density (notes) and
 * tempo (cycle speed) differ per signature. Everything is a pure function of the visitor id, so the same person
 * sounds the same in every view and on every tab; the global drone takes the PARTIAL (`partialOf`) of the same motif.
 *
 * The 2026-10-10 version put the whole pitch content in micro-tones (±90 cents) — an out-of-tune unison that was
 * monotonous and could not resolve. Pitch now comes from the shared tonal field; micro-tones are colour only.
 *
 * Pure and deterministic. No Web Audio here (engine.ts).
 */

import { degreePitch, scaleClasses, snapToClasses, type PlaceChord, type WorldKey } from "./harmony";

export interface MotifConfig {
  /** Register: MIDI pitch of the motif's degree 0, drawn uniformly (D3 … D5). */
  baseLo: number;
  baseHi: number;
  /** Notes in the motif (inclusive). */
  notesMin: number;
  notesMax: number;
  /** Steps of the rhythm grid in one cycle. */
  steps: number;
  /** Constant micro-tonal colour of a voice: ± this many cents. */
  colourCents: number;
  /** Extra wobble (cents) of a FREE voice (lock 0: alone, off any path), per note. */
  freeCents: number;
  /** Length (s) of one cycle at 60 BPM (see cycleSeconds). */
  cycleSec: number;
  /** Per-signature tempo scale range (log-uniform): 1 / tempoRange … tempoRange. */
  tempoRange: number;
}

export const DEFAULT_MOTIF: MotifConfig = {
  baseLo: 50,
  baseHi: 74,
  notesMin: 3,
  notesMax: 5,
  steps: 8,
  colourCents: 12,
  freeCents: 35,
  cycleSec: 2,
  tempoRange: 1.33,
};

export interface Motif {
  id: string;
  /** MIDI pitch of degree 0 (the register). */
  base: number;
  /** Hz of the register note: the "centroid" the spec speaks of; the global partial is derived from it. */
  centroid: number;
  /** Scale degrees relative to the register (0 = the register note; may go below 0 or above 6), in order. */
  degrees: number[];
  /** Step (0 … steps−1) each degree sounds on, strictly increasing, the first at 0. */
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
  const n = cfg.notesMin + Math.floor(r() * (cfg.notesMax - cfg.notesMin + 1));
  // contour: a walk in scale degrees, steps of 1–3, mostly within an octave, never the same degree twice in a row
  const degrees = [0];
  let d = 0;
  for (let i = 1; i < n; i++) {
    const step = 1 + Math.floor(r() * 3);
    const up = d <= -2 ? true : d >= 5 ? false : r() < 0.55;
    d += up ? step : -step;
    degrees.push(d);
  }
  // rhythm cell: n distinct steps of the grid, the first on the downbeat
  const pool = Array.from({ length: cfg.steps - 1 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const onsets = [0, ...pool.slice(0, n - 1)].sort((a, b) => a - b);
  const colour = (r() * 2 - 1) * cfg.colourCents;
  const tempoScale = Math.exp((r() * 2 - 1) * Math.log(cfg.tempoRange));
  const timbre = r();
  return { id, base, centroid: midiToHz(base), degrees, onsets, steps: cfg.steps, colour, tempoScale, timbre, cycleSec: cfg.cycleSec };
}

export interface MotifNote {
  /** Onset within the cycle, 0..1. */
  at: number;
  /** Length as a share of the cycle (0..1). */
  len: number;
  /** MIDI pitch played (after the lock). */
  pitch: number;
  freq: number;
  /** Whether the lock moved this note onto a chord tone. */
  locked: boolean;
}

/**
 * One cycle of the motif made real in the world: degrees → pitches of the world's mode in the motif's register,
 * then LOCKED onto the chord of the place with probability `lock` per note (a formed path under the feet, or
 * staying among others, see signals.ts / docs/sound-logic.md §5). A free voice (lock 0) wobbles by `freeCents`.
 * `cycle` indexes the cycle so the choices differ from cycle to cycle but are reproducible.
 */
export function realize(m: Motif, key: WorldKey, chord: PlaceChord | null, lock: number, cycle: number, cfg: MotifConfig = DEFAULT_MOTIF): MotifNote[] {
  const r = rng(hashString(`${m.id}#${cycle}`));
  const n = m.degrees.length;
  // the register lands on the nearest note of the world's scale: degree 0 of this voice
  const base = snapToClasses(m.base, scaleClasses(key));
  return m.degrees.map((deg, i) => {
    let pitch = degreePitch(key, base, deg);
    let locked = false;
    if (chord && lock > 0 && r() < lock) {
      const snapped = snapToClasses(pitch, chord.classes);
      locked = true;
      pitch = snapped;
    } else r();
    const wobble = (1 - lock) * cfg.freeCents * (r() * 2 - 1);
    const next = i + 1 < n ? m.onsets[i + 1] : m.steps;
    return { at: m.onsets[i] / m.steps, len: ((next - m.onsets[i]) / m.steps) * 0.85, pitch, freq: midiToHz(pitch, m.colour + wobble), locked };
  });
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
