import { describe, expect, it } from "vitest";
import { deceptiveOf, isMinor, predominantOf, stayingChord, tenseArrival, tenseChord, TENSE_BARS, walkingChord } from "./colour";
import { bassOf, chordName, magentaChordName, placeChord, scaleClasses, worldKey } from "./harmony";
import { arrivalBars, nextArrival, ARRIVAL_IDLE } from "./sequencer";

describe("more turns in the harmony (sound-logic §13f)", () => {
  const key = worldKey("1760000000000");
  const place = placeChord(key, 0, 0);

  it("staying: the place's own chord on the bar's first step, then a progression that leaves the mode — the same for the same place", () => {
    const tag = "w#0#" + place.rootClass;
    const bars = [0, 1, 2, 3].map((b) => stayingChord(place, tag, b, 1));
    expect(bars[0]).toEqual(place);
    expect(new Set(bars.map((c) => c.classes.join())).size).toBeGreaterThan(2);
    // the same place, the same bar: the same chord (everyone staying there hears it)
    expect(stayingChord(place, tag, 6, 1)).toEqual(stayingChord(place, tag, 2, 1));
    // across the progressions some chord leaves the key's scale (borrowed, chromatic)
    const scale = new Set(scaleClasses(key));
    let outside = 0;
    for (let i = 0; i < 40; i++) for (let b = 1; b < 4; b++) if (stayingChord(place, `t${i}`, b, 1).classes.some((c) => !scale.has(c))) outside++;
    expect(outside).toBeGreaterThan(10);
    // amount 0: the chord held, as before
    for (let b = 0; b < 4; b++) expect(stayingChord(place, tag, b, 0)).toEqual(place);
  });

  it("walking: some bars suspended or opened on their own root, as many as asked", () => {
    let coloured = 0;
    for (let b = 0; b < 400; b++) {
      const c = walkingChord(place, b, 0.3);
      if (c !== place) {
        coloured++;
        expect(c.rootClass).toBe(place.rootClass);
        expect(chordName(key, c)).toMatch(/sus4|sus2|add9/);
      }
    }
    expect(coloured).toBeGreaterThan(80);
    expect(coloured).toBeLessThan(160);
    expect(walkingChord(place, 3, 0)).toBe(place);
  });

  it("the long arrival: pre-dominant, dominant, sometimes a deceptive turn, then home; the short one as before", () => {
    expect(arrivalBars(5, false)).toEqual(["dominant", "tonic"]);
    let deceptive = 0;
    for (let s = 0; s < 200; s++) {
      const seq = arrivalBars(s, true);
      expect(seq[0]).toBe("pre");
      expect(seq[1]).toBe("dominant");
      expect(seq[seq.length - 1]).toBe("tonic");
      if (seq.includes("deceptive")) deceptive++;
    }
    expect(deceptive).toBeGreaterThan(40);
    expect(deceptive).toBeLessThan(110);
    // stepping through: it starts when building together begins, and runs its bars
    let st = { ...ARRIVAL_IDLE };
    const phases: (string | null)[] = [];
    for (let bar = 100; bar < 106; bar++) {
      const r = nextArrival(st, bar, true, false, 8, true);
      st = r.state;
      phases.push(r.phase);
    }
    expect(phases.slice(0, arrivalBars(100, true).length)).toEqual(arrivalBars(100, true));
    expect(phases[phases.length - 1]).toBeNull();
    expect(predominantOf(key, 7).classes.length).toBe(4);
    expect(isMinor(deceptiveOf(key))).toBe(false);
  });

  it("names: suspensions, added notes, a pedal; Magenta gets what it knows", () => {
    const c7sus4 = { band: 0, degree: -1, classes: [0, 5, 7, 10], rootClass: 0 };
    expect(chordName(key, c7sus4)).toBe("C7sus4");
    expect(magentaChordName("C7sus4")).toBe("C7");
    expect(chordName(key, { band: 0, degree: -1, classes: [5, 9, 0, 4], rootClass: 0 })).toBe("Fmaj7/C");
    expect(magentaChordName("Fmaj7/C")).toBe("Fmaj7");
    expect(magentaChordName("Am6")).toBe("Am");
    expect(magentaChordName("Dadd9")).toBe("D");
  });

  it("gathered, tense: as many eight-bar phrases as the level, home on the first bar, a dominant on the last (§13g)", () => {
    expect(tenseChord(place, "x", 3, 0)).toBeNull();
    let tense = 0;
    for (let ph = 0; ph < 400; ph++) if (tenseChord(place, "x", ph * TENSE_BARS + 3, 0.5)) tense++;
    expect(tense).toBeGreaterThan(150);
    expect(tense).toBeLessThan(250);
    const names = new Set<string>();
    for (let t = 0; t < 30; t++) {
      const tag = `t${t}`;
      const bars = Array.from({ length: TENSE_BARS }, (_, k) => tenseChord(place, tag, 80 + k, 1)!);
      expect(bars[0]).toEqual(place);
      // the last bar leans home: it holds the place's leading tone (V, or the tritone substitute)
      expect(bars[TENSE_BARS - 1].classes).toContain((place.rootClass + 11) % 12);
      for (const c of bars) {
        names.add(chordName(key, c));
        expect(c.classes.length).toBeLessThanOrEqual(4); // the pad holds the bass and four
        expect(bassOf(c)).toBeGreaterThanOrEqual(30);
        expect(bassOf(c)).toBeLessThanOrEqual(52); // (I/3 lifts it a third)
      }
      // the same place, the same bar: the same chord
      expect(tenseChord(place, tag, 83, 1)).toEqual(bars[3]);
    }
    expect([...names].some((n) => /7b9|7#9|dim7|m7b5|7#5|m\(maj7\)/.test(n))).toBe(true);
  });

  it("the lament's bass falls a semitone a bar instead of jumping an octave", () => {
    let found = false;
    for (let t = 0; t < 200 && !found; t++) {
      const bass = Array.from({ length: 6 }, (_, k) => bassOf(tenseChord(place, `l${t}`, 160 + k, 1)!));
      if (bass.every((b, i) => i === 0 || b === bass[0] - i)) found = true;
    }
    expect(found).toBe(true);
  });

  it("the arrival made tense: ii ø or #iv°7, then V altered; names Magenta still knows", () => {
    const dom = tenseArrival(key, "dominant", 12, 0, 1)!;
    expect(dom.classes[0]).toBe((key.root + 7) % 12);
    expect(chordName(key, dom)).toMatch(/7b9|7#9|7#5/);
    expect(tenseArrival(key, "pre", 12, 0, 0)).toBeNull();
    expect(chordName(key, tenseArrival(key, "pre", 12, 0, 1)!)).toMatch(/m7b5|dim7/);
    expect(magentaChordName("G7b9")).toBe("G7");
    expect(magentaChordName("G7sus4b9/G")).toBe("G7");
    expect(magentaChordName("Am(maj7)")).toBe("Am");
    expect(magentaChordName("Cmaj7#11")).toBe("Cmaj7");
    expect(magentaChordName("Bm7b5")).toBe("Bm");
    expect(magentaChordName("Dbmaj7/G")).toBe("Dbmaj7");
  });
});
