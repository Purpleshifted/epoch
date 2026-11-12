import { describe, expect, it } from "vitest";
import { ARRIVED, Arrivals, KEEP_S, arriveOrder } from "./arrive";
import { DEFAULT_BOXES, PART_KINDS, boxesOfSeed, type Box, type PartKind, type Seed } from "./seeds";

const box = (kind: PartKind, slot: number, seed = 1): Box => ({ kind, seed, material: "concrete", x: 0, y: slot, z: 0, sx: 1, sy: 1, sz: 1, tone: 0.5, along: 0, slot });
const born = (a: Arrivals, b: Box): number => a.of(b)?.[0] ?? ARRIVED;

describe("arrivals: when a part was first there", () => {
  it("a new building's parts are born now; regenerated, the same parts keep their time and only the new ones are new", () => {
    const a = new Arrivals();
    const first = [box("mass", 3), box("mass", 3), box("slab", 3)];
    a.note(1, 0, first, 10, false);
    expect(first.map((b) => born(a, b))).toEqual([10, 10, 10]);
    // the building gained a slot and one more mass in the old slot: every Box is a new object
    const again = [box("mass", 3), box("mass", 3), box("mass", 3), box("slab", 3), box("mass", 4)];
    a.note(1, 0, again, 12, false);
    expect(again.map((b) => born(a, b))).toEqual([10, 10, 12, 10, 12]);
  });

  it("a neighbour changing does not touch a building; parts long there are simply there", () => {
    const a = new Arrivals();
    const mine = [box("mass", 0, 1)];
    a.note(1, 0, mine, 5, false);
    a.note(2, 0, [box("mass", 0, 2)], 50, false);
    expect(born(a, mine[0])).toBe(5);
    // regenerated long after: nothing of it replays
    const later = [box("mass", 0, 1), box("column", 0, 1)];
    a.note(1, 0, later, 5 + KEEP_S + 1, false);
    expect(born(a, later[0])).toBe(ARRIVED);
    expect(born(a, later[1])).toBe(5 + KEEP_S + 1);
  });

  it("quiet (a load, a knob) and another level of detail are not building", () => {
    const a = new Arrivals();
    const loaded = [box("mass", 0), box("mass", 1)];
    a.note(1, 0, loaded, 0, true);
    expect(loaded.map((b) => born(a, b))).toEqual([ARRIVED, ARRIVED]);
    expect(a.any(0)).toBe(false);
    // the camera came near: more parts of the same building (slats), none of them built now
    const near = [box("mass", 0), box("mass", 0), box("mass", 0), box("mass", 1)];
    a.note(1, 1, near, 20, false);
    expect(near.map((b) => born(a, b))).toEqual([ARRIVED, ARRIVED, ARRIVED, ARRIVED]);
    // at the same level a new slot is built
    const grown = [...near.map((b) => ({ ...b })), box("mass", 2)];
    a.note(1, 1, grown, 30, false);
    expect(grown.map((b) => born(a, b))).toEqual([ARRIVED, ARRIVED, ARRIVED, ARRIVED, 30]);
    expect(a.any(30)).toBe(true);
    expect(a.any(30 + KEEP_S + 1)).toBe(false);
  });

  it("a building that is gone is forgotten: back again, it is built again", () => {
    const a = new Arrivals();
    a.note(1, 0, [box("mass", 0)], 1, true);
    a.keep(new Set());
    const back = [box("mass", 0)];
    a.note(1, 0, back, 9, false);
    expect(born(a, back[0])).toBe(9);
  });

  it("the order within a slot: 0 … 1, the ground before the masses before what hangs", () => {
    for (const k of PART_KINDS) for (let i = 0; i < 50; i++) {
      const o = arriveOrder(k, i);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
    expect(arriveOrder("basement", 0)).toBeLessThan(arriveOrder("mass", 0));
    expect(arriveOrder("mass", 0)).toBeLessThan(arriveOrder("drip", 0));
  });

  it("boxesOfSeed is untouched: noting its parts changes none of them", () => {
    const seed: Seed = { id: 7, material: "concrete", role: "worker", x: 2, z: 2, t0: 0, t1: 100, mass: 2 } as Seed;
    const parts = boxesOfSeed(seed, DEFAULT_BOXES);
    const before = JSON.stringify(parts);
    new Arrivals().note(seed.id, 0, parts, 3, false);
    expect(JSON.stringify(parts)).toBe(before);
    expect(JSON.stringify(boxesOfSeed(seed, DEFAULT_BOXES))).toBe(before);
  });
});
