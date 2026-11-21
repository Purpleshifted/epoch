/**
 * parliament/fuse.ts
 *
 * What a structure BECOMES with age, as one surface (naive surface nets: one vertex per surface cell, quads between).
 * Everything runs on ONE clock, each part's own corrosion (decay = 1 − survival, seeds.wearModel), so it happens on
 * the structure itself, never as a separate slab, and never on a part that has not begun to corrode:
 *
 *   0 GATHERING   already in the present (within the grace depth, before any corrosion) and on until accOnset: no
 *                 mass here — vegetation POINTS gather on and around the part
 *                 (natureHistory.reclaimPoints with a decay clock), densest just before accOnset
 *   1 ACCRETION   accOnset → fuseOnset: lumpy organic matter grows on the part's top and hangs below it, starting as
 *                 small sparse specks (noise-thresholded) and thickening (ref 9578); the points fade out meanwhile
 *   2 FUSION      fuseOnset → 1: the part itself becomes mass, max(share, gain · blurred share) — parts keep their form
 *                 and near ones cling together; a part that has fallen away leaves its mass in its place. Vegetation
 *                 sediment sticks to it (only near decaying concrete)
 *   3 POROSITY    older layers have round voids (refs 9579/9580)
 *
 *   The SKELETON: a share of the concrete parts (slabs, slat bundles) keep their sharp, orthogonal form inside the mass
 *   (drawn as parts, wrapped only thinly) until late — a frame protected in exposed concrete; only the oldest layers
 *   swallow it. The mass SAGS downwards (drips), is smoothed (Taubin), is dense and crisp in the old bottom layers and
 *   breaks into scattered fragments at its edges in the young ones.
 *   4 RESIN       the oldest layers (sediment share ≥ `resinShare`) are a second face group (FuseMesh.resinStart …) for a
 *                 translucent material; their standing parts stay visible inside
 *
 * FORM STUDY (V2, `cfg.study`; all off = the mass wraps the parts as above). Two ways for the same mass, to compare:
 *   B FILL     the mass FILLS the room between a building's plates (refs 9645, 9659): it hangs from the plate above and
 *              grows down to the one below as the parts in the room fuse; the plates stay sharp (a frame, like the
 *              skeleton) and the mass hardly swells past the building
 *   C SHELL    the mass is a SHELL, hollow inside (9649, 9662), opened by cells that touch each other so only RIBS remain
 *              between them (Voronoi, refs 9664–9668, 9648); dark pits on its surface (colour only). Replaces the round voids
 *   (D FIBRE — discs, hanging fibre lines and spines — was tried and dropped: the artist did not want it, 2026-10-19.)
 *
 * The field is sampled on a GLOBAL voxel grid (spacing `voxel`) and meshed in chunks of whole slots. Every chunk
 * computes its field with padding, so neighbouring chunks agree on their shared vertices; each face belongs to the one
 * chunk that owns its edge, so nothing is drawn twice. Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { natureAt, sedimentShare, type NatureHistory, type NaturePointOptions } from "./natureHistory";
import { halfHeight, partHash, type Box } from "./seeds";

export interface FuseConfig {
  enabled: boolean;
  /** Decay at which growths begin on a part (before it, vegetation points gather on it instead). */
  accOnset: number;
  /** Decay at which the part itself begins to turn into mass. */
  fuseOnset: number;
  /**
   * V2: a building's parts in slots at least this many below the present keep the shape they were first built with
   * (the artist, 2026-11-01 evening: "from 4 slots down the parts should not change"). Absent = regenerated whenever the
   * building's mass or slots change (V1).
   */
  freezeSlots?: number;
  /** The corrosion at which the fused mass is full (fusedShare reaches 1); default 1. */
  fuseFull?: number;
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
  /** Downward sag of the mass per voxel (0 = none … 0.9 = long drips). */
  sag: number;
  /** Taubin smoothing passes of the surface (0 = raw voxel facets). */
  smooth: number;
  /** Size of the round voids (world). */
  poreSize: number;
  /** How much the young layers' mass breaks into fragments at its edges (0 = a closed surface everywhere). */
  scatter: number;
  /** Share of the concrete parts that are SKELETON: they keep their sharp form inside the mass. */
  skeleton: number;
  /** Decay up to which the skeleton stands out of the mass (after it, it is swallowed too). */
  skeletonUntil: number;
  /**
   * THE BLOCK — THE COUNT OF LAYERS, MULTIPLIED IN (the artist, 2026-11-15: "융합은 층수 로직도 섞어서", "제일 최신
   * 층은 화석화 되면 안 되는데" → "딱 잘려보이는데, 다른 로직에 곱하거나 하는 식으로(단수를) 조정"). The fusion's
   * clock there is the erosion of a part's place (spaceModel blockClock) TIMES how many slots below the block's top it
   * lies, as a share of `freshSlots`: 0 at the top, 1 from `freshSlots` slots down. A factor, not a line — the
   * newest layers have next to nothing to fuse with, and where the mass begins follows the place's own value (the
   * unlived fuse higher up, the lived lower down). `freshSpread` (0 … 1) lets that depth differ from place to place
   * (× 1 ∓ spread, in the erosion's patches), so it is no plane even where the places are alike.
   * Absent / 0 = the count of layers is not read. Not read outside the block.
   */
  freshSlots?: number;
  freshSpread?: number;
  /**
   * THE BLOCK — WHAT HAS ERODED LEAVES NO MASS (the artist, 2026-11-15: "덩어리도 비우도록"). A part the erosion has
   * taken used to leave its whole mass where it stood (as a part worn away did), so a building fused into its full
   * prism however much of it was gone. Now the mass is of what still stands: the erosion's patches cut it, and what
   * is left are the plates, the columns and the rooms between them. 0 / absent = an eroded part leaves nothing;
   * up to 1 = it leaves that much of its mass (1 = as before). Not read outside the block.
   */
  goneMass?: number;
  /**
   * THE BLOCK — THE MASS CLINGS (the artist, 2026-11-15: "융합덩어리가 건물이 녹는 게 아니라 건물에 엉겨붙도록 하는
   * 게 예전 느낌에 더 맞는 것 같은데"). How much of a fused part the mass takes the place of: 1 / absent = as before the
   * redesign (a fused part is hidden little by little as the mass covers it; the skeleton and the steel stay); 0 = no
   * part is hidden — the building stands whole under what has grown on it. Not read outside the block.
   */
  absorb?: number;
  /**
   * THE BLOCK: the mass is made BUILDING BY BUILDING from a state kept (spaceModel fuseBuildings; the artist,
   * 2026-11-15: "건물 상태를 기점마다 굽고 일정 변화 이상이 감지되면 변화하는 식으로") — a building's mass is made
   * again when its state has moved by `unitChange` (the mean change of its parts, in its most changed band of slots)
   * from the state it was made from. Absent / false = chunk by chunk, tile by tile, as before.
   */
  perBuilding?: boolean;
  unitChange?: number;
  /**
   * THE CRUST (the artist, 2026-11-15: "화석 속에 보존됐던 직교 형태가 깨진 셀 바깥으로 드러나거나 … 보로노이랑 리브를
   * 그 목적으로", "식생 기여 포함" → "1단계 시작"). The mass is no longer a skin round every part: it is ONE SHELL OVER
   * THE BUILDING'S OUTLINE — the hull of its plates and parts, hollow, the parts standing whole inside it — and it is
   * there only where the crust has come: `decay` is then how far the crust has come at each part (the model hands the
   * part's progress × the vegetation gathered at its place: spaceModel computeFuse, `crustVeg`), and it spreads from
   * spots as that rises. The Voronoi cells open in it, the ribs stay, and through them the building is seen.
   * Not used with it: the parts' own skins and tubes, the growths, the filled rooms, the cavities, the envelope's cut,
   * the vegetation's thickening.
   */
  crust?: boolean;
  /** How much the vegetation makes the mass — the crust or the parts' own skins (0 = the progress alone … 1 = only
   *  where vegetation gathered). */
  crustVeg?: number;
  /** THE BLOCK: the mass grows only on what has been simplified with time (spaceModel: the assets) — a part still in
   *  its many pieces is new building. Absent / true = so (when the simplification is on); false = on every part. */
  assetsOnly?: boolean;
  /**
   * THE BLOCK: THE MASS'S SHAPE IS MADE ONCE, AND GROWS ON THE SCREEN (the artist, 2026-11-16: "건물생성시드 참조해서
   * 그렇게 적용 가능하게", "그러면 병렬진행 가능하잖아", "시간대별로 눌러서 안 보이게 … 얼추 생성되는 것처럼", and the three
   * stretches: the part alone → the part standing while its fossil grows → the part gone, the fossil left). A
   * building is what its seed makes it, whatever its progress — so its mass is fused ONCE as it will be when all of
   * it has fused (made again only when its parts are other than they were), and every vertex is given the part it
   * grows from: the point of that part's surface it is PRESSED to, and what that part's progress is made of (its
   * slot, the top when it was built, the vegetation gathered there, its own lead or lag, its layer factor, how much
   * of it fuses). The wall's shader works the part's progress out of the window's top every frame and lets the vertex
   * out of its part by as much: nothing is fused again as the progress moves, and the erosion needs no keeping in
   * step — a part that goes by its tick leaves the fossil that had grown on it. Needs the rising window and the
   * simplification (an asset's clock stands); otherwise the mass is made from the state, as before.
   */
  seeded?: boolean;
  /**
   * THE BLOCK: THE MASS'S GRID IS NO FINER THAN WHAT IT GROWS ON (2026-11-16, with the artist's own values: the
   * simplification's lattice was 1 and the mass was worked out at 0.3 — more than three times finer than the boxes it
   * wraps, a piece of a building 1.5–4.5 s). When the mass grows on the simplified bodies, `voxel` is at least this ×
   * the lattice (spaceModel computeFuse); 0 / absent = `voxel` as it is set. A coarser grid shows as facets on the
   * surface — the artist judges it, and turns this to 0 if it does.
   */
  voxelTie?: number;
  /**
   * THE FOSSIL IN STAGES (spaceModel FuseInput.stages): how many stages, and over how many seconds a group of pieces
   * made again is put on the screen — a slot at a time from the bottom up, each at once (fuseUnits show). Absent / 0 =
   * the mass made once.
   */
  stageN?: number;
  stageSweep?: number;
  /**
   * THE PIECES THE SEEDED MASS IS MADE IN (spaceModel sendUnits → the worker beside; the artist, 2026-11-20: "현재
   * 상태에서도 화석 생성 단위 묶음/타일 더 촘촘하게 만들 수 있지 않나?"): cells of ground a side, and slots of height
   * (absent: 14 × 10, as it was). A smaller piece is made sooner — a change is on the screen sooner, and less is
   * made again for it — but there are more of them, each reading the same margin round itself: the whole takes
   * longer to fill, and there are more faces between pieces to keep closed.
   */
  pieceTile?: number;
  pieceSeg?: number;
  /** How thickly the mass wraps a skeleton part (× its fused share; 1 = like any other part). */
  skeletonWrap: number;
  /** SPIKES: share of the surface cells a thin spike of the same mass grows out of (0 = none). */
  spikes: number;
  /** Longest spike (world); each spike has its own hashed length up to this. */
  spikeLen: number;
  /** Colour of the growths (linear RGB); absent = the pale ochre-green default. */
  growthColor?: [number, number, number];
  /**
   * EXTERNAL PARTS (the artist, 2026-10-20): what joined the buildings fuses too — the water pipes and the walkways
   * as tubes in the field with their own decay, so the mass crosses between buildings along them; and a share of
   * the steel (columns, beams) stays as fossil instead of rusting away.
   */
  fusePipes: boolean;
  /**
   * THE PIPES' TRUNKS IN THE SEEDED MASS (spaceModel trunksNow; the artist, 2026-11-20: "본줄기만 하는 건 ㄱㅊ은 생각인 것
   * 같아"): a pipe run is a trunk when it carries at least this share of the most any run of its slot carries; and
   * in the mass it is this many times its own radius (a bone). Absent: 0.5, 3.
   */
  trunkShare?: number;
  trunkThick?: number;
  fuseWalks: boolean;
  /** A walkway's tube radius (world). */
  walkRadius: number;
  /**
   * THE WAYS' MAIN LINES IN THE SEEDED MASS (spaceModel waysNow; the artist, 2026-11-21: "길도 넣어"): of the ways
   * drawn in a layer, the most used ones up to this share of them (at least one) — each straightened into a few
   * tubes of `wayRadius` (world: a bone in the mass, as a trunk is — `walkRadius` is the drawn way's, a tenth of a
   * unit, under what the mass's grid can hold). Absent: 0.3, 0.45.
   */
  wayShare?: number;
  wayRadius?: number;
  /** The share of the steel parts that fuse into the mass as fossils (0 = none: the steel rusts and falls). */
  steelFossil: number;
  /** FORM STUDY (V2): other ways for the mass; absent = none (the mass wraps the parts). */
  study?: FuseStudy;
}

