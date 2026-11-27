import { describe, expect, it } from "vitest";
import { bridgeTo, conduct, connects, dominantTo, tenseStep, type ConductInputs, type PhraseLock } from "./colour";
import { placeChord, worldKey, type PlaceChord } from "./harmony";
import { closeVoicing, voiceLead, VOICE_HI, VOICE_LO } from "./voicing";

const chord = (classes: number[], rootClass = classes[0]): PlaceChord => ({ band: 0, degree: -1, classes, rootClass });
const Cmaj7 = chord([0, 4, 7, 11]);
const G7 = chord([7, 11, 2, 5]);
const Dm7 = chord([2, 5, 9, 0]);
const Ebmaj7 = chord([3, 7, 10, 2]);
const Db7 = chord([1, 5, 8, 11]);
const Abmaj7 = chord([8, 0, 3, 7]);

describe("voice leading (§13i)", () => {
  it("holds common tones, moves the rest by the smallest steps, sounds every tone, stays in the window", () => {
    const from = closeVoicing(Cmaj7.classes);
    expect(from).toEqual([48, 52, 55, 59]);
    const to = voiceLead(from, Abmaj7.classes);
    // C and G are common to Cmaj7 and Abmaj7: they stay where they are
    expect(to).toContain(48);
    expect(to).toContain(55);
    expect(new Set(to.map((p) => p % 12))).toEqual(new Set(Abmaj7.classes));
    const motion = to.reduce((s, p, i) => s + Math.abs(p - from[i]), 0);
    expect(motion).toBeLessThanOrEqual(4); // E → Eb, B → Ab… a step or so each, against 8 + 4 + 8 + 8 slot by slot
    for (const p of to) {
      expect(p).toBeGreaterThanOrEqual(VOICE_LO);
      expect(p).toBeLessThanOrEqual(VOICE_HI);
    }
  });
  it("a triad doubles one tone; a long walk never leaves the window", () => {
    let v = closeVoicing(Cmaj7.classes);
    const chords = [G7, Dm7, Ebmaj7, Db7, Abmaj7, chord([9, 0, 4]), Cmaj7, chord([6, 9, 0, 3])];
    for (let i = 0; i < 80; i++) {
      const c = chords[i % chords.length];
      const next = voiceLead(v, c.classes);
      expect(next.length).toBe(4);
      expect(new Set(next.map((p) => p % 12))).toEqual(new Set(c.classes));
      for (let k = 0; k < 4; k++) expect(Math.abs(next[k] - v[k])).toBeLessThanOrEqual(7);
      v = next;
    }
  });
});

describe("the connection rule (§13i)", () => {
  it("knows what follows naturally", () => {
    expect(connects(G7, Cmaj7)).toBe(true); // down a fifth
    expect(connects(Dm7, G7)).toBe(true);
    expect(connects(Db7, Cmaj7)).toBe(true); // the tritone substitute
    expect(connects(Cmaj7, chord([9, 0, 4, 7]))).toBe(true); // common tones
    expect(connects(Cmaj7, Ebmaj7)).toBe(false); // a chromatic mediant out of nowhere
    expect(connects(chord([4, 8, 11, 2]), Cmaj7)).toBe(true); // E7 → Cmaj7 shares E and B: a mediant, allowed
    expect(connects(chord([6, 10, 1, 4]), Cmaj7)).toBe(false); // F#7 → C: a tritone away, one common tone
    expect(bridgeTo(Ebmaj7).classes[0]).toBe(10); // Bb7 → Eb
    expect(connects(bridgeTo(Ebmaj7), Ebmaj7)).toBe(true);
  });
});

describe("one conductor (§13i)", () => {
  const key = worldKey("1760000000000");
  const place = placeChord(key, 0, 0);
  const other: PlaceChord = { ...(place.rootClass === 5 ? chord([7, 11, 2, 5]) : chord([5, 9, 0, 4])), band: place.band + 7 };
  const base = (bar: number, over: Partial<ConductInputs> = {}): ConductInputs => ({
    bar,
    place,
    tag: "w#0#" + place.rootClass,
    keyId: "w",
    level: 0.8,
    holding: true,
    gathered: true,
    staying: true,
    turnAmount: 0.8,
    colourAmount: 0.3,
    prev: null,
    prevPlace: null,
    ...over,
  });

  it("a tense phrase begins only on a multiple of eight and runs its eight bars, whatever changes meanwhile", () => {
    expect(conduct(null, base(13)).lock).toBeNull(); // mid-phrase: no tense phrase starts
    let lock: PhraseLock | null = null;
    const got: PlaceChord[] = [];
    for (let bar = 16; bar < 24; bar++) {
      // halfway the people leave, I start walking, the place under me changes: the phrase keeps going
      const late = bar >= 19;
      const r = conduct(lock, base(bar, late ? { level: 0, holding: false, gathered: false, staying: false, place: other, tag: "w#9#" + other.rootClass } : {}));
      lock = r.lock;
      expect(r.kind).toBe("tense");
      got.push(r.chord);
    }
    for (let k = 1; k < 8; k++) expect(got[k]).toEqual(tenseStep(place, "w#0#" + place.rootClass, 16 + k, 0.8, true));
    expect(conduct(lock, base(24, { level: 0, gathered: false, staying: false })).kind).toBe("walk"); // over at its end
  });

  it("a new key ends the phrase under way", () => {
    const start = conduct(null, base(8));
    expect(start.lock?.kind).toBe("tense");
    expect(conduct(start.lock, base(9, { keyId: "Eb Dorian" })).lock?.kind).not.toBe("tense");
  });

  it("fewer layers: gathered and staying → no turn (the place's chord or the tense phrase); alone and staying → the turn", () => {
    expect(conduct(null, base(4, { level: 0, holding: false })).kind).toBe("still");
    expect(conduct(null, base(4, { level: 0, holding: false, gathered: false })).kind).toBe("turn");
  });

  it("walking: no colour on the bar the band changes; an unconnected bar gets its dominant first", () => {
    for (let bar = 1; bar < 60; bar++) {
      const r = conduct(null, base(bar, { level: 0, holding: false, gathered: false, staying: false, prevPlace: other, colourAmount: 1 }));
      expect(r.chord.classes).toEqual((r.bridged ? bridgeTo(place) : place).classes);
    }
    const jump = conduct(null, base(3, { level: 0, holding: false, gathered: false, staying: false, prev: Ebmaj7, prevPlace: place, colourAmount: 0, place: Cmaj7 }));
    expect(jump.bridged).toBe(true);
    expect(jump.chord).toEqual(dominantTo(Cmaj7));
  });
});
