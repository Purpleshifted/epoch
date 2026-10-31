import { describe, expect, it } from "vitest";
import {
  type CameraState,
  type Sequence,
  type Shot,
  azimuthAt,
  blendPose,
  cameraStateOf,
  clockSec,
  createShotDriver,
  cycleSec,
  ease5,
  ease5Integral,
  eligible,
  locate,
  placeCamera,
  SETTLE_SEC,
  SHOT_CLOCK_T0,
  settled,
  shotStatus,
  stepShotDriver,
  turnIntegral,
  wrapDeg,
} from "./cameraShots";

const shot = (id: number, dist: number, polar: number, lift: number, holdSec: number, turn = 1, lookX = 0, lookZ = 0): Shot => ({ id, dist, polar, lookX, lookZ, lift, turn, holdSec });

/** The plan's defaults: base 90 s, fossil overview 60 s, top-down 45 s (half turn speed), close-up 60 s (0.7), fades 12 s. */
const SEQ: Sequence = {
  base: shot(0, 75, 58, -25, 90),
  shots: [shot(1, 140, 72, -48, 60), shot(2, 60, 12, 0, 45, 0.5), shot(3, 30, 62, 1, 60, 0.7)],
  fadeSec: 12,
};
const CYCLE = 90 + 60 + 45 + 60 + 4 * 12; // 303

const cursor = () => ({ from: 0, to: 0, k: 0, left: 0, seg: -1 });
const pose = () => ({ dist: 0, polar: 0, lookX: 0, lookZ: 0, lift: 0, turn: 0 });

describe("the cycle and where the clock lands in it", () => {
  it("one cycle is every hold plus one fade per shot", () => {
    expect(cycleSec(SEQ)).toBe(CYCLE);
    expect(cycleSec({ ...SEQ, shots: [] })).toBe(90); // the base alone: no fades
  });

  it("holds, fades and wraps by the clock", () => {
    const c = cursor();
    locate(SEQ, 0, c);
    expect(c).toMatchObject({ from: 0, to: 0, k: 0, left: 90, seg: 0 });
    locate(SEQ, 95, c); // 5 s into the first fade
    expect(c.from).toBe(0);
    expect(c.to).toBe(1);
    expect(c.k).toBeCloseTo(ease5(5 / 12));
    expect(c.left).toBeCloseTo(7);
    expect(c.seg).toBe(1);
    locate(SEQ, 102, c); // the fossil overview, just arrived
    expect(c).toMatchObject({ from: 1, to: 1, k: 0, seg: 2 });
    expect(c.left).toBeCloseTo(60);
    locate(SEQ, CYCLE - 1, c); // the last second of the fade back to the base
    expect(c.from).toBe(3);
    expect(c.to).toBe(0);
    expect(c.k).toBeCloseTo(ease5(11 / 12));
    locate(SEQ, CYCLE + 95, c); // the next cycle is the same
    expect(c.from).toBe(0);
    expect(c.to).toBe(1);
    expect(c.k).toBeCloseTo(ease5(5 / 12));
    locate(SEQ, -5, c); // before the origin: still inside the cycle
    expect(c.from).toBe(3);
    expect(c.to).toBe(0);
  });

  it("with no extra shot it only holds the base", () => {
    const c = cursor();
    locate({ ...SEQ, shots: [] }, 12345, c);
    expect(c).toMatchObject({ from: 0, to: 0, k: 0, seg: 0 });
    expect(c.left).toBe(Infinity);
  });

  it("the clock origin is 2026-01-01 in seconds", () => {
    expect(clockSec(SHOT_CLOCK_T0 * 1000)).toBe(0);
    expect(clockSec(SHOT_CLOCK_T0 * 1000 + 1500)).toBe(1.5);
  });
});

