import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, DEFAULT_WEATHER, SpaceModel, botActor, dueSamples, writeMatrix, type Box, type PEvent } from "./index";

function runBots(bots: number, seconds: number): PEvent[] {
  const start = 1_800_000_000_000;
  const out: PEvent[] = [];
  let last = start - 1000;
  for (let now = start; now <= start + seconds * 1000; now += 1000) {
    const due = dueSamples(last, now, 1000);
    if (due.length) last = due[due.length - 1];
    for (const w of due) {
      for (let i = 0; i < bots; i++) {
        const a = botActor(i, "worker", w, start, start, 60, { groups: 2, spread: 10 });
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
  const parts = (lod = lodNear) => ({ fold: DEFAULT_FOLD, box: DEFAULT_BOXES, wear: true, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE, edges: false, lod });

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

  it("old layers are fused into one mesh and their parts leave the instances", () => {
    // an old world: the same bots, an hour before the present
    const late: PEvent[] = [...events, { id: "late", o: "late", r: "worker", k: "p", x: 40, z: 40, s: 4000 }];
    const m = new SpaceModel();
    m.add(late);
    const off = m.computeParts({ ...parts(), fuse: { ...DEFAULT_FUSE, enabled: false } })!;
    const opaque = m.computeParts({ ...parts(), fuse: { ...DEFAULT_FUSE, resinShare: 2 } })!;
    const withResin = m.computeParts(parts())!;
    expect(opaque.parts).toBeLessThan(off.parts); // fused layers dissolve their parts
    expect(withResin.parts).toBeGreaterThanOrEqual(opaque.parts); // resin layers keep theirs inside
    const input = { box: DEFAULT_BOXES, weather: DEFAULT_WEATHER, fuse: DEFAULT_FUSE };
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

  it("reset forgets the world", () => {
    const m = new SpaceModel();
    m.add(events);
    m.computeParts(parts());
    m.reset();
    expect(m.computeParts(parts())!.seeds).toBe(0);
  });
});
