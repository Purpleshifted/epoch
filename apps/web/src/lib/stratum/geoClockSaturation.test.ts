import { describe, expect, it } from "vitest";
import { DEFAULT_CLOCK, geoYears, secondsForYears } from "./geoClock";

/**
 * SATURATION (2026-11-01): the first hours keep the compressed curve; from the saturation point on, the same seconds
 * are worth the same years however old the world is — a wall running for days no longer melts a building right
 * after it is built.
 */
describe("geoClock saturation", () => {
  const S = DEFAULT_CLOCK.saturateSeconds!;
  const H = 3600;

  it("is unchanged before the saturation point", () => {
    const a = Math.log10(1 + DEFAULT_CLOCK.maxYears) / Math.log10(1 + DEFAULT_CLOCK.exhibitionSeconds);
    for (const t of [10, 100, H, 3 * H, S]) expect(geoYears(t)).toBeCloseTo(Math.pow(1 + t, a) - 1, 6);
  });

  it("is continuous and smooth at the point, then a straight line", () => {
    const d = 1;
    const before = geoYears(S) - geoYears(S - d);
    const after = geoYears(S + d) - geoYears(S);
    expect(after / before).toBeCloseTo(1, 2);
    // twenty seconds weigh the same years at 8 h, at 24 h and after a fortnight
    const w = (t: number) => geoYears(t + 20) - geoYears(t);
    expect(w(8 * H)).toBeCloseTo(w(24 * H), 6);
    expect(w(24 * H)).toBeCloseTo(w(14 * 24 * H), 6);
    // … and no longer eight times more than at one hour (what melted the buildings)
    expect(w(14 * 24 * H) / w(H)).toBeLessThan(2.5);
  });

  it("the inverse follows both pieces", () => {
    for (const t of [10, H, S - 1, S + 1, 24 * H, 14 * 24 * H]) expect(secondsForYears(geoYears(t))).toBeCloseTo(t, 3);
  });

  it("a config without saturation is the old curve everywhere", () => {
    const cfg = { exhibitionSeconds: 8 * H, maxYears: 1e6 };
    const a = Math.log10(1 + 1e6) / Math.log10(1 + 8 * H);
    expect(geoYears(24 * H, cfg)).toBeCloseTo(Math.pow(1 + 24 * H, a) - 1, 3);
  });
});
