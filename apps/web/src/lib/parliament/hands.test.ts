/**
 * Whose house it is while it grows (spaceModel.handsOf): what the wall outlines around a person's marker.
 */
import { describe, expect, it } from "vitest";
import { handsOf } from "./spaceModel";
import type { Seed } from "./seeds";

const seed = (x: number, t1: number, who: [string, number][]): Seed => ({ id: x, material: "concrete", role: "worker", x, z: 0, t0: 0, t1, mass: 50, who: who.map(([o, last]) => ({ o, first: 0, last, amount: 1 })) });

describe("the cells people are building now", () => {
  it("a person whose weight went in just now, never a bot, never a cell left a while ago", () => {
    const seeds = [seed(1, 100, [["v_a", 100], ["bot1", 100]]), seed(2, 100, [["v_a", 90], ["bot2", 100]]), seed(3, 80, [["v_b", 80]]), seed(4, 99, [["v_b", 98], ["v_a", 99]])];
    expect(handsOf(seeds, 100)).toEqual([
      { o: "v_a", x: 1, z: 0, last: 100 },
      { o: "v_b", x: 4, z: 0, last: 98 },
      { o: "v_a", x: 4, z: 0, last: 99 },
    ]);
  });
});
