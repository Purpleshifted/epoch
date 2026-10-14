import { describe, expect, it } from "vitest";
import { DEFAULT_HARMONY, MODES, buildingKey, chordName, degreePitch, diatonicChord, homeKey, keyChord, keyName, magentaChordName, snapToClasses } from "./harmony";

describe("harmony: a key per motif, a key per building", () => {
  it("home keys are deterministic per id, in the middle modes, and differ between ids", () => {
    const a = homeKey("v_abc");
    expect(homeKey("v_abc")).toEqual(a);
    expect(DEFAULT_HARMONY.homeModes.map((i) => MODES[i].name)).toContain(a.mode.name);
    const keys = Array.from({ length: 50 }, (_, i) => keyName(homeKey(`v_${i}`)));
    expect(new Set(keys).size).toBeGreaterThan(10);
  });

  it("building keys come from the building's identity and may be stranger", () => {
    const b = buildingKey("12,-3");
    expect(buildingKey("12,-3")).toEqual(b);
    expect(DEFAULT_HARMONY.buildingModes.map((i) => MODES[i].name)).toContain(b.mode.name);
    expect(keyName(buildingKey("0,0")) !== keyName(buildingKey("0,1")) || buildingKey("0,0").root !== buildingKey("0,1").root).toBe(true);
  });

  it("diatonic chords stack thirds of the mode", () => {
    const ionian = MODES[5];
    expect(diatonicChord(ionian, 0, 3)).toEqual([0, 4, 7]); // I
    expect(diatonicChord(ionian, 1, 4)).toEqual([2, 5, 9, 12]); // ii7
    expect(diatonicChord(ionian, 4, 4)).toEqual([7, 11, 14, 17]); // V7
    expect(diatonicChord(MODES[2], 0, 3)).toEqual([0, 3, 7]); // i
  });

  it("keyChord: the tonic seventh of a key, named", () => {
    const am = { root: 9, mode: MODES[2] }; // A Aeolian
    expect(chordName(keyChord(am))).toBe("Am7");
    expect(keyChord(am).rootClass).toBe(9);
    const d = { root: 2, mode: MODES[5] }; // D Ionian
    expect(chordName(keyChord(d))).toBe("Dmaj7");
    expect(chordName(keyChord(d, 6))).toBe("Dbm7b5");
    expect(magentaChordName(chordName(keyChord(d, 6)))).toBe("Dbm");
    expect(chordName(keyChord(d, 6, 3))).toBe("Dbdim");
  });

  it("degreePitch and snapToClasses", () => {
    const k = { root: 0, mode: MODES[5] }; // C Ionian
    expect(degreePitch(k, 60, 0)).toBe(60);
    expect(degreePitch(k, 60, 2)).toBe(64);
    expect(degreePitch(k, 60, 7)).toBe(72);
    expect(degreePitch(k, 60, -1)).toBe(59);
    expect(degreePitch(k, 64, 1)).toBe(65);
    expect(degreePitch(k, 64, -2)).toBe(60);
    expect(degreePitch(k, 64, 5)).toBe(72);
    expect(snapToClasses(62, [0, 4, 7])).toBe(60);
    expect(snapToClasses(65, [0, 4, 7])).toBe(64);
    expect(snapToClasses(71, [0, 4, 7])).toBe(72);
    expect(snapToClasses(64, [0, 4, 7])).toBe(64);
  });
});