/** An external part that fuses (FuseChunkInput.tubes): a capsule with its own decay — a pipe, a walkway, a steel part. */
export interface FuseTube {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  r: number;
  /** Decay 0 … 1 on its own clock. */
  decay: number;
  kind: "pipe" | "walk" | "steel";
  /** The slot it belongs to. */
  k: number;
}

/** The form study's switches and numbers (see the file header: B FILL, C SHELL). Both can be combined. */
export interface FuseStudy {
  /** B: the mass fills the rooms between a building's plates; the plates stay sharp. */
  fill: boolean;
  /** B: how full a room gets once its parts have fused (1 = to the plate below). */
  fillAmount: number;
  /** B: how far the fill keeps back from the plate's edges (world). */
  fillInset: number;
  /** C: the mass is a hollow shell with rib-edged openings. */
  shell: boolean;
  /** C: shell thickness (voxels) in the OLD layers (layer age ≥ shellSplit). */
  shellThick: number;
  /** C: shell thickness (voxels) in the YOUNG layers (layer age < shellSplit); the artist, 2026-10-19: thinner above. */
  shellThickYoung: number;
  /** C: the layer age (0 … 1) from which the thick shell applies. */
  shellSplit: number;
  /** C: size of the opening cells (world). */
  ribCell: number;
  /** C: width of the ribs between open cells (world). */
  ribWidth: number;
  /** C: share of the cells that open (× layer age: the old layers are most open). */
  ribOpen: number;
  /**
   * C: the shape of the openings. "voronoi": cells that touch, ribs between them (bone). "noise": openings where a
   * smooth noise runs high — rounded, worm-eaten, merging into one another (ribCell = their size, ribWidth = how
   * soft their edge is). "round": the round voids of ③ (poreSize), on the shell.
   */
  holeShape: "voronoi" | "noise" | "round" | "size";
  /**
   * C: PITS — small round pores scattered over the shell's surfaces (refs 9664, 9665), drawn by the MATERIAL: a
   * jittered scatter of spheres of varied size cut into the shading (a concave dent by normal, a shadow by colour),
   * so they are round, irregular and carved at any size — the voxel grid never sees them. Here: how dark (0 = none).
   */
  pits: number;
  /** C: size of a pit (world). */
  pitSize: number;
  /** C: how much the pits differ in size from place to place (0 = all alike … 1). */
  pitJitter: number;
  /** C: softness of a pit's edge (0 = hard dot … 0.4 = a soft stain). */
  pitSoft: number;
  /** C: how much of the surface the pits cover (0 … 1). */
  pitCover: number;
  /** C: how deep the pits read (the dent's shading; 0 = colour only). Only on the broad faces, away from the ribs. */
  pitDepth: number;
  /** C: how much the pits GATHER in patches (0 = evenly over the surface … 1 = all in patches, bare between). */
  pitGather: number;
  /** C: the size of those patches (world). */
  pitPatch: number;
  /**
   * SIZE CURVES (the artist, 2026-10-19: the look was growing uniform — by size, some elements should follow the
   * Voronoi more, some read more as multipipe, some faces gather the pits and others stay bare). A part's SIZE (its
   * largest extent, world, jittered per part) is read on the band sizeSmall … sizeLarge as t = 0 … 1; each feature
   * has a weight for the small end and one for the large end, blended by t.
   */
  sizeSmall: number;
  sizeLarge: number;
  /** Per-part random variation of the read size (0 = none … 1 = ×⅓ … ×3). */
  sizeJitter: number;
  /**
   * A FORM OF ITS OWN FOR EVERY BUILDING (the artist, 2026-11-20: "형태가 너무 획일화 된 것 같은 건 … 전에는 녹아내리는
   * 꼴을 다르게 둬서 했는데"). The seeded mass is made once, as its oldest form, of a building's few wide bodies: one
   * way of melting for the whole wall. With `meltVary` each building takes ONE of three forms by a number of its own
   * (spaceModel sets Box.melt): the bare FRAME of tubes, a ragged PLATE within the tubes, or the whole round LUMP —
   * `meltFrame` and `meltLump` of them (the rest plates), and by `meltSteer` the deep and long-lived places lean to
   * the lump, the shallow and briefly used ones to the frame. 0 / absent = every part by the settings below, alike.
   */
  meltVary?: number;
  meltFrame?: number;
  meltLump?: number;
  meltSteer?: number;
  /** E by size: the share of a part drawn as its frame (tubes) rather than its box — 0 = box, 1 = tubes only. */
  pipeSize: boolean;
  pipeSmall: number;
  pipeLarge: number;
  /** C holeShape "size": how much the openings follow the Voronoi cells (1) rather than the noise (0). */
  holeVoronoiSmall: number;
  holeVoronoiLarge: number;
  /** C: the pits' coverage × this, by size. */
  pitSmall: number;
  pitLarge: number;
  /**
   * C: how much the pits gather on the BROAD faces — the flat middles of the large closed cells, away from rims and
   * curves (the artist, 2026-10-20: the reference's pores sit on the big smooth faces). 0 = anywhere … 1 = only there.
   */
  pitBroad: number;
  /**
   * FOAM (ref 9579, the artist 2026-10-19): the cells are carved as cavities through the VOLUME, without hollowing —
   * sponge bone. ribOpen = the share of cells that are cavities; the hole shape and the pits apply as on the shell.
   */
  foam: boolean;
  /**
   * ROOMS → CAVITIES (ref 9579 "the rooms become bubbles"): the building's rooms (between its plates, as B FILL
   * finds them) become rounded cavities in the old layers; the parts themselves stay as membranes between them,
   * and a thin membrane breaks. 0 = off … 1 = the room fully carved.
   */
  cavity: number;
  /** How round the cavities are (voxels of blur on the room mask). */
  cavityRound: number;
  /**
   * FOSSIL CURVE: the layer age (0 … 1) where fossilisation starts and where it is complete. Young = architecture
   * (the voxel steps of the parts' boxes), old = fossil (smooth, cavities, the frame embedded).
   */
  fossilFrom: number;
  fossilTo: number;
  /** Young layers keep the voxel steps (ref 9579's cubes): 0 = all smooth … 1 = fully blocky below fossilFrom. */
  blocky: number;
  /** E: plates (slab, plinth) stay plates, with a tube along their rim. */
  platesStay: boolean;
  /** E: the tube radius at the large end of the size band, × pipeRadius. */
  pipeThickLarge: number;
  /** E: joints — balls where the tubes meet (the box corners), radius = tube radius × this (0 = none). */
  pipeJoint: number;
  /** E: how much the frame is embedded again by the fossil curve (0 = frame stays frame in the old layers … 1). */
  pipeFossil: number;
  /** C: the lip — the ribs and opening rims thicken over this band (world; 0 = none). */
  ribLip: number;
  /**
   * ENVELOPE (refs 9706–9708, 9579; the artist 2026-10-20: "architecture, not potatoes"): the mass stays INSIDE the
   * building's outline — the plates' footprints raised between consecutive plates, and every part's box a voxel
   * wider — so the outer faces remain the building's planes and the organic matter is what is carved inside (and
   * breaks out only where it reaches a face). 0 = the mass swells past its parts as before … 1 = cut at the outline.
   */
  envelope: number;
  /** FOSSIL CURVE: noise mixed into the layer age it reads (in units of age), so the fossil's border is not a flat band. */
  fossilNoise: number;
  /** E PIPES: a part fuses as tubes along its edges (its frame), not as its full box — tubes meet and merge like a
   *  multipipe over the building's wireframe; the rooms stay open. */
  pipe: boolean;
  /** E: tube radius (world). */
  pipeRadius: number;
}

export const DEFAULT_STUDY: FuseStudy = {
  fill: false,
  fillAmount: 1,
  fillInset: 0.25,
  shell: false,
  shellThick: 2,
  shellThickYoung: 1,
  shellSplit: 0.6,
  ribCell: 1.6,
  ribWidth: 0.3,
  ribOpen: 0.6,
  holeShape: "voronoi",
  pits: 0.5,
  pitSize: 0.35,
  pitJitter: 0.5,
  pitSoft: 0.12,
  pitCover: 0.45,
  pitDepth: 0,
  pitGather: 0.5,
  pitPatch: 3,
  sizeSmall: 1.5,
  sizeLarge: 8,
  sizeJitter: 0.35,
  pipeSize: false,
  pipeSmall: 0.2,
  pipeLarge: 1,
  holeVoronoiSmall: 0.15,
  holeVoronoiLarge: 1,
  pitSmall: 0.5,
  pitLarge: 1.3,
  pitBroad: 0,
  foam: false,
  cavity: 0,
  cavityRound: 2,
  fossilFrom: 0.3,
  fossilTo: 0.8,
  blocky: 0,
  platesStay: true,
  pipeThickLarge: 2,
  pipeJoint: 1.5,
  pipeFossil: 0,
  ribLip: 0,
  envelope: 0,
  fossilNoise: 0,
  pipe: false,
  pipeRadius: 0.3,
};
/** E: a plate that stays a plate is drawn at this box weight (its rim as tubes on top). */
const PLATE_FRAME = 0.3;

/** B FILL: the plates that bound a room (they stay sharp as frame). */
export const FRAME_KINDS: ReadonlySet<Box["kind"]> = new Set<Box["kind"]>(["slab", "plinth"]);
/** B FILL: the tallest room between two plates (slots); taller = not one room (empty time lies between). */
export const FILL_MAX_GAP = 6;
/** B FILL: how much the blurred mass may still swell outside the rooms (× gain). */
const FILL_OUTSIDE = 0.35;

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
  sag: 0.7,
  smooth: 2,
  poreSize: 1.2,
  scatter: 0.6,
  skeleton: 0.3,
  skeletonUntil: 0.9,
  skeletonWrap: 0.35,
  spikes: 0,
  spikeLen: 1.2,
  fusePipes: true,
  fuseWalks: true,
  walkRadius: 0.15,
  steelFossil: 0,
};

/** Concrete kinds that can be skeleton (the orthogonal frame: slabs, slat bundles and walls, plinths). */
const SKELETON_KINDS = new Set<Box["kind"]>(["slab", "mass", "plinth", "basement"]);

/** Whether a part is skeleton at this decay: it keeps its form (is drawn, not absorbed) and the mass only wraps it. */
export function isSkeleton(b: Box, decay: number, cfg: FuseConfig): boolean {
  if (!cfg.enabled || !SKELETON_KINDS.has(b.kind) || decay >= cfg.skeletonUntil) return false;
  if (cfg.study?.fill && FRAME_KINDS.has(b.kind)) return true; // B FILL: the plates are the frame
  if (cfg.skeleton <= 0) return false;
  // its own hash, independent of the absorption order
  return (partHash(b) * 7.31) % 1 < cfg.skeleton;
}

/** Sample rows of padding a chunk needs: below (blur, smoothing) and above (also the sag hanging down into it). */
/**
 * HOW FAR A PART'S MASS LIES BEYOND ITS BOX (world): its frame's tubes and the balls at their joints stand out of the
 * box by their radius — with thick pipes several units. Two pieces that share a face must both be made of every part
 * whose MASS reaches the field round that face, or each draws the face from other parts and the two do not meet (the
 * artist, 2026-11-20: "화석 표면에서 거친 모서리나 경계면 … 여기서 '열린 곡면'은 발생하면 안 되는 건데"). The pieces
 * chose their parts by the box alone.
 */
export function partReach(cfg: FuseConfig): number {
  const st = cfg.study;
  if (!st || !(st.pipe || st.pipeSize || (st.meltVary ?? 0) > 0)) return 0;
  return Math.max(0, st.pipeRadius) * Math.max(1, st.pipeThickLarge ?? 1) * Math.max(1, st.pipeJoint ?? 0);
}

