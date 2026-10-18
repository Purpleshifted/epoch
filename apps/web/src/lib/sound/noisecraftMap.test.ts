import { describe, expect, it } from "vitest";
import { CLOCK_KNOB, MIN_GATE_STEPS, PULSES_PER_BAR, STEPS_PER_BAR, clockParams, modeOfPlan, notesToSteps, planToSequences } from "./noisecraftMap";
import type { BarPlan } from "./sequencer";

const chord = (root: number, classes: number[]) => ({ band: 0, degree: 0, classes, rootClass: root });
const plan = (over: Partial<BarPlan>): BarPlan =>
  ({ bar: 0, chord: chord(2, [2, 5, 9, 0]), lock: 0, density: 1, answer: false, me: [], others: [], bass: [], pad: { pitches: [], level: 0 }, ...over }) as BarPlan;

describe("the patch's grid (noisecraftMap)", () => {
  it("a bar is 16 steps and a gate is the note's length in steps", () => {
    const { pitches, gates } = notesToSteps([
      { at: 0, pitch: 60, len: 0.2 },
      { at: 0.5, pitch: 64, len: 0.1 },
      { at: 0.75, pitch: 67 },
    ]);
    expect(STEPS_PER_BAR).toBe(16);
    expect(gates[0]).toBeCloseTo(3.2);
    expect(gates[8]).toBeCloseTo(1.6);
    expect(gates[12]).toBe(1);
    expect(pitches.slice(0, 8).every((p) => p === 60)).toBe(true);
    expect(pitches[15]).toBe(67);
    expect(notesToSteps([{ at: 0, pitch: 60, len: 0.001 }]).gates[0]).toBe(MIN_GATE_STEPS);
  });

  it("the music clock as the patch receives it: 96 pulses a bar on the one clock knob, within its range", () => {
    const at = (sec: number) => clockParams(sec);
    expect(PULSES_PER_BAR).toBe(96);
    expect(at(2)).toHaveLength(1);
    expect(at(2)[0].nodeId).toBe(CLOCK_KNOB.nodeId);
    expect(at(2)[0].value).toBeCloseTo(48);
    expect(at(3)[0].value).toBeCloseTo(32);
    expect(at(1.84)[0].value).toBeCloseTo(52.17, 1);
    expect(at(10)[0].value).toBe(CLOCK_KNOB.min); // never below the knob's range: the patch would not load again
    expect(at(0.3)[0].value).toBe(CLOCK_KNOB.max);
  });
});

describe("what each voice receives (planToSequences)", () => {
  it("in the open: the root breathes every other bar, the colour and the fifth are pitch only, the chorale is silent", () => {
    const even = planToSequences(plan({ bar: 2 }));
    expect(modeOfPlan(plan({}))).toBe("open");
    expect(even.parliament.pitches[0]).toEqual([38, 65, 69, 60]); // D2 root, F4 colour, A4 fifth, C4 fourth
    expect(even.parliament.gates[0]).toEqual([8, 16, 0, 0]); // the first bar: the colour swells (a "change" from nothing)
    const odd = planToSequences(plan({ bar: 3 }), plan({ bar: 2 }));
    expect(odd.parliament.gates[0]).toEqual([0, 0, 0, 0]);
    expect(odd.harmony.gates[0]).toEqual([0, 0, 0, 0]);
    expect(odd.harmony.pitches[0]).toEqual([50, 53, 57, 48]); // pitched anyway
    expect(odd.line.gates.every((g) => g === 0)).toBe(true);
  });

  it("on a path: the root walks with the plan's bass; the colour swells only when the chord changes", () => {
    const walk = plan({ bar: 4, bass: [{ at: 0, pitch: 38, level: 0.8 }, { at: 0.5, pitch: 38, level: 0.5 }] });
    const same = planToSequences(walk, plan({ bar: 3 }));
    expect(modeOfPlan(walk)).toBe("path");
    expect(same.parliament.gates[0]).toEqual([1.5, 0, 0, 0]);
    expect(same.parliament.gates[8][0]).toBe(1.5);
    expect(same.bass.gates[8]).toBe(1.5);
    const changed = planToSequences({ ...walk, chord: chord(7, [7, 11, 2, 5]), bass: walk.bass.map((b) => ({ ...b, pitch: 43 })) }, plan({ bar: 3 }));
    expect(changed.parliament.pitches[0]).toEqual([43, 71, 62, 65]);
    expect(changed.parliament.gates[0][1]).toBe(16);
  });

  it("building together: the root and the colour hold the bar, the chorale takes the pad's upper four tones", () => {
    const build = plan({ bar: 5, pad: { pitches: [38, 50, 53, 57, 60], level: 0.9 } });
    const q = planToSequences(build, build);
    expect(modeOfPlan(build)).toBe("build");
    expect(q.parliament.gates[0]).toEqual([16, 16, 0, 0]);
    expect(q.harmony.pitches[0]).toEqual([50, 53, 57, 60]);
    expect(q.harmony.gates[0]).toEqual([16, 16, 16, 16]);
    expect(q.harmony.gates[8]).toEqual([0, 0, 0, 0]);
  });

  it("the rhythm rows: my onsets, then the neighbours'", () => {
    const n = (at: number) => ({ at, len: 0.1, pitch: 60, freq: 0, locked: false });
    const q = planToSequences(plan({ me: [n(0), n(0.5)], others: [{ o: "b", notes: [n(0.25)] }] }));
    expect(q.traces.gates[0]).toEqual([1, 0, 0, 0]);
    expect(q.traces.gates[4]).toEqual([0, 1, 0, 0]);
    expect(q.traces.gates[8]).toEqual([1, 0, 0, 0]);
  });
});
