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
import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { accretionShare, fuseChunk, fusePad, fusedShare, gatheringShare, isSkeleton, mergeMeshes, type FuseConfig, type FuseMesh } from "./fuse";
import { NATURE_KIND, burialOf, natureAt, natureHistory, type NatureHistory, naturePointLoad, naturePoints, reclaimPoints, type NaturePoints } from "./natureHistory";
import type { NatureConfig } from "./nature";
import { PART_KINDS, RECIPES, boxesOfSeed, gatherAmount, gatherDensity, halfHeight, rotOnsetSlots, occupiedSlots, partHash, seedsFromSnapshot, wearModel, wearParts, type Box, type BoxConfig, type PartKind, type Seed } from "./seeds";
import type { FoldConfig, PEvent } from "./types";
import { waterDistance, waterField, waterLinks, type WaterConfig, type WaterLink } from "./water";

const CELL = CELL_SIZE;
const STEEL_KINDS: ReadonlySet<string> = new Set(["column", "beam", "brace"]);

/** Instance capacity per part kind (what the view allocates). */
export const PART_CAPACITY: Record<PartKind, number> = { mass: 400000, slab: 12000, drip: 60000, column: 16000, beam: 12000, brace: 12000, plinth: 2000, basement: 2000, pile: 10000 };
/** Boxes that get edge lines at most. */
export const EDGE_CAP = 40000;
/** Slots per cached chunk of vegetation points and of the fused mesh. */
export const NATURE_CHUNK = 10;
/** Fused chunks (re)built per request at most; the rest follow on the next requests. */
export const FUSE_NEW_PER_CALL = 2;