export function fusePad(cfg: FuseConfig): { below: number; above: number } {
  const st = cfg.study;
  // C: the shell's interior is found by a blur of its own; spikes reach out of the chunk's rows
  const spikeRows = cfg.spikes > 0 ? Math.ceil(cfg.spikeLen / cfg.voxel) + 1 : 0;
  const base = Math.max(2, Math.round(cfg.blur) * 2 + 2) + 2 * Math.max(0, Math.round(cfg.smooth)) + (st?.shell ? Math.round(Math.max(st.shellThick, st.shellThickYoung)) : 0) + spikeRows;
  const sagRows = cfg.sag > 0.01 ? Math.min(10, Math.ceil(Math.log(0.03) / Math.log(Math.min(0.95, cfg.sag)))) : 0;
  return { below: base, above: base + sagRows };
}

export type Sediment = NonNullable<NaturePointOptions["sediment"]>;

const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
const smoothRamp = (x: number, a: number, b: number) => {
  const t = ramp(x, a, b);
  return t * t * (3 - 2 * t);
};

/** How much of a part has itself turned into mass, from its decay (1 − survival). */
/** THE CRUST: its reach at which it is there (against a noise 0.55 … 1.45 of it), the noise's frequency (per world
 *  unit: spots a couple of units across), and the least a loose piece must be of the largest to stay. */
const CRUST_AT = 0.3;
const CRUST_PATCH = 0.45;
const CRUST_BODY = 0.15;

/** The most of the mass the noise openings take (fuseChunk: above it what is left is islands, not a sponge). */
const NOISE_OPEN_MAX = 0.55;

export function fusedShare(decay: number, cfg: FuseConfig): number {
  if (!cfg.enabled) return 0;
  // the mass is full at fuseFull (default 1: it fills slowly all the way); lower, it rises right past the threshold —
  // where the gathered vegetation leaves — instead of appearing only far below it (the artist, 2026-11-01: "cut flat")
  return ramp(decay, cfg.fuseOnset, Math.max(cfg.fuseOnset + 0.01, Math.min(1, cfg.fuseFull ?? 1)));
}

/** How far the growths on a part have come (0 none … 1 full), from its decay. */
export function accretionShare(decay: number, cfg: FuseConfig): number {
  if (!cfg.enabled || cfg.accretion <= 0) return 0;
  return smoothRamp(decay, cfg.accOnset, cfg.fuseOnset);
}

/**
 * How many vegetation points gather on a part (0 … 1). They already gather in the PRESENT, before any corrosion:
 * `pre` (0 … 1) is how deep the part lies in the grace depth (0 at the present, 1 where weathering begins). Then they
 * rise with its decay until accOnset, and fade as the growths take over (gone by halfway to fuseOnset). Without
 * fusion: rising and staying.
 */
export function gatheringShare(decay: number, cfg: FuseConfig, pre = 0): number {
  const up = Math.max(pre, smoothRamp(decay, 0, cfg.accOnset));
  if (!cfg.enabled) return up;
  // with growths: gone by halfway to the fusion; without (accretion 0): they stay until the fusion itself begins
  const to = cfg.accretion > 0 ? (cfg.accOnset + cfg.fuseOnset) / 2 : cfg.fuseOnset;
  return up * (1 - smoothRamp(decay, cfg.accOnset, to));
}

export interface FuseMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Per vertex (4): x = GHOST, how much a part lies right under the surface (the skin shows it); y = FLAT, how
   *  blocky the vertex is (the shader flattens its shading); z = PITS, the pits' coverage here (× by the part's
   *  size, gathered in patches); w = how far from the ribs (0 on a rib: no pit across it). */
  extra: Float32Array;
  /** Opaque faces first, then the resin faces from `resinStart` on. */
  index: Uint32Array;
  /** SEEDED (FuseConfig.seeded) — per vertex: the point it is pressed to (3); [slot, the top when its part was built,
   *  the vegetation gathered there, the part's own lead or lag] (4); [layers until the layer factor is whole (0 = no
   *  factor), how much of it fuses (< 0 = not seeded: whole as it is)] (2). Absent = a mesh made from the state. */
  anchor?: Float32Array;
  growA?: Float32Array;
  growB?: Float32Array;
  /**
   * SEEDED — THE FRAME FIRST, THE PLATES AND ROOMS AFTER (the artist, 2026-11-17: "A2": the multipipe's melting form
   * back — the tubes come out first, the plates and rooms fill in later). Per vertex: 0 = the surface here is the
   * frame's (the parts' edge tubes, the pipes and ways would make it on their own) … 1 = it is the filling's (a part's
   * box, a plate, a filled room, what the blur and the sag add). The wall's shader lets the filling out later.
   * Absent = all frame (no delay).
   */
  late?: Float32Array;
  /**
   * THE PROVISIONAL SKIN (the artist, 2026-11-21: of what a piece shows while its neighbour is being made or waited
   * for, "둘 다 넣는데, 그러면 가장자리에 노이즈 처리나 부피감을 넣어서 뚝 잘린 단면처럼 안 보이게 해"). Per vertex: 0 = a
   * vertex of the piece's own faces; otherwise the faces beyond its own tile or rows (FuseChunkInput.ring) — a copy of
   * the vertex, and which of the six sides it lies beyond (bits: above 1, below 2, +x 4, −x 8, +z 16, −z 32). The
   * worker shows them while the neighbour there is not on the screen (fuseUnits). Absent = none.
   */
  side?: Float32Array;
  /**
   * …AND WHAT CHANGES, CHANGES SOFTLY (the same request): per vertex (4) — the provisional skin's share before the
   * last change, the clock that change came at (fuseUnits' seconds; −1e9 = none), a cross-dissolve (+1 = a piece
   * coming in, −1 = one going out, 0 = neither), and the skin's share now (1 = all of it; the own faces: 1 → 1). The
   * wall's shader goes from the old share to the new and lets the skin go through a noise of the world where it is
   * less than whole; it dissolves the pieces over its blend time. Absent = 1, no change.
   */
  blend?: Float32Array;
  resinStart: number;
}

const EMPTY: FuseMesh = { position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0), extra: new Float32Array(0), index: new Uint32Array(0), resinStart: 0 };

/** Whether slot k has become resin (on the layer's corrosion clock when given, else the sediment clock). */
export function isResin(k: number, sed: Sediment, cfg: FuseConfig, layerDecay?: (k: number) => number): boolean {
  return cfg.enabled && cfg.resinShare <= 1 && (layerDecay ? layerDecay(k) : sedimentShare(k, sed)) >= cfg.resinShare;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lat = (x: number, y: number, z: number, salt: number) => hash2((x * 73856093) ^ z, (y * 19349663) ^ (z * 83492791), salt);
/** Trilinear value noise, 0..1. */
export function noise3(x: number, y: number, z: number, salt: number): number {
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
  // (the line's two ends clamp their reads; the stretch between runs without — the blur is the volume stages' hot
  // loop, 2026-11-21: three passes over every sample for each field blurred)
  const a = Math.min(n, r), b = Math.max(a, n - r - 1);
  let t = 0;
  for (; t < a; t++) {
    dst[o + t * st] = sum * inv;
    sum += src[o + Math.min(n - 1, t + r + 1) * st] - src[o + Math.max(0, t - r) * st];
  }
  let pOut = o + t * st, pAdd = o + (t + r + 1) * st, pSub = o + (t - r) * st;
  for (; t < b; t++) {
    dst[pOut] = sum * inv;
    sum += src[pAdd] - src[pSub];
    pOut += st;
    pAdd += st;
    pSub += st;
  }
  for (; t < n; t++) {
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

/**
 * Round voids: one sphere (or none) per cell of size `size`, at a hashed place with a hashed radius. Returns how deep
 * (x, y, z) lies inside the nearest one (0 outside … 1 at its centre).
 */
function voids(x: number, y: number, z: number, size: number): number {
  const s = Math.max(0.2, size);
  const cx = Math.floor(x / s), cy = Math.floor(y / s), cz = Math.floor(z / s);
  let best = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = cx + dx, Y = cy + dy, Z = cz + dz;
    if (lat(X, Y, Z, 71) > 0.55) continue; // about half the cells have a void
    const px = (X + 0.2 + 0.6 * lat(X, Y, Z, 72)) * s;
    const py = (Y + 0.2 + 0.6 * lat(X, Y, Z, 73)) * s;
    const pz = (Z + 0.2 + 0.6 * lat(X, Y, Z, 74)) * s;
    const r = s * (0.22 + 0.33 * lat(X, Y, Z, 75));
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < r) best = Math.max(best, 1 - d / r);
  }
  return best;
}

/**
 * Voronoi of one jittered point per cell of size `s` (y stretched by `ys`, so the cells are upright ovals): writes the
 * distances to the nearest and second-nearest point and the nearest point's hash (0..1) into `out`.
 */
function voronoi(x: number, y: number, z: number, s: number, ys: number, out: Float64Array): void {
  const sx = Math.max(0.2, s), sy = sx * ys;
  const cx = Math.floor(x / sx), cy = Math.floor(y / sy), cz = Math.floor(z / sx);
  let d1 = Infinity, d2 = Infinity, id = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = cx + dx, Y = cy + dy, Z = cz + dz;
    const px = (X + 0.1 + 0.8 * lat(X, Y, Z, 101)) * sx;
    const py = (Y + 0.1 + 0.8 * lat(X, Y, Z, 102)) * sy;
    const pz = (Z + 0.1 + 0.8 * lat(X, Y, Z, 103)) * sx;
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      id = lat(X, Y, Z, 104);
    } else if (d < d2) d2 = d;
  }
  out[0] = d1;
  out[1] = d2;
  out[2] = id;
}

/** Vertex neighbours from quads (a b c d flip owned), as CSR. */
function neighbours(quads: readonly number[], nv: number): { start: Int32Array; list: Int32Array } {
  const deg = new Int32Array(nv + 1);
  for (let t = 0; t < quads.length; t += 6) for (let e = 0; e < 4; e++) {
    deg[quads[t + e]]++;
    deg[quads[t + ((e + 1) & 3)]]++;
  }
  const start = new Int32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const at = start.slice(0, nv);
  const list = new Int32Array(start[nv]);
  for (let t = 0; t < quads.length; t += 6) for (let e = 0; e < 4; e++) {
    const a = quads[t + e], b = quads[t + ((e + 1) & 3)];
    list[at[a]++] = b;
    list[at[b]++] = a;
  }
  return { start, list };
}

/** Taubin smoothing (λ|μ): rounds the voxel facets without shrinking the mass. In place. */
function taubin(P: Float32Array, quads: readonly number[], nv: number, passes: number, W?: Float32Array): void {
  const { start, list } = neighbours(quads, nv);
  const tmp = new Float32Array(P.length);
  const step = (w0: number) => {
    for (let v = 0; v < nv; v++) {
      const a = start[v], b = start[v + 1];
      const w = W ? w0 * W[v] : w0; // per vertex: the blocky (young) vertices hardly move
      if (b === a || w === 0) {
        tmp[v * 3] = P[v * 3];
        tmp[v * 3 + 1] = P[v * 3 + 1];
        tmp[v * 3 + 2] = P[v * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let e = a; e < b; e++) {
        const u = list[e] * 3;
        sx += P[u];
        sy += P[u + 1];
        sz += P[u + 2];
      }
      const inv = 1 / (b - a);
      for (let c = 0; c < 3; c++) tmp[v * 3 + c] = P[v * 3 + c] + w * ((c === 0 ? sx : c === 1 ? sy : sz) * inv - P[v * 3 + c]);
    }
    P.set(tmp);
  };
  for (let i = 0; i < passes; i++) {
    step(0.5);
    step(-0.53);
  }
}

/** Area-weighted normals from the faces (after smoothing), on the gradient's side; vertices without faces keep theirs. In place. */
function faceNormals(P: Float32Array, quads: readonly number[], N: Float32Array): void {
  const acc = new Float32Array(N.length);
  const tri = (a: number, b: number, c: number) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      acc[v * 3] += nx;
      acc[v * 3 + 1] += ny;
      acc[v * 3 + 2] += nz;
    }
  };
  for (let t = 0; t < quads.length; t += 6) {
    const a = quads[t], b = quads[t + 1], c = quads[t + 2], d = quads[t + 3];
    if (quads[t + 4]) {
      tri(a, c, b);
      tri(a, d, c);
    } else {
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  for (let v = 0; v < N.length; v += 3) {
    // the winding is not tied to the outside: keep the side the field's gradient (the old normal) says is out
    const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]);
    if (l <= 1e-12) continue;
    const sgn = acc[v] * N[v] + acc[v + 1] * N[v + 1] + acc[v + 2] * N[v + 2] < 0 ? -1 : 1;
    N[v] = (sgn * acc[v]) / l;
    N[v + 1] = (sgn * acc[v + 1]) / l;
    N[v + 2] = (sgn * acc[v + 2]) / l;
  }
}

