/**
 * parliament/fuse.ts
 *
 * What a structure BECOMES with age, as one surface (naive surface nets: one vertex per surface cell, quads between).
 * Everything runs on ONE clock, each part's own corrosion (decay = 1 − survival, seeds.wearModel), so it happens on
 * the structure itself, never as a separate slab, and never on a part that has not begun to corrode:
 *
 *   0 GATHERING   already in the present (within the grace depth, before any corrosion) and on until accOnset: no
 *                 mass here — vegetation POINTS gather on and around the part
 *                 (natureHistory.reclaimPoints with a decay clock), densest just before accOnset
 *   1 ACCRETION   accOnset → fuseOnset: lumpy organic matter grows on the part's top and hangs below it, starting as
 *                 small sparse specks (noise-thresholded) and thickening (ref 9578); the points fade out meanwhile
 *   2 FUSION      fuseOnset → 1: the part itself becomes mass, max(share, gain · blurred share) — parts keep their form
 *                 and near ones cling together; a part that has fallen away leaves its mass in its place. Vegetation
 *                 sediment sticks to it (only near decaying concrete)
 *   3 POROSITY    older layers have round voids (refs 9579/9580)
 *
 *   The SKELETON: a share of the concrete parts (slabs, slat bundles) keep their sharp, orthogonal form inside the mass
 *   (drawn as parts, wrapped only thinly) until late — a frame protected in exposed concrete; only the oldest layers
 *   swallow it. The mass SAGS downwards (drips), is smoothed (Taubin), is dense and crisp in the old bottom layers and
 *   breaks into scattered fragments at its edges in the young ones.
 *   4 RESIN       the oldest layers (sediment share ≥ `resinShare`) are a second face group (FuseMesh.resinStart …) for a
 *                 translucent material; their standing parts stay visible inside
 *
 * FORM STUDY (V2, `cfg.study`; all off = the mass wraps the parts as above). Two ways for the same mass, to compare:
 *   B FILL     the mass FILLS the room between a building's plates (refs 9645, 9659): it hangs from the plate above and
 *              grows down to the one below as the parts in the room fuse; the plates stay sharp (a frame, like the
 *              skeleton) and the mass hardly swells past the building
 *   C SHELL    the mass is a SHELL, hollow inside (9649, 9662), opened by cells that touch each other so only RIBS remain
 *              between them (Voronoi, refs 9664–9668, 9648); dark pits on its surface (colour only). Replaces the round voids
 *   (D FIBRE — discs, hanging fibre lines and spines — was tried and dropped: the artist did not want it, 2026-10-19.)
 *
 * The field is sampled on a GLOBAL voxel grid (spacing `voxel`) and meshed in chunks of whole slots. Every chunk
 * computes its field with padding, so neighbouring chunks agree on their shared vertices; each face belongs to the one
 * chunk that owns its edge, so nothing is drawn twice. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { natureAt, sedimentShare, type NatureHistory, type NaturePointOptions } from "./natureHistory";
import { halfHeight, partHash, type Box } from "./seeds";

export interface FuseConfig {
  enabled: boolean;
  /** Decay at which growths begin on a part (before it, vegetation points gather on it instead). */
  accOnset: number;
  /** Decay at which the part itself begins to turn into mass. */
  fuseOnset: number;
  /** Voxel spacing (world). */
  voxel: number;
  /** Box-blur radius in voxels: how far apart decaying pieces still cling together. */
  blur: number;
  /** The concrete field is max(decay, gain · blurred decay). */
  gain: number;
  /** How strongly holes are carved (× the layer's sediment share). */
  porosity: number;
  /** Iso level of the surface. */
  iso: number;
  /** Weight of the vegetation's sediment that sticks to decaying concrete. */
  natureWeight: number;
  /** ACCRETION: weight of the growths (× their progress between accOnset and fuseOnset); 0 = none. */
  accretion: number;
  /** Most thickness of the growths on top / hanging below a part (world), × their progress. */
  accDepth: number;
  /** Size of the lumps (world): larger = fewer, bigger clumps. */
  lump: number;
  /** Layers with a sediment share ≥ this become resin (translucent, parts inside); > 1 = never. */
  resinShare: number;
  /** Downward sag of the mass per voxel (0 = none … 0.9 = long drips). */
  sag: number;
  /** Taubin smoothing passes of the surface (0 = raw voxel facets). */
  smooth: number;
  /** Size of the round voids (world). */
  poreSize: number;
  /** How much the young layers' mass breaks into fragments at its edges (0 = a closed surface everywhere). */
  scatter: number;
  /** Share of the concrete parts that are SKELETON: they keep their sharp form inside the mass. */
  skeleton: number;
  /** Decay up to which the skeleton stands out of the mass (after it, it is swallowed too). */
  skeletonUntil: number;
  /** How thickly the mass wraps a skeleton part (× its fused share; 1 = like any other part). */
  skeletonWrap: number;
  /** SPIKES: share of the surface cells a thin spike of the same mass grows out of (0 = none). */
  spikes: number;
  /** Longest spike (world); each spike has its own hashed length up to this. */
  spikeLen: number;
  /** Colour of the growths (linear RGB); absent = the pale ochre-green default. */
  growthColor?: [number, number, number];
  /** FORM STUDY (V2): other ways for the mass; absent = none (the mass wraps the parts). */
  study?: FuseStudy;
}

