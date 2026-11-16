/**
 * parliament/fuseUnits.ts
 *
 * THE BUILDINGS' MASS, MADE PIECE BY PIECE IN A WORKER OF ITS OWN (2026-11-16; the artist, on what would make the
 * wall lighter with her own values kept: "일단 1-3 진행해봐. 3은 중요할 것 같음").
 *
 * With her values the model's worker took 13 s a round (the ways 10.8 s of it) and a piece of a building's mass
 * 1.5–4.5 s more, every other tick, IN THE SAME WORKER — the buildings waited for the fossil and the fossil for the
 * buildings, and a building's mass was shown only when every one of its pieces was done: none within two minutes.
 *
 * Here the mass is made apart from the model:
 *
 * - the model's worker only says WHAT each building is made of (a UnitJob: its simplified parts and what each one's
 *   fossil grows by) when its parts are other than they were — it fuses nothing;
 * - this side (FuseUnits, in components/parliament/side.worker.ts) cuts the building into pieces (bands of slots ×
 *   tiles of the ground, as before), makes them one at a time — THE DEEPEST FIRST, across all the buildings, and a
 *   piece that has no mass yet before one that only has to be made again — and every piece is SHOWN AS SOON AS IT IS
 *   DONE. That is sound only for the seeded mass (fuse.ts seeded): its shape is the building's whole mass whatever the
 *   progress, so a piece made a minute later than the one beside it agrees with it;
 * - what is shown is sent straight to the view, not through the model, in CHUNKS OF THE SPACE (a square of the ground
 *   × a band of slots), each a mesh of its own: a piece done replaces a megabyte on the screen, not the whole wall's
 *   fossil (that was merged and sent again whole every time a building changed);
 * - a piece appears by GROWING OUT OF ITS PARTS (the wall's shader: the stamp below against the clock), and a piece
 *   made again keeps its stamp — it is changed where it stands.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { accretionShare, fuseChunk, fusePad, fusedShare, mergeMeshes, type FuseConfig, type FuseMesh, type FuseTube, type Sediment } from "./fuse";
import type { NatureHistory } from "./natureHistory";
import type { Box } from "./seeds";

const CELL = CELL_SIZE;
/** Cells of margin round a building (and round a piece's own tile) that a piece is fused with. */
export const UNIT_PAD = 4;

type Sed = Sediment;

