import { describe, expect, it } from "vitest";
import { DEFAULT_MOTIF, cycleSeconds, makeMotif, motifNotes, partialOf, toneFreq } from "./motif";

describe("motif: the visitor's signature (spec §3.1)", () => {
  it("is deterministic per id and differs between ids", () => {
    const a = makeMotif("v_abc12");
    expect(makeMotif("v_abc12")).toEqual(a);
    const b = makeMotif("v_xyz99");
    expect(b.centroid).not.toBe(a.centroid);
  });

  it("has a centroid in range and 3–5 micro-tones within its spread, the first on the centroid", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `v_${i.toString(36)}`).concat(["bot0", "bot1", "bot2"]);
    for (const id of ids) {
      const m = makeMotif(id);
      expect(m.centroid).toBeGreaterThanOrEqual(DEFAULT_MOTIF.centroidLo);
      expect(m.centroid).toBeLessThanOrEqual(DEFAULT_MOTIF.centroidHi);
      expect(m.cents.length).toBeGreaterThanOrEqual(DEFAULT_MOTIF.notesMin);
      expect(m.cents.length).toBeLessThanOrEqual(DEFAULT_MOTIF.notesMax);
      expect(m.cents[0]).toBe(0);
      expect(m.spread).toBeGreaterThanOrEqual(DEFAULT_MOTIF.spreadCentsMin);
      expect(m.spread).toBeLessThanOrEqual(DEFAULT_MOTIF.spreadCentsMax);
      for (const c of m.cents) expect(Math.abs(c)).toBeLessThanOrEqual(m.spread + 1e-9);
      expect(m.tempoScale).toBeGreaterThanOrEqual(1 / DEFAULT_MOTIF.tempoRange - 1e-9);
      expect(m.tempoScale).toBeLessThanOrEqual(DEFAULT_MOTIF.tempoRange + 1e-9);
    }
  });

  it("spreads centroids over the range (not all alike)", () => {
    const cs = Array.from({ length: 100 }, (_, i) => makeMotif(`v_${i}`).centroid);
    const lows = cs.filter((c) => c < 220).length;
    expect(lows).toBeGreaterThan(20);
    expect(lows).toBeLessThan(80);
  });

  it("arpeggiates its tones evenly over one cycle, tones in cents off the centroid", () => {
    const m = makeMotif("v_test");
    const notes = motifNotes(m);
    expect(notes.length).toBe(m.cents.length);
    notes.forEach((n, i) => {
      expect(n.at).toBeCloseTo(i / notes.length);
      expect(n.freq).toBeCloseTo(toneFreq(m, i));
    });
    expect(toneFreq(m, 0)).toBeCloseTo(m.centroid);
    // 100 cents = one semitone
    const semi = { ...m, cents: [0, 100] };
    expect(toneFreq(semi, 1) / semi.centroid).toBeCloseTo(Math.pow(2, 1 / 12));
  });

  it("runs the cycle at the visitor's tempo: 60 BPM = the configured cycle, slower when still", () => {
    const m = { ...makeMotif("v_t"), tempoScale: 1 };
    expect(cycleSeconds(m, 60)).toBeCloseTo(DEFAULT_MOTIF.cycleSec);
    expect(cycleSeconds(m, 40)).toBeGreaterThan(cycleSeconds(m, 140));
  });

  it("gives the global view one low partial per person", () => {
    const m = makeMotif("v_p");
    expect(partialOf(m, 3)).toBeCloseTo(m.centroid / 8);
    expect(partialOf(m, 3)).toBeLessThan(60);
  });
});
