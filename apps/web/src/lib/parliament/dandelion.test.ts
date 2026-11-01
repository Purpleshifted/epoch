/**
 * What an answer leaves (dandelion.ts): a head from one event, its life and its jitter, the points thrown when it is born,
 * where its word is found.
 */
import { describe, expect, it } from "vitest";
import { NO_JITTER, SEEDS_PER_HEAD, STEM, dandelionShape, dandelionsIn, headScale, headVariation, scatterPoints, wordSpots, type Dandelion, type HeadDraw, type HeadLife, type PEvent, type Scatter } from "./index";

const head: Dandelion = { id: "v_a:t:1", o: "v_a", x: 10, z: -4, s: 100 };
const whole: HeadDraw = { size: 1, stem: 1, shape: 0, dot: 0.2, dotJitter: 0 };
const shape = (h: HeadDraw = whole) => {
  const lines: number[] = [], dots: number[] = [], sizes: number[] = [];
  const cy = dandelionShape(head.id, head.x, 5, head.z, h, lines, dots, sizes);
  return { spokes: lines.length / 6 - 1, seeds: dots.length / 3, dots, sizes, cy };
};

const plain: Scatter = { count: 50, reach: 10, lifeSec: 20, wind: 0, rise: 0, waver: 0, from: 0 };
const thrown = (age: number, c: Scatter = plain) => {
  const pos = new Float32Array(300 * 3);
  const light = new Float32Array(300);
  const size = new Float32Array(300);
  const n = scatterPoints(head.id, age, 0, 0, 0, c, { pos, light, size });
  return { n, pos, light, size };
};
const distOf = (pos: Float32Array, i: number) => Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

describe("the dandelion", () => {
  it("is read from the log's seed events only", () => {
    const events: PEvent[] = [
      { id: "a", o: "v_a", r: "worker", k: "p", x: 1, z: 1, s: 1 },
      { id: "b", o: "v_a", r: "tree", k: "s", x: 2, z: 3, s: 4 },
    ];
    expect(dandelionsIn(events)).toEqual([{ id: "b", o: "v_a", x: 2, z: 3, s: 4 }]);
  });

  it("stands whole, a stem and all its spokes with a seed on each, the same for the same event", () => {
    expect(shape().spokes).toBe(SEEDS_PER_HEAD);
    expect(shape().seeds).toBe(SEEDS_PER_HEAD);
    expect(shape().cy).toBeCloseTo(5 + STEM);
    expect(shape()).toEqual(shape());
    expect(new Set(shape().sizes).size).toBe(1);
  });

  it("with jitter its spokes and seeds differ, and a longer stem lifts the ball", () => {
    const rough = shape({ ...whole, shape: 0.6, dotJitter: 0.6 });
    expect(new Set(rough.sizes).size).toBeGreaterThan(5);
    expect(rough.dots).not.toEqual(shape().dots);
    expect(shape({ ...whole, stem: 2 }).cy).toBeCloseTo(5 + 2 * STEM);
  });

  it("offers others' words at the head and where the wind has carried them, never my own", () => {
    expect(wordSpots([head], "v_a", 100000)).toEqual([]);
    const fresh = wordSpots([head], "v_me", 100);
    expect(fresh).toEqual([{ o: "v_a", x: 10, z: -4 }]);
    const old = wordSpots([head], "v_me", 100000);
    expect(old.length).toBeGreaterThan(5);
    expect(old.every((w) => w.o === "v_a")).toBe(true);
    expect(old.some((w) => w.x !== 10 || w.z !== -4)).toBe(true);
  });
});

describe("a head's life", () => {
  const life: HeadLife = { settle: 0.5, settleSec: 10, fossilDepth: 45, fossilSpread: 0, keep: 0.4 };
  const stays = { ...headVariation("x", NO_JITTER), fate: 0.1, early: 0 };
  const goes = { ...stays, fate: 0.9 };
  const DUST = 40;

  it("is large while its powder flies, then shrinks to its settled size and stays there", () => {
    expect(headScale(stays, 0, 0, DUST, life)).toBe(1);
    expect(headScale(stays, DUST - 1, 0, DUST, life)).toBe(1);
    const mid = headScale(stays, DUST + 5, 0, DUST, life);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.5);
    expect(headScale(stays, DUST + 10, 0, DUST, life)).toBe(0.5);
    expect(headScale(stays, 100000, 0, DUST, life)).toBe(0.5);
  });

  it("one that was already there when the wall opened has long settled", () => {
    expect(headScale(stays, null, 0, DUST, life)).toBe(0.5);
  });

  it("where it fossilises, some go and some stay", () => {
    expect(headScale(goes, null, 44, DUST, life)).toBe(0.5);
    const going = headScale(goes, null, 46, DUST, life);
    expect(going).toBeLessThan(0.5);
    expect(going).toBeGreaterThan(0);
    expect(headScale(goes, null, 48, DUST, life)).toBe(0);
    expect(headScale(goes, null, 400, DUST, life)).toBe(0);
    expect(headScale(stays, null, 400, DUST, life)).toBe(0.5);
  });

  it("the keep share decides how many stay, over many heads", () => {
    const share = (keep: number) => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (headScale(headVariation(`h${i}`, NO_JITTER), null, 400, DUST, { ...life, keep }) > 0) n++;
      return n / 400;
    };
    expect(share(0)).toBe(0);
    expect(share(1)).toBe(1);
    expect(share(0.35)).toBeGreaterThan(0.25);
    expect(share(0.35)).toBeLessThan(0.45);
  });

  it("the depth differs between heads by the spread", () => {
    const early = { ...goes, early: -1 };
    const late = { ...goes, early: 1 };
    const c = { ...life, fossilSpread: 6 };
    expect(headScale(early, null, 42, DUST, c)).toBe(0);
    expect(headScale(late, null, 50, DUST, c)).toBe(0.5);
  });
});