describe("blending", () => {
  it("the quintic ease has zero speed at both ends and is symmetric", () => {
    expect(ease5(0)).toBe(0);
    expect(ease5(1)).toBe(1);
    expect(ease5(0.5)).toBeCloseTo(0.5);
    const h = 1e-3;
    expect((ease5(h) - ease5(0)) / h).toBeLessThan(1e-4);
    expect((ease5(1) - ease5(1 - h)) / h).toBeLessThan(1e-4);
    expect(ease5(0.3) + ease5(0.7)).toBeCloseTo(1);
    // the integral matches a numerical one
    let num = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) num += ease5((i + 0.5) / N) / N;
    expect(ease5Integral(1)).toBeCloseTo(num, 6);
    let half = 0;
    for (let i = 0; i < N / 2; i++) half += ease5((i + 0.5) / N) / N;
    expect(ease5Integral(0.5)).toBeCloseTo(half, 6);
  });

  it("ends exactly on the shots and takes the distance on a log scale", () => {
    const out = pose();
    const a = SEQ.base;
    const b = SEQ.shots[0];
    expect(blendPose(a, b, 0, out)).toMatchObject({ dist: 75, polar: 58, lift: -25, turn: 1 });
    expect(blendPose(a, b, 1, out)).toMatchObject({ dist: 140, polar: 72, lift: -48, turn: 1 });
    blendPose(a, b, 0.5, out);
    expect(out.dist).toBeCloseTo(Math.sqrt(75 * 140));
    expect(out.polar).toBeCloseTo(65);
    expect(out.lift).toBeCloseTo(-36.5);
  });
});

describe("the turn: one continuous function of time", () => {
  it("with every factor 1 it is the plain turn", () => {
    const flat: Sequence = { ...SEQ, shots: SEQ.shots.map((s) => ({ ...s, turn: 1 })) };
    expect(turnIntegral(flat, 1000)).toBeCloseTo(1000);
    expect(azimuthAt(flat, 45, 180, 1, 36)).toBeCloseTo(126); // a quarter turn in 45 s
    expect(azimuthAt(flat, 45, 180, -1, 36)).toBeCloseTo(306);
    expect(azimuthAt(flat, 999, 0, 1, 36)).toBe(36); // 0 = still
  });

  it("is continuous across fades, factor changes and the cycle's end", () => {
    const step = 1 / 60;
    const maxRate = (360 / 180) * 1; // the largest factor is 1
    let prev = azimuthAt(SEQ, 0, 180, 1, 0);
    for (let t = step; t < 2 * CYCLE + 30; t += step) {
      const az = azimuthAt(SEQ, t, 180, 1, 0);
      const d = wrapDeg(az - prev);
      expect(d).toBeGreaterThanOrEqual(-1e-6);
      expect(d).toBeLessThanOrEqual(maxRate * step + 1e-6);
      prev = az;
    }
  });

  it("turns slower through the top-down shot and adds up over a cycle", () => {
    // holding the top-down shot (factor 0.5): half the rate
    const t0 = 90 + 12 + 60 + 12 + 10;
    const a0 = azimuthAt(SEQ, t0, 180, 1, 0);
    const a1 = azimuthAt(SEQ, t0 + 1, 180, 1, 0);
    expect(wrapDeg(a1 - a0)).toBeCloseTo(1); // 2°/s × 0.5
    // one cycle: holds × factors + fades at the mean of their ends
    const total = 90 * 1 + 60 * 1 + 45 * 0.5 + 60 * 0.7 + 12 * ((1 + 1) / 2 + (1 + 0.5) / 2 + (0.5 + 0.7) / 2 + (0.7 + 1) / 2);
    expect(turnIntegral(SEQ, CYCLE)).toBeCloseTo(total);
    expect(turnIntegral(SEQ, 3 * CYCLE + 7)).toBeCloseTo(3 * total + 7);
  });

  it("wraps degrees into (−180, 180]", () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(720)).toBe(0);
  });
});