/** A chunk's parts (all square to the grid) fused tile by tile. */
export function fuseTilesOf(
  w: { c0: number; c1: number; ps: { b: Box; d: number; up: boolean; sk: boolean }[]; tubes: readonly FuseTube[]; x0: number; z0: number; nx: number; nz: number },
  h: NatureHistory | null,
  u: number,
  sed: Sed,
  layerDecay: ((k: number) => number) | undefined,
  fuse: FuseConfig,
  TILE = 24,
  stages: Record<string, number> = {},
): FuseMesh {
  const MARGIN = 4;
  const meshes: FuseMesh[] = [];
  const cellOf = (v: number) => Math.floor(v / CELL);
  for (let tz = w.z0; tz < w.z0 + w.nz; tz += TILE) {
    for (let tx = w.x0; tx < w.x0 + w.nx; tx += TILE) {
      let ax = tx - MARGIN, bx = tx + TILE + MARGIN, az = tz - MARGIN, bz = tz + TILE + MARGIN;
      const ps = w.ps.filter(({ b }) => {
        const r = Math.max(b.sx, b.sy, b.sz) / 2;
        return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
      });
      const tubes = w.tubes.filter((t) => cellOf(Math.max(t.x0, t.x1) + t.r) >= ax && cellOf(Math.min(t.x0, t.x1) - t.r) < bx && cellOf(Math.max(t.z0, t.z1) + t.r) >= az && cellOf(Math.min(t.z0, t.z1) - t.r) < bz);
      if (!ps.length && !tubes.length) continue; // empty ground costs nothing
      // THE GRID IS AS LARGE AS WHAT IS IN IT (2026-11-15: a tile was always 32 × 32 cells, and its cost is its
      // volume — a district's few cells of building paid for the whole square, ~150 ms a tile): the tile's grid is
      // cut down to its parts and tubes, with the same margin round them. What the tile emits (`own`) is unchanged.
      {
        let a = Infinity, b2 = -Infinity, c = Infinity, d = -Infinity;
        for (const { b } of ps) {
          const r = Math.max(b.sx, b.sy, b.sz) / 2;
          a = Math.min(a, cellOf(b.x - r));
          b2 = Math.max(b2, cellOf(b.x + r));
          c = Math.min(c, cellOf(b.z - r));
          d = Math.max(d, cellOf(b.z + r));
        }
        for (const t of tubes) {
          a = Math.min(a, cellOf(Math.min(t.x0, t.x1) - t.r));
          b2 = Math.max(b2, cellOf(Math.max(t.x0, t.x1) + t.r));
          c = Math.min(c, cellOf(Math.min(t.z0, t.z1) - t.r));
          d = Math.max(d, cellOf(Math.max(t.z0, t.z1) + t.r));
        }
        ax = Math.max(ax, a - MARGIN);
        bx = Math.min(bx, b2 + 1 + MARGIN);
        az = Math.max(az, c - MARGIN);
        bz = Math.min(bz, d + 1 + MARGIN);
      }
      stages["fuse tiles (n)"] = (stages["fuse tiles (n)"] ?? 0) + 1;
      stages["fuse cells (n)"] = (stages["fuse cells (n)"] ?? 0) + (bx - ax) * (bz - az);
      const tTile = performance.now();
      const kinds: Record<string, number> = {};
      for (const e of ps) kinds[e.b.kind] = (kinds[e.b.kind] ?? 0) + 1;
      const tubeKinds: Record<string, number> = {};
      for (const t of tubes) tubeKinds[t.kind] = (tubeKinds[t.kind] ?? 0) + 1;
      let big = 0;
      for (const e of ps) big = Math.max(big, e.b.sx, e.b.sz, e.b.sy);
      const tileMesh = fuseChunk({
          parts: ps.map((e) => e.b),
          decay: ps.map((e) => e.d),
          standing: ps.map((e) => e.up),
          skeleton: ps.map((e) => e.sk),
          tubes,
          history: h,
          k0: w.c0,
          k1: w.c1,
          x0: ax,
          z0: az,
          nx: bx - ax,
          nz: bz - az,
          own: { x0: tx, x1: tx + TILE, z0: tz, z1: tz + TILE },
          unit: u,
          sediment: sed,
          layerDecay,
          cfg: fuse,
        });
      meshes.push(tileMesh);
      const dtTile = performance.now() - tTile;
      if (dtTile > (stages["slow tile ms"] ?? 300)) {
        let y0 = Infinity, y1 = -Infinity;
        for (let q = 1; q < tileMesh.position.length; q += 3) {
          y0 = Math.min(y0, tileMesh.position[q]);
          y1 = Math.max(y1, tileMesh.position[q]);
        }
        Object.assign(stages, { "slow tile ms": dtTile, "slow tile cells": (bx - ax) * (bz - az), "slow tile parts": ps.length, "slow tile tubes": tubes.length, "slow tile tris": tileMesh.index.length / 3, "slow tile y0": y0, "slow tile y1": y1, "slow tile biggest part": big, "slow tile c0": w.c0 });
        for (const [k, v] of Object.entries(kinds)) stages[`slow tile ${k}`] = v;
        for (const [k, v] of Object.entries(tubeKinds)) stages[`slow tile tube ${k}`] = v;
      }
    }
  }
  return mergeMeshes(meshes);
}

/**
 * SEEDED (fuse.ts seeded): every vertex of a building's mass is given THE PART IT GROWS FROM — the nearest of the
 * building's parts (by its box, in the box's own turn) — as the point of that part it is pressed to (the nearest
 * point of the box, drawn a little inside it, so the pressed mass lies within the part) and that part's growing
 * data. The parts are looked up through a coarse grid of the space (a vertex asks only the parts near it).
 */
