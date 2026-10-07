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
import { Leva, button, folder, useControls } from "leva";
import * as THREE from "three";
import {
  DEFAULT_BOXES,
  LS_PARLIAMENT_ME_KEY,
  PART_CAPACITY,
  PART_KINDS,
  RECIPES,
  STEEL,
  clearWorld,
  latestOf,
  latestS,
  loadEvents,
  seedParliamentDemoIfRequested,
  type BoxConfig,
  type EventLog,
  type FoldConfig,
  type NatureConfig,
  type PEvent,
  type PartKind,
  type PointsResult,
  type Recipe,
  type RoleId,
  type SpaceRequest,
  type SpaceResponse,
  type WeatherConfig,
  DEFAULT_WEATHER,
  DEFAULT_WATER,
  type WaterConfig,
  DEFAULT_FUSE,
  type FuseConfig,
  type FuseMesh,
  SpaceModel,
  handleSpaceRequest,
} from "@/lib/parliament";
import { useTicker } from "./useTicker";
import { LEVA_THEME, useFoldControls, useNatureControls, useWorld } from "./useWorld";

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
/** …and for the parts. */
const SPACE_BOXES = { ...DEFAULT_BOXES, secPerUnit: 20, width: 0.8, density: 1.4 };

/** How often the view asks the worker (wall clock). */
const TICK_MS = 500;
/** Vegetation and plants are asked for every this-many ticks. */
const NATURE_EVERY = 4;
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
  /** Waterways flowing now. */
  links: number;
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
  paths: { hole: number; berm: number } | null;
  window: number;
  margin: number;
  budget: number;
  burialSlots: number;
  reclaim: boolean;
  tauReclaimYears: number;
  reclaimPerArea: number;
}

