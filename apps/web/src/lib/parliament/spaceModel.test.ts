import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, DEFAULT_WATER, DEFAULT_WEATHER, NATURE_KIND, SpaceModel, natureColors, botActor, dueSamples, writeMatrix, type Box, type PEvent } from "./index";

function runBots(bots: number, seconds: number, spread = 10): PEvent[] {
  const start = 1_800_000_000_000;
  const out: PEvent[] = [];
  let last = start - 1000;
  for (let now = start; now <= start + seconds * 1000; now += 1000) {
    const due = dueSamples(last, now, 1000);
    if (due.length) last = due[due.length - 1];
    for (const w of due) {
      for (let i = 0; i < bots; i++) {
        const a = botActor(i, "worker", w, start, start, 60, { groups: 2, spread });
        out.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s });
      }
    }
  }
  return out;
}

const box = (over: Partial<Box>): Box => ({ kind: "beam", seed: 1, material: "concrete", x: 1, y: 2, z: 3, sx: 0.1, sy: 4, sz: 0.2, tone: 0.5, along: 0, slot: 0, ...over });

describe("writeMatrix equals three.js Object3D.updateMatrix (Euler YZX)", () => {
  it.each([
    [box({})],
    [box({ yaw: 0.7, tilt: Math.PI / 2 + 0.1 })],
    [box({ yaw: 2.4, tilt: 0.6, sx: 0.3, sy: 1.7, sz: 0.05 })],
  ])("%#", (b) => {
    const o = new THREE.Object3D();
    o.position.set(b.x, b.y, b.z);
    o.rotation.set(0, b.yaw ?? 0, b.tilt ?? 0, "YZX");
    o.scale.set(b.sx, b.sy, b.sz);
    o.updateMatrix();
    const m = new Float32Array(16);
    writeMatrix(m, 0, b);
    for (let i = 0; i < 16; i++) expect(m[i]).toBeCloseTo(o.matrix.elements[i], 5);
  });
});

