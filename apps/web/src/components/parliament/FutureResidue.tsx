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
 * touched it outwards (`spread`), first in the colour the scan saw there, then its own — what is left pale (steel and
 * piles brightest), the plants in the night garden's colours of IMG_1586/1587 (her own palette) — and stays.
 *
 * When the observer goes (out of reach, or gone), everything found blows away: a gust sweeps through from upwind along
 * the observer's way, the plants lift and drift far like seed fluff, what is left sinks a little as dust before the wind
 * takes it, all through one swirling flow (points near one another turn together); each takes a petal's or a pollen's
 * colour as it goes and draws a thread behind it (the artist, 2026-11-27: "퍼질 때 점들이 연속적으로 이어져 보였으면",
 * "흩날림 더 자연스러워야").
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
  /** How far off the residue shows (world; it fades from about half of it, never past the lidar's reach): the far
   *  plants had piled into a glowing band along the horizon. */
  reach: number;
  /** What is left: its colour, and concrete's share of it (steel and piles full). */
  colour: string;
  concrete: number;
  /** Points of a plant cloud per square world unit of its ground. */
  plantDensity: number;
  /** THE DREAM'S COLOURS (the artist, 2026-11-27: "미래 색을 좀 더 꿈처럼 다채롭게" → A + C; "색 팔레트 내가 고를 수 있게"):
   *  her six leaf colours and five flower colours — each plant cloud and tree takes one leaf colour (a little of
   *  another in it), a meadow flowers in hers; `sat` their saturation, `flower` how many of a meadow's points flower. */
  leaves: string[];
  flowers: string[];
  sat: number;
  flower: number;
  /** The trees' crowns filled out: their points × this (leaf clumps), and the stems drawn whole ("나무는 더 풍성해보여야"). */
  treeFull: number;
  /** The points' grain, apart from the present's crisp even dots: their sizes spread (0 = even), their edge soft
   *  (0 = crisp … 1 = a soft round glow). */
  sizeVar: number;
  soft: number;
  /** C: blowing away, they take a petal's or a pollen's colour (0 = none … 1). */
  bloom: number;
  /** The blowing away: its time (s), how far (world), how long the gust takes to sweep through (s), how much the light
   *  things rise (world), how much the flow swirls (0 = straight). */
  scatter: number;
  scatterDist: number;
  stagger: number;
  rise: number;
  turb: number;
  /** THE FUTURE'S OWN LONG EXPOSURE, IN THE WORLD (the artist, 2026-11-27: "억지로 실 적용하는 건 별로고... 미래 스캔
   *  레이어에만 선택적으로 장노출" → "내가 움직이는 거 따라서는 적용되지 말고 실제로 점이 변하거나 움직일 때만"): a point that
   *  moves leaves its own smear — as wide as the dot, in its colour, along the way it really went over the last
   *  `expose` seconds (0 = none), fading towards the oldest — so a point that stands leaves nothing and the visitor's
   *  turning smears nothing. `streak`: how strong the smear is. The present's lidar never has one. */
  expose: number;
  streak: number;
}

/** The references' palettes (read off IMG_1586 — a pale night garden — and IMG_1587 — a darker one), loaded into her
 *  pickers by the knobs' buttons; the garden is the default. */
export const RESIDUE_PRESETS = {
  garden: { leaves: ["#8fb39a", "#b9b65e", "#a294d6", "#7fa58a", "#c8c97a", "#9fc3b0"], flowers: ["#f07a86", "#e3a0b6", "#f2d572", "#ff5fa2", "#b08ce0"] },
  night: { leaves: ["#3f6f4a", "#6f9a5e", "#a8c48a", "#7d8f6a", "#5a7f6f", "#c0b090"], flowers: ["#ff6a3d", "#6c63e0", "#ffb38a", "#ff4f6d", "#f5e06a"] },
} as const;

export const DEFAULT_RESIDUE: ResidueLook = {
  on: false,
  gateR: 12,
  find: 0.6,
  spread: 5,
  develop: 1.2,
  life: 0,
  dot: 2,
  reach: 14,
  colour: "#ffffff",
  concrete: 0.7,
  plantDensity: 8,
  leaves: [...RESIDUE_PRESETS.garden.leaves],
  flowers: [...RESIDUE_PRESETS.garden.flowers],
  sat: 1,
  flower: 0.5,
  treeFull: 4,
  sizeVar: 0.6,
  soft: 0.6,
  bloom: 0.8,
  scatter: 2.5,
  scatterDist: 5,
  stagger: 1.2,
  rise: 1.2,
  turb: 1,
  expose: 0.25,
  streak: 0.45,
};

