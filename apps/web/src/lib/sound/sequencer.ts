/**
 * sound/sequencer.ts — the SHARED GRID and what each bar holds (docs/sound-logic.md §5–7).
 *
 * Ported from the intersection / umwelt NoiseCraft sequencer logic (noisecraft/public/sequencer-logic.js), which
 * was what made that version musical: one clock for everybody, voices = participants, the others' notes placed on
 * the same grid as mine. The synth is Web Audio now (engine.ts); this module is the sequencer's brain, pure.
 *
 *   GRID        one bar = `barSec` (2 s) = 8 steps, counted from the EPOCH on the wall clock, so every tab, bot and
 *               view is on the same beat. Nothing is ever played off the grid.
 *   DENSITY     walking speed does not change the tempo (a shared pulse cannot smear): it changes how often the
 *               motif comes round — still = every other bar, walking = every bar, running = twice a bar.
 *   LOCK        pathP (a formed path under the feet) or stay × company pull the notes onto the chord of the place
 *               (harmony.ts): consonance arrives when you follow or build.
 *   BASS        on a path the root of the place's chord is a soft pulse on the downbeat: the walking rhythm.
 *   VOICES      the others within earshot play their own motifs on the same grid (intersection: bass / baritone /
 *               tenor = me / first neighbour / second neighbour). While I STAY among them the bars alternate:
 *               my bar, their bar (the nearest answers), and my motif borrows from theirs by how long they have
 *               been close (variation.ts); a Magenta phrase, when one has come back, takes my next bars.
 *   PAD         staying among others holds the chord tones (the building being born) — a sustained pad.
 */

import { placeChord, type PlaceChord, type WorldKey } from "./harmony";
import { midiToHz, realize, type Motif, type MotifNote, DEFAULT_MOTIF, hashString, rng } from "./motif";
import type { PersonalSignals } from "./signals";
import { CYCLES_PER_PHRASE, STEPS_PER_CYCLE, blend, stepsToCycle, type Phrase } from "./variation";

export interface SequencerParams {
  /** Seconds per bar (the grid). */
  barSec: number;
  /** Speed (world/s) below which the motif comes every other bar, above twice `speedMax` … see density(). */
  speedMax: number;
  /** Path strength from which the bass pulse is heard. */
  bassFrom: number;
  /** My motif comes on average every this many bars (v4 A2): 1 = every bar; 1.5 = two bars in three, drawn by chance (reproducible per bar). */
  motifEvery?: number;
  /** How much of the micro-tones is heard (motif.ts MotifConfig.microtone), 0..1. */
  microtone?: number;
  /** One of my bars in this many (on average) is played an octave (or two) away — 0 = never. */
  motifOctaveEvery?: number;
  /** How far such a shift may go: 1 = one octave, 2 = up to two. */
  motifOctaveRange?: number;
}

export const DEFAULT_SEQUENCER: SequencerParams = { barSec: 2, speedMax: 7, bassFrom: 0.25, motifEvery: 1, microtone: 1 };

export type Density = 0.5 | 1 | 2;

/** How often the motif comes round: still → every other bar, walking → every bar, running → twice a bar. */
export function density(speed: number, speedMax: number): Density {
  const s = speed / Math.max(0.01, speedMax);
  return s < 0.12 ? 0.5 : s < 0.75 ? 1 : 2;
}

/** 0..1 how much the place pulls the notes onto its chord. */
export function lockOf(sig: Pick<PersonalSignals, "pathP" | "stay" | "neighbours">): number {
  const company = Math.min(1, sig.neighbours.length / 2);
  return Math.max(0, Math.min(1, Math.max(sig.pathP, sig.stay * company)));
}

export interface VoiceBar {
  o: string;
  notes: MotifNote[];
}

export interface BarPlan {
  bar: number;
  chord: PlaceChord;
  lock: number;
  density: Density;
  /** Whether this bar is the others' answer (I keep quiet). */
  answer: boolean;
  me: MotifNote[];
  others: VoiceBar[];
  /** Downbeat pulses: at (0..1 of the bar), MIDI pitch, level 0..1. */
  bass: { at: number; pitch: number; level: number }[];
  /** Chord tones (MIDI) to hold through the bar and their level (0 = none). */
  pad: { pitches: number[]; level: number };
}

export interface BarInputs {
  bar: number;
  sig: PersonalSignals;
  key: WorldKey;
  me: Motif;
  others: ReadonlyMap<string, Motif>;
  /** 0..1 per neighbour id: how long and close they have been (engine keeps it). */
  closeness: ReadonlyMap<string, number>;
  /** A phrase (variation.ts) that takes my bars: its cycle index and the phrase; null = my motif. */
  phrase: { phrase: Phrase; from: number } | null;
  params?: SequencerParams;
}

