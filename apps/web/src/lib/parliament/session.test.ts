import { describe, expect, it } from "vitest";
import {
  blinkAt,
  drawLife,
  fmtClock,
  hindrance,
  lifeAt,
} from "./index";

describe("the lifespan", () => {
  const cfg = { lifeSec: 100, warnSec: 20, endHoldSec: 5 };
  it("a life is drawn between its limits, and what comes near its start and end keeps its proportion", () => {
    const set = { lifeSec: 180, lifeMinSec: 30, lifeMaxSec: 120, warnSec: 40, endHoldSec: 3, hintAfterSec: 30, hintPeriodSec: 30, hintShowSec: 5, stopLastSec: 15 };
    expect(drawLife(set, 0).lifeSec).toBe(30);
    expect(drawLife(set, 1).lifeSec).toBe(120);
    expect(drawLife(set, 0.5).lifeSec).toBe(75);
    const short = drawLife(set, 0);
    expect(short.warnSec).toBeCloseTo(40 / 6);
    expect(short.hintAfterSec).toBeCloseTo(5);
    expect(short.stopLastSec).toBeCloseTo(2.5);
    expect(short.hintPeriodSec).toBeCloseTo(5);
    expect(short.hintShowSec).toBeCloseTo(2.5); // gone half the time, not up for good
    expect(drawLife(set, 1).hintShowSec).toBe(5);
    // a short life is not spent dying
    expect(lifeAt(10, short).warn).toBe(0);
    expect(lifeAt(23, short).warn).toBe(0);
    expect(lifeAt(29, short).warn).toBeGreaterThan(0);
    expect(short.endHoldSec).toBe(3);
    // no limits: as it was
    expect(drawLife(cfg, 0.5)).toBe(cfg);
  });
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
