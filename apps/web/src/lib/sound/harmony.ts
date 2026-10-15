/**
 * sound/harmony.ts — KEYS: every motif has its own, every building has its own (docs/sound-logic.md §3).
 *
 * There is no world key. A visitor's leitmotif is their identity, so it comes with its HOME KEY (root + mode,
 * from the id). A BUILDING is a key too (root + mode from the building's cell): when I come near one my motif
 * MODULATES into the building's key — the contour, rhythm and register stay mine, the scale under them changes.
 * Everybody at the same building is in the same key, so building together is where voices become consonant;
 * far from buildings each voice is in its own key, and the mass of them (the global view) is polytonal.
 *
 * Modes and chord stacking come from umwelt's chord_library (pure port). Pitches are MIDI numbers.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hashString, rng } from "./motif";

export interface Mode {
  name: string;
  intervals: number[];
  base: "major" | "minor";
}

/** umwelt chord_library MODES, darkest to brightest. */
export const MODES: readonly Mode[] = [
  { name: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10], base: "minor" },
  { name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10], base: "minor" },
  { name: "Aeolian", intervals: [0, 2, 3, 5, 7, 8, 10], base: "minor" },
  { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10], base: "minor" },
  { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10], base: "major" },
  { name: "Ionian", intervals: [0, 2, 4, 5, 7, 9, 11], base: "major" },
  { name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11], base: "major" },
];

export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export interface Key {
  /** Tonic as a pitch class (0 = C). */
  root: number;
  mode: Mode;
}

export interface HarmonyConfig {
  /** Which modes a HOME key may have (indices into MODES): the middle four, not too sour, not too sweet. */
  homeModes: number[];
  /** Which modes a BUILDING may have: wider — a building may be strange. */
  buildingModes: number[];
  /** Chord size: 3 = triads, 4 = sevenths. */
  chordSize: number;
}

export const DEFAULT_HARMONY: HarmonyConfig = {
  homeModes: [2, 3, 4, 5],
  buildingModes: [1, 2, 3, 4, 5, 6],
  chordSize: 4,
};

function keyFrom(seed: string, modes: readonly number[]): Key {
  const r = rng(hashString(seed));
  const root = Math.floor(r() * 12);
  const mode = MODES[modes[Math.floor(r() * modes.length)] ?? 3];
  return { root, mode };
}

/** The home key of a visitor (or bot): part of their identity. */
export function homeKey(id: string, cfg: HarmonyConfig = DEFAULT_HARMONY): Key {
  return keyFrom("home:" + id, cfg.homeModes);
}

/** The key of a building, from its identity (the slab's cell key). */
export function buildingKey(buildingId: string, cfg: HarmonyConfig = DEFAULT_HARMONY): Key {
  return keyFrom("building:" + buildingId, cfg.buildingModes);
}

export const keyName = (k: Key): string => `${KEY_NAMES[k.root]} ${k.mode.name}`;

/** Diatonic chord on `degree` of the mode: `size` stacked thirds as semitones above the TONIC (not the chord root). */
export function diatonicChord(mode: Mode, degree: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const d = degree + i * 2;
    out.push(mode.intervals[d % 7] + Math.floor(d / 7) * 12);
  }
  return out;
}

export interface PlaceChord {
  degree: number;
  /** Pitch classes (0..11) of the chord tones. */
  classes: number[];
  /** Pitch class of the chord root. */
  rootClass: number;
}

/** The chord of a key's degree (the tonic chord by default): what the bass and the pad play. */
export function keyChord(key: Key, degree = 0, size = DEFAULT_HARMONY.chordSize): PlaceChord {
  const tones = diatonicChord(key.mode, degree, size);
  return { degree, classes: tones.map((t) => (key.root + t) % 12), rootClass: (key.root + key.mode.intervals[degree]) % 12 };
}

/**
 * HARMONY MODE "world" (the 2026-10-14 afternoon version, commit 93e85c5, which the artist liked): ONE key per epoch
 * for everybody, with a Markov progression laid over the ground in bands along x + z — walking anywhere moves
 * through it, standing holds one chord, and conforming pulls every note onto it. Kept as a selectable mode next to
 * "identity" (a home key per motif, a key per building).
 */
export interface WorldKey extends Key {
  /** The progression over the ground: degree (0..6) per band, `bands` long, wrapping. */
  degrees: number[];
}

export interface WorldConfig {
  modes: number[];
  bands: number;
  /** Width of one band (cells): walking this far moves the chord on. */
  bandCells: number;
}

export const DEFAULT_WORLD: WorldConfig = { modes: [2, 3, 4, 5], bands: 16, bandCells: 4 };