export interface FuseChunkInput {
  /** WHERE A PIECE'S TIME GOES (2026-11-21; the readout): each stage of the chunk adds its ms to `stages["ms <stage>"]`,
   *  and the grid's samples to `stages["grid samples (n)"]`. Absent = not timed. */
  stages?: Record<string, number>;
  /**
   * TILE OWNERSHIP (cells, optional): the grid covers x0 … x0 + nx (± padding) but only the faces whose edge starts in
   * own.x0 … own.x1 × own.z0 … own.z1 are kept — the same rule as the chunk's own rows (k0 … k1), across the ground, so
   * neighbouring tiles join without a seam. Absent = all of x0 … x0 + nx.
   */
  own?: { x0: number; x1: number; z0: number; z1: number };
  /** Every part as BUILT (also those that have fallen away), at least those overlapping the chunk's slots ± padding. */
  parts: readonly Box[];
  /** Per part: decay = 1 − survival (0 fresh … 1 gone). Absent = 1 (all fully decayed). */
  decay?: ArrayLike<number>;

  /** Per part: still standing (accretion only grows on standing parts). Absent = all standing. */
  standing?: ArrayLike<boolean>;
  /** Per part: skeleton (isSkeleton): wrapped only thinly. Absent = none. */
  skeleton?: ArrayLike<boolean>;
  /**
   * Per part: how much of its fused share goes into the field (the artist, 2026-11-21: the iso — "덩어리로 치는 밀도
   * 기준" — raised high changed nothing, "Make iso work"). The seeded mass is made as it will be when all of it has fused,
   * so every part stood in the field at 1 and the iso only trimmed the blur between them. There it is the part's fossil
   * share — how much of it the vegetation makes (spaceModel's `most`, massVeg) — and the iso decides which of them
   * are mass at all: raised, the parts with the least fossil drop out first, the rest still join. Absent = 1.
   */
  weight?: ArrayLike<number>;
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
  /**
   * ONE CLOCK (V2): the typical corrosion (0 … 1) of the parts of slot k — the layer's age on the parts' own clock.
   * It decides the resin (resinShare) and the bottom-heaviness, darkening, voids and crispness of the layers, so the
   * stages always come in order: gathering → growths → fusion → resin. Absent = the sediment clock (V1).
   */
  layerDecay?: (k: number) => number;
  /** EXTERNAL PARTS that fuse too (pipes, walkways, fossil steel), as capsules with their own decay. */
  tubes?: readonly FuseTube[];
  /** THE PROVISIONAL SKIN (FuseMesh.side): the faces this far (world) beyond `own` across the ground, and `reachY`
   *  beyond the chunk's rows, are kept too — as copies marked by their side. Absent = only the own faces. */
  ring?: { reach: number; reachY: number };
  cfg: FuseConfig;
}

/** Linear-RGB colours: fresh concrete, old stone; moss, humus, peat. */
/** The fused mass: the concrete's own grey, mixed in streaks with a low-saturation brown (ref 9570). */
const CONCRETE = [0.42, 0.42, 0.42];
/** The mass's stains: a darker grey, no brown (the artist, 2026-10-19: the soil before the resin is grey too). */
const DULL_BROWN = [0.2, 0.2, 0.2];
/** Accretions (ref 9578: pale ochre-green rock growths). */
const GROWTH = [0.42, 0.38, 0.22];

