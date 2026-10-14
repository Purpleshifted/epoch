import { describe, expect, it } from "vitest";
import { makeMotif } from "./motif";
import { blend, cycleToSteps, intoRange, stepsToCycle } from "./variation";

describe("variation: my motif borrows from whoever stays near", () => {
  it("amount 0 = mine untouched; amount 1 = the other's contour and rhythm", () => {
    const mine = makeMotif("v_mine");
    const theirs = makeMotif("bot4");
    expect(blend(mine, theirs, 0, 0)).toBe(mine);
    const full = blend(mine, theirs, 1, 0);
    expect(full.id).toBe(mine.id);
    expect(full.base).toBe(mine.base); // my register stays: it is still my voice
    expect(full.onsets).toEqual(theirs.onsets.slice(0, full.degrees.length));
    full.degrees.forEach((d, i) => expect(d).toBe(theirs.degrees[i % theirs.degrees.length]));
  });

  it("in between, some notes are theirs, some mine; reproducible per cycle; onsets stay a valid cell", () => {
    const mine = makeMotif("v_m2");
    const theirs = makeMotif("v_t2");
    let borrowed = 0, kept = 0;
    for (let c = 0; c < 20; c++) {
      const b = blend(mine, theirs, 0.4, c);
      expect(blend(mine, theirs, 0.4, c)).toEqual(b);
      expect(b.onsets.length).toBe(b.degrees.length);
      expect(b.onsets[0]).toBe(0);
      for (let i = 1; i < b.onsets.length; i++) expect(b.onsets[i]).toBeGreaterThan(b.onsets[i - 1]);
      b.degrees.forEach((d, i) => {
        if (d === theirs.degrees[i % theirs.degrees.length] && d !== mine.degrees[i % mine.degrees.length]) borrowed++;
        else if (d === mine.degrees[i % mine.degrees.length]) kept++;
      });
    }
    expect(borrowed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it("phrase steps round-trip a cycle", () => {
    const notes = [{ at: 0, pitch: 60 }, { at: 3 / 8, pitch: 64 }, { at: 6 / 8, pitch: 67 }];
    const steps = cycleToSteps(notes);
    expect(steps).toEqual([60, 0, 0, 64, 0, 0, 67, 0]);
    const back = stepsToCycle([...steps, ...steps], 8);
    expect(back.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(back[0].len).toBeCloseTo((3 / 8) * 0.85);
    expect(back[2].len).toBeCloseTo((2 / 8) * 0.85);
  });

  it("intoRange shifts by octaves into Magenta's melody range", () => {
    expect(intoRange(36)).toBe(48);
    expect(intoRange(95)).toBe(83);
    expect(intoRange(60)).toBe(60);
  });
});
