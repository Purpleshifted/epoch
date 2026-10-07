/**
 * parliament/spaceModel.ts
 *
 * Everything the 3D timespace computes, in one place that can run OFF the main thread (components/parliament/
 * space.worker.ts): fold → seeds → parts (with level of detail) → wear → instance matrices per part kind; the
 * vegetation volume (natureHistory → points); the plants on ruins (reclaim). The main thread only copies the
 * returned buffers into its meshes. No three.js here: matrices and colours are written directly.
 *
 * LEVEL OF DETAIL. A seed further than `lod.near` from the camera is built without slat bundles (one box per mass);
 * vegetation chunks further away get fewer points (down to `lod.farFactor`). Levels only change when a seed or chunk
 * crosses the distance, so the caches keep working while the camera moves a little.
 */

import { foldWorld, latestS, withoutWear } from "./fold";
import { NATURE_KIND, burialOf, natureHistory, naturePointLoad, naturePoints, reclaimPoints, type NaturePoints } from "./natureHistory";
import type { NatureConfig } from "./nature";
import { PART_KINDS, RECIPES, boxesOfSeed, halfHeight, occupiedSlots, seedsFromSnapshot, wearParts, type Box, type BoxConfig, type PartKind, type Seed } from "./seeds";
import type { FoldConfig, PEvent } from "./types";

/** Instance capacity per part kind (what the view allocates). */
export const PART_CAPACITY: Record<PartKind, number> = { mass: 400000, slab: 12000, drip: 60000, column: 16000, beam: 12000, brace: 12000, plinth: 2000, basement: 2000, pile: 10000 };
/** Boxes that get edge lines at most. */
export const EDGE_CAP = 40000;
/** Slots per cached chunk of vegetation points. */
export const NATURE_CHUNK = 10;

/** sRGB hex pairs (low, high shade) per NATURE_KIND. */
export const NATURE_PALETTE: [string, string][] = [
  ["#7a6248", "#a38a6a"], // soil
  ["#5f8a3c", "#9cbf5a"], // grass
  ["#2f5a2c", "#4f7d3a"], // herb
  ["#b59a52", "#d4bd78"], // dry leaves
  ["#8a9a3a", "#b8bb52"], // moss / lichen (reclaim)
  ["#24402a", "#3b5d34"], // woody growth (reclaim)
  ["#3e3630", "#5a4e44"], // buried under concrete
];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}
const PALETTE_LIN = NATURE_PALETTE.map(([a, b]) => [hexLinear(a), hexLinear(b)] as const);

/** Linear-RGB vertex colours of nature points (palette by kind, lerped by shade). */
export function natureColors(np: Pick<NaturePoints, "count" | "kind" | "shade">): Float32Array {
  const col = new Float32Array(np.count * 3);
  for (let i = 0; i < np.count; i++) {
    const [lo, hi] = PALETTE_LIN[np.kind[i]] ?? PALETTE_LIN[NATURE_KIND.grass];
    const t = np.shade[i];
    col[i * 3] = lo[0] + (hi[0] - lo[0]) * t;
    col[i * 3 + 1] = lo[1] + (hi[1] - lo[1]) * t;
    col[i * 3 + 2] = lo[2] + (hi[2] - lo[2]) * t;
  }
  return col;
}

/**
 * Column-major 4×4 of position · rotation (Euler "YZX" with x = 0: yaw about Y after tilt about Z) · scale —
 * exactly what three.js Object3D.updateMatrix gives (tested against it).
 */
export function writeMatrix(out: Float32Array, o: number, b: Box): void {
  const cy = Math.cos(b.yaw ?? 0), sy = Math.sin(b.yaw ?? 0);
  const cz = Math.cos(b.tilt ?? 0), sz = Math.sin(b.tilt ?? 0);
  // R = Ry · Rz
  out[o] = cy * cz * b.sx;
  out[o + 1] = sz * b.sx;
  out[o + 2] = -sy * cz * b.sx;
  out[o + 3] = 0;
  out[o + 4] = -cy * sz * b.sy;
  out[o + 5] = cz * b.sy;
  out[o + 6] = sy * sz * b.sy;
  out[o + 7] = 0;
  out[o + 8] = sy * b.sz;
  out[o + 9] = 0;
  out[o + 10] = cy * b.sz;
  out[o + 11] = 0;
  out[o + 12] = b.x;
  out[o + 13] = b.y;
  out[o + 14] = b.z;
  out[o + 15] = 1;
}