/** The form study's switches and numbers (see the file header: B FILL, C SHELL). Both can be combined. */
export interface FuseStudy {
  /** B: the mass fills the rooms between a building's plates; the plates stay sharp. */
  fill: boolean;
  /** B: how full a room gets once its parts have fused (1 = to the plate below). */
  fillAmount: number;
  /** B: how far the fill keeps back from the plate's edges (world). */
  fillInset: number;
  /** C: the mass is a hollow shell with rib-edged openings. */
  shell: boolean;
  /** C: shell thickness (voxels). */
  shellThick: number;
  /** C: size of the opening cells (world). */
  ribCell: number;
  /** C: width of the ribs between open cells (world). */
  ribWidth: number;
  /** C: share of the cells that open (× layer age: the old layers are most open). */
  ribOpen: number;
  /** C: dark pits on the surface (0 = none). */
  pits: number;
  /** E PIPES: a part fuses as tubes along its edges (its frame), not as its full box — tubes meet and merge like a
   *  multipipe over the building's wireframe; the rooms stay open. */
  pipe: boolean;
  /** E: tube radius (world). */
  pipeRadius: number;
}

export const DEFAULT_STUDY: FuseStudy = {
  fill: false,
  fillAmount: 1,
  fillInset: 0.25,
  shell: false,
  shellThick: 2,
  ribCell: 1.6,
  ribWidth: 0.3,
  ribOpen: 0.6,
  pits: 0.5,
  pipe: false,
  pipeRadius: 0.3,
};

/** B FILL: the plates that bound a room (they stay sharp as frame). */
export const FRAME_KINDS: ReadonlySet<Box["kind"]> = new Set<Box["kind"]>(["slab", "plinth"]);
/** B FILL: the tallest room between two plates (slots); taller = not one room (empty time lies between). */
export const FILL_MAX_GAP = 6;
/** B FILL: how much the blurred mass may still swell outside the rooms (× gain). */
const FILL_OUTSIDE = 0.35;

export const DEFAULT_FUSE: FuseConfig = {
  enabled: true,
  accOnset: 0.08,
  fuseOnset: 0.3,
  voxel: 0.4,
  blur: 2,
  gain: 2.5,
  porosity: 0.6,
  iso: 0.3,
  natureWeight: 0.7,
  accretion: 1.6,
  accDepth: 0.9,
  lump: 0.9,
  resinShare: 0.85,
  sag: 0.7,
  smooth: 2,
  poreSize: 1.2,
  scatter: 0.6,
  skeleton: 0.3,
  skeletonUntil: 0.9,
  skeletonWrap: 0.35,
  spikes: 0,
  spikeLen: 1.2,
};

/** Concrete kinds that can be skeleton (the orthogonal frame: slabs, slat bundles and walls, plinths). */
const SKELETON_KINDS = new Set<Box["kind"]>(["slab", "mass", "plinth", "basement"]);

/** Whether a part is skeleton at this decay: it keeps its form (is drawn, not absorbed) and the mass only wraps it. */
export function isSkeleton(b: Box, decay: number, cfg: FuseConfig): boolean {
  if (!cfg.enabled || !SKELETON_KINDS.has(b.kind) || decay >= cfg.skeletonUntil) return false;
  if (cfg.study?.fill && FRAME_KINDS.has(b.kind)) return true; // B FILL: the plates are the frame
  if (cfg.skeleton <= 0) return false;
  // its own hash, independent of the absorption order
  return (partHash(b) * 7.31) % 1 < cfg.skeleton;
}

/** Sample rows of padding a chunk needs: below (blur, smoothing) and above (also the sag hanging down into it). */
export function fusePad(cfg: FuseConfig): { below: number; above: number } {
  const st = cfg.study;
  // C: the shell's interior is found by a blur of its own; spikes reach out of the chunk's rows
  const spikeRows = cfg.spikes > 0 ? Math.ceil(cfg.spikeLen / cfg.voxel) + 1 : 0;
  const base = Math.max(2, Math.round(cfg.blur) * 2 + 2) + 2 * Math.max(0, Math.round(cfg.smooth)) + (st?.shell ? Math.round(st.shellThick) : 0) + spikeRows;
  const sagRows = cfg.sag > 0.01 ? Math.min(10, Math.ceil(Math.log(0.03) / Math.log(Math.min(0.95, cfg.sag)))) : 0;
  return { below: base, above: base + sagRows };
}

type Sediment = NonNullable<NaturePointOptions["sediment"]>;

const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
const smoothRamp = (x: number, a: number, b: number) => {
  const t = ramp(x, a, b);
  return t * t * (3 - 2 * t);
};

/** How much of a part has itself turned into mass, from its decay (1 − survival). */
export function fusedShare(decay: number, cfg: FuseConfig): number {
  if (!cfg.enabled) return 0;
  return ramp(decay, cfg.fuseOnset, 1);
}

/** How far the growths on a part have come (0 none … 1 full), from its decay. */
export function accretionShare(decay: number, cfg: FuseConfig): number {
  if (!cfg.enabled || cfg.accretion <= 0) return 0;
  return smoothRamp(decay, cfg.accOnset, cfg.fuseOnset);
}

/**
 * How many vegetation points gather on a part (0 … 1). They already gather in the PRESENT, before any corrosion:
 * `pre` (0 … 1) is how deep the part lies in the grace depth (0 at the present, 1 where weathering begins). Then they
 * rise with its decay until accOnset, and fade as the growths take over (gone by halfway to fuseOnset). Without
 * fusion: rising and staying.
 */
export function gatheringShare(decay: number, cfg: FuseConfig, pre = 0): number {
  const up = Math.max(pre, smoothRamp(decay, 0, cfg.accOnset));
  if (!cfg.enabled) return up;
  // with growths: gone by halfway to the fusion; without (accretion 0): they stay until the fusion itself begins
  const to = cfg.accretion > 0 ? (cfg.accOnset + cfg.fuseOnset) / 2 : cfg.fuseOnset;
  return up * (1 - smoothRamp(decay, cfg.accOnset, to));
}

