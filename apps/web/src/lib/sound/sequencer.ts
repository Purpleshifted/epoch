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
 *               motif comes round — still = AUGMENTED over two bars (the cell at half speed), walking = every bar,
 *               running = twice a bar; a rough run keeps only the head of the motif (FRAGMENTATION).
 *   HARMONY     with a harmony state (harmonyState.ts) the bar takes its key, chord, voicing, tension and cadence:
 *               my motif anchors on a chord tone near where the last bar ended (a sequence), its chromatic budget
 *               opens with the tension, passing tones fill its leaps when the walk conforms and is slow, a full
 *               cadence lands it on the tonic. A Magenta phrase never replaces me: it is a LINE of its own.
 *   KEY         my motif is in my home key; at a building, in the building's key (a modulation). The others are heard
 *               through my key (their identity = contour, rhythm, register; the scale is mine). The chord of the
 *               place is the current DEGREE of my key: a path walked moves it on (a progression), standing holds it.
 *   LOCK        conforming (a path, concrete, staying among others) pulls a few notes onto that chord (small).
 *   BASS        on a path the root of the place's chord is a soft pulse on the downbeat: the walking rhythm.
 *   VOICES      the others within earshot play their own motifs on the same grid (intersection: bass / baritone /
 *               tenor = me / first neighbour / second neighbour). While I STAY among them the bars alternate:
 *               my bar, their bar (the nearest answers), and my motif borrows from theirs by how long they have
 *               been close (variation.ts); a Magenta phrase, when one has come back, takes my next bars.
 *   PAD         staying among others holds the chord tones (the building being born) — a sustained pad.
 */

import { keyChord, type Key, type PlaceChord } from "./harmony";
import type { Cadence, HarmonyState } from "./harmonyState";
import { midiToHz, realize, realizeIn, type Motif, type MotifNote } from "./motif";
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
  /**
   * intersection's INNER radius (world): only people this close become VOICES in my sequence (their motif on my
   * grid); people further out but within earshot are only heard as texture / company (knobs, pad level).
   */
  innerRadius: number;
}

export const DEFAULT_SEQUENCER: SequencerParams = { barSec: 2, speedMax: 7, bassFrom: 0.25, lockPull: 0.25, innerRadius: 5 };

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
  /** Downbeat pulses: at (0..1 of the bar), MIDI pitch, level 0..1; `len` (0..1 of the bar) when held, else a pulse. */
  bass: { at: number; pitch: number; level: number; len?: number }[];
  /** Chord tones (MIDI) to hold through the bar and their level (0 = none). */
  pad: { pitches: number[]; level: number };
  /** The harmony state the bar was planned on (null in world mode / legacy inputs). */
  harmony: HarmonyState | null;
  tension: number;
  cadence: Cadence;
  /** A derived line (a Magenta phrase: my motif improvised over the chords, or blended with a neighbour's). */
  line: MotifNote[];
  /** Rhythm cells on the 16-step grid: mine and the nearest neighbours' (for the patch's GateSeq traces). */
  traces: { o: string; steps: number[] }[];
}

export interface BarInputs {
  bar: number;
  sig: PersonalSignals;
  /** The key I am in now: my home key, or the key of the building I am at (the engine decides, with hysteresis). */
  key: Key;
  /** The building I am at (its id), or null. */
  building: string | null;
  /** Degree (0..6) of the progression in my key: moved on by walking a path (engine), 0 = the tonic. */
  degree: number;
  /** The chord of the place when it is not the key's degree chord: a building's chord of its builders' roots. */
  chord?: PlaceChord | null;
  me: Motif;
  others: ReadonlyMap<string, Motif>;
  /** 0..1 per neighbour id: how long and close they have been (engine keeps it). */
  closeness: ReadonlyMap<string, number>;
  /** A phrase (variation.ts): its cycle index and the phrase; null = none. */
  phrase: { phrase: Phrase; from: number } | null;
  /** Where the phrase goes: "line" (default: a voice of its own, my motif untouched) or "me" (legacy: it takes my bars). */
  phraseTo?: "me" | "line";
  params?: SequencerParams;
  /** The harmony state of this bar (harmonyState.nextHarmony); when given, key / degree / chord come from it. */
  harmony?: HarmonyState | null;
  /** The last pitch of my previous bar (anchoring). */
  prevLast?: number | null;
  /** Semitones my motif is shifted (a building's register: inside concrete an octave down). */
  register?: number;
}

