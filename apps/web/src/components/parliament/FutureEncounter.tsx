"use client";
/**
 * FutureEncounter — THE FUTURE PASSES WHERE THE VISITOR STANDS (the artist, 2026-11-22: "미래에서는 늘 고고학 봇 6-7개
 * 정도가 돌아다니고 … 걔들이랑 xy 좌표가 일정 범위 내로 겹칠 때 '미래가 당신을 응시합니다...' 혹은 '미래가 당신의 삶을
 * 발견했습니다' 등의 안내멘트 로그와 함께 그 인근 미래의 모습을 pointcloud 로 보여줬다가 쏴아 사라져서 잔상처럼").
 *
 * The future's archaeologists (lib/parliament/excavators.ts) walk the layer's ground, unseen. When one crosses where
 * the visitor stands, the future round the visitor is read once (lib/parliament/futurePresence.ts — what of the
 * buildings is left, the mounds and dark earth, the plants that took it, the visitor's own cells) and shown as a point
 * cloud: it gathers out of nothing from the visitor outwards, holds while the archaeologist is there, and streams away
 * the way it walks — then nothing is left of it but the line in the record. "Found" when the visitor's life is in that
 * ground (they stayed there: their own cells), "looked at" when it is not.
 *
 * One draw call (the points) and a line; the reading only at an encounter (≈ 5 – 40 ms once). Its knobs: the
 * personal view's folder 미래 (개인뷰 · 시험), mode 마주침.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, nearestImage, wrapDist, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { excavatorsAt } from "@/lib/parliament/excavators";
import { futurePresence, waterDistance } from "@/lib/parliament/futurePresence";
import { FutureFrames } from "./futureFrames";
import { FutureWindows } from "./futureWindows";
import { paperLook } from "./paperLook";
import { playFuturePassing } from "./futureSound";
import type { SoundSetup } from "./useSound";
import { CELL_SIZE } from "@/lib/stratum/field";
import type { FuturePresenceVisual } from "./FuturePresence";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";

/** The last encounter, for the record (RoleField puts it on the observation; witness.ts writes its line once); and
 *  whether the present is to be dark now (the future holds — RoleField hides its drawing). */
export const futureMeet: { last: { id: string; found: boolean } | null; dark: boolean } = { last: null, dark: false };
/** THE SCAN HOLDS THE VISITOR STILL (the artist, 2026-11-22: "나는 가만히 있고 풍경이 닥쳐오듯"): while `on`, the
 *  Controller (ParliamentScene.tsx) does not move the visitor — it leaves here the velocity their walking would have had,
 *  and the scanned future flows to them by it instead (their turning still turns). */
export const futureHold = { on: false, vx: 0, vz: 0 };

/** The wall's density rule as the artist had it (2026-11-20) — until the server's hello says its own. */
const FALLBACK_DENSITY: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: NO_PATHS }, slotSec: 20, gapSec: 20, maxBuilt: 8000, mergeGap: 3, mergeThick: 2, liveAt: 0.25, minVisitors: 4, step: 40, maxLevel: 6, ratio: 3, massRatio: 1.45, visitorCap: 60, radius: 2.75, timeSec: 60, down: 0.5 };
const FEED_PER_FRAME = 150;
const CAP = 90000;
/** How near (world) one's own cells must be for the future to have found one's life. */
const FOUND_NEAR = 5;

/** A number 0 … 1 of three integers — a full integer hash (lowbias32): the quicker one before it drew diagonal lines
 *  through the dream's ground, a pattern where a scan has none. */
const hash = (a: number, b: number, c: number) => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x5bd1e995, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const VERT = `
attribute vec3 color;
attribute vec4 aSeed;
attribute float aSize;
uniform float uT, uIn, uOutAt, uOut, uSize, uScale;
uniform vec2 uDir;
uniform vec3 uOrigin;
varying vec3 vColor;
varying float vA;
void main() {
  float d = length(position.xz - uOrigin.xz);
  // gathers out of nothing, the nearest first
  float tin = clamp((uT - d * 0.045) / uIn, 0.0, 1.0);
  float gin = 1.0 - pow(1.0 - tin, 3.0);
  vec3 p = position + (aSeed.xyz * 3.5 + vec3(0.0, 2.0, 0.0)) * (1.0 - gin);
  // a scanned thing's tremor while it holds
  p += aSeed.xyz * 0.025 * sin(uT * 2.3 + aSeed.w * 40.0);
  // streams away the way the archaeologist walks, each point at its own moment
  float tout = clamp((uT - uOutAt - aSeed.w * 0.7 - d * 0.03) / uOut, 0.0, 1.0);
  float go = tout * tout;
  p += vec3(uDir.x, 0.0, uDir.y) * go * (4.0 + 6.0 * aSeed.w) + vec3(0.0, go * (1.5 + 2.5 * aSeed.w), 0.0) + aSeed.xyz * go * 1.5;
  vA = gin * (1.0 - tout);
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * aSize * uScale / max(0.1, -mv.z) * (1.0 - 0.5 * go));
}`;
const FRAG = `
varying vec3 vColor;
varying float vA;
void main() {
  if (vA < 0.01) discard;
  gl_FragColor = vec4(vColor, vA);
}`;

/**
 * THE DREAM (FuturePresenceVisual.dream — the reference study of 2026-11-22): five details, all in the vertex shader.
 * ① the points are the future's surfaces sampled (finer, and thinner with distance: on the CPU, once an encounter);
 * ② they drift, breathing in a slow noise, and smear along the way the archaeologist walks as they go;
 * ③ soft round points of many sizes, blurred and fainter near and far (a bokeh without a depth-of-field pass), added
 *    lightly, their pixel size capped;
 * ④ a RAGGED WINDOW: what is shown is cut by a 3D noise threshold round the meeting, not by a circle;
 * ⑤ they come and go POINT BY POINT — each its own threshold against a density that rises and falls (where the
 *    visitor's own cells are the threshold is lower: they come first and stay longest).
 * No full-screen pass; the present stays under it.
 */