export interface FuseMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Opaque faces first, then the resin faces from `resinStart` on. */
  index: Uint32Array;
  resinStart: number;
}

const EMPTY: FuseMesh = { position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0), index: new Uint32Array(0), resinStart: 0 };

/** Whether slot k has become resin (on the layer's corrosion clock when given, else the sediment clock). */
export function isResin(k: number, sed: Sediment, cfg: FuseConfig, layerDecay?: (k: number) => number): boolean {
  return cfg.enabled && cfg.resinShare <= 1 && (layerDecay ? layerDecay(k) : sedimentShare(k, sed)) >= cfg.resinShare;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lat = (x: number, y: number, z: number, salt: number) => hash2((x * 73856093) ^ z, (y * 19349663) ^ (z * 83492791), salt);
/** Trilinear value noise, 0..1. */
function noise3(x: number, y: number, z: number, salt: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const a = lat(x0, y0, z0, salt), b = lat(x0 + 1, y0, z0, salt), c = lat(x0, y0 + 1, z0, salt), d = lat(x0 + 1, y0 + 1, z0, salt);
  const e = lat(x0, y0, z0 + 1, salt), f = lat(x0 + 1, y0, z0 + 1, salt), g = lat(x0, y0 + 1, z0 + 1, salt), h = lat(x0 + 1, y0 + 1, z0 + 1, salt);
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx, ef = e + (f - e) * fx, gh = g + (h - g) * fx;
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy;
  return lo + (hi - lo) * fz;
}

/** The 12 edges of a cube, as corner pairs (corner bit 1 = +x, 2 = +y, 4 = +z). */
const CUBE_EDGES = [0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7];

/** One running-sum box-blur pass along a line of `n` samples starting at `o` with stride `st`. */
function blurLine(src: Float32Array, dst: Float32Array, o: number, st: number, n: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  let sum = 0;
  for (let t = -r; t <= r; t++) sum += src[o + Math.min(n - 1, Math.max(0, t)) * st];
  for (let t = 0; t < n; t++) {
    dst[o + t * st] = sum * inv;
    sum += src[o + Math.min(n - 1, t + r + 1) * st] - src[o + Math.max(0, t - r) * st];
  }
}

/** Separable box blur (radius r) of a nx·ny·nz field (x fastest), in place, using `tmp`. */
function blur3(f: Float32Array, tmp: Float32Array, nx: number, ny: number, nz: number, r: number): void {
  if (r < 1) return;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) blurLine(f, tmp, (k * ny + j) * nx, 1, nx, r);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) blurLine(tmp, f, k * ny * nx + i, nx, ny, r);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) blurLine(f, tmp, j * nx + i, nx * ny, nz, r);
  f.set(tmp);
}

/**
 * Round voids: one sphere (or none) per cell of size `size`, at a hashed place with a hashed radius. Returns how deep
 * (x, y, z) lies inside the nearest one (0 outside … 1 at its centre).
 */
function voids(x: number, y: number, z: number, size: number): number {
  const s = Math.max(0.2, size);
  const cx = Math.floor(x / s), cy = Math.floor(y / s), cz = Math.floor(z / s);
  let best = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = cx + dx, Y = cy + dy, Z = cz + dz;
    if (lat(X, Y, Z, 71) > 0.55) continue; // about half the cells have a void
    const px = (X + 0.2 + 0.6 * lat(X, Y, Z, 72)) * s;
    const py = (Y + 0.2 + 0.6 * lat(X, Y, Z, 73)) * s;
    const pz = (Z + 0.2 + 0.6 * lat(X, Y, Z, 74)) * s;
    const r = s * (0.22 + 0.33 * lat(X, Y, Z, 75));
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < r) best = Math.max(best, 1 - d / r);
  }
  return best;
}

/**
 * Voronoi of one jittered point per cell of size `s` (y stretched by `ys`, so the cells are upright ovals): writes the
 * distances to the nearest and second-nearest point and the nearest point's hash (0..1) into `out`.
 */
function voronoi(x: number, y: number, z: number, s: number, ys: number, out: Float64Array): void {
  const sx = Math.max(0.2, s), sy = sx * ys;
  const cx = Math.floor(x / sx), cy = Math.floor(y / sy), cz = Math.floor(z / sx);
  let d1 = Infinity, d2 = Infinity, id = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = cx + dx, Y = cy + dy, Z = cz + dz;
    const px = (X + 0.1 + 0.8 * lat(X, Y, Z, 101)) * sx;
    const py = (Y + 0.1 + 0.8 * lat(X, Y, Z, 102)) * sy;
    const pz = (Z + 0.1 + 0.8 * lat(X, Y, Z, 103)) * sx;
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      id = lat(X, Y, Z, 104);
    } else if (d < d2) d2 = d;
  }
  out[0] = d1;
  out[1] = d2;
  out[2] = id;
}

/** Vertex neighbours from quads (a b c d flip owned), as CSR. */
function neighbours(quads: readonly number[], nv: number): { start: Int32Array; list: Int32Array } {
  const deg = new Int32Array(nv + 1);
  for (let t = 0; t < quads.length; t += 6) for (let e = 0; e < 4; e++) {
    deg[quads[t + e]]++;
    deg[quads[t + ((e + 1) & 3)]]++;
  }
  const start = new Int32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const at = start.slice(0, nv);
  const list = new Int32Array(start[nv]);
  for (let t = 0; t < quads.length; t += 6) for (let e = 0; e < 4; e++) {
    const a = quads[t + e], b = quads[t + ((e + 1) & 3)];
    list[at[a]++] = b;
    list[at[b]++] = a;
  }
  return { start, list };
}