/** The key, mode and progression of one epoch (seed = the epoch ms as a string). */
export function worldKey(seed: string, cfg: WorldConfig = DEFAULT_WORLD): WorldKey {
  const r = rng(hashString("key:" + seed));
  const root = Math.floor(r() * 12);
  const mode = MODES[cfg.modes[Math.floor(r() * cfg.modes.length)] ?? 3];
  const matrix = mode.base === "major" ? MAJOR_MARKOV : MINOR_MARKOV;
  const degrees: number[] = [0];
  for (let i = 1; i < cfg.bands; i++) {
    const opts = matrix[degrees[i - 1]];
    degrees.push(opts[Math.floor(r() * opts.length)]);
  }
  return { root, mode, degrees };
}

/** Which band of the progression a world position is in (bands run along x + z, so any walk crosses them). */
export function bandOf(x: number, z: number, cfg: WorldConfig = DEFAULT_WORLD): number {
  const b = Math.floor((x + z) / (CELL_SIZE * cfg.bandCells));
  return ((b % cfg.bands) + cfg.bands) % cfg.bands;
}

/** Diatonic Markov transitions by degree (umwelt chord_library): where a progression may go next. */
const MAJOR_MARKOV = [[3, 4, 5, 1], [4, 6, 0], [5, 3, 0], [0, 4, 1], [0, 5, 2], [1, 3, 0], [0, 2]];
const MINOR_MARKOV = [[3, 4, 5, 2], [4, 6, 0], [5, 3, 0], [0, 4, 6], [0, 5, 2], [1, 3, 6], [2, 0, 4]];

/**
 * The next degree of a progression in `key` after `degree`, chosen by `u` (0..1). A PATH is a progression: every
 * stretch of path walked moves the chord on (sequencer.ts); standing holds it; leaving the path falls back to the
 * tonic.
 */
export function nextDegree(key: Key, degree: number, u: number): number {
  const m = key.mode.base === "major" ? MAJOR_MARKOV : MINOR_MARKOV;
  const opts = m[((degree % 7) + 7) % 7];
  return opts[Math.min(opts.length - 1, Math.floor(u * opts.length))];
}

/** Pitch classes (0..11) of the key's scale. */
export function scaleClasses(key: Key): number[] {
  return key.mode.intervals.map((i) => (i + key.root) % 12);
}

/**
 * MIDI pitch `deg` scale degrees above `base` (negative = below; octaves wrap). `base` must be a scale note of the
 * key (snap it with `snapToClasses(base, scaleClasses(key))` first); it is degree 0 of the voice, not the tonic.
 */
export function degreePitch(key: Key, base: number, deg: number): number {
  const cls = (((base - key.root) % 12) + 12) % 12;
  const baseIdx = Math.max(0, key.mode.intervals.indexOf(cls));
  const total = baseIdx + deg;
  const oct = Math.floor(total / 7);
  const idx = ((total % 7) + 7) % 7;
  return base - key.mode.intervals[baseIdx] + oct * 12 + key.mode.intervals[idx];
}

/** The nearest pitch (MIDI) whose pitch class is one of `classes`; ties go down. */
export function snapToClasses(pitch: number, classes: readonly number[]): number {
  let best = pitch;
  let bestD = Infinity;
  for (const c of classes) {
    const base = pitch - (((pitch % 12) + 12) % 12) + c;
    for (const cand of [base - 12, base, base + 12]) {
      const d = Math.abs(cand - pitch);
      if (d < bestD || (d === bestD && cand < best)) {
        bestD = d;
        best = cand;
      }
    }
  }
  return best;
}

/** Chord name for the debug line / doc, e.g. "Dm7", "Dbm7b5". */
export function chordName(pc: PlaceChord): string {
  const third = (pc.classes[1] - pc.classes[0] + 12) % 12;
  const fifth = (pc.classes[2] - pc.classes[0] + 12) % 12;
  const seventh = pc.classes.length >= 4 ? (pc.classes[3] - pc.classes[0] + 12) % 12 : -1;
  let q = third === 3 ? (fifth === 6 ? "dim" : "m") : "";
  if (seventh === 10) q = q === "dim" ? "m7b5" : q + "7";
  else if (seventh === 11) q += "maj7";
  return KEY_NAMES[pc.rootClass] + q;
}

/** The chord name reduced to what Magenta's chord_pitches_improv surely knows: "", m, 7, m7, maj7. */
export function magentaChordName(name: string): string {
  return name.replace("m7b5", "m").replace("dim", "m");
}
