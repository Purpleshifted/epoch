import { describe, expect, it } from "vitest";
import { DEFAULT_HARMONY, MODES, buildingKey, chordName, degreePitch, diatonicChord, homeKey, keyChord, keyName, intervalClass, keepsShape, magentaChordName, nextDegree, pullToChord, relatedKey, scaleClasses, snapToClasses, tonalAnswer, tonalityOf, worldKey, bandOf, DEFAULT_WORLD } from "./harmony";
import { CELL_SIZE } from "@/lib/stratum/field";

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

  it("world mode: one key per epoch with a progression over the ground in bands (93e85c5)", () => {
    const k = worldKey("1760000000000");
    expect(worldKey("1760000000000")).toEqual(k);
    expect(k.degrees.length).toBe(DEFAULT_WORLD.bands);
    expect(k.degrees[0]).toBe(0);
    expect(new Set(k.degrees).size).toBeGreaterThan(2);
    const w = CELL_SIZE * DEFAULT_WORLD.bandCells;
    expect(bandOf(0, 0)).toBe(0);
    expect(bandOf(w, 0)).toBe(1);
    expect(bandOf(0, w)).toBe(1);
    expect(bandOf(w * DEFAULT_WORLD.bands, 0)).toBe(0);
    expect(bandOf(-0.01, 0)).toBe(DEFAULT_WORLD.bands - 1);
  });

  it("interval classes and the shape test", () => {
    expect([0, 1, 2, 3, 4].map((c) => intervalClass([0, 2, 3, 7, 9][c]))).toEqual([0, 1, 2, 3, 4]);
    expect(intervalClass(-1)).toBe(1);
    expect(intervalClass(4)).toBe(2);
    expect(intervalClass(5)).toBe(3);
    expect(keepsShape(60, 61, 60, 62)).toBe(true); // a semitone step rendered as a whole-tone step
    expect(keepsShape(60, 63, 60, 64)).toBe(true); // minor third → major third: still a skip
    expect(keepsShape(60, 62, 60, 63)).toBe(false); // a step must not become a skip
    expect(keepsShape(60, 62, 62, 60)).toBe(false); // direction must not flip
  });

  it("tonal answer: the shape laid on a scale — semitones become whole tones where needed, directions and classes kept", () => {
    const C = { root: 0, mode: MODES[5] }; // C Ionian
    // a chromatic shape from E: E F# G# A (0 2 4 5) → in C the answer trades the sharps: E F G A (0 1 3 5)
    const ans = tonalAnswer([0, 2, 4, 5], 64, C);
    expect(ans[0]).toBe(64);
    for (const p of ans) expect(scaleClasses(C)).toContain(((p % 12) + 12) % 12);
    expect(ans.map((p, i) => (i ? Math.sign(p - ans[i - 1]) : 0))).toEqual([0, 1, 1, 1]);
    expect(ans.map((p, i) => (i ? intervalClass(p - ans[i - 1]) : 0))).toEqual([0, 1, 1, 1]);
    // a shape that already fits stays exactly
    expect(tonalAnswer([0, 2, 4, 7], 60, C)).toEqual([60, 62, 64, 67]);
    // the first note lands on the nearest scale tone of the register
    expect(tonalAnswer([0, 2], 61, C)[0]).toBe(60);
    // a leap stays a leap, a skip a skip, in a minor key too
    const Am = { root: 9, mode: MODES[2] };
    const leap = tonalAnswer([0, 7, 4, 0], 64, Am);
    expect(leap.map((p, i) => (i ? intervalClass(p - leap[i - 1]) : 0))).toEqual([0, 3, 2, 2]);
    for (const p of leap) expect(scaleClasses(Am)).toContain(((p % 12) + 12) % 12);
  });

  it("tonal answer: at most one chromatic note survives, and only when the shape needs it", () => {
    const C = { root: 0, mode: MODES[5] };
    // E → F → F# → G: two consecutive semitone steps up from F cannot both be whole-tone steps without a class change
    const ans = tonalAnswer([0, 1, 2, 3], 64, C, 1);
    const chroma = ans.filter((p) => !scaleClasses(C).includes(((p % 12) + 12) % 12)).length;
    expect(chroma).toBeLessThanOrEqual(1);
    expect(ans.map((p, i) => (i ? Math.sign(p - ans[i - 1]) : 0))).toEqual([0, 1, 1, 1]);
    const strict = tonalAnswer([0, 1, 2, 3], 64, C, 0);
    for (const p of strict) expect(scaleClasses(C)).toContain(((p % 12) + 12) % 12);
    expect(strict.map((p, i) => (i ? Math.sign(p - strict[i - 1]) : 0))).toEqual([0, 1, 1, 1]);
  });

  it("chord pull: strong beats onto chord tones when the shape allows, weak beats untouched", () => {
    const classes = [0, 4, 7, 11]; // Cmaj7
    const always = () => 0; // every roll < lock
    const { pitches, locked } = pullToChord([62, 64, 65, 67], [true, false, true, false], classes, 1, always);
    expect(pitches[1]).toBe(64);
    expect(pitches[3]).toBe(67);
    expect(locked[1]).toBe(false);
    expect(locked[3]).toBe(false);
    // 62 (D) on a strong beat: nearest chord tone is C (60) — the step up to 64 would become a skip, so D stays
    expect(pitches[0]).toBe(62);
    // 65 (F) strong: E (64) would make a unison with the previous E → stays; so F stays too
    expect(pitches[2]).toBe(65);
    // a case that moves: 61 strong before 64: C (60) keeps a skip up to E
    const moved = pullToChord([61, 64], [true, false], classes, 1, always);
    expect(moved.pitches[0]).toBe(60);
    expect(moved.locked[0]).toBe(true);
    // lock 0: nothing moves
    expect(pullToChord([61, 64], [true, false], classes, 0, always).pitches).toEqual([61, 64]);
  });

  it("relatedKey: a building's key is the dominant, subdominant, relative or parallel of the world's", () => {
    const C = { root: 0, mode: MODES[5] };
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const k = relatedKey(C, `b${i}`);
      const tag = `${k.root}:${k.mode.name}`;
      seen.add(tag);
      expect(["7:Ionian", "5:Ionian", "9:Aeolian", "0:Aeolian"]).toContain(tag);
    }
    expect(seen.size).toBe(4);
    const Am = { root: 9, mode: MODES[2] };
    for (let i = 0; i < 20; i++) expect(["4:Aeolian", "2:Aeolian", "0:Ionian", "9:Ionian"]).toContain(`${relatedKey(Am, `m${i}`).root}:${relatedKey(Am, `m${i}`).mode.name}`);
  });

  it("a building's tonality is made of its builders' home roots: tonic = the heaviest, chord = the roots, mode = best fit", () => {
    expect(tonalityOf([])).toBeNull();
    const a = tonalityOf([{ o: "v_a", amount: 10 }])!;
    expect(a.key.root).toBe(homeKey("v_a").root);
    expect(a.chord.rootClass).toBe(a.key.root);
    expect(a.chord.classes.length).toBeGreaterThanOrEqual(3); // filled to a triad
    expect(a.builders).toEqual(["v_a"]);
    const who = [{ o: "v_a", amount: 3 }, { o: "v_b", amount: 9 }, { o: "bot1", amount: 5 }, { o: "bot2", amount: 1 }, { o: "bot3", amount: 2 }];
    const t = tonalityOf(who)!;
    expect(t.key.root).toBe(homeKey("v_b").root); // the heaviest builder is the tonic
    expect(t.builders[0]).toBe("v_b");
    expect(t.chord.classes[0]).toBe(homeKey("v_b").root);
    expect(t.chord.classes.length).toBeLessThanOrEqual(4);
    for (const b of t.builders) expect(t.chord.classes).toContain(homeKey(b).root);
    expect(DEFAULT_HARMONY.homeModes.map((i) => MODES[i].name)).toContain(t.key.mode.name);
    // weights move the chord: when v_a grows past v_b the tonic changes — a progression made of people
    const later = tonalityOf([{ o: "v_a", amount: 12 }, { o: "v_b", amount: 9 }])!;
    expect(later.key.root).toBe(homeKey("v_a").root);
    expect(tonalityOf(who)).toEqual(t); // deterministic
  });

  it("nextDegree walks the Markov table of the mode", () => {
    const major = { root: 0, mode: MODES[5] };
    expect([3, 4, 5, 1]).toContain(nextDegree(major, 0, 0.5));
    expect(nextDegree(major, 0, 0)).toBe(3); // I → IV first
    expect(nextDegree(major, 4, 0)).toBe(0); // V → I
    const minor = { root: 9, mode: MODES[2] };
    expect([3, 4, 5, 2]).toContain(nextDegree(minor, 0, 0.99));
    expect(nextDegree(minor, 6, 0.5)).toBe(0); // VII → i (middle option)
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
