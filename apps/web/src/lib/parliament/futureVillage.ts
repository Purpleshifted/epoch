/**
 * parliament/futureVillage.ts
 *
 * THE INFERRED VILLAGE (the artist, 2026-11-16): above the column — apart from it — a layer of what is to come, two
 * or three slots of it, in 3D and standing on a ground of its own: "재배치되는 건물, 길이나 마을 변경, 수로변화를
 * 통시적으로 반영해서 추론된 마을 … 한 2-3단 정도의. 근데 이제 땅에서 붙은", "아, 식생변화도", "꼭대기는 지금 기둥에서
 * 분리된 형태여야 해". The window is the present made thick; this is read OFF it: how the buildings, the paths, the
 * water and (as what they leave free) the plants have changed over its latest slots, carried on a little further.
 *
 * FIRST RULES (Claude's reading, to be changed as the artist and the literature say — docs/world-review §29):
 *  - the latest `band` slots are halved into BEFORE and LATELY;
 *  - A BUILDING stands where a cell has been built lately and is not being left: presence lately + gain × (lately −
 *    before) ≥ ½; the higher that is (and the denser the cell), the taller — 1 … `maxH` slots. A cell being left
 *    (built before, hardly lately) is empty;
 *  - THE VILLAGE GROWS AT ITS EDGE: a free cell beside two cells that are growing, or beside one and on a path's
 *    side, gets a low building;
 *  - A PATH that is walked now stays; one whose end is new is carried on two cells the way it was going; no path
 *    under a building;
 *  - WATER keeps its latest course, but NOT THROUGH WHAT STANDS ("아래 건물이 있으면 거기 물 흐름이 원활하진 않을 거
 *    아니야"): where the course meets a building (inferred, or standing in the column's top) it is cut, and the
 *    water stands before it — a pool as large as the stretch that is blocked;
 *  - PLANTS take what the village, the paths and the water leave free, within a margin of where anybody has been —
 *    more of them by the water and its pools, fewer beside a path.
 * Nothing here is fused, eroded or kept: it is made again as the top rises, and so goes on varying.
 */

import { CELL_SIZE } from "@/lib/stratum/field";

const CELL = CELL_SIZE;

export interface FutureConfig {
  on: boolean;
  /** Slots of the window's top the change is read from (halved into before / lately). */
  band: number;
  /** How far the change of late is carried on (0 = what stands lately, as it is). */
  gain: number;
  /** The tallest inferred building (slots). */
  maxH: number;
  /** Whether the village grows at its edge. */
  edge: boolean;
  /** Cells round what anybody built or walked in which plants stand; plants per free cell. */
  margin: number;
  vegPer: number;
}

export const DEFAULT_FUTURE: FutureConfig = { on: true, band: 12, gain: 1, maxH: 3, edge: true, margin: 3, vegPer: 3 };

export interface FutureResult {
  /** The newest slot it was read from. */
  k: number;
  /** [x, z, sx, sz, h (slots), tone 0..1, grown (1 = a cell the village grew into)] per building. */
  boxes: Float32Array;
  /** [x0, z0, x1, z1] per stretch of path, of water (the pools' rims among them). */
  roads: Float32Array;
  water: Float32Array;
  /** [x, y (slots above the ground), z] per plant. */
  veg: Float32Array;
  /** The ground it stands on: [minX, minZ, maxX, maxZ] (world), or empty when nothing is inferred. */
  ground: Float32Array;
  /** How much of each there is (the readout). */
  n: { stand: number; left: number; grown: number; road: number; blocked: number };
}

export interface FutureInput {
  /** The newest whole slot of the window. */
  k: number;
  /** Every built cell with its level per slot. */
  cells: Iterable<{ x: number; z: number; levels?: ReadonlyMap<number, number> }>;
  pathAt: (cx: number, cz: number, k: number) => boolean;
  /** The open water's courses per slot ([x, z, …] polylines) and the buried runs as stretches [x0, z0, x1, z1, slot]. */
  streams: ReadonlyMap<number, readonly Float32Array[]>;
  cfg: FutureConfig;
}