export function growData(mesh: FuseMesh, parts: readonly { b: Box; grow?: number[] }[], unit = 0): void {
  const nv = mesh.position.length / 3;
  const anchor = new Float32Array(nv * 3), A = new Float32Array(nv * 4), B = new Float32Array(nv * 2);
  const G = 2, REACH = 3;
  const cellKey = (ix: number, iy: number, iz: number) => ((ix & 1023) * 1024 + (iy & 1023)) * 1024 + (iz & 1023);
  const cells = new Map<number, number[]>();
  const cs = parts.map((e) => Math.cos(e.b.yaw ?? 0)), sn = parts.map((e) => Math.sin(e.b.yaw ?? 0));
  parts.forEach((e, pi) => {
    const b = e.b, r = Math.max(b.sx, b.sz) / 2 + REACH, ry = b.sy / 2 + REACH;
    for (let ix = Math.floor((b.x - r) / G); ix <= Math.floor((b.x + r) / G); ix++)
      for (let iy = Math.floor((b.y - ry) / G); iy <= Math.floor((b.y + ry) / G); iy++)
        for (let iz = Math.floor((b.z - r) / G); iz <= Math.floor((b.z + r) / G); iz++) {
          const k = cellKey(ix, iy, iz), l = cells.get(k);
          if (l) l.push(pi);
          else cells.set(k, [pi]);
        }
  });
  const all = parts.map((_, i) => i);
  let last = 0;
  for (let v = 0; v < nv; v++) {
    const px = mesh.position[v * 3], py = mesh.position[v * 3 + 1], pz = mesh.position[v * 3 + 2];
    // (far from every part — what hangs a long way down: the part the vertex before it grew from, and its neighbours)
    const near = cells.get(cellKey(Math.floor(px / G), Math.floor(py / G), Math.floor(pz / G))) ?? (parts.length <= 64 ? all : [last]);
    let best = last, bd = Infinity, ax = px, ay = py, az = pz;
    for (const pi of near) {
      const b = parts[pi].b, c = cs[pi], s = sn[pi];
      const dx = px - b.x, dz = pz - b.z;
      // (into the part's own turn: writeMatrix's turn undone)
      const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = py - b.y;
      const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
      const qx = Math.max(-hx, Math.min(hx, lx)), qy = Math.max(-hy, Math.min(hy, ly)), qz = Math.max(-hz, Math.min(hz, lz));
      const d2 = (lx - qx) * (lx - qx) + (ly - qy) * (ly - qy) + (lz - qz) * (lz - qz);
      if (d2 < bd) {
        bd = d2;
        best = pi;
        const ix = qx * 0.9, iy = qy * 0.9, iz = qz * 0.9;
        ax = b.x + ix * c + iz * s;
        ay = b.y + iy;
        az = b.z - ix * s + iz * c;
      }
    }
    last = best;
    anchor[v * 3] = ax;
    anchor[v * 3 + 1] = ay;
    anchor[v * 3 + 2] = az;
    const g = parts[best].grow;
    if (g) {
      A[v * 4] = g[0];
      A[v * 4 + 1] = g[1];
      A[v * 4 + 2] = g[2];
      A[v * 4 + 3] = g[3];
      B[v * 2] = g[4];
      B[v * 2 + 1] = g[5];
    } else B[v * 2 + 1] = -1;
  }
  if (unit > 0) placeValues(mesh, parts, unit, A, B);
  mesh.anchor = anchor;
  mesh.growA = A;
  mesh.growB = B;
}

/** The side of a cell of the grid the parts' values are spread on (world), and the passes of a 3 × 3 × 3 box over it. */
const PLACE_CELL = 1;
const PLACE_PASSES = 2;

/**
 * THE VALUES OF THE PLACE, NOT OF THE PART (the artist, 2026-11-16, of the mass let out part by part: "근데 부푸는 건
 * 진짜 개별로던데"). A vertex that carries the numbers of the one part nearest to it moves apart from its neighbour
 * that carries another part's — the mass came out part by part, and split along the parts. The exhibition's mass was
 * one body although every part had a value of its own, because the values were written into a field and the field
 * BLURRED. So here: what each part's fossil grows by (the top when it was built, its own lead or lag, how much of it
 * the vegetation makes) is spread over the cells its box covers, on a grid that is the same for every piece (a cell
 * is where it is in the world), blurred, and read by every vertex at its own place — the nearest part's own numbers
 * only where no part reaches. And the layer a vertex lies in is read off its own height, not its part's slot.
 * Two pieces give a vertex they share the same values: a value depends on the parts within three cells of it, and
 * a piece is fused with every part within four cells of the ground round its tile.
 */
