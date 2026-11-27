/**
 * sound/colour.ts — HARMONY WITH MORE TURNS (the artist, 2026-11-27: "화성이 좀 더 ... 진행이 다양했으면 좋겠고 (지금은 오묘한
 * 구간은 없고 살짝 고조되다 금방 풀림)"; docs/sound-logic.md §13f). Pure.
 *
 * Until now every chord was a diatonic seventh of the epoch's mode, standing still held one chord, a building was its
 * tonic, and an arrival leaned one bar on the dominant and resolved. Here:
 *
 *   STAYING MOVES   while I stay, the place's chord leads a four-bar progression of its own, one of a handful that
 *                   leave the mode — borrowed chords (bVI, bVII, iv), chromatic mediants (bIII, bVI), the Neapolitan
 *                   (bII), a pedal under moving chords — chosen by the place, so a place keeps its own turn of phrase;
 *                   the bar comes from the epoch's clock, so everyone staying in one place hears the same chord.
 *   WALKING COLOURS now and then a bar's chord is suspended (sus4, sus2) or opened (add9) on its own root: the band
 *                   is still the band, its colour undecided.
 *   ARRIVING LONGER (sequencer.ts nextArrival, long): a pre-dominant, the dominant, sometimes a deceptive turn, then
 *                   the tonic — a build of two or three bars instead of one.
 *   GATHERED, TENSE (§13g) the more people around me, the more often an eight-bar phrase goes tense — a bass walking down
 *                   by semitones, diminished sevenths, altered dominants (7b9, 7#9, 7#5), a low pedal on V, the tritone
 *                   substitute — and home only at the next phrase; building together, the arrival's bars lean the same way.
 */

import { diatonicChord, type PlaceChord, type WorldKey } from "./harmony";
import { hashString, rng } from "./motif";

/** Chord qualities as semitones above the root, in the order root · third-slot · fifth · seventh-slot. */
const Q = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m6: [0, 3, 7, 9],
  sus47: [0, 5, 7, 10],
  sus2: [0, 2, 7],
  add9: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
  // the tense ones (§13g) — four tones, so the pad (bass + four) holds them whole; the b9 / #9 take the fifth's place
  dom7b9: [0, 4, 10, 1],
  dom7s9: [0, 4, 10, 3],
  aug7: [0, 4, 8, 10],
  dim7: [0, 3, 6, 9],
  hdim: [0, 3, 6, 10],
  mMaj7: [0, 3, 7, 11],
  sus4b9: [0, 5, 10, 1],
  maj7s11: [0, 4, 6, 11],
} as const;
type Quality = keyof typeof Q;

/** Names the intervals cannot tell (chordName writes them after the root). */
const NAMED: Partial<Record<Quality, string>> = {
  dom7b9: "7b9",
  dom7s9: "7#9",
  aug7: "7#5",
  dim7: "dim7",
  hdim: "m7b5",
  mMaj7: "m(maj7)",
  sus4b9: "7sus4b9",
  maj7s11: "maj7#11",
};

/**
 * One step of a progression: semitones above the place's root, the quality, and the bass — "pedal" kept on the place's
 * root, or a number: the bass that many semitones from the place's root (a line that walks down, a low pedal on V).
 */
type Step = [number, Quality] | [number, Quality, "pedal" | number];