describe("the camera on its sphere", () => {
  it("placeCamera and cameraStateOf are inverses", () => {
    const target = { x: 3, y: 120, z: -4 };
    const p = { x: 0, y: 0, z: 0 };
    placeCamera(target, 75, 58, 36, p);
    const s = cameraStateOf(p, target, 145, 0, { dist: 0, polar: 0, az: 0, lookX: 0, lookZ: 0, lift: 0 });
    expect(s.dist).toBeCloseTo(75);
    expect(s.polar).toBeCloseTo(58);
    expect(s.az).toBeCloseTo(36);
    expect(s.lookX).toBe(3);
    expect(s.lookZ).toBe(-4);
    expect(s.lift).toBe(-25);
    // straight above and the horizon
    placeCamera(target, 60, 12, 200, p);
    expect(p.y - target.y).toBeCloseTo(60 * Math.cos((12 * Math.PI) / 180));
    expect(cameraStateOf(p, target, null, -7, s).lift).toBe(-7); // no focus known: the fallback
  });

  it("a shot whose target would sink below the column's bottom is not eligible", () => {
    expect(eligible(SEQ.shots[0], 100)).toBe(true); // 100 − 48 ≥ 0
    expect(eligible(SEQ.shots[0], 40)).toBe(false);
    expect(eligible(SEQ.shots[0], null)).toBe(true); // nothing known yet
    expect(eligible(SEQ.base, 25)).toBe(true);
    expect(eligible(SEQ.base, 24)).toBe(false);
  });
});