const DREAM_VERT = `
attribute vec3 color;
attribute vec4 aSeed;
attribute float aSize;
uniform float uT, uIn, uOutAt, uOut, uSize, uScale, uR, uMaxPx;
uniform vec2 uDir;
uniform vec3 uOrigin;
varying vec3 vColor;
varying float vA;
varying float vBlur;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 p = position;
  float d = length(p.xz - uOrigin.xz);
  // ④ the ragged window
  float edge = n3(p * 0.35 + vec3(0.0, uT * 0.05, 0.0)) * 0.55 + n3(p * 1.3) * 0.2;
  float win = 1.0 - d / uR + edge - 0.35;
  // ⑤ point by point
  float dens = smoothstep(0.0, uIn, uT) * (1.0 - smoothstep(uOutAt, uOutAt + uOut, uT));
  float keep = step(aSeed.w, dens * clamp(win * 3.0, 0.0, 1.0));
  // ② the place stands; only its ragged edge breathes — and as it goes, a short sweep the way the archaeologist walks
  // (the artist, 2026-11-22, of the first dream: "그게 풍경으로 보여야 하는데 지금은 그냥 비주얼 이펙트 같아")
  float t = uT * 0.6;
  float rim = 1.0 - clamp(win * 3.0, 0.0, 1.0);
  vec3 drift = vec3(n3(p * 0.5 + vec3(t, 0.0, 0.0)) - 0.5, n3(p * 0.5 + vec3(0.0, t, 7.0)) - 0.5, n3(p * 0.5 + vec3(3.0, 0.0, t)) - 0.5) * (0.03 + 0.3 * rim);
  float go = smoothstep(uOutAt, uOutAt + uOut, uT);
  p += drift + vec3(uDir.x, 0.0, uDir.y) * go * (0.3 + 1.0 * aSeed.w);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.1, -mv.z);
  // ③ small crisp points; blurred only far off
  float blur = smoothstep(uR * 2.5, uR * 5.0, z);
  vBlur = blur;
  vA = keep * (0.55 + 0.45 * clamp(win * 2.0, 0.0, 1.0)) * (1.0 - 0.5 * vBlur);
  vColor = color;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * aSize * clamp(8.0 / z, 0.6, 1.4) * (1.0 + 1.5 * vBlur) * (1.0 - 0.3 * go), 1.0, uMaxPx);
}`;
const DREAM_FRAG = `
varying vec3 vColor;
varying float vA;
varying float vBlur;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = vA * mix(1.0, exp(-r * 3.0), vBlur) * 0.9;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}`;
/**
 * THE SCAN (FuturePresenceVisual.scan — the artist, 2026-11-22: "둘러볼 때마다 생성되는 2d 프레임을 점으로 렌더해서 쌓고
 * 그 잔흔이 합쳐져서 … 홀로그래픽 하도록", and of her TouchDesigner work: "변화량이나 이런 거 감지해서 포인트 거리 정하게
 * 하는 방식" — the change in a frame sets how far apart its points are).
 *
 * The place (the dream's sampling, not drawn) is taken as a small frame from the eye each time one looks round: every
 * pixel the nearest surface's position and its tone (SCAN_CAPTURE_*, into one slot of an atlas of frames). Every pixel of
 * every frame kept is a point (SCAN_*, one draw call, the positions read from the atlas by gl_VertexID): a frame keeps its
 * points where it CHANGES — an outline or an edge in it (the second difference of its positions, against a pixel's
 * footprint), or what the frame before it did not see there — and only a few where it is flat. The frames stack, the older
 * fainter, added light: where one looked long and from many sides the residue is dense and bright, where one never
 * looked there is nothing. As it goes the oldest residues leave first.
 */
const SCAN_MAX = 48;
const SCAN_COLS = 8;
const SCAN_CAPTURE_VERT = `
attribute vec3 color;
attribute vec4 aSeed;
uniform float uScale, uSplat, uR;
uniform vec3 uOrigin, uShift;
varying vec3 vC;
varying float vKind;
varying float vLum;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 p = position;
  // (the place's ragged edge, as the dream's window)
  float win = 1.0 - length(p.xz - uOrigin.xz) / uR + n3(p * 0.35) * 0.55 + n3(p * 1.3) * 0.2 - 0.35;
  // (where the place is now: it rushes in, and flows to the visitor as they walk — uShift)
  vC = p + uShift;
  vKind = aSeed.y;
  vLum = clamp(dot(color, vec3(0.3333)), 0.0, 0.99);
  vec4 mv = modelViewMatrix * vec4(vC, 1.0);
  gl_Position = win < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  // (big enough for the level a ground sample lies on, seen low; the fragments outside it are dropped)
  gl_PointSize = clamp(2.6 * uSplat * uScale / max(0.1, -mv.z), 1.5, 24.0);
}`;
/** A frame's pixel is where the eye's ray meets the surface — not the centre of the sample that covered it: the ground
 *  and what lies on it (kinds 0, 4, 5, 6) as a level at the sample's height, the rest (remains, plants, trees) as a small
 *  disc facing the eye. So a flat ground reads flat (its change is nothing), and only outlines, edges and the plants'
 *  tangle read as change. */
