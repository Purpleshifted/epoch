import { describe, expect, it } from "vitest";
import { TILT_DEAD_DEG, TILT_FULL_DEG, tiltAxis, tiltToInput } from "./tilt";

describe("the phone as the controller", () => {
  it("ignores small tilts, rises to full, and keeps the sign", () => {
    expect(tiltAxis(0)).toBe(0);
    expect(tiltAxis(TILT_DEAD_DEG)).toBe(0);
    expect(tiltAxis(-TILT_DEAD_DEG)).toBe(0);
    expect(tiltAxis((TILT_DEAD_DEG + TILT_FULL_DEG) / 2)).toBeCloseTo(0.5);
    expect(tiltAxis(TILT_FULL_DEG)).toBe(1);
    expect(tiltAxis(90)).toBe(1);
    expect(tiltAxis(-90)).toBe(-1);
    expect(tiltAxis(NaN)).toBe(0);
  });
  it("walks forward when the top is tipped away from the neutral angle, turns with the sideways tilt", () => {
    const neutral = 55;
    expect(tiltToInput(55, 0, neutral)).toEqual({ fwd: 0, turn: 0 });
    expect(tiltToInput(55 - TILT_FULL_DEG, 0, neutral).fwd).toBe(1);
    expect(tiltToInput(55 + TILT_FULL_DEG, 0, neutral).fwd).toBe(-1);
    expect(tiltToInput(55, TILT_FULL_DEG, neutral).turn).toBe(1);
    expect(tiltToInput(55, -TILT_FULL_DEG, neutral).turn).toBe(-1);
  });
});