describe("the driver", () => {
  const input = (t: number, dt: number, focusY: number | null, resyncFrom: CameraState | null = null) => ({ seq: SEQ, t, dt, turnSec: 180, dir: 1 as const, azOffset: 36, focusY, maxPolar: 179.5, resyncFrom });

  it("shows the clock's pose exactly: the first frame snaps, then follows frame by frame", () => {
    const d = createShotDriver();
    const s = stepShotDriver(d, input(0, 1 / 60, 500));
    expect(s).toMatchObject({ dist: 75, polar: 58, lookX: 0, lookZ: 0, lift: -25 });
    expect(s.az).toBeCloseTo(36);
    expect(d.primed).toBe(true);
    // 5 s into the first fade: the blend of base → fossil overview, the turn 95 s on
    stepShotDriver(d, input(95, 1 / 60, 500));
    const k = ease5(5 / 12);
    expect(d.shown.polar).toBeCloseTo(58 + (72 - 58) * k);
    expect(d.shown.lift).toBeCloseTo(-25 + (-48 + 25) * k);
    expect(d.shown.az).toBeCloseTo((36 + 95 * 2) % 360);
    expect(settled(d)).toBe(true);
  });

  it("a shallow column: the fossil overview is replaced by the base, latched when its fade begins", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(0, 1 / 60, 30)); // the base holds (30 − 25 ≥ 0)
    expect(d.fallback).toBe(false);
    stepShotDriver(d, input(91, 1 / 60, 30)); // the fade into shot 1 begins: 30 − 48 < 0 → the base stands in
    expect(d.fallback).toBe(true);
    expect(d.shown.dist).toBeCloseTo(75);
    expect(d.shown.lift).toBeCloseTo(-25);
    stepShotDriver(d, input(120, 1 / 60, 200)); // deeper now, but the decision holds until the next time
    expect(d.fallback).toBe(true);
    expect(d.shown.dist).toBeCloseTo(75);
    // the next cycle: eligible, so the fade takes it
    stepShotDriver(d, input(CYCLE + 91, 1 / 60, 200));
    expect(d.fallback).toBe(false);
    stepShotDriver(d, input(CYCLE + 110, 1 / 60, 200));
    expect(d.shown.dist).toBeCloseTo(140);
    expect(d.shown.lift).toBeCloseTo(-48);
  });

  it("a shot that is ineligible is also what the NEXT fade leaves from (no jump at its end)", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(0, 1 / 60, 30));
    stepShotDriver(d, input(91, 1 / 60, 30)); // shot 1 → base stands in
    stepShotDriver(d, input(90 + 12 + 60 + 6, 1 / 60, 30)); // mid-fade shot 1 → shot 2: from the base's pose
    expect(d.shown.dist).toBeCloseTo(Math.exp(Math.log(75) + (Math.log(60) - Math.log(75)) * ease5(0.5)));
  });

  it("after a disruption the camera stays where it is and settles to the clock's pose", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(10, 1 / 60, 500));
    // a drag left the camera elsewhere: closer, from another direction
    const dragged: CameraState = { dist: 40, polar: 70, az: 300, lookX: 5, lookZ: -5, lift: -10 };
    let s = stepShotDriver(d, input(10 + 1 / 60, 1 / 60, 500, dragged));
    expect(s.dist).toBeCloseTo(40, 3);
    expect(s.polar).toBeCloseTo(70, 3);
    expect(s.az).toBeCloseTo(300, 3);
    expect(s.lookX).toBeCloseTo(5, 3);
    expect(s.lift).toBeCloseTo(-10, 3);
    expect(settled(d)).toBe(false);
    // frame by frame it approaches: monotonic, and within ~8 time constants it is there
    let prevDist = s.dist;
    let t = 10 + 1 / 60;
    for (let i = 0; i < 60 * 8 * SETTLE_SEC; i++) {
      t += 1 / 60;
      s = stepShotDriver(d, input(t, 1 / 60, 500));
      expect(s.dist).toBeGreaterThanOrEqual(prevDist - 1e-9);
      prevDist = s.dist;
    }
    expect(s.dist).toBeCloseTo(75, 1);
    expect(s.polar).toBeCloseTo(58, 1);
    expect(s.lookX).toBeCloseTo(0, 1);
    expect(s.lift).toBeCloseTo(-25, 1);
    expect(wrapDeg(s.az - azimuthAt(SEQ, t, 180, 1, 36))).toBeCloseTo(0, 1);
    expect(settled(d)).toBe(true);
  });

  it("a stall does not jump: the camera is kept where it was and the gap settles, not wiped by the long frame", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(10, 1 / 60, 500));
    const before = { ...d.shown };
    // 2 s stalled: the clock's azimuth is 4° further; the caller hands the camera's last pose back
    const s = stepShotDriver(d, input(12, 2, 500, before));
    expect(s.az).toBeCloseTo(before.az, 2);
    // the gap decays as if the frame were 0.1 s long
    expect(Math.abs(d.err.az)).toBeCloseTo(4 * Math.exp(-0.1 / SETTLE_SEC), 3);
  });

  it("the azimuth difference settles the short way round", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(0, 1 / 60, 500)); // az 36
    const s = stepShotDriver(d, input(1 / 60, 1 / 60, 500, { dist: 75, polar: 58, az: 350, lookX: 0, lookZ: 0, lift: -25 }));
    expect(s.az).toBeCloseTo(350, 2);
    expect(d.err.az).toBeLessThan(0); // −46°, not +314°
    expect(d.err.az).toBeGreaterThan(-50);
  });

  it("without a known focus the lift difference is not taken from the camera", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(0, 1 / 60, null));
    stepShotDriver(d, input(1 / 60, 1 / 60, null, { dist: 75, polar: 58, az: 36, lookX: 0, lookZ: 0, lift: 99 }));
    expect(d.err.lift).toBe(0);
  });

  it("keeps the polar angle off the pole and the distance at least 1", () => {
    const d = createShotDriver();
    const seq: Sequence = { ...SEQ, shots: [shot(1, 0.2, 0, 0, 60)] };
    const s = stepShotDriver(d, { seq, t: 90 + 12 + 1, dt: 1 / 60, turnSec: 180, dir: 1, azOffset: 0, focusY: 500, maxPolar: 179.5, resyncFrom: null });
    expect(s.polar).toBe(0.5);
    expect(s.dist).toBe(1);
  });

  it("the status line names the shot, the seconds left and the depth fallback", () => {
    const d = createShotDriver();
    stepShotDriver(d, input(10, 1 / 60, 500));
    expect(shotStatus(SEQ, d)).toBe("자동 운행: 기본 (80 s)");
    stepShotDriver(d, input(95, 1 / 60, 500));
    expect(shotStatus(SEQ, d)).toBe("자동 운행: 기본 → 샷 1 (7 s)");
    const shallow = createShotDriver();
    stepShotDriver(shallow, input(95, 1 / 60, 10));
    expect(shotStatus(SEQ, shallow)).toBe("자동 운행: 기본 → 샷 1 (7 s) · 바닥이 얕아 기본으로");
    stepShotDriver(shallow, input(CYCLE - 5, 1 / 60, 10)); // back to the base, itself too deep: no word about it
    expect(shotStatus(SEQ, shallow)).toBe("자동 운행: 샷 3 → 기본 (5 s)");
    expect(shotStatus({ ...SEQ, shots: [] }, d)).toBe("자동 운행: 기본만 (켜진 샷 없음)");
  });
});
