import { describe, expect, it } from "vitest";
import { DEFAULT_FUSE, fuseChunk, fusedWeight, isResin, mergeMeshes, sedimentShare, type Box } from "./index";

const SPU = 30;
const sed = { tNow: 3000, secPerUnit: SPU, timeScale: 0.02, tauYears: 600 };
const part = (over: Partial<Box>): Box => ({ kind: "mass", seed: 1, material: "concrete", x: 1.2, y: 5.5, z: 1.2, sx: 1.5, sy: 1, sz: 1.5, tone: 0.5, along: 0, slot: 5, ...over });
// a little block of masses in old slots 3–8
const parts: Box[] = [];
for (let k = 3; k <= 8; k++) for (let a = 0; a < 3; a++) parts.push(part({ x: 0.8 + a * 0.9, y: k + 0.5, z: 1.2 + (a % 2) * 0.6, slot: k }));
const base = { parts, history: null, x0: -1, z0: -1, nx: 6, nz: 6, unit: 1, sediment: sed, cfg: DEFAULT_FUSE };

describe("fusion: old layers become one mass", () => {
  it("fusedWeight follows the sediment share (old slots fused, recent ones not)", () => {
    expect(sedimentShare(4, sed)).toBeGreaterThan(DEFAULT_FUSE.share);
    expect(fusedWeight(4, sed, DEFAULT_FUSE)).toBe(1);
    expect(fusedWeight(99, sed, DEFAULT_FUSE)).toBe(0);
    expect(fusedWeight(4, sed, { ...DEFAULT_FUSE, enabled: false })).toBe(0);
  });

  it("meshes old concrete into a surface with valid indices, normals and colours", () => {
    const m = fuseChunk({ ...base, k0: 0, k1: 9 });
    expect(m.index.length).toBeGreaterThan(0);
    expect(m.index.length % 3).toBe(0);
    const nv = m.position.length / 3;
    for (const i of m.index) expect(i).toBeLessThan(nv);
    expect(m.normal.length).toBe(m.position.length);
    expect(m.color.length).toBe(m.position.length);
    for (const v of m.normal) expect(Number.isFinite(v)).toBe(true);
  });

  it("recent layers are not fused", () => {
    const fresh = parts.map((b) => ({ ...b, y: b.y + 90, slot: b.slot + 90 }));
    expect(fuseChunk({ ...base, parts: fresh, k0: 90, k1: 99 }).index.length).toBe(0);
  });

  it("is deterministic, and chunks tile without gaps or doubles", () => {
    const whole = fuseChunk({ ...base, k0: 0, k1: 9 });
    expect(fuseChunk({ ...base, k0: 0, k1: 9 })).toEqual(whole);
    const split = mergeMeshes([fuseChunk({ ...base, k0: 0, k1: 4 }), fuseChunk({ ...base, k0: 5, k1: 9 })]);
    expect(split.index.length).toBe(whole.index.length);
  });

  it("porosity carves holes (fewer solid samples → a different, larger surface)", () => {
    const solid = fuseChunk({ ...base, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, porosity: 0 } });
    const porous = fuseChunk({ ...base, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, porosity: 1.5 } });
    expect(porous.index.length).not.toBe(solid.index.length);
  });
});

describe("resin: the oldest layers become a translucent body", () => {
  const later = { ...sed, tNow: 9000 }; // the same parts, much later: their layers are old enough for resin
  const old = { ...base, sediment: later };
  it("faces of resin layers come after the opaque ones (resinStart), merged per kind across chunks", () => {
    expect(isResin(3, later, DEFAULT_FUSE)).toBe(true);
    expect(isResin(3, sed, DEFAULT_FUSE)).toBe(false);
    const m = fuseChunk({ ...old, k0: 0, k1: 9 });
    expect(m.resinStart).toBeLessThan(m.index.length);
    const none = fuseChunk({ ...old, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, resinShare: 2 } });
    expect(none.resinStart).toBe(none.index.length);
    const a = fuseChunk({ ...old, k0: 0, k1: 4 }), b = fuseChunk({ ...old, k0: 5, k1: 9 });
    const merged = mergeMeshes([a, b]);
    expect(merged.resinStart).toBe(a.resinStart + b.resinStart);
    expect(merged.index.length).toBe(a.index.length + b.index.length);
  });
});