function placeValues(mesh: FuseMesh, parts: readonly { b: Box; grow?: number[] }[], unit: number, A: Float32Array, B: Float32Array): void {
  const P = mesh.position, nv = P.length / 3;
  if (!nv) return;
  const G = PLACE_CELL, R = PLACE_PASSES + 1;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const i0 = Math.floor(x0 / G) - R, j0 = Math.floor(y0 / G) - R, k0 = Math.floor(z0 / G) - R;
  const nx = Math.floor(x1 / G) + R + 1 - i0, ny = Math.floor(y1 / G) + R + 1 - j0, nz = Math.floor(z1 / G) + R + 1 - k0;
  const n = nx * ny * nz;
  if (n > 6e6) return; // (too large a piece: the nearest part's own numbers stand)
  // the top when a part was built is some hundreds of slots: kept against the least of them (the sums stay exact)
  let base = Infinity;
  for (const e of parts) if (e.grow && e.grow[1] < base) base = e.grow[1];
  if (base === Infinity) return;
  const W = new Float32Array(n), S1 = new Float32Array(n), S2 = new Float32Array(n), S3 = new Float32Array(n);
  for (const e of parts) {
    const g = e.grow;
    if (!g) continue;
    const b = e.b, c = Math.abs(Math.cos(b.yaw ?? 0)), sn = Math.abs(Math.sin(b.yaw ?? 0));
    const hx = (c * b.sx + sn * b.sz) / 2, hz = (sn * b.sx + c * b.sz) / 2, hy = b.sy / 2;
    const ia = Math.max(0, Math.floor((b.x - hx) / G) - i0), ib = Math.min(nx - 1, Math.floor((b.x + hx) / G) - i0);
    const ja = Math.max(0, Math.floor((b.y - hy) / G) - j0), jb = Math.min(ny - 1, Math.floor((b.y + hy) / G) - j0);
    const ka = Math.max(0, Math.floor((b.z - hz) / G) - k0), kb = Math.min(nz - 1, Math.floor((b.z + hz) / G) - k0);
    for (let k = ka; k <= kb; k++) {
      for (let j = ja; j <= jb; j++) {
        let q = (k * ny + j) * nx + ia;
        for (let i = ia; i <= ib; i++, q++) {
          W[q] += 1;
          S1[q] += g[1] - base;
          S2[q] += g[3];
          S3[q] += g[5];
        }
      }
    }
  }
  const tmp = new Float32Array(n);
  const strides = [1, nx, nx * ny], dims = [nx, ny, nz];
  const box = (f: Float32Array) => {
    for (let pass = 0; pass < PLACE_PASSES; pass++) {
      for (let ax = 0; ax < 3; ax++) {
        const st = strides[ax], len = dims[ax];
        for (let q = 0; q < n; q++) {
          const at = Math.floor(q / st) % len;
          tmp[q] = f[q] + (at > 0 ? f[q - st] : 0) + (at < len - 1 ? f[q + st] : 0);
        }
        f.set(tmp);
      }
    }
  };
  box(W);
  box(S1);
  box(S2);
  box(S3);
  // (a part's own numbers count for as much as this share of one cell fully covered: only where the field is all but empty)
  const OWN = 0.02 * Math.pow(27, PLACE_PASSES);
  for (let v = 0; v < nv; v++) {
    if (B[v * 2 + 1] < 0) continue;
    const fx = P[v * 3] / G - i0 - 0.5, fy = P[v * 3 + 1] / G - j0 - 0.5, fz = P[v * 3 + 2] / G - k0 - 0.5;
    const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx))), iy = Math.max(0, Math.min(ny - 2, Math.floor(fy))), iz = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy)), tz = Math.max(0, Math.min(1, fz - iz));
    let w = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const q = ((iz + dz) * ny + iy + dy) * nx + ix + dx;
      const t = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      w += t * W[q];
      s1 += t * S1[q];
      s2 += t * S2[q];
      s3 += t * S3[q];
    }
    A[v * 4] = P[v * 3 + 1] / unit - 0.5;
    A[v * 4 + 1] = base + (s1 + OWN * (A[v * 4 + 1] - base)) / (w + OWN);
    A[v * 4 + 3] = (s2 + OWN * A[v * 4 + 3]) / (w + OWN);
    B[v * 2 + 1] = (s3 + OWN * B[v * 2 + 1]) / (w + OWN);
  }
}

/** A part of a building as its mass is made from it. */
export interface UnitPart {
  b: Box;
  /** Its decay (the seeded mass: 1 — all of it), whether it stands, whether it is kept as skeleton. */
  d: number;
  up: boolean;
  sk: boolean;
  /** SEEDED: what its fossil grows by (growData). */
  grow?: number[];
  /** The part's key in the model (SpaceModel.partKey): what the model is told has a mass now. */
  key?: number;
}

/** One piece of a building: a band of slots × a tile of the ground (in the building's own frame), with its parts. */
export interface UnitPiece<P> {
  key: string;
  sig: string;
  k0: number;
  k1: number;
  tx: number;
  tz: number;
  ps: P[];
  /** The pipes and ways that reach into it (in the frame of the parts). */
  tubes: FuseTube[];
}

/** Whether anything comes of these parts (nothing is fused where no part is fusing: fuseTiled). */
export function unitFusing(fuse: FuseConfig): (list: readonly { d: number }[]) => boolean {
  return (list) => list.some((e) => fusedShare(e.d, fuse) >= 0.05 || (!fuse.crust && accretionShare(e.d, fuse) > 0.01));
}

const cellOf = (v: number) => Math.floor(v / CELL);

/** The cells and slots a building's parts reach (in the frame the parts are given in), with the margin round them. */
export function unitExtent(ps: readonly { b: Box }[], turn?: { c: number; sn: number }): { ext: { x0: number; z0: number; nx: number; nz: number }; ka: number; kb: number } {
  let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity, ka = Infinity, kb = -Infinity;
  for (const { b } of ps) {
    const x = turn ? b.x * turn.c - b.z * turn.sn : b.x, z = turn ? b.x * turn.sn + b.z * turn.c : b.z;
    const r = Math.max(b.sx, b.sy, b.sz) / 2;
    xa = Math.min(xa, cellOf(x - r));
    xb = Math.max(xb, cellOf(x + r));
    za = Math.min(za, cellOf(z - r));
    zb = Math.max(zb, cellOf(z + r));
    ka = Math.min(ka, b.slot);
    kb = Math.max(kb, b.slot);
  }
  return { ext: { x0: xa - UNIT_PAD, z0: za - UNIT_PAD, nx: xb - xa + 1 + 2 * UNIT_PAD, nz: zb - za + 1 + 2 * UNIT_PAD }, ka, kb };
}

