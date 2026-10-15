/**
 * sound/harmonyState.ts — the HARMONY STATE H: what key, what chord, how tense, and why (docs/sound-logic.md §3;
 * the plan docs/sound-plan-hybrid-2026-10-15.md §2). Both instruments and the speakers read the same H.
 *
 *   TONALITY IS WHOSE WEIGHTS   alone: my home key. With people who have been close (closeness): a GROUP tonality
 *                               of their home roots — whoever has been close long enough outweighs me and becomes
 *                               the tonic (I go along). At a building: its builders' weights. The same function
 *                               (harmony.tonalityOf) for all three, so a group that starts building hardens into
 *                               the building's tonality.
 *   PEOPLE ARE VOICES           the chord is the weighted people's home ROOTS; its four voices are LED: each upper
 *                               voice moves to the nearest tone of the next chord, the bass takes the root, a root
 *                               new to the chord prefers the top voice (the newcomer is heard on top).
 *   THE GROUND = PROGRESSION    the chord of the open ground is BOUND TO THE PLACE: bands `stepEvery` world units
 *                               wide along x + z carry a Markov progression of my home key (16 bands, wrapping, a
 *                               walk of my own) — walking anywhere moves the chord, coming back brings it back,
 *                               standing holds it. This is the 2026-10-14 "world" version's idea, which the artist
 *                               found intuitive, kept under the people's chords: a path adds its cadences
 *                               (stopping on it = the dominant held, leaving it = the tonic), a building or a group
 *                               replaces the band's chord with the people's.
 *   APPROACH = DOMINANT         within reach of a building but not in it, the chord is the DOMINANT of the
 *                               building's tonality: arriving resolves. The one place the harmony pulls forward.
 *   MODULATION                  coming home from a building or a group goes through a PIVOT bar (a triad both keys
 *                               hold), the new dominant, the new tonic. Into a building the approach was the
 *                               dominant; between people's chords the roots themselves are the pivot — immediate.
 *   HARMONIC RHYTHM             a chord changes on a bar line only; a people's chord at most every 2 bars.
 *   TENSION                     0..1 from the degree's function, the approach and the roughness; a full cadence
 *                               drops it to 0. The pad's brightness, the chromatic budget of the motifs, the room.
 *
 * Two parts: a TRACKER (stateful, fed every signal fold: hysteresis at buildings, path distance, cadences) and the
 * pure `nextHarmony(prev, inputs)` per bar. No audio.
 */

import { KEY_NAMES, buildingKey, chordName, homeKey, keyChord, keyName, nextDegree, tonalityOf, type Contribution, type Key, type PlaceChord } from "./harmony";
import { hashString, rng } from "./motif";
import type { PersonalSignals } from "./signals";

export type Cadence = "none" | "half" | "full";
export type TonalitySource = "home" | "group" | "building" | "approach";

export interface HarmonyState {
  bar: number;
  key: Key;
  chord: PlaceChord;
  /** Degree of the path progression in `key` (0 = tonic). */
  degree: number;
  /** Four voices (MIDI, low to high: the bass and three upper voices), led from the previous state. */
  voicing: number[];
  bass: number;
  tension: number;
  cadence: Cadence;
  /** A staged modulation under way: the key we come from, the key we go to, which bar of the three. */
  modulation: { from: Key; to: Key; stage: 0 | 1 | 2 } | null;
  /** The bar the chord last changed on. */
  changedBar: number;
  source: TonalitySource;
  /** Who weighs in the tonality (heaviest first; empty when it is my home key alone). */
  builders: string[];
  /** The place the tonality belongs to (building id, "group", or "home"). */
  placeId: string;
}

export interface PlaceState {
  /** The building I am IN (hysteresis), with its builders. */
  at: { id: string; who: Contribution[] } | null;
  /** A building within reach but not entered: 0..1 how far in. */
  approach: { id: string; who: Contribution[]; amount: number } | null;
  /** The degree the path progression is on. */
  degree: number;
  /** A cadence the next bar should make (the tracker sets it when I stop on or leave a path). */
  cadence: Cadence;
  /** Whether I am on a path now (the degree chord is the chord of the place). */
  onPath: boolean;
}