/** Place a motif's cycle into a bar at the density: 0.5 = only even bars, 1 = once, 2 = twice (compressed). */
export function placeInBar(notes: readonly MotifNote[], d: Density, bar: number): MotifNote[] {
  if (d === 0.5) return bar % 2 === 0 ? notes.slice() : [];
  if (d === 1) return notes.slice();
  const out: MotifNote[] = [];
  for (const half of [0, 0.5]) for (const n of notes) out.push({ ...n, at: half + n.at / 2, len: n.len / 2 });
  return out;
}

export function planBar(inp: BarInputs): BarPlan {
  const p = inp.params ?? DEFAULT_SEQUENCER;
  const { bar, sig, key, me } = inp;
  const chord = placeChord(key, sig.x, sig.z);
  const lock = lockOf(sig);
  const d = density(sig.speed, p.speedMax);
  const company = Math.min(1, sig.neighbours.length / 2);
  const staying = sig.stay > 0.5 && sig.neighbours.length > 0;
  // call and response while staying among others: odd bars are theirs
  const answer = staying && bar % 2 === 1;
  const motifCfg = { ...DEFAULT_MOTIF, microtone: p.microtone ?? 1 };
  const every = Math.max(1, p.motifEvery ?? 1);
  // my bar: with probability 1/every, drawn from the bar and my id (the same answer every time this bar is planned)
  const myBar = every <= 1.0001 || rng(hashString(`${me.id}#every#${bar}`))() < 1 / every;

  // my notes: a Magenta phrase if one is running, else my motif blended with whoever has been close
  let mine: MotifNote[] = [];
  if (!answer && myBar) {
    if (inp.phrase && bar - inp.phrase.from < CYCLES_PER_PHRASE && bar >= inp.phrase.from) {
      const cyc = stepsToCycle(inp.phrase.phrase, (bar - inp.phrase.from) * STEPS_PER_CYCLE);
      mine = cyc.map((n) => ({ at: n.at, len: n.len, pitch: n.pitch, freq: midiToHz(n.pitch, me.colour), locked: false }));
    } else {
      let motif = me;
      const nearest = sig.neighbours[0];
      const amount = nearest ? inp.closeness.get(nearest.o) ?? 0 : 0;
      const theirs = nearest ? inp.others.get(nearest.o) : undefined;
      if (theirs && amount > 0) motif = blend(me, theirs, amount, bar);
      mine = placeInBar(realize(motif, key, chord, lock, bar, motifCfg), d, bar);
    }
    // now and then the whole bar an octave (or two) away, so the voice is not always in one register
    const octEvery = p.motifOctaveEvery ?? 0;
    if (mine.length && octEvery > 0) {
      const r = rng(hashString(`${me.id}#oct#${bar}`));
      if (r() < 1 / octEvery) {
        const range = Math.max(1, Math.round(p.motifOctaveRange ?? 1));
        const k = 1 + Math.floor(r() * range);
        const shift = (r() < 0.5 ? -1 : 1) * 12 * k;
        mine = mine.map((n) => ({ ...n, pitch: n.pitch + shift, freq: n.freq * Math.pow(2, shift / 12) }));
      }
    }
  }

  // the others: their own motifs on the same grid, locked like me (we share the place); in their answer bar the
  // nearest plays alone, otherwise everybody, every bar
  const others: VoiceBar[] = [];
  for (const n of sig.neighbours) {
    const m = inp.others.get(n.o);
    if (!m) continue;
    if (staying && !answer && n !== sig.neighbours[0]) {
      // while staying, the others wait for their bar — except the nearest, who plays along with me softly
      continue;
    }
    if (staying && answer && n !== sig.neighbours[0]) continue;
    const notes = realize(m, key, chord, Math.max(lock, staying ? 0.8 : 0), bar, motifCfg);
    others.push({ o: n.o, notes });
  }

  // bass: the root of the place on the downbeat while on a path
  const bass: BarPlan["bass"] = [];
  if (sig.pathP >= p.bassFrom) {
    const level = Math.min(1, (sig.pathP - p.bassFrom) / (1 - p.bassFrom) + 0.25);
    const pitch = 36 + chord.rootClass; // C2 … B2
    bass.push({ at: 0, pitch, level });
    if (d === 2) bass.push({ at: 0.5, pitch, level: level * 0.7 });
  }

  // pad: the chord held while building
  const padLevel = sig.stay * company;
  const pad = padLevel > 0.2 ? { pitches: [36 + chord.rootClass, ...chord.classes.map((c) => 48 + c)], level: padLevel } : { pitches: [], level: 0 };

  return { bar, chord, lock, density: d, answer, me: mine, others, bass, pad };
}

/** Bar index and the AudioContext time of its start, from the epoch on the wall clock (shared by every tab). */
export function barClock(epochMs: number, wallMs: number, ctxNow: number, barSec: number): { bar: number; start: number } {
  const elapsed = (wallMs - epochMs) / 1000;
  const bar = Math.floor(elapsed / barSec);
  const into = elapsed - bar * barSec;
  return { bar, start: ctxNow - into };
}
