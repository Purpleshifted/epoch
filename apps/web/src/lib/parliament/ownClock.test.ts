import { describe, expect, it } from "vitest";
import { geoAge, geoYears } from "@/lib/stratum/geoClock";
import { DEFAULT_FOLD, DEFAULT_WEATHER } from "./index";
import { DEFAULT_BOXES } from "./seeds";
import { layerDecayOf } from "./spaceModel";
import { sedimentShare } from "./natureHistory";

/**
 * EVERY THING ON ITS OWN CLOCK (the artist, 2026-10-31): a thing made on the third day lives the same life as one
 * made in the first minute — its age runs from its own birth through the compressed curve, never from the world's.
 */
describe("own clock: the same life whenever a thing was made", () => {
  const DAY = 86_400;

  it("geoAge depends only on the elapsed time", () => {
    expect(geoAge(600, 0)).toBeCloseTo(geoYears(600), 9);
    expect(geoAge(3 * DAY + 600, 3 * DAY)).toBeCloseTo(geoYears(600), 9);
    expect(geoAge(100, 200)).toBe(0);
    // what the world-clock difference did: the same 600 s weighed many times more on day 3
    expect(geoYears(3 * DAY + 600) - geoYears(3 * DAY)).toBeGreaterThan(geoYears(600) * 5);
  });

  it("a layer's corrosion (the one clock of the resin) is the same on day 1 and day 3", () => {
    const spu = DEFAULT_BOXES.secPerUnit;
    const d1 = layerDecayOf(1200, spu, DEFAULT_WEATHER, DEFAULT_FOLD.tauSlabYears)(0);
    const kDay3 = (3 * DAY) / spu;
    const d3 = layerDecayOf(3 * DAY + 1200, spu, DEFAULT_WEATHER, DEFAULT_FOLD.tauSlabYears)(kDay3);
    expect(d1).toBeGreaterThan(0);
    expect(d3).toBeCloseTo(d1, 6);
  });

  it("the sediment's share ages the same way", () => {
    const sed = (tNow: number) => ({ tNow, secPerUnit: 20, timeScale: 0.4, tauYears: 600, graceSlots: 0 });
    const s1 = sedimentShare(0, sed(1200));
    const s3 = sedimentShare((3 * DAY) / 20, sed(3 * DAY + 1200));
    expect(s1).toBeGreaterThan(0);
    expect(s3).toBeCloseTo(s1, 6);
  });
});