/** For a major-coloured place. */
const MAJOR_TURNS: Step[][] = [
  [[0, "maj7"], [8, "maj7"], [10, "dom7"], [0, "sus2"]], // borrowed darkness: I – bVI – bVII – Isus2
  [[0, "maj7"], [4, "m7"], [5, "maj7"], [5, "m6"]], // the minor iv: I – iii – IV – iv6
  [[0, "add9"], [2, "dom7"], [5, "maj7"], [0, "maj7"]], // the Lydian II: Iadd9 – II7 – IV – I
  [[0, "maj7"], [3, "maj7"], [8, "maj7"], [7, "sus47"]], // chromatic mediants: I – bIII – bVI – V7sus4
  [[0, "sus2"], [0, "sus47"], [5, "maj7", "pedal"], [0, "add9"]], // a pedal: Isus2 – I7sus4 – IV/I – Iadd9
];
/** For a minor-coloured place. */
const MINOR_TURNS: Step[][] = [
  [[0, "m7"], [8, "maj7"], [3, "maj7"], [10, "dom7"]], // i – bVI – bIII – bVII
  [[0, "m7"], [5, "m7"], [10, "dom7"], [3, "maj7"]], // i – iv – bVII – bIII
  [[0, "m7"], [1, "maj7"], [7, "sus47"], [0, "m6"]], // the Neapolitan: i – bII – V7sus4 – i6
  [[0, "m6"], [8, "maj7"], [5, "m6"], [7, "dom7"]], // i6 – bVI – iv6 – V7
  [[0, "madd9"], [0, "m7"], [10, "dom7", "pedal"], [0, "sus47"]], // a pedal: i(add9) – i7 – bVII/i – i7sus4
];

function chordOn(root: number, q: Quality, band: number, bass = root): PlaceChord {
  const classes = Q[q].map((i) => (((root + i) % 12) + 12) % 12);
  // (a pedal: the bass and the pad's root stay on the place's root while the chord above it moves)
  const c: PlaceChord = { band, degree: -1, classes, rootClass: ((bass % 12) + 12) % 12 };
  const name = NAMED[q];
  if (name) c.quality = name;
  return c;
}

/**
 * TENSION WHEN PEOPLE GATHER (§13g — the artist, 2026-11-27: "더 텐스한 화성진행도 듣고싶음, 사람이 모였을 떄 특히").
 * Eight bars each, from the mildest to the darkest; the first bar is always the place's own chord and the last a
 * dominant of some kind, so home comes back only at the next phrase — sixteen seconds of leaning instead of four.
 */
const MAJOR_TENSE: Step[][] = [
  // the lament: the bass walks down a semitone a bar under I, to IV, to the minor iv, to V
  [[0, "maj7"], [0, "maj7", -1], [0, "dom7", -2], [5, "maj7", -3], [5, "m6", -4], [0, "add9", -5], [7, "sus4b9", -5], [7, "dom7b9", -5]],
  // floating, then pulled: I(#11) – viiø – III7b9 – vi – I7#5 – iv(maj7) – iiø – V7b9
  [[0, "maj7s11"], [11, "hdim"], [4, "dom7b9"], [9, "m7"], [0, "aug7"], [5, "mMaj7"], [2, "hdim"], [7, "dom7b9"]],
  // secondary dominants and the tritone substitute: I – III7b9 – vi – vi(maj7) – II7#9 – bVI7 – V7sus4b9 – bII7
  [[0, "maj7"], [4, "dom7b9"], [9, "m7"], [9, "mMaj7"], [2, "dom7s9"], [8, "dom7"], [7, "sus4b9", -5], [1, "dom7"]],
  // the diminished climb: I – #i°7 – ii – #ii°7 – I/3 – IV – #ivø – V7#9
  [[0, "maj7"], [1, "dim7"], [2, "m7"], [3, "dim7"], [0, "maj7", 4], [5, "maj7"], [6, "hdim"], [7, "dom7s9"]],
  // the dominant pedal: a low V under iv, bVI, the Neapolitan — then V altered three ways
  [[0, "maj7"], [7, "sus47", -5], [5, "m7", -5], [8, "maj7", -5], [1, "maj7", -5], [7, "dom7s9", -5], [7, "aug7", -5], [7, "dom7b9", -5]],
];
const MINOR_TENSE: Step[][] = [
  // the lament: i – i(maj7)/7 – i/b7 – IV7/6 – iv6/b6 – bVI/b6 – iiø/5 – V7b9
  [[0, "m7"], [0, "mMaj7", -1], [0, "m7", -2], [5, "dom7", -3], [5, "m6", -4], [8, "maj7", -4], [2, "hdim", -5], [7, "dom7b9", -5]],
  // the Andalusian fall, then the tritone substitute: i – bVII7 – bVI – V7b9 – i6 – bVI7 – bII7 – V7#9
  [[0, "m7"], [10, "dom7"], [8, "maj7"], [7, "dom7b9"], [0, "m6"], [8, "dom7"], [1, "dom7"], [7, "dom7s9"]],
  // diminished: i – vii°7 – i6 – bII – #iv°7 – iv – iiø – V7b9
  [[0, "m7"], [11, "dim7"], [0, "m6"], [1, "maj7"], [6, "dim7"], [5, "m7"], [2, "hdim"], [7, "dom7b9"]],
  // noir: i(maj7) – i7 – viø – bVI7 – bIII7#5 – iiø – V7sus4b9 – V7b9
  [[0, "mMaj7"], [0, "m7"], [9, "hdim"], [8, "dom7"], [3, "aug7"], [2, "hdim"], [7, "sus4b9", -5], [7, "dom7b9", -5]],
  // the dominant pedal
  [[0, "m7"], [7, "sus4b9", -5], [5, "m6", -5], [8, "maj7", -5], [1, "maj7", -5], [7, "dom7b9", -5], [7, "aug7", -5], [7, "dom7s9", -5]],
];