const EDGE: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export interface LodConfig {
  /** Camera position (world). */
  camera: [number, number, number];
  /** Seeds and vegetation chunks within this distance get full detail. */
  near: number;
  /** Least share of vegetation points far away. */
  farFactor: number;
}

export interface PartsInput {
  fold: FoldConfig;
  box: BoxConfig;
  wear: boolean;
  edges: boolean;
  lod: LodConfig;
}

export interface PartsResult {
  counts: Record<PartKind, number>;
  /** 16 floats per instance, per kind (only `counts[kind]` used). */
  matrices: Record<PartKind, Float32Array>;
  /** 3 floats per instance (grey tone), per kind. */
  colors: Record<PartKind, Float32Array>;
  edges: Float32Array | null;
  seeds: number;
  parts: number;
  /** Seeds built without slats (far). */
  farSeeds: number;
  t: number;
  top: number;
  minX: number;
  minZ: number;
}

export interface NatureInput {
  fold: FoldConfig;
  box: BoxConfig;
  nature: NatureConfig;
  perSlot: number;
  /** Slots around `focusK` that are built. */
  window: number;
  focusK: number;
  margin: number;
  budget: number;
  burialSlots: number;
  lod: LodConfig;
}

export interface ReclaimInput {
  tauReclaimYears: number;
  perArea: number;
  unit: number;
}

export interface PointsResult {
  position: Float32Array;
  color: Float32Array;
}

const dist3 = (a: [number, number, number], x: number, y: number, z: number) => Math.hypot(a[0] - x, a[1] - y, a[2] - z);

export class SpaceModel {
  private events: PEvent[] = [];
  private ids = new Set<string>();
  private t = 0;
  private version = 0;
  private seeds: Seed[] = [];
  private seedsKey = "";
  private partCache = new Map<number, { key: string; parts: Box[] }>();
  private partsSig = "";
  private built: Box[] = [];
  private worn: Box[] = [];
  private natureSig = "";
  private chunks = new Map<number, { key: string; pos: Float32Array; col: Float32Array }>();
  private reclaimSig = "";

  /** Adds events (duplicates by id are ignored). */
  add(list: readonly PEvent[]): void {
    for (const e of list) {
      if (this.ids.has(e.id)) continue;
      this.ids.add(e.id);
      this.events.push(e);
      if (e.s > this.t) this.t = e.s;
      this.version++;
    }
  }

  /** Forgets every event (the world was cleared). */
  reset(): void {
    this.events = [];
    this.ids.clear();
    this.t = 0;
    this.version++;
    this.partCache.clear();
    this.chunks.clear();
  }

  get latest(): number {
    return this.t;
  }

  private ensureSeeds(fold: FoldConfig): Seed[] {
    const key = `${this.version}:${JSON.stringify(fold)}`;
    if (key !== this.seedsKey) {
      this.seedsKey = key;
      // fold without wear (this view is history); wear is applied to the parts instead
      this.seeds = this.events.length ? seedsFromSnapshot(foldWorld(this.events, latestS(this.events), withoutWear(fold))) : [];
    }
    return this.seeds;
  }

