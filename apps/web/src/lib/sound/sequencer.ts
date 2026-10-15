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
import { midiToHz, realize, type Motif, type MotifNote } from "./motif";
import type { PersonalSignals } from "./signals";
import { CYCLES_PER_PHRASE, STEPS_PER_CYCLE, blend, stepsToCycle, type Phrase } from "./variation";

export interface SequencerParams {
  /** Seconds per bar (the grid). */
  barSec: number;
  /** Speed (world/s) below which the motif comes every other bar, above twice `speedMax` … see density(). */
  speedMax: number;
  /** Path strength from which the bass pulse is heard. */
  bassFrom: number;
  /** How much conforming pulls single notes of a motif onto the chord of the place (0 = never: the motif is untouched). */
  lockPull: number;
}

export const DEFAULT_SEQUENCER: SequencerParams = { barSec: 2, speedMax: 7, bassFrom: 0.25, lockPull: 0.25 };

export type Density = 0.5 | 1 | 2;

/** How often the motif comes round: still → every other bar, walking → every bar, running → twice a bar. */
export function density(speed: number, speedMax: number): Density {
  const s = speed / Math.max(0.01, speedMax);
  return s < 0.12 ? 0.5 : s < 0.75 ? 1 : 2;
}

/**
 * CONFORMITY 0..1: how much the visitor goes along with what is already there — a formed path under the feet,
 * concrete, or staying among others (building). The conforming walk is the stable one.
 */
export function conformity(sig: Pick<PersonalSignals, "pathP" | "stay" | "neighbours" | "sealed">): number {
  const company = Math.min(1, sig.neighbours.length / 2);
  return Math.max(0, Math.min(1, Math.max(sig.pathP, sig.stay * company, sig.sealed * 0.7)));
}

/**
 * ROUGHNESS 0..1: how unstable the voice is — crossing untrodden vegetation while moving is the roughest walk;
 * standing still anywhere is calmer; anything conforming is smooth.
 */
export function roughness(sig: Pick<PersonalSignals, "pathP" | "stay" | "neighbours" | "sealed" | "grass" | "speed">, speedMax: number): number {
  const c = conformity(sig);
  const moving = Math.min(1, sig.speed / Math.max(0.01, speedMax * 0.3));
  return (1 - c) * (0.35 + 0.65 * sig.grass) * (0.4 + 0.6 * moving);
}

/** 0..1 how much the place pulls single notes onto its chord (conformity, scaled by `lockPull`). */
export function lockOf(sig: Pick<PersonalSignals, "pathP" | "stay" | "neighbours" | "sealed">, lockPull = DEFAULT_SEQUENCER.lockPull): number {
  return conformity(sig) * lockPull;
}

export interface VoiceBar {
  o: string;
  notes: MotifNote[];
}

export interface BarPlan {
  bar: number;
  chord: PlaceChord;
  /** Conformity 0..1 (see conformity()). */
  stable: number;
  /** Roughness 0..1 (see roughness()): the engine turns it into noise, drift and dropped notes. */
  rough: number;
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
  const stable = conformity(sig);
  const rough = roughness(sig, p.speedMax);
  const lock = lockOf(sig, p.lockPull);
  const d = density(sig.speed, p.speedMax);
  const company = Math.min(1, sig.neighbours.length / 2);
  const staying = sig.stay > 0.5 && sig.neighbours.length > 0;
  // call and response while staying among others: odd bars are theirs
  const answer = staying && bar % 2 === 1;

  // my notes: a Magenta phrase if one is running, else my motif blended with whoever has been close
  let mine: MotifNote[] = [];
  if (!answer) {
    if (inp.phrase && bar - inp.phrase.from < CYCLES_PER_PHRASE && bar >= inp.phrase.from) {
      const cyc = stepsToCycle(inp.phrase.phrase, (bar - inp.phrase.from) * STEPS_PER_CYCLE);
      mine = cyc.map((n) => ({ at: n.at, len: n.len, pitch: n.pitch, freq: midiToHz(n.pitch, me.colour), locked: false }));
    } else {
      let motif = me;
      const nearest = sig.neighbours[0];
      const amount = nearest ? inp.closeness.get(nearest.o) ?? 0 : 0;
      const theirs = nearest ? inp.others.get(nearest.o) : undefined;
      if (theirs && amount > 0) motif = blend(me, theirs, amount, bar);
      mine = placeInBar(realize(motif, key, chord, lock, bar, undefined, rough), d, bar);
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
    // the others share my place: same pull, same roughness; answering while we build is the steadiest of all
    const notes = realize(m, key, chord, staying ? Math.max(lock, p.lockPull) : lock, bar, undefined, staying ? rough * 0.3 : rough);
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

  return { bar, chord, stable, rough, lock, density: d, answer, me: mine, others, bass, pad };
}

/** Bar index and the AudioContext time of its start, from the epoch on the wall clock (shared by every tab). */
export function barClock(epochMs: number, wallMs: number, ctxNow: number, barSec: number): { bar: number; start: number } {
  const elapsed = (wallMs - epochMs) / 1000;
  const bar = Math.floor(elapsed / barSec);
  const into = elapsed - bar * barSec;
  return { bar, start: ctxNow - into };
}
