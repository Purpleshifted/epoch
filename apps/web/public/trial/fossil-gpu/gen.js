// A PLAUSIBLE BLOCK OF THE BOXES THE FOSSIL GROWS ON (trial, 2026-11-18). Not the artist's world: a generated one with
// the same kinds of things in it — the simplified assets of buildings (latticeUnion: a few joined masses a storey,
// in the building's own turn), the plates kept, the foundations below the first storey, the pipes and the ways
// between buildings (capsules) — each with the slot it is in, the window's top when it was built (born) and how much
// of its fossil the vegetation makes (veg). Same numbers as the wall: a cell is 1.2 world, a slot 1.8, the ground
// 160 × 160 cells.
//
// prim layout (12 floats): [x, y, z, cos|r, hx, hy, hz, sin, born, veg, late, type]
//   type 0 = box (centre, half sizes, turn); type 1 = capsule (x,y,z = one end, [3] = radius, [4..6] = the other end)
//   late: 0 = frame (pipes, ways, columns: out first), 1 = fill (masses, plates: after) — fuseLate on the wall

export const CELL = 1.2;
export const UNIT = 1.8;
export const GROUND = 160;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth noise of the ground (how lived-in a place is), 0..1. */
function groundNoise(r) {
  const waves = [];
  for (let i = 0; i < 6; i++) waves.push({ fx: (r() - 0.5) * 0.08, fz: (r() - 0.5) * 0.08, ph: r() * 6.28 });
  return (x, z) => {
    let s = 0;
    for (const w of waves) s += Math.sin(x * w.fx + z * w.fz + w.ph);
    return 0.5 + 0.5 * Math.tanh(s / 2.2);
  };
}

/**
 * @param {{ n?: number, slots?: number, seed?: number }} o  n = boxes wanted (prims, the pipes and ways counted), slots = the window's height
 * @returns {{ prims: Float32Array, count: number, boxes: number, tubes: number, buildings: number, bounds: number[], slots: number }}
 */
