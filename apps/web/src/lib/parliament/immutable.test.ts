import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel, botActor, dueSamples, type PEvent } from "./index";

/**
 * THE THREE BANDS (the artist, 2026-10-31 night): the present, the layer where the processes run, and from the
 * immutable line down nothing changes — a chunk whose top crosses the line is baked as it is then and final; no chunk
 * above it is ever baked.
 */
describe("the immutable layer", () => {
  const start = 1_800_000_000_000;
  const events: PEvent[] = [];
  let last = start - 1000;
  for (let now = start; now <= start + 1500 * 1000; now += 1000) {
    const due = dueSamples(last, now, 1000);
    if (due.length) last = due[due.length - 1];
    for (const w of due) for (let i = 0; i < 8; i++) { const a = botActor(i, "worker", w, start, start, 60, { groups: 2, spread: 10 }); events.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s }); }
  }
  const lod = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
  const weather = { ...DEFAULT_WEATHER, timeScale: 0.5, gatherStart: 0, rotDose: 0 };
  const parts = () => ({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod });

  it("bakes exactly the chunks whose top lies below the line, final, and nothing above it", () => {
    const m = new SpaceModel() as SpaceModel & { baked: Map<number, { final: boolean; c1: number }> };
    m.add(events);
    const spu = DEFAULT_BOXES.secPerUnit;
    const present = 1500 + 20 * spu;
    m.setNow(present);
    const kNow = Math.floor(present / spu);
    const immutable = 15;
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12, immutable };
    // several calls: build, then bake (the parts must reflect every built chunk between calls)
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    expect(m.baked.size).toBeGreaterThan(0);
    for (const bk of m.baked.values()) {
      expect(bk.final).toBe(true);
      expect(bk.c1).toBeLessThan(kNow - immutable);
    }
    // the present moves on: the line moves with it, one more chunk crosses, the earlier ones are untouched
    const before = new Set(m.baked.keys());
    m.setNow(present + 10 * spu);
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    for (const c0 of before) expect(m.baked.has(c0)).toBe(true);
    expect(m.baked.size).toBeGreaterThanOrEqual(before.size);
    for (const bk of m.baked.values()) expect(bk.c1).toBeLessThan(kNow + 10 - immutable);
  });

  it("without the line (V1) the old rule is unchanged: nothing is baked well above the window's cut", () => {
    const m = new SpaceModel() as SpaceModel & { baked: Map<number, unknown> };
    m.add(events);
    m.setNow(1500 + 20 * DEFAULT_BOXES.secPerUnit);
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12 };
    for (let i = 0; i < 3; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    expect(m.baked.size).toBe(0);
  });
});
