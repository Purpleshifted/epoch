import { describe, expect, it } from "vitest";
import { homeKey, intervalClass, keyChord, scaleClasses } from "./harmony";
import { nextHarmony, type HarmonyState } from "./harmonyState";
import { anchorBase, makeMotif, realize, realizeIn } from "./motif";
import { DEFAULT_SEQUENCER, planBar, type BarInputs } from "./sequencer";
import type { PersonalSignals } from "./signals";

const ME = makeMotif("v_me");
const KEY = homeKey("v_me");
const sig = (over: Partial<PersonalSignals> = {}): PersonalSignals => ({ x: 0, z: 0, speed: 3, stay: 0, neighbours: [], pathP: 0, sealed: 0, building: null, grass: 0.3, ...over });
const H = (over: Partial<HarmonyState> = {}): HarmonyState => ({ ...nextHarmony(null, { bar: 0, myId: "v_me", sig: sig(), place: { at: null, approach: null, degree: 0, cadence: "none", onPath: false }, closeness: new Map(), rough: 0, cadence: "none" }), ...over });
const inputs = (over: Partial<BarInputs> = {}): BarInputs => ({ bar: 2, sig: sig(), key: KEY, building: null, degree: 0, me: ME, others: new Map(), closeness: new Map(), phrase: null, harmony: H(), params: { ...DEFAULT_SEQUENCER, lockPull: 0.7 }, ...over });
const dirs = (ps: number[]) => ps.slice(1).map((p, i) => Math.sign(p - ps[i]));
const kinds = (ps: number[]) => ps.slice(1).map((p, i) => intervalClass(p - ps[i]));

describe("melody M: what moves with the harmony, what never moves", () => {
  it("anchoring: on a conforming walk the first note is a chord tone near where the last bar ended, within a fourth of the register", () => {
    const chord = keyChord(KEY, 3);
    const base = anchorBase(ME, KEY, chord, 70);
    expect(Math.abs(base - ME.base)).toBeLessThanOrEqual(5);
    const notes = realizeIn(ME, KEY, chord, 0.7, 2, 0, { anchor: 70 });
    expect(chord.classes).toContain(notes[0].pitch % 12);
    // free (lock 0): the register itself, no anchoring
    const free = realizeIn(ME, KEY, chord, 0, 2, 0.5, { anchor: 70 });
    expect(free[0].pitch).toBe(realize(ME, KEY, null, 0, 2)[0].pitch);
  });

  it("identity: over any key and chord the directions are kept and ≥ 80 % of the interval classes; the cell is the cell", () => {
    const plain = realize(ME, KEY, null, 0, 0).map((n) => n.pitch);
    for (let root = 0; root < 12; root += 3) {
      for (let deg = 0; deg < 7; deg += 2) {
        const key = { root, mode: KEY.mode };
        const chord = keyChord(key, deg);
        const notes = realizeIn(ME, key, chord, 0.7, 5, 0, { anchor: 66, chromaticBudget: 1 });
        const ps = notes.map((n) => n.pitch);
        expect(dirs(ps)).toEqual(dirs(plain));
        const same = kinds(ps).filter((k, i) => k === kinds(plain)[i]).length;
        expect(same / kinds(plain).length).toBeGreaterThanOrEqual(0.8);
        notes.forEach((n, i) => expect(n.at).toBeCloseTo(ME.onsets[i] / ME.steps));
      }
    }
  });

  it("passing tones fill leaps only when asked, between the two notes, on the scale", () => {
    const leaper = makeMotif("v_leaper");
    const ids = ["v_leaper", "v_a", "v_b", "v_c", "v_d", "v_e"];
    const m = ids.map((id) => makeMotif(id)).find((x) => x.semis.some((s, i) => i > 0 && Math.abs(s - x.semis[i - 1]) >= 5)) ?? leaper;
    const plain = realizeIn(m, KEY, keyChord(KEY, 0), 0.7, 1, 0, {});
    const filled = realizeIn(m, KEY, keyChord(KEY, 0), 0.7, 1, 0, { passing: true });
    expect(filled.length).toBeGreaterThanOrEqual(plain.length);
    const scale = scaleClasses(KEY);
    for (const n of filled) if (!plain.some((q) => q.at === n.at)) expect(scale).toContain(n.pitch % 12);
  });

  it("a full cadence lands the last note on the tonic or the third", () => {
    const notes = realizeIn(ME, KEY, keyChord(KEY, 0), 0.7, 3, 0, { cadence: "full" });
    const last = notes[notes.length - 1].pitch % 12;
    expect([KEY.root, (KEY.root + KEY.mode.intervals[2]) % 12]).toContain(last);
  });

  it("planBar with a harmony state: its key and chord, the voicing as the pad, the bass held among people", () => {
    const h = H({ source: "building", placeId: "b", builders: ["v_x"] });
    const plan = planBar(inputs({ sig: sig({ speed: 0, stay: 1 }), harmony: h }));
    expect(plan.chord).toEqual(h.chord);
    expect(plan.pad.pitches).toEqual(h.voicing);
    expect(plan.pad.level).toBeGreaterThanOrEqual(0.6);
    expect(plan.bass[0]).toMatchObject({ pitch: h.bass, len: 1 });
    expect(plan.harmony).toBe(h);
    expect(plan.traces[0].o).toBe("v_me");
    expect(plan.traces[0].steps).toHaveLength(16);
    expect(plan.traces[0].steps.filter((x) => x).length).toBe(ME.onsets.length);
  });

  it("a rough run keeps only the head of the motif (fragmentation); the chromatic budget opens with tension", () => {
    const run = planBar(inputs({ sig: sig({ speed: 7, grass: 1 }) }));
    expect(run.density).toBe(2);
    expect(run.rough).toBeGreaterThanOrEqual(0.5);
    expect(run.me.length).toBe(Math.min(3, ME.semis.length) * 2);
    const tense = planBar(inputs({ sig: sig({ pathP: 1 }), harmony: H({ tension: 0.9 }) }));
    expect(tense.tension).toBe(0.9);
  });

  it("a Magenta phrase is a line of its own; my motif stays (legacy routing still takes my bars)", () => {
    const phrase = new Array(32).fill(0).map((_, i) => (i % 4 === 0 ? 64 + (i % 8) : 0));
    const line = planBar(inputs({ phrase: { phrase, from: 2 } }));
    expect(line.line.length).toBeGreaterThan(0);
    expect(line.me.length).toBe(ME.semis.length);
    const legacy = planBar(inputs({ phrase: { phrase, from: 2 }, phraseTo: "me" }));
    expect(legacy.line).toEqual([]);
    expect(legacy.me.length).toBe(2);
  });

  it("a register shift moves my notes, not the others'", () => {
    const low = planBar(inputs({ register: -12 }));
    const plain = planBar(inputs());
    low.me.forEach((n, i) => expect(n.pitch).toBe(plain.me[i].pitch - 12));
  });
});
