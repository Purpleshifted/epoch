"use client";
/**
 * FutureResidue — THE SCAN'S RESIDUE BECOMES THE FUTURE (the artist, 2026-11-27: direction B of the scan (future) study,
 * then "있을 때만" and "미래 관찰자가 사라지면 이전 pointcloud 흩날려 사라지듯이"; docs/mobile-view-lab.md › scan (future)).
 *
 * While the lidar reads the present (LidarScan.tsx), the future's place round the visitor is read every few seconds as
 * the wall infers it (lib/parliament/futurePresence.ts): the parts that are left (as points on their faces), the plants
 * that take the ground, the mounds and the dark earth. None of it is drawn by itself. A part is FOUND when one of the
 * scan's readings lands within `find` of it — and only while one of the future's observers (lib/parliament/excavators.ts,
 * the same walkers bot (future) shows) is within `gateR` of the visitor. A found part develops from where the reading
 * touched it outwards (`spread`), first in the colour the scan saw there, then pale (white for what is left, steel and
 * piles brightest; green for the plants) — and stays. Looking round leaves the ruin as an afterimage among the present's
 * passing colours: the visitor is the scanner, and what they look at while the future is near is what is found.
 *
 * When the observer goes (out of reach, or gone), everything found blows away the way it walks, each point at its own
 * moment, rising a little and thinning out — as the encounter's cloud streamed away (FutureEncounter.tsx).
 *
 * Shown where `residueActive()` says: the scan (future) lab page, and — with 개인뷰에 켜기 — wherever every asset runs
 * (the action preview, the experiment). `?futurepass=1` (the scan (future) page's test scene): one observer that walks
 * in, stands, walks away and is gone, every 32 s.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { futurePresence, type PresenceConfig, type PresenceResult } from "@/lib/parliament/futurePresence";
import { excavatorsAt, type Excavator } from "@/lib/parliament/excavators";
import { wrapDelta } from "@/lib/parliament/world";
import { CELL_SIZE } from "@/lib/stratum/field";
import { lidarActive, lidarLook, lidarTap } from "./LidarScan";
import { mobileLab, runsEveryAsset } from "./mobileLab";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";
import type { FuturePresenceVisual } from "./FuturePresence";

export interface ResidueLook {
  /** 개인뷰에 켜기: the residue where every asset runs (the preview, the experiment); the scan (future) page always. */
  on: boolean;
  /** An observer within this (world) of the visitor makes the future findable. */
  gateR: number;
  /** A reading within this (world) of a part finds it. */
  find: number;
  /** How fast a found part develops from where it was touched (world/s). */
  spread: number;
  /** Seconds from the scan's colour to the residue's. */
  develop: number;
  /** Seconds a found part stays while the observer is near (0 = until it leaves). */
  life: number;
  /** A point's size on screen (CSS px). */
  dot: number;
  /** What is left: its colour, and concrete's share of it (steel and piles full). */
  colour: string;
  concrete: number;
  /** Points of a plant cloud per square world unit of its ground. */
  plantDensity: number;
  /** The blowing away: its time (s), how far (world), how far apart the points start (s), how much they rise (world). */
  scatter: number;
  scatterDist: number;
  stagger: number;
  rise: number;
}

export const DEFAULT_RESIDUE: ResidueLook = { on: false, gateR: 12, find: 0.6, spread: 5, develop: 1.2, life: 0, dot: 2, colour: "#ffffff", concrete: 0.7, plantDensity: 8, scatter: 2.5, scatterDist: 5, stagger: 1.2, rise: 1.2 };

/** Set by the scan (future) knobs (labKnobsScanFuture.ts), read per frame here. */
export const residueLook: ResidueLook = { ...DEFAULT_RESIDUE };
export function setResidueLook(v: Partial<ResidueLook>): void {
  Object.assign(residueLook, v);
}

/** Whether the residue runs on this page: under the lidar, on the scan (future) page, or where every asset runs and
 *  the place is switched on for the personal view. */
export function residueActive(): boolean {
  if (!lidarActive()) return false;
  return mobileLab() === "scan-future" || (runsEveryAsset() && residueLook.on);
}

