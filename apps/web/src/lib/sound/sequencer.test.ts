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

describe("v4 A2 (the artist): the motif half as often, the micro-tones turned down", () => {
  it("my motif comes every `motifEvery` bars; the others keep theirs", async () => {
    const { planBar } = await import("./sequencer");
    const { makeMotif } = await import("./motif");
    const { worldKey } = await import("./harmony");
    const key = worldKey("t");
    const me = makeMotif("v_me");
    const others = new Map([["b", makeMotif("b")]]);
    const sig = { x: 0, z: 0, speed: 2, stay: 0, neighbours: [{ o: "b", dist: 3, angle: 0, bot: true }], pathP: 0, sealed: 0, grass: 0 };
    const at = (bar: number, every: number) => planBar({ bar, sig, key, me, others, closeness: new Map(), phrase: null, params: { barSec: 2, speedMax: 7, bassFrom: 0.25, motifEvery: every } });
    const rate = (every: number) => [...Array(400).keys()].filter((b) => at(b, every).me.length > 0).length / 400;
    expect(rate(1)).toBe(1);
    expect(rate(2)).toBeGreaterThan(0.4);
    expect(rate(2)).toBeLessThan(0.6);
    expect(rate(1.5)).toBeGreaterThan(0.57);
    expect(rate(1.5)).toBeLessThan(0.77);
    expect(rate(4)).toBeGreaterThan(0.17);
    expect(rate(4)).toBeLessThan(0.33);
    expect(at(1, 2).me.length).toBe(at(1, 2).me.length); // the same bar, the same answer
    expect([...Array(50).keys()].some((b) => at(b, 2).others[0].notes.length > 0)).toBe(true);
  });

  it("microtone 0 puts every note exactly on its MIDI pitch", async () => {
    const { realize, makeMotif, midiToHz, DEFAULT_MOTIF } = await import("./motif");
    const { worldKey } = await import("./harmony");
    const key = worldKey("t");
    const m = makeMotif("v_x");
    for (const n of realize(m, key, null, 0, 3, { ...DEFAULT_MOTIF, microtone: 0 })) expect(n.freq).toBeCloseTo(midiToHz(n.pitch), 6);
    const coloured = realize(m, key, null, 0, 3, { ...DEFAULT_MOTIF, microtone: 1 });
    expect(coloured.some((n) => Math.abs(n.freq - midiToHz(n.pitch)) > 0.01)).toBe(true);
  });
});

describe("octave shifts of my motif (the artist: not always one register)", () => {
  it("shifts one bar in `motifOctaveEvery` by a whole octave (or two), never otherwise", async () => {
    const { planBar } = await import("./sequencer");
    const { makeMotif } = await import("./motif");
    const { worldKey } = await import("./harmony");
    const key = worldKey("t");
    const me = makeMotif("v_oct");
    const sig = { x: 0, z: 0, speed: 2, stay: 0, neighbours: [], pathP: 0, sealed: 0, grass: 0 };
    const plain = (bar: number) => planBar({ bar, sig, key, me, others: new Map(), closeness: new Map(), phrase: null, params: { barSec: 2, speedMax: 7, bassFrom: 0.25, motifEvery: 1 } });
    const shifted = (bar: number, every: number, range: number) => planBar({ bar, sig, key, me, others: new Map(), closeness: new Map(), phrase: null, params: { barSec: 2, speedMax: 7, bassFrom: 0.25, motifEvery: 1, motifOctaveEvery: every, motifOctaveRange: range } });
    let moved = 0;
    const offsets = new Set<number>();
    for (let b = 0; b < 300; b++) {
      const a = plain(b).me, s = shifted(b, 3, 2).me;
      const off = s[0].pitch - a[0].pitch;
      if (off !== 0) {
        moved++;
        offsets.add(off);
        expect(s.every((n, i) => n.pitch - a[i].pitch === off)).toBe(true); // the whole bar together
        expect(Math.abs(off) % 12).toBe(0);
        expect(s[0].freq / a[0].freq).toBeCloseTo(Math.pow(2, off / 12), 6);
      }
    }
    expect(moved / 300).toBeGreaterThan(0.22);
    expect(moved / 300).toBeLessThan(0.45);
    expect([...offsets].some((o) => Math.abs(o) === 24)).toBe(true);
    expect(shifted(5, 0, 1).me.map((n) => n.pitch)).toEqual(plain(5).me.map((n) => n.pitch));
  });
});

