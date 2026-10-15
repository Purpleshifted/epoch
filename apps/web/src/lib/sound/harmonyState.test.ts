import { describe, expect, it } from "vitest";
import { chordName, homeKey, keyChord, keyName, tonalityOf } from "./harmony";
import { HarmonyTracker, leadVoices, nextHarmony, pivotChord, weightsOf, type HarmonyInputs, type HarmonyState, type PlaceState } from "./harmonyState";
import type { PersonalSignals } from "./signals";

const ME = "v_me";
const HOME = homeKey(ME);
const sig = (over: Partial<PersonalSignals> = {}): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, building: null, grass: 0.3, ...over });
const near = (o: string, dist = 2) => ({ o, dist, angle: 0, bot: o.startsWith("bot") });
const place = (over: Partial<PlaceState> = {}): PlaceState => ({ at: null, approach: null, degree: 0, cadence: "none", onPath: false, ...over });
const inputs = (bar: number, over: Partial<HarmonyInputs> = {}): HarmonyInputs => ({ bar, myId: ME, sig: sig(), place: place(), closeness: new Map(), rough: 0, cadence: "none", ...over });
const classes = (h: HarmonyState) => h.chord.classes;
const run = (bars: Partial<HarmonyInputs>[]): HarmonyState[] => {
  const out: HarmonyState[] = [];
  let prev: HarmonyState | null = null;
  bars.forEach((b, i) => {
    prev = nextHarmony(prev, inputs(i, b));
    out.push(prev);
  });
  return out;
};