/** THE WALL'S DENSITY RULE AS THE ARTIST HAD IT ON 2026-11-20 — until the server's hello says its own (as FuturePresence). */
const FALLBACK_DENSITY: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: NO_PATHS }, slotSec: 20, gapSec: 20, maxBuilt: 8000, mergeGap: 3, mergeThick: 2, liveAt: 0.25, minVisitors: 4, step: 40, maxLevel: 6, ratio: 3, massRatio: 1.45, visitorCap: 60, radius: 2.75, timeSec: 60, down: 0.5 };
/** Samples put into the field in one frame. */
const FEED_PER_FRAME = 150;
/** The most points in the pool (the parts' faces, the plants, the mounds, what is still blowing away). */
const CAP = 120_000;
/** Readings looked at in one frame (more are sampled evenly). */
const READ_PER_FRAME = 4000;
/** The parts' grid (world): a reading looks in its own bucket only, each part in every bucket it reaches into. */
const GRID = 2.4;
/** Rays of the residue's own onto the ground a frame (finding only, never drawn). */
const GROUND_RAYS = 240;

const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** What a part has been through, kept across readings by its key. */
interface PartState {
  /** When it was found (s; 0 = not), when it was let go (s; 0 = not), where it was touched. */
  found: number;
  rel: number;
  hx: number;
  hy: number;
  hz: number;
  /** Its blowing direction (the observer's way when it was let go). */
  dx: number;
  dz: number;
  /** When it went from the future's reading (s; 0 = it is there): it fades out instead of popping. */
  died: number;
}

