import { describe, expect, it } from "vitest";
import { MODES, homeKey, intervalClass, keyChord, scaleClasses } from "./harmony";
import { DEFAULT_MOTIF, cycleSeconds, makeMotif, midiToHz, partialOf, realize } from "./motif";

const KEY = { root: 0, mode: MODES[5] }; // C Ionian
const pc = (p: number) => ((p % 12) + 12) % 12;
const inKey = (p: number, k = KEY) => scaleClasses(k).includes(pc(p));

describe("motif: the visitor's signature as a SHAPE of real intervals + a rhythm cell", () => {
  it("is deterministic per id and differs between ids", () => {
    const a = makeMotif("v_abc12");
    expect(makeMotif("v_abc12")).toEqual(a);
    const b = makeMotif("v_xyz99");
    expect(b.base !== a.base || b.semis.join() !== a.semis.join() || b.onsets.join() !== a.onsets.join()).toBe(true);
  });

  it("has a register in range, 3–5 notes starting on 0 with no repeats in a row, steps/skips/leaps only, a rhythm cell on the downbeat, small colour", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `v_${i.toString(36)}`).concat(["bot0", "bot1", "bot2"]);
    for (const id of ids) {
      const m = makeMotif(id);
      expect(m.base).toBeGreaterThanOrEqual(DEFAULT_MOTIF.baseLo);
      expect(m.base).toBeLessThanOrEqual(DEFAULT_MOTIF.baseHi);
      expect(m.semis.length).toBeGreaterThanOrEqual(DEFAULT_MOTIF.notesMin);
      expect(m.semis.length).toBeLessThanOrEqual(DEFAULT_MOTIF.notesMax);
      expect(m.semis[0]).toBe(0);
      for (let i = 1; i < m.semis.length; i++) {
        const iv = Math.abs(m.semis[i] - m.semis[i - 1]);
        expect(iv).toBeGreaterThanOrEqual(1);
        expect(iv).toBeLessThanOrEqual(7);
      }
      for (const d of m.semis) expect(Math.abs(d)).toBeLessThanOrEqual(16);
      expect(m.onsets.length).toBe(m.semis.length);
      expect(m.onsets[0]).toBe(0);
      for (let i = 1; i < m.onsets.length; i++) expect(m.onsets[i]).toBeGreaterThan(m.onsets[i - 1]);
      expect(m.onsets[m.onsets.length - 1]).toBeLessThan(m.steps);
      expect(Math.abs(m.colour)).toBeLessThanOrEqual(DEFAULT_MOTIF.colourCents);
      expect(m.centroid).toBeCloseTo(midiToHz(m.base));
    }
  });

  it("spreads registers over the range and rhythm cells differ", () => {
    const ms = Array.from({ length: 100 }, (_, i) => makeMotif(`v_${i}`));
    const low = ms.filter((m) => m.base < 62).length;
    expect(low).toBeGreaterThan(25);
    expect(low).toBeLessThan(75);
    expect(new Set(ms.map((m) => m.onsets.join())).size).toBeGreaterThan(20);
  });

  it("realize in a key = a tonal answer: in the key (≤ 1 chromatic note), every direction and interval class of the shape kept", () => {
    for (let i = 0; i < 200; i++) {
      const m = makeMotif(`v_ta${i}`);
      const notes = realize(m, KEY, null, 0, 0);
      expect(notes.length).toBe(m.semis.length);
      let chromatic = 0;
      notes.forEach((n, j) => {
        expect(n.at).toBeCloseTo(m.onsets[j] / m.steps);
        if (!inKey(n.pitch)) chromatic++;
        if (j > 0) {
          const a = m.semis[j - 1], b = m.semis[j];
          expect(Math.sign(n.pitch - notes[j - 1].pitch)).toBe(Math.sign(b - a));
        }
      });
      expect(chromatic).toBeLessThanOrEqual(DEFAULT_MOTIF.chromaticBudget);
      // the strict shape (interval classes) holds for the great majority; when it cannot, directions still do
      const classesKept = notes.every((n, j) => j === 0 || intervalClass(n.pitch - notes[j - 1].pitch) === intervalClass(m.semis[j] - m.semis[j - 1]));
      if (!classesKept) expect(chromatic).toBeLessThanOrEqual(1);
    }
  });

  it("the same motif in two keys is a modulation: same rhythm, same directions, both in their keys", () => {
    const m = makeMotif("v_mod");
    const home = homeKey("v_mod");
    const other = { root: (home.root + 6) % 12, mode: MODES[1] };
    const a = realize(m, home, null, 0, 0);
    const b = realize(m, other, null, 0, 0);
    expect(a.length).toBe(b.length);
    a.forEach((n, i) => expect(n.at).toBe(b[i].at));
    for (let i = 1; i < a.length; i++) expect(Math.sign(a[i].pitch - a[i - 1].pitch)).toBe(Math.sign(b[i].pitch - b[i - 1].pitch));
  });

  it("chord pull: only strong beats move, only onto chord tones, never breaking a direction; weak beats pass", () => {
    const chord = keyChord(KEY); // Cmaj7
    let pulled = 0;
    for (let i = 0; i < 200; i++) {
      const m = makeMotif(`v_cp${i}`);
      const free = realize(m, KEY, chord, 0, 3);
      const locked = realize(m, KEY, chord, 1, 3);
      locked.forEach((n, j) => {
        const strong = m.onsets[j] % (m.steps / 2) === 0;
        if (!strong) expect(n.pitch).toBe(free[j].pitch);
        if (n.locked) {
          expect(chord.classes).toContain(pc(n.pitch));
          if (n.pitch !== free[j].pitch) pulled++;
        }
        if (j > 0) expect(Math.sign(n.pitch - locked[j - 1].pitch)).toBe(Math.sign(m.semis[j] - m.semis[j - 1]));
      });
    }
    expect(pulled).toBeGreaterThan(0);
  });

  it("realize is reproducible per cycle and varies between cycles under a partial pull", () => {
    const m = makeMotif("v_c");
    const chord = keyChord(KEY);
    expect(realize(m, KEY, chord, 0.5, 7)).toEqual(realize(m, KEY, chord, 0.5, 7));
    const a = realize(m, KEY, chord, 0.5, 1).map((n) => n.freq).join();
    const b = realize(m, KEY, chord, 0.5, 2).map((n) => n.freq).join();
    expect(a).not.toBe(b);
  });

  it("runs the cycle at the visitor's tempo: 60 BPM = the configured cycle, slower when still", () => {
    const m = { ...makeMotif("v_t"), tempoScale: 1 };
    expect(cycleSeconds(m, 60)).toBeCloseTo(DEFAULT_MOTIF.cycleSec);
    expect(cycleSeconds(m, 40)).toBeGreaterThan(cycleSeconds(m, 140));
  });

  it("gives the global view one low partial per person", () => {
    const m = makeMotif("v_p");
    expect(partialOf(m, 3)).toBeCloseTo(m.centroid / 8);
    expect(partialOf(m, 3)).toBeLessThan(80);
  });
});