/** The resin body of the oldest layers: transmissive, darkening with thickness (Beer–Lambert attenuation). */
interface ResinLook {
  color: string;
  transmission: number;
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
  m.needsUpdate = true;
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
 * Level of detail: seeds further than `lodNear` from the camera are built without slats; vegetation thins out with
 * distance down to `farFactor`.
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
  farFactor,
  weather,
  fuse,
  resin,
  water,
  nearFade,
}: {
  log: EventLog;
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
}) {
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
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
  const seq = useRef(0);
  const focus = useRef({ focusS: 0, focusIsMe: false });
  const last = useRef<Stats | null>(null);
  // the ticker reads the latest props through this ref
  const live = useRef({ fold, boxCfg, showEdges, wear, nature, lodNear, farFactor, weather, fuse, water, onStats });
  useEffect(() => {
    live.current = { fold, boxCfg, showEdges, wear, nature, lodNear, farFactor, weather, fuse, water, onStats };
  });
  const fused = useRef<THREE.Mesh>(null);
  const stoneMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), []);
  const resinMat = useMemo(() => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, metalness: 0 }), []);
  useEffect(() => applyResin(resinMat, resin), [resinMat, resin]);
  const fusedMats = useMemo(() => [stoneMat, resinMat], [stoneMat, resinMat]);
  const natureMat = useMemo(() => fadingPointsMaterial(), []);
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
      if (ax) {
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
      last.current = { seeds: p.seeds, boxes: p.parts, kinds: p.counts, t: p.t, top: p.top, farSeeds: p.farSeeds, links: p.links, workerMs: r.ms, runner: worker.current?.mode ?? "-", ...focus.current };
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
    const { fold: f, boxCfg: cfg, showEdges: e, wear: wr, nature: nat, lodNear: near, farFactor: ff, weather: wx, fuse: fu, water: wa } = live.current;
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
    const cam: [number, number, number] = o ? [o.object.position.x, o.object.position.y, o.object.position.z] : [0, 0, 0];
    const lod = { camera: cam, near, farFactor: ff };
    const id = ++seq.current;
    const withNature = !!nat && id % NATURE_EVERY === 1;
    const req: Extract<SpaceRequest, { type: "compute" }> = { type: "compute", id, parts: { fold: f, box: cfg, wear: wr, weather: wx, fuse: fu, water: waterCfg, edges: e, lod } };
    if (withNature && nat) {
      const focusK = (o ? Math.max(0, o.target.y) : 0) / cfg.unit;
      req.nature = { fold: f, box: cfg, weather: wx, fuse: fu, nature: nat.cfg, perSlot: nat.perSlot, window: nat.window, focusK, margin: nat.margin, budget: nat.budget, burialSlots: nat.burialSlots, paths: nat.paths, lod };
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
    // the fused mass follows the vegetation's cadence (it is built from its history)
    if (id % NATURE_EVERY === 1) {
      const focusK = (o ? Math.max(0, o.target.y) : 0) / cfg.unit;
      req.fuse = { box: cfg, weather: wx, fuse: fu, tauReclaimYears: nat?.tauReclaimYears ?? 300, focusK };
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
      <lineSegments ref={axis} frustumCulled={false}>
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

export default function ParliamentSpace() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld(undefined, 1000);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";
  const controls = useRef<Orbit | null>(null);
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, kinds: NO_COUNTS, t: 0, top: 0, focusS: 0, focusIsMe: false, farSeeds: 0, links: 0, workerMs: 0, runner: "-" });
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

  // ── Leva, grouped: 보기 · 시간축 · 생성 규칙 · 건물 · 풍화/지층 · 식생 · 엉김/융합/레진 · 렌더/성능 ──
  const [focusResets, setFocusResets] = useState(0);
  const v = useControls(
    "보기",
    {
      theme: { options: { "종이 (밝음)": "paper", "검정": "black" }, value: "black" as keyof typeof THEMES, label: "배경" },
      follow: { value: true, label: "플레이어 시간대 따라가기" },
      toMe: button(() => jump(focusRef.current)),
      toGround: button(() => jump(0)),
      toLatest: button(() => jump(Math.max(0, topRef.current - 6))),
      markers: { value: true, label: "실시간 마커 (나/봇/방문자)" },
      markerHold: { value: 6, min: 2, max: 60, step: 1, label: "마커 유지 (갱신 끊긴 뒤 초)" },
      showEdges: { value: false, label: "모서리 선" },
      "초점 · 시야": folder({
        dof: { value: true, label: "초점 흐림 (피사계 심도)" },
        clickFocus: { value: true, label: "클릭한 곳에 초점 (끄면 화면 중앙)" },
        dofRange: { value: 24, min: 1, max: 80, step: 1, label: "초점이 맞는 깊이 (월드)" },
        dofBokeh: { value: 4, min: 0, max: 10, step: 0.5, label: "흐림 정도" },
        focusSpeed: { value: 4, min: 0.5, max: 20, step: 0.5, label: "초점 옮겨가는 속도" },
        resetFocus: button(() => setFocusResets((n) => n + 1)),
        nearFade: { value: [2, 24] as [number, number], min: 0, max: 60, step: 0.5, label: "카메라 가까운 식생 사라짐 (거리)" },
      }),
      "데이터": folder(
        {
          reload: button(() => log.addMany(loadEvents())),
          "clear world": button(() => {
            if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
              clearWorld();
              log.clear();
            }
          }),
        },
        { collapsed: true },
      ),
    },
    { order: 0 },
  );
  const tAxis = useControls(
    "시간축",
    {
      secPerUnit: { value: SPACE_BOXES.secPerUnit, min: 2, max: 600, step: 1, label: "한 단 = 몇 초" },
      unit: { value: DEFAULT_BOXES.unit, min: 0.2, max: 4, step: 0.1, label: "한 단의 높이 (월드)" },
      timeJitter: { value: SPACE_BOXES.timeJitter ?? 0, min: 0, max: 1, step: 0.05, label: "시간 오차 (부품·식생 위치 ±단)" },
      emptyGapSec: { value: SPACE_FOLD.emptyGapSec, min: 1, max: 600, step: 1, label: "빈 시간으로 볼 공백 (s)" },
    },
    { order: 1 },
  );
  const bld = useControls(
    "건물",
    {
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
    },
    { order: 3 },
  );
  const wx = useControls(
    "풍화 · 지층",
    {
      wear: { value: true, label: "마모 (끄면 지은 그대로; 엉김·융합도 꺼짐)" },
      strata: { value: DEFAULT_WEATHER.strata, label: "지층: 층마다 자기 나이 (끄면 엉김·융합 꺼짐)" },
      graceSlots: { value: DEFAULT_WEATHER.graceSlots, min: 0, max: 120, step: 1, label: "이만큼(단) 쌓여야 풍화·융합 시작 (위쪽 '현재' 두께)" },
      timeScale: { value: DEFAULT_WEATHER.timeScale, min: 0.001, max: 1, step: 0.001, label: "풍화 속도" },
      ageJitter: { value: DEFAULT_WEATHER.ageJitter, min: 0, max: 1, step: 0.05, label: "풍화 오차 (부품마다 나이 ±)" },
      concreteLife: { value: DEFAULT_WEATHER.concreteLife, min: 0.05, max: 5, step: 0.05, label: "콘크리트 수명 배율" },
      steelLife: { value: DEFAULT_WEATHER.steelLife, min: 0.05, max: 5, step: 0.05, label: "철골 수명 (슬래브 대비)" },
      tauSedimentYears: { value: DEFAULT_WEATHER.tauSedimentYears, min: 10, max: 20000, step: 10, label: "식생 → 부식토/이탄 (년)" },
      "매몰 · 식생 영향": folder(
        {
          coverSlots: { value: DEFAULT_WEATHER.coverSlots, min: 0, max: 20, step: 1, label: "덮였다고 볼 위층 수 (0 = 끔)" },
          buriedSlow: { value: DEFAULT_WEATHER.buriedSlow, min: 1, max: 500, step: 1, label: "덮인 뒤 몇 배 느려지나" },
          natureAccel: { value: DEFAULT_WEATHER.natureAccel, min: 0, max: 5, step: 0.1, label: "식생이 부식을 빠르게 하는 정도" },
        },
        { collapsed: true },
      ),
    },
    { order: 4 },
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
      graceSlots: wx.graceSlots,
    }),
    [wx.strata, wx.timeScale, wx.steelLife, wx.concreteLife, wx.tauSedimentYears, wx.coverSlots, wx.buriedSlow, wx.natureAccel, wx.ageJitter, wx.graceSlots],
  );
  const veg = useControls(
    "식생",
    {
      natureOn: { value: true, label: "켜기" },
      "퇴적 식생 (시간 속 볼륨)": folder({
        perSlot: { value: 6, min: 0.5, max: 40, step: 0.5, label: "칸·단당 점 수 (밀도 1일 때)" },
        volumeSize: { value: 0.07, min: 0.01, max: 0.4, step: 0.005, label: "점 크기" },
        window: { value: 120, min: 10, max: 600, step: 10, label: "보이는 시간 범위 (±단)" },
        margin: { value: 5, min: 0, max: 30, step: 1, label: "방문 범위 바깥 여백 (칸)" },
        budget: { value: 600000, min: 50000, max: 3000000, step: 50000, label: "최대 점 수" },
        burialSlots: { value: 3, min: 0, max: 20, step: 1, label: "매몰층: 탄생 아래 몇 단" },
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
      "길 (식생에 난 구멍)": folder({
        pathsOn: { value: true, label: "켜기" },
        pathHole: { value: 0.35, min: 0.05, max: 1, step: 0.01, label: "구멍이 되는 길 세기 (작을수록 넓은 구멍)" },
        pathBerm: { value: 2, min: 0, max: 8, step: 0.5, label: "가장자리 둔덕 (쌓이는 흙 양)" },
      }),
    },
    { order: 5 },
  );
  const wtr = useControls(
    "수로",
    {
      waterOn: { value: DEFAULT_WATER.enabled, label: "켜기" },
      minRaw: { value: DEFAULT_WATER.minRaw, min: 1, max: 10, step: 0.05, label: "건물이 '커졌다'고 볼 단 수" },
      reach: { value: DEFAULT_WATER.reach, min: 1, max: 60, step: 0.5, label: "이을 수 있는 건물 간 거리 (월드)" },
      minShare: { value: DEFAULT_WATER.minShare, min: 0.1, max: 20, step: 0.1, label: "기여자로 볼 최소 기여량" },
      persistSec: { value: DEFAULT_WATER.persistSec, min: 0, max: 3600, step: 10, label: "건물이 버려진 뒤 흐르는 시간 (s)" },
      vegBoost: { value: DEFAULT_WATER.vegBoost, min: 0, max: 2, step: 0.05, label: "물가 식생 밀도 (짙어지는 정도)" },
      channel: { value: DEFAULT_WATER.channel, min: 0, max: 4, step: 0.05, label: "물길 폭 (식생이 비는 너비)" },
      wetShare: { value: DEFAULT_WATER.wetShare, min: 0, max: 1, step: 0.05, label: "물가 식생 중 습지색 비율" },
      corrode: { value: DEFAULT_WATER.corrode, min: 0, max: 5, step: 0.1, label: "물에 닿은 부품이 빨리 부식하는 정도" },
      "물길 경로": folder(
        {
          meander: { value: DEFAULT_WATER.meander, min: 0, max: 0.6, step: 0.01, label: "굽이 (길이 대비)" },
          radius: { value: DEFAULT_WATER.radius, min: 0.5, max: 8, step: 0.1, label: "습지 폭 (물길에서 영향 범위, 월드)" },
          join: { value: DEFAULT_WATER.join, min: 1, max: 4, step: 1, label: "한 건물로 볼 거리 (칸)" },
        },
        { collapsed: true },
      ),
    },
    { order: 5.5 },
  );
  const waterView = useMemo(
    () =>
      wtr.waterOn
        ? {
            enabled: true,
            minRaw: wtr.minRaw,
            join: wtr.join,
            reach: wtr.reach,
            minShare: wtr.minShare,
            persistSec: wtr.persistSec,
            meander: wtr.meander,
            radius: wtr.radius,
            vegBoost: wtr.vegBoost,
            corrode: wtr.corrode,
            wetShare: wtr.wetShare,
            channel: wtr.channel,
          }
        : null,
    [wtr.waterOn, wtr.minRaw, wtr.join, wtr.reach, wtr.minShare, wtr.persistSec, wtr.meander, wtr.radius, wtr.vegBoost, wtr.corrode, wtr.wetShare, wtr.channel],
  );
  const { cfg: natureCfg } = useNatureControls({ folder: "식생 규칙 (개인 뷰와 공유)", rulesOnly: true, collapsed: true, order: 6 });
  const fu = useControls(
    "엉김 · 융합 · 레진",
    {
      fuseOn: { value: DEFAULT_FUSE.enabled, label: "켜기 (마모 + 지층이 켜져 있어야 함)" },
      accOnset: { value: DEFAULT_FUSE.accOnset, min: 0, max: 0.9, step: 0.01, label: "덩어리가 붙기 시작하는 부식 정도" },
      fuseOnset: { value: DEFAULT_FUSE.fuseOnset, min: 0.02, max: 0.95, step: 0.01, label: "건물과 하나가 되기 시작하는 부식 정도" },
      accretion: { value: DEFAULT_FUSE.accretion, min: 0, max: 3, step: 0.05, label: "덩어리 세기 (0 = 끔)" },
      accDepth: { value: DEFAULT_FUSE.accDepth, min: 0.1, max: 4, step: 0.05, label: "덩어리 최대 두께 (월드)" },
      lump: { value: DEFAULT_FUSE.lump, min: 0.2, max: 4, step: 0.05, label: "덩어리 크기 (클수록 큰 뭉치)" },
      porosity: { value: DEFAULT_FUSE.porosity, min: 0, max: 2, step: 0.05, label: "다공성 (구멍)" },
      resinShare: { value: DEFAULT_FUSE.resinShare, min: 0.1, max: 1.01, step: 0.01, label: "레진이 되는 퇴적 비율 (>1 = 끔)" },
      "형태 (뼈대 · 처짐 · 흩어짐)": folder({
        skeleton: { value: DEFAULT_FUSE.skeleton, min: 0, max: 1, step: 0.01, label: "뼈대로 남는 콘크리트 비율" },
        skeletonUntil: { value: DEFAULT_FUSE.skeletonUntil, min: 0.3, max: 1.01, step: 0.01, label: "뼈대가 삼켜지는 부식 정도 (>1 = 끝까지)" },
        skeletonWrap: { value: DEFAULT_FUSE.skeletonWrap, min: 0, max: 1, step: 0.05, label: "뼈대를 감싸는 두께 (1 = 다른 부재와 같게)" },
        sag: { value: DEFAULT_FUSE.sag, min: 0, max: 0.95, step: 0.01, label: "아래로 처짐 (흘러내림)" },
        scatter: { value: DEFAULT_FUSE.scatter, min: 0, max: 2, step: 0.05, label: "젊은 층 가장자리 흩어짐" },
        poreSize: { value: DEFAULT_FUSE.poreSize, min: 0.3, max: 4, step: 0.05, label: "구멍(구형 공극) 크기 (월드)" },
        smooth: { value: DEFAULT_FUSE.smooth, min: 0, max: 6, step: 1, label: "표면 다듬기 (횟수, 0 = 각진 복셀)" },
      }),
      "표면 계산": folder(
        {
          voxel: { value: DEFAULT_FUSE.voxel, min: 0.15, max: 1.2, step: 0.05, label: "해상도 (복셀, 작을수록 무거움)" },
          blur: { value: DEFAULT_FUSE.blur, min: 0, max: 5, step: 1, label: "엉김 반경 (복셀)" },
          gain: { value: DEFAULT_FUSE.gain, min: 0.5, max: 8, step: 0.1, label: "엉김 세기" },
          iso: { value: DEFAULT_FUSE.iso, min: 0.05, max: 0.9, step: 0.01, label: "표면 문턱" },
          natureWeight: { value: DEFAULT_FUSE.natureWeight, min: 0, max: 2, step: 0.05, label: "식생 퇴적물 비중" },
        },
        { collapsed: true },
      ),
      "레진 재질": folder(
        {
          resinColor: { value: KIND_COLOR.slab, label: "색 (슬래브와 같은 회색)" },
          transmission: { value: 0.85, min: 0, max: 1, step: 0.01, label: "투과" },
          resinRoughness: { value: 0.45, min: 0, max: 1, step: 0.01, label: "거칠기 (서리 낀 정도)" },
          thickness: { value: 1.5, min: 0, max: 10, step: 0.1, label: "두께감" },
          attenuationColor: { value: "#8a8b8c", label: "깊을수록 물드는 색 (무채색)" },
          attenuationDistance: { value: 2.5, min: 0.1, max: 30, step: 0.1, label: "물드는 거리 (짧을수록 무거움)" },
        },
        { collapsed: true },
      ),
    },
    { order: 7 },
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
      resinShare: fu.resinShare,
      sag: fu.sag,
      smooth: fu.smooth,
      poreSize: fu.poreSize,
      scatter: fu.scatter,
      skeleton: fu.skeleton,
      skeletonUntil: fu.skeletonUntil,
      skeletonWrap: fu.skeletonWrap,
    }),
    [fu.fuseOn, fu.accOnset, fu.fuseOnset, fu.voxel, fu.blur, fu.gain, fu.porosity, fu.iso, fu.natureWeight, fu.accretion, fu.accDepth, fu.lump, fu.resinShare, fu.sag, fu.smooth, fu.poreSize, fu.scatter, fu.skeleton, fu.skeletonUntil, fu.skeletonWrap],
  );
  const resinLook = useMemo<ResinLook>(
    () => ({
      color: fu.resinColor,
      transmission: fu.transmission,
      roughness: fu.resinRoughness,
      thickness: fu.thickness,
      attenuationColor: fu.attenuationColor,
      attenuationDistance: fu.attenuationDistance,
    }),
    [fu.resinColor, fu.transmission, fu.resinRoughness, fu.thickness, fu.attenuationColor, fu.attenuationDistance],
  );
  const rnd = useControls(
    "렌더 · 성능",
    {
      AO: folder({
        aoOn: { value: true, label: "켜기" },
        aoRadius: { value: 2.5, min: 0.1, max: 12, step: 0.1, label: "반경 (월드)" },
        distanceFalloff: { value: 1, min: 0.05, max: 4, step: 0.05, label: "거리 감쇠" },
        aoIntensity: { value: 3, min: 0, max: 12, step: 0.1, label: "세기" },
        quality: { options: ["performance", "low", "medium", "high", "ultra"] as const, value: "medium" as const, label: "품질" },
        halfRes: { value: false, label: "절반 해상도" },
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
        near: { value: 60, min: 5, max: 400, step: 5, label: "이 거리 안쪽만 막대 묶음 (월드)" },
        farFactor: { value: 0.25, min: 0.05, max: 1, step: 0.05, label: "먼 곳 식생 점 비율" },
      }),
    },
    { order: 8, collapsed: true },
  );
  const fold = useFoldControls(SPACE_FOLD, { folder: "생성 규칙 (회사원 시공간 밀집)", collapsed: true, order: 2 });
  const theme = THEMES[v.theme as keyof typeof THEMES] ?? THEMES.paper;
  const focusTarget = useMemo(() => new THREE.Vector3(0, 4, 0), []);
  const composerOn = rnd.aoOn || rnd.grain > 0 || v.dof;
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
            budget: veg.budget,
            burialSlots: veg.burialSlots,
            reclaim: veg.gatherOn,
            tauReclaimYears: veg.tauReclaimYears,
            reclaimPerArea: veg.gatherPerArea,
            paths: veg.pathsOn ? { hole: veg.pathHole, berm: veg.pathBerm } : null,
          }
        : null,
    [veg.natureOn, natureCfg, veg.perSlot, veg.volumeSize, veg.gatherSize, veg.gatherJitter, veg.gatherPoints, veg.gatherDot, veg.window, veg.margin, veg.budget, veg.burialSlots, veg.gatherOn, veg.tauReclaimYears, veg.gatherPerArea, veg.pathsOn, veg.pathHole, veg.pathBerm],
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

  return (
    <div className="relative h-full w-full" style={{ background: theme.bg }}>
      <Leva hidden={hideUi} theme={LEVA_THEME} />
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[theme.bg]} />
        <ambientLight intensity={0.85} />
        <Sun controls={controls} azimuth={rnd.azimuth} elevation={rnd.elevation} intensity={rnd.sunIntensity} softness={rnd.softness} shadows={rnd.shadows} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <gridHelper key={v.theme} args={[80, 80, theme.grid[0], theme.grid[1]]} position={[0, -0.01, 0]} />
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
          lodNear={rnd.near}
          farFactor={rnd.farFactor}
          weather={weather}
          fuse={fuseCfg}
          resin={resinLook}
          water={waterView}
          nearFade={v.nearFade}
        />
        <FocusFollow controls={controls} target={focusTarget} clickFocus={v.clickFocus} speed={v.focusSpeed} resetTick={focusResets} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={Math.PI * 0.499} />
        {composerOn && (
          <EffectComposer key={`${rnd.aoOn}:${rnd.grain > 0}:${v.dof}`}>
            {rnd.aoOn && <N8AO aoRadius={rnd.aoRadius} distanceFalloff={rnd.distanceFalloff} intensity={rnd.aoIntensity} quality={rnd.quality} halfRes={rnd.halfRes} color="black" />}
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
          LOD: {stats.farSeeds}/{stats.seeds} seeds far (no slats) · computed in {stats.runner}, {Math.round(stats.workerMs)} ms
        </div>
        <div>waterways now: {stats.links}{stats.links === 0 ? " (none: no two big buildings share a builder within reach)" : ""}</div>
        <div>x, z = ground · y = time (1 step = {boxCfg.secPerUnit} s) · concrete needs ≥ {fold.minVisitors} visitors</div>
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
