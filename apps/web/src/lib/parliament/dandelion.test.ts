/**
 * What an answer leaves (dandelion.ts): a head from one event, its seeds leaving one by one, where they land.
 */
import { describe, expect, it } from "vitest";
import { SEEDS_PER_HEAD, dandelionShape, dandelionsIn, wordSpots, type Dandelion, type PEvent } from "./index";

const head: Dandelion = { id: "v_a:t:1", o: "v_a", x: 10, z: -4, s: 100 };
const shape = (age: number) => {
  const lines: number[] = [], dots: number[] = [];
  dandelionShape(head.id, age, head.x, 5, head.z, 1, lines, dots);
  return { spokes: lines.length / 6 - 1, seeds: dots.length / 3, dots };
};

describe("the dandelion", () => {
  it("is read from the log's seed events only", () => {
    const events: PEvent[] = [
      { id: "a", o: "v_a", r: "worker", k: "p", x: 1, z: 1, s: 1 },
      { id: "b", o: "v_a", r: "tree", k: "s", x: 2, z: 3, s: 4 },
    ];
    expect(dandelionsIn(events)).toEqual([{ id: "b", o: "v_a", x: 2, z: 3, s: 4 }]);
  });

  it("stands whole at first, thins as the seeds leave, and always keeps a few; no seed is ever lost", () => {
    expect(shape(0).spokes).toBe(SEEDS_PER_HEAD);
    const later = shape(40).spokes;
    expect(later).toBeLessThan(SEEDS_PER_HEAD);
    const old = shape(100000);
    expect(old.spokes).toBeGreaterThan(0);
    expect(old.spokes).toBeLessThan(later + 1);
    for (const age of [0, 40, 100000]) expect(shape(age).seeds).toBe(SEEDS_PER_HEAD);
  });

  it("is the same for the same event, and the seeds come down at the foot's height", () => {
    expect(shape(30)).toEqual(shape(30));
    const landed: number[] = [];
    const { dots } = shape(100000);
    for (let i = 1; i < dots.length; i += 3) if (Math.abs(dots[i] - 5) < 1e-9) landed.push(dots[i]);
    expect(landed.length).toBeGreaterThan(SEEDS_PER_HEAD / 2);
  });

  it("offers others' words at the head and where its seeds have landed, never my own", () => {
    expect(wordSpots([head], "v_a", 100000)).toEqual([]);
    const fresh = wordSpots([head], "v_me", 100);
    expect(fresh).toEqual([{ o: "v_a", x: 10, z: -4 }]);
    const old = wordSpots([head], "v_me", 100000);
    expect(old.length).toBeGreaterThan(5);
    expect(old.every((w) => w.o === "v_a")).toBe(true);
    expect(old.some((w) => w.x !== 10 || w.z !== -4)).toBe(true);
  });
});
