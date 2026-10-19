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
  MAX_TIME_RATE,
  MIN_TIME_RATE,
  latestOf,
  latestS,
  loadEvents,
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
import { useGlobalBots } from "./useGlobalBots";
import { useParliamentVersion } from "./version";

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
/** Leva paths in the mass-way folder (each way's own numbers show only for it). */
const MODE_PATH = "엉김 · 융합 · 레진.④ 덩어리 방식.massMode";
const FILL_PATH = "엉김 · 융합 · 레진.④ 덩어리 방식.fill";
const SHELL_PATH = "엉김 · 융합 · 레진.④ 덩어리 방식.shell";
const HOLE_PATH = "엉김 · 융합 · 레진.④ 덩어리 방식.holeShape";
const RESIN_MODE_PATH = "엉김 · 융합 · 레진.⑥ 재질: 덩어리 · 레진.resinMode";
const MASS_BODY_PATH = "엉김 · 융합 · 레진.⑥ 재질: 덩어리 · 레진.massBody";
const ALL_RESIN_PATH = "엉김 · 융합 · 레진.① 언제: 부재의 부식 정도 (0 새것 … 1 사라짐).allResin";

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
  /** The glass body's Fresnel rim (0 = none): brightness added where the surface turns away from the eye. */
  rim: number;
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
  // the glass body: a clearcoat for the lights' highlights (cheap), no refraction
  m.clearcoat = r.rim > 0 ? 0.6 : 0;
  m.clearcoatRoughness = 0.35;
  m.needsUpdate = true;
}

/**
 * The resin's material: MeshPhysical whose vertex colours (the mass's stains, pits, darkening with age) are not
 * multiplied in as they are — that made the glass dirty — but normalised by the concrete's base grey, so a plain
 * surface leaves the resin colour as it is and only the deviations (pits, stains) show, by `shade` (0 = none).
 */
function makeResinMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, metalness: 0, vertexColors: true });
  const uShade: THREE.IUniform = { value: 0.5 };
  // the GLASS body (no refraction): a Fresnel rim — brighter and more opaque where the surface turns away from the
  // eye, as glass does — on top of the translucent body; 0 = off
  const uRim: THREE.IUniform = { value: 0 };
  m.userData.uShade = uShade;
  m.userData.uRim = uRim;
  m.onBeforeCompile = (shader) => {
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

function setDecay(mesh: THREE.InstancedMesh | null, src: Float32Array, stride: number, count: number): void {
  if (!mesh) return;
  let attr = mesh.geometry.getAttribute("aDecay") as THREE.InstancedBufferAttribute | undefined;
  if (!attr || attr.count < PIPE_CAPACITY) {
    attr = new THREE.InstancedBufferAttribute(new Float32Array(PIPE_CAPACITY), 1);
    mesh.geometry.setAttribute("aDecay", attr);
  }
  for (let i = 0; i < count; i++) attr.array[i] = src[i * stride + stride - 1];
  attr.needsUpdate = true;
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
    elbow.instanceMatrix.needsUpdate = true;
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
    cyl.instanceMatrix.needsUpdate = true;
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
  for (const a of [at.center, at.color]) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * 3);
    a.needsUpdate = true;
  }
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
}: {
  log: EventLog;
  /** The clock this view runs on (rate 0 = paused: the view is pinned and settings apply at once). */
  clock: Clock;
  fold: FoldConfig;
  boxCfg: BoxConfig;
  showEdges: boolean;
  /** Wear the parts to the present (the fold's slab wear); off = everything as built. */
  wear: boolean;
  follow: boolean;
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
  const stoneMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), []);
  const resinMat = useMemo(() => makeResinMaterial(), []);
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
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, n * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          (mesh.instanceColor.array as Float32Array).set(p.colors[kind]);
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, n * 3);
          mesh.instanceColor.needsUpdate = true;
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
    if (events.length < sent.current) {
      w.post({ type: "events", add: events, reset: true });
    } else if (events.length > sent.current) {
      w.post({ type: "events", add: events.slice(sent.current) });
    }
    sent.current = events.length;

    const meS = latestOf(events, typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY));
    const t = latestS(events);
    focus.current = { focusS: meS ?? t, focusIsMe: meS !== null };
    focusY.current = events.length ? ((meS ?? t) / cfg.secPerUnit) * cfg.unit : null;

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
    const req: Extract<SpaceRequest, { type: "compute" }> = { type: "compute", id, parts: { fold: f, box: cfg, wear: wr, weather: wx, fuse: fu, water: waterCfg, walk: wk, edges: e, lod } };
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
    const c = controls.current;
    if (!c || focusY.current === null || !(follow || !snapped.current)) return;
    const want = Math.max(0, focusY.current);
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
}: {
  controls: React.MutableRefObject<Orbit | null>;
  azimuth: number;
  elevation: number;
  intensity: number;
  softness: number;
  shadows: boolean;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const extent = 35;
  useFrame(() => {
    const l = light.current;
    const t = controls.current?.target;
    if (!l || !t) return;
    const az = azimuth * DEG;
    const el = elevation * DEG;
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
  onActive,
  onMe,
}: {
  log: EventLog;
  secPerUnit: number;
  unit: number;
  holdSec: number;
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
            <mesh position={[m.x, y / 2, m.z]}>
              <cylinderGeometry args={[0.03, 0.03, Math.max(y, 0.001), 6]} />
              <meshBasicMaterial color={color} transparent opacity={0.5} />
            </mesh>
            <mesh position={[m.x, 0.02, m.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.35, 0.5, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            <Html position={[m.x, y + big + 0.25, m.z]} center style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap font-mono text-[10px] leading-3" style={{ color }}>
                {m.kind === "me" ? (m.stale ? "me (silent)" : "me") : m.kind === "bot" ? m.id : "visitor"} · {m.role}
              </div>
            </Html>
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
  const controls = useRef<Orbit | null>(null);
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
    "엉김 · 융합 · 레진",
    savable("엉김 · 융합 · 레진", {
      fuseOn: { value: DEFAULT_FUSE.enabled, label: "켜기 (풍화 · 지층의 '마모'와 '지층'이 켜져 있어야 함)" },
      // what happens to a part is read off its corrosion (0 = new … 1 = gone): the SAME clock for every stage below
      "① 언제: 부재의 부식 정도 (0 새것 … 1 사라짐)": folder({
        accOnset: { value: DEFAULT_FUSE.accOnset, min: 0, max: 0.9, step: 0.01, label: "엉김이 붙기 시작 (그 전엔 식생 점만 모임)" },
        fuseOnset: { value: DEFAULT_FUSE.fuseOnset, min: 0.02, max: 0.95, step: 0.01, label: "부재가 덩어리로 녹기 시작" },
        skeletonUntil: { value: DEFAULT_FUSE.skeletonUntil, min: 0.3, max: 1.01, step: 0.01, label: "뼈대까지 삼켜짐 (>1 = 끝까지 남음)" },
        // V2 (the artist, 2026-10-19): one body — everything fused is resin, no stone in between
        allResin: { value: true, label: "레진 = 융합된 것 전부 (중간 몸체 없음)", render: () => isV2 },
        resinShare: { value: DEFAULT_FUSE.resinShare, min: 0.1, max: 1.01, step: 0.01, label: isV2 ? "레진이 되는 층의 부식 정도 (융합이 끝나 가는 뒤; >1 = 레진 없음)" : "레진이 되는 층 (퇴적 비율; 오래될수록 1에 가까움, >1 = 레진 없음)", render: (get) => !isV2 || !get(ALL_RESIN_PATH) },
      }),
      "② 엉김: 부재에 붙는 작은 덩어리 (융합 전의 얇은 띠)": folder({
        // V2: off by default (the artist, 2026-10-19: the soil-coloured band before the resin is not wanted)
        accretion: { value: isV2 ? 0 : DEFAULT_FUSE.accretion, min: 0, max: 3, step: 0.05, label: "양 (0 = 없음 = 이 띠 없이 바로 융합)" },
        accDepth: { value: DEFAULT_FUSE.accDepth, min: 0.1, max: 4, step: 0.05, label: "두께 (월드)" },
        lump: { value: DEFAULT_FUSE.lump, min: 0.2, max: 4, step: 0.05, label: "뭉치 크기 (월드; 클수록 굵은 몇 덩이)" },
        growthColor: { value: "#ada585", label: "색 (이 띠의 흙색; 회색이면 #6e6e6e)" },
      }),
      "③ 덩어리: 녹은 부재들이 되는 것": folder({
        gain: { value: DEFAULT_FUSE.gain, min: 0.5, max: 8, step: 0.1, label: "이어 붙는 세기 (클수록 부재 사이가 메워져 한 덩어리 = 돌무덤; 1 = 부재 모양 거의 그대로)" },
        blur: { value: DEFAULT_FUSE.blur, min: 0, max: 5, step: 1, label: "메워지는 틈의 너비 (복셀; 0 = 안 메움)" },
        sag: { value: DEFAULT_FUSE.sag, min: 0, max: 0.95, step: 0.01, label: "아래로 흘러내림 (0 = 없음)" },
        scatter: { value: DEFAULT_FUSE.scatter, min: 0, max: 2, step: 0.05, label: "젊은 층 가장자리 부스러짐 (0 = 매끈)" },
        porosity: { value: DEFAULT_FUSE.porosity, min: 0, max: 2, step: 0.05, label: "둥근 구멍 양 (오래된 층일수록 많이; C 껍질을 켜면 꺼짐)" },
        poreSize: { value: DEFAULT_FUSE.poreSize, min: 0.3, max: 4, step: 0.05, label: "둥근 구멍 크기 (월드)" },
        skeleton: { value: DEFAULT_FUSE.skeleton, min: 0, max: 1, step: 0.01, label: "뼈대로 남는 부재 비율 (날카로운 직교 형태 유지)" },
        skeletonWrap: { value: DEFAULT_FUSE.skeletonWrap, min: 0, max: 1, step: 0.05, label: "뼈대가 덩어리에 덮이는 정도 (0 = 안 덮임, 1 = 다른 부재와 같게)" },
        spikes: { value: DEFAULT_FUSE.spikes, min: 0, max: 1, step: 0.01, label: "가시: 표면에서 뻗어 나오는 양 (같은 재질; 0 = 없음)" },
        spikeLen: { value: DEFAULT_FUSE.spikeLen, min: 0.2, max: 4, step: 0.1, label: "가시: 가장 긴 길이 (월드)" },
      }),
      // HOW a part turns into mass (one of two: as its box, or as tubes along its edges), and what is ADDED on top
      // (both can be on): the rooms between the plates filled; the whole mass hollowed into a shell with ribbed
      // openings. Each shows only its own numbers
      "④ 덩어리 방식": folder(
        {
          massMode: {
            options: {
              "부재를 통째로 (감싸고 사이를 메움)": "wrap",
              "E 관 (multipipe): 부재의 모서리만 관으로, 방은 비움": "pipe",
              "크기에 따라: 작은 부재는 통째로, 큰 부재는 관 (④-1 커브)": "size",
            },
            value: "wrap" as "wrap" | "pipe" | "size",
            label: "부재가 녹는 꼴",
          },
          pipeRadius: { value: DEFAULT_STUDY.pipeRadius, min: 0.1, max: 1.5, step: 0.05, label: "E · 관 굵기 (월드; ③ 이어 붙는 세기 1 근처에서 관이 살아남)", render: (get) => get(MODE_PATH) !== "wrap" },
          fill: { value: DEFAULT_STUDY.fill, label: "+ B 판 사이 채우기: 슬래브 · 기단 사이 방을 위에서부터 채움, 판은 날카롭게" },
          fillAmount: { value: DEFAULT_STUDY.fillAmount, min: 0.1, max: 1.5, step: 0.05, label: "B · 채워지는 깊이 (1 = 아래 판까지)", render: (get) => get(FILL_PATH) },
          fillInset: { value: DEFAULT_STUDY.fillInset, min: 0, max: 1.5, step: 0.05, label: "B · 판 가장자리에서 물러남 (월드)", render: (get) => get(FILL_PATH) },
          shell: { value: DEFAULT_STUDY.shell, label: "+ C 껍질 · 리브: 속을 비우고 구멍을 열어 그 사이 벽(리브)만 남김 (둥근 구멍 대신)" },
          shellThickYoung: { value: DEFAULT_STUDY.shellThickYoung, min: 1, max: 4, step: 1, label: "C · 껍질 두께 · 얕은 층 (복셀)", render: (get) => get(SHELL_PATH) },
          shellThick: { value: DEFAULT_STUDY.shellThick, min: 1, max: 4, step: 1, label: "C · 껍질 두께 · 깊은 층 (복셀)", render: (get) => get(SHELL_PATH) },
          shellSplit: { value: DEFAULT_STUDY.shellSplit, min: 0.05, max: 1, step: 0.01, label: "C · 깊은 층으로 치는 부식 정도 (층의 나이)", render: (get) => get(SHELL_PATH) },
          holeShape: {
            options: { "보로노이: 맞닿은 다각형 구멍, 사이에 리브 (뼈)": "voronoi", "노이즈: 둥글게 번지며 서로 이어지는 구멍 (벌레 먹은 듯)": "noise", "둥근 구멍: ③의 구형 공극을 껍질에": "round", "크기에 따라: 작은 부재는 노이즈, 큰 부재는 보로노이 (④-1 커브)": "size" },
            value: DEFAULT_STUDY.holeShape as "voronoi" | "noise" | "round" | "size",
            label: "C · 구멍 모양",
            render: (get) => get(SHELL_PATH),
          },
          ribCell: { value: DEFAULT_STUDY.ribCell, min: 0.6, max: 5, step: 0.1, label: "C · 구멍 크기 (월드; 둥근 구멍은 ③의 크기를 씀)", render: (get) => get(SHELL_PATH) },
          ribWidth: { value: DEFAULT_STUDY.ribWidth, min: 0.05, max: 1.2, step: 0.05, label: "C · 리브 굵기 (보로노이: 구멍 사이 벽의 두께 · 노이즈: 가장자리 부드러움)", render: (get) => get(SHELL_PATH) },
          ribOpen: { value: DEFAULT_STUDY.ribOpen, min: 0, max: 1, step: 0.01, label: "C · 열리는 구멍 비율 (0 = 닫힌 껍질, 1 = 거의 다 열림)", render: (get) => get(SHELL_PATH) },
          pits: { value: DEFAULT_STUDY.pits, min: 0, max: 1, step: 0.05, label: "C · 표면 곰보 · 진하기 (어두운 점; 색만, 0 = 없음)", render: (get) => get(SHELL_PATH) },
          pitCover: { value: DEFAULT_STUDY.pitCover, min: 0, max: 1, step: 0.01, label: "C · 곰보 · 양 (표면의 얼마나를 덮나)", render: (get) => get(SHELL_PATH) },
          pitSize: { value: DEFAULT_STUDY.pitSize, min: 0.05, max: 2, step: 0.01, label: "C · 곰보 · 크기 (월드)", render: (get) => get(SHELL_PATH) },
          pitJitter: { value: DEFAULT_STUDY.pitJitter, min: 0, max: 1, step: 0.05, label: "C · 곰보 · 크기 지터 (0 = 다 같게)", render: (get) => get(SHELL_PATH) },
          pitSoft: { value: DEFAULT_STUDY.pitSoft, min: 0.01, max: 0.4, step: 0.01, label: "C · 곰보 · 가장자리 부드러움 (0.01 = 또렷한 점 … 0.4 = 번진 얼룩)", render: (get) => get(SHELL_PATH) },
          pitDepth: { value: DEFAULT_STUDY.pitDepth, min: 0, max: 1, step: 0.05, label: "C · 곰보 · 파이는 깊이 (0 = 색만, 1 = 뚫림; 리브에서 떨어진 넓은 면에만 — 크기 0.5 이상이어야 격자에 잡힘)", render: (get) => get(SHELL_PATH) },
          pitGather: { value: DEFAULT_STUDY.pitGather, min: 0, max: 1, step: 0.05, label: "C · 곰보 · 몰림 (0 = 고르게, 1 = 어떤 면에는 몰리고 어떤 면은 맨살)", render: (get) => get(SHELL_PATH) },
          pitPatch: { value: DEFAULT_STUDY.pitPatch, min: 0.5, max: 12, step: 0.5, label: "C · 곰보 · 몰리는 자리 크기 (월드)", render: (get) => get(SHELL_PATH) },
        },
        { render: () => isV2 },
      ),
      // SIZE CURVES (the artist, 2026-10-19: the look was growing uniform): a part's size, read on a band, decides
      // how much of each feature it gets — the weights at the small end and at the large end
      "④-1 크기 커브: 부재 크기에 따라 다르게 (획일화 막기)": folder(
        {
          sizeSmall: { value: DEFAULT_STUDY.sizeSmall, min: 0.3, max: 20, step: 0.1, label: "'작은 부재'로 치는 크기 (월드; 가장 긴 변이 이 아래면 0)" },
          sizeLarge: { value: DEFAULT_STUDY.sizeLarge, min: 0.5, max: 40, step: 0.5, label: "'큰 부재'로 치는 크기 (월드; 이 위면 1; 사이는 커브)" },
          sizeJitter: { value: DEFAULT_STUDY.sizeJitter, min: 0, max: 1, step: 0.05, label: "부재마다 크기 읽기의 흔들림 (0 = 크기 그대로, 1 = ⅓ … 3배; 같은 크기도 다르게)" },
          pipeSmall: { value: DEFAULT_STUDY.pipeSmall, min: 0, max: 1, step: 0.05, label: "E 관 비율 · 작은 부재 (0 = 통째로, 1 = 관만; 사이 = 관 안에 너덜한 판)", render: (get) => get(MODE_PATH) === "size" },
          pipeLarge: { value: DEFAULT_STUDY.pipeLarge, min: 0, max: 1, step: 0.05, label: "E 관 비율 · 큰 부재", render: (get) => get(MODE_PATH) === "size" },
          holeVoronoiSmall: { value: DEFAULT_STUDY.holeVoronoiSmall, min: 0, max: 1, step: 0.05, label: "C 구멍 · 작은 부재 (0 = 노이즈, 1 = 보로노이)", render: (get) => get(SHELL_PATH) && get(HOLE_PATH) === "size" },
          holeVoronoiLarge: { value: DEFAULT_STUDY.holeVoronoiLarge, min: 0, max: 1, step: 0.05, label: "C 구멍 · 큰 부재 (0 = 노이즈, 1 = 보로노이)", render: (get) => get(SHELL_PATH) && get(HOLE_PATH) === "size" },
          pitSmall: { value: DEFAULT_STUDY.pitSmall, min: 0, max: 2, step: 0.05, label: "C 곰보 양 배율 · 작은 부재 (× 곰보 양)", render: (get) => get(SHELL_PATH) },
          pitLarge: { value: DEFAULT_STUDY.pitLarge, min: 0, max: 2, step: 0.05, label: "C 곰보 양 배율 · 큰 부재", render: (get) => get(SHELL_PATH) },
        },
        { render: () => isV2, collapsed: true },
      ),
      "⑤ 계산 (보통은 그대로)": folder(
        {
          voxel: { value: DEFAULT_FUSE.voxel, min: 0.15, max: 1.2, step: 0.05, label: "격자 간격 (월드; 작을수록 세밀하고 무거움)" },
          iso: { value: DEFAULT_FUSE.iso, min: 0.05, max: 0.9, step: 0.01, label: "덩어리로 치는 밀도 기준 (낮출수록 덩어리가 두꺼워지고 더 멀리 이어짐)" },
          smooth: { value: DEFAULT_FUSE.smooth, min: 0, max: 6, step: 1, label: "표면 다듬기 횟수 (0 = 각진 격자 그대로)" },
          natureWeight: { value: DEFAULT_FUSE.natureWeight, min: 0, max: 2, step: 0.05, label: "식생 퇴적물이 덩어리에 섞이는 양" },
        },
        { collapsed: true },
      ),
      "⑥ 재질: 덩어리 · 레진": folder(
        {
          // the MASS (fused, not yet resin): opaque stone or a translucent body (alpha, no depth write — what stands
          // inside shows through; the artist, 2026-10-19: the middle layers suit it)
          massBody: { options: { "불투명 (돌)": "opaque", "반투명 (속의 부재가 비쳐 보임)": "alpha" }, value: "alpha" as "opaque" | "alpha", label: "덩어리 몸체 (융합 ~ 레진 전)", render: (get) => !isV2 || !get(ALL_RESIN_PATH) },
          massOpacity: { value: 0.75, min: 0.1, max: 1, step: 0.05, label: "덩어리 · 불투명도", render: (get) => (!isV2 || !get(ALL_RESIN_PATH)) && get(MASS_BODY_PATH) === "alpha" },
          // the RESIN (the fossil layers): refraction (three.js transmission: the scene behind is re-rendered every
          // frame — heavy, glass-like) or the same translucent body (light)
          // the artist, 2026-10-19: the exhibition view turns slowly, it is not zoomed into — the light glass is the
          // default (the refraction cost 1–16 fps on the lab column), the refraction stays as a choice
          resinMode: {
            options: { "유리 느낌 (가벼움: 불투명 몸체 + 가장자리 광택, 굴절 없음)": "glass", "굴절 (유리처럼 뒤를 굴절 · 무거움)": "refract", "반투명 (가장 가벼움, 광택 없음)": "alpha" },
            value: "glass" as "alpha" | "refract" | "glass",
            label: "레진 몸체 (화석 층)",
          },
          resinOpacity: { value: 1, min: 0.1, max: 1, step: 0.05, label: "레진 · 불투명도 (1 = 불투명 몸체; 낮추면 속의 부재가 비침)", render: (get) => get(RESIN_MODE_PATH) !== "refract" },
          resinRim: { value: 0.35, min: 0, max: 1, step: 0.05, label: "유리 느낌 · 가장자리 광택 (프레넬)", render: (get) => get(RESIN_MODE_PATH) === "glass" },
          resinColor: { value: KIND_COLOR.slab, label: "레진 색 (슬래브와 같은 회색)" },
          resinShade: { value: 0.5, min: 0, max: 1, step: 0.05, label: "레진에 비치는 덩어리 얼룩 · 곰보 (0 = 레진 색만, 1 = 다)" },
          transmission: { value: 0.85, min: 0, max: 1, step: 0.01, label: "굴절 · 투과 (0 = 불투명 유리, 1 = 맑은 유리)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
          resinRoughness: { value: 0.45, min: 0, max: 1, step: 0.01, label: "레진 거칠기 (0 = 맑음, 1 = 서리 낀 유리)" },
          thickness: { value: 1.5, min: 0, max: 10, step: 0.1, label: "굴절 · 두께감 (굴절이 얼마나 휘는지)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
          attenuationColor: { value: "#8a8b8c", label: "굴절 · 물드는 색 (무채색; 빛이 깊이 들어갈수록 이 색으로)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
          attenuationDistance: { value: 2.5, min: 0.1, max: 30, step: 0.1, label: "물드는 거리 (월드; 빛이 몸체 속을 이만큼 지나면 '물드는 색'이 됨 — 짧을수록 두껍고 탁한 유리)", render: (get) => get(RESIN_MODE_PATH) === "refract" },
        },
        { collapsed: true },
      ),
    }, [], isV2 ? [{ tag: "no-growths-2026-10-19", set: { accretion: 0 } }, { tag: "resin-colour-back-2026-10-19", set: { resinColor: KIND_COLOR.slab } }, { tag: "resin-glass-2026-10-19", set: { resinMode: "glass" } }, { tag: "resin-opaque-2026-10-19", set: { resinOpacity: 1 } }] : []),
    { order: lab ? 2 : 8 },
  );
  const fuseCfg = useMemo<FuseConfig>(
    () => ({
      enabled: fu.fuseOn,
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
      resinShare: isV2 && fu.allResin ? -1 : fu.resinShare, // −1: every fused face is resin
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
            pipe: fu.massMode === "pipe",
            pipeRadius: fu.pipeRadius,
          }
        : undefined,
    }),
    [isV2, fu.massMode, fu.fill, fu.fillAmount, fu.fillInset, fu.shell, fu.shellThick, fu.shellThickYoung, fu.shellSplit, fu.ribCell, fu.ribWidth, fu.ribOpen, fu.holeShape, fu.pits, fu.pitSize, fu.pitJitter, fu.pitSoft, fu.pitCover, fu.pitDepth, fu.pitGather, fu.pitPatch, fu.sizeSmall, fu.sizeLarge, fu.sizeJitter, fu.pipeSmall, fu.pipeLarge, fu.holeVoronoiSmall, fu.holeVoronoiLarge, fu.pitSmall, fu.pitLarge, fu.pipeRadius, fu.spikes, fu.spikeLen, fu.growthColor, fu.fuseOn, fu.accOnset, fu.fuseOnset, fu.voxel, fu.blur, fu.gain, fu.porosity, fu.iso, fu.natureWeight, fu.accretion, fu.accDepth, fu.lump, fu.allResin, fu.resinShare, fu.sag, fu.smooth, fu.poreSize, fu.scatter, fu.skeleton, fu.skeletonUntil, fu.skeletonWrap],
  );
  const resinLook = useMemo<ResinLook>(
    () => ({
      color: fu.resinColor,
      transmission: fu.resinMode === "refract" ? fu.transmission : 0,
      opacity: fu.resinOpacity,
      massOpacity: fu.massBody === "alpha" ? fu.massOpacity : 1,
      shade: fu.resinShade,
      rim: fu.resinMode === "glass" ? fu.resinRim : 0,
      roughness: fu.resinRoughness,
      thickness: fu.thickness,
      attenuationColor: fu.attenuationColor,
      attenuationDistance: fu.attenuationDistance,
    }),
    [fu.resinMode, fu.resinOpacity, fu.resinRim, fu.massBody, fu.massOpacity, fu.resinShade, fu.resinColor, fu.transmission, fu.resinRoughness, fu.thickness, fu.attenuationColor, fu.attenuationDistance],
  );
  const rnd = useControls(
    "렌더 · 성능",
    savable("렌더 · 성능", {
      perfMode: { value: false, label: "성능 모드 (해상도 ↓ · AO 절반 · 그림자 끔 · 식생 점 ↓ · LOD 가까이)" },
      // the pixels: a 5K iMac at ×2 draws 15 M of them per frame, with the AO on every one — ×1.5 looks the same
      // at that density and costs half
      dprMax: { value: 1.5, min: 1, max: 2, step: 0.25, label: "해상도 상한 (화면 픽셀 배율; 2 = 레티나 전부, 1.5 권장)" },
      transmissionScale: { value: 0.5, min: 0.25, max: 1, step: 0.25, label: "굴절 패스 해상도 (레진 굴절용 장면 재렌더 배율; 0.5 = 비용 ¼, 서리 낀 레진엔 티 안 남)" },
      pointsInRefraction: { value: false, label: "굴절에 식생 점 비침 (켜면 굴절 패스가 식생 점 수십만 개를 매 프레임 다시 그림 — 무거움)" },
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
    <div className="relative h-full w-full" style={{ background: theme.bg }}>
      <Leva hidden={hideUi} theme={LEVA_THEME} />
      <Canvas shadows="percentage" dpr={[1, dprMax]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[theme.bg]} />
        <ambientLight intensity={0.85} />
        <Sun controls={controls} azimuth={rnd.azimuth} elevation={rnd.elevation} intensity={rnd.sunIntensity} softness={rnd.softness} shadows={shadowsOn} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <RendererTuning transmissionScale={perf ? Math.min(0.25, rnd.transmissionScale) : rnd.transmissionScale} />
        {/* V2: no ground plane and no time axis — the timespace floats */}
        {!isV2 && <gridHelper key={v.theme} args={[80, 80, theme.grid[0], theme.grid[1]]} position={[0, -0.01, 0]} />}
        <SpaceWorld
          log={log}
          fold={spaceFold}
          boxCfg={boxCfg}
          showEdges={c.showEdges}
          wear={c.wear}
          follow={c.follow}
          controls={controls}
          onStats={setStats}
          nature={natureParams}
          lodNear={lodNear}
          lodMid={lodMid}
          pointsInRefraction={rnd.pointsInRefraction && !perf}
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
        />
        <FocusFollow controls={controls} target={focusTarget} clickFocus={v.clickFocus} speed={v.focusSpeed} resetTick={focusResets} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={isV2 ? Math.PI : Math.PI * 0.499} />
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
            <Markers log={log} secPerUnit={c.secPerUnit} unit={c.unit} holdSec={c.markerHold} onActive={setActive} onMe={setMeStatus} />
          </Hud>
        )}
      </Canvas>
      <div className={`pointer-events-none absolute bottom-3 left-3 select-none font-mono text-[10px] leading-4 ${theme.text}`}>
        <div>
          seeds {stats.seeds} · parts {stats.boxes} · t {Math.round(stats.t)} s · top {stats.top.toFixed(1)} · focus{" "}
          {stats.focusIsMe ? "me" : "latest"} @ {Math.round(stats.focusS)} s
        </div>
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
    </div>
  );
}
