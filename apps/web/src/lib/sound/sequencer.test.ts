import { describe, expect, it } from "vitest";
import { homeKey } from "./harmony";
import { makeMotif, realize } from "./motif";
import { DEFAULT_SEQUENCER, barClock, conformity, density, lockOf, placeInBar, planBar, roughness, type BarInputs } from "./sequencer";
import type { PersonalSignals } from "./signals";

const KEY = homeKey("v_me");
const ME = makeMotif("v_me");
const OTHERS = new Map([["bot1", makeMotif("bot1")], ["v_b", makeMotif("v_b")]]);
const sig = (over: Partial<PersonalSignals> = {}): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, building: null, grass: 0.5, ...over });
const near = (o: string, dist = 2) => ({ o, dist, angle: 0, bot: o.startsWith("bot") });
const inputs = (bar: number, s: PersonalSignals, over: Partial<BarInputs> = {}): BarInputs => ({ bar, sig: s, key: KEY, building: null, degree: 0, me: ME, others: OTHERS, closeness: new Map(), phrase: null, ...over });

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

  it("conformity: a path, concrete or staying among others; lock = conformity × lockPull (small by default)", () => {
    expect(conformity({ pathP: 0.7, stay: 0, neighbours: [], sealed: 0 })).toBeCloseTo(0.7);
    expect(conformity({ pathP: 0, stay: 1, neighbours: [near("bot1")], sealed: 0 })).toBeCloseTo(0.5);
    expect(conformity({ pathP: 0, stay: 1, neighbours: [near("bot1"), near("v_b")], sealed: 0 })).toBeCloseTo(1);
    expect(conformity({ pathP: 0, stay: 1, neighbours: [], sealed: 0 })).toBe(0);
    expect(conformity({ pathP: 0, stay: 0, neighbours: [], sealed: 1 })).toBeCloseTo(0.7);
    expect(lockOf({ pathP: 1, stay: 0, neighbours: [], sealed: 0 })).toBeCloseTo(DEFAULT_SEQUENCER.lockPull);
    expect(lockOf({ pathP: 1, stay: 0, neighbours: [], sealed: 0 }, 0)).toBe(0);
  });

  it("roughness: crossing vegetation while moving is the roughest; a path, concrete or building together is smooth", () => {
    const crossing = roughness({ pathP: 0, stay: 0, neighbours: [], sealed: 0, grass: 1, speed: 5 }, 7);
    const standingInGrass = roughness({ pathP: 0, stay: 1, neighbours: [], sealed: 0, grass: 1, speed: 0 }, 7);
    const onPath = roughness({ pathP: 1, stay: 0, neighbours: [], sealed: 0, grass: 0.2, speed: 5 }, 7);
    const building = roughness({ pathP: 0, stay: 1, neighbours: [near("bot1"), near("v_b")], sealed: 0, grass: 1, speed: 0 }, 7);
    expect(crossing).toBeCloseTo(1);
    expect(standingInGrass).toBeLessThan(crossing);
    expect(standingInGrass).toBeGreaterThan(0);
    expect(onPath).toBe(0);
    expect(building).toBe(0);
  });

  it("alone on open ground: my motif free, no bass, no pad, nobody else", () => {
    const plan = planBar(inputs(2, sig({ speed: 3 })));
    expect(plan.me.length).toBe(ME.degrees.length);
    expect(plan.me.every((n) => !n.locked)).toBe(true);
    expect(plan.stable).toBe(0);
    expect(plan.rough).toBeGreaterThan(0.3);
    expect(plan.bass).toEqual([]);
    expect(plan.pad.level).toBe(0);
    expect(plan.others).toEqual([]);
    expect(plan.answer).toBe(false);
  });

  it("on a path: bass pulse on the downbeat with the chord root, the motif kept (only a small pull), smooth", () => {
    const plan = planBar(inputs(2, sig({ speed: 3, pathP: 1 })));
    expect(plan.bass.length).toBe(1);
    expect(plan.bass[0].at).toBe(0);
    expect(plan.bass[0].pitch % 12).toBe(plan.chord.rootClass);
    expect(plan.stable).toBeCloseTo(1);
    expect(plan.rough).toBe(0);
    expect(plan.lock).toBeCloseTo(DEFAULT_SEQUENCER.lockPull);
    // identity first: with lockPull 1 every note would be a chord tone; by default most notes stay the motif's own
    const pulled = planBar(inputs(2, sig({ speed: 3, pathP: 1 }), { params: { ...DEFAULT_SEQUENCER, lockPull: 1 } }));
    expect(pulled.me.every((n) => n.locked)).toBe(true);
    for (const n of pulled.me) expect(pulled.chord.classes).toContain(((n.pitch % 12) + 12) % 12);
    const untouched = planBar(inputs(2, sig({ speed: 3, pathP: 1 }), { params: { ...DEFAULT_SEQUENCER, lockPull: 0 } }));
    expect(untouched.me.every((n) => !n.locked)).toBe(true);
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
    expect(odd.rough).toBe(0);
    expect(even.pad.level).toBeCloseTo(1);
    expect(even.pad.pitches.length).toBe(1 + even.chord.classes.length);
    expect(even.pad.pitches[0] % 12).toBe(even.chord.rootClass);
  });

  it("the others are heard through my key (their contour, my scale); at a building, the building's key for all", () => {
    const s = sig({ speed: 3, neighbours: [near("v_b")] });
    const open = planBar(inputs(6, s));
    for (const n of open.others[0].notes) expect(KEY.mode.intervals).toContain((((n.pitch - KEY.root) % 12) + 12) % 12);
    const theirs = OTHERS.get("v_b")!;
    expect(open.others[0].notes.length).toBe(theirs.degrees.length);
    open.others[0].notes.forEach((n, i) => expect(n.at).toBeCloseTo(theirs.onsets[i] / theirs.steps));
    const bKey = { root: 1, mode: KEY.mode };
    const atB = planBar(inputs(6, s, { key: bKey, building: "3,4" }));
    for (const n of [...atB.me, ...atB.others[0].notes]) expect(bKey.mode.intervals).toContain((((n.pitch - 1) % 12) + 12) % 12);
    expect(atB.chord.rootClass).toBe(1);
  });

  it("the degree moves the chord of the place: bass root and pad follow it", () => {
    const s = sig({ speed: 3, pathP: 1 });
    const tonic = planBar(inputs(2, s));
    const fourth = planBar(inputs(2, s, { degree: 3 }));
    expect(fourth.chord.rootClass).not.toBe(tonic.chord.rootClass);
    expect(fourth.bass[0].pitch % 12).toBe(fourth.chord.rootClass);
    expect(fourth.bass[0].pitch).toBeGreaterThanOrEqual(48);
    expect(fourth.bass[0].pitch).toBeLessThan(60);
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