const hash = (a: number, b: number, c = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const cellOf = (v: number) => Math.floor(v / CELL);
const key = (cx: number, cz: number) => cx * 65536 + cz;

export function inferFuture(input: FutureInput): FutureResult {
  const { k: K, cfg } = input;
  const band = Math.max(4, Math.round(cfg.band)), half = Math.floor(band / 2);
  const maxH = Math.max(1, Math.min(4, Math.round(cfg.maxH)));
  // every built cell: how much of BEFORE and of LATELY it stood, and how dense it was lately
  const cells = new Map<number, { cx: number; cz: number; a: number; b: number; lv: number }>();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of input.cells) {
    if (!s.levels) continue;
    let a = 0, b = 0, lv = 0;
    for (let i = 0; i < band; i++) {
      const l = s.levels.get(K - i) ?? 0;
      if (l < 1) continue;
      if (i < half) {
        b++;
        lv += l;
      } else a++;
    }
    if (!a && !b) continue;
    const cx = cellOf(s.x), cz = cellOf(s.z);
    const e = cells.get(key(cx, cz));
    // (a ground cell can be several buildings in time: together)
    if (e) {
      e.a = Math.min(1, e.a + a / (band - half));
      e.lv = Math.max(e.lv, b ? lv / b : 0);
      e.b = Math.min(1, e.b + b / half);
    } else cells.set(key(cx, cz), { cx, cz, a: a / (band - half), b: b / half, lv: b ? lv / b : 0 });
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cz < z0) z0 = cz;
    if (cz > z1) z1 = cz;
  }
  const empty: FutureResult = { k: K, boxes: new Float32Array(0), roads: new Float32Array(0), water: new Float32Array(0), veg: new Float32Array(0), ground: new Float32Array(0), n: { stand: 0, left: 0, grown: 0, road: 0, blocked: 0 } };
  if (!cells.size) return empty;
  const M = Math.max(1, Math.round(cfg.margin));
  x0 -= M;
  z0 -= M;
  x1 += M;
  z1 += M;
  // (a square of the ground no larger than the world: a guard against a stray cell far off)
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > 200 * 200) return empty;
  const n = { stand: 0, left: 0, grown: 0, road: 0, blocked: 0 };

  // ── buildings ──
  const stand = new Map<number, { cx: number; cz: number; h: number; tone: number; grown: number; rising: boolean }>();
  for (const [q, c] of cells) {
    const trend = c.b - c.a;
    const p = c.b + cfg.gain * trend;
    if (p < 0.5) {
      if (c.a > 0.3) n.left++;
      continue;
    }
    // (the surer and the denser, the taller)
    const h = Math.max(1, Math.min(maxH, Math.round(1 + (maxH - 1) * Math.min(1, (p - 0.5) * 0.7 + Math.max(0, c.lv - 1) * 0.25))));
    stand.set(q, { cx: c.cx, cz: c.cz, h, tone: hash(c.cx, c.cz, 7), grown: 0, rising: trend > 0.2 });
    n.stand++;
  }
  const pathNow = (cx: number, cz: number) => input.pathAt(cx, cz, K) || input.pathAt(cx, cz, K - 1);
  if (cfg.edge) {
    const grown: { cx: number; cz: number }[] = [];
    const seen = new Set<number>();
    for (const s of stand.values()) {
      if (!s.rising) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cx = s.cx + dx, cz = s.cz + dz, q = key(cx, cz);
        if (stand.has(q) || seen.has(q) || pathNow(cx, cz)) continue;
        seen.add(q);
        let rising = 0, byPath = false;
        for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (stand.get(key(cx + ex, cz + ez))?.rising) rising++;
          if (pathNow(cx + ex, cz + ez)) byPath = true;
        }
        if (rising >= 2 || (rising >= 1 && byPath)) grown.push({ cx, cz });
      }
    }
    for (const g of grown) {
      stand.set(key(g.cx, g.cz), { cx: g.cx, cz: g.cz, h: 1, tone: hash(g.cx, g.cz, 7), grown: 1, rising: false });
      n.grown++;
    }
  }

  // ── paths ──
  const road = new Set<number>();
  const roadCells: [number, number][] = [];
  const addRoad = (cx: number, cz: number) => {
    const q = key(cx, cz);
    if (road.has(q) || stand.has(q)) return;
    road.add(q);
    roadCells.push([cx, cz]);
  };
  const ends: [number, number, number, number][] = [];
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!pathNow(cx, cz)) continue;
      addRoad(cx, cz);
      // a new end: one neighbour on the path, and not walked half a band ago
      if (input.pathAt(cx, cz, K - half)) continue;
      let nb = 0, nx = 0, nz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (pathNow(cx + dx, cz + dz)) {
          nb++;
          nx = dx;
          nz = dz;
        }
      }
      if (nb === 1) ends.push([cx, cz, -nx, -nz]);
    }
  }
  for (const [cx, cz, dx, dz] of ends) for (let s = 1; s <= 2; s++) addRoad(cx + dx * s, cz + dz * s);
  const roads: number[] = [];
  for (const [cx, cz] of roadCells) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    let any = false;
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      if (road.has(key(cx + dx, cz + dz))) {
        roads.push(x, z, x + dx * CELL, z + dz * CELL);
        any = true;
      }
    }
    if (!any && !road.has(key(cx - 1, cz)) && !road.has(key(cx, cz - 1))) roads.push(x - CELL * 0.3, z, x + CELL * 0.3, z);
  }
  n.road = roadCells.length;

  // ── water: its latest course, cut where something stands, standing before it ──
  let course: readonly Float32Array[] = [];
  for (let k = K; k > K - band && !course.length; k--) course = input.streams.get(k) ?? [];
  const water: number[] = [];
  const wet = new Set<number>();
  const pool = (x: number, z: number, r: number) => {
    const SEG = 14;
    for (let i = 0; i < SEG; i++) {
      const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
      water.push(x + Math.cos(t0) * r, z + Math.sin(t0) * r, x + Math.cos(t1) * r, z + Math.sin(t1) * r);
    }
    const rc = Math.ceil(r / CELL);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) wet.add(key(cellOf(x) + dx, cellOf(z) + dz));
  };
  for (const line of course) {
    let blocked = 0, lastX = NaN, lastZ = NaN;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const hit = stand.has(key(cellOf((ax + bx) / 2), cellOf((az + bz) / 2)));
      if (hit) {
        blocked += Math.hypot(bx - ax, bz - az);
        continue;
      }
      if (blocked > 0 && !Number.isNaN(lastX)) {
        pool(lastX, lastZ, Math.min(CELL * 2.5, CELL * 0.6 + blocked * 0.35));
        n.blocked++;
      }
      blocked = 0;
      water.push(ax, az, bx, bz);
      wet.add(key(cellOf(ax), cellOf(az)));
      wet.add(key(cellOf(bx), cellOf(bz)));
      lastX = bx;
      lastZ = bz;
    }
    if (blocked > 0 && !Number.isNaN(lastX)) {
      pool(lastX, lastZ, Math.min(CELL * 2.5, CELL * 0.6 + blocked * 0.35));
      n.blocked++;
    }
  }

  // ── plants: what is left free, within the margin of where anybody has been ──
  const near = new Set<number>();
  const mark = (cx: number, cz: number) => {
    for (let dz = -M; dz <= M; dz++) for (let dx = -M; dx <= M; dx++) if (dx * dx + dz * dz <= M * M + 1) near.add(key(cx + dx, cz + dz));
  };
  for (const c of cells.values()) mark(c.cx, c.cz);
  for (const [cx, cz] of roadCells) mark(cx, cz);
  const veg: number[] = [];
  const per = Math.max(0, cfg.vegPer);
  const CAP = 60000;
  for (let cz = z0; cz <= z1 && veg.length < CAP * 3; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const q = key(cx, cz);
      if (!near.has(q) || stand.has(q) || road.has(q)) continue;
      let w = 1;
      // (more by the water, fewer beside a path, and where a building was left the plants come thick)
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (wet.has(key(cx + dx, cz + dz))) w = Math.max(w, 2);
        if (road.has(key(cx + dx, cz + dz))) w *= 0.7;
      }
      const c = cells.get(q);
      if (c && c.a > 0.3) w = Math.max(w, 1.8);
      const count = Math.floor(per * w + hash(cx, cz, 3));
      for (let i = 0; i < count; i++) veg.push((cx + hash(cx, cz, 11 + i)) * CELL, hash(cx, cz, 31 + i) * 0.35 * (c && c.a > 0.3 ? 2.5 : 1), (cz + hash(cx, cz, 53 + i)) * CELL);
    }
  }

  const boxes = new Float32Array(stand.size * 7);
  let o = 0;
  for (const s of stand.values()) {
    // (a building does not fill its cell: a little in from its sides, by its own number)
    const sx = CELL * (0.62 + 0.3 * hash(s.cx, s.cz, 1)), sz = CELL * (0.62 + 0.3 * hash(s.cx, s.cz, 2));
    boxes[o++] = (s.cx + 0.5) * CELL;
    boxes[o++] = (s.cz + 0.5) * CELL;
    boxes[o++] = sx;
    boxes[o++] = sz;
    boxes[o++] = s.h - 0.25 * hash(s.cx, s.cz, 5);
    boxes[o++] = s.tone;
    boxes[o++] = s.grown;
  }
  return { k: K, boxes, roads: Float32Array.from(roads), water: Float32Array.from(water), veg: Float32Array.from(veg), ground: Float32Array.from([x0 * CELL, z0 * CELL, (x1 + 1) * CELL, (z1 + 1) * CELL]), n };
}
