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

import { withoutWear } from "./fold";
import { FoldState } from "./foldState";
import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { DensityField, type DensityConfig } from "./density";
import { erodeThreshold, erosion, erosionAt, pipeErosion, placeNoise, type ErodeConfig, type Erosion } from "./erode";
import { FILL_MAX_GAP, FRAME_KINDS, accretionShare, fuseChunk, fusePad, fusedShare, gatheringShare, isSkeleton, mergeMeshes, type FuseConfig, type FuseMesh } from "./fuse";
import { NATURE_KIND, burialOf, natureAt, natureHistory, type NatureHistory, naturePointLoad, naturePoints, reclaimPoints, type NaturePoints } from "./natureHistory";
import type { NatureConfig } from "./nature";
import { ARRIVED, Arrivals } from "./arrive";
import { PART_KINDS, RECIPES, boxesOfSeed, carrySeeds, districtOf, gatherAmount, gatherDensity, halfHeight, rotOnsetSlots, occupiedSlots, partHash, seedsFromSnapshot, survivalFromBasis, wearModel, wearParts, type Box, type BoxConfig, type PartKind, type Seed, type WearBasis, type WearConfig } from "./seeds";
import { bakedKey, clearBaked, loadBaked, saveBaked, type BakedTube } from "./bakeStore";
import { DEFAULT_FOLD, type FoldConfig, type PEvent } from "./types";
import { DEFAULT_FLOW } from "./flow";
import { NO_WALKWAYS, otherLineNear, walkSegments, walkways, type WalkConfig, type WalkLayer, type Walkways } from "./walkways";
import { NO_DRAINAGE, drainage, pipeParts, waterDistance, waterField, type Drainage, type PipeParts, type PipeRun, type WaterConfig } from "./water";

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
/** THE BLOCK: the ways and the pipes are laid again at most this often (ms; the artist, 2026-11-15: "길 연산에 너무 많이 쓴다면 디바운싱 훨 길게 잡아도 됨"), and one call fuses for about this long. */
const SLOW_MS = 30000;
const FUSE_BUDGET_MS = 450;
/** THE BLOCK: a part's age is read in this many steps to `lifeSec` (the steps are the clock's: all parts move at once). */
const AGE_STEPS = 8;

/** sRGB hex pairs (low, high shade) per NATURE_KIND. */
export const NATURE_PALETTE: [string, string][] = [
  ["#7a6248", "#a38a6a"], // soil
  ["#5f8a3c", "#9cbf5a"], // grass
  ["#2f5a2c", "#4f7d3a"], // herb
  ["#b59a52", "#d4bd78"], // dry leaves
  ["#8a9a3a", "#b8bb52"], // moss / lichen (reclaim)
  ["#24402a", "#3b5d34"], // woody growth (reclaim)
  ["#3e3630", "#5a4e44"], // buried under concrete
  ["#3a3a3a", "#525252"], // humus (aged vegetation) — dark grey, no brown (the artist, 2026-10-19)
  ["#222222", "#303030"], // peat / compressed (old sediment) — darker grey
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
  /**
   * Seeds between `near` and this distance get the MIDDLE level: slat bundles thinned (half the slats, at most 16 per
   * mass) and no drips — the texture of the bundles stays, at a fraction of the parts; beyond it, solid masses.
   * Absent = no middle band (near → solid).
   */
  mid?: number;
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
  /** EROSION IN THE BLOCK (erode.ts): by a part's depth below the block's top and how little its place was lived in —
   *  no clock. Only with the density's buildings; absent / null = none. */
  erode?: ErodeConfig | null;
}

export const DEFAULT_WEATHER: WeatherConfig = { strata: true, timeScale: 0.06, steelLife: 2, concreteLife: 1, tauSedimentYears: 600, coverSlots: 8, buriedSlow: 4, natureAccel: 1, ageJitter: 0.5, gatherStart: 2, gatherRise: 8, rotDose: 12 };

/**
 * The typical corrosion (0 … 1) of the parts of slot k at the present tQ — a mid-thick exposed part's, on the parts'
 * own clock (seeds.wearModel), without burial or vegetation: ONE clock for what the layers look like.
 */
export function layerDecayOf(tQ: number, spu: number, w: WeatherConfig, tauSlabYears: number): (k: number) => number {
  const onset = rotOnsetSlots(w);
  const tau = tauSlabYears * 0.75 * w.concreteLife;
  const yNow = geoYears(tQ);
  return (k: number) => {
    const laid = Math.min(tQ, (k + 1 + onset) * spu);
    const A = Math.max(0, yNow - geoYears(laid)) * w.timeScale;
    return 1 - Math.exp(-A / tau);
  };
}

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
  /**
   * STEADY CORROSION (V2, the artist 2026-11-01 evening): the view sends full-detail parts (no LOD) and a vegetation
   * window anchored at the present (not the camera), so the same part has the same corrosion wherever the camera is.
   * The vegetation stays in the clock (its density spreads the rot onset building by building — without it every part
   * fused at the same depth and the band became one flat-topped block); anchored at the present it no longer moves
   * with the camera.
   */
  steady?: boolean;
  weather: WeatherConfig;
  /** Layers old enough are fused into one mesh (computeFuse); their parts dissolve here. */
  fuse: FuseConfig;
  /** Water from the sealed ground (water.ts): open streams hasten the corrosion near them; pipes are drawn. */
  water: WaterConfig;
  /** V2: walkways where the flow of people is sustained (walkways.ts); absent / null = none. */
  walk?: WalkConfig | null;
  edges: boolean;
  lod: LodConfig;
  /** BUILDINGS FROM THE DENSITY OF SPACETIME (density.ts) instead of the fold; absent / null = the fold (as before). */
  density?: DensityConfig | null;
}

export interface PartsResult {
  counts: Record<PartKind, number>;
  /** 16 floats per instance, per kind (only `counts[kind]` used). */
  matrices: Record<PartKind, Float32Array>;
  /** 3 floats per instance (grey tone), per kind. */
  colors: Record<PartKind, Float32Array>;
  /** ARRIVAL (arrive.ts): 2 floats per instance, per kind — when the part was first there (s since `bornEpochMs`,
   *  ARRIVED = always) and where in its slot's order of building it starts (0 … 1). The wall's shader brings it in. */
  born: Record<PartKind, Float32Array>;
  /** The wall clock (Date.now(), ms) the `born` times count from. */
  bornEpochMs: number;
  edges: Float32Array | null;
  seeds: number;
  parts: number;
  /** Seeds built without slats (far). */
  farSeeds: number;
  /** Chunks of slots kept as they were (baked). */
  baked: number;
  /** Waterways flowing now. */
  /** Open streams now / pipe runs laid in all. */
  links: number;
  pipeRuns: number;
  /** The pipes as plumbing to instance (water.pipeParts): `live` within the present (still changing), `kept` below. */
  pipes: { live: PipeParts; kept: PipeParts };
  /** The open water of every slot as line segments [x, y, z, x, y, z] at its slot's height (the water between the
   *  villages, water.ts WaterConfig.villages). */
  streams: Float32Array;
  /** V2 walkways' pre-layer as line segments with a weight per vertex (walkways.walkSegments): `live` within the present, `kept` below. */
  walk: { live: Float32Array; kept: Float32Array; liveW: Float32Array; keptW: Float32Array; liveU: Float32Array; keptU: Float32Array; liveEnds: Float32Array; keptEnds: Float32Array };
  t: number;
  top: number;
  minX: number;
  minZ: number;
}

export interface NatureInput {
  fold: FoldConfig;
  box: BoxConfig;
  nature: NatureConfig;
  /** Slots around `focusK` whose history is kept. */
  window: number;
  focusK: number;
  margin: number;
}

export interface ReclaimInput {
  tauReclaimYears: number;
  perArea: number;
  unit: number;
  secPerUnit?: number;
  timeScale?: number;
  /** With wear and this, points GATHER on parts by their corrosion (fuse.gatheringShare) instead of abandonment. */
  fuse?: FuseConfig;
  /** THE DENSITY'S GATHERING: points gather on a part by how little its cell-slot was lived in (Seed.gather,
   *  density.ts liveAt) — no wear, no age. */
  unlived?: boolean;
}

export interface FuseInput {
  box: BoxConfig;
  weather: WeatherConfig;
  fuse: FuseConfig;
  /**
   * THE IMMUTABLE LAYER (the artist, 2026-10-31 night): three bands — the present (the top slots), the layer where the
   * processes run (gathering → rot → fusion → resin, on the clock), and from `immutable` slots below the present
   * down, nothing changes: a chunk whose top crosses that line is baked as it is then (rendered once from its
   * material if its mesh is stale) and final. Nothing else is ever baked. Absent = V1 (baked at the window's cut).
   */
  immutable?: number;
  /**
   * The view has CAUGHT UP with its clock (its last result is within a couple of slots of the latest event). A chunk
   * is baked below the immutable line only then: baking is final, and while the worker lags behind a fast rate (×20)
   * a chunk's inputs are not yet what the world has become (the artist, 2026-11-01: "I only need to be sure that
   * piling up at ×20 and then going back to ×1 is safe"). Absent = caught up.
   */
  caughtUp?: boolean;
  /**
   * BAKING OFF (the artist, 2026-11-01 16:45: "take the bake out for now — only what happened in the last twenty
   * minutes"): false = no chunk is ever baked, kept, aged or stored; the immutable line, the caught-up rule and the
   * orphan rule are all inactive; the world is the history window alone and what leaves it is gone; baked chunks
   * loaded from disk are dropped. Absent = on (V1).
   */
  bake?: boolean;
  /** Model years after which (1 − 1/e of) a part is overgrown (accretion). */
  tauReclaimYears: number;
  /** The slot the camera looks at: chunks near it are built first (default: the present). */
  focusK?: number;
  /** Chunks (re)built per call (default FUSE_NEW_PER_CALL); the paused view asks for many at once. */
  perCall?: number;
  /**
   * V2: the layers' age for resin, darkening and voids is the parts' own corrosion clock (fuse.ts layerDecay), so the
   * resin only comes after the fusion; absent = the sediment clock (V1, where the resin could begin above the mass).
   */
  oneClock?: boolean;
  /** The fold's slab wear time (for the layers' corrosion clock); DEFAULT_FOLD's when absent. */
  tauSlabYears?: number;
  /** WORK MODE (the paused view): baked layers are rendered again when the fuse config changed. */
  rebake?: boolean;
}

export interface PointsResult {
  position: Float32Array;
  color: Float32Array;
}

const dist3 = (a: [number, number, number], x: number, y: number, z: number) => Math.hypot(a[0] - x, a[1] - y, a[2] - z);

/** A chunk of slots kept as it was (see SpaceModel.baked). */
interface Baked {
  c0: number;
  c1: number;
  mesh: FuseMesh;
  /** Whether `mesh` has been built from `src` at all (a chunk restored from disk starts without one). */
  rendered: boolean;
  /**
   * THE PAST KEEPS AGEING (the artist, 2026-10-20: baked layers are final only once fossilised): until every part
   * is fully decayed and the layers' age is complete, the chunk's parts are read again from their wear basis at
   * the present and the chunk rendered again, a step at a time; then it is final and never touched.
   */
  final: boolean;
  /** The present (session s) the parts' decay was last read at. */
  agedT: number;
  boxes: Box[];
  /** Grey shade per box (the part's weathering at the time of baking). */
  shade: Float32Array;
  nature: { pos: Float32Array; col: Float32Array } | null;
  /**
   * WORK MODE: what the mesh was made from (the parts' state, a slice of the vegetation history, the layers' age) and
   * the fuse config it was made with — so a paused view can re-render the baked layers with a changed look
   * (computeFuse rebake). The world below does not change; its rendering can.
   */
  src: {
    parts: Box[];
    /** Per part: what its decay at any later time is read from (null = frozen at `decay`). */
    basis: (WearBasis | null)[];
    decay: number[];
    standing: boolean[];
    skeleton: boolean[];
    /** The external parts (pipes, walkways, fossil steel) that fused with the chunk, with what their decay is read from. */
    tubes: BakedTube[];
    history: NatureHistory | null;
    x0: number;
    z0: number;
    nx: number;
    nz: number;
    unit: number;
    sediment: NonNullable<ReturnType<typeof sedimentOf>>;
    /** When the chunk was baked (session s). */
    t0: number;
    cfgKey: string;
    /** An ORPHAN's last mesh (no material to rebuild from): kept and stored as it is. */
    mesh?: FuseMesh;
  };
}

/** The slots [k0, k1] of a vegetation history as a history of their own (V only: what fuseChunk reads). */
function sliceHistory(h: NatureHistory, k0: number, k1: number): NatureHistory {
  const a = Math.max(h.k0, k0), b = Math.min(h.k0 + h.nk - 1, k1);
  const n = h.nx * h.nz;
  if (b < a) return { ...h, k0: a, nk: 0, V: new Float32Array(0), P: new Float32Array(0) };
  return { x0: h.x0, z0: h.z0, nx: h.nx, nz: h.nz, k0: a, nk: b - a + 1, V: h.V.slice((a - h.k0) * n, (b - h.k0 + 1) * n), P: new Float32Array(0) };
}

/** Decay (1 − survival) from which a part counts as done, for baking a chunk early. */
const BAKE_DECAY = 0.98;
/** World seconds between two readings of a baked chunk's ageing. */
const AGE_STEP_S = 30;
const quant20 = (v: number) => Math.round(v * 20) / 20;
/** The key by which a drawn box is matched to its part (restored boxes are copies, not the same objects). */
const boxKey = (b: Box) => `${b.kind}:${b.slot}:${b.x.toFixed(2)}:${b.y.toFixed(2)}:${b.z.toFixed(2)}`;

