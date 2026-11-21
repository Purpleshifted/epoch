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
import { FILL_MAX_GAP, FRAME_KINDS, accretionShare, fuseChunk, fusePad, fusedShare, mergeMeshes, noise3, partReach, type FuseConfig, type FuseMesh, type FuseTube, type Sediment } from "./fuse";
import { WALL_BUILD } from "./build";
import type { NatureHistory } from "./natureHistory";
import type { Box } from "./seeds";

const CELL = CELL_SIZE;
/** Cells of margin round a building (and round a piece's own tile) that a piece is fused with. */
export const UNIT_PAD = 4;

type Sed = Sediment;

/**
 * WHETHER A PIPE OR A WAY REACHES A RECTANGLE OF THE GROUND [ax, bx] × [az, bz] (world): the stretch itself, by its
 * radius — not the square round it. Along x or z the two are the same; askew (a way, or a trunk joined over a turned
 * district's ground, 2026-11-21) the square round a long stretch is whole tiles it never enters, each of which
 * would be a piece made of nothing, and made again whenever the stretch changed.
 */
export function tubeInRect(t: FuseTube, ax: number, az: number, bx: number, bz: number): boolean {
  const lo = [ax - t.r, az - t.r], hi = [bx + t.r, bz + t.r], p0 = [t.x0, t.z0], d = [t.x1 - t.x0, t.z1 - t.z0];
  let ta = 0, tb = 1;
  for (let q = 0; q < 2; q++) {
    if (Math.abs(d[q]) < 1e-9) {
      if (p0[q] < lo[q] || p0[q] > hi[q]) return false;
      continue;
    }
    let a = (lo[q] - p0[q]) / d[q], b = (hi[q] - p0[q]) / d[q];
    if (a > b) [a, b] = [b, a];
    if (a > ta) ta = a;
    if (b < tb) tb = b;
    if (ta > tb) return false;
  }
  return true;
}

/** The longest box (world) an askew pipe or way is cut into for what its mass grows by (tubeBoxes). */
const TUBE_BOX = 3;

/**
 * A PIPE OR A WAY AS THE PARTS ITS MASS GROWS FROM (growData; the worker's make): along x or z it is one box. Askew —
 * a way's stretch — it is boxes of at most TUBE_BOX along it, each turned its way: one box square to the world round
 * an askew stretch covers the whole square the stretch crosses, and the values of the place (placeValues: the
 * youngest thing in a cell is the cell's age) would write the way's age over every building standing in it.
 */
export function tubeBoxes(w: FuseTube): Box[] {
  const dx = w.x1 - w.x0, dy = w.y1 - w.y0, dz = w.z1 - w.z0, d = 2 * w.r;
  const box = (m: number, sx: number, sy: number, sz: number, yaw: number): Box =>
    ({ kind: "mass", seed: 0, x: w.x0 + dx * m, y: w.y0 + dy * m, z: w.z0 + dz * m, sx, sy, sz, slot: w.k, tone: 0, along: 0, ...(yaw ? { yaw } : {}) }) as unknown as Box;
  if (Math.abs(dx) < 1e-4 || Math.abs(dz) < 1e-4) return [box(0.5, Math.abs(dx) + d, Math.abs(dy) + d, Math.abs(dz) + d, 0)];
  const flat = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(flat / TUBE_BOX));
  // (the box's own x along the stretch: growData turns a point into the box's frame by lx = dx·cos − dz·sin)
  const yaw = Math.atan2(-dz, dx);
  const out: Box[] = [];
  for (let i = 0; i < n; i++) out.push(box((i + 0.5) / n, flat / n + d, Math.abs(dy) / n + d, d, yaw));
  return out;
}