describe("the jitter", () => {
  it("nothing varies at zero; at one, the multipliers stay within a third to three times", () => {
    const v = headVariation(head.id, NO_JITTER);
    for (const m of [v.size, v.stem, v.dustCount, v.dustReach, v.dustSec]) expect(m).toBe(1);
    const full = { size: 1, shape: 1, dot: 1, dustCount: 1, dustReach: 1, dustSec: 1 };
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const w = headVariation(`h${i}`, full);
      for (const m of [w.size, w.stem, w.dustCount, w.dustReach, w.dustSec]) {
        expect(m).toBeGreaterThanOrEqual(1 / 3);
        expect(m).toBeLessThanOrEqual(3);
      }
      seen.add(w.size);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it("a head's fate does not change with the jitter", () => {
    expect(headVariation(head.id, { ...NO_JITTER, size: 1 }).fate).toBe(headVariation(head.id, NO_JITTER).fate);
  });
});

describe("a scatter", () => {
  it("starts whole at its centre, thins, and is gone at the end of its life", () => {
    const start = thrown(0);
    expect(start.n).toBe(plain.count);
    for (let i = 0; i < start.n; i++) expect(distOf(start.pos, i)).toBeCloseTo(0, 5);
    const mid = thrown(plain.lifeSec * 0.6).n;
    expect(mid).toBeLessThan(plain.count);
    expect(mid).toBeGreaterThan(0);
    expect(thrown(plain.lifeSec).n).toBe(0);
  });

  it("goes outwards, never past its reach, and its light goes down", () => {
    const later = thrown(5);
    const sooner = thrown(1);
    let farther = 0;
    for (let i = 0; i < later.n; i++) expect(distOf(later.pos, i)).toBeLessThanOrEqual(plain.reach);
    for (let i = 0; i < sooner.n; i++) farther = Math.max(farther, distOf(sooner.pos, i));
    expect(farther).toBeGreaterThan(0);
    expect(later.light[0]).toBeLessThan(sooner.light[0]);
    expect(sooner.light[0]).toBeLessThan(1);
  });

  it("is the same for the same id at the same age", () => {
    expect(thrown(3).pos).toEqual(thrown(3).pos);
  });

  it("gives each grain a size of its own with jitter, one size without", () => {
    const sizesOf = (dotJitter: number) => new Set(thrown(0, { ...plain, dot: 0.2, dotJitter }).size.slice(0, plain.count));
    expect(sizesOf(0).size).toBe(1);
    expect(sizesOf(0.5).size).toBeGreaterThan(20);
  });

  it("with the wind goes mostly one way, without it every way", () => {
    const meanLength = (c: Scatter) => {
      const { n, pos } = thrown(1, c);
      let mx = 0, mz = 0, len = 0;
      for (let i = 0; i < n; i++) {
        mx += pos[i * 3];
        mz += pos[i * 3 + 2];
        len += Math.hypot(pos[i * 3], pos[i * 3 + 2]);
      }
      return Math.hypot(mx, mz) / len; // 1: all one way, 0: all ways
    };
    expect(meanLength({ ...plain, wind: 0.9 })).toBeGreaterThan(0.8);
    expect(meanLength(plain)).toBeLessThan(0.4);
  });

  it("appends after what is already written and stops when the buffer is full", () => {
    const pos = new Float32Array(30 * 3);
    expect(scatterPoints(head.id, 0, 0, 0, 0, { ...plain, count: 20 }, { pos }, 5)).toBe(25);
    expect(scatterPoints(head.id, 0, 0, 0, 0, plain, { pos })).toBe(30);
  });
});
