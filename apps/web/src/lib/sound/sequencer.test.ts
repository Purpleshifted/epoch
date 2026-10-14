import { describe, expect, it } from "vitest";
import { worldKey } from "./harmony";
import { makeMotif, realize } from "./motif";
import { DEFAULT_SEQUENCER, barClock, density, lockOf, placeInBar, planBar, type BarInputs } from "./sequencer";
import type { PersonalSignals } from "./signals";

const KEY = worldKey("epoch-t");
const ME = makeMotif("v_me");
const OTHERS = new Map([["bot1", makeMotif("bot1")], ["v_b", makeMotif("v_b")]]);
const sig = (over: Partial<PersonalSignals> = {}): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, grass: 0.5, ...over });
const near = (o: string, dist = 2) => ({ o, dist, angle: 0, bot: o.startsWith("bot") });
const inputs = (bar: number, s: PersonalSignals, over: Partial<BarInputs> = {}): BarInputs => ({ bar, sig: s, key: KEY, me: ME, others: OTHERS, closeness: new Map(), phrase: null, ...over });

describe("sequencer: one grid for everybody, bars planned from the signals", () => {
  it("density: still = every other bar, walking = every bar, running = twice a bar", () => {
    expect(density(0, 7)).toBe(0.5);
    expect(density(3, 7)).toBe(1);
    expect(density(7, 7)).toBe(2);
    const notes = realize(ME, KEY, null, 0, 0);
    expect(placeInBar(notes, 0.5, 1)).toEqual([]);
    expect(placeInBar(notes, 0.5, 2).length).toBe(notes.length);
    expect(placeInBar(notes, 2, 0).length).toBe(notes.length * 2);
    expect(placeInBar(notes, 2, 0)[notes.length].at).toBeCloseTo(0.5);
  });

  it("lock: a path or staying among others", () => {
    expect(lockOf({ pathP: 0.7, stay: 0, neighbours: [] })).toBeCloseTo(0.7);
    expect(lockOf({ pathP: 0, stay: 1, neighbours: [near("bot1")] })).toBeCloseTo(0.5);
    expect(lockOf({ pathP: 0, stay: 1, neighbours: [near("bot1"), near("v_b")] })).toBeCloseTo(1);
    expect(lockOf({ pathP: 0, stay: 1, neighbours: [] })).toBe(0);
  });

  it("alone on open ground: my motif free, no bass, no pad, nobody else", () => {
    const plan = planBar(inputs(2, sig({ speed: 3 })));
    expect(plan.me.length).toBe(ME.degrees.length);
    expect(plan.me.every((n) => !n.locked)).toBe(true);
    expect(plan.bass).toEqual([]);
    expect(plan.pad.level).toBe(0);
    expect(plan.others).toEqual([]);
    expect(plan.answer).toBe(false);
  });

  it("on a path: bass pulse on the downbeat with the chord root, notes locked", () => {
    const plan = planBar(inputs(2, sig({ speed: 3, pathP: 1 })));
    expect(plan.bass.length).toBe(1);
    expect(plan.bass[0].at).toBe(0);
    expect(plan.bass[0].pitch % 12).toBe(plan.chord.rootClass);
    expect(plan.me.every((n) => n.locked)).toBe(true);
    for (const n of plan.me) expect(plan.chord.classes).toContain(((n.pitch % 12) + 12) % 12);
    const running = planBar(inputs(2, sig({ speed: 7, pathP: 1 })));
    expect(running.bass.length).toBe(2);
    const weak = planBar(inputs(2, sig({ speed: 3, pathP: DEFAULT_SEQUENCER.bassFrom - 0.05 })));
    expect(weak.bass).toEqual([]);
  });

  it("walking among others: everybody plays on the grid, no call and response", () => {
    const s = sig({ speed: 3, neighbours: [near("bot1"), near("v_b", 5)] });
    for (const bar of [0, 1]) {
      const plan = planBar(inputs(bar, s));
      expect(plan.answer).toBe(false);
      expect(plan.me.length).toBeGreaterThan(0);
      expect(plan.others.map((v) => v.o)).toEqual(["bot1", "v_b"]);
    }
  });

  it("staying among others: bars alternate (mine / the nearest answers), the chord is held, the others lock", () => {
    const s = sig({ stay: 1, neighbours: [near("bot1"), near("v_b", 5)] });
    const even = planBar(inputs(4, s));
    expect(even.answer).toBe(false);
    expect(even.me.length).toBeGreaterThan(0);
    expect(even.others.map((v) => v.o)).toEqual(["bot1"]); // the nearest plays along
    const odd = planBar(inputs(5, s));
    expect(odd.answer).toBe(true);
    expect(odd.me).toEqual([]);
    expect(odd.others.map((v) => v.o)).toEqual(["bot1"]);
    expect(odd.others[0].notes.every((n) => n.locked)).toBe(true);
    expect(even.pad.level).toBeCloseTo(1);
    expect(even.pad.pitches.length).toBe(1 + even.chord.classes.length);
    expect(even.pad.pitches[0] % 12).toBe(even.chord.rootClass);
  });

  it("closeness blends the nearest neighbour's motif into mine", () => {
    const s = sig({ speed: 3, neighbours: [near("v_b")] });
    const plain = planBar(inputs(6, s)).me.map((n) => n.pitch).join();
    const blended = planBar(inputs(6, s, { closeness: new Map([["v_b", 1]]) })).me.map((n) => n.pitch).join();
    expect(blended).not.toBe(plain);
  });

  it("a phrase takes my bars for 4 bars from its start, then my motif returns", () => {
    const phrase = new Array(32).fill(0);
    phrase[0] = 60; phrase[8] = 62; phrase[16] = 64; phrase[24] = 65;
    const s = sig({ speed: 3 });
    const inBar = planBar(inputs(10, s, { phrase: { phrase, from: 10 } }));
    expect(inBar.me.map((n) => n.pitch)).toEqual([60]);
    const third = planBar(inputs(12, s, { phrase: { phrase, from: 10 } }));
    expect(third.me.map((n) => n.pitch)).toEqual([64]);
    const after = planBar(inputs(14, s, { phrase: { phrase, from: 10 } }));
    expect(after.me.length).toBe(ME.degrees.length);
  });

  it("barClock counts bars from the epoch on the wall clock", () => {
    const { bar, start } = barClock(1000, 1000 + 2500, 10, 2);
    expect(bar).toBe(1);
    expect(start).toBeCloseTo(10 - 0.5);
  });
});