describe("harmony state H: tonality is whose weights", () => {
  it("alone on open ground: my home key, its tonic chord, no tension", () => {
    const h = nextHarmony(null, inputs(0));
    expect(keyName(h.key)).toBe(keyName(HOME));
    expect(h.source).toBe("home");
    expect(chordName(h.chord)).toBe(chordName(keyChord(HOME, 0)));
    expect(h.tension).toBe(0);
    expect(h.voicing).toHaveLength(4);
    expect(h.bass % 12).toBe(HOME.root);
  });

  it("with people who have been close: a group tonality of our roots; whoever outweighs me becomes the tonic", () => {
    const s = sig({ neighbours: [near("v_b"), near("bot1", 4)] });
    const little = nextHarmony(null, inputs(0, { sig: s, closeness: new Map([["v_b", 0.4], ["bot1", 0.2]]) }));
    expect(little.source).toBe("group");
    expect(little.key.root).toBe(HOME.root); // I weigh 0.8: still the tonic
    expect(classes(little)).toContain(homeKey("v_b").root);
    expect(classes(little)).toContain(homeKey("bot1").root);
    const long = nextHarmony(null, inputs(0, { sig: s, closeness: new Map([["v_b", 0.95]]) }));
    expect(long.key.root).toBe(homeKey("v_b").root); // they have been close long enough: I go along
    expect(weightsOf(inputs(0, { sig: s, closeness: new Map([["v_b", 0.05]]) })).source).toBe("home");
  });

  it("at a building: its builders' tonality (the same function), the chord of their roots", () => {
    const who = [{ o: "v_x", amount: 30 }, { o: "v_y", amount: 10 }, { o: ME, amount: 5 }];
    const h = nextHarmony(null, inputs(0, { place: place({ at: { id: "3,4", who } }) }));
    const t = tonalityOf(who)!;
    expect(h.source).toBe("building");
    expect(keyName(h.key)).toBe(keyName(t.key));
    expect(classes(h)).toEqual(t.chord.classes);
    expect(h.builders[0]).toBe("v_x");
  });

  it("approach: within reach of a building the chord is the DOMINANT of its tonality; entering resolves", () => {
    const who = [{ o: "v_x", amount: 30 }];
    const target = tonalityOf(who)!.key;
    const [far, close, inside] = run([
      { place: place({ approach: { id: "3,4", who, amount: 0.2 } }) },
      { place: place({ approach: { id: "3,4", who, amount: 0.8 } }) },
      { place: place({ at: { id: "3,4", who } }) },
    ]);
    expect(far.source).toBe("home");
    expect(close.source).toBe("approach");
    expect(close.chord.rootClass).toBe((target.root + 7) % 12);
    expect(close.tension).toBeGreaterThan(0.5);
    expect(inside.source).toBe("building");
    expect(inside.chord.rootClass).toBe(target.root);
    expect(inside.tension).toBeLessThan(close.tension);
  });

  it("a people's chord moves at most every 2 bars; a changed weight waits for the bar line it may take", () => {
    const a = [{ o: "v_x", amount: 30 }, { o: "v_y", amount: 10 }];
    const b = [{ o: "v_x", amount: 30 }, { o: "v_y", amount: 10 }, { o: "v_z", amount: 8 }];
    const hs = run([
      { place: place({ at: { id: "b", who: a } }) },
      { place: place({ at: { id: "b", who: b } }) },
      { place: place({ at: { id: "b", who: b } }) },
    ]);
    expect(classes(hs[1])).toEqual(classes(hs[0])); // too soon
    expect(classes(hs[2])).toContain(homeKey("v_z").root); // bar 2: the newcomer is in
    expect(hs[2].changedBar).toBe(2);
    // the newcomer's root prefers the top voice
    expect(hs[2].voicing[3] % 12).toBe(homeKey("v_z").root);
  });

  it("voice leading: upper voices move the least, the bass takes the root", () => {
    const c = keyChord({ root: 0, mode: HOME.mode }, 0, 3); // C triad
    const v0 = leadVoices(null, c, null);
    expect(v0[0]).toBe(48);
    expect(v0.slice(1).every((p) => p >= 60 && p <= 79)).toBe(true);
    const f = keyChord({ root: 5, mode: HOME.mode }, 0, 3); // F triad
    const v1 = leadVoices(v0, f, c.classes);
    expect(v1[0]).toBe(53);
    const moved = v1.slice(1).reduce((s, p, i) => s + Math.abs(p - v0[i + 1]), 0);
    expect(moved).toBeLessThanOrEqual(6);
    for (let i = 1; i < 4; i++) expect(f.classes).toContain(v1[i] % 12);
  });

  it("the path is a progression; leaving it is a full cadence (tonic, tension 0); stopping on it a half one", () => {
    const h = nextHarmony(null, inputs(0, { place: place({ onPath: true, degree: 3 }) }));
    expect(h.chord.rootClass).toBe(keyChord(HOME, 3).rootClass);
    const full = nextHarmony(h, inputs(1, { cadence: "full" }));
    expect(full.chord.rootClass).toBe(HOME.root);
    expect(full.tension).toBe(0);
    expect(full.cadence).toBe("full");
    const half = nextHarmony(h, inputs(1, { place: place({ onPath: true, degree: 4 }), cadence: "half" }));
    expect(half.chord.rootClass).toBe(keyChord(HOME, 4).rootClass);
    expect(half.tension).toBeGreaterThanOrEqual(0.6);
  });

  it("coming home from a building: pivot, dominant, tonic over three bars", () => {
    const who = [{ o: "v_far", amount: 20 }];
    const bKey = tonalityOf(who)!.key;
    if (bKey.root === HOME.root) return; // no modulation to stage for this pair of ids
    const hs = run([{ place: place({ at: { id: "b", who } }) }, {}, {}, {}, {}]);
    expect(hs[1].modulation?.stage).toBe(0);
    expect(keyName(hs[1].key)).toBe(keyName(bKey)); // still the old key under the pivot
    const pivot = hs[1].chord.classes;
    const oldScale = bKey.mode.intervals.map((i) => (i + bKey.root) % 12);
    expect(pivot.every((c) => oldScale.includes(c))).toBe(true);
    expect(hs[2].modulation?.stage).toBe(1);
    expect(keyName(hs[2].key)).toBe(keyName(HOME));
    expect(hs[2].chord.rootClass).toBe(keyChord(HOME, 4).rootClass);
    expect(hs[3].modulation).toBeNull();
    expect(hs[3].chord.rootClass).toBe(HOME.root);
    expect(hs[3].cadence).toBe("full");
    expect(hs[4].source).toBe("home");
  });

  it("pivotChord: a triad of the new key whose tones the old key holds", () => {
    const from = { root: 0, mode: HOME.mode };
    const to = { root: 7, mode: HOME.mode };
    const p = pivotChord(from, to, null);
    const fromScale = from.mode.intervals.map((i) => (i + from.root) % 12);
    expect(p.classes.every((c) => fromScale.includes(c))).toBe(true);
  });

  it("the tracker: hysteresis at a building, the progression on a path, cadences when stopping and leaving", () => {
    const tr = new HarmonyTracker({ stepEvery: 4 });
    const who = [{ o: "v_x", amount: 10 }];
    expect(tr.update(ME, sig({ building: { id: "b", dist: 4, who }, sealed: 0 })).approach?.amount).toBeCloseTo(1 - 4 / 6);
    expect(tr.update(ME, sig({ building: { id: "b", dist: 1, who }, sealed: 0.5 })).at?.id).toBe("b");
    expect(tr.update(ME, sig({ building: { id: "b", dist: 2, who }, sealed: 0.2 })).at?.id).toBe("b"); // hysteresis
    expect(tr.update(ME, sig({ building: { id: "b", dist: 3, who }, sealed: 0.05 })).at).toBeNull();
    // walking a path moves the degree; stopping on it = half cadence; leaving = full
    tr.update(ME, sig({ x: 0, z: 0, pathP: 1, speed: 3 }));
    let st = tr.update(ME, sig({ x: 5, z: 0, pathP: 1, speed: 3 }));
    expect(st.onPath).toBe(true);
    expect(st.degree).not.toBe(0);
    st = tr.update(ME, sig({ x: 5, z: 0, pathP: 1, speed: 0 }));
    expect(st.cadence).toBe("half");
    expect(st.degree).toBe(4);
    expect(tr.takeCadence()).toBe("half");
    expect(tr.takeCadence()).toBe("none");
    tr.update(ME, sig({ x: 6, z: 0, pathP: 1, speed: 3 }));
    st = tr.update(ME, sig({ x: 8, z: 0, pathP: 0, speed: 3 }));
    expect(st.cadence).toBe("full");
    expect(tr.takeCadence()).toBe("full");
    // wandering off the path moves the progression too, three times slower; standing holds it
    const w = new HarmonyTracker({ stepEvery: 4 });
    w.update(ME, sig({ x: 0, z: 0, speed: 3 }));
    expect(w.update(ME, sig({ x: 6, z: 0, speed: 3 })).degree).toBe(0); // 6 × 0.5 = 3 < 6
    expect(w.update(ME, sig({ x: 13, z: 0, speed: 3 })).degree).not.toBe(0); // 3 + 3.5 ≥ 6
    const held = w.update(ME, sig({ x: 13, z: 0, speed: 0 })).degree;
    expect(w.update(ME, sig({ x: 13, z: 0, speed: 0 })).degree).toBe(held);
  });

  it("a chord change re-anchors the motif even in the open; alone and unchanged it sits on its register", () => {
    const h0 = nextHarmony(null, inputs(0));
    const h1 = nextHarmony(h0, inputs(1, { place: place({ degree: 3 }) }));
    expect(h1.changedBar).toBe(1);
    expect(h1.chord.rootClass).toBe(keyChord(HOME, 3).rootClass);
    const h2 = nextHarmony(h1, inputs(2, { place: place({ degree: 3 }) }));
    expect(h2.changedBar).toBe(1);
  });
});