/** Taubin smoothing (λ|μ): rounds the voxel facets without shrinking the mass. In place. */
function taubin(P: Float32Array, quads: readonly number[], nv: number, passes: number): void {
  const { start, list } = neighbours(quads, nv);
  const tmp = new Float32Array(P.length);
  const step = (w: number) => {
    for (let v = 0; v < nv; v++) {
      const a = start[v], b = start[v + 1];
      if (b === a) {
        tmp[v * 3] = P[v * 3];
        tmp[v * 3 + 1] = P[v * 3 + 1];
        tmp[v * 3 + 2] = P[v * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let e = a; e < b; e++) {
        const u = list[e] * 3;
        sx += P[u];
        sy += P[u + 1];
        sz += P[u + 2];
      }
      const inv = 1 / (b - a);
      for (let c = 0; c < 3; c++) tmp[v * 3 + c] = P[v * 3 + c] + w * ((c === 0 ? sx : c === 1 ? sy : sz) * inv - P[v * 3 + c]);
    }
    P.set(tmp);
  };
  for (let i = 0; i < passes; i++) {
    step(0.5);
    step(-0.53);
  }
}

/** Area-weighted normals from the faces (after smoothing), on the gradient's side; vertices without faces keep theirs. In place. */
function faceNormals(P: Float32Array, quads: readonly number[], N: Float32Array): void {
  const acc = new Float32Array(N.length);
  const tri = (a: number, b: number, c: number) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      acc[v * 3] += nx;
      acc[v * 3 + 1] += ny;
      acc[v * 3 + 2] += nz;
    }
  };
  for (let t = 0; t < quads.length; t += 6) {
    const a = quads[t], b = quads[t + 1], c = quads[t + 2], d = quads[t + 3];
    if (quads[t + 4]) {
      tri(a, c, b);
      tri(a, d, c);
    } else {
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  for (let v = 0; v < N.length; v += 3) {
    // the winding is not tied to the outside: keep the side the field's gradient (the old normal) says is out
    const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]);
    if (l <= 1e-12) continue;
    const sgn = acc[v] * N[v] + acc[v + 1] * N[v + 1] + acc[v + 2] * N[v + 2] < 0 ? -1 : 1;
    N[v] = (sgn * acc[v]) / l;
    N[v + 1] = (sgn * acc[v + 1]) / l;
    N[v + 2] = (sgn * acc[v + 2]) / l;
  }
}

export interface FuseChunkInput {
  /** Every part as BUILT (also those that have fallen away), at least those overlapping the chunk's slots ± padding. */
  parts: readonly Box[];
  /** Per part: decay = 1 − survival (0 fresh … 1 gone). Absent = 1 (all fully decayed). */
  decay?: ArrayLike<number>;

  /** Per part: still standing (accretion only grows on standing parts). Absent = all standing. */
  standing?: ArrayLike<boolean>;
  /** Per part: skeleton (isSkeleton): wrapped only thinly. Absent = none. */
  skeleton?: ArrayLike<boolean>;
  /** Vegetation history (may be null: concrete only). */
  history: NatureHistory | null;
  /** Slots [k0, k1] of this chunk. */
  k0: number;
  k1: number;
  /** World extent in x, z (cells). */
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  unit: number;
  sediment: Sediment;
  /**
   * ONE CLOCK (V2): the typical corrosion (0 … 1) of the parts of slot k — the layer's age on the parts' own clock.
   * It decides the resin (resinShare) and the bottom-heaviness, darkening, voids and crispness of the layers, so the
   * stages always come in order: gathering → growths → fusion → resin. Absent = the sediment clock (V1).
   */
  layerDecay?: (k: number) => number;
  cfg: FuseConfig;
}

/** Linear-RGB colours: fresh concrete, old stone; moss, humus, peat. */
/** The fused mass: the concrete's own grey, mixed in streaks with a low-saturation brown (ref 9570). */
const CONCRETE = [0.42, 0.42, 0.42];
/** The mass's stains: a darker grey, no brown (the artist, 2026-10-19: the soil before the resin is grey too). */
const DULL_BROWN = [0.2, 0.2, 0.2];
/** Accretions (ref 9578: pale ochre-green rock growths). */
const GROWTH = [0.42, 0.38, 0.22];