/**
 * Place a motif's cycle into a bar at the density: 0.5 = AUGMENTED over two bars (the first half of the cell in
 * an even bar, the second in the odd one, at half speed), 1 = once, 2 = twice (compressed).
 */
export function placeInBar(notes: readonly MotifNote[], d: Density, bar: number): MotifNote[] {
  if (d === 0.5) {
    const half = bar % 2 === 0 ? 0 : 0.5;
    return notes.filter((n) => (half === 0 ? n.at < 0.5 : n.at >= 0.5)).map((n) => ({ ...n, at: (n.at - half) * 2, len: Math.min(1 - (n.at - half) * 2, n.len * 2) }));
  }
  if (d === 1) return notes.slice();
  const out: MotifNote[] = [];
  for (const half of [0, 0.5]) for (const n of notes) out.push({ ...n, at: half + n.at / 2, len: n.len / 2 });
  return out;
}

export function planBar(inp: BarInputs): BarPlan {
  const p = inp.params ?? DEFAULT_SEQUENCER;
  const { bar, sig, me } = inp;
  const h = inp.harmony ?? null;
  const key = h ? h.key : inp.key;
  const chord = h ? h.chord : (inp.chord ?? keyChord(key, inp.degree));
  const stable = conformity(sig);
  const rough = roughness(sig, p.speedMax);
  const lock = lockOf(sig, p.lockPull);
  const d = density(sig.speed, p.speedMax);
  const company = Math.min(1, sig.neighbours.length / 2);
  const staying = sig.stay > 0.5 && sig.neighbours.length > 0;
  // call and response while staying among others: odd bars are theirs
  const answer = staying && bar % 2 === 1;
  const tension = h?.tension ?? 0;
  const cadence: Cadence = h?.cadence ?? "none";
  const phraseTo = inp.phraseTo ?? "line";
  const phraseRunning = !!inp.phrase && bar - inp.phrase.from < CYCLES_PER_PHRASE && bar >= inp.phrase.from;
  const phraseNotes = (): MotifNote[] => {
    const cyc = stepsToCycle(inp.phrase!.phrase, (bar - inp.phrase!.from) * STEPS_PER_CYCLE);
    return cyc.map((n) => ({ at: n.at, len: n.len, pitch: n.pitch, freq: midiToHz(n.pitch, me.colour), locked: false }));
  };

  // my notes: my motif blended with whoever has been close, through the harmony (anchored, budgeted, ornamented);
  // a Magenta phrase takes my bars only in the legacy routing (phraseTo "me")
  let mine: MotifNote[] = [];
  if (!answer) {
    if (phraseRunning && phraseTo === "me") {
      mine = phraseNotes();
    } else {
      let motif = me;
      const nearest = sig.neighbours[0];
      const amount = nearest ? inp.closeness.get(nearest.o) ?? 0 : 0;
      const theirs = nearest ? inp.others.get(nearest.o) : undefined;
      if (theirs && amount > 0) motif = blend(me, theirs, amount, bar);
      const budget = h ? Math.min(3, Math.round(1 + 2 * tension + 2 * rough)) : undefined;
      let cycle = h
        ? realizeIn(motif, key, chord, lock, bar, rough, { anchor: inp.prevLast ?? null, chromaticBudget: budget, passing: lock >= 0.6 && d <= 1 && rough < 0.3, cadence })
        : realize(motif, key, chord, lock, bar, undefined, rough);
      // a rough run keeps only the head of the motif
      if (d === 2 && rough >= 0.5) cycle = cycle.slice(0, 3);
      if (inp.register) cycle = cycle.map((n) => ({ ...n, pitch: n.pitch + inp.register!, freq: midiToHz(n.pitch + inp.register!, me.colour) }));
      mine = placeInBar(cycle, d, bar);
    }
  }
  const line: MotifNote[] = phraseRunning && phraseTo === "line" ? phraseNotes() : [];

  // the others: their own motifs on the same grid, locked like me (we share the place); in their answer bar the
  // nearest plays alone, otherwise everybody, every bar
  const others: VoiceBar[] = [];
  for (const n of sig.neighbours) {
    if (n.dist > p.innerRadius) continue; // outer range: texture only (intersection: audio cue, no sequencer)
    const m = inp.others.get(n.o);
    if (!m) continue;
    if (staying && !answer && n !== sig.neighbours[0]) {
      // while staying, the others wait for their bar — except the nearest, who plays along with me softly
      continue;
    }
    if (staying && answer && n !== sig.neighbours[0]) continue;
    // the others are heard THROUGH MY KEY: their contour, rhythm and register (their identity), on my scale and
    // my chord — in their own headset it is the other way round. Same pull, same roughness as me (we share the
    // ground); answering while we build is the steadiest of all
    const notes = realize(m, key, chord, staying ? Math.max(lock, p.lockPull) : lock, bar, undefined, staying ? rough * 0.3 : rough);
    others.push({ o: n.o, notes });
  }

  // bass: the root of the place on the downbeat while on a path; among people (a group, a building) the root held
  const bass: BarPlan["bass"] = [];
  if (sig.pathP >= p.bassFrom) {
    const level = Math.min(1, (sig.pathP - p.bassFrom) / (1 - p.bassFrom) + 0.25);
    const pitch = h ? h.bass : 48 + chord.rootClass; // C3 … B3 (an octave lower was inaudible on small speakers)
    bass.push({ at: 0, pitch, level });
    if (d === 2) bass.push({ at: 0.5, pitch, level: level * 0.7 });
  } else if (h && (h.source === "building" || h.source === "group")) {
    bass.push({ at: 0, pitch: h.bass, level: 0.5, len: 1 });
  }

  // pad: the chord held while building; a building sounds its chord even to one visitor
  let padLevel = sig.stay * company;
  if (h?.source === "building") padLevel = Math.max(padLevel, 0.6);
  const padPitches = h ? h.voicing.slice() : [48 + chord.rootClass, ...chord.classes.map((c) => 60 + c)];
  const pad = padLevel > 0.2 ? { pitches: padPitches, level: padLevel } : { pitches: [], level: 0 };

  // traces: my cell and the nearest neighbours' on the 16-step grid (one cycle a bar)
  const cellSteps = (m: Motif) => {
    const steps = new Array<number>(16).fill(0);
    for (const o of m.onsets) steps[Math.min(15, Math.round((o / m.steps) * 16))] = 1;
    return steps;
  };
  const traces: BarPlan["traces"] = [{ o: me.id, steps: cellSteps(me) }];
  for (const n of sig.neighbours.slice(0, 3)) {
    const m = inp.others.get(n.o);
    if (m) traces.push({ o: n.o, steps: cellSteps(m) });
  }

  return { bar, chord, stable, rough, lock, density: d, answer, me: mine, others, bass, pad, harmony: h, tension, cadence, line, traces };
}

/** Bar index and the AudioContext time of its start, from the epoch on the wall clock (shared by every tab). */
export function barClock(epochMs: number, wallMs: number, ctxNow: number, barSec: number): { bar: number; start: number } {
  const elapsed = (wallMs - epochMs) / 1000;
  const bar = Math.floor(elapsed / barSec);
  const into = elapsed - bar * barSec;
  return { bar, start: ctxNow - into };
}
