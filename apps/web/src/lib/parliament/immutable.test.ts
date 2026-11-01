import { describe, expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel, botActor, dueSamples, type PEvent } from "./index";

/**
 * THE THREE BANDS (the artist, 2026-10-31 night): the present, the layer where the processes run, and from the
 * immutable line down nothing changes — a chunk whose top crosses the line is baked as it is then and final; no chunk
 * above it is ever baked.
 */
describe("the immutable layer", () => {
  const start = 1_800_000_000_000;
  const events: PEvent[] = [];
  let last = start - 1000;
  for (let now = start; now <= start + 1500 * 1000; now += 1000) {
    const due = dueSamples(last, now, 1000);
    if (due.length) last = due[due.length - 1];
    for (const w of due) for (let i = 0; i < 8; i++) { const a = botActor(i, "worker", w, start, start, 60, { groups: 2, spread: 10 }); events.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s }); }
  }
  const lod = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
  const weather = { ...DEFAULT_WEATHER, timeScale: 0.5, gatherStart: 0, rotDose: 0 };
  const parts = () => ({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod });

  it("bakes exactly the chunks whose top lies below the line, final, and nothing above it", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { baked: Map<number, { final: boolean; c1: number }> };
    m.add(events);
    const spu = DEFAULT_BOXES.secPerUnit;
    const present = 1500 + 20 * spu;
    m.setNow(present);
    const kNow = Math.floor(present / spu);
    const immutable = 15;
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12, immutable };
    // several calls: build, then bake (the parts must reflect every built chunk between calls)
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    expect(priv.baked.size).toBeGreaterThan(0);
    for (const bk of priv.baked.values()) {
      expect(bk.final).toBe(true);
      expect(bk.c1).toBeLessThan(kNow - immutable);
    }
    // the present moves on: the line moves with it, one more chunk crosses, the earlier ones are untouched
    const before = new Set(priv.baked.keys());
    m.setNow(present + 10 * spu);
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    for (const c0 of before) expect(priv.baked.has(c0)).toBe(true);
    expect(priv.baked.size).toBeGreaterThanOrEqual(before.size);
    for (const bk of priv.baked.values()) expect(bk.c1).toBeLessThan(kNow + 10 - immutable);
  });

  it("nothing is baked while the view has not caught up with its clock (a fast rate); it is once it has", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { baked: Map<number, unknown> };
    m.add(events);
    m.setNow(1500 + 20 * DEFAULT_BOXES.secPerUnit);
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12, immutable: 15 };
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse({ ...input, caughtUp: false });
    }
    expect(priv.baked.size).toBe(0);
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse({ ...input, caughtUp: true });
    }
    expect(priv.baked.size).toBeGreaterThan(0);
  });

  it("BAKING OFF: nothing is ever baked, whatever the line says, and chunks already baked are dropped", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { baked: Map<number, unknown> };
    m.add(events);
    m.setNow(1500 + 20 * DEFAULT_BOXES.secPerUnit);
    const on = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12, immutable: 15 };
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse(on);
    }
    expect(priv.baked.size).toBeGreaterThan(0);
    // switched off: the baked chunks go, and nothing is baked again
    m.setNow(1500 + 40 * DEFAULT_BOXES.secPerUnit);
    for (let i = 0; i < 6; i++) {
      m.computeParts(parts());
      m.computeFuse({ ...on, bake: false });
    }
    expect(priv.baked.size).toBe(0);
  }, 600_000);

  it("BAKING OFF: no chunk is built first forever — the oldest-built goes next (round robin)", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { fuseChunks: Map<number, { built: number }>; fuseBuilt: number };
    m.add(events);
    const spu = DEFAULT_BOXES.secPerUnit;
    let now = 1500 + 20 * spu;
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, bake: false };
    // the present moves a slot per call, so every chunk whose parts corrode is stale every call
    for (let i = 0; i < 20; i++) {
      now += spu;
      m.setNow(now);
      m.computeParts(parts());
      m.computeFuse(input);
    }
    // round robin: no kept chunk is more than one turn of all the chunks behind
    let lag = 0;
    for (const ch of priv.fuseChunks.values()) lag = Math.max(lag, priv.fuseBuilt - ch.built);
    expect(priv.fuseChunks.size).toBeGreaterThan(2);
    expect(lag).toBeLessThanOrEqual(priv.fuseChunks.size + 2);
  }, 600_000);

  it("STEADY: with the vegetation window at the present, a part's corrosion does not depend on the camera (LOD)", () => {
    const run = (camera: [number, number, number], near: number, withNature: boolean) => {
      const m = new SpaceModel();
      m.add(events);
      m.setNow(1500 + 20 * DEFAULT_BOXES.secPerUnit);
      if (withNature) m.computeNature({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, nature: DEFAULT_NATURE, perSlot: 6, window: 120, focusK: 60, margin: 4, budget: 1e7, burialSlots: 0, lod: { camera, near: 1e9, farFactor: 1 } });
      m.computeParts({ ...parts(), lod: { camera, near, mid: near, farFactor: 1 }, steady: true });
      const priv = m as unknown as { built: { slot: number }[]; wear: { survival: (b: unknown) => number } };
      return priv.built.map((b) => `${b.slot}:${(1 - priv.wear.survival(b)).toFixed(4)}`).sort().join("|");
    };
    const a = run([0, 0, 0], Infinity, true);
    expect(run([0, 500, 900], Infinity, true)).toBe(a);
  }, 600_000);

  it("FROZEN PARTS: below freezeSlots a building's parts keep their shape and identity as it grows; erosion still applies", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { built: { slot: number; x: number; y: number; z: number; sx: number }[]; wear: { survival: (b: unknown) => number } };
    const spu = DEFAULT_BOXES.secPerUnit;
    const fuse = { ...DEFAULT_FUSE, freezeSlots: 4 };
    const half = events.filter((e) => e.s <= 900);
    m.add(half);
    m.setNow(900);
    m.computeParts({ ...parts(), fuse });
    const kFreeze = Math.floor(900 / spu) - 4;
    const before = priv.built.filter((b) => b.slot <= kFreeze);
    const d0 = new Map(before.map((b) => [b, 1 - priv.wear.survival(b)]));
    // the same buildings go on growing (more visitors, more slots) and time passes
    m.add(events.filter((e) => e.s > 900 && e.s <= 1300));
    m.setNow(1300);
    m.computeParts({ ...parts(), fuse });
    const after = new Set(priv.built);
    for (const b of before) expect(after.has(b as never)).toBe(true);
    // … and erosion moved on for those same parts
    let older = 0;
    for (const b of before) if (1 - priv.wear.survival(b) > (d0.get(b) ?? 0)) older++;
    expect(older).toBeGreaterThan(0);
  }, 600_000);

  it("without the line (V1) the old rule is unchanged: what is baked is not final (the past keeps ageing)", () => {
    const m = new SpaceModel();
    const priv = m as unknown as { baked: Map<number, { final: boolean }> };
    m.add(events);
    m.setNow(1500 + 20 * DEFAULT_BOXES.secPerUnit);
    const input = { box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 12 };
    for (let i = 0; i < 3; i++) {
      m.computeParts(parts());
      m.computeFuse(input);
    }
    for (const bk of priv.baked.values()) expect(bk.final).toBe(false);
  });
});
