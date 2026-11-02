/**
 * What an answer leaves (dandelion.ts): a head from one event, its life and its jitter, the points thrown when it is born,
 * where its word is found.
 */
import { describe, expect, it } from "vitest";
import { MAX_SPOKES, NO_JITTER, dandelionShape, dandelionsIn, headState, headVariation, scatterEndSec, scatterPoints, wordSpots, type Dandelion, type HeadDraw, type HeadLife, type PEvent, type Scatter } from "./index";

const head: Dandelion = { id: "v_a:t:1", o: "v_a", x: 10, z: -4, s: 100 };
const SPOKES = 24;
const whole: HeadDraw = { stem: 0.9, radius: 0.55, spokes: SPOKES, keepSpokes: 1, dome: 0, shape: 0, dot: 0.2, dotJitter: 0 };
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
    expect(shape().spokes).toBe(SPOKES);
    expect(shape().seeds).toBe(SPOKES);
    expect(shape().cy).toBeCloseTo(5.9);
    expect(shape()).toEqual(shape());
    expect(new Set(shape().sizes).size).toBe(1);
  });

  it("with jitter its spokes and seeds differ, and a longer stem lifts the ball", () => {
    const rough = shape({ ...whole, shape: 0.6, dotJitter: 0.6 });
    expect(new Set(rough.sizes).size).toBeGreaterThan(5);
    expect(rough.dots).not.toEqual(shape().dots);
    expect(shape({ ...whole, stem: 2 }).cy).toBeCloseTo(7);
  });

  it("has as many spokes as asked within its buffers, loses some when told, and can gather at the top", () => {
    expect(shape({ ...whole, spokes: 8 }).spokes).toBe(8);
    expect(shape({ ...whole, spokes: 1000 }).spokes).toBe(MAX_SPOKES);
    const few = shape({ ...whole, keepSpokes: 0.5 }).spokes;
    expect(few).toBeGreaterThan(4);
    expect(few).toBeLessThan(SPOKES - 4);
    expect(shape({ ...whole, keepSpokes: 0 }).spokes).toBe(0);
    const dome = shape({ ...whole, dome: 1 });
    for (let i = 1; i < dome.dots.length; i += 3) expect(dome.dots[i]).toBeGreaterThanOrEqual(dome.cy - 1e-9);
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
  const life: HeadLife = { growSec: 0, settle: 0.5, settleSec: 10, fossilDepth: 45, fossilSpread: 0, keep: 0.4, goneSteps: 3, fossilScale: 1, fossilLight: 1, fossilSpokes: 1 };
  const headScale = (v: Parameters<typeof headState>[0], since: number | null, depth: number, dust: number, c: HeadLife) => headState(v, since, depth, dust, c).scale;
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

  it("grows in when told, and what stays can turn smaller, darker and thinner as it fossilises", () => {
    expect(headScale(stays, 0, 0, DUST, { ...life, growSec: 2 })).toBe(0);
    expect(headScale(stays, 1, 0, DUST, { ...life, growSec: 2 })).toBeCloseTo(0.5);
    expect(headScale(stays, 2, 0, DUST, { ...life, growSec: 2 })).toBe(1);
    const c = { ...life, fossilScale: 0.5, fossilLight: 0.25, fossilSpokes: 0.5 };
    expect(headState(stays, null, 44, DUST, c)).toEqual({ scale: 0.5, light: 1, spokes: 1 });
    expect(headState(stays, null, 400, DUST, c)).toEqual({ scale: 0.25, light: 0.25, spokes: 0.5 });
    expect(headState(goes, null, 46.5, DUST, { ...life, goneSteps: 3 }).scale).toBeCloseTo(0.25);
    expect(headState(goes, null, 46.5, DUST, { ...life, goneSteps: 6 }).scale).toBeCloseTo(0.375);
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
    for (const m of [v.size, v.stem, v.spokes, v.light, v.dustCount, v.dustReach, v.dustSec]) expect(m).toBe(1);
    const full = { size: 1, shape: 1, dot: 1, spokes: 1, light: 1, dustCount: 1, dustReach: 1, dustSec: 1 };
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const w = headVariation(`h${i}`, full);
      for (const m of [w.size, w.stem, w.spokes, w.dustCount, w.dustReach, w.dustSec]) {
        expect(m).toBeGreaterThanOrEqual(1 / 3);
        expect(m).toBeLessThanOrEqual(3);
      }
      expect(w.light).toBeGreaterThanOrEqual(0);
      expect(w.light).toBeLessThanOrEqual(1);
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

  it("thrown slowly, it starts with few and lasts longer", () => {
    const slow = { ...plain, emit: 1 };
    expect(scatterEndSec(plain)).toBe(plain.lifeSec);
    expect(scatterEndSec(slow)).toBe(2 * plain.lifeSec);
    expect(thrown(0.5, slow).n).toBeLessThan(plain.count / 4);
    expect(thrown(plain.lifeSec + 1, slow).n).toBeGreaterThan(0);
    expect(thrown(scatterEndSec(slow), slow).n).toBe(0);
  });

  it("a share bursts at the start and the rest keep coming", () => {
    const both = { ...plain, count: 200, emit: 1, first: 0.5 };
    const atStart = thrown(0.01, both).n;
    expect(atStart).toBeGreaterThan(70);
    expect(atStart).toBeLessThan(130);
    // the burst's points are gone by then; those still in the air were thrown later
    expect(thrown(plain.lifeSec + 1, both).n).toBeGreaterThan(0);
    expect(thrown(0.01, { ...both, first: 1 }).n).toBe(200);
    expect(thrown(scatterEndSec(both), both).n).toBe(0);
  });

  it("a harder burst is farther sooner; a given heading takes the wind that way", () => {
    const meanDist = (burst: number) => {
      const { n, pos } = thrown(1, { ...plain, burst });
      let d = 0;
      for (let i = 0; i < n; i++) d += distOf(pos, i);
      return d / n;
    };
    expect(meanDist(5)).toBeGreaterThan(meanDist(1));
    const { n, pos } = thrown(1, { ...plain, wind: 1, heading: 0, headingSpread: 0 });
    for (let i = 0; i < n; i++) {
      expect(pos[i * 3]).toBeGreaterThan(0);
      expect(pos[i * 3 + 2]).toBeCloseTo(0, 5);
    }
  });

  it("appends after what is already written and stops when the buffer is full", () => {
    const pos = new Float32Array(30 * 3);
    expect(scatterPoints(head.id, 0, 0, 0, 0, { ...plain, count: 20 }, { pos }, 5)).toBe(25);
    expect(scatterPoints(head.id, 0, 0, 0, 0, plain, { pos })).toBe(30);
  });
});
