/**
 * sound/tonality.ts — the tonality of a BUILDING from the people who built it (v4 A4, docs/sound-logic.md §8c).
 *
 * The artist's rule: every visitor's motif has a HOME KEY (from their id, like the motif itself); a building's key is
 * the one that fits its contributors' home keys best — "a unified key-distance algorithm", weights = how much each
 * put in (fold.ts `who`). Inside the building's ZONE the tonic chord holds; in the ring just outside, the dominant
 * leans in; beyond, the world's bands as before. The same distance will carry the paths' modulations (A5) and the
 * drone's common tone (A6).
 *
 *   keyDistance(a, b)   how far apart two keys are: pitch classes the two scales do not share (0 for relative keys,
 *                       which share every note), a little for the tonics' distance on the circle of fifths, a little
 *                       for a change of major/minor family. C Ionian → A Aeolian 1.0, → G Ionian 1.25, → C Aeolian 3.25.
 *   bestKey(who, cur)   the key (12 roots × the home modes) with the least weighted distance to the contributors'
 *                       home keys; `cur` is kept unless another is better by `margin` (hysteresis: a building does
 *                       not flicker when one more person leans in).
 *
 * Pure and deterministic.
 */

import { KEY_NAMES, MODES, diatonicChord, scaleClasses, type Mode, type PlaceChord, type WorldKey } from "./harmony";
import { hashString, rng } from "./motif";

/** The modes a visitor's home key may have (indices into MODES): Aeolian, Dorian, Mixolydian, Ionian. */
export const HOME_MODES = [2, 3, 4, 5] as const;

/** A key as a WorldKey without a ground progression (a building has one chord, not a band of chords). */
const asKey = (root: number, mode: Mode): WorldKey => ({ root: ((root % 12) + 12) % 12, mode, degrees: [0] });

/** The home key of a visitor (or bot): the same for the same id, always. */
export function homeKey(id: string): WorldKey {
  const r = rng(hashString("home:" + id));
  return asKey(Math.floor(r() * 12), MODES[HOME_MODES[Math.floor(r() * HOME_MODES.length)]]);
}

export const keyName = (k: Pick<WorldKey, "root" | "mode">): string => `${KEY_NAMES[k.root]} ${k.mode.name}`;

/** Steps apart on the circle of fifths, 0..6. */
export function fifthsDistance(a: number, b: number): number {
  // pitch class p sits at position (p · 7) mod 12 on the circle of fifths
  const d = Math.abs((((a * 7) % 12) - ((b * 7) % 12) + 12) % 12);
  return Math.min(d, 12 - d);
}

export function keyDistance(a: Pick<WorldKey, "root" | "mode">, b: Pick<WorldKey, "root" | "mode">): number {
  const sa = new Set(scaleClasses(a as WorldKey));
  const sb = new Set(scaleClasses(b as WorldKey));
  let diff = 0;
  for (const c of sa) if (!sb.has(c)) diff++;
  for (const c of sb) if (!sa.has(c)) diff++;
  return diff / 2 + 0.25 * fifthsDistance(a.root, b.root) + (a.mode.base === b.mode.base ? 0 : 0.25);
}

export interface Contributor {
  o: string;
  amount: number;
}

/** Every key a building may take: 12 roots × the home modes, in a fixed order (ties resolve the same way always). */
const CANDIDATES: WorldKey[] = [];
for (const mi of HOME_MODES) for (let root = 0; root < 12; root++) CANDIDATES.push(asKey(root, MODES[mi]));

/**
 * The key that fits the contributors best: least weighted distance to their home keys. `current` is kept unless
 * another key is better by `margin` (× the total weight). null when nobody has built.
 */
export function bestKey(who: readonly Contributor[], current: WorldKey | null = null, margin = 0.15): WorldKey | null {
  const homes = who.filter((w) => w.amount > 0).map((w) => ({ key: homeKey(w.o), w: w.amount }));
  if (!homes.length) return null;
  const total = homes.reduce((s, h) => s + h.w, 0);
  const cost = (k: WorldKey) => homes.reduce((s, h) => s + h.w * keyDistance(k, h.key), 0) / total;
  let best = CANDIDATES[0];
  let bestCost = cost(best);
  for (const k of CANDIDATES) {
    const c = cost(k);
    if (c < bestCost - 1e-9) {
      best = k;
      bestCost = c;
    }
  }
  if (current && cost(current) - bestCost < margin) return current;
  return best;
}

/** The chord a zone holds: inside the tonic seventh (degree 0), in the ring the dominant (degree 4). */
export function zoneChord(key: WorldKey, zone: "in" | "ring"): PlaceChord {
  const degree = zone === "in" ? 0 : 4;
  const classes = diatonicChord(key.mode, degree, 4).map((t) => (key.root + t) % 12);
  return { band: -1, degree, classes, rootClass: (key.root + key.mode.intervals[degree]) % 12 };
}

/** The pitch class both scales share that sits best in `b`'s tonic chord (the drone between two keys, A6); null if none. */
export function commonTone(a: WorldKey, b: WorldKey): number | null {
  const sa = new Set(scaleClasses(a));
  const tonic = new Set(diatonicChord(b.mode, 0, 3).map((t) => (b.root + t) % 12));
  for (const c of [b.root, ...tonic, ...scaleClasses(b)]) if (sa.has(c)) return c;
  return null;
}

/** Where I stand in a building's harmony: inside its zone, in the ring outside, or nowhere (null). */
export function zoneOf(dist: number, radius: number, ring: number): "in" | "ring" | null {
  if (dist <= radius) return "in";
  if (dist <= radius + ring) return "ring";
  return null;
}