export function generate(o = {}) {
  const N = o.n ?? 12000, SLOTS = o.slots ?? 120, r = rng(o.seed ?? 7);
  const W = GROUND * CELL;
  const lived = groundNoise(r);
  const out = [];
  const push = (a) => out.push(a);
  // villages: a centre, a radius, a turn its buildings share (a few are not turned at all)
  const villages = [];
  const nv = 9 + Math.floor(r() * 6);
  for (let i = 0; i < nv; i++) {
    villages.push({ x: 15 + r() * (W - 30), z: 15 + r() * (W - 30), rad: 10 + r() * 22, yaw: r() < 0.3 ? 0 : (r() - 0.5) * 1.2, w: 0.4 + r() });
  }
  const wsum = villages.reduce((s, v) => s + v.w, 0);
  const buildings = [];
  let boxes = 0, tubes = 0;
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  while (out.length < N * 0.96) {
    // which village
    let pick = r() * wsum, v = villages[0];
    for (const q of villages) {
      pick -= q.w;
      if (pick <= 0) {
        v = q;
        break;
      }
    }
    const bx = Math.min(W - 6, Math.max(6, v.x + gauss() * v.rad)), bz = Math.min(W - 6, Math.max(6, v.z + gauss() * v.rad));
    const yaw = v.yaw + (r() < 0.15 ? (r() - 0.5) * 0.6 : 0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // footprint in the building's frame (a lattice of 0.5: latticeUnion's grid with the artist's lodGrid)
    const fw = Math.round((2 + r() * 5) * CELL * 2) / 2, fd = Math.round((2 + r() * 5) * CELL * 2) / 2;
    const k0 = Math.floor(r() * (SLOTS - 3));
    const hs = Math.max(1, Math.min(SLOTS - k0, Math.round(1 + Math.pow(r(), 1.6) * 12)));
    const veg = Math.min(1, 0.3 + 0.75 * (1 - lived(bx, bz)) + (r() - 0.5) * 0.2);
    const lag = 0.3 + r() * 1.5;
    const frame = r() < 0.4;
    const B = { x: bx, z: bz, yaw, k0, hs, veg };
    buildings.push(B);
    const at = (lx, lz) => [bx + lx * c + lz * s, bz - lx * s + lz * c];
    const box = (lx, ly, lz, sx, sy, sz, born, late) => {
      const [x, z] = at(lx, lz);
      push([x, ly, z, c, sx / 2, sy / 2, sz / 2, s, born, veg, late, 0]);
      boxes++;
    };
    // the foundation: a basement under the first storey, smaller than it
    box(0, k0 * UNIT - UNIT * 0.8, 0, fw * 0.7, UNIT * 1.6, fd * 0.7, k0 + lag, 1);
    for (let k = k0; k < k0 + hs; k++) {
      const born = k + lag + r() * 0.6;
      const y0 = k * UNIT;
      // the storey's masses joined on the lattice: one block, or an L of two, or a block and a lean-to
      const kind = r();
      const sh = UNIT * (r() < 0.75 ? 1 : 0.5 + r() * 0.5);
      if (kind < 0.45) box(0, y0 + sh / 2, 0, fw, sh, fd, born, 1);
      else if (kind < 0.8) {
        box(-fw * 0.2, y0 + sh / 2, 0, fw * 0.6, sh, fd, born, 1);
        box(fw * 0.3, y0 + sh / 2, -fd * 0.25, fw * 0.4, sh, fd * 0.5, born, 1);
      } else {
        box(0, y0 + sh / 2, -fd * 0.15, fw, sh, fd * 0.7, born, 1);
        box(fw * 0.15, y0 + sh * 0.3, fd * 0.35, fw * 0.7, sh * 0.6, fd * 0.3, born, 1);
      }
      // the plate kept, every other storey; it reaches past the masses a little
      if ((k - k0) % 2 === 0) box(0, y0 + 0.1, 0, fw + 0.6, 0.2, fd + 0.6, born, 1);
      // a frame: columns at the corners (out first)
      if (frame) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box((sx * (fw + 0.3)) / 2, y0 + UNIT / 2, (sz * (fd + 0.3)) / 2, 0.3, UNIT, 0.3, born, 0);
      }
    }
  }
  // pipes and ways between neighbouring buildings (capsules), and the ways along the ground of a slot
  const tube = (x0, y0, z0, x1, y1, z1, rad, born, veg) => {
    push([x0, y0, z0, rad, x1, y1, z1, 0, born, veg, 0, 1]);
    tubes++;
  };
  let guard = 0;
  while (out.length < N && guard++ < N * 20) {
    const a = buildings[Math.floor(r() * buildings.length)], b = buildings[Math.floor(r() * buildings.length)];
    if (a === b) continue;
    const dx = a.x - b.x, dz = a.z - b.z, dist = Math.hypot(dx, dz);
    if (dist > 30 || dist < 4) continue;
    const ka = a.k0 + Math.floor(r() * a.hs), kb = Math.max(b.k0, Math.min(b.k0 + b.hs - 1, ka + Math.round((r() - 0.5) * 2)));
    const veg = (a.veg + b.veg) / 2;
    if (r() < 0.6) {
      // a pipe from one building to the other, high on a storey
      tube(a.x, ka * UNIT + UNIT * 0.7, a.z, b.x, kb * UNIT + UNIT * 0.7, b.z, 0.22 + r() * 0.2, Math.max(ka, kb) + 1, veg);
    } else {
      // a way on the ground of the slot, in two legs (along the village's lines)
      const k = Math.min(ka, kb), y = k * UNIT + 0.15, born = k + 1;
      tube(a.x, y, a.z, b.x, y, a.z, 0.3, born, veg);
      tube(b.x, y, a.z, b.x, y, b.z, 0.3, born, veg);
    }
  }
  const prims = new Float32Array(out.length * 12);
  out.forEach((p, i) => prims.set(p, i * 12));
  const bounds = [0, -3 * UNIT, 0, W, SLOTS * UNIT + UNIT, W];
  return { prims, count: out.length, boxes, tubes, buildings: buildings.length, bounds, slots: SLOTS };
}