/**
 * A building's PIECES as it stands: bands of `seg` slots × tiles of `tile` cells, each with the parts that reach into
 * it (masses hang ≤ 3 slots, foundations ≤ 8 below their slot — as the chunks did) and a signature of them: a piece
 * whose parts stand exactly as they did is kept as it was.
 */
export function unitPieces<P extends { b: Box; d: number; up: boolean; sk: boolean }>(
  ps: readonly P[],
  at: { ext: { x0: number; z0: number; nx: number; nz: number }; ka: number; kb: number },
  o: { seg: number; tile: number; padSlots: number; fusing: (list: readonly { d: number }[]) => boolean },
  /** The pipes and ways of the ground, with how far (world) a band's field reaches above and below its own slots. */
  ext2?: { tubes: readonly FuseTube[]; unit: number; reach: number },
): UnitPiece<P>[] {
  const { ext, ka, kb } = at;
  const SEG = o.seg, T = o.tile, PAD = UNIT_PAD;
  const out: UnitPiece<P>[] = [];
  for (let k0 = Math.floor((ka - 8) / SEG) * SEG; k0 <= kb + 3; k0 += SEG) {
    const k1 = k0 + SEG - 1;
    const inBand = ps.filter((e) => e.b.slot >= k0 - o.padSlots - 3 && e.b.slot <= k1 + o.padSlots + 8);
    // (a tube is read by the band whose field it lies in — by its height, not by a count of slots: a tube that
    // changes makes only the pieces it is in be made again)
    const yLo = ext2 ? k0 * ext2.unit - ext2.reach : 0, yHi = ext2 ? (k1 + 1) * ext2.unit + ext2.reach : 0;
    const tubesBand = ext2 ? ext2.tubes.filter((t) => Math.max(t.y0, t.y1) + t.r >= yLo && Math.min(t.y0, t.y1) - t.r <= yHi) : [];
    if (!inBand.length && !tubesBand.length) continue;
    for (let tz = Math.floor(ext.z0 / T) * T; tz < ext.z0 + ext.nz; tz += T) {
      for (let tx = Math.floor(ext.x0 / T) * T; tx < ext.x0 + ext.nx; tx += T) {
        const ax = tx - PAD, bx = tx + T + PAD, az = tz - PAD, bz = tz + T + PAD;
        const mine = inBand.filter(({ b }) => {
          const r = Math.max(b.sx, b.sy, b.sz) / 2;
          return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
        });
        const tubes = tubesBand.filter((t) => cellOf(Math.max(t.x0, t.x1) + t.r) >= ax && cellOf(Math.min(t.x0, t.x1) - t.r) < bx && cellOf(Math.max(t.z0, t.z1) + t.r) >= az && cellOf(Math.min(t.z0, t.z1) - t.r) < bz);
        // (…nor where no pipe or way runs: the mass follows them across the ground between the buildings)
        if (!o.fusing(mine) && !tubes.length) continue;
        let sg = 0;
        for (const t of tubes) sg += t.x0 * 3.1 + t.y0 * 7.3 + t.z0 * 11.7 + t.x1 * 13.9 + t.y1 * 17.1 + t.z1 * 19.3 + t.r * 23.9;
        for (const e of mine) sg += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.b.sx * 0.7 + e.b.sy * 1.3 + e.b.sz * 1.9 + Math.round(e.d * 20) * 0.9 + (e.up ? 19 : 0) + (e.sk ? 23 : 0);
        out.push({ key: `${k0}:${tx}:${tz}`, sig: `${mine.length}:${tubes.length}:${sg.toFixed(3)}`, k0, k1, tx, tz, ps: mine, tubes });
      }
    }
  }
  return out;
}

/** A mesh made in a turned district's own frame, turned back into the world. */
export function turnBack(mesh: FuseMesh, ang: number): void {
  if (!ang) return;
  const c = Math.cos(ang), sn = Math.sin(ang);
  for (const arr of [mesh.position, mesh.normal]) {
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], z = arr[i + 2];
      arr[i] = x * c + z * sn;
      arr[i + 2] = -x * sn + z * c;
    }
  }
}

