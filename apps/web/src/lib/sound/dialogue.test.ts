import { describe, expect, it } from "vitest";
import { apartShift, bassUnder, callsOn, endClosed, endOpen, interlock, landWith, octaveToward, placeApart, rotate, shiftNotes } from "./dialogue";
import { worldKey } from "./harmony";
import { makeMotif, midiToHz, realize, type MotifNote } from "./motif";

const note = (step: number, pitch: number, steps = 8): MotifNote => ({ at: step / steps, len: 0.1, pitch, freq: midiToHz(pitch), locked: true });
const pc = (p: number) => ((p % 12) + 12) % 12;
const mean = (ns: MotifNote[]) => ns.reduce((s, n) => s + n.pitch, 0) / ns.length;

describe("dialogue: asking and answering as counterpoint (sound-logic §13d)", () => {
  it("two lines closer than an octave are set an octave apart, away from mine, inside the range", () => {
    const mine = [note(0, 60), note(3, 64), note(5, 62)];
    const above = [note(0, 65), note(2, 67)];
    expect(apartShift(mine, above)).toBe(12);
    const below = [note(0, 57), note(4, 55)];
    expect(apartShift(mine, below)).toBe(-12);
    // already apart: left where it is
    expect(apartShift(mine, [note(0, 76), note(2, 79)])).toBe(0);
    // my register knob counts: mine heard an octave up makes theirs (just above my notes) move down
    expect(apartShift(mine, above, 12)).toBe(-12);
    // no room above, and one octave down is still too close: two octaves down
    expect(apartShift([note(0, 84)], [note(0, 86), note(1, 88)])).toBe(-24);
  });

  it("shifting keeps each note's colour (its ratio to the pure pitch)", () => {
    const n = { ...note(0, 60), freq: midiToHz(60, 7) };
    const [m] = shiftNotes([n], 12);
    expect(m.pitch).toBe(72);
    expect(m.freq / midiToHz(72)).toBeCloseTo(n.freq / midiToHz(60), 9);
  });

  it("a question ends open — on the key's 2nd or 5th, above the note before it; an answer closes on the tonic, at or below it", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const key = worldKey(seed);
      const line = realize(makeMotif(`v_${seed}`), key, null, 1, 0);
      const q = endOpen(line, key);
      const last = q[q.length - 1];
      const before = q[q.length - 2];
      expect(last.pitch).toBeGreaterThan(before.pitch);
      expect([pc(key.root + key.mode.intervals[1]), pc(key.root + key.mode.intervals[4])]).toContain(pc(last.pitch));
      expect(last.pitch - before.pitch).toBeLessThanOrEqual(12);
      const a = endClosed(line, key);
      const end = a[a.length - 1];
      expect(pc(end.pitch)).toBe(pc(key.root));
      expect(end.pitch).toBeLessThanOrEqual(a[a.length - 2].pitch);
      expect(a[a.length - 2].pitch - end.pitch).toBeLessThan(12);
      // only the last note moves
      expect(q.slice(0, -1)).toEqual(line.slice(0, -1));
    }
  });

  it("interlock: their notes step aside from mine, in order, never two on one step; more onsets together than either alone", () => {
    const mine = [note(0, 60), note(2, 62), note(5, 64)];
    const theirs = [note(0, 72), note(2, 74), note(3, 76), note(6, 79)];
    const meshed = interlock(mine, theirs);
    const steps = meshed.map((n) => Math.round(n.at * 8));
    expect(steps).toEqual([1, 3, 4, 6]);
    for (const s of steps) expect([0, 2, 5]).not.toContain(s);
    expect(new Set([...steps, 0, 2, 5]).size).toBe(7);
    // pitches and order kept; each held to its own next onset
    expect(meshed.map((n) => n.pitch)).toEqual([72, 74, 76, 79]);
    expect(meshed[0].len).toBeCloseTo((2 / 8) * 0.85, 9);
    expect(meshed[3].len).toBeCloseTo((2 / 8) * 0.85, 9);
  });

  it("interlock drops what finds no free step before the bar's end", () => {
    const mine = [note(0, 60), note(5, 62), note(6, 64), note(7, 65)];
    const theirs = [note(0, 72), note(4, 74), note(5, 76)];
    const meshed = interlock(mine, theirs);
    expect(meshed.map((n) => Math.round(n.at * 8))).toEqual([1, 4]);
  });

  it("the new word's octave goes to the partner's side, and stays in range", () => {
    const word = [note(0, 62), note(3, 65)];
    expect(octaveToward(word, 80)).toBe(12);
    expect(octaveToward(word, 40)).toBe(-12);
    expect(octaveToward([note(0, 80), note(1, 86)], 99)).toBe(-12);
    expect(mean(shiftNotes(word, octaveToward(word, 80)))).toBeGreaterThan(mean(word));
  });

  it("a question's bars: call, empty, call, empty", () => {
    expect([0, 1, 2, 3].map(callsOn)).toEqual([true, false, true, false]);
  });
});

describe("the ensemble: several lines, each its own place (sound-logic §13e)", () => {
  it("rotate: a canon's entry half a bar late, the tail wrapped to the head, held to the next onset", () => {
    const l = [note(0, 60), note(2, 62), note(5, 64)];
    const r = rotate(l);
    expect(r.map((n) => Math.round(n.at * 8))).toEqual([1, 4, 6]);
    expect(r.map((n) => n.pitch)).toEqual([64, 60, 62]);
    expect(r[2].len).toBeCloseTo((2 / 8) * 0.85, 9);
  });

  it("placeApart: a new line goes where no placed line is within the gap", () => {
    const me = [note(0, 60), note(4, 62)];
    const theirs = [note(0, 62), note(3, 64)];
    expect(placeApart([me], theirs)).toBe(12);
    const above = shiftNotes(theirs, 12);
    // a third line: neither near me nor near the one above
    expect(placeApart([me, above], [note(0, 61), note(2, 63)])).toBe(-12);
    // already apart: stays
    expect(placeApart([me], [note(0, 74), note(1, 76)])).toBe(0);
  });

  it("bassUnder: two notes on the downbeat and the half bar, under every placed note", () => {
    const lines = [[note(0, 60), note(4, 64)], [note(1, 72)]];
    const b = bassUnder(lines, [note(0, 62), note(3, 65)]);
    expect(b.map((n) => n.at)).toEqual([0, 0.5]);
    for (const n of b) expect(n.pitch).toBeLessThanOrEqual(60 - 7);
    expect(b.map((n) => n.pitch)).toEqual([50, 53]);
    // never below the floor of the range
    expect(Math.min(...bassUnder([[note(0, 40)]], [note(0, 50)], 36).map((n) => n.pitch))).toBeGreaterThanOrEqual(36);
  });

  it("landWith: the first note lands on the downbeat with everyone's, the rest meshed around the others", () => {
    const placed = [note(0, 60), note(2, 62)];
    const l = landWith(placed, [note(1, 72), note(2, 74), note(5, 76)]);
    expect(l.map((n) => Math.round(n.at * 8))).toEqual([0, 3, 5]);
  });
});