export interface HarmonyConfigH {
  /** World units of path walked that move the progression on by one chord. */
  stepEvery: number;
  /** Reach (world) within which a building is approached (signals list buildings within 2 × sealRadius = 6). */
  reach: number;
  /** Sealed level at which I am IN a building, and below which I have left it (hysteresis). */
  enterAt: number;
  leaveAt: number;
  /** Closeness from which a neighbour weighs in the group tonality, and my own weight against theirs. */
  groupFrom: number;
  myWeight: number;
  /** A people's chord (group / building) changes at most this often (bars). */
  peopleEvery: number;
}

export const DEFAULT_H: HarmonyConfigH = { stepEvery: 6, reach: 6, enterAt: 0.3, leaveAt: 0.1, groupFrom: 0.15, myWeight: 0.8, peopleEvery: 2 };

/** Functional tension of a degree (0 = tonic): I, ii, iii, IV, V, vi, vii. */
const FUNC_MAJOR = [0, 0.4, 0.2, 0.4, 0.8, 0.2, 0.9];
const FUNC_MINOR = [0, 0.5, 0.2, 0.4, 0.8, 0.3, 0.9];
const DOMINANT = 4;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sameKey = (a: Key, b: Key) => a.root === b.root && a.mode.name === b.mode.name;
const sameClasses = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((c) => b.includes(c));

/**
 * The tracker: hysteresis at buildings, the path walked, the cadences. Fed every signal fold (~0.5 s), read when a
 * bar is planned.
 */
/** The bands' progression of one person: 16 degrees walked through the Markov table of their home key. */
export function bandDegrees(myId: string, bands = 16): number[] {
  const key = homeKey(myId);
  const r = rng(hashString("bands:" + myId));
  const out = [0];
  for (let i = 1; i < bands; i++) out.push(nextDegree(key, out[i - 1], r()));
  return out;
}

/** Which band a position is in: bands `width` wide along x + z, wrapping every `bands`. */
export function bandAt(x: number, z: number, width: number, bands = 16): number {
  const b = Math.floor((x + z) / Math.max(0.5, width));
  return ((b % bands) + bands) % bands;
}

export class HarmonyTracker {
  private at: { id: string; who: Contribution[] } | null = null;
  private degree = 0;
  private bands: number[] = [];
  private lastPos: { x: number; z: number } | null = null;
  private onPath = false;
  private walkedOnPath = 0;
  private cadence: Cadence = "none";
  private stoppedOn = false;
  private myId = "";
  readonly cfg: HarmonyConfigH;

  constructor(cfg: Partial<HarmonyConfigH> = {}) {
    this.cfg = { ...DEFAULT_H, ...cfg };
  }

  reset(): void {
    this.at = null;
    this.degree = 0;
    this.bands = bandDegrees(this.myId);
    this.lastPos = null;
    this.onPath = false;
    this.walkedOnPath = 0;
    this.cadence = "none";
    this.stoppedOn = false;
  }

