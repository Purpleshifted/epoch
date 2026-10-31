import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel, botActor, dueSamples, type PEvent } from "./index";
import { depthDecayOf, effDecay, fusedShare, type FuseConfig } from "./fuse";

/**
 * FUSION BY DEPTH (the artist, 2026-10-31): the mass begins a fixed number of slots below the present and is complete
 * a fixed number further down — whatever the parts' own corrosion, however old the world.
 */
describe("fusion by depth", () => {
  const cfg = { ...DEFAULT_FUSE, byDepth: { start: 21, end: 60 } };

  it("the depth's decay runs 0 → fuseOnset above the start, fuseOnset → 1 from the start to the end", () => {
    const d = depthDecayOf(100, cfg)!;
    expect(d(100)).toBe(0);
    expect(d(100 - 10)).toBeCloseTo(cfg.fuseOnset * (10 / 21), 6);
    expect(d(100 - 21)).toBeCloseTo(cfg.fuseOnset, 6);
    expect(fusedShare(d(100 - 21), cfg)).toBe(0);
    expect(fusedShare(d(100 - 40), cfg)).toBeGreaterThan(0.3);
    expect(d(100 - 60)).toBeCloseTo(1, 6);
    expect(d(100 - 200)).toBeCloseTo(1, 6);
    expect(depthDecayOf(100, DEFAULT_FUSE)).toBeUndefined();
  });

  it("the same depth gives the same decay whenever the world began", () => {
    const a = depthDecayOf(90, cfg)!, b = depthDecayOf(60000, cfg)!;
    for (const depth of [5, 21, 30, 45, 60]) expect(a(90 - depth)).toBeCloseTo(b(60000 - depth), 9);
  });

  it("a part's effective decay is the further of its own and the depth's", () => {
    const d = depthDecayOf(100, cfg);
    expect(effDecay(0.05, 100 - 40, d)).toBeCloseTo(d!(60), 9);
    expect(effDecay(0.9, 100 - 40, d)).toBe(0.9);
    expect(effDecay(0.05, 100 - 40, undefined)).toBe(0.05);
  });

  it("a buried world fuses by depth where the corrosion clock alone gives nothing", () => {
    const start = 1_800_000_000_000;
    const events: PEvent[] = [];
    let last = start - 1000;
    for (let now = start; now <= start + 1500 * 1000; now += 1000) {
      const due = dueSamples(last, now, 1000);
      if (due.length) last = due[due.length - 1];
      for (const w of due) for (let i = 0; i < 8; i++) { const a = botActor(i, "worker", w, start, start, 60, { groups: 2, spread: 10 }); events.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s }); }
    }
    // a weather under which the parts' own clock barely moves (as burial did for covered parts under the artist's)
    const weather = { ...DEFAULT_WEATHER, timeScale: 0.002, rotDose: 3, gatherRise: 6, coverSlots: 5, buriedSlow: 4 };
    const lod = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
    const run = (fuse: FuseConfig) => {
      const m = new SpaceModel();
      m.add(events);
      m.setNow(1500 + 600);
      m.computeParts({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather, fuse, water: DEFAULT_WATER, edges: false, lod });
      let mesh = null;
      for (let i = 0; i < 12; i++) mesh = m.computeFuse({ box: DEFAULT_BOXES, weather, fuse, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12 }) ?? mesh;
      return mesh ? mesh.index.length / 3 : 0;
    };
    const byDepth = run({ ...cfg, fuseOnset: 0.14, byDepth: { start: 10, end: 40 } });
    const byClock = run({ ...cfg, fuseOnset: 0.14, byDepth: null });
    expect(byDepth).toBeGreaterThan(1000);
    expect(byDepth).toBeGreaterThan(byClock * 5);
  });
});
