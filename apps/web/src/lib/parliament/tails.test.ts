import { describe, expect, it } from "vitest";
import { DEFAULT_TAILS, DEFAULT_TAIL_LINES, TailField } from "./tails";

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
  f.configure({ ...cfg });
  // everybody stops where they are a second after their last sample (a tail is laid when the walk has ended)
  const last = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!last.has(e.o) || e.s >= last.get(e.o)!.s) last.set(e.o, e);
  const all = [...events, ...[...last.values()].map((e) => ({ ...e, s: e.s + 1 }))];
  for (const e of all.sort((a, b) => a.s - b.s)) f.add(e);
  return f;
};

describe("tails: paths from fading tails", () => {
  it("one walk over a cell's middle is one tail there: whole at its time, fading after, then gone", () => {
    const f = fieldOf(walk("a", 0, 20, 0, 400));
    expect(f.level(10, 0, 20)).toBeCloseTo(1, 5);
    expect(f.level(10, 0, 24)).toBeGreaterThan(0);
    expect(f.level(10, 0, 24)).toBeLessThan(f.level(10, 0, 21));
    expect(f.level(10, 0, 31)).toBe(0); // 180 s later
    expect(f.level(10, 0, 19)).toBe(0); // not before it
    expect(f.level(10, 1, 20)).toBe(0); // not beside it
  });

  it("whose tail it is does not matter: one walker three times is three tails, as three walkers once are", () => {
    const thrice = fieldOf([...walk("a", 0, 20, 0, 400), ...walk("a", 20, 0, 0, 420), ...walk("a", 0, 20, 0, 440)]);
    const three = fieldOf([...walk("a", 0, 20, 0, 400), ...walk("b", 0, 20, 0, 420), ...walk("c", 0, 20, 0, 440)]);
    expect(thrice.level(10, 0, 22)).toBeCloseTo(three.level(10, 0, 22), 5);
    expect(three.level(10, 0, 22)).toBeGreaterThan(2.5);
  });

  it("path where the tails overlap enough — one line from end to end; it ends when the flow is not kept up", () => {
    const busy = fieldOf([0, 1, 2, 3].flatMap((i) => walk(`w${i}`, 0, 20, 0, 400 + i * 15)));
    const lines = busy.lines({ ...DEFAULT_TAIL_LINES, smooth: 0 });
    expect(lines.length).toBeGreaterThan(6 * 15);
    // unbroken: every segment begins where another ends, but for the line's two ends
    const ends = new Map<string, number>();
    for (let i = 0; i < lines.length; i += 3) {
      const k = `${lines[i].toFixed(2)},${lines[i + 2].toFixed(2)}`;
      ends.set(k, (ends.get(k) ?? 0) + 1);
    }
    expect([...ends.values()].filter((n) => n === 1).length).toBe(2);
    // a single walk is no path; nor are walks too far apart in time to overlap
    expect(fieldOf(walk("a", 0, 20, 0, 400)).lines(DEFAULT_TAIL_LINES).length).toBe(0);
    expect(fieldOf([0, 1, 2, 3].flatMap((i) => walk(`w${i}`, 0, 20, 0, 400 + i * 400))).lines(DEFAULT_TAIL_LINES).length).toBe(0);
  });

  it("a path that lives on is laid again higher up, and a branch climbs from the way it leaves", () => {
    // kept walked for ten minutes
    const long = fieldOf(Array.from({ length: 40 }, (_, i) => walk(`w${i % 5}`, i % 2 ? 20 : 0, i % 2 ? 0 : 20, 0, 400 + i * 15)).flat());
    const hs = new Set<number>();
    const l = long.lines({ ...DEFAULT_TAIL_LINES, smooth: 0 });
    for (let i = 1; i < l.length; i += 3) hs.add(Math.round(l[i]));
    expect(hs.size).toBeGreaterThan(2);
    // flat: what became path in the same layer lies at one height (no wobble from cell to cell)
    const first = Math.min(...hs);
    let atFirst = 0, offLayer = 0;
    for (let i = 1; i < l.length; i += 3) {
      if (Math.abs(l[i] - first) < 1e-6) atFirst++;
      if (Math.abs(l[i] / DEFAULT_TAIL_LINES.layer - Math.round(l[i] / DEFAULT_TAIL_LINES.layer)) > 1e-6) offLayer++;
    }
    expect(atFirst).toBeGreaterThan(30);
    // (but for the few points of a ramp where a newer stretch climbs)
    expect(offLayer).toBeLessThan(l.length / 30);
    // smoothing keeps it a line of the same ends
    expect(long.lines(DEFAULT_TAIL_LINES).length).toBeGreaterThan(l.length);
  });

  it("near and far: a hop within a place leaves no tail; a walk from one place to another does", () => {
    const hops = [0, 1, 2, 3, 4, 5].flatMap((i) => walk(`h${i % 3}`, i % 2 ? 6 : 0, i % 2 ? 0 : 6, 0, 400 + i * 20));
    expect(fieldOf(hops).steps).toBe(0);
    expect(fieldOf(hops, { ...DEFAULT_TAILS, minLeg: 0 }).steps).toBeGreaterThan(0);
    expect(fieldOf(walk("a", 0, 20, 0, 400)).steps).toBeGreaterThan(0);
  });
});