/** sRGB hex pairs (low, high shade) per NATURE_KIND. */
export const NATURE_PALETTE: [string, string][] = [
  ["#7a6248", "#a38a6a"], // soil
  ["#5f8a3c", "#9cbf5a"], // grass
  ["#2f5a2c", "#4f7d3a"], // herb
  ["#b59a52", "#d4bd78"], // dry leaves
  ["#8a9a3a", "#b8bb52"], // moss / lichen (reclaim)
  ["#24402a", "#3b5d34"], // woody growth (reclaim)
  ["#3e3630", "#5a4e44"], // buried under concrete
  ["#4b3a28", "#6b5136"], // humus (aged vegetation)
  ["#26221f", "#3a332c"], // peat / compressed (old sediment)
  ["#4a4a4a", "#7a7a7a"], // trodden ground at a path's rim (a human trace: grey)
  ["#0b4f57", "#2a9c9a"], // wetland vegetation along waterways (blue-green: reads as water)
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

/** How the view weathers things (see WearConfig): per-slot ages, speed, relative lives of steel and concrete. */
export interface WeatherConfig {
  /** Each part (and vegetation slot) ages from its own slot — lower layers are older. */
  strata: boolean;
  /** Multiplies every model-years age. */
  timeScale: number;
  steelLife: number;
  concreteLife: number;
  /** Model years after which (1 − 1/e of) a vegetation slot has turned to humus / peat. */
  tauSedimentYears: number;
  /** A part covered by this many more slots of its structure wears `buriedSlow` × slower (0 = off). */
  coverSlots: number;
  buriedSlow: number;
  /** Exposed parts wear × (1 + natureAccel · vegetation density) (0 = off). */
  natureAccel: number;
  /** Every part's age × (1 ± this), fixed per part; vegetation sediment shares vary by half of it. */
  ageJitter: number;
  /** Slots that must pile up above a layer before anything weathers, buries, fuses or turns to sediment there. */
  /** Vegetation gathers from this many slots below the present, thickening over `gatherRise` slots… */
  gatherStart: number;
  gatherRise: number;
  /** …and a part rots once it has collected this much (gathered density × slots buried together). */
  rotDose: number;
}

export const DEFAULT_WEATHER: WeatherConfig = { strata: true, timeScale: 0.06, steelLife: 2, concreteLife: 1, tauSedimentYears: 600, coverSlots: 8, buriedSlow: 4, natureAccel: 1, ageJitter: 0.5, gatherStart: 2, gatherRise: 8, rotDose: 12 };

/** The sediment clock of the view at its present (per slot, so it moves once a slot); null without strata. */
function sedimentOf(t: number, box: BoxConfig, w: WeatherConfig) {
  if (!w.strata) return null;
  const tQ = Math.floor(t / box.secPerUnit) * box.secPerUnit;
  return { tNow: tQ, secPerUnit: box.secPerUnit, timeScale: w.timeScale, tauYears: w.tauSedimentYears, graceSlots: rotOnsetSlots(w) };
}

export interface PartsInput {
  fold: FoldConfig;
  box: BoxConfig;
  wear: boolean;
  weather: WeatherConfig;
  /** Layers old enough are fused into one mesh (computeFuse); their parts dissolve here. */
  fuse: FuseConfig;
  /** Waterways between buildings the same people built (water.ts); they hasten the corrosion near them. */
  water: WaterConfig;
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
  /** Waterways flowing now. */
  links: number;
  t: number;
  top: number;
  minX: number;
  minZ: number;
}

export interface NatureInput {
  fold: FoldConfig;
  box: BoxConfig;
  weather: WeatherConfig;
  fuse: FuseConfig;
  /** Desire paths drawn as holes in the vegetation with a heaped rim (null = off). */
  paths?: { hole: number; berm: number } | null;
  nature: NatureConfig;
  perSlot: number;
  /** Slots around `focusK` that are built. */
  window: number;
  focusK: number;
  margin: number;
  budget: number;
  burialSlots: number;
  lod: LodConfig;
  /** Vegetation volume: density below which a cell shows no points (naturePoints.cut); 0 / absent = all. */
  densityCut?: number;
  /**
   * …raised far away by this × (1 − the chunk's LOD level), instead of thinning every cell evenly: from afar only
   * the dense vegetation remains. 0 / absent = the even thinning (LodConfig.farFactor).
   */
  farCut?: number;
}

export interface ReclaimInput {
  tauReclaimYears: number;
  perArea: number;
  unit: number;
  secPerUnit?: number;
  timeScale?: number;
  /** With wear and this, points GATHER on parts by their corrosion (fuse.gatheringShare) instead of abandonment. */
  fuse?: FuseConfig;
}

export interface FuseInput {
  box: BoxConfig;
  weather: WeatherConfig;
  fuse: FuseConfig;
  /** Model years after which (1 − 1/e of) a part is overgrown (accretion). */
  tauReclaimYears: number;
  /** The slot the camera looks at: chunks near it are built first (default: the present). */
  focusK?: number;
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
  /** The weathering of the last computed parts (null without wear). */
  private wear: { age: (b: Box) => number; survival: (b: Box) => number } | null = null;
  /** How much vegetation has gathered on a part (strata only): it gathers before (and so causes) its rot. */
  private gatherOf: ((b: Box) => number) | null = null;
  private history: NatureHistory | null = null;
  /** The waterways of the last computed parts, and their nearness per (cell, slot). */
  private links: WaterLink[] = [];
  private nearWater: ((ix: number, iz: number, k: number) => number) | null = null;
  private waterCfg: WaterConfig | null = null;
  private fuseSig = "";
  private fuseChunks = new Map<number, { key: string; mesh: FuseMesh }>();
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
    const sig = `${this.seedsKey}:${cfgKey}:${input.wear ? Math.floor(t) : "-"}:${JSON.stringify(input.weather)}:${JSON.stringify(input.fuse)}:${JSON.stringify(input.water)}:${far.size}:${lodSig}:${input.edges}`;
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
    const w = input.weather;
    // vegetation around a part: the last vegetation history (if the view draws vegetation), at the part's cell and slot
    const h = this.history;
    const veg = h ? (b: Box) => natureAt(h, Math.floor(b.x / CELL), Math.floor(b.z / CELL), b.slot) ?? 0 : undefined;
    // waterways between buildings the same people built: nearness per (cell, slot) over the whole history
    this.waterCfg = input.water;
    this.links = waterLinks(seeds, input.water, t);
    this.nearWater = this.links.length ? waterField(this.links, 0, Math.floor(t / box.secPerUnit), box.secPerUnit, input.water) : null;
    const near = this.nearWater;
    const water = near && input.water.corrode > 0 ? (b: Box) => near(Math.floor(b.x / CELL), Math.floor(b.z / CELL), b.slot) * input.water.corrode : undefined;
    const wearCfg = {
      ...input.fold,
      secPerUnit: w.strata ? box.secPerUnit : undefined,
      timeScale: w.timeScale,
      steelLife: w.steelLife,
      concreteLife: w.concreteLife,
      coverSlots: w.coverSlots,
      buriedSlow: w.buriedSlow,
      natureAccel: w.natureAccel,
      ageJitter: w.ageJitter,
      ...(w.strata ? { gatherStart: w.gatherStart, gatherRise: w.gatherRise, rotDose: w.rotDose } : {}),
      veg,
      water,
    };
    const worn = input.wear ? wearParts(built, seeds, t, wearCfg) : built;
    // the weathering of every part: what it turns into (fuse.ts) follows it, on the structure itself
    this.wear = input.wear ? wearModel(seeds, t, wearCfg) : null;
    // vegetation gathering on a part (0 … 1), by its depth below the present and the density around it
    const kNow = t / box.secPerUnit;
    this.gatherOf = w.strata ? (b: Box) => gatherAmount(kNow - (b.slot + 1), wearCfg) * gatherDensity(b, wearCfg) : null;
    this.built = built;
    this.worn = worn;
    const survival = this.wear?.survival;
    // a part being fused is absorbed into the mass, little by little (by a fixed hash): the mass takes its place.
    // Steel stays (it sticks out of the mass), and so does the skeleton until late (its form kept inside the mass).
    const fu = input.fuse;
    const absorbed = (b: Box) => {
      if (!survival || !fu.enabled || !w.strata || STEEL_KINDS.has(b.kind)) return false;
      const d = 1 - survival(b);
      if (isSkeleton(b, d, fu)) return false;
      const f = fusedShare(d, fu);
      return f > 0 && partHash(b) < Math.min(1, f * 1.6);
    };
    const shown = worn.filter((b) => !absorbed(b));

    const counts = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    for (const b of shown) counts[b.kind] = Math.min(PART_CAPACITY[b.kind], counts[b.kind] + 1);
    const matrices = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 16)])) as Record<PartKind, Float32Array>;
    const colors = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 3)])) as Record<PartKind, Float32Array>;
    const fill = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    const edgeCount = input.edges ? Math.min(EDGE_CAP, shown.length) : 0;
    const edges = input.edges ? new Float32Array(edgeCount * 72) : null;
    let ei = 0;
    const m = new Float32Array(16);
    let minX = Infinity, minZ = Infinity, top = 0;
    for (const b of shown) {
      const k = b.kind;
      const i = fill[k];
      if (i >= counts[k]) continue;
      fill[k]++;
      writeMatrix(matrices[k], i * 16, b);
      // weathering shows on the part itself: darker as it decays — grey only (human traces carry no colour)
      const d = survival ? 1 - survival(b) : 0;
      const g = (0.86 + 0.14 * b.tone) * (1 - 0.4 * d);
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
      parts: shown.length,
      farSeeds: far.size,
      links: this.links.length,
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
    // sediment changes with time: rebuilt once per slot of the present
    const tQ = Math.floor(this.t / spu) * spu;
    const sediment = input.weather.strata
      ? { tNow: tQ, secPerUnit: spu, timeScale: input.weather.timeScale, tauYears: input.weather.tauSedimentYears, jitter: input.weather.ageJitter * 0.5, graceSlots: rotOnsetSlots(input.weather) }
      : undefined;
    const sedKey = sediment ? `${tQ}:${sediment.timeScale}:${sediment.tauYears}` : "-";
    // LIVING vs FOSSIL: vegetation lives only in the layers whose concrete has not begun to fuse. A layer's typical
    // corrosion (a mid-thick part, exposed) is taken from its age; the points thin out as it nears fuseOnset and
    // there are none below. The most recent layers have the most.
    const fz = input.fuse;
    const living =
      sediment && fz.enabled
        ? (k: number) => {
            const laid = Math.min(tQ, (k + 1 + rotOnsetSlots(input.weather)) * spu);
            const A = Math.max(0, geoYears(tQ) - geoYears(laid)) * input.weather.timeScale;
            const d = 1 - Math.exp(-A / (input.fold.tauSlabYears * 0.75 * input.weather.concreteLife));
            const t = Math.min(1, Math.max(0, (d - fz.fuseOnset * 0.4) / (fz.fuseOnset * 0.6)));
            return 1 - t * t * (3 - 2 * t);
          }
        : undefined;
    // the parts' corrosion decides where vegetation points give way to mass: rebuild when the parts change
    const fuseKey = `${JSON.stringify(input.fuse)}:${JSON.stringify(input.paths ?? null)}:${this.partsSig}:${this.links.length}`;
    const sig = `${this.seedsKey}:${JSON.stringify([box.secPerUnit, box.unit, input.nature, input.perSlot, input.margin, input.budget, input.burialSlots])}:${sedKey}:${fuseKey}:${k0}:${k1}:${levels.join(",")}`;
    if (sig === this.natureSig) return null;
    this.natureSig = sig;
    if (k1 < k0 || !this.events.length) return { position: new Float32Array(0), color: new Float32Array(0) };

    const near = this.nearWater;
    const wc = this.waterCfg;
    const waterBoost = near && wc && wc.vegBoost > 0 ? (ix: number, iz: number, k: number) => near(ix, iz, k) * wc.vegBoost : undefined;
    // the water is not drawn: the vegetation along it is wetland (its colour) and denser (waterBoost)
    // the channel itself stays clear; its banks are wetland (per point, from the exact distance to the course)
    const water =
      wc && this.links.length
        ? { dist: waterDistance(this.links, k0, k1, spu, wc), half: wc.channel / 2, radius: wc.radius, share: wc.wetShare }
        : undefined;
    const h = natureHistory({ events: this.events, seeds, secPerUnit: spu, k0, k1, margin: input.margin, nature: input.nature, fold: input.fold, waterBoost });
    this.history = h;
    // where mass has formed (growths or fusion), the vegetation is part of it: no points there
    const massed = new Set<string>();
    const wm = this.wear;
    if (wm && input.fuse.enabled) {
      for (const b of this.built) {
        if (b.slot < k0 - 1 || b.slot > k1 + 1 || accretionShare(1 - wm.survival(b), input.fuse) <= 0.05) continue;
        for (let ix = Math.floor((b.x - b.sx / 2) / CELL); ix <= Math.floor((b.x + b.sx / 2) / CELL); ix++) {
          for (let iz = Math.floor((b.z - b.sz / 2) / CELL); iz <= Math.floor((b.z + b.sz / 2) / CELL); iz++) {
            for (let k = b.slot - 1; k <= b.slot + 1; k++) massed.add(`${ix},${iz},${k}`);
          }
        }
      }
    }
    const thinCell = massed.size ? (ix: number, iz: number, k: number) => (massed.has(`${ix},${iz},${k}`) ? 0 : 1) : undefined;
    let massSig = massed.size;
    for (const key of massed) massSig = (massSig * 31 + key.length + key.charCodeAt(0)) % 1e9;
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
      const farCut = input.farCut ?? 0;
      const level = levels[li];
      // far away: a higher density floor (only the dense remains) instead of fewer points everywhere
      const per = input.perSlot * scale * (farCut > 0 ? 0.5 + 0.5 * level : level);
      const cut = Math.min(0.95, (input.densityCut ?? 0) + farCut * (1 - level));
      const off = (a - h.k0) * h.nx * h.nz;
      let sum = 0;
      for (let i = off; i < (b - h.k0 + 1) * h.nx * h.nz; i++) sum += h.V[i] * (i - off + 1);
      const key = `${a}:${b}:${h.x0}:${h.z0}:${h.nx}:${h.nz}:${sum.toFixed(4)}:${per.toFixed(4)}:${cut.toFixed(3)}:${box.unit}:${burySig}:${sedKey}:${fuseKey}:${massSig}`;
      keep.add(c0);
      let ch = this.chunks.get(c0);
      if (!ch || ch.key !== key) {
        const np = naturePoints(h, a, b, { unit: box.unit, perSlot: per, cut, buried, sediment, thinCell, timeJitter: box.timeJitter, paths: input.paths ?? undefined, water, thin: living });
        ch = { key, pos: np.position, col: natureColors(np) };
        this.chunks.set(c0, ch);
      }
      parts.push(ch);
    }
    for (const c of this.chunks.keys()) if (!keep.has(c)) this.chunks.delete(c);
    return concat(parts);
  }

  /**
   * The fused mass of the old layers (fuse.ts), built in chunks of NATURE_CHUNK slots within the vegetation window
   * (or all slots without vegetation), at most FUSE_NEW_PER_CALL new chunks per call; null when nothing changed.
   */
  computeFuse(input: FuseInput): FuseMesh | null {
    const { box, fuse } = input;
    const sed = sedimentOf(this.t, box, input.weather);
    const h = this.history;
    const wm = this.wear;
    const sig = `${this.partsSig}:${this.natureSig}:${JSON.stringify(input)}`;
    if (sig === this.fuseSig) return null;
    if (!sed || !wm || !fuse.enabled || !this.built.length) {
      this.fuseSig = sig;
      this.fuseChunks.clear();
      return mergeMeshes([]);
    }
    const u = box.unit;
    const kNow = Math.floor(this.t / box.secPerUnit);
    const kA = h ? h.k0 : 0;
    const kB = h ? h.k0 + h.nk - 1 : kNow;
    // extent: the vegetation's, or the parts' (cells)
    let x0: number, z0: number, nx: number, nz: number;
    if (h && h.nx > 0) {
      ({ x0, z0, nx, nz } = h);
    } else {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (const p of this.built) {
        a = Math.min(a, p.x - p.sx / 2);
        b = Math.max(b, p.x + p.sx / 2);
        c = Math.min(c, p.z - p.sz / 2);
        d = Math.max(d, p.z + p.sz / 2);
      }
      x0 = Math.floor(a / CELL) - 2;
      z0 = Math.floor(c / CELL) - 2;
      nx = Math.ceil(b / CELL) + 2 - x0;
      nz = Math.ceil(d / CELL) + 2 - z0;
    }
    // every built part with its decay, its reclaim and whether it still stands (quantised: the cache keys follow)
    const standing = new Set(this.worn);
    const q20 = (v: number) => Math.round(v * 20) / 20;
    type P = { b: Box; d: number; up: boolean; sk: boolean };
    const bySlot = new Map<number, P[]>();
    for (const b of this.built) {
      if (STEEL_KINDS.has(b.kind) || b.kind === "drip") continue; // too thin to carry mass or growths
      const d = q20(1 - wm.survival(b));
      if (fusedShare(d, fuse) <= 0 && accretionShare(d, fuse) <= 0.01) continue; // not corroding yet: nothing grows on it
      const e: P = { b, d, up: standing.has(b), sk: isSkeleton(b, d, fuse) };
      const l = bySlot.get(b.slot);
      if (l) l.push(e);
      else bySlot.set(b.slot, [e]);
    }
    const padSlots = Math.ceil((fusePad(fuse).above * fuse.voxel + fuse.accDepth) / u) + 1;
    // the age clock in the keys moves once per chunk of slots (it only tints and pits), not every slot
    const clockKey = Math.floor(sed.tNow / (box.secPerUnit * NATURE_CHUNK));
    type Want = { c0: number; c1: number; ps: P[]; key: string };
    const wants: Want[] = [];
    for (let c0 = Math.floor(kA / NATURE_CHUNK) * NATURE_CHUNK; c0 <= kB; c0 += NATURE_CHUNK) {
      const c1 = c0 + NATURE_CHUNK - 1;
      const ps: P[] = [];
      let sum = 0;
      // parts reaching into the chunk ± padding (masses hang ≤ 3 slots, foundations ≤ 8 below their slot)
      for (let k = c0 - padSlots - 3; k <= c1 + padSlots + 8; k++) {
        for (const e of bySlot.get(k) ?? []) {
          ps.push(e);
          sum += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.d * 13 + (e.up ? 19 : 0) + (e.sk ? 23 : 0);
        }
      }
      if (!ps.length) continue;
      let vs = 0;
      if (h) for (let k = Math.max(c0 - padSlots, h.k0); k <= Math.min(c1 + padSlots, h.k0 + h.nk - 1); k++) {
        const off = (k - h.k0) * h.nx * h.nz;
        for (let i = 0; i < h.nx * h.nz; i++) vs += h.V[off + i] * ((i % 13) + 1);
      }
      wants.push({ c0, c1, ps, key: `${ps.length}:${sum.toFixed(3)}:${vs.toFixed(3)}:${clockKey}:${JSON.stringify(fuse)}:${input.tauReclaimYears}:${x0},${z0},${nx},${nz}` });
    }
    // build order: chunks with no mesh yet first, then stale ones; each nearest to where the camera looks first
    // (oldest-first starved the upper chunks — where the buildings are — while the lower ones kept changing)
    const focus = input.focusK ?? kNow;
    const dist = (w: Want) => Math.abs((w.c0 + w.c1) / 2 - focus);
    const todo = wants.filter((w) => this.fuseChunks.get(w.c0)?.key !== w.key);
    todo.sort((a, b) => Number(this.fuseChunks.has(a.c0)) - Number(this.fuseChunks.has(b.c0)) || dist(a) - dist(b));
    for (const w of todo.slice(0, FUSE_NEW_PER_CALL)) {
      const mesh = fuseChunk({
        parts: w.ps.map((e) => e.b),
        decay: w.ps.map((e) => e.d),
        standing: w.ps.map((e) => e.up),
        skeleton: w.ps.map((e) => e.sk),
        history: h,
        k0: w.c0,
        k1: w.c1,
        x0,
        z0,
        nx,
        nz,
        unit: u,
        sediment: sed,
        cfg: fuse,
      });
      this.fuseChunks.set(w.c0, { key: w.key, mesh });
    }
    const pending = todo.length > FUSE_NEW_PER_CALL;
    const out: FuseMesh[] = [];
    const keep = new Set<number>();
    for (const w of wants) {
      keep.add(w.c0);
      const ch = this.fuseChunks.get(w.c0); // fresh, or the stale one until its turn comes
      if (ch) out.push(ch.mesh);
    }
    for (const c of this.fuseChunks.keys()) if (!keep.has(c)) this.fuseChunks.delete(c);
    if (!pending) this.fuseSig = sig;
    return mergeMeshes(out);
  }

  /** Plants on the ruins of the last computed parts; null when nothing changed. */
  computeReclaim(input: ReclaimInput): PointsResult | null {
    const sig = `${this.partsSig}:${JSON.stringify(input)}`;
    if (sig === this.reclaimSig) return null;
    this.reclaimSig = sig;
    const wm = this.wear;
    const fu = input.fuse;
    // plants gather first (their own process, from gatherStart below the present), and the part rots under them
    const pre = this.gatherOf;
    const gathering = wm && fu ? (b: Box) => gatheringShare(1 - wm.survival(b), fu, pre ? pre(b) : 0) : undefined;
    const { fuse: _f, ...cfg } = input;
    void _f;
    const np = reclaimPoints(this.built, this.worn, this.seeds, this.t, { ...cfg, gathering });
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
  | { type: "compute"; id: number; parts?: PartsInput; nature?: NatureInput; reclaim?: ReclaimInput; fuse?: FuseInput };

/** What the space worker posts back for a compute request. */
export interface SpaceResponse {
  type: "result";
  id: number;
  /** undefined = not asked; null = unchanged. */
  parts?: PartsResult | null;
  nature?: PointsResult | null;
  reclaim?: PointsResult | null;
  fuse?: FuseMesh | null;
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
  if (m.fuse) {
    out.fuse = model.computeFuse(m.fuse);
    if (out.fuse) for (const a of [out.fuse.position, out.fuse.normal, out.fuse.color, out.fuse.index]) transfer.add(a.buffer as ArrayBuffer);
  }
  out.ms = performance.now() - t0;
  return { out, transfer: [...transfer] };
}
