/**
 * parliament/fuse.ts
 *
 * What a structure BECOMES with age, as one surface (naive surface nets: one vertex per surface cell, quads between).
 * Everything runs on ONE clock, each part's own corrosion (decay = 1 − survival, seeds.wearModel), so it happens on
 * the structure itself, never as a separate slab, and never on a part that has not begun to corrode:
 *
 *   0 GATHERING   decay < accOnset: no mass here — vegetation POINTS gather on and around the part
 *                 (natureHistory.reclaimPoints with a decay clock), densest just before accOnset
 *   1 ACCRETION   accOnset → fuseOnset: lumpy organic matter grows on the part's top and hangs below it, starting as
 *                 small sparse specks (noise-thresholded) and thickening (ref 9578); the points fade out meanwhile
 *   2 FUSION      fuseOnset → 1: the part itself becomes mass, max(share, gain · blurred share) — parts keep their form
 *                 and near ones cling together; a part that has fallen away leaves its mass in its place. Vegetation
 *                 sediment sticks to it (only near decaying concrete)
 *   3 POROSITY    older layers are pitted (refs 9579/9580)
 *   4 RESIN       the oldest layers (sediment share ≥ `resinShare`) are a second face group (FuseMesh.resinStart …) for a
 *                 translucent material; their standing parts stay visible inside
 *
 * The field is sampled on a GLOBAL voxel grid (spacing `voxel`) and meshed in chunks of whole slots. Every chunk
 * computes its field with padding, so neighbouring chunks agree on their shared vertices; each face belongs to the one
 * chunk that owns its edge, so nothing is drawn twice. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { natureAt, sedimentShare, type NatureHistory, type NaturePointOptions } from "./natureHistory";
import { halfHeight, type Box } from "./seeds";

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
}

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
};

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
 * How many vegetation points gather on a part (0 … 1), from its decay: rising until accOnset, then fading as the
 * growths take over (gone by halfway to fuseOnset). Without fusion: rising and staying.
 */