  update(myId: string, sig: PersonalSignals, stepEvery = this.cfg.stepEvery): PlaceState {
    const cfg = this.cfg;
    if (this.myId !== myId) {
      this.myId = myId;
      this.reset();
    }
    // buildings: in (hysteresis), or approached
    if (sig.building && sig.sealed >= cfg.enterAt && this.at?.id !== sig.building.id) {
      this.at = { id: sig.building.id, who: sig.building.who };
      this.degree = 0;
      this.cadence = "none";
    } else if (this.at && (!sig.building || sig.building.id !== this.at.id || sig.sealed <= cfg.leaveAt)) {
      this.at = null;
      this.degree = 0;
    } else if (this.at && sig.building && sig.building.id === this.at.id) {
      this.at = { id: this.at.id, who: sig.building.who }; // the builders' weights move
    }
    let approach: PlaceState["approach"] = null;
    if (!this.at && sig.building) {
      const amount = clamp01(1 - sig.building.dist / cfg.reach);
      if (amount > 0) approach = { id: sig.building.id, who: sig.building.who, amount };
    }
    // the ground: the band I stand on names the chord (position-bound); a path adds its cadences — stopping on it
    // holds the dominant (half), leaving it resolves (full)
    const onPath = sig.pathP >= 0.25;
    if (!this.bands.length) this.bands = bandDegrees(myId);
    const band = this.bands[bandAt(sig.x, sig.z, stepEvery)] ?? 0;
    if (this.lastPos) {
      const d = Math.hypot(sig.x - this.lastPos.x, sig.z - this.lastPos.z);
      if (onPath) {
        this.walkedOnPath += d * sig.pathP;
        if (sig.speed < 0.3 && !this.stoppedOn && this.walkedOnPath >= stepEvery * 0.5) {
          this.stoppedOn = true;
          this.cadence = "half";
        } else if (sig.speed >= 0.3 && this.stoppedOn && d > 0.2) {
          this.stoppedOn = false;
        }
      } else if (this.onPath && sig.pathP < 0.15) {
        if (this.walkedOnPath >= stepEvery * 0.5) this.cadence = "full";
        this.walkedOnPath = 0;
        this.stoppedOn = false;
      }
    }
    this.degree = this.at ? 0 : this.stoppedOn ? DOMINANT : band;
    this.onPath = onPath;
    this.lastPos = { x: sig.x, z: sig.z };
    return { at: this.at, approach, degree: this.degree, cadence: this.cadence, onPath };
  }

  /** The bar takes the pending cadence (once). */
  takeCadence(): Cadence {
    const c = this.cadence;
    this.cadence = "none";
    return c;
  }
}

export interface HarmonyInputs {
  bar: number;
  myId: string;
  sig: PersonalSignals;
  place: PlaceState;
  closeness: ReadonlyMap<string, number>;
  /** Roughness of this bar (sequencer.roughness). */
  rough: number;
  /** The cadence this bar makes (HarmonyTracker.takeCadence). */
  cadence: Cadence;
  cfg?: HarmonyConfigH;
}

/** Whose weights make the tonality now, and where it belongs. */
export function weightsOf(inp: HarmonyInputs): { weights: Contribution[]; source: TonalitySource; placeId: string } {
  const cfg = inp.cfg ?? DEFAULT_H;
  if (inp.place.at) return { weights: inp.place.at.who, source: "building", placeId: inp.place.at.id };
  const weights: Contribution[] = [{ o: inp.myId, amount: cfg.myWeight }];
  for (const n of inp.sig.neighbours) {
    const c = inp.closeness.get(n.o) ?? 0;
    if (c >= cfg.groupFrom) weights.push({ o: n.o, amount: c });
  }
  if (weights.length > 1) return { weights, source: "group", placeId: "group" };
  return { weights, source: "home", placeId: "home" };
}

/** The triads of `to` whose tones all lie in `from`'s scale: the pivots; the one closest to `like` first. */
export function pivotChord(from: Key, to: Key, like: PlaceChord | null): PlaceChord {
  const fromScale = from.mode.intervals.map((i) => (i + from.root) % 12);
  let best: PlaceChord | null = null;
  let bestScore = -1;
  for (let deg = 0; deg < 7; deg++) {
    const triad = keyChord(to, deg, 3);
    if (!triad.classes.every((c) => fromScale.includes(c))) continue;
    const shared = like ? triad.classes.filter((c) => like.classes.includes(c)).length : 0;
    const score = shared * 10 + (deg === 0 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = triad;
    }
  }
  return best ?? keyChord(from, 0, 3);
}