const SCAN_CAPTURE_FRAG = `
uniform mat4 uInvVP, uVP;
uniform vec4 uView;
uniform vec3 uCamPos, uOrigin, uShift;
uniform float uSplat;
varying vec3 vC;
varying float vKind;
varying float vLum;
void main() {
  vec2 ndc = (gl_FragCoord.xy - uView.xy) / uView.zw * 2.0 - 1.0;
  vec4 far = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  bool level = vKind < 0.5 || vKind > 3.5;
  vec3 P;
  if (level) {
    if (abs(dir.y) < 1e-4) discard;
    float t = (vC.y - uCamPos.y) / dir.y;
    if (t <= 0.0) discard;
    P = uCamPos + dir * t;
    if (length(P.xz - vC.xz) > uSplat * 1.2) discard;
  } else {
    P = uCamPos + dir * length(vC - uCamPos);
    if (length(P - vC) > uSplat * 0.6) discard;
  }
  vec4 clip = uVP * vec4(P, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  // what it is: 0 ground and remains, 1 plants and trees, 2 the visitor's own cells
  float cls = vKind > 5.5 ? 2.0 : (vKind > 1.5 && vKind < 3.5) ? 1.0 : 0.0;
  // (kept in the place's own frame, so what was taken moves with the place)
  gl_FragColor = vec4(P - uOrigin - uShift, 1.0 + cls * 2.0 + vLum);
}`;
const SCAN_VERT = `
uniform sampler2D uAtlas;
uniform vec2 uFrame, uAtlasSize, uDir;
uniform float uCols, uK, uNewest, uCount, uT, uIn, uOutAt, uOut, uBase, uGain, uNew, uPx, uGlow, uPixAng;
uniform float uSeed[${SCAN_MAX}];
uniform vec3 uOrigin, uCam, uPlant, uShift;
varying vec3 vColor;
varying float vA;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(uint v) { return float(pcg(v)) / 4294967295.0; }
vec4 at(float slot, vec2 px) {
  px = clamp(px, vec2(0.0), uFrame - 1.0);
  vec2 o = vec2(mod(slot, uCols), floor(slot / uCols)) * uFrame;
  return texture2D(uAtlas, (o + px + 0.5) / uAtlasSize);
}
float clsOf(vec4 t) { return floor((t.w - 1.0) * 0.5); }
void main() {
  vA = 0.0;
  vColor = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  int W = int(uFrame.x);
  int per = W * int(uFrame.y);
  int si = gl_VertexID / per;
  int pix = gl_VertexID - si * per;
  float slot = float(si);
  float age = mod(uNewest - slot + uK, uK);
  if (age >= uCount) return;
  vec2 px = vec2(float(pix % W), float(pix / W));
  vec4 c = at(slot, px);
  if (c.w < 0.5) return;
  vec3 P = c.xyz + uOrigin + uShift;
  float foot = max(0.3, length(P - uCam)) * uPixAng;
  float cls = clsOf(c), lum = c.w - 1.0 - cls * 2.0;
  // THE CHANGE IN THE FRAME: an outline (a neighbour empty or of another kind), an edge (the second difference of the
  // positions — zero on any flat surface, however tilted), a change of tone
  vec4 l = at(slot, px - vec2(1.0, 0.0)), r = at(slot, px + vec2(1.0, 0.0)), d = at(slot, px - vec2(0.0, 1.0)), u = at(slot, px + vec2(0.0, 1.0));
  float sp = 1.0;
  if (l.w > 0.5 && r.w > 0.5 && d.w > 0.5 && u.w > 0.5 && clsOf(r) == cls && clsOf(u) == cls) {
    sp = (length(l.xyz + r.xyz - 2.0 * c.xyz) + length(d.xyz + u.xyz - 2.0 * c.xyz)) / (foot * 4.0);
    sp = max(sp, (abs(r.w - c.w) + abs(u.w - c.w)) * 2.0);
  }
  sp = clamp(sp, 0.0, 1.0);
  // THE CHANGE SINCE THE FRAME BEFORE: what it did not see at that pixel (one turned, or walked)
  float tm = 1.0;
  if (age + 1.0 < uCount) {
    vec4 pv = at(mod(slot - 1.0 + uK, uK), px);
    tm = pv.w < 0.5 ? 1.0 : clamp(length(pv.xyz - c.xyz) / (foot * 3.0), 0.0, 1.0);
  }
  float change = clamp(sp * uGain + tm * uNew, 0.0, 1.0);
  uint id = uint(gl_VertexID) ^ floatBitsToUint(uSeed[si]);
  if (rnd(id) > uBase + (1.0 - uBase) * change) return;
  float h2 = rnd(id * 3u + 1u);
  // (a scan's light, not the surface's paint: the tones lifted, the plants' green at full)
  float lit = 0.5 + 0.5 * lum;
  vColor = cls > 1.5 ? vec3(1.0, 0.97, 0.92) : cls > 0.5 ? uPlant / max(0.05, max(uPlant.r, max(uPlant.g, uPlant.b))) * lit * 0.9 : vec3(lit);
  // it comes as it is looked at; it goes, the oldest residues first, a short sweep the way the archaeologist walks
  float env = smoothstep(0.0, uIn, uT);
  float st = uOutAt + (1.0 - age / uK) * uOut * 0.4;
  float go = smoothstep(st, st + uOut * 0.6, uT);
  P += vec3(uDir.x, 0.0, uDir.y) * go * (0.4 + 1.6 * h2) + vec3(0.0, go * h2 * 0.8, 0.0);
  vA = uGlow * env * (1.0 - go) * (1.0 - 0.7 * age / max(1.0, uK - 1.0)) * (0.6 + 0.8 * sp);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * (0.8 + 0.6 * sp) * clamp(6.0 / max(0.1, -mv.z), 0.7, 1.5), 1.0, 6.0);
}`;
const SCAN_FRAG = `
varying vec3 vColor;
varying float vA;
void main() {
  if (vA < 0.003) discard;
  gl_FragColor = vec4(vColor, vA);
}`;
/** The low-discrepancy jitter of a frame (a pixel's fraction): frames from one standing fill in between each other. */
const halton = (i: number, b: number) => {
  let f = 1, r = 0;
  for (let n = i; n > 0; n = Math.floor(n / b)) {
    f /= b;
    r += f * (n % b);
  }
  return r;
};
const tmpDir = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const clearTmp = new THREE.Color();
const tmpFrustum = new THREE.Frustum();
const tmpMat = new THREE.Matrix4();
const tmpSphere = new THREE.Sphere();
const isCoarse = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;

