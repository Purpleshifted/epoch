import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY, DEFAULT_PATH, DensityField, levelOf, type DensityConfig } from "./density";
import { DEFAULT_BOXES, DEFAULT_VARIETY, boxesOfSeed, buildKeep, districtOf } from "./seeds";
import type { PEvent } from "./types";

const CFG: DensityConfig = { ...DEFAULT_DENSITY };
/** `n` people standing within half a metre of (x, z) from `s0` for `sec` seconds, one sample a second each. */
function crowd(n: number, x: number, z: number, s0: number, sec: number, tag = "a"): PEvent[] {
  const out: PEvent[] = [];
  for (let t = 0; t < sec; t++) for (let i = 0; i < n; i++) out.push({ id: `${tag}${i}:${t}`, o: `${tag}${i}`, r: "worker", k: "p", x: x + (i % 3) * 0.2, z: z + (i % 2) * 0.2, s: s0 + t });
  return out;
}
const fieldOf = (events: PEvent[], cfg = CFG) => {
  const f = new DensityField(cfg);
  for (const e of events) f.add(e);
  return f;
};

describe("density: buildings from the density of spacetime", () => {
  it("levelOf: nothing under four visitors or under the first threshold, then one level per factor", () => {
    const by = (amounts: number[]) => new Map(amounts.map((a, i) => [i, a] as const));
    expect(levelOf(by([20, 20, 20]), CFG)).toBe(0); // three people, however long
    expect(levelOf(by([5, 5, 5, 5]), CFG)).toBe(0); // four, but 20 < 40
    expect(levelOf(by([10, 10, 10, 10]), CFG)).toBe(1);
    expect(levelOf(by([20, 20, 20, 20]), CFG)).toBe(2);
    expect(levelOf(by([99, 99, 99, 99]), CFG)).toBe(2); // each capped at 20: one herd never passes level 2
    expect(levelOf(by([20, 20, 20, 20, 20, 20, 20, 20]), CFG)).toBe(3);
    expect(levelOf(by([1, 20, 20, 20]), CFG)).toBe(0); // the fourth only passed by
  });

  it("three people never build; five standing twenty seconds do — at once, where and when they stood", () => {
    expect(fieldOf(crowd(3, 10, 10, 400, 60)).seeds().length).toBe(0);
    const f = fieldOf(crowd(5, 10, 10, 400, 20));
    const seeds = f.seeds();
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(Math.hypot(s.x - 10, s.z - 10)).toBeLessThan(CFG.radius + 1.5);
      expect(s.t0).toBeGreaterThanOrEqual(400 - CFG.timeSec * CFG.down - CFG.slotSec);
      expect(s.t1).toBeLessThanOrEqual(420 + CFG.timeSec + CFG.slotSec);
      expect(s.spans!.length).toBeGreaterThanOrEqual(1);
      expect(s.who!.length).toBeGreaterThanOrEqual(CFG.minVisitors);
    }
  });

  it("between two thresholds nothing changes: the same seeds, the same version", () => {
    const f = fieldOf(crowd(5, 0, 0, 200, 14));
    const before = f.seeds(), v = f.version;
    // one more second of the same five: no cell-slot crosses a threshold
    for (const e of crowd(5, 0, 0, 214, 1, "a")) f.add(e);
    expect(f.version).toBe(v);
    expect(f.seeds()).toBe(before);
  });

  it("is a sum: the order of the samples does not matter", () => {
    const ev = [...crowd(5, 3, -4, 300, 30), ...crowd(4, 5, -4, 520, 25, "b")];
    const a = fieldOf(ev);
    const b = fieldOf([...ev].reverse());
    const flat = (f: DensityField) => f.seeds().map((s) => `${s.id}:${s.mass}:${JSON.stringify(s.spans)}`).sort();
    expect(flat(b)).toEqual(flat(a));
  });

  it("written deep in the block later: the cell keeps its id (its parts are not reshuffled) and gains the slots below", () => {
    const f = fieldOf(crowd(5, 0, 0, 1000, 20));
    const top = f.seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    for (const e of crowd(5, 0, 0, 300, 20, "c")) f.add(e);
    const both = f.seeds().find((s) => s.id === top.id)!;
    expect(both).toBeDefined();
    expect(both.t0).toBeLessThan(top.t0);
    expect(both.spans!.length).toBe(2);
  });

  it("down 0: a presence weighs on its own time and later, never on the slots before it", () => {
    const f = fieldOf(crowd(6, 0, 0, 405, 30), { ...CFG, down: 0 });
    for (const s of f.seeds()) expect(s.t0).toBeGreaterThanOrEqual(400);
    expect(f.seeds().length).toBeGreaterThan(0);
  });

  it("buildKeep: the foundation at once, then beams, slabs, masses, drips — complete `buildSlots` above the beginning", () => {
    for (const k of ["basement", "pile", "plinth", "column"] as const) expect(buildKeep(k, 0, 3)).toBe(1);
    for (const k of ["beam", "brace", "slab", "mass", "drip"] as const) expect(buildKeep(k, 0, 3)).toBe(0);
    expect(buildKeep("beam", 1, 3)).toBeGreaterThan(0);
    expect(buildKeep("mass", 1, 3)).toBe(0);
    expect(buildKeep("mass", 2, 3)).toBeGreaterThan(0);
    for (const k of ["beam", "slab", "mass", "drip"] as const) expect(buildKeep(k, 3, 3)).toBe(1);
    expect(buildKeep("drip", 0, 0)).toBe(1); // 0 = everything at once
  });

  it("the order of building is the time axis: no mass in a building's first slot, everything `buildSlots` above it", () => {
    const f = fieldOf(crowd(6, 0, 0, 400, 200));
    const seed = f.seeds().reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a));
    const box = { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec };
    const first = Math.floor(seed.t0 / CFG.slotSec);
    const plain = boxesOfSeed(seed, box), built = boxesOfSeed(seed, { ...box, buildSlots: 3 });
    expect(built.length).toBeLessThan(plain.length);
    expect(built.some((b) => b.slot === first && (b.kind === "mass" || b.kind === "slab" || b.kind === "drip"))).toBe(false);
    const count = (list: typeof plain, k: number) => list.filter((b) => b.slot === k).length;
    for (let k = first + 3; k <= first + 5; k++) expect(count(built, k)).toBe(count(plain, k));
    expect(boxesOfSeed(seed, { ...box, buildSlots: 0 }).length).toBe(plain.length);
  });

  it("empty time: a short pause is one building, a longer one starts another — its order of building from the beginning", () => {
    // two stays at the same place, far apart in time
    const ev = [...crowd(6, 0, 0, 200, 30), ...crowd(6, 0, 0, 900, 30, "b")];
    const two = fieldOf(ev).seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    expect(two.spans!.length).toBe(2);
    const one = fieldOf(ev, { ...CFG, gapSec: 2000 }).seeds().find((s) => Math.hypot(s.x, s.z) < 1.5)!;
    expect(one.spans!.length).toBe(1);
    // the second building's first slot is a beginning again: no masses there
    const box = { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, buildSlots: 3 };
    const again = Math.floor(two.spans![1][0] / CFG.slotSec);
    expect(boxesOfSeed(two, box).some((b) => b.slot === again && b.kind === "mass")).toBe(false);
  });

  it("districts: one district's buildings share an angle and a character; districts differ; nothing is lost or made", () => {
    const v = { ...DEFAULT_VARIETY };
    const a = districtOf(1, 1, v), a2 = districtOf(1.5, 0.5, v);
    expect(a2).toEqual(a);
    const angles = new Set<string>(), chars = new Set<string>();
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const d = districtOf(i * 14, j * 14, v);
      angles.add(d.angle.toFixed(3));
      chars.add(d.character);
      expect(Math.abs(d.angle)).toBeLessThanOrEqual(v.angle + 1e-9);
    }
    expect(angles.size).toBeGreaterThan(20);
    expect(chars.size).toBe(4);
    expect(Math.abs(districtOf(40, 40, { ...v, angleStep: Math.PI / 12 }).angle % (Math.PI / 12))).toBeLessThan(1e-9);
    // a seed's parts: with no lean, the same parts — only turned and resized
    const f = fieldOf(crowd(5, 30, 30, 400, 30));
    const seed = f.seeds()[0];
    const plain = boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec });
    const turned = boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, variety: { ...v, character: 0 } });
    expect(turned.length).toBe(plain.length);
    const d = districtOf(seed.x, seed.z, v);
    if (d.angle) expect(turned.some((b, i) => Math.abs(b.x - plain[i].x) > 1e-6 || (b.yaw ?? 0) !== (plain[i].yaw ?? 0))).toBe(true);
    // with a lean some kinds thin out, none is added
    expect(boxesOfSeed(seed, { ...DEFAULT_BOXES, secPerUnit: CFG.slotSec, variety: { ...v, character: 1 } }).length).toBeLessThanOrEqual(plain.length);
  });

  it("read against its peak: more living in a building does not widen it, and the order of writing does not matter", () => {
    const P = { ...CFG, peakShare: 0.5 };
    const cells = (f: DensityField) => f.seeds().length;
    const one = fieldOf(crowd(5, 0, 0, 400, 60), P);
    const three = [...crowd(5, 0, 0, 400, 60), ...crowd(5, 0, 0, 400, 60, "b"), ...crowd(5, 0, 0, 400, 60, "c")];
    expect(cells(one)).toBeGreaterThan(0);
    // three times the people at the same spot: about the same building (the peak and the threshold rose together)
    expect(cells(fieldOf(three, P))).toBeLessThanOrEqual(cells(one) + 2);
    // without it the building widens as more is put in
    expect(cells(fieldOf(three))).toBeGreaterThan(cells(fieldOf(three, P)));
    const flat = (f: DensityField) => f.seeds().map((s) => `${s.id}:${JSON.stringify(s.spans)}`).sort();
    expect(flat(fieldOf([...three].reverse(), P))).toEqual(flat(fieldOf(three, P)));
    // somebody standing beside it still builds there
    expect(cells(fieldOf([...crowd(5, 0, 0, 400, 60), ...crowd(5, 6, 0, 400, 60, "d")], P))).toBeGreaterThan(cells(one));
  });

  it("built but not lived in: vegetation gathers on the rim and on the slots before and after, not where people stood", () => {
    const f = fieldOf(crowd(6, 0, 0, 400, 40), { ...CFG, liveAt: 0.25 });
    const seeds = f.seeds();
    const own = seeds.reduce((a, b) => (Math.hypot(b.x - 0.3, b.z - 0.3) < Math.hypot(a.x - 0.3, a.z - 0.3) ? b : a));
    // where and when they stood: lived
    expect(own.gather!.get(20)).toBeLessThan(0.5);
    // somewhere it was only reached (a cell nobody stood in, or a slot before or after): all of it gathers
    const all = seeds.flatMap((s) => [...s.gather!.values()]);
    expect(Math.max(...all)).toBe(1);
    for (const g of all) expect(g * 4).toBe(Math.round(g * 4)); // read in quarters
    // without liveAt nothing is worked out
    expect(fieldOf(crowd(6, 0, 0, 400, 40)).seeds()[0].gather).toBeUndefined();
  });

  it("a budget of what is built: beyond it the first-built cell-slots go, the newest stand", () => {
    const count = (f: DensityField) => f.seeds().reduce((n, s) => n + s.levels!.size, 0);
    const first = crowd(5, 0, 0, 400, 30), second = crowd(5, 40, 40, 400, 30, "b");
    const free = fieldOf([...first, ...second]);
    const all = count(free);
    expect(all).toBeGreaterThan(20);
    const tight = fieldOf([...first, ...second], { ...CFG, maxBuilt: 12 });
    expect(count(tight)).toBeLessThanOrEqual(12);
    // what stands is of the second place (built last)
    for (const s of tight.seeds()) expect(Math.hypot(s.x - 40, s.z - 40)).toBeLessThan(10);
  });

  it("others at the same place and time raise the level, and with it the mass", () => {
    const one = fieldOf(crowd(5, 0, 0, 400, 40));
    const two = fieldOf([...crowd(5, 0, 0, 400, 40), ...crowd(5, 0, 0, 400, 40, "b")]);
    const mass = (f: DensityField) => Math.max(...f.seeds().map((s) => s.mass));
    expect(mass(two)).toBeGreaterThan(mass(one));
  });
});