/** The fused surface of slots [k0, k1]. */
export function fuseChunk(input: FuseChunkInput): FuseMesh {
  const { cfg, unit, sediment: sed, history: h } = input;
  if (!cfg.enabled || input.nx <= 0 || input.nz <= 0) return EMPTY;
  const vs = cfg.voxel;
  // (the stages' clock: a lap adds the time since the last to the stage named — FuseChunkInput.stages)
  const stg = input.stages;
  let tLap = stg ? performance.now() : 0;
  const lap = (name: string) => {
    if (!stg) return;
    const now = performance.now();
    stg[name] = (stg[name] ?? 0) + (now - tLap);
    tLap = now;
  };
  const iso0 = cfg.iso;
  const GROW = cfg.growthColor ?? GROWTH;
  /** The age of a layer (0 … 1): the parts' corrosion clock when given, else the sediment clock. */
  const layerAge = (k: number) => Math.max(0, Math.min(1, input.layerDecay ? input.layerDecay(k) : sedimentShare(k, sed)));
  const { below: pad, above: padTop } = fusePad(cfg);
  // global sample indices: X = round(x / vs) etc.
  const I0 = Math.floor((input.x0 * CELL_SIZE) / vs) - pad;
  const I1 = Math.ceil(((input.x0 + input.nx) * CELL_SIZE) / vs) + pad;
  const K0 = Math.floor((input.z0 * CELL_SIZE) / vs) - pad;
  const K1 = Math.ceil(((input.z0 + input.nz) * CELL_SIZE) / vs) + pad;
  const Jlo = Math.floor((input.k0 * unit) / vs); // first owned sample row
  const Jhi = Math.floor(((input.k1 + 1) * unit) / vs); // first row of the next chunk
  const J0 = Jlo - pad;
  const J1 = Jhi + padTop;
  const nx = I1 - I0 + 1, ny = J1 - J0 + 1, nz = K1 - K0 + 1;
  const n = nx * ny * nz;
  if (n > 6e6) return EMPTY; // safety: refuse absurd grids
  if (stg) stg["grid samples (n)"] = (stg["grid samples (n)"] ?? 0) + n;
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // age of each sample row (sediment share): porosity and colour
  const rowQ = new Float32Array(ny);
  for (let j = 0; j < ny; j++) {
    const k = Math.floor(((J0 + j) * vs) / unit);
    rowQ[j] = k < 0 ? 0 : layerAge(k);
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
  const st = cfg.study;
  /** THE CRUST (FuseConfig.crust): the field is the building's hull, and V how far the crust has come at each place. */
  const crust = !!cfg.crust && !!st;
  const V = crust ? new Float32Array(n) : null;
  /** SIZE CURVES: per sample, the size reading t (0 … 1) of the part that fused there (the largest wins). */
  const T = st && (st.shell || st.foam) ? new Float32Array(n) : null;
  /** The parts' full boxes as fused (whatever their frame share): what lies under the skin (ghost), the membranes. */
  const Praw = st ? new Float32Array(n) : null;
  /** SEEDED (FuseMesh.late): how much each sample is the FRAME's — near a part's edges (whatever its tubes' thickness:
   *  with the artist's values the tubes alone swallowed the whole box, and every vertex read as frame), or in a pipe or
   *  a way — against the middles of the part's faces, the plates, the rooms (0). Per vertex: the most of its cube. */
  const Fr = st && !crust && cfg.seeded ? new Float32Array(n) : null;
  /** …and how far the part that wrote it is (a sample takes the NEAREST part's reading: beyond a box's edge every
   *  sample clamps onto that edge, and the stacked boxes of a building made the whole surface read as frame). */
  const FrD = Fr ? new Float32Array(n).fill(Infinity) : null;
  /** A part's frame band around its edges, written into Fr over the part's box widened by `reach`: a sample is
   *  clamped onto the box, and the box point's distance to its nearest edge (the second-smallest of its margins) is
   *  read against `band` — the frame within it, the face beyond. */
  const frameBand = (arr: Float32Array, dist: Float32Array, b: Box, hx: number, hy: number, hz: number, band: number, reach: number) => {
    const ia = Math.max(0, Math.ceil((b.x - hx - reach) / vs) - I0), ib = Math.min(nx - 1, Math.floor((b.x + hx + reach) / vs) - I0);
    const ja = Math.max(0, Math.ceil((b.y - hy - reach) / vs) - J0), jb = Math.min(ny - 1, Math.floor((b.y + hy + reach) / vs) - J0);
    const ka = Math.max(0, Math.ceil((b.z - hz - reach) / vs) - K0), kb = Math.min(nz - 1, Math.floor((b.z + hz + reach) / vs) - K0);
    const lo = band * 0.6, hi = Math.max(lo + vs * 0.5, band * 1.3);
    for (let k = ka; k <= kb; k++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const ax = Math.abs((I0 + i) * vs - b.x), ay = Math.abs((J0 + j) * vs - b.y), az = Math.abs((K0 + k) * vs - b.z);
      const ox = Math.max(0, ax - hx), oy = Math.max(0, ay - hy), oz = Math.max(0, az - hz);
      const d = Math.hypot(ox, oy, oz);
      const p = idx(i, j, k);
      if (d > dist[p] + 1e-4) continue;
      const mx = hx - Math.min(hx, ax), my = hy - Math.min(hy, ay), mz = hz - Math.min(hz, az);
      // (the middle of the three margins: on a face one margin is 0, and the next is how far the edge is)
      const edge = mx + my + mz - Math.min(mx, my, mz) - Math.max(mx, my, mz);
      const v = band <= 0 ? 0 : 1 - smoothRamp(edge, lo, hi);
      // (as near as the part before: the two meet here — an edge of both — the more frame of them)
      arr[p] = d < dist[p] - 1e-4 ? v : Math.max(arr[p], v);
      dist[p] = Math.min(dist[p], d);
    }
  };
  /** FOSSIL CURVE: 0 = young (architecture) … 1 = fossil, of a layer age. */
  const fossilOf = (q: number): number => (st ? smoothRamp(q, st.fossilFrom ?? 0.3, Math.max((st.fossilFrom ?? 0.3) + 0.05, st.fossilTo ?? 0.8)) : 1);
  const fossilNoise = st ? Math.max(0, st.fossilNoise ?? 0) : 0;
  /** The fossil curve at a place: the layer age jittered by a slow noise, so the border wanders (cubes sink into bone). */
  const fossilAt = (q: number, x: number, y: number, z: number): number => fossilOf(fossilNoise > 0 ? q + (noise3(x * 0.35, y * 0.35, z * 0.35, 43) - 0.5) * fossilNoise : q);
  /** How blocky a row is (young layers keep the voxel steps). */
  const youngOf = (j: number): number => (st ? (st.blocky ?? 0) * (1 - fossilOf(rowQ[j])) : 0);
  const youngAt = (j: number, x: number, y: number, z: number): number => (st ? (st.blocky ?? 0) * (1 - fossilAt(rowQ[j], x, y, z)) : 0);
  /** A part's size reading on the band sizeSmall … sizeLarge, jittered per part. */
  const sizeT = (b: Box, hx: number, hy: number, hz: number): number => {
    if (!st) return 0;
    const u = hash2(Math.round(b.x * 10), Math.round(b.z * 10) * 131 + Math.round(b.y * 10), 71);
    const size = 2 * Math.max(hx, hy, hz) * Math.exp((u - 0.5) * 2.2 * (st.sizeJitter ?? 0));
    return smoothRamp(size, st.sizeSmall ?? 1.5, Math.max((st.sizeSmall ?? 1.5) + 0.1, st.sizeLarge ?? 8));
  };
  /** A capsule of radius r along the segment (x0,y0,z0)→(x1,y1,z1), written as max(v) into `arr`. */
  const tube = (arr: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, v: number) => {
    const ia = Math.max(0, Math.ceil((Math.min(x0, x1) - r) / vs) - I0), ib = Math.min(nx - 1, Math.floor((Math.max(x0, x1) + r) / vs) - I0);
    const ja = Math.max(0, Math.ceil((Math.min(y0, y1) - r) / vs) - J0), jb = Math.min(ny - 1, Math.floor((Math.max(y0, y1) + r) / vs) - J0);
    const ka = Math.max(0, Math.ceil((Math.min(z0, z1) - r) / vs) - K0), kb = Math.min(nz - 1, Math.floor((Math.max(z0, z1) + r) / vs) - K0);
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l2 = dx * dx + dy * dy + dz * dz || 1;
    for (let k = ka; k <= kb; k++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const px = (I0 + i) * vs, py = (J0 + j) * vs, pz = (K0 + k) * vs;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy + (pz - z0) * dz) / l2));
      const qx = x0 + dx * t - px, qy = y0 + dy * t - py, qz = z0 + dz * t - pz;
      if (qx * qx + qy * qy + qz * qz > r * r) continue;
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
    const f = fusedShare(input.decay ? input.decay[pi] : 1, cfg) * (input.weight ? input.weight[pi] : 1);
    if (crust && V) {
      // THE CRUST: every part is part of the hull, whatever its progress; how far the crust has come there is V
      // (a voxel wider than the part: the crust stands just off it)
      fill(C, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, 1);
      if (f > 0) fill(V, b.x - hx - vs, b.x + hx + vs, b.y - hy - vs, b.y + hy + vs, b.z - hz - vs, b.z + hz + vs, f);
      if (Praw) fill(Praw, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, 1);
      if (T && st) {
        const e = (cfg.blur + 2) * vs;
        fill(T, b.x - hx - e, b.x + hx + e, b.y - hy - e, b.y + hy + e, b.z - hz - e, b.z + hz + e, sizeT(b, hx, hy, hz));
      }
      if (f > 0.02) any = true;
      continue;
    }
    if (f > 0) {
      const v = input.skeleton?.[pi] ? f * cfg.skeletonWrap : f;
      const t = st ? sizeT(b, hx, hy, hz) : 0;
      // E PIPES: how much of the part is its frame — all of it (pipe), by its size (pipeSize), or none (its box)
      let w = st?.pipeSize ? (st.pipeSmall ?? 0) + ((st.pipeLarge ?? 1) - (st.pipeSmall ?? 0)) * t : st?.pipe ? 1 : 0;
      // (…or the form its building melts in — Box.melt: its own, whatever the size says, by as much as meltVary)
      const own = st && b.melt !== undefined ? Math.max(0, Math.min(1, st.meltVary ?? 0)) : 0;
      if (own > 0) w += (b.melt! - w) * own;
      // by kind: a plate (slab, plinth) stays a plate — its rim as tubes, the plate itself kept (ref 9666: plates
      // and fibres; the artist 2026-10-19: architecture, not a wire ball)
      if (w > 0 && st?.platesStay && FRAME_KINDS.has(b.kind)) w = Math.min(w, PLATE_FRAME);
      // FOSSIL: in the old layers the frame is embedded again — the box fills in around the tubes
      // (a building's own form is its form for good: it is not embedded again by as much as it is its own)
      if (w > 0 && st && (st.pipeFossil ?? 0) > 0) w *= 1 - (1 - own) * st.pipeFossil * fossilAt(layerAge(b.slot), b.x, b.y, b.z);
      if (st && w > 0) {
        // the part's twelve edges as tubes (its frame), the box itself left open (or drawn fainter: below); the big
        // parts' tubes are thicker (bones), and balls at the corners are the joints
        const r = Math.max(vs * 0.6, st.pipeRadius * (1 + ((st.pipeThickLarge ?? 1) - 1) * t));
        const xs = [b.x - hx, b.x + hx], ys = [b.y - hy, b.y + hy], zs = [b.z - hz, b.z + hz];
        for (const y of ys) for (const z of zs) tube(C, xs[0], y, z, xs[1], y, z, r, v);
        for (const x of xs) for (const z of zs) tube(C, x, ys[0], z, x, ys[1], z, r, v);
        for (const x of xs) for (const y of ys) tube(C, x, y, zs[0], x, y, zs[1], r, v);
        const jr = r * (st.pipeJoint ?? 0);
        if (jr > r) for (const x of xs) for (const y of ys) for (const z of zs) tube(C, x, y, z, x, y, z, jr, v);
        // (THE FRAME FIRST: the band round its edges — no wider than the tube, nor than 45 % of the part's thinnest
        // half, so a face keeps a middle that comes later. A plate that stays a plate is all filling: "판은 나중에" —
        // it only claims the samples nearest to it)
        if (Fr && FrD) frameBand(Fr, FrD, b, hx, hy, hz, st.platesStay && FRAME_KINDS.has(b.kind) ? 0 : Math.max(vs * 0.75, Math.min(r, 0.45 * Math.min(hx, hy, hz))), Math.max(r, jr) + (cfg.blur + 2) * vs);
      }
      // the box, fainter the more the part is frame (between: a ragged plate within the tubes)
      if (w < 1) fill(C, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, v * (1 - w));
      if (Praw) fill(Praw, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, v);
      if (T) {
        const e = (cfg.blur + 2) * vs; // the size reading reaches as far as the blurred surface
        fill(T, b.x - hx - e, b.x + hx + e, b.y - hy - e, b.y + hy + e, b.z - hz - e, b.z + hz + e, t);
      }
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
  // EXTERNAL PARTS: pipes, walkways and fossil steel as capsules with their own decay — the mass follows them between
  // the buildings; a metal tube under the surface darkens the mass over it (Dk)
  const Dk = input.tubes && input.tubes.length ? new Float32Array(n) : null;
  if (input.tubes) for (const tb of input.tubes) {
    const f = fusedShare(tb.decay, cfg);
    if (f <= 0) continue;
    const r = Math.max(vs * 0.6, tb.r);
    if (Math.max(tb.y0, tb.y1) + r < yLo || Math.min(tb.y0, tb.y1) - r > yHi) continue;
    tube(C, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, r, f);
    if (Fr) tube(Fr, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, r + (cfg.blur + 2) * vs, 1);
    if (Praw) tube(Praw, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, r, f);
    if (Dk && tb.kind !== "walk") tube(Dk, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, r + vs, 1);
    if (T && st) tube(T, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, r + (cfg.blur + 2) * vs, smoothRamp(2 * r, st.sizeSmall ?? 1.5, Math.max((st.sizeSmall ?? 1.5) + 0.1, st.sizeLarge ?? 8)));
    any = true;
  }
  if (!any) return EMPTY;

  // THE CRUST'S HULL: between two consecutive plates of one building the union of their footprints is the building's
  // body too (the same outline as the ENVELOPE below) — a room is inside the hull, and the shell is taken off the
  // hull's outside, not off every plate
  if (crust && V) {
    const bySeed = new Map<number, number[]>();
    for (let pi = 0; pi < input.parts.length; pi++) {
      const b = input.parts[pi];
      if (b.tilt || !FRAME_KINDS.has(b.kind)) continue;
      const l = bySeed.get(b.seed);
      if (l) l.push(pi);
      else bySeed.set(b.seed, [pi]);
    }
    for (const plates of bySeed.values()) {
      plates.sort((a, b) => input.parts[a].y - input.parts[b].y);
      for (let t = 0; t + 1 < plates.length; t++) {
        const lo = input.parts[plates[t]], hi = input.parts[plates[t + 1]];
        const yb = lo.y - halfHeight(lo), yt = hi.y + halfHeight(hi);
        if (yt - yb > (FILL_MAX_GAP + 1) * unit || yt < yLo || yb > yHi) continue;
        const x0 = Math.min(lo.x - lo.sx / 2, hi.x - hi.sx / 2), x1 = Math.max(lo.x + lo.sx / 2, hi.x + hi.sx / 2);
        const z0 = Math.min(lo.z - lo.sz / 2, hi.z - hi.sz / 2), z1 = Math.max(lo.z + lo.sz / 2, hi.z + hi.sz / 2);
        fill(C, x0, x1, yb, yt, z0, z1, 1);
        const fv = Math.max(fusedShare(input.decay ? input.decay[plates[t]] : 1, cfg), fusedShare(input.decay ? input.decay[plates[t + 1]] : 1, cfg));
        if (fv > 0) fill(V, x0 - vs, x1 + vs, yb - vs, yt + vs, z0 - vs, z1 + vs, fv);
      }
    }
  }

  // B FILL: the rooms between a building's plates. A room spans from the top of one plate to the underside of the next
  // one up (the same seed, at most FILL_MAX_GAP slots: never across empty time), under the upper plate's footprint, and
  // only where the building's masses stood. As those masses fuse, the mass hangs from the ceiling and grows down to the
  // floor, its sides lumpy and kept back from the plate's edges; drips differ from column to column.
  const cav = st && !crust ? Math.max(0, Math.min(1, st.cavity ?? 0)) : 0;
  const Fl = st?.fill && !crust ? new Float32Array(n) : null;
  const room = st && (st.fill || cav > 0) ? new Uint8Array(n) : null;
  if (st && room) {
    const bySeed = new Map<number, number[]>();
    for (let pi = 0; pi < input.parts.length; pi++) {
      const b = input.parts[pi];
      if (b.tilt || (b.kind !== "mass" && !FRAME_KINDS.has(b.kind))) continue;
      const l = bySeed.get(b.seed);
      if (l) l.push(pi);
      else bySeed.set(b.seed, [pi]);
    }
    const lf = 1 / Math.max(0.1, cfg.lump);
    for (const list of bySeed.values()) {
      const plates = list.filter((pi) => FRAME_KINDS.has(input.parts[pi].kind)).sort((a, b) => input.parts[a].y - input.parts[b].y);
      for (let t = 0; t + 1 < plates.length; t++) {
        const lo = input.parts[plates[t]], hi = input.parts[plates[t + 1]];
        const yb = lo.y + halfHeight(lo), yt = hi.y - halfHeight(hi);
        if (yt - yb < 2 * vs || yt - yb > FILL_MAX_GAP * unit || yt < yLo || yb > yHi) continue;
        const ax0 = hi.x - hi.sx / 2, ax1 = hi.x + hi.sx / 2, az0 = hi.z - hi.sz / 2, az1 = hi.z + hi.sz / 2;
        // how far the room's parts have fused (their mean); none = no building here
        let sum = 0, cnt = 0;
        for (const pi of list) {
          const m = input.parts[pi];
          if (m.kind !== "mass" || m.y <= yb || m.y >= yt) continue;
          if (m.x + m.sx / 2 < ax0 || m.x - m.sx / 2 > ax1 || m.z + m.sz / 2 < az0 || m.z - m.sz / 2 > az1) continue;
          sum += fusedShare(input.decay ? input.decay[pi] : 1, cfg) * (input.weight ? input.weight[pi] : 1);
          cnt++;
        }
        const a = cnt ? sum / cnt : 0;
        if (a <= 0) continue;
        // (by the same rule as its parts: a room whose parts' fossil share, swollen as the mass is, is under the iso is
        // no mass — FuseChunkInput.weight; the oldest layers' swelling, as the seeded mass is old everywhere)
        if (input.weight && a * cfg.gain * 1.45 < iso0) continue;
        const ia = Math.max(0, Math.ceil(ax0 / vs) - I0), ib = Math.min(nx - 1, Math.floor(ax1 / vs) - I0);
        const ja = Math.max(0, Math.ceil(yb / vs) - J0), jb = Math.min(ny - 1, Math.floor(yt / vs) - J0);
        const ka = Math.max(0, Math.ceil(az0 / vs) - K0), kb = Math.min(nz - 1, Math.floor(az1 / vs) - K0);
        for (let k = ka; k <= kb; k++) for (let i = ia; i <= ib; i++) {
          const x = (I0 + i) * vs, z = (K0 + k) * vs;
          const reach = a * st.fillAmount * (0.55 + 0.9 * noise3(x * 0.9, 0, z * 0.9, 111)); // per column: drips
          for (let j = ja; j <= jb; j++) {
            const p = idx(i, j, k);
            room[p] = 1;
            if (!Fl) continue;
            const y = (J0 + j) * vs;
            const edge = Math.min(x - ax0, ax1 - x, z - az0, az1 - z);
            const side = smoothRamp(edge - st.fillInset + (noise3(x * lf, y * lf, z * lf, 112) - 0.5) * 0.9, 0, 0.6);
            const down = smoothRamp(reach - (yt - y) / (yt - yb), 0, 0.15);
            const v = (iso0 + 0.8) * side * down;
            if (v > Fl[p]) Fl[p] = v;
          }
        }
      }
    }
  }

  lap("ms field");
  const tmp = new Float32Array(n);
  const Cb = C.slice();
  blur3(Cb, tmp, nx, ny, nz, Math.round(cfg.blur));
  // ROOMS → CAVITIES: the rooms, rounded
  let Rm: Float32Array | null = null;
  if (cav > 0 && room && st) {
    Rm = Float32Array.from(room);
    blur3(Rm, tmp, nx, ny, nz, Math.max(1, Math.round(st.cavityRound ?? 2)));
  }
  // ENVELOPE: the building's outline — between two consecutive plates of one building the union of their footprints,
  // and every part's box a voxel wider; softened by a voxel so the cut faces come out as planes
  const env = st && !crust ? Math.max(0, Math.min(1, st.envelope ?? 0)) : 0;
  let E: Float32Array | null = null;
  if (env > 0 && st) {
    E = new Float32Array(n);
    const bySeed = new Map<number, number[]>();
    for (let pi = 0; pi < input.parts.length; pi++) {
      const b = input.parts[pi];
      if (b.tilt) continue;
      const l = bySeed.get(b.seed);
      if (l) l.push(pi);
      else bySeed.set(b.seed, [pi]);
    }
    for (const list of bySeed.values()) {
      const plates = list.filter((pi) => FRAME_KINDS.has(input.parts[pi].kind)).sort((a, b) => input.parts[a].y - input.parts[b].y);
      for (let t = 0; t + 1 < plates.length; t++) {
        const lo = input.parts[plates[t]], hi = input.parts[plates[t + 1]];
        const yb = lo.y - halfHeight(lo), yt = hi.y + halfHeight(hi);
        if (yt - yb > (FILL_MAX_GAP + 1) * unit || yt < yLo || yb > yHi) continue;
        const x0 = Math.min(lo.x - lo.sx / 2, hi.x - hi.sx / 2), x1 = Math.max(lo.x + lo.sx / 2, hi.x + hi.sx / 2);
        const z0 = Math.min(lo.z - lo.sz / 2, hi.z - hi.sz / 2), z1 = Math.max(lo.z + lo.sz / 2, hi.z + hi.sz / 2);
        fill(E, x0, x1, yb, yt, z0, z1, 1);
      }
      for (const pi of list) {
        const b = input.parts[pi];
        const hh = halfHeight(b);
        // the plates ARE the outline (exact); the other parts may be coated half a voxel
        const d = FRAME_KINDS.has(b.kind) ? 0 : vs * 0.5;
        const hx = Math.max(b.sx, vs) / 2 + d, hz = Math.max(b.sz, vs) / 2 + d, hy = Math.max(2 * hh, vs) / 2 + d;
        fill(E, b.x - hx, b.x + hx, b.y - hy, b.y + hy, b.z - hz, b.z + hz, 1);
      }
    }
    // what joins the buildings is part of the outline too
    if (input.tubes) for (const tb of input.tubes) tube(E, tb.x0, tb.y0, tb.z0, tb.x1, tb.y1, tb.z1, Math.max(vs * 0.6, tb.r) + vs, 1);
    blur3(E, tmp, nx, ny, nz, 1);
  }
  // SAG: the mass hangs down — each row keeps a share of the row above it, more in some columns than others (drips);
  // the young (blocky) layers do not sag
  if (cfg.sag > 0.01) {
    const sag = Math.min(0.95, cfg.sag);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const s = sag * (0.55 + 0.45 * noise3((I0 + i) * vs * 0.8, 0, (K0 + k) * vs * 0.8, 51));
      for (let j = ny - 2; j >= 0; j--) {
        const p = idx(i, j, k), up = Cb[p + nx] * s * (1 - youngOf(j));
        if (up > Cb[p]) Cb[p] = up;
      }
    }
  }
  // (THE CRUST: how far it has come, smoothed over the rooms' sides — and it reaches down with what hangs)
  let Vb: Float32Array | null = null;
  if (V) {
    Vb = V;
    blur3(Vb, tmp, nx, ny, nz, 2);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      for (let j = ny - 2; j >= 0; j--) {
        const p = idx(i, j, k), up = Vb[p + nx] * 0.9;
        if (up > Vb[p]) Vb[p] = up;
      }
    }
  }
  // growths are lumpy and start as sparse specks: only where the noise exceeds (1 − progress) do they show, so a
  // young growth is a few small lumps and a full one a continuous crust
  const lf = 1 / Math.max(0.1, cfg.lump);
  let anyA = false;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = idx(i, j, k);
    const a = A[p];
    if (a <= 0) continue;
    const nz3 = noise3((I0 + i) * vs * lf, (J0 + j) * vs * lf, (K0 + k) * vs * lf, 21);
    const prog = Math.min(1, a / Math.max(1e-6, cfg.accretion));
    A[p] = nz3 > 1 - prog ? a * (0.6 + 1.4 * (nz3 - (1 - prog)) / Math.max(1e-6, prog)) : 0;
    if (A[p] > 0) anyA = true;
  }
  // (no growths anywhere — the exhibition's accretion is 0 — and a blur of nothing is nothing: skipped)
  if (anyA) blur3(A, tmp, nx, ny, nz, 1);

  // vegetation sediment sticks to decaying concrete (never a slab of its own)
  if (h && cfg.natureWeight > 0 && !crust) {
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

  // the field: concrete mass (form kept, gaps filled) + growths + sediment, denser in the old layers;
  // minus round voids (old layers) and minus fragmenting at the edges (young layers)
  const iso = cfg.iso;
  const F = new Float32Array(n);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const q = rowQ[j];
      const por = st?.shell || st?.foam ? 0 : cfg.porosity * q; // C: the openings replace the round voids
      const young = youngOf(j);
      // bottom-heavy; the young (blocky) layers hardly swell past their parts' boxes — architecture, not a blob
      const gain = cfg.gain * (0.55 + 0.9 * q) * (1 - 0.6 * young);
      const scat = cfg.scatter * (1 - q);
      const yRow = (J0 + j) * vs;
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        // B: outside the rooms the mass hardly swells past its parts
        let f = Math.max(C[p], gain * Cb[p] * (room && !room[p] && Fl ? FILL_OUTSIDE : 1)) + A[p] + N[p];
        if (Fl && Fl[p] > f) f = Fl[p];
        // ROOMS → CAVITIES (ref 9579): in the old layers the room is carved out as a rounded cavity; the parts
        // themselves (Praw) are kept, so the plates and walls remain as membranes between the cavities
        if (Rm && cav > 0 && Rm[p] > 0.12 && f > iso * 0.5) {
          const h = cav * fossilAt(q, (I0 + i) * vs, yRow, (K0 + k) * vs) * smoothRamp(Rm[p], 0.12, 0.6) * (1 - Math.min(1, Praw![p] * 1.5));
          if (h > 0) f -= h * (f - iso * 0.5 + 0.3);
        }
        // ENVELOPE: outside the building's outline (mask < 0.5 = past a face) the mass is cut to air, however strong
        // the field — so the outer faces come out as the building's planes, whatever swells inside
        if (E && E[p] < 0.5) f += (Math.min(f, iso * (E[p] / 0.5)) - f) * env;
        if (f <= iso * 0.5 || (por <= 0 && scat <= 0)) {
          F[p] = f;
          continue;
        }
        const x = (I0 + i) * vs, y = (J0 + j) * vs, z = (K0 + k) * vs;
        if (scat > 0) {
          // near the surface (thin mass) the young mass breaks up: only where the noise is high do pieces remain
          const edge = 1 - ramp(f, iso, iso + 0.6);
          if (edge > 0) f -= scat * edge * Math.max(0, 0.7 - noise3(x * 1.6, y * 1.6, z * 1.6, 61)) * 1.6;
        }
        if (por > 0 && f > iso) f -= por * 1.6 * smoothRamp(voids(x, y, z, cfg.poreSize), 0, 0.35);
        F[p] = f;
      }
    }
  }

  lap("ms blur");
  // C SHELL: hollow the mass (whatever lies deeper than the shell's thickness), then open some of the cells that touch
  // each other so only ribs remain between them; old layers are opened most. FOAM: the same cells carved through the
  // volume without hollowing (sponge bone, ref 9579)
  if (st && (st.shell || st.foam || crust)) {
    if (st.shell || crust) {
    // two thicknesses: thin in the young layers, thick in the old ones (blended over a short band of layer age)
    const rOld = Math.max(1, Math.round(st.shellThick)), rYoung = Math.max(1, Math.round(st.shellThickYoung));
    const inside = new Float32Array(n);
    for (let p = 0; p < n; p++) inside[p] = F[p] > iso ? 1 : 0;
    const S = inside.slice();
    blur3(S, tmp, nx, ny, nz, rOld);
    let S2: Float32Array | null = null;
    // (the young thickness counts only in rows under shellSplit: the seeded mass is made at age 1 — every row old —
    // and its blur would be mixed in at 0: skipped, 2026-11-21)
    let anyYoung = false;
    for (let j = 0; j < ny && !anyYoung; j++) if (rowQ[j] < st.shellSplit + 0.08) anyYoung = true;
    if (rYoung !== rOld && anyYoung) {
      S2 = inside;
      blur3(S2, tmp, nx, ny, nz, rYoung);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const old = S2 ? smoothRamp(rowQ[j], st.shellSplit - 0.08, st.shellSplit + 0.08) : 1;
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        if (F[p] <= iso) continue;
        const s = S2 ? S2[p] + (S[p] - S2[p]) * old : S[p];
        const w = smoothRamp(s, 0.86, 0.985);
        if (w > 0) F[p] -= (F[p] - iso + 0.25) * w;
      }
    }
    }
    // THE CRUST IS THERE ONLY WHERE IT HAS COME: its reach at a place against a slow noise — a little of it is a few
    // spots, more of it spreads from them, all of it covers the hull
    if (crust && Vb) {
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        if (F[p] <= iso - 0.25) continue;
        const c = Vb[p] * (0.55 + 0.9 * noise3((I0 + i) * vs * CRUST_PATCH, (J0 + j) * vs * CRUST_PATCH, (K0 + k) * vs * CRUST_PATCH, 133));
        const keep = smoothRamp(c, CRUST_AT, CRUST_AT + 0.2);
        if (keep < 1) F[p] -= (F[p] - iso + 0.25) * (1 - keep);
      }
    }
    const vo = new Float64Array(3);
    // NO CRUMBS (the artist, 2026-11-15, a screenshot of fields of pebbles: "보로노이 또 이러네"). Where nearly every
    // cell opens, what is left of the mass must still hang together: (1) a rib is never thinner than the grid can
    // hold (a voxel and a half), (2) the noise openings — which leave no ribs, only what the threshold spares — open
    // at most NOISE_OPEN_MAX of the mass (above it the rest is islands), (3) what still comes loose, smaller than a
    // fifth of a cell across, is taken away (below).
    const half = Math.max(st.ribWidth / 2, 0.75 * vs);
    const lip = Math.max(0, st.ribLip ?? 0);
    const shape = st.holeShape ?? "voronoi";
    const nf = 1 / Math.max(0.2, st.ribCell); // noise openings: one feature per ribCell
    const soft = Math.max(0.02, st.ribWidth * 0.5);
    // "size": the openings follow the Voronoi cells on the large elements and the noise on the small ones (or as the
    // curve says) — the mix is read per sample from the fused part's size, switched over a short band
    const hvS = st.holeVoronoiSmall ?? 0, hvL = st.holeVoronoiLarge ?? 1;
    const voronoiMix = (p: number): number => (shape === "voronoi" ? 1 : shape === "noise" ? 0 : smoothRamp(hvS + (hvL - hvS) * (T ? T[p] : 0), 0.35, 0.65));
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const open = st.ribOpen * (0.35 + 0.65 * rowQ[j]);
      if (open <= 0) continue;
      for (let i = 0; i < nx; i++) {
        const p = idx(i, j, k);
        if (F[p] <= iso - 0.25) continue;
        const x = (I0 + i) * vs, y = (J0 + j) * vs, z = (K0 + k) * vs;
        let carve = 0;
        if (shape === "round") {
          carve = smoothRamp(voids(x, y, z, cfg.poreSize), 0, 0.35) * Math.min(1, open * 1.5);
        } else {
          const m = voronoiMix(p);
          let byNoise = 0, byCells = 0;
          if (m < 1) {
            // open where the noise runs high: the share `open` of the surface, edges softened over ribWidth
            const nz = noise3(x * nf, y * nf * 0.8, z * nf, 87);
            const openN = Math.min(open, NOISE_OPEN_MAX);
            byNoise = smoothRamp(nz, 1 - openN - soft, 1 - openN + soft);
          }
          if (m > 0) {
            voronoi(x, y, z, st.ribCell, 1.35, vo);
            const margin = (vo[1] - vo[0]) / 2; // distance to the cell's boundary (the rib)
            // LIP: the rib and the opening's rim thicken (bone: the edge of a hole rolls over)
            if (lip > 0 && margin < half + lip) F[p] += 0.6 * m * (1 - ramp(margin, half, half + lip));
            if (vo[2] < open) byCells = smoothRamp(margin, half, half + vs);
          }
          carve = byCells * m + byNoise * (1 - m);
        }
        if (carve > 0) F[p] -= (F[p] - iso + 0.25) * carve;
      }
    }
    // (3) the loose bits: every piece of mass that touches no side of the grid (a piece cut by the grid's side may go
    // on in the next tile) and is smaller than a fifth of a cell across goes — and THE CRUST IS ONE BODY: there, what
    // is not at least CRUST_BODY of the largest piece goes too
    const minVox = Math.max(27, Math.round(Math.pow((0.2 * st.ribCell) / vs, 3)));
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    const nxy = nx * ny;
    const comps: [number, number, boolean, number][] = []; // [first in the queue, how many, touches a side, thinnest extent (samples)]
    let tail = 0, largest = 0;
    for (let p0 = 0; p0 < n; p0++) {
      if (seen[p0] || !(F[p0] > iso)) continue;
      const first = tail;
      let head = tail, edge = false;
      let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, k0 = Infinity, k1 = -Infinity;
      queue[tail++] = p0;
      seen[p0] = 1;
      while (head < tail) {
        const p = queue[head++];
        const i = p % nx, j = ((p - i) / nx) % ny, k = (p - i - j * nx) / nxy;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
        if (k < k0) k0 = k;
        if (k > k1) k1 = k;
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          edge = true;
          continue;
        }
        for (let s6 = 0; s6 < 6; s6++) {
          const q = p + (s6 === 0 ? -1 : s6 === 1 ? 1 : s6 === 2 ? -nx : s6 === 3 ? nx : s6 === 4 ? -nxy : nxy);
          if (seen[q] || !(F[q] > iso)) continue;
          seen[q] = 1;
          queue[tail++] = q;
        }
      }
      comps.push([first, tail - first, edge, Math.min(i1 - i0, j1 - j0, k1 - k0) + 1]);
      if (tail - first > largest) largest = tail - first;
    }
    const least = Math.max(minVox, crust ? CRUST_BODY * largest : 0);
    // (THE FOSSIL IN STAGES — "표면 뾰족한 거 진짜 싫어": a loose piece that is no thicker than two samples anywhere — a
    // sheet, a sliver — goes too, whatever its size)
    const stagesThin = (cfg.stageN ?? 0) > 0 ? 2 : 0;
    for (const [first, count, edge, thinnest] of comps) {
      if (edge || (count >= least && thinnest > stagesThin)) continue;
      for (let t = first; t < first + count; t++) F[queue[t]] = iso - 0.25;
    }
  }

  // SPIKES: out of a hashed share of the surface cells a thin spike of the same mass grows outward along the field's
  // gradient (one voxel thick, its own length up to spikeLen); the smoothing rounds them a little
  if (cfg.spikes > 0 && cfg.spikeLen > 0) {
    const maxSteps = Math.ceil(cfg.spikeLen / vs);
    const adds: number[] = [];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const p = idx(i, j, k);
      if (F[p] <= iso) continue;
      // a surface cell: an air neighbour on some side
      if (F[p - 1] > iso && F[p + 1] > iso && F[p - nx] > iso && F[p + nx] > iso && F[p - nx * ny] > iso && F[p + nx * ny] > iso) continue;
      const hsh = hash2(I0 + i, (J0 + j) * 7919 + (K0 + k) * 31, 97);
      if (hsh >= cfg.spikes * 0.08) continue;
      // outward = −gradient of the field
      let gx = F[p - 1] - F[p + 1], gy = F[p - nx] - F[p + nx], gz = F[p - nx * ny] - F[p + nx * ny];
      const gl = Math.hypot(gx, gy, gz);
      if (gl < 1e-6) continue;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      const steps = Math.max(1, Math.round(maxSteps * (0.3 + 0.7 * hash2(I0 + i, (J0 + j) * 7919 + (K0 + k) * 31, 98))));
      for (let s = 1; s <= steps; s++) {
        const ii = Math.round(i + gx * s), jj = Math.round(j + gy * s), kk = Math.round(k + gz * s);
        if (ii < 1 || ii >= nx - 1 || jj < 1 || jj >= ny - 1 || kk < 1 || kk >= nz - 1) break;
        adds.push(idx(ii, jj, kk));
      }
    }
    for (const p of adds) if (F[p] < iso + 0.25) F[p] = iso + 0.25;
  }

  lap("ms shell");
  // ── naive surface nets ──
  const cubeVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const ext: number[] = []; // per vertex: ghost, flat, pits, rib distance
  const wgt: number[] = []; // per vertex: smoothing weight (0 = blocky)
  const lateV: number[] = []; // per vertex (seeded): 0 = the frame's surface … 1 = the filling's (FuseMesh.late)
  // PITS (drawn by the material): per vertex how much of the pits' coverage applies — by the part's size, gathered
  // in patches — and how far from the ribs (none across them)
  const pitsOn = !!st && (st.shell || st.foam) && st.pits > 0;
  const pitPatch = Math.max(0.3, st?.pitPatch ?? 3);
  const pitShape = st?.holeShape ?? "voronoi";
  const voP = new Float64Array(3);
  const broadM: number[] = []; // per vertex: how far into a broad closed cell (0 at the rim … 1 at its middle)
  const cornerF = new Float32Array(8);
  /** A field's value at a sample near the cube (i, j, k), `d` voxels inward along the outward normal. */
  const underIn = (arr: Float32Array, i: number, j: number, k: number, ox: number, oy: number, oz: number, d: number): number => {
    const ii = Math.round(i + 0.5 - ox * d), jj = Math.round(j + 0.5 - oy * d), kk = Math.round(k + 0.5 - oz * d);
    if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) return 0;
    return arr[idx(ii, jj, kk)];
  };
  /** The parts' full-box value near the cube (ghost). */
  const under = (i: number, j: number, k: number, ox: number, oy: number, oz: number, d: number): number => (Praw ? underIn(Praw, i, j, k, ox, oy, oz, d) : 0);
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
        // BLOCKY (ref 9579): the young layers keep the voxel steps — the vertex sits at the cube's centre (the mesh
        // becomes the stepped voxel surface) and is not smoothed; the old layers melt
        const bl = youngAt(Math.min(ny - 1, j), (I0 + i + 0.5) * vs, (J0 + j + 0.5) * vs, (K0 + k + 0.5) * vs);
        const vx = (I0 + i + sx / cnt + (0.5 - sx / cnt) * bl) * vs, vy = (J0 + j + sy / cnt + (0.5 - sy / cnt) * bl) * vs, vz = (K0 + k + sz / cnt + (0.5 - sz / cnt) * bl) * vs;
        cubeVert[cidx(i, j, k)] = pos.length / 3;
        pos.push(vx, vy, vz);
        wgt.push(1 - bl);
        // THE FRAME FIRST (FuseMesh.late): how much of the frame is at the cube's corners (the most of them)
        if (Fr) {
          let fm = 0;
          for (let c = 0; c < 8; c++) fm = Math.max(fm, Fr[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]);
          lateV.push(1 - fm);
        }
        // normal: −gradient (the field grows inwards)
        const gx = cornerF[1] + cornerF[3] + cornerF[5] + cornerF[7] - cornerF[0] - cornerF[2] - cornerF[4] - cornerF[6];
        const gy = cornerF[2] + cornerF[3] + cornerF[6] + cornerF[7] - cornerF[0] - cornerF[1] - cornerF[4] - cornerF[5];
        const gz = cornerF[4] + cornerF[5] + cornerF[6] + cornerF[7] - cornerF[0] - cornerF[1] - cornerF[2] - cornerF[3];
        const gl = Math.hypot(gx, gy, gz) || 1;
        const ox = -gx / gl, oy = -gy / gl, oz = -gz / gl;
        nor.push(ox, oy, oz);
        // GHOST: a part right under the skin shows through it (ref 9649: the machine parts under the white skin)
        const ghost = Praw ? Math.max(under(i, j, k, ox, oy, oz, 0), under(i, j, k, ox, oy, oz, 1), 0.6 * under(i, j, k, ox, oy, oz, 2)) : 0;
        let pitZ = 0, pitW = 0;
        if (pitsOn && st) {
          const tS = T ? T[idx(i, j, k)] : 0;
          const sizeMul = (st.pitSmall ?? 1) + ((st.pitLarge ?? 1) - (st.pitSmall ?? 1)) * tS;
          const gather = st.pitGather ?? 0;
          // WHERE THEY GATHER THEY CROWD (the artist, 2026-11-20: "곰보가 몰리는 곳은 레퍼런스 사진처럼 빡! 몰리길 원함" — ref
          // 9664: on a few faces the pores stand shoulder to shoulder, large and small, and the rest is bare). The
          // patches were half the surface with twice the pits — one pit a cell at most, so never crowded. Now a patch
          // is where a slow noise runs clearly high (a third of the surface, with a short edge) and carries up to
          // three times the share: past 1 the wall's shader lays smaller pits between the first (patchFuseExtras).
          // Outside the patches the share falls to 1 − gather: bare at 1.
          const g = gather > 0 ? 1 - gather + gather * 3 * smoothRamp(noise3(vx / pitPatch, vy / pitPatch, vz / pitPatch, 89), 0.54, 0.61) : 1;
          // (0 … 3: up to 1 the share of cells with a pit; past it, how crowded the patch is)
          pitZ = Math.max(0, Math.min(3, sizeMul * g));
          if (pitShape === "voronoi" || pitShape === "size") {
            voronoi(vx, vy, vz, st.ribCell, 1.35, voP);
            const margin = (voP[1] - voP[0]) / 2, halfRib = st.ribWidth / 2;
            pitW = smoothRamp(margin, halfRib + st.pitSize * 0.5, halfRib + st.pitSize * 1.5);
            broadM.push(smoothRamp(margin, halfRib + st.pitSize * 0.5, halfRib + Math.max(st.pitSize * 1.5, st.ribCell * 0.35)));
          } else {
            pitW = 1;
            broadM.push(1);
          }
        } else broadM.push(0);
        ext.push(Math.min(1, ghost), bl, pitZ, pitW);
        // colour: the living growths (pale ochre-green, ref 9578) where they dominate; where the mass is fused concrete
        // or sediment, a dull mix of the concrete's grey and a low-saturation brown in streaks (ref 9570); all
        // darkening with age. Nothing bright survives fusion.
        const p = idx(i, j, k);
        const tot = Cb[p] + A[p] + N[p] + 1e-6;
        const grow = A[p] / tot;
        const q = rowQ[j];
        const jit = 0.88 + 0.24 * hash2(I0 + i, (J0 + j) * 7919 + K0 + k, 13);
        const streak = noise3(vx * 1.7, vy * 0.35, vz * 1.7, 31); // vertical stains
        const brown = Math.min(1, 0.25 + 0.55 * streak + 0.4 * (N[p] / tot));
        let dark = 1 - 0.35 * q;
        // a metal tube (pipe, steel) right under the surface darkens the mass over it
        if (Dk) dark *= 1 - 0.35 * Math.max(underIn(Dk, i, j, k, ox, oy, oz, 0), underIn(Dk, i, j, k, ox, oy, oz, 1));
        for (let c = 0; c < 3; c++) {
          const fused = CONCRETE[c] + (DULL_BROWN[c] - CONCRETE[c]) * brown;
          const growc = GROW[c] + (DULL_BROWN[c] - GROW[c]) * Math.min(1, q * 1.2);
          col.push((fused * (1 - grow) + growc * grow) * dark * jit);
        }
      }
    }
  }

  lap("ms nets");
  // faces: one quad per sign-changing sample edge. All are collected (padding too) so that smoothing and normals see
  // the same neighbourhood in neighbouring chunks; each is kept by the chunk whose rows contain the edge's start.
  const quads: number[] = []; // a b c d flip owned
  /** Per quad (THE PROVISIONAL SKIN): 0 = not provisional, else the sides (FuseMesh.side bits) its edge lies beyond. */
  const qSide: number[] = [];
  let sideNow = 0;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean, own: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    quads.push(a, b, c, d, flip ? 1 : 0, own ? 1 : 0);
    qSide.push(own ? 0 : sideNow);
  };
  const owned = (j: number) => J0 + j >= Jlo && J0 + j < Jhi;
  const ow = input.own;
  const Ilo = ow ? Math.floor((ow.x0 * CELL_SIZE) / vs) : -Infinity, Ihi = ow ? Math.floor((ow.x1 * CELL_SIZE) / vs) : Infinity;
  const Klo = ow ? Math.floor((ow.z0 * CELL_SIZE) / vs) : -Infinity, Khi = ow ? Math.floor((ow.z1 * CELL_SIZE) / vs) : Infinity;
  // THE PROVISIONAL SKIN: the faces in a ring beyond the own ones, while they lie well inside the padded grid (its
  // outermost samples see a field cut short by the grid's edge)
  const rg = input.ring;
  const rI = rg && ow ? Math.ceil(rg.reach / vs) : 0, rJ = rg ? Math.ceil(rg.reachY / vs) : 0;
  const inH = (g: number, n0: number, n: number) => g >= n0 + Math.ceil(pad / 2) && g <= n0 + n - 1 - Math.ceil(pad / 2);
  const sideOf = (I: number, J: number, K: number): number => {
    if (!rg) return -1;
    let b = 0;
    if (J >= Jhi) b |= J < Jhi + rJ ? 1 : 64;
    else if (J < Jlo) b |= J >= Jlo - rJ ? 2 : 64;
    if (I >= Ihi) b |= I < Ihi + rI ? 4 : 64;
    else if (I < Ilo) b |= I >= Ilo - rI ? 8 : 64;
    if (K >= Khi) b |= K < Khi + rI ? 16 : 64;
    else if (K < Klo) b |= K >= Klo - rI ? 32 : 64;
    if (b & 64 || !b || !inH(I, I0, nx) || !inH(J, J0, ny) || !inH(K, K0, nz)) return -1;
    return b;
  };
  for (let k = 1; k < nz - 1; k++) {
    const ownK = K0 + k >= Klo && K0 + k < Khi;
    for (let j = 1; j < ny - 1; j++) {
      const ownJK = ownK && owned(j);
      for (let i = 1; i < nx - 1; i++) {
        const own = ownJK && I0 + i >= Ilo && I0 + i < Ihi;
        sideNow = own ? 0 : sideOf(I0 + i, J0 + j, K0 + k);
        const f0 = F[idx(i, j, k)] > iso;
        // edge along x: (i,j,k)→(i+1,j,k), cubes around it in (j,k)
        if (f0 !== F[idx(i + 1, j, k)] > iso) {
          quad(cubeVert[cidx(i, j - 1, k - 1)], cubeVert[cidx(i, j, k - 1)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j - 1, k)], !f0, own);
        }
        if (f0 !== F[idx(i, j + 1, k)] > iso) {
          quad(cubeVert[cidx(i - 1, j, k - 1)], cubeVert[cidx(i - 1, j, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i, j, k - 1)], !f0, own);
        }
        if (f0 !== F[idx(i, j, k + 1)] > iso) {
          quad(cubeVert[cidx(i - 1, j - 1, k)], cubeVert[cidx(i, j - 1, k)], cubeVert[cidx(i, j, k)], cubeVert[cidx(i - 1, j, k)], !f0, own);
        }
      }
    }
  }
  lap("ms quads");
  const P = Float32Array.from(pos);
  const NV = P.length / 3;
  const Nn = Float32Array.from(nor);
  const anyBlocky = wgt.some((w) => w < 1);
  if (cfg.smooth > 0 && NV > 0) taubin(P, quads, NV, Math.round(cfg.smooth), anyBlocky ? Float32Array.from(wgt) : undefined);
  if (cfg.smooth > 0 && NV > 0) faceNormals(P, quads, Nn);
  lap("ms smooth");
  // PITS ON THE BROAD FACES: the pits' coverage drawn toward the flat middles of the large faces — a vertex whose
  // neighbours' normals agree with its own (flat) and that lies deep in a closed cell (broadM) keeps its pits; rims,
  // ribs, edges and small curved bits lose them, by pitBroad
  const pitBroad = pitsOn && st ? Math.max(0, Math.min(1, st.pitBroad ?? 0)) : 0;
  if (pitBroad > 0 && NV > 0) {
    const { start, list } = neighbours(quads, NV);
    for (let v = 0; v < NV; v++) {
      const a = start[v], b = start[v + 1];
      let dot = 0;
      for (let e = a; e < b; e++) {
        const u = list[e] * 3;
        dot += Nn[v * 3] * Nn[u] + Nn[v * 3 + 1] * Nn[u + 1] + Nn[v * 3 + 2] * Nn[u + 2];
      }
      const flat = b > a ? ramp(dot / (b - a), 0.9, 0.99) : 0;
      ext[v * 4 + 2] *= 1 - pitBroad + pitBroad * flat * broadM[v];
    }
  }

  // (the frame's border on the surface is softened over the vertex's neighbours: no speckle where the two meet)
  let late: Float32Array | undefined;
  if (Fr && NV > 0 && lateV.length === NV) {
    late = Float32Array.from(lateV);
    const { start, list } = neighbours(quads, NV);
    const next = new Float32Array(NV);
    for (let pass = 0; pass < 2; pass++) {
      for (let v = 0; v < NV; v++) {
        const a = start[v], b = start[v + 1];
        let s = late[v];
        for (let e = a; e < b; e++) s += late[list[e]];
        next[v] = s / (1 + b - a);
      }
      late.set(next);
    }
  }

  const ind: number[] = [];
  const resinInd: number[] = [];
  // THE PROVISIONAL SKIN: its faces get vertices of their own (copies, one per vertex and side), so the worker can
  // hide them without touching the own faces they meet
  let Pv: Float32Array = P, Nv: Float32Array = Nn, colA: Float32Array = Float32Array.from(col), extA: Float32Array = Float32Array.from(ext), lateA: Float32Array | undefined = late;
  let sideA: Float32Array | undefined;
  const copyOf = new Map<number, number>();
  const addV: number[] = [], addS: number[] = [];
  const vOf = (v: number, sd: number): number => {
    if (!sd) return v;
    const key = v * 64 + sd;
    let c = copyOf.get(key);
    if (c === undefined) {
      c = NV + addV.length;
      copyOf.set(key, c);
      addV.push(v);
      addS.push(sd);
    }
    return c;
  };
  for (let t = 0; t < quads.length; t += 6) {
    const sd = qSide[t / 6];
    if (!quads[t + 5] && !(sd > 0)) continue;
    const a = vOf(quads[t], sd > 0 ? sd : 0), b = vOf(quads[t + 1], sd > 0 ? sd : 0), c = vOf(quads[t + 2], sd > 0 ? sd : 0), d = vOf(quads[t + 3], sd > 0 ? sd : 0);
    const ra = quads[t];
    // the face goes to the resin group if its first vertex lies in a resin layer (a noisy boundary: the resin layer
    // does not start at one exact height)
    const ax = P[ra * 3], ay = P[ra * 3 + 1], az = P[ra * 3 + 2];
    const qa = layerAge(Math.floor(ay / unit)) + (noise3(ax * 0.5, ay * 0.5, az * 0.5, 41) - 0.5) * 0.3;
    const to = cfg.resinShare <= 1 && qa >= cfg.resinShare ? resinInd : ind;
    if (quads[t + 4]) to.push(a, c, b, a, d, c);
    else to.push(a, b, c, a, c, d);
  }
  const index = new Uint32Array(ind.length + resinInd.length);
  index.set(ind);
  index.set(resinInd, ind.length);
  if (rg) {
    const m = addV.length, NT = NV + m;
    const grow = (src: Float32Array, k: number): Float32Array => {
      const out = new Float32Array(NT * k);
      out.set(src);
      for (let e = 0; e < m; e++) for (let c = 0; c < k; c++) out[(NV + e) * k + c] = src[addV[e] * k + c];
      return out;
    };
    if (m) {
      Pv = grow(P, 3);
      Nv = grow(Nn, 3);
      colA = grow(colA, 3);
      extA = grow(extA, 4);
      if (lateA) lateA = grow(lateA, 1);
    }
    sideA = new Float32Array(NT);
    for (let e = 0; e < m; e++) sideA[NV + e] = addS[e];
  }
  // ONLY THE VERTICES A FACE USES (2026-11-21): the nets make a vertex for every surface cube of the grid, padding
  // included — the smoothing and the normals need them — but a chunk keeps only the faces its own rows and tile own:
  // about two vertices in three were carried, stored, grown, transferred and uploaded for nothing. Dropped here, every
  // per-vertex array compacted by one remap; nothing drawn changes.
  const out = compactFuseMesh({ position: Pv, normal: Nv, color: colA, extra: extA, index, resinStart: ind.length, ...(lateA ? { late: lateA } : {}), ...(sideA ? { side: sideA } : {}) });
  lap("ms finish");
  return out;
}