describe("a building's place in the plan (v4 A4)", () => {
  it("inside a zone the plan takes the building's key and chord; the motif re-sits in that scale; outside, the bands", async () => {
    const { planBar } = await import("./sequencer");
    const { makeMotif } = await import("./motif");
    const { worldKey, scaleClasses, placeChord } = await import("./harmony");
    const { bestKey, zoneChord } = await import("./tonality");
    const world = worldKey("t");
    const me = makeMotif("v_zone");
    const who = [{ o: "bot1", amount: 12 }, { o: "bot2", amount: 9 }];
    const bkey = bestKey(who)!;
    const sig = { x: 4, z: 4, speed: 0, stay: 1, neighbours: [{ o: "bot1", dist: 2, angle: 0, bot: true }, { o: "bot2", dist: 3, angle: 1, bot: true }], pathP: 0, sealed: 1, grass: 0 };
    const inside = planBar({ bar: 2, sig, key: world, me, others: new Map(), closeness: new Map(), phrase: null, place: { key: bkey, chord: zoneChord(bkey, "in"), zone: "in" } });
    const ring = planBar({ bar: 2, sig, key: world, me, others: new Map(), closeness: new Map(), phrase: null, place: { key: bkey, chord: zoneChord(bkey, "ring"), zone: "ring" } });
    const open = planBar({ bar: 2, sig, key: world, me, others: new Map(), closeness: new Map(), phrase: null, place: null });
    expect(inside.chord.rootClass).toBe(bkey.root);
    expect(ring.chord.rootClass).toBe((bkey.root + bkey.mode.intervals[4]) % 12);
    expect(open.chord).toEqual(placeChord(world, 4, 4));
    const scale = new Set(scaleClasses(bkey));
    expect(inside.me.every((n) => scale.has(((n.pitch % 12) + 12) % 12))).toBe(true); // every note of mine in the building's scale
    expect(inside.pad.pitches.slice(1).every((p) => inside.chord.classes.includes(((p % 12) + 12) % 12))).toBe(true);
  });
});

describe("the arrival cadence (v4 A4b)", () => {
  it("begins on the edge of building together (or a birth while together), once, with a breath between", async () => {
    const { ARRIVAL_IDLE, nextArrival } = await import("./sequencer");
    let s = ARRIVAL_IDLE;
    let r = nextArrival(s, 10, false, false); s = r.state; expect(r.phase).toBeNull();
    r = nextArrival(s, 11, true, false); s = r.state; expect(r.phase).toBe("dominant");
    r = nextArrival(s, 12, true, false); s = r.state; expect(r.phase).toBe("tonic");
    r = nextArrival(s, 13, true, false); s = r.state; expect(r.phase).toBeNull();
    r = nextArrival(s, 14, true, true); s = r.state; expect(r.phase).toBeNull(); // a birth, but within the cooldown
    r = nextArrival(s, 20, true, true); s = r.state; expect(r.phase).toBe("dominant"); // a birth while together, after the breath
    r = nextArrival(s, 21, true, false); s = r.state; expect(r.phase).toBe("tonic");
    r = nextArrival(s, 30, false, false); s = r.state; expect(r.phase).toBeNull();
    r = nextArrival(s, 31, false, true); s = r.state; expect(r.phase).toBeNull(); // a birth alone: no cadence
  });

  it("the dominant bar leans (V7, the pad up), the tonic bar arrives (the place's chord, pad full, lock 1, my motif lifted, a downbeat)", async () => {
    const { planBar, dominantOf } = await import("./sequencer");
    const { makeMotif } = await import("./motif");
    const { worldKey, placeChord } = await import("./harmony");
    const key = worldKey("t");
    const me = makeMotif("v_arr");
    const sig = { x: 3, z: 3, speed: 0, stay: 1, neighbours: [{ o: "b", dist: 2, angle: 0, bot: true }], pathP: 0, sealed: 0, grass: 0 };
    const base = { sig, key, me, others: new Map(), closeness: new Map(), phrase: null as null, params: { barSec: 2, speedMax: 7, bassFrom: 0.25, motifEvery: 100 } };
    const plain = planBar({ ...base, bar: 4 });
    const dom = planBar({ ...base, bar: 4, arrival: "dominant" });
    const ton = planBar({ ...base, bar: 6, arrival: "tonic" });
    const placeC = placeChord(key, 3, 3, { modes: [2, 3, 4, 5], bands: 16, bandCells: 12, chordSize: 4 });
    expect(plain.chord).toEqual(placeC);
    expect(dom.chord).toEqual(dominantOf(key, placeC));
    expect(dom.chord.degree).toBe(4);
    expect(dom.pad.level).toBeGreaterThanOrEqual(0.7);
    expect(ton.chord).toEqual(placeC);
    expect(ton.pad.level).toBe(1);
    expect(ton.lock).toBe(1);
    expect(ton.me.length).toBeGreaterThan(0); // forced in spite of motifEvery 100
    expect(ton.bass[0]).toEqual({ at: 0, pitch: 36 + placeC.rootClass, level: 1 });
    expect(ton.arrival).toBe("tonic");
    const wide = planBar({ ...base, bar: 4, params: { ...base.params, bandCells: 4 } });
    expect(wide.chord).toEqual(placeChord(key, 3, 3, { modes: [2, 3, 4, 5], bands: 16, bandCells: 4, chordSize: 4 }));
  });
});
