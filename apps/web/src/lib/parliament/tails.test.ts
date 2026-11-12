import { describe, expect, it } from "vitest";
import { DEFAULT_TAILS, TailField } from "./tails";

const C = 1.2;
/** A walker going from cell (i0, j) to cell (i1, j) through the cells' middles, a cell a step, from time s0. */
const walk = (o: string, i0: number, i1: number, j: number, s0: number) => {
  const d = Math.sign(i1 - i0) || 1;
  const out = [];
  for (let i = i0, t = 0; d > 0 ? i <= i1 : i >= i1; i += d, t++) out.push({ o, x: (i + 0.5) * C, z: (j + 0.5) * C, s: s0 + t * 0.6, k: "p" as const });
  return out;
};
const fieldOf = (events: ReturnType<typeof walk>, cfg = DEFAULT_TAILS) => {
  const f = new TailField();
  f.configure({ ...cfg, slotSec: cfg.slotSec });
  f.clear();
  f.cfg = { ...cfg };
  // everybody stops where they are a second after their last sample (a tail is laid when the walk has ended)
  const last = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!last.has(e.o) || e.s >= last.get(e.o)!.s) last.set(e.o, e);
  const all = [...events, ...[...last.values()].map((e) => ({ ...e, s: e.s + 1 }))];
  for (const e of all.sort((a, b) => a.s - b.s)) f.add(e);
  return f;
};

describe("tails: what the bots follow", () => {
  it("one walk over a cell's middle is one tail there: whole at its time, fading after, then gone", () => {
    const f = fieldOf(walk("a", 0, 20, 0, 400));
    expect(f.level(10, 0, 20)).toBeCloseTo(1, 5);
    expect(f.level(10, 0, 24)).toBeGreaterThan(0);
    expect(f.level(10, 0, 24)).toBeLessThan(f.level(10, 0, 21));
    expect(f.level(10, 0, 31)).toBe(0); // 180 s later
    expect(f.level(10, 0, 19)).toBe(0); // not before it: a bot living earlier does not see it
    expect(f.level(10, 1, 20)).toBe(0); // not beside it
  });

  it("whose tail it is does not matter: one walker three times is three tails, as three walkers once are", () => {
    const thrice = fieldOf([...walk("a", 0, 20, 0, 400), ...walk("a", 20, 0, 0, 420), ...walk("a", 0, 20, 0, 440)]);
    const three = fieldOf([...walk("a", 0, 20, 0, 400), ...walk("b", 0, 20, 0, 420), ...walk("c", 0, 20, 0, 440)]);
    expect(thrice.level(10, 0, 22)).toBeCloseTo(three.level(10, 0, 22), 5);
    expect(three.level(10, 0, 22)).toBeGreaterThan(2.5);
  });

  it("near and far: a hop within a place leaves no tail; a walk from one place to another does", () => {
    const hops = [0, 1, 2, 3, 4, 5].flatMap((i) => walk(`h${i % 3}`, i % 2 ? 6 : 0, i % 2 ? 0 : 6, 0, 400 + i * 20));
    expect(fieldOf(hops).steps).toBe(0);
    expect(fieldOf(hops, { ...DEFAULT_TAILS, minLeg: 0 }).steps).toBeGreaterThan(0);
    expect(fieldOf(walk("a", 0, 20, 0, 400)).steps).toBeGreaterThan(0);
  });
});
