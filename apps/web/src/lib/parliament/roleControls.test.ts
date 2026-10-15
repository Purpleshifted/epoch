import { describe, expect, it } from "vitest";
import { ROLE_CONTROLS, camDistOf, stepBody, type Body, type MoveKeys } from "./roleControls";
import type { Surface } from "./witness";

const NONE: MoveKeys = { fwd: false, back: false, left: false, right: false };
const DRAG = 5.64; // 점성 0.72: 2 + (1 − 0.72) · 13
const DT = 1 / 60;

function run(role: keyof typeof ROLE_CONTROLS, keys: MoveKeys, sec: number, b: Body = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 }, surface?: Surface) {
  for (let t = 0; t < sec; t += DT) stepBody(b, keys, ROLE_CONTROLS[role].motion, { dt: DT, drag: DRAG, gain: 1, surface });
  return b;
}
const speed = (b: Body) => Math.hypot(b.vx, b.vz);

describe("role controls", () => {
  it("the worker walks as before (forward 7, sidestep 4.5, back 0.4 × 7)", () => {
    const b = run("worker", { ...NONE, fwd: true }, 3);
    expect(b.vz).toBeCloseTo(7, 1);
    const s = run("worker", { ...NONE, right: true }, 3);
    expect(s.vx).toBeCloseTo(-4.5, 1); // right of heading 0 is −x
    const bk = run("worker", { ...NONE, back: true }, 3);
    expect(bk.vz).toBeCloseTo(-2.8, 1);
  });

  it("the cat gets up to speed and stops sooner than the worker", () => {
    const w = run("worker", { ...NONE, fwd: true }, 0.2);
    const c = run("cat", { ...NONE, fwd: true }, 0.2);
    expect(speed(c) / 10).toBeGreaterThan(speed(w) / 7);
    run("worker", NONE, 0.3, w);
    run("cat", NONE, 0.3, c);
    expect(speed(c)).toBeLessThan(speed(w));
  });

  it("the car cannot sidestep, and cannot turn at a standstill", () => {
    const b = run("car", { ...NONE, right: true }, 2);
    expect(b.x).toBe(0);
    expect(b.z).toBe(0);
    expect(b.yaw).toBe(0);
  });

  it("the car steers while rolling, and never slides sideways", () => {
    const b = run("car", { ...NONE, fwd: true }, 3, undefined, "sealed");
    run("car", { ...NONE, fwd: true, right: true }, 1, b, "sealed");
    expect(b.yaw).toBeLessThan(-0.5); // turned right
    // its velocity points along its heading
    const side = b.vx * -Math.cos(b.yaw) + b.vz * Math.sin(b.yaw);
    expect(Math.abs(side)).toBeLessThan(1e-9);
  });

  it("the car is fast on sealed ground and slow on open ground", () => {
    const sealed = run("car", { ...NONE, fwd: true }, 20, undefined, "sealed");
    const open = run("car", { ...NONE, fwd: true }, 20, undefined, "open");
    expect(speed(sealed)).toBeGreaterThan(12);
    expect(speed(open)).toBeLessThan(5);
  });

  it("the car rolls out long, brakes hard to a stop, and only then reverses", () => {
    const roll = run("car", { ...NONE, fwd: true }, 20, undefined, "sealed");
    const brake = { ...roll };
    run("car", NONE, 1, roll, "sealed");
    run("car", { ...NONE, back: true }, 0.6, brake, "sealed");
    expect(speed(roll)).toBeGreaterThan(9);
    expect(speed(brake)).toBeLessThan(1);
    const v = (b: Body) => b.vx * Math.sin(b.yaw) + b.vz * Math.cos(b.yaw);
    expect(v(brake)).toBeGreaterThanOrEqual(0); // braked, not yet reversing
    run("car", { ...NONE, back: true }, 10, brake, "sealed");
    expect(v(brake)).toBeCloseTo(-4, 0);
  });

  it("the tree stays where it stands: the keys only sway it, and it springs back", () => {
    const b = run("tree", { ...NONE, fwd: true, left: true }, 10, { x: 3, z: -2, vx: 0, vz: 0, yaw: 1 });
    expect(Math.hypot(b.x - 3, b.z + 2)).toBeLessThanOrEqual(ROLE_CONTROLS.tree.motion.sway! + 1e-9);
    expect(Math.hypot(b.x - 3, b.z + 2)).toBeGreaterThan(0.2);
    expect(speed(b)).toBe(0);
    run("tree", NONE, 10, b);
    expect(Math.hypot(b.x - 3, b.z + 2)).toBeLessThan(0.01);
  });

  it("the tree's eye rises over the lifespan; the others' stays", () => {
    expect(camDistOf(ROLE_CONTROLS.tree.cam, 1)).toBeCloseTo(3 * camDistOf(ROLE_CONTROLS.tree.cam, 0));
    expect(camDistOf(ROLE_CONTROLS.worker.cam, 1)).toBe(1);
  });
});