/** The look of a building's layers (the mean decay of the parts round a slot), as numbers that can be sent. */
export interface UnitLook {
  k: number[];
  sum: number[];
  cnt: number[];
  mean: number;
}

export function unitLook(list: readonly { b: Box; d: number }[]): UnitLook {
  const sum = new Map<number, number>(), cnt = new Map<number, number>();
  let all = 0;
  for (const e of list) {
    sum.set(e.b.slot, (sum.get(e.b.slot) ?? 0) + e.d);
    cnt.set(e.b.slot, (cnt.get(e.b.slot) ?? 0) + 1);
    all += e.d;
  }
  const k = [...sum.keys()];
  return { k, sum: k.map((q) => sum.get(q)!), cnt: k.map((q) => cnt.get(q)!), mean: list.length ? all / list.length : 0 };
}

export function lookFn(l: UnitLook): (k: number) => number {
  const sum = new Map<number, number>(), cnt = new Map<number, number>();
  l.k.forEach((q, i) => {
    sum.set(q, l.sum[i]);
    cnt.set(q, l.cnt[i]);
  });
  return (k: number) => {
    let sm = 0, n = 0;
    for (let j = k - 1; j <= k + 1; j++) {
      const c = cnt.get(j);
      if (c) {
        sm += sum.get(j)!;
        n += c;
      }
    }
    return n ? sm / n : l.mean;
  };
}

// ── what the model's worker says to this side, and this side to the view ──

/** What a building is made of now: its mass is to be made (again) from this. */
export interface UnitJob {
  type: "job";
  id: string;
  /** Rising with every job the model sends. */
  serial: number;
  /** The fusion's configuration as one string: a piece made under another is made again. */
  cfg: string;
  fuse: FuseConfig;
  /** The building's parts, in the world. */
  parts: UnitPart[];
  /** The pipes and the ways of its ground that fuse with it (in the world; fuse.ts FuseTube). */
  tubes?: FuseTube[];
  /** The angle its district is turned by (it is fused in its own frame, where its boxes lie along the grid). */
  ang: number;
  /** What gathered round it (cut to the building, in its own frame). */
  h: NatureHistory | null;
  look: UnitLook | null;
  u: number;
  sed: Sed;
  padSlots: number;
  seg: number;
  tile: number;
}

export type UnitRequest =
  | UnitJob
  /** A building under another name (it grew a cell older than its oldest, or joined another): its mass goes with it. */
  | { type: "heir"; from: string; to: string }
  /** A building that is no more. */
  | { type: "drop"; id: string }
  /** Nothing of what was made stands any more (the fusion off, another way of making it, a new world). */
  | { type: "reset" };

/** Back to the model: these parts have a mass on the screen now (the parts are absorbed only as far as that). */
export interface UnitFused {
  type: "fused";
  keys: number[];
}

export interface UnitStats {
  /** Pieces still to make: with no mass yet / to be made again. */
  waiting: number;
  remake: number;
  /** Pieces made since the last message, the longest of them (ms), and the mean. */
  made: number;
  pieceMaxMs: number;
  pieceMeanMs: number;
  /** What stands on the screen: triangles, chunks, buildings. */
  tris: number;
  chunks: number;
  units: number;
  voxel: number;
}

/** To the view: the chunks of the space whose mass is other than it was (a chunk with nothing left is dropped). */
export interface UnitChunks {
  type: "fuse-chunks";
  clear?: boolean;
  set: { id: string; mesh: FuseMesh }[];
  drop: string[];
  stats: UnitStats;
  /** Date.now() at which this side's clock began: a piece's stamp (fuseGrowB.x) is seconds since. */
  clock0: number;
}

/** A chunk of the space on the screen: this many cells square × this many slots. */
const CHUNK_CELLS = 42;
const CHUNK_SLOTS = 30;

interface Made {
  cfg: string;
  sig: string;
  mesh: FuseMesh;
  /** When it first stood on the screen (seconds of this side's clock): it grows out of its parts from then. */
  stamp: number;
  chunk: string;
  /** A piece of a building that joined this one: it stands until this building's own piece there is made again. */
  orphanOf?: string;
  after?: number;
}
interface Turned {
  b: Box;
  d: number;
  up: boolean;
  sk: boolean;
  /** Its place in the job's parts. */
  i: number;
}
interface Unit {
  job: UnitJob | null;
  ps: Turned[];
  look: ((k: number) => number) | undefined;
  todo: UnitPiece<Turned>[];
  done: Map<string, Made>;
  serial: number;
}

/**
 * THE MASSES BEING MADE (this side's state): every building's latest job, its pieces done and those still to do.
 * `step` makes one piece; `flush` gives what is to be sent to the view.
 */