/** A chunk's parts (all square to the grid) fused tile by tile. */
export function fuseTilesOf(
  w: { c0: number; c1: number; ps: { b: Box; d: number; up: boolean; sk: boolean; w?: number }[]; tubes: readonly FuseTube[]; x0: number; z0: number; nx: number; nz: number },
  h: NatureHistory | null,
  u: number,
  sed: Sed,
  layerDecay: ((k: number) => number) | undefined,
  fuse: FuseConfig,
  TILE = 24,
  stages: Record<string, number> = {},
  /** THE PROVISIONAL SKIN (fuse.ts FuseChunkInput.ring): faces beyond the tile and the rows too, marked by their side. */
  ring?: { reach: number; reachY: number },
): FuseMesh {
  const MARGIN = 4;
  const meshes: FuseMesh[] = [];
  const cellOf = (v: number) => Math.floor(v / CELL);
  // (a part is its box and what its mass stands out of it by: fuse.ts partReach)
  const grown = partReach(fuse);
  for (let tz = w.z0; tz < w.z0 + w.nz; tz += TILE) {
    for (let tx = w.x0; tx < w.x0 + w.nx; tx += TILE) {
      let ax = tx - MARGIN, bx = tx + TILE + MARGIN, az = tz - MARGIN, bz = tz + TILE + MARGIN;
      const ps = w.ps.filter(({ b }) => {
        const r = Math.max(b.sx, b.sy, b.sz) / 2 + grown;
        return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
      });
      const tubes = w.tubes.filter((t) => tubeInRect(t, ax * CELL, az * CELL, bx * CELL, bz * CELL));
      if (!ps.length && !tubes.length) continue; // empty ground costs nothing
      // THE GRID IS AS LARGE AS WHAT IS IN IT (2026-11-15: a tile was always 32 × 32 cells, and its cost is its
      // volume — a district's few cells of building paid for the whole square, ~150 ms a tile): the tile's grid is
      // cut down to its parts and tubes, with the same margin round them. What the tile emits (`own`) is unchanged.
      {
        let a = Infinity, b2 = -Infinity, c = Infinity, d = -Infinity;
        for (const { b } of ps) {
          const r = Math.max(b.sx, b.sy, b.sz) / 2 + grown;
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
          weight: ps.map((e) => e.w ?? 1),
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
          ...(ring ? { ring } : {}),
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
/** How far off its unit's surface a vertex of the mass is pressed (world): clear of the wall drawn there. */
const ANCHOR_OUT = 0.08;
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
        // ON ITS UNIT, NOT IN IT (the artist, 2026-11-20: "화석 생길 때 건물벽이랑 맞물리면 플리커링이 보임"). The point a
        // vertex is pressed to lay a tenth inside the box: swelling out, the mass's skin passed THROUGH the building's
        // wall — for as long as the fossil takes to come, the two surfaces lay in one another and flickered. It now
        // lies just OFF the box's surface on the vertex's side (ANCHOR_OUT), so the skin begins on the wall and only
        // ever moves away from it. (A vertex inside the box — mass within the body — is pressed inwards as before.)
        const off = Math.sqrt(d2);
        const m = off > 1e-6 ? Math.min(1, ANCHOR_OUT / off) : 0;
        const ix = off > 1e-6 ? qx + (lx - qx) * m : qx * 0.9, iy = off > 1e-6 ? qy + (ly - qy) * m : qy * 0.9, iz = off > 1e-6 ? qz + (lz - qz) * m : qz * 0.9;
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
          // THE YOUNGEST THING IN A CELL IS THE CELL'S AGE (the artist, 2026-11-16: "부재가 지어질 때 바로 안 보이고 바로
          // 화석화되는 경우가 있는데"): as a mean, a new part among old ones took their age — its mass was out the
          // moment it was made. Now what is newly there holds the fossil back round it until it has aged itself.
          if (W[q] === 0 || g[1] - base > S1[q]) S1[q] = g[1] - base;
          W[q] += 1;
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
  // (the age is a value per covered cell, not a sum over the parts in it: its own weight)
  const W1 = new Float32Array(n);
  for (let q = 0; q < n; q++) if (W[q] > 0) W1[q] = 1;
  box(W1);
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
    let w = 0, w1 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const q = ((iz + dz) * ny + iy + dy) * nx + ix + dx;
      const t = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      w += t * W[q];
      w1 += t * W1[q];
      s1 += t * S1[q];
      s2 += t * S2[q];
      s3 += t * S3[q];
    }
    A[v * 4] = P[v * 3 + 1] / unit - 0.5;
    A[v * 4 + 1] = base + (s1 + OWN * (A[v * 4 + 1] - base)) / (w1 + OWN);
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
export function unitPieces<P extends { b: Box; d: number; up: boolean; sk: boolean; born?: number }>(
  ps: readonly P[],
  at: { ext: { x0: number; z0: number; nx: number; nz: number }; ka: number; kb: number },
  o: { seg: number; tile: number; padSlots: number; fusing: (list: readonly { d: number }[]) => boolean; grown?: number },
  /** The pipes and ways of the ground, with how far (world) a band's field reaches above and below its own slots. */
  ext2?: { tubes: readonly FuseTube[]; unit: number; reach: number; parts?: { margin: number; fill: boolean } },
): UnitPiece<P>[] {
  const { ext, ka, kb } = at;
  const SEG = o.seg, T = o.tile, PAD = UNIT_PAD;
  const out: UnitPiece<P>[] = [];
  for (let k0 = Math.floor((ka - 8) / SEG) * SEG; k0 <= kb + 3; k0 += SEG) {
    const k1 = k0 + SEG - 1;
    let inBand = ps.filter((e) => e.b.slot >= k0 - o.padSlots - 3 && e.b.slot <= k1 + o.padSlots + 8);
    // A PIECE READS ONLY THE PARTS THAT REACH ITS FIELD (2026-11-16; the artist: "프로그래밍적 아이디어로 최적화할 방안이
    // 없나?"): by the count of slots a band took the parts of some 49 slots (her values) — its field reaches about
    // 20, and fuseChunk passes the rest over. But they were in the piece's signature: a part come or gone 15 slots
    // away made the piece be made again for nothing. Now: the parts whose height reaches the field (and the plates
    // that may close a room of it from further off, when the rooms are filled).
    if (ext2?.parts) {
      const lo = k0 * ext2.unit - ext2.reach - ext2.parts.margin, hi = (k1 + 1) * ext2.unit + ext2.reach + ext2.parts.margin;
      const room = ext2.parts.fill ? (FILL_MAX_GAP + 1) * ext2.unit : 0;
      inBand = inBand.filter(({ b }) => {
        const hh = b.tilt ? Math.max(b.sx, b.sy, b.sz) / 2 : b.sy / 2, far = room && FRAME_KINDS.has(b.kind) ? room : 0;
        return b.y + hh >= lo - far && b.y - hh <= hi + far;
      });
    }
    // (a tube is read by the band whose field it lies in — by its height, not by a count of slots: a tube that
    // changes makes only the pieces it is in be made again)
    const yLo = ext2 ? k0 * ext2.unit - ext2.reach : 0, yHi = ext2 ? (k1 + 1) * ext2.unit + ext2.reach : 0;
    const tubesBand = ext2 ? ext2.tubes.filter((t) => Math.max(t.y0, t.y1) + t.r >= yLo && Math.min(t.y0, t.y1) - t.r <= yHi) : [];
    if (!inBand.length && !tubesBand.length) continue;
    for (let tz = Math.floor(ext.z0 / T) * T; tz < ext.z0 + ext.nz; tz += T) {
      for (let tx = Math.floor(ext.x0 / T) * T; tx < ext.x0 + ext.nx; tx += T) {
        const ax = tx - PAD, bx = tx + T + PAD, az = tz - PAD, bz = tz + T + PAD;
        const mine = inBand.filter(({ b }) => {
          const r = Math.max(b.sx, b.sy, b.sz) / 2 + (o.grown ?? 0);
          return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
        });
        const tubes = tubesBand.filter((t) => tubeInRect(t, ax * CELL, az * CELL, bx * CELL, bz * CELL));
        // (…nor where no pipe or way runs: the mass follows them across the ground between the buildings)
        if (!o.fusing(mine) && !tubes.length) continue;
        let sg = 0;
        for (const t of tubes) sg += t.x0 * 3.1 + t.y0 * 7.3 + t.z0 * 11.7 + t.x1 * 13.9 + t.y1 * 17.1 + t.z1 * 19.3 + t.r * 23.9;
        // (THE AGE IS PART OF WHAT A PIECE IS MADE FROM, 2026-11-20: the fossil's age is written into the piece's mesh —
        // growData — so a part whose clock starts over with the same box (its cell-slot lived in again: spaceModel
        // takeLived, or the slot built higher) makes its piece be made again; otherwise the old age would stay in it)
        let bornSig = 0;
        for (const e of mine) {
          sg += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.b.sx * 0.7 + e.b.sy * 1.3 + e.b.sz * 1.9 + Math.round(e.d * 20) * 0.9 + Math.round(((e as { w?: number }).w ?? 1) * 20) * 0.37 + (e.up ? 19 : 0) + (e.sk ? 23 : 0);
          // (a sum, as `sg` is: the same parts in another order are the same piece)
          if (e.born !== undefined) bornSig += e.born * (1.9 + e.b.x * 0.37 + e.b.y * 0.53 + e.b.z * 0.71);
        }
        out.push({ key: `${k0}:${tx}:${tz}`, sig: `${mine.length}:${tubes.length}:${sg.toFixed(3)}:${bornSig.toFixed(3)}`, k0, k1, tx, tz, ps: mine, tubes });
      }
    }
  }
  return out;
}

/** A mesh made in a turned district's own frame, turned back into the world. */
export function turnBack(mesh: FuseMesh, ang: number): void {
  if (!ang) return;
  const c = Math.cos(ang), sn = Math.sin(ang);
  for (const arr of [mesh.position, mesh.normal, mesh.key1, mesh.key2]) {
    if (!arr) continue;
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
  /** The pipes and the ways of its ground that fuse with it (in the world; fuse.ts FuseTube) — `born`: the window's
   *  top when the tube hardened (its fossil's age is counted from then). */
  tubes?: (FuseTube & { born?: number })[];
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
  /** THE FOSSIL'S CLOCK at the job's time (slots: the window's top + the stopped rise's clock — spaceModel bornAge), and
   *  the age after which a place's fossil begins to come out (the wall's uGrowAfter): what is out is made first. */
  age?: { now: number; after: number };
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
  /** Pieces made and held until their neighbours are (not on the screen yet). */
  held?: number;
  /** Pieces made since the last message, the longest of them (ms), and the mean. */
  made: number;
  pieceMaxMs: number;
  pieceMeanMs: number;
  /** What stands on the screen: triangles, chunks, buildings. */
  tris: number;
  chunks: number;
  units: number;
  voxel: number;
  /** The hardened pipes and ways that are in the grounds' fields now — and how many of them are ways. */
  tubes?: number;
  ways?: number;
  /** The stamp of the code this worker runs (build.ts). */
  build?: string;
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

// ── THE POOL (2026-11-20; the artist sees the buildings' simplification as a compromise of speed and would rather
// drop it — without it the fossil has more to make). The side that keeps the pieces (FuseUnits: what each building is,
// what is done, held, still to do, in what order) stays ONE; only the making of a piece — fuseTilesOf, turnBack,
// growData: the seconds — is handed to helper workers. A piece's mesh depends only on what it is made from, so it is
// the same whoever makes it; the order they are chosen in is the same order. ──

/** What every piece of a job is made with: said to a helper once per job (by its serial). */
export interface PieceCtx {
  type: "ctx";
  serial: number;
  h: NatureHistory | null;
  u: number;
  sed: Sed;
  look: UnitLook | null;
  fuse: FuseConfig;
  tile: number;
  ang: number;
}

/** A piece to make. */
export interface PieceTask {
  type: "piece";
  ticket: number;
  serial: number;
  k0: number;
  k1: number;
  tx: number;
  tz: number;
  /** (`w`: the part's fossil share in the field — FuseChunkInput.weight, what the iso is read against) */
  ps: { b: Box; d: number; up: boolean; sk: boolean; w?: number }[];
  tubes: FuseTube[];
  /** The parts (and pipes and ways) it grows from (growData). */
  own: UnitPart[];
  /** Whether it carries growth data (a part that grows, or — seeded — a pipe's trunk alone). */
  grows: boolean;
}

/** A piece made, back to the side that keeps the pieces. */
export interface PieceDone {
  type: "piece-done";
  ticket: number;
  mesh: FuseMesh;
  ms: number;
  stages?: Record<string, number>;
}

/** A piece's mesh: the same function on this side (step) and in a helper. */
export function makePiece(
  c: { h: NatureHistory | null; u: number; sed: Sed; fuse: FuseConfig; tile: number; ang: number },
  look: ((k: number) => number) | undefined,
  p: { k0: number; k1: number; tx: number; tz: number; ps: readonly { b: Box; d: number; up: boolean; sk: boolean; w?: number }[]; tubes: readonly FuseTube[] },
  own: readonly UnitPart[],
  stages: Record<string, number>,
  /** Whether it carries growth data (FuseUnits pick: a part that grows, or — seeded — a pipe's trunk alone). */
  grows = own.some((e) => e.grow),
): FuseMesh {
  const mesh = fuseTilesOf({ c0: p.k0, c1: p.k1, ps: [...p.ps], tubes: p.tubes, x0: p.tx, z0: p.tz, nx: c.tile, nz: c.tile }, c.h, c.u, c.sed, look, c.fuse, c.tile, stages, c.fuse.seeded ? { reach: PROV_REACH, reachY: PROV_REACH_Y } : undefined);
  turnBack(mesh, c.ang);
  if (grows && own.length) growData(mesh, own, c.u);
  return mesh;
}

/** A chunk of the space on the screen: this many cells square × this many slots. */
const CHUNK_CELLS = 42;
const CHUNK_SLOTS = 30;

/**
 * A PIECE THAT STANDS IS NOT MADE AGAIN FOR THIS LONG (2026-11-16 night; the artist: the fossil must mix with the
 * present — "현재랑 믹스되는 것도 중요해서 … 어차피 오버랩 구간이 생김" — so it stays in the window, where people write at
 * any depth). There every new simplified part made the pieces round it be made again at once, and with her world
 * more pieces fell due than could be made: the queue of pieces to make again only grew. But what is newly built
 * shows no fossil of its own for its first minutes (the wall's shader lets it out by its age), and meanwhile it
 * simply stands in the fossil that was there — the mix. So a piece is made again at most once in this long, with
 * everything that came into it meanwhile; a piece that has no mass yet, or whose mass was made under other
 * settings, is made at once.
 */
const PIECE_REST_MS = 180000;

interface Made {
  cfg: string;
  sig: string;
  mesh: FuseMesh;
  /** When it first stood on the screen (seconds of this side's clock): it grows out of its parts from then. */
  stamp: number;
  chunk: string;
  /** When it was made (performance.now()): it is not made again before it has stood PIECE_REST_MS. */
  at: number;
  /** A piece of a building that joined this one: it stands until this building's own piece there is made again. */
  orphanOf?: string;
  after?: number;
  /** Which of the six neighbours (bits: above, below, +x, −x, +z, −z) are wanted and not made yet (fadeEdges): the
   *  order makes those first. */
  mask?: number;
  /** THE PROVISIONAL SKIN: which of the six neighbours are on the screen now (its skin there is hidden), and per
   *  vertex how much of the skin is kept by its distance past the piece's own bounds (1 for the own faces). */
  shownBits?: number;
  prov?: Float32Array;
}
/** A piece on its way off the screen (made again, or no more): drawn, dissolving, until `until` (performance.now()). */
interface Leaving {
  made: Made;
  until: number;
}
/**
 * A PIECE MADE AGAIN IS NOT SHOWN AT ONCE (2026-11-18; the artist: "아니 화석 위에가 잘려 보일 때가 있다니깐??" — then,
 * of the ways out, "2, 3 진행"). A piece draws only its own slots and its own tile: the mass beyond is its neighbours'.
 * A piece made again from other parts no longer meets its neighbours made from the old ones. So it is HELD until no
 * neighbour it meets face to face is still to be made, and is then shown TOGETHER with the held pieces it meets (one
 * swap) — what stood stays until the whole is ready, as the exhibition's mass did ("the stale one until its turn
 * comes"). `made: null` — a piece that is no more, let go together with its neighbours in the same way.
 */
interface Staged {
  made: Made | null;
  /** The parts' keys that have a mass once it is shown (UnitFused). */
  keys: number[];
  /** performance.now() when it was held. */
  since: number;
}
interface Turned {
  b: Box;
  d: number;
  up: boolean;
  sk: boolean;
  /** Its fossil share in the field (fuse.ts FuseChunkInput.weight): the seeded mass's `most`. */
  w: number;
  /** Its place in the job's parts. */
  i: number;
  /** SEEDED: the age its fossil is counted from (growData's grow[1]) — in the piece's signature (unitPieces). */
  born?: number;
}
interface Unit {
  job: UnitJob | null;
  ps: Turned[];
  look: ((k: number) => number) | undefined;
  todo: UnitPiece<Turned>[];
  done: Map<string, Made>;
  serial: number;
  /** The pieces the building is made of now (their keys). */
  keys: Set<string>;
  /** …and each one's signature now (a piece back from a helper is taken only if it is still so). */
  sigs: Map<string, string>;
  /** Pieces made again and held (Staged). */
  staged: Map<string, Staged>;
  /** How far past being pressed each piece's oldest part is (slots of the fossil's age, at the job's time): what is
   *  out on the screen is made first. */
  vis: Map<string, number>;
  /** Pieces dissolving off the screen (show / commit). */
  leaving: Leaving[];
}

/**
 * A HELD PIECE IS SHOWN AFTER THIS LONG WHATEVER ITS NEIGHBOURS (ms): a neighbour that keeps changing must not keep
 * the whole from the screen. Longer than PIECE_REST_MS — a neighbour resting is made within it.
 */
const HOLD_MAX_MS = 240000;
/** (Until 2026-11-21 a face whose neighbour was not made yet was pressed back into its parts over 4 world, through a
 *  ragged noise: still the piece's outline. The provisional skin below goes past it instead.) */

/**
 * THE PROVISIONAL SKIN (the artist, 2026-11-21, of the cut while a piece's neighbour is made again or waited for: "둘 다
 * 넣는데, 그러면 가장자리에 노이즈 처리나 부피감을 넣어서 뚝 잘린 단면처럼 안 보이게 해"). A piece's mass is no longer cut at its
 * own tile and rows: it goes on PROV_REACH (world) across the ground — PROV_REACH_Y up and down — as a skin of its own
 * (fuse.ts FuseMesh.side), shown wherever the neighbour there is not on the screen and hidden where it is. The skin
 * thins out towards its far end through a noise of the world (PROV_RAG further in, patch by patch, PROV_PATCH wide)
 * and, thinned, is pressed into its parts by the wall's shader (its seal): it ends in a ragged, rounded fringe that
 * closes into the parts, not in a plane. Where the neighbour has no mass of its own at all, the skin simply stays.
 */
const PROV_REACH = 3.6;
const PROV_REACH_Y = 1.8;
const PROV_FADE = 1.6;
const PROV_RAG = 1.4;
const PROV_PATCH = 2.2;
/**
 * …AND WHAT CHANGES, CHANGES SOFTLY (the same request): a skin hidden or shown, a face pressed or let out, goes from
 * its old share to its new over this many seconds; a piece made again DISSOLVES into the one it replaces (the old one
 * drawn where a screen noise is over the time gone, the new one where it is under it) — the wall's shader, with the
 * same number (ParliamentSpace uGrowBlend).
 */
export const FUSE_BLEND_S = 6;

/** A mesh's pending changes, none yet (FuseMesh.blend): the skin's share 1 → 1, no change, no dissolve. */
function blendOf(nv: number): Float32Array {
  const bl = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    bl[v * 4] = 1;
    bl[v * 4 + 1] = -1e9;
    bl[v * 4 + 3] = 1;
  }
  return bl;
}

/** The pieces a piece meets face to face — above, below, +x, −x, +z, −z (its key: `${k0}:${tx}:${tz}`). */
function faceNeighbours(key: string, seg: number, tile: number): string[] {
  const [k0, tx, tz] = key.split(":").map(Number);
  return [`${k0 + seg}:${tx}:${tz}`, `${k0 - seg}:${tx}:${tz}`, `${k0}:${tx + tile}:${tz}`, `${k0}:${tx - tile}:${tz}`, `${k0}:${tx}:${tz + tile}`, `${k0}:${tx}:${tz - tile}`];
}

/**
 * THE MASSES BEING MADE (this side's state): every building's latest job, its pieces done, held and still to do.
 * `step` makes one piece; `takeFused` gives the parts that came onto the screen; `flush` what is to be sent to the view.
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
  private fused: number[] = [];
  /** After a `step` that made nothing: how long until a piece that is resting may be made again (ms; Infinity = none). */
  waitMs = Infinity;
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
    if (!unit) this.units.set(j.id, (unit = { job: null, ps: [], look: undefined, todo: [], done: new Map(), serial: -1, keys: new Set(), sigs: new Map(), staged: new Map(), vis: new Map(), leaving: [] }));
    const c = Math.cos(j.ang), sn = Math.sin(j.ang);
    // (a turned district is fused in its own frame, where its boxes lie along the grid: seeds.ts' turn undone)
    const ps: Turned[] = j.parts.map((e, i) => ({ b: j.ang ? { ...e.b, x: e.b.x * c - e.b.z * sn, z: e.b.x * sn + e.b.z * c, yaw: 0 } : e.b, d: e.d, up: e.up, sk: e.sk, w: e.grow ? Math.max(0, Math.min(1, e.grow[5] ?? 1)) : 1, i, born: e.grow?.[1] }));
    const tubes = (j.tubes ?? []).map((t, i) => (j.ang ? { ...t, x0: t.x0 * c - t.z0 * sn, z0: t.x0 * sn + t.z0 * c, x1: t.x1 * c - t.z1 * sn, z1: t.x1 * sn + t.z1 * c, i } : { ...t, i }));
    const pad = fusePad(j.fuse);
    const pieces = ps.length
      ? unitPieces(ps, unitExtent(ps), { seg: j.seg, tile: j.tile, padSlots: j.padSlots, fusing: unitFusing(j.fuse), grown: partReach(j.fuse) }, { tubes, unit: j.u, reach: Math.max(pad.above, pad.below) * j.fuse.voxel, parts: { margin: j.fuse.accDepth + 2 * j.fuse.voxel + partReach(j.fuse), fill: !!j.fuse.study?.fill } })
      : [];
    const want = new Map(pieces.map((p) => [p.key, p] as const));
    // (what was held for parts that are no longer so is made again; a piece let go that is wanted again, too)
    for (const [k, s] of unit.staged) {
      const p = want.get(k);
      if (s.made ? !p || s.made.sig !== p.sig || s.made.cfg !== j.cfg : !!p) unit.staged.delete(k);
    }
    // (a piece out with a helper, made from these very parts under these settings, is not asked for again: it comes)
    const flying = this.flying(unit, j.cfg);
    const todo = pieces.filter((p) => {
      const m = unit.done.get(p.key);
      return !(m && m.cfg === j.cfg && m.sig === p.sig) && !unit.staged.has(p.key) && flying.get(p.key) !== p.sig;
    });
    const again = new Set(todo.map((p) => p.key));
    const now = performance.now();
    for (const [k, m] of unit.done) {
      // what joined from another building, where this building's own piece is not made again for it (its parts are gone)
      if (m.orphanOf !== undefined) {
        if (!again.has(m.orphanOf) && !unit.staged.has(m.orphanOf)) {
          unit.done.delete(k);
          this.dirty.add(m.chunk);
        }
        continue;
      }
      // a piece that is no more: let go together with its neighbours (held, as an empty piece)
      if (!want.has(k) && !unit.staged.has(k)) unit.staged.set(k, { made: null, keys: [], since: now });
    }
    // HOW MUCH OF EACH PIECE IS OUT (idea 2): the fossil comes out by the age since its place hardened; a piece whose
    // parts are all younger than that is pressed on the screen — a change there is seen by nobody yet, and waits
    unit.vis = new Map();
    if (j.age) {
      for (const p of pieces) {
        let born = Infinity;
        for (const e of p.ps) {
          const g = j.parts[e.i]?.grow;
          if (g && g[1] < born) born = g[1];
        }
        unit.vis.set(p.key, born === Infinity ? 0 : j.age.now - j.age.after - born);
      }
    }
    unit.job = j;
    unit.ps = ps;
    unit.look = j.look ? lookFn(j.look) : undefined;
    unit.todo = todo;
    unit.serial = j.serial;
    unit.keys = new Set(want.keys());
    unit.sigs = new Map(pieces.map((p) => [p.key, p.sig] as const));
    this.voxel = j.fuse.voxel;
    this.commit(unit);
    // (a neighbour wanted now that was not, or the other way round: the faces open or close)
    for (const k of unit.done.keys()) this.fadeEdges(unit, k);
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
    b.leaving.push(...a.leaving);
  }

  private drop(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    for (const m of unit.done.values()) this.dirty.add(m.chunk);
    for (const l of unit.leaving) this.dirty.add(l.made.chunk);
    this.units.delete(id);
  }

  private reset(): void {
    this.units.clear();
    // (what helpers are making now is of nothing that stands: it is let go when it comes)
    this.flights.clear();
    this.dirty.clear();
    this.fused = [];
    this.cleared = true;
  }

  /** Pieces still to make: [with no mass yet, to be made again]. */
  pending(): [number, number] {
    let fresh = 0, again = 0;
    for (const unit of this.units.values()) for (const p of unit.todo) unit.done.has(p.key) ? again++ : fresh++;
    // (and those out with a helper: still to come)
    for (const f of this.flights.values()) f.unit.done.has(f.p.key) ? again++ : fresh++;
    return [fresh, again];
  }

  /** Pieces made again and held (not on the screen yet). */
  held(): number {
    let n = 0;
    for (const unit of this.units.values()) n += unit.staged.size;
    return n;
  }

  hasDirty(): boolean {
    return this.cleared || this.dirty.size > 0;
  }

  /** The parts that have a mass on the screen since the last call (UnitFused). */
  takeFused(): number[] {
    const out = this.fused;
    this.fused = [];
    return out;
  }

  /**
   * THE FACES TOWARDS THE NEIGHBOURS (2026-11-18; since 2026-11-21 the provisional skin): what each vertex is let out by
   * — the vegetation's share as made (fuseGrowB.y) — times, on the provisional skin, 0 where the neighbour on that side
   * is on the screen (it draws its own) and the skin's thinning towards its far end (provOf) where it is not. A change
   * goes over FUSE_BLEND_S from what is on the screen (FuseMesh.blend). Only the numbers are written again (no fusing);
   * the piece's chunk is sent again when a neighbour comes or goes.
   */
  private fadeEdges(q: Unit, key: string): void {
    const m = q.done.get(key), j = q.job;
    if (!m || m.orphanOf !== undefined || !j) return;
    const P = m.mesh.position;
    if (!P.length) return;
    // (wanted and not made: the faces the order closes first — `mask`; on the screen: the skin there is hidden)
    let mask = 0, shownBits = 0;
    faceNeighbours(key, j.seg, j.tile).forEach((n, f) => {
      if (q.keys.has(n) && !q.done.has(n)) mask |= 1 << f;
      if (q.done.has(n)) shownBits |= 1 << f;
    });
    m.mask = mask;
    const side = m.mesh.side;
    const nv = P.length / 3;
    let bl = m.mesh.blend;
    const fresh = !bl;
    if (!bl) {
      bl = m.mesh.blend = blendOf(nv);
    } else if ((m.shownBits ?? -1) === shownBits) return;
    m.shownBits = shownBits;
    if (!side) return;
    if (!m.prov) m.prov = this.provOf(m, key, j);
    const tNow = this.now();
    for (let v = 0; v < nv; v++) {
      const sd = side[v];
      if (!sd) continue;
      // the skin's share: hidden where the neighbour on its side is on the screen, thinning towards its far end
      const target = sd & shownBits ? 0 : m.prov[v];
      const was = bl[v * 4 + 3];
      if (target === was) continue;
      if (fresh || bl[v * 4 + 2] !== 0) {
        // (not on the screen yet, or dissolving in or out: the share is set as it is — the dissolve carries it)
        bl[v * 4] = target;
        bl[v * 4 + 3] = target;
        continue;
      }
      // (from what is on the screen now — mid-way through an earlier change, where it stands — to the new share)
      const t = Math.max(0, Math.min(1, (tNow - bl[v * 4 + 1]) / FUSE_BLEND_S));
      bl[v * 4] = bl[v * 4] + (was - bl[v * 4]) * t;
      bl[v * 4 + 1] = tNow;
      bl[v * 4 + 3] = target;
    }
    this.dirty.add(m.chunk);
  }

  /** THE PROVISIONAL SKIN's share kept per vertex: 1 within PROV_REACH − PROV_FADE of the own bounds, thinning to 0 at
   *  PROV_REACH through the noise of the world (the own faces: 1). */
  private provOf(m: Made, key: string, j: UnitJob): Float32Array {
    const side = m.mesh.side!, P = m.mesh.position, nv = side.length;
    const out = new Float32Array(nv).fill(1);
    const [k0, tx, tz] = key.split(":").map(Number);
    const y0 = k0 * j.u, y1 = (k0 + j.seg) * j.u;
    const x0 = tx * CELL, x1 = (tx + j.tile) * CELL, z0 = tz * CELL, z1 = (tz + j.tile) * CELL;
    const c = Math.cos(j.ang), sn = Math.sin(j.ang);
    for (let v = 0; v < nv; v++) {
      const sd = side[v];
      if (!sd) continue;
      const wx = P[v * 3], y = P[v * 3 + 1], wz = P[v * 3 + 2];
      const x = wx * c - wz * sn, z = wx * sn + wz * c;
      // (how far past its own bounds, by the side it lies beyond: the larger of the two across the ground, or up/down)
      let past = 0, reach = PROV_REACH;
      if (sd & 4) past = Math.max(past, x - x1);
      if (sd & 8) past = Math.max(past, x0 - x);
      if (sd & 16) past = Math.max(past, z - z1);
      if (sd & 32) past = Math.max(past, z0 - z);
      if (sd & 3) {
        const py = sd & 1 ? y - y1 : y0 - y;
        if (py / PROV_REACH_Y > past / PROV_REACH) [past, reach] = [py, PROV_REACH_Y];
      }
      const rag = PROV_RAG * (reach / PROV_REACH) * noise3(wx / PROV_PATCH, y / PROV_PATCH, wz / PROV_PATCH, 131);
      const t = Math.max(0, Math.min(1, (reach - rag - Math.max(0, past)) / (PROV_FADE * (reach / PROV_REACH))));
      out[v] = t * t * (3 - 2 * t);
    }
    return out;
  }

  /** A piece off the screen: it dissolves out over FUSE_BLEND_S (drawn until then from `leaving`). */
  private leave(q: Unit, m: Made): void {
    const nv = m.mesh.position.length / 3;
    if (nv) {
      const bl = (m.mesh.blend ??= blendOf(nv));
      const tNow = this.now();
      for (let v = 0; v < nv; v++) {
        // (its skin stays as it is on the screen now; the dissolve takes the whole away)
        const t = Math.max(0, Math.min(1, (tNow - bl[v * 4 + 1]) / FUSE_BLEND_S));
        const S = bl[v * 4] + (bl[v * 4 + 3] - bl[v * 4]) * t;
        bl[v * 4] = S;
        bl[v * 4 + 3] = S;
        bl[v * 4 + 1] = tNow;
        bl[v * 4 + 2] = -1;
      }
      q.leaving.push({ made: m, until: performance.now() + FUSE_BLEND_S * 1000 + 200 });
    }
    this.dirty.add(m.chunk);
  }

  /** The pieces whose dissolve is over are let go; returns ms until the next one is (Infinity = none). */
  sweep(): number {
    const now = performance.now();
    let next = Infinity;
    for (const q of this.units.values()) {
      if (!q.leaving.length) continue;
      q.leaving = q.leaving.filter((l) => {
        if (l.until > now) {
          next = Math.min(next, l.until - now);
          return true;
        }
        this.dirty.add(l.made.chunk);
        return false;
      });
    }
    return next;
  }

  /** A piece comes onto the screen: stamped (one new on the screen grows out of its parts from now; one made again
   *  keeps its stamp), what joined from another building there let go, its parts absorbed, its faces and its
   *  neighbours' faces looked at again. */
  private show(q: Unit, k: string, made: Made, keys: readonly number[], stampNow: number): void {
    const was = q.done.get(k);
    const stamp = was ? was.stamp : stampNow;
    if (made.stamp !== stamp) {
      made.stamp = stamp;
      const B = made.mesh.growB;
      if (B) for (let v = 0; v < B.length; v += 2) B[v] = stamp;
    }
    // MADE AGAIN: it dissolves in over the one it replaces, which dissolves out (FUSE_BLEND_S)
    if (was && was !== made) {
      const nv = made.mesh.position.length / 3;
      const bl = (made.mesh.blend = blendOf(nv));
      const tNow = this.now();
      for (let v = 0; v < nv; v++) {
        bl[v * 4 + 1] = tNow;
        bl[v * 4 + 2] = 1;
      }
      this.leave(q, was);
    }
    q.done.set(k, made);
    this.dirty.add(made.chunk);
    if (was && was.chunk !== made.chunk) this.dirty.add(was.chunk);
    for (const [ok, m] of q.done) {
      if (m.orphanOf === k && q.serial > (m.after ?? -1)) {
        q.done.delete(ok);
        this.dirty.add(m.chunk);
      }
    }
    for (const key of keys) this.fused.push(key);
    this.fadeEdges(q, k);
    if (q.job) for (const n of faceNeighbours(k, q.job.seg, q.job.tile)) this.fadeEdges(q, n);
  }

  /**
   * THE HELD PIECES ARE SHOWN, A WHOLE AT A TIME: the held pieces that meet face to face are one group, and a group is
   * shown when none of its pieces meets a piece still to be made (or it has waited HOLD_MAX_MS).
   */
  private commit(q: Unit): void {
    if (!q.staged.size || !q.job) return;
    const { seg, tile } = q.job;
    // (a piece out with a helper is still to be made, as one in the list is)
    const todoKeys = new Set([...q.todo.map((p) => p.key), ...this.flying(q).keys()]);
    const seen = new Set<string>();
    const now = performance.now();
    for (const start of [...q.staged.keys()]) {
      if (seen.has(start)) continue;
      const group: string[] = [];
      const stack = [start];
      seen.add(start);
      let blocked = false, oldest = Infinity;
      while (stack.length) {
        const k = stack.pop()!;
        group.push(k);
        oldest = Math.min(oldest, q.staged.get(k)!.since);
        for (const n of faceNeighbours(k, seg, tile)) {
          if (todoKeys.has(n)) blocked = true;
          if (q.staged.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      if (blocked && now - oldest < HOLD_MAX_MS) continue;
      const stampNow = this.now();
      const toShow: [string, Made, number[]][] = [];
      for (const k of group) {
        const s = q.staged.get(k)!;
        q.staged.delete(k);
        if (s.made) {
          toShow.push([k, s.made, s.keys]);
          continue;
        }
        const was = q.done.get(k);
        if (was) {
          q.done.delete(k);
          if (was.orphanOf === undefined) this.leave(q, was);
          else this.dirty.add(was.chunk);
        }
      }
      // (the empty ones are gone first, so a shown piece's faces are read against what is left)
      for (const [k, made, keys] of toShow) this.show(q, k, made, keys, stampNow);
      // (a piece let go: the faces of those round it may open)
      for (const k of group) for (const n of faceNeighbours(k, seg, tile)) this.fadeEdges(q, n);
    }
  }

  /**
   * ONE PIECE. The order (2026-11-18, "2, 3 진행"):
   *  1. a piece that a held piece waits for — so what was begun is shown soon, whole;
   *  2. a piece that is out on the screen (its oldest part older than the fossil's beginning) before one that is still
   *     pressed — a change nobody can see yet waits;
   *  3. a piece with no mass yet before one only made again;
   *  4. a piece next to one on the screen whose face towards it is pressed — so the mass closes up;
   *  5. the more out, then the deepest.
   * A piece that stands and was made under these settings is not made again before it has stood PIECE_REST_MS (even
   * when a held piece waits for it — HOLD_MAX_MS is longer). A piece with no mass yet is shown at once (its faces
   * towards what is not there yet pressed: fadeEdges); one made again is held (commit). Returns null when nothing was
   * made.
   */
  step(): number[] | null {
    const p = this.pick();
    if (!p) return null;
    const t0 = performance.now();
    const mesh = makePiece(p.j, p.unit.look, p.p, p.own, this.stages, p.grows);
    return this.finish(p.unit, p.j, p.p, p.own, p.keys, mesh, performance.now() - t0, p.grows);
  }

  /** The next piece by the order above, taken out of its building's list (null when nothing may be made now). */
  private pick(): { unit: Unit; j: UnitJob; p: UnitPiece<Turned>; own: UnitPart[]; keys: number[]; grows: boolean } | null {
    const now = performance.now();
    this.waitMs = Infinity;
    this.sweep();
    // (groups whose waiting is over — or that were waiting for nothing any more)
    for (const q of this.units.values()) this.commit(q);
    let unit: Unit | null = null, at = -1;
    let best: number[] | null = null;
    for (const q of this.units.values()) {
      if (!q.todo.length || !q.job) continue;
      const needed = new Set<string>();
      for (const k of q.staged.keys()) for (const n of faceNeighbours(k, q.job.seg, q.job.tile)) needed.add(n);
      const closing = new Set<string>();
      for (const [k, m] of q.done) if (m.mask) for (const n of faceNeighbours(k, q.job.seg, q.job.tile)) closing.add(n);
      for (let i = 0; i < q.todo.length; i++) {
        const p = q.todo[i];
        const m = q.done.get(p.key);
        if (m && m.cfg === q.job.cfg && now - m.at < PIECE_REST_MS) {
          this.waitMs = Math.min(this.waitMs, PIECE_REST_MS - (now - m.at));
          continue;
        }
        const vis = q.vis.get(p.key) ?? 0;
        const rank = [needed.has(p.key) ? 0 : 1, vis > 0 ? 0 : 1, m ? 1 : 0, closing.has(p.key) ? 0 : 1, -vis, p.k0];
        let better = !best;
        if (best) {
          for (let r = 0; r < rank.length; r++) {
            if (rank[r] !== best[r]) {
              better = rank[r] < best[r];
              break;
            }
          }
        }
        if (better) [unit, at, best] = [q, i, rank];
      }
    }
    const q = unit as Unit | null;
    if (!q || !q.job) return null;
    const j = q.job;
    const p = q.todo.splice(at, 1)[0];
    const own: UnitPart[] = p.ps.map((e) => j.parts[e.i]);
    // (a pipe or a way is, for what its mass grows by, a part of its own: as old as its slot, and all of it fuses —
    // also where a piece holds nothing but a pipe's trunk: without its growth data the wall's shader never lets it out)
    const grows = own.some((e) => e.grow) || (!!j.fuse.seeded && p.tubes.length > 0);
    if (grows) {
      for (const t of p.tubes) {
        const w = (j.tubes ?? [])[(t as FuseTube & { i: number }).i];
        if (!w) continue;
        const grow = [w.k, w.born ?? w.k, 1, 1, 0, 1];
        for (const b of tubeBoxes(w)) own.push({ b, d: 1, up: true, sk: false, grow });
      }
    }
    const keys: number[] = [];
    for (const e of own) if (e.key !== undefined) keys.push(e.key);
    return { unit: q, j, p, own, keys, grows };
  }

  /** A piece made (here or by a helper): stamped, put in its chunk, shown — or held until its neighbours are made. */
  private finish(unit: Unit, j: UnitJob, p: UnitPiece<Turned>, own: readonly UnitPart[], keys: number[], mesh: FuseMesh, ms: number, grows: boolean): number[] {
    const was = unit.done.get(p.key);
    // (the stamp is written when it is shown: show)
    const stamp = was ? was.stamp : -1;
    if (grows && own.length && mesh.growB) {
      const B = mesh.growB;
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
    const made: Made = { cfg: j.cfg, sig: p.sig, mesh, stamp, chunk, at: performance.now() };
    if (was && was.orphanOf === undefined) {
      unit.staged.set(p.key, { made, keys, since: performance.now() });
      this.commit(unit);
    } else this.show(unit, p.key, made, keys, this.now());
    this.made++;
    this.madeMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
    return keys;
  }

  // ── THE POOL (2026-11-20): the pieces made by helper workers, this side keeping everything else ──

  /** A piece out with a helper: everything it is finished with when it comes back. */
  private flights = new Map<number, { unit: Unit; j: UnitJob; p: UnitPiece<Turned>; own: UnitPart[]; keys: number[]; grows: boolean; helper: number }>();
  private ticket = 0;

  /** Pieces out with a helper now. */
  inFlight(helper?: number): number {
    if (helper === undefined) return this.flights.size;
    let n = 0;
    for (const f of this.flights.values()) if (f.helper === helper) n++;
    return n;
  }

  /**
   * THE NEXT PIECE FOR A HELPER: chosen and taken out exactly as `step` would take it, and given a ticket; the job it
   * is of is said once per helper (`ctx`, by the job's serial). Null when nothing may be made now (`waitMs` set).
   */
  dispatch(helper: number): { ctx: PieceCtx; task: PieceTask } | null {
    const p = this.pick();
    if (!p) return null;
    const ticket = ++this.ticket;
    this.flights.set(ticket, { ...p, helper });
    const j = p.j;
    return {
      ctx: { type: "ctx", serial: j.serial, h: j.h, u: j.u, sed: j.sed, look: j.look, fuse: j.fuse, tile: j.tile, ang: j.ang },
      task: { type: "piece", ticket, serial: j.serial, k0: p.p.k0, k1: p.p.k1, tx: p.p.tx, tz: p.p.tz, ps: p.p.ps.map(({ b, d, up, sk, w }) => ({ b, d, up, sk, w })), tubes: p.p.tubes, own: p.own, grows: p.grows },
    };
  }

  /** A helper's piece came back: finished as `step` finishes it — if its building still wants it as it was made. */
  complete(m: PieceDone): number[] | null {
    const f = this.flights.get(m.ticket);
    if (!f) return null;
    this.flights.delete(m.ticket);
    // (the helper's account of its piece: its slowest tile kept if slower than any here; the counts added)
    const st = m.stages ?? {};
    if ((st["slow tile ms"] ?? 0) > (this.stages["slow tile ms"] ?? 0)) Object.assign(this.stages, st);
    else for (const k of ["fuse tiles (n)", "fuse cells (n)"]) if (st[k]) this.stages[k] = (this.stages[k] ?? 0) + st[k];
    if (!this.live(f.unit) || f.unit.job?.cfg !== f.j.cfg || f.unit.sigs.get(f.p.key) !== f.p.sig) return null;
    return this.finish(f.unit, f.j, f.p, f.own, f.keys, m.mesh, m.ms, f.grows);
  }

  /** A helper is gone (failed, or the pool was made smaller) — or lost one piece: its pieces go back to be made. */
  cancel(helper: number, ticket?: number): void {
    for (const [t, f] of this.flights) {
      if (f.helper !== helper || (ticket !== undefined && t !== ticket)) continue;
      this.flights.delete(t);
      if (this.live(f.unit) && f.unit.job?.cfg === f.j.cfg && f.unit.sigs.get(f.p.key) === f.p.sig && !f.unit.todo.some((q) => q.key === f.p.key)) f.unit.todo.push(f.p);
    }
  }

  private live(q: Unit): boolean {
    for (const u of this.units.values()) if (u === q) return true;
    return false;
  }

  /** The pieces of a building out with a helper (key → signature, made under its job's settings). */
  private flying(q: Unit, cfg?: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of this.flights.values()) if (f.unit === q && (cfg === undefined || f.j.cfg === cfg)) out.set(f.p.key, f.p.sig);
    return out;
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
      // (the pieces dissolving out are drawn with their chunk until they are gone)
      for (const lv of unit.leaving) {
        const l = by.get(lv.made.chunk);
        if (l && lv.made.mesh.index.length) l.push(lv.made.mesh);
      }
    }
    const [fresh, again] = this.pending();
    const out: UnitChunks = {
      type: "fuse-chunks",
      set: [],
      drop: [],
      clock0: this.clock0,
      stats: { waiting: fresh, remake: again, held: this.held(), made: this.made, pieceMaxMs: this.maxMs, pieceMeanMs: this.made ? this.madeMs / this.made : 0, tris: 0, chunks: 0, units: this.units.size, voxel: this.voxel, build: WALL_BUILD, tubes: [...this.units.values()].reduce((n, q) => n + (q.job?.tubes?.length ?? 0), 0), ways: [...this.units.values()].reduce((n, q) => n + (q.job?.tubes?.filter((t) => t.kind === "walk").length ?? 0), 0) },
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
      delete mesh.side; // (the worker's own: the view does not read it)
      this.shown.set(id, mesh.index.length / 3);
      out.set.push({ id, mesh });
      for (const a of [mesh.position, mesh.normal, mesh.color, mesh.extra, mesh.index, mesh.anchor, mesh.growA, mesh.growB, mesh.late, mesh.blend, mesh.key1, mesh.key2]) if (a) transfer.push(a.buffer as ArrayBuffer);
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
