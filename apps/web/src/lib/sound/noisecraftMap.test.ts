import { describe, expect, it } from "vitest";
import { CLOCK_KNOB, MIN_GATE_STEPS, NC_NOISE_MAP, PULSES_PER_BAR, STEPS_PER_BAR, knobParams, modeOf, notesToSteps, planToSequences } from "./noisecraftMap";
import { placeInBar, type BarPlan } from "./sequencer";
import type { PersonalSignals } from "./signals";

const sig = (over: Partial<PersonalSignals> = {}): PersonalSignals =>
  ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, building: null, grass: 0, ...over }) as PersonalSignals;

describe("the rhythm on the patch's grid (noisecraftMap)", () => {
  it("a bar is 16 steps and a gate is the note's length in steps", () => {
    const { pitches, gates } = notesToSteps([
      { at: 0, pitch: 60, len: 0.2 },
      { at: 0.5, pitch: 64, len: 0.1 },
      { at: 0.75, pitch: 67 },
    ]);
    expect(STEPS_PER_BAR).toBe(16);
    expect(pitches).toHaveLength(16);
    expect(gates[0]).toBeCloseTo(3.2);
    expect(gates[8]).toBeCloseTo(1.6);
    expect(gates[12]).toBe(1); // no length given: one step
    expect(gates.filter((g) => g > 0)).toHaveLength(3);
    expect(pitches.slice(0, 8).every((p) => p === 60)).toBe(true);
    expect(pitches.slice(8, 12).every((p) => p === 64)).toBe(true);
    expect(pitches[15]).toBe(67);
  });

  it("a very short note still opens the envelope", () => {
    expect(notesToSteps([{ at: 0, pitch: 60, len: 0.001 }]).gates[0]).toBe(MIN_GATE_STEPS);
  });

  it("a cell held twice in the bar (density 2) is compressed into each half, both halves distinct", () => {
    const cycle = [0, 2, 3].map((s) => ({ at: s / 8, len: 0.1, pitch: 60 + s, freq: 0, locked: false }));
    const { gates } = notesToSteps(placeInBar(cycle, 2, 0));
    expect(gates.map((g, i) => (g > 0 ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2, 3, 8, 10, 11]);
  });

  it("a plan becomes the receivers' sequences: parliament 4 voices, a half-bar pad, a walking bass", () => {
    const me = [{ at: 0, len: 0.4, pitch: 62, freq: 0, locked: false }];
    const plan = {
      me,
      others: [{ notes: [{ at: 0.25, len: 0.2, pitch: 69, freq: 0, locked: false }] }],
      bass: [{ at: 0, pitch: 50, level: 0.5 }],
      pad: { pitches: [50, 62, 65, 69], level: 0.3 },
      chord: { degree: 0, classes: [2, 5, 9, 0], rootClass: 2 },
      line: [{ at: 0.5, len: 0.1, pitch: 74, freq: 0, locked: false }],
      traces: [{ o: "v_me", steps: [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
    } as unknown as BarPlan;
    // the noisecraft instrument: the melody in parliament too
    const all = planToSequences(plan, "all");
    expect(all.parliament.pitches).toHaveLength(16);
    expect(all.parliament.pitches[0]).toEqual([62, 69, 0, 0]);
    expect(all.parliament.gates[0]).toEqual([6.4, 0, 0, 0]);
    expect(all.parliament.gates[4]).toEqual([0, 3.2, 0, 0]);
    expect(all.me.gates[0]).toBe(6.4);
    // the hybrid (default): parliament = the bass and the three upper chord voices, the melody modules silent
    const seq = planToSequences(plan);
    expect(seq.parliament.pitches[0]).toEqual([50, 65, 81, 60]); // the bass, then the chord's tones above the root
    expect(seq.parliament.gates[0]).toEqual([1.5, 16, 16, 16]); // gated: the pad is on (among people)
    const open = planToSequences({ ...plan, pad: { pitches: [], level: 0 }, bass: [] } as unknown as BarPlan);
    expect(open.parliament.pitches[0]).toEqual([0, 65, 81, 60]); // pitched for the patch's own triggers
    expect(open.parliament.gates[0]).toEqual([0, 0, 0, 0]);
    expect(seq.me.gates.every((g) => g === 0)).toBe(true);
    expect(seq.harmony.gates[0]).toEqual([16, 16, 16, 16]);
    expect(seq.harmony.gates[8]).toEqual([0, 0, 0, 0]);
    expect(seq.pad).toEqual(seq.harmony);
    expect(seq.texture.pitches[0].map((p) => p % 12)).toEqual([2, 5, 9, 0]);
    expect(seq.line.gates[8]).toBeCloseTo(1.6);
    expect(seq.traces.gates[0]).toEqual([1, 0, 0, 0]);
    expect(seq.traces.gates[4]).toEqual([1, 0, 0, 0]);
    expect(seq.bass.gates[0]).toBe(1.5);
    expect(seq.bass.pitches[0]).toBe(50);
  });

  it("the sequencer clock knob follows barSec: 96 pulses a bar", () => {
    const hz = (barSec: number) => knobParams(NC_NOISE_MAP, { sig: sig(), mode: "open", plan: null, master: 1, barSec }).find((p) => p.nodeId === CLOCK_KNOB.nodeId)!.value;
    expect(PULSES_PER_BAR).toBe(96);
    expect(hz(2)).toBeCloseTo(48);
    expect(hz(3)).toBeCloseTo(32);
    expect(hz(1.2)).toBeCloseTo(80);
  });

  it("the mode a walk implies", () => {
    expect(modeOf(sig())).toBe("open");
    expect(modeOf(sig({ pathP: 0.3 }))).toBe("path");
    expect(modeOf(sig({ stay: 0.6, neighbours: [{ o: "x", dist: 2 } as PersonalSignals["neighbours"][number]] }))).toBe("build");
    expect(modeOf(sig({ sealed: 0.5 }))).toBe("building");
  });
});