/**
 * The mesh with only the vertices its index uses, every per-vertex array compacted by the same remap (first use first),
 * the index rewritten. Nothing drawn changes. The mesh itself when nothing is unused.
 */
export function compactFuseMesh(mesh: FuseMesh): FuseMesh {
  const nv = mesh.position.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let used = 0;
  const index = new Uint32Array(mesh.index.length);
  for (let i = 0; i < mesh.index.length; i++) {
    const v = mesh.index[i];
    if (remap[v] < 0) remap[v] = used++;
    index[i] = remap[v];
  }
  if (used === nv) return mesh;
  const take = <T extends Float32Array | undefined>(a: T, k: number): T => {
    if (!a) return a;
    const out = new Float32Array(used * k);
    for (let v = 0; v < nv; v++) {
      const t = remap[v];
      if (t < 0) continue;
      for (let c = 0; c < k; c++) out[t * k + c] = a[v * k + c];
    }
    return out as T;
  };
  const out: FuseMesh = { position: take(mesh.position, 3), normal: take(mesh.normal, 3), color: take(mesh.color, 3), extra: take(mesh.extra, 4), index, resinStart: mesh.resinStart };
  if (mesh.anchor) out.anchor = take(mesh.anchor, 3);
  if (mesh.growA) out.growA = take(mesh.growA, 4);
  if (mesh.growB) out.growB = take(mesh.growB, 2);
  if (mesh.late) out.late = take(mesh.late, 1);
  if (mesh.side) out.side = take(mesh.side, 1);
  if (mesh.blend) out.blend = take(mesh.blend, 4);
  return out;
}