/** Bars of one tense phrase. */
export const TENSE_BARS = 8;

/**
 * The tense chord of bar `bar` at a place whose own chord is `place`, or null (the usual chord stands). `level` 0..1 =
 * how gathered (the knob × how many are around me): it is the share of eight-bar phrases that go tense, and how far
 * down the list (towards the darker ones) the phrase may reach. Drawn from the place (`tag`) and the phrase, so everyone
 * at one place, equally gathered, hears the same.
 */
export function tenseChord(place: PlaceChord, tag: string, bar: number, level: number, holding = false): PlaceChord | null {
  if (level <= 0) return null;
  const phrase = Math.floor(bar / TENSE_BARS);
  const r = rng(hashString(`tense#${tag}#${phrase}`));
  // (holding, §13h: every phrase tense — no roll)
  if (r() >= level && !holding) return null;
  const k = ((bar % TENSE_BARS) + TENSE_BARS) % TENSE_BARS;
  // (holding: the phrase does not begin at home — home is kept for a resolution)
  if (k === 0) return holding ? withheldHome(place, phrase) : place;
  const turns = isMinor(place) ? MINOR_TENSE : MAJOR_TENSE;
  // (more gathered → the darker ones too)
  const reach = Math.max(1, Math.min(turns.length, Math.ceil(turns.length * (0.4 + 0.6 * level))));
  const [off, q, bassOff] = turns[Math.floor(r() * reach)][k];
  const root = place.rootClass + off;
  if (typeof bassOff !== "number") return chordOn(root, q, place.band, bassOff === "pedal" ? place.rootClass : root);
  const c = chordOn(root, q, place.band, place.rootClass + bassOff);
  // (the line under it: from the place's own bass, so a falling bass falls instead of jumping an octave)
  c.bassMidi = 36 + place.rootClass + bassOff;
  return c;
}

/**
 * HOME KEPT (§13h): while the tension holds, a phrase's first bar is not the place's chord but a stand-in — vi, bVI or
 * bIII (major), bVI, bIII or iv (minor) — so the dominant before it is answered sideways and the tonic waits.
 */
export function withheldHome(place: PlaceChord, phrase: number): PlaceChord {
  const steps: Step[] = isMinor(place) ? [[8, "maj7"], [3, "maj7"], [5, "m7"]] : [[9, "m7"], [8, "maj7"], [3, "maj7"]];
  const [off, q] = steps[((phrase % steps.length) + steps.length) % steps.length];
  return chordOn(place.rootClass + off, q, place.band);
}

/**
 * THE RESOLUTION'S CHORD (§13h), on the place's root: "home" = its plain triad (firmer than the seventh, the long-kept
 * tonic at last); "plagal" = the amen's iv (minor iv6 for a major place); "deceptive" = bVI (the scattered tension).
 */