/** A birch's stem, nearly white (IMG_1586/1587), and its dark marks. */
const STEM = "#e8e4dc";

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
/** A smear's ribbon: this many pieces along the way it went (it follows the swirl's curve). */
const STREAK_SEGS = 8;
/** The most smears at once (points blowing away). */
const STREAK_CAP = 40_000;
/** Readings looked at in one frame (more are sampled evenly). */
const READ_PER_FRAME = 4000;
/** The parts' grid (world): a reading looks in its own bucket only, each part in every bucket it reaches into. */
const GRID = 2.4;
/** Rays of the residue's own onto the ground a frame (finding only, never drawn). */
const GROUND_RAYS = 240;
/** How wide the gust's sweep is reckoned (world): a point this far downwind of the visitor leaves the whole sweep later. */
const SWEEP = 24;

const DB = new THREE.Vector2();

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
  /** Its blowing direction (the observer's way when it was let go), and where the visitor stood then (the sweep's
   *  middle). */
  dx: number;
  dz: number;
  ox: number;
  oz: number;
  /** When it went from the future's reading (s; 0 = it is there): it fades out instead of popping. */
  died: number;
}

/** When a point of a part let go starts to blow (s): the gust sweeps through from upwind (`stagger` for its whole
 *  width), each point a little on its own. */
function blowAt(ps: PartState, x: number, z: number, seed: number, stagger: number): number {
  const front = Math.max(0, Math.min(1, 0.5 + ((x - ps.ox) * ps.dx + (z - ps.oz) * ps.dz) / SWEEP));
  return ps.rel + stagger * (0.7 * front + 0.3 * seed);
}

/** The pool as built from one reading: the points (grouped by part) and the parts. */
interface Pool {
  n: number;
  pos: Float32Array;
  col: Float32Array;
  /** The colour a point takes as it blows away (C). */
  bloom: Float32Array;
  seed: Float32Array;
  /** 1 = a plant (light: it lifts and drifts far), 0 = what is left, a mound, the earth (dust: it sinks a little first). */
  kind: Float32Array;
  parts: { key: string; i0: number; i1: number; box: [number, number, number, number, number, number] }[];
  grid: Map<number, number[]>;
}

