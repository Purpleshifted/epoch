import { describe, expect, it } from "vitest";
import { DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, DEFAULT_STUDY, accretionShare, fuseChunk, fusedShare, gatheringShare, isResin, isSkeleton, mergeMeshes, natureHistory, type Box, type FuseMesh, type PEvent } from "./index";

const SPU = 30;
const sed = { tNow: 3000, secPerUnit: SPU, timeScale: 0.02, tauYears: 600 };
const part = (over: Partial<Box>): Box => ({ kind: "mass", seed: 1, material: "concrete", x: 1.2, y: 5.5, z: 1.2, sx: 1.5, sy: 1, sz: 1.5, tone: 0.5, along: 0, slot: 5, ...over });
// a little block of masses in slots 3–8
const parts: Box[] = [];
for (let k = 3; k <= 8; k++) for (let a = 0; a < 3; a++) parts.push(part({ x: 0.8 + a * 0.9, y: k + 0.5, z: 1.2 + (a % 2) * 0.6, slot: k }));
const all = (v: number) => parts.map(() => v);
const base = { parts, history: null, x0: -1, z0: -1, nx: 6, nz: 6, unit: 1, sediment: sed, cfg: DEFAULT_FUSE };
const decayed = { ...base, decay: all(0.9), standing: parts.map(() => false) };

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
  it("one corrosion clock: points gather, then growths take over, then the part fuses", () => {
    const F = DEFAULT_FUSE;
    expect(fusedShare(F.fuseOnset, F)).toBe(0);
    expect(fusedShare(1, F)).toBe(1);
    expect(accretionShare(F.accOnset, F)).toBe(0);
    expect(accretionShare(F.fuseOnset, F)).toBeCloseTo(1, 9);
    // points: none on a fresh part, most just before the growths, gone once the growths are halfway
    expect(gatheringShare(0, F)).toBe(0);
    expect(gatheringShare(F.accOnset, F)).toBeCloseTo(1, 9);
    expect(gatheringShare((F.accOnset + F.fuseOnset) / 2, F)).toBeCloseTo(0, 9);
    // continuity: around accOnset points are still there while the first specks appear
    const mid = F.accOnset + (F.fuseOnset - F.accOnset) * 0.2;
    expect(gatheringShare(mid, F)).toBeGreaterThan(0.2);
    expect(accretionShare(mid, F)).toBeGreaterThan(0);
    expect(fusedShare(1, { ...F, enabled: false })).toBe(0);
    // points gather before any corrosion (their own process, `pre`), and go on into it
    expect(gatheringShare(0, F, 0.5)).toBeCloseTo(0.5, 9);
    expect(gatheringShare(F.accOnset, F, 1)).toBeCloseTo(1, 9); // continuous where weathering begins
    expect(gatheringShare((F.accOnset + F.fuseOnset) / 2, F, 1)).toBeCloseTo(0, 9); // and still gone under the growths
  });

  it("fresh parts (no decay, nothing grown) make no mass", () => {
    expect(fuseChunk({ ...base, k0: 0, k1: 9, decay: all(0) }).index.length).toBe(0);
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
    const m = fuseChunk({ ...decayed, k0: 0, k1: 9, decay: all(0.5), standing: parts.map(() => true) });
    for (const [x, y, z] of verts(m)) expect(nearest(x, y, z)).toBeLessThanOrEqual(reach);
  });

  it("vegetation alone (fresh structure) makes no mass", () => {
    const events: PEvent[] = Array.from({ length: 60 }, (_, i) => ({ id: `v${i}`, o: "v", r: "worker", k: "p", x: 30, z: 30, s: i + 0.5 }));
    const history = natureHistory({ events, seeds: [], secPerUnit: SPU, k0: 0, k1: 9, margin: 40, nature: DEFAULT_NATURE, fold: DEFAULT_FOLD });
    expect(fuseChunk({ ...base, history, k0: 0, k1: 9, decay: all(0) }).index.length).toBe(0);
  });

  it("ACCRETION: growths only once corrosion has begun, on and under standing parts, before they fuse", () => {
    const up = parts.map(() => true);
    // not corroding yet: no growths, however long abandoned (that stage is points)
    expect(fuseChunk({ ...base, k0: 0, k1: 9, decay: all(DEFAULT_FUSE.accOnset * 0.9), standing: up }).index.length).toBe(0);
    const between = (DEFAULT_FUSE.accOnset + DEFAULT_FUSE.fuseOnset) / 2 + 0.08;
    const m = fuseChunk({ ...base, k0: 0, k1: 9, decay: all(between), standing: up });
    expect(m.index.length).toBeGreaterThan(0);
    const tops = Math.max(...parts.map((b) => b.y + b.sy / 2));
    expect(verts(m).some(([, y]) => y > tops)).toBe(true); // something grows above the top
    // fallen parts carry no growths
    expect(fuseChunk({ ...base, k0: 0, k1: 9, decay: all(between), standing: parts.map(() => false) }).index.length).toBe(0);
  });

  it("young growths are sparse specks, older ones a crust", () => {
    const up = parts.map(() => true);
    const F = DEFAULT_FUSE;
    const young = fuseChunk({ ...base, k0: 0, k1: 9, decay: all(F.accOnset + (F.fuseOnset - F.accOnset) * 0.3), standing: up });
    const old = fuseChunk({ ...base, k0: 0, k1: 9, decay: all(F.fuseOnset - 0.01), standing: up });
    expect(young.index.length).toBeLessThan(old.index.length);
  });

  it("is deterministic, and chunks tile without gaps or doubles", () => {
    const whole = fuseChunk({ ...decayed, k0: 0, k1: 9 });
    expect(fuseChunk({ ...decayed, k0: 0, k1: 9 })).toEqual(whole);
    const split = mergeMeshes([fuseChunk({ ...decayed, k0: 0, k1: 4 }), fuseChunk({ ...decayed, k0: 5, k1: 9 })]);
    expect(split.index.length).toBe(whole.index.length);
  });

  it("smoothed surfaces agree across chunk seams (the same vertices where two chunks meet)", () => {
    const used = (m: FuseMesh) => new Set(Array.from(m.index, (i) => `${m.position[i * 3].toFixed(4)},${m.position[i * 3 + 1].toFixed(4)},${m.position[i * 3 + 2].toFixed(4)}`));
    const whole = fuseChunk({ ...decayed, k0: 0, k1: 9 });
    const split = mergeMeshes([fuseChunk({ ...decayed, k0: 0, k1: 4 }), fuseChunk({ ...decayed, k0: 5, k1: 9 })]);
    expect([...used(split)].sort()).toEqual([...used(whole)].sort());
    // and smoothing does move them (off the voxel facets)
    const raw = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, smooth: 0 } });
    expect(raw.position).not.toEqual(whole.position);
  });

  it("SAG: the mass hangs further down than without", () => {
    const low = (m: FuseMesh) => Math.min(...verts(m).map(([, y]) => y));
    const flat = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, sag: 0 } });
    const hung = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, sag: 0.85 } });
    expect(low(hung)).toBeLessThan(low(flat));
  });

  it("SKELETON: a share of the concrete keeps its form until late, wrapped only thinly", () => {
    const F = DEFAULT_FUSE;
    const sk = parts.filter((b) => isSkeleton(b, 0.5, { ...F, skeleton: 0.5 }));
    expect(sk.length).toBeGreaterThan(0);
    expect(sk.length).toBeLessThan(parts.length);
    expect(parts.some((b) => isSkeleton(b, F.skeletonUntil, { ...F, skeleton: 1 }))).toBe(false); // swallowed at last
    expect(isSkeleton(part({ kind: "column" }), 0.5, { ...F, skeleton: 1 })).toBe(false); // steel is not skeleton
    const plain = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...F, sag: 0, blur: 0, scatter: 0, porosity: 0 } });
    const bones = fuseChunk({ ...decayed, k0: 0, k1: 9, skeleton: parts.map(() => true), cfg: { ...F, sag: 0, blur: 0, scatter: 0, porosity: 0, skeletonWrap: 0 } });
    expect(bones.index.length).toBeLessThan(plain.index.length);
  });

  it("SCATTER: the young mass breaks up at its edges, the old one does not", () => {
    const closed = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, scatter: 0 } });
    const broken = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, scatter: 1.5 } });
    expect(broken.index.length).not.toBe(closed.index.length);
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

