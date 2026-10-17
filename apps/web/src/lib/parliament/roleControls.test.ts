import { describe, expect, it } from "vitest";
import { FULL_ROAD_P, ROAD_P, ROLE_CONTROLS, camDistOf, roadSpeed, stepBody, yawAlong, type Body, type Ground, type MoveKeys } from "./roleControls";

const NONE: MoveKeys = { fwd: false, back: false, left: false, right: false };
const DRAG = 5.64; // 점성 0.72: 2 + (1 − 0.72) · 13
const DT = 1 / 60;
const SEALED: Ground = { surface: "sealed", p: 0 };
const OPEN: Ground = { surface: "open", p: 0 };
/** A clean road running along x (axis = atan2(dz, dx) = 0), fully formed, every tread on one line. */
const ROAD_X: Ground = { surface: "trodden", p: 1, axis: 0, align: 1 };
/** A crossing: a path, but the treads do not agree on a line. */
const CROSSING: Ground = { surface: "trodden", p: 1, axis: 0, align: 0 };

function run(role: keyof typeof ROLE_CONTROLS, keys: MoveKeys, sec: number, b: Body = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 }, ground?: Ground) {
  for (let t = 0; t < sec; t += DT) stepBody(b, keys, ROLE_CONTROLS[role].motion, { dt: DT, drag: DRAG, gain: 1, ground });
  return b;
}
const speed = (b: Body) => Math.hypot(b.vx, b.vz);
const along = (b: Body) => b.vx * Math.sin(b.yaw) + b.vz * Math.cos(b.yaw);

describe("role controls", () => {
  it("the worker walks as before (forward 7, sidestep 4.5, back 2.8)", () => {
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
    const b = run("car", { ...NONE, right: true }, 2, undefined, SEALED);
    expect(b.x).toBe(0);
    expect(b.z).toBe(0);
    expect(b.yaw).toBe(0);
  });

  it("the car steers while rolling on sealed ground, and never slides sideways", () => {
    const b = run("car", { ...NONE, fwd: true }, 3, undefined, SEALED);
    run("car", { ...NONE, fwd: true, right: true }, 1, b, SEALED);
    expect(b.yaw).toBeLessThan(-0.5); // turned right
    const side = b.vx * -Math.cos(b.yaw) + b.vz * Math.sin(b.yaw);
    expect(Math.abs(side)).toBeLessThan(1e-9);
  });

  it("the car's speed comes from the ground: full on sealed ground and a formed road, a crawl off the road", () => {
    const crawl = ROLE_CONTROLS.car.motion.crawl!;
    expect(roadSpeed(SEALED, crawl)).toBe(1);
    expect(roadSpeed(OPEN, crawl)).toBe(crawl);
    expect(roadSpeed(undefined, crawl)).toBe(crawl);
    expect(roadSpeed({ surface: "trodden", p: ROAD_P, axis: 0, align: 1 }, crawl)).toBeCloseTo(crawl);
    expect(roadSpeed({ surface: "trodden", p: FULL_ROAD_P, axis: 0, align: 1 }, crawl)).toBe(1);
    const road = run("car", { ...NONE, fwd: true }, 20, undefined, ROAD_X);
    const open = run("car", { ...NONE, fwd: true }, 20, undefined, OPEN);
    expect(speed(road)).toBeGreaterThan(12);
    expect(speed(open)).toBeLessThan(1.5);
    expect(speed(open)).toBeGreaterThan(0.5); // it does move, slowly
  });

  it("on a road the car runs on rails: its heading turns onto the road's line, the nearer way, and A/D do nothing", () => {
    // heading +z (yaw 0) onto a road along x: the nearer way is +x (yaw π/2)
    const b = run("car", { ...NONE, fwd: true }, 4, { x: 0, z: 0, vx: 0, vz: 0, yaw: 0.2 }, ROAD_X);
    expect(Math.abs(b.yaw - Math.PI / 2)).toBeLessThan(0.02);
    expect(Math.abs(along(b))).toBeGreaterThan(12);
    // heading −x-ish stays −x
    const c = run("car", { ...NONE, fwd: true }, 4, { x: 0, z: 0, vx: 0, vz: 0, yaw: -Math.PI / 2 + 0.3 }, ROAD_X);
    expect(Math.abs(c.yaw + Math.PI / 2)).toBeLessThan(0.02);
    // steering on a clean road does not turn it off the line
    run("car", { ...NONE, fwd: true, right: true }, 2, b, ROAD_X);
    expect(Math.abs(b.yaw - Math.PI / 2)).toBeLessThan(0.02);
    expect(yawAlong(0)).toBeCloseTo(Math.PI / 2);
    expect(yawAlong(Math.PI / 2)).toBeCloseTo(0);
  });

  it("at a crossing (the treads disagree) and off the road the car steers freely", () => {
    const x = run("car", { ...NONE, fwd: true }, 3, undefined, CROSSING);
    run("car", { ...NONE, fwd: true, right: true }, 1, x, CROSSING);
    expect(x.yaw).toBeLessThan(-0.5);
    const o = run("car", { ...NONE, fwd: true }, 6, undefined, OPEN);
    run("car", { ...NONE, fwd: true, left: true }, 2, o, OPEN);
    expect(o.yaw).toBeGreaterThan(0.5);
  });

  it("the car rolls out long, brakes hard to a stop, and only then reverses", () => {
    const roll = run("car", { ...NONE, fwd: true }, 20, undefined, SEALED);
    const brake = { ...roll };
    run("car", NONE, 1, roll, SEALED);
    run("car", { ...NONE, back: true }, 0.6, brake, SEALED);
    expect(speed(roll)).toBeGreaterThan(9);
    expect(speed(brake)).toBeLessThan(1);
    expect(along(brake)).toBeGreaterThanOrEqual(0); // braked, not yet reversing
    run("car", { ...NONE, back: true }, 10, brake, SEALED);
    expect(along(brake)).toBeCloseTo(-4, 0);
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