/**
 * VOICE LEADING: three upper voices (MIDI 60–79) onto the chord's classes above the root, each moving the least;
 * a class new to the chord prefers the top voice. The bass is the root in 48–59.
 */
export function leadVoices(prev: readonly number[] | null, chord: PlaceChord, prevClasses: readonly number[] | null): number[] {
  const root = chord.rootClass;
  const upperClasses = chord.classes.length >= 4 ? chord.classes.filter((c) => c !== root) : chord.classes.slice();
  while (upperClasses.length < 3) upperClasses.push(upperClasses[upperClasses.length - 1] ?? root);
  const classes = upperClasses.slice(0, 3);
  const prevUpper = prev && prev.length >= 4 ? prev.slice(1, 4) : [60 + ((root + 4) % 12), 64 + ((root + 7) % 12), 67 + root];
  const nearest = (p: number, c: number) => {
    let best = p;
    let bestD = Infinity;
    for (let cand = 60; cand <= 79; cand++) {
      if (cand % 12 !== c) continue;
      const d = Math.abs(cand - p);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    return best;
  };
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const fresh = new Set(prevClasses ? classes.filter((c) => !prevClasses.includes(c)) : []);
  let best: number[] = [];
  let bestCost = Infinity;
  for (const perm of perms) {
    const voices = perm.map((ci, vi) => nearest(prevUpper[vi], classes[ci]));
    let cost = voices.reduce((s, v, vi) => s + Math.abs(v - prevUpper[vi]), 0);
    // crossing voices cost, a new class not on top costs
    for (let i = 1; i < 3; i++) if (voices[i] <= voices[i - 1]) cost += 6;
    if (fresh.size && !fresh.has(classes[perm[2]])) cost += 3;
    if (cost < bestCost) {
      bestCost = cost;
      best = voices;
    }
  }
  return [48 + root, ...best];
}

/** The next harmony state: the bar's key, chord, voicing, tension, from the previous state and the inputs. */
export function nextHarmony(prev: HarmonyState | null, inp: HarmonyInputs): HarmonyState {
  const cfg = inp.cfg ?? DEFAULT_H;
  const { bar, place } = inp;
  const home = homeKey(inp.myId);
  const w = weightsOf(inp);
  // alone, the tonality is my home key itself (tonalityOf would only see my root); with people, theirs and mine
  const t = w.source === "home" ? null : tonalityOf(w.weights);
  let key: Key = t?.key ?? (place.at ? buildingKey(place.at.id) : home);
  let builders = t?.builders ?? [];
  let source = w.source;
  let placeId = w.placeId;
  let degree = place.degree;
  // the chord of the place: the people's roots (a building; a group off the path), else the progression's degree
  let chord: PlaceChord = source === "building" || (source === "group" && !place.onPath) ? (t?.chord ?? keyChord(key, 0)) : keyChord(key, degree);
  let cadence = inp.cadence;
  let modulation: HarmonyState["modulation"] = null;
  let tension = 0;
  let approach = 0;

  // APPROACH: the dominant of the building ahead
  if (!place.at && place.approach && place.approach.amount >= 0.3) {
    const target = tonalityOf(place.approach.who)?.key ?? buildingKey(place.approach.id);
    chord = keyChord(target, DOMINANT);
    approach = place.approach.amount;
    source = "approach";
    placeId = place.approach.id;
    builders = tonalityOf(place.approach.who)?.builders ?? [];
    degree = DOMINANT;
  }

  // CADENCE: a full cadence resolves to the tonic, a half one holds the dominant
  if (cadence === "full") {
    chord = keyChord(key, 0);
    degree = 0;
  } else if (cadence === "half") {
    chord = keyChord(key, DOMINANT);
    degree = DOMINANT;
  }

  // MODULATION home: a pivot, the dominant, the tonic — staged over three bars
  if (prev && !sameKey(prev.key, key) && source === "home" && (prev.source !== "home" || prev.modulation)) {
    const stage = prev.modulation && sameKey(prev.modulation.to, key) ? Math.min(2, prev.modulation.stage + 1) : 0;
    const from = prev.modulation && sameKey(prev.modulation.to, key) ? prev.modulation.from : prev.key;
    if (stage === 0) {
      key = from; // still in the old key: a pivot chord both keys hold
      chord = pivotChord(from, home, prev.chord);
      modulation = { from, to: home, stage: 0 };
      tension = 0.4;
    } else if (stage === 1) {
      chord = keyChord(home, DOMINANT);
      degree = DOMINANT;
      modulation = { from, to: home, stage: 1 };
      tension = 0.7;
    } else {
      chord = keyChord(home, 0);
      degree = 0;
      modulation = null;
      cadence = "full";
    }
  } else if (prev?.modulation && sameKey(prev.modulation.to, key) && prev.modulation.stage < 2 && source === "home") {
    // keeps staging when the key already reads as home (stage 1 → 2)
    const stage = (prev.modulation.stage + 1) as 1 | 2;
    if (stage === 1) {
      chord = keyChord(home, DOMINANT);
      degree = DOMINANT;
      modulation = { from: prev.modulation.from, to: home, stage: 1 };
      tension = 0.7;
    } else {
      chord = keyChord(home, 0);
      degree = 0;
      cadence = "full";
    }
  }

  // HARMONIC RHYTHM: a people's chord moves at most every `peopleEvery` bars
  let changedBar = prev?.changedBar ?? bar;
  if (prev && (source === "building" || source === "group") && prev.source === source && prev.placeId === placeId && !sameClasses(prev.chord.classes, chord.classes) && bar - prev.changedBar < cfg.peopleEvery) {
    chord = prev.chord;
    key = prev.key;
    builders = prev.builders;
  }
  if (!prev || !sameClasses(prev.chord.classes, chord.classes) || prev.chord.rootClass !== chord.rootClass) changedBar = bar;

  // TENSION
  const func = key.mode.base === "major" ? FUNC_MAJOR : FUNC_MINOR;
  if (tension === 0) tension = clamp01(0.5 * func[((degree % 7) + 7) % 7] + 0.3 * approach + 0.2 * inp.rough);
  if (cadence === "full") tension = 0;
  if (cadence === "half") tension = Math.max(tension, 0.6);

  const voicing = leadVoices(prev?.voicing ?? null, chord, prev?.chord.classes ?? null);
  return { bar, key, chord, degree, voicing, bass: voicing[0], tension, cadence, modulation, changedBar, source, builders, placeId };
}

/** One line for the debug / inspector: key, chord, why, tension. */
export function harmonyLabel(h: HarmonyState): string {
  const why = h.source === "approach" ? `→ ${h.placeId}` : h.source === "building" ? `${h.placeId} ← ${h.builders.join(",")}` : h.source === "group" ? `group ${h.builders.join(",")}` : "home";
  const mod = h.modulation ? ` · mod ${keyName(h.modulation.from)} → ${keyName(h.modulation.to)} [${["pivot", "V", "I"][h.modulation.stage]}]` : "";
  const cad = h.cadence !== "none" ? ` · ${h.cadence} cadence` : "";
  return `${keyName(h.key)} · ${chordName(h.chord)} (deg ${h.degree}, ${why}) · voices ${h.voicing.map((v) => KEY_NAMES[v % 12] + Math.floor(v / 12 - 1)).join(" ")} · tension ${h.tension.toFixed(2)}${mod}${cad}`;
}

/** The scale tones of the chord's key between two pitches: for passing tones (motif.ts). */
export function scaleBetween(key: Key, a: number, b: number): number[] {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const scale = key.mode.intervals.map((i) => (i + key.root) % 12);
  const out: number[] = [];
  for (let p = lo + 1; p < hi; p++) if (scale.includes(((p % 12) + 12) % 12)) out.push(p);
  return out;
}
