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

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Hud, OrbitControls } from "@react-three/drei";
import { DepthOfField, EffectComposer, N8AO, Noise } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Leva, button, buttonGroup, folder, levaStore, monitor, useControls } from "leva";
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
  buildTestColumn,
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
  type SpaceResponse,
  type WeatherConfig,
  DEFAULT_WEATHER,
  rotOnsetSlots,
  DEFAULT_WALK,
  DEFAULT_WATER,
  type WalkConfig,
  type WaterConfig,
  DEFAULT_FUSE,
  DEFAULT_STUDY,
  type FuseConfig,
  type FuseMesh,
  SpaceModel,
  layerDecayOf,
  handleSpaceRequest,
} from "@/lib/parliament";
import { useTicker } from "./useTicker";
import { LEVA_THEME, useFoldControls, useNatureControls, useWorld, useKeepWindowControl } from "./useWorld";
import { savable } from "./levaSave";
import { type CameraState, type Sequence as ShotSequence, type Shot, type ShotDriver, type StepInput, STALL_SEC, cameraStateOf, clockSec, createShotDriver, placeCamera, shotStatus, stepShotDriver } from "@/lib/parliament/cameraShots";
import { useGlobalBots } from "./useGlobalBots";
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
const FU_WHEN = "① 언제 (부재의 부식 정도: 0 새것 … 1 사라짐)";
const FU_MASS = "② 덩어리 (녹은 부재들이 되는 것)";
const FU_WAY = "③ 꼴 (부재가 녹는 꼴)";
const FU_FOSSIL = "④ 화석화 (층의 나이: 젊음 = 건축 · 오래됨 = 화석)";
const FU_HOLLOW = "⑤ 껍질 · 거품";
const FU_PITS = "⑥ 곰보 (껍질 · 거품의 표면)";
const FU_MAT = "⑦ 재질 (레진 = 융합된 것 전부)";
const MODE_PATH = `${FU}.${FU_WAY}.massMode`;
const WALKS_PATH = `${FU}.${FU_WAY}.배관 · 다리 · 철골도 녹음.fuseWalks`;
const FILL_PATH = `${FU}.${FU_WAY}.판 사이 채우기.fill`;
const SHELL_PATH = `${FU}.${FU_HOLLOW}.shell`;
const FOAM_PATH = `${FU}.${FU_HOLLOW}.foam`;
const HOLE_PATH = `${FU}.${FU_HOLLOW}.holeShape`;
const PITS_PATH = `${FU}.${FU_PITS}.pits`;
const CAV_PATH = `${FU}.${FU_FOSSIL}.cavity`;
const ACC_PATH = `${FU}.${FU_MASS}.고급.엉김 띠 (융합 전).accretion`;
const SKEL_PATH = `${FU}.${FU_MASS}.고급.skeleton`;
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
  /** Chunks of slots baked (kept as they were, below the history window too). */
  baked: number;
  /** Waterways flowing now. */
  links: number;
  pipeRuns: number;
  /** How long the worker's last computation took. */
  workerMs: number;
  /** Where it ran. */
  runner: string;
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
  perSlot: number;
  /** Point size of the vegetation volume (sediment). */
  size: number;
  /** Vegetation gathering on buildings, drawn as point clouds: the cloud's diameter, its random spread (±), the
   * number of points in one cloud and their size. */
  gatherSize: number;
  gatherJitter: number;
  gatherPoints: number;
  gatherDot: number;
  paths: { hole: number; berm: number; edge?: number } | null;
  window: number;
  margin: number;
  budget: number;
  burialSlots: number;
  /** Density floor of the vegetation volume, and how much it rises far away (V2; 0 = V1's even thinning). */
  /** V2: absolute density floor, and over how many slots it rises towards the dead layers; null = V1. */
  density: { cut: number; fade: number } | null;
  reclaim: boolean;
  tauReclaimYears: number;
  reclaimPerArea: number;
}

/** The resin body of the oldest layers: transmissive, darkening with thickness (Beer–Lambert attenuation). */
interface ResinLook {
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
  m.transparent = !solid;
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
}
function makeFuseUniforms(): FuseUniforms {
  return { uGhost: { value: 0 }, uPitDark: { value: 0 }, uPitCover: { value: 0 }, uPitSize: { value: 0.35 }, uPitJitter: { value: 0.5 }, uPitSoft: { value: 0.12 }, uPitDepth: { value: 0 } };
}

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
function patchFuseExtras(shader: THREE.WebGLProgramParametersWithUniforms, u: FuseUniforms): void {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec4 fuseExtra;\nvarying vec4 vExtra;\nvarying vec3 vFusePos;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvExtra = fuseExtra;\nvFusePos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nuniform float uGhost;\nuniform float uPitDark;\nuniform float uPitCover;\nuniform float uPitSize;\nuniform float uPitJitter;\nuniform float uPitSoft;\nuniform float uPitDepth;\nvarying vec4 vExtra;\nvarying vec3 vFusePos;\n" + FUSE_PITS_GLSL,
    )
    .replace(
      "#include <normal_fragment_begin>",
      [
        "#include <normal_fragment_begin>",
        "float fuseFlat = smoothstep( 0.45, 0.9, vExtra.y );",
        "if ( fuseFlat > 0.0 ) {",
        "\tvec3 fdx = dFdx( vViewPosition );",
        "\tvec3 fdy = dFdy( vViewPosition );",
        "\tnormal = normalize( mix( normal, normalize( cross( fdx, fdy ) ), fuseFlat ) );",
        "}",
        "if ( uPitDark + uPitDepth > 0.0 && vExtra.z * vExtra.w > 0.001 ) {",
        "\tvec4 pf = fusePits( vFusePos, uPitSize, uPitJitter, uPitCover * vExtra.z );",
        "\tif ( pf.w > 0.0 ) {",
        "\t\tfloat dent = smoothstep( 0.0, max( 0.02, uPitSoft * 2.0 ), pf.w ) * vExtra.w;",
        "\t\tvec3 gt = pf.xyz - normal * dot( pf.xyz, normal );",
        "\t\tnormal = normalize( normal - uPitDepth * 2.0 * uPitSize * gt * dent );",
        "\t\tdiffuseColor.rgb *= 1.0 - uPitDark * ( 0.35 + 0.65 * pf.w ) * dent;",
        "\t}",
        "}",
        "nonPerturbedNormal = normal;",
      ].join("\n"),
    )
    .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uGhost * vExtra.x * 0.5;");
}

/** The fused stone's material (V1's mass before the resin; V2 draws everything as resin). */
function makeStoneMaterial(u: FuseUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.userData.fuseU = u;
  m.onBeforeCompile = (shader) => patchFuseExtras(shader, u);
  return m;
}

/**
 * The resin's material: MeshPhysical whose vertex colours (the mass's stains, pits, darkening with age) are not
 * multiplied in as they are — that made the glass dirty — but normalised by the concrete's base grey, so a plain
 * surface leaves the resin colour as it is and only the deviations (pits, stains) show, by `shade` (0 = none).
 */
function makeResinMaterial(u: FuseUniforms): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, metalness: 0, vertexColors: true });
  const uShade: THREE.IUniform = { value: 0.5 };
  // the FROSTED SKIN (no refraction): a Fresnel rim — brighter where the surface turns away from the eye, as glass
  // does — on the opaque body; 0 = off
  const uRim: THREE.IUniform = { value: 0 };
  m.userData.uShade = uShade;
  m.userData.uRim = uRim;
  m.userData.fuseU = u;
  m.onBeforeCompile = (shader) => {
    patchFuseExtras(shader, u);
    shader.uniforms.uShade = uShade;
    shader.uniforms.uRim = uRim;
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
function setFused(mesh: THREE.Mesh | null, r: FuseMesh | null | undefined): void {
  if (!mesh || !r) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(r.normal, 3));
  g.setAttribute("color", new THREE.BufferAttribute(r.color, 3));
  g.setAttribute("fuseExtra", new THREE.BufferAttribute(r.extra, 4));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  // group 0: opaque fused stone; group 1: resin (the oldest layers)
  g.addGroup(0, r.resinStart, 0);
  g.addGroup(r.resinStart, r.index.length - r.resinStart, 1);
  mesh.geometry.dispose();
  mesh.geometry = g;
}

