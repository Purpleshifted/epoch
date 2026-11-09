/**
 * Whose house it is while it grows (spaceModel.handsOf): what the wall outlines around a person's marker.
 */
import { describe, expect, it } from "vitest";
import { handsOf, trailSegments } from "./spaceModel";
import type { PEvent } from "./types";
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

describe("where people walked", () => {
  const p = (o: string, s: number, x: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z: 5, s });
  it("a line between a person's steps at the height of their time; none for bots, for standing, or across a gap", () => {
    const events = [p("v_a", 2, 14), p("v_a", 0, 10), p("v_a", 1, 12), p("v_a", 3, 14), p("v_a", 60, 16), p("bot1", 0, 10), p("bot1", 1, 12)];
    expect([...trailSegments(events, 20, 2)]).toEqual([10, 0, 5, 12, 0.1, 5, 12, 0.1, 5, 14, 0.2, 5].map((v) => Math.fround(v)));
  });
});