export class FuseUnits {
  readonly clock0 = Date.now();
  private units = new Map<string, Unit>();
  private dirty = new Set<string>();
  private shown = new Map<string, number>();
  private cleared = false;
  private made = 0;
  private madeMs = 0;
  private maxMs = 0;
  private voxel = 0;
  stages: Record<string, number> = {};

  private now(): number {
    return (Date.now() - this.clock0) / 1000;
  }

  request(m: UnitRequest): void {
    if (m.type === "job") this.job(m);
    else if (m.type === "heir") this.heir(m.from, m.to);
    else if (m.type === "drop") this.drop(m.id);
    else this.reset();
  }

  private job(j: UnitJob): void {
    let unit = this.units.get(j.id);
    if (!unit) this.units.set(j.id, (unit = { job: null, ps: [], look: undefined, todo: [], done: new Map(), serial: -1 }));
    const c = Math.cos(j.ang), sn = Math.sin(j.ang);
    // (a turned district is fused in its own frame, where its boxes lie along the grid: seeds.ts' turn undone)
    const ps: Turned[] = j.parts.map((e, i) => ({ b: j.ang ? { ...e.b, x: e.b.x * c - e.b.z * sn, z: e.b.x * sn + e.b.z * c, yaw: 0 } : e.b, d: e.d, up: e.up, sk: e.sk, i }));
    const tubes = (j.tubes ?? []).map((t, i) => (j.ang ? { ...t, x0: t.x0 * c - t.z0 * sn, z0: t.x0 * sn + t.z0 * c, x1: t.x1 * c - t.z1 * sn, z1: t.x1 * sn + t.z1 * c, i } : { ...t, i }));
    const pad = fusePad(j.fuse);
    const pieces = ps.length
      ? unitPieces(ps, unitExtent(ps), { seg: j.seg, tile: j.tile, padSlots: j.padSlots, fusing: unitFusing(j.fuse) }, { tubes, unit: j.u, reach: Math.max(pad.above, pad.below) * j.fuse.voxel })
      : [];
    const keys = new Set(pieces.map((p) => p.key));
    const todo = pieces.filter((p) => {
      const m = unit.done.get(p.key);
      return !(m && m.cfg === j.cfg && m.sig === p.sig);
    });
    const again = new Set(todo.map((p) => p.key));
    for (const [k, m] of unit.done) {
      // a piece that is no more; and what joined from another building, where this building's own piece is not made
      // again for it (its parts are gone)
      if (m.orphanOf === undefined ? !keys.has(k) : !again.has(m.orphanOf)) {
        unit.done.delete(k);
        this.dirty.add(m.chunk);
      }
    }
    unit.job = j;
    unit.ps = ps;
    unit.look = j.look ? lookFn(j.look) : undefined;
    unit.todo = todo;
    unit.serial = j.serial;
    this.voxel = j.fuse.voxel;
  }

  private heir(from: string, to: string): void {
    const a = this.units.get(from);
    if (!a) return;
    this.units.delete(from);
    const b = this.units.get(to);
    if (!b) {
      // (the same building under another name: its pieces, and what was still to do of it, go on)
      this.units.set(to, a);
      return;
    }
    for (const [k, m] of a.done) b.done.set(`${k}~${from}`, { ...m, orphanOf: m.orphanOf ?? k, after: b.serial });
  }

  private drop(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    for (const m of unit.done.values()) this.dirty.add(m.chunk);
    this.units.delete(id);
  }

  private reset(): void {
    this.units.clear();
    this.dirty.clear();
    this.cleared = true;
  }

  /** Pieces still to make: [with no mass yet, to be made again]. */
  pending(): [number, number] {
    let fresh = 0, again = 0;
    for (const unit of this.units.values()) for (const p of unit.todo) unit.done.has(p.key) ? again++ : fresh++;
    return [fresh, again];
  }

  hasDirty(): boolean {
    return this.cleared || this.dirty.size > 0;
  }

