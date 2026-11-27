import { describe, expect, it } from "vitest";
import { answerArc, ARC_IDLE, arrivalHold, DEFAULT_ARC, HOLD_FROM, stepArc, type ArcState } from "./tensionArc";
import { resolutionChord, tenseChord, TENSE_BARS, withheldHome } from "./colour";
import { placeChord, worldKey } from "./harmony";
import { arrivalBars, nextArrival, ARRIVAL_IDLE } from "./sequencer";

const cfg = { ...DEFAULT_ARC, bondSec: 0, patienceBars: 0 };
const run = (state: ArcState, from: number, bars: number, heard: string[], c = cfg) => {
  let st = state;
  let last = stepArc(st, { bar: from, barSec: 2, heard }, c);
  for (let b = from; b < from + bars; b++) {
    last = stepArc(st, { bar: b, barSec: 2, heard }, c);
    st = last.state;
  }
  return last;
};

describe("tension that builds and is resolved (§13h)", () => {
  it("builds while gathered — faster with more — and holds; drains alone", () => {
    const two = run(ARC_IDLE, 0, 6, ["a", "b"]);
    const one = run(ARC_IDLE, 0, 6, ["a"]);
    expect(two.state.stored).toBeGreaterThan(one.state.stored);
    const full = run(ARC_IDLE, 0, DEFAULT_ARC.buildBars, ["a", "b"]);
    expect(full.state.stored).toBeCloseTo(1);
    expect(full.holding).toBe(true);
    expect(full.level).toBeCloseTo(DEFAULT_ARC.tension);
    expect(run(ARC_IDLE, 0, 4, []).state.stored).toBe(0);
  });

  it("building together resolves it wholly; my answer resolves half", () => {
    const full = run(ARC_IDLE, 0, 12, ["a", "b"]);
    const built = stepArc(full.state, { bar: 12, barSec: 2, heard: ["a", "b"], building: true }, cfg);
    expect(built.resolved).toBe("build");
    expect(built.state.stored).toBe(0);
    expect(built.holding).toBe(false);
    const answered = answerArc(full.state, 12);
    expect(answered.stored).toBeCloseTo(full.state.stored / 2);
    expect(answered.last).toEqual({ kind: "answer", bar: 12 });
  });

  it("familiarity resolves it slowly: the same people long enough and it no longer holds", () => {
    const c = { ...cfg, bondSec: 60 };
    const early = run(ARC_IDLE, 0, 12, ["a", "b"], c);
    expect(early.holding).toBe(true);
    const late = run(early.state, 12, 20, ["a", "b"], c);
    expect(late.bond).toBeGreaterThan(0.9);
    expect(late.level).toBeLessThan(HOLD_FROM);
    expect(late.holding).toBe(false);
    // a stranger arrives: the tension is back
    const stranger = run(late.state, 32, 2, ["a", "b", "z"], c);
    expect(stranger.level).toBeGreaterThan(late.level);
  });

  it("patience: after holding long with nothing happening — the amen's iv, then home", () => {
    const c = { ...cfg, patienceBars: 20 };
    let st = ARC_IDLE;
    const releases: (string | null)[] = [];
    for (let b = 0; b < 40; b++) {
      const r = stepArc(st, { bar: b, barSec: 2, heard: ["a", "b"] }, c);
      st = r.state;
      releases.push(r.release);
    }
    const i = releases.indexOf("plagal");
    expect(i).toBeGreaterThan(10);
    expect(releases[i + 1]).toBe("home");
    expect(st.last?.kind).toBe("patience");
  });

  it("scattering while it held: one deceptive bar, then it fades", () => {
    const full = run(ARC_IDLE, 0, 12, ["a", "b"]);
    const gone = stepArc(full.state, { bar: 12, barSec: 2, heard: [] }, cfg);
    expect(gone.release).toBe("deceptive");
    expect(gone.resolved).toBe("scatter");
    const after = stepArc(gone.state, { bar: 13, barSec: 2, heard: [] }, cfg);
    expect(after.release).toBeNull();
    expect(after.holding).toBe(false);
  });

  it("a bar already stepped changes nothing but the events", () => {
    const a = run(ARC_IDLE, 0, 5, ["a"]);
    const again = stepArc(a.state, { bar: 4, barSec: 2, heard: ["a"] }, cfg);
    expect(again.state.stored).toBe(a.state.stored);
  });
});

describe("the chords of holding and resolving", () => {
  const key = worldKey("1760000000000");
  const place = placeChord(key, 0, 0);
  it("holding: no phrase begins at home, every phrase is tense", () => {
    for (let ph = 0; ph < 12; ph++) {
      const first = tenseChord(place, "h", ph * TENSE_BARS, 0.3, true)!;
      expect(first).not.toBeNull();
      expect(first.rootClass).not.toBe(place.rootClass);
      expect(first).toEqual(withheldHome(place, ph));
    }
  });
  it("home = the place's triad; the amen's iv; the scattered bVI", () => {
    const home = resolutionChord(place, "home");
    expect(home.classes).toEqual(place.classes.slice(0, 3));
    expect(home.rootClass).toBe(place.rootClass);
    expect(resolutionChord(place, "plagal").classes[0]).toBe((place.rootClass + 5) % 12);
    expect(resolutionChord(place, "deceptive").classes[0]).toBe((place.rootClass + 8) % 12);
  });
  it("a stored tension holds the arrival's dominant longer and lands without a deceptive turn", () => {
    expect(arrivalHold(0.1)).toBe(0);
    expect(arrivalHold(0.3)).toBe(1);
    expect(arrivalHold(0.8)).toBe(2);
    expect(arrivalBars(3, true, 2)).toEqual(["pre", "dominant", "dominant", "dominant", "tonic"]);
    let st = { ...ARRIVAL_IDLE };
    const phases: (string | null)[] = [];
    for (let bar = 50; bar < 57; bar++) {
      const r = nextArrival(st, bar, true, false, 8, true, 1);
      st = r.state;
      phases.push(r.phase);
    }
    expect(phases.slice(0, 4)).toEqual(["pre", "dominant", "dominant", "tonic"]);
  });
});