  /** The parts, as per-kind instance buffers; null when nothing changed since the last call. */
  computeParts(input: PartsInput): PartsResult | null {
    const { box, lod } = input;
    const seeds = this.ensureSeeds(input.fold);
    const t = this.t;
    /** The same config without slat bundles, for far seeds. */
    const solid = (s: Seed): BoxConfig => {
      const rc = box.recipe ?? RECIPES[s.material];
      return { ...box, recipe: { ...rc, slat: { ...rc.slat, enabled: false } } };
    };
    const cfgKey = JSON.stringify(box);

    // level per seed: far seeds are built without slats
    let lodSig = 0;
    const far = new Set<number>();
    for (const s of seeds) {
      const yMid = ((s.t0 + s.t1) / 2 / box.secPerUnit) * box.unit;
      if (dist3(lod.camera, s.x, yMid, s.z) > lod.near) {
        far.add(s.id);
        lodSig = (lodSig * 31 + s.id) % 1e9;
      }
    }
    const sig = `${this.seedsKey}:${cfgKey}:${input.wear ? Math.floor(t) : "-"}:${far.size}:${lodSig}:${input.edges}`;
    if (sig === this.partsSig) return null;
    this.partsSig = sig;

    const order = [...seeds].sort((a, b) => a.t0 - b.t0 || a.id - b.id);
    const built: Box[] = [];
    const live = new Set<number>();
    for (const s of order) {
      const isFar = far.has(s.id);
      const slots = occupiedSlots(s, box);
      const key = `${s.t0}:${slots[0]}:${slots[slots.length - 1]}:${slots.length}:${s.spans?.length ?? 0}:${s.mass}:${isFar}:${cfgKey}`;
      let hit = this.partCache.get(s.id);
      if (!hit || hit.key !== key) {
        hit = { key, parts: boxesOfSeed(s, isFar ? solid(s) : box) };
        this.partCache.set(s.id, hit);
      }
      live.add(s.id);
      for (const b of hit.parts) built.push(b);
    }
    for (const id of this.partCache.keys()) if (!live.has(id)) this.partCache.delete(id);
    const worn = input.wear ? wearParts(built, seeds, t, input.fold) : built;
    this.built = built;
    this.worn = worn;

    const counts = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    for (const b of worn) counts[b.kind] = Math.min(PART_CAPACITY[b.kind], counts[b.kind] + 1);
    const matrices = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 16)])) as Record<PartKind, Float32Array>;
    const colors = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 3)])) as Record<PartKind, Float32Array>;
    const fill = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    const edgeCount = input.edges ? Math.min(EDGE_CAP, worn.length) : 0;
    const edges = input.edges ? new Float32Array(edgeCount * 72) : null;
    let ei = 0;
    const m = new Float32Array(16);
    let minX = Infinity, minZ = Infinity, top = 0;
    for (const b of worn) {
      const k = b.kind;
      const i = fill[k];
      if (i >= counts[k]) continue;
      fill[k]++;
      writeMatrix(matrices[k], i * 16, b);
      const g = 0.86 + 0.14 * b.tone;
      colors[k][i * 3] = g;
      colors[k][i * 3 + 1] = g;
      colors[k][i * 3 + 2] = g;
      minX = Math.min(minX, b.x - b.sx / 2);
      minZ = Math.min(minZ, b.z - b.sz / 2);
      top = Math.max(top, b.y + halfHeight(b));
      if (!edges || k === "pile" || ei >= edgeCount) continue;
      writeMatrix(m, 0, b);
      for (let e = 0; e < 12; e++) {
        for (let c = 0; c < 2; c++) {
          const v = EDGE[e][c];
          const lx = (v & 1) - 0.5, ly = ((v >> 2) & 1) - 0.5, lz = ((v >> 1) & 1) - 0.5;
          const o = ei * 72 + e * 6 + c * 3;
          edges[o] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
          edges[o + 1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
          edges[o + 2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        }
      }
      ei++;
    }
    return {
      counts: fill,
      matrices,
      colors,
      edges: edges ? edges.subarray(0, ei * 72) : null,
      seeds: seeds.length,
      parts: worn.length,
      farSeeds: far.size,
      t,
      top,
      minX,
      minZ,
    };
  }

  /** The vegetation points around the camera's time; null when nothing changed. */
  computeNature(input: NatureInput): PointsResult | null {
    const { box, lod } = input;
    const seeds = this.ensureSeeds(input.fold);
    const spu = box.secPerUnit;
    const kNow = Math.floor(this.t / spu);
    const kFocus = Math.floor(Math.max(0, input.focusK) / NATURE_CHUNK) * NATURE_CHUNK;
    const k0 = Math.max(0, kFocus - input.window);
    const k1 = Math.min(kNow, kFocus + input.window);
    // vegetation level per chunk (quantised), from the camera's distance to the chunk's middle
    const levels: number[] = [];
    const firstChunk = Math.floor(k0 / NATURE_CHUNK) * NATURE_CHUNK;
    for (let c0 = firstChunk; c0 <= k1; c0 += NATURE_CHUNK) {
      const y = (c0 + NATURE_CHUNK / 2) * box.unit;
      const d = Math.abs(lod.camera[1] - y);
      const f = d <= lod.near ? 1 : Math.max(lod.farFactor, lod.near / d);
      levels.push(Math.round(f * 4) / 4);
    }
    const sig = `${this.seedsKey}:${JSON.stringify([box.secPerUnit, box.unit, input.nature, input.perSlot, input.margin, input.budget, input.burialSlots])}:${k0}:${k1}:${levels.join(",")}`;
    if (sig === this.natureSig) return null;
    this.natureSig = sig;
    if (k1 < k0 || !this.events.length) return { position: new Float32Array(0), color: new Float32Array(0) };

    const h = natureHistory({ events: this.events, seeds, secPerUnit: spu, k0, k1, margin: input.margin, nature: input.nature, fold: input.fold });
    const load = naturePointLoad(h, k0, k1, input.perSlot);
    const scale = load > input.budget ? input.budget / load : 1;
    const buried = input.burialSlots > 0 ? burialOf(seeds, spu, input.burialSlots) : undefined;
    let burySig = input.burialSlots;
    for (const sd of seeds) burySig += sd.t0 + (sd.id % 89);

    const parts: { pos: Float32Array; col: Float32Array }[] = [];
    const keep = new Set<number>();
    let li = 0;
    for (let c0 = firstChunk; c0 <= k1; c0 += NATURE_CHUNK, li++) {
      const a = Math.max(c0, k0);
      const b = Math.min(c0 + NATURE_CHUNK - 1, k1);
      const per = input.perSlot * scale * levels[li];
      const off = (a - h.k0) * h.nx * h.nz;
      let sum = 0;
      for (let i = off; i < (b - h.k0 + 1) * h.nx * h.nz; i++) sum += h.V[i] * (i - off + 1);
      const key = `${a}:${b}:${h.x0}:${h.z0}:${h.nx}:${h.nz}:${sum.toFixed(4)}:${per.toFixed(4)}:${box.unit}:${burySig}`;
      keep.add(c0);
      let ch = this.chunks.get(c0);
      if (!ch || ch.key !== key) {
        const np = naturePoints(h, a, b, { unit: box.unit, perSlot: per, buried });
        ch = { key, pos: np.position, col: natureColors(np) };
        this.chunks.set(c0, ch);
      }
      parts.push(ch);
    }
    for (const c of this.chunks.keys()) if (!keep.has(c)) this.chunks.delete(c);
    return concat(parts);
  }

  /** Plants on the ruins of the last computed parts; null when nothing changed. */
  computeReclaim(input: ReclaimInput): PointsResult | null {
    const sig = `${this.partsSig}:${input.tauReclaimYears}:${input.perArea}:${input.unit}`;
    if (sig === this.reclaimSig) return null;
    this.reclaimSig = sig;
    const np = reclaimPoints(this.built, this.worn, this.seeds, this.t, input);
    return { position: np.position, color: natureColors(np) };
  }
}

