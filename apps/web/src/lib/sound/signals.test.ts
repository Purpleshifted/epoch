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

describe("buildings (v4 A4): sealed slabs that touch, their zone, who built them", () => {
  it("joins touching slabs into one building, sums the builders, grows the zone with the mass", async () => {
    const { buildingAround, buildingsOf, ZONE_BASE, ZONE_PER_SQRT_MASS } = await import("./signals");
    const slab = (cx: number, cz: number, raw: number, who: { o: string; amount: number }[]) => ({ key: `${cx},${cz}`, x: (cx + 0.5) * 1.2, z: (cz + 0.5) * 1.2, h: raw, raw, foot: 1, bornS: 0, lastS: 10, who: who.map((w) => ({ ...w, first: 0, last: 10 })) });
    const slabs = [slab(0, 0, 2, [{ o: "a", amount: 5 }]), slab(1, 0, 3, [{ o: "a", amount: 4 }, { o: "b", amount: 6 }]), slab(1, 1, 1, [{ o: "b", amount: 2 }]), slab(10, 10, 4, [{ o: "c", amount: 9 }]), slab(5, 5, 0.05, [{ o: "d", amount: 1 }])];
    const bs = buildingsOf(slabs as never);
    expect(bs).toHaveLength(2); // the low slab at (5,5) is not sealed
    const big = bs.find((b) => b.id === "0,0")!;
    expect(big.mass).toBe(6);
    expect(big.who).toEqual([{ o: "b", amount: 8 }, { o: "a", amount: 9 }].sort((p, q) => q.amount - p.amount));
    expect(big.radius).toBeCloseTo(ZONE_BASE + ZONE_PER_SQRT_MASS * Math.sqrt(6));
    const near = buildingAround(slabs as never, 1.5, 0.5);
    expect(near?.id).toBe("0,0");
    expect(near!.dist).toBeLessThan(2);
    expect(buildingAround(slabs as never, 60, 60)).toBeNull();
  });
});
