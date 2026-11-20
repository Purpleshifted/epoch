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
import { FILL_MAX_GAP, FRAME_KINDS, accretionShare, fuseChunk, fusePad, fusedShare, gatheringShare, isSkeleton, mergeMeshes, partReach, type FuseConfig, type FuseMesh, type FuseTube } from "./fuse";
import { WALL_BUILD } from "./build";
import { inferFuture, type FutureConfig, type FutureResult } from "./futureVillage";
import { fuseTilesOf, growData, unitExtent, unitLook, type UnitFused, type UnitJob, type UnitRequest } from "./fuseUnits";
import { NATURE_KIND, burialOf, natureAt, natureHistory, type NatureHistory, naturePointLoad, naturePoints, reclaimPoints, type NaturePoints } from "./natureHistory";
import { hash2, type NatureConfig } from "./nature";
import { ARRIVED, Arrivals } from "./arrive";
import { PART_KINDS, RECIPES, boxesOfSeed, carrySeeds, districtOf, gatherAmount, gatherDensity, halfHeight, rotOnsetSlots, occupiedSlots, partHash, seedsFromSnapshot, survivalFromBasis, wearModel, wearParts, type Box, type BoxConfig, type PartKind, type Seed, type WearBasis, type WearConfig } from "./seeds";
import { bakedKey, clearBaked, loadBaked, saveBaked, type BakedTube } from "./bakeStore";
import { DEFAULT_FOLD, type FoldConfig, type PEvent } from "./types";
import { DEFAULT_FLOW } from "./flow";
import { NO_WALKWAYS, otherLineNear, walkSegments, walkways, type WalkConfig, type WalkLayer, type WalkRequest, type WalkResult, type Walkways } from "./walkways";
import { NO_DRAINAGE, drainage, pipeParts, waterDistance, waterField, type Drainage, type PipeParts, type PipeRun, type WaterConfig } from "./water";

const CELL = CELL_SIZE;
/** In the layer above the column (computeFuture, FutureConfig.under): when a kind of part that stands on the ground
 *  goes, 0 (first) … 1 (last) — the body before the slabs, those before the beams and braces, the columns last. */
const FUTURE_GO: Record<string, number> = { drip: 0, mass: 0.2, slab: 0.5, beam: 0.7, brace: 0.7, column: 1 };
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
/** THE BLOCK: a tile is this many cells (the old wall: 24). A tile is fused in one go — the budget cannot stop it —
 *  and at the exhibition's fine voxels (0.25) a full tile of 24 took over a second. */
const BLOCK_TILE = 14;
/** THE EROSION'S TICK: a part that stands (its leaving time), and how long a part that has gone is still handed to
 *  the wall (s: longer than the wall's knob for how long a part takes to go). */
const STANDS = 1e9;
/** SEEDED: a building's mass is not made again sooner than this after it was made (ms). */
const UNIT_REST_MS = 12000;
/** THE MASS MADE IN A WORKER OF ITS OWN: a call here spends no longer than this telling it what the buildings are made
 *  of (the rest are told at the next call). */
const UNIT_SEND_MS = 80;
/** THE FOSSIL AS A FIELD (fuse.ts field): its material is looked over again no more often than this (ms) — a change
 *  costs the view a few bricks of its field, not a piece of mesh, so it need not rest as long as a ground's job. */
const FIELD_REST_MS = 2000;
/** Floats a box of the field's material: x, y, z, sx, sy, sz, yaw, kind (0 plate · 1 body · 2 foundation), slot, the
 *  age's clock when it hardened (slots), own (sooner or later), most (how much of it the vegetation makes). */
export const FOSSIL_BOX = 12;

/** What of the fossil's material is other than it was (fuse.ts field). A key said again = that box is other than it
 *  was. */
