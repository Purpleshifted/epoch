import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel, buildTestColumn, layerDecayOf } from "./index";

describe("test column (work mode): a whole column at once", () => {
  it("writes a bot crowd's log for the given seconds, with buildings in it", () => {
    const ev = buildTestColumn({ seconds: 600, bots: 8 });
    expect(ev.length).toBeGreaterThan(600 * 8 * 0.8);
    expect(Math.max(...ev.map((e) => e.s))).toBeGreaterThan(590);
    const m = new SpaceModel();
    m.add(ev);
    const r = m.computeParts({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod: { camera: [0, 0, 0], near: 1e9, farFactor: 0.25 } })!;
    expect(r.seeds).toBeGreaterThan(0);
  });

  it("ONE CLOCK: the layers' age rises with depth on the parts' corrosion clock, so the resin comes after the fusion", () => {
    const w = { ...DEFAULT_WEATHER, timeScale: 0.4, gatherStart: 5, gatherRise: 8, rotDose: 3 };
    const spu = 20, tQ = 20 * 600;
    const age = layerDecayOf(tQ, spu, w, DEFAULT_FOLD.tauSlabYears);
    const kNow = tQ / spu;
    expect(age(kNow)).toBe(0); // the present
    let last = 0;
    for (let d = 0; d <= 60; d += 5) {
      const a = age(kNow - d);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    // where the parts begin to fuse (fuseOnset) lies above where the layer becomes resin (resinShare)
    const at = (q: number) => { for (let d = 0; d < 400; d++) if (age(kNow - d) >= q) return d; return Infinity; };
    expect(at(DEFAULT_FUSE.fuseOnset)).toBeLessThan(at(DEFAULT_FUSE.resinShare));
  });
});