export function FutureEncounter({ log, meRef, getS, getWorldSec, getEpochMs, getLive, playerPosRef, cfg, sound = null, getYaw }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; getWorldSec: () => number; getEpochMs: () => number; getLive: () => boolean; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; cfg: FuturePresenceVisual; sound?: SoundSetup | null; getYaw?: () => number }) {
  const field = useRef<{ f: DensityField; key: string; fed: number; drops: number } | null>(null);
  // (the scan's place: where it came from (arrive: a direction × a distance), how far the visitor's walking has drawn it
  // (flow), and where it is now (shift = the two))
  const st = useRef({ active: false, t0: 0, ex: -1, cool: new Map<number, number>(), outAt: 0, scan: false, frames: false, windows: false, readAt: 0, seed: 0, arrive: new THREE.Vector3(), flow: new THREE.Vector3(), shift: new THREE.Vector3() });
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(CAP * 4), 4));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(CAP), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // (uR and uMaxPx are the dream's; set on both materials alike)
        uniforms: { uT: { value: 0 }, uIn: { value: 1 }, uOutAt: { value: 3 }, uOut: { value: 1.8 }, uSize: { value: 0.07 }, uScale: { value: 400 }, uDir: { value: new THREE.Vector2(1, 0) }, uOrigin: { value: new THREE.Vector3() }, uR: { value: 12 }, uMaxPx: { value: 28 } },
      }),
    [],
  );
  const dreamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DREAM_VERT,
        fragmentShader: DREAM_FRAG,
        transparent: true,
        depthWrite: false,
        // (ordinary transparency: the first dream's added light read as an effect)
        uniforms: { uT: { value: 0 }, uIn: { value: 1 }, uOutAt: { value: 3 }, uOut: { value: 1.8 }, uSize: { value: 0.07 }, uScale: { value: 400 }, uDir: { value: new THREE.Vector2(1, 0) }, uOrigin: { value: new THREE.Vector3() }, uR: { value: 12 }, uMaxPx: { value: 28 } },
      }),
    [],
  );
  // THE ARCHAEOLOGIST, while it is there: a thin white line standing on the ground where it walks
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, fog: false, depthWrite: false }), []);
  const points = useRef<THREE.Points>(null);
  // THE SCAN: the frames (one atlas, a slot each), the place as it is taken into them (the cloud above, not drawn), the
  // points they make
  const scan = useRef({ rt: null as THREE.WebGLRenderTarget | null, W: 0, H: 0, K: 0, count: 0, newest: -1, n: 0, lastAt: -Infinity, dir: new THREE.Vector3(), pos: new THREE.Vector3(), ms: 0 });
  const scanCam = useMemo(() => new THREE.PerspectiveCamera(), []);
  const captureMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: SCAN_CAPTURE_VERT, fragmentShader: SCAN_CAPTURE_FRAG, uniforms: { uScale: { value: 100 }, uSplat: { value: 0.14 }, uR: { value: 9 }, uOrigin: { value: new THREE.Vector3() }, uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uView: { value: new THREE.Vector4() }, uCamPos: { value: new THREE.Vector3() }, uShift: { value: new THREE.Vector3() } } }), []);
  const captureScene = useMemo(() => {
    const sc = new THREE.Scene();
    const pts = new THREE.Points(geom, captureMat);
    pts.frustumCulled = false;
    sc.add(pts);
    return sc;
  }, [geom, captureMat]);
  const scanMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SCAN_VERT,
        fragmentShader: SCAN_FRAG,
        transparent: true,
        depthWrite: false,
        // (added light: where the frames overlap, the residue is brighter)
        blending: THREE.AdditiveBlending,
        uniforms: { uAtlas: { value: null }, uFrame: { value: new THREE.Vector2(1, 1) }, uAtlasSize: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2(1, 0) }, uCols: { value: SCAN_COLS }, uK: { value: 1 }, uNewest: { value: 0 }, uCount: { value: 0 }, uT: { value: 0 }, uIn: { value: 1 }, uOutAt: { value: 10 }, uOut: { value: 2.7 }, uBase: { value: 0.12 }, uGain: { value: 2.5 }, uNew: { value: 0.8 }, uPx: { value: 1.6 }, uGlow: { value: 0.3 }, uPixAng: { value: 0.01 }, uSeed: { value: new Float32Array(SCAN_MAX) }, uOrigin: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uPlant: { value: new THREE.Color() }, uShift: { value: new THREE.Vector3() } },
      }),
    [],
  );
  const scanPoints = useMemo(() => {
    const g0 = new THREE.BufferGeometry();
    g0.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const pts = new THREE.Points(g0, scanMat);
    pts.frustumCulled = false;
    pts.visible = false;
    return pts;
  }, [scanMat]);
  useEffect(
    () => () => {
      scan.current.rt?.dispose();
      scan.current.rt = null;
      scanPoints.geometry.dispose();
      scanMat.dispose();
      captureMat.dispose();
    },
    [scanPoints, scanMat, captureMat],
  );
  // THE FRAMES (futureFrames.ts): the place taken from the eye as pictures, each a translucent plate that comes
  const frames = useMemo(() => new FutureFrames(geom), [geom]);
  const framesKey = useRef("");
  /** ?paper=1 — the trial's white ground (until the street look's is here): a white sky, and the present (still drawn for
   *  the black ground) put away while the frames stand, so they are seen as they will be on paper. A trial's hook only. */
  const paperTrial = useRef(false);
  useEffect(() => () => frames.dispose(), [frames]);
  // THE WINDOWS (futureWindows.ts): the observer a large window onto the future, windows left where it passed, the screen
  // filled when the visitor is near one
  const windows = useMemo(() => new FutureWindows(geom), [geom]);
  const windowsKey = useRef("");
  useEffect(() => () => windows.dispose(), [windows]);
  useEffect(() => {
    futureMeet.last = null;
    futureMeet.dark = false;
    futureHold.on = false;
    return () => {
      futureMeet.last = null;
      futureMeet.dark = false;
      futureHold.on = false;
      geom.dispose();
      mat.dispose();
      dreamMat.dispose();
      line.dispose();
      lineMat.dispose();
    };
  }, [geom, mat, dreamMat, line, lineMat]);

  /** One look, taken: the place from the eye into the next slot of the atlas (a pixel's jitter of its own). */
  const capture = (gl: THREE.WebGLRenderer, cam: THREE.Camera, now: number) => {
    const sc = scan.current;
    if (!sc.rt) return;
    const t0 = performance.now();
    sc.n++;
    sc.newest = (sc.newest + 1) % sc.K;
    sc.count = Math.min(sc.K, sc.count + 1);
    const x = (sc.newest % SCAN_COLS) * sc.W, y = Math.floor(sc.newest / SCAN_COLS) * sc.H;
    sc.rt.viewport.set(x, y, sc.W, sc.H);
    sc.rt.scissor.set(x, y, sc.W, sc.H);
    sc.rt.scissorTest = true;
    const pc = cam as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) scanCam.copy(pc, false);
    scanCam.matrixAutoUpdate = false;
    scanCam.matrixWorldAutoUpdate = false;
    scanCam.matrixWorld.copy(cam.matrixWorld);
    scanCam.matrixWorldInverse.copy(cam.matrixWorldInverse);
    scanCam.projectionMatrix.copy(cam.projectionMatrix);
    const e = scanCam.projectionMatrix.elements;
    e[8] += ((halton(sc.n, 2) - 0.5) * 2) / sc.W;
    e[9] += ((halton(sc.n, 3) - 0.5) * 2) / sc.H;
    scanCam.projectionMatrixInverse.copy(scanCam.projectionMatrix).invert();
    const tanH = Math.tan(THREE.MathUtils.degToRad(pc.isPerspectiveCamera ? pc.fov : 60) / 2);
    captureMat.uniforms.uScale.value = sc.H / 2 / tanH;
    captureMat.uniforms.uSplat.value = cfg.scanSplat;
    const CU = captureMat.uniforms;
    CU.uVP.value.multiplyMatrices(scanCam.projectionMatrix, scanCam.matrixWorldInverse);
    CU.uInvVP.value.copy(CU.uVP.value).invert();
    CU.uView.value.set(x, y, sc.W, sc.H);
    CU.uCamPos.value.setFromMatrixPosition(scanCam.matrixWorld);
    scanMat.uniforms.uPixAng.value = (2 * tanH) / sc.H;
    const prev = gl.getRenderTarget(), prevAuto = gl.autoClear, prevA = gl.getClearAlpha();
    gl.getClearColor(clearTmp);
    gl.setRenderTarget(sc.rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    gl.autoClear = false;
    gl.render(captureScene, scanCam);
    gl.autoClear = prevAuto;
    gl.setClearColor(clearTmp, prevA);
    gl.setRenderTarget(prev);
    (scanMat.uniforms.uSeed.value as Float32Array)[sc.newest] = sc.n * 0.6180339 + 0.25;
    scanMat.uniforms.uNewest.value = sc.newest;
    scanMat.uniforms.uCount.value = sc.count;
    cam.getWorldDirection(sc.dir);
    cam.getWorldPosition(sc.pos).sub(st.current.shift);
    sc.lastAt = now;
    sc.ms = performance.now() - t0;
    markSpan("future-scan", sc.ms);
    (window as unknown as { __futureScan?: unknown }).__futureScan = { n: sc.n, count: sc.count, W: sc.W, H: sc.H, K: sc.K, ms: Math.round(sc.ms * 100) / 100, t: Math.round((now - st.current.t0) * 10) / 10, outAt: Math.round(st.current.outAt * 10) / 10, dark: futureMeet.dark, held: futureHold.on, shift: st.current.shift.toArray().map((q) => Math.round(q * 10) / 10) };
  };

  /** THE ATLAS of a look round: as many points a frame as asked, of the screen's shape; a phone half, 16 frames. Made
   *  (and put on the GPU) before the first encounter — made at the encounter it stalled the first frame by up to 90 ms. */
  const ensureAtlas = (gl: THREE.WebGLRenderer, phone: boolean) => {
    const sc = scan.current, U = scanMat.uniforms;
    const el = gl.domElement, aspect = Math.max(0.2, el.width / Math.max(1, el.height));
    const per = Math.max(2000, cfg.scanPix * 1000 * (phone ? 0.5 : 1));
    const W = Math.max(16, Math.round(Math.sqrt(per * aspect))), H = Math.max(16, Math.round(per / W));
    const K = Math.max(2, Math.min(SCAN_MAX, phone ? Math.min(16, cfg.scanFrames) : cfg.scanFrames));
    if (!sc.rt || sc.W !== W || sc.H !== H || sc.K !== K) {
      sc.rt?.dispose();
      const rows = Math.ceil(K / SCAN_COLS);
      sc.rt = new THREE.WebGLRenderTarget(W * SCAN_COLS, H * rows, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
      Object.assign(sc, { W, H, K });
      scanPoints.geometry.dispose();
      // (one vertex a pixel of a frame; its place is read from the atlas by its index)
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(W * H * K), 1));
      // (the vertices hold no place of their own; a sphere big enough so three.js does not measure them)
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      scanPoints.geometry = g;
      U.uAtlas.value = sc.rt.texture;
      U.uFrame.value.set(W, H);
      U.uAtlasSize.value.set(W * SCAN_COLS, H * rows);
      U.uK.value = K;
      gl.initRenderTarget(sc.rt);
    }
  };
  const compiled = useRef(false);
  useFrame((state, delta) => {
    // (the scan's two programs made before the first encounter: their compile stalled the first look by half a second)
    if (!compiled.current) {
      compiled.current = true;
      const tmp = new THREE.Scene();
      tmp.add(new THREE.Points(scanPoints.geometry, scanMat));
      state.gl.compile(tmp, state.camera);
      state.gl.compile(captureScene, state.camera);
      if (cfg.scan) ensureAtlas(state.gl, isCoarse());
      // (a trial's hook until the street look's white ground is here: ?paper=1 = the view on paper)
      if (new URLSearchParams(window.location.search).get("paper") === "1") {
        paperTrial.current = true;
        paperLook.on = true;
        state.scene.background = new THREE.Color(paperLook.paper);
      }
    }
    // (the frames' plates and programs made before the first encounter, and again when their number or size changes)
    if (cfg.frames) {
      const fk = `${isCoarse()}:${cfg.frameMax}`;
      if (framesKey.current !== fk) {
        framesKey.current = fk;
        frames.ensure(state.gl, isCoarse(), cfg);
        frames.compile(state.gl, state.camera);
      }
    }
    // THE FIELD: this view's log through the wall's density rule, fed a little every frame
    const dcfg = visitorWorld.density ?? FALLBACK_DENSITY;
    const key = `${visitorWorld.version}:${JSON.stringify(dcfg)}`;
    let h = field.current;
    if (!h || h.key !== key || h.drops !== log.drops) h = field.current = { f: new DensityField(dcfg), key, fed: 0, drops: log.drops };
    const all = log.all();
    if (h.fed < all.length) {
      const t0 = performance.now(), to = Math.min(all.length, h.fed + FEED_PER_FRAME);
      for (let i = h.fed; i < to; i++) h.f.add(all[i]);
      h.fed = to;
      markSpan("future-feed", performance.now() - t0);
    }
    const now = performance.now() / 1000;
    const s = st.current;
    const p = playerPosRef.current;
    const epoch = getEpochMs();
    const exCfg = { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 };
    const exs = epoch > 0 ? excavatorsAt(epoch, getWorldSec(), exCfg) : [];
    // (the dream's own material, or today's — the same uniforms are set on both)
    const M = cfg.dream ? dreamMat : mat;
    if (points.current && points.current.material !== M) points.current.material = M;
    // (the scan: the cloud is only what the frames are taken of)
    if (cfg.windows) {
      const el = state.gl.domElement, wk = `${isCoarse()}:${cfg.winMax}:${Math.round((el.width / Math.max(1, el.height)) * 50)}`;
      if (windowsKey.current !== wk) {
        windowsKey.current = wk;
        windows.ensure(state.gl, isCoarse(), cfg);
        windows.compile(state.gl, state.camera);
      }
    }
    if (points.current) points.current.visible = !(s.active && (s.scan || s.frames || s.windows));
    for (const m of [mat, dreamMat]) {
      m.uniforms.uScale.value = state.gl.domElement.height / 2;
      m.uniforms.uSize.value = cfg.pointSize;
    }
    // (the dream's points are sized in pixels: small and crisp)
    dreamMat.uniforms.uSize.value = cfg.dreamPx;
    dreamMat.uniforms.uMaxPx.value = Math.max(2, cfg.dreamPx * 1.6);
    /** THE PLACE READ: the future round the visitor as it is now (what is left, the plants, the visitor's own cells …) put
     *  into the cloud. Once at an encounter — and, for the frames, again while it lasts: the future in the plates is the
     *  living one, and what the visitor does (stays, is joined) is in the next pictures. `seed`: the ground's own scatter,
     *  the same through an encounter. */
    const readPlace = (seed: number) => {
      const t0 = performance.now();
      const sNow = getS();
      const kMe = Math.floor(sNow / Math.max(1, dcfg.slotSec));
      let K = kMe;
      if (cfg.readLatest) {
        let kk = -Infinity;
        for (const sd of h.f.seeds()) if (sd.levels) for (const [k, lv] of sd.levels) if (lv >= 1 && k > kk && k <= K) kk = k;
        if (kk !== -Infinity) K = kk;
      }
      const box: BoxConfig = { ...DEFAULT_BOXES, secPerUnit: Math.max(1, dcfg.slotSec), unit: cfg.unit, width: 0.8, density: 1.4, variety: DEFAULT_VARIETY, buildSlots: 0 };
      const me = meRef.current.id;
      // (the scan takes its frames of the dream's sampling of the place)
      const dream = cfg.dream || cfg.scan || cfg.frames || cfg.windows, phone = isCoarse();
      // (the dream: a narrow piece, sampled densely — the whole budget in it — so the place reads from the points' density)
      const R = cfg.windows ? cfg.winR : cfg.frames ? cfg.frameR : cfg.scan ? cfg.scanR : dream ? cfg.dreamR : cfg.cloudR;
      const r = futurePresence(h.f, me, K, kMe, p, { ...cfg, radius: R + 4, surface: cfg.surface * (dream ? (phone ? 4 : 14) : 1), surfaceCap: dream ? (phone ? 400 : 2000) : 160, wild: cfg.wild, traces: true }, box);
      // FOUND: the visitor stayed in that ground (their own cells near, whenever in their life)
      let found = false;
      for (const c of h.f.cellsOf(me)) if (wrapDist((c.cx + 0.5) * CELL_SIZE, (c.cz + 0.5) * CELL_SIZE, p.x, p.z) <= FOUND_NEAR) {
        found = true;
        break;
      }
      // ── the cloud ──
      const P = (geom.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const C = (geom.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
      const S = (geom.getAttribute("aSeed") as THREE.BufferAttribute).array as Float32Array;
      const Z = (geom.getAttribute("aSize") as THREE.BufferAttribute).array as Float32Array;
      let size = 1;
      // (what a point is, for the scan: 0 ground · 1 remains · 2 plants · 3 trees · 4 mounds · 5 dark earth · 6 own cells)
      let kind = 0;
      let v = 0;
      // (the dream: up to 90 000 points — a phone a fifth — thinner the further from the visitor; the visitor's own cells
      // lower the threshold of what is near them: their life comes first and stays longest)
      // (the scan's cloud is never drawn, only taken into frames: a phone gets it whole)
      const scanOnly = cfg.scan || cfg.frames || cfg.windows;
      const cap = dream ? Math.min(CAP, phone && !scanOnly ? 18000 : 90000) : CAP;
      const mine: number[] = [];
      for (let o = 0; o + 3 < r.traces.length; o += 4) mine.push(r.traces[o], r.traces[o + 1]);
      const put = (x0: number, y: number, z0: number, r0: number, g0: number, b0: number) => {
        if (v >= cap) return;
        const x = nearestImage(x0, p.x), z = nearestImage(z0, p.z);
        const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d2 > R * R * (dream ? 1.8 : 1)) return;
        P[v * 3] = x;
        P[v * 3 + 1] = y;
        P[v * 3 + 2] = z;
        C[v * 3] = r0;
        C[v * 3 + 1] = g0;
        C[v * 3 + 2] = b0;
        // (the scan reads only the place, the tone and the kind: the rest of a point is the dream's, and costed 70 – 150 ms)
        if (scanOnly) {
          S[v * 4 + 1] = kind;
          v++;
          return;
        }
        const a = hash(v, 17, 1) * Math.PI * 2, c = hash(v, 17, 2) * 2 - 1, q = Math.sqrt(1 - c * c);
        S[v * 4] = Math.cos(a) * q;
        S[v * 4 + 1] = c;
        S[v * 4 + 2] = Math.sin(a) * q;
        S[v * 4 + 3] = hash(v, 17, 3);
        if (dream) {
          S[v * 4] = hash(v, 17, 4) - 0.5;
          S[v * 4 + 1] = kind;
          let nearMine = false;
          for (let m = 0; m + 1 < mine.length && !nearMine; m += 2) if ((x - nearestImage(mine[m], p.x)) ** 2 + (z - nearestImage(mine[m + 1], p.z)) ** 2 < 4) nearMine = true;
          if (nearMine) S[v * 4 + 3] *= 0.4;
        }
        // (sizes: the kind's, and in the dream each its own — from a third to twice)
        Z[v] = dream ? size * (0.75 + 0.5 * hash(v, 17, 5)) : size;
        v++;
      };
      // (the dream's plants paler: only the plants carry colour)
      const green = new THREE.Color(cfg.plantColor);
      if (dream) green.lerp(new THREE.Color("#9aa59a"), 0.5);
      // the parts that are left, on their surfaces
      size = 1;
      kind = 1;
      for (let o = 0; o + 3 < r.surface.length; o += 4) {
        const sh = r.surface[o + 3];
        put(r.surface[o], r.surface[o + 1], r.surface[o + 2], sh, sh, sh);
      }
      // the plants: grass a low carpet, scrub a dome — each cloud a few dozen points
      size = 0.9;
      kind = 2;
      let flowering = 0;
      for (let o = 0; o + 11 < r.plantClouds.length; o += 12) {
        const x = r.plantClouds[o], z = r.plantClouds[o + 1], rad = r.plantClouds[o + 3], tall = r.plantClouds[o + 4] * cfg.unit, kind = r.plantClouds[o + 5], own = Math.floor(r.plantClouds[o + 9] * 1e6);
        if ((nearestImage(x, p.x) - p.x) ** 2 + (nearestImage(z, p.z) - p.z) ** 2 > (R + 2) ** 2) continue;
        const n = Math.min(scanOnly ? 260 : dream ? 700 : 120, Math.round((20 + rad * rad * 25) * (dream ? 6 : 1)));
        if (r.plantClouds[o + 6] > 0.3) flowering++;
        for (let i = 0; i < n; i++) {
          const th = hash(own, i, 1) * Math.PI * 2, rr = rad * Math.sqrt(hash(own, i, 2)), u = hash(own, i, 3);
          const y = kind >= 1 ? tall * (1 - (rr / Math.max(1e-3, rad)) ** 2) * u : tall * u * 0.5 + 0.01;
          const k = (kind >= 1 ? 0.55 : 0.8) + 0.45 * hash(own, i, 4);
          put(x + Math.cos(th) * rr, y, z + Math.sin(th) * rr, green.r * k, green.g * k, green.b * k);
        }
      }
      // the trees' points
      kind = 3;
      for (let o = 0; o + 4 < r.vegTree.length; o += 5) {
        const k = 0.45 + r.vegTree[o + 3];
        put(r.vegTree[o], r.vegTree[o + 1] * cfg.unit, r.vegTree[o + 2], green.r * k, green.g * k, green.b * k);
        // (the dream: each of a tree's points a small knot of them)
        if (dream) for (let j = 0; j < 4; j++) put(r.vegTree[o] + (hash(o, j, 41) - 0.5) * 0.16, r.vegTree[o + 1] * cfg.unit + (hash(o, j, 42) - 0.5) * 0.16, r.vegTree[o + 2] + (hash(o, j, 43) - 0.5) * 0.16, green.r * k, green.g * k, green.b * k);
      }
      // the mounds: domes of pale points; the dark earth: a few grey points flat on the ground
      kind = 4;
      for (let o = 0; o + 3 < r.mounds.length; o += 4) {
        const x = r.mounds[o], z = r.mounds[o + 1], score = r.mounds[o + 2], sd = Math.floor(r.mounds[o + 3] * 1e6);
        const n = Math.min(dream ? 400 : 60, Math.round((10 + score * 10) * (dream ? 6 : 1))), Rm = CELL_SIZE * 0.5 * Math.min(2, Math.sqrt(score)), H = cfg.unit * 0.3 * Math.min(1.5, score);
        for (let i = 0; i < n; i++) {
          const u1 = hash(sd, i, 1), th = hash(sd, i, 2) * Math.PI * 2, rr = Rm * Math.sqrt(u1), c = 0.7 + 0.25 * hash(sd, i, 3);
          put(x + Math.cos(th) * rr, 0.02 + H * (1 - u1), z + Math.sin(th) * rr, c, c, c);
        }
      }
      kind = 5;
      for (let o = 0; o + 3 < r.stains.length; o += 4) {
        const x = r.stains[o], z = r.stains[o + 1], sd = Math.floor(r.stains[o + 3] * 1e6);
        for (let i = 0; i < (dream ? 60 : 8); i++) {
          const th = hash(sd, i, 5) * Math.PI * 2, rr = CELL_SIZE * 0.45 * Math.sqrt(hash(sd, i, 6));
          put(x + Math.cos(th) * rr, 0.015, z + Math.sin(th) * rr, 0.3, 0.3, 0.3);
        }
      }
      // the visitor's own cells: a white patch each (a bright one where a building stands because of them)
      // (the scan tells them by their size: theirs alone over 2)
      size = 1.5;
      kind = 6;
      for (let o = 0; o + 3 < r.traces.length; o += 4) {
        const x = r.traces[o], z = r.traces[o + 1], kind = r.traces[o + 3], sd = Math.floor((x * 131 + z * 71) * 100);
        const c = kind >= 1 ? 1 : kind > 0 ? 0.8 : 0.6;
        for (let i = 0; i < (dream ? 90 : 14); i++) put(x + (hash(sd, i, 7) - 0.5) * CELL_SIZE, 0.03, z + (hash(sd, i, 8) - 0.5) * CELL_SIZE, c, c, c);
      }
      // the ground of the future, scanned: a sparse floor of small dark points
      size = dream ? 0.85 : 0.45;
      kind = 0;
      // (the dream: the ground fills what is left of the budget, densely, and rises over the mounds — the place's
      // relief read from the points, as a scan's; a little lighter or darker by a slow noise of its own)
      const groundN = dream ? Math.max(0, cap - v) : 1400;
      const moundH = (x: number, z: number): number => {
        let hgt = 0;
        for (let o = 0; o + 3 < r.mounds.length; o += 4) {
          const dx = nearestImage(r.mounds[o], p.x) - x, dz = nearestImage(r.mounds[o + 1], p.z) - z, score = r.mounds[o + 2];
          const Rm = CELL_SIZE * 0.9 * Math.min(2, Math.sqrt(score)), q = (dx * dx + dz * dz) / (Rm * Rm);
          if (q < 1) hgt = Math.max(hgt, cfg.unit * 0.3 * Math.min(1.5, score) * (1 - q) * (1 - q));
        }
        return hgt;
      };
      for (let i = 0; i < groundN; i++) {
        const th = hash(i, 91, seed) * Math.PI * 2, rr = R * (dream ? 1.3 : 1) * Math.sqrt(hash(i, 92, seed));
        const x = p.x + Math.cos(th) * rr, z = p.z + Math.sin(th) * rr;
        if (!dream) {
          put(x, 0.005, z, 0.2, 0.2, 0.2);
          continue;
        }
        const c = 0.2 + 0.1 * Math.sin(x * 0.9 + Math.cos(z * 0.7) * 2) * Math.cos(z * 1.1 - x * 0.3) + 0.05 * hash(i, 93, 1);
        put(x, 0.005 + moundH(x, z), z, c, c, c);
      }
      const fillMs = performance.now() - t0 - r.ms;
      geom.setDrawRange(0, v);
      M.uniforms.uR.value = R;
      for (const name of ["position", "color", "aSeed", "aSize"]) (geom.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      return { t0, sNow, K, kMe, r, v, found, flowering, fillMs, R, green, phone };
    };
    if (s.active) {
      const t = now - s.t0;
      const ex = exs.find((e) => e.i === s.ex);
      const inside = !!ex && wrapDist(ex.x, ex.z, p.x, p.z) <= cfg.meetR * 1.6;
      // (it holds while the archaeologist is there, at least `hold` seconds; then it streams away)
      // (the frames stay as long as the archaeologist is in reach, and go when it is not)
      if (inside) s.outAt = Math.max(s.outAt, Math.min(t + 0.5, cfg.inSec + (s.scan ? cfg.scanHold : s.frames ? 48 : 0) + 12));
      const outLen = s.scan || s.frames ? cfg.outSec * 1.5 : cfg.outSec;
      M.uniforms.uT.value = t;
      M.uniforms.uOutAt.value = s.outAt;
      if (ex) {
        M.uniforms.uDir.value.set(ex.dx, ex.dz);
        scanMat.uniforms.uDir.value.set(ex.dx, ex.dz);
        const x = nearestImage(ex.x, p.x), z = nearestImage(ex.z, p.z);
        const a = line.getAttribute("position") as THREE.BufferAttribute;
        (a.array as Float32Array).set([x, 0, z, x, 6, z]);
        a.needsUpdate = true;
      }
      const env = Math.min(1, t / Math.max(0.1, cfg.inSec)) * (1 - Math.min(1, Math.max(0, (t - s.outAt) / Math.max(0.1, outLen))));
      // (the frames' archaeologist is a window of a body's shape, not a line)
      lineMat.opacity = s.frames || s.windows ? 0 : 0.7 * env;
      // (the present is dark while the future holds; it comes back as the cloud streams away — the afterimage)
      // (the frames stand in the present, translucent: it stays)
      futureMeet.dark = s.frames || s.windows ? paperTrial.current : (s.scan ? cfg.scanDark : cfg.darkPresent && !cfg.dream) && t < s.outAt;
      // (the living future: the place read again while the frames stand — what the visitor does is in the next pictures)
      if (s.frames && cfg.frameReread > 0 && t < s.outAt && now - s.readAt >= cfg.frameReread) {
        s.readAt = now;
        const t1 = performance.now();
        frames.place(p, readPlace(s.seed).R);
        markSpan("future-reread", performance.now() - t1);
      }
      // THE WINDOWS: they outlast the meeting — the encounter is over when the observer is out of sight and the last
      // window it left has faded (or after a minute and a half)
      let standing = 0;
      if (s.windows) {
        if (cfg.frameReread > 0 && now - s.readAt >= cfg.frameReread) {
          s.readAt = now;
          const t1 = performance.now();
          windows.place(p, readPlace(s.seed).R);
          markSpan("future-reread", performance.now() - t1);
        }
        standing = windows.update({ gl: state.gl, cam: state.camera, now, t, ex: ex ? { x: nearestImage(ex.x, p.x), z: nearestImage(ex.z, p.z), standing: ex.standing } : null, me: p, cfg });
        if (t > 90) standing = 0;
      }
      if (s.frames) frames.update({ gl: state.gl, cam: state.camera, now, t, outAt: s.outAt, outLen, ex: ex ? { x: nearestImage(ex.x, p.x), z: nearestImage(ex.z, p.z), standing: ex.standing } : null, cfg });
      if (s.scan) {
        // THE PLACE COMES (B): from far ahead it rushes in, slowing as it reaches the visitor; and (A) while it holds the
        // visitor stands where they are — their walking draws the place to them instead
        futureHold.on = cfg.scanFlow && t < s.outAt;
        if (futureHold.on) s.flow.add(tmpPos.set(-futureHold.vx, 0, -futureHold.vz).multiplyScalar(Math.min(delta, 0.05)));
        const u = cfg.scanArrive ? Math.min(1, t / Math.max(0.1, cfg.scanArriveSec)) : 1;
        s.shift.copy(s.arrive).multiplyScalar(Math.pow(1 - u, 2.5)).add(s.flow);
        scanMat.uniforms.uShift.value.copy(s.shift);
        captureMat.uniforms.uShift.value.copy(s.shift);
        // ONE LOOKS ROUND: a frame each time the eye has turned (or walked, or the place has moved) enough, or has rested
        const sc = scan.current, cam = state.camera;
        cam.getWorldPosition(tmpPos);
        if (t < s.outAt && sc.rt) {
          cam.getWorldDirection(tmpDir);
          const since = now - sc.lastAt;
          const turned = sc.count === 0 ? Infinity : THREE.MathUtils.radToDeg(tmpDir.angleTo(sc.dir));
          // (only while the place is in view: a frame of nothing would push a frame of it out of the ring)
          tmpFrustum.setFromProjectionMatrix(tmpMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
          tmpSphere.center.copy(scanMat.uniforms.uOrigin.value).add(s.shift);
          tmpSphere.radius = captureMat.uniforms.uR.value;
          const inView = tmpFrustum.intersectsSphere(tmpSphere);
          // (the eye's place in the place's own frame: it moves when the visitor walks or the place comes)
          const rel = tmpPos.clone().sub(s.shift);
          if (inView && ((since >= 0.08 && (turned >= cfg.scanTurn || rel.distanceTo(sc.pos) >= 0.3)) || since >= cfg.scanStill)) capture(state.gl, cam, now);
        }
        const U = scanMat.uniforms;
        U.uT.value = t;
        U.uOutAt.value = s.outAt;
        U.uOut.value = outLen;
        U.uCam.value.copy(tmpPos);
        U.uBase.value = cfg.scanBase;
        U.uGain.value = cfg.scanGain;
        U.uNew.value = cfg.scanNew;
        U.uPx.value = cfg.scanPx * Math.min(2, state.gl.getPixelRatio());
        U.uGlow.value = cfg.scanGlow;
        scanPoints.visible = true;
      }
      if (t >= s.outAt) futureHold.on = false;
      if (t > s.outAt + outLen + 1 && standing === 0) {
        s.active = false;
        futureMeet.dark = false;
        futureHold.on = false;
        geom.setDrawRange(0, 0);
        lineMat.opacity = 0;
        scanPoints.visible = false;
        scanMat.uniforms.uCount.value = 0;
        frames.end();
        windows.end();
      }
      return;
    }
    if (!getLive() || h.fed < all.length) return;
    // AN ARCHAEOLOGIST CROSSES WHERE THE VISITOR STANDS
    const ex = exs.find((e) => wrapDist(e.x, e.z, p.x, p.z) <= cfg.meetR && (s.cool.get(e.i) ?? -Infinity) <= now);
    if (!ex) return;
    const { t0, sNow, K, kMe, r, v, found, flowering, fillMs, R, green, phone } = readPlace(Math.round(now));
    s.readAt = now;
    s.seed = Math.round(now);
    futureMeet.last = { id: `${ex.i}:${Math.round(getWorldSec())}`, found };
    M.uniforms.uOrigin.value.set(p.x, 0, p.z);
    M.uniforms.uDir.value.set(ex.dx, ex.dz);
    M.uniforms.uIn.value = cfg.inSec;
    M.uniforms.uOut.value = cfg.outSec;
    M.uniforms.uT.value = 0;
    if (cfg.scan && !cfg.frames && !cfg.windows) {
      const sc = scan.current, U = scanMat.uniforms;
      ensureAtlas(state.gl, phone);
      Object.assign(sc, { count: 0, newest: -1, n: 0, lastAt: -Infinity });
      // (it comes from where the visitor looks: that far ahead, level)
      state.camera.getWorldDirection(tmpDir);
      tmpDir.y = 0;
      if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, -1);
      s.arrive.copy(tmpDir.normalize()).multiplyScalar(cfg.scanArrive ? cfg.scanArriveDist : 0);
      s.flow.set(0, 0, 0);
      s.shift.copy(s.arrive);
      U.uShift.value.copy(s.shift);
      captureMat.uniforms.uShift.value.copy(s.shift);
      U.uCount.value = 0;
      U.uT.value = 0;
      U.uIn.value = cfg.inSec;
      U.uOutAt.value = cfg.inSec + cfg.scanHold;
      U.uOrigin.value.set(p.x, 0, p.z);
      U.uDir.value.set(ex.dx, ex.dz);
      U.uPlant.value.copy(green);
      captureMat.uniforms.uOrigin.value.set(p.x, 0, p.z);
      captureMat.uniforms.uR.value = R;
    }
    if (cfg.frames) {
      frames.ensure(state.gl, phone, cfg);
      frames.begin(p, R, cfg.plantColor);
    }
    if (cfg.windows) {
      windows.ensure(state.gl, phone, cfg);
      windows.begin(p, R, cfg.plantColor);
    }
    Object.assign(s, { active: true, t0: now, ex: ex.i, outAt: cfg.inSec + (cfg.frames ? cfg.frameHold : cfg.scan ? cfg.scanHold : cfg.holdSec), scan: cfg.scan && !cfg.frames && !cfg.windows, frames: cfg.frames && !cfg.windows, windows: cfg.windows });
    s.cool.set(ex.i, now + cfg.cooldownSec);
    // THE PASSING, HEARD (futureSound.ts): glitter where the meadow flowers, a river where the future's water runs near,
    // from the side it comes from to the side it goes to (the listener's right: the camera's yaw)
    const wd = waterDistance(epoch, visitorWorld.herd, sNow, p.x, p.z);
    const yaw = getYaw?.() ?? 0, rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const side = Math.max(-1, Math.min(1, ex.dx * rx + ex.dz * rz));
    const heard = cfg.fxLevel > 0 && playFuturePassing(sound, { glitter: Math.min(1, flowering / 15), river: wd <= 10 ? 1 - wd / 10 : 0, found, panFrom: -side * 0.8, panTo: side * 0.8, dur: cfg.inSec + (cfg.frames ? cfg.frameHold + 2 : cfg.scan ? cfg.scanHold : cfg.holdSec) + cfg.outSec, level: cfg.fxLevel });
    markSpan("future-meet", performance.now() - t0);
    (window as unknown as { __futureMeet?: unknown }).__futureMeet = { at: Math.round(getWorldSec()), ex: ex.i, found, heard, flowering, water: Number.isFinite(wd) ? Math.round(wd * 10) / 10 : null, points: v, ms: Math.round(performance.now() - t0), readMs: Math.round(r.ms), fillMs: Math.round(fillMs), k: K, kMe, n: r.n, surface: r.surface.length / 4, plants: r.plantClouds.length / 12, trees: r.vegTree.length / 5, mounds: r.mounds.length / 4, stains: r.stains.length / 4, traces: r.traces.length / 4, scan: cfg.scan ? { W: scan.current.W, H: scan.current.H, K: scan.current.K, points: scan.current.W * scan.current.H * scan.current.K } : null };
  });

  return (
    <>
      <points ref={points} geometry={geom} material={mat} frustumCulled={false} />
      <lineSegments geometry={line} material={lineMat} frustumCulled={false} />
      <primitive object={scanPoints} />
      <primitive object={frames.group} />
      <primitive object={windows.group} />
    </>
  );
}

/** For the readout: where the archaeologists are now (a debugging helper; not drawn). */
export function excavatorsNear(epochMs: number, sec: number, at: { x: number; z: number }, cfg: FuturePresenceVisual): { i: number; d: number }[] {
  return excavatorsAt(epochMs, sec, { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 })
    .map((e) => ({ i: e.i, d: Math.round(wrapDist(e.x, e.z, at.x, at.z) * 10) / 10 }))
    .sort((a, b) => a.d - b.d);
}