export function resolutionChord(place: PlaceChord, kind: "home" | "plagal" | "deceptive"): PlaceChord {
  if (kind === "home") return { ...place, classes: place.classes.slice(0, 3), quality: undefined, bassMidi: undefined };
  if (kind === "plagal") return chordOn(place.rootClass + 5, isMinor(place) ? "m7" : "m6", place.band);
  return chordOn(place.rootClass + 8, "maj7", place.band);
}

/** The arrival's bars made tense (building together is a gathering too): ii ø or #iv°7 before, V7b9 · V7#9 · V7#5. */
export function tenseArrival(key: WorldKey, phase: "pre" | "dominant", bar: number, band: number, level: number): PlaceChord | null {
  if (level <= 0) return null;
  const r = rng(hashString(`tensearr#${phase}#${bar}`));
  if (r() >= level) return null;
  const pick = r();
  if (phase === "pre") return pick < 0.5 ? chordOn(key.root + 2, "hdim", band) : chordOn(key.root + 6, "dim7", band);
  return chordOn(key.root + 7, pick < 0.5 ? "dom7b9" : pick < 0.8 ? "dom7s9" : "aug7", band);
}

/** Whether a chord sounds minor (its third-slot a minor third). */
export const isMinor = (c: PlaceChord): boolean => (((c.classes[1] - c.classes[0]) % 12) + 12) % 12 === 3;

/**
 * STAYING: the chord of bar `bar` while I stay at a place whose own chord is `place` — its progression is picked by
 * `tag` (the place: its band or its building), its step by the bar (0 … 3, the epoch's clock). `amount` 0 = the place's
 * chord held, as before; else the progression (the first step always the place's own chord).
 */
export function stayingChord(place: PlaceChord, tag: string, bar: number, amount = 1): PlaceChord {
  if (amount <= 0) return place;
  const turns = isMinor(place) ? MINOR_TURNS : MAJOR_TURNS;
  const r = rng(hashString(`turn#${tag}`));
  const turn = turns[Math.floor(r() * turns.length)];
  const k = ((bar % 4) + 4) % 4;
  if (k === 0) return place;
  // (with amount below 1 some steps keep the place's chord: the progression thins)
  if (rng(hashString(`turnstep#${tag}#${bar}`))() >= amount) return place;
  const [off, q, pedal] = turn[k];
  const root = place.rootClass + off;
  return chordOn(root, q, place.band, pedal ? place.rootClass : root);
}

/** WALKING: now and then (`amount` of the bars) the bar's chord suspended or opened on its own root. */
export function walkingChord(chord: PlaceChord, bar: number, amount: number): PlaceChord {
  const r = rng(hashString(`colour#${chord.band}#${bar}`));
  if (r() >= amount) return chord;
  const minor = isMinor(chord);
  const pick = r();
  const q: Quality = pick < 0.4 ? "sus47" : pick < 0.7 ? "sus2" : minor ? "madd9" : "add9";
  return chordOn(chord.rootClass, q, chord.band);
}

/** THE ARRIVAL'S PRE-DOMINANT (sequencer "pre"): IV or ii of the key, or a borrowed bVI — by the bar. */
export function predominantOf(key: WorldKey, bar: number, band = -1): PlaceChord {
  const pick = rng(hashString(`pre#${bar}`))();
  if (pick < 0.35) return chordOn(key.root + 8, "maj7", band);
  const degree = pick < 0.7 ? 3 : 1;
  const classes = diatonicChord(key.mode, degree, 4).map((t) => (key.root + t) % 12);
  return { band, degree, classes, rootClass: (key.root + key.mode.intervals[degree]) % 12 };
}

/** THE ARRIVAL'S DECEPTIVE TURN (sequencer "deceptive"): the dominant goes to bVI instead of home — home a bar later. */
export function deceptiveOf(key: WorldKey, band = -1): PlaceChord {
  return chordOn(key.root + 8, "maj7", band);
}
