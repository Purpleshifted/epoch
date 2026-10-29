import { describe, expect, it } from "vitest";
import {
  blinkAt,
  fmtClock,
  hindrance,
  lifeAt,
} from "./index";

describe("the lifespan", () => {
  const cfg = { lifeSec: 100, warnSec: 20, endHoldSec: 5 };
  it("does not warn before the last warnSec, then rises to 1 at the end", () => {
    expect(lifeAt(0, cfg).warn).toBe(0);
    expect(lifeAt(80, cfg).warn).toBe(0);
    const a = lifeAt(85, cfg).warn, b = lifeAt(95, cfg).warn;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(lifeAt(100, cfg)).toMatchObject({ warn: 1, over: true, left: 0, frac: 1 });
    expect(lifeAt(99.9, cfg).over).toBe(false);
  });
  it("the cursor blinks faster and shorter as the end comes", () => {
    expect(blinkAt(0).hz).toBeCloseTo(1.2);
    expect(blinkAt(1).hz).toBeGreaterThan(blinkAt(0.5).hz);
    expect(blinkAt(1).duty).toBeLessThan(blinkAt(0).duty);
  });
  it("controls answer normally until the warning, then worse and with dropouts", () => {
    const h0 = hindrance(0, 3);
    expect(h0).toEqual({ gain: 1, response: 1, look: 1, dropped: false });
    const h1 = hindrance(1, 3);
    expect(h1.gain).toBeLessThan(1);
    expect(h1.response).toBeLessThan(1);
    let drops = 0, dropsHalf = 0;
    for (let t = 0; t < 60; t += 0.05) {
      if (hindrance(1, t).dropped) drops++;
      if (hindrance(0.4, t).dropped) dropsHalf++;
    }
    const n = 60 / 0.05;
    expect(drops / n).toBeGreaterThan(0.15);
    expect(drops / n).toBeLessThan(0.9);
    expect(dropsHalf).toBeLessThan(drops);
  });
  it("fmtClock", () => {
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(83.7)).toBe("01:23");
    expect(fmtClock(3600)).toBe("60:00");
  });
});
