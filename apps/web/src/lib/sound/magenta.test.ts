import { describe, expect, it } from "vitest";
import { phraseToSequence, sequenceToPhrase } from "./magenta";

describe("magenta: phrases ↔ note sequences", () => {
  it("round-trips a phrase, holding each note to the next onset, pitches into 48…83", () => {
    const phrase = new Array(32).fill(0);
    phrase[0] = 40; phrase[4] = 64; phrase[20] = 90;
    const seq = phraseToSequence(phrase);
    expect(seq.notes?.length).toBe(3);
    expect(seq.notes?.[0].pitch).toBe(52);
    expect(seq.notes?.[0].endTime).toBeCloseTo(4 * 0.125);
    expect(seq.notes?.[2].pitch).toBe(78);
    expect(seq.notes?.[2].endTime).toBeCloseTo(32 * 0.125);
    const back = sequenceToPhrase(seq);
    expect(back[0]).toBe(52);
    expect(back[4]).toBe(64);
    expect(back[20]).toBe(78);
    expect(back.filter((p) => p > 0).length).toBe(3);
  });

  it("drops the seed steps of a continuation and reads quantized steps when present", () => {
    const seq = { notes: [{ pitch: 60, quantizedStartStep: 32 }, { pitch: 62, quantizedStartStep: 40 }, { pitch: 1, quantizedStartStep: 2 }] };
    const phrase = sequenceToPhrase(seq, 32);
    expect(phrase[0]).toBe(60);
    expect(phrase[8]).toBe(62);
    expect(phrase.filter((p) => p > 0).length).toBe(2);
  });
});
