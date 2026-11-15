import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY } from "./density";
import { DEFAULT_ERODE } from "./erode";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel, type PEvent } from "./index";

/**
 * THE FUSION IN THE BLOCK (the artist, 2026-11-15): the fusion's one clock is the erosion of a part's place — how far
 * below the block's top it lies (and how little it was lived in). No wear, no strata, no clock.
 */
describe("the fusion in the block: a part fuses by where it lies", () => {
  const SPU = DEFAULT_BOXES.secPerUnit;
  const TOP = 100; // the block: slots 0 … 100
  /** Six people standing together for 200 s from `s0`. */
  const crowd = (s0: number): PEvent[] => {
    const out: PEvent[] = [];
    for (let t = 0; t < 200; t++) for (let i = 0; i < 6; i++) out.push({ id: `c${i}:${t}`, o: `c${i}`, r: "worker", k: "p", x: 10 + (i % 3) * 0.3, z: 10 + (i % 2) * 0.3, s: s0 + t });
    return out;
  };
  const weather = { ...DEFAULT_WEATHER, strata: false, erode: { ...DEFAULT_ERODE, topSlot: TOP, vegPull: 0, amount: 0 } };
  const density = { ...DEFAULT_DENSITY, slotSec: SPU, maxLevel: 1 };
  const lod = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
  const parts = (fuseOn: boolean) => ({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: false, weather, fuse: { ...DEFAULT_FUSE, enabled: fuseOn }, water: { ...DEFAULT_WATER, enabled: false }, edges: false, lod, density });
  const fuseInput = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, bake: false };
  const settle = (m: SpaceModel) => {
    let mesh = m.computeFuse(fuseInput);
    for (let i = 0; i < 80; i++) {
      const next = m.computeFuse(fuseInput);
      if (!next) break;
      mesh = next;
    }
    return mesh;
  };

  it("deep in the block the buildings turn into mass and their parts are absorbed; near its top nothing fuses", () => {
    // deep: built in slots ~5 … 15 of 100
    const deep = new SpaceModel();
    deep.add(crowd(5 * SPU));
    const off = deep.computeParts(parts(false))!;
    expect(off.parts).toBeGreaterThan(0);
    deep.computeParts(parts(true));
    const mass = settle(deep)!;
    expect(mass.index.length).toBeGreaterThan(0);
    const on = deep.computeParts(parts(true))!;
    expect(on.parts).toBeLessThan(off.parts);

    // near the top: the same crowd in slots ~88 … 98 — above where the erosion starts
    const high = new SpaceModel();
    high.add(crowd(88 * SPU));
    const before = high.computeParts(parts(true))!;
    const none = settle(high);
    expect(none?.index.length ?? 0).toBe(0);
    expect(high.computeParts(parts(true))?.parts ?? before.parts).toBe(before.parts);
  }, 240_000);

  it("it is a place, not a clock: the same block later on the clock is the same mass", () => {
    const a = new SpaceModel(), b = new SpaceModel();
    a.add(crowd(5 * SPU));
    b.add(crowd(5 * SPU));
    b.setNow(50_000);
    a.computeParts(parts(true));
    b.computeParts(parts(true));
    const ma = settle(a)!, mb = settle(b)!;
    expect(ma.index.length).toBeGreaterThan(0);
    expect(mb.index.length).toBe(ma.index.length);
  }, 240_000);
});