/** Replaces a Points' geometry with the given buffers (the old one is disposed, freeing its GPU memory). */
/** Pre-layer look: line colour of walkways; the pipes' material (round tubes). */
interface WalkLook {
  walkColor: string;
  /** A free end's dot (px); opacity of the kept lines (below the present). */
  walkDot: number;
  walkKeptOpacity: number;
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

/** Line segments [a, b] × n into a line set. */
function setSegments(lines: THREE.LineSegments | null, segs: Float32Array): void {
  if (!lines) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(segs, 3));
  lines.geometry.dispose();
  lines.geometry = g;
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
function corrodingPipeMaterial(color: THREE.ColorRepresentation, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const u = { uHoles: { value: 0.95 }, uOnset: { value: 0.2 }, uDark: { value: 0.55 }, uGrain: { value: 23 } };
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aDecay;\nvarying float vDecay;\nvarying vec3 vWorldP;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvDecay = aDecay;\nvWorldP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vDecay;\nvarying vec3 vWorldP;\nuniform float uHoles, uOnset, uDark, uGrain;\nfloat pipeHash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\nfloat pipeNoise(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = mix(mix(pipeHash(i), pipeHash(i + vec3(1,0,0)), f.x), mix(pipeHash(i + vec3(0,1,0)), pipeHash(i + vec3(1,1,0)), f.x), f.y); float b = mix(mix(pipeHash(i + vec3(0,0,1)), pipeHash(i + vec3(1,0,1)), f.x), mix(pipeHash(i + vec3(0,1,1)), pipeHash(i + vec3(1,1,1)), f.x), f.y); return mix(a, b, f.z); }")
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\n// holes: fine noise, more of it eaten as the pipe decays; before the onset only tarnish\nfloat pn = 0.6 * pipeNoise(vWorldP * uGrain) + 0.4 * pipeNoise(vWorldP * uGrain * 2.65);\nfloat eat = smoothstep(uOnset, 1.0, vDecay);\nif (pn < eat * uHoles) discard;",
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uDark * vDecay;");
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
  resin,
  water,
  nearFade,
  noAxis,
  walk,
  walkLook,
  clock,
  local,
}: {
  log: EventLog;
  /** The clock this view runs on (rate 0 = paused: the view is pinned and settings apply at once). */
  clock: Clock;
  /** A world of this tab only (the lab): its present is the log's end moved on by `clock`, not the shared epoch's. */
  local: boolean;
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
  walkLook: WalkLook;
}) {
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
  const pipeLive = useRef<THREE.InstancedMesh>(null);
  const pipeKept = useRef<THREE.InstancedMesh>(null);
  const elbowLive = useRef<THREE.InstancedMesh>(null);
  const elbowKept = useRef<THREE.InstancedMesh>(null);
  const naturePts = useRef<THREE.Points>(null);
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
  const focusY = useRef<number | null>(null);
  const snapped = useRef(false);
  const worker = useRef<SpaceRunner | null>(null);
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
  // the ticker reads the latest props through this ref
  const live = useRef({ fold, boxCfg, showEdges, wear, nature, lodNear, lodMid, farFactor, weather, fuse, water, noAxis, walk, onStats });
  const walkLive = useRef<THREE.LineSegments>(null);
  const walkKept = useRef<THREE.LineSegments>(null);
  const endLive = useRef<THREE.Points>(null);
  const endKept = useRef<THREE.Points>(null);
  const dotTex = useMemo(() => dotTexture(), []);
  useEffect(() => () => dotTex.dispose(), [dotTex]);
  useEffect(() => {
    live.current = { fold, boxCfg, showEdges, wear, nature, lodNear, lodMid, farFactor, weather, fuse, water, noAxis, walk, onStats };
  });
  const fused = useRef<THREE.Mesh>(null);
  const keptPipeColor = useMemo(() => new THREE.Color(walkLook.pipeColor).multiplyScalar(walkLook.pipeKeptDim), [walkLook.pipeColor, walkLook.pipeKeptDim]);
  const pipeMats = useMemo(
    () => ({ live: corrodingPipeMaterial(walkLook.pipeColor, walkLook.pipeRoughness, walkLook.pipeMetalness), kept: corrodingPipeMaterial(keptPipeColor, walkLook.pipeRoughness, walkLook.pipeMetalness) }),
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
    }
  }, [pipeMats, walkLook.pipeHoles, walkLook.pipeHoleOnset, walkLook.pipeDarken, walkLook.pipeGrain]);
  const fuseU = useMemo<FuseUniforms>(() => makeFuseUniforms(), []);
  const stoneMat = useMemo(() => makeStoneMaterial(fuseU), [fuseU]);
  const resinMat = useMemo(() => makeResinMaterial(fuseU), [fuseU]);
  useEffect(() => applyResin(resinMat, resin), [resinMat, resin]);
  useEffect(() => {
    // the mass as a translucent body: alpha, no depth write (what stands inside shows through)
    stoneMat.transparent = resin.massOpacity < 1;
    stoneMat.opacity = resin.massOpacity;
    stoneMat.depthWrite = resin.massOpacity >= 1;
    stoneMat.needsUpdate = true;
  }, [stoneMat, resin.massOpacity]);
  const fusedMats = useMemo(() => [stoneMat, resinMat], [stoneMat, resinMat]);
  const natureMat = useMemo(() => fadingPointsMaterial(), []);
  useEffect(() => {
    // transparent points are left out of the transmission pass (three.js re-renders only the opaque objects into it)
    for (const m of [natureMat, gatherMat]) {
      m.transparent = !pointsInRefraction;
      m.needsUpdate = true;
    }
  }, [natureMat, gatherMat, pointsInRefraction]);
  useEffect(() => {
    applyPointLook(natureMat, nature?.size ?? 0.07, nearFade);
    applyCloudLook(gatherMat, nature?.gatherDot ?? 0.025, (nature?.gatherSize ?? 0.3) / 2, nature?.gatherJitter ?? 0, nearFade);
  }, [natureMat, gatherMat, nature?.size, nature?.gatherDot, nature?.gatherSize, nature?.gatherJitter, nearFade]);

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
        mesh.count = n;
      }
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
      setWalkEnds(endLive.current, p.walk.liveEnds);
      setWalkEnds(endKept.current, p.walk.keptEnds);
      setPipeParts(pipeLive.current, elbowLive.current, p.pipes.live);
      setPipeParts(pipeKept.current, elbowKept.current, p.pipes.kept);
      last.current = { seeds: p.seeds, boxes: p.parts, kinds: p.counts, t: p.t, top: p.top, farSeeds: p.farSeeds, baked: p.baked, links: p.links, pipeRuns: p.pipeRuns, workerMs: r.ms, runner: worker.current?.mode ?? "-", ...focus.current };
    }
    setPoints(naturePts.current, r.nature);
    if (r.reclaim) {
      gatherCount.current = Math.min(r.reclaim.position.length / 3, GATHER_CAPACITY);
      setGatherings(gatherGeomRef.current, r.reclaim);
    }
    setFused(fused.current, r.fuse);
    if (last.current) report({ ...last.current, ...focus.current, workerMs: r.ms });
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
      worker.current = { mode: "worker", post: (m) => w.postMessage(m), stop: () => w.terminate() };
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

  // ── every TICK_MS: new events → worker, then one compute request (only one in flight) ──
  useTicker(TICK_MS, () => {
    const w = worker.current;
    if (!w) return;
    const now = performance.now();
    if (inFlight.current && now - inFlight.current.at < 15000) return;
    const { fold: f, boxCfg: cfg, showEdges: e, wear: wr, nature: nat, lodNear: near, lodMid: mid, farFactor: ff, weather: wx, fuse: fu, water: wa, walk: wk, noAxis: oneClk } = live.current; // noAxis = V2
    const waterCfg: WaterConfig = wa ? { ...wa } : { ...DEFAULT_WATER, enabled: false };
    const events = log.all();
    // the shared world's epoch names the baked layers on disk (bakeStore); the lab's world is this tab's only
    const epoch = local ? null : currentEpochKey();
    if (events.length < sent.current) {
      w.post({ type: "events", add: events, reset: true, epoch });
      labAnchor.current = null;
    } else if (events.length > sent.current) {
      w.post({ type: "events", add: events.slice(sent.current), epoch });
    } else if (epoch !== lastEpoch.current) w.post({ type: "events", add: [], epoch });
    lastEpoch.current = epoch;
    sent.current = events.length;
    // THE PRESENT FOLLOWS THE CLOCK: the world's "now" in session seconds — shared: the world clock against the
    // shared epoch; lab: the column's end moved on by the lab's own clock (so the time rate ages the world even
    // with nobody in it; the model takes the later of this and its latest event)
    let nowS: number | undefined;
    if (local) {
      if (!labAnchor.current) labAnchor.current = { ms: clock.now(), s: latestS(events) };
      nowS = labAnchor.current.s + (clock.now() - labAnchor.current.ms) / 1000;
    } else nowS = Math.min(sessionSeconds(clock.now(), getEpochMs(), 0), latestS(events) + IDLE_AGE_MAX_S);

    const meS = latestOf(events, typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY));
    const t = latestS(events);
    const meQuiet = meS !== null && nowS !== undefined && nowS - meS > quietSec;
    const useMe = meS !== null && followWho !== "latest" && !(followWho === "auto" && meQuiet);
    const focusS = useMe && meS !== null ? meS : t;
    focus.current = { focusS, focusIsMe: useMe };
    focusY.current = events.length ? (focusS / cfg.secPerUnit) * cfg.unit : null;

    const o = controls.current;
    // TIME STANDING STILL (rate 0): the camera the LOD and the vegetation window follow is pinned too, so moving the
    // view does not rebuild anything — only a changed setting does (and chunks still catching up)
    const frozen = clock.rate() === 0;
    const camNow: [number, number, number] = o ? [o.object.position.x, o.object.position.y, o.object.position.z] : [0, 0, 0];
    const focusNow = (o ? Math.max(0, o.target.y) : 0) / cfg.unit;
    if (!frozen || !pinned.current) pinned.current = { cam: camNow, focusK: focusNow };
    const { cam, focusK } = pinned.current;
    const lod = { camera: cam, near, mid, farFactor: ff };
    const id = ++seq.current;
    // PAUSE MODE (time standing still): a changed setting should show at once — the mass is asked for on every tick
    // and built many chunks at a time, the vegetation only when something it depends on changed (it is the heaviest
    // part and most settings do not touch it)
    const natSig = frozen ? JSON.stringify([nat, wx, cfg, fu, f, waterCfg]) : "";
    const withNature = !!nat && (frozen ? natSig !== lastNatSig.current : id % NATURE_EVERY === 1);
    if (withNature) lastNatSig.current = natSig;
    const req: Extract<SpaceRequest, { type: "compute" }> = { type: "compute", id, now: nowS, parts: { fold: f, box: cfg, wear: wr, weather: wx, fuse: fu, water: waterCfg, walk: wk, edges: e, lod } };
    if (withNature && nat) {
      req.nature = { fold: f, box: cfg, weather: wx, fuse: fu, nature: nat.cfg, perSlot: nat.perSlot, window: nat.window, focusK, margin: nat.margin, budget: nat.budget, burialSlots: nat.burialSlots, paths: nat.paths, lod, density: nat.density ?? undefined };
      if (nat.reclaim) {
        req.reclaim = {
          tauReclaimYears: nat.tauReclaimYears,
          perArea: nat.reclaimPerArea,
          unit: cfg.unit,
          secPerUnit: wx.strata ? cfg.secPerUnit : undefined,
          timeScale: wx.timeScale,
          fuse: fu.enabled ? fu : undefined,
        };
      }
    }
    // the fused mass follows the vegetation's cadence (it is built from its history); paused: every tick, in bulk
    if (frozen || id % NATURE_EVERY === 1) {
      req.fuse = { box: cfg, weather: wx, fuse: fu, tauReclaimYears: nat?.tauReclaimYears ?? 300, focusK, perCall: frozen ? PAUSED_FUSE_PER_CALL : undefined, oneClock: oneClk, tauSlabYears: f.tauSlabYears, rebake: frozen };
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
      {PART_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => {
            meshes.current[kind] = m;
            if (m && !m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PART_CAPACITY[kind] * 3), 3);
          }}
          args={[undefined, undefined, PART_CAPACITY[kind]]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          {kind === "pile" ? <cylinderGeometry args={[0.5, 0.5, 1, 10]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial color={KIND_COLOR[kind]} roughness={kind === "pile" || STEEL.has(kind) ? 0.7 : 1} metalness={0} />
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
        <lineBasicMaterial color={walkLook.walkColor} />
      </lineSegments>
      <lineSegments ref={walkKept} frustumCulled={false} visible={!!walk}>
        <bufferGeometry />
        <lineBasicMaterial color={walkLook.walkColor} transparent opacity={walkLook.walkKeptOpacity} depthWrite={false} />
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
      <points ref={naturePts} frustumCulled={false} visible={!!nature} material={natureMat}>
        <bufferGeometry />
      </points>
      <points geometry={gatherGeom} material={gatherMat} frustumCulled={false} visible={!!nature && nature.reclaim} />
    </>
  );
}

/**
 * The depth-of-field focus. With `clickFocus`, a click (not a drag) on the scene puts the focus on what was hit — a part,
 * the fused mass, a point — or, if nothing was hit, on the depth of the orbit target along that ray; the focus glides
 * there (`speed`). Without it, or after "resetFocus", it follows the orbit target (the centre of the view).
 */
function FocusFollow({
  controls,
  target,
  clickFocus,
  speed,
  resetTick,
}: {
  controls: React.MutableRefObject<Orbit | null>;
  target: THREE.Vector3;
  clickFocus: boolean;
  speed: number;
  /** Changes when the focus should go back to the centre of the view. */
  resetTick: number;
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
  useFrame((_, dt) => {
    const t = controls.current?.target;
    const goal = want.current ?? (t ? new THREE.Vector3(t.x, t.y, t.z) : null);
    if (!goal) return;
    target.lerp(goal, 1 - Math.exp(-dt * speed));
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
  useFrame((_, dt) => {
    const l = light.current;
    const t = controls.current?.target;
    if (!l || !t) return;
    if (drift.active) driftT.current += Math.min(dt, 0.1);
    const s = driftT.current;
    const turn = drift.active && drift.turnMin > 0 ? (drift.dir * 360 * s) / (drift.turnMin * 60) : 0;
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

/**
 * Live markers: the latest presence sample of each owner, as a sphere at (x, time, z) with a thin line down to
 * the ground. "me" is the player tab on this browser (id written to localStorage by RoleField). An owner stays
 * visible while its newest sample keeps advancing; `holdSec` of silence hides it — except "me", which is always
 * drawn at its latest presence (dimmed while silent), so the player can always be found.
 */
function Markers({
  log,
  secPerUnit,
  unit,
  holdSec,
  labels,
  onActive,
  onMe,
}: {
  log: EventLog;
  secPerUnit: number;
  unit: number;
  holdSec: number;
  /** The name over each marker ("me · worker", a bot's id, "visitor"); off on the exhibition wall (no text at all). */
  labels: boolean;
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
        const color = MARK_COLOR[m.kind];
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

/**
 * `lab`: the WORK ROOM (/v2/global/lab) — a world of this tab only (a test column on opening, never the shared
 * storage), its own clock (paused at first), no history window; the same Leva, saved under the shared view's key.
 */
export default function ParliamentSpace({ lab = false }: { lab?: boolean } = {}) {
  const isV2 = useParliamentVersion() === "v2";
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld(undefined, 1000, !lab);
  useKeepWindowControl(log, -2, !lab); // the shared history window (log.ts), the first folder
  // the lab's test column: how the crowd that writes it is spread (the artist's player-page bot values by default)
  const tc = useControls(
    "테스트 기둥 (랩 · 이 탭만)",
    savable("테스트 기둥 (랩 · 이 탭만)", {
      tcMinutes: { value: 20, min: 5, max: 60, step: 5, label: "분량 (분)" },
      tcBots: { value: 18, min: 2, max: 40, step: 1, label: "봇 수" },
      tcGroups: { value: 5, min: 1, max: 10, step: 1, label: "무리 수" },
      tcSpread: { value: 44, min: 0, max: 90, step: 1, label: "무리 간 거리 (월드; 멀수록 건물이 흩어짐)" },
      tcTime: { value: 150, min: 0, max: 600, step: 5, label: "봇 시각 폭 (s)" },
      "다시 만들기": button(() => rebuildColumn.current()),
    }),
    { order: 0.5, render: () => lab },
  );
  const rebuildColumn = useRef(() => {});
  useEffect(() => {
    rebuildColumn.current = () => {
      log.clear();
      log.addMany(buildTestColumn({ seconds: tc.tcMinutes * 60, bots: tc.tcBots, flock: { groups: tc.tcGroups, spread: tc.tcSpread, timeSpread: tc.tcTime } }));
    };
  }, [log, tc.tcMinutes, tc.tcBots, tc.tcGroups, tc.tcSpread, tc.tcTime]);
  // the lab opens with a whole column in view
  useEffect(() => {
    if (lab && log.size === 0) rebuildColumn.current();
  }, [lab, log]);
  // the clock the view and its bots run on: the shared world clock, or the lab's own (this tab only)
  const clk = useMemo<Clock>(() => (lab ? makeLocalClock(0) : sharedClock), [lab]);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";
  // THE WALL opens at real speed: the shared rate is saved per origin, and a ×20 left behind from a rehearsal would
  // run the exhibition's world away (2026-10-31)
  useEffect(() => {
    if (hideUi && !lab && clk.rate() !== 1) clk.setRate(1);
  }, [hideUi, lab, clk]);
  useReloadOnContextLoss(hideUi && !lab);
  const controls = useRef<Orbit | null>(null);
  /** The exhibition camera's auto run ↔ the time-axis follow (CamLink), and the readout line that names the shot. */
  const camLink = useRef<CamLink>({ lift: null, focusY: null });
  const shotLine = useRef<HTMLDivElement | null>(null);
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, kinds: NO_COUNTS, t: 0, top: 0, focusS: 0, focusIsMe: false, farSeeds: 0, baked: 0, links: 0, pipeRuns: 0, workerMs: 0, runner: "-" });
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
      "초점 · 시야": folder({
        dof: { value: false, label: "초점 흐림 (피사계 심도)" },
        clickFocus: { value: true, label: "클릭한 곳에 초점 (끄면 화면 중앙)" },
        dofRange: { value: 24, min: 1, max: 80, step: 1, label: "초점이 맞는 깊이 (월드)" },
        dofBokeh: { value: 4, min: 0, max: 10, step: 0.5, label: "흐림 정도" },
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
  const shotSeq: ShotSequence = {
    base: { id: 0, dist: cam.camDist, polar: cam.camPolar, lookX: cam.camLook[0], lookZ: cam.camLook[1], lift: cam.camLift, turn: 1, holdSec: cam.camHoldSec },
    shots: [
      shotFrom(1, cam.camShot1On, cam.camShot1Dist, cam.camShot1Polar, cam.camShot1Look, cam.camShot1Lift, cam.camShot1HoldSec, cam.camShot1Turn),
      shotFrom(2, cam.camShot2On, cam.camShot2Dist, cam.camShot2Polar, cam.camShot2Look, cam.camShot2Lift, cam.camShot2HoldSec, cam.camShot2Turn),
      shotFrom(3, cam.camShot3On, cam.camShot3Dist, cam.camShot3Polar, cam.camShot3Look, cam.camShot3Lift, cam.camShot3HoldSec, cam.camShot3Turn),
      shotFrom(4, cam.camShot4On, cam.camShot4Dist, cam.camShot4Polar, cam.camShot4Look, cam.camShot4Lift, cam.camShot4HoldSec, cam.camShot4Turn),
      shotFrom(5, cam.camShot5On, cam.camShot5Dist, cam.camShot5Polar, cam.camShot5Look, cam.camShot5Lift, cam.camShot5HoldSec, cam.camShot5Turn),
    ].filter((s): s is Shot => s !== null),
    fadeSec: cam.camFadeSec,
  };
  const tAxis = useControls(
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
  const clock = useControls(
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
  const bld = useControls(
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
      strata: wx.strata,
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
      "퇴적 식생 (시간 속 볼륨)": folder({
        perSlot: { value: 6, min: 0.5, max: 40, step: 0.5, label: "칸·단당 점 수 (밀도 1일 때)" },
        volumeSize: { value: 0.07, min: 0.01, max: 0.4, step: 0.005, label: "점 크기" },
        window: { value: 120, min: 10, max: 600, step: 10, label: "보이는 시간 범위 (±단)" },
        margin: { value: 5, min: 0, max: 30, step: 1, label: "방문 범위 바깥 여백 (칸)" },
        budget: { value: 600000, min: 50000, max: 3000000, step: 50000, label: "최대 점 수" },
        burialSlots: { value: 3, min: 0, max: 20, step: 1, label: "식생 매몰층: 콘크리트가 생긴 시각 아래 몇 단" },
        densityCut: { value: 0.25, min: 0, max: 0.9, step: 0.01, label: "보이는 최소 밀도 (어디서 보든 같음)", render: () => isV2 },
        densityFade: { value: 15, min: 0, max: 80, step: 1, label: "시간 방향: 옅은 곳부터 사라지는 구간 (단)", render: () => isV2 },
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
  const WALK_GROUP = "길 → 다리";
  const fold = useFoldControls(SPACE_FOLD, {
    folder: "생성 규칙 (회사원 시공간 밀집)",
    collapsed: true,
    order: lab ? 8 : 2,
    flow: {
      path: `${WALK_GROUP}.① 땅: 밟힘 → 길 (V2 · 건물과 먼저 온 쪽이 자리)`,
      order: 1,
      legacy: [`${WALK_GROUP}.① 길: 밟힘 (V2 · 유지되는 유통량)`, "생성 규칙 (회사원 시공간 밀집)"],
    },
  });
  // V2: bots run from here, without a player tab (useGlobalBots.ts)
  const globalBots = useGlobalBots(log, fold, isV2, lab ? 7 : 1.5, lab ? { clock: clk, local: true } : undefined);
  const wlk = useControls(
    WALK_GROUP,
    savable(
      WALK_GROUP,
      {
        "② 길 흔적: 식생 속 빈 통로 (남음)": folder(
          {
            pathsOn: { value: true, label: "켜기" },
            pathHole: { value: 0.35, min: 0.05, max: 1, step: 0.01, label: "빈 통로가 되는 길 세기 (작을수록 넓음)" },
            pathBerm: { value: 2, min: 0, max: 8, step: 0.5, label: "가장자리로 밀려난 흙 양" },
            pathEdge: { value: 0.75, min: 0.3, max: 0.98, step: 0.01, label: "경계 돌 띠 너비 (클수록 좁음)", render: () => isV2 },
          },
          { order: 2 },
        ),
        "③ 다리: 어디에 놓이나 (V2)": folder(
          {
            walkOn: { value: DEFAULT_WALK.enabled, label: "켜기", render: () => isV2 },
            buildAt: { value: DEFAULT_WALK.buildAt, min: 0.05, max: 0.99, step: 0.01, label: "다리가 되는 길 세기 (건물 사이 경로의 평균)", render: () => isV2 },
            maxSpan: { value: DEFAULT_WALK.maxSpan, min: 2, max: 120, step: 1, label: "가장 긴 다리 (월드)", render: () => isV2 },
            walkJoin: { value: DEFAULT_WALK.join, min: 1, max: 4, step: 1, label: "한 건물로 볼 거리 (칸)", render: () => isV2 },
            smooth: { value: DEFAULT_WALK.smooth, min: 0, max: 5, step: 1, label: "선의 부드러움 (0 = 칸에서 칸으로)", render: () => isV2 },
          },
          { order: 3, render: () => isV2 },
        ),
        "④ 다리: 층 · 이어짐 · 남음 (V2)": folder(
          {
            [PRESENT]: presentMonitor,
            walkChange: { value: DEFAULT_WALK.change, min: 0.02, max: 1, step: 0.01, label: "새 층이 놓이는 변화 (다리가 이만큼 생기거나 사라지면)", render: () => isV2 },
            walkGap: { value: DEFAULT_WALK.minGapSlots, min: 1, max: 30, step: 1, label: "새 층 최소 간격 (단)", render: () => isV2 },
            reach: { value: DEFAULT_WALK.reach, min: 0, max: 120, step: 1, label: "이보다 오래된 다리는 과거: 잇지 않음 (단, 0 = '현재' 두께)", render: () => isV2 },
            grace: { value: DEFAULT_WALK.grace, min: 0, max: 60, step: 1, label: "이만큼 안 쓰여도 같은 다리 (단, 넘으면 다시 생겨도 새 다리)", render: () => isV2 },
            minorShare: { value: DEFAULT_WALK.minorShare, min: 0, max: 1.01, step: 0.01, label: "기존 다리의 변경으로 볼 겹침 (미만 = 따로 새 다리, 경사로 없음)", render: () => isV2 },
            rampLength: { value: DEFAULT_WALK.rampLength, min: 0.5, max: 20, step: 0.5, label: "경사로 길이 (월드)", render: () => isV2 },
            resurfaceOn: { value: DEFAULT_WALK.resurface >= 0, label: "재포장: 오래 쓰는 다리를 다시 깖", render: () => isV2 },
            resurface: { value: DEFAULT_WALK.resurface, min: 0, max: 120, step: 1, label: "재포장 간격 (단, 0 = 과거가 되는 나이와 같게)", render: () => isV2 },
          },
          { order: 4, render: () => isV2 },
        ),
        "⑤ 다리 선 · 끝 점 (V2 · 프리레이어 선)": folder(
          {
            walkColor: { value: "#d8d8d8", label: "다리 선 색 (무채색)", render: () => isV2 },
            walkKeptOpacity: { value: 0.4, min: 0.05, max: 1, step: 0.05, label: "굳은 다리의 불투명도 (현재 = 1)", render: () => isV2 },
            walkDot: { value: 6, min: 0, max: 20, step: 0.5, label: "이어지지 않은 끝의 점 크기 (px, 0 = 없음)", render: () => isV2 },
          },
          { order: 5, collapsed: true, render: () => isV2 },
        ),
      },
      ["길 · 다리"],
    ),
    { order: 4, collapsed: true, render: () => !lab },
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
            rampLength: wlk.rampLength,
            smooth: wlk.smooth,
            reach: wlk.reach,
            grace: wlk.grace,
            minorShare: wlk.minorShare,
            resurface: wlk.resurfaceOn ? wlk.resurface : -1,
            life: 0,
          }
        : null,
    [isV2, wlk.walkOn, wlk.buildAt, wlk.maxSpan, wlk.walkJoin, wlk.walkChange, wlk.walkGap, wlk.rampLength, wlk.smooth, wlk.reach, wlk.grace, wlk.minorShare, wlk.resurfaceOn, wlk.resurface],
  );
  // ── 물 → 배관 (V1 + V2): the sealed ground → its rain piped below (dense) / open streams (sparse, past outfalls) ──
  const WATER_GROUP = "물 → 배관";
  const wtr = useControls(
    WATER_GROUP,
    savable(
      WATER_GROUP,
      {
        waterOn: { value: DEFAULT_WATER.enabled, label: "켜기" },
        "① 땅: 덮인 땅 (빗물이 못 스밈)": folder(
          {
            imperviousRadius: { value: DEFAULT_WATER.imperviousRadius, min: 1, max: 10, step: 1, label: "덮인 비율을 재는 범위 (칸)" },
            pathAt: { value: DEFAULT_WATER.pathAt, min: 0.05, max: 1, step: 0.01, label: "덮인 땅이 되는 길 세기 (포장된 길)" },
            join: { value: DEFAULT_WATER.join, min: 1, max: 4, step: 1, label: "한 건물로 볼 거리 (칸)" },
            persistSec: { value: DEFAULT_WATER.persistSec, min: 0, max: 3600, step: 10, label: "건물이 비어도 물이 나오는 시간 (s)" },
          },
          { order: 1 },
        ),
        "② 배관: 어디에 깔리나": folder(
          {
            burial: { value: DEFAULT_WATER.burial, min: 0.02, max: 1, step: 0.01, label: "배관이 되는 덮인 비율 (건물 주변)" },
            quarterGap: { value: DEFAULT_WATER.quarterGap, min: 1, max: 40, step: 0.5, label: "한 관망으로 묶는 건물 간 거리 (월드)" },
            diagonal: { value: DEFAULT_WATER.diagonal, min: 0, max: 1, step: 0.05, label: "45° 꺾임 (0 = 직각만)" },
            pipeDepth: { value: DEFAULT_WATER.pipeDepth, min: 0, max: 10, step: 0.5, label: "묻히는 깊이 (깔린 층보다 몇 단 아래 — 늘 다리 아래)" },
          },
          { order: 2 },
        ),
        "③ 배관: 층 · 이어짐 · 남음": folder(
          {
            [PRESENT]: presentMonitor,
            change: { value: DEFAULT_WATER.change, min: 0.01, max: 1, step: 0.01, label: "새 층이 놓이는 변화 (덮인 땅이 이만큼 바뀌면; 건물이 오고 가도)" },
            minGapSlots: { value: DEFAULT_WATER.minGapSlots, min: 1, max: 30, step: 1, label: "새 층 최소 간격 (단)" },
            pipeReach: { value: DEFAULT_WATER.reach, min: 0, max: 120, step: 1, label: "이보다 오래된 관은 과거: 잇지 않음 (단, 0 = '현재' 두께)" },
            pipeGrace: { value: DEFAULT_WATER.grace, min: 0, max: 60, step: 1, label: "이만큼 안 쓰여도 같은 관 (단)" },
            relayOn: { value: DEFAULT_WATER.relay >= 0, label: "재부설: 오래 쓰는 관망을 다시 깖" },
            relay: { value: DEFAULT_WATER.relay, min: 0, max: 120, step: 1, label: "재부설 간격 (단, 0 = 과거가 되는 나이와 같게)" },
          },
          { order: 3 },
        ),
        "④ 배관 모양 · 재질 · 부식": folder(
          {
            pipeRadius: { value: DEFAULT_WATER.pipeRadius, min: 0.01, max: 0.2, step: 0.005, label: "관 굵기 (건물 하나 몫, 반지름)" },
            flowGain: { value: DEFAULT_WATER.flowGain, min: 0, max: 1, step: 0.05, label: "모일수록 굵어짐 (0 = 다 같게, 0.5 = √)" },
            elbow: { value: DEFAULT_WATER.elbow, min: 0.5, max: 3, step: 0.05, label: "엘보 반지름 (관 굵기 배; 작을수록 급한 직각)" },
            shaftRadius: { value: DEFAULT_WATER.shaftRadius, min: 0.5, max: 4, step: 0.05, label: "맨홀 세로관 굵기 (관 굵기 배)" },
            coverRadius: { value: DEFAULT_WATER.coverRadius, min: 1, max: 4, step: 0.05, label: "맨홀 뚜껑 너비 (세로관 배)" },
            coverHeight: { value: DEFAULT_WATER.coverHeight, min: 0, max: 2, step: 0.05, label: "맨홀 뚜껑 두께 (세로관 반지름 배)" },
            collarRadius: { value: DEFAULT_WATER.collarRadius, min: 1, max: 2.5, step: 0.05, label: "칼라(T 이음쇠) 굵기 (관 배)" },
            collarLength: { value: DEFAULT_WATER.collarLength, min: 0.2, max: 4, step: 0.1, label: "칼라 길이 (관 반지름 배, 반쪽)" },
            pipeColor: { value: "#7c7f84", label: "관 색 (무채색)" },
            pipeRoughness: { value: 0.55, min: 0, max: 1, step: 0.01, label: "관 거칠기" },
            pipeMetalness: { value: 0.35, min: 0, max: 1, step: 0.01, label: "관 금속성" },
            pipeKeptDim: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: "굳은 관의 밝기 (현재 대비)" },
            "부식 (오래된 관부터, 부재와 같은 시계)": folder({
              pipeLife: { value: DEFAULT_WATER.pipeLife, min: 0, max: 5, step: 0.05, label: "관 수명 (철골 대비; 0 = 부식 없음)" },
              thin: { value: DEFAULT_WATER.thin, min: 0, max: 0.9, step: 0.05, label: "다 부식하면 얇아지는 비율" },
              pipeHoleOnset: { value: 0.2, min: 0, max: 0.95, step: 0.05, label: "구멍이 나기 시작하는 부식 정도" },
              pipeHoles: { value: 0.95, min: 0, max: 1, step: 0.05, label: "다 부식하면 먹히는 벽 비율" },
              pipeGrain: { value: 23, min: 3, max: 80, step: 1, label: "구멍 결 (클수록 잘고 많음)" },
              pipeDarken: { value: 0.55, min: 0, max: 1, step: 0.05, label: "부식할수록 어두워짐" },
            }),
          },
          { order: 4, collapsed: true },
        ),
        "⑤ 열린 물길: 식생 · 부식 (남음: 식생 속 물길)": folder(
          {
            openShare: { value: DEFAULT_WATER.openShare, min: 0, max: 0.6, step: 0.01, label: "물이 다시 스미는 덮인 비율 (배출구)" },
            streamLength: { value: DEFAULT_WATER.streamLength, min: 0, max: 40, step: 0.5, label: "배출구 너머로 흐르는 거리 (월드)" },
            channel: { value: DEFAULT_WATER.channel, min: 0, max: 4, step: 0.05, label: "물길 폭 (식생이 비는 너비)" },
            meander: { value: DEFAULT_WATER.meander, min: 0, max: 0.6, step: 0.01, label: "굽이" },
            radius: { value: DEFAULT_WATER.radius, min: 0.5, max: 8, step: 0.1, label: "습지 폭 (물길에서 영향 범위, 월드)" },
            vegBoost: { value: DEFAULT_WATER.vegBoost, min: 0, max: 2, step: 0.05, label: "물가 식생 밀도 (짙어지는 정도)" },
            wetShare: { value: DEFAULT_WATER.wetShare, min: 0, max: 1, step: 0.05, label: "물가 식생 중 습지색 비율" },
            corrode: { value: DEFAULT_WATER.corrode, min: 0, max: 5, step: 0.1, label: "물에 닿은 부품이 빨리 부식하는 정도" },
          },
          { order: 5, collapsed: true },
        ),
      },
      ["수로 (덮인 땅의 물)", "길 · 다리"],
    ),
    { order: 5, collapsed: true, render: () => !lab },
  );
  const waterView = useMemo<WaterConfig | null>(
    () =>
      wtr.waterOn
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
            persistSec: wtr.persistSec,
            meander: wtr.meander,
            channel: wtr.channel,
            radius: wtr.radius,
            vegBoost: wtr.vegBoost,
            wetShare: wtr.wetShare,
            corrode: wtr.corrode,
            pipeRadius: wtr.pipeRadius,
            quarterGap: wtr.quarterGap,
            reach: wtr.pipeReach,
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
          }
        : null,
    [wtr.waterOn, wtr.join, wtr.change, wtr.minGapSlots, wtr.pipeDepth, wtr.imperviousRadius, wtr.burial, wtr.openShare, wtr.pathAt, wtr.diagonal, wtr.streamLength, wtr.persistSec, wtr.meander, wtr.channel, wtr.radius, wtr.vegBoost, wtr.wetShare, wtr.corrode, wtr.pipeRadius, wtr.quarterGap, wtr.pipeReach, wtr.pipeGrace, wtr.relayOn, wtr.relay, wtr.elbow, wtr.flowGain, wtr.shaftRadius, wtr.coverRadius, wtr.coverHeight, wtr.collarRadius, wtr.collarLength, wtr.pipeLife, wtr.thin],
  );
  const theme = THEMES[v.theme as keyof typeof THEMES] ?? THEMES.paper;
  const walkLook = useMemo<WalkLook>(
    () => ({ walkColor: wlk.walkColor, walkDot: wlk.walkDot, walkKeptOpacity: wlk.walkKeptOpacity, pipeColor: wtr.pipeColor, pipeRoughness: wtr.pipeRoughness, pipeMetalness: wtr.pipeMetalness, pipeKeptDim: wtr.pipeKeptDim, pipeHoles: wtr.pipeHoles, pipeHoleOnset: wtr.pipeHoleOnset, pipeDarken: wtr.pipeDarken, pipeGrain: wtr.pipeGrain }),
    [wlk.walkColor, wlk.walkDot, wlk.walkKeptOpacity, wtr.pipeColor, wtr.pipeRoughness, wtr.pipeMetalness, wtr.pipeKeptDim, wtr.pipeHoles, wtr.pipeHoleOnset, wtr.pipeDarken, wtr.pipeGrain],
  );
  const { cfg: natureCfg } = useNatureControls({ folder: "식생 규칙 (개인 뷰와 공유)", rulesOnly: true, collapsed: true, order: lab ? 8.5 : 6.5 });
  const fu = useControls(
    FU,
    savable(FU, {
      fuseOn: { value: DEFAULT_FUSE.enabled, label: "켜기 (풍화 · 지층의 '마모'와 '지층'이 켜져 있어야 함)" },
      // ONE CLOCK: what happens to a part is read off its corrosion (0 = new … 1 = gone), the same for every stage
      [FU_WHEN]: folder({
        fuseOnset: { value: DEFAULT_FUSE.fuseOnset, min: 0.02, max: 0.95, step: 0.01, label: "덩어리로 녹기 시작" },
        accOnset: { value: DEFAULT_FUSE.accOnset, min: 0, max: 0.9, step: 0.01, label: "엉김 띠가 붙기 시작 (② 고급의 띠 양 > 0일 때)", render: (get) => get(ACC_PATH) > 0 },
        skeletonUntil: { value: DEFAULT_FUSE.skeletonUntil, min: 0.3, max: 1.01, step: 0.01, label: "뼈대까지 삼켜짐 (>1 = 끝까지 남음)", render: (get) => get(SKEL_PATH) > 0 },
        resinShare: { value: DEFAULT_FUSE.resinShare, min: 0.1, max: 1.01, step: 0.01, label: "레진이 되는 층 (퇴적 비율; 오래될수록 1에 가까움, >1 = 레진 없음)", render: () => !isV2 },
      }),
      [FU_MASS]: folder({
        gain: { value: DEFAULT_FUSE.gain, min: 0.5, max: 8, step: 0.1, label: "이어 붙는 세기 (클수록 부재 사이가 메워져 한 덩어리; 1 = 부재 모양 거의 그대로)" },
        blur: { value: DEFAULT_FUSE.blur, min: 0, max: 5, step: 1, label: "메워지는 틈의 너비 (복셀; 0 = 안 메움)" },
        "고급": folder(
          {
            sag: { value: DEFAULT_FUSE.sag, min: 0, max: 0.95, step: 0.01, label: "아래로 흘러내림 (0 = 없음; 젊은 블로키 층은 안 흐름)" },
            scatter: { value: DEFAULT_FUSE.scatter, min: 0, max: 2, step: 0.05, label: "젊은 층 가장자리 부스러짐 (0 = 매끈)" },
            porosity: { value: DEFAULT_FUSE.porosity, min: 0, max: 2, step: 0.05, label: "둥근 구멍 양 (오래된 층일수록 많이)", render: (get) => !get(SHELL_PATH) && !get(FOAM_PATH) },
            poreSize: { value: DEFAULT_FUSE.poreSize, min: 0.3, max: 4, step: 0.05, label: "둥근 구멍 크기 (월드; 껍질 · 거품의 '둥근 구멍' 모양도 이 크기)", render: (get) => !get(SHELL_PATH) && !get(FOAM_PATH) },
            skeleton: { value: DEFAULT_FUSE.skeleton, min: 0, max: 1, step: 0.01, label: "뼈대로 남는 부재 비율 (날카로운 직교 형태 유지)" },
            skeletonWrap: { value: DEFAULT_FUSE.skeletonWrap, min: 0, max: 1, step: 0.05, label: "뼈대가 덩어리에 덮이는 정도 (0 = 안 덮임, 1 = 다른 부재와 같게)", render: (get) => get(SKEL_PATH) > 0 },
            spikes: { value: DEFAULT_FUSE.spikes, min: 0, max: 1, step: 0.01, label: "가시: 표면에서 뻗어 나오는 양 (0 = 없음)" },
            spikeLen: { value: DEFAULT_FUSE.spikeLen, min: 0.2, max: 4, step: 0.1, label: "가시: 가장 긴 길이 (월드)", render: (get) => get(SPIKES_PATH) > 0 },
            // V2: off by default (the artist, 2026-10-19: the soil-coloured band before the resin is not wanted)
            "엉김 띠 (융합 전)": folder(
              {
                accretion: { value: isV2 ? 0 : DEFAULT_FUSE.accretion, min: 0, max: 3, step: 0.05, label: "양 (0 = 없음 = 이 띠 없이 바로 융합)" },
                accDepth: { value: DEFAULT_FUSE.accDepth, min: 0.1, max: 4, step: 0.05, label: "두께 (월드)", render: (get) => get(ACC_PATH) > 0 },
                lump: { value: DEFAULT_FUSE.lump, min: 0.2, max: 4, step: 0.05, label: "뭉치 크기 (월드; 클수록 굵은 몇 덩이)", render: (get) => get(ACC_PATH) > 0 },
                growthColor: { value: "#ada585", label: "색 (이 띠의 흙색; 회색이면 #6e6e6e)", render: (get) => get(ACC_PATH) > 0 },
              },
              { collapsed: true },
            ),
            "계산": folder(
              {
                voxel: { value: DEFAULT_FUSE.voxel, min: 0.15, max: 1.2, step: 0.05, label: "격자 간격 (월드; 작을수록 세밀하고 무거움)" },
                iso: { value: DEFAULT_FUSE.iso, min: 0.05, max: 0.9, step: 0.01, label: "덩어리로 치는 밀도 기준 (낮출수록 두꺼워지고 더 멀리 이어짐)" },
                smooth: { value: DEFAULT_FUSE.smooth, min: 0, max: 6, step: 1, label: "표면 다듬기 횟수 (0 = 각진 격자 그대로; 껍질은 3 권장)" },
                natureWeight: { value: DEFAULT_FUSE.natureWeight, min: 0, max: 2, step: 0.05, label: "식생 퇴적물이 덩어리에 섞이는 양" },
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
          },
          pipeRadius: { value: DEFAULT_STUDY.pipeRadius, min: 0.1, max: 1.5, step: 0.05, label: "관 굵기 (월드; ② 이어 붙는 세기 1 근처에서 관이 살아남)", render: (get) => get(MODE_PATH) !== "wrap" },
          pipeSmall: { value: DEFAULT_STUDY.pipeSmall, min: 0, max: 1, step: 0.05, label: "관 비율 · 작은 부재 (0 = 통째로, 1 = 관만; 사이 = 관 안에 너덜한 판)", render: (get) => get(MODE_PATH) === "size" },
          pipeLarge: { value: DEFAULT_STUDY.pipeLarge, min: 0, max: 1, step: 0.05, label: "관 비율 · 큰 부재", render: (get) => get(MODE_PATH) === "size" },
          platesStay: { value: DEFAULT_STUDY.platesStay, label: "판은 판으로 (슬래브 · 기단은 테두리만 관, 판은 남음)", render: (get) => get(MODE_PATH) !== "wrap" },
          "고급": folder(
            {
              pipeThickLarge: { value: DEFAULT_STUDY.pipeThickLarge, min: 1, max: 4, step: 0.1, label: "관 굵기 · 큰 부재 배율 (큰 부재 = 굵은 뼈)", render: (get) => get(MODE_PATH) !== "wrap" },
              pipeJoint: { value: DEFAULT_STUDY.pipeJoint, min: 0, max: 3, step: 0.1, label: "마디: 관이 만나는 모서리의 구 (관 굵기 배, 0 = 없음)", render: (get) => get(MODE_PATH) !== "wrap" },
            },
            { collapsed: true, render: (get) => get(MODE_PATH) !== "wrap" },
          ),
          // SIZE CURVES (the artist, 2026-10-19: the look was growing uniform): a part's size, read on this band,
          // decides how much of each feature it gets (the pairs sit next to their feature)
          // EXTERNAL PARTS (the artist, 2026-10-20): what joined the buildings fuses too — the mass crosses along it
          "배관 · 다리 · 철골도 녹음": folder(
            {
              fusePipes: { value: DEFAULT_FUSE.fusePipes, label: "배관이 덩어리에 들어감 (관 그대로, 자기 부식 시계)" },
              fuseWalks: { value: DEFAULT_FUSE.fuseWalks, label: "다리가 덩어리에 들어감 (층의 나이로 늙음)" },
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
              fill: { value: DEFAULT_STUDY.fill, label: "B 판 사이 채우기: 슬래브 · 기단 사이 방을 위에서부터 채움, 판은 날카롭게" },
              fillAmount: { value: DEFAULT_STUDY.fillAmount, min: 0.1, max: 1.5, step: 0.05, label: "채워지는 깊이 (1 = 아래 판까지)", render: (get) => get(FILL_PATH) },
              fillInset: { value: DEFAULT_STUDY.fillInset, min: 0, max: 1.5, step: 0.05, label: "판 가장자리에서 물러남 (월드)", render: (get) => get(FILL_PATH) },
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
          cavity: { value: 0, min: 0, max: 1, step: 0.05, label: "방 → 공동 (오래된 층의 방이 둥근 빈 공간으로, 판은 막으로; 0 = 없음; 9579 레시피 0.7–1)" },
          cavityRound: { value: DEFAULT_STUDY.cavityRound, min: 1, max: 5, step: 1, label: "공동의 둥글기 (복셀)", render: (get) => get(CAV_PATH) > 0 },
          pipeFossil: { value: isV2 ? 1 : 0, min: 0, max: 1, step: 0.05, label: "관 뼈대가 오래된 층에서 묻힘 (0 = 끝까지 뼈대, 1 = 다 묻힘)", render: (get) => get(MODE_PATH) !== "wrap" },
          // SUBTRACTIVE (refs 9706–9708, 9579; 2026-10-20): the outline stays the building's, the organic is inside
          envelope: { value: 0, min: 0, max: 1, step: 0.05, label: "겉면은 건물 윤곽대로 (0 = 부재 밖으로 부풀림 … 1 = 윤곽에서 잘라냄; 유기물은 안에서 — 방 채움 · 방 → 공동 · 거품)" },
          fossilNoise: { value: isV2 ? 0.15 : 0, min: 0, max: 0.6, step: 0.01, label: "화석화 경계의 흔들림 (나이 단위; 0 = 평평한 띠)" },
        },
        { render: () => isV2 },
      ),
      // HOLLOWING: a shell with openings (ribs between), or a foam carved through the volume (sponge bone)
      [FU_HOLLOW]: folder(
        {
          shell: { value: DEFAULT_STUDY.shell, label: "껍질: 속을 비우고 구멍을 엶 (구멍 사이 벽 = 리브)" },
          foam: { value: DEFAULT_STUDY.foam, label: "거품: 속을 비우지 않고 셀을 부피째 공동으로 (해면뼈, 9579)" },
          holeShape: {
            options: { "보로노이: 맞닿은 다각형 구멍, 사이에 리브 (뼈)": "voronoi", "노이즈: 둥글게 번지며 서로 이어지는 구멍 (벌레 먹은 듯)": "noise", "둥근 구멍: 구형 공극 (② 고급의 크기)": "round", "크기에 따라: 작은 부재는 노이즈, 큰 부재는 보로노이": "size" },
            value: DEFAULT_STUDY.holeShape as "voronoi" | "noise" | "round" | "size",
            label: "구멍 모양",
            render: (get) => get(SHELL_PATH) || get(FOAM_PATH),
          },
          ribCell: { value: DEFAULT_STUDY.ribCell, min: 0.6, max: 5, step: 0.1, label: "구멍 크기 (월드)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          ribWidth: { value: DEFAULT_STUDY.ribWidth, min: 0.05, max: 1.2, step: 0.05, label: "리브 굵기 (보로노이: 벽 두께 · 노이즈: 가장자리 부드러움)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          ribOpen: { value: DEFAULT_STUDY.ribOpen, min: 0, max: 1, step: 0.01, label: "열리는 비율 (0 = 닫힘, 1 = 거의 다; 거품: 공동이 되는 셀의 몫)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
          holeVoronoiSmall: { value: DEFAULT_STUDY.holeVoronoiSmall, min: 0, max: 1, step: 0.05, label: "보로노이 비율 · 작은 부재 (0 = 노이즈, 1 = 보로노이)", render: (get) => (get(SHELL_PATH) || get(FOAM_PATH)) && get(HOLE_PATH) === "size" },
          holeVoronoiLarge: { value: DEFAULT_STUDY.holeVoronoiLarge, min: 0, max: 1, step: 0.05, label: "보로노이 비율 · 큰 부재", render: (get) => (get(SHELL_PATH) || get(FOAM_PATH)) && get(HOLE_PATH) === "size" },
          "고급": folder(
            {
              ribLip: { value: DEFAULT_STUDY.ribLip, min: 0, max: 1.5, step: 0.05, label: "입술: 리브 · 구멍 테두리가 두꺼워지는 띠 (월드; 0 = 없음)", render: (get) => get(SHELL_PATH) || get(FOAM_PATH) },
              shellThickYoung: { value: DEFAULT_STUDY.shellThickYoung, min: 1, max: 4, step: 1, label: "껍질 두께 · 얕은 층 (복셀)", render: (get) => get(SHELL_PATH) },
              shellThick: { value: DEFAULT_STUDY.shellThick, min: 1, max: 4, step: 1, label: "껍질 두께 · 깊은 층 (복셀)", render: (get) => get(SHELL_PATH) },
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
              pitGather: { value: DEFAULT_STUDY.pitGather, min: 0, max: 1, step: 0.05, label: "몰림 (0 = 고르게, 1 = 어떤 면에는 몰리고 어떤 면은 맨살)" },
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
    }, [], isV2 ? [{ tag: "no-growths-2026-10-19", set: { accretion: 0 } }, { tag: "resin-colour-back-2026-10-19", set: { resinColor: KIND_COLOR.slab } }, { tag: "resin-glass-2026-10-19", set: { resinMode: "glass" } }, { tag: "resin-opaque-2026-10-19", set: { resinOpacity: 1 } }, { tag: "resin-frost-2026-10-19", set: { resinMode: "frost", resinOpacity: 0.7 } }, { tag: "fossil-opt-in-2026-10-20", set: { blocky: 0, cavity: 0 } }] : []),
    { order: lab ? 2 : 8 },
  );
  const fuseCfg = useMemo<FuseConfig>(
    () => ({
      enabled: fu.fuseOn,
      fusePipes: fu.fusePipes,
      fuseWalks: fu.fuseWalks,
      walkRadius: fu.walkRadius,
      steelFossil: fu.steelFossil,
      accOnset: fu.accOnset,
      fuseOnset: fu.fuseOnset,
      voxel: fu.voxel,
      blur: fu.blur,
      gain: fu.gain,
      porosity: fu.porosity,
      iso: fu.iso,
      natureWeight: fu.natureWeight,
      accretion: fu.accretion,
      accDepth: fu.accDepth,
      lump: fu.lump,
      resinShare: isV2 ? -1 : fu.resinShare, // V2: −1 = every fused face is resin (one body)
      sag: fu.sag,
      smooth: fu.smooth,
      poreSize: fu.poreSize,
      scatter: fu.scatter,
      skeleton: fu.skeleton,
      skeletonUntil: fu.skeletonUntil,
      skeletonWrap: fu.skeletonWrap,
      spikes: fu.spikes,
      spikeLen: fu.spikeLen,
      growthColor: hexToLinear(fu.growthColor),
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
    [isV2, fu.fusePipes, fu.fuseWalks, fu.walkRadius, fu.steelFossil, fu.foam, fu.cavity, fu.cavityRound, fu.fossilFrom, fu.fossilTo, fu.blocky, fu.platesStay, fu.pipeThickLarge, fu.pipeJoint, fu.pipeFossil, fu.ribLip, fu.envelope, fu.fossilNoise, fu.massMode, fu.fill, fu.fillAmount, fu.fillInset, fu.shell, fu.shellThick, fu.shellThickYoung, fu.shellSplit, fu.ribCell, fu.ribWidth, fu.ribOpen, fu.holeShape, fu.pits, fu.pitSize, fu.pitJitter, fu.pitSoft, fu.pitCover, fu.pitDepth, fu.pitGather, fu.pitPatch, fu.sizeSmall, fu.sizeLarge, fu.sizeJitter, fu.pipeSmall, fu.pipeLarge, fu.holeVoronoiSmall, fu.holeVoronoiLarge, fu.pitSmall, fu.pitLarge, fu.pitBroad, fu.pipeRadius, fu.spikes, fu.spikeLen, fu.growthColor, fu.fuseOn, fu.accOnset, fu.fuseOnset, fu.voxel, fu.blur, fu.gain, fu.porosity, fu.iso, fu.natureWeight, fu.accretion, fu.accDepth, fu.lump, fu.resinShare, fu.sag, fu.smooth, fu.poreSize, fu.scatter, fu.skeleton, fu.skeletonUntil, fu.skeletonWrap],
  );
  const resinLook = useMemo<ResinLook>(
    () => ({
      color: fu.resinColor,
      transmission: fu.resinMode === "refract" ? fu.transmission : 0,
      opacity: fu.resinMode === "alpha" ? fu.resinOpacity : 1,
      massOpacity: !isV2 && fu.massBody === "alpha" ? fu.massOpacity : 1,
      shade: fu.resinShade,
      rim: fu.resinMode === "frost" ? fu.resinRim : 0,
      ghost: fu.resinGhost,
      glow: fu.resinMode === "frost" ? fu.resinGlow : 0,
      pits: { dark: fu.shell || fu.foam ? fu.pits : 0, cover: fu.pitCover, size: fu.pitSize, jitter: fu.pitJitter, soft: fu.pitSoft, depth: fu.shell || fu.foam ? fu.pitDepth : 0 },
      roughness: fu.resinRoughness,
      thickness: fu.thickness,
      attenuationColor: fu.attenuationColor,
      attenuationDistance: fu.attenuationDistance,
    }),
    [isV2, fu.shell, fu.foam, fu.pits, fu.pitCover, fu.pitSize, fu.pitJitter, fu.pitSoft, fu.pitDepth, fu.resinMode, fu.resinOpacity, fu.resinRim, fu.resinGhost, fu.resinGlow, fu.massBody, fu.massOpacity, fu.resinShade, fu.resinColor, fu.transmission, fu.resinRoughness, fu.thickness, fu.attenuationColor, fu.attenuationDistance],
  );
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
  const composerOn = rnd.aoOn || rnd.grain > 0 || v.dof;
  // PERFORMANCE MODE: the same knobs, capped — fewer pixels, cheaper AO, no shadows, fewer vegetation points, closer LOD
  const perf = rnd.perfMode;
  // THE WALL (ui=0, the exhibition): one device pixel per CSS pixel and no shadows, whatever the rehearsal saved — at
  // ×1.5 a full-screen wall is 3000×1700 and the GPU falls behind; the main thread then stalls (twice a second, when the
  // worker's new buffers are uploaded) until the frame is done, which starved the room's sound (2026-10-29)
  const wall = hideUi && !lab;
  // The exhibition wall follows the rehearsal wall's 렌더링 group (the artist, 2026-10-31: "리허설보다 글로벌 해상도가 훅
  // 떨어진다"); the forced dpr 1 / no shadows of 10/29 is gone now that the per-tick full-buffer uploads are fixed.
  const dprMax = perf ? Math.min(1.25, rnd.dprMax) : rnd.dprMax;
  const aoHalfRes = perf || rnd.halfRes;
  const aoQuality = perf ? ("performance" as const) : rnd.quality;
  const shadowsOn = rnd.shadows && !perf;
  const vegBudget = perf ? Math.min(veg.budget, 250000) : veg.budget;
  const lodNear = perf ? Math.min(rnd.near, 25) : rnd.near;
  const lodMid = perf ? Math.min(rnd.mid, 50) : rnd.mid;
  // …and no transmission on the resin (its refraction pass re-renders the whole opaque scene every frame)
  const resinView = useMemo<ResinLook>(() => (perf ? { ...resinLook, transmission: 0 } : resinLook), [perf, resinLook]);
  const fps = useFps();
  const natureParams = useMemo<NatureParams | null>(
    () =>
      veg.natureOn
        ? {
            cfg: natureCfg,
            perSlot: veg.perSlot,
            size: veg.volumeSize,
            gatherSize: veg.gatherSize,
            gatherJitter: veg.gatherJitter,
            gatherPoints: veg.gatherPoints,
            gatherDot: veg.gatherDot,
            window: veg.window,
            margin: veg.margin,
            budget: vegBudget,
            burialSlots: veg.burialSlots,
            reclaim: veg.gatherOn,
            tauReclaimYears: veg.tauReclaimYears,
            reclaimPerArea: veg.gatherPerArea,
            paths: wlk.pathsOn ? { hole: wlk.pathHole, berm: wlk.pathBerm, edge: isV2 ? wlk.pathEdge : undefined } : null,
            // V1 keeps every cell by its density and the even far thinning
            density: isV2 ? { cut: veg.densityCut, fade: veg.densityFade } : null,
          }
        : null,
    [isV2, veg.densityCut, veg.densityFade, veg.natureOn, natureCfg, veg.perSlot, veg.volumeSize, veg.gatherSize, veg.gatherJitter, veg.gatherPoints, veg.gatherDot, veg.window, veg.margin, vegBudget, veg.burialSlots, veg.gatherOn, veg.tauReclaimYears, veg.gatherPerArea, wlk.pathsOn, wlk.pathHole, wlk.pathBerm, wlk.pathEdge],
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
    () => ({ ...DEFAULT_BOXES, secPerUnit: tAxis.secPerUnit, unit: tAxis.unit, width: bld.partWidth, density: bld.partDensity, timeJitter: tAxis.timeJitter, recipe }),
    [tAxis.secPerUnit, tAxis.unit, bld.partWidth, bld.partDensity, tAxis.timeJitter, recipe],
  );
  const c = { ...tAxis, showEdges: v.showEdges, wear: wx.wear, follow: v.follow, markers: v.markers, markerHold: v.markerHold };
  // heights on the time axis, read by the "toLatest" / "toMe" buttons
  topRef.current = Math.max(stats.top, (stats.t / c.secPerUnit) * c.unit);
  focusRef.current = (stats.focusS / c.secPerUnit) * c.unit;
  const spaceFold = useMemo(() => ({ ...fold, emptyGapSec: c.emptyGapSec }), [fold, c.emptyGapSec]);
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

  return (
    // the wall (ui=0) shows no cursor either: nothing on it but the strata
    <div className="relative h-full w-full" style={{ background: theme.bg, cursor: hideUi ? "none" : undefined }}>
      <Leva hidden={hideUi} theme={LEVA_THEME} />
      <Canvas shadows="percentage" dpr={[1, dprMax]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: !wall }}>
        <color attach="background" args={[theme.bg]} />
        <ambientLight intensity={0.85} />
        <Sun controls={controls} azimuth={rnd.azimuth} elevation={rnd.elevation} intensity={rnd.sunIntensity} softness={rnd.softness} shadows={shadowsOn} drift={{ turnMin: cam.sunTurnMin, dir: cam.sunDir as 1 | -1, swingDeg: cam.sunSwing, swingMin: cam.sunSwingMin, active: !lab }} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <RendererTuning transmissionScale={perf ? Math.min(0.25, fu.transmissionScale) : fu.transmissionScale} />
        {/* V2: no ground plane and no time axis — the timespace floats */}
        {!isV2 && <gridHelper key={v.theme} args={[80, 80, theme.grid[0], theme.grid[1]]} position={[0, -0.01, 0]} />}
        <SpaceWorld
          log={log}
          fold={spaceFold}
          boxCfg={boxCfg}
          showEdges={c.showEdges}
          wear={c.wear}
          follow={c.follow}
          followLift={cam.camLift}
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
          weather={weather}
          fuse={fuseCfg}
          resin={resinView}
          water={waterView}
          nearFade={v.nearFade}
          noAxis={isV2}
          walk={walkView}
          walkLook={walkLook}
          clock={clk}
          local={lab}
        />
        {/* THE WALL (ui=0): a landscape — no orbiting, zooming, panning or click focus; the stage camera turns it */}
        <FocusFollow controls={controls} target={focusTarget} clickFocus={v.clickFocus && !wall} speed={v.focusSpeed} resetTick={focusResets} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={isV2 ? Math.PI : Math.PI * 0.499} enableRotate={!wall} enableZoom={!wall} enablePan={!wall} />
        <StageCamera
          controls={controls}
          pose={{ dist: cam.camDist, polar: cam.camPolar, azimuth: cam.camAzimuth, look: cam.camLook }}
          turnSec={cam.camTurnSec}
          dir={cam.camDir as 1 | -1}
          maxPolarDeg={isV2 ? 179.5 : 89.8}
          active={!lab}
          auto={cam.camAuto ? shotSeq : null}
          link={camLink}
          status={shotLine}
        />
        {composerOn && (
          <EffectComposer key={`${rnd.aoOn}:${rnd.grain > 0}:${v.dof}`}>
            {rnd.aoOn && <N8AO aoRadius={rnd.aoRadius} distanceFalloff={rnd.distanceFalloff} intensity={rnd.aoIntensity} quality={aoQuality} halfRes={aoHalfRes} color="black" />}
            {v.dof && <DepthOfField target={focusTarget} worldFocusRange={v.dofRange} bokehScale={v.dofBokeh} />}
            {rnd.grain > 0 && <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={rnd.grain} />}
          </EffectComposer>
        )}
        {/* markers are an overlay: their own scene, drawn after the parts (and after AO / grain) on a cleared depth
            buffer, so "me" is never buried inside the masses or darkened by AO. Priority 1 also renders the main scene
            (no composer); with the composer on (priority 1, it renders the scene) the overlay follows at 2. */}
        {c.markers && (
          <Hud key={composerOn ? "after-composer" : "plain"} renderPriority={composerOn ? 2 : 1}>
            <Markers log={log} secPerUnit={c.secPerUnit} unit={c.unit} holdSec={c.markerHold} labels={!hideUi} onActive={setActive} onMe={setMeStatus} />
          </Hud>
        )}
      </Canvas>
      {/* THE WALL (ui=0, the exhibition): no text at all — the readout and the markers' names are debugging (the artist,
          2026-10-28); the TEST entry (no ui parameter) keeps them */}
      {!hideUi && (
      <div className={`pointer-events-none absolute bottom-3 left-3 select-none font-mono text-[10px] leading-4 ${theme.text}`}>
        <div>
          seeds {stats.seeds} · parts {stats.boxes} · t {Math.round(stats.t)} s · top {stats.top.toFixed(1)} · focus{" "}
          {stats.focusIsMe ? "me" : "latest"} @ {Math.round(stats.focusS)} s
        </div>
        {/* the exhibition camera's auto run writes which shot is on (StageCamera, once a second; empty when it is off) */}
        <div ref={shotLine} />
        <div>{PART_KINDS.map((k) => `${k} ${stats.kinds[k]}`).join(" · ")}</div>
        <div>
          {fps} fps · LOD: {stats.farSeeds}/{stats.seeds} seeds solid · baked {stats.baked} chunk(s) · computed in {stats.runner}, {Math.round(stats.workerMs)} ms{perf ? " · PERF MODE" : ""}
        </div>
        <div>water: {stats.links} open stream(s) now · {stats.pipeRuns} pipe run(s) laid</div>
        <div>x, z = ground · y = time (1 step = {boxCfg.secPerUnit} s) · concrete needs ≥ {fold.minVisitors} visitors</div>
        {clock.timeRate !== 1 && <div>{clock.timeRate > 0 ? `time × ${clock.timeRate} (1 step every ${(boxCfg.secPerUnit / clock.timeRate).toFixed(1)} s)` : "PAUSED (rate 0): settings apply at once, the view is pinned"}</div>}
        {globalBots > 0 && <div>bots: {globalBots} running from this view ({lab ? "lab, this tab only" : "global"})</div>}
        {lab && <div>LAB: a world of this tab only · saved settings are the shared global view's</div>}
        {depths && (
          <div>
            깊이 (현재에서 ↓단): 식생 모임 {depths.gather} · 부패 시작 {depths.rot} · 엉김 {depths.acc ?? "–"} · 융합 {depths.fuse ?? "–"} · 레진 {depths.resin ?? "없음"}
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
