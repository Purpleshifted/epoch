/**
 * parliament/fuse.ts
 *
 * FUSION: once a layer of the timespace is old enough, its separate parts and plants stop being separate. What is
 * left of the concrete and the sediment of the vegetation is turned into one density field, blurred so the pieces
 * cling together, pitted by porosity (older = more porous, refs 9579/9580), and meshed as ONE surface (naive surface
 * nets: one vertex per surface cell, quads between them — soft, organic, no tables).
 *
 * Old enough = the slot's sediment share q (natureHistory.sedimentShare: the same clock that turns vegetation into
 * humus and peat) has reached `share`; within `band` below it the layer fades in (and the separate parts dissolve).
 *
 * RESIN: the oldest layers (sediment share ≥ `resinShare`) are not opaque stone but a heavy translucent body: their
 * faces are put in a second group (FuseMesh.resinStart …) for a transmissive material, and their concrete parts are
 * kept (spaceModel), so what was built stays visible inside the compressed layer.
 *
 * The field is sampled on a GLOBAL voxel grid (spacing `voxel`), and meshed in chunks of whole slots. Every chunk
 * computes its field with padding, so neighbouring chunks agree on their shared vertices; each face belongs to the one
 * chunk that owns its edge, so nothing is drawn twice. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { natureAt, sedimentShare, type NatureHistory, type NaturePointOptions } from "./natureHistory";
import { halfHeight, type Box } from "./seeds";

export interface FuseConfig {
  enabled: boolean;
  /** Sediment share at which a layer is fully fused. */
  share: number;
  /** Width (in share) of the fade-in below `share`. */
  band: number;
  /** Voxel spacing (world). */
  voxel: number;
  /** Box-blur radius in voxels: how far apart pieces still cling together. */
  blur: number;
  /**
   * The field is max(concrete, gain · blurred concrete): parts keep their own form, and where several are near each
   * other the blurred sum rises above the surface and fills the gaps between them.
   */
  gain: number;
  /** How strongly holes are carved (× the layer's sediment share). */
  porosity: number;
  /** Iso level of the surface. */
  iso: number;
  /** Weight of the vegetation's sediment in the field (concrete = 1). */
  natureWeight: number;
  /** Layers with a sediment share ≥ this become resin (translucent, parts inside); > 1 = never. */
  resinShare: number;
}

export const DEFAULT_FUSE: FuseConfig = { enabled: true, share: 0.6, band: 0.15, voxel: 0.4, blur: 2, gain: 2.5, porosity: 0.6, iso: 0.3, natureWeight: 0.7, resinShare: 0.85 };

type Sediment = NonNullable<NaturePointOptions["sediment"]>;

/** How fused slot k is: 0 separate … 1 one mass. */
export function fusedWeight(k: number, sed: Sediment, cfg: FuseConfig): number {
  if (!cfg.enabled) return 0;
  const q = sedimentShare(k, sed);
  if (q >= cfg.share) return 1;
  const lo = cfg.share - cfg.band;
  return q <= lo ? 0 : (q - lo) / Math.max(1e-6, cfg.band);
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
  /** Parts as they stand (worn), at least those overlapping the chunk's slots ± padding. */
  parts: readonly Box[];
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
const STONE_NEW = [0.62, 0.61, 0.58];
const STONE_OLD = [0.36, 0.34, 0.31];
const MOSS = [0.2, 0.27, 0.08];
const HUMUS = [0.09, 0.055, 0.03];
const PEAT = [0.025, 0.02, 0.016];

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

  // weight of fusion per sample row (by slot)
  const rowW = new Float32Array(ny);
  const rowQ = new Float32Array(ny);
  let any = false;
  for (let j = 0; j < ny; j++) {
    const y = (J0 + j) * vs;
    const k = Math.floor(y / unit);
    rowW[j] = k < 0 ? 0 : fusedWeight(k, sed, cfg);
    rowQ[j] = k < 0 ? 0 : sedimentShare(k, sed);
    if (rowW[j] > 0) any = true;
  }
  if (!any) return EMPTY;

  const C = new Float32Array(n); // concrete
  const N = new Float32Array(n); // vegetation sediment
  // concrete: what still stands, rasterised (at least one voxel thick so thin slats do not vanish)
  const yLo = J0 * vs, yHi = J1 * vs;
  for (const b of input.parts) {
    if (b.tilt) continue;
    const hh = halfHeight(b);
    if (b.y + hh < yLo || b.y - hh > yHi) continue;
    const hx = Math.max(b.sx, vs) / 2, hz = Math.max(b.sz, vs) / 2, hy = Math.max(2 * hh, vs) / 2;
    const ia = Math.max(0, Math.ceil((b.x - hx) / vs) - I0), ib = Math.min(nx - 1, Math.floor((b.x + hx) / vs) - I0);
    const ja = Math.max(0, Math.ceil((b.y - hy) / vs) - J0), jb = Math.min(ny - 1, Math.floor((b.y + hy) / vs) - J0);
    const ka = Math.max(0, Math.ceil((b.z - hz) / vs) - K0), kb = Math.min(nz - 1, Math.floor((b.z + hz) / vs) - K0);
    for (let k = ka; k <= kb; k++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) C[idx(i, j, k)] = 1;
  }
  // vegetation: its density, pressed into the lower part of each slot (compaction grows with q)
  if (h && cfg.natureWeight > 0) {
    for (let k = 0; k < nz; k++) {
      const cz = Math.floor(((K0 + k) * vs) / CELL_SIZE);
      for (let i = 0; i < nx; i++) {
        const cx = Math.floor(((I0 + i) * vs) / CELL_SIZE);
        for (let j = 0; j < ny; j++) {
          if (rowW[j] <= 0) continue;
          const y = (J0 + j) * vs;
          const slot = Math.floor(y / unit);
          const v = natureAt(h, cx, cz, slot);
          if (!v) continue;
          const frac = y / unit - slot;
          if (frac < 0.6 * (1 - 0.75 * rowQ[j]) + 0.1) N[idx(i, j, k)] = v * cfg.natureWeight;
        }
      }
    }
  }
  const tmp = new Float32Array(n);
  const Cb = C.slice();
  blur3(Cb, tmp, nx, ny, nz, Math.round(cfg.blur));
  blur3(N, tmp, nx, ny, nz, Math.round(cfg.blur));

  // the field: fused share × (max(concrete, gain · blurred concrete) + sediment) − porosity
  const iso = cfg.iso;
  const F = new Float32Array(n);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const w = rowW[j];
      if (w <= 0) continue;
      const por = cfg.porosity * rowQ[j];
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        const base = w * (Math.max(C[p], cfg.gain * Cb[p]) + N[p]);
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
        const veg = N[p] / (Cb[p] + N[p] + 1e-6);
        const q = rowQ[j];
        const jit = 0.85 + 0.3 * hash2(I0 + i, (J0 + j) * 7919 + K0 + k, 13);
        for (let c = 0; c < 3; c++) {
          const stone = STONE_NEW[c] + (STONE_OLD[c] - STONE_NEW[c]) * q;
          const sedc = q < 0.8 ? MOSS[c] + (HUMUS[c] - MOSS[c]) * (q / 0.8) : HUMUS[c] + (PEAT[c] - HUMUS[c]) * ((q - 0.8) / 0.2);
          col.push((stone + (sedc - stone) * veg) * jit);
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
    const to = isResin(Math.floor(pos[a * 3 + 1] / unit), sed, cfg) ? resinInd : ind;
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
