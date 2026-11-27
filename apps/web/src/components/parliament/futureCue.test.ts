import { beforeEach, describe, expect, it } from "vitest";
import { COOLDOWN_SEC, cueState, futureFrame, noteFind, onFutureCue, panOf, QUIET_SEC, type FutureCue } from "./futureCue";

const me = { x: 0, z: 0 };
const fwd = { x: 0, z: -1 }; // looking along −z: right is +x

describe("the future's cues for the daydream (sound-logic §13k)", () => {
  let got: FutureCue[] = [];
  let off = () => {};
  beforeEach(() => {
    off();
    got = [];
    off = onFutureCue((c) => got.push(c));
    Object.assign(cueState, { present: false, lastFind: -1e9, lastArrive: -1e9, find: null });
  });

  it("pans by where I look: right is +, left is −", () => {
    expect(panOf(1, 0, fwd.x, fwd.z)).toBeCloseTo(1);
    expect(panOf(-1, 0, fwd.x, fwd.z)).toBeCloseTo(-1);
    expect(panOf(0, -1, fwd.x, fwd.z)).toBeCloseTo(0);
  });

  it("an observer overlapping me arrives from its side once; letting go leaves the way the wind blows", () => {
    futureFrame({ now: 1, showWhen: "observer", present: false, letGo: false, me, fwd });
    futureFrame({ now: 2, showWhen: "observer", present: true, letGo: false, me, fwd, obs: { x: 3, z: -1 } });
    futureFrame({ now: 3, showWhen: "observer", present: true, letGo: false, me, fwd, obs: { x: 3, z: -1 } });
    expect(got.length).toBe(1);
    expect(got[0].kind).toBe("arrive");
    expect(got[0].panFrom).toBeGreaterThan(0.5);
    futureFrame({ now: 9, showWhen: "observer", present: false, letGo: true, me, fwd, blow: { x: -1, z: 0 } });
    expect(got[1]).toMatchObject({ kind: "leave" });
    expect(got[1].panTo).toBeCloseTo(-1);
  });

  it("always there: a find after a quiet while arrives, not every find, and not again within the cooldown", () => {
    noteFind(10, -2, -2);
    futureFrame({ now: 10, showWhen: "always", present: true, letGo: false, me, fwd });
    expect(got.length).toBe(1);
    expect(got[0].panFrom).toBeLessThan(0);
    noteFind(10.5, 1, 1);
    futureFrame({ now: 10.5, showWhen: "always", present: true, letGo: false, me, fwd });
    expect(got.length).toBe(1); // finds keep coming: no new arrival
    noteFind(10.5 + QUIET_SEC + 1, 1, 1); // quiet, but within the cooldown
    futureFrame({ now: 10.5 + QUIET_SEC + 1, showWhen: "always", present: true, letGo: false, me, fwd });
    expect(got.length).toBe(1);
    const later = 10 + COOLDOWN_SEC + QUIET_SEC + 2;
    noteFind(later, 2, -1);
    futureFrame({ now: later, showWhen: "always", present: true, letGo: false, me, fwd });
    expect(got.length).toBe(2);
  });
});
