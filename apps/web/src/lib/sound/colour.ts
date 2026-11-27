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
} as const;
type Quality = keyof typeof Q;

/** One step of a progression: semitones above the place's root, the quality, and (a pedal) the bass kept on the place's root. */
type Step = [number, Quality] | [number, Quality, "pedal"];

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
  return { band, degree: -1, classes, rootClass: ((bass % 12) + 12) % 12 };
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
