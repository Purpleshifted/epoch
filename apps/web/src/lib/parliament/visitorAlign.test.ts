import { describe, expect, it } from "vitest";
import { DEFAULT_ALIGN, VisitorTracker, azimuthBehind, createAlignMotion, dampTo, shortestDeg, stepAlign } from "./visitorAlign";
import { WORLD_HALF } from "./world";

let seq = 0;
const p = (o: string, x: number, z: number) => ({ id: `${o}:${seq++}`, o, k: "p", x, z });

/** A log that grows: the tracker reads only what is new. */
function world() {
  const log: ReturnType<typeof p>[] = [p("old", 0, 0)];
  const tr = new VisitorTracker();
  tr.feed(log, 0);
  const walk = (o: string, at: number, x: number, z: number) => {
    log.push(p(o, x, z));
    tr.feed(log, at);
    return tr.update(at, DEFAULT_ALIGN);
  };
  return { log, tr, walk };
}

describe("who holds the wall's camera", () => {
  it("whoever moves first; nobody before they have moved", () => {
    const { walk } = world();
    expect(walk("a", 0, 0, 0)).toBeNull(); // the marker is up, but no direction yet
    expect(walk("a", 1000, 0.5, 0)).toBeNull(); // a wobble is not movement
    const h = walk("a", 2000, 0, 2);
    expect(h?.id).toBe("a");
    expect(h?.heading).toBeCloseTo(0); // +z: yaw 0
    expect(walk("b", 3000, 5, 5)?.id).toBe("a");
    expect(walk("b", 4000, 8, 5)?.id).toBe("a");
  });

  it("the direction of travel, as the phone's yaw, and across the world's edge the short way", () => {
    const { walk } = world();
    walk("a", 0, 0, 0);
    expect(walk("a", 1000, 3, 0)?.heading).toBeCloseTo(Math.PI / 2); // +x
    const { walk: w2 } = world();
    w2("e", 0, WORLD_HALF - 1, 0);
    expect(w2("e", 1000, -WORLD_HALF + 1, 0)?.heading).toBeCloseTo(Math.PI / 2); // over the edge: still +x
  });

  it("standing still keeps the last direction, then lets the camera go", () => {
    const { walk, tr } = world();
    walk("a", 0, 0, 0);
    expect(walk("a", 1000, 3, 0)?.heading).toBeCloseTo(Math.PI / 2);
    expect(walk("a", 15000, 3, 0)?.heading).toBeCloseTo(Math.PI / 2);
    expect(tr.update(1000 + 20000, DEFAULT_ALIGN)?.id).toBe("a");
    expect(tr.update(1000 + 20001, DEFAULT_ALIGN)).toBeNull();
  });

  it("bots never hold it, and owners already in the log count only with something new", () => {
    const { walk, tr, log } = world();
    expect(walk("bot17", 0, 0, 0)).toBeNull();
    expect(walk("bot17", 1000, 9, 9)).toBeNull();
    expect(tr.tracks.has("bot17")).toBe(false);
    expect(tr.tracks.has("old")).toBe(false);
    log.push(p("old", 1, 1));
    tr.feed(log, 2000);
    expect(tr.tracks.has("old")).toBe(true);
  });

  it("passes on after the hold while others move, and comes back; alone it stays", () => {
    const { walk } = world();
    let x = 0;
    let at = 0;
    /** Both keep walking, a sample a second, until `until`: who holds the camera then. */
    const both = (until: number) => {
      let h = null;
      while (at < until) {
        at += 1000;
        x += 3;
        walk("a", at, x, 0);
        h = walk("b", at, 0, x);
      }
      return h;
    };
    walk("a", 0, 0, 0);
    walk("b", 0, 0, 0);
    expect(both(1000)?.id).toBe("a");
    expect(both(30000)?.id).toBe("a");
    expect(both(31000)?.id).toBe("b");
    expect(both(60000)?.id).toBe("b");
    expect(both(61000)?.id).toBe("a");
    const solo = world();
    solo.walk("c", 0, 0, 0);
    solo.walk("c", 1000, 3, 0);
    expect(solo.walk("c", 40000, 6, 0)?.id).toBe("c");
  });

  it("a new world (the last event gone) is old news, as when the view opened", () => {
    const { tr } = world();
    tr.feed([p("x", 0, 0), p("x", 5, 5)], 1000);
    expect(tr.tracks.size).toBe(0);
  });
});

describe("the angle and the look point", () => {
  it("the camera stands opposite the direction of travel", () => {
    expect(azimuthBehind(0)).toBeCloseTo(180); // walking +z: the camera at −z
    expect(azimuthBehind(Math.PI / 2)).toBeCloseTo(270); // walking +x: the camera at −x
  });

  it("takes the short way round", () => {
    expect(shortestDeg(350)).toBeCloseTo(-10);
    expect(shortestDeg(-350)).toBeCloseTo(10);
    expect(shortestDeg(180)).toBeCloseTo(180);
  });

  it("damps without overshoot, no jump in speed, and keeps to the speed limit", () => {
    const d = { value: 0, speed: 0 };
    dampTo(d, 100, 2.5, 30, 1 / 60);
    expect(d.value).toBeLessThan(0.5); // starts gently
    let top = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const before = d.value;
      dampTo(d, 100, 2.5, 30, 1 / 60);
      top = Math.max(top, (d.value - before) * 60);
      expect(d.value).toBeLessThanOrEqual(100.0001);
    }
    expect(top).toBeLessThanOrEqual(30.5);
    expect(d.value).toBeCloseTo(100, 1);
    const off = { value: 3, speed: 1 };
    dampTo(off, 7, 0, 30, 1 / 60);
    expect(off).toEqual({ value: 7, speed: 0 }); // no time constant: at once
  });

  it("turns to the goal through 0° and the look point lags a walker by speed × time constant", () => {
    const m = createAlignMotion();
    let az = 350;
    let x = 0;
    let goalX = 0;
    for (let i = 0; i < 60 * 30; i++) {
      goalX += 7 / 60;
      stepAlign(m, az, x, 0, 10, goalX, 0, DEFAULT_ALIGN, 1 / 60);
      az = m.az.value;
      x = m.x.value;
    }
    expect(shortestDeg(az - 10)).toBeCloseTo(0, 1);
    expect(goalX - x).toBeCloseTo(7 * DEFAULT_ALIGN.lookSec, 0); // the marker runs ahead on the wall while it walks
  });

  it("with nobody to follow the angle stays and its speed runs out", () => {
    const m = createAlignMotion();
    m.az.speed = 10;
    let az = 40;
    stepAlign(m, az, 0, 0, null, 0, 0, DEFAULT_ALIGN, 1 / 60);
    expect(m.az.value).toBeGreaterThan(40);
    for (let i = 0; i < 60 * 20; i++) {
      az = m.az.value;
      stepAlign(m, az, 0, 0, null, 0, 0, DEFAULT_ALIGN, 1 / 60);
    }
    expect(Math.abs(m.az.speed)).toBeLessThan(0.01);
  });
});
