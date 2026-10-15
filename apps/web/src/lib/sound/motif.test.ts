import { describe, expect, it } from "vitest";
import { MODES, placeChord, worldKey } from "./harmony";
import { DEFAULT_MOTIF, cycleSeconds, makeMotif, midiToHz, partialOf, realize } from "./motif";

const KEY = { root: 0, mode: MODES[5], degrees: Array(16).fill(0) }; // C Ionian, I everywhere

describe("motif: the visitor's signature (spec §3.1, revised)", () => {
  it("is deterministic per id and differs between ids", () => {
    const a = makeMotif("v_abc12");
    expect(makeMotif("v_abc12")).toEqual(a);
    const b = makeMotif("v_xyz99");
    expect(b.base !== a.base || b.degrees.join() !== a.degrees.join() || b.onsets.join() !== a.onsets.join()).toBe(true);
  });

  it("has a register in range, 3–5 degrees starting on 0 with no repeats in a row, a rhythm cell on the downbeat, small colour", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `v_${i.toString(36)}`).concat(["bot0", "bot1", "bot2"]);
    for (const id of ids) {
      const m = makeMotif(id);
      expect(m.base).toBeGreaterThanOrEqual(DEFAULT_MOTIF.baseLo);
      expect(m.base).toBeLessThanOrEqual(DEFAULT_MOTIF.baseHi);
      expect(m.degrees.length).toBeGreaterThanOrEqual(DEFAULT_MOTIF.notesMin);
      expect(m.degrees.length).toBeLessThanOrEqual(DEFAULT_MOTIF.notesMax);
      expect(m.degrees[0]).toBe(0);
      for (let i = 1; i < m.degrees.length; i++) expect(m.degrees[i]).not.toBe(m.degrees[i - 1]);
      for (const d of m.degrees) expect(Math.abs(d)).toBeLessThanOrEqual(8);
      expect(m.onsets.length).toBe(m.degrees.length);
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

  it("realize: free (lock 0) = diatonic pitches of the mode in the register, with wobble but never snapped", () => {
    const m = makeMotif("v_free");
    const notes = realize(m, KEY, null, 0, 0);
    expect(notes.length).toBe(m.degrees.length);
    notes.forEach((n, i) => {
      expect(n.at).toBeCloseTo(m.onsets[i] / m.steps);
      expect(KEY.mode.intervals).toContain((((n.pitch - KEY.root) % 12) + 12) % 12);
      expect(n.locked).toBe(false);
      // wobble stays within colour + freeCents
      const cents = 1200 * Math.log2(n.freq / midiToHz(n.pitch));
      expect(Math.abs(cents)).toBeLessThanOrEqual(DEFAULT_MOTIF.colourCents + DEFAULT_MOTIF.freeCents + 1e-6);
    });
  });

  it("realize: locked (lock 1) = every note a chord tone of the place, no wobble, and it differs from free for some motif", () => {
    const chord = placeChord(KEY, 0, 0); // C maj7: 0 4 7 11
    let moved = 0;
    for (let i = 0; i < 40; i++) {
      const m = makeMotif(`v_l${i}`);
      const free = realize(m, KEY, chord, 0, 3);
      const locked = realize(m, KEY, chord, 1, 3);
      locked.forEach((n, j) => {
        expect(chord.classes).toContain(((n.pitch % 12) + 12) % 12);
        expect(n.locked).toBe(true);
        expect(1200 * Math.log2(n.freq / midiToHz(n.pitch))).toBeCloseTo(m.colour, 5);
        if (n.pitch !== free[j].pitch) moved++;
      });
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("realize is reproducible per cycle and varies between cycles under a partial lock", () => {
    const m = makeMotif("v_c");
    const chord = placeChord(KEY, 0, 0);
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

  it("two visitors in the same epoch are diatonic to each other", () => {
    const key = worldKey("epoch-1");
    const a = realize(makeMotif("v_a"), key, null, 0, 0);
    const b = realize(makeMotif("v_b"), key, null, 0, 0);
    for (const n of [...a, ...b]) expect(key.mode.intervals).toContain((((n.pitch - key.root) % 12) + 12) % 12);
  });
});
