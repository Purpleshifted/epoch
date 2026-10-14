import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_NATURE, type PEvent, type Snapshot } from "@/lib/parliament";
import { DEFAULT_SIGNALS, personalSignals } from "./signals";

const ev = (o: string, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });
const me = (x: number, z: number, vx = 0, vz = 0) => ({ id: "v_me", x, z, vx, vz });
const base = { events: [] as PEvent[], sNow: 100, snap: null, stress: null, natureCfg: DEFAULT_NATURE };

describe("signals: what the player hears, from the same log", () => {
  it("speed is the visitor's own velocity", () => {
    expect(personalSignals({ ...base, me: me(0, 0, 3, 4) }).speed).toBeCloseTo(5);
  });

  it("stay: standing for staySec → 1, having walked away → 0", () => {
    const standing = Array.from({ length: 8 }, (_, t) => ev("v_me", 0.1 * Math.sin(t), 0, 100 - t));
    expect(personalSignals({ ...base, me: me(0, 0), events: standing }).stay).toBeCloseTo(1);
    const walked = Array.from({ length: 8 }, (_, t) => ev("v_me", -t * 1.5, 0, 100 - t));
    expect(personalSignals({ ...base, me: me(0, 0), events: walked }).stay).toBe(0);
    // what I did more than staySec ago does not count
    const longAgo = [ev("v_me", 20, 0, 100 - DEFAULT_SIGNALS.staySec - 1)];
    expect(personalSignals({ ...base, me: me(0, 0), events: longAgo }).stay).toBeCloseTo(1);
  });

  it("neighbours: the latest sample of each person within earshot and recent, nearest first, bots flagged", () => {
    const events = [
      ev("v_a", 10, 0, 90), // old position
      ev("v_a", 2, 0, 99), // where they are now
      ev("bot3", 0, 5, 100),
      ev("v_far", 30, 0, 100), // out of earshot
      ev("v_gone", 1, 1, 100 - DEFAULT_SIGNALS.recentSec - 1), // went quiet
      ev("v_future", 1, 0, 101), // not yet (from a later time)
      ev("v_me", 0, 0, 100),
    ];
    const s = personalSignals({ ...base, me: me(0, 0), events });
    expect(s.neighbours.map((n) => n.o)).toEqual(["v_a", "bot3"]);
    expect(s.neighbours[0].dist).toBeCloseTo(2);
    expect(s.neighbours[0].angle).toBeCloseTo(Math.PI / 2); // +x
    expect(s.neighbours[1].bot).toBe(true);
    expect(s.neighbours[1].angle).toBeCloseTo(0); // +z
  });

  it("ground: path under the feet, concrete nearby, vegetation around", () => {
    const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
    const snap: Snapshot = {
      slabs: [{ key: key(0, 0), x: CELL_SIZE / 2, z: CELL_SIZE / 2, h: 2, raw: 2, foot: 1, bornS: 0, lastS: 100 }],
      paths: [{ key: key(6, 6), x: 6, z: 6, p: 0.7, visits: 9 }],
    };
    const onSlab = personalSignals({ ...base, me: me(CELL_SIZE / 2, CELL_SIZE / 2), snap });
    expect(onSlab.sealed).toBeCloseTo(1);
    const onPath = personalSignals({ ...base, me: me(6, 6), snap });
    expect(onPath.pathP).toBeCloseTo(0.7);
    expect(onPath.sealed).toBe(0);
    expect(onPath.grass).toBeLessThan(personalSignals({ ...base, me: me(40, 40), snap }).grass);
    const open = personalSignals({ ...base, me: me(40, 40), snap });
    expect(open.grass).toBeGreaterThan(0.2);
    expect(open.grass).toBeLessThanOrEqual(1);
  });

  it("concrete a little way off dulls the sound in part, out of sealRadius not at all", () => {
    const slab = { key: "0,0", x: 0, z: 0, h: 1, raw: 1, foot: 1, bornS: 0, lastS: 100 };
    const snap: Snapshot = { slabs: [slab], paths: [] };
    const mid = personalSignals({ ...base, me: me(1.8, 0), snap }).sealed;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(personalSignals({ ...base, me: me(10, 0), snap }).sealed).toBe(0);
  });
});