/** The pool as built from one reading: the points (grouped by part) and the parts. */
interface Pool {
  n: number;
  pos: Float32Array;
  col: Float32Array;
  seed: Float32Array;
  parts: { key: string; i0: number; i1: number; box: [number, number, number, number, number, number] }[];
  grid: Map<number, number[]>;
}

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aFound;
attribute float aDelay;
attribute float aRel;
attribute vec2 aDir;
attribute float aSeed;
attribute float aDie;
uniform float uTime;
uniform float uDevelop;
uniform float uLife;
uniform float uScatter;
uniform float uStagger;
uniform float uDist;
uniform float uRise;
uniform float uSize;
uniform float uRange;
uniform float uLod;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec3 vCol;
varying float vA;
varying float vPx;
vec3 ramp(float t) {
  return t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0);
}
void main() {
  vec3 p = position;
  float a = 0.0;
  float px = uSize;
  vec3 col = aCol;
  if (aFound > 0.0) {
    float age = uTime - (aFound + aDelay);
    a = age < 0.0 ? 0.0 : 1.0;
    // developing: first as the scan saw it there (the lidar's colour by range from the eye), then pale — what is left
    vec4 mv0 = modelViewMatrix * vec4(p, 1.0);
    float dEye = -mv0.z;
    vec3 seen = ramp(clamp(dEye / uRange, 0.0, 1.0) * 3.0);
    // far off, as sparse as the lidar's own far readings (kept with the chance (lod/d)²), and gone at the scanner's
    // reach — the far plants had piled into one green band along the horizon
    if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
    a *= 1.0 - smoothstep(uRange * 0.7, uRange, dEye);
    col = mix(seen, aCol, uDevelop > 0.0 ? smoothstep(0.0, uDevelop, age) : 1.0);
    if (uLife > 0.0) a *= 1.0 - smoothstep(uLife * 0.7, uLife, age);
    // (gone from the future's reading: it fades in a second rather than popping)
    if (aDie > 0.0) a *= 1.0 - smoothstep(0.0, 1.0, uTime - aDie);
    // BLOWN AWAY when the observer went: each point at its own moment, the observer's way spread a little, rising,
    // swaying, smaller and fainter until it is gone
    if (aRel > 0.0) {
      float rt = uTime - aRel - aSeed * uStagger;
      if (rt > 0.0) {
        float k = clamp(rt / max(0.05, uScatter), 0.0, 1.0);
        float ang = (fract(aSeed * 7.31) - 0.5) * 1.4;
        float ca = cos(ang), sa = sin(ang);
        vec2 d = vec2(aDir.x * ca - aDir.y * sa, aDir.x * sa + aDir.y * ca);
        float s = uDist * (0.35 * k + 0.65 * k * k) * (0.6 + 0.8 * fract(aSeed * 13.7));
        float sw = sin(rt * 3.1 + aSeed * 40.0) * 0.25 * k;
        p += vec3(d.x * s - d.y * sw, uRise * k * (0.5 + fract(aSeed * 5.3)), d.y * s + d.x * sw);
        a *= 1.0 - smoothstep(0.3, 1.0, k);
        px *= 1.0 - 0.55 * k;
      }
    }
  }
  vA = a;
  vCol = col;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // (as the lidar's dots: one size on screen, a little larger right by the eye)
  vPx = px * clamp(3.0 / max(0.1, -mv.z), 1.0, 1.6);
  gl_PointSize = a > 0.0 ? vPx : 0.0;
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vPx;
void main() {
  // a round dot with a one-pixel edge, as the lidar's
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float edge = clamp((1.0 - r) * vPx * 0.5 + 0.5, 0.0, 1.0);
  float a = vA * edge;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/** The pool's GPU side, made the first time the residue runs (the exhibition's view never makes it). */
function makePoints(): THREE.Points {
  const g = new THREE.BufferGeometry();
  const attr = (name: string, size: number) => {
    const a = new THREE.BufferAttribute(new Float32Array(CAP * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  };
  attr("position", 3);
  attr("aCol", 3);
  attr("aFound", 1);
  attr("aDelay", 1);
  attr("aRel", 1);
  attr("aDir", 2);
  attr("aSeed", 1);
  attr("aDie", 1);
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDevelop: { value: 1.2 },
      uLife: { value: 0 },
      uScatter: { value: 2.5 },
      uStagger: { value: 1.2 },
      uDist: { value: 5 },
      uRise: { value: 1.2 },
      uSize: { value: 2 },
      uRange: { value: 22 },
      uLod: { value: 12 },
      uC0: { value: new THREE.Color("#5ff0c8") },
      uC1: { value: new THREE.Color("#c6f06a") },
      uC2: { value: new THREE.Color("#ffb86b") },
      uC3: { value: new THREE.Color("#ff7eb0") },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

/** The pool from one reading of the future: the parts' faces, the trees, the plant clouds, the mounds, the dark earth. */
function buildPool(r: PresenceResult, unit: number, look: ResidueLook, plantHex: string): Pool {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), seed = new Float32Array(CAP);
  const parts: Pool["parts"] = [];
  let n = 0;
  const white = new THREE.Color(look.colour), green = new THREE.Color(plantHex);
  let part: Pool["parts"][number] | null = null;
  const open = (tag: string) => {
    part = { key: tag, i0: n, i1: n, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
  };
  const close = () => {
    const p = part;
    part = null;
    if (!p || n <= p.i0) return;
    p.i1 = n;
    const b = p.box;
    p.key = `${p.key}:${Math.round(b[0] * 100)},${Math.round(b[1] * 100)},${Math.round(b[2] * 100)},${Math.round(b[3] * 100)},${Math.round(b[4] * 100)},${Math.round(b[5] * 100)}`;
    parts.push(p);
  };
  const add = (x: number, y: number, z: number, c: THREE.Color, k: number, s: number): boolean => {
    if (n >= CAP || !part) return false;
    const p = part as Pool["parts"][number];
    pos[n * 3] = x;
    pos[n * 3 + 1] = y;
    pos[n * 3 + 2] = z;
    col[n * 3] = c.r * k;
    col[n * 3 + 1] = c.g * k;
    col[n * 3 + 2] = c.b * k;
    seed[n] = s;
    const b = p.box;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x;
    if (y > b[4]) b[4] = y;
    if (z > b[5]) b[5] = z;
    n++;
    return true;
  };
  // WHAT IS LEFT: the parts' faces (steel and piles full, concrete paler; each point its own small tone)
  const S = r.surface, SP = r.surfacePart;
  let cur = -1;
  for (let i = 0, o = 0; o + 3 < S.length && i < SP.length; i++, o += 4) {
    if (SP[i] !== cur) {
      close();
      cur = SP[i];
      open("p");
    }
    const k = (r.partSteel[cur] ? 1 : look.concrete) * (0.82 + 0.36 * hash(i, cur, 31));
    add(S[o], S[o + 1], S[o + 2], white, k, hash(i, cur, 37));
  }
  close();
  // THE TREES: their points, one part a cell
  const T = r.vegTree;
  const trees = new Map<number, number[]>();
  for (let o = 0; o + 4 < T.length; o += 5) {
    const q = Math.floor(T[o] / CELL_SIZE) * 65536 + Math.floor(T[o + 2] / CELL_SIZE);
    const l = trees.get(q);
    if (l) l.push(o);
    else trees.set(q, [o]);
  }
  for (const list of trees.values()) {
    open("t");
    for (const o of list) add(T[o], T[o + 1] * unit, T[o + 2], green, 0.6 + 0.8 * T[o + 3], hash(Math.round(T[o] * 97), Math.round(T[o + 2] * 89), o));
    close();
  }
  // THE PLANT CLOUDS (grass and scrub: x, z, foot, radius, height …): points in a low dome over their ground
  const PC = r.plantClouds;
  for (let o = 0; o + 11 < PC.length; o += 12) {
    const x = PC[o], z = PC[o + 1], foot = PC[o + 2] * unit, R = Math.max(0.05, PC[o + 3]), H = PC[o + 4] * unit;
    const cnt = Math.max(4, Math.min(80, Math.round(Math.PI * R * R * look.plantDensity)));
    const sx = Math.round(x * 100), sz = Math.round(z * 100);
    open("g");
    for (let i = 0; i < cnt; i++) {
      const a = hash(sx, sz, i * 3 + 1) * Math.PI * 2, rr = R * Math.sqrt(hash(sx, sz, i * 3 + 2));
      const y = foot + 0.02 + H * (1 - (rr / R) * (rr / R)) * (0.3 + 0.7 * hash(sx, sz, i * 3 + 3));
      add(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, green, 0.75 + 0.5 * hash(sz, sx, i), hash(sx, i, sz));
    }
    close();
  }
  // THE MOUNDS: a dome of pale points, fuller the higher their score; THE DARK EARTH: a few grey points flat
  const M = r.mounds;
  for (let o = 0; o + 3 < M.length; o += 4) {
    const x = M[o], z = M[o + 1], score = M[o + 2], sd = Math.floor(M[o + 3] * 1e6);
    const cnt = Math.min(48, 8 + Math.round(score * 8)), R = CELL_SIZE * 0.45 * Math.min(2, Math.sqrt(score)), H = unit * 0.3 * Math.min(1.5, score);
    open("m");
    for (let i = 0; i < cnt; i++) {
      const u1 = hash(sd, i, 1), th = hash(sd, i, 2) * Math.PI * 2, rr = R * Math.sqrt(u1);
      add(x + Math.cos(th) * rr, 0.02 + H * (1 - u1), z + Math.sin(th) * rr, white, 0.75 + 0.2 * hash(sd, i, 3), hash(sd, i, 4));
    }
    close();
  }
  const E = r.stains;
  for (let o = 0; o + 3 < E.length; o += 4) {
    const x = E[o], z = E[o + 1], share = E[o + 2], sd = Math.floor(E[o + 3] * 1e6);
    const cnt = 4 + Math.round(share * 6);
    open("e");
    for (let i = 0; i < cnt; i++) {
      const th = hash(sd, i, 5) * Math.PI * 2, rr = CELL_SIZE * 0.4 * Math.sqrt(hash(sd, i, 6));
      add(x + Math.cos(th) * rr, 0.02, z + Math.sin(th) * rr, white, 0.4, hash(sd, i, 7));
    }
    close();
  }
  // (the parts' buckets: each part in every bucket its box, grown by the finding distance, reaches into)
  const grid = new Map<number, number[]>();
  const f = Math.max(0, look.find);
  parts.forEach((p, i) => {
    const b = p.box;
    for (let gx = Math.floor((b[0] - f) / GRID); gx <= Math.floor((b[3] + f) / GRID); gx++)
      for (let gz = Math.floor((b[2] - f) / GRID); gz <= Math.floor((b[5] + f) / GRID); gz++) {
        const q = (gx + 32768) * 65536 + (gz + 32768);
        const l = grid.get(q);
        if (l) l.push(i);
        else grid.set(q, [i]);
      }
  });
  return { n, pos, col, seed, parts, grid };
}

export function FutureResidue({ log, meRef, getS, playerPosRef, getEpochMs, getWorldSec, getLive, cfg }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; getEpochMs: () => number; getWorldSec: () => number; getLive: () => boolean; cfg: FuturePresenceVisual }) {
  const group = useRef<THREE.Group>(null);
  const pts = useRef<THREE.Points | null>(null);
  const field = useRef<{ f: DensityField; dens: DensityConfig | null; version: unknown; fed: number; drops: number } | null>(null);
  const st = useRef({ timer: 10, pool: null as Pool | null, states: new Map<string, PartState>(), tapFrame: -1, present: false, obs: null as Excavator | null, pass: null as null | { x: number; z: number; fx: number; fz: number; t0: number } });
  useEffect(
    () => () => {
      const p = pts.current;
      if (p) {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }
    },
    [],
  );

  useFrame((state, dt) => {
    const on = residueActive();
    if (pts.current) pts.current.visible = on;
    if (!on) return;
    if (!pts.current && group.current) {
      pts.current = makePoints();
      group.current.add(pts.current);
    }
    const P = pts.current;
    if (!P) return;
    const L = residueLook, s = st.current, now = state.clock.elapsedTime, me = playerPosRef.current;
    const t0 = performance.now();

    // THE FIELD: this view's log through the wall's density rule, fed a little every frame (as FuturePresence)
    const dcfg = visitorWorld.density ?? FALLBACK_DENSITY;
    let h = field.current;
    if (!h || h.dens !== visitorWorld.density || h.version !== visitorWorld.version || h.drops !== log.drops) h = field.current = { f: new DensityField(dcfg), dens: visitorWorld.density, version: visitorWorld.version, fed: 0, drops: log.drops };
    const all = log.all();
    if (h.fed < all.length) {
      const to = Math.min(all.length, h.fed + FEED_PER_FRAME);
      for (let i = h.fed; i < to; i++) h.f.add(all[i]);
      h.fed = to;
    }

    // THE OBSERVERS: the future's walkers (a pure function of the world's clock), or the test scene's one
    const g = P.geometry;
    const A = (name: string) => g.getAttribute(name) as THREE.BufferAttribute;
    const fFound = A("aFound").array as Float32Array, fDelay = A("aDelay").array as Float32Array, fRel = A("aRel").array as Float32Array, fDir = A("aDir").array as Float32Array;
    let dirty0 = Infinity, dirty1 = -1;
    let near: Excavator | null = null, nearD = Infinity;
    if (getLive()) {
      let obs: Excavator[] = [];
      const passOn = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("futurepass") === "1";
      if (passOn) {
        // (the test scene: one observer comes from 18 ahead to 3.5 ahead (6 s), stands (12 s), walks off sideways out
        // of reach (6 s), and is gone (8 s); again and again, from where the visitor first stood and looked)
        if (!s.pass) {
          const d = new THREE.Vector3();
          state.camera.getWorldDirection(d);
          d.y = 0;
          if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
          d.normalize();
          s.pass = { x: me.x, z: me.z, fx: d.x, fz: d.z, t0: now };
        }
        const q = s.pass, u = (now - q.t0) % 32, sm = (v: number) => v * v * (3 - 2 * v);
        const sx = -q.fz, sz = q.fx;
        if (u < 6) {
          const a = 18 + (3.5 - 18) * sm(u / 6);
          obs = [{ i: 0, x: q.x + q.fx * a, z: q.z + q.fz * a, dx: -q.fx, dz: -q.fz, standing: false }];
        } else if (u < 18) obs = [{ i: 0, x: q.x + q.fx * 3.5, z: q.z + q.fz * 3.5, dx: sx, dz: sz, standing: true }];
        else if (u < 24) {
          const b = 18 * sm((u - 18) / 6);
          obs = [{ i: 0, x: q.x + q.fx * 3.5 + sx * b, z: q.z + q.fz * 3.5 + sz * b, dx: sx, dz: sz, standing: false }];
        }
      } else {
        const epoch = getEpochMs();
        if (epoch > 0) obs = excavatorsAt(epoch, getWorldSec(), { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 });
      }
      for (const o of obs) {
        const d = Math.hypot(wrapDelta(o.x - me.x), wrapDelta(o.z - me.z));
        if (d < nearD) {
          nearD = d;
          near = o;
        }
      }
    }
    // (in reach, with a little give so it does not flicker at the edge)
    const wasPresent = s.present;
    s.present = near !== null && nearD <= (wasPresent ? L.gateR * 1.1 : L.gateR);
    if (near) s.obs = near;
    // LET GO: the observer went — everything held blows away its way
    if (wasPresent && !s.present && s.pool) {
      const o = s.obs;
      let dx = o ? o.dx : 1, dz = o ? o.dz : 0;
      if (o && o.standing) {
        // (it stood: the way from the visitor to it)
        const ax = wrapDelta(o.x - me.x), az = wrapDelta(o.z - me.z), l = Math.hypot(ax, az);
        if (l > 1e-3) [dx, dz] = [ax / l, az / l];
      }
      s.pool.parts.forEach((p) => {
        const ps = s.states.get(p.key);
        if (!ps || ps.found <= 0 || ps.rel > 0 || ps.died > 0) return;
        if (L.life > 0 && now - ps.found > L.life) return;
        ps.rel = now;
        ps.dx = dx;
        ps.dz = dz;
        for (let i = p.i0; i < p.i1; i++) {
          fRel[i] = now;
          fDir[i * 2] = dx;
          fDir[i * 2 + 1] = dz;
        }
        dirty0 = Math.min(dirty0, p.i0);
        dirty1 = Math.max(dirty1, p.i1);
      });
    }

    // THE READING OF THE FUTURE, every few seconds: the pool built anew, what each part has been through carried by
    // its key; a part gone from the reading fades out where it was (or finishes blowing away)
    s.timer += dt;
    const sNow = getS();
    if (s.timer >= Math.max(0.5, cfg.everySec) && h.fed >= all.length && sNow > 0) {
      s.timer = 0;
      const kMe = Math.floor(sNow / Math.max(1, dcfg.slotSec));
      let K = kMe;
      if (cfg.readLatest) {
        let kk = -Infinity;
        for (const sd of h.f.seeds()) if (sd.levels) for (const [k, lv] of sd.levels) if (lv >= 1 && k > kk && k <= K) kk = k;
        if (kk !== -Infinity) K = kk;
      }
      const box: BoxConfig = { ...DEFAULT_BOXES, secPerUnit: Math.max(1, dcfg.slotSec), unit: cfg.unit, width: 0.8, density: 1.4, variety: DEFAULT_VARIETY, buildSlots: 0 };
      const pcfg: PresenceConfig = { band: cfg.band, ruin: cfg.ruin, unit: cfg.unit, radius: lidarLook.range + 4, maxBuildings: cfg.maxBuildings, strip: cfg.strip, lastSteel: cfg.lastSteel, lastPile: cfg.lastPile, traces: false, surface: cfg.surface, surfaceCap: 160, wild: cfg.wild };
      const r = futurePresence(h.f, meRef.current.id, K, kMe, me, pcfg, box);
      const pool = buildPool(r, cfg.unit, L, cfg.plantColor);
      // (what was found and has left the reading: carried over to fade, or to finish blowing away)
      const old = s.pool;
      const keys = new Set(pool.parts.map((p) => p.key));
      // (one that had faded out and is back in the reading is new: it waits to be found again)
      for (const k of keys) if ((s.states.get(k)?.died ?? 0) > 0) s.states.delete(k);
      const gone = L.scatter + L.stagger + 0.5;
      if (old)
        for (const p of old.parts) {
          if (keys.has(p.key)) continue;
          const ps = s.states.get(p.key);
          if (!ps || ps.found <= 0) continue;
          if (ps.rel > 0 ? now - ps.rel > gone : ps.died > 0 && now - ps.died > 1.2) continue;
          if (ps.rel <= 0 && ps.died <= 0) ps.died = now;
          if (pool.n + (p.i1 - p.i0) > CAP) continue;
          const i0 = pool.n;
          pool.pos.set(old.pos.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.col.set(old.col.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.seed.set(old.seed.subarray(p.i0, p.i1), i0);
          pool.n += p.i1 - p.i0;
          pool.parts.push({ key: p.key, i0, i1: pool.n, box: p.box });
          keys.add(p.key);
        }
      // (the states of parts long gone or long blown away are forgotten: they may be found again)
      for (const [k, ps] of s.states) {
        if (!keys.has(k) || (ps.rel > 0 && now - ps.rel > gone)) s.states.delete(k);
      }
      // the GPU side anew: positions, colours, seeds, and what each part has been through
      const fPos = A("position").array as Float32Array, fCol = A("aCol").array as Float32Array, fSeed = A("aSeed").array as Float32Array, fDie = A("aDie").array as Float32Array;
      fPos.set(pool.pos.subarray(0, pool.n * 3));
      fCol.set(pool.col.subarray(0, pool.n * 3));
      fSeed.set(pool.seed.subarray(0, pool.n));
      for (const p of pool.parts) {
        const ps = s.states.get(p.key);
        for (let i = p.i0; i < p.i1; i++) {
          if (!ps || ps.found <= 0) {
            fFound[i] = 0;
            fDelay[i] = 0;
            fRel[i] = 0;
            fDie[i] = 0;
            continue;
          }
          fFound[i] = ps.found;
          fDelay[i] = Math.hypot(fPos[i * 3] - ps.hx, fPos[i * 3 + 1] - ps.hy, fPos[i * 3 + 2] - ps.hz) / Math.max(0.1, L.spread) + 0.08 * fSeed[i];
          fRel[i] = ps.rel;
          fDir[i * 2] = ps.dx;
          fDir[i * 2 + 1] = ps.dz;
          fDie[i] = ps.died;
        }
      }
      // (the buckets were made from the new parts only; the carried ones cannot be found again)
      s.pool = pool;
      for (const at of ["position", "aCol", "aSeed", "aDie", "aFound", "aDelay", "aRel", "aDir"]) {
        const a = A(at);
        a.clearUpdateRanges();
        a.addUpdateRange(0, pool.n * a.itemSize);
        a.needsUpdate = true;
      }
      dirty0 = Infinity;
      dirty1 = -1;
      g.setDrawRange(0, pool.n);
      (window as unknown as { __residue?: unknown }).__residue = { k: K, kMe, parts: pool.parts.length, points: pool.n, held: [...s.states.values()].filter((q) => q.found > 0 && q.rel <= 0).length, present: s.present, observer: Math.round(nearD * 10) / 10, ms: r.ms };
    }

    // FINDING: the scan's readings near a part find it — only while an observer is near
    const pool = s.pool;
    if (pool && s.present) {
      const f = Math.max(0, L.find);
      const fSeed = A("aSeed").array as Float32Array, fPos = A("position").array as Float32Array;
      const findAt = (x: number, y: number, z: number) => {
        const list = pool.grid.get((Math.floor(x / GRID) + 32768) * 65536 + (Math.floor(z / GRID) + 32768));
        if (!list) return;
        for (const pi of list) {
          const p = pool.parts[pi];
          let ps = s.states.get(p.key);
          if (ps && ps.found > 0 && ps.rel <= 0 && ps.died <= 0 && !(L.life > 0 && now - ps.found > L.life)) continue;
          if (ps && ps.died > 0) continue;
          const b = p.box;
          const ddx = Math.max(b[0] - x, 0, x - b[3]), ddy = Math.max(b[1] - y, 0, y - b[4]), ddz = Math.max(b[2] - z, 0, z - b[5]);
          if (ddx * ddx + ddy * ddy + ddz * ddz > f * f) continue;
          // FOUND: it develops from here outwards
          if (!ps) {
            ps = { found: 0, rel: 0, hx: 0, hy: 0, hz: 0, dx: 1, dz: 0, died: 0 };
            s.states.set(p.key, ps);
          }
          Object.assign(ps, { found: now, rel: 0, hx: x, hy: y, hz: z, died: 0 });
          for (let i = p.i0; i < p.i1; i++) {
            fFound[i] = now;
            fDelay[i] = Math.hypot(fPos[i * 3] - x, fPos[i * 3 + 1] - y, fPos[i * 3 + 2] - z) / Math.max(0.1, L.spread) + 0.08 * fSeed[i];
            fRel[i] = 0;
          }
          dirty0 = Math.min(dirty0, p.i0);
          dirty1 = Math.max(dirty1, p.i1);
        }
      };
      // …the lidar's own readings of this frame (walls, roofs, and the ground when its radar draws dots)…
      if (lidarTap.pos && lidarTap.frame !== s.tapFrame) {
        s.tapFrame = lidarTap.frame;
        const Pt = lidarTap.pos, cap = lidarTap.cap, n = lidarTap.n, stride = Math.max(1, Math.ceil(n / READ_PER_FRAME));
        for (let j = 0; j < n; j += stride) {
          const k = (lidarTap.start + j) % cap;
          findAt(Pt[k * 3], Pt[k * 3 + 1], Pt[k * 3 + 2]);
        }
      }
      // …and a few rays of its own through the view onto the ground (not drawn): the ground's radar may draw lines,
      // which leave no readings, and the plants and mounds lie on the ground
      const cam = state.camera as THREE.PerspectiveCamera, e = cam.matrixWorld.elements;
      const th = Math.tan(((cam.fov ?? 60) * Math.PI) / 360), asp = cam.aspect ?? 1, cy = Math.max(0.05, cam.position.y);
      for (let i = 0; i < GROUND_RAYS; i++) {
        const px = (Math.random() * 2 - 1) * th * asp, py = (Math.random() * 2 - 1) * th;
        const dx = -e[8] + e[0] * px + e[4] * py, dy = -e[9] + e[1] * px + e[5] * py, dz = -e[10] + e[2] * px + e[6] * py;
        if (dy > -1e-3) continue;
        const t = cy / -dy;
        if (t * Math.hypot(dx, dy, dz) > lidarLook.range) continue;
        findAt(cam.position.x + dx * t, 0.02, cam.position.z + dz * t);
      }
    }
    if (dirty1 > dirty0) {
      for (const at of ["aFound", "aDelay", "aRel", "aDir"]) {
        const a = A(at);
        a.clearUpdateRanges();
        a.addUpdateRange(dirty0 * a.itemSize, (dirty1 - dirty0) * a.itemSize);
        a.needsUpdate = true;
      }
    }

    // the look
    const u = (P.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = now;
    u.uDevelop.value = L.develop;
    u.uLife.value = L.life;
    u.uScatter.value = L.scatter;
    u.uStagger.value = L.stagger;
    u.uDist.value = L.scatterDist;
    u.uRise.value = L.rise;
    u.uSize.value = L.dot * state.viewport.dpr;
    u.uRange.value = lidarLook.range;
    u.uLod.value = lidarLook.lod;
    (u.uC0.value as THREE.Color).set(lidarLook.c0);
    (u.uC1.value as THREE.Color).set(lidarLook.c1);
    (u.uC2.value as THREE.Color).set(lidarLook.c2);
    (u.uC3.value as THREE.Color).set(lidarLook.c3);
    markSpan("residue", performance.now() - t0);
  });

  return <group ref={group} />;
}