/** The shared half of both programs: where a point is after `rt` seconds of blowing, `k` its share of the flight. */
const BLOW_GLSL = /* glsl */ `
attribute vec2 aDir;
attribute float aSeed;
attribute float aKind;
uniform float uDist;
uniform float uRise;
uniform float uTurb;
uniform float uScatter;
vec3 blowOffset(vec3 p0, float rt, float k) {
  // the wind along the observer's way, each a little to the side
  float ang = (fract(aSeed * 7.31) - 0.5) * 0.9;
  float ca = cos(ang), sa = sin(ang);
  vec2 d = vec2(aDir.x * ca - aDir.y * sa, aDir.x * sa + aDir.y * ca);
  float light = aKind;
  float reach = uDist * (0.5 + 0.9 * fract(aSeed * 13.7)) * mix(0.75, 1.25, light);
  // a gust takes it slowly at first, then it rides the wind and loses speed (drag)
  float s = reach * (k * k * (3.0 - 2.0 * k) * 0.6 + k * 0.4);
  // light things lift and keep rising; dust sinks a little before the wind takes it up
  float up = light > 0.5 ? uRise * k * (0.7 + 0.6 * fract(aSeed * 5.3)) : uRise * (0.45 * k * k - 0.12 * sin(3.14159 * min(1.0, k * 1.6)));
  vec3 off = vec3(d.x * s, up, d.y * s);
  // one flow that turns in space and time: points near one another swirl together
  vec3 q = p0 * 0.55 + off * 0.35;
  float t = rt * 0.9;
  vec3 turb = vec3(
    sin(q.z * 1.7 + t * 1.3 + sin(q.y * 2.3 + t * 0.7)),
    0.6 * sin(q.x * 1.3 - t * 1.1 + sin(q.z * 1.9)),
    cos(q.x * 1.9 + t * 0.9 + sin(q.y * 1.4 - t * 0.5))
  );
  off += turb * uTurb * (0.25 + 0.75 * k) * k * 0.9;
  return off;
}
float flightOf(float rt) {
  // (each its own flight time, a quarter shorter or longer)
  return clamp(rt / max(0.05, uScatter * (0.75 + 0.5 * fract(aSeed * 3.7))), 0.0, 1.0);
}`;

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute vec3 aBloom;
attribute float aFound;
attribute float aDelay;
attribute float aRel;
attribute float aDie;
uniform float uTime;
uniform float uDevelop;
uniform float uLife;
uniform float uSize;
uniform float uRange;
uniform float uLod;
uniform float uReach;
uniform float uSizeVar;
uniform float uBloom;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec3 vCol;
varying float vA;
varying float vPx;
${BLOW_GLSL}
vec3 ramp(float t) {
  return t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0);
}
void main() {
  vec3 p = position;
  float a = 0.0;
  // (sizes spread, unlike the present's even dots: most small, a few large)
  float sv = fract(aSeed * 53.1);
  float px = uSize * mix(1.0, 0.55 + 1.5 * sv * sv, uSizeVar);
  vec3 col = aCol;
  if (aFound > 0.0) {
    float age = uTime - (aFound + aDelay);
    a = age < 0.0 ? 0.0 : 1.0;
    // developing: first as the scan saw it there (the lidar's colour by range from the eye), then its own
    vec4 mv0 = modelViewMatrix * vec4(p, 1.0);
    float dEye = -mv0.z;
    vec3 seen = ramp(clamp(dEye / uRange, 0.0, 1.0) * 3.0);
    col = mix(seen, aCol, uDevelop > 0.0 ? smoothstep(0.0, uDevelop, age) : 1.0);
    // far off, as sparse as the lidar's own far readings (kept with the chance (lod/d)²), and gone at the scanner's reach
    if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
    a *= 1.0 - smoothstep(uReach * 0.55, uReach, dEye);
    if (uLife > 0.0) a *= 1.0 - smoothstep(uLife * 0.7, uLife, age);
    // (gone from the future's reading: it fades in a second rather than popping)
    if (aDie > 0.0) a *= 1.0 - smoothstep(0.0, 1.0, uTime - aDie);
    // BLOWN AWAY when the observer went (aRel: when this point's gust comes)
    if (aRel > 0.0) {
      float rt = uTime - aRel;
      if (rt > 0.0) {
        float k = flightOf(rt);
        p += blowOffset(position, rt, k);
        a *= 1.0 - smoothstep(0.45, 1.0, k);
        // C: it blooms as it leaves — a petal's colour for a plant, a pale pollen for what is left — swelling a little
        // at first, then smaller as it goes
        float bl = uBloom * smoothstep(0.0, 0.3, k);
        col = mix(col, aBloom * (1.0 + 0.4 * uBloom), bl);
        px *= (1.0 + 0.6 * uBloom * sin(3.14159 * min(1.0, k * 2.5))) * (1.0 - 0.55 * k);
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
uniform float uSoft;
varying vec3 vCol;
varying float vA;
varying float vPx;
void main() {
  // a round dot: the lidar's one-pixel edge (soft 0) … a soft round glow falling off from its middle (soft 1)
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float crisp = clamp((1.0 - r) * vPx * 0.5 + 0.5, 0.0, 1.0);
  float glow = exp(-r * r * 3.0) * (1.0 - smoothstep(0.8, 1.0, r));
  float a = vA * mix(crisp, glow, uSoft);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/** THE SMEAR: a blown point's way over the last uTail seconds, as a ribbon as wide as the dot along the very path it
 *  took (each cross-section where the point was at that moment, turned to the screen), strongest at the point and
 *  fading to nothing at the oldest end. In the world: the visitor's turning moves it as it moves the rest. */
const STREAK_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aCol;
attribute vec3 aBloom;
attribute float aRel;
uniform float uTime;
uniform float uTail;
uniform float uStreak;
uniform float uBloom;
uniform float uLod;
uniform float uReach;
uniform float uSize;
uniform float uSizeVar;
uniform vec2 uRes;
varying vec3 vCol;
varying float vA;
varying float vSide;
${BLOW_GLSL}
vec4 clipAt(float rt) {
  return projectionMatrix * modelViewMatrix * vec4(aOrigin + blowOffset(aOrigin, rt, flightOf(rt)), 1.0);
}
void main() {
  // (position: x = how far back along the smear, 0 at the point … 1 at the oldest; y = which side)
  float along = position.x, side = position.y;
  float rtH = uTime - aRel;
  float rt = rtH - along * uTail;
  float rc = max(0.0, rt);
  vec4 c0 = clipAt(rc);
  // the way it goes on the screen there (a moment later), and across it
  vec4 c1 = clipAt(rc + 0.03);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  float len = length(d);
  vec2 perp = len > 1e-4 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
  float kh = flightOf(rtH), k = flightOf(rc);
  float a = rtH > 0.0 && rt > 0.0 ? uStreak * (1.0 - along) * (1.0 - smoothstep(0.45, 1.0, kh)) : 0.0;
  float dEye = c0.w;
  if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
  a *= 1.0 - smoothstep(uReach * 0.55, uReach, dEye);
  // (a little wider than the dot was then — a blur, not a thread — narrowing towards the oldest)
  float sv = fract(aSeed * 53.1);
  float px = 1.4 * uSize * mix(1.0, 0.55 + 1.5 * sv * sv, uSizeVar) * (1.0 - 0.55 * k) * (1.0 - 0.4 * along);
  vA = a;
  vSide = side;
  vCol = mix(aCol, aBloom * (1.0 + 0.4 * uBloom), uBloom * smoothstep(0.0, 0.3, k));
  gl_Position = c0 + vec4(perp * side * px / uRes * c0.w, 0.0, 0.0);
}`;
const STREAK_FRAG = /* glsl */ `
uniform float uSoft;
varying vec3 vCol;
varying float vA;
varying float vSide;
void main() {
  // soft across, as the dot is
  float s = abs(vSide);
  float a = vA * mix(1.0 - smoothstep(0.6, 1.0, s), exp(-s * s * 3.0), uSoft);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

const BLOW_UNIFORMS = () => ({ uDist: { value: 5 }, uRise: { value: 1.2 }, uTurb: { value: 1 }, uScatter: { value: 2.5 } });

/** The pool's GPU side, made the first time the residue runs (the exhibition's view never makes it). */
function makePoints(): THREE.Points {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["aCol", 3], ["aBloom", 3], ["aFound", 1], ["aDelay", 1], ["aRel", 1], ["aDir", 2], ["aSeed", 1], ["aKind", 1], ["aDie", 1]] as const)
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(CAP * size), size).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...BLOW_UNIFORMS(),
      uTime: { value: 0 },
      uDevelop: { value: 1.2 },
      uLife: { value: 0 },
      uSize: { value: 2 },
      uRange: { value: 22 },
      uLod: { value: 12 },
      uReach: { value: 14 },
      uSizeVar: { value: 0.6 },
      uBloom: { value: 0.8 },
      uSoft: { value: 0.6 },
      uC0: { value: new THREE.Color("#5ff0c8") },
      uC1: { value: new THREE.Color("#c6f06a") },
      uC2: { value: new THREE.Color("#ffb86b") },
      uC3: { value: new THREE.Color("#ff7eb0") },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // (its depth written: the photograph's pass softens it by its real distance, not as the far ground)
    depthWrite: true,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

/** The smears' GPU side: one ribbon (STREAK_SEGS pieces, both sides) drawn for every point that blows away, its origin,
 *  colours, gust time and way per instance — a ring filled as parts are let go. */
function makeStreaks(): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  const base: number[] = [], index: number[] = [];
  for (let i = 0; i <= STREAK_SEGS; i++) base.push(i / STREAK_SEGS, -1, 0, i / STREAK_SEGS, 1, 0);
  for (let i = 0; i < STREAK_SEGS; i++) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  g.setAttribute("position", new THREE.Float32BufferAttribute(base, 3));
  g.setIndex(index);
  for (const [name, size] of [["aOrigin", 3], ["aCol", 3], ["aBloom", 3], ["aRel", 1], ["aDir", 2], ["aSeed", 1], ["aKind", 1]] as const)
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(STREAK_CAP * size), size).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...BLOW_UNIFORMS(), uTime: { value: 0 }, uTail: { value: 0.8 }, uStreak: { value: 0.6 }, uBloom: { value: 0.8 }, uLod: { value: 12 }, uReach: { value: 14 }, uSize: { value: 2 }, uSizeVar: { value: 0.6 }, uSoft: { value: 0.6 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const ms = new THREE.Mesh(g, m);
  ms.frustumCulled = false;
  ms.renderOrder = 5;
  return ms;
}

/** The pool from one reading of the future: the parts' faces, the trees, the plant clouds, the mounds, the dark earth. */
function buildPool(r: PresenceResult, unit: number, look: ResidueLook): Pool {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), bloom = new Float32Array(CAP * 3), seed = new Float32Array(CAP), kind = new Float32Array(CAP);
  const parts: Pool["parts"] = [];
  let n = 0;
  const white = new THREE.Color(look.colour), stem = new THREE.Color(STEM);
  // her leaf and flower colours (A), saturated by `sat` (round their own lightness)
  const satd = (hex: string) => {
    const c = new THREE.Color(hex);
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = Math.max(0, look.sat);
    return c.setRGB(l + (c.r - l) * s, l + (c.g - l) * s, l + (c.b - l) * s);
  };
  const leaves = (look.leaves.length ? look.leaves : [...RESIDUE_PRESETS.garden.leaves]).map(satd);
  const flowers = (look.flowers.length ? look.flowers : [...RESIDUE_PRESETS.garden.flowers]).map(satd);
  // (C: what each point turns as it blows away — a petal's colour for the plants, a pale pollen of the whole palette
  // for what is left)
  const petals = flowers, pollen = [...flowers, ...leaves].map((c) => c.clone().lerp(new THREE.Color(1, 1, 1), 0.35));
  const pick = <T,>(list: T[], u: number): T => list[Math.min(list.length - 1, Math.floor(u * list.length))];
  const tmp = new THREE.Color();
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
  const add = (x: number, y: number, z: number, c: THREE.Color, k: number, s: number, bc: THREE.Color, light: number): boolean => {
    if (n >= CAP || !part) return false;
    const p = part as Pool["parts"][number];
    pos[n * 3] = x;
    pos[n * 3 + 1] = y;
    pos[n * 3 + 2] = z;
    col[n * 3] = c.r * k;
    col[n * 3 + 1] = c.g * k;
    col[n * 3 + 2] = c.b * k;
    bloom[n * 3] = bc.r;
    bloom[n * 3 + 1] = bc.g;
    bloom[n * 3 + 2] = bc.b;
    seed[n] = s;
    kind[n] = light;
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
    add(S[o], S[o + 1], S[o + 2], white, k, hash(i, cur, 37), pick(pollen, hash(i, cur, 41)), 0);
  }
  close();
  // THE TREES, one part a cell — fuller ("나무는 더 풍성해보여야"): the crown filled with leaf clumps round its own
  // points (the dappled crowns of IMG_1586/1587), the stem drawn whole from the ground to the crown
  const T = r.vegTree;
  const trees = new Map<number, number[]>();
  for (let o = 0; o + 4 < T.length; o += 5) {
    const q = Math.floor(T[o] / CELL_SIZE) * 65536 + Math.floor(T[o + 2] / CELL_SIZE);
    const l = trees.get(q);
    if (l) l.push(o);
    else trees.set(q, [o]);
  }
  const full = Math.max(1, look.treeFull);
  for (const [q, list] of trees) {
    // (a tree its own leaf colour, a little of another in it; the stem a birch's near-white)
    const crown = pick(leaves, hash(q, 17, 3)), alt = pick(leaves, hash(q, 19, 5));
    open("t");
    let cx = 0, cy = 0, cz = 0, cn = 0, sx = 0, sz = 0, sn = 0, crownLow = Infinity;
    for (const o of list) {
      const s = hash(Math.round(T[o] * 97), Math.round(T[o + 2] * 89), o);
      const isStem = T[o + 3] < 0.2, y = T[o + 1] * unit;
      const c = isStem ? stem : tmp.copy(crown).lerp(alt, 0.35 * hash(o, q, 7));
      add(T[o], y, T[o + 2], c, isStem ? 0.85 : 0.75 + 0.6 * T[o + 3], s, pick(petals, hash(o, q, 9)), 1);
      if (isStem) {
        sx += T[o];
        sz += T[o + 2];
        sn++;
      } else {
        cx += T[o];
        cy += y;
        cz += T[o + 2];
        cn++;
        crownLow = Math.min(crownLow, y);
      }
    }
    if (cn > 0 && full > 1) {
      cx /= cn;
      cy /= cn;
      cz /= cn;
      // the crown's reach from its middle
      let rx = 0.2, ry = 0.2, rz = 0.2;
      for (const o of list) {
        if (T[o + 3] < 0.2) continue;
        rx = Math.max(rx, Math.abs(T[o] - cx));
        ry = Math.max(ry, Math.abs(T[o + 1] * unit - cy));
        rz = Math.max(rz, Math.abs(T[o + 2] - cz));
      }
      // leaf clumps over the crown (most near its outside), points gathered round each
      const extra = Math.round(cn * (full - 1)), clumps = 6 + Math.floor(hash(q, 23, 1) * 8);
      for (let i = 0; i < extra; i++) {
        const cl = i % clumps;
        const ca = hash(q, cl, 29) * Math.PI * 2, cc = hash(q, cl, 31) * 2 - 1, cr = Math.pow(hash(q, cl, 37), 0.35);
        const cq = Math.sqrt(1 - cc * cc);
        const kx = cx + Math.cos(ca) * cq * cr * rx, ky = cy + cc * cr * ry * 0.85, kz = cz + Math.sin(ca) * cq * cr * rz;
        // (a clump's points: roughly a ball a third of the crown wide)
        const g1 = hash(q, i, 41) + hash(q, i, 43) + hash(q, i, 47) - 1.5, g2 = hash(q, i, 53) + hash(q, i, 59) + hash(q, i, 61) - 1.5, g3 = hash(q, i, 67) + hash(q, i, 71) + hash(q, i, 73) - 1.5;
        const sp = 0.38;
        const shade = 0.6 + 0.6 * hash(q, i, 79);
        add(kx + g1 * rx * sp, Math.max(0.1, ky + g2 * ry * sp), kz + g3 * rz * sp, tmp.copy(crown).lerp(alt, hash(q, cl, 83) * 0.6), shade, hash(q, i, 89), pick(petals, hash(i, q, 97)), 1);
      }
      // the stem whole: from the ground up into the crown, leaning a little, with a birch's dark marks
      if (sn > 0) {
        sx /= sn;
        sz /= sn;
        const top = Math.max(0.3, Math.min(cy, crownLow + ry * 0.4)), cntS = Math.round(18 + 10 * full);
        const lean = (hash(q, 101, 1) - 0.5) * 0.15;
        for (let i = 0; i < cntS; i++) {
          const u = hash(q, i, 103), y = u * top;
          const mark = hash(q, i, 107) < 0.18;
          add(sx + lean * y + (hash(q, i, 109) - 0.5) * 0.06, y, sz + lean * 0.5 * y + (hash(q, i, 113) - 0.5) * 0.06, stem, mark ? 0.35 : 0.9, hash(q, i, 127), pick(pollen, hash(i, q, 131)), 1);
        }
      }
    }
    close();
  }
  // THE PLANT CLOUDS (grass and scrub: x, z, foot, radius, height …): points in a low dome over their ground
  const PC = r.plantClouds;
  for (let o = 0; o + 11 < PC.length; o += 12) {
    const x = PC[o], z = PC[o + 1], foot = PC[o + 2] * unit, R = Math.max(0.05, PC[o + 3]), H = PC[o + 4] * unit;
    const cnt = Math.max(4, Math.min(80, Math.round(Math.PI * R * R * look.plantDensity)));
    const sx = Math.round(x * 100), sz = Math.round(z * 100);
    // (a cloud its own leaf colour, a little of a neighbour's in it; a meadow flowers by its own flower share — PC[o + 6]
    // — × 꽃 비율)
    const fam = pick(leaves, hash(sx, sz, 97)), nb = pick(leaves, hash(sz, sx, 101)), fl = Math.min(1, PC[o + 6] * look.flower * 1.6);
    open("g");
    for (let i = 0; i < cnt; i++) {
      const a = hash(sx, sz, i * 3 + 1) * Math.PI * 2, rr = R * Math.sqrt(hash(sx, sz, i * 3 + 2));
      const y = foot + 0.02 + H * (1 - (rr / R) * (rr / R)) * (0.3 + 0.7 * hash(sx, sz, i * 3 + 3));
      const flowering = hash(sx, sz, i * 7 + 5) < fl;
      const c = flowering ? pick(flowers, hash(sx, i, 103)) : tmp.copy(fam).lerp(nb, 0.3 * hash(sz, i, 107));
      add(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, c, flowering ? 1.1 : 0.75 + 0.5 * hash(sz, sx, i), hash(sx, i, sz), pick(petals, hash(i, sz, 109)), 1);
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
      add(x + Math.cos(th) * rr, 0.02 + H * (1 - u1), z + Math.sin(th) * rr, white, 0.75 + 0.2 * hash(sd, i, 3), hash(sd, i, 4), pick(pollen, hash(sd, i, 8)), 0);
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
      add(x + Math.cos(th) * rr, 0.02, z + Math.sin(th) * rr, white, 0.4, hash(sd, i, 7), pick(pollen, hash(sd, i, 9)), 0);
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
  return { n, pos, col, bloom, seed, kind, parts, grid };
}

export function FutureResidue({ log, meRef, getS, playerPosRef, getEpochMs, getWorldSec, getLive, cfg }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; getEpochMs: () => number; getWorldSec: () => number; getLive: () => boolean; cfg: FuturePresenceVisual }) {
  const group = useRef<THREE.Group>(null);
  const pts = useRef<THREE.Points | null>(null);
  const streaks = useRef<THREE.Mesh | null>(null);
  const field = useRef<{ f: DensityField; dens: DensityConfig | null; version: unknown; fed: number; drops: number } | null>(null);
  const st = useRef({ timer: 10, pool: null as Pool | null, states: new Map<string, PartState>(), tapFrame: -1, present: false, obs: null as Excavator | null, pass: null as null | { x: number; z: number; fx: number; fz: number; t0: number }, streakHead: 0, streakFilled: 0, streakUntil: 0 });
  useEffect(
    () => () => {
      for (const o of [pts.current, streaks.current]) {
        if (!o) continue;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    },
    [],
  );

  useFrame((state, dt) => {
    const on = residueActive();
    if (pts.current) pts.current.visible = on;
    if (streaks.current) streaks.current.visible = on && residueLook.expose > 0 && residueLook.streak > 0;
    if (!on) return;
    if (!pts.current && group.current) {
      pts.current = makePoints();
      streaks.current = makeStreaks();
      group.current.add(pts.current, streaks.current);
    }
    const P = pts.current, SM = streaks.current;
    if (!P || !SM) return;
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
    // LET GO: the observer went — everything held blows away its way, the gust sweeping through from upwind
    if (wasPresent && !s.present && s.pool) {
      const o = s.obs, pool = s.pool;
      let dx = o ? o.dx : 1, dz = o ? o.dz : 0;
      if (o && o.standing) {
        // (it stood: the way from the visitor to it)
        const ax = wrapDelta(o.x - me.x), az = wrapDelta(o.z - me.z), l = Math.hypot(ax, az);
        if (l > 1e-3) [dx, dz] = [ax / l, az / l];
      }
      const fPos = A("position").array as Float32Array;
      // (each point that had appeared also gets its smear: a ribbon instance with its origin, colours, gust and way)
      const SG = SM.geometry as THREE.InstancedBufferGeometry, I = (name: string) => SG.getAttribute(name) as THREE.InstancedBufferAttribute;
      const iOrig = I("aOrigin").array as Float32Array, iCol = I("aCol").array as Float32Array, iBloom = I("aBloom").array as Float32Array, iRel = I("aRel").array as Float32Array, iDir = I("aDir").array as Float32Array, iSeed = I("aSeed").array as Float32Array, iKind = I("aKind").array as Float32Array;
      const smear = L.expose > 0 && L.streak > 0;
      let wrote = 0;
      pool.parts.forEach((p) => {
        const ps = s.states.get(p.key);
        if (!ps || ps.found <= 0 || ps.rel > 0 || ps.died > 0) return;
        if (L.life > 0 && now - ps.found > L.life) return;
        Object.assign(ps, { rel: now, dx, dz, ox: me.x, oz: me.z });
        for (let i = p.i0; i < p.i1; i++) {
          fRel[i] = blowAt(ps, fPos[i * 3], fPos[i * 3 + 2], pool.seed[i], L.stagger);
          fDir[i * 2] = dx;
          fDir[i * 2 + 1] = dz;
          if (!smear || ps.found + fDelay[i] > now || wrote >= STREAK_CAP) continue;
          const j = s.streakHead;
          iOrig.set(pool.pos.subarray(i * 3, i * 3 + 3), j * 3);
          iCol.set(pool.col.subarray(i * 3, i * 3 + 3), j * 3);
          iBloom.set(pool.bloom.subarray(i * 3, i * 3 + 3), j * 3);
          iRel[j] = fRel[i];
          iDir[j * 2] = dx;
          iDir[j * 2 + 1] = dz;
          iSeed[j] = pool.seed[i];
          iKind[j] = pool.kind[i];
          s.streakHead = (s.streakHead + 1) % STREAK_CAP;
          s.streakFilled = Math.min(STREAK_CAP, s.streakFilled + 1);
          wrote++;
        }
        dirty0 = Math.min(dirty0, p.i0);
        dirty1 = Math.max(dirty1, p.i1);
      });
      if (wrote) {
        for (const name of ["aOrigin", "aCol", "aBloom", "aRel", "aDir", "aSeed", "aKind"]) I(name).needsUpdate = true;
        SG.instanceCount = s.streakFilled;
        // (when every smear of this release has run out, the ribbons are not drawn at all)
        s.streakUntil = now + L.stagger + L.scatter * 1.25 + L.expose + 0.5;
      }
    }
    // (nothing blowing: no ribbons to draw)
    if (s.streakFilled > 0 && now > s.streakUntil) {
      s.streakFilled = 0;
      s.streakHead = 0;
      (SM.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
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
      const pool = buildPool(r, cfg.unit, L);
      // (what was found and has left the reading: carried over to fade, or to finish blowing away)
      const old = s.pool;
      const keys = new Set(pool.parts.map((p) => p.key));
      // (one that had faded out and is back in the reading is new: it waits to be found again)
      for (const k of keys) if ((s.states.get(k)?.died ?? 0) > 0) s.states.delete(k);
      const gone = L.scatter * 1.25 + L.stagger + 0.5;
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
          pool.bloom.set(old.bloom.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.seed.set(old.seed.subarray(p.i0, p.i1), i0);
          pool.kind.set(old.kind.subarray(p.i0, p.i1), i0);
          pool.n += p.i1 - p.i0;
          pool.parts.push({ key: p.key, i0, i1: pool.n, box: p.box });
          keys.add(p.key);
        }
      // (the states of parts long gone or long blown away are forgotten: they may be found again)
      for (const [k, ps] of s.states) {
        if (!keys.has(k) || (ps.rel > 0 && now - ps.rel > gone)) s.states.delete(k);
      }
      // the GPU side anew: positions, colours, seeds, kinds, and what each part has been through
      const fPos = A("position").array as Float32Array, fDie = A("aDie").array as Float32Array;
      fPos.set(pool.pos.subarray(0, pool.n * 3));
      (A("aCol").array as Float32Array).set(pool.col.subarray(0, pool.n * 3));
      (A("aBloom").array as Float32Array).set(pool.bloom.subarray(0, pool.n * 3));
      (A("aSeed").array as Float32Array).set(pool.seed.subarray(0, pool.n));
      (A("aKind").array as Float32Array).set(pool.kind.subarray(0, pool.n));
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
          fDelay[i] = Math.hypot(fPos[i * 3] - ps.hx, fPos[i * 3 + 1] - ps.hy, fPos[i * 3 + 2] - ps.hz) / Math.max(0.1, L.spread) + 0.08 * pool.seed[i];
          fRel[i] = ps.rel > 0 ? blowAt(ps, fPos[i * 3], fPos[i * 3 + 2], pool.seed[i], L.stagger) : 0;
          fDir[i * 2] = ps.dx;
          fDir[i * 2 + 1] = ps.dz;
          fDie[i] = ps.died;
        }
      }
      // (the buckets were made from the new parts only; the carried ones cannot be found again)
      s.pool = pool;
      for (const at of ["position", "aCol", "aBloom", "aSeed", "aKind", "aDie", "aFound", "aDelay", "aRel", "aDir"]) {
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
            ps = { found: 0, rel: 0, hx: 0, hy: 0, hz: 0, dx: 1, dz: 0, ox: 0, oz: 0, died: 0 };
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
        if (t * Math.hypot(dx, dy, dz) > Math.min(L.reach, lidarLook.range)) continue;
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
    const u = (P.material as THREE.ShaderMaterial).uniforms, su = (SM.material as THREE.ShaderMaterial).uniforms;
    for (const w of [u, su]) {
      w.uTime.value = now;
      w.uScatter.value = L.scatter;
      w.uDist.value = L.scatterDist;
      w.uRise.value = L.rise;
      w.uTurb.value = L.turb;
      w.uBloom.value = L.bloom;
      w.uLod.value = lidarLook.lod;
      w.uReach.value = Math.min(L.reach, lidarLook.range);
      w.uSizeVar.value = L.sizeVar;
      w.uSoft.value = L.soft;
      w.uSize.value = L.dot * state.viewport.dpr * (1 + 0.6 * L.soft);
    }
    su.uTail.value = L.expose;
    su.uStreak.value = L.streak;
    state.gl.getDrawingBufferSize(DB);
    (su.uRes.value as THREE.Vector2).copy(DB);
    u.uRange.value = lidarLook.range;
    u.uDevelop.value = L.develop;
    u.uLife.value = L.life;
    (u.uC0.value as THREE.Color).set(lidarLook.c0);
    (u.uC1.value as THREE.Color).set(lidarLook.c1);
    (u.uC2.value as THREE.Color).set(lidarLook.c2);
    (u.uC3.value as THREE.Color).set(lidarLook.c3);
    markSpan("residue", performance.now() - t0);
  });

  return <group ref={group} />;
}