export class SpaceModel {
  private events: PEvent[] = [];
  private ids = new Set<string>();
  private t = 0;
  /** The latest event's time (the present `t` may run ahead of it by the clock). */
  private latestEvent = 0;
  private version = 0;
  private seeds: Seed[] = [];
  private seedsKey = "";
  /** The fold as a state that grows with the events (foldState.ts), per fold config: a refold costs only what arrived. */
  private foldState: { key: string; state: FoldState; fed: number } | null = null;
  /** BUILDINGS FROM THE DENSITY OF SPACETIME (density.ts): when set (computeParts), the seeds come from it, not the fold. */
  private densityCfg: DensityConfig | null = null;
  private densityState: { key: string; field: DensityField; fed: number } | null = null;
  private pathsKey = "";
  /** After a reset that keeps what is built: the ids of the samples the density has already had. */
  private densitySeen: Set<string> | null = null;
  private partCache = new Map<number, { key: string; parts: Box[] }>();
  /** ARRIVAL (arrive.ts): when each part was first there, on a wall clock of this model's own; the parts' config the
   *  last parts were made with (another one, or none yet = a knob or a load: what appears then is not being built). */
  private arrivals = new Arrivals();
  private arriveEpoch = Date.now();
  private arriveCfg: string | null = null;
  /** FROZEN PARTS per building and slot (fuse.freezeSlots): once a slot is that deep, its parts are kept as they were. */
  private frozen = new Map<number, Map<number, Box[]>>();
  private partsSig = "";
  /** Seeds by cell as last folded: kept through reset (a moved history window), see carrySeeds. */
  private seedMemo = new Map<string, Seed>();
  /** The latest time before the last reset: a world that starts again far earlier is a new world (memo cleared). */
  private tBeforeReset = 0;
  /** The decay each part had in the fused mass as last drawn (computeFuse): it is absorbed only as far as that. */
  /**
   * Kept per chunk and BY THE PART'S OWN KEY (its slot and its hash — where it lies and what it is), not by the Box
   * object: with the density's buildings a cell's parts are made again whenever anything is written near it (and all
   * of them when old samples are forgotten) — new objects, the same parts. Remembered by object, every such part
   * came back out of the mass and stayed out until its chunk happened to be built again: the buildings stood in
   * front of the mass, most of all in the layers nobody writes in (the artist, 2026-11-15: "아래층에서는 안 보임",
   * "건물은 있고, 융합이 보였다 말았다 함").
   */
  private fusedAt = new Map<number, Map<number, number>>();
  private static partKey(b: Box): number {
    return b.slot * 4294967296 + Math.floor(partHash(b) * 4294967296);
  }
  private fusedAtOf(b: Box): number | undefined {
    return this.fusedAt.get(Math.floor(b.slot / NATURE_CHUNK) * NATURE_CHUNK)?.get(SpaceModel.partKey(b));
  }
  /** The wear config the parts were last worn with (the baked layers age by it). */
  private wearCfg: WearConfig | null = null;
  /** For the pipes' corrosion in the fuse (computeParts' present thickness and slab wear; the water config is kept below). */
  private presentSlots = 1;
  private foldTau = DEFAULT_FOLD.tauSlabYears;
  /** The world epoch the baked layers are kept under on disk (bakeStore); null = not kept (the lab). */
  private epoch: string | null = null;
  /** Counts mass chunks built, so the parts follow what the mass has taken. */
  private fuseBuilt = 0;
  /** The earliest event's time (the history window's cut); parts below it are not drawn. */
  private cutS = Infinity;
  private built: Box[] = [];
  private worn: Box[] = [];
  /** The weathering of the last computed parts (null without wear). */
  private wear: ReturnType<typeof wearModel> | null = null;
  /** How much vegetation has gathered on a part (strata only): it gathers before (and so causes) its rot. */
  private gatherOf: ((b: Box) => number) | null = null;
  /** The erosion of the last computed parts (erode.ts; null = none), and how much of it feeds the gatherings. */
  private eroded: (Erosion & { feed: number }) | null = null;
  /** A part's own erosion threshold, kept while the rule that made it stands. */
  private erodeMemo = new WeakMap<Box, number>();
  /**
   * THE BLOCK'S ONE CLOCK FOR THE FUSION (the artist, 2026-11-15: "융합 진행"). The fusion was always driven by one
   * number per part — its corrosion, 0 new … 1 gone — and every stage is a threshold of it (fuse.ts). In the block
   * nothing is on a clock: that number is the EROSION OF THE PART'S PLACE (erode.ts erosionAt: how far below the
   * block's top, and how little it was lived in). So a part fuses by where it lies; nothing else decides when.
   * null = not the block (the wear model's corrosion is read, as before).
   */
  private blockClock: { top: number; decay: (b: Box) => number; layer: (k: number) => number; old: (slot: number, x?: number, z?: number) => number; erode: ErodeConfig } | null = null;
  private erodeKey = "";
  private history: NatureHistory | null = null;
  /** The waterways of the last computed parts, and their nearness per (cell, slot). */
  private drain: Drainage = NO_DRAINAGE;
  /** The open water as segments, made again only when the drainage is (streamSegments). */
  private streamSegs: { of: Drainage; unit: number; segs: Float32Array } | null = null;
  private drainKey = "";
  /** What water has laid in the slots already past: kept as it is (same rule); reset when the rule changes. */
  private drainKept: { rule: string; pipes: PipeRun[]; streams: Map<number, Float32Array[]>; upToK: number } | null = null;
  private walks: Walkways = NO_WALKWAYS;
  private walkKey = "";
  /** Walkway layers laid in the slots already past: kept as they are (same rule). */
  private walkKept: { rule: string; layers: WalkLayer[]; upToK: number } | null = null;
  private nearWater: ((ix: number, iz: number, k: number) => number) | null = null;
  private waterCfg: WaterConfig | null = null;
  private fuseSig = "";
  /** Per chunk: its latest mesh, the key it was built for, and WHEN (this.fuseBuilt at the time) — for the round robin. */
  private fuseChunks = new Map<number, { key: string; mesh: FuseMesh; built: number }>();
  /** How many chunk builds ago the least recently built kept chunk was built (0 = none kept): the round robin's lag. */
  get fuseMaxLag(): number {
    let lag = 0;
    for (const ch of this.fuseChunks.values()) lag = Math.max(lag, this.fuseBuilt - ch.built);
    return lag;
  }
  /**
   * BAKED chunks: layers that are done. Their mass, the parts still standing in them (with their last shade) and
   * their vegetation points are kept as they were and never recomputed — through reset too (the history window
   * moving on), so the past stays while the events below the window are forgotten. A chunk is baked when its slots
   * are about to leave the history window (the two chunks just above the cut), or earlier when every part in it has
   * fully decayed below the present. Only a cleared world (a new epoch) empties it.
   */
  private baked = new Map<number, Baked>();
  /** The parts drawn by the last computeParts (after wear and absorption): what a baked chunk keeps of them. */
  private shown: Box[] = [];
  /**
   * ONE CLOCK (the artist, 2026-11-01: "the fossilised layer and the layer where the buildings vanish drift apart,
   * and the fossil is cut off flat"): a layer's age for the resin, the voids and the fossil curve is read off the
   * parts actually lying in that slot (their mean corrosion, smoothed over the neighbouring slots), not off a
   * typical exposed part on the layer clock — covered parts corrode slower, and the two clocks drifted apart as the
   * world aged. Slots without parts fall back to the formula.
   */
  /**
   * THE BLOCK'S VEGETATION FOR THE MASS (the artist, 2026-11-15: "그렇게 적용해서 어떻게 보이는지 확인하면 좋을듯").
   * The mass used to take the vegetation's sediment from the vegetation's history (fuse.ts natureWeight: it sticks to
   * decaying concrete, the lumps that made the fossil organic). The redesign has no such history; what it has is
   * where plants gather — what is BUILT BUT NOT LIVED IN (Seed.gather, density.ts liveAt). That is read in its place:
   * per cell-slot the unlived share, and a little of it on the cells right beside (it sticks from the side too).
   */
  /**
   * WHERE THE TIME GOES (the artist, 2026-11-15: "지금 성능이 너무 떨어져서"): milliseconds per stage of the last
   * request, shown in the wall's readout. Stages of computeParts: seeds (the density / the fold), parts (the
   * buildings' boxes), water (the pipes), walk (the ways), emit (erosion, wear and the buffers); then the other
   * calls of the request (nature, reclaim, paths, fuse).
   */
  stages: Record<string, number> = {};
  private lap(name: string, t0: number): number {
    const t = performance.now();
    this.stages[name] = (this.stages[name] ?? 0) + t - t0;
    return t;
  }
  /** The parts still standing, as of the fuse being computed (tubesOf reads it: eroded steel leaves no mass). */
  private standingNow: Set<Box> | null = null;
  /**
   * WHEN EACH CELL-SLOT WAS BUILT, in real seconds (erode.ts lifeSec: its parts' progress counts from then on) — by
   * the cell (seed id) and the slot, with the level it had; kept through the forgetting of old samples, emptied with
   * the world. `ageClock` only ever goes forward.
   */
  private bornT = new Map<number, Map<number, { born: number; level: number }>>();
  /** How far a part's plants have come since it was built (0 during its wait … 1): the gatherings read it. */
  private partSettled: ((b: Box) => number) | null = null;
  private ageClock = 0;
  /** Whether the parts' ages have begun to be kept: until then what is found standing is taken as long there. */
  private ageBegun = false;
  /** What is made again whole in the block (the ways, the pipes): when it was last made, and of how many events. */
  private slow = new Map<string, { cfg: string; at: number; version: number; n: number }>();
  /** A key that moves when the rule changed — or, no sooner than SLOW_MS after the last time, when anything was written. */
  /** Every slot's open water as line segments at the slot's height (a little above its floor), cached per drainage. */
  private streamSegments(unit: number): Float32Array {
    const c = this.streamSegs;
    if (c && c.of === this.drain && c.unit === unit) return c.segs;
    const out: number[] = [];
    for (const [k, courses] of this.drain.streams) {
      const y = k * unit + 0.04;
      for (const line of courses) for (let i = 0; i + 3 < line.length; i += 2) out.push(line[i], y, line[i + 1], line[i + 2], y, line[i + 3]);
    }
    const segs = Float32Array.from(out);
    this.streamSegs = { of: this.drain, unit, segs };
    return segs;
  }

