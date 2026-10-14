/**
 * sound/harmony.ts — the TONAL FIELD the world shares, and the chord of a place.
 *
 * Why: the first headset sound (micro-tones ±90 cents round a random centroid) was an out-of-tune unison — nothing
 * in it could resolve, so neither following a path nor building with others could ever sound like something
 * (docs/sound-logic.md §3). So the pitch content now comes from ONE shared field:
 *
 *   WORLD KEY      one key + mode per epoch (seeded by the epoch), diatonic for everybody: two visitors near each
 *                  other are consonant-ish by construction, before any rule acts.
 *   PROGRESSION    the ground carries harmony: a Markov chord progression (umwelt's chord_library, kept here as a
 *                  pure port) laid out over the ground in bands (`bandCells` cells wide, along x + z). Walking
 *                  moves through the progression; standing holds one chord. So a path IS a progression, and a
 *                  building is born on one chord.
 *   LOCK           how much a voice snaps to the chord of its place: a formed path under the feet, or staying among
 *                  others, pull every tone of the motif onto the nearest chord tone (consonance arrives when you
 *                  follow or build). Alone on open ground the motif is free: diatonic but with loose timing and
 *                  wider micro-tonal colour.
 *
 * Pitches are MIDI numbers (semitones); frequencies are made in motif.ts. Pure and deterministic.
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

/** Diatonic Markov transitions by degree (umwelt chord_library). */
const MAJOR_MARKOV = [[3, 4, 5, 1], [4, 6, 0], [5, 3, 0], [0, 4, 1], [0, 5, 2], [1, 3, 0], [0, 2]];
const MINOR_MARKOV = [[3, 4, 5, 2], [4, 6, 0], [5, 3, 0], [0, 4, 6], [0, 5, 2], [1, 3, 6], [2, 0, 4]];

export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export interface WorldKey {
  /** Tonic as a pitch class (0 = C). */
  root: number;
  mode: Mode;
  /** The chord progression laid over the ground: degree (0..6) per band, `bands` long, wrapping. */
  degrees: number[];
}

export interface HarmonyConfig {
  /** Which modes an epoch may get (indices into MODES). The outer ones are left out by default: too sour / too sweet. */
  modes: number[];
  /** Length of the progression before it wraps (bands). */
  bands: number;
  /** Width of one band (cells): walking this far moves the chord on. */
  bandCells: number;
  /** Chord size: 3 = triads, 4 = sevenths. */
  chordSize: number;
}

export const DEFAULT_HARMONY: HarmonyConfig = {
  modes: [2, 3, 4, 5],
  bands: 16,
  bandCells: 4,
  chordSize: 4,
};

/** The key, mode and progression of one epoch (seed = the epoch key / ms as a string). */
export function worldKey(seed: string, cfg: HarmonyConfig = DEFAULT_HARMONY): WorldKey {
  const r = rng(hashString("key:" + seed));
  const root = Math.floor(r() * 12);
  const mode = MODES[cfg.modes[Math.floor(r() * cfg.modes.length)] ?? 3];
  const matrix = mode.base === "major" ? MAJOR_MARKOV : MINOR_MARKOV;
  const degrees: number[] = [0];
  for (let i = 1; i < cfg.bands; i++) {
    const from = degrees[i - 1];
    const opts = matrix[from];
    degrees.push(opts[Math.floor(r() * opts.length)]);
  }
  return { root, mode, degrees };
}

/** Which band of the progression a world position is in (bands run along x + z, so any walk crosses them). */
export function bandOf(x: number, z: number, cfg: HarmonyConfig = DEFAULT_HARMONY): number {
  const b = Math.floor((x + z) / (CELL_SIZE * cfg.bandCells));
  return ((b % cfg.bands) + cfg.bands) % cfg.bands;
}

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
  band: number;
  degree: number;
  /** Pitch classes (0..11) of the chord tones. */
  classes: number[];
  /** Pitch class of the chord root. */
  rootClass: number;
}

/** The chord of a place. */
export function placeChord(key: WorldKey, x: number, z: number, cfg: HarmonyConfig = DEFAULT_HARMONY): PlaceChord {
  const band = bandOf(x, z, cfg);
  const degree = key.degrees[band];
  const tones = diatonicChord(key.mode, degree, cfg.chordSize);
  const classes = tones.map((t) => (key.root + t) % 12);
  return { band, degree, classes, rootClass: (key.root + key.mode.intervals[degree]) % 12 };
}

/** Pitch classes (0..11) of the key's scale. */
export function scaleClasses(key: WorldKey): number[] {
  return key.mode.intervals.map((i) => (i + key.root) % 12);
}

/**
 * MIDI pitch `deg` scale degrees above `base` (negative = below; octaves wrap). `base` must be a scale note of the
 * key (snap it with `snapToClasses(base, scaleClasses(key))` first); it is degree 0 of the voice, not the tonic.
 */
export function degreePitch(key: WorldKey, base: number, deg: number): number {
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
    // the candidate of class c nearest to pitch
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

/** Chord name for the debug line / doc, e.g. "Dm7" in "A Aeolian". */
export function chordName(key: WorldKey, pc: PlaceChord): string {
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