describe("density: paths from the density of movement", () => {
  const P: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH } };
  /** `n` walkers side by side going from x0 to x1 along z = 0 (2 units a second), from time s0. */
  function march(n: number, x0: number, x1: number, s0: number, tag: string): PEvent[] {
    const out: PEvent[] = [];
    const steps = Math.ceil(Math.abs(x1 - x0) / 2);
    for (let i = 0; i < n; i++) for (let t = 0; t <= steps; t++) out.push({ id: `${tag}${i}:${t}:${s0}`, o: `${tag}${i}`, r: "worker", k: "p", x: x0 + ((x1 - x0) * t) / steps, z: (i - (n - 1) / 2) * 0.3, s: s0 + t });
    return out;
  }
  /** Everybody stops where they are, a second after their last sample (a walk is a leg once the walker has stopped). */
  const halted = (events: PEvent[]): PEvent[] => {
    const last = new Map<string, PEvent>();
    for (const e of events) if (!last.has(e.o) || e.s >= last.get(e.o)!.s) last.set(e.o, e);
    return [...events, ...[...last.values()].map((e) => ({ ...e, id: e.id + ":halt", s: e.s + 1 }))];
  };
  const pathCells = (f: DensityField) => f.pathPlates(0.25).length / 3;

  it("one herd crossing once is not a path; the same way there and back is", () => {
    expect(pathCells(fieldOf(halted(march(5, 0, 30, 400, "a")), P))).toBe(0);
    const f = fieldOf(halted([...march(5, 0, 30, 400, "a"), ...march(5, 30, 0, 430, "a")]), P);
    expect(pathCells(f)).toBeGreaterThan(10);
    // along the way, near its line
    const plates = f.pathPlates(0.25);
    for (let i = 0; i < plates.length; i += 3) {
      expect(plates[i]).toBeGreaterThan(-3);
      expect(plates[i]).toBeLessThan(33);
      expect(Math.abs(plates[i + 2])).toBeLessThan(DEFAULT_PATH.radius + 1.5);
    }
  });

  it("as lines: a way is ONE line along its middle, however wide it was trodden", () => {
    const f = fieldOf(halted([...march(5, 0, 30, 400, "a"), ...march(5, 30, 0, 430, "a")]), P);
    const lines = f.pathLines(0.25, 0);
    expect(lines.length).toBeGreaterThan(6 * 10);
    // every segment joins two neighbouring cells, and the line keeps to one row of them
    const rows = new Set<number>();
    for (let i = 0; i < lines.length; i += 6) {
      expect(Math.hypot(lines[i + 3] - lines[i], lines[i + 5] - lines[i + 2])).toBeLessThanOrEqual(1.2 * Math.SQRT2 + 1e-6);
      rows.add(Math.round(lines[i + 2] * 100));
      rows.add(Math.round(lines[i + 5] * 100));
    }
    expect(rows.size).toBe(1);
    expect(fieldOf(halted(march(5, 0, 30, 400, "a")), P).pathLines(0.25).length).toBe(0);
  });

  it("as curves: a way with a corner is one unbroken line, its corner rounded, its ends where they were", () => {
    // there and back along an L: east, then north
    const leg = (tag: string, s0: number, back: boolean): PEvent[] => {
      const out: PEvent[] = [];
      for (let i = 0; i < 5; i++) {
        const pts: [number, number][] = [];
        for (let t = 0; t <= 10; t++) pts.push([2 * t, (i - 2) * 0.3]);
        for (let t = 1; t <= 10; t++) pts.push([20 + (i - 2) * 0.3, 2 * t]);
        if (back) pts.reverse();
        pts.forEach(([x, z], t) => out.push({ id: `${tag}${i}:${t}:${s0}`, o: `${tag}${i}`, r: "worker", k: "p", x, z, s: s0 + t }));
      }
      return out;
    };
    const f = fieldOf(halted([...leg("a", 400, false), ...leg("a", 425, true)]), P);
    const sharp = f.pathLines(0.25, 0), curve = f.pathLines(0.25, 4);
    expect(sharp.length).toBeGreaterThan(0);
    // (the line is the route's own either way: smoothing evens its heights)
    expect(curve.length).toBe(sharp.length);
    // unbroken: each segment begins where the one before ended (one chain)
    let breaks = 0;
    for (let i = 6; i < curve.length; i += 6) if (Math.hypot(curve[i] - curve[i - 3], curve[i + 2] - curve[i - 1]) > 1e-4) breaks++;
    expect(breaks).toBeLessThanOrEqual(2);
    // no sharp turn left: every bend between two segments is gentle
    let sharpest = 0;
    for (let i = 6; i < curve.length; i += 6) {
      if (Math.hypot(curve[i] - curve[i - 3], curve[i + 2] - curve[i - 1]) > 1e-4) continue;
      const ax = curve[i - 3] - curve[i - 6], az = curve[i - 1] - curve[i - 4], bx = curve[i + 3] - curve[i], bz = curve[i + 5] - curve[i + 2];
      const cos = (ax * bx + az * bz) / Math.max(1e-9, Math.hypot(ax, az) * Math.hypot(bx, bz));
      sharpest = Math.max(sharpest, Math.acos(Math.max(-1, Math.min(1, cos))));
    }
    expect(sharpest).toBeLessThan(Math.PI / 4);
  });

  it("walking does not build: no building comes of a herd that only passes, however often", () => {
    const ev = [0, 1, 2, 3, 4, 5].flatMap((r) => march(5, r % 2 ? 30 : 0, r % 2 ? 0 : 30, 400 + r * 20, "a"));
    expect(fieldOf(halted(ev), P).seeds().length).toBe(0);
  });

  it("the contest: a cell-slot is a building's or a path's, never both", () => {
    const ev = [...crowd(6, 15, 0, 400, 40), ...march(5, 0, 30, 400, "w"), ...march(5, 30, 0, 420, "w")];
    const f = fieldOf(halted(ev), P);
    expect(f.seeds().length).toBeGreaterThan(0);
    for (const s of f.seeds()) for (const k of s.levels!.keys()) expect(f.pathAt(Math.floor(s.x / 1.2), Math.floor(s.z / 1.2), k)).toBe(false);
  });

  it("a later branch climbs from the way it leaves: its surface rises no faster than the slope allows", () => {
    // an old way along x, then — four slots later — a branch that runs along it and leaves it northwards
    const old = [...march(5, 0, 30, 400, "a"), ...march(5, 30, 0, 430, "a")];
    const branch = (tag: string, s0: number): PEvent[] => {
      const out: PEvent[] = [];
      for (let i = 0; i < 5; i++) {
        for (let t = 0; t <= 8; t++) out.push({ id: `${tag}${i}:x${t}:${s0}`, o: `${tag}${i}`, r: "worker", k: "p", x: 2 * t, z: (i - 2) * 0.3, s: s0 + t });
        for (let t = 1; t <= 10; t++) out.push({ id: `${tag}${i}:z${t}:${s0}`, o: `${tag}${i}`, r: "worker", k: "p", x: 16 + (i - 2) * 0.3, z: 2 * t, s: s0 + 8 + t });
      }
      return out;
    };
    const back = (tag: string, s0: number): PEvent[] => branch(tag, 0).map((e) => ({ ...e, id: e.id + "b", s: s0 + (18 - e.s) })).sort((p, q) => p.s - q.s);
    const f = fieldOf(halted([...old, ...branch("b", 480), ...back("b", 500)]), P);
    const flat = f.pathPlates(1e9), ramp = f.pathPlates(0.25);
    expect(ramp.length).toBe(flat.length);
    // on the branch, far from the old way: at its own time; close to the old way: lower than it began
    let lowered = 0, far = 0;
    for (let i = 0; i < ramp.length; i += 3) {
      expect(ramp[i + 1]).toBeLessThanOrEqual(flat[i + 1] + 1e-6);
      if (ramp[i + 2] > 3 && ramp[i + 2] < 8 && ramp[i + 1] < flat[i + 1] - 0.2) lowered++;
      if (ramp[i + 2] > 14) far++;
    }
    expect(far).toBeGreaterThan(0);
    expect(lowered).toBeGreaterThan(0);
    // no step steeper than the slope between touching surfaces
    const at = new Map<string, number>();
    for (let i = 0; i < ramp.length; i += 3) at.set(`${Math.floor(ramp[i] / 1.2)},${Math.floor(ramp[i + 2] / 1.2)}`, ramp[i + 1]);
    for (const [k, h] of at) {
      const [cx, cz] = k.split(",").map(Number);
      const n = at.get(`${cx + 1},${cz}`);
      if (n !== undefined && Math.abs(n - h) > 0.25 + 1e-6) expect(Math.abs(n - h)).toBeGreaterThanOrEqual(1); // (runs that do not touch in time)
    }
  });
});
