"use client";
/**
 * ParliamentSpace — the global timespace in 3D, before any styling.
 *
 *   x, z  the ground      y  TIME (exhibition seconds / secPerUnit · unit), later = higher
 *
 * What is drawn is exactly the output of the seed pipeline (lib/parliament/seeds.ts):
 *   folded world (without wear: this view is history) → seeds (where/when ≥ minVisitors gathered)
 *   → recipe → parts (plinth, basement, piles, masses, slabs, columns), only in the time slots in which somebody
 *   was around (columns may cross empty time).
 * One InstancedMesh per part kind (a material each); screen-space AO (N8AO) does most of the reading of the masses.
 * Time is linear (y = t / secPerUnit · unit). The camera is focused on the PLAYER's present time (the latest
 * presence of the most recently opened /mobile tab), so the boxes are in view however old the epoch is.
 * Untextured on purpose, for now: textures, natural matter and other roles come later, through the same seeds.
 * URL: ?demo=1 seeds a demo crowd · ?ui=0 hides the panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Hud, OrbitControls } from "@react-three/drei";
import { Dandelions } from "./Dandelions";
import { keepWindowSec, setKeepWindowSec } from "@/lib/parliament/log";
import { Bloom, DepthOfField, EffectComposer, N8AO, Noise } from "@react-three/postprocessing";
import { useFlowerBloom } from "./plantCloudsGpu";
import { VEG_FLOW_W, VegFlow, vegFlowSupported, type VegFlowKnobs } from "./vegFlow";
import { useFutureRender } from "./futureLife";
import { BONE_GLSL, boneLight, boneU, FOSSIL_AT_GLSL, pickClock, wayBoneShader, type FossilClock } from "./boneLook";
import { BlendFunction } from "postprocessing";
import { Leva, button, buttonGroup, folder, levaStore, monitor, useControls as useLevaControls } from "leva";
import * as THREE from "three";
import {
  DEFAULT_BOXES,
  LS_PARLIAMENT_ME_KEY,
  PART_CAPACITY,
  PART_KINDS,
  RECIPES,
  STEEL,
  clearWorld,
  currentEpochKey,
  MAX_TIME_RATE,
  MIN_TIME_RATE,
  getEpochMs,
  latestOf,
  latestS,
  loadEvents,
  sessionSeconds,
  makeLocalClock,
  sharedClock,
  type Clock,
  seedParliamentDemoIfRequested,
  type BoxConfig,
  type EventLog,
  type FoldConfig,
  type NatureConfig,
  type PEvent,
  type PartKind,
  type PipeParts,
  type PointsResult,
  type Recipe,
  type RoleId,
  type SpaceRequest,
  type WallClock,
  type SpaceResponse,
  type WeatherConfig,
  DEFAULT_WEATHER,
  rotOnsetSlots,
  DEFAULT_WALK,
  DEFAULT_WATER,
  type DensityConfig,
  DEFAULT_DENSITY,
  DensityField,
  DEFAULT_PATH,
  botGround,
  tailField,
  WORLD_CELLS,
  WORLD_HALF,
  WORLD_SIZE,
  DEFAULT_VARIETY,
  type WalkConfig,
  type WaterConfig,
  type Border,
  nearestOnBorder,
  villageBorders,
  DEFAULT_FUSE,
  DEFAULT_STUDY,
  type FuseConfig,
  type FuseMesh,
  SpaceModel,
  layerDecayOf,
  handleSpaceRequest,
  blockSlots,
} from "@/lib/parliament";
import { FUSE_BLEND_S, type UnitChunks, type UnitStats } from "@/lib/parliament/fuseUnits";
import { WALL_BUILD } from "@/lib/parliament/build";
import { FutureVillage, futureLink } from "./FutureVillage";
import { FutureUnder, futureUnder } from "./FutureUnder";
import { futureOnly } from "@/lib/parliament/futureOnly";
import { DEFAULT_ERODE, erosionAt, fossilWaitSec, type ErodeConfig } from "@/lib/parliament/erode";
import { useTicker } from "./useTicker";
import { LEVA_THEME, useFoldControls, useNatureControls, useWorld, useKeepWindowControl } from "./useWorld";
import { applyValues, presetSource, reloadSaved, savable, showNote } from "./levaSave";
import { LevelsPass, RenderLights, RenderTuning, StillNoise, TonePass, useRenderOptions } from "./useRenderOptions";
import { HeroCapture, HeroFrame, useHeroShot } from "./HeroShot";
import { EXHIBITION_FUSION, FUSION_PRESETS } from "@/presets/exhibitionFusion";
import { arriveCompile, arriveDepthMaterial, makeArriveUniforms, setArrive, type ArriveWay } from "@/lib/parliament/arriveMaterial";
import { setLevaFocus } from "./levaFocus";
import { useLabWorld, type TakenWorld } from "./useLabWorld";
import { type CameraState, type Sequence as ShotSequence, type Shot, type ShotDriver, type StepInput, STALL_SEC, cameraStateOf, clockSec, createShotDriver, placeCamera, shotStatus, stepShotDriver } from "@/lib/parliament/cameraShots";
import { botKinds, botReadout, useGlobalBots, type BotKind } from "./useGlobalBots";
import { useParliamentVersion } from "./version";
import { useReloadOnContextLoss } from "./useReloadOnContextLoss";

/** Background and ground grid per theme. */
const THEMES = {
  paper: { bg: "#e9ebee", grid: ["#9aa0a8", "#d3d6db"], text: "text-black/45" },
  black: { bg: "#0a0b0d", grid: ["#3a3f47", "#1a1d22"], text: "text-white/50" },
} as const;

/**
 * Points that dissolve near the camera (a dithered fade between `near0` and `near1`, view distance), so close
 * vegetation never blocks the view. No transparency sorting: fragments are discarded against screen-space noise.
 */
function fadingPointsMaterial(): THREE.PointsMaterial {
  const m = new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: true });
  const uniforms = { uFade0: { value: 2 }, uFade1: { value: 8 }, uJitter: { value: 0 } };
  m.userData.fade = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uFade0;\nuniform float uFade1;\nuniform float uJitter;\nvarying float vFade;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFade = smoothstep(uFade0, max(uFade0 + 1e-3, uFade1), -mvPosition.z);")
      // size jitter: a fixed factor per point, hashed from its position
      .replace(
        "#include <fog_vertex>",
        "#include <fog_vertex>\ngl_PointSize *= max(0.05, 1.0 + uJitter * (fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 2.0 - 1.0));",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vFade < fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)) discard;");
  };
  return m;
}
/** Base colour per part kind (instance tone multiplies it). */
const KIND_COLOR: Record<PartKind, string> = {
  mass: "#f4f4f2",
  slab: "#fbfbfa",
  drip: "#ecece9",
  column: "#6f747b",
  beam: "#6f747b",
  brace: "#6f747b",
  plinth: "#b8bbbf",
  basement: "#9fa3a8",
  pile: "#7f848a",
};
/** The 3D view's own defaults for the worker rule (tuned on screen 2026-10-07); the player view keeps DEFAULT_FOLD. */
const SPACE_FOLD = { radius: 2.75, threshold: 40, pourUnit: 111, minVisitors: 4, visitorCap: 20, maxHeight: 18, tauFootprintYears: 2000, emptyGapSec: 20 };
/** V2 weathering defaults: the whole life of a part fits in the kept history window (see the 풍화 · 지층 Leva). */
const V2_ROT_DOSE = 3;
const V2_TIME_SCALE = 0.4;
/** …and for the parts. */
const SPACE_BOXES = { ...DEFAULT_BOXES, secPerUnit: 20, width: 0.8, density: 1.4 };

/** How often the view asks the worker (wall clock). */
const TICK_MS = 500;

/** Frames per second of this tab, once a second (0 while hidden). */
function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let n = 0, t0 = performance.now(), raf = 0;
    const tick = (now: number) => {
      n++;
      if (now - t0 >= 1000) {
        setFps(Math.round((n * 1000) / (now - t0)));
        n = 0;
        t0 = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}
/** Vegetation and plants are asked for every this-many ticks. */
const NATURE_EVERY = 4;
/** Paused (time rate 0): mass chunks rebuilt per request — a changed setting shows in one or two requests. */
const PAUSED_FUSE_PER_CALL = 12;
/**
 * How far past the last event the clock may carry the present (session s): the world keeps ageing with nobody in it,
 * but a clock left at ×20 overnight no longer turns it into a fourteen-day-old fossil bed — the geological clock is
 * superlinear in session time, and at such ages a building melted eleven slots after it was built (the artist,
 * 2026-10-31: "buildings appear and vanish in real time").
 */
const IDLE_AGE_MAX_S = 2 * 3600;
/** The fusion group and the Leva paths its `render` conditions read (a folder's name is part of the path). */
const FU = "엉김 · 융합 · 레진";
// (named for what each does, in the order a part goes through them — the artist, 2026-11-15: "융합비주얼 레바 정리/설명좀")
const FU_WHEN = "① 언제 덩어리가 되나 (부재의 진행 = 침식과 같은 숫자)";
const FU_MASS = "② 얼마나 뭉치나 (부재 사이를 메움)";
const FU_WAY = "③ 부재가 녹는 꼴 (통째 · 관 · 판 사이 채움)";
const FU_FOSSIL = "④ 건축 → 화석 (진행이 깊을수록 둥글게)";
const FU_HOLLOW = "⑤ 구멍 (껍질 · 거품 · 보로노이)";
const FU_PITS = "⑥ 곰보 (표면의 작은 자국)";
const FU_MAT = "⑦ 재질 (덩어리의 색 · 빛)";
const BODY_PATH = `${FU}.fuseBody`;
const MODE_PATH = `${FU}.${FU_WAY}.massMode`;
const WALKS_PATH = `${FU}.${FU_WAY}.배관 · 다리 · 철골도 녹음.fuseWalks`;
const PIPES_PATH = `${FU}.${FU_WAY}.배관 · 다리 · 철골도 녹음.fusePipes`;
const FILL_PATH = `${FU}.${FU_WAY}.판 사이 채우기.fill`;
const SHELL_PATH = `${FU}.${FU_HOLLOW}.shell`;
const FOAM_PATH = `${FU}.${FU_HOLLOW}.foam`;
const HOLE_PATH = `${FU}.${FU_HOLLOW}.holeShape`;
const PITS_PATH = `${FU}.${FU_PITS}.pits`;
const CAV_PATH = `${FU}.${FU_FOSSIL}.cavity`;
const ACC_PATH = `${FU}.${FU_MASS}.고급.엉김 띠 (융합 전).accretion`;
const SKEL_PATH = `${FU}.${FU_MASS}.고급.skeleton`;
const BAKE_PATH = `${FU}.${FU_WHEN}.bake`;
const SPIKES_PATH = `${FU}.${FU_MASS}.고급.spikes`;
const RESIN_MODE_PATH = `${FU}.${FU_MAT}.resinMode`;
const MASS_BODY_PATH = `${FU}.${FU_MAT}.고급.massBody`;

/** sRGB hex → linear RGB (the fused mass's vertex colours are linear). */
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
const DEG = Math.PI / 180;
const RC = RECIPES.concrete;
const pair = (v: [number, number], f = 1): [number, number] => [v[0] * f, v[1] * f];

const NO_COUNTS = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
/** A focus change larger than this (world units on the time axis) is a jump, not a drift. */
const FOLLOW_SNAP = 40;

interface Stats {
  seeds: number;
  boxes: number;
  kinds: Record<PartKind, number>;
  t: number;
  top: number;
  /** Time the camera is focused on: the player's present (or the latest event when there is no player). */
  focusS: number;
  focusIsMe: boolean;
  /** Seeds built without slats (level of detail). */
  farSeeds: number;
  /** how far the computed present lies behind the latest event (s): the compute cannot keep up when > a slot */
  lagS: number;
  /** The fused mass as last received: triangles in all, and in the resin part (0 = the mesh came empty). */
  fuseTris: number;
  /** SEEDED: of the mass's vertices, the share that is out of its part at all, and how far out they are on average
   *  (0 … 1; −1 = the mass is not seeded) — so "nothing to be seen yet" can be told from "nothing there". */
  fuseOut?: number;
  fuseOutMean?: number;
  fuseResin: number;
  /** THE MASS MADE IN A WORKER OF ITS OWN (fuseUnits.ts), as it last said: pieces still to make, how long a piece takes, what stands. */
  fuseSide?: UnitStats;
  /** THE MASS ON THIS THREAD (2026-11-21): a message's way from the worker (ms), making a chunk's geometry (ms, mean and
   *  the worst), and its first draw — the GPU upload (ms, mean and the worst) — over the chunks since the last message. */
  fuseUpload?: FuseUpload;
  /** What stands on the screen, counted on this thread: chunk meshes, their vertices and triangles. */
  fuseScene?: { chunks: number; verts: number; tris: number };
  /** The stamp of the code the model's worker runs (lib/parliament/build.ts; "?" = a worker from before the stamp). */
  build?: string;
  /** Chunks of slots baked (kept as they were, below the history window too). */
  baked: number;
  /** Waterways flowing now. */
  links: number;
  pipeRuns: number;
  /** How long the worker's last computation took. */
  workerMs: number;
  /** The slowest request of the last few seconds, by stage (ms). */
  stages?: { ms: number; stages: Record<string, number> };
  /** Where it ran. */
  runner: string;
}

interface FuseUpload {
  transferMs: number;
  applyMs: number;
  applyMax: number;
  drawMs: number;
  drawMax: number;
  n: number;
}

interface Orbit {
  target: { x: number; y: number; z: number };
  object: { position: { x: number; y: number; z: number } };
  update: () => void;
}

/**
 * What the exhibition camera and the time-axis follow share, frame to frame (docs/camera-motion.md §5): the auto run
 * writes the lift it wants (null = the "초점 높이" slider stands), the follow writes the focus's height it moves to.
 */
interface CamLink {
  lift: number | null;
  focusY: number | null;
}

/** What the view asks the worker for vegetation (null = vegetation off). */
interface NatureParams {
  cfg: NatureConfig;
  /** Vegetation gathering on buildings, drawn as point clouds: the cloud's diameter, its random spread (±), the
   * number of points in one cloud and their size. */
  gatherSize: number;
  gatherJitter: number;
  gatherPoints: number;
  gatherDot: number;
  /** The vegetation's history (what the fusion and the gatherings read; no points of its own): slots around the focus, cells around the visits. */
  window: number;
  margin: number;
  reclaim: boolean;
  tauReclaimYears: number;
  reclaimPerArea: number;
  /** The gatherings are the density's (built but not lived in, density.ts liveAt): no vegetation history is asked for. */
  unlived?: boolean;
}

/** The resin body of the oldest layers: transmissive, darkening with thickness (Beer–Lambert attenuation). */
interface ResinLook {
  /** Seconds the mass takes to change from what it was to what it is (the cross-fade; 0 = at once). */
  fadeSec?: number;
  /** How much thinner the mass is where it is least out (world; the shader stands the surface back along its normal). */
  growThin?: number;
  /** THE FOSSIL'S ONE RULER IS THE AGE (2026-11-20): the slots since what stands there hardened over which it is whole,
   *  and how much the DEPTH slows that ageing (0 = the age alone, the same speed everywhere … 1 = at the window's top
   *  nothing fossilises; the foot always at full speed). */
  /** (in MINUTES of the clock since 2026-11-20 — "시간 단위여야 하는 게 단인 것들도 있음": the wall turns them into slots of
   *  the top's way) */
  growAgeMin?: number;
  growDeep?: number;
  /** IT MELTS OUT OF ITS PARTS (the shader's growFar): how far into the progress the fossil's farthest surface waits
   *  behind what lies on the part (0 = the whole surface at once), and the distance from the part that counts as
   *  farthest (world). */
  growMelt?: number;
  growReach?: number;
  /** IT SWELLS OUT OF ITS OWN UNIT (the shader's press): 0 = the whole surface stands back along its normal, one body
   *  … 1 = every vertex is pressed into its own part (unit) and swells out of it — the first seeded mass (11/16). */
  growPress?: number;
  /** THE EDGE IS EATEN, NOT CUT (the shader's seal): below this much out, the mass goes through a noise of the world
   *  (holes of 삭는 구멍의 크기) rather than ending in an open line (0 = off). */
  growSeal?: number;
  /** …and the size of those holes (world). */
  growSealGrain?: number;
  /** THE CAP: the inside of the mass, seen through an opening, drawn as solid stone (false = as it is: a hollow skin). */
  growCap?: boolean;
  /** THE FRAME FIRST (fuse.ts FuseMesh.late): how far into the fossil's progress the filling (boxes, plates, rooms)
   *  waits behind the frame (0 = all at once … 0.9), and how much it fills from each layer's floor upward (0 … 1). */
  growLate?: number;
  growRise?: number;
  /** THE FOSSIL HAS A LIFE (the shader's growGone): whether it goes back into its parts at all before the window's
   *  foot; the slots of the same ruler (its age, slowed by the depth) after which it begins, and goes over. */
  growDie?: boolean;
  growDieAfterMin?: number;
  growDieSpanMin?: number;
  /** …and HOW it goes: 0 = it thins back into its parts … 1 = holes eat through it (as the pipes'); the holes' size (world). */
  growDieHoles?: number;
  growDieGrain?: number;
  /** …how ragged the edge of the going is (patches ahead of and behind it), and the patches' size (world). */
  growDieRag?: number;
  growDiePatch?: number;
  color: string;
  /** Transmission (refraction) — 0 = a plain translucent body with `opacity`. */
  transmission: number;
  opacity: number;
  /** The fused mass before the resin: 1 = opaque stone, less = a translucent body. */
  massOpacity: number;
  /** How much of the mass's shades (pits, stains, age) show in the resin: 0 = pure resin colour … 1 = all. */
  shade: number;
  /** The frosted skin's Fresnel rim (0 = none): brightness added where the surface turns away from the eye. */
  rim: number;
  /** How much a part right under the skin shows through it (darkening by the mesh's GHOST extra; 0 = none). */
  ghost: number;
  /** WHAT IS INSIDE SHOWS THROUGH (boneLook.ts uSeeBase / uSeeParts): either above 0 makes the body blend. */
  see?: number;
  /** The frosted skin's own light (emissive, in the resin's colour; 0 = none). */
  glow: number;
  /** The shell's pits, drawn by the material (see fuse.ts FuseStudy.pits): shadow, coverage, size (world), size jitter, rim softness, dent depth. */
  pits: { dark: number; cover: number; size: number; jitter: number; soft: number; depth: number };
  roughness: number;
  thickness: number;
  attenuationColor: string;
  attenuationDistance: number;
}

function applyPointLook(m: THREE.PointsMaterial, size: number, fade: [number, number], jitter = 0): void {
  m.size = size;
  m.userData.fade.uJitter.value = jitter;
  m.userData.fade.uFade0.value = fade[0];
  m.userData.fade.uFade1.value = fade[1];
}

function applyCloudLook(m: THREE.PointsMaterial, dot: number, radius: number, jitter: number, fade: [number, number]): void {
  applyPointLook(m, dot, fade, jitter);
  m.userData.cloud.uRadius.value = radius;
}

function applyResin(m: THREE.MeshPhysicalMaterial, r: ResinLook): void {
  m.color.set(r.color);
  m.transmission = r.transmission;
  m.roughness = r.roughness;
  m.thickness = r.thickness;
  m.ior = 1.5;
  m.attenuationColor.set(r.attenuationColor);
  m.attenuationDistance = r.attenuationDistance;
  // transmission 0 (the glass / alpha body, also performance mode): no refraction pass — a solid body at opacity 1
  // (the artist, 2026-10-19: the translucent body was too see-through, opaque fits the intent), alpha below it
  const solid = r.transmission > 0 || r.opacity >= 1;
  // (what is inside showing through: the body blends — over what was drawn before it — but still writes its depth, so
  // its own far side does not show through its near one)
  const see = solid && (r.see ?? 0) > 0;
  if (m.transparent !== (!solid || see)) m.needsUpdate = true;
  m.transparent = !solid || see;
  m.opacity = solid ? 1 : r.opacity;
  m.depthWrite = solid;
  (m.userData.uShade as THREE.IUniform).value = r.shade;
  (m.userData.uRim as THREE.IUniform).value = r.rim;
  const u = m.userData.fuseU as FuseUniforms;
  u.uGhost.value = r.ghost;
  u.uPitDark.value = r.pits.dark;
  u.uPitCover.value = r.pits.cover;
  u.uPitSize.value = r.pits.size;
  u.uPitJitter.value = r.pits.jitter;
  u.uPitSoft.value = r.pits.soft;
  u.uPitDepth.value = r.pits.depth;
  // the frosted skin: a little of its own light (the AO otherwise weighs the opaque body down), a clearcoat for the
  // lights' highlights (cheap), no refraction
  m.emissive.set(r.color);
  m.emissiveIntensity = r.glow;
  m.clearcoat = r.rim > 0 ? 0.5 : 0;
  m.clearcoatRoughness = 0.4;
  m.needsUpdate = true;
}

/** The uniforms both fused materials share (the stone's and the resin's): the skin's ghost and the shell's pits. */
interface FuseUniforms {
  uGhost: THREE.IUniform;
  uPitDark: THREE.IUniform;
  uPitCover: THREE.IUniform;
  uPitSize: THREE.IUniform;
  uPitJitter: THREE.IUniform;
  uPitSoft: THREE.IUniform;
  uPitDepth: THREE.IUniform;
  // THE MASS GROWS OUT OF ITS PARTS ON THE SCREEN (fuse.ts seeded): on for a mesh that carries the growing data; the
  // window's top now (slots), its height, the erosion's start … full depth and the unlived pull, the life and the
  // wait as slots of the top's travel, and the progress the mass begins … is whole at
  uGrowOn: THREE.IUniform;
  uGrowTop: THREE.IUniform;
  uGrowHeight: THREE.IUniform;
  uGrowStart: THREE.IUniform;
  uGrowFull: THREE.IUniform;
  uGrowVegPull: THREE.IUniform;
  uGrowLifeTop: THREE.IUniform;
  uGrowWaitTop: THREE.IUniform;
  /** …and the slots a part stands before its fossil begins (it must have been simplified), and the slots it comes out over. */
  uGrowAfter: THREE.IUniform;
  uGrowOver: THREE.IUniform;
  /** …the clock a piece's stamp is read against (seconds; fuseUnits.ts: a piece made in the worker beside grows out
   *  of its parts from the moment it is shown) and the seconds it takes; and the slot the window has let go below. */
  uGrowClock: THREE.IUniform;
  uGrowAppear: THREE.IUniform;
  uGrowFloor: THREE.IUniform;
  /** …and how much thinner the mass is where it is least out (world, along its surface's normal). */
  uGrowThin: THREE.IUniform;
  /** …the slots of AGE (the top's way since what stands there hardened) over which the fossil is whole, and how much
   *  the depth slows that ageing (ResinLook.growDeep). */
  uGrowAgeSpan: THREE.IUniform;
  uGrowDeep: THREE.IUniform;
  /** …and how far the fossil's farthest surface waits behind what lies on its part, and that distance (ResinLook.growMelt). */
  uGrowMelt: THREE.IUniform;
  uGrowReach: THREE.IUniform;
  /** …and how much a vertex is pressed into its own unit while it is not out (ResinLook.growPress). */
  uGrowPress: THREE.IUniform;
  /** …and below how much out the mass is eaten through a noise of the world (ResinLook.growSeal). */
  uGrowSeal: THREE.IUniform;
  /** …and the seconds a change of the worker's (a skin hidden or shown, a piece made again) takes (fuseUnits FUSE_BLEND_S). */
  uGrowBlend: THREE.IUniform;
  /** …and the size of the holes the barely-out edge, the skin's end and a swap go through (world; ResinLook.growSealGrain). */
  uGrowSealGrain: THREE.IUniform;
  /** …and whether the inside of the mass, seen through an opening, is drawn as solid stone (ResinLook.growCap). */
  uGrowCap: THREE.IUniform;
  /** …and whether the fossil is made in stages (FuseConfig.stageN): the mesh is the stage's real shape, drawn whole. */
  uGrowStages: THREE.IUniform;
  /** …how far the filling waits behind the frame, and how much it rises from each layer's floor (ResinLook.growLate). */
  uGrowLate: THREE.IUniform;
  /** …and how far the top would have risen while its rise was stopped (rise.ts; slots): the fossil's AGE is read off
   *  the top's way plus this, its depth off the top alone. */
  uGrowStood: THREE.IUniform;
  uGrowRise: THREE.IUniform;
  /** …and THE FOSSIL'S LIFE (ResinLook.growDie): 1 = it goes back into its parts as it ages on (0 = only at the
   *  window's foot); the slots of the same ruler it begins after and goes over. */
  uGrowDie: THREE.IUniform;
  uGrowDieAfter: THREE.IUniform;
  uGrowDieSpan: THREE.IUniform;
  /** …how much of that going is HOLES eaten through the mass (0 = it thins … 1 = holes), and the holes' size (world). */
  uGrowDieHoles: THREE.IUniform;
  uGrowDieGrain: THREE.IUniform;
  /** …and how far the going is ahead or behind from patch to patch (0 = one line across the wall), the patches' size (world). */
  uGrowDieRag: THREE.IUniform;
  uGrowDiePatch: THREE.IUniform;
}
function makeFuseUniforms(): FuseUniforms {
  return {
    uGhost: { value: 0 }, uPitDark: { value: 0 }, uPitCover: { value: 0 }, uPitSize: { value: 0.35 }, uPitJitter: { value: 0.5 }, uPitSoft: { value: 0.12 }, uPitDepth: { value: 0 },
    uGrowOn: { value: 0 }, uGrowTop: { value: 0 }, uGrowHeight: { value: 1 }, uGrowStart: { value: 0 }, uGrowFull: { value: 1 }, uGrowVegPull: { value: 0 }, uGrowLifeTop: { value: 1 }, uGrowWaitTop: { value: 0 }, uGrowAfter: { value: 0 }, uGrowOver: { value: 3 },
    uGrowClock: { value: 1e9 }, uGrowAppear: { value: 10 }, uGrowFloor: { value: -1e9 }, uGrowThin: { value: 0.6 }, uGrowAgeSpan: { value: 40 }, uGrowDeep: { value: 0.6 }, uGrowMelt: { value: 0.6 }, uGrowReach: { value: 2 }, uGrowPress: { value: 1 }, uGrowSeal: { value: 0 }, uGrowBlend: { value: FUSE_BLEND_S }, uGrowSealGrain: { value: 0.8 }, uGrowCap: { value: 1 }, uGrowStages: { value: 0 },
    uGrowLate: { value: 0 }, uGrowRise: { value: 0 }, uGrowStood: { value: 0 },
    uGrowDie: { value: 0 }, uGrowDieAfter: { value: 60 }, uGrowDieSpan: { value: 30 },
    uGrowDieHoles: { value: 0 }, uGrowDieGrain: { value: 1.2 }, uGrowDieRag: { value: 0 }, uGrowDiePatch: { value: 9 },
  };
}

/**
 * THE MASS GROWS OUT OF ITS PARTS (fuse.ts seeded; the artist, 2026-11-16: "시간대별로 눌러서 안 보이게 … 얼추 생성되는
 * 것처럼", "건물이 있는데 화석화되는 구간도 있어야지"). The mesh is the mass as it will be when all of it has fused;
 * every vertex knows the part it grows from. Here the part's PROGRESS is worked out of the window's top — the same
 * sum the model makes (spaceModel sunk: the depth's weight × the layer factor over the top's way since the part was
 * built, without its steps) — and the vertex is let out of its part by as much: pressed to the part while the part
 * is new, swelling out of it as it goes on. Nothing is sent or made again for it: one number a frame.
 */
const FUSE_GROW_VERT_HEAD = `
attribute vec3 fuseAnchor;
attribute vec4 fuseGrowA;
attribute vec2 fuseGrowB;
attribute float fuseLate;
attribute vec4 fuseBlend;
varying vec2 vSwap;
varying float vSkin;
varying float vEdge;
uniform float uGrowBlend, uGrowStages;
uniform float uGrowOn, uGrowTop, uGrowHeight, uGrowAfter, uGrowOver, uGrowClock, uGrowAppear, uGrowFloor, uGrowThin, uGrowAgeSpan, uGrowDeep, uGrowMelt, uGrowReach, uGrowPress, uGrowSeal, uGrowLate, uGrowRise, uGrowStood, uGrowDie, uGrowDieAfter, uGrowDieSpan, uGrowDieHoles;
varying float vGrow;
varying float vGone;
varying vec3 vGonePos;`;
/**
 * THE FOSSIL GOES IN HOLES (the artist, 2026-11-17: "구멍으로 삭게" — as the pipes do: holes eaten through the wall, more
 * of it as it decays). The fragment's side of the fossil's life: a noise fixed in the world (two sizes of it), and
 * whatever of it lies under how far gone the place is, is not drawn — the holes open, widen, join, and nothing is left.
 * What stands inside (the parts that did not erode) shows through them.
 */
const FUSE_GONE_FRAG_HEAD = `
varying vec2 vSwap;
varying float vSkin;
varying float vEdge;
uniform float uGrowSeal, uGrowSealGrain;
varying float vGrow;
varying float vGone;
varying vec3 vGonePos;
uniform float uGrowDieGrain, uGrowDieRag, uGrowDiePatch, uGrowPress;
float goneHash( vec3 p ) { p = fract( p * 0.1031 + vec3( 0.71, 0.113, 0.419 ) ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
float goneNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( goneHash( i ), goneHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 0.0 ) ), goneHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
              mix( mix( goneHash( i + vec3( 0.0, 0.0, 1.0 ) ), goneHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 1.0 ) ), goneHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}`;
const FUSE_GONE_FRAG_BODY = `
// A PIECE MADE AGAIN DISSOLVES INTO THE ONE IT REPLACES (the artist, 2026-11-21: "둘 다 넣는데"; fuseUnits FUSE_BLEND_S):
// the one coming in is drawn where a screen noise is under the time gone, the one going out where it is over it — the
// two are drawn together, pixel by pixel one or the other, and where they are the same surface nothing changes
// (through a noise fixed in the world, patch by patch — not a screen grain, which read as see-through: the artist,
// 2026-11-21, "투명하다가 생기는 건 좀 별로")
if ( vSwap.x != 0.0 ) {
  vec3 swapP = vGonePos / max( 0.05, uGrowSealGrain ) + 11.7;
  float swapN = clamp( ( 0.65 * goneNoise( swapP ) + 0.35 * goneNoise( swapP * 2.7 + 2.9 ) - 0.5 ) * 1.9 + 0.5, 0.001, 0.999 );
  if ( vSwap.x > 0.0 ? swapN >= vSwap.y : swapN < vSwap.y ) discard;
}
// THE EDGE IS EATEN, NOT CUT (the artist, 2026-11-21, of the first try at a closed edge: "열자마자 잘려보이는디" — a vertex
// pressed all the way into its unit lay on the unit's box, and the boxes' faces read as flat cuts). Where the mass is
// barely out (vGrow under uGrowSeal) and where the provisional skin thins towards its far end (vSkin), it goes through
// a noise fixed in the world — holes of their own size (uGrowSealGrain: the life's holes, 4 world with the artist's
// values, were blotches, not an edge): islands and bays, no plane
float edgeK = min( uGrowSeal > 0.0 ? vEdge / uGrowSeal : 1.0, vSkin );
if ( edgeK < 1.0 ) {
  vec3 edgeP = vGonePos / max( 0.05, uGrowSealGrain ) + 3.1;
  float edgeN = clamp( ( 0.65 * goneNoise( edgeP ) + 0.35 * goneNoise( edgeP * 2.7 + 5.3 ) - 0.5 ) * 1.9 + 0.5, 0.001, 0.999 );
  if ( edgeN > edgeK ) discard;
}
// NO LINE ACROSS THE WALL (the artist, 2026-11-18: "지금 화석화 잘리는 구간 생기는데?"): where everything of a layer is as
// old as its depth, the going was one value per layer — holes over a few slots, and nothing below: a cut. Each PATCH of
// the world is now ahead of or behind the going by its own amount (a wide noise), so the going's edge wanders up
// and down the column patch by patch and the holes begin here long before there. (vGone comes unclamped.)
float goneAt = vGone == 0.0 ? 0.0 : clamp( vGone + ( goneNoise( vGonePos / max( 0.5, uGrowDiePatch ) + 7.7 ) - 0.5 ) * 3.0 * uGrowDieRag, 0.0, 1.0 );
if ( goneAt > 0.001 ) {
  vec3 goneP = vGonePos / max( 0.05, uGrowDieGrain );
  // (an average of hashes crowds round the middle: spread back out, so the first holes come early and the last late)
  float goneN = clamp( ( 0.65 * goneNoise( goneP ) + 0.35 * goneNoise( goneP * 2.7 + 11.3 ) - 0.5 ) * 1.9 + 0.5, 0.0, 0.999 );
  if ( goneN < goneAt ) discard;
}`;
// BY ITS LAYER AND THE VEGETATION THERE, CONTINUOUSLY (the artist, 2026-11-16: "왜 그정도나 기다려야해? 층이랑 식생양따라
// 연속적 가중치 넣어"): how far a vertex is out is read straight off where its part lies — how deep in the window
// (0 the top … 1 its foot), deeper by the vegetation gathered there and a little sooner or later part by part — between
// the depth the fossil begins at and the depth it is whole at; times how much of it the vegetation makes; and not
// before its part has stood long enough to have been simplified (then over a few slots, so it does not appear at once).
// No sum over the time gone by: the layer sinks as the window rises, and the fossil comes out with it.
const FUSE_GROW_VERT_BODY = `
vGrow = 1.0;
vGone = 0.0;
vSwap = vec2( 0.0 );
vSkin = 1.0;
vEdge = 1.0;
vGonePos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
if ( uGrowOn > 0.5 && fuseGrowB.y >= 0.0 ) {
  // (the vegetation is a FACTOR of how much comes out — fuseGrowB.y — not a depth added: with the artist's own
  // values, 2026-11-16, most cells are unlived and "unlived first" at 0.45 put every layer past the depth the fossil
  // is whole at: the whole wall's fossil was out at once, and the layer shaped nothing)
  // ONE RULER, AND IT IS THE AGE (the artist, 2026-11-18: "나이와 깊이를 고민하는데 나이를 세게 고민한다 — 여기에서 점점
  // 멀어지는 기분", and of the knobs: "서로 엉킨 레바도 있는 것 같고"). Until now the layer's depth and the age were two
  // rulers mixed half and half — each with its own onset and span, for the coming-out and again for the going — and
  // a depth far enough down let the fossil out of what had only just been built. Now the fossil is read off ONE
  // number: the slots since what stands there hardened (the top's way, and the clock of the stopped rise), which
  // nothing comes out without. The depth only sets how fast that age counts — at the window's foot at full speed,
  // slower towards its top by uGrowDeep (1 = at the top not at all) — and each part's own factor a little sooner or
  // later (fuseGrowA.w: spaceModel's own factor, 1 ± the spread). The going reads the same number further on.
  float growDepth = ( uGrowTop - ( fuseGrowA.x + 0.5 ) ) / max( 1.0, uGrowHeight );
  float growAge = uGrowTop + uGrowStood - fuseGrowA.y - uGrowAfter;
  float growT = growAge * max( 0.2, fuseGrowA.w ) * ( 1.0 - uGrowDeep * ( 1.0 - clamp( growDepth, 0.0, 1.0 ) ) );
  float growLayer = clamp( growT / max( 1.0, uGrowAgeSpan ), 0.0, 1.0 );
  float growAged = clamp( growAge / max( 0.1, uGrowOver ), 0.0, 1.0 );
  // (a piece shown a moment ago comes out of its parts over a few seconds — it does not appear at once; and what
  // the window lets go of at its foot goes back into its parts over the last two slots above it)
  float growShown = clamp( ( uGrowClock - fuseGrowB.x ) / max( 0.01, uGrowAppear ), 0.0, 1.0 );
  float growKept = clamp( ( fuseGrowA.x - uGrowFloor ) * 0.5, 0.0, 1.0 );
  // THE FRAME FIRST, THE PLATES AND ROOMS AFTER (the artist, 2026-11-17: "A2" — the multipipe's melting form): the
  // progress is the frame's; the filling (fuseLate 1: a box, a plate, a room, what the blur adds) begins only once
  // the frame is that far out, and the higher it lies in its layer the later (it fills from the floor up). The
  // vegetation's factor stays an amount, not a time: it is applied after.
  // THE FOSSIL HAS A LIFE (the artist, 2026-11-17, asked whether the fossil should only be let go more softly or have
  // a life of its own: "수명을 준다"): it goes back into its parts as it came out of them — further along the same
  // ruler (its age, slowed by the depth): from uGrowDieAfter slots on, over uGrowDieSpan. It is a factor of the
  // progress, so it runs the coming-out backwards: the plates and rooms go first, the frame last; what did not erode
  // stands bare again. (uGrowDie 0 = off.)
  float growGoneAt = ( growT - uGrowDieAfter ) / max( 1.0, uGrowDieSpan );
  float growGone = uGrowDie * clamp( growGoneAt, 0.0, 1.0 );
  // (…IN HOLES — "구멍으로 삭게": as much of the going as uGrowDieHoles says is not a thinning but holes, eaten through
  // the mass in the fragment shader — FUSE_GONE_FRAG_BODY; the mass keeps its body until the holes have it all)
  // (unclamped, so that the fragment's patches can be ahead of it or behind: FUSE_GONE_FRAG_BODY; 0 = no life at all)
  vGone = uGrowDie * uGrowDieHoles * clamp( growGoneAt, -4.0, 4.0 );
  float growTime = growLayer * growAged * growShown * growKept * ( 1.0 - growGone * ( 1.0 - uGrowDieHoles ) );
  float growWait = uGrowLate * fuseLate * ( 1.0 - uGrowRise + uGrowRise * fract( fuseGrowA.x + 0.5 ) );
  // THE FRAME IS WHOLE BY THE TIME THE FILLING BEGINS (the artist, 2026-11-20: "이전처럼 파이프 형태로 녹지 않아서 비주얼이
  // 획일화되는 거"). The frame used to go on coming out over the whole progress, so at the moment the plates and rooms
  // began it was only that share out — a thin sliver along the edges, never tubes. It now comes out over the first
  // uGrowLate of the progress and stands whole while the filling comes over the rest: a stage of pipes alone.
  // IT MELTS OUT OF ITS PARTS (the artist, 2026-11-20, of the new fossil on the wall: "화석이 자연스럽게 녹아내려서
  // 생기질 않고 깊은 곳에선 바로 껍데기로 생기는데"). The whole surface of the mass used to come out together — all of the
  // final shape at once, faint, then a little thicker: a shell put on. Now what lies ON its part comes first, and
  // the surface waits the longer the farther it has swollen from the part (and what hangs below it longer still:
  // it runs down) — the fossil's edge creeps out of the parts and down as it goes on. One body all the same: a
  // vertex only waits, it is not pulled to its own part. (A piece new on the screen comes the same way, over
  // uGrowAppear seconds.)
  vec3 growOff = position - fuseAnchor;
  growWait = max( growWait, uGrowMelt * clamp( ( length( growOff ) + max( 0.0, - growOff.y ) ) / max( 0.1, uGrowReach ), 0.0, 1.0 ) );
  float growSpan = min( mix( uGrowLate > 0.05 ? uGrowLate : 1.0, 1.0 - growWait, fuseLate ), 1.0 - growWait );
  // WHAT CHANGES, CHANGES SOFTLY (the artist, 2026-11-21: "둘 다 넣는데"): the provisional skin's share (hidden where
  // the neighbour is on the screen, thinning towards its far end — fuseUnits fadeEdges) goes from what it was to what it
  // is over uGrowBlend seconds from the change (fuseBlend: the old share, the change's clock, the dissolve, the new)
  float growBlendT = clamp( ( uGrowClock - fuseBlend.y ) / max( 0.01, uGrowBlend ), 0.0, 1.0 );
  float growVeg = fuseGrowB.y;
  vSkin = mix( fuseBlend.x, fuseBlend.w, growBlendT );
  vSwap = vec2( fuseBlend.z, growBlendT );
  // (how far along its coming-out a vertex is, apart from how much of it the vegetation makes: the edge's holes read
  // this — read against vGrow, a place the vegetation makes little of stood in holes for good, 2026-11-21)
  vEdge = clamp( ( growTime - growWait ) / max( 0.05, growSpan ), 0.0, 1.0 );
  vGrow = vEdge * growVeg;
  // ONE BODY (the artist, 2026-11-16: "근데 부푸는 건 진짜 개별로던데"): a vertex is no longer pressed to its own part's
  // box — neighbours pressed to different boxes split the mass along the parts. What it reads is the value of its
  // PLACE (fuseUnits.ts placeValues: the parts' values blurred over the space; the layer off its own height), and it
  // only stands back along the surface's normal by as much as it is not out: the surface moves as one.
  // …OR OUT OF ITS OWN UNIT (the artist, 2026-11-20: "완전 초기에 삑사리나서 버렸던 부재별 감싸기가 난 훨씬 좋아보여 … 지금은
  // 파이프고 뭐고 하나도 유기적이지가 않고 그냥 따로 노는 느낌"): by uGrowPress the vertex is pressed into the unit it grows
  // from (fuseAnchor: the nearest point of it, a little inside) and swells out of it as it comes — the first seeded
  // mass (11/16), given up then because the mass split along its many small parts. The units are now a building's
  // few wide bodies (spaceModel fossilUnits), and how far each is out is still read off its place.
  float growEase = vGrow * vGrow * ( 3.0 - 2.0 * vGrow );
  // (the barely-out edge is eaten through a noise in the fragment shader — FUSE_GONE_FRAG_BODY, uGrowSeal — instead of
  // being pressed into its unit: pressed all the way, it lay flat on the unit's box, 2026-11-21)
  transformed = mix( transformed - normal * uGrowThin * ( 1.0 - growEase ), mix( fuseAnchor, transformed, growEase ), uGrowPress );
  // (…and the skin thins towards its far end, as it is eaten there: a tapering body, not a sheet)
  transformed -= normal * 0.35 * ( 1.0 - vSkin );
  // THE FOSSIL IN STAGES (spaceModel FuseInput.stages; the artist, 2026-11-21 night: "표면 뾰족한 거 진짜 싫어"): the mesh
  // is the stage's real shape — drawn whole where it stands: nothing pressed, thinned, eaten at its edge or let out by
  // the clock (a part on no stage yet is not in it). Only the life's going applies, and the provisional skin is there
  // or not (where its neighbour is on the screen, or towards its far end: cut — the cap shows it solid). A new stage
  // is put on by the worker a slot at a time from the bottom up (fuseUnits show: fuseBlend).
  if ( uGrowStages > 0.5 ) {
    transformed = position;
    vEdge = 1.0;
    vGrow = growKept * ( 1.0 - growGone * ( 1.0 - uGrowDieHoles ) ) * step( 0.5, vSkin );
  }
}`;

/**
 * The PITS of the shell (refs 9664, 9665: small round pores scattered over a smooth surface, of varied size, denser
 * here than there, each clearly cut in): a jittered scatter of spheres in world space — one or none per cell of
 * 2.2 pit diameters, its centre jittered, its radius ×½ … ×2 — cut into the SHADING: where the surface lies inside a
 * sphere the normal tilts toward its centre (a concave dent) and the colour darkens (its shadow). Nothing is carved
 * from the voxel grid (0.4): the pores are round and carved at any size, and the surface between them stays smooth.
 * Returns (d / r², depth 0 … 1) of the deepest sphere at p.
 */
const FUSE_PITS_GLSL = [
  "float fuseHash( vec3 p ) { p = fract( p * 0.1031 + vec3( 0.11, 0.37, 0.73 ) ); p += dot( p, p.yzx + 19.19 ); return fract( ( p.x + p.y ) * p.z ); }",
  "vec4 fusePits( vec3 p, float size, float jitter, float cover ) {",
  "\tfloat s = size * 2.2;",
  "\tvec3 base = floor( p / s - 0.5 );",
  "\tfloat best = 0.0;",
  "\tvec3 g = vec3( 0.0 );",
  "\tfor ( int dz = 0; dz <= 1; dz++ ) for ( int dy = 0; dy <= 1; dy++ ) for ( int dx = 0; dx <= 1; dx++ ) {",
  "\t\tvec3 q = base + vec3( float( dx ), float( dy ), float( dz ) );",
  "\t\tif ( fuseHash( q ) > cover ) continue;",
  "\t\tvec3 c = ( q + 0.15 + 0.7 * vec3( fuseHash( q + 7.1 ), fuseHash( q + 13.3 ), fuseHash( q + 29.7 ) ) ) * s;",
  "\t\tfloat r = size * 0.5 * exp2( ( fuseHash( q + 41.2 ) - 0.5 ) * 2.0 * jitter );",
  "\t\tvec3 d = p - c;",
  "\t\tfloat dd = dot( d, d );",
  "\t\tif ( dd < r * r ) { float dent = 1.0 - dd / ( r * r ); if ( dent > best ) { best = dent; g = d / ( r * r ); } }",
  "\t}",
  "\treturn vec4( g, best );",
  "}",
].join("\n");

/**
 * The fused mesh's per-vertex extras (FuseMesh.extra) in a material's shader: GHOST — a part right under the skin
 * darkens it (ref 9649: the machine parts under the white skin), by `uGhost`; FLAT — a blocky vertex (the young
 * layers' voxel steps, ref 9579) is shaded by its face, not by the smoothed vertex normal; PITS — the shell's pores
 * (FUSE_PITS_GLSL) where the vertex allows them (z = coverage here, w = away from the ribs).
 */
/**
 * THE MASS CHANGES SOFTLY (the artist, 2026-11-15: "건물 티커 적용처럼 융합 비주얼도 부드럽게 interpolate"). The mass
 * is one mesh, made again whole whenever something in it changed — it has no parts to bring in one by one. So what
 * it WAS is kept and drawn together with what it IS for a moment, through complementary screen-door patterns: a
 * pixel is drawn by the new mesh where its noise is under `t`, by the old one where it is not, `t` going 0 → 1. Where
 * the two are the same surface the picture does not change at all; where they differ, one dissolves into the other.
 */
interface FuseFade {
  t: THREE.IUniform<number>;
  /** 0 = what the mass is now (coming in), 1 = what it was (going out). */
  side: 0 | 1;
}

/**
 * THE MASS'S SHADOW IS OF THE MASS AS IT IS DRAWN: the same growing in the depth pass, and nothing where the mass is
 * not out — without it the whole mass, made for every layer of the window, cast its shadow from where nothing is shown.
 */
function fuseDepthMaterial(u: FuseUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial();
  m.customProgramCacheKey = () => "fuse-depth";
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${FUSE_GROW_VERT_HEAD}`).replace("#include <begin_vertex>", `#include <begin_vertex>${FUSE_GROW_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${FUSE_GONE_FRAG_HEAD}`).replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\nif ( vGrow < 0.15 ) discard;${FUSE_GONE_FRAG_BODY}`);
  };
  return m;
}

function patchFuseExtras(shader: THREE.WebGLProgramParametersWithUniforms, u: FuseUniforms, fade?: FuseFade): void {
  Object.assign(shader.uniforms, u);
  if (fade) {
    shader.uniforms.uFuseFade = fade.t;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uFuseFade;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\nfloat fuseFadeN = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );\nif ( ${fade.side === 0 ? "fuseFadeN >= uFuseFade" : "fuseFadeN < uFuseFade"} ) discard;`,
      );
  }
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nattribute vec4 fuseExtra;\nvarying vec4 vExtra;\nvarying vec3 vFusePos;${FUSE_GROW_VERT_HEAD}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>${FUSE_GROW_VERT_BODY}\nvExtra = fuseExtra;\nvFusePos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  // (what has not begun to grow is not drawn: the pressed mass lies inside its part, or where its part was)
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>${FUSE_GONE_FRAG_HEAD}`)
    .replace(
      "#include <clipping_planes_fragment>",
      // (where it is not out it is not drawn; where it is beginning to be, it comes in grain by grain — the edge of
      // what is shown is not a cut; and where its life is over, holes eat through it)
      // (NO SCREEN-DOOR — the artist, 2026-11-21: "화석이... 투명하다가 생기는 건 좀 별로인듯": the barely-out mass used to
      // come in grain by grain in screen space, which read as see-through; it now comes in through the world's holes —
      // FUSE_GONE_FRAG_BODY, uGrowSeal)
      "#include <clipping_planes_fragment>\nif ( vGrow < 0.02 ) discard;" + FUSE_GONE_FRAG_BODY,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nuniform float uGrowCap;\nuniform float uGhost;\nuniform float uPitDark;\nuniform float uPitCover;\nuniform float uPitSize;\nuniform float uPitJitter;\nuniform float uPitSoft;\nuniform float uPitDepth;\nvarying vec4 vExtra;\nvarying vec3 vFusePos;\n" + FUSE_PITS_GLSL,
    )
    .replace(
      "#include <normal_fragment_begin>",
      [
        "#include <normal_fragment_begin>",
        // THE CAP (the artist, 2026-11-21: "중간에 잘려 보일 수 있는 표면을 닫고 노이즈로 경계면을 거칠게"): the mass is a
        // closed surface; whatever of it is not drawn — the edge's holes while it comes out, a piece's open side, the
        // life's holes — lets the eye in, and the far side seen from inside is a BACK face. Drawn as the stone's cut — lit
        // flat towards the eye, darker, no pits — the opening reads as solid matter cut, not a hollow skin.
        "bool fuseCap = uGrowCap > 0.5 && !gl_FrontFacing;",
        "if ( fuseCap ) {",
        "\tvec3 capN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );",
        "\tnormal = dot( capN, vViewPosition ) < 0.0 ? - capN : capN;",
        "\tdiffuseColor.rgb *= 0.62;",
        "}",
        "float fuseFlat = fuseCap ? 0.0 : smoothstep( 0.45, 0.9, vExtra.y );",
        "if ( fuseFlat > 0.0 ) {",
        "\tvec3 fdx = dFdx( vViewPosition );",
        "\tvec3 fdy = dFdy( vViewPosition );",
        "\tnormal = normalize( mix( normal, normalize( cross( fdx, fdy ) ), fuseFlat ) );",
        "}",
        "if ( !fuseCap && uPitDark + uPitDepth > 0.0 && vExtra.z * vExtra.w > 0.001 ) {",
        "\tvec4 pf = fusePits( vFusePos, uPitSize, uPitJitter, uPitCover * vExtra.z );",
        // WHERE THEY GATHER THEY CROWD (fuse.ts pitZ past 1; the artist, 2026-11-20: "곰보가 몰리는 곳은 레퍼런스 사진처럼
        // 빡! 몰리길"): two smaller sizes of pit laid between the first, as many as the patch is gathered — the
        // deepest of the three at a place is the one that shows
        "\tfloat pitSize = uPitSize;",
        "\tfloat pitCrowd = clamp( ( vExtra.z - 1.0 ) * 0.5, 0.0, 1.0 );",
        "\tif ( pitCrowd > 0.01 ) {",
        "\t\tvec4 p2 = fusePits( vFusePos + 3.7, uPitSize * 0.58, uPitJitter, pitCrowd * 1.2 );",
        "\t\tif ( p2.w > pf.w ) { pf = p2; pitSize = uPitSize * 0.58; }",
        "\t\tvec4 p3 = fusePits( vFusePos + 9.1, uPitSize * 0.34, uPitJitter, pitCrowd );",
        "\t\tif ( p3.w > pf.w ) { pf = p3; pitSize = uPitSize * 0.34; }",
        "\t}",
        "\tif ( pf.w > 0.0 ) {",
        "\t\tfloat dent = smoothstep( 0.0, max( 0.02, uPitSoft * 2.0 ), pf.w ) * vExtra.w;",
        "\t\tvec3 gt = pf.xyz - normal * dot( pf.xyz, normal );",
        "\t\tnormal = normalize( normal - uPitDepth * 2.0 * pitSize * gt * dent );",
        "\t\tdiffuseColor.rgb *= 1.0 - uPitDark * ( 0.35 + 0.65 * pf.w ) * dent;",
        "\t}",
        "}",
        "nonPerturbedNormal = normal;",
      ].join("\n"),
    )
    .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uGhost * vExtra.x * 0.5;");
}

/** The fused stone's material (V1's mass before the resin; V2 draws everything as resin). */
function makeStoneMaterial(u: FuseUniforms, fade?: FuseFade): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.userData.fuseU = u;
  m.onBeforeCompile = (shader) => patchFuseExtras(shader, u, fade);
  // (the two sides of the fade are two programs)
  m.customProgramCacheKey = () => `fuse-stone-${fade ? fade.side : "x"}`;
  return m;
}

/**
 * The resin's material: MeshPhysical whose vertex colours (the mass's stains, pits, darkening with age) are not
 * multiplied in as they are — that made the glass dirty — but normalised by the concrete's base grey, so a plain
 * surface leaves the resin colour as it is and only the deviations (pits, stains) show, by `shade` (0 = none).
 */
function makeResinMaterial(u: FuseUniforms, fade?: FuseFade): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, metalness: 0, vertexColors: true });
  const uShade: THREE.IUniform = { value: 0.5 };
  // the FROSTED SKIN (no refraction): a Fresnel rim — brighter where the surface turns away from the eye, as glass
  // does — on the opaque body; 0 = off
  const uRim: THREE.IUniform = { value: 0 };
  m.userData.uShade = uShade;
  m.userData.uRim = uRim;
  m.userData.fuseU = u;
  m.customProgramCacheKey = () => `fuse-resin-${fade ? fade.side : "x"}`;
  m.onBeforeCompile = (shader) => {
    patchFuseExtras(shader, u, fade);
    shader.uniforms.uShade = uShade;
    shader.uniforms.uRim = uRim;
    // THE FOSSIL AS BONE (boneLook.ts; the artist, 2026-11-20: "좀 더 '뼈' 같은 비주얼 재질로 어떻게 값싸게"): its colour
    // the bone's — the mass's own shading, stains and pits kept on it (what the resin's colour was multiplied by) —
    // and a fill of its own colour for the light that seems to come through it. Before the lights: the colour is lit.
    Object.assign(shader.uniforms, boneU);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${BONE_GLSL}`)
      .replace(
        "#include <emissivemap_fragment>",
        // (round the holes the fossil's going eats, a band where it is porous — the going's own noise, as FUSE_GONE_FRAG_BODY)
        "#include <emissivemap_fragment>\nif ( uBoneMass > 0.0 ) {\n\tfloat boneBand = 0.0;\n\tfloat boneGoneAt = vGone == 0.0 ? 0.0 : clamp( vGone + ( goneNoise( vGonePos / max( 0.5, uGrowDiePatch ) + 7.7 ) - 0.5 ) * 3.0 * uGrowDieRag, 0.0, 1.0 );\n\tif ( boneGoneAt > 0.001 ) {\n\t\tvec3 boneGP = vGonePos / max( 0.05, uGrowDieGrain );\n\t\tfloat boneGN = clamp( ( 0.65 * goneNoise( boneGP ) + 0.35 * goneNoise( boneGP * 2.7 + 11.3 ) - 0.5 ) * 1.9 + 0.5, 0.0, 0.999 );\n\t\tboneBand = 1.0 - smoothstep( 0.0, 0.14, boneGN - boneGoneAt );\n\t}\n\tdiffuseColor.rgb *= mix( 1.0, bonePattern( vFusePos, boneBand ), uBoneMass );\n\ttotalEmissiveRadiance += diffuseColor.rgb * uBoneFill * uBoneMass;\n}",
      )
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>${boneLight("uBoneMass")}`)
      // (what is inside showing through: everywhere by uSeeBase, more where a part lies right under the skin)
      .replace("#include <opaque_fragment>", "diffuseColor.a *= 1.0 - clamp( uSeeBase + uSeeParts * clamp( vExtra.x, 0.0, 1.0 ), 0.0, 0.95 );\n#include <opaque_fragment>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uShade;\nuniform float uRim;")
      .replace("#include <color_fragment>", "#if defined( USE_COLOR )\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), clamp( vColor.rgb / 0.42, 0.0, 1.2 ), uShade );\n#endif")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nif ( uRim > 0.0 ) {\n\tfloat fres = pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );\n\tgl_FragColor.rgb += uRim * fres;\n\tgl_FragColor.a = max( gl_FragColor.a, fres * 0.9 );\n}",
      );
  };
  return m;
}

/** Replaces the fused mesh's geometry (the old one is disposed). */
function setFused(mesh: THREE.Mesh | null, r: FuseMesh | null | undefined, was?: { mesh: THREE.Mesh | null; fade: { t: THREE.IUniform<number>; t0: number }; sec: number }, u?: FuseUniforms): void {
  if (!mesh || !r) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(r.normal, 3));
  g.setAttribute("color", new THREE.BufferAttribute(r.color, 3));
  g.setAttribute("fuseExtra", new THREE.BufferAttribute(r.extra, 4));
  // SEEDED (fuse.ts): the growing data — and the shader grows the mass only for a mesh that carries it
  const grows = !!(r.anchor && r.growA && r.growB);
  if (grows) {
    g.setAttribute("fuseAnchor", new THREE.BufferAttribute(r.anchor!, 3));
    g.setAttribute("fuseGrowA", new THREE.BufferAttribute(r.growA!, 4));
    g.setAttribute("fuseGrowB", new THREE.BufferAttribute(r.growB!, 2));
    // (the frame-first mark; none = all frame)
    g.setAttribute("fuseLate", new THREE.BufferAttribute(r.late && r.late.length * 3 === r.position.length ? r.late : new Float32Array(r.position.length / 3), 1));
    // (the worker's pending changes; none = no change: its clock far in the past)
    let blend = r.blend && r.blend.length * 3 === r.position.length * 4 ? r.blend : null;
    if (!blend) {
      blend = new Float32Array((r.position.length / 3) * 4);
      for (let v = 0; v < blend.length; v += 4) [blend[v], blend[v + 1], blend[v + 3]] = [1, -1e9, 1];
    }
    g.setAttribute("fuseBlend", new THREE.BufferAttribute(blend, 4));
    // (the vertices move in the shader: the mesh's bounds are not where it is drawn)
    mesh.frustumCulled = false;
  }
  if (u) u.uGrowOn.value = grows ? 1 : 0;
  // (readable from DevTools / a headless check, like `__perfSpans`: the growing data and the shader's numbers — how
  // far the mass is out of its parts can be worked out without looking)
  if (typeof window !== "undefined") (window as unknown as { __fuseGrow?: unknown }).__fuseGrow = grows && u ? { position: r.position, anchor: r.anchor, growA: r.growA, growB: r.growB, u } : null;
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  // group 0: opaque fused stone; group 1: resin (the oldest layers)
  g.addGroup(0, r.resinStart, 0);
  g.addGroup(r.resinStart, r.index.length - r.resinStart, 1);
  const old = mesh.geometry;
  mesh.geometry = g;
  // what it was goes on being drawn while the new comes in (the frame loop ends the fade and lets it go)
  if (was?.mesh && was.sec > 0 && (old.index?.count ?? 0) > 0) {
    was.mesh.geometry.dispose();
    was.mesh.geometry = old;
    was.mesh.visible = true;
    was.fade.t.value = 0;
    was.fade.t0 = performance.now();
  } else old.dispose();
}

/** Replaces a Points' geometry with the given buffers (the old one is disposed, freeing its GPU memory). */
/** Pre-layer look: line colour of walkways; the pipes' material (round tubes). */
interface WalkLook {
  walkColor: string;
  /** A free end's dot (px); opacity of the kept lines (below the present). */
  walkDot: number;
  walkKeptOpacity: number;
  /** A way just over the threshold against one as trodden as can be: its brightness and its opacity (1 = no difference). */
  walkUseDim: number;
  walkUseFade: number;
  pipeColor: string;
  pipeRoughness: number;
  pipeMetalness: number;
  /** Brightness of the kept pipes (below the present) against the live ones. */
  pipeKeptDim: number;
  /** Corrosion look: share of the wall eaten at full decay, decay at which holes begin, darkening, noise grain. */
  pipeHoles: number;
  pipeHoleOnset: number;
  pipeDarken: number;
  pipeGrain: number;
}

/**
 * THE OPEN WATER for the vegetation (the artist, 2026-11-15: "물길은 선으로 표현하기보다 식생 점이 닳는 걸로"): the
 * streams of every slot as the worker last laid them (SpaceResult.streams: segments at their slot's height), handed from
 * the scene to the Vegetation, which wears its points away along them.
 */
const waterNow: { segs: Float32Array } = { segs: new Float32Array(0) };

/** Line segments [a, b] × n into a line set. */
function setSegments(lines: THREE.LineSegments | null, segs: Float32Array): void {
  if (!lines) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(segs, 3));
  lines.geometry.dispose();
  lines.geometry = g;
}

/**
 * A WAY MORE USED IS BRIGHTER AND LESS SEE-THROUGH (the artist, 2026-11-12): per vertex, the walkway's use (the mean
 * path strength along it when it was laid, walkways.ts) from `buildAt` (just a way) to 1 (as trodden as can be) —
 * brightness from `dim` to 1, opacity from `fade` to 1 (× the material's own).
 */
function setSegmentUse(lines: THREE.LineSegments | null, use: Float32Array, buildAt: number, dim: number, fade: number): void {
  if (!lines) return;
  const n = use.length;
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = Math.max(0, Math.min(1, (use[i] - buildAt) / Math.max(1e-6, 1 - buildAt)));
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = dim + (1 - dim) * u;
    col[i * 4 + 3] = fade + (1 - fade) * u;
  }
  lines.geometry.setAttribute("color", new THREE.BufferAttribute(col, 4));
}

/** Free ends [x, y, z, weight] × n into a points cloud (positions only: the dot takes the line's colour). */
function setWalkEnds(pts: THREE.Points | null, ends: Float32Array): void {
  if (!pts) return;
  const n = Math.floor(ends.length / 4);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([ends[i * 4], ends[i * 4 + 1], ends[i * 4 + 2]], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pts.geometry.dispose();
  pts.geometry = g;
}
/** A round dot as a points sprite. */
function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.beginPath();
  x.arc(32, 32, 30, 0, Math.PI * 2);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const PIPE_CAPACITY = 12000;

/**
 * The pipes' material: a standard material that CORRODES per instance — `aDecay` (0 fresh … 1 gone) eats holes into
 * the wall (a hash noise on the surface, discarded below the decay, the holes' edges ragged) and darkens what is
 * left towards rust-grey (achromatic). Old pipes are perforated, the oldest nearly gone: the same clock as the parts.
 */
function corrodingPipeMaterial(color: THREE.ColorRepresentation, roughness: number, metalness: number, clock?: () => FossilClock): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  // (uUnit, uDepth: a slot's height and how many slots under its slot a pipe lies — its slot is read off its height)
  const u = { uHoles: { value: 0.95 }, uOnset: { value: 0.2 }, uDark: { value: 0.55 }, uGrain: { value: 23 }, uUnit: { value: 1 }, uDepth: { value: 0 } };
  m.userData.u = u;
  m.customProgramCacheKey = () => (clock ? "pipe-bone" : "pipe");
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    // A PIPE TURNS TO BONE (boneLook.ts; the artist, 2026-11-20: "둘 다 해"): as the mass round it fossilises — the
    // mass's ruler, read off where it lies — it is no longer eaten through but becomes bone, pores and all
    if (clock) Object.assign(shader.uniforms, pickClock(clock()), boneU);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aDecay;\nvarying float vDecay;\nvarying vec3 vWorldP;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvDecay = aDecay;\nvWorldP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vDecay;\nvarying vec3 vWorldP;\nuniform float uHoles, uOnset, uDark, uGrain, uUnit, uDepth;\nfloat pipeHash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\nfloat pipeNoise(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = mix(mix(pipeHash(i), pipeHash(i + vec3(1,0,0)), f.x), mix(pipeHash(i + vec3(0,1,0)), pipeHash(i + vec3(1,1,0)), f.x), f.y); float b = mix(mix(pipeHash(i + vec3(0,0,1)), pipeHash(i + vec3(1,0,1)), f.x), mix(pipeHash(i + vec3(0,1,1)), pipeHash(i + vec3(1,1,1)), f.x), f.y); return mix(a, b, f.z); }" + (clock ? `${BONE_GLSL}${FOSSIL_AT_GLSL}` : "\nconst float uBonePipes = 0.0;\nfloat fossilAt( float s ) { return 0.0; }\nfloat bonePattern( vec3 p, float b ) { return 1.0; }\nconst float uBoneFill = 0.0;"))
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\n// (a pipe is bone only once the mass round it is WHOLE — before that it is the pipe as it was, metal, corroding: the artist,\n// 2026-11-21, 관이랑 관의 화석화는 다른 거잖아; it used to start turning the moment its age counted, a little from the first slots)\nfloat pipeF = smoothstep(0.9, 1.0, fossilAt(vWorldP.y / max(1e-4, uUnit) + uDepth)) * uBonePipes;\n// holes: fine noise, more of it eaten as the pipe decays; before the onset only tarnish — none once it is bone\nfloat pn = 0.6 * pipeNoise(vWorldP * uGrain) + 0.4 * pipeNoise(vWorldP * uGrain * 2.65);\nfloat eat = smoothstep(uOnset, 1.0, vDecay);\nfloat pipeEat = eat * uHoles * (1.0 - 0.6 * pipeF);\nif (pn < pipeEat) discard;",
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uDark * vDecay * (1.0 - pipeF);\nif (pipeF > 0.0) diffuseColor.rgb *= mix(1.0, bonePattern(vWorldP, pipeEat > 0.0 ? 1.0 - smoothstep(0.0, 0.1, pn - pipeEat) : 0.0), pipeF);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - pipeF;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, pipeF);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uBoneFill * pipeF;")
      .replace("#include <lights_fragment_end>", clock ? `#include <lights_fragment_end>${boneLight("pipeF")}` : "#include <lights_fragment_end>");
  };
  return m;
}

/**
 * Uploads only the first `n` items of an instanced attribute. With n = 0 nothing is uploaded: an update range of length
 * 0 reaches WebGL2's bufferSubData as "to the end", i.e. the WHOLE capacity — the empty wall sent ~35 MB to the GPU twice
 * a second this way, and the main thread stalled on it for as long as the GPU took to draw the frame (2026-10-29).
 */
function uploadFirst(attr: THREE.BufferAttribute, n: number): void {
  if (n <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

function setDecay(mesh: THREE.InstancedMesh | null, src: Float32Array, stride: number, count: number): void {
  if (!mesh) return;
  let attr = mesh.geometry.getAttribute("aDecay") as THREE.InstancedBufferAttribute | undefined;
  if (!attr || attr.count < PIPE_CAPACITY) {
    attr = new THREE.InstancedBufferAttribute(new Float32Array(PIPE_CAPACITY), 1);
    mesh.geometry.setAttribute("aDecay", attr);
  }
  for (let i = 0; i < count; i++) attr.array[i] = src[i * stride + stride - 1];
  uploadFirst(attr, count);
}
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _q = new THREE.Quaternion(), _sc = new THREE.Vector3(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
/**
 * Straight cylinders [a, b, r] × n into an instanced unit cylinder (y-axis, height 1); elbows into an instanced quarter
 * torus (centreline radius ELBOW, tube 1, its arc from local +x to local +y) turned so its arms point along the two
 * given directions; fittings [x, y, z, r] × m into spheres.
 */
function setPipeParts(cyl: THREE.InstancedMesh | null, elbow: THREE.InstancedMesh | null, p: PipeParts): void {
  if (elbow) {
    const n = Math.min(PIPE_CAPACITY, p.elbows.length / 11);
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      _mid.set(p.elbows[o], p.elbows[o + 1], p.elbows[o + 2]);
      _a.set(p.elbows[o + 3], p.elbows[o + 4], p.elbows[o + 5]);
      _b.set(p.elbows[o + 6], p.elbows[o + 7], p.elbows[o + 8]);
      _n.crossVectors(_a, _b);
      const r = p.elbows[o + 9];
      _m.makeBasis(_a, _b, _n).scale(_sc.set(r, r, r)).setPosition(_mid);
      elbow.setMatrixAt(i, _m);
    }
    elbow.count = n;
    uploadFirst(elbow.instanceMatrix, n);
    setDecay(elbow, p.elbows, 11, n);
  }
  if (cyl) {
    const n = Math.min(PIPE_CAPACITY, p.cylinders.length / 8);
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      _dir.set(p.cylinders[o + 3] - p.cylinders[o], p.cylinders[o + 4] - p.cylinders[o + 1], p.cylinders[o + 5] - p.cylinders[o + 2]);
      const L = _dir.length() || 1e-6;
      _mid.set((p.cylinders[o] + p.cylinders[o + 3]) / 2, (p.cylinders[o + 1] + p.cylinders[o + 4]) / 2, (p.cylinders[o + 2] + p.cylinders[o + 5]) / 2);
      _q.setFromUnitVectors(_up, _dir.multiplyScalar(1 / L));
      const r = p.cylinders[o + 6];
      _sc.set(r, L, r);
      cyl.setMatrixAt(i, _m.compose(_mid, _q, _sc));
    }
    cyl.count = n;
    uploadFirst(cyl.instanceMatrix, n);
    setDecay(cyl, p.cylinders, 8, n);
  }
}

function setPoints(pts: THREE.Points | null, r: PointsResult | null | undefined): void {
  if (!pts || !r) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
  g.setAttribute("color", new THREE.BufferAttribute(r.color, 3));
  pts.geometry.dispose();
  pts.geometry = g;
}

const GATHER_CAPACITY = 60000;

/**
 * The cloud of one gathering: `count` points inside a unit ball, dense at the centre and thinning out to its edge (a
 * Gaussian falloff), so from afar it reads as a soft lump and up close as an electron cloud. Deterministic.
 */
function cloudOffsets(count: number): Float32Array {
  let st = 0x9e3779b9;
  const rnd = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = gauss() * 0.42, y = gauss() * 0.42, z = gauss() * 0.42;
    const l = Math.hypot(x, y, z);
    const k = l > 1 ? 1 / l : 1; // the few beyond the ball sit on its rim
    out[i * 3] = x * k;
    out[i * 3 + 1] = y * k;
    out[i * 3 + 2] = z * k;
  }
  return out;
}

/** Per-gathering data shared by every cloud geometry (centre and colour, instanced). */
function gatherAttributes(): { center: THREE.InstancedBufferAttribute; color: THREE.InstancedBufferAttribute } {
  return {
    center: new THREE.InstancedBufferAttribute(new Float32Array(GATHER_CAPACITY * 3), 3),
    color: new THREE.InstancedBufferAttribute(new Float32Array(GATHER_CAPACITY * 3), 3),
  };
}

/** One cloud of `count` points, drawn once per gathering (instanced). */
function cloudGeometry(count: number, at: ReturnType<typeof gatherAttributes>): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(cloudOffsets(count), 3));
  g.setAttribute("iCenter", at.center);
  g.setAttribute("color", at.color);
  g.instanceCount = 0;
  return g;
}

/**
 * The material of the gathering clouds: the fading points' material, each point placed at its gathering's centre +
 * its offset × the cloud's radius (jittered per gathering by a hash of the centre, and turned by it, so no two clouds
 * repeat), a little lighter on top.
 */
function cloudPointsMaterial(): THREE.PointsMaterial {
  const m = fadingPointsMaterial();
  const cloud = { uRadius: { value: 0.15 } };
  m.userData.cloud = cloud;
  const fade = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    fade(shader, renderer);
    Object.assign(shader.uniforms, cloud);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 iCenter;\nuniform float uRadius;")
      .replace(
        "#include <begin_vertex>",
        [
          "float hA = fract(sin(dot(iCenter, vec3(12.9898, 78.233, 37.719))) * 43758.5453);",
          "float hB = fract(sin(dot(iCenter, vec3(39.346, 11.135, 83.155))) * 24634.6345);",
          "float rad = uRadius * max(0.05, 1.0 + uJitter * (hA * 2.0 - 1.0));",
          "float ca = cos(hB * 6.2832), sa = sin(hB * 6.2832);",
          "vec3 off = vec3(ca * position.x - sa * position.z, position.y, sa * position.x + ca * position.z);",
          "vec3 transformed = iCenter + off * rad;",
        ].join("\n"),
      )
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb *= 0.82 + 0.22 * position.y;")
      // the per-point size jitter of the fading material does not apply here (the cloud's radius is jittered)
      .replace(/gl_PointSize \*= max\(0\.05, 1\.0 \+ uJitter[^;]*;/, "");
  };
  m.customProgramCacheKey = () => "gather-cloud";
  return m;
}

function setInstanceCount(g: THREE.InstancedBufferGeometry, n: number): void {
  g.instanceCount = n;
}

/** Writes the gatherings (centres, colours) into the instanced attributes (shared by every cloud geometry). */
function setGatherings(g: THREE.InstancedBufferGeometry | null, r: PointsResult): void {
  if (!g) return;
  const at = { center: g.getAttribute("iCenter") as THREE.InstancedBufferAttribute, color: g.getAttribute("color") as THREE.InstancedBufferAttribute };
  const n = Math.min(r.position.length / 3, GATHER_CAPACITY);
  (at.center.array as Float32Array).set(r.position.subarray(0, n * 3));
  (at.color.array as Float32Array).set(r.color.subarray(0, n * 3));
  for (const a of [at.center, at.color]) uploadFirst(a, n);
  g.instanceCount = n;
}

/** Where the space computation runs: a Web Worker, or (if the worker cannot start) the main thread. */
interface SpaceRunner {
  post: (m: SpaceRequest) => void;
  stop: () => void;
  mode: "worker" | "main thread";
  /** The log as the model is given it, for the worker the ways are laid in (side.worker.ts); absent = none. */
  log?: (m: Extract<SpaceRequest, { type: "events" }>) => void;
}

/** WHERE A PIECE'S TIME GOES (the status line; UnitStats.stageMs): the stages of a piece, mean ms, in the order they run. */
function fossilStageLine(s: UnitStats): string {
  const m = s.stageMs;
  if (!m) return "";
  const names: [string, string][] = [["field", "장"], ["blur", "블러"], ["shell", "껍질·거품"], ["nets", "표면"], ["quads", "면"], ["smooth", "다듬기"], ["finish", "마무리"], ["merge", "합침"], ["grow", "자람"], ["place values", "└자리값"], ["transfer", "전송"]];
  const parts = names.filter(([k]) => (m[k] ?? 0) >= 0.5).map(([k, l]) => `${l} ${Math.round(m[k])}`);
  if (!parts.length) return "";
  return ` · 조각 단계(ms) ${parts.join(" · ")}${s.samples ? ` · 격자 ${Math.round(s.samples / 1000)}k샘플` : ""}`;
}

/** WHAT STANDS ON THE SCREEN AND HOW IT GOT THERE (the status line; Stats.fuseScene / fuseUpload): counted on this thread. */
function fossilSceneLine(st: Stats): string {
  const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
  let out = "";
  if (st.fuseScene) out += ` · 화면: 청크 ${st.fuseScene.chunks} · 정점 ${k(st.fuseScene.verts)} · △ ${k(st.fuseScene.tris)}${st.fuseSide?.pieces !== undefined ? ` · 조각 ${st.fuseSide.pieces}` : ""}${st.fuseSide?.simplified ? ` · 삼각형 줄인 청크 ${st.fuseSide.simplified}` : ""}`;
  const u = st.fuseUpload;
  if (u && u.n) out += ` · 올리기: 전송 ${Math.round(u.transferMs)} · 적용 ${Math.round(u.applyMs)} (최대 ${Math.round(u.applyMax)}) · 첫 그리기 ${Math.round(u.drawMs)} (최대 ${Math.round(u.drawMax)}) ms`;
  return out;
}

/** The same protocol on the main thread (fallback): results come back on the next task, like a worker's. */
function mainThreadRunner(onResult: (r: SpaceResponse) => void): SpaceRunner {
  const model = new SpaceModel();
  let alive = true;
  return {
    mode: "main thread",
    post: (m) => {
      const r = handleSpaceRequest(model, m);
      if (r) setTimeout(() => alive && onResult(r.out), 0);
    },
    stop: () => {
      alive = false;
    },
  };
}

/**
 * The world of the timespace: parts (one InstancedMesh per kind), vegetation and plants on ruins. Everything is
 * computed in a Web Worker (space.worker.ts → lib/parliament/spaceModel.ts); this component only sends the new events
 * and a compute request every TICK_MS (wall clock, also in a hidden tab), and copies each result into its meshes.
 * Level of detail: seeds within `lodNear` of the camera get every part, up to `lodMid` thinned slat bundles without
 * drips, beyond that solid masses (spaceModel LodConfig); vegetation thins out with distance down to `farFactor`.
 */
function SpaceWorld({
  log,
  fold,
  boxCfg,
  showEdges,
  wear,
  follow,
  followLift,
  link,
  followWho,
  quietSec,
  controls,
  onStats,
  nature,
  lodNear,
  lodMid,
  pointsInRefraction,
  farFactor,
  weather,
  fuse,
  immutable,
  bake,
  resin,
  water,
  nearFade,
  noAxis,
  walk,
  density,
  pathLook,
  walkLook,
  partColors,
  arrive,
  clock,
  local,
  takenEpochMs = 0,
  fuseWorkers = 1,
  uploadMB = 0,
  fossilSimplify = 0,
}: {
  /** MB of new geometry of the mass put on the screen per frame (렌더 › 작업 분담); 0 = all of a message at once. */
  uploadMB?: number;
  /** The share of triangles taken off the fossil's settled chunks (렌더 › 작업 분담); 0 = none. */
  fossilSimplify?: number;
  /** How many workers make the pieces of the mass side by side (렌더 › 작업 분담); 1 = the worker of the mass alone. */
  fuseWorkers?: number;
  log: EventLog;
  /** The clock this view runs on (rate 0 = paused: the view is pinned and settings apply at once). */
  clock: Clock;
  /** A world of this tab only (the lab): its present is the log's end moved on by `clock`, not the shared epoch's. */
  local: boolean;
  /** …and, when that world was TAKEN from the wall's (useLabWorld.ts), the epoch it came with: its present is then
   *  counted as the wall counts its own — the lab's clock against that epoch. 0 = a world begun here. */
  takenEpochMs?: number;
  fold: FoldConfig;
  boxCfg: BoxConfig;
  showEdges: boolean;
  /** Wear the parts to the present (the fold's slab wear); off = everything as built. */
  wear: boolean;
  follow: boolean;
  /** Added to the followed height (the exhibition camera's "초점 높이"): the view looks a little above or below the present. */
  followLift: number;
  /** The exhibition camera's auto run: its lift replaces `followLift` while it runs; the focus height goes back to it. */
  link?: React.MutableRefObject<CamLink>;
  /** Whom the present follows: the player tab's own owner ("me"), the latest event of anybody (bots included), or
   * "auto" — me unless me has been quiet for `quietSec` exhibition seconds (the wall with only bots running, and a
   * stale me id left in storage, used to stand still at me's last moment — the artist, 2026-10-30). */
  followWho: FollowWho;
  quietSec: number;
  controls: React.MutableRefObject<Orbit | null>;
  onStats: (s: Stats) => void;
  nature: NatureParams | null;
  lodNear: number;
  /** Seeds between lodNear and this get thinned slat bundles; beyond, solid masses (spaceModel LodConfig.mid). */
  lodMid: number;
  /**
   * Whether the vegetation points are drawn into the resin's refraction (they are the bulk of what the transmission
   * pass re-renders every frame). Off: the points are drawn as transparent (after the resin, not through it) and the
   * refraction pass costs a fraction.
   */
  pointsInRefraction: boolean;
  farFactor: number;
  weather: WeatherConfig;
  /** Old layers fused into one mass. */
  fuse: FuseConfig;
  /** V2: the immutable layer begins this many slots below the present (baked as it is, final). */
  immutable: number;
  /** V2: whether anything is baked at all (false = the history window alone). */
  bake: boolean;
  /** Look of the resin (oldest) layers. */
  resin: ResinLook;
  /** Waterways between buildings the same people built (null = off). */
  water: WaterConfig | null;
  /** Vegetation within this view distance [start, end] dissolves (keeps the view clear). */
  nearFade: [number, number];
  /** V2: no time axis drawn (the timespace floats, without ground or axis). */
  noAxis: boolean;
  /** V2: walkways between buildings (walkways.ts); null = none. */
  walk: WalkConfig | null;
  /** Buildings from the density of spacetime (density.ts); null = from the fold, as before. */
  density: DensityConfig | null;
  /** The paths' lines (density.ts pathLines): the slope they may rise at, their grey and opacity; null = none. */
  pathLook: { rise: number; smooth: number; shade: number; opacity: number } | null;
  walkLook: WalkLook;
  /** Each kind of part's colour (the folder 건물 부재의 색); absent = KIND_COLOR. */
  partColors?: Record<PartKind, string>;
  /** How a part that was just built comes in (lib/parliament/arriveMaterial.ts); `on` false = it is simply there. */
  arrive: { on: boolean; sec: number; stagger: number; way: ArriveWay; lift: number; tick: number; leave?: number };
}) {
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  // ARRIVAL (lib/parliament/arriveMaterial.ts): every part's instance carries when it was first there (`aBorn`, from the model);
  // the parts' shader (and their shadows') brings it in — per frame only this time uniform moves
  const arriveU = useMemo(() => makeArriveUniforms(), []);
  const arriveShader = useMemo(() => arriveCompile(arriveU), [arriveU]);
  const arriveDepth = useMemo(() => arriveDepthMaterial(arriveU), [arriveU]);
  const arriveEpoch = useRef(0);
  useEffect(() => () => arriveDepth.dispose(), [arriveDepth]);
  useEffect(() => setArrive(arriveU, arrive), [arriveU, arrive]);
  useFrame(() => {
    arriveU.uArriveNow.value = (Date.now() - arriveEpoch.current) / 1000;
  });
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
  const pipeLive = useRef<THREE.InstancedMesh>(null);
  const pipeKept = useRef<THREE.InstancedMesh>(null);
  const elbowLive = useRef<THREE.InstancedMesh>(null);
  const elbowKept = useRef<THREE.InstancedMesh>(null);
  // vegetation gathering on buildings: one point cloud per gathering (instanced); the cloud is rebuilt when its point
  // count changes, the gatherings stay in the shared attributes
  const gatherAt = useMemo(() => gatherAttributes(), []);
  const gatherCount = useRef(0);
  const cloudPts = nature?.gatherPoints ?? 24;
  const gatherGeom = useMemo(() => cloudGeometry(cloudPts, gatherAt), [cloudPts, gatherAt]);
  const gatherGeomRef = useRef<THREE.InstancedBufferGeometry | null>(null);
  useEffect(() => {
    setInstanceCount(gatherGeom, gatherCount.current);
    gatherGeomRef.current = gatherGeom;
    return () => gatherGeom.dispose();
  }, [gatherGeom]);
  const gatherMat = useMemo(() => cloudPointsMaterial(), []);
  // THE PATHS' LINES (density.ts pathLines): achromatic, as every trace of people
  const pathCap = useRef(0);
  const pathGeom = useMemo(() => new THREE.BufferGeometry(), []);
  const pathMat = useMemo(() => new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }), []);
  useEffect(() => {
    pathMat.color.setScalar(pathLook?.shade ?? 0.9);
    pathMat.opacity = pathLook?.opacity ?? 0.9;
  }, [pathMat, pathLook?.shade, pathLook?.opacity]);
  useEffect(() => () => pathGeom.dispose(), [pathGeom]);
  useEffect(() => () => pathMat.dispose(), [pathMat]);
  const focusY = useRef<number | null>(null);
  const snapped = useRef(false);
  const worker = useRef<SpaceRunner | null>(null);
  /** The worker of the mass (side.worker.ts, "fuse"), for its pool of helpers; null = none (the model makes the mass). */
  const fuseSide = useRef<Worker | null>(null);
  const helperIds = useRef(0);
  const sent = useRef(0);
  const inFlight = useRef<{ id: number; at: number } | null>(null);
  /** The lab's present: the log's end when first seen, moved on by the lab's own clock since. */
  const labAnchor = useRef<{ ms: number; s: number } | null>(null);
  const lastEpoch = useRef<string | null | undefined>(undefined);
  /** The camera and focus the last request used; kept while time stands still (see the ticker). */
  const pinned = useRef<{ cam: [number, number, number]; focusK: number } | null>(null);
  /** Paused: what the vegetation was last asked with (it is asked again only when this changes). */
  const lastNatSig = useRef("");
  const seq = useRef(0);
  const focus = useRef({ focusS: 0, focusIsMe: false });
  const last = useRef<Stats | null>(null);
  const fuseStats = useRef<{ fuseTris: number; fuseResin: number; fuseOut?: number; fuseOutMean?: number; fuseSide?: UnitStats; fuseUpload?: FuseUpload; fuseScene?: { chunks: number; verts: number; tris: number } }>({ fuseTris: 0, fuseResin: 0 });
  /** The chunks' way onto the screen since the last message (Stats.fuseUpload): summed, and how many. */
  const uploadAcc = useRef({ transfer: 0, nTransfer: 0, apply: 0, applyMax: 0, n: 0, draw: 0, drawMax: 0, nDraw: 0 });
  const tallyScene = () => {
    let verts = 0, tris = 0;
    for (const mm of chunkMeshes.current.values()) {
      const g = mm.geometry;
      verts += g.getAttribute("position")?.count ?? 0;
      tris += (g.index?.count ?? 0) / 3;
    }
    fuseStats.current = { ...fuseStats.current, fuseScene: { chunks: chunkMeshes.current.size, verts, tris } };
  };
  // (the chunks' geometry goes with the view: nothing of the mass is left on the GPU when it unmounts)
  useEffect(
    () => () => {
      for (const mm of chunkMeshes.current.values()) mm.geometry.dispose();
      chunkMeshes.current.clear();
    },
    [],
  );
  // THE MASS MADE IN THE WORKER BESIDE (fuseUnits.ts): a mesh per chunk of the space, each replaced on its own when a
  // piece in it is done; and the moment that worker's clock began (null = the mass comes from the model's worker)
  const chunkGroup = useRef<THREE.Group>(null);
  const chunkMeshes = useRef(new Map<string, THREE.Mesh>());
  const chunkClock0 = useRef<number | null>(null);
  /** The chunks of the mass waiting for a frame (applyChunks), and the clock their worker began at. */
  const chunkOps = useRef<({ kind: "set"; id: string; mesh: FuseMesh | null } | { kind: "drop"; id: string } | { kind: "clearRest"; keep: Set<string> })[]>([]);
  const chunkClockAt = useRef(0);
  /** Bytes of new geometry of the mass put on the screen per frame (렌더 › 작업 분담); 0 = all of a message at once. */
  const uploadBudget = useRef(0);
  uploadBudget.current = Math.max(0, uploadMB) * 1e6;
  const workerBuild = useRef("");
  // HOW FAR THE MASS IS OUT OF ITS PARTS (the readout): the shader's own sum on a sample of the vertices, once a
  // second — the artist, 2026-11-16: "아직 뭐가 보이질 않아서 … 피드백을 못 주겠는데"
  const growSeen = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - growSeen.current < 1000) return;
    growSeen.current = now;
    // (the mass made in the model's worker is one mesh; the mass made in the worker beside, a mesh per chunk of the space)
    const geoms = [fused.current?.geometry, ...[...chunkMeshes.current.values()].map((m) => m.geometry)].filter((g): g is THREE.BufferGeometry => !!g?.getAttribute("fuseGrowA"));
    if (!geoms.length || fuseU.uGrowOn.value < 0.5) {
      fuseStats.current.fuseOut = -1;
      return;
    }
    const U = fuseU;
    let all = 0;
    for (const g of geoms) all += g.getAttribute("fuseGrowA").count;
    const stepV = Math.max(1, Math.floor(all / 4000));
    let out = 0, sum = 0, n = 0;
    for (const g of geoms) {
      const A = g.getAttribute("fuseGrowA").array as Float32Array, B = g.getAttribute("fuseGrowB").array as Float32Array;
      const L = g.getAttribute("fuseLate")?.array as Float32Array | undefined;
      const P = g.getAttribute("position")?.array as Float32Array | undefined, N = g.getAttribute("fuseAnchor")?.array as Float32Array | undefined;
      const nv = A.length / 4;
      for (let v = 0; v < nv; v += stepV) {
        n++;
        if (B[v * 2 + 1] < 0) continue;
        // (as the shader: one ruler — the age, slowed by the depth, a little sooner or later part by part)
        const depth = (U.uGrowTop.value - (A[v * 4] + 0.5)) / Math.max(1, U.uGrowHeight.value);
        const age = U.uGrowTop.value + U.uGrowStood.value - A[v * 4 + 1] - U.uGrowAfter.value;
        const ruler = age * Math.max(0.2, A[v * 4 + 3]) * (1 - U.uGrowDeep.value * (1 - Math.max(0, Math.min(1, depth))));
        const layer = Math.max(0, Math.min(1, ruler / Math.max(1, U.uGrowAgeSpan.value)));
        const aged = Math.max(0, Math.min(1, age / Math.max(0.1, U.uGrowOver.value)));
        const shown = Math.max(0, Math.min(1, (U.uGrowClock.value - B[v * 2]) / Math.max(0.01, U.uGrowAppear.value)));
        const kept = Math.max(0, Math.min(1, (A[v * 4] - U.uGrowFloor.value) * 0.5));
        // (as the shader: the fossil's life, and the filling waits behind the frame)
        const gone = U.uGrowDie.value * Math.max(0, Math.min(1, (ruler - U.uGrowDieAfter.value) / Math.max(1, U.uGrowDieSpan.value)));
        const time = layer * aged * shown * kept * (1 - gone * (1 - U.uGrowDieHoles.value));
        const yIn = A[v * 4] + 0.5 - Math.floor(A[v * 4] + 0.5);
        const lateV = L ? L[v] : 0, frameSpan = U.uGrowLate.value > 0.05 ? U.uGrowLate.value : 1;
        // (as the shader: the filling waits behind the frame, and the surface the longer the farther from its part)
        const ox = P && N ? P[v * 3] - N[v * 3] : 0, oy = P && N ? P[v * 3 + 1] - N[v * 3 + 1] : 0, oz = P && N ? P[v * 3 + 2] - N[v * 3 + 2] : 0;
        const far = Math.max(0, Math.min(1, (Math.hypot(ox, oy, oz) + Math.max(0, -oy)) / Math.max(0.1, U.uGrowReach.value)));
        const wait = Math.max(U.uGrowLate.value * lateV * (1 - U.uGrowRise.value + U.uGrowRise.value * yIn), U.uGrowMelt.value * far);
        const f = Math.max(0, Math.min(1, (time - wait) / Math.max(0.05, Math.min(frameSpan + (1 - wait - frameSpan) * lateV, 1 - wait)))) * B[v * 2 + 1];
        if (f >= 0.02) out++;
        sum += f;
      }
    }
    fuseStats.current.fuseOut = n ? out / n : 0;
    fuseStats.current.fuseOutMean = n ? sum / n : 0;
  });
  const stageMax = useRef<{ ms: number; at: number; stages: Record<string, number> }>({ ms: 0, at: 0, stages: {} });
  // the ticker reads the latest props through this ref
  const live = useRef({ fold, boxCfg, showEdges, wear, nature, lodNear, lodMid, farFactor, weather, fuse, immutable, bake, water, noAxis, walk, density, pathLook, onStats, resin });
  const walkLive = useRef<THREE.LineSegments>(null);
  const walkKept = useRef<THREE.LineSegments>(null);
  // how used each walkway is (per vertex), and its look applied (again when the look's knobs turn)
  const walkUse = useRef<{ live: Float32Array; kept: Float32Array } | null>(null);
  const walkUseLook = useRef({ buildAt: 0.45, dim: 1, fade: 1 });
  walkUseLook.current = { buildAt: walk?.buildAt ?? 0.45, dim: walkLook.walkUseDim, fade: walkLook.walkUseFade };
  const applyWalkUse = useCallback(() => {
    const u = walkUse.current, l = walkUseLook.current;
    if (!u) return;
    setSegmentUse(walkLive.current, u.live, l.buildAt, l.dim, l.fade);
    setSegmentUse(walkKept.current, u.kept, l.buildAt, l.dim, l.fade);
  }, []);
  useEffect(() => applyWalkUse(), [applyWalkUse, walk?.buildAt, walkLook.walkUseDim, walkLook.walkUseFade]);
  const endLive = useRef<THREE.Points>(null);
  const endKept = useRef<THREE.Points>(null);
  // (the ways' lines turning to bone: the mass's ruler and a slot's height — boneLook.ts)
  const wayBone = useMemo(() => wayBoneShader(() => fuseU, () => live.current.boxCfg.unit), []);
  const dotTex = useMemo(() => dotTexture(), []);
  useEffect(() => () => dotTex.dispose(), [dotTex]);
  useEffect(() => {
    live.current = { fold, boxCfg, showEdges, wear, nature, lodNear, lodMid, farFactor, weather, fuse, immutable, bake, water, noAxis, walk, density, pathLook, onStats, resin };
  });
  const fused = useRef<THREE.Mesh>(null);
  const keptPipeColor = useMemo(() => new THREE.Color(walkLook.pipeColor).multiplyScalar(walkLook.pipeKeptDim), [walkLook.pipeColor, walkLook.pipeKeptDim]);
  const pipeMats = useMemo(
    // (the kept pipes — below the present — turn to bone with the mass: boneLook.ts; the mass's uniforms are read when
    // the material is first drawn)
    () => ({ live: corrodingPipeMaterial(walkLook.pipeColor, walkLook.pipeRoughness, walkLook.pipeMetalness), kept: corrodingPipeMaterial(keptPipeColor, walkLook.pipeRoughness, walkLook.pipeMetalness, () => fuseU) }),
    [walkLook.pipeColor, keptPipeColor, walkLook.pipeRoughness, walkLook.pipeMetalness],
  );
  useEffect(() => () => { pipeMats.live.dispose(); pipeMats.kept.dispose(); }, [pipeMats]);
  useEffect(() => {
    for (const m of [pipeMats.live, pipeMats.kept]) {
      const u = m.userData.u as { uHoles: { value: number }; uOnset: { value: number }; uDark: { value: number }; uGrain: { value: number } };
      u.uHoles.value = walkLook.pipeHoles;
      u.uOnset.value = walkLook.pipeHoleOnset;
      u.uDark.value = walkLook.pipeDarken;
      u.uGrain.value = walkLook.pipeGrain;
      const ub = m.userData.u as { uUnit: { value: number }; uDepth: { value: number } };
      ub.uUnit.value = boxCfg.unit;
      ub.uDepth.value = water?.pipeDepth ?? 0;
    }
  }, [pipeMats, walkLook.pipeHoles, walkLook.pipeHoleOnset, walkLook.pipeDarken, walkLook.pipeGrain, boxCfg.unit, water?.pipeDepth]);
  const fuseU = useMemo<FuseUniforms>(() => makeFuseUniforms(), []);
  // THE MASS GROWS OUT OF ITS PARTS (fuse.ts seeded): what the shader makes each part's progress of — the window's
  // top from the bots' own clock, every frame (the model's own is in quarters of a slot), and the erosion's and the
  // fusion's knobs as they stand
  useFrame(() => {
    const er = weather.erode;
    if (!er) return;
    const slotSec = Math.max(1, er.slotSec ?? boxCfg.secPerUnit), shift = Math.max(0, er.shift ?? 0);
    const perTop = shift > 0 ? slotSec / shift : slotSec;
    const w = botGround.window?.();
    fuseU.uGrowTop.value = w && w.shift > 0 ? Math.max(er.height ?? 0, w.top / slotSec) : er.topSlot;
    // (the rise stopped — rise.ts: what stands in the window goes on ageing, the fossil with it. The clock the model
    // stamped each part's building with: erode.ts stood — every frame here, in quarters of a slot there)
    fuseU.uGrowStood.value = w && w.shift > 0 ? Math.max(0, w.stood ?? 0) / slotSec : Math.max(0, er.stood ?? 0);
    fuseU.uGrowHeight.value = Math.max(1, er.height ?? er.topSlot);
    fuseU.uGrowStart.value = er.start;
    fuseU.uGrowFull.value = er.full;
    fuseU.uGrowVegPull.value = er.vegPull;
    fuseU.uGrowLifeTop.value = Math.max(1e-3, (er.lifeSec ?? 0) / perTop);
    fuseU.uGrowWaitTop.value = Math.max(0, (er.waitSec ?? 0) / perTop);
    // (a part's fossil begins once every cell-slot of its age is surely simplified — the latest of them, 1.3 of the
    // time — and a slot more for its mass to have been made; then it comes out over three slots)
    // (the same wait with the simplification off: erode fossilSec)
    fuseU.uGrowAfter.value = (fossilWaitSec(er) * 1.3) / perTop + 1;
    fuseU.uGrowOver.value = 3;
    // (the stamps of the pieces made in the worker beside are seconds of ITS clock; a mass made in the model's worker
    // has none — it is whole as it comes)
    fuseU.uGrowClock.value = chunkClock0.current === null ? 1e9 : (Date.now() - chunkClock0.current) / 1000;
    fuseU.uGrowThin.value = Math.max(0, resin.growThin ?? 0.6);
    // (the fossil's knobs are minutes of the clock; its ruler is slots of the top's way — perTop seconds each)
    fuseU.uGrowAgeSpan.value = Math.max(1, (Math.max(0, resin.growAgeMin ?? 2.5) * 60) / perTop);
    fuseU.uGrowDeep.value = Math.max(0, Math.min(1, resin.growDeep ?? 0.6));
    fuseU.uGrowMelt.value = Math.max(0, Math.min(0.9, resin.growMelt ?? 0.6));
    fuseU.uGrowReach.value = Math.max(0.1, resin.growReach ?? 2);
    fuseU.uGrowPress.value = Math.max(0, Math.min(1, resin.growPress ?? 1));
    fuseU.uGrowSeal.value = Math.max(0, Math.min(1, resin.growSeal ?? 0));
    fuseU.uGrowSealGrain.value = Math.max(0.05, resin.growSealGrain ?? 0.8);
    fuseU.uGrowCap.value = resin.growCap === false ? 0 : 1;
    // (THE FOSSIL IN STAGES: the mesh is the stage's real shape — drawn whole; a change is put on at once, the worker
    // staggering it from the bottom up; no edge holes)
    const stagesOn = (fuse.stageN ?? 0) > 0;
    fuseU.uGrowStages.value = stagesOn ? 1 : 0;
    fuseU.uGrowBlend.value = stagesOn ? 0.02 : FUSE_BLEND_S;
    if (stagesOn) fuseU.uGrowSeal.value = 0;
    fuseU.uGrowLate.value = Math.max(0, Math.min(0.9, resin.growLate ?? 0));
    fuseU.uGrowRise.value = Math.max(0, Math.min(1, resin.growRise ?? 0));
    // (the fossil's life: off unless the look says so — a look without the knobs is the fossil as it was)
    fuseU.uGrowDie.value = resin.growDie ? 1 : 0;
    fuseU.uGrowDieAfter.value = (Math.max(0, resin.growDieAfterMin ?? 5.5) * 60) / perTop;
    fuseU.uGrowDieSpan.value = Math.max(1, (Math.max(0, resin.growDieSpanMin ?? 8.5) * 60) / perTop);
    fuseU.uGrowDieHoles.value = Math.max(0, Math.min(1, resin.growDieHoles ?? 0));
    fuseU.uGrowDieGrain.value = Math.max(0.05, resin.growDieGrain ?? 1.2);
    fuseU.uGrowDieRag.value = Math.max(0, resin.growDieRag ?? 0);
    fuseU.uGrowDiePatch.value = Math.max(0.5, resin.growDiePatch ?? 9);
    // (what the window lets go of at its foot goes back into its parts — only while the window RISES: where its top
    // stands nothing leaves at the foot, and the oldest layers keep their fossil)
    fuseU.uGrowFloor.value = shift > 0 && er.height && !w?.still ? fuseU.uGrowTop.value - er.height - Math.max(0, er.tail ?? 0) : -1e9;
  });
  // (the mass changes softly: what it is, and what it was — two sets of the same materials, one fade between them)
  const fuseFade = useMemo(() => ({ t: { value: 1 } as THREE.IUniform<number>, t0: 0 }), []);
  const fusedWas = useRef<THREE.Mesh>(null);
  const fadeSec = useRef(0);
  fadeSec.current = Math.max(0, resin.fadeSec ?? 0);
  const stoneMat = useMemo(() => makeStoneMaterial(fuseU, { t: fuseFade.t, side: 0 }), [fuseU, fuseFade]);
  const resinMat = useMemo(() => makeResinMaterial(fuseU, { t: fuseFade.t, side: 0 }), [fuseU, fuseFade]);
  const stoneWas = useMemo(() => makeStoneMaterial(fuseU, { t: fuseFade.t, side: 1 }), [fuseU, fuseFade]);
  const resinWas = useMemo(() => makeResinMaterial(fuseU, { t: fuseFade.t, side: 1 }), [fuseU, fuseFade]);
  useEffect(() => {
    applyResin(resinMat, resin);
    applyResin(resinWas, resin);
  }, [resinMat, resinWas, resin]);
  useEffect(() => {
    // the mass as a translucent body: alpha, no depth write (what stands inside shows through)
    for (const m of [stoneMat, stoneWas]) {
      m.transparent = resin.massOpacity < 1;
      m.opacity = resin.massOpacity;
      m.depthWrite = resin.massOpacity >= 1;
      m.needsUpdate = true;
    }
  }, [stoneMat, stoneWas, resin.massOpacity]);
  const fusedMats = useMemo(() => [stoneMat, resinMat], [stoneMat, resinMat]);
  const fusedMatsNow = useRef(fusedMats);
  fusedMatsNow.current = fusedMats;
  const fuseDepth = useMemo(() => fuseDepthMaterial(fuseU), [fuseU]);
  useEffect(() => () => fuseDepth.dispose(), [fuseDepth]);
  useEffect(() => {
    if (fused.current) fused.current.customDepthMaterial = fuseDepth;
    for (const m of chunkMeshes.current.values()) m.customDepthMaterial = fuseDepth;
  }, [fuseDepth]);
  useEffect(() => {
    for (const m of chunkMeshes.current.values()) m.material = fusedMats;
  }, [fusedMats]);
  /**
   * THE MASS FROM THE WORKER BESIDE (fuseUnits.ts UnitChunks): the chunks of the space that are other than they were —
   * each a mesh of its own, replaced on its own. No fade between what was and what is: a piece new on the screen
   * grows out of its parts (its stamp against that worker's clock, in the shader), and a piece made again stands
   * where it stood.
   */
  const applyChunks = (m: UnitChunks) => {
    // (the last message's chunks: how they came and went up — then the counts begin again for this one)
    {
      const a = uploadAcc.current;
      if (a.n || a.nDraw || a.nTransfer) fuseStats.current = { ...fuseStats.current, fuseUpload: { transferMs: a.nTransfer ? a.transfer / a.nTransfer : 0, applyMs: a.n ? a.apply / a.n : 0, applyMax: a.applyMax, drawMs: a.nDraw ? a.draw / a.nDraw : 0, drawMax: a.drawMax, n: a.n } };
      uploadAcc.current = { transfer: 0, nTransfer: 0, apply: 0, applyMax: 0, n: 0, draw: 0, drawMax: 0, nDraw: 0 };
      if (m.sentAt) {
        uploadAcc.current.transfer += Math.max(0, performance.timeOrigin + performance.now() - m.sentAt);
        uploadAcc.current.nTransfer++;
      }
    }
    // A BIG ARRIVAL IS PUT ON THE SCREEN A FEW MB A FRAME (2026-11-20; 렌더 › 작업 분담 › 화석 올리기): a message of
    // the worker of the mass can be tens of MB of chunks, made into geometry and uploaded in one frame — the frame
    // waited for all of it. Now each message's work is queued in order (what it lets go, what it sets) and done in the
    // frame loop up to the budget a frame, at least one chunk; a chunk set again before its turn is set once, as it
    // is last. A chunk on the screen stays as it is until its new geometry replaces it, so nothing opens meanwhile.
    const q = chunkOps.current;
    const supersede = (id?: string) => {
      for (const op of q) if (op.kind === "set" && (id === undefined || op.id === id)) op.mesh = null;
    };
    if (m.clear) supersede();
    for (const id of m.drop) {
      supersede(id);
      q.push({ kind: "drop", id });
    }
    for (const { id, mesh } of m.set) {
      supersede(id);
      q.push({ kind: "set", id, mesh });
    }
    // (everything that was is let go, except what this message sets — after it is set, so nothing stands empty between)
    if (m.clear) q.push({ kind: "clearRest", keep: new Set(m.set.map((e) => e.id)) });
    // (what was set again before its turn holds nothing any more: out of the queue, while it waits for frames)
    if (q.length > 256) chunkOps.current = q.filter((op) => op.kind !== "set" || op.mesh);
    chunkClockAt.current = m.clock0;
    fuseStats.current = { ...fuseStats.current, fuseSide: m.stats };
    if (last.current) live.current.onStats({ ...last.current, ...focus.current, ...fuseStats.current, stages: stageMax.current, build: workerBuild.current });
    if (!(uploadBudget.current > 0)) drainChunks(Infinity);
  };
  /** The queued chunks put on the screen, up to `budget` bytes of new geometry (at least one chunk). */
  const drainChunks = (budget: number) => {
    const group = chunkGroup.current;
    const q = chunkOps.current;
    if (!group || !q.length) return;
    const map = chunkMeshes.current;
    const let_go = (id: string) => {
      const mesh = map.get(id);
      if (!mesh) return;
      group.remove(mesh);
      mesh.geometry.dispose();
      map.delete(id);
    };
    let spent = 0, sets = 0, i = 0;
    for (; i < q.length; i++) {
      const op = q[i];
      if (op.kind === "drop") let_go(op.id);
      else if (op.kind === "clearRest") {
        for (const id of [...map.keys()]) if (!op.keep.has(id)) let_go(id);
      } else if (op.mesh) {
        const r = op.mesh;
        let bytes = 0;
        for (const a of [r.position, r.normal, r.color, r.extra, r.index, r.anchor, r.growA, r.growB, r.late]) if (a) bytes += a.byteLength;
        if (sets > 0 && spent + bytes > budget) break;
        spent += bytes;
        sets++;
        let mesh = map.get(op.id);
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.BufferGeometry(), fusedMatsNow.current);
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.customDepthMaterial = fuseDepth;
          group.add(mesh);
          map.set(op.id, mesh);
        }
        const tApply = performance.now();
        setFused(mesh, r, undefined, fuseU);
        const dtApply = performance.now() - tApply;
        const a = uploadAcc.current;
        a.apply += dtApply;
        a.applyMax = Math.max(a.applyMax, dtApply);
        a.n++;
        armDrawTimer(mesh);
        op.mesh = null;
      }
    }
    q.splice(0, i);
    chunkClock0.current = map.size ? chunkClockAt.current : null;
    if (i > 0) tallyScene();
  };
  /**
   * THE FIRST DRAW UPLOADS THE GEOMETRY (three.js: a new BufferAttribute's buffer is made and filled when the mesh is
   * first drawn — in the shadow pass if there is one, else the colour pass): timed from the first before-hook to the
   * first after-hook of this mesh, once, then the hooks are taken off.
   */
  const armDrawTimer = (mm: THREE.Mesh) => {
    let t0 = 0, done = false;
    const noop = () => {};
    const before = () => {
      if (!done && !t0) t0 = performance.now();
    };
    const after = () => {
      if (done || !t0) return;
      done = true;
      const dt = performance.now() - t0;
      const a = uploadAcc.current;
      a.draw += dt;
      a.drawMax = Math.max(a.drawMax, dt);
      a.nDraw++;
      mm.onBeforeRender = noop;
      mm.onAfterRender = noop;
      hooks.onBeforeShadow = noop;
      hooks.onAfterShadow = noop;
    };
    const hooks = mm as unknown as { onBeforeShadow: () => void; onAfterShadow: () => void };
    mm.onBeforeRender = before;
    mm.onAfterRender = after;
    hooks.onBeforeShadow = before;
    hooks.onAfterShadow = after;
  };
  useFrame(() => {
    if (chunkOps.current.length) drainChunks(Math.max(1, uploadBudget.current));
  });
  const applyChunksNow = useRef(applyChunks);
  applyChunksNow.current = applyChunks;
  const fusedWasMats = useMemo(() => [stoneWas, resinWas], [stoneWas, resinWas]);
  useFrame(() => {
    if (!fuseFade.t0) return;
    const t = fadeSec.current > 0 ? (performance.now() - fuseFade.t0) / (fadeSec.current * 1000) : 1;
    fuseFade.t.value = Math.min(1, t);
    if (t < 1) return;
    fuseFade.t0 = 0;
    const m = fusedWas.current;
    if (m) {
      m.visible = false;
      m.geometry.dispose();
      m.geometry = new THREE.BufferGeometry();
    }
  });
  useEffect(() => {
    // transparent points are left out of the transmission pass (three.js re-renders only the opaque objects into it)
    gatherMat.transparent = !pointsInRefraction;
    gatherMat.needsUpdate = true;
  }, [gatherMat, pointsInRefraction]);
  useEffect(() => {
    applyCloudLook(gatherMat, nature?.gatherDot ?? 0.025, (nature?.gatherSize ?? 0.3) / 2, nature?.gatherJitter ?? 0, nearFade);
  }, [gatherMat, nature?.gatherDot, nature?.gatherSize, nature?.gatherJitter, nearFade]);

  // ── apply a result: copy buffers into the meshes (no per-part work on the main thread) ──
  const apply = (r: SpaceResponse) => {
    const { boxCfg: cfg, onStats: report } = live.current;
    const p = r.parts;
    if (p) {
      for (const kind of PART_KINDS) {
        const mesh = meshes.current[kind];
        if (!mesh) continue;
        const n = p.counts[kind];
        (mesh.instanceMatrix.array as Float32Array).set(p.matrices[kind]);
        uploadFirst(mesh.instanceMatrix, n);
        if (mesh.instanceColor) {
          (mesh.instanceColor.array as Float32Array).set(p.colors[kind]);
          uploadFirst(mesh.instanceColor, n);
        }
        // when each part was first there (arrive.ts): rides along with the matrices, only when a result changes them
        let bornAt = mesh.geometry.getAttribute("aBorn") as THREE.InstancedBufferAttribute | undefined;
        if (!bornAt) mesh.geometry.setAttribute("aBorn", (bornAt = new THREE.InstancedBufferAttribute(new Float32Array(PART_CAPACITY[kind] * 2), 2)));
        (bornAt.array as Float32Array).set(p.born[kind]);
        uploadFirst(bornAt, n);
        // …and when it goes (the erosion's tick)
        let goneAt = mesh.geometry.getAttribute("aGone") as THREE.InstancedBufferAttribute | undefined;
        if (!goneAt) mesh.geometry.setAttribute("aGone", (goneAt = new THREE.InstancedBufferAttribute(new Float32Array(PART_CAPACITY[kind]).fill(1e9), 1)));
        (goneAt.array as Float32Array).set(p.gone[kind]);
        uploadFirst(goneAt, n);
        mesh.count = n;
      }
      arriveEpoch.current = p.bornEpochMs;
      const eg = edges.current;
      if (eg) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(p.edges ?? new Float32Array(0), 3));
        eg.geometry.dispose();
        eg.geometry = g;
      }
      // the time axis: a vertical line beside the parts, a tick per slot, a long tick per 10 slots (latest 2000)
      const ax = axis.current;
      if (ax && !live.current.noAxis) {
        const x0 = Number.isFinite(p.minX) ? p.minX - 2 : -3;
        const z0 = Number.isFinite(p.minZ) ? p.minZ - 2 : -3;
        const yTop = Math.max(p.top, (p.t / cfg.secPerUnit) * cfg.unit) + cfg.unit;
        const slots = Math.ceil(yTop / cfg.unit);
        const pts: number[] = [x0, 0, z0, x0, yTop, z0];
        for (let k = Math.max(0, slots - 2000); k <= slots; k++) {
          const len = k % 10 === 0 ? 1.4 : 0.5;
          pts.push(x0, k * cfg.unit, z0, x0 + len, k * cfg.unit, z0);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
        ax.geometry.dispose();
        ax.geometry = g;
      }
      setSegments(walkLive.current, p.walk.live);
      setSegments(walkKept.current, p.walk.kept);
      walkUse.current = { live: p.walk.liveU, kept: p.walk.keptU };
      applyWalkUse();
      setWalkEnds(endLive.current, p.walk.liveEnds);
      setWalkEnds(endKept.current, p.walk.keptEnds);
      waterNow.segs = p.streams;
      setPipeParts(pipeLive.current, elbowLive.current, p.pipes.live);
      setPipeParts(pipeKept.current, elbowKept.current, p.pipes.kept);
      last.current = { seeds: p.seeds, boxes: p.parts, kinds: p.counts, t: p.t, top: p.top, farSeeds: p.farSeeds, baked: p.baked, links: p.links, pipeRuns: p.pipeRuns, workerMs: r.ms, runner: worker.current?.mode ?? "-", lagS: Math.max(0, latestS(log.all()) - p.t), ...fuseStats.current, ...focus.current };
    }
    if (r.paths) {
      // the paths' lines (density.ts pathLines)
      const g = pathGeom;
      if (!g.getAttribute("position") || r.paths.length > pathCap.current) {
        pathCap.current = Math.max(6000, Math.ceil(r.paths.length * 1.5));
        g.dispose();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pathCap.current), 3));
      }
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      (pos.array as Float32Array).set(r.paths);
      pos.needsUpdate = true;
      g.setDrawRange(0, r.paths.length / 3);
    }
    // (the inferred village above the column: FutureVillage.tsx draws it)
    if (r.future) {
      futureLink.result = r.future;
      futureLink.version++;
    }
    if (r.reclaim) {
      gatherCount.current = Math.min(r.reclaim.position.length / 3, GATHER_CAPACITY);
      setGatherings(gatherGeomRef.current, r.reclaim);
    }
    // (what the wall shows as built, for the vegetation — botGround.shown)
    if (r.parts?.cells) {
      botGround.shown = r.parts.cells;
      botGround.shownAt = performance.now();
    }
    if (r.fuse) {
      // (the model's worker sends its one mesh EMPTY when the worker beside takes the mass over: nothing to fade
      // from, and the growing stays as that worker's chunks have set it)
      const empty = !r.fuse.index.length, beside = chunkMeshes.current.size > 0;
      if (!beside) chunkClock0.current = null;
      setFused(fused.current, r.fuse, empty ? undefined : { mesh: fusedWas.current, fade: fuseFade, sec: fadeSec.current }, empty && beside ? undefined : fuseU);
    }
    // what the mass is, by the numbers (the readout): a mesh that came empty is the question, not a mesh that did not come
    if (r.fuse) fuseStats.current = { ...fuseStats.current, fuseTris: r.fuse.index.length / 3, fuseResin: (r.fuse.index.length - r.fuse.resinStart) / 3 };
    // where the worker's time went: the slowest request of the last few is kept, so a heavy one can be read
    if (r.stages && (r.ms >= stageMax.current.ms || performance.now() - stageMax.current.at > 8000)) stageMax.current = { ms: r.ms, at: performance.now(), stages: r.stages };
    workerBuild.current = r.build ?? "?";
    if (last.current) report({ ...last.current, ...focus.current, ...fuseStats.current, workerMs: r.ms, stages: stageMax.current, build: workerBuild.current });
  };

  useEffect(() => {
    const onResult = (r: SpaceResponse) => {
      if (inFlight.current?.id === r.id) inFlight.current = null;
      apply(r);
    };
    // if the worker cannot start (or fails to load), the same computation runs here; everything is resent
    const fallback = () => {
      worker.current?.stop();
      worker.current = mainThreadRunner(onResult);
      sent.current = 0;
      inFlight.current = null;
    };
    try {
      const w = new Worker(new URL("./space.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<SpaceResponse>) => onResult(ev.data);
      w.onerror = (e) => {
        console.warn("[parliament] space worker failed, computing on the main thread:", e.message);
        fallback();
      };
      // THE WORKERS BESIDE IT (side.worker.ts; 2026-11-16): the buildings' mass and the ways are each worked out in a
      // worker of their own — the model's worker is given one end of a channel to each, and says there what is to be
      // worked out. The mass comes straight from its worker to this view (applyChunks); the ways go back to the model.
      // If one cannot start, the model's worker is told so and does that work itself, as before.
      const sides: Worker[] = [];
      let walkSide: Worker | null = null;
      const beside = (role: "fuse" | "walk"): MessagePort | null => {
        // (the layer above alone: no fossil, so no worker for it)
        if (futureOnly() && role === "fuse") return null;
        try {
          const sw = new Worker(new URL("./side.worker.ts", import.meta.url), { type: "module" });
          const ch = new MessageChannel();
          sw.postMessage({ type: "port", port: ch.port1 }, [ch.port1]);
          sw.onerror = (e) => {
            console.warn(`[parliament] the ${role} worker failed, that work goes back to the space worker:`, e.message);
            w.postMessage({ type: "ports", [role]: null });
            if (role === "fuse") fuseSide.current = null;
            if (role === "walk") walkSide = null;
          };
          if (role === "fuse") {
            sw.onmessage = (ev: MessageEvent<UnitChunks>) => ev.data.type === "fuse-chunks" && applyChunksNow.current(ev.data);
            fuseSide.current = sw;
          } else walkSide = sw;
          sides.push(sw);
          return ch.port2;
        } catch (e) {
          console.warn(`[parliament] no ${role} worker, that work stays in the space worker:`, e);
          return null;
        }
      };
      if (REDESIGN) {
        const fusePort = beside("fuse"), walkPort = beside("walk");
        const ports = [fusePort, walkPort].filter((q): q is MessagePort => !!q);
        if (ports.length) w.postMessage({ type: "ports", fuse: fusePort, walk: walkPort } satisfies SpaceRequest, ports);
      }
      worker.current = {
        mode: "worker",
        post: (m) => w.postMessage(m),
        stop: () => {
          w.terminate();
          for (const sw of sides) sw.terminate();
          fuseSide.current = null;
        },
        log: (m) => walkSide?.postMessage({ type: "events", add: m.add, reset: m.reset }),
      };
    } catch (e) {
      console.warn("[parliament] no space worker, computing on the main thread:", e);
      fallback();
    }
    sent.current = 0;
    return () => {
      worker.current?.stop();
      worker.current = null;
    };
    // apply and the runner read everything through refs
  }, []);

  // THE POOL OF THE MASS (2026-11-20; 렌더 › 작업 분담 › 화석 워커 수): with more than one, the worker of the mass keeps
  // the order and hands the making of each piece to this many helpers (side.worker.ts) — the mass is the same, made
  // side by side. Changing the number lets the old helpers go (their pieces go back to be made) and starts new ones.
  useEffect(() => {
    const coord = fuseSide.current;
    const n = fuseWorkers >= 2 ? Math.min(8, fuseWorkers) : 0;
    if (!coord || !n) return;
    const mine: { id: number; w: Worker }[] = [];
    const add: { id: number; port: MessagePort }[] = [];
    for (let i = 0; i < n; i++) {
      try {
        const hw = new Worker(new URL("./side.worker.ts", import.meta.url), { type: "module" });
        const ch = new MessageChannel();
        const id = ++helperIds.current;
        hw.postMessage({ type: "helper", port: ch.port1 }, [ch.port1]);
        hw.onerror = (e) => {
          console.warn("[parliament] a helper of the mass failed, its pieces go back to be made:", e.message);
          hw.terminate();
          if (fuseSide.current === coord) coord.postMessage({ type: "helpers", remove: [id] });
        };
        mine.push({ id, w: hw });
        add.push({ id, port: ch.port2 });
      } catch (e) {
        console.warn("[parliament] no helper of the mass:", e);
        break;
      }
    }
    // (none would start: the worker of the mass makes the pieces itself, as with one)
    if (add.length) coord.postMessage({ type: "helpers", add }, add.map((a) => a.port));
    return () => {
      for (const { w } of mine) w.terminate();
      if (fuseSide.current === coord) coord.postMessage({ type: "helpers", remove: mine.map((m) => m.id) });
    };
    // (declared after the effect that starts the worker of the mass: it runs after it, and sees it)
  }, [fuseWorkers]);
  // FEWER TRIANGLES FOR THE SETTLED CHUNKS (렌더 › 작업 분담 › 굳은 화석 조각의 삼각형 줄이기): the worker of the mass does
  // it (fuseUnits settleSimplify); 0 puts the chunks back as they were
  useEffect(() => {
    fuseSide.current?.postMessage({ type: "simplify", ratio: fossilSimplify });
  }, [fossilSimplify]);

  // (the world's clock as the bots' window has it — spaceModel WallClock; none without the window)
  const wallClock = (): WallClock | undefined => {
    const w = botGround.window?.();
    return w && w.elapsed !== undefined ? { now: w.elapsed, riseAt: w.riseAt ?? null, riseLost: w.riseLost ?? 0, standing: !!w.standing } : undefined;
  };
  // ── every TICK_MS: new events → worker, then one compute request (only one in flight) ──
  useTicker(TICK_MS, () => {
    const w = worker.current;
    if (!w) return;
    const now = performance.now();
    if (inFlight.current && now - inFlight.current.at < 15000) return;
    const { fold: f, boxCfg: cfg, showEdges: e, wear: wr, nature: nat, lodNear: near, lodMid: mid, farFactor: ff, weather: wx, fuse: fu, immutable, bake, water: wa, walk: wk, noAxis: oneClk, density: dens, pathLook: pl, resin: rs } = live.current; // noAxis = V2
    const waterCfg: WaterConfig = wa ? { ...wa } : { ...DEFAULT_WATER, enabled: false };
    const events = log.all();
    // the shared world's epoch names the baked layers on disk (bakeStore); the lab's world is this tab's only
    const epoch = local ? null : currentEpochKey();
    const tell = (m: Extract<SpaceRequest, { type: "events" }>) => {
      w.post(m);
      if (m.add.length || m.reset) w.log?.(m);
    };
    if (events.length < sent.current) {
      tell({ type: "events", add: events, reset: true, keepBuilt: log.lastDrop === "oldest", epoch });
      labAnchor.current = null;
    } else if (events.length > sent.current) {
      tell({ type: "events", add: events.slice(sent.current), epoch });
    } else if (epoch !== lastEpoch.current) tell({ type: "events", add: [], epoch });
    lastEpoch.current = epoch;
    sent.current = events.length;
    // THE PRESENT FOLLOWS THE CLOCK: the world's "now" in session seconds — shared: the world clock against the
    // shared epoch; lab: the column's end moved on by the lab's own clock (so the time rate ages the world even
    // with nobody in it; the model takes the later of this and its latest event)
    let nowS: number | undefined;
    if (local && takenEpochMs > 0) nowS = Math.min(sessionSeconds(clock.now(), takenEpochMs, 0), latestS(events) + IDLE_AGE_MAX_S);
    else if (local) {
      if (!labAnchor.current) labAnchor.current = { ms: clock.now(), s: latestS(events) };
      nowS = labAnchor.current.s + (clock.now() - labAnchor.current.ms) / 1000;
    } else nowS = Math.min(sessionSeconds(clock.now(), getEpochMs(), 0), latestS(events) + IDLE_AGE_MAX_S);

    const meS = latestOf(events, typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY));
    const t = latestS(events);
    const meQuiet = meS !== null && nowS !== undefined && nowS - meS > quietSec;
    const useMe = meS !== null && followWho !== "latest" && !(followWho === "auto" && meQuiet);
    // THE VIEW FOLLOWS THE COMPUTED WORLD, not the clock: a heavy world's compute can take longer than a tick, and the
    // latest event then lies above everything built — the camera must not leave the world behind (2026-10-31)
    const modelT = last.current?.t;
    const wantS = useMe && meS !== null ? meS : t;
    const focusS = modelT !== undefined && modelT > 0 ? Math.min(wantS, modelT + 2 * cfg.secPerUnit) : wantS;
    focus.current = { focusS, focusIsMe: useMe };
    focusY.current = events.length ? (focusS / cfg.secPerUnit) * cfg.unit : null;

    const o = controls.current;
    // TIME STANDING STILL (rate 0): the camera the LOD and the vegetation window follow is pinned too, so moving the
    // view does not rebuild anything — only a changed setting does (and chunks still catching up)
    const frozen = clock.rate() === 0;
    const camNow: [number, number, number] = o ? [o.object.position.x, o.object.position.y, o.object.position.z] : [0, 0, 0];
    // the vegetation window (and the fused mass) sit around the PRESENT, not around where the camera looks: the
    // exhibition camera aims `followLift` below the present (−25 by default, to frame the fossil band), and with the
    // orbit target as the reference the window slid 25 world down and vegetation grew on old layers (the artist,
    // 2026-10-31)
    // V2 (steady): the windows sit at the PRESENT itself — the camera has no say in what is computed
    const focusNow = oneClk ? t / cfg.secPerUnit : (o ? Math.max(0, o.target.y - (link?.current.lift ?? followLift)) : 0) / cfg.unit; // the lift in effect: the auto run's shot or the base pose
    if (!frozen || !pinned.current) pinned.current = { cam: camNow, focusK: focusNow };
    const { cam, focusK } = pinned.current;
    // V2 (steady): every seed with all its parts (no LOD): the parts' shapes, lives and the fused mass do not change as
    // the camera moves; the vegetation keeps its own density floor (it does not thin by distance in V2 either)
    const lod = oneClk ? { camera: cam, near: Infinity, mid: Infinity, farFactor: 1 } : { camera: cam, near, mid, farFactor: ff };
    const id = ++seq.current;
    // PAUSE MODE (time standing still): a changed setting should show at once — the mass is asked for on every tick
    // and built many chunks at a time, the vegetation only when something it depends on changed (it is the heaviest
    // part and most settings do not touch it)
    const natSig = frozen ? JSON.stringify([nat, wx, cfg, fu, f, waterCfg]) : "";
    const withNature = !!nat && (frozen ? natSig !== lastNatSig.current : id % NATURE_EVERY === 1);
    if (withNature) lastNatSig.current = natSig;
    const req: Extract<SpaceRequest, { type: "compute" }> = { type: "compute", id, now: nowS, parts: { fold: f, box: cfg, wear: wr, weather: wx, fuse: fu, water: waterCfg, walk: wk, edges: e, lod, steady: oneClk, density: dens, futureOnly: futureOnly(), clock: wallClock() } };
    if (pl && dens?.path) req.paths = { rise: pl.rise, smooth: pl.smooth };
    // (…with what is left under the ground: FutureUnder.tsx's knob)
    // (not asked for at all while the layer is off — off by default since 2026-11-20, "디폴트로 미래 모습은 안 보이게")
    if (REDESIGN && dens && futureLink.cfg?.on) req.future = futureUnder.cfg ? { ...futureLink.cfg, ...futureUnder.cfg } : futureLink.cfg;
    // (the layer above alone — futureOnly.ts: no vegetation of the present, no fossil)
    if (withNature && nat && !futureOnly()) {
      if (!nat.unlived) req.nature = { fold: f, box: cfg, nature: nat.cfg, window: nat.window, focusK, margin: nat.margin };
      if (nat.reclaim) {
        req.reclaim = {
          tauReclaimYears: nat.tauReclaimYears,
          perArea: nat.reclaimPerArea,
          unit: cfg.unit,
          secPerUnit: wx.strata ? cfg.secPerUnit : undefined,
          timeScale: wx.timeScale,
          fuse: !nat.unlived && fu.enabled ? fu : undefined,
          unlived: nat.unlived,
        };
      }
    }
    // the fused mass follows the vegetation's cadence (it is built from its history); paused: every tick, in bulk
    // (THE REDESIGN: the mass is asked for half as often — a request in which it is fused keeps the buildings waiting,
    // and nothing about a fossil is in a hurry)
    // (BUILDING BY BUILDING: a call fuses no longer than its budget and one building at a time, so it is asked for
    // every other tick — the buildings waiting get their turn sooner)
    if (!futureOnly() && (frozen || id % (REDESIGN ? (fu.perBuilding ? 2 : NATURE_EVERY * 2) : NATURE_EVERY) === 1)) {
      // the history window must reach below the immutable line (plus two chunks), or a layer would be cut before it is baked
      if (oneClk && bake && !local) {
        const need = (immutable + 20) * cfg.secPerUnit;
        if (keepWindowSec() < need) setKeepWindowSec(need);
      }
      // THE FOSSIL THAT HAS GONE IS LET GO (spaceModel FuseInput.dead): the life as the shader reads it — only where it
      // surely ends (all holes, or all thinning: between the two a share of the fossil stays for good)
      const dead = (() => {
        const ec = wx.erode, holes = rs.growDieHoles ?? 0;
        if (!REDESIGN || !ec || !rs.growDie || !((ec.shift ?? 0) > 0) || (holes > 0.001 && holes < 0.999)) return undefined;
        const perTop = Math.max(1, ec.slotSec ?? cfg.secPerUnit) / (ec.shift ?? 1);
        const slots = (min: number) => (Math.max(0, min) * 60) / perTop;
        // (every pixel of it gone: the patches of the going are behind by at most 1.5 × their share — FUSE_GONE_FRAG_BODY;
        // and a quarter more, for what a vertex reads of its neighbours' later hardening)
        const at = slots(rs.growDieAfterMin ?? 5.5) + Math.max(1, slots(rs.growDieSpanMin ?? 8.5)) * (holes >= 0.999 ? 1 + 1.5 * Math.max(0, rs.growDieRag ?? 0) : 1);
        return { deep: Math.max(0, Math.min(1, rs.growDeep ?? 0.6)), at: at * 1.25, after: (fossilWaitSec(ec) * 1.3) / perTop + 1 };
      })();
      // THE FOSSIL IN STAGES (spaceModel FuseInput.stages): the fossil's own ruler as the shader reads it, cut into steps
      const stages = (() => {
        const ec = wx.erode, n = fu.stageN ?? 0;
        if (!REDESIGN || !ec || !(n > 0) || !((ec.shift ?? 0) > 0)) return undefined;
        const perTop = Math.max(1, ec.slotSec ?? cfg.secPerUnit) / (ec.shift ?? 1);
        return { n, span: Math.max(1, (Math.max(0, rs.growAgeMin ?? 2.5) * 60) / perTop), deep: Math.max(0, Math.min(1, rs.growDeep ?? 0.6)), after: (fossilWaitSec(ec) * 1.3) / perTop + 1 };
      })();
      req.fuse = { box: cfg, weather: wx, fuse: fu, dead, stages, tauReclaimYears: nat?.tauReclaimYears ?? 300, focusK, perCall: frozen ? PAUSED_FUSE_PER_CALL : undefined, oneClock: oneClk, tauSlabYears: f.tauSlabYears, rebake: frozen, immutable: oneClk && bake ? immutable : undefined, bake: oneClk ? bake : true, caughtUp: !last.current || t - last.current.t <= 2 * cfg.secPerUnit };
    }
    inFlight.current = { id, at: now };
    w.post(req);
  });

  // follow the player's present: the view moves along the time axis, keeping the viewer's own orbit.
  // The first focus (and any jump further than FOLLOW_SNAP) is immediate, so an old epoch is never out of view.
  useFrame((state, dt) => {
    if (link) link.current.focusY = focusY.current;
    const c = controls.current;
    if (!c || focusY.current === null || !(follow || !snapped.current)) return;
    const want = Math.max(0, focusY.current + (link?.current.lift ?? followLift));
    const far = Math.abs(want - c.target.y) > FOLLOW_SNAP;
    const d = !snapped.current || far ? want - c.target.y : (want - c.target.y) * Math.min(1, dt * 1.5);
    snapped.current = true;
    if (Math.abs(d) > 1e-5) {
      c.target.y += d;
      state.camera.position.y += d;
      c.update();
    }
  });

  return (
    <>
      {/* (the wall opened for the layer above alone — lib/parliament/futureOnly.ts — draws nothing of the column) */}
      <group visible={!futureOnly()}>
      {PART_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => {
            meshes.current[kind] = m;
            if (m && !m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PART_CAPACITY[kind] * 3), 3);
            if (m) m.customDepthMaterial = arriveDepth;
          }}
          args={[undefined, undefined, PART_CAPACITY[kind]]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          {kind === "pile" ? <cylinderGeometry args={[0.5, 0.5, 1, 10]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial color={partColors?.[kind] ?? KIND_COLOR[kind]} roughness={kind === "pile" || STEEL.has(kind) ? 0.7 : 1} metalness={0} onBeforeCompile={arriveShader} />
        </instancedMesh>
      ))}
      <lineSegments ref={edges} frustumCulled={false} visible={showEdges}>
        <bufferGeometry />
        <lineBasicMaterial color="#15181c" />
      </lineSegments>
      {/* WALKWAYS' pre-layer as lines: light grey, the kept ones (below the present) see-through; an end with nothing
          to arrive at any more is closed with a round dot */}
      <lineSegments ref={walkLive} frustumCulled={false} visible={!!walk}>
        <bufferGeometry />
        <lineBasicMaterial color={walkLook.walkColor} vertexColors transparent />
      </lineSegments>
      <lineSegments ref={walkKept} frustumCulled={false} visible={!!walk}>
        <bufferGeometry />
        {/* (an old way turns to bone with the mass round it — the trace kept in the stone: boneLook.ts) */}
        <lineBasicMaterial color={walkLook.walkColor} vertexColors transparent opacity={walkLook.walkKeptOpacity} depthWrite={false} onBeforeCompile={wayBone} customProgramCacheKey={() => "way-bone"} />
      </lineSegments>
      {(["live", "kept"] as const).map((w) => (
        <points key={w} ref={w === "live" ? endLive : endKept} frustumCulled={false} visible={!!walk}>
          <bufferGeometry />
          <pointsMaterial color={walkLook.walkColor} map={dotTex} alphaTest={0.5} sizeAttenuation={false} size={walkLook.walkDot} transparent={w === "kept"} opacity={w === "kept" ? walkLook.walkKeptOpacity : 1} depthWrite={w === "live"} />
        </points>
      ))}
      {/* PIPES as plumbing (the wrapper around the pre-layer): straight cylinders at right angles, ball fittings at the
          bends, upright manholes with covers — grey, a human trace; the kept ones (below the present) dimmer */}
      {(["live", "kept"] as const).map((w) => (
        <group key={w} visible={!!water}>
          <instancedMesh ref={w === "live" ? pipeLive : pipeKept} args={[undefined, undefined, PIPE_CAPACITY]} frustumCulled={false} castShadow receiveShadow material={pipeMats[w]}>
            <cylinderGeometry args={[1, 1, 1, 14, 1, true]} />
          </instancedMesh>
          <instancedMesh ref={w === "live" ? elbowLive : elbowKept} args={[undefined, undefined, PIPE_CAPACITY]} frustumCulled={false} castShadow receiveShadow material={pipeMats[w]}>
            <torusGeometry args={[Math.max(0.5, water?.elbow ?? 1), 1, 10, 10, Math.PI / 2]} />
          </instancedMesh>
        </group>
      ))}
      <lineSegments ref={axis} frustumCulled={false} visible={!noAxis}>
        <bufferGeometry />
        <lineBasicMaterial color="#6a7078" />
      </lineSegments>
      <mesh ref={fused} frustumCulled={false} castShadow receiveShadow visible={fuse.enabled} material={fusedMats}>
        <bufferGeometry />
      </mesh>
      {/* the mass made in the worker beside: a mesh per chunk of the space (applyChunks) */}
      <group ref={chunkGroup} visible={fuse.enabled} />
      </group>
      {/* what is to come, inferred from the window's latest slots: apart from the column, above its top */}
      {REDESIGN && !!density && <FutureVillage unit={boxCfg.unit} top={fuseU.uGrowTop} kindColor={KIND_COLOR} />}
      {REDESIGN && !!density && <FutureUnder unit={boxCfg.unit} top={fuseU.uGrowTop} />}
      <group visible={!futureOnly()}>
      {/* what the mass was, while the new comes in (setFused; hidden otherwise) */}
      <mesh ref={fusedWas} frustumCulled={false} castShadow receiveShadow visible={false} material={fusedWasMats}>
        <bufferGeometry />
      </mesh>
      <lineSegments geometry={pathGeom} material={pathMat} frustumCulled={false} visible={!!pathLook} renderOrder={3} />
      <points geometry={gatherGeom} material={gatherMat} frustumCulled={false} visible={!!nature && nature.reclaim} />
      </group>
    </>
  );
}

/**
 * The depth-of-field focus. With `clickFocus`, a click (not a drag) on the scene puts the focus on what was hit — a part,
 * the fused mass, a point — or, if nothing was hit, on the depth of the orbit target along that ray; the focus glides
 * there (`speed`). Without it, or after "resetFocus", it follows the orbit target (the centre of the view).
 */
/** Where the focus is now (FocusFollow writes it; FocusLine reads it): its distance from the camera, and how it is set. */
const focusNow = { dist: 0, fixed: false };

/** One line: the focus's distance from the camera, its width and blur — read four times a second. */
function FocusLine({ range, bokeh }: { range: number; bokeh: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div>
      초점: 카메라에서 {Math.round(focusNow.dist)} ({focusNow.fixed ? "거리로 정함" : "따라감"}) · 폭 {range} · 흐림 {bokeh}
    </div>
  );
}

function FocusFollow({
  controls,
  target,
  clickFocus,
  speed,
  resetTick,
  fixedDist = null,
}: {
  controls: React.MutableRefObject<Orbit | null>;
  target: THREE.Vector3;
  clickFocus: boolean;
  speed: number;
  /** Changes when the focus should go back to the centre of the view. */
  resetTick: number;
  /** The focus at this distance from the camera, straight ahead (렌더 › 피사계 심도 세부 › 거리로 정함); null = follow. */
  fixedDist?: number | null;
}) {
  const { gl, camera, scene } = useThree();
  const want = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    want.current = null;
  }, [resetTick]);
  useEffect(() => {
    if (!clickFocus) {
      want.current = null;
      return;
    }
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.15 };
    ray.params.Line = { threshold: 0 };
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? [e.clientX, e.clientY] : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // a drag orbits, it does not focus
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && !(h.object instanceof THREE.LineSegments) && !(h.object instanceof THREE.GridHelper));
      if (hit) {
        want.current = hit.point.clone();
        return;
      }
      // nothing there: the point on the ray at the orbit target's depth
      const t = controls.current?.target;
      if (!t) return;
      const c = new THREE.Vector3(t.x, t.y, t.z);
      const depth = c.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      want.current = ray.ray.at(Math.max(0.1, depth), new THREE.Vector3());
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [clickFocus, gl, camera, scene, controls]);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    focusNow.fixed = fixedDist !== null;
    if (fixedDist !== null) {
      // (straight ahead of the camera at that distance: the focus moves with the camera, no easing)
      camera.getWorldDirection(ahead);
      target.copy(camera.position).addScaledVector(ahead, Math.max(0.1, fixedDist));
      focusNow.dist = fixedDist;
      return;
    }
    const t = controls.current?.target;
    const goal = want.current ?? (t ? new THREE.Vector3(t.x, t.y, t.z) : null);
    if (!goal) return;
    target.lerp(goal, 1 - Math.exp(-dt * speed));
    focusNow.dist = camera.position.distanceTo(target);
  });
  return null;
}

/** Whom the present follows — see SpaceWorld's `followWho`. */
type FollowWho = "auto" | "me" | "latest";

/** The sun's slow drift on the exhibition wall — see Sun. */
interface SunDrift {
  /** Minutes for one turn of the azimuth (0 = fixed). */
  turnMin: number;
  dir: 1 | -1;
  /** The elevation swings ± this many degrees around the slider's value … */
  swingDeg: number;
  /** … once per this many minutes. */
  swingMin: number;
  active: boolean;
}

/** What the exhibition camera is set to: a point on a sphere around where it looks. */
interface StagePose {
  /** Distance from the target (world). */
  dist: number;
  /** Angle from straight above, degrees: 0 = looking down, 90 = at the horizon. */
  polar: number;
  /** Direction around the target, degrees (where the turn starts). */
  azimuth: number;
  /** Where it looks, x and z (y is the time axis, followed). */
  look: [number, number];
}

/** The parts of OrbitControls' event API the stage camera listens to (a drag on the rehearsal wall pauses the turn). */
interface OrbitEvents {
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

/**
 * THE EXHIBITION CAMERA. The wall is a landscape: nobody steers it, it turns slowly around the strata (the artist,
 * 2026-10-30). The pose comes from the "전시 카메라" Leva group — set on the rehearsal wall (same page, so the same saved
 * values) and read by the exhibition wall; `turnSec` is one turn in seconds (0 = still). The turn is driven here by the
 * clock, not by OrbitControls' autoRotate, which moves a fixed angle per FRAME (a 40 fps wall would turn slower than the
 * 60 fps rehearsal). A drag on the rehearsal wall pauses the turn until the pointer is up; the time-axis follow
 * (SpaceWorld) keeps moving the target and the camera together along y underneath.
 */
function StageCamera({
  controls,
  pose,
  turnSec,
  dir,
  maxPolarDeg,
  active,
  auto,
  link,
  status,
}: {
  controls: React.MutableRefObject<Orbit | null>;
  pose: StagePose;
  turnSec: number;
  dir: 1 | -1;
  maxPolarDeg: number;
  /** Off in the lab, which has its own column to look at. */
  active: boolean;
  /** THE AUTO RUN (docs/camera-motion.md): the shot sequence to play by the clock, or null = the pose above, turning. */
  auto: ShotSequence | null;
  /** Shared with SpaceWorld's follow: the lift the run wants goes out, the focus's height comes back. */
  link: React.MutableRefObject<CamLink>;
  /** A line of the rehearsal wall's readout: which shot is on (null on the exhibition wall, which shows no text). */
  status: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const dragging = useRef(false);
  /** The next auto frame eases in from where the camera is (a drag ended, a stall, the run switched on). */
  const resync = useRef(false);
  useEffect(() => {
    const o = controls.current as (Orbit & OrbitEvents) | null;
    if (!o?.addEventListener) return;
    const start = () => void (dragging.current = true);
    const end = () => {
      dragging.current = false;
      resync.current = true;
    };
    o.addEventListener("start", start);
    o.addEventListener("end", end);
    return () => {
      o.removeEventListener?.("start", start);
      o.removeEventListener?.("end", end);
    };
  }, [controls]);
  // the pose, applied once at mount and whenever a value changes: the camera put on its sphere around the target
  const [lookX, lookZ] = pose.look;
  const autoOn = auto !== null;
  useEffect(() => {
    if (!active || autoOn) return; // the auto run places the camera itself; switched off, the pose below comes back
    const o = controls.current;
    if (!o) return;
    const polar = THREE.MathUtils.clamp(pose.polar, 0.5, maxPolarDeg) * DEG;
    const az = pose.azimuth * DEG;
    const r = Math.max(1, pose.dist);
    o.target.x = lookX;
    o.target.z = lookZ;
    o.object.position.x = o.target.x + r * Math.sin(polar) * Math.sin(az);
    o.object.position.y = o.target.y + r * Math.cos(polar);
    o.object.position.z = o.target.z + r * Math.sin(polar) * Math.cos(az);
    o.update();
  }, [active, autoOn, controls, pose.dist, pose.polar, pose.azimuth, lookX, lookZ, maxPolarDeg]);
  // THE AUTO RUN: the driver (lib/parliament/cameraShots.ts) says where the camera is this frame — the clock's shot,
  // blended, plus whatever difference is still settling after a drag or a stall — and it is put on its sphere around
  // the followed target (SpaceWorld moves target.y underneath and reads the lift back through `link`). Nothing is
  // allocated per frame: the input and the driver's results are objects kept here.
  const driver = useRef<ShotDriver | null>(null);
  const camState = useRef<CameraState>({ dist: 1, polar: 90, az: 0, lookX: 0, lookZ: 0, lift: 0 });
  const stepIn = useRef<StepInput | null>(null);
  const wasAuto = useRef(false);
  const statusSec = useRef(-1);
  // the turn: the camera moved around the vertical axis through the target by the time passed (a stall moves it at
  // most 0.1 s worth, so the landscape never jumps)
  useFrame((_, dt) => {
    if (!active) return;
    const o = controls.current;
    if (!o) return;
    if (!auto) {
      if (wasAuto.current) {
        wasAuto.current = false;
        link.current.lift = null; // the follow reads the slider again; the pose effect above puts the camera back
        if (status.current) status.current.textContent = "";
      }
      if (turnSec <= 0 || dragging.current) return;
      const a = (dir * 2 * Math.PI * Math.min(dt, 0.1)) / turnSec;
      const dx = o.object.position.x - o.target.x;
      const dz = o.object.position.z - o.target.z;
      const c = Math.cos(a);
      const s = Math.sin(a);
      o.object.position.x = o.target.x + dx * c + dz * s;
      o.object.position.z = o.target.z + dz * c - dx * s;
      o.update();
      return;
    }
    let d = driver.current;
    if (!d) {
      d = driver.current = createShotDriver();
      // readable from DevTools / a headless check, like `__perfSpans`: the driver (what the run shows this frame) and
      // the controls (where the camera actually is)
      const w = window as unknown as { __stageCam?: ShotDriver; __stageControls?: Orbit | null };
      w.__stageCam = d;
      w.__stageControls = o;
    }
    if (!wasAuto.current) {
      wasAuto.current = true;
      if (d.primed) resync.current = true; // switched on again: ease in from where the camera is
    }
    if (dragging.current) {
      resync.current = true; // the pointer steers (rehearsal wall); when it lets go we ease back to the run
      return;
    }
    if (dt > STALL_SEC) resync.current = true;
    const focusY = link.current.focusY;
    const inp =
      stepIn.current ?? (stepIn.current = { seq: auto, t: 0, dt: 0, turnSec, dir, azOffset: pose.azimuth, focusY, maxPolar: maxPolarDeg, resyncFrom: null });
    inp.seq = auto;
    inp.t = clockSec(Date.now());
    inp.dt = dt;
    inp.turnSec = turnSec;
    inp.dir = dir;
    inp.azOffset = pose.azimuth;
    inp.focusY = focusY;
    inp.maxPolar = maxPolarDeg;
    inp.resyncFrom = null;
    if (resync.current) {
      resync.current = false;
      inp.resyncFrom = cameraStateOf(o.object.position, o.target, focusY, d.want.lift, camState.current);
    }
    const s = stepShotDriver(d, inp);
    o.target.x = s.lookX;
    o.target.z = s.lookZ;
    link.current.lift = s.lift;
    placeCamera(o.target, s.dist, s.polar, s.az, o.object.position);
    o.update();
    if (status.current) {
      const sec = Math.ceil(d.cursor.left);
      if (sec !== statusSec.current) {
        statusSec.current = sec;
        status.current.textContent = shotStatus(auto, d);
      }
    }
  });
  return null;
}

/** A shot of the auto run from its Leva values (null = switched off). */
function shotFrom(id: number, on: boolean, dist: number, polar: number, look: [number, number], lift: number, holdSec: number, turn: number): Shot | null {
  return on ? { id, dist, polar, lookX: look[0], lookZ: look[1], lift, holdSec, turn } : null;
}

/**
 * The shadow-casting sun. The scene climbs the time axis, so the light (and its shadow camera) follows the orbit
 * target every frame at a fixed direction; the shadow box covers ±`extent` around it.
 */
/**
 * Renderer settings that are not props of anything: the resolution of the TRANSMISSION pass (the resin's refraction
 * re-renders the opaque scene into a texture every frame — at half resolution that pass costs a quarter, and the
 * frosted resin shows no difference).
 */
function RendererTuning({ transmissionScale }: { transmissionScale: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.transmissionResolutionScale = transmissionScale;
  }, [gl, transmissionScale]);
  return null;
}

function Sun({
  controls,
  azimuth,
  elevation,
  intensity,
  softness,
  shadows,
  drift,
}: {
  controls: React.MutableRefObject<Orbit | null>;
  azimuth: number;
  elevation: number;
  intensity: number;
  softness: number;
  shadows: boolean;
  drift: SunDrift;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const extent = 35;
  // THE SUN'S DAY (the artist, 2026-10-30): on the wall the azimuth turns and the elevation swings slowly around the
  // sliders' values, by the clock (a stall moves it at most 0.1 s worth), from the "전시 카메라" values
  const driftT = useRef(0);
  // (the turn is summed frame by frame: a new pace — 렌더 › 해 돌기 — goes on from where the sun stands, no jump)
  const turnDeg = useRef(0);
  useFrame((_, dt) => {
    const l = light.current;
    const t = controls.current?.target;
    if (!l || !t) return;
    const step = Math.min(dt, 0.1);
    if (drift.active) driftT.current += step;
    const s = driftT.current;
    if (drift.active && drift.turnMin > 0) turnDeg.current = (turnDeg.current + (drift.dir * 360 * step) / (drift.turnMin * 60)) % 360;
    const turn = turnDeg.current;
    const swing = drift.active && drift.swingDeg > 0 && drift.swingMin > 0 ? drift.swingDeg * Math.sin((2 * Math.PI * s) / (drift.swingMin * 60)) : 0;
    const az = (azimuth + turn) * DEG;
    const el = THREE.MathUtils.clamp(elevation + swing, 2, 89) * DEG;
    const d = 80;
    l.position.set(t.x + Math.cos(el) * Math.cos(az) * d, t.y + Math.sin(el) * d, t.z + Math.cos(el) * Math.sin(az) * d);
    l.target.position.set(t.x, t.y, t.z);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      intensity={intensity}
      castShadow={shadows}
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-extent}
      shadow-camera-right={extent}
      shadow-camera-top={extent}
      shadow-camera-bottom={-extent}
      shadow-camera-near={1}
      shadow-camera-far={200}
      shadow-radius={softness}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
    />
  );
}

interface Mark {
  id: string;
  kind: "me" | "bot" | "visitor";
  role: RoleId;
  x: number;
  z: number;
  s: number;
  /** No newer sample for `holdSec` (only "me" is still drawn then, dimmed). */
  stale: boolean;
}

/** What the overlay says about "me": the id this browser's player tab wrote, and how long it has been silent. */
interface MeStatus {
  id: string | null;
  /** Seconds since its newest sample arrived; null = it has left no presence yet. */
  silentSec: number | null;
}

const MARK_COLOR = { me: "#ff4d00", bot: "#2a62ff", visitor: "#111111" } as const;
/** The markers' filter: a bot's colour by how its herd moves (settlers · roamers · on a round · alone). */
const BOT_KIND_COLOR: Record<BotKind, string> = { settle: "#2a62ff", roam: "#ff8a1f", tour: "#19b36b", loner: "#9a9a9a" };

/**
 * THE REDESIGN (the artist, 2026-11-12: "지금 재편하는 중이니 레바는 다 지우고 내가 도입하는 것들만 하나씩 고쳐서
 * 옮겨와. 식생, 융합, 길, 파이프: 지금 안 쓰잖아"). While this is on, every folder this view declares with `useControls`
 * is NOT SHOWN (its saved values still apply, so the picture's settings are what they were), and the vegetation, the
 * fusion, the walkways and the pipes are off. What the redesign has brought over is declared with `useLevaControls`
 * and shown: the time axis, the bots (useGlobalBots), the buildings' density rule, the markers — and since then the
 * walkways (길), the vegetation as clouds, the erosion (침식) and the pipes (배관, 2026-11-15). Still off: the fusion.
 */
const REDESIGN = true;
/** The vegetation leaves a built cell-slot this many seconds after its building came, over this many seconds. */
const VEG_AFTER = 3;
const VEG_OVER = 4;
/** The test render mode (세계 › 테스트 렌더): off = the picture as saved; light = 1 device pixel per CSS pixel, no
 *  post-processing (AO, grain, depth of field), no shadows, no refraction; min = 0.6 pixels, a third of the vegetation
 *  points, on top of that. */
type TestPerf = "off" | "light" | "min";
const TEST_PERF_KEY = "parliament.testPerf";
/** Whether the camera goes up with the rising block (세계 › 카메라가 올라가는 덩어리를 따라감), kept in this browser. */
const CAM_RISE_KEY = "parliament.camRise";
const TEST_PERF_OPTIONS: Record<string, TestPerf> = { "끔 (저장된 화질 그대로)": "off", "가볍게 (해상도 1× · AO · 그림자 · 굴절 끔)": "light", "아주 가볍게 (해상도 0.6× · 식생 점 1/3까지)": "min" };
const useControls: typeof useLevaControls = ((...args: unknown[]) => {
  if (REDESIGN && typeof args[0] === "string") {
    const hide = { render: () => false };
    if (args.length >= 3 && args[2] && typeof args[2] === "object" && !Array.isArray(args[2])) args[2] = { ...(args[2] as object), ...hide };
    else args.splice(2, 0, hide);
  }
  return (useLevaControls as unknown as (...a: unknown[]) => unknown)(...args);
}) as typeof useLevaControls;

/**
 * Live markers: the latest presence sample of each owner, as a sphere at (x, time, z) with a thin line down to
 * the ground. "me" is the player tab on this browser (id written to localStorage by RoleField). An owner stays
 * visible while its newest sample keeps advancing; `holdSec` of silence hides it — except "me", which is always
 * drawn at its latest presence (dimmed while silent), so the player can always be found.
 */
/**
 * THE VEGETATION, AS THE OPPOSITE OF PEOPLE (the artist, 2026-11-12: "식생도 밀도함수 만들어서 길이랑 건물함수랑
 * 역방향으로 자라게 만드는 게 나을 듯"; earlier: "전체에 두면서도 cpu/gpu 덜먹게 못하나?"). It is everywhere in the
 * block by default: ONE fixed set of points filling it, made once. What takes it away is the people's density — how
 * near a cell-slot is to being building (density.ts eachShare) and the tails of the walks lying on it (tails.ts) —
 * written into a small 3D texture every two seconds; the vertex shader reads it and lets a point live only where the
 * vegetation left there (1 − the people's share) is more than the point's own draw. So it thins towards a building,
 * is gone inside one and along a way that is walked, and is back where and when the tails have faded. Per frame
 * nothing is computed or uploaded.
 */
/** The width of the clouds' texture (one texel per cloud, row after row). */
const VEG_CLOUD_W = 256;
/**
 * THE VEGETATION COMES AND GOES SOFTLY, AS THE LAYER ABOVE'S DOES (the artist, 2026-11-20: "글로벌 식생도 미래처럼 연속적으로
 * 움직이게 해줘"). Three things used to happen at once: every two seconds the people's share was written anew and every
 * point whose share had crossed its draw was there or gone in that frame; a cloud seated again jumped whole to its
 * new place; and the water's wear was laid in one go. Now —
 *  · the last snapshot of the share (and of the range, and of the water's wear) is kept beside the new one and the
 *    shader goes from one to the other over the time between two snapshots (uMix, uWaterMix): the share moves all
 *    the time, never in a step;
 *  · a point is not alive or dead but as LARGE as its share is past its own draw (over a band, uSoft): it grows in
 *    and shrinks away, each at its own moment;
 *  · THE CLOUDS MOVE (the artist, the same day, of the first version that only faded a cloud out and in: "현재 층에서
 *    구름 연속적으로 움직이는 거 안 보여", "배경 구름들 유기적으로 움직이게 해달라고"). A cloud that is seated again
 *    GOES there — from where it stood to its new place, over a time by the length of the way (the clouds' texture:
 *    where it is going, and when it set out; uCloudsFrom: where it came from, and how long the way takes) — and it
 *    is seated near by when a place near by is free, so that it reads as pushed aside, not flown across the block.
 *    And no cloud stands still: each WANDERS a slow path of its own round its place (uSway wide, a turn of it some
 *    uSwaySec long, never the same twice soon), its points BREATHE in and out and TURN slowly about its middle
 *    (uOrganic). The points pass over the people's ground as they go, and grow and shrink with it.
 */
/** Seconds between two snapshots of the people's share (and how long the shader takes from one to the next), and how
 *  long the water's wear takes to go over to a new course. */
const VEG_STEP = 2;
const VEG_WATER_EASE = 3;
const VEG_VERT = `
precision highp sampler3D;
uniform sampler3D uHuman;
uniform sampler3D uHumanWas;
uniform sampler2D uRange;
uniform sampler2D uRangeWas;
uniform sampler3D uWater;
uniform sampler3D uWaterWas;
uniform float uMix;
uniform float uWaterMix;
uniform float uSoft;
uniform vec3 uLife;
uniform sampler2D uCloudsFrom;
uniform float uSway;
uniform float uSwaySpeed;
uniform float uOrganic;
uniform vec3 uMin;
uniform vec3 uSpan;
uniform float uSize;
uniform float uScale;
uniform float uFull;
// THE CLOUDS' MIDDLES (spots): one texel each (VEG_CLOUD_W wide); a point's position is then its offset from the
// middle of its cloud (aCloud) — a cloud that moves is a few texels written, not every point re-uploaded
uniform sampler2D uClouds;
uniform float uCloudsOn;
uniform float uHalf;
// THE FLOW (vegFlow.ts): no clouds — each point's place is a texel of a texture the GPU writes anew every frame
uniform sampler2D uFlow;
uniform float uFlowOn;
attribute float aCloud;
attribute float aSeed;
varying float vShade;
void main() {
  vec3 wp = position;
  float inBlock = 1.0;
  if (uFlowOn > 0.5) {
    wp = texelFetch(uFlow, ivec2(gl_VertexID % ${VEG_FLOW_W}, gl_VertexID / ${VEG_FLOW_W}), 0).xyz;
  } else if (uCloudsOn > 0.5) {
    int ci = int(aCloud + 0.5);
    ivec2 ct = ivec2(ci % ${VEG_CLOUD_W}, ci / ${VEG_CLOUD_W});
    vec4 cl = texelFetch(uClouds, ct, 0);
    vec4 cf = texelFetch(uCloudsFrom, ct, 0);
    // (on its way from where it stood: w of the one = when it set out, 0 = it stands; of the other = how long it takes)
    float go = cl.w > 0.0 ? smoothstep(0.0, 1.0, (uLife.x - cl.w) / max(0.01, cf.w)) : 1.0;
    vec3 mid = mix(cf.xyz, cl.xyz, go);
    // IT WANDERS, BREATHES AND TURNS: a phase and a pace of its own (from its number), two turns of unlike lengths
    // on each axis so the path does not close soon; the points draw in and out ring by ring, and go round the middle
    float cn = float(ci);
    float ph = fract(sin(cn * 12.9898) * 43758.5453) * 6.2832;
    float tt = uLife.x * uSwaySpeed * (0.7 + 0.6 * fract(cn * 0.618));
    vec3 wander = vec3(sin(tt + ph) + 0.6 * sin(tt * 0.37 + ph * 2.3), 0.3 * sin(tt * 0.53 + ph * 1.3), cos(tt * 0.81 + ph * 0.7) + 0.6 * cos(tt * 0.29 + ph * 3.1)) / 1.6;
    float turn = uOrganic * 0.35 * tt * (fract(cn * 0.37) > 0.5 ? 1.0 : -1.0);
    float ct2 = cos(turn), st2 = sin(turn);
    vec3 off = vec3(ct2 * position.x - st2 * position.z, position.y, st2 * position.x + ct2 * position.z);
    off *= 1.0 + uOrganic * 0.3 * sin(tt * 1.7 + ph * 5.0 + length(position) * 0.6);
    wp = mid + uSway * wander + off;
    // (a point that falls out of the block is never alive)
    inBlock = wp.y >= 0.0 && abs(wp.x) < uHalf && abs(wp.z) < uHalf ? 1.0 : 0.0;
  }
  // (THE RISING WINDOW: the points fill the window, whose foot is uMin.y — a point keeps its place in the world while
  // the window rises past it, and when it drops out below it is a point of the new time at the top)
  float yl = mod(wp.y - uMin.y, uSpan.y);
  vec3 pos = vec3(wp.x, uMin.y + yl, wp.z);
  // the texture's x, y are the ground's x, z cells; its depth is the slot (the height)
  vec3 uvw = vec3((pos.x - uMin.x) / uSpan.x, (pos.z - uMin.z) / uSpan.z, yl / uSpan.y);
  float human = mix(texture(uHumanWas, uvw).r, texture(uHuman, uvw).r, uMix);
  // (uFull < 1: even untouched ground is not all vegetation)
  // (only round where anybody has been — uRange: 1 within the margin of what was built or walked, 0 beyond)
  // (the open water wears the plants away along its course: water.ts → waterNow)
  float worn = mix(texture(uWaterWas, uvw).r, texture(uWater, uvw).r, uWaterMix);
  float veg = (1.0 - human) * (1.0 - worn) * uFull * mix(texture(uRangeWas, uvw.xy).r, texture(uRange, uvw.xy).r, uMix);
  // (as large as its share is past its own draw: nothing where the share is under the draw, whole a band above it)
  float alive = smoothstep(aSeed, aSeed + max(0.001, uSoft), veg) * inBlock;
  vShade = fract(aSeed * 7.31);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = alive > 0.004 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = alive * uSize * uScale / max(0.001, -mv.z);
}`;
const VEG_FRAG = `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vShade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(mix(uColorA, uColorB, vShade), 1.0);
}`;

/** The time (s) of height `y` in the rising window, as the vegetation's shader takes it (round the window). */
function windowTime(y: number, base: number, unit: number, top: number, secPerUnit: number): number {
  const yl = (((y - base * unit) % top) + top) % top;
  return ((base * unit + yl) / unit) * secPerUnit;
}

/** A place on a border of the time of height `y` (a border by its length, anywhere along it but its ends, a little to
 *  either side), or null when no two villages live then. */
function beltPoint(bl: { secPerUnit: number; at: (t: number) => Border[] }, y: number, base: number, unit: number, top: number, R: number, rnd: () => number): [number, number] | null {
  const bs = bl.at(windowTime(y, base, unit, top, bl.secPerUnit));
  if (!bs.length) return null;
  let tot = 0;
  const ws = bs.map((b) => (tot += Math.hypot(b.bx - b.ax, b.bz - b.az)));
  const u = rnd() * tot;
  const b = bs[Math.max(0, ws.findIndex((w) => w >= u))];
  const ex = b.bx - b.ax, ez = b.bz - b.az, L = Math.hypot(ex, ez) || 1;
  const along = 0.1 + 0.8 * rnd(), side = (rnd() - 0.5) * R * 0.6;
  return [b.ax + ex * along - (ez / L) * side, b.az + ez * along + (ex / L) * side];
}

/** Whether a cloud stands on a border of its time (within its radius of one). */
function onBelt(bl: { secPerUnit: number; at: (t: number) => Border[] }, c: { x: number; y: number; z: number }, base: number, unit: number, top: number, R: number): boolean {
  return bl.at(windowTime(c.y, base, unit, top, bl.secPerUnit)).some((b) => nearestOnBorder(b, c.x, c.z).d <= R);
}

function Vegetation({
  unit,
  slots,
  count,
  size,
  full,
  pathAt,
  colorA,
  colorB,
  spots,
  spotR,
  spotGrow,
  spotLobed,
  spotJitter,
  moveSec,
  moveAt,
  ease,
  sway,
  swaySec,
  organic,
  erode,
  margin,
  base,
  river,
  belts,
  flow,
}: {
  /**
   * THE FLOW (vegFlow.ts; the artist, 2026-11-21: "전체 식생 생성해서 밀도장 따라 curl 처럼 몰려다니게"): the points are
   * made over the whole block (no clouds: `spots` 0) and every frame each goes a step along a flow made from the
   * vegetation's own density, on the GPU. null = the clouds, as before.
   */
  flow: VegFlowKnobs | null;
  /** Seconds a cloud takes to a place near by when it is seated again — further ones as much longer (0 = at once, and
   *  the points are there or not, as before). */
  ease: number;
  /** How wide each cloud wanders round its place (world; 0 = it stands), the seconds of one turn of that path, and how
   *  much its points breathe and turn (0 … 1). */
  sway: number;
  swaySec: number;
  organic: number;
  /**
   * BELTS ON THE BORDERS (the artist, 2026-11-16: "권역 나누기"): `share` of the clouds stand on the borders between
   * the villages alive at their own height's time (villageBorders.ts) — green belts that part one village's ground from
   * another's, which the borders' streams wear through; a belt cloud whose border has moved on (its village gone, or the
   * window risen past it) is seated on a border again. null = every cloud anywhere.
   */
  belts: { share: number; secPerUnit: number; at: (t: number) => Border[] } | null;
  /** The window's first slot (the rising block: its foot; 0 = the fixed block). */
  base: number;
  /** World units of vegetation beyond what was built or walked (< 0 = the whole ground). */
  margin: number;
  unit: number;
  slots: number;
  count: number;
  size: number;
  full: number;
  pathAt: number;
  colorA: string;
  colorB: string;
  /** SPOTS (the artist, 2026-11-12: "얘들도 스팟 정해놓고 자라게 하면 안 돼?" → "시공간상의 전자구름처럼"): how many
   *  clouds (0 = everywhere alike), a cloud's mean radius on the ground (world) and in time (slots), and the share of
   *  clouds that are two lobes instead of round. */
  spots: number;
  spotR: number;
  spotGrow: number;
  spotLobed: number;
  /** ± share by which a cloud is larger or smaller than the mean (each its own). */
  spotJitter: number;
  /** Seconds between two looks at where the clouds are (0 = they stay), and the people's share round a cloud's
   *  middle from which it is seated again. */
  moveSec: number;
  moveAt: number;
  /** THE EROSION (erode.ts): where buildings erode, their share of the people's density is given back to the
   *  vegetation (by depth, × feed); null = buildings count whole. */
  erode: ErodeConfig | null;
  /** THE OPEN WATER WEARS THE PLANTS (waterNow): per slot the water adds `gain` of wear on its course (± `width`
   *  cells), the wear goes on up the block × `keep` per slot — deeper where it has run on; null = none. */
  river: { gain: number; keep: number; width: number } | null;
}) {
  const gl = useThree((st) => st.gl);
  const camera = useThree((st) => st.camera);
  const N = WORLD_CELLS;
  const D = Math.max(8, Math.min(160, Math.round(slots)));
  // the people's share per cell-slot (x = the cell along x, y = the cell along z, depth = the slot) — TWO of them:
  // the snapshot being shown and the one before it (the shader goes from one to the other: VEG_VERT uMix); each
  // snapshot is written into the older of the two
  const texPair = useMemo(() => {
    const mk = () => {
      const t = new THREE.Data3DTexture(new Uint8Array(N * N * D), N, N, D);
      t.format = THREE.RedFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    };
    return [mk(), mk()] as const;
  }, [N, D]);
  useEffect(() => () => texPair.forEach((t) => t.dispose()), [texPair]);
  // how worn by water each cell-slot is (0 … 1), in the same layout — two as well
  const wPair = useMemo(() => {
    const mk = () => {
      const t = new THREE.Data3DTexture(new Uint8Array(N * N * D), N, N, D);
      t.format = THREE.RedFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    };
    return [mk(), mk()] as const;
  }, [N, D]);
  useEffect(() => () => wPair.forEach((t) => t.dispose()), [wPair]);
  /** Which of each pair holds the snapshot being shown (−1 = none written yet). */
  const snap = useRef({ human: -1, water: -1 });
  /** The clock the clouds' moving is read against (s; begins above 0: a cloud's 0 means "it stands"), and when each
   *  cloud on its way arrives (it is not looked at again before). */
  const lifeClock = useRef(1);
  const arrives = useRef(new Float32Array(0));
  const wornOf = useRef<{ segs: Float32Array | null; key: string }>({ segs: null, key: "" });
  // the points: made once — anywhere in the block, or (spots) as CLOUDS IN SPACETIME (the artist, 2026-11-12: "이렇게
  // 말고 시공간상의 전자구름처럼 해야지"): each spot is a place and a time of the block, and its points are drawn from
  // a probability like an electron's — thick at the middle, thinning without an edge, in every direction of the block
  // (the ground and time alike). Most are round (1s: density ∝ e^(−2r/a)); a share are two lobes along an axis of their
  // own (2p: ∝ r² e^(−r/a) cos²θ).
  /** The clouds' middles, and per point its cloud, its place in it (an offset from the middle) and its own draw —
   *  what moving a cloud needs (below). */
  const clouds = useRef<{ x: number; y: number; z: number }[]>([]);
  /** The clouds' middles as a texture the vertex shader reads (spots only; VEG_VERT uClouds). */
  const made = useRef<{ tex: THREE.DataTexture; from: THREE.DataTexture } | null>(null);
  /** Which clouds stand in the belts on the borders (drawn once with the clouds). */
  const beltOf = useRef<Uint8Array>(new Uint8Array(0));
  const beltsRef = useRef(belts);
  beltsRef.current = belts;
  const rndState = useRef(0x2f6e2b1);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = Math.max(0, Math.round(count));
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const of = new Uint16Array(n), off = new Float32Array(n * 3), draw = new Float32Array(n);
    let a = 0x2f6e2b1;
    const rnd = () => ((a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296;
    const top = D * unit;
    const nSpots = Math.max(0, Math.min(60000, Math.round(spots)));
    const R = Math.max(0.5, spotR), T = Math.max(0.2, spotGrow) * unit;
    const cloud: { x: number; y: number; z: number; lobed: boolean; ax: [number, number, number]; sc: number }[] = [];
    const belt = new Uint8Array(nSpots);
    const bl = beltsRef.current;
    for (let i = 0; i < nSpots; i++) {
      // an axis of its own for a lobed cloud (any direction of the block)
      const c = 2 * rnd() - 1, ph = rnd() * 2 * Math.PI, sn = Math.sqrt(1 - c * c);
      const cl = { x: (rnd() - 0.5) * WORLD_SIZE * 0.85, y: rnd() * top, z: (rnd() - 0.5) * WORLD_SIZE * 0.85, lobed: rnd() < spotLobed, ax: [sn * Math.cos(ph), c, sn * Math.sin(ph)] as [number, number, number], sc: 1 + (rnd() - 0.5) * 2 * Math.max(0, Math.min(0.95, spotJitter)) };
      // a belt cloud: on a border of its time, if there are any yet (else it is seated there when it is looked at)
      if (bl && rnd() < bl.share) {
        belt[i] = 1;
        const q = beltPoint(bl, cl.y, base, unit, top, R, rnd);
        if (q) [cl.x, cl.z] = q;
      }
      cloud.push(cl);
    }
    beltOf.current = belt;
    for (let i = 0; i < n; i++) {
      let x = (rnd() - 0.5) * WORLD_SIZE, y = rnd() * top, z = (rnd() - 0.5) * WORLD_SIZE;
      let ok = true;
      if (nSpots > 0) {
        const pi = Math.min(nSpots - 1, Math.floor(rnd() * nSpots));
        const p = cloud[pi];
        // a direction: anywhere (round), or towards the cloud's axis either way (lobed: cos θ drawn ∝ cos²θ)
        let dx: number, dy: number, dz: number, r: number;
        if (p.lobed) {
          const c = Math.cbrt(2 * rnd() - 1), ph = rnd() * 2 * Math.PI, sn = Math.sqrt(Math.max(0, 1 - c * c));
          // a frame about the axis
          const [ux, uy, uz] = p.ax;
          const hx = Math.abs(uy) < 0.9 ? 0 : 1, hy = Math.abs(uy) < 0.9 ? 1 : 0;
          let vx = uy * 0 - uz * hy, vy = uz * hx - ux * 0, vz = ux * hy - uy * hx;
          const vl = Math.hypot(vx, vy, vz) || 1;
          vx /= vl;
          vy /= vl;
          vz /= vl;
          const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
          dx = ux * c + (vx * Math.cos(ph) + wx * Math.sin(ph)) * sn;
          dy = uy * c + (vy * Math.cos(ph) + wy * Math.sin(ph)) * sn;
          dz = uz * c + (vz * Math.cos(ph) + wz * Math.sin(ph)) * sn;
          // r ∝ r⁴ e^(−r/a): the sum of five exponentials (a = 1/5, so its mean is 1)
          r = -Math.log(Math.max(1e-12, rnd() * rnd() * rnd() * rnd() * rnd())) / 5;
        } else {
          const c = 2 * rnd() - 1, ph = rnd() * 2 * Math.PI, sn = Math.sqrt(1 - c * c);
          dx = sn * Math.cos(ph);
          dy = c;
          dz = sn * Math.sin(ph);
          // r ∝ r² e^(−2r/a): the sum of three exponentials (mean 1)
          r = -Math.log(Math.max(1e-12, rnd() * rnd() * rnd())) / 3;
        }
        // (the cloud's size: R on the ground, T in time — r = 1 is its mean radius)
        of[i] = pi;
        off[i * 3] = dx * r * R * p.sc;
        off[i * 3 + 1] = dy * r * T * p.sc;
        off[i * 3 + 2] = dz * r * R * p.sc;
        x = p.x + off[i * 3];
        y = p.y + off[i * 3 + 1];
        z = p.z + off[i * 3 + 2];
        ok = y >= 0 && Math.abs(x) < WORLD_HALF && Math.abs(z) < WORLD_HALF;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      draw[i] = rnd();
      // (a point that fell out of the block is never alive)
      seed[i] = ok ? draw[i] : 2;
    }
    clouds.current = cloud.map((c) => ({ x: c.x, y: c.y, z: c.z }));
    rndState.current = a;
    if (nSpots > 0) {
      // SPOTS ON THE GPU: a point is its offset in its cloud, its cloud's index and its own draw; the middles are a
      // texture (moving a cloud = one texel). Whether it fell out of the block is the shader's (uHalf, y ≥ 0).
      const H = Math.ceil(nSpots / VEG_CLOUD_W);
      const tex = new THREE.DataTexture(new Float32Array(VEG_CLOUD_W * H * 4), VEG_CLOUD_W, H, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      const td = tex.image.data as Float32Array;
      // (w 0: every cloud stands — VEG_VERT; and where each came from: the same place, a way of no length)
      cloud.forEach((c, i) => td.set([c.x, c.y, c.z, 0], i * 4));
      tex.needsUpdate = true;
      const from = new THREE.DataTexture(new Float32Array(VEG_CLOUD_W * H * 4), VEG_CLOUD_W, H, THREE.RGBAFormat, THREE.FloatType);
      from.minFilter = from.magFilter = THREE.NearestFilter;
      from.generateMipmaps = false;
      const fd = from.image.data as Float32Array;
      cloud.forEach((c, i) => fd.set([c.x, c.y, c.z, 1], i * 4));
      from.needsUpdate = true;
      made.current = { tex, from };
      arrives.current = new Float32Array(nSpots);
      g.userData.cloudTex = tex;
      g.userData.cloudFrom = from;
      g.setAttribute("position", new THREE.BufferAttribute(off, 3));
      g.setAttribute("aCloud", new THREE.BufferAttribute(Float32Array.from(of), 1));
      g.setAttribute("aSeed", new THREE.BufferAttribute(draw, 1));
    } else {
      made.current = null;
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aCloud", new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    }
    return g;
  }, [count, D, unit, spots, spotR, spotGrow, spotLobed, spotJitter, belts?.share]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      geom.dispose();
      (geom.userData.cloudTex as THREE.DataTexture | undefined)?.dispose();
      (geom.userData.cloudFrom as THREE.DataTexture | undefined)?.dispose();
    },
    [geom],
  );
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VEG_VERT,
        fragmentShader: VEG_FRAG,
        uniforms: {
          uHuman: { value: null },
          uHumanWas: { value: null },
          uRange: { value: null },
          uRangeWas: { value: null },
          uWater: { value: null },
          uWaterWas: { value: null },
          uMix: { value: 1 },
          uWaterMix: { value: 1 },
          uSoft: { value: 0.15 },
          uLife: { value: new THREE.Vector3(1, 3, 3) },
          uCloudsFrom: { value: null },
          uSway: { value: 0 },
          uSwaySpeed: { value: 0.15 },
          uOrganic: { value: 0 },
          uMin: { value: new THREE.Vector3() },
          uSpan: { value: new THREE.Vector3(1, 1, 1) },
          uSize: { value: 0.1 },
          uScale: { value: 500 },
          uFull: { value: 1 },
          uColorA: { value: new THREE.Color() },
          uColorB: { value: new THREE.Color() },
          uClouds: { value: null },
          uCloudsOn: { value: 0 },
          uHalf: { value: WORLD_HALF },
          uFlow: { value: null },
          uFlowOn: { value: 0 },
        },
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  // THE FLOW: the points' places as a texture the GPU steps every frame (vegFlow.ts) — made anew with the points;
  // where the renderer cannot draw into float textures there is none, and the points stand where they were made
  const flowOn = !!flow;
  const flowSim = useMemo(() => {
    if (!flowOn) return null;
    if (!vegFlowSupported(gl)) {
      console.warn("[vegetation] no float render targets (EXT_color_buffer_float): the flow is off");
      return null;
    }
    return new VegFlow(geom.getAttribute("position").array, N, D);
  }, [flowOn, geom, gl, N, D]);
  useEffect(() => () => flowSim?.dispose(), [flowSim]);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    // (new textures — until their first snapshot is written: the pairs' first, both ways; a knob moved does not come here)
    mat.uniforms.uHuman.value = mat.uniforms.uHumanWas.value = texPair[0];
    mat.uniforms.uRange.value = mat.uniforms.uRangeWas.value = rangePair[0];
    mat.uniforms.uWater.value = mat.uniforms.uWaterWas.value = wPair[0];
    mat.uniforms.uMix.value = mat.uniforms.uWaterMix.value = 1;
    snap.current = { human: -1, water: -1 };
    wornOf.current = { segs: null, key: "" };
  }, [mat, texPair, wPair]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    mat.uniforms.uMin.value.set(-WORLD_HALF, base * unit, -WORLD_HALF);
    mat.uniforms.uSpan.value.set(WORLD_SIZE, D * unit, WORLD_SIZE);
    mat.uniforms.uSize.value = size;
    mat.uniforms.uFull.value = full;
    mat.uniforms.uColorA.value.set(colorA);
    mat.uniforms.uColorB.value.set(colorB);
  }, [mat, D, unit, size, full, colorA, colorB, base]);
  const timer = useRef(10);
  const moveTimer = useRef(0);
  // where the vegetation is, and how thick: a map of the ground (N × N), and a scratch map of the ground in use
  const rangePair = useMemo(() => {
    const mk = () => {
      const t = new THREE.DataTexture(new Uint8Array(N * N).fill(255), N, N, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    return [mk(), mk()] as const;
  }, [N]);
  useEffect(() => () => rangePair.forEach((t) => t.dispose()), [rangePair]);
  const rangeUsed = useRef(new Uint8Array(0));
  if (rangeUsed.current.length !== N * N) rangeUsed.current = new Uint8Array(N * N);

  useFrame((_, dt) => {
    // a point's size in pixels for its size in the world, at its distance
    // (times the camera's zoom: 1 but while a hero shot draws its frame alone, zoomed — HeroShot.tsx)
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    mat.uniforms.uScale.value = ((camera as THREE.PerspectiveCamera).zoom ?? 1) * (gl.domElement.height / (2 * Math.tan((fov * Math.PI) / 360)));
    // the clouds' texture of the points in use (set here, before the frame is drawn, so a new set of points is never
    // drawn with the last one's middles)
    const cloudTex = (geom.userData.cloudTex as THREE.DataTexture | undefined) ?? null;
    mat.uniforms.uClouds.value = cloudTex;
    mat.uniforms.uCloudsFrom.value = (geom.userData.cloudFrom as THREE.DataTexture | undefined) ?? cloudTex;
    mat.uniforms.uCloudsOn.value = cloudTex ? 1 : 0;
    mat.uniforms.uSway.value = Math.max(0, sway);
    mat.uniforms.uSwaySpeed.value = (2 * Math.PI) / Math.max(4, swaySec);
    mat.uniforms.uOrganic.value = Math.max(0, Math.min(1, organic));
    // THE FLOW: every point a step along it (the newest snapshots of the people's share, the water's wear and the
    // range), then the vertex shader reads the places just written
    if (flowSim && flowRef.current)
      flowSim.step(gl, dt, { human: mat.uniforms.uHuman.value, water: mat.uniforms.uWater.value, range: mat.uniforms.uRange.value, min: mat.uniforms.uMin.value, span: mat.uniforms.uSpan.value, unit, knobs: flowRef.current });
    mat.uniforms.uFlow.value = flowSim?.ready ? flowSim.texture : null;
    mat.uniforms.uFlowOn.value = flowSim?.ready ? 1 : 0;
    // SOFTLY (VEG_VERT): the clock, the times, how far between two snapshots; with no time (ease 0) all at once, as before
    // (the flow is always soft: its points grow and shrink as they pass over the people's ground)
    const soft = flowOn || ease > 0;
    lifeClock.current += dt;
    const now = lifeClock.current;
    (mat.uniforms.uLife.value as THREE.Vector3).set(now, Math.max(0.01, ease), Math.max(0.01, ease));
    mat.uniforms.uSoft.value = soft ? 0.15 : 0.001;
    mat.uniforms.uMix.value = soft ? Math.min(1, (mat.uniforms.uMix.value as number) + dt / VEG_STEP) : 1;
    mat.uniforms.uWaterMix.value = soft ? Math.min(1, (mat.uniforms.uWaterMix.value as number) + dt / VEG_WATER_EASE) : 1;
    timer.current += dt;
    if (timer.current < VEG_STEP) return;
    timer.current = 0;
    // (the snapshot is written into the older of the two; the one shown until now is what the shader comes from)
    const hWas = snap.current.human, hNow = hWas === 0 ? 1 : 0;
    const tex = texPair[hNow];
    const rangeTex = rangePair[hNow];
    const data = tex.image.data as Uint8Array;
    data.fill(0);
    const put = (cx: number, cz: number, kAbs: number, share: number) => {
      const k = kAbs - base; // (the texture's first row is the window's first slot)
      if (k < 0 || k >= D) return;
      const i = cx + N / 2 + N * (cz + N / 2 + N * k);
      const v = Math.round(Math.max(0, Math.min(1, share)) * 255);
      if (v > data[i]) data[i] = v;
    };
    // AFTER THE BUILDING (the artist, 2026-11-15: "식생이 건물보다 먼저 보였음", "건물 생성이랑, 식생 모이는 거랑 …
    // 단계가 딱딱 분절로 나뉘어있는 게 맞아? 지금 뭔가 뒤죽박죽이야"). The clouds used to give way to the people's
    // DENSITY, read here on the main thread — seconds before the building that density becomes had come through the
    // wall's worker and ticked in, and (deep in the block) with the eroded share given back at once. Now they give way
    // to what the wall itself SHOWS as built (botGround.shown, from the worker's own result): a few seconds after a
    // cell-slot's building has come, the plants are gone from it; as it goes on (erosion), they come back by its
    // progress × feed. Where the wall has no density rule (the old wall) the density is read as before.
    const eb = erode && erode.feed > 0 ? erode : null;
    const shown = botGround.shown;
    if (shown) {
      const since = (performance.now() - botGround.shownAt) / 1000;
      const feed = eb ? eb.feed : 0;
      for (let c = 0; c + 4 < shown.length; c += 5) {
        const age = shown[c + 3] < 0 ? Infinity : shown[c + 3] + since;
        // (the building ticks in over its first seconds; the plants leave after that)
        const q = age <= VEG_AFTER ? 0 : age >= VEG_AFTER + VEG_OVER ? 1 : (age - VEG_AFTER) / VEG_OVER;
        if (q > 0) put(shown[c], shown[c + 1], shown[c + 2], q * (1 - feed * shown[c + 4]));
      }
    } else botGround.built?.eachShare(eb ? (cx, cz, k, share) => put(cx, cz, k, share * (1 - eb.feed * eb.amount * erosionAt(k, 0, eb))) : put);
    const at = Math.max(0.1, pathAt);
    tailField.each((cx, cz, k, level) => put(cx, cz, k, level / at));
    tex.needsUpdate = true;
    mat.uniforms.uHuman.value = tex;
    mat.uniforms.uHumanWas.value = hWas < 0 ? tex : texPair[hWas];
    mat.uniforms.uRange.value = rangeTex;
    mat.uniforms.uRangeWas.value = hWas < 0 ? rangeTex : rangePair[hWas];
    mat.uniforms.uMix.value = hWas < 0 || !soft ? 1 : 0;
    snap.current.human = hNow;
    // WHERE THE VEGETATION IS AT ALL (the artist, 2026-11-15: "식생반경이 알아서 돌아다닌 범위 살짝 바깥에만 마진
    // 두고 생성되게"): the ground anybody has built on or walked over (at any time of the block), widened by the
    // margin — beyond it there are no plants. With margin < 0 (off) the whole ground, as before.
    {
      const R = rangeTex.image.data as Uint8Array;
      const m = Math.round(margin / (WORLD_SIZE / N));
      if (margin < 0) {
        R.fill(255);
        flowSim?.writeToward(null, 0);
      } else {
        const used = rangeUsed.current;
        used.fill(0);
        for (let k = 0; k < D; k++) {
          const off = N * N * k;
          for (let i = 0; i < N * N; i++) if (data[off + i]) used[i] = 1;
        }
        // THE RANGE HAS NO EDGE (the artist, 2026-11-17: "식생 배치가 경계가 있어 보이고... 녹아드는 느낌이 아님"). It
        // was a square of the margin round every used cell, all or nothing: the plants stopped on a straight outline,
        // a wall of them up the whole block. Now it is how far a cell lies from the used ground (round, not square —
        // a chamfer over the map, there and back), and the plants THIN with that distance: all of them close by, half
        // at the margin, none from 1.7 margins on. A point lives where its own draw is under the share (VEG_VERT), so
        // a falling share is fewer and fewer plants, with no line where they end.
        const dist = new Float32Array(N * N), DIAG = Math.SQRT2;
        for (let i = 0; i < N * N; i++) dist[i] = used[i] ? 0 : 1e9;
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const c = j * N + i;
            let v = dist[c];
            if (i > 0) v = Math.min(v, dist[c - 1] + 1);
            if (j > 0) {
              v = Math.min(v, dist[c - N] + 1);
              if (i > 0) v = Math.min(v, dist[c - N - 1] + DIAG);
              if (i < N - 1) v = Math.min(v, dist[c - N + 1] + DIAG);
            }
            dist[c] = v;
          }
        }
        const lo = 0.3 * m, hi = Math.max(lo + 1, 1.7 * m);
        for (let j = N - 1; j >= 0; j--) {
          for (let i = N - 1; i >= 0; i--) {
            const c = j * N + i;
            let v = dist[c];
            if (i < N - 1) v = Math.min(v, dist[c + 1] + 1);
            if (j < N - 1) {
              v = Math.min(v, dist[c + N] + 1);
              if (i < N - 1) v = Math.min(v, dist[c + N + 1] + DIAG);
              if (i > 0) v = Math.min(v, dist[c + N - 1] + DIAG);
            }
            dist[c] = v;
            const q = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
            R[c] = Math.round(255 * (1 - q * q * (3 - 2 * q)));
          }
        }
        // (the flow: which way the ground in use lies, for the points beyond the range — vegFlow.ts)
        flowSim?.writeToward(dist, hi);
      }
      rangeTex.needsUpdate = true;
    }
    // (the flow: the borders' field of each slot's time, laid again only when the borders or the window moved)
    flowSim?.writeBelts(beltsRef.current, base, WORLD_HALF);
    // THE WATER'S WEAR, laid again only when the streams or the knobs changed
    // (the rising window: a slot's row is counted from the window's first slot, as the people's share is)
    const wKey = river ? `${river.gain}|${river.keep}|${river.width}|${unit}|${D}|${base}` : "";
    if (waterNow.segs !== wornOf.current.segs || wKey !== wornOf.current.key) {
      wornOf.current = { segs: waterNow.segs, key: wKey };
      const wWas = snap.current.water, wNow = wWas === 0 ? 1 : 0;
      const wTex = wPair[wNow];
      mat.uniforms.uWater.value = wTex;
      mat.uniforms.uWaterWas.value = wWas < 0 ? wTex : wPair[wWas];
      mat.uniforms.uWaterMix.value = wWas < 0 || !soft ? 1 : 0;
      snap.current.water = wNow;
      const wd = wTex.image.data as Uint8Array;
      wd.fill(0);
      const segs = waterNow.segs;
      if (river && segs.length) {
        const C = WORLD_SIZE / N, NN = N * N;
        const mark = new Float32Array(NN * D);
        const W = Math.max(0, river.width), Wc = Math.ceil(W);
        for (let i = 0; i + 5 < segs.length; i += 6) {
          const k = Math.floor(segs[i + 1] / unit) - base;
          if (k < 0 || k >= D) continue;
          const x0 = segs[i], z0 = segs[i + 2], x1 = segs[i + 3], z1 = segs[i + 5];
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (C * 0.5)));
          for (let t = 0; t <= n; t++) {
            const cx = Math.floor((x0 + ((x1 - x0) * t) / n) / C) + N / 2, cz = Math.floor((z0 + ((z1 - z0) * t) / n) / C) + N / 2;
            for (let dz = -Wc; dz <= Wc; dz++)
              for (let dx = -Wc; dx <= Wc; dx++) {
                const r = Math.hypot(dx, dz);
                if (r > W + 0.5) continue;
                // whole on the course, less towards the banks
                const v = 1 - r / (W + 1);
                const id = (((cx + dx) % N) + N) % N + N * ((((cz + dz) % N) + N) % N) + NN * k;
                if (v > mark[id]) mark[id] = v;
              }
          }
        }
        const keep = Math.max(0, Math.min(0.99, river.keep)), gain = Math.max(0, river.gain);
        for (let c = 0; c < NN; c++) {
          let w = 0;
          for (let k = 0; k < D; k++) {
            const id = c + NN * k;
            w = Math.min(1, w * keep + mark[id] * gain);
            wd[id] = Math.round(w * 255);
          }
        }
      }
      wTex.needsUpdate = true;
    }
    // THE CLOUDS KEEP OUT OF THE PEOPLE'S WAY (the artist, 2026-11-12: "구름 위치 디바운싱으로 건물/길 위치 따라
    // 재배정"): every `moveSec` the clouds are looked at — one whose place has filled with building or way (the mean
    // of the people's share round its middle over `moveAt`) is seated again at the emptiest of a few places tried, a
    // few clouds at a time (nothing jumps about while the people's density is only just changing)
    moveTimer.current += 2;
    const m = made.current;
    if (!m || moveSec <= 0 || moveTimer.current < moveSec) return;
    moveTimer.current = 0;
    const C = WORLD_SIZE / N, top = D * unit;
    const R = Math.max(0.5, spotR), T = Math.max(0.2, spotGrow) * unit;
    const humanAt = (x: number, y: number, z: number): number => {
      // (a point's height is taken round the window, as the shader does)
      const span = D * unit;
      const cx = Math.floor(x / C) + N / 2, cz = Math.floor(z / C) + N / 2, k = Math.floor(((((y - base * unit) % span) + span) % span) / unit);
      if (cx < 0 || cx >= N || cz < 0 || cz >= N || k < 0) return 1;
      return k >= D ? 0 : data[cx + N * (cz + N * k)] / 255;
    };
    const around = (x: number, y: number, z: number): number =>
      (humanAt(x, y, z) * 2 + humanAt(x + 0.6 * R, y, z) + humanAt(x - 0.6 * R, y, z) + humanAt(x, y, z + 0.6 * R) + humanAt(x, y, z - 0.6 * R) + humanAt(x, y + 0.6 * T, z) + humanAt(x, y - 0.6 * T, z)) / 8;
    let a = rndState.current;
    const rnd = () => ((a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296;
    const moved = new Map<number, { x: number; y: number; z: number }>();
    const bl = beltsRef.current, belt = beltOf.current;
    for (let i = 0; i < clouds.current.length && moved.size < 6; i++) {
      // (a cloud on its way is not looked at again until it has come)
      if ((arrives.current[i] ?? 0) > now) continue;
      const c = clouds.current[i];
      // a BELT cloud off any border of its time (its villages gone, or the window risen past it) is seated on one again
      const isBelt = !!bl && belt[i] === 1;
      const offBelt = isBelt && !onBelt(bl!, c, base, unit, top, R);
      if (!offBelt && around(c.x, c.y, c.z) <= moveAt) continue;
      // NEAR BY FIRST (it is pushed aside, not flown across the block): sixteen places within three of its radii on
      // the ground and two in time, then eight anywhere — the emptiest near by if that is clearly free, else the
      // emptiest of them all. (A belt cloud's places are on the borders, wherever those are.)
      let best = c, bestH = Infinity, near = c, nearH = Infinity;
      for (let t = 0; t < 24; t++) {
        const close = t < 16 && !isBelt;
        let p = close
          ? { x: c.x + (rnd() - 0.5) * 6 * R, y: c.y + (rnd() - 0.5) * 4 * T, z: c.z + (rnd() - 0.5) * 6 * R }
          : { x: (rnd() - 0.5) * WORLD_SIZE * 0.85, y: rnd() * top, z: (rnd() - 0.5) * WORLD_SIZE * 0.85 };
        if (close && (Math.abs(p.x) > WORLD_HALF * 0.92 || Math.abs(p.z) > WORLD_HALF * 0.92 || p.y < 0 || p.y > top)) continue;
        if (isBelt) {
          const q = beltPoint(bl!, p.y, base, unit, top, R, rnd);
          if (!q) continue;
          p = { x: q[0], y: p.y, z: q[1] };
        }
        const h = around(p.x, p.y, p.z);
        if (h < bestH) [best, bestH] = [p, h];
        if (close && h < nearH) [near, nearH] = [p, h];
      }
      if (near !== c && nearH <= moveAt * 0.5) best = near;
      if (best === c) continue;
      moved.set(i, c);
      clouds.current[i] = best;
    }
    rndState.current = a;
    if (!moved.size) return;
    // (the points follow in the vertex shader: only the moved clouds' texels are written — no loop over the points,
    // no buffer upload)
    const td = m.tex.image.data as Float32Array, fd = m.from.image.data as Float32Array;
    for (const [i, was] of moved) {
      const c = clouds.current[i];
      // IT GOES THERE (VEG_VERT): from where it stood, in the time a way of 2.5 radii takes × the way's length — at
      // most forty seconds; with no time (ease 0) it is there at once, as before
      const far = Math.hypot(c.x - was.x, c.y - was.y, c.z - was.z);
      const takes = soft ? Math.max(ease, Math.min(40, (ease * far) / (2.5 * R))) : 0;
      fd.set([was.x, was.y, was.z, Math.max(0.01, takes)], i * 4);
      td.set([c.x, c.y, c.z, soft ? now : 0], i * 4);
      arrives.current[i] = now + takes;
    }
    m.tex.needsUpdate = true;
    m.from.needsUpdate = true;
  });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

function Markers({
  log,
  secPerUnit,
  unit,
  holdSec,
  labels,
  tint,
  onActive,
  onMe,
}: {
  log: EventLog;
  secPerUnit: number;
  unit: number;
  holdSec: number;
  /** The name over each marker ("me · worker", a bot's id, "visitor"); off on the exhibition wall (no text at all). */
  labels: boolean;
  /** Bots coloured by how their herd moves (BOT_KIND_COLOR) instead of all one blue. */
  tint: boolean;
  onActive: (n: number) => void;
  onMe: (m: MeStatus) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const seen = useRef(new Map<string, { s: number; at: number }>());
  const timer = useRef(10);
  const sig = useRef("");
  const meSig = useRef("");

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.25) return;
    timer.current = 0;
    const events = log.all();
    const latest = new Map<string, PEvent>();
    for (const e of events) {
      if (e.k !== "p") continue;
      const p = latest.get(e.o);
      if (!p || e.s >= p.s) latest.set(e.o, e);
    }
    const now = performance.now();
    const firstScan = seen.current.size === 0;
    const me = typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY);
    const out: Mark[] = [];
    for (const [id, e] of latest) {
      const prev = seen.current.get(id);
      // owners that were already stored when this view opened count as stale until they send a newer sample
      if (!prev || e.s > prev.s) seen.current.set(id, { s: e.s, at: firstScan && !prev ? -1e12 : now });
      const at = seen.current.get(id)!.at;
      const stale = now - at > holdSec * 1000;
      if (stale && id !== me) continue;
      out.push({ id, kind: id === me ? "me" : id.startsWith("bot") ? "bot" : "visitor", role: e.r, x: e.x, z: e.z, s: e.s, stale });
    }
    const meAt = me ? seen.current.get(me)?.at : undefined;
    const meStatus: MeStatus = { id: me, silentSec: meAt === undefined ? null : meAt < 0 ? Infinity : Math.floor((now - meAt) / 1000) };
    const ms = `${meStatus.id}:${meStatus.silentSec}`;
    if (ms !== meSig.current) {
      meSig.current = ms;
      onMe(meStatus);
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    const next = out.map((m) => `${m.id}:${m.s}:${m.x.toFixed(2)}:${m.z.toFixed(2)}:${m.stale}`).join("|");
    if (next === sig.current) return;
    sig.current = next;
    setMarks(out);
    onActive(out.filter((m) => !m.stale).length);
  });

  return (
    <>
      {marks.map((m) => {
        const y = (m.s / secPerUnit) * unit;
        const kind = tint && m.kind === "bot" ? botKinds.get(m.id) : undefined;
        const color = kind ? BOT_KIND_COLOR[kind] : MARK_COLOR[m.kind];
        const big = m.kind === "me" ? 0.5 : 0.32;
        return (
          <group key={m.id}>
            <mesh position={[m.x, y, m.z]}>
              <sphereGeometry args={[big, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={m.stale ? 0.4 : 0.95} />
            </mesh>
            {/* a unit cylinder scaled to the height: the height in `args` would make r3f build (and throw away) a new
                geometry every time a marker's time moved — with 22 bots, ~22 geometries a second (2026-10-30) */}
            <mesh position={[m.x, y / 2, m.z]} scale={[1, Math.max(y, 0.001), 1]}>
              <cylinderGeometry args={[0.03, 0.03, 1, 6]} />
              <meshBasicMaterial color={color} transparent opacity={0.5} />
            </mesh>
            <mesh position={[m.x, 0.02, m.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.35, 0.5, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            {labels && (
              <Html position={[m.x, y + big + 0.25, m.z]} center style={{ pointerEvents: "none" }}>
                <div className="whitespace-nowrap font-mono text-[10px] leading-3" style={{ color }}>
                  {m.kind === "me" ? (m.stale ? "me (silent)" : "me") : m.kind === "bot" ? m.id : "visitor"} · {m.role}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/** The lab's line of the readout: which world it holds, how far its own clock has gone since, or why it has none. */
function LabLine({ world, note, clock }: { world: TakenWorld | null; note: string; clock: Clock }) {
  if (!world) return <div>랩: {note || "세계 없음"}</div>;
  const at = new Date(world.takenAt);
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`;
  const gone = Math.max(0, Math.round((clock.now() - world.nowMs) / 1000));
  return (
    <div>
      랩: 벽의 세계를 {hhmm}에 한 번 따옴 ({world.from === "server" ? "봇 서버" : "이 브라우저에 남은 기록"} · 표본 {world.count.toLocaleString()}개) · 봇 없음 · 따온 뒤 흐른 시간 {Math.floor(gone / 60)}:{String(gone % 60).padStart(2, "0")}
      {note ? ` · ${note}` : ""} · 저장은 벽과 같은 폴더
    </div>
  );
}

/**
 * `lab`: the WORK ROOM (/v2/global/lab) — the wall's world taken once (useLabWorld.ts: no bots, nothing built after;
 * this tab only, never the shared storage), its own clock (standing still at first), no history window; the same
 * Leva, saved under the shared view's key.
 */
export default function ParliamentSpace({ lab = false }: { lab?: boolean } = {}) {
  const isV2 = useParliamentVersion() === "v2";
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld(undefined, 1000, !lab);
  useKeepWindowControl(log, -2, !lab, REDESIGN); // the shared history window (log.ts), the first folder
  // (the lab's test column is gone, 2026-11-12: the lab opens empty and the bots write it — the time rate fills it fast)
  // the clock the view and its bots run on: the shared world clock, or the lab's own (this tab only)
  const labClock = useMemo(() => makeLocalClock(0), []);
  const clk: Clock = lab ? labClock : sharedClock;
  // THE LAB'S WORLD: the wall's, taken once when the lab opens — no bots here, nothing built after (useLabWorld.ts)
  const labWorld = useLabWorld(log, labClock, lab);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";
  // THE FUSION'S FOLDER LISTS ONLY WHAT IS BEING WORKED ON (levaFocus.ts; every other folder is whole) — set while
  // rendering, before the panel mounts
  setLevaFocus(REDESIGN && isV2);
  // THE WALL opens at real speed: the shared rate is saved per origin, and a ×20 left behind from a rehearsal would
  // run the exhibition's world away (2026-10-31)
  useEffect(() => {
    if (hideUi && !lab && clk.rate() !== 1) clk.setRate(1);
  }, [hideUi, lab, clk]);
  useReloadOnContextLoss(hideUi && !lab);
  const controls = useRef<Orbit | null>(null);
  /** The element the canvas fills (the hero shot measures its frame on it). */
  const rootBox = useRef<HTMLDivElement>(null);
  /** The exhibition camera's auto run ↔ the time-axis follow (CamLink), and the readout line that names the shot. */
  const camLink = useRef<CamLink>({ lift: null, focusY: null });
  const shotLine = useRef<HTMLDivElement | null>(null);
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, kinds: NO_COUNTS, t: 0, top: 0, focusS: 0, focusIsMe: false, farSeeds: 0, lagS: 0, fuseTris: 0, fuseResin: 0, baked: 0, links: 0, pipeRuns: 0, workerMs: 0, runner: "-" });
  const [active, setActive] = useState(0);
  const [meStatus, setMeStatus] = useState<MeStatus>({ id: null, silentSec: null });
  const topRef = useRef(0);
  const focusRef = useRef(0);

  /** move orbit target and camera together along y (the time axis), keeping the viewer's own angle/distance */
  const jump = (y: number) => {
    const o = controls.current;
    if (!o) return;
    const d = y - o.target.y;
    o.target.y += d;
    o.object.position.y += d;
    o.update();
  };

  // ── Leva, grouped: 보기 · 시간축 · 생성 규칙 · 건물 · 길 → 다리 · 물 → 배관 · 식생 · 풍화/지층 · 엉김/융합/레진 · 렌더/성능 ──
  const [focusResets, setFocusResets] = useState(0);
  const v = useControls(
    "보기",
    savable("보기", {
      theme: { options: { "종이 (밝음)": "paper", "검정": "black" }, value: "black" as keyof typeof THEMES, label: "배경" },
      follow: { value: true, label: "플레이어 시간대 따라가기" },
      "나에게": button(() => jump(focusRef.current)),
      "바닥으로": button(() => jump(0)),
      "가장 최근으로": button(() => jump(Math.max(0, topRef.current - 6))),
      markers: { value: true, label: "실시간 마커 (나/봇/방문자)" },
      markerHold: { value: 6, min: 2, max: 60, step: 1, label: "마커 유지 (갱신 끊긴 뒤 초)" },
      showEdges: { value: false, label: "모서리 선" },
      "응답의 홀씨": folder({
        seedsOn: { value: true, label: "켜기" },
        seedHead: { value: 5, min: 0.5, max: 20, step: 0.5, label: "처음 크기 (월드)" },
        seedThrough: { value: 0.3, min: 0, max: 1, step: 0.05, label: "덩어리 너머로 비침 (0 = 가려짐)" },
        "송이 모양": folder({
          seedStem: { value: 0.9, min: 0, max: 4, step: 0.05, label: "줄기 길이 (× 크기)" },
          seedRadius: { value: 0.55, min: 0.1, max: 2, step: 0.05, label: "공 반지름 (× 크기)" },
          seedSpokes: { value: 24, min: 3, max: 64, step: 1, label: "살 수" },
          seedDome: { value: 0, min: 0, max: 1, step: 0.05, label: "살이 모이는 곳 (0 = 공 전체, 1 = 위쪽 반구만)" },
          seedLineWidth: { value: 1, min: 0.5, max: 6, step: 0.25, label: "선 굵기 (px)" },
          seedLineColor: { value: "#ffffff", label: "선 색" },
          seedLineLight: { value: 1, min: 0, max: 1, step: 0.05, label: "선 밝기" },
          seedDot: { value: 0.3, min: 0.05, max: 2, step: 0.05, label: "씨앗 점 크기 (월드)" },
          seedDotColor: { value: "#ffffff", label: "씨앗 색" },
          seedDotLight: { value: 1, min: 0, max: 1, step: 0.05, label: "씨앗 밝기" },
          seedDotSquare: { value: false, label: "씨앗을 네모로" },
        }),
        "가루": folder({
          seedDust: { value: 260, min: 0, max: 800, step: 10, label: "양 (한 송이당 점 수)" },
          seedDustReach: { value: 30, min: 2, max: 80, step: 1, label: "날아가는 거리 (월드)" },
          seedDustSec: { value: 40, min: 3, max: 120, step: 1, label: "날리는 시간 (s)" },
          seedDustEmit: { value: 0, min: 0, max: 1, step: 0.05, label: "뿜는 방식 (0 = 한꺼번에, 1 = 서서히; 날리는 시간이 최대 2배)" },
          seedDustBurst: { value: 3, min: 1, max: 6, step: 0.25, label: "터지는 세기 (1 = 일정하게, 높을수록 확 터지고 떠 있음)" },
          seedDustLifeSpread: { value: 0.7, min: 0, max: 1, step: 0.05, label: "점마다 수명 차이" },
          seedDustFade: { value: 1.5, min: 0.25, max: 5, step: 0.25, label: "사라지는 곡선 (낮을수록 늦게 흐려짐)" },
          seedDustWind: { value: 0.7, min: 0, max: 1, step: 0.05, label: "바람에 쏠림 (0 = 사방으로, 1 = 한 방향)" },
          seedDustHeading: { value: 0, min: 0, max: 360, step: 5, label: "바람 방향 (°)" },
          seedDustHeadingSpread: { value: 1, min: 0, max: 1, step: 0.05, label: "방향 차이 (0 = 모두 같은 쪽, 1 = 송이마다 제각각)" },
          seedDustRise: { value: 0.12, min: -0.5, max: 1, step: 0.01, label: "떠오름 (× 거리; 음수 = 가라앉음)" },
          seedDustWaver: { value: 0.1, min: 0, max: 0.5, step: 0.01, label: "흔들림 (× 거리)" },
          seedDustFrom: { value: 1, min: 0, max: 2, step: 0.05, label: "출발 위치 (0 = 공 가운데, 1 = 씨앗 끝)" },
          seedDustDot: { value: 0.15, min: 0.03, max: 2, step: 0.01, label: "점 크기 (월드)" },
          seedDustColor: { value: "#ffffff", label: "색" },
          seedDustLight: { value: 1, min: 0, max: 1, step: 0.05, label: "밝기" },
          seedDustSoft: { value: 0, min: 0, max: 1, step: 0.05, label: "가장자리 부드러움" },
          seedDustSquare: { value: false, label: "네모로" },
        }),
        "일생 · 화석화": folder({
          seedGrowSec: { value: 0, min: 0, max: 10, step: 0.1, label: "처음 자라나는 시간 (s; 0 = 바로)" },
          seedSettle: { value: 0.55, min: 0.1, max: 1, step: 0.05, label: "가루가 다 날린 뒤 크기 (처음의 ×)" },
          seedSettleSec: { value: 12, min: 1, max: 60, step: 1, label: "줄어드는 시간 (s)" },
          seedFossil: { value: 45, min: 5, max: 120, step: 1, label: "화석화되는 깊이 (현재에서 ↓단)" },
          seedFossilSpread: { value: 6, min: 0, max: 30, step: 1, label: "그 깊이의 홀씨마다 차이 (±단)" },
          seedKeep: { value: 0.35, min: 0, max: 1, step: 0.05, label: "화석으로 남는 비율 (나머지는 사라짐)" },
          seedGoneSteps: { value: 3, min: 0.5, max: 20, step: 0.5, label: "변하는 데 걸리는 깊이 (단)" },
          seedFossilScale: { value: 1, min: 0.1, max: 1.5, step: 0.05, label: "남은 것의 크기 (×)" },
          seedFossilLight: { value: 1, min: 0, max: 1, step: 0.05, label: "남은 것의 밝기 (×)" },
          seedFossilSpokes: { value: 1, min: 0.1, max: 1, step: 0.05, label: "남은 것의 살 비율" },
        }),
        "지터 (0 = 모두 같음, 1 = ⅓배~3배)": folder({
          seedJitSize: { value: 0.35, min: 0, max: 1, step: 0.05, label: "송이 크기" },
          seedJitShape: { value: 0.3, min: 0, max: 1, step: 0.05, label: "줄기·살 길이" },
          seedJitSpokes: { value: 0, min: 0, max: 1, step: 0.05, label: "살 수" },
          seedJitLight: { value: 0, min: 0, max: 1, step: 0.05, label: "송이 밝기 (1 = 검정~흰색)" },
          seedJitDot: { value: 0.4, min: 0, max: 1, step: 0.05, label: "씨앗·가루 점 크기" },
          seedJitCount: { value: 0.5, min: 0, max: 1, step: 0.05, label: "가루 양" },
          seedJitReach: { value: 0.4, min: 0, max: 1, step: 0.05, label: "가루 거리" },
          seedJitSec: { value: 0.3, min: 0, max: 1, step: 0.05, label: "가루 시간" },
        }),
      }),
      "초점 · 시야": folder({
        // (the focus's distance, width and blur are in 렌더 › 후처리 › 피사계 심도 세부 alone since 2026-11-18 — two copies of
        // the width, one of which did nothing once 렌더 was saved, were half of "심도조절도 되는지 아닌지 헷갈림")
        dof: { value: false, label: "초점 흐림 (피사계 심도 · 거리 · 폭 · 흐림은 렌더 › 후처리 › 피사계 심도 세부)" },
        clickFocus: { value: true, label: "클릭한 곳에 초점 (렌더에서 '따라감'일 때 · 끄면 화면 중앙)" },
        focusSpeed: { value: 4, min: 0.5, max: 20, step: 0.5, label: "초점 옮겨가는 속도" },
        "초점 초기화": button(() => setFocusResets((n) => n + 1)),
        nearFade: { value: [2, 24] as [number, number], min: 0, max: 60, step: 0.5, label: "카메라 가까운 식생 사라짐 (거리)" },
      }),
      "데이터": folder(
        {
          // the lab has its own column (the 테스트 기둥 group), not the shared storage
          ...(lab
            ? {}
            : {
                "기록 다시 읽기": button(() => log.addMany(loadEvents())),
                "세계 지우기": button(() => {
                  if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
                    clearWorld();
                    log.clear();
                  }
                }),
              }),
        },
        { collapsed: true },
      ),
    }),
    { order: lab ? 6 : 0, collapsed: lab },
  );
  // ── 전시 카메라: the wall is a landscape nobody steers; it turns slowly (the artist, 2026-10-30) — see StageCamera.
  // Saved on the rehearsal wall, read by the exhibition wall (same page → same storage key). Keys are stable on purpose:
  // the planned server presets (MacBook → iMac) carry these same names. ──
  const capturePose = useRef(() => {});
  const cam = useControls(
    "전시 카메라",
    savable("전시 카메라", {
      camTurnSec: { value: 180, min: 0, max: 900, step: 5, label: "한 바퀴 (초 · 0 = 멈춤)" },
      camDir: { options: { "한쪽": 1, "반대쪽": -1 }, value: 1, label: "도는 방향" },
      // DEFAULT FRAMING (the fusion session, 2026-10-30): the fused mass, resin and fossils begin 45–54 slots below the
      // present (45+ world down); aimed at the present from 28.5 away the 40° view showed ±10 world and the fossil band
      // never. Target 25 below the present, 75 away at 58°: the present near the top edge, the band near the bottom.
      camDist: { value: 75, min: 4, max: 200, step: 0.5, label: "거리" },
      camPolar: { value: 58, min: 1, max: 179, step: 1, label: "높이 각 (0 = 바로 위 · 90 = 지평선)" },
      camAzimuth: { value: 36, min: 0, max: 360, step: 1, label: "시작 방향 (도)" },
      camLook: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
      camLift: { value: -25, min: -60, max: 30, step: 0.5, label: "초점 높이 (시간축 위에 더함 · 음수 = 아래)" },
      "현재 시점 가져오기 (그다음 save)": button(() => capturePose.current()),
      // THE AUTO RUN (the artist, 2026-10-31: not one fixed angle — the whole fossil, the view from above…): the pose
      // above is the base shot; these are the others, cycled by the clock — docs/camera-motion.md. Off by default: the
      // wall starts to move only once this is switched on and saved on the rehearsal wall.
      "자동 운행 (샷)": folder(
        {
          camAuto: { value: false, label: "켜기 (켜고 save → 전시 벽이 돈다)" },
          camFadeSec: { value: 12, min: 3, max: 60, step: 1, label: "전환 (초)" },
          camHoldSec: { value: 90, min: 10, max: 900, step: 5, label: "기본 샷 머무는 초" },
          "샷 1 · 화석 전체뷰": folder(
            {
              camShot1On: { value: true, label: "켜기" },
              camShot1Dist: { value: 140, min: 4, max: 200, step: 0.5, label: "거리" },
              camShot1Polar: { value: 72, min: 1, max: 179, step: 1, label: "높이 각" },
              camShot1Look: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
              camShot1Lift: { value: -48, min: -120, max: 30, step: 0.5, label: "초점 높이" },
              camShot1HoldSec: { value: 60, min: 10, max: 900, step: 5, label: "머무는 초" },
              camShot1Turn: { value: 1, min: 0, max: 2, step: 0.1, label: "자전 배율" },
            },
            { collapsed: true },
          ),
          "샷 2 · 위에서 내려다봄": folder(
            {
              camShot2On: { value: true, label: "켜기" },
              camShot2Dist: { value: 60, min: 4, max: 200, step: 0.5, label: "거리" },
              camShot2Polar: { value: 12, min: 1, max: 179, step: 1, label: "높이 각" },
              camShot2Look: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
              camShot2Lift: { value: 0, min: -120, max: 30, step: 0.5, label: "초점 높이" },
              camShot2HoldSec: { value: 45, min: 10, max: 900, step: 5, label: "머무는 초" },
              camShot2Turn: { value: 0.5, min: 0, max: 2, step: 0.1, label: "자전 배율" },
            },
            { collapsed: true },
          ),
          "샷 3 · 현재 가까이": folder(
            {
              camShot3On: { value: true, label: "켜기" },
              camShot3Dist: { value: 30, min: 4, max: 200, step: 0.5, label: "거리" },
              camShot3Polar: { value: 62, min: 1, max: 179, step: 1, label: "높이 각" },
              camShot3Look: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
              camShot3Lift: { value: 1, min: -120, max: 30, step: 0.5, label: "초점 높이" },
              camShot3HoldSec: { value: 60, min: 10, max: 900, step: 5, label: "머무는 초" },
              camShot3Turn: { value: 0.7, min: 0, max: 2, step: 0.1, label: "자전 배율" },
            },
            { collapsed: true },
          ),
          "샷 4": folder(
            {
              camShot4On: { value: false, label: "켜기" },
              camShot4Dist: { value: 75, min: 4, max: 200, step: 0.5, label: "거리" },
              camShot4Polar: { value: 58, min: 1, max: 179, step: 1, label: "높이 각" },
              camShot4Look: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
              camShot4Lift: { value: -25, min: -120, max: 30, step: 0.5, label: "초점 높이" },
              camShot4HoldSec: { value: 60, min: 10, max: 900, step: 5, label: "머무는 초" },
              camShot4Turn: { value: 1, min: 0, max: 2, step: 0.1, label: "자전 배율" },
            },
            { collapsed: true },
          ),
          "샷 5": folder(
            {
              camShot5On: { value: false, label: "켜기" },
              camShot5Dist: { value: 75, min: 4, max: 200, step: 0.5, label: "거리" },
              camShot5Polar: { value: 58, min: 1, max: 179, step: 1, label: "높이 각" },
              camShot5Look: { value: [0, 0] as [number, number], min: -100, max: 100, step: 0.5, label: "바라보는 자리 (x · z)" },
              camShot5Lift: { value: -25, min: -120, max: 30, step: 0.5, label: "초점 높이" },
              camShot5HoldSec: { value: 60, min: 10, max: 900, step: 5, label: "머무는 초" },
              camShot5Turn: { value: 1, min: 0, max: 2, step: 0.1, label: "자전 배율" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: true },
      ),
      camFollow: { options: { "자동 (내가 조용하면 최신)": "auto", "나 (개인 탭)": "me", "최신 (봇 포함)": "latest" }, value: "auto" as FollowWho, label: "따라갈 대상" },
      camQuietSec: { value: 30, min: 5, max: 600, step: 5, label: "자동: 내가 이만큼 조용하면 최신으로 (초)" },
      "해 (자동 운행)": folder({
        sunTurnMin: { value: 90, min: 0, max: 480, step: 1, label: "해 방위 한 바퀴 (분 · 0 = 고정)" },
        sunDir: { options: { "한쪽": 1, "반대쪽": -1 }, value: 1, label: "해 도는 방향" },
        sunSwing: { value: 10, min: 0, max: 60, step: 1, label: "해 고도 흔들림 (± ° · 0 = 고정)" },
        sunSwingMin: { value: 30, min: 1, max: 480, step: 1, label: "해 고도 한 주기 (분)" },
      }),
    }),
    { order: 1, collapsed: lab },
  );
  // the button: the view as it is now (after dragging / zooming on the rehearsal wall) put into the values above
  useEffect(() => {
    capturePose.current = () => {
      const o = controls.current;
      if (!o) return;
      const dx = o.object.position.x - o.target.x;
      const dy = o.object.position.y - o.target.y;
      const dz = o.object.position.z - o.target.z;
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-3) return;
      const half = (x: number) => Math.round(x * 2) / 2;
      const set = (k: string, val: unknown) => {
        try {
          levaStore.setValueAtPath(`전시 카메라.${k}`, val, true);
        } catch {
          /* the group is not mounted */
        }
      };
      set("camDist", THREE.MathUtils.clamp(half(r), 4, 200));
      set("camPolar", Math.round(THREE.MathUtils.clamp(Math.acos(dy / r) / DEG, 1, 179)));
      set("camAzimuth", Math.round((((Math.atan2(dx, dz) / DEG) % 360) + 360) % 360) % 360);
      set("camLook", [THREE.MathUtils.clamp(half(o.target.x), -100, 100), THREE.MathUtils.clamp(half(o.target.z), -100, 100)]);
      set("camLift", THREE.MathUtils.clamp(half(o.target.y - focusRef.current), -60, 30));
    };
  }, []);
  // the shot sequence the auto run plays (docs/camera-motion.md §1): the pose above as the base, then the enabled shots
  // MEASUREMENT SWITCH `?cam=band` (2026-11-01, the reset): a fixed framing that shows the fusion band whatever the
  // saved camera says — focus 45 slots below the present, polar 62°, distance 120, no auto run, no turn
  // THE REDESIGN: the camera does not move by itself (the artist, 2026-11-12: "카메라 자동이동 좀 꺼줘", twice) — no
  // turning, no automatic shots, and it does not climb with the present either (`follow` below: it goes to the
  // present once when the view opens, then stays); the mouse moves it
  const camBase = REDESIGN ? { ...cam, camAuto: false, camTurnSec: 0 } : cam;
  const camView = params.get("cam") === "band" ? { ...camBase, camAuto: false, camLift: -45, camPolar: 62, camDist: 120, camTurnSec: 0 } : camBase;
  const shotSeq: ShotSequence = {
    base: { id: 0, dist: camView.camDist, polar: camView.camPolar, lookX: camView.camLook[0], lookZ: camView.camLook[1], lift: camView.camLift, turn: 1, holdSec: camView.camHoldSec },
    shots: [
      shotFrom(1, cam.camShot1On, cam.camShot1Dist, cam.camShot1Polar, cam.camShot1Look, cam.camShot1Lift, cam.camShot1HoldSec, cam.camShot1Turn),
      shotFrom(2, cam.camShot2On, cam.camShot2Dist, cam.camShot2Polar, cam.camShot2Look, cam.camShot2Lift, cam.camShot2HoldSec, cam.camShot2Turn),
      shotFrom(3, cam.camShot3On, cam.camShot3Dist, cam.camShot3Polar, cam.camShot3Look, cam.camShot3Lift, cam.camShot3HoldSec, cam.camShot3Turn),
      shotFrom(4, cam.camShot4On, cam.camShot4Dist, cam.camShot4Polar, cam.camShot4Look, cam.camShot4Lift, cam.camShot4HoldSec, cam.camShot4Turn),
      shotFrom(5, cam.camShot5On, cam.camShot5Dist, cam.camShot5Polar, cam.camShot5Look, cam.camShot5Lift, cam.camShot5HoldSec, cam.camShot5Turn),
    ].filter((s): s is Shot => s !== null),
    fadeSec: cam.camFadeSec,
  };
  const tAxis = useLevaControls(
    "시간축",
    savable("시간축", {
      secPerUnit: { value: SPACE_BOXES.secPerUnit, min: 2, max: 600, step: 1, label: "한 단 = 몇 초" },
      unit: { value: DEFAULT_BOXES.unit, min: 0.2, max: 4, step: 0.1, label: "한 단의 높이 (월드)" },
      timeJitter: { value: SPACE_BOXES.timeJitter ?? 0, min: 0, max: 1, step: 0.05, label: "시간 오차 (부품·식생 위치 ±단)" },
      emptyGapSec: { value: SPACE_FOLD.emptyGapSec, min: 1, max: 600, step: 1, label: "빈 시간으로 볼 공백 (s)" },
    }),
    { order: 1 },
  );
  // the world clock's rate (worldClock.ts): shared by every tab, so the player tabs and their bots run faster too;
  // not saved with the group (it is the world's state, not a look)
  const clock = useLevaControls(
    "시간축",
    {
      timeRate: {
        value: clk.rate(),
        min: lab ? MIN_TIME_RATE : 0.2, // standing still only in the lab (the shared clock stops every tab)
        max: MAX_TIME_RATE,
        step: 0.1,
        label: lab ? "시간 배율 (이 탭만, 0 = 정지 · 작업 모드)" : "시간 배율 (모든 탭 공유, 1 = 실제 속도)",
        onChange: (r: number) => clk.setRate(r),
        transient: false, // also returned, for the readout
      },
      // quick presets for watching an iteration: stand still (lab), slow motion, real time, fast
      rates: buttonGroup({
        label: "빠르게 고르기",
        opts: Object.fromEntries((lab ? [0, 0.2, 0.5, 1, 5, 20] : [0.2, 0.5, 1, 5, 20]).map((r) => [r === 0 ? "정지" : `×${r}`, () => levaStore.setValueAtPath("시간축.timeRate", r, true)])),
      }),
    },
    { order: 1 },
  );
  // BROUGHT OVER (the artist, 2026-11-12: "좀 더 세세한 파라미터 조정"): the parts' own shapes, as they were
  const bld = useLevaControls(
    "건물",
    savable("건물", {
      partWidth: { value: SPACE_BOXES.width, min: 0.3, max: 3, step: 0.05, label: "부품 폭 배율" },
      partDensity: { value: SPACE_BOXES.density, min: 0.2, max: 4, step: 0.1, label: "단당 매스 수 배율" },
      "막대 묶음 · 드립": folder(
        {
          slatOn: { value: RC.slat.enabled, label: "큰 매스를 막대 묶음으로" },
          slatMinFootprint: { value: RC.slat.minFootprint, min: 0.2, max: 4, step: 0.05, label: "묶음이 되는 최소 크기 (칸)" },
          slatWidth: { value: RC.slat.width, min: 0.03, max: 1, step: 0.01, label: "막대 굵기 (칸)" },
          slatDensity: { value: RC.slat.density, min: 0.1, max: 1, step: 0.05, label: "막대 채움 비율" },
          slatMax: { value: RC.slat.maxPerMass, min: 4, max: 200, step: 1, label: "매스당 최대 막대 수" },
          slatVertical: { value: RC.slat.vertical, min: 0, max: 1, step: 0.05, label: "세로(매달린) 묶음 비율" },
          slatShortest: { value: RC.slat.shortest, min: 0.05, max: 1, step: 0.05, label: "매달린 막대 최소 길이 (매스 대비)" },
          dripPerArea: { value: RC.drip.perArea, min: 0, max: 6, step: 0.1, label: "드립: 칸²당 개수" },
          dripMax: { value: RC.drip.max, min: 0, max: 60, step: 1, label: "드립: 부품당 최대" },
          dripLength: { value: RC.drip.length, min: 0.02, max: 6, step: 0.01, label: "드립: 길이 (단)" },
          dripAlpha: { value: RC.drip.alpha, min: 0.3, max: 4, step: 0.05, label: "드립: 길이 분포 (작을수록 긴 것 많음)" },
          dripWidth: { value: RC.drip.width, min: 0.01, max: 0.4, step: 0.01, label: "드립: 굵기 (칸)" },
        },
        { collapsed: true },
      ),
      "철골": folder(
        {
          beamChance: { value: RC.beam.chance, min: 0, max: 1, step: 0.01, label: "가로보: 슬롯당 확률" },
          beamLength: { value: RC.beam.length, min: 0.3, max: 12, step: 0.1, label: "가로보: 길이 (칸)" },
          beamWidth: { value: RC.beam.width, min: 0.01, max: 0.5, step: 0.01, label: "가로보: 굵기 (칸)" },
          beamOnGrid: { value: RC.beam.onGrid, min: 0, max: 1, step: 0.05, label: "가로보: 격자 정렬 비율" },
          beamSkew: { value: Math.round(RC.beam.skew / DEG), min: 0, max: 45, step: 1, label: "가로보: 최대 기울기 (°)" },
          braceChance: { value: RC.brace.chance, min: 0, max: 1, step: 0.01, label: "사선: 슬롯당 확률" },
          braceLength: { value: RC.brace.length, min: 0.2, max: 8, step: 0.1, label: "사선: 길이 (단)" },
          braceTilt: { value: pair(RC.brace.tilt, 1 / DEG).map(Math.round) as [number, number], min: 0, max: 89, step: 1, label: "사선: 수직에서 기울기 (°)" },
          braceWidth: { value: RC.brace.width, min: 0.01, max: 0.5, step: 0.01, label: "사선: 굵기 (칸)" },
          columnCount: { value: RC.column.count, min: 0, max: 8, step: 1, label: "기둥: 슬래브당 개수" },
          columnWidth: { value: RC.column.width, min: 0.01, max: 0.5, step: 0.01, label: "기둥: 굵기 (칸)" },
        },
        { collapsed: true },
      ),
      "기초": folder(
        {
          plinthFootprint: { value: RC.plinth.footprint, min: 0.3, max: 8, step: 0.1, label: "기단: 크기 (칸)" },
          plinthThick: { value: RC.plinth.thick, min: 0.02, max: 2, step: 0.01, label: "기단: 두께 (단)" },
          basementDepth: { value: RC.basement.depth, min: 0.01, max: 6, step: 0.05, label: "베이스먼트: 깊이 (단)" },
          basementFootprint: { value: RC.basement.footprint, min: 0.1, max: 1, step: 0.05, label: "베이스먼트: 크기 (기단 대비)" },
          pileCount: { value: RC.pile.count, min: 0, max: 10, step: 1, label: "말뚝: 개수" },
          pileDepth: { value: RC.pile.depth, min: 0.05, max: 8, step: 0.05, label: "말뚝: 길이 (단)" },
          pileWidth: { value: RC.pile.width, min: 0.01, max: 0.4, step: 0.01, label: "말뚝: 굵기 (칸)" },
        },
        { collapsed: true },
      ),
    }),
    { order: lab ? 5 : 3, collapsed: lab },
  );
  const wx = useControls(
    "풍화 · 지층",
    savable("풍화 · 지층", {
      wear: { value: true, label: "마모 (끄면 지은 그대로; 엉김·융합도 꺼짐)" },
      strata: { value: DEFAULT_WEATHER.strata, label: "지층: 층마다 자기 나이 (끄면 엉김·융합 꺼짐)" },
      gatherStart: { value: DEFAULT_WEATHER.gatherStart, min: 0, max: 60, step: 1, label: "식생이 모이기 시작하는 깊이 (현재에서 몇 단 아래)" },
      gatherRise: { value: DEFAULT_WEATHER.gatherRise, min: 0, max: 60, step: 1, label: "식생이 다 모이기까지 (단)" },
      // V2: the whole life (gathering → growths → fusion) fits in the kept history (log.ts KEEP_WINDOW_SEC, 60 slots of
      // 20 s): rot from 12–21 slots down, growths by 20–30, fused by ~40 (the old values only began growing at the cut)
      rotDose: { value: isV2 ? V2_ROT_DOSE : DEFAULT_WEATHER.rotDose, min: 0, max: 80, step: 0.5, label: "부패가 시작되는 모인 양 (밀도 × 함께 묻힌 단)" },
      timeScale: { value: isV2 ? V2_TIME_SCALE : DEFAULT_WEATHER.timeScale, min: 0.001, max: 1, step: 0.001, label: "풍화 속도" },
      ageJitter: { value: DEFAULT_WEATHER.ageJitter, min: 0, max: 1, step: 0.05, label: "풍화 오차 (부품마다 나이 ±)" },
      concreteLife: { value: DEFAULT_WEATHER.concreteLife, min: 0.05, max: 5, step: 0.05, label: "콘크리트 수명 배율" },
      steelLife: { value: DEFAULT_WEATHER.steelLife, min: 0.05, max: 5, step: 0.05, label: "철골 수명 (슬래브 대비)" },
      tauSedimentYears: { value: DEFAULT_WEATHER.tauSedimentYears, min: 10, max: 20000, step: 10, label: "식생 → 부식토/이탄 (년)" },
      "매몰 · 식생 영향": folder(
        {
          coverSlots: { value: DEFAULT_WEATHER.coverSlots, min: 0, max: 20, step: 1, label: "부재가 덮였다고 볼 위층 수 (0 = 끔)" },
          buriedSlow: { value: DEFAULT_WEATHER.buriedSlow, min: 1, max: 500, step: 1, label: "덮인 부재는 몇 배 느리게 부식" },
          natureAccel: { value: DEFAULT_WEATHER.natureAccel, min: 0, max: 5, step: 0.1, label: "식생이 부식을 빠르게 하는 정도" },
        },
        { collapsed: true },
      ),
    },
    [],
    // V2: once, the saved values follow the defaults that fit the kept history (2026-10-11)
    isV2 ? [{ tag: "fit-history-2026-10-11", set: { rotDose: V2_ROT_DOSE, timeScale: V2_TIME_SCALE } }] : []),
    { order: lab ? 3 : 7 },
  );
  const weather = useMemo<WeatherConfig>(
    () => ({
      // THE REDESIGN: no weathering, no wear for now (the artist, 2026-11-12: "풍화, 마모는 꺼두는 게 좋겠어")
      strata: wx.strata && !REDESIGN,
      timeScale: wx.timeScale,
      steelLife: wx.steelLife,
      concreteLife: wx.concreteLife,
      tauSedimentYears: wx.tauSedimentYears,
      coverSlots: wx.coverSlots,
      buriedSlow: wx.buriedSlow,
      natureAccel: wx.natureAccel,
      ageJitter: wx.ageJitter,
      gatherStart: wx.gatherStart,
      gatherRise: wx.gatherRise,
      rotDose: wx.rotDose,
    }),
    [wx.strata, wx.timeScale, wx.steelLife, wx.concreteLife, wx.tauSedimentYears, wx.coverSlots, wx.buriedSlow, wx.natureAccel, wx.ageJitter, wx.gatherStart, wx.gatherRise, wx.rotDose],
  );
  const veg = useControls(
    "식생",
    savable("식생", {
      natureOn: { value: true, label: "켜기" },
      // THE SEDIMENT VEGETATION IS GONE (the artist, 2026-11-12). Its history is still read by the fusion and the gatherings:
      "식생의 기록 (그리지 않음 · 융합과 건물 식생이 읽음)": folder({
        window: { value: 120, min: 10, max: 600, step: 10, label: "읽는 시간 범위 (±단)" },
        margin: { value: 5, min: 0, max: 30, step: 1, label: "방문 범위 바깥 여백 (칸)" },
      }),
      "건물에 모이는 식생": folder({
        gatherOn: { value: true, label: "켜기 (부식 초기, 덩어리 전)" },
        gatherPerArea: { value: 40, min: 0, max: 300, step: 1, label: "칸²당 점 수" },
        gatherSize: { value: 0.3, min: 0.02, max: 1.5, step: 0.01, label: "구 지름 (월드)" },
        gatherJitter: { value: 0.5, min: 0, max: 0.95, step: 0.05, label: "구 크기 지터 (±)" },
        gatherPoints: { value: 24, min: 4, max: 96, step: 1, label: "구 하나의 점 수 (많을수록 무거움)" },
        gatherDot: { value: 0.025, min: 0.005, max: 0.15, step: 0.001, label: "구 속 점 크기" },
        tauReclaimYears: { value: 300, min: 10, max: 10000, step: 10, label: "재점유 속도 (년; 마모를 끈 경우에만)" },
      }),
    }),
    { order: lab ? 4 : 6 },
  );
  // the PRESENT thickness (풍화 · 지층: the rot onset): layers within it still change, those below are kept
  const presentSlots = Math.max(1, Math.round(rotOnsetSlots(weather)));
  const presentRef = useRef(presentSlots);
  presentRef.current = presentSlots;
  const presentMonitor = monitor(() => presentRef.current, { graph: false });
  const PRESENT = "지금 '현재' 두께 (단 · 풍화 · 지층에서 정함)";
  // ── 길 → 다리 (V2): the ground (buildings and trodden paths, first comes first) → walkways between buildings ──
  // (the folder of the paths: its name and its inputs are today's — the artist, 2026-11-12: "안 쓰는 레바 말고 지금에
  // 맞게 하라고"; what was saved under the old names is read as before)
  const WALK_GROUP = "길";
  const WALK_GROUP_OLD = "길 → 다리";
  const fold = useFoldControls(SPACE_FOLD, {
    hidden: REDESIGN,
    folder: "생성 규칙 (회사원 시공간 밀집)",
    collapsed: true,
    order: lab ? 8 : 2,
    flow: {
      path: `${WALK_GROUP}.밟힘 (걸음이 땅을 다지고 · 안 다니면 되돌아옴)`,
      shown: true,
      order: 1,
      legacy: [`${WALK_GROUP_OLD}.① 땅: 밟힘 → 길 (V2 · 건물과 먼저 온 쪽이 자리)`, `${WALK_GROUP_OLD}.① 길: 밟힘 (V2 · 유지되는 유통량)`, "생성 규칙 (회사원 시공간 밀집)"],
      keep: ["flowOn", "flowUnit", "tauSec", "stayRadius", "staySec"],
      labels: {
        flowOn: "켜기 (꺼지면 길이 안 생김)",
        flowUnit: "길이 되는 밟힘 (이만큼 밟히면 63 %)",
        tauSec: "안 다니면 되돌아오는 시간 (s)",
        stayRadius: "머묾으로 치는 반경 (월드 · 그 밖은 걸음)",
        staySec: "머묾으로 치는 시간 (s)",
      },
    },
  });
  // V2: bots run from here, without a player tab (useGlobalBots.ts)
  // how deep (slots) the bots write below the present: while they do, no part's shape is frozen (below)
  const [botDepth, setBotDepth] = useState(0);
  // the bots' village sites: the pipes are laid in villages only (water.ts WaterConfig.villages)
  const [botVillages, setBotVillages] = useState<WaterConfig["villages"] | null>(null);
  // (the herds count a 단 as the wall's time axis does — its seconds and its height: useGlobalBots slotSec)
  const botOpts = useMemo(
    () => ({ ...(lab ? { clock: clk, local: true, still: true, epochMs: labWorld.world?.epochMs ?? 0, taken: labWorld.world?.id ?? 0 } : {}), setDepth: setBotDepth, setVillages: setBotVillages, slotSec: tAxis.secPerUnit, unit: tAxis.unit }),
    [lab, clk, labWorld.world, tAxis.secPerUnit, tAxis.unit],
  );
  const globalBots = useGlobalBots(log, fold, isV2, lab ? 7 : 1.5, botOpts);
  // EMPTY THE WORLD AND LET IT BE MADE AGAIN (the artist, 2026-11-15: "지우고 다시 생성하기 레바 버튼 넣기"), at the top
  // of the panel. The lab's world is this tab's only; the wall's is the shared one (every open tab follows), so there
  // it asks first. The bots start over with a fresh crowd (useGlobalBots), the wall and the bots' ground from nothing.
  const [worldResets, setWorldResets] = useState(0);
  const resetWorld = useRef(() => {});
  resetWorld.current = () => {
    // (the lab makes no world of its own: its world is taken from the wall's again — the wall's is not touched)
    if (lab) {
      labWorld.retake();
      return;
    }
    if (!window.confirm("세계를 비우고 처음부터 다시 생성할까요? (열려 있는 다른 탭도 따라옵니다)")) return;
    clearWorld();
    log.clear();
    setWorldResets((n) => n + 1);
  };
  // (the bots' copy of what is built is made again from the log for every world the lab takes)
  const takenId = labWorld.world?.id ?? 0;
  useEffect(() => {
    if (takenId > 0) setWorldResets((n) => n + 1);
  }, [takenId]);
  // THE LAB'S OWN BUTTONS (not saved): the world taken again, the moment of taking, and time jumped ahead — the rate
  // itself is 시간축 › 시간 배율 (standing still at first)
  useLevaControls(
    "랩 — 벽의 세계를 한 번 따온 것 (봇 없음 · 이 탭만)",
    {
      "다시 따오기 (지금 벽의 세계)": button(() => labWorld.retake()),
      "따온 순간으로 되돌리기 (같은 세계 · 시간만 처음으로)": button(() => labWorld.rewind()),
      "시간 건너뛰기": buttonGroup({ label: "시간 건너뛰기", opts: { "+30초": () => labWorld.skip(30), "+1분": () => labWorld.skip(60), "+5분": () => labWorld.skip(300), "+20분": () => labWorld.skip(1200) } }),
    },
    { order: -3, collapsed: false, render: () => lab },
    [labWorld.retake, labWorld.rewind, labWorld.skip],
  );
  // A RENDER MODE FOR TESTING (the artist, 2026-11-15: "테스트 할 때 쓸 퍼포먼스 렌더모드 좀 도입해줘. 이리저리
  // 이터레이션 돌려보는 것도 이게 랙이 적어야 가능한 거니까"): what is computed stays the same — the picture is drawn
  // cheaper. Remembered in this browser (not with the saved looks, and never on the exhibition wall, ?ui=0);
  // `?perf=light|min` sets it by the link.
  const perfFirst = useMemo<TestPerf>(() => {
    try {
      const q = params.get("perf") ?? window.localStorage.getItem(TEST_PERF_KEY);
      return q === "light" || q === "min" ? q : "off";
    } catch {
      return "off";
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // THE CAMERA GOES UP WITH THE RISING BLOCK — or stays where it is put (the artist, 2026-11-15: "카메라 자동으로
  // 따라가지는거 켜고 끌 수 있게 레바도 넣어줘"). Kept in this browser, like the test render.
  // (OFF unless this browser has turned it on — the artist, 2026-11-20: "카메라 같이 올라가는 거 또 자동으로 켜진듯": a
  // browser that had nothing kept, or had it cleared, came up following the block)
  const camRiseFirst = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(CAM_RISE_KEY) === "on";
    } catch {
      return false;
    }
  }, []);
  const world = useLevaControls(
    "세계",
    {
      "지우고 다시 생성하기": button(() => resetWorld.current()),
      testPerf: { options: TEST_PERF_OPTIONS, value: perfFirst, label: "테스트 렌더 (가볍게)" },
      camRise: { value: camRiseFirst, label: "카메라가 올라가는 덩어리를 따라감 (끄면 카메라는 둔 자리에 그대로)" },
    },
    { order: 0.4, render: () => isV2 },
  );
  const testPerf: TestPerf = hideUi ? "off" : (world.testPerf as TestPerf);
  useEffect(() => {
    if (hideUi) return;
    try {
      window.localStorage.setItem(TEST_PERF_KEY, world.testPerf as string);
    } catch {
      /* storage unavailable */
    }
  }, [hideUi, world.testPerf]);
  useEffect(() => {
    try {
      window.localStorage.setItem(CAM_RISE_KEY, world.camRise ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
  }, [world.camRise]);
  // THE BUILDINGS' RULE (lib/parliament/density.ts): a threshold on what has been put into each cell-slot. Off = the fold.
  const DENSITY_GROUP = "건물 생성 (칸 밀도 계단)";
  const dn = useLevaControls(
    DENSITY_GROUP,
    savable(DENSITY_GROUP, {
      densityOn: { value: true, label: "새 규칙 (끄면 예전 접기)" },
      dVisitors: { value: DEFAULT_DENSITY.minVisitors, min: 1, max: 10, step: 1, label: "필요한 사람 수 (서로 다른)" },
      dStep: { value: DEFAULT_DENSITY.step, min: 5, max: 200, step: 5, label: "문턱 (머묾의 양 · 넘으면 지어짐)" },
      // A BUILDING GROWS WITH WHAT IS STAYED (the artist, 2026-11-15: "더 머물러도 건물이 너무 일찍 성장을 멈춤",
      // "어차피 침식 가져왔으니 건물도 더 지어져도 상관없어"): the levels are back — every doubling of what was put
      // into a cell-slot is one more level (bigger and more parts), and one person may put in more than before, so one
      // herd that stays on raises it too. 1 level = a threshold and nothing after (as on 11/12).
      // (a new input: the count now reads what was stayed in the building up to each slot — density.ts)
      dGrow: { value: 6, min: 1, max: 10, step: 1, label: "머물수록 커짐: 계단 수 (한 건물에 머문 양이 쌓여 두 배가 될 때마다 한 계단 · 1 = 안 커짐)" },
      // (how much more must be stayed for each further level: at ×2 every cell of a building was at the top level within
      // a minute or two — all alike again; at ×3 the middle of where people stood grows well ahead of its edges)
      dGrowEvery: { value: 3, min: 1.5, max: 6, step: 0.25, label: "한 계단 오르는 데 필요한 머묾의 배수 (클수록 천천히 · 가운데와 가장자리가 달라짐)" },
      dGrowBy: { value: 1.45, min: 1, max: 2.5, step: 0.05, label: "한 계단마다 커지는 배율" },
      // (seeds.ts growCount: larger parts, hardly more of them — "엇비슷한 하얀 네모만 엄청 많아져서")
      dGrowCount: { value: 0.15, min: 0, max: 1, step: 0.05, label: "커질 때 매스 수가 느는 정도 (0 = 크기만 커짐 … 1 = 수도 같이, 하얀 상자가 많아짐)" },
      dCap: { value: 60, min: 10, max: 200, step: 5, label: "한 사람이 한 칸에 보탤 수 있는 최대 (클수록 한 무리가 오래 머물러 더 키움)" },
      dRadius: { value: DEFAULT_DENSITY.radius, min: 1, max: 8, step: 0.25, label: "옆으로 닿는 반경 (월드)" },
      dTime: { value: DEFAULT_DENSITY.timeSec, min: 0, max: 300, step: 10, label: "시간으로 닿는 범위 (s)" },
      dMaxBuilt: { value: 8000, min: 0, max: 60000, step: 500, label: "남기는 건물 칸 수 (넘으면 가장 먼저 지어진 칸부터 사라짐 · 0 = 한도 없음)" },
      dDown: { value: DEFAULT_DENSITY.down, min: 0, max: 1, step: 0.05, label: "아래로도 닿는 비율 (0 = 위로만)" },
      // NEAR BUILDINGS ARE ONE (density.ts mergeGap; the artist, 2026-11-15: "가까이 있으면 병합되도록")
      dMerge: { value: 3, min: 0, max: 10, step: 1, label: "가까운 건물 병합: 틈이 이 칸 수 이하이면 메워 한 건물로 (0 = 끔)" },
      dMergeThick: { value: 2, min: 1, max: 8, step: 1, label: "메운 자리의 최소 두께 (단 · 1 = 한 겹짜리도 메움)" },
      // THE ORDER OF BUILDING IS THE TIME AXIS (seeds.ts buildKeep): slots above a building's beginning until it is complete
      buildSlots: { value: 3, min: 0, max: 20, step: 1, label: "다 지어지기까지 (단 · 0 = 한꺼번에)" },
    }),
    { order: lab ? 7.5 : 1.6, render: () => isV2 },
  );
  // DISTRICTS (seeds.ts VarietyConfig): the buildings of one neighbourhood turned and shaped alike, unlike the next
  const VARIETY_GROUP = "건물 변주 (구역마다 다르게)";
  const vr = useLevaControls(
    VARIETY_GROUP,
    savable(VARIETY_GROUP, {
      varietyOn: { value: true, label: "켜기" },
      vSize: { value: DEFAULT_VARIETY.size, min: 3, max: 60, step: 1, label: "구역 크기 (월드)" },
      vAngle: { value: Math.round(DEFAULT_VARIETY.angle / DEG), min: 0, max: 90, step: 1, label: "각도 변주 (± °)" },
      vAngleStep: { value: 0, min: 0, max: 45, step: 5, label: "각도 단위 (° · 0 = 아무 각도)" },
      vWidth: { value: DEFAULT_VARIETY.width, min: 0, max: 0.9, step: 0.05, label: "폭 변주 (±)" },
      vHeight: { value: DEFAULT_VARIETY.height, min: 0, max: 0.9, step: 0.05, label: "매스 높이 변주 (±)" },
      vCharacter: { value: DEFAULT_VARIETY.character, min: 0, max: 1, step: 0.05, label: "유형 차이 (판 · 탑 · 뼈대 · 다발)" },
    }),
    { order: lab ? 7.6 : 1.65, render: () => isV2 },
  );
  // BUILDINGS ARE BUILT, THEY DO NOT POP (lib/parliament/arrive.ts, arriveMaterial.ts — the artist, 2026-11-12: "건물
  // 지어지는 거 좀 더 연속적으로 보이게 가능한가?"): a part that has just appeared comes in over a short time
  const ARRIVE_GROUP = "건물이 지어지는 모습";
  const ar = useLevaControls(
    ARRIVE_GROUP,
    savable(ARRIVE_GROUP, {
      arriveOn: { value: true, label: "켜기 (끄면 한 번에 나타남)" },
      arriveWay: { value: "tick", options: { "틱마다 하나씩 (통째로 · 규칙이 낸 순서)": "tick", "바닥에서 자라남": "grow", "위에서 내려앉음": "settle", "가운데서 부풀어 오름": "swell" }, label: "들어오는 방식" },
      arriveTick: { value: 0.12, min: 0.01, max: 2, step: 0.01, label: "틱 간격 (s · 한 건물의 부품 하나마다)", render: (get: (path: string) => unknown) => get(`${ARRIVE_GROUP}.arriveWay`) === "tick" },
      arriveSec: { value: 2.5, min: 0.2, max: 20, step: 0.1, label: "부품 하나가 들어오는 시간 (s)", render: (get: (path: string) => unknown) => get(`${ARRIVE_GROUP}.arriveWay`) !== "tick" },
      arriveStagger: { value: 4, min: 0, max: 30, step: 0.5, label: "한 단의 부품이 차례로 시작하는 폭 (s · 0 = 한꺼번에)", render: (get: (path: string) => unknown) => get(`${ARRIVE_GROUP}.arriveWay`) !== "tick" },
arriveLift: { value: 1.5, min: 0, max: 10, step: 0.1, label: "내려앉는 높이 (월드)", render: (get: (path: string) => unknown) => get(`${ARRIVE_GROUP}.arriveWay`) === "settle" },
    }),
    { order: lab ? 7.65 : 1.66, render: () => isV2 },
  );
  const arriveView = useMemo(() => ({ on: ar.arriveOn, sec: ar.arriveSec, stagger: ar.arriveStagger, way: ar.arriveWay as ArriveWay, lift: ar.arriveLift, tick: ar.arriveTick }), [ar.arriveOn, ar.arriveSec, ar.arriveStagger, ar.arriveWay, ar.arriveLift, ar.arriveTick]);
  // THE PATHS, STAGE 1 (lib/parliament/trails.ts): every walk as a thread through the block
  // THE VEGETATION, AS THE OPPOSITE OF PEOPLE (Vegetation above)
  const VEG_GROUP = "식생 (사람의 반대)";
  // (a knob only one way of moving reads is listed only while that way is on; its value is kept)
  const vegFlowOnly = (get: (path: string) => unknown) => get(`${VEG_GROUP}.vegMotion`) === "flow";
  const vegCloudOnly = (get: (path: string) => unknown) => get(`${VEG_GROUP}.vegMotion`) !== "flow";
  const vg = useLevaControls(
    VEG_GROUP,
    savable(VEG_GROUP, {
      vegOn: { value: true, label: "켜기" },
      // HOW IT MOVES (the artist, 2026-11-21: "식생구름 허공에서 돌아다니게 하는 것보다 그냥 전체 식생 생성해서 밀도장 따라
      // curl 처럼 몰려다니게"): the clouds seated again (as before), or every point flowing on the GPU (vegFlow.ts)
      vegMotion: { value: "cloud", options: { "구름 (지금 · 구름이 자리를 옮김)": "cloud", "흐름 (새 · 전체 점이 밀도장을 따라 몰려다님 · GPU)": "flow" }, label: "식생 움직임" },
      vegFlowSpeed: { value: 2, min: 0, max: 8, step: 0.1, label: "흐름 빠르기 (대략 월드/s · 0 = 멈춤)", render: vegFlowOnly },
      vegFlowSwirl: { value: 14, min: 3, max: 60, step: 1, label: "소용돌이 크기 (월드 · 클수록 큰 물결)", render: vegFlowOnly },
      vegFlowFollow: { value: 1, min: 0, max: 3, step: 0.05, label: "밀도장을 따르는 세기 (건물·길·물가를 돌아 흐르고 빈 땅으로 몰림 · 범위 밖 점을 불러옴 · 0 = 소용돌이만)", render: vegFlowOnly },
      vegFlowHerd: { value: 0.5, min: 0, max: 2, step: 0.05, label: "떼로 뭉치는 세기 (0 = 고르게 퍼져 흐름)", render: vegFlowOnly },
      vegFlowStray: { value: 0, min: 0, max: 190, step: 2, label: "점이 만들어진 자리에서 멀어질 수 있는 거리 (월드 · 0 = 제한 없음: 사람 땅 둘레로 다 몰려옴)", render: vegFlowOnly },
      vegCount: { value: 60000, min: 5000, max: 400000, step: 5000, label: "점 수 (덩어리 전체 · 한 번만 만듦)" },
      // (the artist, 2026-11-15: "식생반경이 알아서 돌아다닌 범위 살짝 바깥에만 마진 두고 생성되게")
      vegMargin: { value: 8, min: -1, max: 60, step: 1, label: "돌아다닌 범위 바깥으로 식생이 옅어지며 나는 폭 (월드 · 이 거리에서 절반, 1.7배에서 없음 · -1 = 땅 전체에)" },
      vegSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "점 크기 (월드)" },
      vegSpots: { value: 40, min: 0, max: 200, step: 1, label: "구름 수 (0 = 어디나 고르게)", render: vegCloudOnly },
      vegCloudR: { value: 9, min: 1, max: 60, step: 0.5, label: "구름의 반경: 땅 (월드 · 평균)", render: vegCloudOnly },
      vegCloudT: { value: 5, min: 0.5, max: 60, step: 0.5, label: "구름의 반경: 시간 (단 · 평균)", render: vegCloudOnly },
      vegMoveSec: { value: 8, min: 0, max: 120, step: 2, label: "구름 자리를 다시 보는 간격 (s · 0 = 안 옮김)", render: vegCloudOnly },
      vegMoveAt: { value: 0.2, min: 0.02, max: 1, step: 0.02, label: "자리에 사람이 이만큼 차면 빈 곳으로 옮김", render: vegCloudOnly },
      // SOFTLY, AS THE LAYER ABOVE'S (VEG_VERT; the artist, 2026-11-20: "글로벌 식생도 미래처럼 연속적으로 움직이게 해줘")
      // (the same key: now the time of a cloud's way to a place near by — it goes there, it no longer fades out and in)
      vegEase: { value: 3, min: 0, max: 20, step: 0.5, label: "배경 구름이 옆 자리로 옮겨 가는 시간 (s · 사람에게 밀려난 구름이 미끄러지듯 감 · 먼 자리는 더 오래, 최대 40초 · 0 = 순간이동 · 점도 한꺼번에 나타나고 사라짐)", render: vegCloudOnly },
      // THE BACKGROUND CLOUDS MOVE (VEG_VERT; the artist, 2026-11-20: "배경 구름들 유기적으로 움직이게 해달라고")
      vegSway: { value: 3, min: 0, max: 12, step: 0.25, label: "배경 구름이 제자리에서 떠도는 폭 (월드 · 0 = 가만히)", render: vegCloudOnly },
      vegSwaySec: { value: 40, min: 6, max: 240, step: 2, label: "떠도는 한 바퀴의 시간 (s · 클수록 느림 · 구름마다 조금씩 다름)", render: vegCloudOnly },
      vegOrganic: { value: 0.6, min: 0, max: 1, step: 0.05, label: "구름 속 점들이 숨 쉬고 천천히 도는 정도 (0 = 구름 모양은 그대로)", render: vegCloudOnly },
      vegCloudJit: { value: 0.4, min: 0, max: 0.9, step: 0.05, label: "구름 크기 지터 (± · 0 = 다 같은 크기)", render: vegCloudOnly },
      // (the artist, 2026-11-16: "권역 나누기"): belts on the borders between the villages (villageBorders.ts)
      vegBelt: { value: 0.6, min: 0, max: 1, step: 0.05, label: "마을 경계에 띠로 서는 식생 비율 (권역 · 구름: 구름의 비율 · 흐름: 점의 비율 · 0 = 아무 데나)" },
      vegLobed: { value: 0.3, min: 0, max: 1, step: 0.05, label: "두 갈래 구름의 비율 (나머지는 둥근 구름)", render: vegCloudOnly },
      vegFull: { value: 1, min: 0.05, max: 1, step: 0.05, label: "아무도 없는 곳의 무성함 (1 = 점 전부)" },
      vegPathAt: { value: 2, min: 0.25, max: 10, step: 0.25, label: "길에서 다 사라지는 겹침 (꼬리 수)" },
      vegColorA: { value: "#5f7a3a", label: "색 1 (자연색)" },
      vegColorB: { value: "#a9b56a", label: "색 2 (자연색)" },
      // WHAT GATHERS ON BUILDINGS: built but not lived in (density.ts liveAt)
      "건물에 모이는 식생 (지어졌지만 살지 않는 곳)": folder({
        gaOn: { value: true, label: "켜기" },
        gaLiveAt: { value: 0.25, min: 0.02, max: 1, step: 0.01, label: "직접 산 몫이 이만큼이면 안 모임 (작을수록 가장자리에만)" },
        gaPerArea: { value: 40, min: 0, max: 300, step: 1, label: "칸²당 점 뭉치 수 (다 모였을 때)" },
        gaSize: { value: 0.3, min: 0.02, max: 1.5, step: 0.01, label: "뭉치 지름 (월드)" },
        gaJitter: { value: 0.5, min: 0, max: 0.95, step: 0.05, label: "뭉치 크기 지터 (±)" },
        gaPoints: { value: 24, min: 4, max: 96, step: 1, label: "뭉치 하나의 점 수" },
        gaDot: { value: 0.025, min: 0.005, max: 0.15, step: 0.001, label: "점 크기" },
      }),
    }),
    { order: lab ? 7.9 : 1.75, render: () => isV2 },
  );
  // EROSION IN THE BLOCK (lib/parliament/erode.ts): a part is gone by where it lies — how far below the block's top,
  // and how little its place was lived in (the same share the gatherings read). A place, not a clock.
  const ERODE_GROUP = "침식 (깊이 × 살지 않은 정도)";
  const er = useLevaControls(
    ERODE_GROUP,
    savable(ERODE_GROUP, {
      erOn: { value: true, label: "켜기" },
      // ONE LIFE PER PART (erode.ts lifeSec; the artist, 2026-11-15): placed → wait → plants → erosion and mass, in order
      erLife: { value: 180, min: 0, max: 1800, step: 10, label: "진행에 걸리는 시간 (가장 깊은 곳 기준 · 실제 초 · 얕을수록 더 오래 · 0 = 놓이자마자 다)" },
      erWait: { value: 12, min: 0, max: 120, step: 1, label: "놓인 뒤 아무 일 없는 시간 (초 · 깊이와 무관)" },
      // THE TICK (spaceModel: each part goes at its own moment; the artist, 2026-11-15: "침식도 티커 적용해서 부드럽게")
      erSpread: { value: true, label: "한 단계에 깎일 부재를 그 단계에 걸쳐 하나씩 (끄면 예전처럼 한꺼번에)" },
      erLeaveSec: { value: 1.2, min: 0, max: 10, step: 0.1, label: "부재 하나가 줄어들어 사라지는 시간 (s · 0 = 뚝)" },
      erStart: { value: DEFAULT_ERODE.start, min: 0, max: 1, step: 0.01, label: "시작 깊이 (꼭대기에서 · 덩어리 높이의 비율)" },
      erFull: { value: DEFAULT_ERODE.full, min: 0.02, max: 1.5, step: 0.01, label: "다 깎이는 깊이 (덩어리 높이의 비율 · 1 넘으면 바닥에서도 덜 깎임)" },
      erAmount: { value: DEFAULT_ERODE.amount, min: 0, max: 1, step: 0.05, label: "다 깎였을 때 사라지는 몫 (1 = 전부)" },
      erVegPull: { value: DEFAULT_ERODE.vegPull, min: 0, max: 1, step: 0.05, label: "살지 않은 곳이 먼저 (그만큼 더 깊은 셈 · 0 = 깊이만)" },
      erOrder: { value: DEFAULT_ERODE.order, min: 0, max: 1, step: 0.05, label: "지은 순서의 역순으로 (1 = 뼈대가 끝까지 남음 · 0 = 종류 무관)" },
      erPatch: { value: DEFAULT_ERODE.patch, min: 0, max: 1, step: 0.05, label: "뭉텅이로 깎임 (0 = 부재 하나씩 흩어져서)" },
      erGrain: { value: DEFAULT_ERODE.grain, min: 1, max: 20, step: 0.5, label: "뭉텅이 크기 (칸)" },
      erShade: { value: DEFAULT_ERODE.shade, min: 0, max: 0.8, step: 0.05, label: "깎이는 곳의 남은 부재를 어둡게" },
      erFeed: { value: DEFAULT_ERODE.feed, min: 0, max: 1, step: 0.05, label: "깎이는 자리에 식생이 모임 (0 = 안 묶음)" },
      // (the artist, 2026-11-15: "배관도 침식 적용되도록" — erode.ts pipeErosion: by depth, in the parts' patches)
      erPipes: { value: true, label: "배관도 깎임 (깊이로 · 건물과 같은 뭉텅이에서 · 구멍이 나다가 사라짐)" },
    }),
    { order: lab ? 7.95 : 1.76, render: () => isV2 },
  );
  // THE THICK PRESENT RISES (lifecycle.ts shift): where the block's top is now (slots, in quarters — the parts are read
  // again at every quarter), from the bots' own clock; with no bots here, or a block that stands, its height.
  const [win, setWin] = useState<{ top: number; shift: number; tail: number; stood: number }>({ top: 0, shift: 0, tail: 0, stood: 0 });
  useEffect(() => {
    const read = () => {
      const w = botGround.window?.();
      // (…and, while the rise is stopped, how far it would have gone — in quarters too: the ages go on by it)
      const next = w && w.shift > 0 ? { top: Math.round((w.top / Math.max(1, tAxis.secPerUnit)) * 4) / 4, shift: w.shift, tail: w.tail, stood: Math.round((Math.max(0, w.stood ?? 0) / Math.max(1, tAxis.secPerUnit)) * 4) / 4 } : { top: 0, shift: 0, tail: 0, stood: 0 };
      setWin((cur) => (cur.top === next.top && cur.shift === next.shift && cur.tail === next.tail && cur.stood === next.stood ? cur : next));
    };
    read();
    const iv = window.setInterval(read, 500);
    return () => window.clearInterval(iv);
  }, [tAxis.secPerUnit]);
  const rising = win.shift > 0 && botDepth > 0;
  // (only in the block, whose top is known: the bots' block height)
  // SIMPLIFIED WITH TIME (spaceModel computeParts; the artist, 2026-11-16: "시간이 지나면 부재에 lod가 적용돼서
  // 단순화되는 시기를 거치도록 … 재방문해서 건물이 새로 생기더라도 이전 에셋 위에 생기는 거니까"): a cell-slot that has
  // stood this long is one simple body; what is built there later is built over it, and taken into it in its turn
  const SIMPLIFY_GROUP = "건물 단순화 (시간이 지나면 한 덩이로)";
  const sm = useLevaControls(
    SIMPLIFY_GROUP,
    savable(SIMPLIFY_GROUP, {
      lodOn: { value: true, label: "켜기 (끄면 부재가 끝까지 낱낱이)" },
      // (shown with the simplification off too: the fossil still begins a while after this — erode fossilSec)
      lodSec: { value: 180, min: 10, max: 1200, step: 10, label: "지어진 뒤 이만큼 지나면 한 덩이로 (초 · 자리마다 ±30%) — 꺼도 화석이 나오기 시작하는 때는 이 값을 따름" },
      // (the lattice the masses are joined on: their outline is kept to its width — the artist, 2026-11-16: "합쳤을 때 모양 유지")
      lodGrid: { value: 0.5, min: 0.2, max: 4, step: 0.1, label: "합칠 때 모양을 지키는 격자 (월드 · 작을수록 원래 모양 · 클수록 단순한 덩이)", render: (get: (path: string) => unknown) => !!get(`${SIMPLIFY_GROUP}.lodOn`) },
      // THE FOSSIL'S UNITS (spaceModel fossilUnits; the artist, 2026-11-20: "모양은 변하지 않지만 여튼 더 크게 어림한 단순화
      // 부재 단계를 만들고, 화석화는 그걸 단위로") — a second step, not drawn: the same masses on a wider lattice
      lodUnit: { value: 2, min: 0, max: 8, step: 0.25, label: "화석의 재료 — 더 크게 어림한 몸통의 격자 (월드 · 그리지 않음: 건물 모양은 그대로 · 화석이 이 덩이마다 자라 나옴 · 0 = 단순화된 상자 그대로)", render: (get: (path: string) => unknown) => !!get(`${SIMPLIFY_GROUP}.lodOn`) },
    }),
    { order: lab ? 7.955 : 1.77, render: () => isV2 },
  );
  // (the arrival's uniforms carry the leaving too: how long a part takes to go — only with the erosion on)
  const arriveLeave = useMemo(() => ({ ...arriveView, leave: er.erOn ? er.erLeaveSec : 0 }), [arriveView, er.erOn, er.erLeaveSec]);
  const weatherEr = useMemo<WeatherConfig>(
    () =>
      // (the place is read by the fusion too — so it is there whenever the block is; with the erosion itself off
      // nothing goes: amount 0)
      REDESIGN && dn.densityOn && botDepth > 0
        ? { ...weather, erode: { topSlot: rising ? Math.max(botDepth, win.top) : botDepth, ...(rising ? { height: botDepth, shift: win.shift, slotSec: tAxis.secPerUnit, tail: win.tail, stood: win.stood } : {}), start: er.erStart, full: Math.max(er.erFull, er.erStart + 0.01), amount: er.erOn ? er.erAmount : 0, vegPull: er.erVegPull, order: er.erOrder, patch: er.erPatch, grain: er.erGrain, shade: er.erOn ? er.erShade : 0, feed: er.erOn ? er.erFeed : 0, pipes: er.erOn && er.erPipes, lifeSec: er.erLife, waitSec: er.erWait, spread: er.erSpread, lodSec: sm.lodOn ? sm.lodSec : 0, fossilSec: sm.lodSec, lodGrid: sm.lodGrid, lodUnit: sm.lodOn ? sm.lodUnit : 0 } }
        : weather,
    [weather, botDepth, rising, win.top, win.shift, win.tail, win.stood, tAxis.secPerUnit, dn.densityOn, er.erOn, er.erStart, er.erFull, er.erAmount, er.erVegPull, er.erOrder, er.erPatch, er.erGrain, er.erShade, er.erFeed, er.erPipes, er.erLife, er.erWait, er.erSpread, sm.lodOn, sm.lodSec, sm.lodGrid, sm.lodUnit],
  );
  // (the unlived share is read by the gatherings and by the erosion alike)
  const unlivedOn = vg.gaOn || er.erOn;
  const densityCfg = useMemo<DensityConfig | null>(
    () =>
      dn.densityOn && isV2
        // (steps are not presences — walking does not build; the density's own paths are never asked for: step 1e9)
        ? { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: 1e9 }, slotSec: tAxis.secPerUnit, gapSec: tAxis.emptyGapSec, maxBuilt: dn.dMaxBuilt, mergeGap: dn.dMerge, mergeThick: dn.dMergeThick, liveAt: unlivedOn ? vg.gaLiveAt : 0, minVisitors: dn.dVisitors, step: dn.dStep, maxLevel: dn.dGrow, ratio: dn.dGrowEvery, massRatio: dn.dGrowBy, visitorCap: dn.dCap, radius: dn.dRadius, timeSec: dn.dTime, down: dn.dDown }
        : null,
    [isV2, unlivedOn, vg.gaLiveAt, tAxis.secPerUnit, tAxis.emptyGapSec, dn.dMaxBuilt, dn.dMerge, dn.dMergeThick, dn.densityOn, dn.dVisitors, dn.dStep, dn.dGrow, dn.dGrowEvery, dn.dGrowBy, dn.dCap, dn.dRadius, dn.dTime, dn.dDown],
  );
  // WHERE IT IS BUILT, FOR THE BOTS (botGround.ts): a copy of the wall's density field on this thread, with
  // everything the log holds at first — after that the bots feed it as they stand (useGlobalBots). They go round what
  // it says is built, or stop at it.
  useEffect(() => {
    botGround.densityCfg = densityCfg;
    if (!densityCfg) {
      botGround.built = null;
      botGround.shown = null;
      return;
    }
    const field = new DensityField(densityCfg);
    for (const e of [...log.all()].sort((p, q) => p.s - q.s)) field.add(e);
    botGround.built = field;
    botGround.slotSec = densityCfg.slotSec;
    return () => {
      if (botGround.built === field) botGround.built = null;
    };
  }, [log, densityCfg, worldResets]);
  // (the density's own paths, density.ts pathLines, are not drawn: the walkways are the paths — walkways.ts)
  const pathLook = null;
  // the history window reaches as deep as the bots write (the lab keeps everything)
  useEffect(() => {
    if (lab || botDepth <= 0) return;
    const need = botDepth * Math.max(1, tAxis.secPerUnit) + 240;
    if (keepWindowSec() < need) setKeepWindowSec(need);
  }, [lab, botDepth, tAxis.secPerUnit]);
  // THE MARKERS: the bots' names (off: no text over them) and their colours by how their herd moves
  const mk = useLevaControls(
    "마커",
    savable("마커", {
      names: { value: false, label: "봇 이름 보이기" },
      byKind: { value: false, label: "성격별 색 (정착 파랑 · 유랑 주황 · 순회 초록 · 혼자 회색)" },
    }),
    { order: lab ? 7.2 : 1.55 },
  );
  // BROUGHT OVER (the artist, 2026-11-12: "길 로직은 예전 버전 따를 수 있나?" — judged on the ground, between
  // buildings: walkways.ts): the old walkways, on the density's buildings
  const wlk = useLevaControls(
    WALK_GROUP,
    savable(
      WALK_GROUP,
      {
        "어디에 놓이나 (건물과 건물 사이)": folder(
          {
            walkOn: { value: DEFAULT_WALK.enabled, label: "켜기" },
            buildAt: { value: DEFAULT_WALK.buildAt, min: 0.05, max: 0.99, step: 0.01, label: "길이 되는 밟힘 세기 (건물 사이 경로의 평균)" },
            maxSpan: { value: DEFAULT_WALK.maxSpan, min: 2, max: 120, step: 1, label: "가장 긴 길 (월드)" },
            walkJoin: { value: DEFAULT_WALK.join, min: 1, max: 4, step: 1, label: "한 건물로 볼 거리 (칸)" },
            smooth: { value: DEFAULT_WALK.smooth, min: 0, max: 5, step: 1, label: "선의 부드러움 (0 = 칸에서 칸으로)" },
          },
          { order: 2 },
        ),
        "층 · 경사 · 남음": folder(
          {
            walkChange: { value: DEFAULT_WALK.change, min: 0.02, max: 1, step: 0.01, label: "새 층이 놓이는 변화 (길이 이만큼 생기거나 사라지면)" },
            walkGap: { value: DEFAULT_WALK.minGapSlots, min: 1, max: 30, step: 1, label: "새 층 최소 간격 (단)" },
            // JOINING THE PAST (the artist, 2026-11-12: "경사로는 아예 안 보이는디? 과거랑 이어지질 않음"): a new way used
            // to climb from an older one only when most of it (60 %) ran along it, and only from lines of the last few
            // slots — so almost every way was laid flat, on its own. New inputs (new names: the old saved values would
            // keep it so): any touch is enough, the older ways of the last twenty slots count, and the ramp is long
            // enough to be seen as one
            joinShare: { value: 0.02, min: 0, max: 1.01, step: 0.01, label: "옛 길에 이만큼만 겹쳐도 거기서 갈라져 오름 (작을수록 잘 이어짐)" },
            joinReach: { value: 20, min: 1, max: 120, step: 1, label: "이만큼 아래의 옛 길까지 이음 (단)" },
            rampLen: { value: 8, min: 0.5, max: 40, step: 0.5, label: "경사로 길이 (월드)" },
            grace: { value: DEFAULT_WALK.grace, min: 0, max: 60, step: 1, label: "이만큼 안 쓰여도 같은 길 (단)" },
            resurfaceOn: { value: DEFAULT_WALK.resurface >= 0, label: "오래 쓰는 길을 다시 깖" },
            resurface: { value: DEFAULT_WALK.resurface, min: 0, max: 120, step: 1, label: "다시 까는 간격 (단)" },
          },
          { order: 3 },
        ),
        "선": folder(
          {
            walkColor: { value: "#d8d8d8", label: "색 (무채색)" },
            walkKeptOpacity: { value: 0.4, min: 0.05, max: 1, step: 0.05, label: "굳은 길의 불투명도 (지금 것 = 1)" },
            walkDot: { value: 6, min: 0, max: 20, step: 0.5, label: "이어지지 않은 끝의 점 (px · 0 = 없음)" },
            walkUseDim: { value: 0.35, min: 0, max: 1, step: 0.05, label: "덜 쓰는 길의 밝기 × (1 = 차이 없음)" },
            walkUseFade: { value: 0.35, min: 0, max: 1, step: 0.05, label: "덜 쓰는 길의 불투명도 × (1 = 차이 없음)" },
          },
          { order: 4 },
        ),
        // NOT USED NOW (the vegetation is off): the holes paths leave in it, and the readout of the present's thickness
        "쓰지 않음": folder(
          {
            pathsOn: { value: true, label: "켜기" },
            pathHole: { value: 0.35, min: 0.05, max: 1, step: 0.01, label: "빈 통로가 되는 길 세기 (작을수록 넓음)" },
            pathBerm: { value: 2, min: 0, max: 8, step: 0.5, label: "가장자리로 밀려난 흙 양" },
            pathEdge: { value: 0.75, min: 0.3, max: 0.98, step: 0.01, label: "경계 돌 띠 너비 (클수록 좁음)" },
            [PRESENT]: presentMonitor,
          },
          { render: () => false },
        ),
      },
      [WALK_GROUP_OLD, "길 · 다리"],
    ),
    // (shown in the lab too: the artist, 2026-11-12 — "길 비주얼이랑 파라미터 레바에 추가하고")
    { order: lab ? 7.8 : 4, collapsed: false },
  );
  const walkView = useMemo<WalkConfig | null>(
    () =>
      isV2 && wlk.walkOn
        ? {
            enabled: true,
            buildAt: wlk.buildAt,
            maxSpan: wlk.maxSpan,
            join: wlk.walkJoin,
            change: wlk.walkChange,
            minGapSlots: wlk.walkGap,
            rampLength: wlk.rampLen,
            smooth: wlk.smooth,
            reach: wlk.joinReach,
            grace: wlk.grace,
            minorShare: wlk.joinShare,
            resurface: wlk.resurfaceOn ? wlk.resurface : -1,
            life: 0,
          }
        : null,
    [isV2, wlk.walkOn, wlk.buildAt, wlk.maxSpan, wlk.walkJoin, wlk.walkChange, wlk.walkGap, wlk.rampLen, wlk.smooth, wlk.joinReach, wlk.grace, wlk.joinShare, wlk.resurfaceOn, wlk.resurface],
  );
  // ── 배관: the sealed ground → its rain piped away, from the buildings to where the ground is open (water.ts) ──
  // BROUGHT OVER (the artist, 2026-11-15: "배관 먼저"), onto the density's buildings: in the block the ground is read
  // per slot from what stands in it (DrainageOptions.block). The folder is today's — only what does something now;
  // what was saved under the old name is read as before. Not used now and not shown: the open streams (they shaped
  // the old vegetation), the pipes' corrosion (wear is off), the brightness of kept pipes (the block has no present).
  const WATER_GROUP = "배관";
  const WATER_GROUP_OLD = "물 → 배관";
  const wtr = useLevaControls(
    WATER_GROUP,
    savable(
      WATER_GROUP,
      {
        "어디에 깔리나 (덮인 땅의 건물에서 열린 땅 쪽으로)": folder(
          {
            pipesOn: { value: true, label: "켜기" },
            // (the block, calmer: a speck of a building gets no lateral of its own — water.ts minCells)
            pipeMinCells: { value: 4, min: 0, max: 40, step: 1, label: "이보다 작은 건물은 관을 내지 않음 (칸 · 0 = 모두)" },
            burial: { value: DEFAULT_WATER.burial, min: 0.02, max: 1, step: 0.01, label: "관이 깔리는 덮인 비율 (건물 둘레가 이만큼 덮여야 · 관은 여기까지만 감)" },
            imperviousRadius: { value: DEFAULT_WATER.imperviousRadius, min: 1, max: 10, step: 1, label: "덮인 비율을 재는 범위 (칸)" },
            openShare: { value: DEFAULT_WATER.openShare, min: 0, max: 0.6, step: 0.01, label: "관이 향하는 열린 땅 (덮인 비율이 이보다 낮은 곳)" },
            pathAt: { value: DEFAULT_WATER.pathAt, min: 0.05, max: 1, step: 0.01, label: "덮인 땅으로 치는 길 (밟힘 세기)" },
            // (water.ts pathPull: "배관이 거의 길 따라가는데")
            pipePathPull: { value: -1, min: -1, max: 1, step: 0.05, label: "관과 길 (-1 = 관이 길을 피해 제 길로: 건너기만 하고 따라가지 않음 … 0 = 길과 무관한 지름길 … 1 = 길 밑으로, 예전 그대로)" },
            join: { value: DEFAULT_WATER.join, min: 1, max: 4, step: 1, label: "한 건물로 볼 거리 (칸)" },
            quarterGap: { value: DEFAULT_WATER.quarterGap, min: 1, max: 40, step: 0.5, label: "한 관망으로 묶는 건물 간 거리 (월드)" },
            diagonal: { value: DEFAULT_WATER.diagonal, min: 0, max: 1, step: 0.05, label: "45° 꺾임 (0 = 직각만)" },
            pipeDepth: { value: DEFAULT_WATER.pipeDepth, min: 0, max: 10, step: 0.5, label: "묻히는 깊이 (깔린 단보다 몇 단 아래)" },
          },
          { order: 1 },
        ),
        // (the artist, 2026-11-15: "마을과 마을 사이에 물 흐르는 게 보이도록" → "선으로 표현하기보다 식생 점이 닳는
        // 걸로"): each village's water runs from its outfall to where it meets its nearest neighbour's (water.ts
        // towardCourse), and the vegetation's points wear away along it — more where it has run on, slot after slot
        "마을 사이 물길 (식생이 닳음)": folder(
          {
            riverOn: { value: true, label: "켜기" },
            riverGain: { value: 0.35, min: 0, max: 1, step: 0.05, label: "물이 지나간 한 단에 닳는 정도" },
            riverKeep: { value: 0.85, min: 0, max: 0.99, step: 0.01, label: "닳음이 위 단으로 이어지는 정도 (오래 흐른 곳일수록 깊게)" },
            riverWidth: { value: 1, min: 0, max: 4, step: 0.5, label: "물길 폭 (칸 · 양옆으로)" },
          },
          { order: 1.5 },
        ),
        "층 · 이어짐": folder(
          {
            change: { value: DEFAULT_WATER.change, min: 0.01, max: 1, step: 0.01, label: "새 층이 놓이는 변화 (덮인 땅이 이만큼 바뀌면 · 건물이 오고 가도)" },
            minGapSlots: { value: DEFAULT_WATER.minGapSlots, min: 1, max: 30, step: 1, label: "새 층 최소 간격 (단)" },
            // (a new input: the old one's 0 meant "the present's thickness", and the block has no present)
            pipeJoinReach: { value: 20, min: 1, max: 120, step: 1, label: "이만큼 아래의 옛 관까지 이음 (단 · 맨홀로)" },
            pipeGrace: { value: DEFAULT_WATER.grace, min: 0, max: 60, step: 1, label: "이만큼 안 쓰여도 같은 관 (단)" },
            relayOn: { value: DEFAULT_WATER.relay >= 0, label: "오래 쓰는 관망을 다시 깖" },
            relay: { value: DEFAULT_WATER.relay, min: 0, max: 120, step: 1, label: "다시 까는 간격 (단 · 0 = 위의 '옛 관까지'와 같게)" },
          },
          { order: 2 },
        ),
        "관": folder(
          {
            pipeRadius: { value: DEFAULT_WATER.pipeRadius, min: 0.01, max: 0.2, step: 0.005, label: "굵기 (건물 한 칸 몫, 반지름)" },
            flowGain: { value: DEFAULT_WATER.flowGain, min: 0, max: 1, step: 0.05, label: "모일수록 굵어짐 (0 = 다 같게, 0.5 = √)" },
            elbow: { value: DEFAULT_WATER.elbow, min: 0.5, max: 3, step: 0.05, label: "엘보 반지름 (관 굵기 배 · 작을수록 급한 직각)" },
            shaftRadius: { value: DEFAULT_WATER.shaftRadius, min: 0.5, max: 4, step: 0.05, label: "맨홀 세로관 굵기 (관 굵기 배)" },
            coverRadius: { value: DEFAULT_WATER.coverRadius, min: 1, max: 4, step: 0.05, label: "맨홀 뚜껑 너비 (세로관 배)" },
            coverHeight: { value: DEFAULT_WATER.coverHeight, min: 0, max: 2, step: 0.05, label: "맨홀 뚜껑 두께 (세로관 반지름 배)" },
            collarRadius: { value: DEFAULT_WATER.collarRadius, min: 1, max: 2.5, step: 0.05, label: "칼라(T 이음쇠) 굵기 (관 배)" },
            collarLength: { value: DEFAULT_WATER.collarLength, min: 0.2, max: 4, step: 0.1, label: "칼라 길이 (관 반지름 배, 반쪽)" },
            pipeColor: { value: "#7c7f84", label: "색 (무채색)" },
            pipeRoughness: { value: 0.55, min: 0, max: 1, step: 0.01, label: "거칠기" },
            pipeMetalness: { value: 0.35, min: 0, max: 1, step: 0.01, label: "금속성" },
          },
          { order: 3, collapsed: true },
        ),
        // NOT USED NOW (kept so the saved values and the old wall still have them)
        "쓰지 않음": folder(
          {
            waterOn: { value: DEFAULT_WATER.enabled, label: "켜기 (예전 벽)" },
            persistSec: { value: DEFAULT_WATER.persistSec, min: 0, max: 3600, step: 10, label: "건물이 비어도 물이 나오는 시간 (s)" },
            [PRESENT]: presentMonitor,
            pipeReach: { value: DEFAULT_WATER.reach, min: 0, max: 120, step: 1, label: "이보다 오래된 관은 과거: 잇지 않음 (단, 0 = '현재' 두께)" },
            pipeKeptDim: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: "굳은 관의 밝기 (현재 대비)" },
            pipeLife: { value: DEFAULT_WATER.pipeLife, min: 0, max: 5, step: 0.05, label: "관 수명 (철골 대비; 0 = 부식 없음)" },
            thin: { value: DEFAULT_WATER.thin, min: 0, max: 0.9, step: 0.05, label: "다 부식하면 얇아지는 비율" },
            pipeHoleOnset: { value: 0.2, min: 0, max: 0.95, step: 0.05, label: "구멍이 나기 시작하는 부식 정도" },
            pipeHoles: { value: 0.95, min: 0, max: 1, step: 0.05, label: "다 부식하면 먹히는 벽 비율" },
            pipeGrain: { value: 23, min: 3, max: 80, step: 1, label: "구멍 결 (클수록 잘고 많음)" },
            pipeDarken: { value: 0.55, min: 0, max: 1, step: 0.05, label: "부식할수록 어두워짐" },
            streamLength: { value: DEFAULT_WATER.streamLength, min: 0, max: 40, step: 0.5, label: "배출구 너머로 흐르는 거리 (월드)" },
            endPool: { value: DEFAULT_WATER.endPool ?? 1.2, min: 0, max: 6, step: 0.1, label: "물길 끝의 웅덩이 (반지름, 월드 · 물이 스며드는 끝에서 퍼짐 · 0 = 없음)" },
            channel: { value: DEFAULT_WATER.channel, min: 0, max: 4, step: 0.05, label: "물길 폭 (식생이 비는 너비)" },
            meander: { value: DEFAULT_WATER.meander, min: 0, max: 0.6, step: 0.01, label: "굽이" },
            // ("물줄기는 알고리즘상으로 손볼 방법 없는지?", 2026-11-18: water.ts WaterConfig.bed)
            bed: { value: DEFAULT_WATER.bed ?? 0.7, min: 0, max: 1, step: 0.05, label: "물길이 옛 물길을 따르는 정도 (0 = 새로 놓일 때마다 새 길 · 1 = 옛 바닥에 꼭 붙음)" },
            bedSlots: { value: DEFAULT_WATER.bedSlots ?? 30, min: 1, max: 200, step: 1, label: "안 쓰는 옛 물길이 기억되는 단 수 (메워지기까지)" },
            radius: { value: DEFAULT_WATER.radius, min: 0.5, max: 8, step: 0.1, label: "습지 폭 (물길에서 영향 범위, 월드)" },
            vegBoost: { value: DEFAULT_WATER.vegBoost, min: 0, max: 2, step: 0.05, label: "물가 식생 밀도 (짙어지는 정도)" },
            wetShare: { value: DEFAULT_WATER.wetShare, min: 0, max: 1, step: 0.05, label: "물가 식생 중 습지색 비율" },
            corrode: { value: DEFAULT_WATER.corrode, min: 0, max: 5, step: 0.1, label: "물에 닿은 부품이 빨리 부식하는 정도" },
          },
          { render: () => false },
        ),
      },
      [WATER_GROUP_OLD, "수로 (덮인 땅의 물)", "길 · 다리"],
      // (the artist, 2026-11-15: "길이랑 배관 로직 아예 별개로" — the saved 0.3 still laid the pipes under the paths)
      REDESIGN ? [{ tag: "pipes-keep-off-paths-2026-11-15", set: { pipePathPull: -1 } }] : [],
    ),
    // (shown in the lab too, as the paths are)
    { order: lab ? 7.85 : 4.2, collapsed: true },
  );
  const waterView = useMemo<WaterConfig | null>(
    () =>
      // (the redesign's wall: its own switch, and only on the V2 wall; otherwise the old one)
      (REDESIGN ? isV2 && wtr.pipesOn : wtr.waterOn)
        ? {
            enabled: true,
            join: wtr.join,
            change: wtr.change,
            minGapSlots: wtr.minGapSlots,
            pipeDepth: wtr.pipeDepth,
            imperviousRadius: wtr.imperviousRadius,
            burial: wtr.burial,
            openShare: wtr.openShare,
            pathAt: wtr.pathAt,
            diagonal: wtr.diagonal,
            streamLength: wtr.streamLength,
            endPool: wtr.endPool,
            bed: wtr.bed,
            bedSlots: wtr.bedSlots,
            persistSec: wtr.persistSec,
            meander: wtr.meander,
            channel: wtr.channel,
            radius: wtr.radius,
            vegBoost: wtr.vegBoost,
            wetShare: wtr.wetShare,
            corrode: wtr.corrode,
            pipeRadius: wtr.pipeRadius,
            quarterGap: wtr.quarterGap,
            reach: REDESIGN ? wtr.pipeJoinReach : wtr.pipeReach,
            grace: wtr.pipeGrace,
            relay: wtr.relayOn ? wtr.relay : -1,
            elbow: wtr.elbow,
            flowGain: wtr.flowGain,
            shaftRadius: wtr.shaftRadius,
            coverRadius: wtr.coverRadius,
            coverHeight: wtr.coverHeight,
            collarRadius: wtr.collarRadius,
            collarLength: wtr.collarLength,
            pipeLife: wtr.pipeLife,
            thin: wtr.thin,
            ...(REDESIGN ? { minCells: wtr.pipeMinCells, pathPull: wtr.pipePathPull } : {}),
            ...(REDESIGN && botVillages ? { villages: botVillages } : {}),
          }
        : null,
    [botVillages, isV2, wtr.pipesOn, wtr.pipeMinCells, wtr.pipePathPull, wtr.pipeJoinReach, wtr.waterOn, wtr.join, wtr.change, wtr.minGapSlots, wtr.pipeDepth, wtr.imperviousRadius, wtr.burial, wtr.openShare, wtr.pathAt, wtr.diagonal, wtr.streamLength, wtr.endPool, wtr.bed, wtr.bedSlots, wtr.persistSec, wtr.meander, wtr.channel, wtr.radius, wtr.vegBoost, wtr.wetShare, wtr.corrode, wtr.pipeRadius, wtr.quarterGap, wtr.pipeReach, wtr.pipeGrace, wtr.relayOn, wtr.relay, wtr.elbow, wtr.flowGain, wtr.shaftRadius, wtr.coverRadius, wtr.coverHeight, wtr.collarRadius, wtr.collarLength, wtr.pipeLife, wtr.thin],
  );
  const theme = THEMES[v.theme as keyof typeof THEMES] ?? THEMES.paper;
  // THE BUILDINGS' PARTS' COLOURS (the artist, 2026-11-20: "건물 부재 색도 조절 가능하게 해줘"): each kind's, the
  // defaults as they were (achromatic: a human trace)
  const pc = useLevaControls(
    "건물 부재의 색",
    savable("건물 부재의 색", {
      partMass: { value: KIND_COLOR.mass, label: "몸체 (mass)" },
      partSlab: { value: KIND_COLOR.slab, label: "바닥판 (slab)" },
      partDrip: { value: KIND_COLOR.drip, label: "늘어진 것 (drip)" },
      partColumn: { value: KIND_COLOR.column, label: "기둥 (column)" },
      partBeam: { value: KIND_COLOR.beam, label: "보 (beam)" },
      partBrace: { value: KIND_COLOR.brace, label: "가새 (brace)" },
      partPlinth: { value: KIND_COLOR.plinth, label: "기단 (plinth)" },
      partBasement: { value: KIND_COLOR.basement, label: "지하실 (basement)" },
      partPile: { value: KIND_COLOR.pile, label: "말뚝 (pile)" },
    }),
    { order: lab ? 7.96 : 1.775, collapsed: true, render: () => isV2 },
  );
  const partColors = useMemo<Record<PartKind, string>>(
    () => ({ mass: pc.partMass, slab: pc.partSlab, drip: pc.partDrip, column: pc.partColumn, beam: pc.partBeam, brace: pc.partBrace, plinth: pc.partPlinth, basement: pc.partBasement, pile: pc.partPile }),
    [pc.partMass, pc.partSlab, pc.partDrip, pc.partColumn, pc.partBeam, pc.partBrace, pc.partPlinth, pc.partBasement, pc.partPile],
  );
  const walkLook = useMemo<WalkLook>(
    () => ({ walkColor: wlk.walkColor, walkDot: wlk.walkDot, walkKeptOpacity: wlk.walkKeptOpacity, walkUseDim: wlk.walkUseDim, walkUseFade: wlk.walkUseFade, pipeColor: wtr.pipeColor, pipeRoughness: wtr.pipeRoughness, pipeMetalness: wtr.pipeMetalness, pipeKeptDim: REDESIGN ? 1 : wtr.pipeKeptDim, pipeHoles: wtr.pipeHoles, pipeHoleOnset: wtr.pipeHoleOnset, pipeDarken: wtr.pipeDarken, pipeGrain: wtr.pipeGrain }),
    [wlk.walkColor, wlk.walkDot, wlk.walkKeptOpacity, wlk.walkUseDim, wlk.walkUseFade, wtr.pipeColor, wtr.pipeRoughness, wtr.pipeMetalness, wtr.pipeKeptDim, wtr.pipeHoles, wtr.pipeHoleOnset, wtr.pipeDarken, wtr.pipeGrain],
  );
  const { cfg: natureCfg } = useNatureControls({ hidden: REDESIGN, folder: "식생 규칙 (개인 뷰와 공유)", rulesOnly: true, collapsed: true, order: lab ? 8.5 : 6.5 });
  // BROUGHT OVER (the artist, 2026-11-15: "융합 진행하면 될 것 같고"): the fusion in the block. Its one clock — a
  // part's corrosion, 0 new … 1 gone — is there the EROSION OF THE PART'S PLACE (침식: depth below the block's top ×
  // how little it was lived in; spaceModel blockClock), so the thresholds below are thresholds of that, and where the
  // band lies is the erosion's 시작 깊이 … 다 깎이는 깊이. The folder is the artist's own (① … ⑦), shown as it was;
  // what the block has no use for is not shown (baking, the immutable line, the frozen shapes).
  const fu = useLevaControls(
    FU,
    savable(FU, {
      fuseOn: { value: DEFAULT_FUSE.enabled, label: REDESIGN ? "켜기 (화석: 단순화된 건물에서, 굳은 뒤의 나이로 나오고 삭아 사라짐)" : "켜기 (풍화 · 지층의 '마모'와 '지층'이 켜져 있어야 함)" },
      // A SET OF VALUES TO CHOOSE (presets/exhibitionFusion.ts FUSION_PRESETS; the artist, 2026-11-20: "프리셋 선택할 수 있게
      // 레바 추가하고 거기 전시 버전 넣어줘"): choosing one puts its values on this folder's knobs, in this tab — saved
      // only by the folder's save. What it shows afterwards is the set last chosen, not a promise nothing was moved since.
      fusePreset: {
        options: { "— (고르면 이 폴더의 손잡이가 그 값으로)": "", [FUSION_PRESETS.exhibition.label]: "exhibition", [FUSION_PRESETS.exhibitionServer.label]: "exhibitionServer", "저장된 값으로 되돌리기": "saved" },
        value: "",
        label: "값 묶음 불러오기 (이 탭에서만 바뀜 · 남기려면 아래 save · 화석을 전부 다시 만듦)",
        render: () => REDESIGN,
      },
      // THE MASS CHANGES SOFTLY (FuseFade): what it was dissolves into what it is over this long
      // (levaFocus.ts: this folder lists only the knobs under review; this lists all of it again)
      allKnobs: { value: false, label: "이 폴더의 손잡이 전부 보기 (끄면 지금 손보는 것만)", render: () => REDESIGN },
      fuseFade: { value: 2, min: 0, max: 10, step: 0.25, label: "덩어리가 바뀔 때 녹아드는 시간 (s · 0 = 바로)" },
      // BUILDING BY BUILDING, FROM A STATE KEPT (spaceModel fuseBuildings; the artist, 2026-11-15: "건물 상태를 기점마다
      // 굽고 일정 변화 이상이 감지되면 변화하는 식으로")
      // THE CRUST (fuse.ts crust; the artist, 2026-11-15: "1단계 시작"): one shell over the building's outline, where
      // the vegetation gathered — instead of a skin round every part
      // (BACK TO THE PARTS' OWN SKINS BY DEFAULT the same night: the cells and ribs were always a lattice of the
      // world's, and what made the mass read part by part was the mass itself — the crust over a whole building took
      // that away. The artist: "그럼 이전이 나을 것 같은데; 문제가 그럼 건물이랑 지역단위로 묶어서 생겼단 거잖아")
      fuseBody: {
        options: { "부재마다 감싸기 (전시 버전의 방식)": "wrap", "껍질 (건물 윤곽을 덮는 한 몸 · 식생이 모인 곳에)": "crust" },
        value: "wrap" as "crust" | "wrap",
        label: "덩어리의 재료",
        render: () => REDESIGN,
      },
      // (for the parts' own skins too since 2026-11-16 — a new key, so what was saved for the crust does not carry over)
      // (WHAT IT DOES IN THE NEW WAY — the artist, 2026-11-20: "정확하게 뭘 조절하고 어떤 영향을 미치냐": a part's fossil
      // comes out to at most 1 − this × (1 − the vegetation gathered at its cell and slot); under 0.05 it is not made)
      massVeg: { value: 0.5, min: 0, max: 1, step: 0.05, label: "식생이 모인 자리에서만 화석이 다 나옴 (0 = 어디서나 끝까지 나옴 · 클수록 식생이 안 모인 자리 — 오래 머문 곳 — 의 화석이 덜 부풀어 얇게 남음 · 1 = 그런 자리에는 화석이 아예 없음)", render: () => REDESIGN },
      // THE MASS'S SHAPE IS MADE ONCE AND GROWS ON THE SCREEN (fuse.ts seeded; the artist, 2026-11-16: "만들어서 보여줘")
      fuseGrow: {
        options: { "모양은 한 번만 만들고, 부재에서 부풀어 나옴 (새 방식)": "seed", "진행이 바뀔 때마다 다시 만듦 (예전)": "state" },
        value: "seed" as "seed" | "state",
        label: "화석이 나타나는 방식",
        render: () => REDESIGN,
      },
      // THE MASS'S GRID IS NO FINER THAN WHAT IT GROWS ON (fuse.ts voxelTie; 2026-11-16, the artist on making it lighter:
      // "일단 1-3 진행해봐"). Hers to judge: a coarser grid shows as facets — 0 = the grid as set in ② › 계산
      voxelTie: {
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.05,
        label: "화석 격자 ≥ 단순화 격자 × 이 값 (가볍게; 0 = 맞추지 않음 · 계단처럼 보이면 내림)",
        render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseFrom`) === "assets",
      },
      // THE PIECES' SIZE (FuseConfig.pieceTile; the artist, 2026-11-20: "화석 생성 단위 묶음/타일 더 촘촘하게 만들 수 있지 않나?")
      pieceTile: {
        options: { "7칸 (잘게: 바뀐 곳이 빨리 반영 · 전체가 차는 데는 더 오래)": 7, "14칸 (지금까지)": 14, "21칸 (크게)": 21 },
        value: 14,
        label: "화석을 계산하는 조각의 크기: 땅 (한 변의 칸 수 · 모양은 같고 속도만 달라짐 · 바꾸면 전부 다시 만듦)",
        render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed",
      },
      pieceSeg: {
        options: { "5단 (잘게)": 5, "10단 (지금까지)": 10, "15단 (크게)": 15 },
        value: 10,
        label: "화석을 계산하는 조각의 크기: 높이 (단)",
        render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed",
      },
      // HOW THE FOSSIL COMES INTO BEING — one folder, its way first, then in the order it happens (the artist, 2026-11-21
      // night: "나타나는 방식에 그 드롭다운이 따로 있진 않은데...? 그리고 애초에 나타나는 방식에 내가 뭔지 이해 안 되는 레바도
      // 많음"): when it begins → in what order it comes → its edge and cut. Short labels: what changes, and the two ends.
      "화석이 생기는 과정": folder(
        {
          // THE FOSSIL IN STAGES (spaceModel FuseInput.stages; 2026-11-21 night: "시험해 / 표면 뾰족한 거 진짜 싫어...")
          fuseStages: {
            // (…and THE EXHIBITION'S WAY — the artist, 2026-11-21 night: "전시에선 애초에 잘려보이는 거 잘 해결했었잖아" —
            // "Add exhibition way": the mass made again from the parts' progress as it goes, building by building in the
            // model's worker — nothing grown out of a final shape, nothing cut away; the heaviest)
            options: { "지금 — 다 된 모양이 구멍 사이로 나옴": "now", "단계 — 단계마다 실제 모양으로 바뀜": "stages", "전시판 — 진행이 바뀔 때마다 덩어리를 다시 계산 (가장 무거움)": "exhibition" },
            value: "now" as "now" | "stages" | "exhibition",
            label: "방식",
          },
          stageN: { value: 3, min: 2, max: 5, step: 1, label: "단계 수 (2 = 거칠게 · 5 = 촘촘히)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) === "stages" },
          stageSweep: { value: 4, min: 0, max: 20, step: 0.5, label: "단계가 바뀌는 시간 (초 · 아래부터 한 단씩 · 0 = 한꺼번에)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) === "stages" },
          // (ROUND — fuse.ts roundness; "내 말은 둥글게 하라고 둥글게")
          stageRound: { value: 1, min: 0, max: 1.5, step: 0.05, label: "둥글기 (0 = 각진 그대로 · 높을수록 둥글고 구멍이 메워짐)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) === "stages" },
          // (A WALL WITH A BODY — "애초에 그냥 벽에 두께가 있도록 하면": the stages' shell at least this thick, whatever 껍질 벽 두께 says)
          stageWall: { value: 0.75, min: 0, max: 2, step: 0.05, label: "벽 두께 (월드 · 구멍 사이로 보이는 벽의 단면 · 0 = 껍질 벽 두께대로)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) === "stages" },
          stageHoles: { value: "⑤ 구멍 폴더 · 방 → 빈 공간은 ④ 폴더", editable: false, label: "구멍 · 리브 노브는", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) === "stages" },
          "① 언제 시작하나": folder(
            {
              growAgeMin: { value: 2.5, min: 0.2, max: 60, step: 0.1, label: "다 나오기까지 걸리는 시간 (분 · 지은 뒤부터)", render: () => REDESIGN },
              growDeep: { value: 0.6, min: 0, max: 1, step: 0.05, label: "위쪽은 천천히 (0 = 높이 상관없이 · 1 = 꼭대기는 안 나옴)", render: () => REDESIGN },
            },
            { render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) !== "exhibition" },
          ),
          "② 어떤 순서로 나오나": folder(
            {
                growLate: { value: 0.5, min: 0, max: 0.9, step: 0.05, label: "관이 먼저 나오는 몫 (0 = 한꺼번에 · 클수록 관만 오래)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
                growRise: { value: 0.6, min: 0, max: 1, step: 0.05, label: "판·방이 바닥부터 차오름 (0 = 높이 상관없이)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
                growMelt: { value: 0.6, min: 0, max: 0.9, step: 0.05, label: "부재 가까이부터 번져 나옴 (0 = 전체가 함께)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
                growReach: { value: 2, min: 0.2, max: 8, step: 0.1, label: "번지는 거리 (월드)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
            },
            { render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) !== "stages" },
          ),
          "③ 가장자리와 단면": folder({
              growPress: { value: 1, min: 0, max: 1, step: 0.05, label: "덩이 속에서 부풀어 나옴 (0 = 겉이 얇게 덮임 · 1 = 속에서 커짐)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
              growThin: { value: 0.6, min: 0, max: 2, step: 0.05, label: "덜 나온 곳의 두께 (월드)", render: (get: (path: string) => unknown) => REDESIGN && Number(get(`${FU}.화석이 생기는 과정.③ 가장자리와 단면.growPress`) ?? 1) < 1 },
              growSeal: { value: 0.35, min: 0, max: 0.9, step: 0.05, label: "가장자리 구멍 (0 = 없음 · 클수록 넓게)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
              growSealGrain: { value: 0.8, min: 0.1, max: 4, step: 0.05, label: "그 구멍의 크기 (월드)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
              growCap: { value: true, label: "구멍 너머를 꽉 찬 단면으로 (끄면 속이 비어 보임)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
          }),
        },
        { collapsed: false, render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
      ),
      "화석의 수명 (다 나온 뒤 삭아 사라짐)": folder(
        {
          // THE FOSSIL HAS A LIFE (the artist, 2026-11-17: "수명을 준다" — docs/fossil-disappearance-review-2026-11-17.md):
          // it goes back into its parts further along the same ruler (the shader's growGone), the coming-out run
          // backwards. Off = it stays (and, while the window rises, goes over the last two slots above its foot).
          growDie: { value: true, label: "화석에 수명 (다 나온 뒤 삭아서 사라짐 · 끄면 전시 버전처럼 오래된 것이 가장 꽉 참)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" },
          growDieAfterMin: { value: 5.5, min: 0, max: 120, step: 0.5, label: "굳은 뒤 삭기 시작하기까지 (분 · 같은 눈금 — 깊은 곳이 먼저 닿음)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
          growDieSpanMin: { value: 8.5, min: 0.2, max: 120, step: 0.5, label: "삭기 시작해서 다 삭기까지 (분)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
          // IN HOLES (the artist, 2026-11-17: "구멍으로 삭게"): how the going is drawn — holes eaten through the mass, as the pipes'
          growDieHoles: { value: 1, min: 0, max: 1, step: 0.05, label: "삭는 모습: 얇아짐 ↔ 구멍 (0 = 얇아지며 들어감 · 1 = 구멍이 먹어 들어감)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
          growDieGrain: { value: 1.2, min: 0.1, max: 8, step: 0.05, label: "삭는 구멍의 크기 (월드)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
          // NO LINE ACROSS THE WALL (the artist, 2026-11-18: "지금 화석화 잘리는 구간 생기는데?"): patches ahead of and behind the going
          growDieRag: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: "삭는 경계의 얼룩 (0 = 한 층에서 한꺼번에 — 가로로 잘림 · 클수록 자리마다 먼저 · 나중에)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
          growDiePatch: { value: 9, min: 1, max: 60, step: 0.5, label: "삭는 얼룩의 크기 (월드)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && !!get(`${FU}.화석의 수명 (다 나온 뒤 삭아 사라짐).growDie`) },
        },
        { collapsed: true, render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) === "seed" && get(`${FU}.화석이 생기는 과정.fuseStages`) !== "exhibition" },
      ),
      // THE MASS GROWS ON WHAT HAS BEEN SIMPLIFIED (fuse.ts assetsOnly; the artist, 2026-11-16: "융합!!!!! 일단 해보자")
      fuseFrom: {
        options: { "단순화된 것에만 (갓 지은 낱낱의 부재는 융합 안 함)": "assets", "모든 부재에": "all" },
        value: "assets" as "assets" | "all",
        label: "덩어리가 자라는 곳",
        render: () => REDESIGN,
      },
      // (THE OLD WAY'S ONLY — the artist, 2026-11-20, when the pieces' size became a knob: "그러면 '덩어리를 만드는 단위'
      // 레바도 고쳐야 할 것 같고". With the new fossil the unit is not a choice: the ground is one field, made in the
      // pieces of 화석 조각의 크기, of the bodies of 건물 단순화 › 화석의 단위 — and "묶음 · 타일" here made the mass
      // without its age (all of it out at once). So in the new way this is neither listed nor read: fuseCfg perBuilding.)
      fuseUnit: {
        options: { "건물마다 (건물 상태가 달라지면 그 건물만 다시)": "building", "묶음 · 타일 (10단 × 14칸 × 구역 각도)": "tile" },
        value: "building" as "building" | "tile",
        label: "덩어리를 만드는 단위 (예전 방식에서만)",
        render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) !== "seed",
      },
      unitChange: { value: 0.15, min: 0.03, max: 0.5, step: 0.01, label: "건물 상태가 이만큼 달라지면 덩어리를 다시 만듦 (예전 방식에서만 · 작을수록 자주 바뀌고 무거움)", render: (get: (path: string) => unknown) => REDESIGN && get(`${FU}.fuseGrow`) !== "seed" && get(`${FU}.fuseUnit`) === "building" },
      // ONE CLOCK: what happens to a part is read off its corrosion (0 = new … 1 = gone), the same for every stage
      [FU_WHEN]: folder({
        // THREE BANDS (the artist, 2026-10-31 night): the present (풍화 · 지층 › 현재 두께), the layer where the processes
        // run, and from here down the immutable layer — baked as it is, never computed again
        // 현재 층 = 풍화 · 지층 › 현재 두께 (맨 위 N단, 아직 짓는 중). 작용 층 = 그 아래 … 완전불변 층까지: 식생이 모이고
        // (풍화 · 지층 › 식생 모임 · 부패 시작 양) → 부식이 자라 → 아래 문턱에서 덩어리가 됨 → 레진. 완전불변 층 = 그때 모습으로 굳음.
        // BAKING OFF by default (the artist, 2026-11-01 16:45): the world is the history window alone (세계 › 시간 범위,
        // 20 min = 60 slots); below it nothing is kept. On: the immutable layer below, baked as it is, stored
        bake: { value: false, label: "옛 층 굽기 (끄면 기록 창 20분만 남고 창 밖은 사라짐; 켜면 완전불변 층을 구워 보존)", render: () => isV2 && !REDESIGN },
        freezeSlots: { value: 4, min: 0, max: 30, step: 1, label: "부재 모양 고정 (현재에서 ↓단; 그 아래 부재는 처음 지어진 모양 그대로)", render: () => isV2 && !REDESIGN },
        immutable: { value: 60, min: 10, max: 300, step: 5, label: "완전불변 층 (현재에서 ↓단; 그 아래는 그때 모습으로 굳어 다시 계산하지 않음)", render: (get) => isV2 && !REDESIGN && get(BAKE_PATH) },
        // THE BLOCK: the count of layers multiplied in (fuse.ts freshSlots; the artist, 2026-11-15: "제일 최신 층은 화석화
        // 되면 안 되는데" → "딱 잘려보이는데, 다른 로직에 곱하거나 하는 식으로(단수를)") — new names: a factor now, not a line
        // (the new fossil does not read it — its ruler is the age; the BUILDINGS' erosion still does: spaceModel `old`)
        layerSlots: { value: 24, min: 0, max: 240, step: 1, label: "꼭대기 가까운 층의 건물은 덜 깎임: 꼭대기에서 0 → 이 단수 아래부터 제 속도 (0 = 안 봄 · 지금은 건물이 깎이는 속도에만 곱해짐 — 화석의 나이와는 무관)", render: () => REDESIGN },
        layerSpread: { value: 0.5, min: 0, max: 1, step: 0.05, label: "부재마다 늙는 속도가 다름 (0 = 같은 나이는 똑같이 → 띠로 보임 · 1 = 어떤 것은 훨씬 먼저, 어떤 것은 훨씬 나중)", render: () => REDESIGN },
        // THE BLOCK: how much of a fused part the mass takes the place of (fuse.ts absorb; the artist, 2026-11-15:
        // "건물이 녹는 게 아니라 건물에 엉겨붙도록 하는 게 예전 느낌에 더 맞는 것 같은데")
        // (0 by default since 2026-11-15 late: with parts hidden under their mass — and the eroded ones gone — a fused
        // building was a block of mass standing where no building could be seen: "건물 안 생긴 자리에 갑자기 생긴
        // 거라고!!". A new name, so what was saved as 1 does not keep it so.)
        cling: { value: 0, min: 0, max: 1, step: 0.05, label: "덩어리가 부재를 삼키는 정도 (0 = 부재는 그대로 보이고 덩어리가 엉겨 붙음 … 1 = 전시 버전처럼 부재가 녹아 사라짐)", render: () => REDESIGN },
        // THE BLOCK: what the erosion has taken leaves no mass (fuse.ts goneMass; the artist, 2026-11-15: "덩어리도 비우도록")
        goneMass: { value: 0, min: 0, max: 1, step: 0.05, label: "깎여 사라진 부재가 남기는 덩어리 (0 = 비움 … 1 = 예전처럼 통째로)", render: (get) => REDESIGN && get(BODY_PATH) !== "crust" },
        fuseOnset: { value: DEFAULT_FUSE.fuseOnset, min: 0.02, max: 0.95, step: 0.01, label: "이보다 얕은 데서 깎여 나간 부재는 화석을 남기지 않음 (창 높이의 몫 · 새 방식에서 이 손잡이가 하는 일은 이것뿐)" },
        // (THE REDESIGN, 2026-11-15: 0.9 — the mass thickens over most of a part's progress, a thin skin first; the
        // exhibition's 0.49 was full two steps after it began)
        fuseFull: { value: 1, min: 0.1, max: 1, step: 0.01, label: "화석이 다 나온 깊이 (예전 방식에서만)" },
        skeletonUntil: { value: DEFAULT_FUSE.skeletonUntil, min: 0.3, max: 1.01, step: 0.01, label: "뼈대까지 삼켜지는 진행 (>1 = 끝까지 남음)", render: (get) => get(BODY_PATH) !== "crust" && get(SKEL_PATH) > 0 },
        resinShare: { value: DEFAULT_FUSE.resinShare, min: 0.1, max: 1.01, step: 0.01, label: "레진이 되는 층 (퇴적 비율; 오래될수록 1에 가까움, >1 = 레진 없음)", render: () => !isV2 },
      }),
      [FU_MASS]: folder({
        gain: { value: DEFAULT_FUSE.gain, min: 0.5, max: 8, step: 0.1, label: "이어 붙는 세기 (클수록 부재 사이가 메워져 한 덩어리; 1 = 부재 모양 거의 그대로)" },
        blur: { value: DEFAULT_FUSE.blur, min: 0, max: 5, step: 1, label: "메워지는 틈의 너비 (복셀; 0 = 안 메움)" },
        "고급": folder(
          {
            sag: { value: DEFAULT_FUSE.sag, min: 0, max: 0.95, step: 0.01, label: "아래로 흘러내림 (덩어리가 부재 아래로 처지는 양 · 0 = 없음)" },
            // (0 in the redesign since 2026-11-15: it breaks thin, young mass into pieces by a noise — and in the block
            // nearly all the mass is thin and young by its look: fields of pebbles. The artist: "절대 이 조약돌 덩어리를
            // 원한 게 아님")
            scatter: { value: REDESIGN ? 0 : DEFAULT_FUSE.scatter, min: 0, max: 2, step: 0.05, label: "얇은 덩어리를 조각냄 (0 = 안 함 · 올리면 조약돌처럼 부서짐)", render: (get) => get(BODY_PATH) !== "crust" },
            porosity: { value: DEFAULT_FUSE.porosity, min: 0, max: 2, step: 0.05, label: "둥근 구멍 양 (오래된 층일수록 많이)", render: (get) => !get(SHELL_PATH) && !get(FOAM_PATH) },
            poreSize: { value: DEFAULT_FUSE.poreSize, min: 0.3, max: 4, step: 0.05, label: "둥근 구멍 크기 (월드; 껍질 · 거품의 '둥근 구멍' 모양도 이 크기)", render: (get) => (!get(SHELL_PATH) && !get(FOAM_PATH)) || get(HOLE_PATH) === "round" },
            skeleton: { value: DEFAULT_FUSE.skeleton, min: 0, max: 1, step: 0.01, label: "뼈대로 남는 부재 비율 (날카로운 직교 형태 유지)", render: (get) => get(BODY_PATH) !== "crust" },
            skeletonWrap: { value: DEFAULT_FUSE.skeletonWrap, min: 0, max: 1, step: 0.05, label: "뼈대가 덩어리에 덮이는 정도 (0 = 안 덮임, 1 = 다른 부재와 같게)", render: (get) => get(BODY_PATH) !== "crust" && get(SKEL_PATH) > 0 },
            spikes: { value: DEFAULT_FUSE.spikes, min: 0, max: 1, step: 0.01, label: "가시: 표면에서 뻗어 나오는 양 (0 = 없음)" },
            spikeLen: { value: DEFAULT_FUSE.spikeLen, min: 0.2, max: 4, step: 0.1, label: "가시: 가장 긴 길이 (월드)", render: (get) => get(SPIKES_PATH) > 0 },
            // V2: off by default (the artist, 2026-10-19: the soil-coloured band before the resin is not wanted)
            "계산": folder(
              {
                voxel: { value: DEFAULT_FUSE.voxel, min: 0.15, max: 1.2, step: 0.05, label: "격자 간격 (월드; 작을수록 세밀하고 무거움)" },
                iso: { value: DEFAULT_FUSE.iso, min: 0.05, max: 0.9, step: 0.01, label: "덩어리로 치는 밀도 기준 (부재마다 화석 몫 = 식생이 모인 정도가 이보다 낮은 곳은 덩어리에서 빠짐 · 높일수록 화석이 적은 곳부터 빠지고 · 낮출수록 두꺼워지고 더 멀리 이어짐)" },
                smooth: { value: DEFAULT_FUSE.smooth, min: 0, max: 6, step: 1, label: "표면 다듬기 횟수 (0 = 각진 격자 그대로; 껍질은 3 권장)" },
                // (fuse.ts N: the vegetation gathered at a cell and slot — the block's own, spaceModel blockHistory — is
                // added to the field's density there, × this, only close to the parts' mass: never a body of its own)
                natureWeight: { value: DEFAULT_FUSE.natureWeight, min: 0, max: 2, step: 0.05, label: "식생이 모인 칸에서 화석이 더 두껍게 붙음 (그 칸과 옆 칸의 부재 둘레에 덩어리를 더함 — 사이가 더 메워지고 더 멀리 부풂 · 부재가 없는 곳에는 안 생김 · 0 = 식생과 무관한 모양)", render: (get) => get(BODY_PATH) !== "crust" },
              },
              { collapsed: true },
            ),
          },
          { collapsed: true },
        ),
      }),
      // HOW a part turns into mass: as its box, as tubes along its edges (multipipe), or by its size; plates can stay
      // plates; what is added: the rooms between the plates filled
      [FU_WAY]: folder(
        {
          massMode: {
            options: {
              "통째로 (상자를 감싸고 사이를 메움)": "wrap",
              "관 (모서리만 관으로, 방은 비움 — multipipe)": "pipe",
              "크기에 따라 (작은 부재는 통째로, 큰 부재는 관)": "size",
            },
            value: "wrap" as "wrap" | "pipe" | "size",
            label: "부재가 녹는 꼴",
            render: (get) => get(BODY_PATH) !== "crust",
          },
          // A FORM OF ITS OWN FOR EVERY BUILDING (fuse.ts StudyConfig.meltVary; the artist, 2026-11-20: "형태가 너무 획일화
          // 된 것 같은 건 … 전에는 녹아내리는 꼴을 다르게 둬서 했는데", "굵은 뼈가 이전이랑 달리 안 보이는 거 같음"): the new
          // fossil is made once, as its oldest form — the frame embedded in the lump everywhere, so the thick bones of
          // the young layers were gone. Each building now takes one of three forms for good.
          // (OFF BY DEFAULT, under a new key — the artist, an hour later: "관으로 녹는거랑 통째로 녹는거는 부재 사이즈별로 하는
          // 거 아니었나?" It is: the part's size decides (크기에 따라, the shares below). This only lays a building's own
          // pick over that rule, by as much as it is turned up; what was saved as 1 under the first key does not carry over.)
          meltPick: { value: 0, min: 0, max: 1, step: 0.05, label: "크기 규칙 위에 건물마다 제 꼴을 덧씌움 (0 = 부재의 크기가 정함 — 원래 규칙 … 1 = 크기와 무관하게 건물마다 뼈대만 · 판 · 덩어리 중 하나)", render: (get) => REDESIGN && get(BODY_PATH) !== "crust" },
          meltFrame: { value: 0.3, min: 0, max: 1, step: 0.05, label: "굵은 뼈대(관)만 남는 건물의 몫", render: (get) => REDESIGN && get(BODY_PATH) !== "crust" && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0 },
          meltLump: { value: 0.35, min: 0, max: 1, step: 0.05, label: "통째 둥근 덩어리가 되는 건물의 몫 (나머지는 뼈대 속에 너덜한 판)", render: (get) => REDESIGN && get(BODY_PATH) !== "crust" && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0 },
          meltSteer: { value: 0.6, min: 0, max: 1, step: 0.05, label: "자리가 꼴을 기울임 (0 = 건물마다 무작위 … 1 = 깊고 오래 산 곳은 덩어리, 얕고 잠깐 쓴 곳은 뼈대)", render: (get) => REDESIGN && get(BODY_PATH) !== "crust" && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0 },
          pipeRadius: { value: DEFAULT_STUDY.pipeRadius, min: 0.1, max: 1.5, step: 0.05, label: "관 굵기 (월드; ② 이어 붙는 세기 1 근처에서 관이 살아남)", render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
          pipeSmall: { value: DEFAULT_STUDY.pipeSmall, min: 0, max: 1, step: 0.05, label: "관 비율 · 작은 부재 (0 = 통째로, 1 = 관만; 사이 = 관 안에 너덜한 판)", render: (get) => get(BODY_PATH) !== "crust" && get(MODE_PATH) === "size" },
          pipeLarge: { value: DEFAULT_STUDY.pipeLarge, min: 0, max: 1, step: 0.05, label: "관 비율 · 큰 부재", render: (get) => get(BODY_PATH) !== "crust" && get(MODE_PATH) === "size" },
          platesStay: { value: DEFAULT_STUDY.platesStay, label: "판은 판으로 (슬래브 · 기단은 테두리만 관, 판은 남음)", render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
          "고급": folder(
            {
              pipeThickLarge: { value: DEFAULT_STUDY.pipeThickLarge, min: 1, max: 4, step: 0.1, label: "관 굵기 · 큰 부재 배율 (큰 부재 = 굵은 뼈)", render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
              pipeJoint: { value: DEFAULT_STUDY.pipeJoint, min: 0, max: 3, step: 0.1, label: "마디: 관이 만나는 모서리의 구 (관 굵기 배, 0 = 없음)", render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
            },
            { collapsed: true, render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
          ),
          // SIZE CURVES (the artist, 2026-10-19: the look was growing uniform): a part's size, read on this band,
          // decides how much of each feature it gets (the pairs sit next to their feature)
          // EXTERNAL PARTS (the artist, 2026-10-20): what joined the buildings fuses too — the mass crosses along it
          "배관 · 다리 · 철골도 녹음": folder(
            {
              // (the redesign's fossil: THE TRUNKS ONLY, 2026-11-20 — "본줄기만 하는 건 ㄱㅊ은 생각인 것 같아": a trunk
              // hardens where it has lain for as long as the simplification takes, then comes out by its age and
              // is let go at the end of its life, as a building's part is — spaceModel.ts seededTubes)
              fusePipes: { value: DEFAULT_FUSE.fusePipes, label: REDESIGN ? "배관의 본줄기가 화석 덩어리에 들어감 (굳은 뒤, 부재처럼 나이로 나오고 삭아 사라짐)" : "배관이 덩어리에 들어감 (관 그대로, 자기 부식 시계)" },
              trunkShare: { value: 0.4, min: 0.05, max: 1, step: 0.05, label: "본줄기로 치는 관 — 그 층에서 물을 가장 많이 나르는 관의 몇 배 이상인가 (작을수록 가지까지 들어감)", render: (get) => REDESIGN && !!get(PIPES_PATH) },
              trunkThick: { value: 3, min: 1, max: 8, step: 0.25, label: "본줄기의 뼈 굵기 — 관 굵기의 몇 배로 덩어리에 들어가나", render: (get) => REDESIGN && !!get(PIPES_PATH) },
              // (…AND THE WAYS' MAIN LINES, 2026-11-21 — "길도 넣어": the most used ways of a layer, each straightened into
              // a few stretches, hardened and let go as the trunks are — spaceModel.ts waysNow. `walkRadius` is the old
              // way's: a tenth of a unit, under what the mass's grid can hold — the bone has a radius of its own)
              fuseWalks: { value: DEFAULT_FUSE.fuseWalks, label: REDESIGN ? "길의 큰 줄기가 화석 덩어리에 들어감 (굳은 뒤, 부재처럼 나이로 나오고 삭아 사라짐)" : "다리가 덩어리에 들어감 (층의 나이로 늙음)" },
              wayShare: { value: 0.3, min: 0.05, max: 1, step: 0.05, label: "화석에 드는 길 — 그 층에 놓인 길 중 가장 많이 다닌 것부터 이 몫까지 (0.3 = 위 30 % · 층마다 적어도 하나 · 1 = 전부)", render: (get) => REDESIGN && !!get(WALKS_PATH) },
              wayThick: { value: 0.45, min: 0.1, max: 2, step: 0.05, label: "길의 뼈 굵기 (월드 · 반지름 · 화석 격자 1.5칸보다 가늘어지지 않음)", render: (get) => REDESIGN && !!get(WALKS_PATH) },
              walkRadius: { value: DEFAULT_FUSE.walkRadius, min: 0.05, max: 0.6, step: 0.01, label: "다리 관 굵기 (월드)", render: (get) => get(WALKS_PATH) },
              steelFossil: { value: isV2 ? 0.35 : 0, min: 0, max: 1, step: 0.05, label: "철골 중 화석으로 남는 비율 (0 = 철골은 녹슬어 사라짐; 가장 오래 버티는 것부터)" },
            },
            { collapsed: false },
          ),
          "크기 띠": folder(
            {
              sizeSmall: { value: DEFAULT_STUDY.sizeSmall, min: 0.3, max: 20, step: 0.1, label: "'작은 부재'로 치는 크기 (월드; 가장 긴 변이 이 아래면 0)" },
              sizeLarge: { value: DEFAULT_STUDY.sizeLarge, min: 0.5, max: 40, step: 0.5, label: "'큰 부재'로 치는 크기 (월드; 이 위면 1; 사이는 커브)" },
              sizeJitter: { value: DEFAULT_STUDY.sizeJitter, min: 0, max: 1, step: 0.05, label: "부재마다 크기 읽기의 흔들림 (0 = 크기 그대로, 1 = ⅓ … 3배)" },
            },
            { collapsed: true },
          ),
          "판 사이 채우기": folder(
            {
              fill: { value: DEFAULT_STUDY.fill, label: "B 판 사이 채우기: 슬래브 · 기단 사이 방을 위에서부터 채움, 판은 날카롭게", render: (get) => get(BODY_PATH) !== "crust" },
              fillAmount: { value: DEFAULT_STUDY.fillAmount, min: 0.1, max: 1.5, step: 0.05, label: "채워지는 깊이 (1 = 아래 판까지)", render: (get) => get(BODY_PATH) !== "crust" && get(FILL_PATH) },
              fillInset: { value: DEFAULT_STUDY.fillInset, min: 0, max: 1.5, step: 0.05, label: "판 가장자리에서 물러남 (월드)", render: (get) => get(BODY_PATH) !== "crust" && get(FILL_PATH) },
            },
            { collapsed: true },
          ),
        },
        { render: () => isV2 },
      ),
      // FOSSIL CURVE (ref 9579, the artist 2026-10-19): the layer's age decides whether the mass is still
      // architecture (the voxel steps of the parts' boxes) or a fossil (smooth, the rooms carved out, the frame
      // embedded)
      [FU_FOSSIL]: folder(
        {
          fossilFrom: { value: DEFAULT_STUDY.fossilFrom, min: 0, max: 1, step: 0.01, label: "화석이 되기 시작하는 층의 나이 (부식 정도)" },
          fossilTo: { value: DEFAULT_STUDY.fossilTo, min: 0.05, max: 1, step: 0.01, label: "다 화석이 되는 층의 나이" },
          blocky: { value: 0, min: 0, max: 1, step: 0.05, label: "젊은 층의 블로키 (복셀 계단 = 건축; 0 = 다 둥글게 — 껍질 · 리브를 쓰면 0.3 아래로, 계단이 리브를 뭉갬)" },
          cavity: { value: 0, min: 0, max: 1, step: 0.05, label: "방 → 빈 공간 (판 사이 방이 둥글게 비고 판은 막으로 · 0 = 없음)", render: (get) => get(BODY_PATH) !== "crust" },
          cavityRound: { value: DEFAULT_STUDY.cavityRound, min: 1, max: 5, step: 1, label: "공동의 둥글기 (복셀)", render: (get) => get(BODY_PATH) !== "crust" && get(CAV_PATH) > 0 },
          pipeFossil: { value: isV2 ? 1 : 0, min: 0, max: 1, step: 0.05, label: "다 된 화석에서 관 뼈대가 덩어리에 묻힌 정도 (새 방식: 모든 화석에 똑같이 · 0 = 큰 부재는 뼈대만 남음 … 1 = 다 묻힘)", render: (get) => get(BODY_PATH) !== "crust" && (get(MODE_PATH) !== "wrap" || (REDESIGN && Number(get(`${FU}.${FU_WAY}.meltPick`) ?? 0) > 0)) },
          // SUBTRACTIVE (refs 9706–9708, 9579; 2026-10-20): the outline stays the building's, the organic is inside
          envelope: { value: 0, min: 0, max: 1, step: 0.05, label: "겉면은 건물 윤곽대로 (0 = 부재 밖으로 부풀림 … 1 = 윤곽에서 잘라냄; 유기물은 안에서 — 방 채움 · 방 → 공동 · 거품)", render: (get) => get(BODY_PATH) !== "crust" },
          fossilNoise: { value: isV2 ? 0.15 : 0, min: 0, max: 0.6, step: 0.01, label: "화석화 경계의 흔들림 (나이 단위; 0 = 평평한 띠)" },
        },
        { render: () => isV2 },
      ),
      // HOLLOWING: a shell with openings (ribs between), or a foam carved through the volume (sponge bone)
      [FU_HOLLOW]: folder(
        {
          shell: { value: DEFAULT_STUDY.shell, label: "껍질 (속을 비우고, 구멍 사이 벽이 리브로 남음)" },
          foam: { value: DEFAULT_STUDY.foam, label: "거품 (속을 비우지 않고 구멍을 부피째 뚫음)" },
          holeShape: {
            options: { "보로노이: 맞닿은 다각형 구멍, 사이에 리브 (뼈)": "voronoi", "노이즈: 둥글게 번지며 서로 이어지는 구멍 (벌레 먹은 듯)": "noise", "둥근 구멍: 구형 공극 (② 고급의 크기)": "round", "크기에 따라: 작은 부재는 노이즈, 큰 부재는 보로노이": "size" },
            value: DEFAULT_STUDY.holeShape as "voronoi" | "noise" | "round" | "size",
            label: "구멍 모양",
            render: (get) => get(SHELL_PATH) || get(FOAM_PATH),
          },
          ribCell: { value: DEFAULT_STUDY.ribCell, min: 0.6, max: 5, step: 0.1, label: "구멍 크기 (월드)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          ribWidth: { value: DEFAULT_STUDY.ribWidth, min: 0.05, max: 1.2, step: 0.05, label: "리브 굵기 (월드)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          ribOpen: { value: DEFAULT_STUDY.ribOpen, min: 0, max: 1, step: 0.01, label: "구멍이 덮는 정도 (0 = 닫힘 · 1 = 거의 다 열려 리브만)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          holeVoronoiSmall: { value: DEFAULT_STUDY.holeVoronoiSmall, min: 0, max: 1, step: 0.05, label: "보로노이 비율 · 작은 부재 (0 = 노이즈, 1 = 보로노이)", render: (get) => (get(SHELL_PATH) || get(FOAM_PATH)) && get(HOLE_PATH) === "size" },
          holeVoronoiLarge: { value: DEFAULT_STUDY.holeVoronoiLarge, min: 0, max: 1, step: 0.05, label: "보로노이 비율 · 큰 부재", render: (get) => (get(SHELL_PATH) || get(FOAM_PATH)) && get(HOLE_PATH) === "size" },
          "고급": folder(
            {
              ribLip: { value: DEFAULT_STUDY.ribLip, min: 0, max: 1.5, step: 0.05, label: "입술: 리브 · 구멍 테두리가 두꺼워지는 띠 (월드; 0 = 없음)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
              shellThickYoung: { value: DEFAULT_STUDY.shellThickYoung, min: 1, max: 4, step: 1, label: "껍질 두께 · 얕은 층 (복셀)", render: (get) => get(SHELL_PATH) },
              shellThick: { value: DEFAULT_STUDY.shellThick, min: 1, max: 4, step: 1, label: "껍질 벽 두께 (격자 칸 수)", render: (get) => get(SHELL_PATH) },
              shellSplit: { value: DEFAULT_STUDY.shellSplit, min: 0.05, max: 1, step: 0.01, label: "깊은 층으로 치는 층의 나이", render: (get) => get(SHELL_PATH) },
            },
            { collapsed: true, render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          ),
        },
        { render: () => isV2 },
      ),
      [FU_PITS]: folder(
        {
          pits: { value: DEFAULT_STUDY.pits, min: 0, max: 1, step: 0.05, label: "그늘 (곰보 속의 어둠; 0 = 없음 = 곰보 끔)" },
          pitCover: { value: DEFAULT_STUDY.pitCover, min: 0, max: 1, step: 0.01, label: "양 (칸마다 곰보가 있을 확률; 1 = 빽빽)", render: (get) => get(PITS_PATH) > 0 },
          pitSize: { value: DEFAULT_STUDY.pitSize, min: 0.05, max: 2, step: 0.01, label: "크기 (지름, 월드; 격자와 무관)", render: (get) => get(PITS_PATH) > 0 },
          pitDepth: { value: isV2 ? 0.6 : 0, min: 0, max: 1.5, step: 0.05, label: "파임 (음영으로 파인 깊이; 0 = 색만)", render: (get) => get(PITS_PATH) > 0 },
          pitSmall: { value: DEFAULT_STUDY.pitSmall, min: 0, max: 2, step: 0.05, label: "양 배율 · 작은 부재", render: (get) => get(PITS_PATH) > 0 },
          pitLarge: { value: DEFAULT_STUDY.pitLarge, min: 0, max: 2, step: 0.05, label: "양 배율 · 큰 부재", render: (get) => get(PITS_PATH) > 0 },
          pitBroad: { value: isV2 ? 0.6 : 0, min: 0, max: 1, step: 0.05, label: "넓은 면에 몰림 (0 = 어디나 … 1 = 넓고 평평한 면의 가운데에만)", render: (get) => get(PITS_PATH) > 0 },
          "고급": folder(
            {
              pitJitter: { value: DEFAULT_STUDY.pitJitter, min: 0, max: 1, step: 0.05, label: "크기 지터 (0 = 다 같게 … 1 = ½ ~ 2배)" },
              pitSoft: { value: DEFAULT_STUDY.pitSoft, min: 0.01, max: 0.4, step: 0.01, label: "테두리 부드러움 (0.01 = 또렷한 구멍 … 0.4 = 번진 자국)" },
              pitGather: { value: DEFAULT_STUDY.pitGather, min: 0, max: 1, step: 0.05, label: "몰림 (0 = 고르게 … 1 = 몰린 자리에는 크고 작은 곰보가 빽빽이 붙고 나머지는 맨살)" },
              pitPatch: { value: DEFAULT_STUDY.pitPatch, min: 0.5, max: 12, step: 0.5, label: "몰리는 자리 크기 (월드)" },
            },
            { collapsed: true, render: (get) => get(PITS_PATH) > 0 },
          ),
        },
        { collapsed: true, render: (get) => isV2 && (get(SHELL_PATH) || get(FOAM_PATH)) },
      ),
      // the RESIN (V2: everything fused): the FROSTED SKIN — an opaque matte body whose skin shows the parts right
      // under it, lifted by a little glow (ref 9579: matte white + AO; 9649: the white skin over machine parts);
      // the refraction (three.js transmission: the opaque scene re-rendered every frame, 1–16 fps) stays a choice
      [FU_MAT]: folder(
        {
          resinMode: {
            options: { "서리 피부 (불투명 무광 + 밑에 비치는 부재 + 속빛; 가벼움)": "frost", "굴절 (유리처럼 뒤를 굴절 · 무거움)": "refract", "반투명 (가벼움, 광택 없음)": "alpha" },
            value: "frost" as "alpha" | "refract" | "frost",
            label: "레진 몸체",
          },
          resinColor: { value: KIND_COLOR.slab, label: "레진 색 (슬래브와 같은 회색)" },
          resinRoughness: { value: 0.45, min: 0, max: 1, step: 0.01, label: "거칠기 (0 = 맑음, 1 = 서리)" },
          resinShade: { value: 0.5, min: 0, max: 1, step: 0.05, label: "비치는 덩어리 얼룩 · 곰보 (0 = 레진 색만, 1 = 다)" },
          resinGhost: { value: 0.6, min: 0, max: 1, step: 0.05, label: "밑에 비치는 부재 (피부 바로 아래의 부재가 어둡게 비침)" },
          resinGlow: { value: 0.12, min: 0, max: 0.6, step: 0.01, label: "속빛 (자체 밝기; AO에 눌린 무거움을 덜어 줌)", render: (get) => get(RESIN_MODE_PATH) === "frost" },
          resinRim: { value: 0.2, min: 0, max: 1, step: 0.05, label: "가장자리 광택 (프레넬)", render: (get) => get(RESIN_MODE_PATH) === "frost" },
          // BONE (boneLook.ts; the artist, 2026-11-20: "좀 더 '뼈' 같은 비주얼 재질로", then "매트하고 보송해보이는 게 딱
          // 좋았는데", and "레바 새로 만들 필요 없이 아래 '재질'에 넣으면 되잖아"): what has fossilised — the mass, and the
          // pipes and ways once they have — has bone's pores, a porous band round its holes, the light wrapping warm round
          // to its shadowed side and a warm rim; its own colour stays. The defaults are the matte, powdery version (2790fd1)
          boneMass: { value: 1, min: 0, max: 1, step: 0.05, label: "뼈 — 무늬 · 빛 (화석이 된 것에만 · 색은 그대로 · 0 = 끔)" },
          bonePores: { value: 0.6, min: 0, max: 1, step: 0.05, label: "뼈 — 해면질 구멍 (0 = 매끈 … 1 = 구멍마다 짙음)" },
          bonePoreSize: { value: 0.35, min: 0.05, max: 2, step: 0.01, label: "뼈 — 구멍의 크기 (월드)" },
          boneFill: { value: 0.25, min: 0, max: 1, step: 0.05, label: "뼈 — 속빛 (빛이 조금 지나오는 듯 · 그늘을 덜어 줌)" },
          boneWrap: { value: 0.5, min: 0, max: 1, step: 0.05, label: "뼈 — 빛이 그늘 쪽으로 감겨 듦 (반투명 · 보송함)" },
          boneRim: { value: 0.35, min: 0, max: 1, step: 0.05, label: "뼈 — 가장자리가 밝아짐 (눈에서 돌아가는 면)" },
          boneWarm: { value: "#ffffff", label: "뼈 — 감겨 드는 빛 · 가장자리 빛의 색 (흰색 = 중성 · 따뜻한 색은 회색 위에서 붉게 보임)" },
          boneSee: { value: 0, min: 0, max: 0.9, step: 0.05, label: "뼈 — 속이 비쳐 보임: 덩어리 전체 (속의 부재 · 식생이 제 색으로 · 0 = 불투명)" },
          boneSeeParts: { value: 0, min: 0, max: 0.9, step: 0.05, label: "뼈 — 속이 비쳐 보임: 부재가 껍질 바로 밑일수록 더" },
          transmission: { value: 0.85, min: 0, max: 1, step: 0.01, label: "굴절 · 투과 (0 = 불투명 유리, 1 = 맑은 유리)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
          thickness: { value: 1.5, min: 0, max: 10, step: 0.1, label: "굴절 · 두께감 (굴절이 얼마나 휘는지)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
          resinOpacity: { value: 0.7, min: 0.1, max: 1, step: 0.05, label: "반투명 · 불투명도", render: (get) => get(RESIN_MODE_PATH) === "alpha" },
          "고급": folder(
            {
              attenuationColor: { value: "#8a8b8c", label: "굴절 · 물드는 색 (무채색; 빛이 깊이 들어갈수록 이 색으로)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
              attenuationDistance: { value: 2.5, min: 0.1, max: 30, step: 0.1, label: "굴절 · 물드는 거리 (월드; 짧을수록 두껍고 탁한 유리)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
              transmissionScale: { value: 0.5, min: 0.25, max: 1, step: 0.25, label: "굴절 패스 해상도 (장면 재렌더 배율; 0.5 = 비용 ¼, 서리 낀 레진엔 티 안 남)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
              pointsInRefraction: { value: false, label: "굴절에 식생 점 비침 (켜면 점 수십만 개를 매 프레임 다시 그림 — 무거움)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
              // V1 only: the mass before the resin as its own body
              massBody: { options: { "불투명 (돌)": "opaque", "반투명 (속의 부재가 비쳐 보임)": "alpha" }, value: "alpha" as "opaque" | "alpha", label: "덩어리 몸체 (융합 ~ 레진 전)", render: () => !isV2 },
              massOpacity: { value: 0.75, min: 0.1, max: 1, step: 0.05, label: "덩어리 · 불투명도", render: (get) => !isV2 && get(MASS_BODY_PATH) === "alpha" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: false },
      ),
    }, [], isV2 ? [{ tag: "no-growths-2026-10-19", set: { accretion: 0 } }, { tag: "resin-colour-back-2026-10-19", set: { resinColor: KIND_COLOR.slab } }, { tag: "resin-glass-2026-10-19", set: { resinMode: "glass" } }, { tag: "resin-opaque-2026-10-19", set: { resinOpacity: 1 } }, { tag: "resin-frost-2026-10-19", set: { resinMode: "frost", resinOpacity: 0.7 } }, { tag: "fossil-opt-in-2026-10-20", set: { blocky: 0, cavity: 0 } }, ...(REDESIGN ? [{ tag: "exhibition-fusion-2026-11-15", set: EXHIBITION_FUSION }, { tag: "mass-fills-slowly-2026-11-15", set: { fuseFull: 0.9 } }, { tag: "no-pebbles-2026-11-15", set: { scatter: 0 } }, { tag: "parts-own-skins-2026-11-15", set: { fuseBody: "wrap" } }] : [])] : []),
    { order: REDESIGN ? (lab ? 7.97 : 4.4) : lab ? 2 : 8, collapsed: false },
  );
  // (the redesign's wall: only in the block — the density's buildings and a block whose top is known)
  const fuseInBlock = isV2 && dn.densityOn && botDepth > 0;
  const fuseCfg = useMemo<FuseConfig>(
    () => ({
      enabled: fu.fuseOn && (!REDESIGN || fuseInBlock),
      fusePipes: fu.fusePipes,
      trunkShare: fu.trunkShare,
      trunkThick: fu.trunkThick,
      wayShare: fu.wayShare,
      wayRadius: fu.wayThick,
      fuseWalks: fu.fuseWalks,
      walkRadius: fu.walkRadius,
      steelFossil: fu.steelFossil,
      accOnset: DEFAULT_FUSE.accOnset,
      fuseOnset: fu.fuseOnset,
      // THE BLOCK (?block=N, an experiment): no part's shape is frozen — what is written deep rewrites the parts there
      freezeSlots: isV2 && !(botDepth > 0 || dn.densityOn || (typeof window !== "undefined" && blockSlots(window.location.search) > 0)) ? fu.freezeSlots : undefined,
      fuseFull: fu.fuseFull,
      voxel: fu.voxel,
      blur: fu.blur,
      gain: fu.gain,
      porosity: fu.porosity,
      iso: fu.iso,
      natureWeight: fu.natureWeight,
      accretion: 0,
      accDepth: DEFAULT_FUSE.accDepth,
      lump: DEFAULT_FUSE.lump,
      resinShare: isV2 ? -1 : fu.resinShare, // V2: −1 = every fused face is resin (one body)
      sag: fu.sag,
      smooth: fu.smooth,
      poreSize: fu.poreSize,
      scatter: fu.scatter,
      skeleton: fu.skeleton,
      skeletonUntil: fu.skeletonUntil,
      ...(REDESIGN ? { freshSlots: fu.layerSlots, freshSpread: fu.layerSpread, goneMass: fu.goneMass, absorb: fu.cling, perBuilding: fu.fuseUnit === "building" || fu.fuseGrow === "seed", unitChange: fu.unitChange, crust: fu.fuseBody === "crust", crustVeg: fu.massVeg, assetsOnly: fu.fuseFrom === "assets", seeded: fu.fuseGrow === "seed" && fu.fuseStages !== "exhibition", pieceTile: fu.pieceTile, pieceSeg: fu.pieceSeg, voxelTie: fu.voxelTie, ...(fu.fuseStages === "stages" ? { stageN: fu.stageN, stageSweep: fu.stageSweep, roundness: fu.stageRound, stageWall: fu.stageWall } : {}) } : {}),
      skeletonWrap: fu.skeletonWrap,
      // (THE FOSSIL IN STAGES: no spikes — "표면 뾰족한 거 진짜 싫어")
      spikes: REDESIGN && fu.fuseStages === "stages" ? 0 : fu.spikes,
      spikeLen: fu.spikeLen,
      growthColor: hexToLinear("#6c6c6c"),
      study: isV2
        ? {
            fill: fu.fill,
            fillAmount: fu.fillAmount,
            fillInset: fu.fillInset,
            shell: fu.shell,
            shellThick: fu.shellThick,
            shellThickYoung: fu.shellThickYoung,
            shellSplit: fu.shellSplit,
            ribCell: fu.ribCell,
            ribWidth: fu.ribWidth,
            ribOpen: fu.ribOpen,
            holeShape: fu.holeShape as "voronoi" | "noise" | "round" | "size",
            pits: fu.pits,
            pitSize: fu.pitSize,
            pitJitter: fu.pitJitter,
            pitSoft: fu.pitSoft,
            pitCover: fu.pitCover,
            pitDepth: fu.pitDepth,
            pitGather: fu.pitGather,
            pitPatch: fu.pitPatch,
            sizeSmall: fu.sizeSmall,
            sizeLarge: fu.sizeLarge,
            sizeJitter: fu.sizeJitter,
            pipeSize: fu.massMode === "size",
            ...(REDESIGN ? { meltVary: fu.meltPick, meltFrame: fu.meltFrame, meltLump: fu.meltLump, meltSteer: fu.meltSteer } : {}),
            pipeSmall: fu.pipeSmall,
            pipeLarge: fu.pipeLarge,
            holeVoronoiSmall: fu.holeVoronoiSmall,
            holeVoronoiLarge: fu.holeVoronoiLarge,
            pitSmall: fu.pitSmall,
            pitLarge: fu.pitLarge,
            pitBroad: fu.pitBroad,
            foam: fu.foam,
            cavity: fu.cavity,
            cavityRound: fu.cavityRound,
            fossilFrom: fu.fossilFrom,
            fossilTo: fu.fossilTo,
            blocky: fu.blocky,
            platesStay: fu.platesStay,
            pipeThickLarge: fu.pipeThickLarge,
            pipeJoint: fu.pipeJoint,
            pipeFossil: fu.pipeFossil,
            ribLip: fu.ribLip,
            envelope: fu.envelope,
            fossilNoise: fu.fossilNoise,
            pipe: fu.massMode === "pipe",
            pipeRadius: fu.pipeRadius,
          }
        : undefined,
    }),
    [fu.fuseStages, fu.stageN, fu.stageSweep, fu.stageRound, fu.stageWall, fuseInBlock, fu.layerSlots, fu.layerSpread, fu.goneMass, fu.cling, fu.fuseUnit, fu.unitChange, fu.fuseBody, fu.massVeg, fu.fuseFrom, fu.fuseGrow, fu.voxelTie, fu.pieceTile, fu.pieceSeg, isV2, fu.fusePipes, fu.trunkShare, fu.trunkThick, fu.wayShare, fu.wayThick, fu.fuseWalks, fu.walkRadius, fu.steelFossil, fu.foam, fu.cavity, fu.cavityRound, fu.fossilFrom, fu.fossilTo, fu.blocky, fu.platesStay, fu.pipeThickLarge, fu.pipeJoint, fu.pipeFossil, fu.ribLip, fu.envelope, fu.fossilNoise, fu.massMode, fu.meltPick, fu.meltFrame, fu.meltLump, fu.meltSteer, fu.fill, fu.fillAmount, fu.fillInset, fu.shell, fu.shellThick, fu.shellThickYoung, fu.shellSplit, fu.ribCell, fu.ribWidth, fu.ribOpen, fu.holeShape, fu.pits, fu.pitSize, fu.pitJitter, fu.pitSoft, fu.pitCover, fu.pitDepth, fu.pitGather, fu.pitPatch, fu.sizeSmall, fu.sizeLarge, fu.sizeJitter, fu.pipeSmall, fu.pipeLarge, fu.holeVoronoiSmall, fu.holeVoronoiLarge, fu.pitSmall, fu.pitLarge, fu.pitBroad, fu.pipeRadius, fu.spikes, fu.spikeLen, fu.fuseOn, fu.fuseOnset, fu.freezeSlots, botDepth, dn.densityOn, fu.fuseFull, fu.voxel, fu.blur, fu.gain, fu.porosity, fu.iso, fu.natureWeight, fu.resinShare, fu.sag, fu.smooth, fu.poreSize, fu.scatter, fu.skeleton, fu.skeletonUntil, fu.skeletonWrap],
  );
  // A SHAPE KNOB TURNED SHOWS NOTHING AT ONCE (the artist, 2026-11-20, of the shell's thickness: "레바 손잡이 바꿔도 뭐가 확
  // 보이질 않으니"): the mass's shape is made in the worker beside, piece after piece — minutes for the whole wall —
  // and a turned knob looked as if it did nothing. The wall says so when the fusion's settings have changed: what is
  // on the screen is the old shape until its piece has been made again (the status line counts them down).
  const fuseCfgSeen = useRef("");
  useEffect(() => {
    const key = JSON.stringify(fuseCfg);
    const was = fuseCfgSeen.current;
    fuseCfgSeen.current = key;
    if (!was || was === key || !REDESIGN || !fuseCfg.enabled) return;
    showNote("화석의 모양 값이 바뀜 — 조각을 차례로 다시 만드는 중 (지금 보이는 것은 아직 옛 모양 · 상태 줄의 '남은 조각'이 0이 되면 다 바뀐 것 · 몇 분)", true);
  }, [fuseCfg]);
  // THE NEW WAY ONLY (the artist, 2026-11-20, with the wall saved on the old way — 화석이 나타나는 방식 = 예전, 덩어리를
  // 만드는 단위 = 묶음 · 타일: "지금 화석 방식 레바는 이렇게 하는 거 아냐??? … 어디서 꼬인 거지??"). That switch chose
  // between two fossils, and on the old one nothing built since 11/16 runs — the age, the life, the fossil's units,
  // the swelling out of them, the pieces' size, the letting go of what has gone. It is no longer listed (levaFocus
  // FUSION_UNLISTED), and whatever was saved for it, the wall puts it — and the old unit's knob with it — on the
  // new way here: there is one fossil.
  useEffect(() => {
    if (REDESIGN && (fu.fuseGrow !== "seed" || fu.fuseUnit !== "building")) applyValues(FU, { fuseGrow: "seed", fuseUnit: "building" });
  }, [fu.fuseGrow, fu.fuseUnit]);
  // A SET OF VALUES CHOSEN (the fusion folder's 값 묶음 불러오기): put on the folder's knobs when the choice CHANGES —
  // not when the page opens with a choice saved (what is saved may have been moved since it was chosen)
  const presetSeen = useRef(fu.fusePreset);
  useEffect(() => {
    if (fu.fusePreset === presetSeen.current) return;
    presetSeen.current = fu.fusePreset;
    if (!fu.fusePreset) return;
    if (fu.fusePreset === "saved") {
      reloadSaved(FU);
      // (the choice goes back to none — "되돌리기" is a thing done, not a set that stands)
      applyValues(FU, { fusePreset: "" });
      showNote("융합: 저장된 값으로 되돌림", true);
      return;
    }
    const set = FUSION_PRESETS[fu.fusePreset];
    if (!set) return;
    const n = applyValues(FU, set.values);
    showNote(`융합: ${set.label} — 손잡이 ${n}개를 바꿈 (남기려면 save)`, true);
  }, [fu.fusePreset]);
  const resinLook = useMemo<ResinLook>(
    () => ({
      fadeSec: fu.fuseFade,
      growThin: fu.growThin,
      growAgeMin: fu.growAgeMin,
      growDeep: fu.growDeep,
      growMelt: fu.growMelt,
      growReach: fu.growReach,
      growPress: fu.growPress,
      growSeal: fu.growSeal,
      growSealGrain: fu.growSealGrain,
      growCap: fu.growCap,
      growLate: fu.growLate,
      growRise: fu.growRise,
      growDie: fu.growDie,
      growDieAfterMin: fu.growDieAfterMin,
      growDieSpanMin: fu.growDieSpanMin,
      growDieHoles: fu.growDieHoles,
      growDieGrain: fu.growDieGrain,
      growDieRag: fu.growDieRag,
      growDiePatch: fu.growDiePatch,
      color: fu.resinColor,
      transmission: fu.resinMode === "refract" ? fu.transmission : 0,
      opacity: fu.resinMode === "alpha" ? fu.resinOpacity : 1,
      massOpacity: !isV2 && fu.massBody === "alpha" ? fu.massOpacity : 1,
      shade: fu.resinShade,
      rim: fu.resinMode === "frost" ? fu.resinRim : 0,
      ghost: fu.resinGhost,
      see: fu.boneSee + fu.boneSeeParts,
      glow: fu.resinMode === "frost" ? fu.resinGlow : 0,
      pits: { dark: fu.shell || fu.foam ? fu.pits : 0, cover: fu.pitCover, size: fu.pitSize, jitter: fu.pitJitter, soft: fu.pitSoft, depth: fu.shell || fu.foam ? fu.pitDepth : 0 },
      roughness: fu.resinRoughness,
      thickness: fu.thickness,
      attenuationColor: fu.attenuationColor,
      attenuationDistance: fu.attenuationDistance,
    }),
    [fu.fuseFade, fu.growThin, fu.growAgeMin, fu.growDeep, fu.growMelt, fu.growReach, fu.growPress, fu.growSeal, fu.growSealGrain, fu.growCap, fu.growLate, fu.growRise, fu.growDie, fu.growDieAfterMin, fu.growDieSpanMin, fu.growDieHoles, fu.growDieGrain, fu.growDieRag, fu.growDiePatch, isV2, fu.shell, fu.foam, fu.pits, fu.pitCover, fu.pitSize, fu.pitJitter, fu.pitSoft, fu.pitDepth, fu.resinMode, fu.resinOpacity, fu.resinRim, fu.resinGhost, fu.resinGlow, fu.massBody, fu.massOpacity, fu.resinShade, fu.resinColor, fu.transmission, fu.resinRoughness, fu.thickness, fu.attenuationColor, fu.attenuationDistance, fu.boneSee, fu.boneSeeParts],
  );
  // (the bone's knobs, in the material folder, read by reference by every material that draws it — boneLook.ts; the
  // pipes and the ways follow the mass: what has fossilised of them is bone too)
  useEffect(() => {
    boneU.uBoneMass.value = fu.boneMass;
    boneU.uBonePipes.value = fu.boneMass > 0 ? 1 : 0;
    boneU.uBoneWays.value = fu.boneMass > 0 ? 1 : 0;
    boneU.uBonePores.value = fu.bonePores;
    boneU.uBonePoreSize.value = fu.bonePoreSize;
    boneU.uBoneFill.value = fu.boneFill;
    boneU.uBoneWrap.value = fu.boneWrap;
    boneU.uBoneRim.value = fu.boneRim;
    boneU.uBoneWarm.value.set(fu.boneWarm);
    boneU.uSeeBase.value = fu.boneSee;
    boneU.uSeeParts.value = fu.boneSeeParts;
  }, [fu.boneMass, fu.bonePores, fu.bonePoreSize, fu.boneFill, fu.boneWrap, fu.boneRim, fu.boneWarm, fu.boneSee, fu.boneSeeParts]);
  const rnd = useControls(
    "렌더 · 성능",
    savable("렌더 · 성능", {
      perfMode: { value: false, label: "성능 모드 (해상도 ↓ · AO 절반 · 그림자 끔 · 식생 점 ↓ · LOD 가까이)" },
      // the pixels: a 5K iMac at ×2 draws 15 M of them per frame, with the AO on every one — ×1.5 looks the same
      // at that density and costs half
      dprMax: { value: 1.5, min: 1, max: 2, step: 0.25, label: "해상도 상한 (화면 픽셀 배율; 2 = 레티나 전부, 1.5 권장)" },
      AO: folder({
        aoOn: { value: true, label: "켜기" },
        aoRadius: { value: 2.5, min: 0.1, max: 12, step: 0.1, label: "반경 (월드)" },
        distanceFalloff: { value: 1, min: 0.05, max: 4, step: 0.05, label: "거리 감쇠" },
        aoIntensity: { value: 3, min: 0, max: 12, step: 0.1, label: "세기" },
        quality: { options: ["performance", "low", "medium", "high", "ultra"] as const, value: "medium" as const, label: "품질" },
        halfRes: { value: true, label: "절반 해상도 (거의 티 안 남, 비용은 ¼)" },
      }),
      "빛": folder({
        shadows: { value: true, label: "그림자" },
        azimuth: { value: 35, min: 0, max: 360, step: 1, label: "해 방위 (°)" },
        elevation: { value: 55, min: 5, max: 89, step: 1, label: "해 고도 (°)" },
        sunIntensity: { value: 1.4, min: 0, max: 4, step: 0.05, label: "해 세기 (그림자 대비)" },
        softness: { value: 3, min: 0, max: 12, step: 0.5, label: "그림자 부드러움" },
        grain: { value: 0.18, min: 0, max: 1, step: 0.01, label: "그레인 (0 = 끔)" },
      }),
      LOD: folder({
        near: { value: 40, min: 5, max: 400, step: 5, label: "이 거리 안쪽: 막대 묶음 · 드립 다 그림 (월드)" },
        mid: { value: 90, min: 5, max: 600, step: 5, label: "이 거리까지: 막대 절반 · 드립 없음; 그 너머: 통짜 매스 (월드)" },
        farFactor: { value: 0.25, min: 0.05, max: 1, step: 0.05, label: "먼 곳 식생 점 비율", render: () => !isV2 },
      }),
    }),
    { order: 9, collapsed: true },
  );
  const focusTarget = useMemo(() => new THREE.Vector3(0, 4, 0), []);
  // THE HERO SHOT (HeroShot.tsx): markers and text hidden, the camera left to the hand, every render knob at its best
  const hero = useHeroShot(isV2 && !hideUi, rootBox);
  // PERFORMANCE MODE: the same knobs, capped — fewer pixels, cheaper AO, no shadows, fewer vegetation points, closer LOD
  const perf = !hero.on && (rnd.perfMode || testPerf !== "off");
  // THE WALL (ui=0, the exhibition): one device pixel per CSS pixel and no shadows, whatever the rehearsal saved — at
  // ×1.5 a full-screen wall is 3000×1700 and the GPU falls behind; the main thread then stalls (twice a second, when the
  // worker's new buffers are uploaded) until the frame is done, which starved the room's sound (2026-10-29)
  const wall = hideUi && !lab;
  // The exhibition wall follows the rehearsal wall's 렌더링 group (the artist, 2026-10-31: "리허설보다 글로벌 해상도가 훅
  // 떨어진다"); the forced dpr 1 / no shadows of 10/29 is gone now that the per-tick full-buffer uploads are fixed.
  // 렌더 (the artist, 2026-11-16): the pixel / GPU costs as live knobs; each on "자동" does what these lines did
  // (the test render: no post-processing at all; performance mode: capped) — useRenderOptions.tsx
  const ro = useRenderOptions({
    isV2,
    testPerf,
    perfMode: rnd.perfMode,
    wall,
    hero: hero.on,
    // (the shot's ratio only once the canvas stands on the frame alone: HeroShot.tsx, in two steps)
    shot: hero.shot?.armed ? { dpr: hero.shot.dpr, msaa: hero.shot.msaa } : null,
    saved: { dprMax: rnd.dprMax, shadows: rnd.shadows, aoOn: rnd.aoOn, aoQuality: rnd.quality, aoHalfRes: rnd.halfRes, grain: rnd.grain, dof: v.dof, transmissionScale: fu.transmissionScale, aoRadius: rnd.aoRadius, distanceFalloff: rnd.distanceFalloff, aoIntensity: rnd.aoIntensity, azimuth: rnd.azimuth, elevation: rnd.elevation, sunIntensity: rnd.sunIntensity, softness: rnd.softness, dofRange: 24, dofBokeh: 4, lodNear: rnd.near, lodMid: rnd.mid, sunTurnMin: cam.sunTurnMin },
  });
  // (the flowers' bloom — plantCloudsGpu.ts: the layer's knobs turn the composer on for it, in the view of the layer alone)
  const flowerBloom = useFlowerBloom();
  const composerOn = ro.composerOn || flowerBloom.on;
  const aoHalfRes = ro.aoHalfRes;
  const aoQuality = ro.aoQuality;
  // (the view of the layer alone: no AO and no sun's shadows unless its own knobs ask — futureLife.ts FutureRender)
  const futureRender = useFutureRender(), alone = futureOnly();
  const aoOn = ro.ao && (!alone || futureRender.ao);
  const shadowsOn = ro.shadowsOn && (!alone || futureRender.shadows);
  const lodNear = ro.detail.lodNear;
  const lodMid = ro.detail.lodMid;
  // …and no transmission on the resin (its refraction pass re-renders the whole opaque scene every frame)
  const resinView = useMemo<ResinLook>(() => (ro.refraction ? resinLook : { ...resinLook, transmission: 0 }), [ro.refraction, resinLook]);
  // (taken back the same night: coarse voxels made the mass a staircase of facets — the very look being judged)
  const fuseView = fuseCfg;
  const fps = useFps();
  const natureParams = useMemo<NatureParams | null>(
    () =>
      // THE REDESIGN: no vegetation history; what gathers on buildings is the density's (vg: 건물에 모이는 식생)
      REDESIGN
        ? vg.gaOn
          ? { cfg: natureCfg, gatherSize: vg.gaSize, gatherJitter: vg.gaJitter, gatherPoints: vg.gaPoints, gatherDot: vg.gaDot, window: 0, margin: 0, reclaim: true, tauReclaimYears: 300, reclaimPerArea: vg.gaPerArea, unlived: true }
          : null
        : veg.natureOn
          ? {
              cfg: natureCfg,
              gatherSize: veg.gatherSize,
              gatherJitter: veg.gatherJitter,
              gatherPoints: veg.gatherPoints,
              gatherDot: veg.gatherDot,
              window: veg.window,
              margin: veg.margin,
              reclaim: veg.gatherOn,
              tauReclaimYears: veg.tauReclaimYears,
              reclaimPerArea: veg.gatherPerArea,
            }
          : null,
    [vg.gaOn, vg.gaSize, vg.gaJitter, vg.gaPoints, vg.gaDot, vg.gaPerArea, veg.natureOn, natureCfg, veg.gatherSize, veg.gatherJitter, veg.gatherPoints, veg.gatherDot, veg.window, veg.margin, veg.gatherOn, veg.tauReclaimYears, veg.gatherPerArea],
  );
  const recipe = useMemo<Recipe>(
    () => ({
      ...RC,
      plinth: { footprint: bld.plinthFootprint, thick: bld.plinthThick },
      basement: { depth: bld.basementDepth, footprint: bld.basementFootprint },
      pile: { count: bld.pileCount, depth: bld.pileDepth, width: bld.pileWidth },
      slat: { enabled: bld.slatOn, minFootprint: bld.slatMinFootprint, width: bld.slatWidth, density: bld.slatDensity, maxPerMass: bld.slatMax, vertical: bld.slatVertical, shortest: bld.slatShortest },
      drip: { perArea: bld.dripPerArea, max: bld.dripMax, length: bld.dripLength, alpha: bld.dripAlpha, width: bld.dripWidth },
      beam: { ...RC.beam, chance: bld.beamChance, length: bld.beamLength, width: bld.beamWidth, onGrid: bld.beamOnGrid, skew: bld.beamSkew * DEG },
      brace: { ...RC.brace, chance: bld.braceChance, length: bld.braceLength, tilt: pair(bld.braceTilt, DEG), width: bld.braceWidth },
      column: { ...RC.column, count: bld.columnCount, width: bld.columnWidth },
    }),
    [bld],
  );
  const boxCfg = useMemo<BoxConfig>(
    () => ({
      ...DEFAULT_BOXES,
      secPerUnit: tAxis.secPerUnit,
      unit: tAxis.unit,
      width: bld.partWidth,
      density: bld.partDensity,
      timeJitter: tAxis.timeJitter,
      recipe,
      growCount: dn.densityOn ? dn.dGrowCount : undefined,
      variety: vr.varietyOn ? { size: vr.vSize, angle: vr.vAngle * DEG, angleStep: vr.vAngleStep * DEG, width: vr.vWidth, height: vr.vHeight, character: vr.vCharacter } : undefined,
      buildSlots: dn.densityOn ? dn.buildSlots : undefined,
    }),
    [tAxis.secPerUnit, tAxis.unit, bld.partWidth, bld.partDensity, tAxis.timeJitter, recipe, dn.densityOn, dn.dGrowCount, dn.buildSlots, vr.varietyOn, vr.vSize, vr.vAngle, vr.vAngleStep, vr.vWidth, vr.vHeight, vr.vCharacter],
  );
  // THE VEGETATION'S FLOW (vegFlow.ts): its knobs while 식생 움직임 = 흐름, else null (the clouds)
  const vegFlowKnobs = useMemo(
    () => (vg.vegMotion === "flow" ? { speed: vg.vegFlowSpeed, swirl: vg.vegFlowSwirl, follow: vg.vegFlowFollow, herd: vg.vegFlowHerd, stray: vg.vegFlowStray } : null),
    [vg.vegMotion, vg.vegFlowSpeed, vg.vegFlowSwirl, vg.vegFlowFollow, vg.vegFlowHerd, vg.vegFlowStray],
  );
  // THE BORDERS of the villages alive at a time, for the vegetation's belts (cached per set of villages)
  const belts = useMemo(() => {
    const vs = botVillages;
    if (!vs || !(vg.vegBelt > 0)) return null;
    const R = Math.max(1, ...vs.sites.map((q) => Math.hypot(q[0], q[1]) + Math.max(1, q[4] ?? vs.radius) * 1.3));
    const cache = new Map<string, Border[]>();
    const at = (t: number): Border[] => {
      const alive: { i: number; x: number; z: number }[] = [];
      vs.sites.forEach((q, i) => q[2] <= t && t < q[3] && alive.push({ i, x: q[0], z: q[1] }));
      const key = alive.map((x) => x.i).join(",");
      let bs = cache.get(key);
      if (!bs) cache.set(key, (bs = alive.length >= 2 ? villageBorders(alive, R) : []));
      return bs;
    };
    return { share: vg.vegBelt, secPerUnit: tAxis.secPerUnit, at };
  }, [botVillages, vg.vegBelt, tAxis.secPerUnit]);
  const c = { ...tAxis, showEdges: v.showEdges, wear: wx.wear && !REDESIGN, follow: !hero.on && ((v.follow && !REDESIGN) || (rising && !!world.camRise)), markers: v.markers && !hero.on, markerHold: v.markerHold };
  // heights on the time axis, read by the "toLatest" / "toMe" buttons
  topRef.current = Math.max(stats.top, (stats.t / c.secPerUnit) * c.unit);
  focusRef.current = (stats.focusS / c.secPerUnit) * c.unit;
  const spaceFold = useMemo(() => ({ ...fold, emptyGapSec: c.emptyGapSec }), [fold, c.emptyGapSec]);
  // whether a Leva value of the groups that shape the world changed after the page settled (the readout's "tab-modified")
  const mountedAt = useRef(Date.now());
  const [tabModified, setTabModified] = useState(false);
  useEffect(() => {
    if (Date.now() - mountedAt.current > 4000) setTabModified(true);
  }, [fu, weather, boxCfg, fold, c.wear]);
  // where the stages begin, in slots below the present (the readout): the same clocks the model uses
  const depths = useMemo(() => {
    if (!weather.strata || !c.wear || stats.t <= 0) return null;
    const spu = boxCfg.secPerUnit;
    const tQ = Math.floor(stats.t / spu) * spu;
    const kNow = tQ / spu;
    const age = isV2 ? layerDecayOf(tQ, spu, weather, fold.tauSlabYears) : null;
    const at = (q: number): number | null => {
      if (!age) return null;
      for (let d = 0; d <= 400; d++) if (age(kNow - d) >= q) return d;
      return null;
    };
    return {
      gather: weather.gatherStart,
      rot: Math.round(rotOnsetSlots(weather)),
      acc: at(fuseCfg.accOnset),
      fuse: at(fuseCfg.fuseOnset),
      resin: fuseCfg.resinShare < 0 ? at(fuseCfg.fuseOnset) : fuseCfg.resinShare <= 1 ? at(fuseCfg.resinShare) : null,
    };
  }, [weather, c.wear, stats.t, boxCfg.secPerUnit, isV2, fold.tauSlabYears, fuseCfg.accOnset, fuseCfg.fuseOnset, fuseCfg.resinShare]);
  // THE FOSSIL'S LIFE IN MINUTES (the artist, 2026-11-20: "레바도 직관적으로"): the knobs of the fossil's ruler are slots of
  // age — what they come to on the clock is said in the status line, for what stands at the window's foot (the full
  // speed), and how much slower the top is. As the shader reads them (uGrowAfter, uGrowAgeSpan, uGrowDie…).
  const fossilLife = (() => {
    if (!REDESIGN || fu.fuseGrow !== "seed" || !rising) return "";
    const perTop = Math.max(1, tAxis.secPerUnit) / Math.max(0.01, win.shift);
    const after = (sm.lodSec * 1.3 + perTop) / 60;
    const min = (m: number) => (m < 10 ? `${m.toFixed(1)}분` : `${Math.round(m)}분`);
    const slow = 1 - Math.max(0, Math.min(1, fu.growDeep ?? 0.6));
    const going = fu.growDie ? ` → ${min(after + fu.growDieAfterMin)}부터 삭음 → ${min(after + fu.growDieAfterMin + fu.growDieSpanMin)}에 다 삭음` : " (삭지 않음)";
    return ` · 화석의 일생(창 바닥 기준 · 지은 뒤): ${min(after)}에 나오기 시작 → ${min(after + fu.growAgeMin * (fu.growLate > 0.05 ? fu.growLate : 1))}에 관이 다 나옴 → ${min(after + fu.growAgeMin)}에 다 화석${going} · 꼭대기에서는 ${slow > 0.02 ? `${(1 / slow).toFixed(1)}배 느림` : "화석이 안 됨"}`;
  })();

  return (
    // the wall (ui=0) shows no cursor either: nothing on it but the strata
    <div ref={rootBox} className="relative h-full w-full" style={{ background: theme.bg, cursor: hideUi ? "none" : undefined }}>
      <Leva hidden={hideUi} theme={LEVA_THEME} />
      <Canvas
        key={ro.canvasKey}
        shadows={ro.shadowType}
        dpr={ro.dpr}
        camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }}
        gl={{ antialias: ro.antialias, preserveDrawingBuffer: ro.preserveDrawingBuffer }}
        // (while a hero shot saves, the canvas stands on the frame alone, sized to it: HeroShot.tsx)
        style={hero.shot ? { position: "absolute", left: hero.shot.rect.x, top: hero.shot.rect.y, width: hero.shot.rect.w, height: hero.shot.rect.h } : undefined}
      >
        <color attach="background" args={[theme.bg]} />
        {/* (the lights beside the sun's, the exposure, the tone: 렌더 › 밝기 · 톤 — as they were until a knob moves) */}
        <ambientLight intensity={ro.look.ambient} />
        <Sun controls={controls} azimuth={ro.detail.azimuth} elevation={ro.detail.elevation} intensity={ro.detail.sunIntensity} softness={ro.detail.softness} shadows={shadowsOn} drift={{ turnMin: ro.sunTurnMin ?? cam.sunTurnMin, dir: cam.sunDir as 1 | -1, swingDeg: ro.sunTurnMin === 0 ? 0 : cam.sunSwing, swingMin: cam.sunSwingMin, active: !lab || (ro.sunTurnMin ?? 0) > 0 }} />
        <directionalLight position={[-18, 10, -12]} intensity={ro.look.fill} />
        <RenderLights look={ro.look} />
        <RendererTuning transmissionScale={ro.transmissionScale} />
        <RenderTuning shadowType={ro.shadowType} shadowMapSize={ro.shadowMapSize} shadowsOn={shadowsOn} exposure={ro.look.exposure} />
        {/* V2: no ground plane and no time axis — the timespace floats */}
        {!isV2 && <gridHelper key={v.theme} args={[80, 80, theme.grid[0], theme.grid[1]]} position={[0, -0.01, 0]} />}
        {v.seedsOn && !futureOnly() && (
          <Dandelions
            log={log}
            secPerUnit={c.secPerUnit}
            unit={c.unit}
            look={{
              size: v.seedHead,
              stem: v.seedStem,
              radius: v.seedRadius,
              spokes: v.seedSpokes,
              dome: v.seedDome,
              lineWidth: v.seedLineWidth,
              lineColor: v.seedLineColor,
              lineLight: v.seedLineLight,
              dot: v.seedDot,
              dotColor: v.seedDotColor,
              dotLight: v.seedDotLight,
              dotSquare: v.seedDotSquare,
              through: v.seedThrough,
              dustCount: v.seedDust,
              dustReach: v.seedDustReach,
              dustSec: v.seedDustSec,
              dustFrom: v.seedDustFrom,
              dustWind: v.seedDustWind,
              dustHeading: v.seedDustHeading,
              dustHeadingSpread: v.seedDustHeadingSpread,
              dustRise: v.seedDustRise,
              dustWaver: v.seedDustWaver,
              dustBurst: v.seedDustBurst,
              dustEmit: v.seedDustEmit,
              dustLifeSpread: v.seedDustLifeSpread,
              dustFade: v.seedDustFade,
              dustDot: v.seedDustDot,
              dustColor: v.seedDustColor,
              dustLight: v.seedDustLight,
              dustSoft: v.seedDustSoft,
              dustSquare: v.seedDustSquare,
              life: {
                growSec: v.seedGrowSec,
                settle: v.seedSettle,
                settleSec: v.seedSettleSec,
                fossilDepth: v.seedFossil,
                fossilSpread: v.seedFossilSpread,
                keep: v.seedKeep,
                goneSteps: v.seedGoneSteps,
                fossilScale: v.seedFossilScale,
                fossilLight: v.seedFossilLight,
                fossilSpokes: v.seedFossilSpokes,
              },
              jitter: { size: v.seedJitSize, shape: v.seedJitShape, dot: v.seedJitDot, spokes: v.seedJitSpokes, light: v.seedJitLight, dustCount: v.seedJitCount, dustReach: v.seedJitReach, dustSec: v.seedJitSec },
            }}
          />
        )}
        <SpaceWorld
          log={log}
          fold={spaceFold}
          boxCfg={boxCfg}
          showEdges={c.showEdges}
          wear={c.wear}
          follow={c.follow && !futureOnly()}
          followLift={camView.camLift}
          link={camLink}
          followWho={cam.camFollow as FollowWho}
          quietSec={cam.camQuietSec}
          controls={controls}
          onStats={setStats}
          nature={natureParams}
          lodNear={lodNear}
          lodMid={lodMid}
          pointsInRefraction={fu.pointsInRefraction && !perf}
          farFactor={rnd.farFactor}
          weather={weatherEr}
          fuse={fuseView}
          immutable={fu.immutable}
          bake={REDESIGN ? false : fu.bake}
          resin={resinView}
          water={waterView}
          density={densityCfg}
          pathLook={pathLook}
          nearFade={v.nearFade}
          noAxis={isV2}
          walk={walkView}
          walkLook={walkLook}
          partColors={partColors}
          arrive={arriveLeave}
          clock={clk}
          local={lab}
          takenEpochMs={lab ? (labWorld.world?.epochMs ?? 0) : 0}
          // (a world the lab takes is made from nothing: a model and workers of its own for each)
          key={lab ? `lab-${takenId}` : "wall"}
          fuseWorkers={ro.fuseWorkers}
          uploadMB={ro.uploadMB}
          fossilSimplify={ro.fossilSimplify}
        />
        {/* THE WALL (ui=0): a landscape — no orbiting, zooming, panning or click focus; the stage camera turns it */}
        <FocusFollow
          controls={controls}
          target={focusTarget}
          clickFocus={v.clickFocus && !wall}
          speed={v.focusSpeed}
          resetTick={focusResets}
          fixedDist={ro.detail.dofFocus === "dist" ? ro.detail.dofDist : null}
        />
        {hero.shot && <HeroCapture shot={hero.shot} composerOn={composerOn} onDone={hero.done} onArm={hero.arm} />}
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={isV2 ? Math.PI : Math.PI * 0.499} enableRotate={!wall} enableZoom={!wall} enablePan={!wall} />
        <StageCamera
          controls={controls}
          pose={{ dist: camView.camDist, polar: camView.camPolar, azimuth: camView.camAzimuth, look: camView.camLook }}
          turnSec={camView.camTurnSec}
          dir={cam.camDir as 1 | -1}
          maxPolarDeg={isV2 ? 179.5 : 89.8}
          active={!lab && !futureOnly()}
          auto={camView.camAuto ? shotSeq : null}
          link={camLink}
          status={shotLine}
        />
        {composerOn && (
          <EffectComposer key={`${aoOn}:${ro.grain > 0}:${ro.grainStill}:${ro.dof}:${ro.composerMsaa}:${flowerBloom.on}:${ro.tonePass}:${ro.levelsPass}`} multisampling={ro.composerMsaa}>
            {/* (what these measure in pixels — the blur, the grain — is scaled by hero.fx while a hero shot is drawn at a
                larger ratio than the screen's: the same look in the larger picture, HeroShot.tsx) */}
            {aoOn && <N8AO aoRadius={ro.detail.aoRadius} distanceFalloff={ro.detail.distanceFalloff} intensity={ro.detail.aoIntensity} quality={aoQuality} halfRes={aoHalfRes} color={ro.aoColor} />}
            {ro.dof && <DepthOfField target={focusTarget} worldFocusRange={ro.detail.dofRange} bokehScale={ro.detail.dofBokeh * hero.fx} />}
            {flowerBloom.on && <Bloom mipmapBlur intensity={flowerBloom.intensity} luminanceThreshold={flowerBloom.threshold} luminanceSmoothing={0.2} radius={flowerBloom.radius} />}
            {/* (the exposure and the curve, then the levels: on the finished picture, under the grain) */}
            {ro.tonePass && <TonePass curve={ro.look.toneMap} />}
            {ro.levelsPass && <LevelsPass lift={ro.look.lift} gamma={ro.look.gamma} contrast={ro.look.contrast} />}
            {ro.grain > 0 && (ro.grainStill ? <StillNoise opacity={ro.grain} cell={hero.fx} /> : <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={ro.grain} />)}
          </EffectComposer>
        )}
        {/* the vegetation fills the block the bots live in (a little above it too) */}
        {/* (not in the view of the layer above alone: futureOnly.ts) */}
        {vg.vegOn && !futureOnly() && (
          <Vegetation base={rising ? Math.max(0, Math.floor(win.top) - botDepth - 6) : 0} margin={vg.vegMargin} erode={weatherEr.erode ?? null} unit={c.unit} slots={Math.max(20, botDepth + 12)} count={ro.vegCount(vg.vegCount)} size={vg.vegSize} full={vg.vegFull} pathAt={vg.vegPathAt} colorA={vg.vegColorA} colorB={vg.vegColorB} spots={vegFlowKnobs ? 0 : vg.vegSpots} flow={vegFlowKnobs} spotR={vg.vegCloudR} spotGrow={vg.vegCloudT} spotLobed={vg.vegLobed} spotJitter={vg.vegCloudJit} moveSec={vg.vegMoveSec} moveAt={vg.vegMoveAt} ease={vg.vegEase} sway={vg.vegSway} swaySec={vg.vegSwaySec} organic={vg.vegOrganic} river={waterView && wtr.riverOn ? { gain: wtr.riverGain, keep: wtr.riverKeep, width: wtr.riverWidth } : null} belts={belts} />
        )}
        {/* markers are an overlay: their own scene, drawn after the parts (and after AO / grain) on a cleared depth
            buffer, so "me" is never buried inside the masses or darkened by AO. Priority 1 also renders the main scene
            (no composer); with the composer on (priority 1, it renders the scene) the overlay follows at 2. */}
        {c.markers && !futureOnly() && (
          <Hud key={composerOn ? "after-composer" : "plain"} renderPriority={composerOn ? 2 : 1}>
            <Markers log={log} secPerUnit={c.secPerUnit} unit={c.unit} holdSec={c.markerHold} labels={!hideUi && mk.names} tint={mk.byKind} onActive={setActive} onMe={setMeStatus} />
          </Hud>
        )}
      </Canvas>
      <HeroFrame hero={hero}>{ro.dof && <FocusLine range={ro.detail.dofRange} bokeh={ro.detail.dofBokeh} />}</HeroFrame>
      {/* THE WALL (ui=0, the exhibition): no text at all — the readout and the markers' names are debugging (the artist,
          2026-10-28); the TEST entry (no ui parameter) keeps them */}
      {!hideUi && !hero.on && (
      <div className={`pointer-events-none absolute bottom-3 left-3 select-none font-mono text-[10px] leading-4 ${theme.text}`}>
        <div>
          seeds {stats.seeds} · parts {stats.boxes} · t {Math.round(stats.t)} s · top {stats.top.toFixed(1)} · focus{" "}
          {stats.focusIsMe ? "me" : "latest"} @ {Math.round(stats.focusS)} s
          {stats.fuseSide && stats.fuseSide.chunks + stats.fuseSide.waiting + stats.fuseSide.remake > 0
            ? ` · 화석(별도 워커) ${stats.fuseSide.tris}△ · 남은 조각 ${stats.fuseSide.waiting} (다시 만들 것 ${stats.fuseSide.remake}${(stats.fuseSide as { held?: number }).held ? ` · 이웃 기다리는 것 ${(stats.fuseSide as { held?: number }).held}` : ""}) · 조각 ${Math.round(stats.fuseSide.pieceMeanMs)} ms (최대 ${Math.round(stats.fuseSide.pieceMaxMs)})${fossilStageLine(stats.fuseSide)} · 격자 ${stats.fuseSide.voxel} · 굳어서 덩어리에 든 배관 본줄기 ${(stats.fuseSide.tubes ?? 0) - (stats.fuseSide.ways ?? 0)} · 길 ${stats.fuseSide.ways ?? 0}${fossilSceneLine(stats)}${stats.fuseSide.build !== WALL_BUILD ? " · ⚠ 화석 워커가 옛 코드 — 새로고침(⌘R) 필요" : ""}`
            : ` · 덩어리 ${stats.fuseTris}△ (레진 ${stats.fuseResin}△)`}
          {stats.build && stats.build !== WALL_BUILD ? ` · ⚠ 건물 워커가 옛 코드(${stats.build}) — 새로고침(⌘R) 필요` : ""}
          {stats.fuseOut !== undefined && stats.fuseOut >= 0 ? ` · 화석: 부재에서 나온 곳 ${Math.round(stats.fuseOut * 100)}% · 평균 ${Math.round((stats.fuseOutMean ?? 0) * 100)}% 풀림${fossilLife}` : ""}{stats.lagS > boxCfg.secPerUnit ? ` · 지연 ${Math.round(stats.lagS)} s (계산이 시계보다 늦음)` : ""}
        </div>
        {/* the exhibition camera's auto run writes which shot is on (StageCamera, once a second; empty when it is off) */}
        <div ref={shotLine} />
        <div>{PART_KINDS.map((k) => `${k} ${stats.kinds[k]}`).join(" · ")}</div>
        <div>
          {fps} fps · LOD: {stats.farSeeds}/{stats.seeds} seeds solid · baked {stats.baked} chunk(s) · computed in {stats.runner}, {Math.round(stats.workerMs)} ms{testPerf !== "off" ? ` · TEST RENDER (${testPerf})` : perf ? " · PERF MODE" : ""}
        </div>
        {stats.stages && stats.stages.ms > 0 && (
          <div>
            slowest of late {Math.round(stats.stages.ms)} ms:{" "}
            {Object.entries(stats.stages.stages)
              .filter(([, v]) => v >= 1)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${k} ${Math.round(v)}`)
              .join(" · ")}
          </div>
        )}
        <div>water: {stats.links} open stream(s) now · {stats.pipeRuns} pipe run(s) laid</div>
        {ro.dof && <FocusLine range={ro.detail.dofRange} bokeh={ro.detail.dofBokeh} />}
        <div>x, z = ground · y = time (1 step = {boxCfg.secPerUnit} s) · concrete needs ≥ {fold.minVisitors} visitors</div>
        {clock.timeRate !== 1 && <div>{clock.timeRate > 0 ? `time × ${clock.timeRate} (1 step every ${(boxCfg.secPerUnit / clock.timeRate).toFixed(1)} s)` : "PAUSED (rate 0): settings apply at once, the view is pinned"}</div>}
        <div>preset: {presetSource()}{tabModified ? " · tab-modified" : ""}{params.get("cam") === "band" ? " · cam=band" : ""}</div>
        {globalBots > 0 && !lab && <div>{botReadout() ?? `bots: ${globalBots}`} (global)</div>}
        {lab && <LabLine world={labWorld.world} note={labWorld.note} clock={labClock} />}
        {depths && (
          <div>
            깊이 (현재에서 ↓단): 식생 모임 {depths.gather} · 부패 시작 {depths.rot} · 엉김 {depths.acc ?? "–"} · 융합 {depths.fuse ?? "–"} · 레진 {depths.resin ?? "없음"}{isV2 ? (fu.bake ? ` · 불변 ${fu.immutable}+` : " · 굽기 없음 (창 20분)") : ""}
          </div>
        )}
        {c.markers && (
          <div>
            live now {active} (<span style={{ color: MARK_COLOR.me }}>me</span> · <span style={{ color: MARK_COLOR.bot }}>bot</span> ·{" "}
            <span style={{ color: MARK_COLOR.visitor }}>visitor</span>)
          </div>
        )}
        {c.markers && (
          <div style={{ color: MARK_COLOR.me }}>
            {meStatus.id === null
              ? "me: none in this browser (open /mobile in this browser)"
              : meStatus.silentSec === null
                ? `me ${meStatus.id}: no presence yet`
                : meStatus.silentSec === Infinity
                  ? `me ${meStatus.id}: silent since this view opened (is its /mobile tab still open?)`
                  : `me ${meStatus.id}: last sample ${meStatus.silentSec} s ago`}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