/** A prim's bounds (world), widened by `m`. */
export function primAabb(P, i, m) {
  const o = i * 12;
  if (P[o + 11] < 0.5) {
    const c = Math.abs(P[o + 3]), s = Math.abs(P[o + 7]);
    const hx = c * P[o + 4] + s * P[o + 6], hz = s * P[o + 4] + c * P[o + 6], hy = P[o + 5];
    return [P[o] - hx - m, P[o + 1] - hy - m, P[o + 2] - hz - m, P[o] + hx + m, P[o + 1] + hy + m, P[o + 2] + hz + m];
  }
  const rad = P[o + 3] + m;
  return [Math.min(P[o], P[o + 4]) - rad, Math.min(P[o + 1], P[o + 5]) - rad, Math.min(P[o + 2], P[o + 6]) - rad, Math.max(P[o], P[o + 4]) + rad, Math.max(P[o + 1], P[o + 5]) + rad, Math.max(P[o + 2], P[o + 6]) + rad];
}

/**
 * THE BRICKS: the space cut into bricks of B × B × B voxels of side h; only the bricks within reach R of a prim are
 * kept, each with the list of the prims that reach it (a box's bounds turned, so a list may hold one that is just
 * out of reach: the field is right, only a little more is read). Returns the brick grid and the lists.
 */
export function brickLists(P, count, bounds, h, B, R) {
  const bw = B * h;
  const ox = bounds[0] - R, oy = bounds[1] - R, oz = bounds[2] - R;
  const nx = Math.ceil((bounds[3] - bounds[0] + 2 * R) / bw), ny = Math.ceil((bounds[4] - bounds[1] + 2 * R) / bw), nz = Math.ceil((bounds[5] - bounds[2] + 2 * R) / bw);
  const lists = new Map();
  // (the brick's own apron of one voxel is in reach too)
  const m = R + h * 1.5;
  for (let i = 0; i < count; i++) {
    const a = primAabb(P, i, m);
    const i0 = Math.max(0, Math.floor((a[0] - ox) / bw)), i1 = Math.min(nx - 1, Math.floor((a[3] - ox) / bw));
    const j0 = Math.max(0, Math.floor((a[1] - oy) / bw)), j1 = Math.min(ny - 1, Math.floor((a[4] - oy) / bw));
    const k0 = Math.max(0, Math.floor((a[2] - oz) / bw)), k1 = Math.min(nz - 1, Math.floor((a[5] - oz) / bw));
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let ii = i0; ii <= i1; ii++) {
          const key = (k * ny + j) * nx + ii;
          const l = lists.get(key);
          if (l) l.push(i);
          else lists.set(key, [i]);
        }
  }
  return { origin: [ox, oy, oz], dims: [nx, ny, nz], lists, m };
}

/**
 * A WORLD DUMPED FROM THE WALL (2026-11-18, "실제 세계로 다시 잼"): the boxes the wall's model sent to its fossil
 * worker (UnitJob parts: each simplified asset with its turn, slot, the window's top when it was built and its
 * vegetation), caught on their way by a relay in a headless Chrome — nothing of the wall was changed. `data/<name>.json`
 * holds the counts, the window and the bounds; `data/<name>.f32` the prims in the layout above.
 */
export async function loadDump(name) {
  const meta = await (await fetch(`./data/${name}.json`)).json();
  const buf = await (await fetch(`./data/${name}.f32`)).arrayBuffer();
  const prims = new Float32Array(buf);
  return { ...meta, prims, count: prims.length / 12 };
}
