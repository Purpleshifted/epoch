/**
 * A melody written down (glyph.ts).
 */
import { describe, expect, it } from "vitest";
import { makeMotif } from "@/lib/sound/motif";
import { GLYPH_COLS, GLYPH_ROWS, glyphDots, glyphOf, individualNo, newWordOf, rhythmOf, stepAt } from "./index";

describe("the glyph", () => {
  it("every melody fits the box, one dot per note, in the order it sounds", () => {
    for (let i = 0; i < 400; i++) {
      const id = `x${i}`;
      const m = makeMotif(id);
      const dots = glyphOf(id);
      expect(dots.length).toBe(m.degrees.length);
      for (const d of dots) {
        expect(d.col).toBeGreaterThanOrEqual(0);
        expect(d.col).toBeLessThan(GLYPH_COLS);
        expect(d.row).toBeGreaterThanOrEqual(0);
        expect(d.row).toBeLessThan(GLYPH_ROWS);
      }
      expect(dots.map((d) => d.col)).toEqual(m.onsets);
    }
  });

  it("a higher note sits higher, and a high voice sits high in the box", () => {
    const dots = glyphDots({ base: 60, degrees: [0, 3, 1], onsets: [0, 2, 5] });
    expect(dots[1].row).toBeLessThan(dots[2].row);
    expect(dots[2].row).toBeLessThan(dots[0].row);
    const low = glyphDots({ base: 50, degrees: [0, 1], onsets: [0, 4] });
    const high = glyphDots({ base: 74, degrees: [0, 1], onsets: [0, 4] });
    expect(high[0].row).toBeLessThan(low[0].row);
  });

  it("tells people apart better than the rhythm alone", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `x${i}`);
    const glyphs = new Set(ids.map((id) => JSON.stringify(glyphOf(id))));
    const rhythms = new Set(ids.map((id) => rhythmOf(id).join()));
    expect(glyphs.size).toBeGreaterThan(rhythms.size * 3);
  });

  it("a new word is neither one's own and stays the same for the same seed", () => {
    const own = JSON.stringify(glyphOf("bot1"));
    const other = JSON.stringify(glyphOf("bot7"));
    const word = JSON.stringify(newWordOf("bot1", "bot7", 12));
    expect(word).not.toBe(own);
    expect(word).not.toBe(other);
    expect(JSON.stringify(newWordOf("bot1", "bot7", 12))).toBe(word);
  });

  it("the number, the rhythm and the bar", () => {
    expect(individualNo("bot1")).toMatch(/^\d{4}$/);
    expect(individualNo("bot1")).toBe(individualNo("bot1"));
    expect(rhythmOf("bot1").filter(Boolean).length).toBe(makeMotif("bot1").onsets.length);
    expect(rhythmOf("bot1")[0]).toBe(true); // the first note is on the downbeat
    expect(stepAt(0)).toBe(0);
    expect(stepAt(250)).toBe(1);
    expect(stepAt(2000)).toBe(0);
  });
});