  private slowKey(name: string, cfg: string): string {
    const now = Date.now();
    let st = this.slow.get(name);
    if (!st || st.cfg !== cfg || (st.version !== this.version && now - st.at >= SLOW_MS)) {
      st = { cfg, at: now, version: this.version, n: (st?.n ?? 0) + 1 };
      this.slow.set(name, st);
    }
    return `${st.n}:${cfg}`;
  }
  /** fuseTiled stops fusing districts again past this (performance.now()); what it left is done at the next call. */
  private fuseDeadline = Infinity;
  private fuseLeft: Set<number> | null = null;
  /** The mass of each district of each chunk, with the signature of what went into it (fuseTiled). */
  private districtMass = new Map<string, { key: string; mesh: FuseMesh; at: number }>();
  private blockHist: { key: string; h: NatureHistory | null } | null = null;
  private blockHistory(top: number): NatureHistory | null {
    const key = `${this.seedsKey}:${top}`;
    if (this.blockHist && this.blockHist.key === key) return this.blockHist.h;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity, any = false;
    for (const sd of this.seeds) {
      if (!sd.gather) continue;
      any = true;
      const cx = Math.floor(sd.x / CELL), cz = Math.floor(sd.z / CELL);
      a = Math.min(a, cx);
      b = Math.max(b, cx);
      c = Math.min(c, cz);
      d = Math.max(d, cz);
    }
    let h: NatureHistory | null = null;
    if (any) {
      const x0 = a - 2, z0 = c - 2, nx = b - a + 5, nz = d - c + 5, nk = Math.max(1, Math.round(top) + 2);
      const V = new Float32Array(nx * nz * nk);
      for (const sd of this.seeds) {
        if (!sd.gather) continue;
        const i = Math.floor(sd.x / CELL) - x0, j = Math.floor(sd.z / CELL) - z0;
        for (const [k, g] of sd.gather) {
          if (k < 0 || k >= nk || !(g > 0)) continue;
          const off = k * nx * nz;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const p = off + (j + dj) * nx + i + di, v = di || dj ? g * 0.6 : g;
              if (V[p] < v) V[p] = v;
            }
          }
        }
      }
      h = { x0, z0, nx, nz, k0: 0, nk, V, P: new Float32Array(0) };
    }
    this.blockHist = { key, h };
    return h;
  }

  /** A history as a turned district's frame sees it (fuseTiled): the cells of `ext` in that frame, the slots lo … hi. */
  private static turnedHistory(h: NatureHistory, c: number, sn: number, ext: { x0: number; z0: number; nx: number; nz: number }, lo: number, hi: number): NatureHistory {
    const k0 = Math.max(h.k0, lo), k1 = Math.min(h.k0 + h.nk - 1, hi), nk = Math.max(0, k1 - k0 + 1);
    const V = new Float32Array(ext.nx * ext.nz * nk);
    for (let j = 0; j < ext.nz; j++) {
      for (let i = 0; i < ext.nx; i++) {
        // the cell's middle in the frame, turned forward into the world
        const x = (ext.x0 + i + 0.5) * CELL, z = (ext.z0 + j + 0.5) * CELL;
        const wi = Math.floor((x * c + z * sn) / CELL) - h.x0, wj = Math.floor((-x * sn + z * c) / CELL) - h.z0;
        if (wi < 0 || wj < 0 || wi >= h.nx || wj >= h.nz) continue;
        for (let k = 0; k < nk; k++) V[k * ext.nx * ext.nz + j * ext.nx + i] = h.V[(k0 + k - h.k0) * h.nx * h.nz + wj * h.nx + wi];
      }
    }
    return { ...ext, k0, nk, V, P: new Float32Array(0) };
  }

  /** What the fusion reads a part's corrosion from: the wear model — or, in the block, the erosion of its place. */
  private fuseWear(): { survival: (b: Box) => number; basis: (b: Box) => WearBasis | null } | null {
    if (this.wear) return this.wear;
    const bc = this.blockClock;
    return bc ? { survival: (b) => 1 - bc.decay(b), basis: () => null } : null;
  }

  private layerClockOf(formula: (k: number) => number): (k: number) => number {
    const wm = this.fuseWear();
    if (!wm) return formula;
    const sum = new Map<number, number>();
    const n = new Map<number, number>();
    for (const b of this.built) {
      if (STEEL_KINDS.has(b.kind) || b.kind === "drip") continue;
      sum.set(b.slot, (sum.get(b.slot) ?? 0) + 1 - wm.survival(b));
      n.set(b.slot, (n.get(b.slot) ?? 0) + 1);
    }
    const cache = new Map<number, number>();
    return (k: number) => {
      const c = cache.get(k);
      if (c !== undefined) return c;
      let s = 0, m = 0;
      for (let j = k - 1; j <= k + 1; j++) {
        const nj = n.get(j);
        if (nj) { s += sum.get(j)!; m += nj; }
      }
      const v = m > 0 ? s / m : formula(k);
      cache.set(k, v);
      return v;
    };
  }

  /**
   * A chunk's mass in TILES across the ground (TILE cells each, the parts within the tile ± MARGIN): the flocks spread
   * over the world and one grid for the whole ground passed fuseChunk's size limit (an empty mesh — the artist,
   * 2026-11-01: "the bots move differently, but the fossil visual is gone"). Each tile keeps only its own faces (as the
   * chunk keeps only its own rows), so the tiles join without a seam; tiles without parts cost nothing.
   */
  /**
   * THE DISTRICTS ARE TURNED (seeds.ts VarietyConfig: every building of a district stands at the district's angle),
   * and the mass is worked out on a grid: fused as they lie, turned buildings came out as blocks along the world's
   * axes at the buildings' places — stair-steps that did not follow their walls (the artist, 2026-11-15: "화석 모양이
   * 이전보다 너무 블록같은데"). So a chunk's parts are fused district angle by district angle, each in its own frame:
   * turned back until they are square to the grid, fused there exactly as before, and the mesh turned forward again.
   * Parts at no angle (and the pipes, ways and steel) are fused in the world's frame, as they always were.
   */
  private fuseTiled(
    w: { c0: number; c1: number; ps: { b: Box; d: number; up: boolean; sk: boolean; ang?: number }[]; tubes: BakedTube[]; x0: number; z0: number; nx: number; nz: number },
    h: NatureHistory | null,
    u: number,
    sed: NonNullable<ReturnType<typeof sedimentOf>>,
    layerDecay: ((k: number) => number) | undefined,
    fuse: FuseConfig,
    cfgKey = "",
  ): FuseMesh {
    const byAngle = new Map<number, typeof w.ps>();
    for (const e of w.ps) {
      const a = Math.round((e.ang ?? 0) * 1e4) / 1e4;
      const l = byAngle.get(a);
      if (l) l.push(e);
      else byAngle.set(a, [e]);
    }
    if (byAngle.size <= 1 && (byAngle.has(0) || !byAngle.size)) return this.fuseTiles(w, h, u, sed, layerDecay, fuse);
    const out: FuseMesh[] = [];
    const M = 3;
    const extent = (ps: typeof w.ps, tubes: BakedTube[]) => {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (const { b: q } of ps) {
        const r = Math.max(q.sx, q.sy, q.sz) / 2;
        a = Math.min(a, q.x - r);
        b = Math.max(b, q.x + r);
        c = Math.min(c, q.z - r);
        d = Math.max(d, q.z + r);
      }
      for (const t of tubes) {
        a = Math.min(a, t.x0 - t.r, t.x1 - t.r);
        b = Math.max(b, t.x0 + t.r, t.x1 + t.r);
        c = Math.min(c, t.z0 - t.r, t.z1 - t.r);
        d = Math.max(d, t.z0 + t.r, t.z1 + t.r);
      }
      const x0 = Math.floor(a / CELL) - M, z0 = Math.floor(c / CELL) - M;
      return { x0, z0, nx: Math.ceil(b / CELL) + M - x0, nz: Math.ceil(d / CELL) + M - z0 };
    };
    if (!byAngle.has(0) && w.tubes.length) byAngle.set(0, []);
    // ONLY WHAT CHANGED IS FUSED AGAIN (2026-11-15: in the block somebody is always writing somewhere in every chunk,
    // so every chunk was made again whole, all the time — two chunks of a dozen districts each, ~3.5 s a call, while
    // one building had changed). A district's mass is kept with a signature of what went into it: its parts (where
    // they lie, how far gone, standing or not), the layers' ages, the vegetation at its parts, the pipes and ways
    // (for the parts at no angle) and the look. A district whose signature stands is not fused again.
    let layers = "";
    if (layerDecay) for (let k = w.c0 - 12; k <= w.c1 + 12; k++) layers += Math.round(layerDecay(k) * 20).toString(36);
    const used = new Set<string>();
    // (a district's signature reads what its mass is made of — how much of each part is mass — not the part's value
    // itself: past `fuseFull` a part is all mass and ageing on changes nothing)
    const stale: { ang: number; id: string; key: string; at: number; run: () => FuseMesh }[] = [];
    const sigOf = (list: typeof w.ps, tubes: readonly BakedTube[]): string => {
      let sum = 0;
      for (const e of list) {
        const veg = h ? (natureAt(h, Math.floor(e.b.x / CELL), Math.floor(e.b.z / CELL), e.b.slot) ?? 0) : 0;
        sum += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.b.sx * 0.7 + e.b.sy * 1.3 + e.b.sz * 1.9 + Math.round(fusedShare(e.d, fuse) * 20) * 0.65 + Math.round(accretionShare(e.d, fuse) * 20) * 0.35 + (e.up ? 19 : 0) + (e.sk ? 23 : 0) + veg * 5;
      }
      for (const tb of tubes) sum += tb.decay * 13 + tb.x0 + tb.z1 + tb.y0 * 3 + tb.r * 17;
      return `${list.length}:${tubes.length}:${sum.toFixed(3)}:${layers}:${cfgKey}`;
    };
    const want = (ang: number, id: string, key: string, run: () => FuseMesh) => {
      used.add(id);
      const kept = this.districtMass.get(id);
      if (kept && kept.key === key) out.push(kept.mesh);
      else stale.push({ ang, id, key, at: kept ? kept.at : -1, run });
    };
    const cellOf = (v: number) => Math.floor(v / CELL);
    for (const [ang, list] of byAngle) {
      if (!ang) {
        // WHAT STANDS AT NO ANGLE — AND THE PIPES, THE WAYS, THE STEEL, which run all over the ground: kept TILE BY
        // TILE (tiles on a grid of the world's, so a tile is the same tile whatever else is in the chunk). As one
        // unit it was a dozen tiles that had to be fused in one go, whatever the budget said (4 s in one call).
        const T = 24, PAD = 4;
        const ex = extent(list, w.tubes);
        for (let tz = Math.floor(ex.z0 / T) * T; tz < ex.z0 + ex.nz; tz += T) {
          for (let tx = Math.floor(ex.x0 / T) * T; tx < ex.x0 + ex.nx; tx += T) {
            const ax = tx - PAD, bx = tx + T + PAD, az = tz - PAD, bz = tz + T + PAD;
            const ps = list.filter(({ b }) => {
              const r = Math.max(b.sx, b.sy, b.sz) / 2;
              return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
            });
            const tubes = w.tubes.filter((t) => cellOf(Math.max(t.x0, t.x1) + t.r) >= ax && cellOf(Math.min(t.x0, t.x1) - t.r) < bx && cellOf(Math.max(t.z0, t.z1) + t.r) >= az && cellOf(Math.min(t.z0, t.z1) - t.r) < bz);
            if (!ps.length && !tubes.length) continue;
            want(0, `${w.c0}:0:${tx}:${tz}`, sigOf(ps, tubes), () => this.fuseTiles({ ...w, ps, tubes, x0: tx, z0: tz, nx: T, nz: T }, h, u, sed, layerDecay, fuse));
          }
        }
        continue;
      }
      want(ang, `${w.c0}:${ang}`, sigOf(list, []), () => {
        // into the district's frame (the inverse of seeds.ts' turn, about the origin), and the mesh back out of it
        const c = Math.cos(ang), sn = Math.sin(ang);
        const turned = list.map((e) => ({ ...e, b: { ...e.b, x: e.b.x * c - e.b.z * sn, z: e.b.x * sn + e.b.z * c, yaw: 0 } }));
        const ext = extent(turned, []);
        const m = this.fuseTiles({ ...w, ps: turned, tubes: [], ...ext }, h ? SpaceModel.turnedHistory(h, c, sn, ext, w.c0 - 12, w.c1 + 12) : null, u, sed, layerDecay, fuse);
        for (const arr of [m.position, m.normal]) {
          for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i], z = arr[i + 2];
            arr[i] = x * c + z * sn;
            arr[i + 2] = -x * sn + z * c;
          }
        }
        return m;
      });
    }
    // THE LEAST RECENTLY FUSED FIRST (never fused: first of all) — in map order the first districts of a chunk were
    // stale again by the next call and took the whole budget every time, and the others were never reached
    stale.sort((p, q) => p.at - q.at);
    for (const { ang, id, key, run } of stale) {
      // (out of time for this call: the district keeps the mass it had — or none yet — and is done at the next)
      if (performance.now() > this.fuseDeadline) {
        const kept = this.districtMass.get(id);
        if (kept) out.push(kept.mesh);
        (this.fuseLeft ??= new Set()).add(ang);
        continue;
      }
      this.stages["fuse districts (n)"] = (this.stages["fuse districts (n)"] ?? 0) + 1;
      const m = run();
      this.districtMass.set(id, { key, mesh: m, at: this.fuseBuilt });
      out.push(m);
    }
    // (districts that are no longer in this chunk are let go)
    for (const id of this.districtMass.keys()) if (id.startsWith(`${w.c0}:`) && !used.has(id)) this.districtMass.delete(id);
    return mergeMeshes(out);
  }

  /** A chunk's parts (all square to the grid) fused tile by tile. */
  private fuseTiles(
    w: { c0: number; c1: number; ps: { b: Box; d: number; up: boolean; sk: boolean }[]; tubes: BakedTube[]; x0: number; z0: number; nx: number; nz: number },
    h: NatureHistory | null,
    u: number,
    sed: NonNullable<ReturnType<typeof sedimentOf>>,
    layerDecay: ((k: number) => number) | undefined,
    fuse: FuseConfig,
  ): FuseMesh {
    const TILE = 24, MARGIN = 4;
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
        this.stages["fuse tiles (n)"] = (this.stages["fuse tiles (n)"] ?? 0) + 1;
        this.stages["fuse cells (n)"] = (this.stages["fuse cells (n)"] ?? 0) + (bx - ax) * (bz - az);
        meshes.push(
          fuseChunk({
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
          }),
        );
      }
    }
    return mergeMeshes(meshes);
  }

  /** fuseBuilt as of the last computeParts: baking waits until the parts reflect every built chunk. */
  private partsFuseBuilt = -1;
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
      if (e.s > this.latestEvent) this.latestEvent = e.s;
      this.version++;
    }
    // a new world is told from a moved window by the EVENTS' time, never by the present: the present follows the
    // clock and may be minutes ahead of the last event (nobody there) — comparing it cleared the baked layers at the
    // next window move ("the fossils vanish after a while", the artist 2026-10-31)
    if (this.tBeforeReset > 0 && this.latestEvent > 0) {
      if (this.latestEvent < this.tBeforeReset - 120) {
        // a new world, not a moved window: nothing of the old one stays
        this.seedMemo.clear();
        this.baked.clear();
      }
      this.tBeforeReset = 0;
    }
  }

  /**
   * THE PRESENT FOLLOWS THE CLOCK (the artist, 2026-10-20: "the fossilisation does not progress"): the present was
   * the latest event's time, so with nobody present (no bots, no player) a faster world clock aged nothing. Now the
   * view tells the model the clock's present every request; the world ages whether or not anyone is in it (nothing
   * new is built in empty time — only what stands corrodes, gathers vegetation and fuses).
   */
  setNow(s: number): void {
    if (Number.isFinite(s) && s > this.t) {
      this.t = s;
      this.version++;
    }
  }

  /**
   * THE PAST ON DISK: the epoch the baked layers are kept under (bakeStore). Set from the view with the events; a
   * change of epoch (the world cleared) forgets the old epoch's layers on disk and loads the new one's, which are
   * rendered again, a few per call, with the current look.
   */
  setEpoch(epoch: string | null): void {
    if (epoch === this.epoch) return;
    const old = this.epoch;
    this.epoch = epoch;
    if (old) {
      this.baked.clear();
      void clearBaked(old);
    }
    if (!epoch) return;
    void loadBaked(epoch).then((recs) => {
      if (this.epoch !== epoch) return;
      let n = 0;
      for (const r of recs) {
        if (this.baked.has(r.c0)) continue;
        this.baked.set(r.c0, {
          c0: r.c0,
          c1: r.c1,
          mesh: mergeMeshes([]),
          rendered: false,
          final: r.final,
          agedT: r.t0,
          boxes: r.boxes,
          shade: r.shade,
          nature: null,
          src: { parts: r.parts, basis: r.basis, decay: r.decay, standing: r.standing, skeleton: r.parts.map(() => false), tubes: r.tubes ?? [], history: r.history, x0: r.x0, z0: r.z0, nx: r.nx, nz: r.nz, unit: r.unit, sediment: r.sediment, t0: r.t0, cfgKey: "", mesh: r.mesh },
        });
        n++;
      }
      if (n) this.version++;
    });
  }

  /** Writes a baked chunk to disk (when an epoch is set). */
  private persist(bk: Baked): void {
    if (!this.epoch) return;
    const s = bk.src;
    void saveBaked({ key: bakedKey(this.epoch, bk.c0), epoch: this.epoch, c0: bk.c0, c1: bk.c1, final: bk.final, t0: s.t0, parts: s.parts, basis: s.basis, decay: s.decay, standing: s.standing, tubes: s.tubes, history: s.history, x0: s.x0, z0: s.z0, nx: s.nx, nz: s.nz, unit: s.unit, sediment: s.sediment, boxes: bk.boxes, shade: bk.shade, nature: bk.nature, mesh: s.mesh });
  }

  /** How many baked chunks still age, how many are final, and the mean decay of the ageing ones' parts (readout, tests). */
  get bakedAgeing(): { ageing: number; final: number; meanDecay: number } {
    let ageing = 0, final = 0, sum = 0, n = 0;
    for (const bk of this.baked.values()) {
      if (bk.final) final++;
      else {
        ageing++;
        for (const d of bk.src.decay) {
          sum += d;
          n++;
        }
      }
    }
    return { ageing, final, meanDecay: n ? sum / n : 0 };
  }

  /** The pipes' corrosion of the network laid in slot k, at the present (as computeParts' pipeDecay). */
  private pipeDecayAt(k: number, w: WeatherConfig): number {
    const wc = this.waterCfg, spu = this.wearCfg?.secPerUnit ?? 0;
    if (!wc || !w.strata || wc.pipeLife <= 0 || !(spu > 0)) return 0;
    const laid = Math.min(this.t, (k + 1 + this.presentSlots) * spu);
    const A = Math.max(0, geoYears(this.t) - geoYears(laid)) * w.timeScale;
    return 1 - Math.exp(-A / (this.foldTau * w.steelLife * wc.pipeLife));
  }

  /**
   * The EXTERNAL PARTS of slots kLo … kHi as tubes for the fuse: the water pipes (their runs and risers, their own
   * corrosion), the walkways' lines (the layer's age) and the fossil share of the steel (their own wear).
   */
  private tubesOf(kLo: number, kHi: number, fuse: FuseConfig, u: number, w: WeatherConfig, layerDecay: ((k: number) => number) | undefined): BakedTube[] {
    const out: BakedTube[] = [];
    const wc = this.waterCfg;
    if (fuse.fusePipes && wc) {
      const yOf = (k: number) => (k - wc.pipeDepth) * u;
      for (const p of this.drain.pipes) {
        if (p.k < kLo || p.k > kHi) continue;
        // (the block: a run's erosion, by where it lies — as it is drawn, computeParts)
        const bc = this.blockClock;
        const worn = bc && bc.erode.pipes !== false ? pipeErosion((p.ax + p.bx) / 2, (p.az + p.bz) / 2, Math.floor(p.k - wc.pipeDepth), bc.erode) : 0;
        // (a run the erosion has taken leaves no mass either — fuse.ts goneMass)
        const left = bc && worn >= 1 ? Math.max(0, Math.min(1, fuse.goneMass ?? 0)) : 1;
        if (left <= 0) continue;
        const decay = quant20(bc && bc.erode.pipes !== false ? worn * left * bc.old(p.k, (p.ax + p.bx) / 2, (p.az + p.bz) / 2) : this.pipeDecayAt(p.k, w));
        if (p.k0 !== undefined) out.push({ x0: p.ax, y0: yOf(p.k0), z0: p.az, x1: p.ax, y1: yOf(p.k), z1: p.az, r: wc.pipeRadius * wc.shaftRadius, decay, kind: "pipe", k: p.k });
        else out.push({ x0: p.ax, y0: yOf(p.k), z0: p.az, x1: p.bx, y1: yOf(p.k), z1: p.bz, r: wc.pipeRadius * Math.pow(Math.max(1, p.flow), wc.flowGain), decay, kind: "pipe", k: p.k });
      }
    }
    if (fuse.fuseWalks && layerDecay) {
      for (const l of this.walks.layers) {
        if (l.k < kLo || l.k > kHi) continue;
        const decay = quant20(layerDecay(l.k));
        for (const line of l.lines) for (let i = 3; i + 2 < line.length; i += 3) out.push({ x0: line[i - 3], y0: line[i - 2], z0: line[i - 1], x1: line[i], y1: line[i + 1], z1: line[i + 2], r: fuse.walkRadius, decay, kind: "walk", k: l.k });
      }
    }
    const wm = this.fuseWear();
    if (fuse.steelFossil > 0 && wm) {
      for (const b of this.built) {
        if (!STEEL_KINDS.has(b.kind) || b.tilt || b.slot < kLo || b.slot > kHi || partHash(b) >= fuse.steelFossil) continue;
        let decay = quant20(1 - wm.survival(b));
        if (this.blockClock && this.standingNow && !this.standingNow.has(b)) {
          const left = Math.max(0, Math.min(1, fuse.goneMass ?? 0));
          if (left <= 0) continue;
          decay = quant20(decay * left);
        }
        const hh = halfHeight(b);
        // along the part's long axis, as thick as its thin sides
        const dims = [b.sx, 2 * hh, b.sz];
        const long = dims.indexOf(Math.max(...dims));
        const r = Math.max(0.05, Math.min(...dims.filter((_, i) => i !== long)) / 2);
        const a = [b.x, b.y, b.z], e = [b.x, b.y, b.z];
        a[long] -= dims[long] / 2;
        e[long] += dims[long] / 2;
        out.push({ x0: a[0], y0: a[1], z0: a[2], x1: e[0], y1: e[1], z1: e[2], r, decay, kind: "steel", k: b.slot, basis: wm.basis(b), box: b });
      }
    }
    return out;
  }

  /** Renders a baked chunk from its material with the current look and clock. */
  private renderBaked(bk: Baked, fuse: FuseConfig, layerDecay: ((k: number) => number) | undefined): void {
    const s = bk.src;
    if (s.mesh) {
      bk.mesh = s.mesh;
      bk.rendered = true;
      s.cfgKey = JSON.stringify(fuse);
      return;
    }
    bk.mesh = fuseChunk({ parts: s.parts, decay: s.decay, standing: s.standing, skeleton: s.skeleton, tubes: s.tubes, history: s.history, k0: bk.c0, k1: bk.c1, x0: s.x0, z0: s.z0, nx: s.nx, nz: s.nz, unit: s.unit, sediment: s.sediment, layerDecay, cfg: fuse });
    bk.rendered = true;
    s.cfgKey = JSON.stringify(fuse);
  }

  /**
   * Reads a baked chunk's parts again at the present (their wear basis under the current wear config): the decay
   * moves on, the skeleton and the drawn boxes follow, the chunk is rendered again, and it is final once every part
   * of its own slots is fully decayed and the layers' age is complete. True when something changed.
   */
  private ageBaked(bk: Baked, fuse: FuseConfig, w: WeatherConfig, layerDecay: ((k: number) => number) | undefined): boolean {
    const s = bk.src;
    const cfg = this.wearCfg;
    bk.agedT = this.t;
    if (!cfg) return false;
    let changed = false;
    // the external parts on their own clocks
    for (const tb of s.tubes) {
      const d = tb.kind === "pipe" ? quant20(this.pipeDecayAt(tb.k, w)) : tb.kind === "walk" ? (layerDecay ? quant20(layerDecay(tb.k)) : tb.decay) : tb.basis && tb.box ? quant20(1 - survivalFromBasis(tb.box, tb.basis, this.t, cfg)) : tb.decay;
      if (d !== tb.decay) {
        tb.decay = d;
        changed = true;
      }
    }
    const dOf = new Map<string, number>();
    for (let i = 0; i < s.parts.length; i++) {
      const bs = s.basis[i];
      if (!bs) continue;
      const d = quant20(1 - survivalFromBasis(s.parts[i], bs, this.t, cfg));
      if (d !== s.decay[i]) {
        s.decay[i] = d;
        changed = true;
      }
      s.skeleton[i] = isSkeleton(s.parts[i], d, fuse);
      dOf.set(boxKey(s.parts[i]), d);
    }
    if (!changed) return false;
    // the drawn boxes follow: absorbed into the mass as the live ones are (seeds that keep their form stay), shaded
    const keep: Box[] = [];
    const shade: number[] = [];
    for (let i = 0; i < bk.boxes.length; i++) {
      const b = bk.boxes[i];
      const d = dOf.get(boxKey(b));
      if (d !== undefined) {
        const f = fusedShare(d, fuse);
        if (!STEEL_KINDS.has(b.kind) && !isSkeleton(b, d, fuse) && f > 0 && partHash(b) < Math.min(1, f * 1.6)) continue;
        keep.push(b);
        shade.push((0.86 + 0.14 * b.tone) * (1 - 0.4 * d));
      } else {
        keep.push(b);
        shade.push(bk.shade[i]);
      }
    }
    bk.boxes = keep;
    bk.shade = Float32Array.from(shade);
    this.renderBaked(bk, fuse, layerDecay);
    let done = true;
    for (let i = 0; i < s.parts.length && done; i++) {
      const b = s.parts[i];
      if (b.slot >= bk.c0 && b.slot <= bk.c1 && s.basis[i] && s.decay[i] < BAKE_DECAY) done = false;
    }
    if (done && layerDecay && layerDecay(bk.c1) < 0.99) done = false;
    bk.final = done;
    this.persist(bk);
    return true;
  }

  /** Whether slot k lies in a baked chunk. */
  private isBaked(k: number): boolean {
    return this.baked.has(Math.floor(k / NATURE_CHUNK) * NATURE_CHUNK);
  }

  /** How many chunks are baked (the view's readout). */
  get bakedChunks(): number {
    return this.baked.size;
  }

  /** Forgets every event (the world was cleared). */
  /**
   * `keepBuilt` (the oldest-written samples were forgotten, log.ts dropOldest): what the density has built of them
   * STAYS (the artist, 2026-11-12: "건물 있던 게 자꾸 사라지는데?") — the field is kept, and of the samples given again
   * only those it has not had are added. Otherwise the density starts over with the events.
   */
  reset(keepBuilt = false): void {
    this.tBeforeReset = Math.max(this.tBeforeReset, this.latestEvent);
    const ds = this.densityState;
    if (keepBuilt && ds) {
      this.densitySeen = new Set(this.events.slice(0, ds.fed).map((e) => e.id));
      ds.fed = 0;
    } else {
      this.densityState = null;
      this.densitySeen = null;
    }
    // (the world was emptied while the wall runs: whatever is built from now on is new)
    if (!keepBuilt) {
      this.bornT.clear();
      this.ageBegun = true;
    }
    this.events = [];
    this.ids.clear();
    this.t = 0;
    this.latestEvent = 0;
    this.version++;
    this.foldState = null;
    this.partCache.clear();
    this.arrivals.clear();
    this.arriveCfg = null;
    this.frozen.clear();
    this.chunks.clear();
    this.drainKept = null;
    this.walkKept = null;
  }

  get latest(): number {
    return this.t;
  }

  /** The paths as line segments [x, y, z, x, y, z] (y = the slot's height); null when nothing changed since the last call. */
  computePaths(unit: number, rise: number, smooth = 4): Float32Array | null {
    const ds = this.densityState;
    const key = ds ? `${ds.key}:${ds.field.pathVersion}:${rise}:${smooth}:${unit}` : "-";
    if (key === this.pathsKey) return null;
    this.pathsKey = key;
    if (!ds) return new Float32Array(0);
    const out = Float32Array.from(ds.field.pathLines(rise, smooth));
    for (let i = 1; i < out.length; i += 3) out[i] *= unit;
    return out;
  }

  private ensureSeeds(fold: FoldConfig): Seed[] {
    if (this.densityCfg) {
      // THE DENSITY: every new event is added to the sum (nothing is folded again, whenever in the block it is);
      // the seeds are the same list until a cell-slot crosses a threshold
      const dKey = JSON.stringify(this.densityCfg);
      if (!this.densityState || this.densityState.key !== dKey) this.densityState = { key: dKey, field: new DensityField(this.densityCfg), fed: 0 };
      const ds = this.densityState;
      if (ds.fed < this.events.length) {
        let cut = ds.fed === 0 ? Infinity : this.cutS;
        for (let i = ds.fed; i < this.events.length; i++) {
          if (!this.densitySeen?.has(this.events[i].id)) ds.field.add(this.events[i]);
          if (this.events[i].s < cut) cut = this.events[i].s;
        }
        this.densitySeen = null;
        ds.fed = this.events.length;
        this.cutS = cut;
      }
      this.seedsKey = `density:${ds.field.version}:${dKey}`;
      this.seeds = ds.field.seeds();
      return this.seeds;
    }
    const key = `${this.version}:${JSON.stringify(fold)}`;
    if (key !== this.seedsKey) {
      this.seedsKey = key;
      // fold without wear (this view is history); wear is applied to the parts instead. The fold is a growing state:
      // only the events that arrived since the last call are folded in (the same ground as foldWorld)
      const cfg = withoutWear(fold);
      const fKey = JSON.stringify(cfg);
      if (!this.foldState || this.foldState.key !== fKey) this.foldState = { key: fKey, state: new FoldState(cfg), fed: 0 };
      const fs = this.foldState;
      for (let i = fs.fed; i < this.events.length; i++) fs.state.add(this.events[i]);
      fs.fed = this.events.length;
      const fresh = this.events.length ? seedsFromSnapshot(fs.state.snapshot(this.t)) : [];
      let cut = Infinity;
      for (const e of this.events) if (e.s < cut) cut = e.s;
      this.cutS = cut;
      // a building that began before the history window keeps its id, birth and shape (seeds.carrySeeds)
      this.seeds = carrySeeds(fresh, this.seedMemo, fold.emptyGapSec);
    }
    return this.seeds;
  }

  /** The parts, as per-kind instance buffers; null when nothing changed since the last call. */
  computeParts(input: PartsInput): PartsResult | null {
    let lapT = performance.now();
    this.densityCfg = input.density ?? null;
    const { box, lod } = input;
    const seeds = this.ensureSeeds(input.fold);
    lapT = this.lap("seeds", lapT);
    const t = this.t;
    /** The same config without slat bundles and drips, for far seeds. */
    const solid = (s: Seed): BoxConfig => {
      const rc = box.recipe ?? RECIPES[s.material];
      return { ...box, recipe: { ...rc, slat: { ...rc.slat, enabled: false }, drip: { ...rc.drip, perArea: 0, max: 0 } } };
    };
    /** The middle level: half the slats (at most 16 per mass), no drips — the bundles' texture at a fraction of the parts. */
    const thinned = (s: Seed): BoxConfig => {
      const rc = box.recipe ?? RECIPES[s.material];
      return { ...box, recipe: { ...rc, slat: { ...rc.slat, density: rc.slat.density * 0.5, maxPerMass: Math.min(16, rc.slat.maxPerMass) }, drip: { ...rc.drip, perArea: 0, max: 0 } } };
    };
    const cfgKey = JSON.stringify(box);

    // level per seed by its distance from the camera: 0 full, 1 thinned (within lod.mid), 2 solid
    let lodSig = 0;
    const level = new Map<number, 0 | 1 | 2>();
    const far = new Set<number>();
    const midR = Math.max(lod.near, lod.mid ?? lod.near);
    for (const s of seeds) {
      const yMid = ((s.t0 + s.t1) / 2 / box.secPerUnit) * box.unit;
      const d = dist3(lod.camera, s.x, yMid, s.z);
      const lv = d <= lod.near ? 0 : d <= midR ? 1 : 2;
      if (lv) {
        level.set(s.id, lv);
        lodSig = (lodSig * 31 + s.id * lv) % 1e9;
        if (lv === 2) far.add(s.id);
      }
    }
    // (the block's parts go on by the clock: they are read again at every step of it)
    const lifeSec = this.densityCfg && input.weather.erode ? Math.max(0, input.weather.erode.lifeSec ?? 0) : 0;
    const waitSec = Math.max(0, input.weather.erode?.waitSec ?? 0);
    // (real seconds: the world's clock is set back whenever the lab's world is trimmed, and a part's age must not be)
    this.ageClock = Math.max(this.ageClock, (Date.now() - this.arriveEpoch) / 1000);
    const sig = `${this.seedsKey}:${this.fuseBuilt}:${this.baked.size}:${cfgKey}:${input.wear ? Math.floor(t) : "-"}:${lifeSec > 0 ? Math.floor(this.ageClock / (lifeSec / AGE_STEPS)) : "-"}:${JSON.stringify(input.weather)}:${JSON.stringify(input.fuse)}:${JSON.stringify(input.water)}:${level.size}:${lodSig}:${input.edges}`;
    if (sig === this.partsSig) return null;
    this.partsSig = sig;
    // ARRIVAL (arrive.ts): parts first seen now are being built — unless a knob of the parts or of the buildings' rule
    // was turned, or this is the first result (a load, a reset): those are simply there
    const arriveNow = (Date.now() - this.arriveEpoch) / 1000;
    const arriveKey = `${cfgKey}:${JSON.stringify(input.density ?? null)}`;
    const arriveQuiet = arriveKey !== this.arriveCfg;
    this.arriveCfg = arriveKey;

    const order = [...seeds].sort((a, b) => a.t0 - b.t0 || a.id - b.id);
    const built: Box[] = [];
    const live = new Set<number>();
    const floorK = Number.isFinite(this.cutS) ? Math.floor(this.cutS / box.secPerUnit) : -Infinity;
    for (const s0 of order) {
      // a building's mass grows with every sample: the parts follow it in steps of a quarter, so a living building is
      // not rebuilt (every part regenerated) twice a second
      const s: Seed = { ...s0, mass: Math.round(s0.mass * 4) / 4 };
      const lv = level.get(s.id) ?? 0;
      const slots = occupiedSlots(s, box);
      // (…and the mass of each of its slots, where it has one per slot: a building grown lower down is made again too)
      let massSig = 0;
      if (s.masses) for (const [k, m] of s.masses) massSig += (k + 1) * m;
      const key = `${s.t0}:${slots[0]}:${slots[slots.length - 1]}:${slots.length}:${s.spans?.length ?? 0}:${s.mass}:${massSig.toFixed(2)}:${lv}:${cfgKey}`;
      let hit = this.partCache.get(s.id);
      if (!hit || hit.key !== key) {
        hit = { key, parts: boxesOfSeed(s, lv === 2 ? solid(s) : lv === 1 ? thinned(s) : box) };
        this.partCache.set(s.id, hit);
        this.arrivals.note(s.id, lv, hit.parts, arriveNow, arriveQuiet);
      }
      live.add(s.id);
      // FROZEN below the line: a building whose mass grew a quarter, or that gained a slot, is regenerated whole — but its
      // parts deeper than freezeSlots keep the shape (and the identity) they had, so the layers below do not reshuffle,
      // their fused chunks are not invalidated and absorbed parts do not pop back
      let parts = hit.parts;
      const fz = input.fuse.freezeSlots;
      if (fz !== undefined && fz >= 0) {
        const kFreeze = Math.floor(t / box.secPerUnit) - fz;
        let mine = this.frozen.get(s.id);
        if (!mine) this.frozen.set(s.id, (mine = new Map()));
        const fresh = new Map<number, Box[]>();
        for (const b of hit.parts) {
          const l = fresh.get(b.slot);
          if (l) l.push(b);
          else fresh.set(b.slot, [b]);
        }
        const out: Box[] = [];
        const slotsAll = new Set<number>([...fresh.keys(), ...mine.keys()]);
        for (const k of slotsAll) {
          if (k <= kFreeze) {
            let kept = mine.get(k);
            if (!kept) mine.set(k, (kept = fresh.get(k) ?? []));
            for (const b of kept) out.push(b);
          } else {
            for (const b of fresh.get(k) ?? []) out.push(b);
          }
        }
        // what fell below the history window is not kept
        for (const k of mine.keys()) if (k < floorK) mine.delete(k);
        parts = out;
      }
      // nothing below the history window (a carried seed still has its slots below it), nothing in a baked chunk
      for (const b of parts) if (b.slot >= floorK && !this.isBaked(b.slot)) built.push(b);
    }
    for (const id of this.partCache.keys()) if (!live.has(id)) this.partCache.delete(id);
    this.arrivals.keep(live);
    for (const id of this.frozen.keys()) if (!live.has(id)) this.frozen.delete(id);
    const w = input.weather;
    // vegetation around a part: the last vegetation history (if the view draws vegetation), at the part's cell and slot
    const h = this.history;
    const veg = h ? (b: Box) => natureAt(h, Math.floor(b.x / CELL), Math.floor(b.z / CELL), b.slot) ?? 0 : undefined;
    // waterways between buildings the same people built: nearness per (cell, slot) over the whole history
    this.waterCfg = input.water;
    // the PRESENT thickness (the slots above the rot onset): water and walkways laid there still change
    const presentSlots = Math.max(1, Math.round(rotOnsetSlots(input.weather)));
    this.presentSlots = presentSlots;
    this.foldTau = input.fold.tauSlabYears;
    // water from the sealed ground: open streams and buried pipes, laid anew where the quarter changed (rebuilt once
    // per slot, or when the buildings or the rule change)
    // (THE BLOCK: nothing laid is kept there — the whole is laid again — and somebody is always writing: at every new
    // cell and every slot it cost 0.1–0.9 s of the worker, more as the world grew. There it is laid again at most
    // every SLOW_MS, when anything was written since: slowKey)
    const dCfg = `${box.secPerUnit}:${presentSlots}:${JSON.stringify(input.water)}:${JSON.stringify(input.fold.flow ?? null)}`;
    const dKey = this.densityCfg ? this.slowKey("drain", dCfg) : `${Math.floor(t / box.secPerUnit)}:${seeds.length}:${dCfg}`;
    lapT = this.lap("parts", lapT);
    if (dKey !== this.drainKey) {
      this.drainKey = dKey;
      const rule = `${box.secPerUnit}:${presentSlots}:${JSON.stringify(input.water)}:${JSON.stringify(input.fold.flow ?? null)}`;
      // (THE BLOCK: with the density's buildings anybody may write at any depth, so nothing laid is kept as it was,
      // and the ground is read per slot from what stands in it — water.ts DrainageOptions.block)
      const inBlock = !!this.densityCfg;
      const kept = !inBlock && this.drainKept && this.drainKept.rule === rule ? this.drainKept : undefined;
      this.drain = drainage(this.events, seeds, input.water, { secPerUnit: box.secPerUnit, flow: input.fold.flow ?? DEFAULT_FLOW, tNow: t, frozen: kept, present: presentSlots, block: inBlock });
      // the slots before the present are done: what was laid there stays
      // only what lies below the present thickness is done; the present keeps changing
      const upToK = Math.floor(t / box.secPerUnit) - presentSlots;
      const streams = new Map<number, Float32Array[]>();
      for (const [k, c] of this.drain.streams) if (k <= upToK) streams.set(k, c);
      this.drainKept = { rule, pipes: this.drain.pipes.filter((p) => p.k <= upToK), streams, upToK };
    }
    this.nearWater = this.drain.streams.size ? waterField(this.drain, 0, Math.floor(t / box.secPerUnit), input.water) : null;
    // V2: walkways where the flow is sustained (laid where the walked network changed; rebuilt once per slot)
    const wk = input.walk && input.fold.flow?.enabled ? input.walk : null;
    const wCfg = `${box.secPerUnit}:${box.unit}:${JSON.stringify(wk)}:${JSON.stringify(input.fold.flow)}:${presentSlots}`;
    const wKey = wk ? (this.densityCfg ? this.slowKey("walk", wCfg) : `${Math.floor(t / box.secPerUnit)}:${seeds.length}:${wCfg}`) : "-";
    lapT = this.lap("water", lapT);
    if (wKey !== this.walkKey) {
      this.walkKey = wKey;
      const rule = `${box.secPerUnit}:${box.unit}:${presentSlots}:${JSON.stringify(wk)}:${JSON.stringify(input.fold.flow ?? null)}`;
      // (THE BLOCK: with the density's buildings anybody may write at any depth, so no layer is kept as it was)
      const kept = !this.densityCfg && this.walkKept && this.walkKept.rule === rule ? this.walkKept : undefined;
      this.walks = wk ? walkways(this.events, seeds, wk, { secPerUnit: box.secPerUnit, unit: box.unit, flow: input.fold.flow!, tNow: t, frozen: kept, present: presentSlots }) : NO_WALKWAYS;
      const upToK = Math.floor(t / box.secPerUnit) - presentSlots;
      this.walkKept = wk ? { rule, layers: this.walks.layers.filter((l) => l.k <= upToK), upToK } : null;
    }
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
    // one wear model for wearing and for what the parts become (its ages are cached per part)
    const wm = input.wear ? wearModel(seeds, t, wearCfg) : null;
    // the pipes' CORROSION on the same clock as the parts: a layer's pipes age from the end of their slot (plus the
    // rot onset, as the parts do), survival e^(−A / (tauSlab · steelLife · pipeLife)); decay = 1 − survival
    const pipeDecay = (k: number): number => {
      if (!input.wear || !w.strata || input.water.pipeLife <= 0) return 0;
      const laid = Math.min(t, (k + 1 + presentSlots) * box.secPerUnit);
      const A = Math.max(0, geoYears(t) - geoYears(laid)) * w.timeScale;
      return 1 - Math.exp(-A / (input.fold.tauSlabYears * w.steelLife * input.water.pipeLife));
    };
    // EROSION IN THE BLOCK (erode.ts): a part is gone by where it lies (depth below the top × how little its place was
    // lived in) — a place, not a clock, so nothing here moves unless somebody writes near it
    const ec = this.densityCfg && w.erode && w.erode.topSlot > 0 ? w.erode : null;
    if (ec) {
      const eKey = `${ec.order}:${ec.patch}:${ec.grain}`;
      if (eKey !== this.erodeKey) {
        this.erodeKey = eKey;
        this.erodeMemo = new WeakMap();
      }
    }
    lapT = this.lap("walk", lapT);
    const ero = ec ? erosion(seeds, ec, this.erodeMemo) : null;
    // (the count of layers is multiplied in — fuse.ts freshSlots: a factor 0 at the top … 1 from that many slots down,
    // the depth it is whole at differing from place to place in the erosion's patches)
    const fresh = Math.max(0, input.fuse.freshSlots ?? 0), spread = Math.max(0, Math.min(1, input.fuse.freshSpread ?? 0));
    const old = (slot: number, x?: number, z?: number): number => {
      if (!ec || fresh <= 0) return 1;
      const n = spread > 0 && x !== undefined && z !== undefined ? fresh * (1 + spread * (placeNoise(x, z, slot, ec.grain * 2) * 2 - 1)) : fresh;
      return Math.max(0, Math.min(1, (ec.topSlot - (slot + 0.5)) / Math.max(1e-6, n)));
    };
    // …and PART BY PART (the artist, 2026-11-15: "여전히 잘려 보이는 곳이 있어서 자연스럽게 생성된다는 느낌이 안 듦"):
    // read by the place alone, every part of a slot had the same value — the mass began on one plane, and in steps
    // where the unlived share changed. The old corrosion differed part by part (thin and exposed parts went first);
    // here a part's own threshold of the erosion (erode.ts: its patch, its kind, itself) shifts its value the same
    // way — what erodes first fuses first, the skeleton last — by the same `freshSpread`
    const own = (b: Box): number => {
      if (!ec || spread <= 0) return 1;
      let th = this.erodeMemo.get(b);
      if (th === undefined) this.erodeMemo.set(b, (th = erodeThreshold(b, ec)));
      return 1 + spread * (1 - 2 * th);
    };
    // ONE LIFE PER PART (the artist, 2026-11-15: "프로세듀럴하게 건물이 지어지고, 조건에 따라 식생이 모이고, 침식과
    // 융합이 진행되고 — 이전이랑 바뀐 것도 뭐 없어, 그냥 여기서 전 시간대에 대해 이걸 진행하는데 더 깊은 곳에선 빨리
    // 되도록 한다 정도? 근데 지금 함수로만 돌리니까 식생 먼저 렌더되고 건물 보이고 개판"). Read as functions of the
    // place alone, everything about a part was there the moment the part was — eroded, overgrown, fused — in whatever
    // order the results happened to reach the screen. Now a part has ONE number, its PROGRESS: nothing for `waitSec`
    // after it was placed (it is being built), then growing with the time since — as fast as its place weighs (the
    // erosion of its place: depth below the top × how little it was lived in, × the count of layers), all the way in
    // `lifeSec` at the deepest places. Everything that happens to a part is a threshold of that number, so it happens
    // in order: the plants gather, the part erodes when the progress passes its own threshold, the mass grows on it.
    const ageNow = this.ageClock;
    if (ec && lifeSec > 0) {
      // WHEN A CELL-SLOT WAS BUILT — its parts share that time (a building's parts are made again whenever it grows:
      // kept part by part, every growth would have been a new building). A cell-slot found standing when the wall
      // opened (the first reading, if it holds a world and not a first building) has lived one whole life of the
      // deepest places: its progress is its place's weight. One built MORE (its level rose: people came back and
      // stayed) is built anew — it starts over; what is lived in does not fossilise. One that is gone gives its time
      // back: built again later in the same place, it is new.
      const found = !this.ageBegun && built.length > 200;
      if (built.length) this.ageBegun = true;
      const live = new Set<number>();
      for (const sd of seeds) {
        if (!sd.levels) continue;
        live.add(sd.id);
        let m = this.bornT.get(sd.id);
        if (!m) this.bornT.set(sd.id, (m = new Map()));
        for (const [k, lv] of sd.levels) {
          const e = m.get(k);
          if (!e) m.set(k, { born: found ? ageNow - lifeSec - waitSec : ageNow, level: lv });
          else if (lv > e.level) {
            e.born = ageNow;
            e.level = lv;
          }
        }
        if (m.size > sd.levels.size) for (const k of m.keys()) if (!sd.levels.has(k)) m.delete(k);
      }
      if (this.bornT.size > live.size) for (const id of this.bornT.keys()) if (!live.has(id)) this.bornT.delete(id);
    }
    /** Seconds a part's cell-slot has been there past its wait, in the clock's shared steps (AGE_STEPS to `lifeSec`:
     *  all parts move at once, so nothing is worked out again between two steps). A part below its building's slots
     *  (a pile, a basement) goes with the building's first slot. */
    const step = lifeSec > 0 ? lifeSec / AGE_STEPS : 1;
    const aged = (b: Box): number => {
      const m = this.bornT.get(b.seed);
      if (!m) return 0;
      let e = m.get(b.slot);
      if (!e) {
        let lo = Infinity;
        for (const k of m.keys()) if (k < lo) lo = k;
        e = m.get(lo);
        if (!e) return 0;
      }
      return Math.max(0, Math.floor(ageNow / step) - Math.floor((e.born + waitSec) / step)) * step;
    };
    /** How fast a part's place lets it go on (0 … 1). */
    const weight = (b: Box): number => (ero ? Math.max(0, Math.min(1, ero.at(b) * old(b.slot, b.x, b.z))) : 0);
    /** A part's progress, 0 … 1. Without a life time (lifeSec 0) the place alone, as before. */
    const progMemo = new Map<Box, number>();
    const progress = (b: Box): number => {
      let v = progMemo.get(b);
      if (v === undefined) {
        const wgt = weight(b);
        v = lifeSec > 0 ? Math.min(1, (wgt * aged(b)) / lifeSec) : wgt;
        progMemo.set(b, v);
      }
      return v;
    };
    // the erosion reads the progress: a part is gone when it has passed the part's own threshold
    const amount = ec ? Math.min(1, Math.max(0, ec.amount)) : 0;
    const life: Erosion | null =
      ec && ero
        ? {
            at: progress,
            gone: (b) => {
              const e = progress(b) * amount;
              if (e <= 0) return false;
              let th = this.erodeMemo.get(b);
              if (th === undefined) this.erodeMemo.set(b, (th = erodeThreshold(b, ec)));
              return th < e;
            },
          }
        : null;
    // the plants come once the part is built: nothing during the wait, all of them a few steps on
    this.partSettled = ec && lifeSec > 0 ? (b: Box) => Math.min(1, aged(b) / (2 * step)) : null;
    this.blockClock = ec && ero ? { top: ec.topSlot, decay: (b) => Math.max(0, Math.min(1, progress(b) * own(b))), layer: (k) => erosionAt(k, 0, ec) * old(k), old, erode: ec } : null;
    const pipeErode = ec && ec.pipes !== false ? (p: PipeRun) => pipeErosion((p.ax + p.bx) / 2, (p.az + p.bz) / 2, Math.floor(p.k - input.water.pipeDepth), ec) : null;
    this.eroded = life && ec ? { ...life, feed: ec.feed } : null;
    const stands = life ? built.filter((b) => !life.gone(b)) : built;
    const worn = wm ? wearParts(stands, seeds, t, wearCfg, wm) : stands;
    // the weathering of every part: what it turns into (fuse.ts) follows it, on the structure itself
    this.wear = wm;
    this.wearCfg = wearCfg;
    // vegetation gathering on a part (0 … 1), by its depth below the present and the density around it
    const kNow = t / box.secPerUnit;
    this.gatherOf = w.strata ? (b: Box) => gatherAmount(kNow - (b.slot + 1), wearCfg) * gatherDensity(b, wearCfg) : null;
    this.built = built;
    this.worn = worn;
    const survival = this.fuseWear()?.survival;
    // a part being fused is absorbed into the mass, little by little (by a fixed hash): the mass takes its place.
    // Steel stays (it sticks out of the mass), and so does the skeleton until late (its form kept inside the mass).
    const fu = input.fuse;
    const fuSk = fu;
    const absorbed = (b: Box) => {
      // the steel stays out of the mass (it rusts and falls) — but for the share that fuses as fossil
      if (!survival || !fu.enabled || !(w.strata || this.blockClock) || (STEEL_KINDS.has(b.kind) && !(fu.steelFossil > 0 && partHash(b) < fu.steelFossil))) return false;
      const d = 1 - survival(b);
      if (isSkeleton(b, d, fuSk)) return false;
      // only as far as the mass that takes its place is already drawn (it is built a few chunks at a time)
      const f = fusedShare(Math.min(d, this.fusedAtOf(b) ?? 0), fu);
      // (THE BLOCK: the mass CLINGS to the building — fuse.ts absorb: how much of a fused part the mass takes the
      // place of; 0 = the part stays as it is under what has grown on it)
      const take = this.blockClock ? Math.max(0, Math.min(1, fu.absorb ?? 1)) : 1;
      return f > 0 && take > 0 && partHash(b) < Math.min(1, f * 1.6) * take;
    };
    const shown = worn.filter((b) => !absorbed(b));
    this.shown = shown;
    this.partsFuseBuilt = this.fuseBuilt; // the parts now reflect every mass chunk built so far
    // the baked chunks' parts, as they were (their shade kept too)
    const bakedBoxes: Box[] = [];
    const bakedShade: number[] = [];
    for (const bk of this.baked.values()) {
      for (let i = 0; i < bk.boxes.length; i++) {
        bakedBoxes.push(bk.boxes[i]);
        bakedShade.push(bk.shade[i]);
      }
    }
    const bakedOf = new Map<Box, number>();
    bakedBoxes.forEach((b, i) => bakedOf.set(b, bakedShade[i]));
    const all = bakedBoxes.length ? [...bakedBoxes, ...shown] : shown;

    const counts = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    for (const b of all) counts[b.kind] = Math.min(PART_CAPACITY[b.kind], counts[b.kind] + 1);
    const matrices = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 16)])) as Record<PartKind, Float32Array>;
    const colors = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 3)])) as Record<PartKind, Float32Array>;
    const fill = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    const born = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 2)])) as Record<PartKind, Float32Array>;
    const arriving = this.arrivals.any(arriveNow);
    const edgeCount = input.edges ? Math.min(EDGE_CAP, all.length) : 0;
    const edges = input.edges ? new Float32Array(edgeCount * 72) : null;
    let ei = 0;
    const m = new Float32Array(16);
    let minX = Infinity, minZ = Infinity, top = 0;
    for (const b of all) {
      const k = b.kind;
      const i = fill[k];
      if (i >= counts[k]) continue;
      fill[k]++;
      writeMatrix(matrices[k], i * 16, b);
      // weathering shows on the part itself: darker as it decays — grey only (human traces carry no colour);
      // a baked part keeps the shade it had
      const kept = bakedOf.get(b);
      const d = kept === undefined && survival ? 1 - survival(b) : 0;
      const g = kept ?? (0.86 + 0.14 * b.tone) * (1 - 0.4 * d) * (ero && ec && ec.shade > 0 ? 1 - ec.shade * ero.at(b) : 1);
      colors[k][i * 3] = g;
      colors[k][i * 3 + 1] = g;
      colors[k][i * 3 + 2] = g;
      const came = arriving ? this.arrivals.of(b) : undefined;
      born[k][i * 2] = came ? came[0] : ARRIVED;
      born[k][i * 2 + 1] = came ? came[1] : 0;
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
    // what a walkway's end can arrive at: a shown part (after wear) within a cell and a slot of it, or a point of a
    // line of another layer (a ramp's foot, a junction); the lines' weathering on the parts' clock (concrete)
    const walkWeigh = (() => {
      if (!input.walk) return undefined;
      const parts = new Set<string>();
      const cellOf = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.round(y / box.unit)},${Math.floor(z / CELL)}`;
      for (const b of shown) parts.add(cellOf(b.x, b.y, b.z));
      const onLine = otherLineNear(this.walks, box.unit);
      const anchored = (x: number, y: number, z: number, own: number) => {
        for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (parts.has(cellOf(x + dx * CELL, y + dy * box.unit, z + dz * CELL))) return true;
        return onLine(x, y, z, own);
      };
      const life = input.walk.life;
      const decayOf = (k: number): number => {
        if (!input.wear || !w.strata || life <= 0) return 0;
        const laid = Math.min(t, (k + 1 + presentSlots) * box.secPerUnit);
        const A = Math.max(0, geoYears(t) - geoYears(laid)) * w.timeScale;
        return 1 - Math.exp(-A / (input.fold.tauSlabYears * w.concreteLife * life));
      };
      // SNAP: the nearest shown part within two cells and a slot and a half of an end — the point of it closest to the
      // end (a turned part by its middle, kept within its height)
      const near = new Map<string, Box[]>();
      for (const b of shown) {
        const key = cellOf(b.x, b.y, b.z);
        const l = near.get(key);
        if (l) l.push(b);
        else near.set(key, [b]);
      }
      const snap = (x: number, y: number, z: number): [number, number, number] | null => {
        let best: [number, number, number] | null = null, bestD = Infinity;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
          for (const b of near.get(cellOf(x + dx * CELL, y + dy * box.unit, z + dz * CELL)) ?? []) {
            const turned = !!(b.yaw || b.tilt);
            const hx = turned ? 0 : b.sx / 2, hz = turned ? 0 : b.sz / 2, hy = (b.tilt ? Math.min(b.sx, b.sy, b.sz) : b.sy) / 2;
            const px = Math.max(b.x - hx, Math.min(b.x + hx, x)), py = Math.max(b.y - hy, Math.min(b.y + hy, y)), pz = Math.max(b.z - hz, Math.min(b.z + hz, z));
            const d = Math.hypot(px - x, (py - y) * 0.5, pz - z);
            if (d < bestD) [best, bestD] = [[px, py, pz], d];
          }
        }
        return bestD <= 2.5 * CELL ? best : null;
      };
      return { anchored, decayOf, snap };
    })();
    this.lap("emit", lapT);
    return {
      counts: fill,
      matrices,
      colors,
      born,
      bornEpochMs: this.arriveEpoch,
      edges: edges ? edges.subarray(0, ei * 72) : null,
      seeds: seeds.length,
      parts: all.length,
      farSeeds: far.size,
      baked: this.baked.size,
      links: this.drain.streams.get(Math.floor(t / box.secPerUnit))?.length ?? 0,
      pipeRuns: this.drain.pipes.length,
      // (THE BLOCK: the pipes erode as the parts do — by where a run lies, erode.ts pipeErosion; a run that is gone
      // is not drawn, the others carry how near they are to going, which the pipes' material draws as holes)
      pipes: pipeErode
        ? pipeParts(this.drain.pipes.filter((p) => pipeErode(p) < 1), box.unit, input.water, Math.floor(t / box.secPerUnit) - presentSlots + 1, (_k, p) => pipeErode(p))
        : pipeParts(this.drain.pipes, box.unit, input.water, Math.floor(t / box.secPerUnit) - presentSlots + 1, pipeDecay),
      walk: walkSegments(this.walks, Math.floor(t / box.secPerUnit) - presentSlots + 1, walkWeigh),
      streams: this.streamSegments(box.unit),
      t,
      top,
      minX,
      minZ,
    };
  }

  /** The vegetation's HISTORY around the focus (no points: the sediment vegetation is gone); null when nothing changed. */
  computeNature(input: NatureInput): PointsResult | null {
    const { box } = input;
    const seeds = this.ensureSeeds(input.fold);
    const spu = box.secPerUnit;
    const kNow = Math.floor(this.t / spu);
    const kFocus = Math.floor(Math.max(0, input.focusK) / NATURE_CHUNK) * NATURE_CHUNK;
    const k0 = Math.max(0, kFocus - input.window);
    const k1 = Math.min(kNow, kFocus + input.window);
    // THE SEDIMENT VEGETATION IS GONE (the artist, 2026-11-12: "끄라는 말 = 아예 영구제명"): no points are made, drawn
    // or tuned any more. What stays is the vegetation's HISTORY — the fused mass (computeFuse), the parts' corrosion
    // under plants and the gatherings on buildings (computeParts, computeReclaim) are read from it.
    const sig = `${this.seedsKey}:${JSON.stringify([box.secPerUnit, box.unit, input.nature, input.margin])}:${this.drainKey}:${k0}:${k1}`;
    if (sig === this.natureSig) return null;
    this.natureSig = sig;
    if (k1 < k0 || !this.events.length) return { position: new Float32Array(0), color: new Float32Array(0) };
    const near = this.nearWater;
    const wc = this.waterCfg;
    const waterBoost = near && wc && wc.vegBoost > 0 ? (ix: number, iz: number, k: number) => near(ix, iz, k) * wc.vegBoost : undefined;
    this.history = natureHistory({ events: this.events, seeds, secPerUnit: spu, k0, k1, margin: input.margin, nature: input.nature, fold: input.fold, waterBoost });
    return { position: new Float32Array(0), color: new Float32Array(0) };
  }

  /**
   * The fused mass of the old layers (fuse.ts), built in chunks of NATURE_CHUNK slots within the vegetation window
   * (or all slots without vegetation), at most FUSE_NEW_PER_CALL new chunks per call; null when nothing changed.
   */
  computeFuse(input: FuseInput): FuseMesh | null {
    const { box, fuse } = input;
    // THE BLOCK: its clock is a place — the "present" the layers are read against is the block's top, which stands
    const bc = this.blockClock;
    const sed = bc ? { tNow: bc.top * box.secPerUnit, secPerUnit: box.secPerUnit, timeScale: input.weather.timeScale, tauYears: input.weather.tauSedimentYears, graceSlots: 0 } : sedimentOf(this.t, box, input.weather);
    // (the block has no vegetation history: what gathers there is read in its place — blockHistory)
    const h = this.history ?? (bc && fuse.natureWeight > 0 ? this.blockHistory(bc.top) : null);
    const wm = this.fuseWear();
    const sig = `${this.partsSig}:${this.natureSig}:${JSON.stringify(input)}`;
    if (sig === this.fuseSig) return null;
    if (input.bake === false && this.baked.size) this.baked.clear();
    const bakedMeshes = [...this.baked.values()].map((b) => b.mesh);
    if (!sed || !wm || !fuse.enabled || !this.built.length) {
      this.fuseSig = sig;
      this.fuseChunks.clear();
      this.fusedAt.clear();
      this.districtMass.clear();
      return mergeMeshes(fuse.enabled ? bakedMeshes : []);
    }
    const u = box.unit;
    const kNow = bc ? bc.top : Math.floor(this.t / box.secPerUnit);
    // V2: one clock — the layers' age for the resin and the look of the old layers is the parts' corrosion
    // (the block: the erosion of the parts' places; a slot without parts is read by its depth alone)
    // (…read by its depth alone, not as the mean of the parts lying in it: in the block the two are one clock already —
    // and a mean over the whole slot moved whenever anybody wrote anywhere in it, which made every district of the
    // chunk be fused again for a look that had changed by a hair)
    const layerDecay = input.oneClock ? (bc ? bc.layer : this.layerClockOf(layerDecayOf(sed.tNow, box.secPerUnit, input.weather, input.tauSlabYears ?? DEFAULT_FOLD.tauSlabYears))) : undefined;
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
    this.standingNow = standing;
    // THE BLOCK: what the erosion has taken leaves no mass (or `goneMass` of it), and the skeleton stays inside
    const gone = bc ? Math.max(0, Math.min(1, fuse.goneMass ?? 0)) : 1;
    const skCfg = fuse;
    const q20 = (v: number) => Math.round(v * 20) / 20;
    type P = { b: Box; d: number; up: boolean; sk: boolean; ang: number };
    // the angle each seed's district is turned by (fuseTiled)
    const angleOf = new Map<number, number>();
    if (box.variety) for (const sd of this.seeds) angleOf.set(sd.id, districtOf(sd.x, sd.z, box.variety).angle);
    const bySlot = new Map<number, P[]>();
    for (const b of this.built) {
      if (STEEL_KINDS.has(b.kind) || b.kind === "drip") continue; // too thin to carry mass or growths
      const up = standing.has(b);
      let d = q20(1 - wm.survival(b));
      if (!up && gone < 1) {
        if (gone <= 0) continue;
        d = q20(d * gone);
      }
      // not corroding yet: nothing grows on it (B FILL: the plates are kept, they bound the rooms of the parts below)
      if (fusedShare(d, fuse) <= 0 && accretionShare(d, fuse) <= 0.01 && !(fuse.study?.fill && FRAME_KINDS.has(b.kind))) continue;
      const e: P = { b, d, up, sk: isSkeleton(b, d, skCfg), ang: angleOf.get(b.seed) ?? 0 };
      const l = bySlot.get(b.slot);
      if (l) l.push(e);
      else bySlot.set(b.slot, [e]);
    }
    const pad = fusePad(fuse);
    const padSlots = Math.ceil((Math.max(pad.above, pad.below) * fuse.voxel + fuse.accDepth) / u) + 1 + (fuse.study?.fill ? FILL_MAX_GAP : 0);
    // the age clock in the keys moves once per chunk of slots (it only tints and pits), not every slot
    const clockKey = Math.floor(sed.tNow / (box.secPerUnit * NATURE_CHUNK));
    // each chunk's grid covers ITS parts (± a margin), not the whole ground: as the flocks moved over the world the
    // ground grew wider and every chunk's grid passed fuseChunk's size limit — an empty mesh everywhere (the artist,
    // 2026-11-01: "the bots move differently, but the fossil visual is gone")
    type Want = { c0: number; c1: number; ps: P[]; tubes: BakedTube[]; key: string; x0: number; z0: number; nx: number; nz: number };
    const MARGIN = 3; // cells: the blur, the sag and the shell reach a little beyond the parts
    const extentOf = (ps: P[], tubes: BakedTube[]) => {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (const { b: p } of ps) {
        const r = Math.max(p.sx, p.sy, p.sz) / 2;
        a = Math.min(a, p.x - r);
        b = Math.max(b, p.x + r);
        c = Math.min(c, p.z - r);
        d = Math.max(d, p.z + r);
      }
      for (const t of tubes) {
        a = Math.min(a, t.x0 - t.r, t.x1 - t.r);
        b = Math.max(b, t.x0 + t.r, t.x1 + t.r);
        c = Math.min(c, t.z0 - t.r, t.z1 - t.r);
        d = Math.max(d, t.z0 + t.r, t.z1 + t.r);
      }
      const ex0 = Math.floor(a / CELL) - MARGIN, ez0 = Math.floor(c / CELL) - MARGIN;
      return { x0: ex0, z0: ez0, nx: Math.ceil(b / CELL) + MARGIN - ex0, nz: Math.ceil(d / CELL) + MARGIN - ez0 };
    };
    const wants: Want[] = [];
    for (let c0 = Math.floor(kA / NATURE_CHUNK) * NATURE_CHUNK; c0 <= kB; c0 += NATURE_CHUNK) {
      if (this.baked.has(c0)) continue; // done: kept as it was
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
      // the external parts reaching into the chunk (pipes lie below their slot, ramps rise above theirs)
      const tubes = this.tubesOf(c0 - padSlots - 3, c1 + padSlots + 3, fuse, u, input.weather, layerDecay);
      if (!ps.length && !tubes.length) continue;
      let tsum = 0;
      for (const tb of tubes) tsum += tb.decay * 13 + tb.x0 + tb.z1 + tb.y0 * 3;
      let vs = 0;
      if (h) for (let k = Math.max(c0 - padSlots, h.k0); k <= Math.min(c1 + padSlots, h.k0 + h.nk - 1); k++) {
        const off = (k - h.k0) * h.nx * h.nz;
        for (let i = 0; i < h.nx * h.nz; i++) vs += h.V[off + i] * ((i % 13) + 1);
      }
      const ex = extentOf(ps, tubes);
      wants.push({ c0, c1, ps, tubes, ...ex, key: `${ps.length}:${tubes.length}:${tsum.toFixed(2)}:${sum.toFixed(3)}:${vs.toFixed(3)}:${clockKey}:${JSON.stringify(fuse)}:${input.tauReclaimYears}:${ex.x0},${ex.z0},${ex.nx},${ex.nz}` });
    }
    // build order: chunks with no mesh yet first, then stale ones; each nearest to where the camera looks first
    // (oldest-first starved the upper chunks — where the buildings are — while the lower ones kept changing)
    const focus = input.focusK ?? kNow;
    const dist = (w: Want) => Math.abs((w.c0 + w.c1) / 2 - focus);
    const floorK = Number.isFinite(this.cutS) ? Math.floor(this.cutS / box.secPerUnit) : -Infinity;
    /** About to leave the history window: the two chunks just above the cut. */
    // … and so are the chunks about to fall below the vegetation window (kA, which follows the focus): a live chunk
    // outside it is not asked for any more, and would vanish with its mass
    const immK = input.immutable !== undefined ? kNow - input.immutable : -Infinity;
    // (the immutable line is only WHERE a chunk is baked — not a build priority: giving the chunks above it the first
    // turn starved the band where the fusion shows, 2026-10-31 night)
    // V2: the chunks that have just crossed the immutable line come first — built fresh, baked on the next call, gone
    // from the list. (With the window's cut as the criterion they were first forever: not bakeable above the line,
    // stale every slot, and the band where the fusion shows never got a turn — the artist, 2026-11-01)
    // BAKING OFF: nothing leaves the list by being baked, so nothing may be "first" — a chunk first forever starved the
    // band and its mass ended flat at a chunk boundary (the artist, 2026-11-01 evening: "the tops are cut sharp")
    const leaving =
      input.bake === false
        ? () => false
        : input.immutable !== undefined
          ? (w: Want) => w.c1 < immK
          : (w: Want) => w.c1 < Math.max(floorK, kA) + 2 * NATURE_CHUNK;
    // BAKING (before building): a chunk with a mesh from an earlier call, whose parts have since been drawn against it
    // (absorbed as far as it goes), is kept as it is from now on when it is done — about to leave the history window,
    // or every part in it fully decayed well below the present. A leaving chunk is kept with the latest mesh it has,
    // current or not: at a fast time rate (the world moving every tick) no mesh is ever current, and what is kept a
    // little stale beats what vanishes with the cut
    const doneK = kNow - Math.max(1, Math.round(rotOnsetSlots(input.weather))) - NATURE_CHUNK;
    let bakedNow = 0;
    if (input.bake !== false && this.partsFuseBuilt === this.fuseBuilt) {
      for (const w of wants) {
        const ch = this.fuseChunks.get(w.c0);
        if (!ch) continue;
        const fresh = ch.key === w.key;
        if (input.immutable !== undefined) {
          // THE IMMUTABLE LAYER: baked once its top lies below the line, as it is then; nothing else, ever
          if (w.c1 >= immK || input.caughtUp === false) continue;
        } else {
          // V1: about to leave the history window, or every part fully decayed well below the present
          if (!fresh && !leaving(w)) continue;
          let done = fresh && w.c1 < doneK;
          if (done) for (const e of w.ps) if (e.b.slot >= w.c0 && e.b.slot <= w.c1 && e.d < BAKE_DECAY) { done = false; break; }
          if (done) for (const b of this.built) if (b.slot >= w.c0 && b.slot <= w.c1 && 1 - wm.survival(b) < BAKE_DECAY) { done = false; break; }
          if (!leaving(w) && !done) continue;
        }
        const boxes = this.shown.filter((b) => b.slot >= w.c0 && b.slot <= w.c1);
        const shade = new Float32Array(boxes.length);
        boxes.forEach((b, i) => { shade[i] = (0.86 + 0.14 * b.tone) * (1 - 0.4 * (1 - wm.survival(b))); });
        // what the chunk was made from — its material: rendered again with another look (a paused view), and read
        // again at a later present (the past keeps ageing until it is a fossil)
        const ageK0 = w.c0 - padSlots - 3, ageK1 = w.c1 + padSlots + 8;
        const src: Baked["src"] = {
          parts: w.ps.map((e) => e.b),
          basis: w.ps.map((e) => wm.basis(e.b)),
          decay: w.ps.map((e) => e.d),
          standing: w.ps.map((e) => e.up),
          skeleton: w.ps.map((e) => e.sk),
          tubes: w.tubes,
          history: h ? sliceHistory(h, ageK0, ageK1) : null,
          x0: w.x0,
          z0: w.z0,
          nx: w.nx,
          nz: w.nz,
          unit: u,
          sediment: sed,
          t0: this.t,
          cfgKey: JSON.stringify(fuse),
        };
        const bk: Baked = { c0: w.c0, c1: w.c1, mesh: ch.mesh, rendered: true, final: input.immutable !== undefined, agedT: this.t, boxes, shade, nature: null, src };
        // below the immutable line the mesh must be the chunk's final look: rendered once from its material if stale
        if (input.immutable !== undefined && !fresh) this.renderBaked(bk, fuse, layerDecay);
        this.baked.set(w.c0, bk);
        this.persist(bk);
        this.fuseChunks.delete(w.c0);
        this.chunks.delete(w.c0);
        bakedNow++;
      }
    }
    const todo = wants.filter((w) => !this.baked.has(w.c0) && this.fuseChunks.get(w.c0)?.key !== w.key);
    // the chunks about to leave the window come first (so they are baked with a mesh as current as can be), then
    // chunks with no mesh yet, then the stale ones LEAST RECENTLY BUILT first (a round robin), nearest to where the
    // camera looks as the tie-break. With time running, every chunk whose parts corrode is stale on every call;
    // nearest-first then fed the two chunks by the focus forever and starved the fusing band below — in the shared
    // view the mass showed only once a chunk left the window and was baked (the artist, 2026-10-20: "the lab's look
    // does not appear in the global view however fast time runs")
    const builtAt = (w: Want) => this.fuseChunks.get(w.c0)?.built ?? -1;
    todo.sort((a, b) => Number(leaving(b)) - Number(leaving(a)) || Number(this.fuseChunks.has(a.c0)) - Number(this.fuseChunks.has(b.c0)) || builtAt(a) - builtAt(b) || dist(a) - dist(b));
    const perCall = Math.max(1, input.perCall ?? FUSE_NEW_PER_CALL);
    this.stages["fuse chunks waiting (n)"] = todo.length;
    const fuseKey = JSON.stringify(fuse);
    // THE BLOCK: a call fuses for about FUSE_BUDGET_MS (the paused view: as long as it takes) — a chunk that ran out of
    // time keeps a key that is not its own, so it comes round again, and its districts already done are not done twice
    this.fuseDeadline = bc && perCall <= FUSE_NEW_PER_CALL ? performance.now() + FUSE_BUDGET_MS : Infinity;
    let partial = false;
    for (const w of todo.slice(0, perCall)) {
      this.stages["fuse chunks (n)"] = (this.stages["fuse chunks (n)"] ?? 0) + 1;
      this.fuseLeft = null;
      const mesh = this.fuseTiled(w, h, u, sed, layerDecay, fuse, fuseKey);
      const left = this.fuseLeft as Set<number> | null;
      if (left) partial = true;
      this.fuseBuilt++;
      this.fuseChunks.set(w.c0, { key: left ? `${w.key}~` : w.key, mesh, built: this.fuseBuilt });
      // (the parts of a district left for the next call are absorbed only as far as its last mass went)
      const was = left ? this.fusedAt.get(w.c0) : undefined;
      const fa = new Map<number, number>();
      for (const e of w.ps) {
        if (e.b.slot < w.c0 || e.b.slot > w.c1) continue;
        const key = SpaceModel.partKey(e.b);
        if (left && left.has(Math.round(e.ang * 1e4) / 1e4)) {
          const d0 = was?.get(key);
          if (d0 !== undefined) fa.set(key, d0);
        } else fa.set(key, e.d);
      }
      for (const tb of w.tubes) if (tb.box && tb.k >= w.c0 && tb.k <= w.c1) fa.set(SpaceModel.partKey(tb.box), tb.decay);
      this.fusedAt.set(w.c0, fa);
      if (performance.now() > this.fuseDeadline) {
        partial = true; // (what is left of this call's chunks waits for the next)
        break;
      }
    }
    this.fuseDeadline = Infinity;
    let pending = todo.length > perCall || partial;
    // WORK MODE (rebake): the baked layers rendered again with the current look, within what is left of this call's
    // budget — the world below stays, its rendering follows the settings
    let budget = Math.max(1, perCall - Math.min(todo.length, perCall));
    const cfgKey = JSON.stringify(fuse);
    for (const bk of this.baked.values()) {
      // restored from disk (no mesh yet), or a paused view with a changed look: rendered again from its material
      if (bk.rendered && (!input.rebake || bk.src.cfgKey === cfgKey)) continue;
      if (budget <= 0) {
        pending = true;
        break;
      }
      this.renderBaked(bk, fuse, layerDecay);
      budget--;
    }
    // THE PAST KEEPS AGEING: one baked chunk per call, the one longest unread, once the present has moved on a step
    if (budget > 0 && this.wearCfg) {
      let pick: Baked | null = null;
      let more = 0;
      for (const bk of this.baked.values()) {
        if (bk.final || !bk.rendered || bk.src.mesh || this.t - bk.agedT < AGE_STEP_S) continue;
        more++;
        if (!pick || bk.agedT < pick.agedT) pick = bk;
      }
      if (pick) {
        this.ageBaked(pick, fuse, input.weather, layerDecay);
        if (more > 1) pending = true;
      }
    }
    const out: FuseMesh[] = [...this.baked.values()].map((b) => b.mesh);
    const keep = new Set<number>();
    for (const w of wants) {
      if (this.baked.has(w.c0)) continue;
      keep.add(w.c0);
      const ch = this.fuseChunks.get(w.c0); // fresh, or the stale one until its turn comes
      if (ch) out.push(ch.mesh);
    }
    for (const c of this.fuseChunks.keys()) {
      if (keep.has(c)) continue;
      const ch = this.fuseChunks.get(c)!;
      this.fuseChunks.delete(c);
      this.fusedAt.delete(c);
      for (const id of this.districtMass.keys()) if (id.startsWith(`${c}:`)) this.districtMass.delete(id);
      // ORPHAN: a chunk with a mesh that is no longer asked for — its parts went with a bulk window move, or the
      // window moved past it before it was baked — keeps its last mesh for good rather than vanishing (the artist,
      // 2026-10-31: "the fossils vanish after a while"); no material, so it neither ages nor re-renders
      if (input.bake === false || ch.mesh.index.length === 0 || this.baked.has(c)) continue;
      const bk: Baked = {
        c0: c,
        c1: c + NATURE_CHUNK - 1,
        mesh: ch.mesh,
        rendered: true,
        final: true,
        agedT: this.t,
        boxes: [],
        shade: new Float32Array(0),
        nature: null,
        src: { parts: [], basis: [], decay: [], standing: [], skeleton: [], tubes: [], history: null, x0, z0, nx, nz, unit: u, sediment: sed, t0: this.t, cfgKey: JSON.stringify(fuse), mesh: ch.mesh },
      };
      this.baked.set(c, bk);
      out.push(ch.mesh);
      this.persist(bk);
    }
    // something was baked: the parts and points of those slots are now the baked ones (the next computeParts /
    // computeNature see it through their signatures)
    if (!pending && !bakedNow) this.fuseSig = sig;
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
    let gathering = wm && fu ? (b: Box) => gatheringShare(1 - wm.survival(b), fu, pre ? pre(b) : 0) : undefined;
    if (input.unlived) {
      const byId = new Map(this.seeds.map((sd) => [sd.id, sd] as const));
      // tied to the erosion (erode.ts feed): plants gather where it erodes — and stay in the place of what is gone
      const er = this.eroded;
      // (a part's plants come after the part: nothing while it is being built — partSettled)
      const settled = this.partSettled ?? (() => 1);
      gathering = er && er.feed > 0 ? (b: Box) => settled(b) * Math.min(1, (byId.get(b.seed)?.gather?.get(b.slot) ?? 0) + er.feed * er.at(b)) : (b: Box) => settled(b) * (byId.get(b.seed)?.gather?.get(b.slot) ?? 0);
    }
    const { fuse: _f, unlived: _u, ...cfg } = input;
    void _f;
    void _u;
    // (with the erosion feeding them, the gatherings keep the shape of the parts that went: `built`, not `worn`)
    const on = input.unlived && this.eroded && this.eroded.feed > 0 ? this.built : this.worn;
    const np = reclaimPoints(this.built, on, this.seeds, this.t, { ...cfg, gathering });
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
  | { type: "events"; add: PEvent[]; reset?: boolean; keepBuilt?: boolean; epoch?: string | null }
  | { type: "compute"; id: number; now?: number; parts?: PartsInput; nature?: NatureInput; reclaim?: ReclaimInput; fuse?: FuseInput; paths?: { rise: number; smooth?: number } };

/**
 * Two compute requests as one (the worker coalesces what queued up behind a long compute): the newer request's
 * clock and parts, with the vegetation / fuse / reclaim work the older one asked for and the newer did not — those
 * come only every NATURE_EVERY ticks and must not be lost with the request that carried them.
 */
export function mergeComputeRequests<T extends Extract<SpaceRequest, { type: "compute" }>>(prev: T | null, next: T): T {
  if (!prev) return next;
  return { ...next, nature: next.nature ?? prev.nature, reclaim: next.reclaim ?? prev.reclaim, fuse: next.fuse ?? prev.fuse, paths: next.paths ?? prev.paths };
}

/** What the space worker posts back for a compute request. */
export interface SpaceResponse {
  /** Milliseconds per stage of this request (SpaceModel.stages). */
  stages?: Record<string, number>;
  type: "result";
  id: number;
  /** undefined = not asked; null = unchanged. */
  parts?: PartsResult | null;
  nature?: PointsResult | null;
  reclaim?: PointsResult | null;
  fuse?: FuseMesh | null;
  /** The paths as lines (density.ts pathLines): [x, y, z, x, y, z] per segment. */
  paths?: Float32Array | null;
  ms: number;
}

/**
 * One request against a model (the worker's message handler, also used on the main thread as a fallback).
 * Returns the response and the buffers to transfer, or null for an events message.
 */
export function handleSpaceRequest(model: SpaceModel, m: SpaceRequest): { out: SpaceResponse; transfer: ArrayBuffer[] } | null {
  if (m.type === "events") {
    if (m.epoch !== undefined) model.setEpoch(m.epoch);
    if (m.reset) model.reset(!!m.keepBuilt);
    model.add(m.add);
    return null;
  }
  const t0 = performance.now();
  model.stages = {};
  const timed = <T>(name: string, f: () => T): T => {
    const a = performance.now();
    const r = f();
    model.stages[name] = (model.stages[name] ?? 0) + performance.now() - a;
    return r;
  };
  if (m.now !== undefined) model.setNow(m.now);
  const out: SpaceResponse = { type: "result", id: m.id, ms: 0 };
  const transfer = new Set<ArrayBuffer>();
  if (m.parts) {
    out.parts = model.computeParts(m.parts);
    if (out.parts) {
      for (const a of Object.values(out.parts.matrices)) transfer.add(a.buffer as ArrayBuffer);
      for (const a of Object.values(out.parts.colors)) transfer.add(a.buffer as ArrayBuffer);
      for (const a of Object.values(out.parts.born)) transfer.add(a.buffer as ArrayBuffer);
      if (out.parts.edges) transfer.add(out.parts.edges.buffer as ArrayBuffer);
      for (const m of [out.parts.pipes.live, out.parts.pipes.kept]) transfer.add(m.cylinders.buffer as ArrayBuffer).add(m.elbows.buffer as ArrayBuffer);
      for (const a of [out.parts.walk.live, out.parts.walk.kept, out.parts.walk.liveW, out.parts.walk.keptW, out.parts.walk.liveU, out.parts.walk.keptU, out.parts.walk.liveEnds, out.parts.walk.keptEnds]) transfer.add(a.buffer as ArrayBuffer);
    }
  }
  if (m.nature) {
    out.nature = timed("nature", () => model.computeNature(m.nature!));
    if (out.nature) transfer.add(out.nature.position.buffer as ArrayBuffer).add(out.nature.color.buffer as ArrayBuffer);
  }
  if (m.reclaim) {
    out.reclaim = timed("reclaim", () => model.computeReclaim(m.reclaim!));
    if (out.reclaim) transfer.add(out.reclaim.position.buffer as ArrayBuffer).add(out.reclaim.color.buffer as ArrayBuffer);
  }
  if (m.paths && m.parts) {
    out.paths = timed("paths", () => model.computePaths(m.parts!.box.unit, m.paths!.rise, m.paths!.smooth ?? 4));
    if (out.paths) transfer.add(out.paths.buffer as ArrayBuffer);
  }
  if (m.fuse) {
    out.fuse = timed("fuse", () => model.computeFuse(m.fuse!));
    if (out.fuse) for (const a of [out.fuse.position, out.fuse.normal, out.fuse.color, out.fuse.extra, out.fuse.index]) transfer.add(a.buffer as ArrayBuffer);
  }
  out.ms = performance.now() - t0;
  out.stages = { ...model.stages };
  return { out, transfer: [...transfer] };
}