describe("form study (V2): fill, shell", () => {
  // one building: a plinth, masses in slots 3–6 and a slab over them (a room of 4 slots)
  const bld: Box[] = [
    part({ kind: "plinth", x: 2, y: 2.85, z: 2, sx: 3.2, sy: 0.3, sz: 3.2, slot: 2 }),
    part({ kind: "slab", x: 2, y: 7.05, z: 2, sx: 3.6, sy: 0.1, sz: 3.6, slot: 7 }),
  ];
  for (let k = 3; k <= 6; k++) bld.push(part({ x: 1.6 + (k % 2) * 0.8, y: k + 0.5, z: 2, sx: 0.8, sy: 0.9, sz: 0.8, slot: k }));
  const decay = bld.map((b) => (b.kind === "mass" ? 0.9 : 0.2));
  const cfgOf = (over: Partial<typeof DEFAULT_STUDY>) => ({ ...DEFAULT_FUSE, study: { ...DEFAULT_STUDY, ...over } });
  const room = { ...base, parts: bld, decay, standing: bld.map(() => true), x0: -1, z0: -1, nx: 6, nz: 6, k0: 0, k1: 9 };

  it("all switches off = the mass as before (V1 stays the same)", () => {
    expect(fuseChunk({ ...room, cfg: cfgOf({}) })).toEqual(fuseChunk({ ...room, cfg: DEFAULT_FUSE }));
  });

  it("B FILL: the plates are the frame; the mass fills the room below the slab, inside its footprint", () => {
    const cfg = cfgOf({ fill: true });
    expect(isSkeleton(bld[1], 0.5, cfg)).toBe(true);
    expect(isSkeleton(bld[1], 0.5, { ...cfg, skeleton: 0 })).toBe(true);
    expect(isSkeleton(bld[1], 0.5, { ...DEFAULT_FUSE, skeleton: 0 })).toBe(false);
    const m = fuseChunk({ ...room, cfg });
    const vs = verts(m);
    // the room is filled up to the ceiling (just under the slab), between the masses too
    expect(vs.some(([x, y]) => y > 6.3 && y < 7 && Math.abs(x - 2) > 1)).toBe(true);
    expect(fuseChunk({ ...room, cfg: DEFAULT_FUSE }).position.length).toBeLessThan(m.position.length);
    // and it hardly swells past the building (the slab's footprint + a little)
    const swell = (mm: FuseMesh) => Math.max(...verts(mm).map(([x, , z]) => Math.max(Math.abs(x - 2), Math.abs(z - 2))));
    expect(swell(m)).toBeLessThan(swell(fuseChunk({ ...room, cfg: DEFAULT_FUSE })) + 0.5);
    // no room without a building between the plates
    const plates = { ...room, parts: bld.slice(0, 2), decay: decay.slice(0, 2) };
    expect(fuseChunk({ ...plates, cfg }).index.length).toBe(fuseChunk({ ...plates, cfg: DEFAULT_FUSE }).index.length);
  });

  it("C SHELL: the mass is hollow (an inner surface) and opened by cells", () => {
    const big: Box[] = [];
    for (let k = 3; k <= 8; k++) big.push(part({ x: 2, y: k + 0.5, z: 2, sx: 3.2, sy: 1, sz: 3.2, slot: k }));
    const block = { ...base, parts: big, decay: big.map(() => 1), standing: big.map(() => false), k0: 0, k1: 9 };
    const flat = { sag: 0, scatter: 0, porosity: 0 };
    const solid = fuseChunk({ ...block, cfg: { ...DEFAULT_FUSE, ...flat } });
    const closed = fuseChunk({ ...block, cfg: { ...cfgOf({ shell: true, ribOpen: 0 }), ...flat } });
    const open = fuseChunk({ ...block, cfg: { ...cfgOf({ shell: true, ribOpen: 1 }), ...flat } });
    // a vertex well inside the outer surface (|x − 2| ≈ 2.6) exists only once it is hollow
    const inner = (m: FuseMesh) => verts(m).some(([x, y, z]) => Math.abs(x - 2) < 2 && Math.abs(z - 2) < 2 && y > 4.5 && y < 7.5);
    expect(inner(solid)).toBe(false);
    expect(inner(closed)).toBe(true);
    expect(open.index.length).not.toBe(closed.index.length);
  });

  it("E PIPES: a part fuses as tubes along its edges — the middle of a big box stays open", () => {
    const big: Box[] = [part({ x: 2, y: 5.5, z: 2, sx: 3.2, sy: 3, sz: 3.2, slot: 5 })];
    const one = { ...base, parts: big, decay: [1], standing: [false], k0: 0, k1: 9 };
    const flat = { sag: 0, scatter: 0, porosity: 0, gain: 1, blur: 0, smooth: 0 };
    const full = fuseChunk({ ...one, cfg: { ...DEFAULT_FUSE, ...flat } });
    const pipes = fuseChunk({ ...one, cfg: { ...cfgOf({ pipe: true, pipeRadius: 0.3 }), ...flat } });
    expect(pipes.index.length).toBeGreaterThan(0);
    // a vertex on the middle of a face of the box exists for the full box, not for the tubes (the face is open)
    const faceMid = (m: FuseMesh) => verts(m).some(([x, y, z]) => Math.abs(x - 2) < 0.5 && Math.abs(y - 5.5) < 0.5 && z > 3.3);
    expect(faceMid(full)).toBe(true);
    expect(faceMid(pipes)).toBe(false);
    // and the tubes run along the edges: a vertex near a vertical edge, halfway up
    expect(verts(pipes).some(([x, y, z]) => Math.abs(x - 3.6) < 0.5 && Math.abs(z - 3.6) < 0.5 && Math.abs(y - 5.5) < 0.6)).toBe(true);
  });

  it("SIZE CURVES: by size, a small part fuses as its box and a large one as its frame; the shell's openings mix", () => {
    const small = part({ x: 1, y: 5.5, z: 1, sx: 1, sy: 1, sz: 1, slot: 5 });
    const big = part({ x: 4, y: 5.5, z: 4, sx: 3.2, sy: 3, sz: 3.2, slot: 5 });
    const two = { ...base, parts: [small, big], decay: [1, 1], standing: [false, false], x0: -1, z0: -1, nx: 8, nz: 8, k0: 0, k1: 9 };
    const flat = { sag: 0, scatter: 0, porosity: 0, gain: 1, blur: 0, smooth: 0 };
    const curve = { pipeSize: true, pipeSmall: 0, pipeLarge: 1, sizeSmall: 1.5, sizeLarge: 3, sizeJitter: 0 };
    const m = fuseChunk({ ...two, cfg: { ...cfgOf(curve), ...flat } });
    // the small box keeps the middle of its face, the big one's face is open (only its edges fused)
    expect(verts(m).some(([x, y, z]) => Math.abs(x - 1) < 0.3 && Math.abs(y - 5.5) < 0.3 && z > 1.2)).toBe(true);
    expect(verts(m).some(([x, y, z]) => Math.abs(x - 4) < 0.5 && Math.abs(y - 5.5) < 0.5 && z > 5.3)).toBe(false);
    expect(verts(m).some(([x, y, z]) => Math.abs(x - 5.6) < 0.5 && Math.abs(z - 5.6) < 0.5 && Math.abs(y - 5.5) < 0.6)).toBe(true);
    // the shell's openings by size: a valid mesh, different from both pure shapes
    const shellOf = (holeShape: "voronoi" | "noise" | "size") => fuseChunk({ ...two, cfg: { ...cfgOf({ shell: true, ribOpen: 0.8, holeShape, holeVoronoiSmall: 0, holeVoronoiLarge: 1, sizeSmall: 1.5, sizeLarge: 3, sizeJitter: 0 }), ...flat } });
    const mixed = shellOf("size");
    expect(mixed.index.length).toBeGreaterThan(0);
    expect(mixed.index.length).not.toBe(shellOf("voronoi").index.length);
    expect(mixed.index.length).not.toBe(shellOf("noise").index.length);
  });

  it("SPIKES: thin spikes of the same mass grow out of the surface, up to their length", () => {
    const flat = { sag: 0, scatter: 0, porosity: 0, gain: 1, blur: 0, smooth: 0 };
    const plain = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, ...flat } });
    const spiky = fuseChunk({ ...decayed, k0: 0, k1: 9, cfg: { ...DEFAULT_FUSE, ...flat, spikes: 1, spikeLen: 1.5 } });
    const reach = (m: FuseMesh) => Math.max(...verts(m).map(([x, y, z]) => nearest(x, y, z)));
    expect(spiky.position.length).toBeGreaterThan(plain.position.length);
    expect(reach(spiky)).toBeGreaterThan(reach(plain) + 0.4);
    expect(reach(spiky)).toBeLessThanOrEqual(1.5 + 2 * DEFAULT_FUSE.voxel);
  });
});
