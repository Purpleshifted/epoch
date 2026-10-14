import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_HARMONY, MODES, bandOf, chordName, degreePitch, diatonicChord, magentaChordName, placeChord, snapToClasses, worldKey } from "./harmony";

describe("harmony: one tonal field per epoch, a chord per place", () => {
  it("worldKey is deterministic, in an allowed mode, with a progression that starts on the tonic and follows the Markov table", () => {
    const k = worldKey("1760000000000");
    expect(worldKey("1760000000000")).toEqual(k);
    expect(DEFAULT_HARMONY.modes.map((i) => MODES[i].name)).toContain(k.mode.name);
    expect(k.degrees.length).toBe(DEFAULT_HARMONY.bands);
    expect(k.degrees[0]).toBe(0);
    for (const d of k.degrees) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
    // not one chord all the way
    expect(new Set(k.degrees).size).toBeGreaterThan(2);
    expect(worldKey("other").root !== k.root || worldKey("other").mode !== k.mode || worldKey("other").degrees.join() !== k.degrees.join()).toBe(true);
  });

  it("bands run along x + z and wrap", () => {
    const w = CELL_SIZE * DEFAULT_HARMONY.bandCells;
    expect(bandOf(0, 0)).toBe(0);
    expect(bandOf(w, 0)).toBe(1);
    expect(bandOf(0, w)).toBe(1);
    expect(bandOf(w * DEFAULT_HARMONY.bands, 0)).toBe(0);
    expect(bandOf(-0.01, 0)).toBe(DEFAULT_HARMONY.bands - 1);
  });

  it("diatonic chords stack thirds of the mode", () => {
    const ionian = MODES[5];
    expect(diatonicChord(ionian, 0, 3)).toEqual([0, 4, 7]); // I
    expect(diatonicChord(ionian, 1, 4)).toEqual([2, 5, 9, 12]); // ii7
    expect(diatonicChord(ionian, 4, 4)).toEqual([7, 11, 14, 17]); // V7
    const aeolian = MODES[2];
    expect(diatonicChord(aeolian, 0, 3)).toEqual([0, 3, 7]); // i
  });

  it("placeChord names and classes follow the key", () => {
    const k = { root: 9, mode: MODES[2], degrees: [0, 3, 4, 5] }; // A Aeolian
    const c0 = placeChord(k, 0, 0, { ...DEFAULT_HARMONY, bands: 4 });
    expect(c0.rootClass).toBe(9);
    expect(chordName(k, c0)).toBe("Am7");
    const c1 = placeChord(k, CELL_SIZE * 4, 0, { ...DEFAULT_HARMONY, bands: 4 });
    expect(chordName(k, c1)).toBe("Dm7"); // iv7 of A minor
    const d = { root: 2, mode: MODES[5], degrees: [6] }; // D Ionian, vii
    const c6 = placeChord(d, 0, 0, { ...DEFAULT_HARMONY, bands: 1 });
    expect(chordName(d, c6)).toBe("Dbm7b5");
    expect(magentaChordName(chordName(d, c6))).toBe("Dbm");
    expect(chordName(d, placeChord(d, 0, 0, { ...DEFAULT_HARMONY, bands: 1, chordSize: 3 }))).toBe("Dbdim");
  });

  it("degreePitch and snapToClasses", () => {
    const k = { root: 0, mode: MODES[5], degrees: [0] }; // C Ionian
    expect(degreePitch(k, 60, 0)).toBe(60);
    expect(degreePitch(k, 60, 2)).toBe(64);
    expect(degreePitch(k, 60, 7)).toBe(72);
    expect(degreePitch(k, 60, -1)).toBe(59);
    // a voice whose register is E4 (degree 2 of C): one degree up is F, two down is C
    expect(degreePitch(k, 64, 1)).toBe(65);
    expect(degreePitch(k, 64, -2)).toBe(60);
    expect(degreePitch(k, 64, 5)).toBe(72);
    // C major triad classes
    expect(snapToClasses(62, [0, 4, 7])).toBe(60); // D → C (tie with E goes down)
    expect(snapToClasses(65, [0, 4, 7])).toBe(64); // F → E
    expect(snapToClasses(71, [0, 4, 7])).toBe(72); // B → C above
    expect(snapToClasses(64, [0, 4, 7])).toBe(64); // already a chord tone
  });
});