/** Concatenates chunk meshes into one (all opaque faces first, then all resin faces). */
export function mergeMeshes(parts: readonly FuseMesh[]): FuseMesh {
  let nv = 0, ni = 0, nr = 0;
  let seeded = false, anyLate = false, anySide = false, anyBlend = false;
  for (const p of parts) {
    nv += p.position.length;
    ni += p.index.length;
    nr += p.index.length - p.resinStart;
    if (p.anchor) seeded = true;
    if (p.late) anyLate = true;
    if (p.side) anySide = true;
    if (p.blend) anyBlend = true;
  }
  const out: FuseMesh = { position: new Float32Array(nv), normal: new Float32Array(nv), color: new Float32Array(nv), extra: new Float32Array((nv / 3) * 4), index: new Uint32Array(ni), resinStart: ni - nr };
  // (the growing data rides along when any part has it; a part without it is whole as it is)
  if (seeded) {
    out.anchor = new Float32Array(nv);
    out.growA = new Float32Array((nv / 3) * 4);
    out.growB = new Float32Array((nv / 3) * 2);
  }
  // (the frame-first mark rides along when any part has it; a part without it is all frame: 0)
  if (anyLate) out.late = new Float32Array(nv / 3);
  // (the provisional skin's sides, and the pending changes: none = own faces, no change — −1e9 is "no change")
  if (anySide) out.side = new Float32Array(nv / 3);
  if (anyBlend) out.blend = new Float32Array((nv / 3) * 4);
  let ov = 0, oo = 0, or = ni - nr;
  for (const p of parts) {
    if (out.late && p.late) out.late.set(p.late, ov / 3);
    if (out.side && p.side) out.side.set(p.side, ov / 3);
    if (out.blend) {
      if (p.blend) out.blend.set(p.blend, (ov / 3) * 4);
      else for (let v = ov / 3; v < (ov + p.position.length) / 3; v++) [out.blend[v * 4], out.blend[v * 4 + 1], out.blend[v * 4 + 3]] = [1, -1e9, 1];
    }
    out.position.set(p.position, ov);
    out.normal.set(p.normal, ov);
    out.color.set(p.color, ov);
    out.extra.set(p.extra, (ov / 3) * 4);
    if (out.anchor && out.growA && out.growB) {
      if (p.anchor && p.growA && p.growB) {
        out.anchor.set(p.anchor, ov);
        out.growA.set(p.growA, (ov / 3) * 4);
        out.growB.set(p.growB, (ov / 3) * 2);
      } else {
        out.anchor.set(p.position, ov);
        for (let v = ov / 3; v < (ov + p.position.length) / 3; v++) out.growB[v * 2 + 1] = -1;
      }
    }
    const base = ov / 3;
    for (let i = 0; i < p.index.length; i++) {
      if (i < p.resinStart) out.index[oo++] = p.index[i] + base;
      else out.index[or++] = p.index[i] + base;
    }
    ov += p.position.length;
  }
  return out;
}
