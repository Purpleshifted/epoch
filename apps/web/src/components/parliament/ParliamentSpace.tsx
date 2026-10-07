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
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Hud, OrbitControls } from "@react-three/drei";
import { DepthOfField, EffectComposer, N8AO, Noise } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Leva, button, useControls } from "leva";
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
  DEFAULT_FUSE,
  type FuseConfig,
  type FuseMesh,
  SpaceModel,
  handleSpaceRequest,
} from "@/lib/parliament";
import { useTicker } from "./useTicker";
import { useFoldControls, useNatureControls, useWorld } from "./useWorld";

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
  const uniforms = { uFade0: { value: 2 }, uFade1: { value: 8 } };
  m.userData.fade = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uFade0;\nuniform float uFade1;\nvarying float vFade;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFade = smoothstep(uFade0, max(uFade0 + 1e-3, uFade1), -mvPosition.z);");
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
  size: number;
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
  /** Vegetation within this view distance [start, end] dissolves (keeps the view clear). */
  nearFade: [number, number];
}) {
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
  const naturePts = useRef<THREE.Points>(null);
  const reclaimPts = useRef<THREE.Points>(null);
  const focusY = useRef<number | null>(null);
  const snapped = useRef(false);
  const worker = useRef<SpaceRunner | null>(null);
  const sent = useRef(0);
  const inFlight = useRef<{ id: number; at: number } | null>(null);
  const seq = useRef(0);
  const focus = useRef({ focusS: 0, focusIsMe: false });
  const last = useRef<Stats | null>(null);
  // the ticker reads the latest props through this ref
  const live = useRef({ fold, boxCfg, showEdges, wear, nature, lodNear, farFactor, weather, fuse, onStats });
  useEffect(() => {
    live.current = { fold, boxCfg, showEdges, wear, nature, lodNear, farFactor, weather, fuse, onStats };
  });
  const fused = useRef<THREE.Mesh>(null);
  const stoneMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), []);
  const resinMat = useMemo(() => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, metalness: 0 }), []);
  useEffect(() => applyResin(resinMat, resin), [resinMat, resin]);
  const fusedMats = useMemo(() => [stoneMat, resinMat], [stoneMat, resinMat]);
  const natureMat = useMemo(() => fadingPointsMaterial(), []);
  const reclaimMat = useMemo(() => fadingPointsMaterial(), []);
  useEffect(() => {
    for (const m of [natureMat, reclaimMat]) {
      m.size = nature?.size ?? 0.07;
      m.userData.fade.uFade0.value = nearFade[0];
      m.userData.fade.uFade1.value = nearFade[1];
    }
  }, [natureMat, reclaimMat, nature?.size, nearFade]);

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
      last.current = { seeds: p.seeds, boxes: p.parts, kinds: p.counts, t: p.t, top: p.top, farSeeds: p.farSeeds, workerMs: r.ms, runner: worker.current?.mode ?? "-", ...focus.current };
    }
    setPoints(naturePts.current, r.nature);
    setPoints(reclaimPts.current, r.reclaim);
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
    const { fold: f, boxCfg: cfg, showEdges: e, wear: wr, nature: nat, lodNear: near, farFactor: ff, weather: wx, fuse: fu } = live.current;
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
    const req: Extract<SpaceRequest, { type: "compute" }> = { type: "compute", id, parts: { fold: f, box: cfg, wear: wr, weather: wx, fuse: fu, edges: e, lod } };
    if (withNature && nat) {
      const focusK = (o ? Math.max(0, o.target.y) : 0) / cfg.unit;
      req.nature = { fold: f, box: cfg, weather: wx, fuse: fu, nature: nat.cfg, perSlot: nat.perSlot, window: nat.window, focusK, margin: nat.margin, budget: nat.budget, burialSlots: nat.burialSlots, lod };
      if (nat.reclaim) {
        req.reclaim = { tauReclaimYears: nat.tauReclaimYears, perArea: nat.reclaimPerArea, unit: cfg.unit, secPerUnit: wx.strata ? cfg.secPerUnit : undefined, timeScale: wx.timeScale };
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
      <points ref={reclaimPts} frustumCulled={false} visible={!!nature && nature.reclaim} material={reclaimMat}>
        <bufferGeometry />
      </points>
    </>
  );
}