describe("SpaceModel: what the worker computes", () => {
  const events = runBots(8, 240);
  const lodNear = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
  const lodFar = { ...lodNear, near: 0 };
  const parts = (lod = lodNear) => ({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod });

  it("builds parts, and returns null when nothing changed", () => {
    const m = new SpaceModel();
    m.add(events);
    const r = m.computeParts(parts())!;
    expect(r.seeds).toBeGreaterThan(0);
    expect(r.counts.mass).toBeGreaterThan(0);
    expect(r.matrices.mass.length).toBe(r.counts.mass * 16);
    expect(m.computeParts(parts())).toBeNull();
    m.add(events); // duplicates
    expect(m.computeParts(parts())).toBeNull();
  });

  it("far seeds are built without slats (fewer masses)", () => {
    const m = new SpaceModel();
    m.add(events);
    const near = m.computeParts(parts(lodNear))!;
    const far = m.computeParts(parts(lodFar))!;
    expect(far.farSeeds).toBe(far.seeds);
    expect(far.counts.mass).toBeLessThan(near.counts.mass);
  });

  it("vegetation points are built around the focus, fewer far away", () => {
    const m = new SpaceModel();
    m.add(events);
    m.computeParts(parts());
    const input = { fold: DEFAULT_FOLD, box: DEFAULT_BOXES, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, nature: DEFAULT_NATURE, perSlot: 6, window: 40, focusK: 8, margin: 4, budget: 1e7, burialSlots: 3 };
    const near = m.computeNature({ ...input, lod: lodNear })!;
    expect(near.position.length).toBeGreaterThan(0);
    expect(near.color.length).toBe(near.position.length);
    expect(m.computeNature({ ...input, lod: lodNear })).toBeNull();
    const far = m.computeNature({ ...input, lod: { camera: [0, 1e4, 0], near: 10, farFactor: 0.25 } })!;
    expect(far.position.length).toBeLessThan(near.position.length);
  });

  it("weathered structures turn into mass on themselves, and their parts stay drawn", () => {
    // an old world: the same bots, an hour before the present
    const late: PEvent[] = [...events, { id: "late", o: "late", r: "worker", k: "p", x: 40, z: 40, s: 4000 }];
    const m = new SpaceModel();
    m.add(late);
    const off = m.computeParts({ ...parts(), fuse: { ...DEFAULT_FUSE, enabled: false } })!;
    const on = m.computeParts(parts())!;
    expect(on.parts).toBeLessThan(off.parts); // fused parts are absorbed into the mass
    expect(on.counts.column + on.counts.beam + on.counts.brace).toBe(off.counts.column + off.counts.beam + off.counts.brace); // steel stays
    const input = { box: DEFAULT_BOXES, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, tauReclaimYears: 300 };
    // chunks are built a few per call: call until it settles (null = nothing left to build)
    let mesh = m.computeFuse(input)!;
    for (let i = 0; i < 60; i++) {
      const next = m.computeFuse(input);
      if (!next) break;
      mesh = next;
    }
    expect(m.computeFuse(input)).toBeNull();
    expect(mesh.index.length).toBeGreaterThan(0);
    expect(mesh.index.length % 3).toBe(0);
  }, 120_000);

  it("under a moving present every chunk with something on it gets its mesh (no starvation)", () => {
    const long = runBots(8, 1500); // 75 slots: several chunks
    const m = new SpaceModel();
    m.add(long);
    const fuse = DEFAULT_FUSE;
    const weather = { ...DEFAULT_WEATHER, timeScale: 0.5, gatherStart: 0, rotDose: 0 }; // old enough to grow something everywhere
    const input = { box: DEFAULT_BOXES, weather, fuse, tauReclaimYears: 300 };
    let last = long[long.length - 1].s;
    let mesh = null;
    // the present moves on by a slot between requests, so stale chunks keep appearing
    for (let i = 0; i < 40; i++) {
      last += DEFAULT_BOXES.secPerUnit;
      m.add([{ id: `tick${i}`, o: "tick", r: "worker", k: "p", x: 99, z: 99, s: last }]);
      m.computeParts({ ...parts(), weather });
      mesh = m.computeFuse({ ...input, focusK: Math.round(last / DEFAULT_BOXES.secPerUnit) - 5 }) ?? mesh;
    }
    const ys = Array.from({ length: mesh!.position.length / 3 }, (_, i) => mesh!.position[i * 3 + 1]);
    const top = Math.max(...long.map((e) => e.s)) / DEFAULT_BOXES.secPerUnit;
    // the chunks where the camera looks (the present, up with the buildings) are built, not only the oldest ones
    expect(ys.some((y) => y > top * 0.75)).toBe(true);
  }, 300_000);

  it("bots' buildings seal the ground: their water drains away (streams and/or pipes), drawn as wetland", () => {
    const long = runBots(12, 900, 30);
    const m = new SpaceModel();
    m.add(long);
    const r = m.computeParts(parts())!;
    const drain = (m as unknown as { drain: { streams: Map<number, unknown[]>; pipes: unknown[] } }).drain;
    expect(drain.streams.size + drain.pipes.length).toBeGreaterThan(0);
    expect(r.pipes.length).toBe(r.pipeRuns * 7);
    const input = { fold: DEFAULT_FOLD, box: DEFAULT_BOXES, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, nature: DEFAULT_NATURE, perSlot: 6, window: 40, focusK: 20, margin: 4, budget: 1e7, burialSlots: 0, lod: lodNear };
    expect(m.computeNature(input)!.position.length).toBeGreaterThan(0);
    const off = new SpaceModel();
    off.add(long);
    expect(off.computeParts({ ...parts(), water: { ...DEFAULT_WATER, enabled: false } })!.pipeRuns).toBe(0);
  }, 120_000);

  it("vegetation lives only in the layers that have not begun to fuse: none below, most at the top", () => {
    const long = runBots(8, 1500);
    const m = new SpaceModel();
    m.add(long);
    const weather = { ...DEFAULT_WEATHER, timeScale: 0.5 };
    m.computeParts({ ...parts(), weather });
    const top = Math.floor(Math.max(...long.map((e) => e.s)) / DEFAULT_BOXES.secPerUnit);
    const pts = m.computeNature({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, nature: DEFAULT_NATURE, perSlot: 6, window: 60, focusK: top, margin: 4, budget: 1e7, burialSlots: 0, lod: lodNear })!;
    const ys: number[] = [];
    for (let i = 1; i < pts.position.length; i += 3) ys.push(pts.position[i] / DEFAULT_BOXES.unit);
    expect(ys.length).toBeGreaterThan(0);
    const low = ys.filter((y) => y < top - 30).length, high = ys.filter((y) => y >= top - 10).length;
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
  }, 120_000);

  it("vegetation gathers on buildings already in the present, before they rot", () => {
    const m = new SpaceModel();
    m.add(events); // 240 s: above the rot onset, nothing corrodes yet
    m.computeParts(parts());
    const input = { tauReclaimYears: 300, perArea: 40, unit: DEFAULT_BOXES.unit, secPerUnit: DEFAULT_BOXES.secPerUnit, timeScale: DEFAULT_WEATHER.timeScale, fuse: DEFAULT_FUSE };
    expect(m.computeReclaim(input)!.position.length).toBeGreaterThan(0);
  });

  it("V2 density: absolute (the camera's distance changes nothing) and fading out along the time axis, not cut off", () => {
    const long = runBots(8, 1500);
    const m = new SpaceModel();
    m.add(long);
    const weather = { ...DEFAULT_WEATHER, timeScale: 0.5 };
    m.computeParts({ ...parts(), weather });
    const top = Math.floor(Math.max(...long.map((e) => e.s)) / DEFAULT_BOXES.secPerUnit);
    const input = { fold: DEFAULT_FOLD, box: DEFAULT_BOXES, weather, fuse: DEFAULT_FUSE, nature: DEFAULT_NATURE, perSlot: 6, window: 80, focusK: top, margin: 4, budget: 1e7, burialSlots: 0, density: { cut: 0.1, fade: 12 } };
    const near = m.computeNature({ ...input, lod: lodNear })!;
    expect(m.computeNature({ ...input, lod: { camera: [0, 1e4, 0], near: 10, farFactor: 0.25 } })).toBeNull(); // nothing to rebuild
    // points per slot, from the top down: a run of slots with fewer and fewer, not full → none
    const per = new Map<number, number>();
    for (let i = 1; i < near.position.length; i += 3) {
      const k = Math.floor(near.position[i] / DEFAULT_BOXES.unit);
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    const ks = [...per.keys()].sort((a, b) => b - a);
    const most = Math.max(...per.values());
    const between = ks.filter((k) => per.get(k)! > 0 && per.get(k)! < most * 0.5).length;
    expect(between).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("reset forgets the world", () => {
    const m = new SpaceModel();
    m.add(events);
    m.computeParts(parts());
    m.reset();
    expect(m.computeParts(parts())!.seeds).toBe(0);
  });
});
