import { describe, expect, it } from "vitest";
import { deceptiveOf, isMinor, predominantOf, stayingChord, walkingChord } from "./colour";
import { chordName, magentaChordName, placeChord, scaleClasses, worldKey } from "./harmony";
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
});