/** Keeps `target` (the depth-of-field focus) on the orbit target. */
function FocusFollow({ controls, target }: { controls: React.MutableRefObject<Orbit | null>; target: THREE.Vector3 }) {
  useFrame(() => {
    const t = controls.current?.target;
    if (t) target.set(t.x, t.y, t.z);
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
  const fold = useFoldControls(SPACE_FOLD);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";
  const controls = useRef<Orbit | null>(null);
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, kinds: NO_COUNTS, t: 0, top: 0, focusS: 0, focusIsMe: false, farSeeds: 0, workerMs: 0, runner: "-" });
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

  const c = useControls("3D 시공간 (박스 생성 확인)", {
    secPerUnit: { value: SPACE_BOXES.secPerUnit, min: 2, max: 600, step: 1, label: "한 단 = 몇 초 (시간축)" },
    unit: { value: DEFAULT_BOXES.unit, min: 0.2, max: 4, step: 0.1, label: "한 단의 높이 (월드 단위)" },
    width: { value: SPACE_BOXES.width, min: 0.3, max: 3, step: 0.05, label: "부품 폭 배율" },
    density: { value: SPACE_BOXES.density, min: 0.2, max: 4, step: 0.1, label: "단당 매스 수 배율" },
    timeJitter: { value: SPACE_BOXES.timeJitter ?? 0, min: 0, max: 1, step: 0.05, label: "시간 오차 (부품 위치 ±단)" },
    emptyGapSec: { value: SPACE_FOLD.emptyGapSec, min: 1, max: 600, step: 1, label: "빈 시간으로 볼 공백 (s)" },
    showEdges: { value: false, label: "모서리 선" },
    wear: { value: true, label: "마모 적용 (지금 시점까지 버려진 시간만큼)" },
    follow: { value: true, label: "플레이어 시간대 따라가기" },
    toMe: button(() => jump(focusRef.current)),
    toGround: button(() => jump(0)),
    toLatest: button(() => jump(Math.max(0, topRef.current - 6))),
    markers: { value: true, label: "실시간 마커 (나/봇/방문자)" },
    markerHold: { value: 6, min: 2, max: 60, step: 1, label: "마커 유지 (갱신 끊긴 뒤 초)" },
    reload: button(() => log.addMany(loadEvents())),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
        clearWorld();
        log.clear();
      }
    }),
  });
  const ao = useControls("AO (N8AO)", {
    enabled: { value: true, label: "켜기" },
    aoRadius: { value: 2.5, min: 0.1, max: 12, step: 0.1, label: "반경 (월드)" },
    distanceFalloff: { value: 1, min: 0.05, max: 4, step: 0.05, label: "거리 감쇠" },
    intensity: { value: 3, min: 0, max: 12, step: 0.1, label: "세기" },
    quality: { options: ["performance", "low", "medium", "high", "ultra"] as const, value: "medium" as const, label: "품질" },
    halfRes: { value: false, label: "절반 해상도" },
  });
  const light = useControls("빛", {
    shadows: { value: true, label: "그림자" },
    azimuth: { value: 35, min: 0, max: 360, step: 1, label: "해 방위 (°)" },
    elevation: { value: 55, min: 5, max: 89, step: 1, label: "해 고도 (°)" },
    intensity: { value: 1.4, min: 0, max: 4, step: 0.05, label: "해 세기 (그림자 대비)" },
    softness: { value: 3, min: 0, max: 12, step: 0.5, label: "그림자 부드러움" },
    grain: { value: 0.18, min: 0, max: 1, step: 0.01, label: "그레인 (0 = 끔)" },
  });
  const view = useControls("시야 / 초점 / 배경", {
    theme: { options: { "종이 (밝음)": "paper", "검정": "black" }, value: "black" as keyof typeof THEMES, label: "배경" },
    nearFade: { value: [2, 24] as [number, number], min: 0, max: 60, step: 0.5, label: "가까운 식생 사라짐 (카메라 거리)" },
    dof: { value: true, label: "초점 (피사계 심도)" },
    dofRange: { value: 24, min: 1, max: 80, step: 1, label: "초점 범위 (월드)" },
    dofBokeh: { value: 6.5, min: 0, max: 10, step: 0.5, label: "흐림 정도" },
  });
  const weatherCtl = useControls("풍화 / 지층", {
    strata: { value: DEFAULT_WEATHER.strata, label: "지층: 층마다 자기 나이 (아래일수록 오래됨)" },
    timeScale: { value: DEFAULT_WEATHER.timeScale, min: 0.001, max: 1, step: 0.001, label: "풍화 속도 (모델 연수 배율)" },
    steelLife: { value: DEFAULT_WEATHER.steelLife, min: 0.05, max: 5, step: 0.05, label: "철골 수명 (슬래브 대비)" },
    concreteLife: { value: DEFAULT_WEATHER.concreteLife, min: 0.05, max: 5, step: 0.05, label: "콘크리트 수명 배율" },
    tauSedimentYears: { value: DEFAULT_WEATHER.tauSedimentYears, min: 10, max: 20000, step: 10, label: "식생 → 부식토/이탄 (년)" },
    coverSlots: { value: DEFAULT_WEATHER.coverSlots, min: 0, max: 20, step: 1, label: "덮였다고 볼 위층 수 (0 = 매몰 효과 끔)" },
    buriedSlow: { value: DEFAULT_WEATHER.buriedSlow, min: 1, max: 500, step: 1, label: "덮인 뒤 풍화가 몇 배 느려지나" },
    natureAccel: { value: DEFAULT_WEATHER.natureAccel, min: 0, max: 5, step: 0.1, label: "식생이 풍화를 빠르게 하는 정도" },
    ageJitter: { value: DEFAULT_WEATHER.ageJitter, min: 0, max: 1, step: 0.05, label: "풍화 오차 (부품마다 나이 ±)" },
  });
  const weather = useMemo<WeatherConfig>(() => ({ ...weatherCtl }), [weatherCtl]);
  const fuseCtl = useControls("엉김 · 융합 (건물이 덩어리가 되어감)", {
    enabled: { value: DEFAULT_FUSE.enabled, label: "켜기 (지층 + 마모가 켜져 있어야 함)" },
    accretion: { value: DEFAULT_FUSE.accretion, min: 0, max: 3, step: 0.05, label: "엉겨붙는 덩어리 세기 (0 = 끔)" },
    accDepth: { value: DEFAULT_FUSE.accDepth, min: 0.1, max: 4, step: 0.05, label: "덩어리 최대 두께 (월드)" },
    lump: { value: DEFAULT_FUSE.lump, min: 0.2, max: 4, step: 0.05, label: "덩어리 크기 (클수록 큰 뭉치)" },
    onset: { value: DEFAULT_FUSE.onset, min: 0, max: 0.95, step: 0.01, label: "융합이 시작되는 부식 정도" },
    voxel: { value: DEFAULT_FUSE.voxel, min: 0.15, max: 1.2, step: 0.05, label: "해상도 (복셀 크기, 작을수록 무거움)" },
    blur: { value: DEFAULT_FUSE.blur, min: 0, max: 5, step: 1, label: "엉김 반경 (복셀)" },
    gain: { value: DEFAULT_FUSE.gain, min: 0.5, max: 8, step: 0.1, label: "엉김 세기" },
    porosity: { value: DEFAULT_FUSE.porosity, min: 0, max: 2, step: 0.05, label: "다공성 (구멍)" },
    iso: { value: DEFAULT_FUSE.iso, min: 0.05, max: 0.9, step: 0.01, label: "표면 문턱" },
    natureWeight: { value: DEFAULT_FUSE.natureWeight, min: 0, max: 2, step: 0.05, label: "식생 퇴적물 비중" },
    resinShare: { value: DEFAULT_FUSE.resinShare, min: 0.1, max: 1.01, step: 0.01, label: "레진이 되는 퇴적 비율 (>1 = 끔)" },
  });
  const resinCtl = useControls("레진 (가장 오래된 층)", {
    color: { value: "#e8d9b8", label: "색" },
    transmission: { value: 0.85, min: 0, max: 1, step: 0.01, label: "투과" },
    roughness: { value: 0.45, min: 0, max: 1, step: 0.01, label: "거칠기 (서리 낀 정도)" },
    thickness: { value: 1.5, min: 0, max: 10, step: 0.1, label: "두께감" },
    attenuationColor: { value: "#6b3f17", label: "깊을수록 물드는 색" },
    attenuationDistance: { value: 2.5, min: 0.1, max: 30, step: 0.1, label: "물드는 거리 (짧을수록 무거움)" },
  });
  const resinLook = useMemo<ResinLook>(() => ({ ...resinCtl }), [resinCtl]);
  const fuseCfg = useMemo<FuseConfig>(() => ({ ...fuseCtl }), [fuseCtl]);
  const theme = THEMES[view.theme as keyof typeof THEMES] ?? THEMES.paper;
  const focusTarget = useMemo(() => new THREE.Vector3(0, 4, 0), []);
  const composerOn = ao.enabled || light.grain > 0 || view.dof;
  const natureView = useControls("자연 (시공간)", {
    enabled: { value: true, label: "켜기" },
    perSlot: { value: 6, min: 0.5, max: 40, step: 0.5, label: "칸·단당 점 수 (밀도 1일 때)" },
    size: { value: 0.07, min: 0.01, max: 0.4, step: 0.005, label: "점 크기" },
    window: { value: 120, min: 10, max: 600, step: 10, label: "보이는 시간 범위 (±단)" },
    margin: { value: 5, min: 0, max: 30, step: 1, label: "방문 범위 바깥 여백 (칸)" },
    budget: { value: 600000, min: 50000, max: 3000000, step: 50000, label: "최대 점 수" },
    burialSlots: { value: 3, min: 0, max: 20, step: 1, label: "매몰층: 탄생 아래 몇 단" },
    reclaim: { value: true, label: "재점유 (폐허 위 식생)" },
    tauReclaimYears: { value: 300, min: 10, max: 10000, step: 10, label: "재점유 속도 (년, 작을수록 빠름)" },
    reclaimPerArea: { value: 10, min: 0, max: 80, step: 1, label: "재점유: 칸²당 점 수" },
  });
  const { cfg: natureCfg } = useNatureControls();
  const lod = useControls("LOD (성능)", {
    near: { value: 60, min: 5, max: 400, step: 5, label: "이 거리 안쪽만 막대 묶음 (월드)" },
    farFactor: { value: 0.25, min: 0.05, max: 1, step: 0.05, label: "먼 곳 식생 점 비율" },
  });
  const natureParams = useMemo<NatureParams | null>(
    () =>
      natureView.enabled
        ? {
            cfg: natureCfg,
            perSlot: natureView.perSlot,
            size: natureView.size,
            window: natureView.window,
            margin: natureView.margin,
            budget: natureView.budget,
            burialSlots: natureView.burialSlots,
            reclaim: natureView.reclaim,
            tauReclaimYears: natureView.tauReclaimYears,
            reclaimPerArea: natureView.reclaimPerArea,
          }
        : null,
    [natureView, natureCfg],
  );
  const steel = useControls("철골 (steel)", {
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
  });
  const slat = useControls("막대 묶음 / 드립", {
    enabled: { value: RC.slat.enabled, label: "큰 매스를 막대 묶음으로" },
    minFootprint: { value: RC.slat.minFootprint, min: 0.2, max: 4, step: 0.05, label: "묶음이 되는 최소 크기 (칸)" },
    width: { value: RC.slat.width, min: 0.03, max: 1, step: 0.01, label: "막대 굵기 (칸)" },
    density: { value: RC.slat.density, min: 0.1, max: 1, step: 0.05, label: "막대 채움 비율" },
    maxPerMass: { value: RC.slat.maxPerMass, min: 4, max: 200, step: 1, label: "매스당 최대 막대 수" },
    vertical: { value: RC.slat.vertical, min: 0, max: 1, step: 0.05, label: "세로(매달린) 묶음 비율" },
    shortest: { value: RC.slat.shortest, min: 0.05, max: 1, step: 0.05, label: "매달린 막대 최소 길이 (매스 높이 대비)" },
    dripPerArea: { value: RC.drip.perArea, min: 0, max: 6, step: 0.1, label: "드립: 칸²당 개수" },
    dripMax: { value: RC.drip.max, min: 0, max: 60, step: 1, label: "드립: 부품당 최대" },
    dripLength: { value: RC.drip.length, min: 0.02, max: 6, step: 0.01, label: "드립: 길이 (단)" },
    dripAlpha: { value: RC.drip.alpha, min: 0.3, max: 4, step: 0.05, label: "드립: 길이 분포 (작을수록 긴 것 많음)" },
    dripWidth: { value: RC.drip.width, min: 0.01, max: 0.4, step: 0.01, label: "드립: 굵기 (칸)" },
  });
  const found = useControls("기초", {
    plinthFootprint: { value: RC.plinth.footprint, min: 0.3, max: 8, step: 0.1, label: "기단: 크기 (칸)" },
    plinthThick: { value: RC.plinth.thick, min: 0.02, max: 2, step: 0.01, label: "기단: 두께 (단)" },
    basementDepth: { value: RC.basement.depth, min: 0.01, max: 6, step: 0.05, label: "베이스먼트: 깊이 (단)" },
    basementFootprint: { value: RC.basement.footprint, min: 0.1, max: 1, step: 0.05, label: "베이스먼트: 크기 (기단 대비)" },
    pileCount: { value: RC.pile.count, min: 0, max: 10, step: 1, label: "말뚝: 개수" },
    pileDepth: { value: RC.pile.depth, min: 0.05, max: 8, step: 0.05, label: "말뚝: 길이 (단)" },
    pileWidth: { value: RC.pile.width, min: 0.01, max: 0.4, step: 0.01, label: "말뚝: 굵기 (칸)" },
  });
  const recipe = useMemo<Recipe>(
    () => ({
      ...RC,
      plinth: { footprint: found.plinthFootprint, thick: found.plinthThick },
      basement: { depth: found.basementDepth, footprint: found.basementFootprint },
      pile: { count: found.pileCount, depth: found.pileDepth, width: found.pileWidth },
      slat: { enabled: slat.enabled, minFootprint: slat.minFootprint, width: slat.width, density: slat.density, maxPerMass: slat.maxPerMass, vertical: slat.vertical, shortest: slat.shortest },
      drip: { perArea: slat.dripPerArea, max: slat.dripMax, length: slat.dripLength, alpha: slat.dripAlpha, width: slat.dripWidth },
      beam: { ...RC.beam, chance: steel.beamChance, length: steel.beamLength, width: steel.beamWidth, onGrid: steel.beamOnGrid, skew: steel.beamSkew * DEG },
      brace: { ...RC.brace, chance: steel.braceChance, length: steel.braceLength, tilt: pair(steel.braceTilt, DEG), width: steel.braceWidth },
      column: { ...RC.column, count: steel.columnCount, width: steel.columnWidth },
    }),
    [steel, slat, found],
  );
  const boxCfg = useMemo<BoxConfig>(
    () => ({ ...DEFAULT_BOXES, secPerUnit: c.secPerUnit, unit: c.unit, width: c.width, density: c.density, timeJitter: c.timeJitter, recipe }),
    [c.secPerUnit, c.unit, c.width, c.density, c.timeJitter, recipe],
  );
  // heights on the time axis, read by the "toLatest" / "toMe" buttons
  topRef.current = Math.max(stats.top, (stats.t / c.secPerUnit) * c.unit);
  focusRef.current = (stats.focusS / c.secPerUnit) * c.unit;
  const spaceFold = useMemo(() => ({ ...fold, emptyGapSec: c.emptyGapSec }), [fold, c.emptyGapSec]);

  return (
    <div className="relative h-full w-full" style={{ background: theme.bg }}>
      <Leva hidden={hideUi} />
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[theme.bg]} />
        <ambientLight intensity={0.85} />
        <Sun controls={controls} azimuth={light.azimuth} elevation={light.elevation} intensity={light.intensity} softness={light.softness} shadows={light.shadows} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <gridHelper key={view.theme} args={[80, 80, theme.grid[0], theme.grid[1]]} position={[0, -0.01, 0]} />
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
          lodNear={lod.near}
          farFactor={lod.farFactor}
          weather={weather}
          fuse={fuseCfg}
          resin={resinLook}
          nearFade={view.nearFade}
        />
        <FocusFollow controls={controls} target={focusTarget} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={Math.PI * 0.499} />
        {composerOn && (
          <EffectComposer key={`${ao.enabled}:${light.grain > 0}:${view.dof}`}>
            {ao.enabled && <N8AO aoRadius={ao.aoRadius} distanceFalloff={ao.distanceFalloff} intensity={ao.intensity} quality={ao.quality} halfRes={ao.halfRes} color="black" />}
            {view.dof && <DepthOfField target={focusTarget} worldFocusRange={view.dofRange} bokehScale={view.dofBokeh} />}
            {light.grain > 0 && <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={light.grain} />}
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