  /**
   * ONE PIECE: the deepest of those that have no mass yet — the fossil comes out by its layer's depth, so the deepest
   * is what is seen first — and only then those to be made again (what stands of them is nearly right meanwhile).
   * Returns the keys of the parts that have a mass now, or null when nothing is left to make.
   */
  step(): number[] | null {
    let unit: Unit | null = null, at = -1, cls = 2, k0 = Infinity;
    for (const q of this.units.values()) {
      for (let i = 0; i < q.todo.length; i++) {
        const p = q.todo[i];
        const c = q.done.has(p.key) ? 1 : 0;
        if (c < cls || (c === cls && p.k0 < k0)) [unit, at, cls, k0] = [q, i, c, p.k0];
      }
    }
    if (!unit || !unit.job) return null;
    const j = unit.job;
    const p = unit.todo.splice(at, 1)[0];
    const t0 = performance.now();
    const mesh = fuseTilesOf({ c0: p.k0, c1: p.k1, ps: p.ps, tubes: p.tubes, x0: p.tx, z0: p.tz, nx: j.tile, nz: j.tile }, j.h, j.u, j.sed, unit.look, j.fuse, j.tile, this.stages);
    turnBack(mesh, j.ang);
    const own: UnitPart[] = p.ps.map((e) => j.parts[e.i]);
    // (a pipe or a way is, for what its mass grows by, a part of its own: as old as its slot, and all of it fuses)
    if (own.some((e) => e.grow)) {
      for (const t of p.tubes) {
        const w = (j.tubes ?? [])[(t as FuseTube & { i: number }).i];
        if (!w) continue;
        const b = { kind: "mass", seed: 0, x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2, z: (w.z0 + w.z1) / 2, sx: Math.abs(w.x1 - w.x0) + 2 * w.r, sy: Math.abs(w.y1 - w.y0) + 2 * w.r, sz: Math.abs(w.z1 - w.z0) + 2 * w.r, slot: w.k, tone: 0, along: 0 } as unknown as Box;
        own.push({ b, d: 1, up: true, sk: false, grow: [w.k, w.k, 1, 1, 0, 1] });
      }
    }
    const was = unit.done.get(p.key);
    const stamp = was ? was.stamp : this.now();
    if (own.some((e) => e.grow)) {
      growData(mesh, own, j.u);
      // (the stamp rides in the growing data's free number: the wall's shader lets the piece out from then)
      const B = mesh.growB!;
      for (let v = 0; v < B.length; v += 2) B[v] = stamp;
    }
    // where it is shown: the chunk of the space its tile's middle lies in (a piece stays in its chunk)
    let chunk = was?.chunk;
    if (!chunk) {
      const mx = (p.tx + j.tile / 2) * CELL, mz = (p.tz + j.tile / 2) * CELL;
      const c = Math.cos(j.ang), sn = Math.sin(j.ang);
      const wx = mx * c + mz * sn, wz = -mx * sn + mz * c;
      chunk = `${Math.floor(wx / (CHUNK_CELLS * CELL))},${Math.floor(wz / (CHUNK_CELLS * CELL))},${Math.floor(p.k0 / CHUNK_SLOTS)}`;
    }
    unit.done.set(p.key, { cfg: j.cfg, sig: p.sig, mesh, stamp, chunk });
    this.dirty.add(chunk);
    // what had joined from another building stood here until now
    for (const [k, m] of unit.done) {
      if (m.orphanOf === p.key && j.serial > (m.after ?? -1)) {
        unit.done.delete(k);
        this.dirty.add(m.chunk);
      }
    }
    const ms = performance.now() - t0;
    this.made++;
    this.madeMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
    const keys: number[] = [];
    for (const e of own) if (e.key !== undefined) keys.push(e.key);
    return keys;
  }

  /** What is to be sent to the view: the chunks that are other than they were, each merged anew (and what to transfer). */
  flush(): { out: UnitChunks; transfer: ArrayBuffer[] } {
    const by = new Map<string, FuseMesh[]>();
    for (const id of this.dirty) by.set(id, []);
    for (const unit of this.units.values()) {
      for (const m of unit.done.values()) {
        const l = by.get(m.chunk);
        if (l && m.mesh.index.length) l.push(m.mesh);
      }
    }
    const [fresh, again] = this.pending();
    const out: UnitChunks = {
      type: "fuse-chunks",
      set: [],
      drop: [],
      clock0: this.clock0,
      stats: { waiting: fresh, remake: again, made: this.made, pieceMaxMs: this.maxMs, pieceMeanMs: this.made ? this.madeMs / this.made : 0, tris: 0, chunks: 0, units: this.units.size, voxel: this.voxel },
    };
    if (this.cleared) {
      out.clear = true;
      this.shown.clear();
    }
    const transfer: ArrayBuffer[] = [];
    for (const [id, list] of by) {
      if (!list.length) {
        if (this.shown.delete(id) && !out.clear) out.drop.push(id);
        continue;
      }
      const mesh = mergeMeshes(list);
      this.shown.set(id, mesh.index.length / 3);
      out.set.push({ id, mesh });
      for (const a of [mesh.position, mesh.normal, mesh.color, mesh.extra, mesh.index, mesh.anchor, mesh.growA, mesh.growB]) if (a) transfer.push(a.buffer as ArrayBuffer);
    }
    for (const n of this.shown.values()) out.stats.tris += n;
    out.stats.chunks = this.shown.size;
    this.dirty.clear();
    this.cleared = false;
    this.made = 0;
    this.madeMs = 0;
    this.maxMs = 0;
    return { out, transfer };
  }
}