export function gatheringShare(decay: number, cfg: FuseConfig): number {
  const up = smoothRamp(decay, 0, cfg.accOnset);
  if (!cfg.enabled || cfg.accretion <= 0) return up;
  return up * (1 - smoothRamp(decay, cfg.accOnset, (cfg.accOnset + cfg.fuseOnset) / 2));
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

/** Whether slot k has become resin. */
export function isResin(k: number, sed: Sediment, cfg: FuseConfig): boolean {
  return cfg.enabled && cfg.resinShare <= 1 && sedimentShare(k, sed) >= cfg.resinShare;
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

export interface FuseChunkInput {
  /** Every part as BUILT (also those that have fallen away), at least those overlapping the chunk's slots ± padding. */
  parts: readonly Box[];
  /** Per part: decay = 1 − survival (0 fresh … 1 gone). Absent = 1 (all fully decayed). */
  decay?: ArrayLike<number>;

  /** Per part: still standing (accretion only grows on standing parts). Absent = all standing. */
  standing?: ArrayLike<boolean>;
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
  cfg: FuseConfig;
}

/** Linear-RGB colours: fresh concrete, old stone; moss, humus, peat. */
/** Concrete is a human trace: neutral grey (only the vegetation in the mass has colour). */
const STONE_NEW = [0.6, 0.6, 0.6];
const STONE_OLD = [0.34, 0.34, 0.34];
const MOSS = [0.2, 0.27, 0.08];
const HUMUS = [0.09, 0.055, 0.03];
const PEAT = [0.025, 0.02, 0.016];
/** Accretions (ref 9578: pale ochre-green rock growths). */
const GROWTH = [0.42, 0.38, 0.22];

/** The fused surface of slots [k0, k1]. */
export function fuseChunk(input: FuseChunkInput): FuseMesh {
  const { cfg, unit, sediment: sed, history: h } = input;
  if (!cfg.enabled || input.nx <= 0 || input.nz <= 0) return EMPTY;
  const vs = cfg.voxel;
  const pad = Math.max(2, cfg.blur * 2 + 2);
  // global sample indices: X = round(x / vs) etc.
  const I0 = Math.floor((input.x0 * CELL_SIZE) / vs) - pad;
  const I1 = Math.ceil(((input.x0 + input.nx) * CELL_SIZE) / vs) + pad;
  const K0 = Math.floor((input.z0 * CELL_SIZE) / vs) - pad;
  const K1 = Math.ceil(((input.z0 + input.nz) * CELL_SIZE) / vs) + pad;
  const Jlo = Math.floor((input.k0 * unit) / vs); // first owned sample row
  const Jhi = Math.floor(((input.k1 + 1) * unit) / vs); // first row of the next chunk
  const J0 = Jlo - pad;
  const J1 = Jhi + pad;
  const nx = I1 - I0 + 1, ny = J1 - J0 + 1, nz = K1 - K0 + 1;
  const n = nx * ny * nz;
  if (n > 6e6) return EMPTY; // safety: refuse absurd grids
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // age of each sample row (sediment share): porosity and colour
  const rowQ = new Float32Array(ny);
  for (let j = 0; j < ny; j++) {
    const k = Math.floor(((J0 + j) * vs) / unit);
    rowQ[j] = k < 0 ? 0 : sedimentShare(k, sed);
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
      fill(C, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, f);
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

  const tmp = new Float32Array(n);
  const Cb = C.slice();
  blur3(Cb, tmp, nx, ny, nz, Math.round(cfg.blur));
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

  // the field: concrete mass (form kept, gaps filled) + growths + sediment − porosity
  const iso = cfg.iso;
  const F = new Float32Array(n);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const por = cfg.porosity * rowQ[j];
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        const base = Math.max(C[p], cfg.gain * Cb[p]) + A[p] + N[p];
        // holes only matter where there is something to carve
        if (por <= 0 || base <= iso) {
          F[p] = base;
          continue;
        }
        const x = (I0 + i) * vs, y = (J0 + j) * vs, z = (K0 + k) * vs;
        const holes = por * Math.max(0, noise3(x * 0.9, y * 0.9, z * 0.9, 5) * 0.65 + noise3(x * 2.1, y * 2.1, z * 2.1, 9) * 0.35 - 0.45) * 2;
        F[p] = base - holes;
      }
    }
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
        // colour: concrete ↔ vegetation sediment, both darkening with age
        const p = idx(i, j, k);
        const tot = Cb[p] + A[p] + N[p] + 1e-6;
        const veg = N[p] / tot;
        const grow = A[p] / tot;
        const q = rowQ[j];
        const jit = 0.85 + 0.3 * hash2(I0 + i, (J0 + j) * 7919 + K0 + k, 13);
        for (let c = 0; c < 3; c++) {
          const stone = STONE_NEW[c] + (STONE_OLD[c] - STONE_NEW[c]) * q;
          const sedc = q < 0.8 ? MOSS[c] + (HUMUS[c] - MOSS[c]) * (q / 0.8) : HUMUS[c] + (PEAT[c] - HUMUS[c]) * ((q - 0.8) / 0.2);
          const growc = GROWTH[c] + (MOSS[c] - GROWTH[c]) * Math.min(1, q * 1.5);
          col.push((stone * (1 - veg - grow) + sedc * veg + growc * grow) * jit);
        }
      }
    }
  }

  // faces: one quad per sign-changing sample edge, owned by the chunk whose rows contain the edge's start
  const ind: number[] = [];
  const resinInd: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // the face goes to the resin group if its first vertex lies in a resin layer
    // a noisy boundary: the resin layer does not start at one exact height
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const qa = sedimentShare(Math.floor(ay / unit), sed) + (noise3(ax * 0.5, ay * 0.5, az * 0.5, 41) - 0.5) * 0.3;
    const to = cfg.enabled && cfg.resinShare <= 1 && qa >= cfg.resinShare ? resinInd : ind;
    if (flip) to.push(a, c, b, a, d, c);
    else to.push(a, b, c, a, c, d);
  };
  const owned = (j: number) => J0 + j >= Jlo && J0 + j < Jhi;
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        if (!owned(j)) continue;
        const f0 = F[idx(i, j, k)] > iso;
        // edge along x: (i,j,k)→(i+1,j,k), cubes around it in (j,k)
        if (i < nx - 1 && f0 !== F[idx(i + 1, j, k)] > iso) {
          quad(cubeVert[cidx(i, j - 1, k - 1)], cubeVert[cidx(i, j, k - 1)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j - 1, k)], !f0);
        }
        if (j < ny - 1 && f0 !== F[idx(i, j + 1, k)] > iso) {
          quad(cubeVert[cidx(i - 1, j, k - 1)], cubeVert[cidx(i - 1, j, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j, k - 1)], !f0);
        }
        if (k < nz - 1 && f0 !== F[idx(i, j, k + 1)] > iso) {
          quad(cubeVert[cidx(i - 1, j - 1, k)], cubeVert[cidx(i, j - 1, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i - 1, j, k)], !f0);
        }
      }
    }
  }
  const index = new Uint32Array(ind.length + resinInd.length);
  index.set(ind);
  index.set(resinInd, ind.length);
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), color: Float32Array.from(col), index, resinStart: ind.length };
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