export interface FossilDiff {
  /** The view's field this is said to (fuse.ts field). */
  token: number;
  /** Nothing said before stands: these are all of it. */
  reset: boolean;
  /** FOSSIL_BOX floats a box. */
  add: Float32Array;
  /** The boxes' keys (partKey), in the order of `add`. */
  keys: Float64Array;
  /** Boxes that are no more. */
  drop: Float64Array;
  /** How many boxes the material holds now. */
  n: number;
}
/** Whether the pipes and the ways fuse with the seeded mass (sendUnits): off — see there. */
const SEEDED_TUBES: boolean = false;
/** A round of ways asked of the other worker that has not come back within this is asked again (ms). */
const WALK_LOST_MS = 180000;
const LEAVE_KEEP_S = 20;
const FUSE_BUDGET_MS = 300;
/** THE BLOCK: a part's age is read in this many steps to `lifeSec` (the steps are the clock's: all parts move at once). */
const AGE_STEPS = 6;
/** …and each patch of the block moves on at one of this many beats within a step (the parts are read at every beat). */
const AGE_PHASES = 6;

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
  /**
   * THE LAYER ABOVE ALONE (the artist, 2026-11-17: "합치고 미래 워커 나눠"; the view `?only=future`, lib/parliament
   * /futureOnly.ts, docs/world-review-2026-11-17-future-worker.md): no part of the present is made — the buildings'
   * density, the water and the ways (what the layer reads) still are, and the layer is asked for with them; every
   * part, its erosion, its fossil and its assets are left out. The bots run on the bot server; this view only reads.
   */
  futureOnly?: boolean;
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
  /** THE BLOCK: every built cell-slot as the wall shows it — [cell x, cell z, slot, seconds since it was built (−1 =
   *  long there), how far it has gone on × how much of it goes] — what the vegetation gives way to. */
  cells?: Float32Array;
  counts: Record<PartKind, number>;
  /** 16 floats per instance, per kind (only `counts[kind]` used). */
  matrices: Record<PartKind, Float32Array>;
  /** 3 floats per instance (grey tone), per kind. */
  colors: Record<PartKind, Float32Array>;
  /** LEAVING (the erosion's tick): 1 float per instance, per kind — when the part goes (s since `bornEpochMs`;
   *  STANDS = it does not). The wall's shader takes it out from then on. */
  gone: Record<PartKind, Float32Array>;
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
  /**
   * THE FOSSIL THAT HAS GONE IS LET GO (the artist, 2026-11-20: "삭아서 사라지는 화석 데이터를 실제로 버려서 데이터 플로우가
   * 적정선에서 유지되도록 하고 있는가" — it was not: a fossil whose life was over was only not drawn; its mass stayed in
   * its piece's mesh, was made again with it, and went through the vertex shader every frame). The wall's life as the
   * shader reads it (ParliamentSpace FUSE_GROW_VERT_BODY growT): how much the depth slows the age (`deep`), the slots
   * of the top's way a part stands before its fossil begins (`after`), and the ruler's value at which every pixel of
   * it is surely gone (`at`). A part past that is no longer part of the seeded mass — its pieces are made again
   * without it, in batches. Not part of the fusion's settings: moving the life's knobs makes nothing again but the
   * pieces whose parts are other than they were. Absent = nothing is let go (no life, or one that never ends).
   */
  dead?: { deep: number; at: number; after: number };
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
    if (this.units.size || this.fieldToken) return this.unitFused.get(SpaceModel.partKey(b));
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
  /** THE EROSION'S TICK: per building and part (partKey), how eroded it was at the last reading and when it goes
   *  (STANDS while it stands; −Infinity = it was gone before anybody looked). */
  private erodeSeen = new Map<number, Map<number, [number, number]>>();
  /** SEEDED: how deep in the window a part lies when the erosion takes it ([the settings it holds for, the depth]). */
  private goneDepth = new WeakMap<Box, [string, number]>();
  // ── SIMPLIFIED WITH TIME (computeParts) ──
  /** Per building and slot: the ASSET its parts were made into once it had stood long enough — the masses it is made
   *  of (`src`: its own, and what was built over it and taken in), its plates and foundation as they were (`kept`),
   *  the clock of what it was first made from; the cell-slot's clock as of the last building taken in; whether new
   *  building stands over it now, of which generation and its parts; and when the parts it took the place of began
   *  to go (the arrival clock). */
  private assets = new Map<number, Map<number, { src: Box[]; kept: Box[]; clock: { born: number; top: number }; seenBorn: number; over: Box[] | null; gen: number; swapAt: number; swapped: Box[] }>>();
  /** The assets of ONE BUILDING IN ONE SLOT as they are drawn: their masses joined (latticeUnion), kept while the
   *  assets in it are the same. */
  private assetGroups = new Map<string, { sig: string; boxes: Box[]; units: Box[] | null }>();
  /**
   * THE FOSSIL'S UNITS (the artist, 2026-11-20: "부재 단순화에 스텝을 정해서, '모양은 변하지 않지만 여튼 더 크게 어림한 단순화
   * 부재' 단계를 만들고, 화석화는 그걸 단위로 진행하든가"). A second step of the simplification that is NOT drawn: the same
   * masses of a building's slot joined on a wider lattice (ErodeConfig.lodUnit) — fewer, larger bodies with the
   * building's outline roughly kept. The seeded mass is made of THEM instead of the asset's own boxes: each is one
   * unit the fossil grows out of (the wall's shader presses a vertex to its unit), so the mass comes lump by lump
   * of a building, not sliver by sliver of its many boxes. Empty = the asset's own boxes, as before.
   */
  private fossilUnits: Box[] = [];
  /** An asset's boxes go on by the clock of what they were first made from, whatever is built over them later. */
  private assetClock = new WeakMap<Box, { born: number; top: number; stood?: number }>();
  /** New building over an asset: when each of its parts arrives ([born, order], as arrive.ts). */
  private lodArrive = new WeakMap<Box, [number, number]>();
  /** A building's parts in another layout (generation g: what is built over an asset is not what was built first). */
  private lodVariants = new Map<string, Map<number, Box[]>>();

  /**
   * MASSES JOINED, THEIR SHAPE KEPT (the artist, 2026-11-16: "이웃끼리도 합치고 … 합쳤을 때 모양 유지시키기는
   * 어려움?"). Not the bounds of them all (a box that fills every gap and squares the building off) and not an exact
   * boolean union either: the masses are laid on a LATTICE in the building's own frame — `grid` wide on the ground,
   * `gy` tall — each lattice cell a column from the lowest to the highest mass over it; and the columns are joined
   * into as few boxes as will cover them (runs along x of the same height, then rows of the same run along z). What
   * comes out has the outline of the masses to the lattice's width, whoever's they were: the masses of neighbouring
   * cells of one building are one body. A wider lattice is a simpler body.
   */
  private static latticeUnion(masses: readonly Box[], grid: number, gy: number): Box[] {
    if (!masses.length) return [];
    const r = Math.max(0.05, grid), ry = Math.max(0.05, gy);
    const yaw = masses[0].yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
    // every lattice cell under a mass: the lowest and the highest of the masses over it (in steps of `gy`)
    const cols = new Map<number, [number, number]>();
    const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
    for (const q of masses) {
      // (into the frame the building is turned by: writeMatrix's turn undone)
      const lx = q.x * c - q.z * sn, lz = q.x * sn + q.z * c;
      const same = Math.abs((q.yaw ?? 0) - yaw) < 1e-6;
      const hx = same ? q.sx / 2 : Math.max(q.sx, q.sz) / 2, hz = same ? q.sz / 2 : Math.max(q.sx, q.sz) / 2;
      const i0 = Math.floor((lx - hx) / r + 0.5), j0 = Math.floor((lz - hz) / r + 0.5);
      const i1 = Math.max(i0 + 1, Math.floor((lx + hx) / r + 0.5)), j1 = Math.max(j0 + 1, Math.floor((lz + hz) / r + 0.5));
      const y0 = Math.floor((q.y - q.sy / 2) / ry + 0.5), y1 = Math.max(y0 + 1, Math.floor((q.y + q.sy / 2) / ry + 0.5));
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const k = key(i, j), was = cols.get(k);
          if (was) {
            if (y0 < was[0]) was[0] = y0;
            if (y1 > was[1]) was[1] = y1;
          } else cols.set(k, [y0, y1]);
        }
      }
    }
    // joined in a fixed order (z, then x), so the same masses always come out as the same boxes
    const order = [...cols.keys()].sort((p, q) => (p % 65536) - (q % 65536) || p - q);
    const used = new Set<number>();
    const out: Box[] = [];
    for (const k0 of order) {
      if (used.has(k0)) continue;
      const i = Math.floor(k0 / 65536) - 32768, j = (k0 % 65536) - 32768;
      const [y0, y1] = cols.get(k0)!;
      const fits = (ii: number, jj: number) => {
        const kk = key(ii, jj), v = cols.get(kk);
        return !!v && !used.has(kk) && v[0] === y0 && v[1] === y1;
      };
      let w = 1;
      while (fits(i + w, j)) w++;
      let h = 1;
      for (;;) {
        let row = true;
        for (let d = 0; d < w && row; d++) row = fits(i + d, j + h);
        if (!row) break;
        h++;
      }
      for (let dj = 0; dj < h; dj++) for (let di = 0; di < w; di++) used.add(key(i + di, j + dj));
      const lx = (i + w / 2) * r, lz = (j + h / 2) * r;
      out.push({ ...masses[0], kind: "mass", x: lx * c + lz * sn, z: -lx * sn + lz * c, y: ((y0 + y1) / 2) * ry, sx: w * r, sy: (y1 - y0) * ry, sz: h * r, yaw, tilt: undefined });
    }
    return out;
  }
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
  private bornT = new Map<number, Map<number, { born: number; level: number; top: number; stood?: number }>>();
  /** How far a part's plants have come since it was built (0 during its wait … 1): the gatherings read it. */
  private partSettled: ((b: Box) => number) | null = null;
  private ageClock = 0;
  /** How many times a cell-slot that had begun to go on was lived in again (the parts are read again when it moves). */
  private renewals = 0;
  /** THE RISING WINDOW: the slot below which everything has been let go (computeParts). */
  private floorDone = -Infinity;
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
  // ── THE MASS BUILDING BY BUILDING (fuseBuildings) ──
  /** Which building a cell-run belongs to: per Seed, its runs of slots with the building's id. */
  private buildingRuns: { key: string; of: Map<number, { k0: number; k1: number; id: string }[]> } | null = null;
  /** Each building's mass as shown, with the state it was made from (part → decay) and its pieces kept for reuse. */
  private units = new Map<string, { cfg: string; snap: Map<number, number>; mesh: FuseMesh; at: number; madeMs: number; pieces: Map<string, { sig: string; mesh: FuseMesh }> }>();
  /** The one building being made now: the state it is made from, the pieces still to do and those done. */
  private unitJob: {
    id: string;
    cfg: string;
    snap: Map<number, number>;
    ang: number;
    /** (seeded: the building's parts as they stand in the world, with what each one's progress is made of) */
    parts: { b: Box; grow?: number[] }[];
    h: NatureHistory | null;
    look: ((k: number) => number) | undefined;
    todo: { key: string; sig: string; k0: number; k1: number; tx: number; tz: number; ps: { b: Box; d: number; up: boolean; sk: boolean }[] }[];
    done: Map<string, { sig: string; mesh: FuseMesh }>;
  } | null = null;
  /** Masses of buildings that are no longer a building of their own (joined to another): shown until that one is made again. */
  private unitOrphans: { mesh: FuseMesh; heir: string; heirAt: number }[] = [];
  /** part → the decay it has in the mass shown (fusedAtOf, building by building). */
  private unitFused = new Map<number, number>();
  private unitsVersion = 0;
  private unitsEmitted = -1;
  // ── THE MASS MADE IN A WORKER OF ITS OWN (fuseUnits.ts) ──
  /** The other side (side.worker.ts FuseUnits); null = the mass is made here, as before. */
  private fusePort: MessagePort | null = null;
  /** Whether the other side is making the buildings' mass now (the seeded mass only). */
  private remoteOn = false;
  private remoteAbsorb = false;
  private unitSerial = 0;
  // ── THE FOSSIL AS A FIELD ON THE GPU (fuse.ts field): what the view has been told its material is ──
  private fieldToken = 0;
  private fieldSnap = new Map<number, number>();
  private fieldOut: { reset: boolean; add: number[]; keys: number[]; drop: number[] } | null = null;
  private fieldAt = 0;
  // ── THE WAYS LAID IN A WORKER OF THEIR OWN (side.worker.ts) ──
  private walkPort: MessagePort | null = null;
  /** The round asked of it (one at a time), and what its answer will be kept under. */
  private walkAsked: { rule: string; upToK: number; serial: number; at: number } | null = null;
  private walkSerial = 0;
  /** Rises with every answer: the parts are read again (the ways' lines and their ends). */
  private walkRev = 0;
  private walkMs = 0;

  /**
   * THE WORKERS BESIDE THIS ONE (2026-11-16; the artist: "3은 중요할 것 같음"): the buildings' mass and the ways are
   * each worked out in a worker of their own, so neither keeps the buildings waiting — with her values a round of
   * ways was 10.8 s and a piece of mass 1.5–4.5 s, in the worker the buildings are made in. null = that work is
   * done here again (the other side could not start).
   */
  attachPorts(p: { fuse?: MessagePort | null; walk?: MessagePort | null }): void {
    if (p.fuse !== undefined) {
      if (this.fusePort) this.fusePort.onmessage = null;
      if (this.remoteOn) this.dropUnits();
      this.fusePort = p.fuse;
      if (p.fuse) {
        p.fuse.onmessage = (ev: MessageEvent<UnitFused>) => {
          if (ev.data.type !== "fused" || !this.remoteOn) return;
          // these parts have a mass on the screen now: they are absorbed only as far as that (fusedAtOf)
          for (const k of ev.data.keys) this.unitFused.set(k, 1);
          if (this.remoteAbsorb && ev.data.keys.length) this.fuseBuilt++;
        };
      }
    }
    if (p.walk !== undefined) {
      if (this.walkPort) this.walkPort.onmessage = null;
      this.walkPort = p.walk;
      this.walkAsked = null;
      if (p.walk) {
        p.walk.onmessage = (ev: MessageEvent<WalkResult>) => {
          const a = this.walkAsked;
          if (ev.data.type !== "walks" || !a || ev.data.serial !== a.serial) return;
          this.walkAsked = null;
          // (what the window has let go of since the round was asked is not brought back)
          const layers = ev.data.walks.layers.filter((l) => l.k >= this.floorDone);
          this.walks = { layers };
          this.walkKept = { rule: a.rule, layers: layers.filter((l) => l.k <= a.upToK), upToK: a.upToK };
          this.walkMs = ev.data.ms;
          this.walkRev++;
        };
      }
    }
  }

  /** What the pipes and ways of each ground were when it was last told (sendUnits). */
  private unitTubes = new Map<string, string>();

  /** THE PIPES AND WAYS BY WHERE THEY LIE (kind, slot, the cell of their middle): since when something has lain there,
   *  when it was last seen, and — once hardened — the runs and lines as they lay then. */
  private tubeSeen = new Map<string, { k: number; first: number; seen: number; hard: (FuseTube & { born?: number })[] | null }>();

  /**
   * THE PIPES AND WAYS HARDEN BEFORE THEY FUSE (the artist, 2026-11-16: "길이랑 파이프는 화석화 연결 안 되고 있음, 변화해서
   * 그런지. 이것들도 '중간 굳히기' 단계 만들어야 하나?"). In the window they are laid again and again as people write, and
   * what was handed to the fusion was other every time. Two rules were tried and watched in the artist's window the
   * same evening, and neither let one in: "a run that has lain exactly so for a while" (the lines are drawn anew
   * every round, never exactly as before), and "a slot hardens once the top has risen past it" (people write at any
   * depth: most runs are laid in slots that had hardened empty). So, as a building's cell-slot is simplified once it
   * has stood long enough: A PLACE — a cell of the ground in a slot — where a pipe (or a way) has lain for as long as
   * the simplification takes, however it was redrawn meanwhile, hardens: the runs and lines through it are taken AS
   * THEY LIE AT THAT MOMENT and kept — the fusion's from then on, whatever is laid there afterwards, until the
   * window lets go of the slot. Their age is counted from the window's top at that moment (`born`).
   */
  private seededTubes(fuse: FuseConfig, u: number): (FuseTube & { born?: number })[] {
    const bc = this.blockClock;
    // (by the clock on the wall: the model's own time is the latest thing written, and does not run on in the block)
    const now = Date.now() / 1000, hardenS = Math.max(20, bc?.erode.lodSec ?? 40), GRACE_S = 25;
    const here = new Map<string, FuseTube[]>();
    for (const t of this.tubesNow(fuse, u)) {
      const key = `${t.kind}:${t.k}:${Math.floor((t.x0 + t.x1) / 2 / CELL)}:${Math.floor((t.z0 + t.z1) / 2 / CELL)}:${Math.abs(t.y1 - t.y0) > Math.abs(t.x1 - t.x0) + Math.abs(t.z1 - t.z0) ? "v" : "h"}`;
      const l = here.get(key);
      if (l) l.push(t);
      else here.set(key, [t]);
    }
    for (const [key, l] of here) {
      const e = this.tubeSeen.get(key);
      if (!e) this.tubeSeen.set(key, { k: l[0].k, first: now, seen: now, hard: null });
      else {
        e.seen = now;
        if (!e.hard && now - e.first >= hardenS) e.hard = l.map((t) => ({ ...t, born: bc ? bc.top : t.k }));
      }
    }
    const out: (FuseTube & { born?: number })[] = [];
    let soft = 0;
    for (const [key, e] of this.tubeSeen) {
      // (let go with its slot; or — not yet hard — nothing has lain there for a while)
      if (e.k < this.floorDone || (!e.hard && now - e.seen > GRACE_S)) this.tubeSeen.delete(key);
      else if (e.hard) for (const t of e.hard) out.push(t);
      else soft++;
    }
    this.stages["pipes and ways hardening (places)"] = soft;
    this.stages["pipes and ways hardened (n)"] = out.length;
    return out;
  }

  /** The pipes and ways as they lie now, as tubes whole (the mass as it will be: the wall's shader lets it out). */
  private tubesNow(fuse: FuseConfig, u: number): FuseTube[] {
    const kMax = Infinity;
    const out: FuseTube[] = [];
    const wc = this.waterCfg;
    if (fuse.fusePipes && wc) {
      const yOf = (k: number) => (k - wc.pipeDepth) * u;
      for (const p of this.drain.pipes) {
        if (p.k > kMax) continue;
        if (p.k0 !== undefined) out.push({ x0: p.ax, y0: yOf(p.k0), z0: p.az, x1: p.ax, y1: yOf(p.k), z1: p.az, r: wc.pipeRadius * wc.shaftRadius, decay: 1, kind: "pipe", k: p.k });
        else out.push({ x0: p.ax, y0: yOf(p.k), z0: p.az, x1: p.bx, y1: yOf(p.k), z1: p.bz, r: wc.pipeRadius * Math.pow(Math.max(1, p.flow), wc.flowGain), decay: 1, kind: "pipe", k: p.k });
      }
    }
    if (fuse.fuseWalks) {
      for (const l of this.walks.layers) {
        if (l.k > kMax) continue;
        for (const line of l.lines) for (let i = 3; i + 2 < line.length; i += 3) out.push({ x0: line[i - 3], y0: line[i - 2], z0: line[i - 1], x1: line[i], y1: line[i + 1], z1: line[i + 2], r: fuse.walkRadius, decay: 1, kind: "walk", k: l.k });
      }
    }
    return out;
  }

  /**
   * THE GROUND CELLS THE WAYS CROSS, per slot k0 … k1 (keys cx × 65536 + cz, as futureVillage.ts has them). The walk
   * worker's layers are written only where a way is laid or the ways in use change (walkways.ts), so a slot without
   * a layer of its own is read from the last one at or under it; a way's line is the one it was last drawn with.
   */
  private waysBySlot(k0: number, k1: number): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    const layers = [...this.walks.layers].sort((a, b) => a.k - b.k);
    if (!layers.length) return out;
    const lineOf = new Map<string, Float32Array>();
    const cellsOf = new Map<Float32Array, number[]>();
    const cells = (line: Float32Array): number[] => {
      let c = cellsOf.get(line);
      if (c) return c;
      c = [];
      for (let i = 3; i + 2 < line.length; i += 3) {
        const ax = line[i - 3], az = line[i - 1], bx = line[i], bz = line[i + 2];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5)));
        for (let q = 0; q <= n; q++) c.push(Math.floor((ax + ((bx - ax) * q) / n) / CELL) * 65536 + Math.floor((az + ((bz - az) * q) / n) / CELL));
      }
      cellsOf.set(line, c);
      return c;
    };
    let i = 0, cur: WalkLayer | null = null, set: Set<number> | null = null;
    for (let k = k0; k <= k1; k++) {
      let moved = false;
      while (i < layers.length && layers[i].k <= k) {
        const l = layers[i++];
        for (let q = Math.min(l.drawn.length, l.lines.length) - 1; q >= 0; q--) lineOf.set(l.drawn[q], l.lines[q]);
        cur = l;
        moved = true;
      }
      if (!cur) continue;
      if (moved || !set) {
        set = new Set<number>();
        for (const key of cur.links) {
          const line = lineOf.get(key);
          if (line) for (const c of cells(line)) set.add(c);
        }
      }
      out.set(k, set);
    }
    return out;
  }

  /**
   * THE WAYS AS THEIR OWN LINES (the artist, 2026-11-17, of the layer's paths drawn cell by cell: "길 격자 없다가 이건
   * 뭐 어디서 생긴 거야??" → "매끄러운 선이 나음"): the lines the walk worker laid, as they lie — those in use at slot
   * `k`, each as [x0, z0, x1, z1] stretches; the ones also in use at `k - half` are the frame (`old`).
   */
  private waysLinesAt(k: number, half: number): { roads: Float32Array; roadsOld: Float32Array } {
    const layers = [...this.walks.layers].sort((a, b) => a.k - b.k);
    const lineOf = new Map<string, Float32Array>();
    let atK: string[] = [], atHalf: string[] = [];
    for (const l of layers) {
      if (l.k > k) break;
      for (let q = Math.min(l.drawn.length, l.lines.length) - 1; q >= 0; q--) lineOf.set(l.drawn[q], l.lines[q]);
      atK = l.links;
      if (l.k <= k - half) atHalf = l.links;
    }
    const old = new Set(atHalf);
    const roads: number[] = [], roadsOld: number[] = [];
    for (const key of atK) {
      const line = lineOf.get(key);
      if (!line) continue;
      const out = old.has(key) ? roadsOld : roads;
      for (let i = 3; i + 2 < line.length; i += 3) out.push(line[i - 3], line[i - 1], line[i], line[i + 2]);
    }
    return { roads: Float32Array.from(roads), roadsOld: Float32Array.from(roadsOld) };
  }

  /** The villages that have lived by time `t` (s) as the wild forest's regions — [x, z, radius, its number]; all of
   *  them if none has yet. A village gone keeps its region (its ground is still its own forest's), so the regions
   *  change only when one is born — step 1 of re-laying only what changed (the artist, 2026-11-18). */
  private regionsAt(t: number): [number, number, number, number][] {
    const vs = this.waterCfg?.villages;
    if (!vs) return [];
    const all = vs.sites.map((q, i) => [q[0], q[1], q[4] ?? vs.radius, q[2], i] as const);
    const born = all.filter((q) => q[3] <= t);
    return (born.length ? born : all).map((q) => [q[0], q[1], q[2], q[4]]);
  }

  private futureKey = "";
  private futureAt = 0;
  /** What the last layer read, summed up (computeFuture: made again only when it changed). */
  private futureDigest = "";
  /** The plants and trees of the last layer made, each by its place, kind and size — to tell how much of the layer the
   *  next one keeps as it was (readout "future plants kept from the last (%)": step 1 of re-laying only what changed). */
  private futureSeen: Set<string> | null = null;
  /**
   * THE INFERRED VILLAGE above the column (futureVillage.ts): read off the latest slots of the window — made again
   * when the top has come a slot further, or (at most every few seconds) when something was written or a knob turned.
   * null = as it was.
   */
  computeFuture(cfg: FutureConfig, box: BoxConfig): FutureResult | null {
    const bc = this.blockClock, field = this.densityState?.field;
    if (!cfg.on || !bc || !field) {
      if (this.futureKey === "-") return null;
      this.futureKey = "-";
      return { k: 0, parts: {}, tones: {}, roads: new Float32Array(0), roadsOld: new Float32Array(0), water: new Float32Array(0), pipes: new Float32Array(0), mounds: new Float32Array(0), stains: new Float32Array(0), veg: new Float32Array(0), ground: new Float32Array(0), n: { stand: 0, left: 0, grown: 0, road: 0, blocked: 0 } };
    }
    // THE COLUMN'S TOP IS WHERE THE BUILDING HAS COME TO, not the window's top (seen in the artist's window,
    // 2026-11-16: the window's top stood at slot 2846 while nothing was built above 2835 — in a young world, 50 slots
    // of air; read from the window's top, the latest slots were empty and nothing was inferred). The newest slot in
    // which more than a stray cell is built: at least three cells, and a fiftieth of the fullest slot.
    const count = new Map<number, number>();
    let most = 0;
    for (const sd of this.seeds) {
      if (!sd.levels) continue;
      for (const [kk, lv] of sd.levels) {
        if (lv < 1) continue;
        const c = (count.get(kk) ?? 0) + 1;
        count.set(kk, c);
        if (c > most) most = c;
      }
    }
    let K = -Infinity;
    const need = Math.max(3, most / 50);
    for (const [kk, c] of count) if (c >= need && kk > K) K = kk;
    // …BUT NOT ABOVE THE WINDOW'S TOP (seen in the artist's window, 2026-11-17, the rise stopped at a top of slot 90:
    // the layer read slot 94 — the upper storeys of buildings begun under the top stand above it, where nobody
    // lives. Read from there, the half of the band called "lately" was those storeys only, and all but 4 of 243
    // buildings counted as left before the end). The newest slot at or under the top's that is built so; none
    // there (a view that is told no top): as it was.
    const under = Math.floor(bc.top) - 1;
    if (K > under) {
      let k2 = -Infinity;
      for (const [kk, c] of count) if (c >= need && kk <= under && kk > k2) k2 = kk;
      if (k2 !== -Infinity) K = k2;
    }
    if (K === -Infinity) K = Math.floor(bc.top) - 1;
    const now = performance.now();
    const key = `${K}:${JSON.stringify(cfg)}:${box.unit}:${box.secPerUnit}`, full = `${key}:${this.version}`;
    if (full === this.futureKey || (this.futureKey.startsWith(`${key}:`) && now - this.futureAt < 6000)) return null;
    this.futureKey = full;
    this.futureAt = now;
    // THE WAYS AND THE PIPES ARE GIVEN TO IT (stage 0 of the order of 2026-11-17; the artist: "0단계 시작"). The layer
    // asked the density's field for the paths — and the field has had none since the ways are laid by the walk worker
    // (its own paths are off: ParliamentSpace, path.step 1e9): in every readout since the layer was made it found no
    // path at all, so no frame was drawn and no ground counted as trodden. A cell is path in a slot when a way in
    // use then crosses it (waysBySlot); the pipes are every run laid.
    const ways = this.waysBySlot(K - Math.max(4, Math.round(cfg.band)), K);
    // NOTHING IT READS HAS CHANGED, SO NOTHING IS MADE AGAIN (step 2 of re-laying only what changed — the artist,
    // 2026-11-18: "변한 곳만 재배치하도록 해서 리소스 덜 쓰고"): the layer reads the slots up to K — the buildings' levels
    // there, the ways, the water — and the bots write into the present, above it. So what it reads is summed up (in
    // an order that does not matter) and, the same as last time with the same knobs, the last layer stands: the
    // worker is spared the whole inference every few seconds while the slot has not moved.
    {
      let hs = 0, ns = 0, hw = 0, hr = 0;
      const mix = (a: number, b: number) => Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35);
      for (const s of this.seeds) {
        if (!s.levels) continue;
        const sx = Math.round(s.x * 97), sz = Math.round(s.z * 89);
        for (const [kk, l] of s.levels)
          if (kk <= K) {
            hs = (hs + mix(mix(sx, sz), kk * 131 + Math.round(l * 7))) | 0;
            ns++;
          }
      }
      for (const [kk, set] of ways) for (const c of set) hw = (hw + mix(kk, c)) | 0;
      const backK = K - Math.max(4, Math.round(cfg.band)) - Math.ceil(Math.max(cfg.water?.grow ?? 0, cfg.water?.fade ?? 0)) - 2;
      for (const [kk, list] of this.drain.streams) {
        if (kk > K || kk < backK) continue;
        for (const line of list) if (line.length >= 2) hr = (hr + mix(mix(kk, line.length), mix(Math.round(line[0] * 50), Math.round(line[line.length - 1] * 50)))) | 0;
      }
      const digest = `${key}|${hs}:${ns}|${hw}|${hr}|${this.drain.pipes.length}|${JSON.stringify(bc.erode)}`;
      if (digest === this.futureDigest) {
        this.stages["future skipped, nothing it reads changed (n)"] = (this.stages["future skipped, nothing it reads changed (n)"] ?? 0) + 1;
        return null;
      }
      this.futureDigest = digest;
    }
    const tInfer = performance.now();
    const plan0 = inferFuture({ k: K, cells: this.seeds, pathAt: (cx, cz, k) => ways.get(k)?.has(cx * 65536 + cz) ?? false, streams: this.drain.streams, pipes: this.drain.pipes, regions: this.regionsAt((K + 0.5) * box.secPerUnit), cfg });
    // (the ways as the walk worker's own smooth lines, unless the knob says the cells)
    const plan = cfg.smoothRoads === false ? plan0 : { ...plan0, ...this.waysLinesAt(K, Math.floor(Math.max(4, Math.round(cfg.band)) / 2)) };
    // THE BUILDINGS ARE MADE AS THE COLUMN'S ARE (the artist, 2026-11-16, of the first version's plain boxes: "너무 좀...
    // 단조롭고 … 건물도 마찬가지 · generative 하다고 느껴지지 않는 것도 아쉽고"): each inferred building is a Seed of
    // its own — the built cell it is carried on from, standing in the slots above the column's top — put through the
    // same generator (seeds.ts boxesOfSeed: its plinth, columns, slabs, masses and their bundles of slats), complete
    // at once and without the drips. Its number is the cell's, so it stands as it is while the cell is inferred so.
    const spu = box.secPerUnit;
    const lists: Record<string, Box[]> = {};
    let gone = 0, footings = 0, fallen = 0, toEnd = 0, unheld = 0;
    // (the plants over the ruins: records of the plants' own kind, laid on the layer's ground, at (K + 1) slots in the
    // parts' frame — and joined to the plants' records below)
    const cover: number[] = [], coverK = Math.max(0, Math.min(1, cfg.cover ?? 0)), groundY = (K + 1) * box.unit;
    // (the surfaces that are left to stand on — the kept bodies, slabs and plinths — by their ground cell, the world
    // wrapping: what the plants and trees on the ruins are set on, below)
    const WORLD = 160 * CELL, wrapCell = (c: number) => ((c % 160) + 160) % 160, surfKey = (cx: number, cz: number) => wrapCell(cx) * 160 + wrapCell(cz);
    const surf = new Map<number, Box[]>();
    for (const bld of plan.buildings) {
      const sd = bld.from;
      const rc = box.recipe ?? RECIPES[sd.material];
      const s0 = K + 1, s1 = K + bld.h;
      const mass = sd.masses?.get(K) ?? sd.masses?.get(K - 1) ?? sd.mass;
      const levels = new Map<number, number>(), masses = new Map<number, number>();
      for (let k = s0; k <= s1; k++) {
        levels.set(k, 1);
        masses.set(k, mass);
      }
      // (its number is the cell's: what is found stands as it is. `fresh` — a shape drawn anew whenever the column's
      // top came a slot further — is no longer set by the inference: nobody builds in what is found)
      const fs: Seed = { ...sd, id: ((bld.cx * 73856093) ^ (bld.cz * 19349663) ^ sd.id ^ (bld.fresh ? Math.imul(K, 0x9e3779b1) : 0)) >>> 0, x: (bld.cx + 0.5) * CELL, z: (bld.cz + 0.5) * CELL, t0: s0 * spu, t1: (s1 + 1) * spu - 1, spans: [[s0 * spu, (s1 + 1) * spu - 1]], mass, levels, masses, gather: undefined, who: undefined, growth: undefined };
      const fcfg: BoxConfig = { ...box, buildSlots: 0, timeJitter: 0, recipe: { ...rc, slat: { ...rc.slat, density: rc.slat.density * 0.5, maxPerMass: Math.min(16, rc.slat.maxPerMass) }, drip: { ...rc.drip, perArea: 0, max: 0 } } };
      // WHAT IS LEFT OF IT (the layer is what is found after the people are gone — futureVillage.ts): its parts are
      // taken away as the column's own erosion takes them — each part's own threshold, in the same order of kinds —
      // as far as the building is gone (1 − left, × how far gone the whole layer is: FutureConfig.ruin).
      const goneTo = Math.max(0, Math.min(1, (1 - bld.left) * (0.4 + 1.2 * Math.max(0, Math.min(1, cfg.ruin ?? 0.5)))));
      // WHAT STANDS ON THE GROUND GOES FIRST, WHAT IS UNDER IT STAYS (stage 1 of the order of 2026-11-17; the artist:
      // "1단계 진행"; FutureConfig.under). Shallow buried things are out of erosion's reach and far likelier to be kept
      // than what stands on the surface (Zalasiewicz et al. 2014: 지층 T5; the foundations' cuts are part of the
      // deposit themselves: Edgeworth et al. 2015, T4). So a part goes by its kind AND ITS HEIGHT: from the top down
      // the body, the slabs, the beams and braces, the columns; the plinth (on the ground) all but never; the basement
      // and the piles (under it) not at all. The patches of the column's erosion still say which corner goes first.
      // Off: the column's own order (erodeThreshold), as before.
      const under = cfg.under !== false;
      const footY = s0 * box.unit, spanY = Math.max(1e-6, (s1 + 1 - s0) * box.unit);
      const rank = (b: Box): number => {
        if (!under) return erodeThreshold(b, bc.erode);
        if (b.kind === "basement" || b.kind === "pile") return 2;
        const own = erodeThreshold(b, { ...bc.erode, order: 0 });
        if (b.kind === "plinth") return 0.9 + 0.2 * own;
        const up = Math.max(0, Math.min(1, (b.y - footY) / spanY));
        return (FUTURE_GO[b.kind] ?? 0.5) * 0.5 + (1 - up) * 0.3 + own * 0.2;
      };
      // LIVED IN TO THE END, OR LEFT BEFORE IT (stage 3 of the order of 2026-11-17; the artist: "3단계 진행";
      // FutureConfig.fate). Where the people went away all at once and far, a structure's timbers are found in place;
      // where they moved near and the village lived on, a left structure's roof is found stripped — reused (the rule
      // of thumb of the Pueblo studies, Churchill 2002 after Varien and Schiffer: 지층 T9; a village shrinks plot by
      // plot while its frame stays, Jones et al. 2006: 정주 S6). So: of a building that STOOD WHEN THE END CAME, what
      // has gone from it has FALLEN — it lies at its foot, laid flat and broken smaller, nothing carried off. One LEFT
      // BEFORE the end was STRIPPED by those who lived on: its body, slabs, beams and braces are gone whatever the
      // layer's decay says — the more the longer it had been left (all of it after three slots) — and nothing of it
      // lies there; its columns and footings stand as the decay leaves them.
      const fate = cfg.fate !== false, since = bld.since ?? 0;
      if (since === 0) toEnd++;
      const lastSteel = Math.max(0, Math.min(1, cfg.last?.steel ?? 0)), lastPile = Math.max(0, Math.min(1, cfg.last?.pile ?? 0));
      // (how far: the knob's share, reached over half the band after it was left — FutureConfig.strip)
      const stripMax = Math.max(0, Math.min(1, cfg.strip ?? 0.4)), stripHalf = Math.max(3, Math.round(cfg.band) / 2);
      const stripTo = fate && since > 0 ? Math.max(goneTo, stripMax * Math.min(1, since / stripHalf)) : goneTo;
      const standing: Box[] = [];
      for (const b of boxesOfSeed(fs, fcfg)) {
        // (the kinds' shares: FutureConfig.partShare — a part of a kind kept at less than all is dropped by its own number)
        const share = cfg.partShare?.[b.kind];
        if (share !== undefined && share < 1 && hash2(Math.round(b.x * 811) ^ b.seed, Math.round(b.z * 797) ^ Math.round(b.y * 787), 6211) >= share) continue;
        const body = b.kind === "mass" || b.kind === "slab" || b.kind === "beam" || b.kind === "brace" || b.kind === "drip";
        // STEEL AND PILES LAST (the artist, 2026-11-17: "철골이랑 말뚝만 관리하는 것도 추가해줘. 걔들은 오래 남을 것 같아서";
        // FutureConfig.last): by their knob's share they hold against the layer's decay — and steel against being
        // stripped too — 1 = they stand whatever else has gone
        const lastBy = STEEL_KINDS.has(b.kind) ? lastSteel : b.kind === "pile" ? lastPile : 0;
        const r0 = rank(b), held = r0 + (2 - r0) * lastBy;
        if (held >= (body ? stripTo : goneTo) * (1 - (STEEL_KINDS.has(b.kind) ? lastSteel : 0))) {
          standing.push(b);
          continue;
        }
        if (b.kind === "mass") gone++;
        if (!fate || since > 0 || b.kind === "drip" || b.kind === "pile") continue;
        // (fallen: its thinnest side up, on the ground beside where it stood, a little askew)
        const h = (salt: number) => hash2(Math.round(b.x * 997) ^ b.seed, Math.round(b.z * 991) ^ Math.round(b.y * 983), salt);
        const d = [b.sx, b.sy, b.sz].sort((p, q) => p - q);
        (lists[b.kind] ??= []).push({ ...b, sx: d[2] * 0.7, sy: d[0], sz: d[1] * 0.7, x: b.x + (h(6101) - 0.5) * CELL * 0.9, z: b.z + (h(6102) - 0.5) * CELL * 0.9, y: footY + d[0] / 2 + h(6103) * 0.25 * box.unit, yaw: h(6104) * Math.PI, tilt: (h(6105) - 0.5) * 0.35 });
        fallen++;
      }
      // NOTHING HANGS IN THE AIR (the artist, 2026-11-17: "허공에 남는 건축부재는 없어야 할 것 같은데"): what stands is
      // kept from the ground up — a part stays only if it rests on the ground (its foot at the building's foot, or
      // below it: the foundations) or on a part kept under it whose footprint it overlaps; a drip only if what it
      // hangs from is kept. What lost its support has fallen — beside where it stood, if the building stood to the
      // end (nothing carried off), and gone if it was left before.
      const tol = 0.15 * box.unit;
      const ext = (q: Box): [number, number] => (q.tilt ? [Math.max(q.sx, q.sy, q.sz) / 2, Math.max(q.sx, q.sy, q.sz) / 2] : [q.sx / 2, q.sz / 2]);
      const over = (a: Box, q: Box) => {
        const [ax, az] = ext(a), [qx, qz] = ext(q);
        return Math.abs(a.x - q.x) <= ax + qx && Math.abs(a.z - q.z) <= az + qz;
      };
      const bot = (q: Box) => q.y - halfHeight(q), top = (q: Box) => q.y + halfHeight(q);
      const kept: Box[] = [], drips: Box[] = [], lost: Box[] = [];
      for (const a of standing.filter((q) => q.kind !== "drip").sort((p, q) => bot(p) - bot(q))) {
        if (bot(a) <= footY + tol || kept.some((q) => top(q) >= bot(a) - tol && bot(q) < bot(a) && over(a, q))) kept.push(a);
        else lost.push(a);
      }
      for (const a of standing) if (a.kind === "drip") (kept.some((q) => bot(q) <= top(a) + tol && top(q) >= top(a) - tol && over(a, q)) ? drips : lost).push(a);
      for (const b of kept) {
        if (b.kind !== "mass" && b.kind !== "slab" && b.kind !== "plinth") continue;
        const [hx, hz] = ext(b);
        for (let cx = Math.floor((b.x - hx) / CELL); cx <= Math.floor((b.x + hx) / CELL); cx++)
          for (let cz = Math.floor((b.z - hz) / CELL); cz <= Math.floor((b.z + hz) / CELL); cz++) {
            const l = surf.get(surfKey(cx, cz));
            if (l) l.push(b);
            else surf.set(surfKey(cx, cz), [b]);
          }
      }
      for (const b of [...kept, ...drips]) {
        (lists[b.kind] ??= []).push(b);
        if (b.kind === "basement" || b.kind === "pile" || b.kind === "plinth") footings++;
        // (the plants over it: on what stands above the layer's ground — FutureConfig.cover)
        if (coverK > 0 && b.kind !== "basement" && b.kind !== "pile" && b.kind !== "drip" && top(b) > groundY + tol) {
          const ch = hash2(Math.round(b.x * 977) ^ b.seed, Math.round(b.z * 971) ^ Math.round(b.y * 967), 6301);
          if (ch < coverK * (0.35 + 0.65 * (1 - bld.left))) {
            const [hx, hz] = ext(b), lo = Math.max(bot(b), groundY);
            cover.push(b.x, b.z, (lo - groundY) / box.unit, hx, (top(b) - lo) / box.unit, 3, 0, 0, 0, hash2(Math.round(b.x * 967) ^ b.seed, Math.round(b.z * 953), 6302), Math.min(1, 0.45 + 0.55 * (1 - bld.left)), hz);
          }
        }
      }
      if (fate && since === 0) {
        for (const b of lost) {
          if (b.kind === "drip" || b.kind === "pile") continue;
          const h = (salt: number) => hash2(Math.round(b.x * 997) ^ b.seed, Math.round(b.z * 991) ^ Math.round(b.y * 983), salt);
          const d = [b.sx, b.sy, b.sz].sort((p, q) => p - q);
          (lists[b.kind] ??= []).push({ ...b, sx: d[2] * 0.7, sy: d[0], sz: d[1] * 0.7, x: b.x + (h(6101) - 0.5) * CELL * 0.9, z: b.z + (h(6102) - 0.5) * CELL * 0.9, y: footY + d[0] / 2 + h(6103) * 0.25 * box.unit, yaw: h(6104) * Math.PI, tilt: (h(6105) - 0.5) * 0.35 });
          fallen++;
        }
      }
      unheld += lost.length;
    }
    const parts: Record<string, Float32Array> = {}, tones: Record<string, Float32Array> = {};
    for (const [kind, l] of Object.entries(lists)) {
      const n = Math.min(l.length, 12000);
      const m = new Float32Array(n * 16), t = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        writeMatrix(m, i * 16, l[i]);
        t[i] = l[i].tone;
      }
      parts[kind] = m;
      tones[kind] = t;
    }
    // (the rest of the plan — the paths, the water, the pipes, the mounds and the dark earth — goes as it is)
    const { buildings: _b, ...rest } = plan;
    void _b;
    const r: FutureResult = { ...rest, parts, tones };
    // NOTHING GROWS IN THE AIR (the artist, 2026-11-18: "허공에 가끔 식생 생기는 거 해결 안 됐어"): the plants and the
    // trees were set on a building's roof by how high it had stood — but what is left of it is decided only here, and
    // its body and slabs may be gone, stripped or fallen. So each plant and tree that stands above the ground is set
    // on the highest surface that is still there under it (a kept body, slab or plinth whose footprint holds its
    // place), or on the ground when nothing is
    const reground = (a: Float32Array | undefined, stride: number) => {
      if (!a) return;
      for (let o = 0; o + stride - 1 < a.length; o += stride) {
        if (!(a[o + 2] > 0)) continue;
        const x = a[o], z = a[o + 1];
        let topS = 0;
        for (const b of surf.get(surfKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
          const hx = b.tilt ? Math.max(b.sx, b.sy, b.sz) / 2 : b.sx / 2, hz = b.tilt ? hx : b.sz / 2;
          let dx = x - b.x, dz = z - b.z;
          dx -= WORLD * Math.round(dx / WORLD);
          dz -= WORLD * Math.round(dz / WORLD);
          if (Math.abs(dx) <= hx + 0.05 && Math.abs(dz) <= hz + 0.05) topS = Math.max(topS, (b.y + halfHeight(b) - groundY) / box.unit);
        }
        a[o + 2] = Math.max(0, topS);
      }
    };
    reground(r.plantClouds, 12);
    reground(r.treeStems, 11);
    if (cover.length) {
      const pc = r.plantClouds ?? new Float32Array(0), all = new Float32Array(pc.length + cover.length);
      all.set(pc);
      all.set(cover, pc.length);
      r.plantClouds = all;
    }
    // (how much of the last layer's plants and trees this one keeps exactly as they were — step 1's measure)
    {
      const seen = new Set<string>(), pc = r.plantClouds, ts = r.treeStems;
      if (pc) for (let i = 0; i + 11 < pc.length; i += 12) seen.add(`p${pc[i].toFixed(2)},${pc[i + 1].toFixed(2)},${pc[i + 5]},${pc[i + 3].toFixed(2)}`);
      if (ts) for (let i = 0; i + 10 < ts.length; i += 11) seen.add(`t${ts[i].toFixed(2)},${ts[i + 1].toFixed(2)},${ts[i + 3].toFixed(2)},${ts[i + 7].toFixed(4)}`);
      const was = this.futureSeen;
      if (was && seen.size) {
        let kept = 0;
        for (const s of seen) if (was.has(s)) kept++;
        this.stages["future plants kept from the last (%)"] = Math.round((100 * kept) / seen.size);
      }
      this.futureSeen = seen;
    }
    this.stages["future made in (ms)"] = Math.round(performance.now() - tInfer);
    Object.assign(this.stages, { "future buildings (n)": r.n.stand + r.n.grown, "future left (n)": r.n.left, "future water blocked (n)": r.n.blocked, "future lasting buildings (n)": r.n.lasting ?? 0, "future frame of paths (cells)": r.n.roadOld ?? 0, "future reads slot": K, "future slots under the window's top": Math.floor(bc.top) - 1 - K, "future roads (n)": r.n.road, "future masses gone (n)": gone, "future stood to the end (n)": toEnd, "future parts fallen (n)": fallen, "future parts that lost their support (n)": unheld,"future footings kept (n)": footings, "future plants of used ground (n)": r.n.used ?? 0, "future water belt points (n)": (r.vegWater?.length ?? 0) / 4, "future tree points (n)": (r.vegTree?.length ?? 0) / 5,"future grass (clouds)": r.n.grass ?? 0,"future scrub (clouds)": r.n.shrub ?? 0, "future trees (clouds)": r.n.tree ?? 0, "future frame broken by roots (cells)": r.n.cracked ?? 0, "future mounds (n)": r.n.mound ?? 0,"future dark earth (n)": r.n.stain ?? 0, "future pipe runs (n)": r.n.pipe ?? 0, "future ways read (slots)": ways.size,"future plants (n)": r.veg.length / 3 });
    return r;
  }

  /** The buildings' masses are let go — here and, when it makes them, on the other side. */
  private dropUnits(): void {
    this.unitTubes.clear();
    this.tubeSeen.clear();
    this.units.clear();
    this.unitOrphans = [];
    this.unitFused.clear();
    this.unitJob = null;
    this.unitsEmitted = -1;
    if (this.remoteOn) {
      this.remoteOn = false;
      this.fusePort?.postMessage({ type: "reset" } satisfies UnitRequest);
    }
  }

  /**
   * THE FOSSIL AS A FIELD (fuse.ts field): nothing is fused here or on the other side — the material is looked over
   * and what is other than it was is kept for the next answer to the view (takeFossil). Every box said is on the
   * screen at once (the view's field takes it within a frame or two), so its part is absorbed as far as that at once.
   */
  private fieldMaterial(bySlot: ReadonlyMap<number, { b: Box; grow?: number[] }[]>, fuse: FuseConfig): FuseMesh | null {
    let first = false;
    if (this.fieldToken !== fuse.field) {
      // (what was made as meshes is let go, here and on the other side; the view's one mesh of it is emptied)
      if (this.units.size || this.unitOrphans.length || this.unitJob || this.remoteOn) this.dropUnits();
      this.fieldToken = fuse.field ?? 0;
      this.fieldSnap.clear();
      this.fieldOut = { reset: true, add: [], keys: [], drop: [] };
      this.fieldAt = 0;
      first = true;
    }
    const now = performance.now();
    if (now - this.fieldAt < FIELD_REST_MS) return first ? mergeMeshes([]) : null;
    this.fieldAt = now;
    const out = this.fieldOut ?? (this.fieldOut = { reset: false, add: [], keys: [], drop: [] });
    const bc = this.blockClock;
    // (a part with nothing said of its growth — the mass is not the seeded one: it hardened now)
    const nowAge = bc ? bc.top + Math.max(0, bc.erode.stood ?? 0) : 0;
    const seen = new Set<number>();
    let added = 0;
    for (const l of bySlot.values()) {
      for (const e of l) {
        const b = e.b;
        if (b.tilt) continue;
        const k = SpaceModel.partKey(b), g = e.grow;
        // (how much the vegetation makes of it moves a hair at a time, all the time: said again only by twentieths)
        const born = g ? g[1] : nowAge, own = g ? g[3] : 1, most = g ? Math.round(g[5] * 20) / 20 : 1;
        const sig = b.x * 3.1 + b.y * 7.3 + b.z * 11.7 + b.sx * 13.9 + b.sy * 17.1 + b.sz * 19.3 + born * 23.9 + own * 29.3 + most * 31.7 + (b.yaw ?? 0) * 37.1;
        seen.add(k);
        if (this.fieldSnap.get(k) === sig) continue;
        this.fieldSnap.set(k, sig);
        this.unitFused.set(k, 1);
        out.add.push(b.x, b.y, b.z, b.sx, b.sy, b.sz, b.yaw ?? 0, FRAME_KINDS.has(b.kind) ? 0 : b.kind === "mass" ? 1 : 2, b.slot, born, own, most);
        out.keys.push(k);
        added++;
      }
    }
    for (const k of this.fieldSnap.keys()) {
      if (seen.has(k)) continue;
      this.fieldSnap.delete(k);
      this.unitFused.delete(k);
      out.drop.push(k);
    }
    // (parts that have a mass now are read again: they are absorbed as far as that)
    if (added && (fuse.absorb ?? 1) > 0) this.fuseBuilt++;
    this.stages["fossil field boxes (n)"] = this.fieldSnap.size;
    return first ? mergeMeshes([]) : null;
  }

  /** The fossil's material, as far as it is other than what the view was told (fuse.ts field); null = as it was. */
  takeFossil(): FossilDiff | null {
    const o = this.fieldOut;
    if (!o || (!o.reset && !o.add.length && !o.drop.length)) return null;
    this.fieldOut = null;
    return { token: this.fieldToken, reset: o.reset, add: Float32Array.from(o.add), keys: Float64Array.from(o.keys), drop: Float64Array.from(o.drop), n: this.fieldSnap.size };
  }

  /**
   * THE SEEDED MASS IS MADE ON THE OTHER SIDE (fuseUnits.ts): here only WHAT EACH BUILDING IS MADE OF is said, when
   * its parts are other than they were (and not more often than every so long: its assets come one by one) — its
   * simplified parts with what each one's fossil grows by, the vegetation gathered round it cut to its own extent,
   * and the look of its layers. Nothing is fused in this worker, and nothing of the mass comes back through it: the
   * other side shows every piece to the view as soon as it is done, and tells this one which parts have a mass now.
   */
  private sendUnits(
    port: MessagePort,
    lists: ReadonlyMap<string, { b: Box; d: number; up: boolean; sk: boolean; ang: number; grow?: number[] }[]>,
    h: NatureHistory | null,
    u: number,
    sed: NonNullable<ReturnType<typeof sedimentOf>>,
    layered: boolean,
    fuse: FuseConfig,
    padSlots: number,
    cfg: string,
    box: BoxConfig,
  ): FuseMesh | null {
    const key = (b: Box) => SpaceModel.partKey(b);
    const say = (m: UnitRequest) => port.postMessage(m);
    // THE PIPES AND THE WAYS FUSE WITH THE GROUND THEY LIE IN (the artist, 2026-11-16: "사실 관이랑 길에도 화석화를
    // 적용하긴 해야하거든", "그럼 그것부터 일단 진행"): as the exhibition's did — tubes in the same field, so the mass
    // crosses from building to building along them. Those that have HARDENED (seededTubes), at whatever depth.
    const tubesOf = new Map<string, (FuseTube & { born?: number })[]>();
    const tubeSig = new Map<string, string>();
    {
      // TAKEN OUT (the artist, 2026-11-16 evening: "아니면 길이랑 배관 화석화는 걍 빼"). Watched in her window on her own
      // world: once the places hardened, 43 → 225,170 → 570,155 tubes were in the field within seven minutes (a way is
      // drawn as thousands of short pieces, in every layer), a piece of the mass went from ~1 s to 7.9 s, the model's
      // round to 14 s and the screen to 3 fps. The pipes and the ways do not fuse; what was written for it stays
      // below, unused, until it is decided how few tubes a way may be.
      for (const t of SEEDED_TUBES ? this.seededTubes(fuse, u) : []) {
        const id = `ground:${box.variety ? Math.round(districtOf((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, box.variety).angle * 1e4) : 0}`;
        if (!lists.has(id)) continue;
        const l = tubesOf.get(id);
        if (l) l.push(t);
        else tubesOf.set(id, [t]);
      }
      for (const [id, l] of tubesOf) {
        let sg = 0;
        for (const t of l) sg += t.x0 * 3.1 + t.y0 * 7.3 + t.z0 * 11.7 + t.x1 * 13.9 + t.y1 * 17.1 + t.z1 * 19.3 + t.r * 23.9;
        tubeSig.set(id, `${l.length}:${sg.toFixed(2)}`);
      }
    }
    let first = false;
    if (!this.remoteOn) {
      // (what was made here is let go: the other side makes all of it — and the one mesh of it is emptied)
      this.dropUnits();
      this.remoteOn = true;
      first = true;
      say({ type: "reset" });
    }
    this.remoteAbsorb = (fuse.absorb ?? 1) > 0;
    // a building that is no more — or under another name (it grew a cell older than its oldest, its foot went with
    // the window's floor, it joined another): its mass goes with most of its parts
    for (const old of [...this.units.keys()].filter((id) => !lists.has(id))) {
      const ent = this.units.get(old)!;
      let heir = "", most = 0;
      if (ent.snap.size) {
        for (const [id, list] of lists) {
          let n = 0;
          for (const e of list) if (ent.snap.has(key(e.b))) n++;
          if (n > most) [heir, most] = [id, n];
        }
      }
      this.units.delete(old);
      if (!heir || most < ent.snap.size * 0.5) {
        for (const k of ent.snap.keys()) this.unitFused.delete(k);
        say({ type: "drop", id: old });
        continue;
      }
      say({ type: "heir", from: old, to: heir });
      if (!this.units.has(heir)) this.units.set(heir, ent);
    }
    const nowMs = performance.now(), deadline = nowMs + UNIT_SEND_MS;
    let waiting = 0, sent = 0;
    for (const [id, list] of lists) {
      const ent = this.units.get(id);
      const tSig = tubeSig.get(id) ?? "";
      if (ent && ent.cfg === cfg && this.unitTubes.get(id) === tSig && ent.snap.size === list.length && list.every((e) => ent.snap.has(key(e.b)))) continue;
      waiting++;
      if ((ent && ent.cfg === cfg && nowMs - ent.madeMs < UNIT_REST_MS) || performance.now() > deadline) continue;
      const ang = list[0].ang;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const at = unitExtent(list, ang ? { c, sn } : undefined);
      const snap = new Map<number, number>();
      const parts: UnitJob["parts"] = list.map((e) => {
        const k = key(e.b);
        snap.set(k, e.d);
        return { b: e.b, d: e.d, up: e.up, sk: e.sk, grow: e.grow, key: k };
      });
      // (parts that are no longer the building's: no mass of theirs is counted any more)
      if (ent) for (const k of ent.snap.keys()) if (!snap.has(k)) this.unitFused.delete(k);
      say({
        type: "job",
        id,
        serial: ++this.unitSerial,
        cfg,
        fuse,
        parts,
        tubes: tubesOf.get(id),
        ang,
        h: h ? SpaceModel.turnedHistory(h, c, sn, at.ext, at.ka - 12, at.kb + 12) : null,
        look: layered ? unitLook(list) : null,
        u,
        sed,
        padSlots,
        // (the pieces' size: the fusion's own if it names one that fits the screen's chunks — FuseConfig.pieceTile)
        seg: [5, 10, 15, 30].includes(fuse.pieceSeg ?? 0) ? fuse.pieceSeg! : NATURE_CHUNK,
        tile: [7, 14, 21, 42].includes(fuse.pieceTile ?? 0) ? fuse.pieceTile! : BLOCK_TILE,
        // (the fossil's clock now and where it begins to come out — as the wall's shader reads it: what is out on the
        // screen is made first, fuseUnits step)
        age: (() => {
          const bc = this.blockClock, ec = bc?.erode;
          if (!bc || !ec || !((ec.shift ?? 0) > 0)) return undefined;
          const perTop = Math.max(1, ec.slotSec ?? box.secPerUnit) / (ec.shift ?? 1);
          return { now: bc.top + Math.max(0, ec.stood ?? 0), after: ((ec.lodSec ?? 0) * 1.3) / perTop + 1 };
        })(),
      });
      this.units.set(id, { cfg, snap, mesh: mergeMeshes([]), at: ++this.unitsVersion, madeMs: nowMs, pieces: new Map() });
      this.unitTubes.set(id, tSig);
      waiting--;
      sent++;
    }
    let nTubes = 0;
    for (const l of tubesOf.values()) nTubes += l.length;
    this.stages["fuse pipes and ways in the field (n)"] = nTubes;
    this.stages["fuse grounds told (n)"] = sent;
    this.stages["fuse grounds waiting to be told (n)"] = waiting;
    this.stages["fuse grounds (n, own worker)"] = lists.size;
    return first ? mergeMeshes([]) : null;
  }

  /**
   * THE BUILDINGS OF THE BLOCK: the cell-runs (a Seed's run of slots) that touch — neighbours on the ground, at the
   * same time, in the same district's frame — are one building. Its id is that of its oldest cell-run, so a building
   * that grows keeps its id.
   */
  private buildingsOfSeeds(box: BoxConfig): Map<number, { k0: number; k1: number; id: string }[]> {
    const key = `${this.seedsKey}:${JSON.stringify(box.variety ?? null)}:${box.secPerUnit}`;
    if (this.buildingRuns?.key === key) return this.buildingRuns.of;
    const spu = box.secPerUnit;
    const nodes: { seed: number; cx: number; cz: number; k0: number; k1: number; ang: number }[] = [];
    const at = new Map<string, number[]>();
    for (const sd of this.seeds) {
      const cx = Math.floor(sd.x / CELL), cz = Math.floor(sd.z / CELL);
      const ang = box.variety ? Math.round(districtOf(sd.x, sd.z, box.variety).angle * 1e4) / 1e4 : 0;
      for (const [t0, t1] of sd.spans ?? [[sd.t0, sd.t1] as [number, number]]) {
        const ck = `${cx},${cz}`;
        const l = at.get(ck);
        if (l) l.push(nodes.length);
        else at.set(ck, [nodes.length]);
        nodes.push({ seed: sd.id, cx, cz, k0: Math.floor(t0 / spu), k1: Math.floor(t1 / spu), ang });
      }
    }
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    nodes.forEach((a, i) => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          for (const j of at.get(`${a.cx + dx},${a.cz + dz}`) ?? []) {
            if (j <= i) continue;
            const b = nodes[j];
            if (b.ang !== a.ang || a.k0 > b.k1 + 1 || b.k0 > a.k1 + 1) continue;
            const ra = find(i), rb = find(j);
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
    });
    // the oldest cell-run names the building
    const first = new Map<number, number>();
    nodes.forEach((a, i) => {
      const r = find(i), f = first.get(r);
      if (f === undefined || a.k0 < nodes[f].k0 || (a.k0 === nodes[f].k0 && a.seed < nodes[f].seed)) first.set(r, i);
    });
    const of = new Map<number, { k0: number; k1: number; id: string }[]>();
    nodes.forEach((a, i) => {
      const f = nodes[first.get(find(i))!];
      const run = { k0: a.k0, k1: a.k1, id: `${f.seed}@${f.k0}` };
      const l = of.get(a.seed);
      if (l) l.push(run);
      else of.set(a.seed, [run]);
    });
    this.buildingRuns = { key, of };
    return of;
  }

  /**
   * THE MASS, BUILDING BY BUILDING, FROM A STATE KEPT (the artist, 2026-11-15: "메시를 굽지 말고 오히려 건물 상태를
   * 기점마다 굽고 일정 변화 이상이 감지되면 변화하는 식으로"). The unit is a building — not a chunk of ten slots, a
   * tile of the ground and a district's angle, whose sides cut the mass wherever one was fused later than the next.
   * Of every building the STATE its mass was last made from is kept (each part's decay). The mass is made again only
   * when the building's state has moved from that by `unitChange` — the mean change of its parts' value, in whichever
   * band of ten slots changed most (a building is tall in time and changes from the bottom: a mean over all of it
   * would never move), a part come or gone counting as a whole change. The building that has changed most goes first.
   * A building is made in PIECES (bands of slots × tiles of the ground, so no call fuses for long), all from the
   * same state, and shown only when every piece is done — so no piece is newer than the one beside it. A piece whose
   * parts stand exactly as they did is kept as it was.
   */
  private fuseBuildings(
    bySlot: ReadonlyMap<number, { b: Box; d: number; up: boolean; sk: boolean; ang: number; grow?: number[] }[]>,
    h: NatureHistory | null,
    u: number,
    sed: NonNullable<ReturnType<typeof sedimentOf>>,
    layered: boolean,
    fuse: FuseConfig,
    padSlots: number,
    box: BoxConfig,
  ): FuseMesh | null {
    type P = { b: Box; d: number; up: boolean; sk: boolean; ang: number; grow?: number[] };
    const SEG = NATURE_CHUNK, T = BLOCK_TILE, PAD = 4;
    // (SEEDED: the mass is the building's whole mass, whatever its progress — it is made again only when its parts
    // are other than they were, and not more often than every so long: its assets come one by one)
    const seeded = !!fuse.seeded;
    // THE FOSSIL AS A FIELD ON THE GPU (fuse.ts field): only its material is said — nothing is fused
    if (fuse.field) return this.fieldMaterial(bySlot, fuse);
    if (this.fieldToken) {
      this.fieldToken = 0;
      this.fieldSnap.clear();
      this.fieldOut = null;
      this.unitFused.clear();
    }
    const cfg = JSON.stringify(fuse);
    // ONE FIELD OVER THE WHOLE GROUND (the artist, 2026-11-16, seeing the seeded mass made building by building: "전
    // 구역에 '화석화' 장이 있는 거 아냐?", "전체가 한 덩어리고, 그걸 조정하는 필터함수가 지경별로 어디는 시각화하고 어디는 안
    // 해서 … 리디자인 전 버전에서 층별로 한다며, 그거에 필터를 추가한 방식이라고 이해했는데"). The seeded mass is THE
    // EXHIBITION'S MASS — every part of a band of slots in one field, whatever building it is of, so the mass is one
    // body that bridges from building to building — and the wall's shader is the filter over it (where it is let
    // out, by the layer's depth and the vegetation there). The unit is therefore not a building but the whole
    // ground of one frame (a district's angle: its boxes lie along one grid — as the exhibition's did); it is cut
    // into the same pieces (bands of slots × tiles), made the deepest first in the worker beside.
    const area = seeded && !!this.fusePort;
    const runsOf = area ? null : this.buildingsOfSeeds(box);
    // every part to its unit: the ground of its frame — or its building
    const lists = new Map<string, P[]>();
    for (const l of bySlot.values()) {
      for (const e of l) {
        if (!runsOf) {
          const id = `ground:${Math.round(e.ang * 1e4)}`;
          const li = lists.get(id);
          if (li) li.push(e);
          else lists.set(id, [e]);
          continue;
        }
        const runs = runsOf.get(e.b.seed);
        if (!runs?.length) continue;
        let best = runs[0], bd = Infinity;
        for (const r of runs) {
          const dd = e.b.slot < r.k0 ? r.k0 - e.b.slot : e.b.slot > r.k1 ? e.b.slot - r.k1 : 0;
          if (dd < bd) [best, bd] = [r, dd];
        }
        const li = lists.get(best.id);
        if (li) li.push(e);
        else lists.set(best.id, [e]);
      }
    }
    // THE SEEDED MASS IS MADE IN A WORKER OF ITS OWN (fuseUnits.ts), when there is one
    if (area && this.fusePort) return this.sendUnits(this.fusePort, lists, h, u, sed, layered, fuse, padSlots, cfg, box);
    if (this.remoteOn) this.dropUnits(); // (made here again)
    // (the crust has no growths: only where it has come)
    const fusing = (list: readonly { d: number }[]): boolean => list.some((e) => fusedShare(e.d, fuse) >= 0.05 || (!fuse.crust && accretionShare(e.d, fuse) > 0.01));
    const value = (d: number) => 0.7 * fusedShare(d, fuse) + 0.3 * d;
    const key = (b: Box) => SpaceModel.partKey(b);
    // A BUILDING UNDER ANOTHER NAME (it grew a cell older than its oldest, or its foot went with the window's floor):
    // the mass kept under the old name is its own — taken over when most of that mass's parts are in it
    const gone = [...this.units.keys()].filter((id) => !lists.has(id));
    for (const old of gone) {
      const ent = this.units.get(old)!;
      let heir = "", most = 0;
      if (ent.snap.size) {
        for (const [id, list] of lists) {
          let nShared = 0;
          for (const e of list) if (ent.snap.has(key(e.b))) nShared++;
          if (nShared > most) [heir, most] = [id, nShared];
        }
      }
      this.units.delete(old);
      this.unitsVersion++;
      if (!heir || most < ent.snap.size * 0.5) continue; // (its parts are gone: so is its mass)
      const mine = this.units.get(heir);
      if (!mine) this.units.set(heir, ent);
      else if (ent.mesh.index.length) this.unitOrphans.push({ mesh: ent.mesh, heir, heirAt: mine.at }); // (joined to another: shown until that one is made again)
    }
    if (this.unitOrphans.length) {
      const n0 = this.unitOrphans.length;
      this.unitOrphans = this.unitOrphans.filter((o) => this.units.get(o.heir)?.at === o.heirAt);
      if (this.unitOrphans.length !== n0) this.unitsVersion++;
    }
    if (this.unitJob && !lists.has(this.unitJob.id)) this.unitJob = null;

    // how far each building's state has moved from the one its mass was made from
    const changeOf = (id: string, list: readonly P[]): number => {
      const ent = this.units.get(id);
      if (!ent) return fusing(list) ? 1 : 0;
      if (ent.cfg !== cfg) return 1;
      const sum = new Map<number, number>(), cnt = new Map<number, number>();
      const add = (band: number, v: number) => {
        sum.set(band, (sum.get(band) ?? 0) + v);
        cnt.set(band, (cnt.get(band) ?? 0) + 1);
      };
      const now = new Set<number>();
      for (const e of list) {
        const k = key(e.b);
        now.add(k);
        const was = ent.snap.get(k);
        add(Math.floor(e.b.slot / SEG), was === undefined ? (fusedShare(e.d, fuse) > 0 ? 1 : 0) : Math.abs(value(e.d) - value(was)));
      }
      for (const [k, was] of ent.snap) if (!now.has(k)) add(Math.floor(Math.floor(k / 4294967296) / SEG), fusedShare(was, fuse) > 0 ? 1 : 0);
      let most = 0;
      for (const [band, v] of sum) most = Math.max(most, v / Math.max(4, cnt.get(band)!));
      return most;
    };
    const lookOf = (list: readonly P[]): ((k: number) => number) | undefined => {
      if (!layered) return undefined;
      const sum = new Map<number, number>(), cnt = new Map<number, number>();
      let all = 0;
      for (const e of list) {
        sum.set(e.b.slot, (sum.get(e.b.slot) ?? 0) + e.d);
        cnt.set(e.b.slot, (cnt.get(e.b.slot) ?? 0) + 1);
        all += e.d;
      }
      const mean = list.length ? all / list.length : 0;
      return (k: number) => {
        let sm = 0, n = 0;
        for (let j = k - 1; j <= k + 1; j++) {
          const c = cnt.get(j);
          if (c) {
            sm += sum.get(j)!;
            n += c;
          }
        }
        return n ? sm / n : mean;
      };
    };
    const cellOf = (v: number) => Math.floor(v / CELL);
    /** The pieces of a building as it stands now, and the state they are made from. */
    const begin = (id: string, list: readonly P[]): NonNullable<SpaceModel["unitJob"]> => {
      const ang = list[0].ang;
      const c = Math.cos(ang), sn = Math.sin(ang);
      // (a turned district is fused in its own frame, where its boxes lie along the grid: seeds.ts' turn undone)
      const ps = ang ? list.map((e) => ({ ...e, b: { ...e.b, x: e.b.x * c - e.b.z * sn, z: e.b.x * sn + e.b.z * c, yaw: 0 } })) : list.slice();
      let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity, ka = Infinity, kb = -Infinity;
      for (const { b } of ps) {
        const r = Math.max(b.sx, b.sy, b.sz) / 2;
        xa = Math.min(xa, cellOf(b.x - r));
        xb = Math.max(xb, cellOf(b.x + r));
        za = Math.min(za, cellOf(b.z - r));
        zb = Math.max(zb, cellOf(b.z + r));
        ka = Math.min(ka, b.slot);
        kb = Math.max(kb, b.slot);
      }
      const ext = { x0: xa - PAD, z0: za - PAD, nx: xb - xa + 1 + 2 * PAD, nz: zb - za + 1 + 2 * PAD };
      const grownBy = partReach(fuse);
      const todo: NonNullable<SpaceModel["unitJob"]>["todo"] = [];
      for (let k0 = Math.floor((ka - 8) / SEG) * SEG; k0 <= kb + 3; k0 += SEG) {
        const k1 = k0 + SEG - 1;
        // (parts reaching into the band: masses hang ≤ 3 slots, foundations ≤ 8 below their slot — as the chunks did)
        const inBand = ps.filter((e) => e.b.slot >= k0 - padSlots - 3 && e.b.slot <= k1 + padSlots + 8);
        if (!inBand.length) continue;
        for (let tz = Math.floor(ext.z0 / T) * T; tz < ext.z0 + ext.nz; tz += T) {
          for (let tx = Math.floor(ext.x0 / T) * T; tx < ext.x0 + ext.nx; tx += T) {
            const ax = tx - PAD, bx = tx + T + PAD, az = tz - PAD, bz = tz + T + PAD;
            const mine = inBand.filter(({ b }) => {
              // (…and what its mass stands out of its box by — fuse.ts partReach: as the worker beside chooses them)
              const r = Math.max(b.sx, b.sy, b.sz) / 2 + grownBy;
              return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
            });
            // (nothing comes of a place where no part is fusing: fuseTiled)
            if (!fusing(mine)) continue;
            let sg = 0;
            for (const e of mine) sg += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.b.sx * 0.7 + e.b.sy * 1.3 + e.b.sz * 1.9 + Math.round(e.d * 20) * 0.9 + (e.up ? 19 : 0) + (e.sk ? 23 : 0);
            todo.push({ key: `${k0}:${tx}:${tz}`, sig: `${mine.length}:${sg.toFixed(3)}`, k0, k1, tx, tz, ps: mine });
          }
        }
      }
      const snap = new Map<number, number>();
      for (const e of list) snap.set(key(e.b), e.d);
      return { id, cfg, snap, ang, parts: seeded ? list.map((e) => ({ b: e.b, grow: e.grow })) : [], h: h && ang ? SpaceModel.turnedHistory(h, c, sn, ext, ka - 12, kb + 12) : h, look: lookOf(list), todo, done: new Map() };
    };

    const deadline = performance.now() + FUSE_BUDGET_MS;
    let waiting = 0;
    for (let guard = 0; guard < 64; guard++) {
      if (!this.unitJob) {
        // the building that has moved most from its state
        let pick = "", most = 0;
        waiting = 0;
        const th = seeded ? 1e-6 : Math.max(0.02, fuse.unitChange ?? 0.15);
        const nowMs = performance.now();
        for (const [id, list] of lists) {
          const ch = changeOf(id, list);
          if (ch < th) continue;
          if (seeded && nowMs - (this.units.get(id)?.madeMs ?? -Infinity) < UNIT_REST_MS) continue;
          waiting++;
          if (ch > most || (ch === most && pick && list.length > lists.get(pick)!.length)) [pick, most] = [id, ch];
        }
        if (!pick) break;
        this.unitJob = begin(pick, lists.get(pick)!);
      }
      const job = this.unitJob;
      const was = this.units.get(job.id);
      while (job.todo.length) {
        const piece = job.todo.shift()!;
        const kept = was && was.cfg === job.cfg ? was.pieces.get(piece.key) : undefined;
        if (kept && kept.sig === piece.sig) job.done.set(piece.key, kept);
        else {
          const t0 = performance.now();
          const mesh = this.fuseTiles({ c0: piece.k0, c1: piece.k1, ps: piece.ps, tubes: [], x0: piece.tx, z0: piece.tz, nx: T, nz: T }, job.h, u, sed, job.look, fuse, T);
          job.done.set(piece.key, { sig: piece.sig, mesh });
          this.stages["fuse pieces (n)"] = (this.stages["fuse pieces (n)"] ?? 0) + 1;
          this.stages["fuse piece max ms"] = Math.max(this.stages["fuse piece max ms"] ?? 0, performance.now() - t0);
        }
        if (performance.now() > deadline) break;
      }
      if (job.todo.length) break; // (out of time: the building goes on at the next call, from the same state)
      // every piece is done: the building's mass is changed whole
      const mesh = mergeMeshes([...job.done.values()].map((q) => q.mesh));
      if (job.ang) {
        const c = Math.cos(job.ang), sn = Math.sin(job.ang);
        for (const arr of [mesh.position, mesh.normal]) {
          for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i], z = arr[i + 2];
            arr[i] = x * c + z * sn;
            arr[i + 2] = -x * sn + z * c;
          }
        }
      }
      if (was) for (const k of was.snap.keys()) this.unitFused.delete(k);
      for (const [k, d] of job.snap) this.unitFused.set(k, d);
      // (the parts are read again against the mass only where the mass takes their place: with `absorb` 0 — the
      // parts stand whole under it — a building's new mass costs the parts nothing)
      if ((fuse.absorb ?? 1) > 0) this.fuseBuilt++;
      // SEEDED: every vertex is given the part it grows from
      if (seeded && job.parts.length) growData(mesh, job.parts, u);
      this.units.set(job.id, { cfg: job.cfg, snap: job.snap, mesh, at: ++this.unitsVersion, madeMs: performance.now(), pieces: job.done });
      this.unitJob = null;
      this.stages["fuse buildings (n)"] = (this.stages["fuse buildings (n)"] ?? 0) + 1;
      if (performance.now() > deadline) break;
    }
    this.stages["fuse buildings waiting (n)"] = waiting;
    if (this.unitsVersion === this.unitsEmitted) return null;
    this.unitsEmitted = this.unitsVersion;
    const out: FuseMesh[] = [];
    for (const ent of this.units.values()) if (ent.mesh.index.length) out.push(ent.mesh);
    for (const o of this.unitOrphans) out.push(o.mesh);
    return mergeMeshes(out);
  }


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
      // (only the slots anything stands in: the top rises without end)
      let kLo = Infinity, kHi = -Infinity;
      for (const sd of this.seeds) {
        if (!sd.gather) continue;
        for (const k of sd.gather.keys()) {
          if (k < kLo) kLo = k;
          if (k > kHi) kHi = k;
        }
      }
      const x0 = a - 2, z0 = c - 2, nx = b - a + 5, nz = d - c + 5, nk = Math.max(1, kHi - kLo + 1);
      const V = new Float32Array(nx * nz * nk);
      for (const sd of this.seeds) {
        if (!sd.gather) continue;
        const i = Math.floor(sd.x / CELL) - x0, j = Math.floor(sd.z / CELL) - z0;
        for (const [k, g] of sd.gather) {
          if (k < kLo || k > kHi || !(g > 0)) continue;
          const off = (k - kLo) * nx * nz;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const p = off + (j + dj) * nx + i + di, v = di || dj ? g * 0.6 : g;
              if (V[p] < v) V[p] = v;
            }
          }
        }
      }
      h = { x0, z0, nx, nz, k0: kLo, nk, V, P: new Float32Array(0) };
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
    // (the old wall — one frame, no districts: as it always was; the block always goes district by district below)
    if (!this.blockClock && byAngle.size <= 1 && (byAngle.has(0) || !byAngle.size)) return this.fuseTiles(w, h, u, sed, layerDecay, fuse);
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
    // THE LAYERS' LOOK IS THE UNIT'S OWN (the rising window): how old a layer of the mass looks — its voids, its
    // darkening, how far it is fossil — is read from the parts of THIS district lying in it (their mean progress,
    // over a slot above and below; a slot of it without parts: the district's mean), not from the block's depth: the
    // depth of every slot changes all the time now, and read from it every district was fused again as it sank.
    const lookOf = (list: typeof w.ps): ((k: number) => number) | undefined => {
      if (!layerDecay) return undefined;
      const sum = new Map<number, number>(), cnt = new Map<number, number>();
      let all = 0;
      for (const e of list) {
        sum.set(e.b.slot, (sum.get(e.b.slot) ?? 0) + e.d);
        cnt.set(e.b.slot, (cnt.get(e.b.slot) ?? 0) + 1);
        all += e.d;
      }
      const mean = list.length ? all / list.length : 0;
      return (k: number) => {
        let sm = 0, n = 0;
        for (let j = k - 1; j <= k + 1; j++) {
          const c = cnt.get(j);
          if (c) {
            sm += sum.get(j)!;
            n += c;
          }
        }
        return n ? sm / n : mean;
      };
    };
    const used = new Set<string>();
    // (a district's signature reads what its mass is made of — how much of each part is mass — not the part's value
    // itself: past `fuseFull` a part is all mass and ageing on changes nothing)
    const stale: { ang: number; id: string; key: string; at: number; run: () => FuseMesh }[] = [];
    const sigOf = (list: typeof w.ps, tubes: readonly BakedTube[]): string => {
      let sum = 0;
      for (const e of list) {
        const veg = h ? (natureAt(h, Math.floor(e.b.x / CELL), Math.floor(e.b.z / CELL), e.b.slot) ?? 0) : 0;
        sum += e.b.x * 3 + e.b.y * 7 + e.b.z * 11 + e.b.sx * 0.7 + e.b.sy * 1.3 + e.b.sz * 1.9 + Math.round(fusedShare(e.d, fuse) * 20) * 0.65 + Math.round(accretionShare(e.d, fuse) * 20) * 0.35 + Math.round(e.d * 10) * 0.9 + (e.up ? 19 : 0) + (e.sk ? 23 : 0) + veg * 5;
      }
      for (const tb of tubes) sum += tb.decay * 13 + tb.x0 + tb.z1 + tb.y0 * 3 + tb.r * 17;
      return `${list.length}:${tubes.length}:${sum.toFixed(3)}:${cfgKey}`;
    };
    // NOTHING COMES OF A PLACE WHERE NO PART IS FUSING (measured 2026-11-15: with "판 사이 채우기" on — the exhibition's
    // value — every plate of every building is handed to the fusion whether it has begun to fuse or not, so every
    // building, however new, was a tile to work out: 1–3 s each, and an empty mesh at the end of it. The same for a
    // tile with only ways or pipes in it: the envelope cuts their mass away where no building stands).
    // (a part counts from a twentieth of it being mass: below that the field does not reach the surface's level, and
    // the tile came out empty after the same second or two)
    const fusing = (list: typeof w.ps): boolean => list.some((e) => fusedShare(e.d, fuse) >= 0.05 || accretionShare(e.d, fuse) > 0.01);
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
        const T = BLOCK_TILE, PAD = 4;
        const ex = extent(list, w.tubes);
        for (let tz = Math.floor(ex.z0 / T) * T; tz < ex.z0 + ex.nz; tz += T) {
          for (let tx = Math.floor(ex.x0 / T) * T; tx < ex.x0 + ex.nx; tx += T) {
            const ax = tx - PAD, bx = tx + T + PAD, az = tz - PAD, bz = tz + T + PAD;
            const ps = list.filter(({ b }) => {
              const r = Math.max(b.sx, b.sy, b.sz) / 2;
              return cellOf(b.x + r) >= ax && cellOf(b.x - r) < bx && cellOf(b.z + r) >= az && cellOf(b.z - r) < bz;
            });
            const tubes = w.tubes.filter((t) => cellOf(Math.max(t.x0, t.x1) + t.r) >= ax && cellOf(Math.min(t.x0, t.x1) - t.r) < bx && cellOf(Math.max(t.z0, t.z1) + t.r) >= az && cellOf(Math.min(t.z0, t.z1) - t.r) < bz);
            if (!fusing(ps)) continue;
            want(0, `${w.c0}:0:${tx}:${tz}`, sigOf(ps, tubes), () => this.fuseTiles({ ...w, ps, tubes, x0: tx, z0: tz, nx: T, nz: T }, h, u, sed, lookOf(ps), fuse, T));
          }
        }
        continue;
      }
      if (!fusing(list)) continue;
      want(ang, `${w.c0}:${ang}`, sigOf(list, []), () => {
        // into the district's frame (the inverse of seeds.ts' turn, about the origin), and the mesh back out of it
        const c = Math.cos(ang), sn = Math.sin(ang);
        const turned = list.map((e) => ({ ...e, b: { ...e.b, x: e.b.x * c - e.b.z * sn, z: e.b.x * sn + e.b.z * c, yaw: 0 } }));
        const ext = extent(turned, []);
        const m = this.fuseTiles({ ...w, ps: turned, tubes: [], ...ext }, h ? SpaceModel.turnedHistory(h, c, sn, ext, w.c0 - 12, w.c1 + 12) : null, u, sed, lookOf(list), fuse, BLOCK_TILE);
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
      const tRun = performance.now();
      const m = run();
      this.stages["fuse units ms"] = (this.stages["fuse units ms"] ?? 0) + performance.now() - tRun;
      this.stages["fuse unit max ms"] = Math.max(this.stages["fuse unit max ms"] ?? 0, performance.now() - tRun);
      this.districtMass.set(id, { key, mesh: m, at: this.fuseBuilt });
      out.push(m);
    }
    // (districts that are no longer in this chunk are let go)
    for (const id of this.districtMass.keys()) if (id.startsWith(`${w.c0}:`) && !used.has(id)) this.districtMass.delete(id);
    return mergeMeshes(out);
  }

  /** A chunk's parts (all square to the grid) fused tile by tile (fuseUnits.ts fuseTilesOf). */
  private fuseTiles(
    w: { c0: number; c1: number; ps: { b: Box; d: number; up: boolean; sk: boolean }[]; tubes: BakedTube[]; x0: number; z0: number; nx: number; nz: number },
    h: NatureHistory | null,
    u: number,
    sed: NonNullable<ReturnType<typeof sedimentOf>>,
    layerDecay: ((k: number) => number) | undefined,
    fuse: FuseConfig,
    TILE = 24,
  ): FuseMesh {
    return fuseTilesOf(w, h, u, sed, layerDecay, fuse, TILE, this.stages);
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
      this.assets.clear();
      this.assetGroups.clear();
      this.lodVariants.clear();
      this.ageBegun = true;
      this.floorDone = -Infinity;
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
    // (a round of ways asked of the other worker before this is not taken when it comes)
    this.walkAsked = null;
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
    let seeds = this.ensureSeeds(input.fold);
    // THE RISING WINDOW LETS GO OF WHAT IS BELOW IT (the artist, 2026-11-15: "전체 시간 덩어리가 조금씩 위로 올라가며 아래 걸
    // 버리도록"): below its foot — and the record kept under it (erode.tail) — the density forgets what was put in and
    // built, and with it go the parts, their lives, the ways and the pipes laid there. Without it the column grew for
    // ever: measured the same day, three windows' length held 720 buildings and a round of ways took 9 s.
    const we0 = this.densityCfg ? input.weather.erode : null;
    const floorNow = we0 && (we0.shift ?? 0) > 0 && we0.height ? Math.floor(we0.topSlot - we0.height - Math.max(0, we0.tail ?? 0)) : -Infinity;
    if (floorNow !== this.floorDone) {
      if (floorNow > this.floorDone && this.densityState) {
        this.densityState.field.dropBelow(floorNow, floorNow - Math.max(1, Math.round(we0!.height!)));
        for (const [id, m] of this.bornT) {
          for (const k of m.keys()) if (k < floorNow) m.delete(k);
          if (!m.size) this.bornT.delete(id);
        }
        if (this.drainKept) {
          const streams = new Map<number, Float32Array[]>();
          for (const [k, c] of this.drainKept.streams) if (k >= floorNow) streams.set(k, c);
          this.drainKept = { ...this.drainKept, pipes: this.drainKept.pipes.filter((p) => p.k >= floorNow), streams };
        }
        if (this.walkKept) this.walkKept = { ...this.walkKept, layers: this.walkKept.layers.filter((l) => l.k >= floorNow) };
        seeds = this.ensureSeeds(input.fold);
      }
      this.floorDone = floorNow;
    }
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
    // WHAT IS LIVED IN STARTS OVER (the artist, 2026-11-15: "건물이 … 어떨 땐 아예 안 생기고"): a cell-slot is built
    // once — people standing in a place that was built long ago, and had since eroded away, built nothing one could
    // see. Every cell-slot somebody stood in since the last reading is given its time back: it stands whole again,
    // and goes on from there once they have left.
    if (this.densityState) {
      const nowAge = Math.max(this.ageClock, (Date.now() - this.arriveEpoch) / 1000);
      for (const [id, k] of this.densityState.field.takeLived()) {
        const e = this.bornT.get(id)?.get(k);
        if (!e) continue;
        // (only what had begun to go on is a change to be seen)
        if (nowAge - e.born > (input.weather.erode?.waitSec ?? 0)) this.renewals++;
        e.born = nowAge;
        e.top = input.weather.erode?.topSlot ?? 0;
        e.stood = Math.max(0, input.weather.erode?.stood ?? 0);
      }
    }
    // (the block's parts go on by the clock: they are read again at every step of it)
    const lifeSec = this.densityCfg && input.weather.erode ? Math.max(0, input.weather.erode.lifeSec ?? 0) : 0;
    const waitSec = Math.max(0, input.weather.erode?.waitSec ?? 0);
    // (real seconds: the world's clock is set back whenever the lab's world is trimmed, and a part's age must not be)
    this.ageClock = Math.max(this.ageClock, (Date.now() - this.arriveEpoch) / 1000);
    const sig = `${this.seedsKey}:${this.fuseBuilt}:${this.baked.size}:${cfgKey}:${input.wear ? Math.floor(t) : "-"}:${lifeSec > 0 ? Math.floor(this.ageClock / (lifeSec / AGE_STEPS / AGE_PHASES)) : "-"}:${this.renewals}:${JSON.stringify(input.weather)}:${JSON.stringify(input.fuse)}:${JSON.stringify(input.water)}:${level.size}:${lodSig}:${input.edges}:${this.walkRev}`;
    if (sig === this.partsSig) return null;
    this.partsSig = sig;
    // ARRIVAL (arrive.ts): parts first seen now are being built — unless a knob of the parts or of the buildings' rule
    // was turned, or this is the first result (a load, a reset): those are simply there
    const arriveNow = (Date.now() - this.arriveEpoch) / 1000;
    const arriveKey = `${cfgKey}:${JSON.stringify(input.density ?? null)}`;
    const arriveQuiet = arriveKey !== this.arriveCfg;
    this.arriveCfg = arriveKey;

    const order = [...seeds].sort((a, b) => a.t0 - b.t0 || a.id - b.id);
    let built: Box[] = [];
    const live = new Set<number>();
    // (the density keeps what it has built whatever samples were forgotten since: nothing of it is below a window —
    // but the RISING window's floor: a building standing across it keeps its slots below for its size, not its parts)
    const floorK = this.densityCfg ? floorNow : Number.isFinite(this.cutS) ? Math.floor(this.cutS / box.secPerUnit) : -Infinity;
    // …AND NOTHING ABOVE THE WINDOW'S TOP (the artist, 2026-11-17: "미래 도시랑 현재 인터랙션 … 떨어져있는 구간은
    // 불가침으로", "그 위로도 봇이 돌아다니고 건물이 생기는 게 문제"). The bots are kept under the top where they are
    // seated (lifecycle.ts ceilSec); this is for what was built above it before — a herd's pace, a depth turned down, a
    // slot length changed: no part of a slot at or above the top is on the wall.
    const ceilK = this.densityCfg && we0 && (we0.shift ?? 0) > 0 && we0.height ? Math.ceil(we0.topSlot) - 1 : Infinity;
    // (the layer above alone: no part of the present is made — PartsInput.futureOnly)
    for (const s0 of input.futureOnly ? [] : order) {
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
      for (const b of parts) if (b.slot >= floorK && b.slot <= ceilK && !this.isBaked(b.slot)) built.push(b);
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
    // THE RISING WINDOW (erode.ts shift): the last slot below it — nothing is written there any more
    const we = this.densityCfg ? input.weather.erode : null;
    const belowK = we && (we.shift ?? 0) > 0 && we.height ? Math.floor(we.topSlot - we.height) - 2 : null;
    const dCfg = `${box.secPerUnit}:${presentSlots}:${JSON.stringify(input.water)}:${JSON.stringify(input.fold.flow ?? null)}`;
    const dKey = this.densityCfg ? this.slowKey("drain", dCfg) : `${Math.floor(t / box.secPerUnit)}:${seeds.length}:${dCfg}`;
    lapT = this.lap("parts", lapT);
    if (dKey !== this.drainKey) {
      this.drainKey = dKey;
      const rule = `${box.secPerUnit}:${presentSlots}:${JSON.stringify(input.water)}:${JSON.stringify(input.fold.flow ?? null)}`;
      // (THE BLOCK: with the density's buildings anybody may write at any depth, so nothing laid is kept as it was,
      // and the ground is read per slot from what stands in it — water.ts DrainageOptions.block)
      const inBlock = !!this.densityCfg;
      // (…but below a RISING window nobody writes any more: what was laid there is kept as it is — the samples it was
      // laid from are forgotten in time, and it must not go with them)
      const kept = (!inBlock || belowK !== null) && this.drainKept && this.drainKept.rule === rule ? this.drainKept : undefined;
      this.drain = drainage(this.events, seeds, input.water, { secPerUnit: box.secPerUnit, flow: input.fold.flow ?? DEFAULT_FLOW, tNow: t, frozen: kept, present: presentSlots, block: inBlock });
      // the slots before the present are done: what was laid there stays
      // only what lies below the present thickness is done; the present keeps changing
      const upToK = belowK ?? Math.floor(t / box.secPerUnit) - presentSlots;
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
      const rule = `${box.secPerUnit}:${box.unit}:${presentSlots}:${JSON.stringify(wk)}:${JSON.stringify(input.fold.flow ?? null)}`;
      // (THE BLOCK: with the density's buildings anybody may write at any depth, so no layer is kept as it was)
      const kept = (!this.densityCfg || belowK !== null) && this.walkKept && this.walkKept.rule === rule ? this.walkKept : undefined;
      const upToK = belowK ?? Math.floor(t / box.secPerUnit) - presentSlots;
      const port = wk && this.densityCfg ? this.walkPort : null;
      if (port && wk) {
        // THE WAYS ARE LAID IN A WORKER OF THEIR OWN (2026-11-16: with the artist's values a round was 10.8 s of this
        // worker's 13 — the buildings waited for it every time): the round is ASKED here and its answer taken when it
        // comes (attachPorts); meanwhile the ways stand as they were. One round at a time: while one is out the key
        // is left as it was, so the next is asked as soon as that one is back.
        if (this.walkAsked && performance.now() - this.walkAsked.at > WALK_LOST_MS) this.walkAsked = null;
        if (!this.walkAsked) {
          this.walkKey = wKey;
          this.walkAsked = { rule, upToK, serial: ++this.walkSerial, at: performance.now() };
          // (the seeds without what the ways do not read: the levels, masses and gatherings of every slot)
          const slim = seeds.map((sd) => ({ id: sd.id, material: sd.material, role: sd.role, x: sd.x, z: sd.z, t0: sd.t0, t1: sd.t1, spans: sd.spans, mass: sd.mass }));
          port.postMessage({ type: "walk", serial: this.walkSerial, seeds: slim, cfg: wk, opts: { secPerUnit: box.secPerUnit, unit: box.unit, flow: input.fold.flow!, tNow: t, frozen: kept ? { layers: kept.layers, upToK: kept.upToK } : undefined, present: presentSlots } } satisfies WalkRequest);
        }
      } else {
        this.walkKey = wKey;
        this.walkAsked = null;
        this.walks = wk ? walkways(this.events, seeds, wk, { secPerUnit: box.secPerUnit, unit: box.unit, flow: input.fold.flow!, tNow: t, frozen: kept, present: presentSlots }) : NO_WALKWAYS;
        this.walkKept = wk ? { rule, layers: this.walks.layers.filter((l) => l.k <= upToK), upToK } : null;
      }
    }
    if (this.walkPort && this.walkMs) this.stages["walk round (ms, own worker)"] = this.walkMs;
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
    const old = (slot: number, x?: number, z?: number, top = ec ? ec.topSlot : 0): number => {
      if (!ec || fresh <= 0) return 1;
      const n = spread > 0 && x !== undefined && z !== undefined ? fresh * (1 + spread * (placeNoise(x, z, slot, ec.grain * 2) * 2 - 1)) : fresh;
      return Math.max(0, Math.min(1, (top - (slot + 0.5)) / Math.max(1e-6, n)));
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
    // THE AGE'S CLOCK WHILE THE RISE STANDS (erode.ts stood): a cell-slot's age is the top's way since it was built —
    // and, with the rise stopped, the way the top would have gone meanwhile. Kept beside where the top stood (`top`:
    // the depth is still read off that) as what this clock stood at then (`stood`). The assets, the erosion's progress,
    // the plants' coming and the fossil's age all go by the two together.
    const stoodE = ec ? Math.max(0, ec.stood ?? 0) : 0;
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
          // (the rising window: what was found standing is taken as built when the top was at its own slot — it has
          // sunk all the way since)
          if (!e) m.set(k, { born: found ? ageNow - lifeSec - waitSec : ageNow, level: lv, top: found ? k + 0.5 : ec.topSlot, stood: stoodE });
          else if (lv > e.level) {
            e.level = lv;
            // (where an asset stands the building's growing elsewhere builds nothing: only people coming back do)
            if (!this.assets.get(sd.id)?.has(k)) {
              e.born = ageNow;
              e.top = ec.topSlot;
              e.stood = stoodE;
            }
          }
        }
        if (m.size > sd.levels.size) for (const k of m.keys()) if (!sd.levels.has(k)) m.delete(k);
      }
      if (this.bornT.size > live.size) for (const id of this.bornT.keys()) if (!live.has(id)) this.bornT.delete(id);
    }
    // SIMPLIFIED WITH TIME (the artist, 2026-11-16: "시간이 지나면 부재에 lod가 적용돼서 단순화되는 시기를 거치도록
    // 만들기 (boolean union이나): 이러면 거기 재방문해서 건물이 새로 생기더라도 이전 에셋 위에 생기는 거니까 커지는
    // 거랑 효과 비슷하게"). A cell-slot that has stood `lodSec` (each a little sooner or later) is no longer its many
    // parts: it is its ASSET — its masses, with its plates and foundation kept; the columns, the steel and what hangs
    // are let go. From then on the building's growing elsewhere changes nothing of it. When somebody comes BACK to
    // it, what they build is built OVER the asset — in another layout than the first, so it shows — and once that
    // too has stood long enough it is taken into the asset, which is then a little larger: the place grows by what
    // was built on it, not by being made again larger. The asset goes on (erodes, fuses) by the clock of what it was
    // first made from.
    // THE ASSETS OF ONE BUILDING IN ONE SLOT ARE ONE BODY (the artist, a day later: "이웃끼리도 합치고", "합쳤을 때
    // 모양 유지"): their masses are joined on a lattice (latticeUnion) — the outline of the masses kept to the
    // lattice's width, as few boxes as cover it — whichever cell they stood in.
    const lodSec = ec && lifeSec > 0 ? Math.max(0, ec.lodSec ?? 0) : 0;
    const lodGone: [Box, number][] = [];
    if (lodSec > 0 && ec) {
      const shiftL = Math.max(0, ec.shift ?? 0);
      const perTopL = shiftL > 0 ? Math.max(1, ec.slotSec ?? box.secPerUnit) / shiftL : 0;
      const grid = Math.max(0.1, ec.lodGrid ?? 0.5);
      // (the fossil's units: a wider lattice than the asset's own — never finer; 0 = none)
      const unitGrid = (ec.lodUnit ?? 0) > 0 ? Math.max(grid, ec.lodUnit ?? 0) : 0;
      const fossilUnits: Box[] = [];
      const seedOf = new Map(seeds.map((sd) => [sd.id, sd] as const));
      const runsOf = this.buildingsOfSeeds(box);
      const isMass = (b: Box) => b.kind === "mass" && !b.tilt;
      const isKept = (b: Box) => b.kind === "slab" || b.kind === "plinth" || b.kind === "basement" || b.kind === "pile";
      const groups = new Map<number, Map<number, Box[]>>();
      for (const b of built) {
        let g = groups.get(b.seed);
        if (!g) groups.set(b.seed, (g = new Map()));
        const l = g.get(b.slot);
        if (l) l.push(b);
        else g.set(b.slot, [b]);
      }
      /** The parts of slot k of a building in the layout of generation g (cached while the building is as it is). */
      const variant = (seed: number, k: number, g: number): Box[] => {
        const sd = seedOf.get(seed), hit = this.partCache.get(seed);
        if (!sd || !hit) return [];
        const vk = `${seed}|${g}|${hit.key}`;
        let bySlot = this.lodVariants.get(vk);
        if (!bySlot) {
          if (this.lodVariants.size > 400) this.lodVariants.clear();
          const lv = level.get(seed) ?? 0;
          const sv: Seed = { ...sd, mass: Math.round(sd.mass * 4) / 4, id: (seed ^ Math.imul(g, 0x9e3779b1)) >>> 0 };
          bySlot = new Map();
          for (const b of boxesOfSeed(sv, lv === 2 ? solid(sd) : lv === 1 ? thinned(sd) : box)) {
            b.seed = seed;
            const l = bySlot.get(b.slot);
            if (l) l.push(b);
            else bySlot.set(b.slot, [b]);
          }
          this.lodVariants.set(vk, bySlot);
        }
        return bySlot.get(k) ?? [];
      };
      const out: Box[] = [];
      // the assets by building and slot: what is joined into one body
      type Asset = NonNullable<ReturnType<NonNullable<ReturnType<SpaceModel["assets"]["get"]>>["get"]>>;
      const bodies = new Map<string, { seed: number; st: Asset }[]>();
      let nAssets = 0;
      for (const [seed, slotsOf] of groups) {
        const clocks = this.bornT.get(seed);
        let states = this.assets.get(seed);
        const runs = runsOf.get(seed);
        for (const [k, parts] of slotsOf) {
          const e = clocks?.get(k);
          let st = states?.get(k);
          if (!e && !st) {
            // (a slot with no clock of its own: nothing is known of its age — as it is)
            for (const b of parts) out.push(b);
            continue;
          }
          if (e) {
            const age = perTopL > 0 ? (ec.topSlot - e.top + stoodE - (e.stood ?? 0)) * perTopL : ageNow - e.born;
            const old = age >= lodSec * (0.7 + 0.6 * hash2(seed, k, 4421));
            if (!st) {
              if (!old) {
                for (const b of parts) out.push(b);
                continue;
              }
              const clock = { born: e.born, top: e.top, stood: e.stood };
              st = { src: parts.filter(isMass), kept: parts.filter(isKept).map((b) => ({ ...b })), clock, seenBorn: e.born, over: null, gen: 0, swapAt: arriveQuiet ? -Infinity : arriveNow, swapped: parts };
              for (const q of st.kept) this.assetClock.set(q, clock);
              if (!states) this.assets.set(seed, (states = new Map()));
              states.set(k, st);
            } else if (e.born !== st.seenBorn) {
              // SOMEBODY CAME BACK: what they build stands over the asset — and is taken into it once it is old enough
              if (!st.over) {
                st.gen++;
                st.over = variant(seed, k, st.gen);
                if (!arriveQuiet) st.over.forEach((b, i) => this.lodArrive.set(b, [arriveNow, i]));
              }
              if (old) {
                st.swapped = st.over;
                st.src = [...st.src, ...st.over.filter(isMass)];
                st.seenBorn = e.born;
                st.over = null;
                st.swapAt = arriveQuiet ? -Infinity : arriveNow;
              } else for (const b of st.over) out.push(b);
            }
          }
          if (!st) continue;
          nAssets++;
          for (const q of st.kept) out.push(q);
          // (the parts an asset took the place of shrink away, one after another — the erosion's tick)
          if (arriveNow < st.swapAt + LEAVE_KEEP_S) st.swapped.forEach((b, i) => lodGone.push([b, st!.swapAt + Math.min(2, i * 0.04)]));
          else if (st.swapped.length) st.swapped = [];
          // its building at this slot: the body its masses are joined into
          let bid = `${seed}`;
          if (runs) for (const rn of runs) if (k >= rn.k0 && k <= rn.k1) bid = rn.id;
          const bk = `${bid}|${k}`;
          const l = bodies.get(bk);
          if (l) l.push({ seed, st });
          else bodies.set(bk, [{ seed, st }]);
        }
        if (states) for (const k of states.keys()) if (!slotsOf.has(k)) states.delete(k);
      }
      for (const id of this.assets.keys()) if (!groups.has(id)) this.assets.delete(id);
      // each building's assets of a slot as one body — made again only when the assets in it are other than they were
      for (const [bk, members] of bodies) {
        members.sort((p, q) => p.seed - q.seed);
        const sig = `${grid}|${unitGrid}|${members.map((m) => `${m.seed}:${m.st.gen}:${m.st.src.length}`).join(",")}`;
        let body = this.assetGroups.get(bk);
        if (!body || body.sig !== sig) {
          const masses: Box[] = [];
          let clock = members[0].st.clock;
          for (const m of members) {
            for (const q of m.st.src) masses.push(q);
            if (m.st.clock.born < clock.born) clock = m.st.clock; // (the oldest of them: what the body was first made from)
          }
          body = { sig, boxes: SpaceModel.latticeUnion(masses, grid, Math.max(0.05, box.unit / 2)), units: unitGrid > 0 ? SpaceModel.latticeUnion(masses, unitGrid, Math.max(0.05, box.unit / 2)) : null };
          for (const q of body.boxes) this.assetClock.set(q, clock);
          if (body.units) for (const q of body.units) this.assetClock.set(q, clock);
          this.assetGroups.set(bk, body);
        }
        for (const q of body.boxes) out.push(q);
        if (body.units) for (const q of body.units) fossilUnits.push(q);
      }
      this.fossilUnits = fossilUnits;
      for (const bk of this.assetGroups.keys()) if (!bodies.has(bk)) this.assetGroups.delete(bk);
      // (for the readout: how many cell-slots are assets, and how many parts that left of how many)
      this.stages["asset slots (n)"] = nAssets;
      this.stages["parts before assets (n)"] = built.length;
      this.stages["parts after assets (n)"] = out.length;
      built = out;
    } else if (this.assets.size) {
      this.assets.clear();
      this.assetGroups.clear();
      this.fossilUnits = [];
    }
    /** Seconds a part's cell-slot has been there past its wait, in the clock's shared steps (AGE_STEPS to `lifeSec`:
     *  all parts move at once, so nothing is worked out again between two steps). A part below its building's slots
     *  (a pile, a basement) goes with the building's first slot. */
    const step = lifeSec > 0 ? lifeSec / AGE_STEPS : 1;
    /** Which beat a place moves on at: 0 … AGE_PHASES − 1, alike within a patch. */
    const phaseOf = (x: number, z: number, slot: number): number => (ec ? Math.min(AGE_PHASES - 1, Math.floor(placeNoise(Math.floor(x / CELL) * CELL, Math.floor(z / CELL) * CELL, slot, ec.grain * 2) * AGE_PHASES)) : 0);
    const aged = (b: Box): number => {
      const m = this.bornT.get(b.seed);
      if (!m) return 0;
      // (an asset: the clock of what it was first made from)
      let e: { born: number } | undefined = this.assetClock.get(b) ?? m.get(b.slot);
      if (!e) {
        let lo = Infinity;
        for (const k of m.keys()) if (k < lo) lo = k;
        e = m.get(lo);
        if (!e) return 0;
      }
      // PATCH BY PATCH (the artist, 2026-11-15: "융합 비주얼을 '유기적으로' 나타나는 것처럼"): the steps are still
      // the clock's — but each patch of the block (the erosion's patches, twice as wide) has its own beat, one of
      // AGE_PHASES: the whole wall no longer moves on at one moment, it moves on here, then there
      const ph = (phaseOf(b.x, b.z, b.slot) * step) / AGE_PHASES;
      return Math.max(0, Math.floor((ageNow + ph) / step) - Math.floor((e.born + waitSec + ph) / step)) * step;
    };
    /** How fast a part's place lets it go on (0 … 1). */
    const weight = (b: Box): number => (ero ? Math.max(0, Math.min(1, ero.at(b) * old(b.slot, b.x, b.z))) : 0);
    /**
     * THE RISING WINDOW: a cell-slot's progress is what its place let it go on at every moment since it was built —
     * and its place changes: it sinks as the top rises. Summed over the top's way from where it stood when the
     * cell-slot was built (plus the wait) to where it stands now, in the clock's shared steps (and the patch's beat):
     * Σ weight(depth at that top) × the time the top took over that stretch ÷ lifeSec. No wall clock in it — only
     * how far the window has moved — so it is the same at any time rate.
     */
    const shiftRate = ec && lifeSec > 0 ? Math.max(0, ec.shift ?? 0) : 0;
    const slotSecE = Math.max(1, ec?.slotSec ?? box.secPerUnit);
    const gatherOfSeed = new Map<number, ReadonlyMap<number, number> | undefined>();
    const xzOfSeed = new Map<number, [number, number]>();
    if (shiftRate > 0) {
      for (const sd of seeds) {
        gatherOfSeed.set(sd.id, sd.gather);
        xzOfSeed.set(sd.id, [sd.x, sd.z]);
      }
    }
    const sunkMemo = new Map<number, Map<number, [number, number]>>();
    /** [progress, how far past its wait the cell-slot is, in steps] of a cell-slot in the rising window. */
    const sunk = (seed: number, slot: number, clock?: { top: number; stood?: number }): [number, number] => {
      let ms = sunkMemo.get(seed);
      if (!ms) sunkMemo.set(seed, (ms = new Map()));
      // (an asset goes by its own clock — the one of what it was first made from: kept beside the cell-slot's)
      const mk = clock ? slot + 0.5 : slot;
      const hit = ms.get(mk);
      if (hit) return hit;
      let out: [number, number] = [0, 0];
      const m = this.bornT.get(seed);
      let e: { top: number; stood?: number } | undefined = clock ?? m?.get(slot);
      if (!clock && m && !e) {
        let lo = Infinity;
        for (const k of m.keys()) if (k < lo) lo = k;
        e = m.get(lo);
      }
      if (e && ec) {
        const perTop = slotSecE / shiftRate; // seconds the top takes over one slot
        const lifeTop = lifeSec / perTop, waitTop = waitSec / perTop;
        const stepTop = lifeTop / AGE_STEPS;
        const [sx, sz] = xzOfSeed.get(seed) ?? [0, 0];
        const ph = (phaseOf(sx, sz, slot) * stepTop) / AGE_PHASES;
        // (on the age's clock — the top's way plus what went on while the rise stood, erode.ts stood. The depth at
        // each moment is read below the top where it really was: taken as risen first, then standing where it is)
        const sb = e.stood ?? 0;
        const t0 = e.top + sb + waitTop;
        const t1 = Math.floor((ec.topSlot + stoodE + ph) / stepTop) * stepTop - ph;
        if (t1 > t0) {
          const g = gatherOfSeed.get(seed)?.get(slot) ?? 0;
          const N = 8;
          let sum = 0;
          for (let q = 0; q < N; q++) {
            const top = Math.min(ec.topSlot, t0 + ((q + 0.5) / N) * (t1 - t0) - sb);
            sum += Math.max(0, Math.min(1, erosionAt(slot, g, { ...ec, topSlot: top }) * old(slot, sx, sz, top)));
          }
          out = [Math.min(1, ((sum / N) * (t1 - t0)) / lifeTop), (t1 - t0) / stepTop];
        }
      }
      ms.set(mk, out);
      return out;
    };
    /** A part's progress, 0 … 1. Without a life time (lifeSec 0) the place alone, as before. */
    const progMemo = new Map<Box, number>();
    const progress = (b: Box): number => {
      let v = progMemo.get(b);
      if (v === undefined) {
        if (shiftRate > 0) v = sunk(b.seed, b.slot, this.assetClock.get(b))[0];
        else {
          const wgt = weight(b);
          v = lifeSec > 0 ? Math.min(1, (wgt * aged(b)) / lifeSec) : wgt;
        }
        progMemo.set(b, v);
      }
      return v;
    };
    // the erosion reads the progress: a part is gone when it has passed the part's own threshold
    const amount = ec ? Math.min(1, Math.max(0, ec.amount)) : 0;
    // (the erosion and the fusion both run over the whole progress, side by side — the artist, 2026-11-16: "건물이
    // 있는데 화석화되는 구간도 있어야지": a part stands while its fossil grows, and may go later. With the seeded mass
    // — fuse.ts — nothing has to be kept in step: the fossil's shape stands, and a part that goes leaves it.)
    const eroded = progress;
    const life: Erosion | null =
      ec && ero
        ? {
            at: eroded,
            gone: (b) => {
              const e = eroded(b) * amount;
              if (e <= 0) return false;
              let th = this.erodeMemo.get(b);
              if (th === undefined) this.erodeMemo.set(b, (th = erodeThreshold(b, ec)));
              return th < e;
            },
          }
        : null;
    // the plants come once the part is built: nothing during the wait, all of them a few steps on
    this.partSettled = ec && lifeSec > 0 ? (shiftRate > 0 ? (b: Box) => Math.min(1, sunk(b.seed, b.slot, this.assetClock.get(b))[1] / 2) : (b: Box) => Math.min(1, aged(b) / (2 * step))) : null;
    this.blockClock = ec && ero ? { top: ec.topSlot, decay: (b) => Math.max(0, Math.min(1, progress(b) * own(b))), layer: (k) => erosionAt(k, 0, ec) * old(k), old, erode: ec } : null;
    const pipeErode = ec && ec.pipes !== false ? (p: PipeRun) => pipeErosion((p.ax + p.bx) / 2, (p.az + p.bz) / 2, Math.floor(p.k - input.water.pipeDepth), ec) : null;
    this.eroded = life && ec ? { ...life, feed: ec.feed } : null;
    const stands = life ? built.filter((b) => !life.gone(b)) : built;
    // THE EROSION TICKS (the artist, 2026-11-15: "침식도 티커 적용해서 부드럽게 이어져 보이도록"). The progress moves
    // in steps, so every part that passed its threshold within a step went at the same moment: a batch gone at once.
    // Each part now goes at ITS OWN moment: how far into the step it passed (its threshold between what it was at the
    // last reading and what it is now) is how far into the NEXT step's length it leaves — the parts of a step go one
    // after another, in the order and at the spacing they passed. To everything that reads the block (the mass, the
    // plants) such a part is gone already; it is only still DRAWN until its moment (and a little after: the shader
    // takes it out). A part with no reading before (a load, a knob turned) is simply not there, as it was.
    const leaving: Box[] = [];
    const leaveAt = new Map<Box, number>();
    if (life && ec && lifeSec > 0 && ec.spread !== false) {
      const stepSec = lifeSec / AGE_STEPS;
      const seen = new Map<number, Map<number, [number, number]>>();
      for (const b of built) {
        const k = SpaceModel.partKey(b);
        const e = eroded(b) * amount;
        const was = this.erodeSeen.get(b.seed)?.get(k);
        let at = STANDS;
        if (life.gone(b)) {
          if (was && was[1] !== STANDS) at = was[1];
          else if (was && !arriveQuiet && e > was[0]) {
            let th = this.erodeMemo.get(b);
            if (th === undefined) this.erodeMemo.set(b, (th = erodeThreshold(b, ec)));
            at = arriveNow + Math.max(0, Math.min(1, (th - was[0]) / (e - was[0]))) * stepSec;
          } else at = -Infinity;
          if (arriveNow < at + LEAVE_KEEP_S) {
            leaving.push(b);
            leaveAt.set(b, at);
          }
        }
        let m = seen.get(b.seed);
        if (!m) seen.set(b.seed, (m = new Map()));
        m.set(k, [e, at]);
      }
      this.erodeSeen = seen;
    } else if (this.erodeSeen.size) this.erodeSeen = new Map();
    // (…and the parts an asset has taken the place of: drawn until they have shrunk away)
    for (const [b, at] of lodGone) {
      if (leaveAt.has(b)) continue;
      leaving.push(b);
      leaveAt.set(b, at);
    }
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
    // (…and the parts on their way out: drawn until their moment — the erosion's tick)
    const all = bakedBoxes.length || leaving.length ? [...bakedBoxes, ...shown, ...leaving] : shown;

    const counts = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    for (const b of all) counts[b.kind] = Math.min(PART_CAPACITY[b.kind], counts[b.kind] + 1);
    const matrices = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 16)])) as Record<PartKind, Float32Array>;
    const colors = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 3)])) as Record<PartKind, Float32Array>;
    const fill = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
    const born = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k] * 2)])) as Record<PartKind, Float32Array>;
    const gone = Object.fromEntries(PART_KINDS.map((k) => [k, new Float32Array(counts[k]).fill(STANDS)])) as Record<PartKind, Float32Array>;
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
      const came = (arriving ? this.arrivals.of(b) : undefined) ?? this.lodArrive.get(b);
      born[k][i * 2] = came ? came[0] : ARRIVED;
      born[k][i * 2 + 1] = came ? came[1] : 0;
      const goes = leaveAt.get(b);
      if (goes !== undefined) gone[k][i] = Math.max(-1e9, goes);
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
    // WHAT THE WALL SHOWS, FOR THE VEGETATION (the artist, 2026-11-15: "식생이 건물보다 먼저 보였음"): the clouds gave
    // way to the people's density on the main thread, seconds before the building it becomes had come through here
    // and ticked in. They are now told what is built by the wall itself: every built cell-slot, how long it has been
    // there and how far it has gone on — [cell x, cell z, slot, seconds since built (−1 = long), progress].
    let cells: Float32Array | undefined;
    if (this.densityCfg) {
      let n = 0;
      for (const sd of seeds) n += sd.levels?.size ?? 0;
      cells = new Float32Array(n * 5);
      let ci = 0;
      const amountC = ec ? Math.min(1, Math.max(0, ec.amount)) : 0;
      for (const sd of seeds) {
        if (!sd.levels) continue;
        const cx = Math.floor(sd.x / CELL), cz = Math.floor(sd.z / CELL);
        const m = this.bornT.get(sd.id);
        for (const k of sd.levels.keys()) {
          const e = m?.get(k);
          const age = e ? this.ageClock - e.born : -1;
          let prog = 0;
          if (ec) {
            const wgt = Math.max(0, Math.min(1, erosionAt(k, sd.gather?.get(k) ?? 0, ec) * old(k, sd.x, sd.z)));
            const step2 = lifeSec > 0 ? lifeSec / AGE_STEPS : 1;
            const ph2 = (phaseOf(sd.x, sd.z, k) * step2) / AGE_PHASES;
            const aged2 = e ? Math.max(0, Math.floor((this.ageClock + ph2) / step2) - Math.floor((e.born + waitSec + ph2) / step2)) * step2 : 0;
            prog = (shiftRate > 0 ? sunk(sd.id, k)[0] : lifeSec > 0 ? Math.min(1, (wgt * aged2) / lifeSec) : wgt) * amountC;
          }
          cells.set([cx, cz, k, age > 1e5 || !e ? -1 : age, prog], ci);
          ci += 5;
        }
      }
    }
    this.lap("emit", lapT);
    return {
      cells,
      counts: fill,
      matrices,
      colors,
      born,
      gone,
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
    const tFuse0 = performance.now();
    const { box } = input;
    // THE BLOCK: its clock is a place — the "present" the layers are read against is the block's top, which stands
    const bc = this.blockClock;
    // THE MASS'S GRID IS NO FINER THAN WHAT IT GROWS ON (fuse.ts voxelTie): on the simplified bodies, at least that
    // share of their lattice
    const tie = bc && input.fuse.assetsOnly !== false && (bc.erode.lodSec ?? 0) > 0 ? Math.max(0, input.fuse.voxelTie ?? 0) * Math.max(0, bc.erode.lodGrid ?? 0) : 0;
    const fuse = tie > input.fuse.voxel ? { ...input.fuse, voxel: Math.round(tie * 1000) / 1000 } : input.fuse;
    this.stages["fuse voxel"] = fuse.voxel;
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
      this.dropUnits();
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
    type P = { b: Box; d: number; up: boolean; sk: boolean; ang: number; grow?: number[] };
    // the angle each seed's district is turned by (fuseTiled)
    const angleOf = new Map<number, number>();
    if (box.variety) for (const sd of this.seeds) angleOf.set(sd.id, districtOf(sd.x, sd.z, box.variety).angle);
    const bySlot = new Map<number, P[]>();
    // THE CRUST (fuse.ts crust): what the fusion is handed for a part is how far the crust has come there — the
    // part's progress × the vegetation gathered at its cell-slot (the unlived share: where nobody stayed the plants
    // gathered, and there the crust grows; `crustVeg` 0 = the progress alone). Every part goes in, whatever its
    // progress (the hull is the whole building's), and those the erosion has taken too: the crust stays over what
    // stood there.
    const crustOn = !!bc && !!fuse.crust;
    const crustVeg = Math.max(0, Math.min(1, fuse.crustVeg ?? 0.5));
    // THE MASS GROWS WHERE THE VEGETATION GATHERED — whatever it is made of (the artist, 2026-11-15: "식생 기여 포함"):
    // the same share for the parts' own skins as for the crust. In the block only.
    const gatherOfSeed = bc && (crustOn || crustVeg > 0) ? new Map(this.seeds.map((sd) => [sd.id, sd.gather] as const)) : null;
    // THE MASS GROWS ON WHAT HAS BEEN SIMPLIFIED (the artist, 2026-11-16: "융합!!!!! 일단 해보자" — after the buildings
    // were given their stage of simplification): built → simplified with time (computeParts: the asset) → fused. A
    // part still in its many pieces is new building — nothing grows on it; the mass is the simple body's, and the
    // orthogonal body stands inside it. (With the simplification off there are no assets: every part, as before.)
    const assetsOnly = !!bc && fuse.assetsOnly !== false && (bc.erode.lodSec ?? 0) > 0;
    // SEEDED (fuse.ts seeded): the mass as it will be when all of it has fused, and for every part what its progress
    // is made of — the wall works the progress out itself. A part that goes before its fossil begins (its erosion's
    // threshold comes first) leaves nothing, and is not in it; nor one where no vegetation makes mass.
    const seeded = !!bc && !!fuse.seeded && assetsOnly && (bc.erode.shift ?? 0) > 0 && !crustOn;
    const seedXZ = seeded ? new Map(this.seeds.map((sd) => [sd.id, [sd.x, sd.z] as const] as const)) : null;
    const spreadS = Math.max(0, Math.min(1, fuse.freshSpread ?? 0)), freshS = Math.max(0, fuse.freshSlots ?? 0);
    const amountS = bc ? Math.min(1, Math.max(0, bc.erode.amount)) : 0;
    const goneKey = bc ? `${JSON.stringify({ ...bc.erode, topSlot: 0, stood: 0 })}:${fuse.fuseOnset}:${freshS}:${spreadS}` : "";
    // (THE FOSSIL'S UNITS — fossilUnits: with them the seeded mass is made of the wider bodies, and the asset's own
    // masses — what is drawn — carry none; its plates and foundation go in as they are: they bound the rooms)
    const unitsOn = seeded && this.fossilUnits.length > 0;
    // (the fossil that has gone — FuseInput.dead: read on a clock that moves in steps, so the parts of a piece are
    // let go together and the piece is made again once for them, not once for each)
    const dead = seeded && bc && input.dead && input.dead.at > 0 ? input.dead : null;
    const deadStep = dead ? Math.max(1, dead.at / 10) : 1;
    const deadNow = dead && bc ? Math.floor((bc.top + Math.max(0, bc.erode.stood ?? 0)) / deadStep) * deadStep : 0;
    const deadH = bc ? Math.max(1, bc.erode.height ?? bc.top) : 1;
    // (how many parts were let go this time — for the readout)
    let letGo = 0;
    const fuseOf = unitsOn ? [...this.built.filter((b) => !(b.kind === "mass" && this.assetClock.has(b))), ...this.fossilUnits] : this.built;
    for (const b of fuseOf) {
      if (STEEL_KINDS.has(b.kind) || b.kind === "drip") continue; // too thin to carry mass or growths
      if (assetsOnly && !this.assetClock.has(b)) continue;
      const up = standing.has(b);
      if (seeded && bc && seedXZ) {
        let th = this.erodeMemo.get(b);
        if (th === undefined) this.erodeMemo.set(b, (th = erodeThreshold(b, bc.erode)));
        const own = spreadS > 0 ? 1 + spreadS * (1 - 2 * th) : 1;
        const g = gatherOfSeed?.get(b.seed)?.get(b.slot) ?? 0;
        const most = 1 - crustVeg * (1 - g);
        if (most < 0.05) continue;
        const [sx, sz] = seedXZ.get(b.seed) ?? [b.x, b.z];
        const nEff = freshS > 0 ? freshS * (spreadS > 0 ? 1 + spreadS * (placeNoise(sx, sz, b.slot, bc.erode.grain * 2) * 2 - 1) : 1) : 0;
        const ac = this.assetClock.get(b);
        const bornTop = ac?.top ?? bc.top;
        // (what the shader reads the fossil's age off: the age's clock at its building — erode.ts stood)
        const bornAge = bornTop + Math.max(0, ac ? (ac.stood ?? 0) : (bc.erode.stood ?? 0));
        // (its fossil's life is over — the wall's shader draws none of it any more: not made)
        if (dead && (deadNow - bornAge - dead.after) * Math.max(0.2, own) * (1 - dead.deep * (1 - Math.max(0, Math.min(1, (bc.top - (b.slot + 0.5)) / deadH)))) >= dead.at) {
          letGo++;
          continue;
        }
        // A PART THAT GOES BEFORE ITS FOSSIL BEGINS LEAVES NONE (the wall's shader lets the fossil out by the layer's
        // depth: FUSE_GROW_VERT_BODY): how deep the part lies when the erosion takes it — its progress summed slot by
        // slot of the top's way, as computeParts does — against the depth its fossil begins at (kept per part: it
        // does not change).
        if (amountS > 0 && th < amountS) {
          let goes = this.goneDepth.get(b);
          if (goes === undefined || goes[0] !== goneKey) {
            const ec = bc.erode, H = Math.max(1, ec.height ?? ec.topSlot);
            const perTop = Math.max(1, ec.slotSec ?? box.secPerUnit) / Math.max(1e-6, ec.shift ?? 1);
            const need = (th / amountS) * Math.max(1e-6, (ec.lifeSec ?? 0) / perTop);
            let acc = 0, at = Infinity;
            for (let T = bornTop + (ec.waitSec ?? 0) / perTop + 0.5; T < b.slot + 0.5 + H * 1.2; T++) {
              acc += erosionAt(b.slot, g, { ...ec, topSlot: T }) * (nEff > 0 ? Math.max(0, Math.min(1, (T - (b.slot + 0.5)) / nEff)) : 1);
              if (acc >= need) {
                at = (T - (b.slot + 0.5)) / H;
                break;
              }
            }
            this.goneDepth.set(b, (goes = [goneKey, at]));
          }
          if (goes[1] + (own - 1) * 0.15 <= fuse.fuseOnset) continue;
        }
        // THE PARTS' TRACES STAY INSIDE THE MASS (the artist, 2026-11-16: "거품 열렸을 때 … 안에 부재 흔적이 남아있어야 의도한
        // 느낌이 날 것 같음"): the share of parts kept as skeleton — only thinly wrapped, their orthogonal form left —
        // is kept in the seeded mass too, for good (its mass is the mass as it will be: there is no progress at which
        // the skeleton is swallowed). It was switched off here, and the foam opened on plain mass.
        const e: P = { b, d: 1, up: true, sk: isSkeleton(b, 0, fuse), ang: angleOf.get(b.seed) ?? 0, grow: [b.slot, bornAge, g, own, nEff, most] };
        const l = bySlot.get(b.slot);
        if (l) l.push(e);
        else bySlot.set(b.slot, [e]);
        continue;
      }
      let d = q20(1 - wm.survival(b));
      if (gatherOfSeed) d = q20(d * (1 - crustVeg * (1 - (gatherOfSeed.get(b.seed)?.get(b.slot) ?? 0))));
      if (!crustOn && !up && gone < 1) {
        if (gone <= 0) continue;
        d = q20(d * gone);
      }
      // not corroding yet: nothing grows on it (B FILL: the plates are kept, they bound the rooms of the parts below)
      if (!crustOn && fusedShare(d, fuse) <= 0 && accretionShare(d, fuse) <= 0.01 && !(fuse.study?.fill && FRAME_KINDS.has(b.kind))) continue;
      const e: P = { b, d, up, sk: isSkeleton(b, d, skCfg), ang: angleOf.get(b.seed) ?? 0 };
      const l = bySlot.get(b.slot);
      if (l) l.push(e);
      else bySlot.set(b.slot, [e]);
    }
    const pad = fusePad(fuse);
    const padSlots = Math.ceil((Math.max(pad.above, pad.below) * fuse.voxel + fuse.accDepth) / u) + 1 + (fuse.study?.fill ? FILL_MAX_GAP : 0);
    if (dead) this.stages["fossil parts let go, their life over (n)"] = letGo;
    // BUILDING BY BUILDING (fuse.ts perBuilding): each building's mass from a state kept — fuseBuildings
    if (bc && fuse.perBuilding) {
      if (this.fuseChunks.size || this.districtMass.size) {
        this.fuseChunks.clear();
        this.fusedAt.clear();
        this.districtMass.clear();
        this.unitsEmitted = -1;
      }
      this.stages["fuse prep ms"] = performance.now() - tFuse0;
      // (never "unchanged" for good: the buildings go on changing — every call looks again)
      return this.fuseBuildings(bySlot, h, u, sed, !!layerDecay, fuse, padSlots, box);
    }
    if (this.units.size || this.unitOrphans.length || this.unitJob || this.remoteOn) this.dropUnits();
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
    // (only where anything stands: the top rises without end)
    let sLo = Infinity, sHi = -Infinity;
    for (const k of bySlot.keys()) {
      if (k < sLo) sLo = k;
      if (k > sHi) sHi = k;
    }
    for (let c0 = Math.floor(Math.max(kA, sLo - 24) / NATURE_CHUNK) * NATURE_CHUNK; c0 <= Math.min(kB, sHi + 24); c0 += NATURE_CHUNK) {
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
    // (the density keeps what it has built whatever samples were forgotten since: nothing of it is below a window)
    const floorK = this.densityCfg ? -Infinity : Number.isFinite(this.cutS) ? Math.floor(this.cutS / box.secPerUnit) : -Infinity;
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
    this.stages["fuse prep ms"] = performance.now() - tFuse0;
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
  /** The workers beside the model's (SpaceModel.attachPorts): one end of a channel to each; null = none (any more). */
  | { type: "ports"; fuse?: MessagePort | null; walk?: MessagePort | null }
  | { type: "compute"; id: number; now?: number; parts?: PartsInput; nature?: NatureInput; reclaim?: ReclaimInput; fuse?: FuseInput; paths?: { rise: number; smooth?: number }; future?: FutureConfig };

/**
 * Two compute requests as one (the worker coalesces what queued up behind a long compute): the newer request's
 * clock and parts, with the vegetation / fuse / reclaim work the older one asked for and the newer did not — those
 * come only every NATURE_EVERY ticks and must not be lost with the request that carried them.
 */
export function mergeComputeRequests<T extends Extract<SpaceRequest, { type: "compute" }>>(prev: T | null, next: T): T {
  if (!prev) return next;
  return { ...next, nature: next.nature ?? prev.nature, reclaim: next.reclaim ?? prev.reclaim, fuse: next.fuse ?? prev.fuse, paths: next.paths ?? prev.paths, future: next.future ?? prev.future };
}

/** What the space worker posts back for a compute request. */
export interface SpaceResponse {
  /** Milliseconds per stage of this request (SpaceModel.stages). */
  stages?: Record<string, number>;
  /** The stamp of the code this worker runs (build.ts). */
  build?: string;
  type: "result";
  id: number;
  /** undefined = not asked; null = unchanged. */
  parts?: PartsResult | null;
  nature?: PointsResult | null;
  reclaim?: PointsResult | null;
  fuse?: FuseMesh | null;
  /** The fossil's material as far as it is other than it was (fuse.ts field); absent = as it was / not that way. */
  fossil?: FossilDiff;
  /** The inferred village above the column (futureVillage.ts); null = as it was. */
  future?: FutureResult | null;
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
  if (m.type === "ports") {
    model.attachPorts(m);
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
      if (out.parts.cells) transfer.add(out.parts.cells.buffer as ArrayBuffer);
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
    if (out.fuse) for (const a of [out.fuse.position, out.fuse.normal, out.fuse.color, out.fuse.extra, out.fuse.index, out.fuse.anchor, out.fuse.growA, out.fuse.growB, out.fuse.late]) if (a) transfer.add(a.buffer as ArrayBuffer);
    const fo = model.takeFossil();
    if (fo) {
      out.fossil = fo;
      transfer.add(fo.add.buffer as ArrayBuffer).add(fo.keys.buffer as ArrayBuffer).add(fo.drop.buffer as ArrayBuffer);
    }
  }
  if (m.future) {
    // (a fault in the inferred village must not take the wall with it: an exception here ended the worker, the view
    // fell back to computing on the main thread, and a heavy world then froze the page — seen in the artist's window,
    // 2026-11-16, when the dev server served this with the inference's older code)
    try {
      out.future = m.parts ? timed("future", () => model.computeFuture(m.future!, m.parts!.box)) : null;
    } catch (e) {
      console.warn("[parliament] the inferred village could not be made:", e);
      out.future = null;
    }
    if (out.future) for (const a of [...Object.values(out.future.parts), ...Object.values(out.future.tones), out.future.roads, out.future.roadsOld, out.future.water, out.future.pipes, out.future.mounds, out.future.stains, ...(out.future.vegOld ? [out.future.vegOld] : []), ...(out.future.vegTree ? [out.future.vegTree] : []), ...(out.future.vegWater ? [out.future.vegWater] : []), ...(out.future.vegWild ? [out.future.vegWild] : []), ...(out.future.vegGrass ? [out.future.vegGrass] : []), ...(out.future.plantClouds ? [out.future.plantClouds] : []), ...(out.future.vegScrub ? [out.future.vegScrub] : []), ...(out.future.stones ? [out.future.stones] : []), ...(out.future.treeStems ? [out.future.treeStems] : []), out.future.veg, out.future.ground]) transfer.add(a.buffer as ArrayBuffer);
  }
  out.ms = performance.now() - t0;
  out.stages = { ...model.stages };
  out.build = WALL_BUILD;
  return { out, transfer: [...transfer] };
}