function concat(parts: { pos: Float32Array; col: Float32Array }[]): PointsResult {
  let n = 0;
  for (const p of parts) n += p.pos.length;
  const position = new Float32Array(n);
  const color = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    position.set(p.pos, o);
    color.set(p.col, o);
    o += p.pos.length;
  }
  return { position, color };
}

/** What the view posts to the space worker. */
export type SpaceRequest =
  | { type: "events"; add: PEvent[]; reset?: boolean }
  | { type: "compute"; id: number; parts?: PartsInput; nature?: NatureInput; reclaim?: ReclaimInput };

/** What the space worker posts back for a compute request. */
export interface SpaceResponse {
  type: "result";
  id: number;
  /** undefined = not asked; null = unchanged. */
  parts?: PartsResult | null;
  nature?: PointsResult | null;
  reclaim?: PointsResult | null;
  ms: number;
}

/**
 * One request against a model (the worker's message handler, also used on the main thread as a fallback).
 * Returns the response and the buffers to transfer, or null for an events message.
 */
export function handleSpaceRequest(model: SpaceModel, m: SpaceRequest): { out: SpaceResponse; transfer: ArrayBuffer[] } | null {
  if (m.type === "events") {
    if (m.reset) model.reset();
    model.add(m.add);
    return null;
  }
  const t0 = performance.now();
  const out: SpaceResponse = { type: "result", id: m.id, ms: 0 };
  const transfer = new Set<ArrayBuffer>();
  if (m.parts) {
    out.parts = model.computeParts(m.parts);
    if (out.parts) {
      for (const a of Object.values(out.parts.matrices)) transfer.add(a.buffer as ArrayBuffer);
      for (const a of Object.values(out.parts.colors)) transfer.add(a.buffer as ArrayBuffer);
      if (out.parts.edges) transfer.add(out.parts.edges.buffer as ArrayBuffer);
    }
  }
  if (m.nature) {
    out.nature = model.computeNature(m.nature);
    if (out.nature) transfer.add(out.nature.position.buffer as ArrayBuffer).add(out.nature.color.buffer as ArrayBuffer);
  }
  if (m.reclaim) {
    out.reclaim = model.computeReclaim(m.reclaim);
    if (out.reclaim) transfer.add(out.reclaim.position.buffer as ArrayBuffer).add(out.reclaim.color.buffer as ArrayBuffer);
  }
  out.ms = performance.now() - t0;
  return { out, transfer: [...transfer] };
}
