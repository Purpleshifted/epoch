import { describe, expect, it } from "vitest";
import { DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, fuseChunk, fusedShare, isResin, mergeMeshes, natureHistory, type Box, type FuseMesh, type PEvent } from "./index";

const SPU = 30;
const sed = { tNow: 3000, secPerUnit: SPU, timeScale: 0.02, tauYears: 600 };
const part = (over: Partial<Box>): Box => ({ kind: "mass", seed: 1, material: "concrete", x: 1.2, y: 5.5, z: 1.2, sx: 1.5, sy: 1, sz: 1.5, tone: 0.5, along: 0, slot: 5, ...over });
// a little block of masses in slots 3–8
const parts: Box[] = [];
for (let k = 3; k <= 8; k++) for (let a = 0; a < 3; a++) parts.push(part({ x: 0.8 + a * 0.9, y: k + 0.5, z: 1.2 + (a % 2) * 0.6, slot: k }));
const all = (v: number) => parts.map(() => v);
const base = { parts, history: null, x0: -1, z0: -1, nx: 6, nz: 6, unit: 1, sediment: sed, cfg: DEFAULT_FUSE };
const decayed = { ...base, decay: all(0.9), reclaim: all(0), standing: parts.map(() => false) };

/** Distance from a point to the nearest part's box (0 inside). */
function nearest(x: number, y: number, z: number): number {
  let best = Infinity;
  for (const b of parts) {
    const dx = Math.max(0, Math.abs(x - b.x) - b.sx / 2);
    const dy = Math.max(0, Math.abs(y - b.y) - b.sy / 2);
    const dz = Math.max(0, Math.abs(z - b.z) - b.sz / 2);
    best = Math.min(best, Math.hypot(dx, dy, dz));
  }
  return best;
}
const verts = (m: FuseMesh) => Array.from({ length: m.position.length / 3 }, (_, i) => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]]);

describe("fuse: what a structure becomes, on the structure itself", () => {
  it("fusedShare follows a part's decay from the onset", () => {
    expect(fusedShare(0, DEFAULT_FUSE)).toBe(0);
    expect(fusedShare(DEFAULT_FUSE.onset, DEFAULT_FUSE)).toBe(0);
    expect(fusedShare(1, DEFAULT_FUSE)).toBe(1);
    expect(fusedShare(1, { ...DEFAULT_FUSE, enabled: false })).toBe(0);
  });

  it("fresh parts (no decay, nothing grown) make no mass", () => {
    expect(fuseChunk({ ...base, k0: 0, k1: 9, decay: all(0), reclaim: all(0) }).index.length).toBe(0);
  });

  it("decayed parts become a mesh with valid indices, normals and colours", () => {
    const m = fuseChunk({ ...decayed, k0: 0, k1: 9 });
    expect(m.index.length).toBeGreaterThan(0);
    expect(m.index.length % 3).toBe(0);
    for (const i of m.index) expect(i).toBeLessThan(m.position.length / 3);
    expect(m.normal.length).toBe(m.position.length);
    expect(m.color.length).toBe(m.position.length);
    for (const v of m.normal) expect(Number.isFinite(v)).toBe(true);
  });

  it("the mass stays on the structure — never a slab of its own", () => {
    const reach = DEFAULT_FUSE.blur * DEFAULT_FUSE.voxel + DEFAULT_FUSE.accDepth + 2 * DEFAULT_FUSE.voxel;
    const m = fuseChunk({ ...decayed, k0: 0, k1: 9, reclaim: all(0.8), standing: parts.map(() => true) });
    for (const [x, y, z] of verts(m)) expect(nearest(x, y, z)).toBeLessThanOrEqual(reach);
  });

  it("vegetation alone (fresh structure) makes no mass", () => {
    const events: PEvent[] = Array.from({ length: 60 }, (_, i) => ({ id: `v${i}`, o: "v", r: "worker", k: "p", x: 30, z: 30, s: i + 0.5 }));
    const history = natureHistory({ events, seeds: [], secPerUnit: SPU, k0: 0, k1: 9, margin: 40, nature: DEFAULT_NATURE, fold: DEFAULT_FOLD });
    expect(fuseChunk({ ...base, history, k0: 0, k1: 9, decay: all(0), reclaim: all(0) }).index.length).toBe(0);
  });

  it("ACCRETION: growths appear on and under standing parts before they decay", () => {
    const m = fuseChunk({ ...base, k0: 0, k1: 9, decay: all(0), reclaim: all(0.9), standing: parts.map(() => true) });
    expect(m.index.length).toBeGreaterThan(0);
    const tops = Math.max(...parts.map((b) => b.y + b.sy / 2));
    expect(verts(m).some(([, y]) => y > tops)).toBe(true); // something grows above the top
    // fallen parts carry no growths
    expect(fuseChunk({ ...base, k0: 0, k1: 9, decay: all(0), reclaim: all(0.9), standing: parts.map(() => false) }).index.length).toBe(0);
  });

  it("is deterministic, and chunks tile without gaps or doubles", () => {
    const whole = fuseChunk({ ...decayed, k0: 0, k1: 9 });
    expect(fuseChunk({ ...decayed, k0: 0, k1: 9 })).toEqual(whole);
    const split = mergeMeshes([fuseChunk({ ...decayed, k0: 0, k1: 4 }), fuseChunk({ ...decayed, k0: 5, k1: 9 })]);
    expect(split.index.length).toBe(whole.index.length);
  });

  it("porosity carves holes", () => {
    const solid = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, porosity: 0 } });
    const porous = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, porosity: 1.5 } });
    expect(porous.index.length).not.toBe(solid.index.length);
  });
});

describe("resin: the oldest layers become a translucent body", () => {
  const later = { ...sed, tNow: 9000 }; // the same parts, much later: their layers are old enough for resin
  const old = { ...decayed, sediment: later };
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