/** The fused surface of slots [k0, k1]. */
export function fuseChunk(input: FuseChunkInput): FuseMesh {
  const { cfg, unit, sediment: sed, history: h } = input;
  if (!cfg.enabled || input.nx <= 0 || input.nz <= 0) return EMPTY;
  const vs = cfg.voxel;
  const iso0 = cfg.iso;
  const GROW = cfg.growthColor ?? GROWTH;
  /** The age of a layer (0 … 1): the parts' corrosion clock when given, else the sediment clock. */
  const layerAge = (k: number) => Math.max(0, Math.min(1, input.layerDecay ? input.layerDecay(k) : sedimentShare(k, sed)));
  const { below: pad, above: padTop } = fusePad(cfg);
  // global sample indices: X = round(x / vs) etc.
  const I0 = Math.floor((input.x0 * CELL_SIZE) / vs) - pad;
  const I1 = Math.ceil(((input.x0 + input.nx) * CELL_SIZE) / vs) + pad;
  const K0 = Math.floor((input.z0 * CELL_SIZE) / vs) - pad;
  const K1 = Math.ceil(((input.z0 + input.nz) * CELL_SIZE) / vs) + pad;
  const Jlo = Math.floor((input.k0 * unit) / vs); // first owned sample row
  const Jhi = Math.floor(((input.k1 + 1) * unit) / vs); // first row of the next chunk
  const J0 = Jlo - pad;
  const J1 = Jhi + padTop;
  const nx = I1 - I0 + 1, ny = J1 - J0 + 1, nz = K1 - K0 + 1;
  const n = nx * ny * nz;
  if (n > 6e6) return EMPTY; // safety: refuse absurd grids
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // age of each sample row (sediment share): porosity and colour
  const rowQ = new Float32Array(ny);
  for (let j = 0; j < ny; j++) {
    const k = Math.floor(((J0 + j) * vs) / unit);
    rowQ[j] = k < 0 ? 0 : layerAge(k);
  }

  const C = new Float32Array(n); // concrete turned to mass (its fused share)
  const A = new Float32Array(n); // accretion: growths on standing parts
  const N = new Float32Array(n); // vegetation sediment
  const yLo = J0 * vs, yHi = J1 * vs;
  const fill = (arr: Float32Array, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    const ia = Math.max(0, Math.ceil(x0 / vs) - I0), ib = Math.min(nx - 1, Math.floor(x1 / vs) - I0);
    const ja = Math.max(0, Math.ceil(y0 / vs) - J0), jb = Math.min(ny - 1, Math.floor(y1 / vs) - J0);
    const ka = Math.max(0, Math.ceil(z0 / vs) - K0), kb = Math.min(nz - 1, Math.floor(z1 / vs) - K0);
    for (let k = ka; k <= kb; k++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const p = idx(i, j, k);
      if (arr[p] < v) arr[p] = v;
    }
  };
  const st = cfg.study;
  /** A capsule of radius r along the segment (x0,y0,z0)→(x1,y1,z1), written as max(v) into `arr`. */
  const tube = (arr: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, v: number) => {
    const ia = Math.max(0, Math.ceil((Math.min(x0, x1) - r) / vs) - I0), ib = Math.min(nx - 1, Math.floor((Math.max(x0, x1) + r) / vs) - I0);
    const ja = Math.max(0, Math.ceil((Math.min(y0, y1) - r) / vs) - J0), jb = Math.min(ny - 1, Math.floor((Math.max(y0, y1) + r) / vs) - J0);
    const ka = Math.max(0, Math.ceil((Math.min(z0, z1) - r) / vs) - K0), kb = Math.min(nz - 1, Math.floor((Math.max(z0, z1) + r) / vs) - K0);
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l2 = dx * dx + dy * dy + dz * dz || 1;
    for (let k = ka; k <= kb; k++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const px = (I0 + i) * vs, py = (J0 + j) * vs, pz = (K0 + k) * vs;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy + (pz - z0) * dz) / l2));
      const qx = x0 + dx * t - px, qy = y0 + dy * t - py, qz = z0 + dz * t - pz;
      if (qx * qx + qy * qy + qz * qz > r * r) continue;
      const p = idx(i, j, k);
      if (arr[p] < v) arr[p] = v;
    }
  };
  let any = false;
  for (let pi = 0; pi < input.parts.length; pi++) {
    const b = input.parts[pi];
    if (b.tilt) continue;
    const hh = halfHeight(b);
    if (b.y + hh + cfg.accDepth < yLo || b.y - hh - cfg.accDepth > yHi) continue;
    const hx = Math.max(b.sx, vs) / 2, hz = Math.max(b.sz, vs) / 2, hy = Math.max(2 * hh, vs) / 2;
    // 2 FUSION: the part becomes mass as it decays (also once it has fallen away: its mass stays in its place)
    const f = fusedShare(input.decay ? input.decay[pi] : 1, cfg);
    if (f > 0) {
      const v = input.skeleton?.[pi] ? f * cfg.skeletonWrap : f;
      if (st?.pipe) {
        // E PIPES: the part's twelve edges as tubes (its frame), the box itself left open
        const r = Math.max(vs * 0.6, st.pipeRadius);
        const xs = [b.x - hx, b.x + hx], ys = [b.y - hy, b.y + hy], zs = [b.z - hz, b.z + hz];
        for (const y of ys) for (const z of zs) tube(C, xs[0], y, z, xs[1], y, z, r, v);
        for (const x of xs) for (const z of zs) tube(C, x, ys[0], z, x, ys[1], z, r, v);
        for (const x of xs) for (const y of ys) tube(C, x, y, zs[0], x, y, zs[1], r, v);
      } else fill(C, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, v);
      any = true;
    }
    // 1 ACCRETION: growths on top and hanging below a standing part, from the moment it begins to corrode
    const r = accretionShare(input.decay ? input.decay[pi] : 1, cfg);
    const up = input.standing ? input.standing[pi] : true;
    if (r > 0.01 && up) {
      const d = cfg.accDepth * r;
      fill(A, b.x - hx, b.x + hx, b.y + hy - vs, b.y + hy + d, b.z - hz, b.z + hz, r * cfg.accretion);
      fill(A, b.x - hx * 0.9, b.x + hx * 0.9, b.y - hy - d * 0.7, b.y - hy + vs, b.z - hz * 0.9, b.z + hz * 0.9, r * cfg.accretion * 0.8);
      any = true;
    }
  }
  if (!any) return EMPTY;

  // B FILL: the rooms between a building's plates. A room spans from the top of one plate to the underside of the next
  // one up (the same seed, at most FILL_MAX_GAP slots: never across empty time), under the upper plate's footprint, and
  // only where the building's masses stood. As those masses fuse, the mass hangs from the ceiling and grows down to the
  // floor, its sides lumpy and kept back from the plate's edges; drips differ from column to column.
  const Fl = st?.fill ? new Float32Array(n) : null;
  const room = st?.fill ? new Uint8Array(n) : null;
  if (st && Fl && room) {
    const bySeed = new Map<number, number[]>();
    for (let pi = 0; pi < input.parts.length; pi++) {
      const b = input.parts[pi];
      if (b.tilt || (b.kind !== "mass" && !FRAME_KINDS.has(b.kind))) continue;
      const l = bySeed.get(b.seed);
      if (l) l.push(pi);
      else bySeed.set(b.seed, [pi]);
    }
    const lf = 1 / Math.max(0.1, cfg.lump);
    for (const list of bySeed.values()) {
      const plates = list.filter((pi) => FRAME_KINDS.has(input.parts[pi].kind)).sort((a, b) => input.parts[a].y - input.parts[b].y);
      for (let t = 0; t + 1 < plates.length; t++) {
        const lo = input.parts[plates[t]], hi = input.parts[plates[t + 1]];
        const yb = lo.y + halfHeight(lo), yt = hi.y - halfHeight(hi);
        if (yt - yb < 2 * vs || yt - yb > FILL_MAX_GAP * unit || yt < yLo || yb > yHi) continue;
        const ax0 = hi.x - hi.sx / 2, ax1 = hi.x + hi.sx / 2, az0 = hi.z - hi.sz / 2, az1 = hi.z + hi.sz / 2;
        // how far the room's parts have fused (their mean); none = no building here
        let sum = 0, cnt = 0;
        for (const pi of list) {
          const m = input.parts[pi];
          if (m.kind !== "mass" || m.y <= yb || m.y >= yt) continue;
          if (m.x + m.sx / 2 < ax0 || m.x - m.sx / 2 > ax1 || m.z + m.sz / 2 < az0 || m.z - m.sz / 2 > az1) continue;
          sum += fusedShare(input.decay ? input.decay[pi] : 1, cfg);
          cnt++;
        }
        const a = cnt ? sum / cnt : 0;
        if (a <= 0) continue;
        const ia = Math.max(0, Math.ceil(ax0 / vs) - I0), ib = Math.min(nx - 1, Math.floor(ax1 / vs) - I0);
        const ja = Math.max(0, Math.ceil(yb / vs) - J0), jb = Math.min(ny - 1, Math.floor(yt / vs) - J0);
        const ka = Math.max(0, Math.ceil(az0 / vs) - K0), kb = Math.min(nz - 1, Math.floor(az1 / vs) - K0);
        for (let k = ka; k <= kb; k++) for (let i = ia; i <= ib; i++) {
          const x = (I0 + i) * vs, z = (K0 + k) * vs;
          const reach = a * st.fillAmount * (0.55 + 0.9 * noise3(x * 0.9, 0, z * 0.9, 111)); // per column: drips
          for (let j = ja; j <= jb; j++) {
            const p = idx(i, j, k);
            room[p] = 1;
            const y = (J0 + j) * vs;
            const edge = Math.min(x - ax0, ax1 - x, z - az0, az1 - z);
            const side = smoothRamp(edge - st.fillInset + (noise3(x * lf, y * lf, z * lf, 112) - 0.5) * 0.9, 0, 0.6);
            const down = smoothRamp(reach - (yt - y) / (yt - yb), 0, 0.15);
            const v = (iso0 + 0.8) * side * down;
            if (v > Fl[p]) Fl[p] = v;
          }
        }
      }
    }
  }

  const tmp = new Float32Array(n);
  const Cb = C.slice();
  blur3(Cb, tmp, nx, ny, nz, Math.round(cfg.blur));
  // SAG: the mass hangs down — each row keeps a share of the row above it, more in some columns than others (drips)
  if (cfg.sag > 0.01) {
    const sag = Math.min(0.95, cfg.sag);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const s = sag * (0.55 + 0.45 * noise3((I0 + i) * vs * 0.8, 0, (K0 + k) * vs * 0.8, 51));
      for (let j = ny - 2; j >= 0; j--) {
        const p = idx(i, j, k), up = Cb[p + nx] * s;
        if (up > Cb[p]) Cb[p] = up;
      }
    }
  }
  // growths are lumpy and start as sparse specks: only where the noise exceeds (1 − progress) do they show, so a
  // young growth is a few small lumps and a full one a continuous crust
  const lf = 1 / Math.max(0.1, cfg.lump);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = idx(i, j, k);
    const a = A[p];
    if (a <= 0) continue;
    const nz3 = noise3((I0 + i) * vs * lf, (J0 + j) * vs * lf, (K0 + k) * vs * lf, 21);
    const prog = Math.min(1, a / Math.max(1e-6, cfg.accretion));
    A[p] = nz3 > 1 - prog ? a * (0.6 + 1.4 * (nz3 - (1 - prog)) / Math.max(1e-6, prog)) : 0;
  }
  blur3(A, tmp, nx, ny, nz, 1);

  // vegetation sediment sticks to decaying concrete (never a slab of its own)
  if (h && cfg.natureWeight > 0) {
    for (let k = 0; k < nz; k++) {
      const cz = Math.floor(((K0 + k) * vs) / CELL_SIZE);
      for (let i = 0; i < nx; i++) {
        const cx = Math.floor(((I0 + i) * vs) / CELL_SIZE);
        for (let j = 0; j < ny; j++) {
          const p = idx(i, j, k);
          const near = Math.min(1, Cb[p] * 3);
          if (near <= 0.02) continue;
          const v = natureAt(h, cx, cz, Math.floor(((J0 + j) * vs) / unit));
          if (v) N[p] = v * cfg.natureWeight * near;
        }
      }
    }
  }

  // the field: concrete mass (form kept, gaps filled) + growths + sediment, denser in the old layers;
  // minus round voids (old layers) and minus fragmenting at the edges (young layers)
  const iso = cfg.iso;
  const F = new Float32Array(n);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const q = rowQ[j];
      const por = st?.shell ? 0 : cfg.porosity * q; // C: the openings replace the round voids
      const gain = cfg.gain * (0.55 + 0.9 * q); // bottom-heavy
      const scat = cfg.scatter * (1 - q);
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        // B: outside the rooms the mass hardly swells past its parts
        let f = Math.max(C[p], gain * Cb[p] * (room && !room[p] ? FILL_OUTSIDE : 1)) + A[p] + N[p];
        if (Fl && Fl[p] > f) f = Fl[p];
        if (f <= iso * 0.5 || (por <= 0 && scat <= 0)) {
          F[p] = f;
          continue;
        }
        const x = (I0 + i) * vs, y = (J0 + j) * vs, z = (K0 + k) * vs;
        if (scat > 0) {
          // near the surface (thin mass) the young mass breaks up: only where the noise is high do pieces remain
          const edge = 1 - ramp(f, iso, iso + 0.6);
          if (edge > 0) f -= scat * edge * Math.max(0, 0.7 - noise3(x * 1.6, y * 1.6, z * 1.6, 61)) * 1.6;
        }
        if (por > 0 && f > iso) f -= por * 1.6 * smoothRamp(voids(x, y, z, cfg.poreSize), 0, 0.35);
        F[p] = f;
      }
    }
  }

  // C SHELL: hollow the mass (whatever lies deeper than the shell's thickness), then open some of the cells that touch
  // each other so only ribs remain between them; old layers are opened most
  if (st?.shell) {
    const r = Math.max(1, Math.round(st.shellThick));
    const S = new Float32Array(n);
    for (let p = 0; p < n; p++) S[p] = F[p] > iso ? 1 : 0;
    blur3(S, tmp, nx, ny, nz, r);
    for (let p = 0; p < n; p++) {
      const w = F[p] > iso ? smoothRamp(S[p], 0.86, 0.985) : 0;
      if (w > 0) F[p] -= (F[p] - iso + 0.25) * w;
    }
    const vo = new Float64Array(3);
    const half = st.ribWidth / 2;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const open = st.ribOpen * (0.35 + 0.65 * rowQ[j]);
      if (open <= 0) continue;
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        if (F[p] <= iso - 0.25) continue;
        voronoi((I0 + i) * vs, (J0 + j) * vs, (K0 + k) * vs, st.ribCell, 1.35, vo);
        if (vo[2] >= open) continue;
        const carve = smoothRamp((vo[1] - vo[0]) / 2, half, half + vs);
        if (carve > 0) F[p] -= (F[p] - iso + 0.25) * carve;
      }
    }
  }

  // SPIKES: out of a hashed share of the surface cells a thin spike of the same mass grows outward along the field's
  // gradient (one voxel thick, its own length up to spikeLen); the smoothing rounds them a little
  if (cfg.spikes > 0 && cfg.spikeLen > 0) {
    const maxSteps = Math.ceil(cfg.spikeLen / vs);
    const adds: number[] = [];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const p = idx(i, j, k);
      if (F[p] <= iso) continue;
      // a surface cell: an air neighbour on some side
      if (F[p - 1] > iso && F[p + 1] > iso && F[p - nx] > iso && F[p + nx] > iso && F[p - nx * ny] > iso && F[p + nx * ny] > iso) continue;
      const hsh = hash2(I0 + i, (J0 + j) * 7919 + (K0 + k) * 31, 97);
      if (hsh >= cfg.spikes * 0.08) continue;
      // outward = −gradient of the field
      let gx = F[p - 1] - F[p + 1], gy = F[p - nx] - F[p + nx], gz = F[p - nx * ny] - F[p + nx * ny];
      const gl = Math.hypot(gx, gy, gz);
      if (gl < 1e-6) continue;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      const steps = Math.max(1, Math.round(maxSteps * (0.3 + 0.7 * hash2(I0 + i, (J0 + j) * 7919 + (K0 + k) * 31, 98))));
      for (let s = 1; s <= steps; s++) {
        const ii = Math.round(i + gx * s), jj = Math.round(j + gy * s), kk = Math.round(k + gz * s);
        if (ii < 1 || ii >= nx - 1 || jj < 1 || jj >= ny - 1 || kk < 1 || kk >= nz - 1) break;
        adds.push(idx(ii, jj, kk));
      }
    }
    for (const p of adds) if (F[p] < iso + 0.25) F[p] = iso + 0.25;
  }

  // ── naive surface nets ──
  const cubeVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const cornerF = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          cornerF[c] = v;
          if (v > iso) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        // vertex: mean of the edge crossings
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = CUBE_EDGES[e], b = CUBE_EDGES[e + 1];
          const fa = cornerF[a], fb = cornerF[b];
          if (fa > iso === fb > iso) continue;
          const t = (iso - fa) / (fb - fa);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        const vx = (I0 + i + sx / cnt) * vs, vy = (J0 + j + sy / cnt) * vs, vz = (K0 + k + sz / cnt) * vs;
        cubeVert[cidx(i, j, k)] = pos.length / 3;
        pos.push(vx, vy, vz);
        // normal: −gradient (the field grows inwards)
        const gx = cornerF[1] + cornerF[3] + cornerF[5] + cornerF[7] - cornerF[0] - cornerF[2] - cornerF[4] - cornerF[6];
        const gy = cornerF[2] + cornerF[3] + cornerF[6] + cornerF[7] - cornerF[0] - cornerF[1] - cornerF[4] - cornerF[5];
        const gz = cornerF[4] + cornerF[5] + cornerF[6] + cornerF[7] - cornerF[0] - cornerF[1] - cornerF[2] - cornerF[3];
        const gl = Math.hypot(gx, gy, gz) || 1;
        nor.push(-gx / gl, -gy / gl, -gz / gl);
        // colour: the living growths (pale ochre-green, ref 9578) where they dominate; where the mass is fused concrete
        // or sediment, a dull mix of the concrete's grey and a low-saturation brown in streaks (ref 9570); all
        // darkening with age. Nothing bright survives fusion.
        const p = idx(i, j, k);
        const tot = Cb[p] + A[p] + N[p] + 1e-6;
        const grow = A[p] / tot;
        const q = rowQ[j];
        const jit = 0.88 + 0.24 * hash2(I0 + i, (J0 + j) * 7919 + K0 + k, 13);
        const streak = noise3(vx * 1.7, vy * 0.35, vz * 1.7, 31); // vertical stains
        const brown = Math.min(1, 0.25 + 0.55 * streak + 0.4 * (N[p] / tot));
        let dark = 1 - 0.35 * q;
        // C: dark pits on the shell (colour only)
        if (st?.shell && st.pits > 0) dark *= 1 - 0.7 * st.pits * smoothRamp(noise3(vx * 3.2, vy * 3.2, vz * 3.2, 83), 0.7, 0.78);
        for (let c = 0; c < 3; c++) {
          const fused = CONCRETE[c] + (DULL_BROWN[c] - CONCRETE[c]) * brown;
          const growc = GROW[c] + (DULL_BROWN[c] - GROW[c]) * Math.min(1, q * 1.2);
          col.push((fused * (1 - grow) + growc * grow) * dark * jit);
        }
      }
    }
  }

  // faces: one quad per sign-changing sample edge. All are collected (padding too) so that smoothing and normals see
  // the same neighbourhood in neighbouring chunks; each is kept by the chunk whose rows contain the edge's start.
  const quads: number[] = []; // a b c d flip owned
  const quad = (a: number, b: number, c: number, d: number, flip: boolean, own: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    quads.push(a, b, c, d, flip ? 1 : 0, own ? 1 : 0);
  };
  const owned = (j: number) => J0 + j >= Jlo && J0 + j < Jhi;
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      const own = owned(j);
      for (let i = 1; i < nx - 1; i++) {
        const f0 = F[idx(i, j, k)] > iso;
        // edge along x: (i,j,k)→(i+1,j,k), cubes around it in (j,k)
        if (f0 !== F[idx(i + 1, j, k)] > iso) {
          quad(cubeVert[cidx(i, j - 1, k - 1)], cubeVert[cidx(i, j, k - 1)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j - 1, k)], !f0, own);
        }
        if (f0 !== F[idx(i, j + 1, k)] > iso) {
          quad(cubeVert[cidx(i - 1, j, k - 1)], cubeVert[cidx(i - 1, j, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j, k - 1)], !f0, own);
        }
        if (f0 !== F[idx(i, j, k + 1)] > iso) {
          quad(cubeVert[cidx(i - 1, j - 1, k)], cubeVert[cidx(i, j - 1, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i - 1, j, k)], !f0, own);
        }
      }
    }
  }
  const P = Float32Array.from(pos);
  const NV = P.length / 3;
  const Nn = Float32Array.from(nor);
  if (cfg.smooth > 0 && NV > 0) taubin(P, quads, NV, Math.round(cfg.smooth));
  if (cfg.smooth > 0 && NV > 0) faceNormals(P, quads, Nn);

  const ind: number[] = [];
  const resinInd: number[] = [];
  for (let t = 0; t < quads.length; t += 6) {
    if (!quads[t + 5]) continue;
    const a = quads[t], b = quads[t + 1], c = quads[t + 2], d = quads[t + 3];
    // the face goes to the resin group if its first vertex lies in a resin layer (a noisy boundary: the resin layer
    // does not start at one exact height)
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const qa = layerAge(Math.floor(ay / unit)) + (noise3(ax * 0.5, ay * 0.5, az * 0.5, 41) - 0.5) * 0.3;
    const to = cfg.resinShare <= 1 && qa >= cfg.resinShare ? resinInd : ind;
    if (quads[t + 4]) to.push(a, c, b, a, d, c);
    else to.push(a, b, c, a, c, d);
  }
  const index = new Uint32Array(ind.length + resinInd.length);
  index.set(ind);
  index.set(resinInd, ind.length);
  return { position: P, normal: Nn, color: Float32Array.from(col), index, resinStart: ind.length };
}

/** Concatenates chunk meshes into one (all opaque faces first, then all resin faces). */
export function mergeMeshes(parts: readonly FuseMesh[]): FuseMesh {
  let nv = 0, ni = 0, nr = 0;
  for (const p of parts) {
    nv += p.position.length;
    ni += p.index.length;
    nr += p.index.length - p.resinStart;
  }
  const out: FuseMesh = { position: new Float32Array(nv), normal: new Float32Array(nv), color: new Float32Array(nv), index: new Uint32Array(ni), resinStart: ni - nr };
  let ov = 0, oo = 0, or = ni - nr;
  for (const p of parts) {
    out.position.set(p.position, ov);
    out.normal.set(p.normal, ov);
    out.color.set(p.color, ov);
    const base = ov / 3;
    for (let i = 0; i < p.index.length; i++) {
      if (i < p.resinStart) out.index[oo++] = p.index[i] + base;
      else out.index[or++] = p.index[i] + base;
    }
    ov += p.position.length;
  }
  return out;
}
