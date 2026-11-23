"use client";
/**
 * FrameLab — HOW A PERSON'S FRAMES ARE LAID OUT (the artist, 2026-11-23: "나와의 상대 각도 고려해서 프레임이 움직임에 따라
 * 늘어져서 옆에서 보면 동세 덩어리로 보이도록 … 랩에 아예 다른 슬랏을 추가해서 거기는 아무런 요소도 없이, 순수하게 사람
 * 프레임을 어떻게 늘어놓을 건지 결정하게"). A lab page of its own (/lab/mobile/frames): white space, no ground, no scan —
 * only people cut out of video (spritePeople's sheet) walking, and the frames they leave.
 *
 * Each walker leaves copies of their frame behind them (at a time spacing, or at each sample — "슉"), fading. A card
 * stands in one of three ways (facing the eye / along the path / across it). Each card may be STRETCHED towards the copy
 * before it by how much of the move between them lies across the eye's view — the relative angle: seen from behind the
 * copies pile into one figure, seen from the side they run together into a mass of the movement. The stretched part is
 * a streak of the silhouette's own colours (the body's middle pulled sideways, like a long exposure's drag), or the
 * frame itself widened. Cards may show only a vertical slit of their frame (slit-scan laid out in space).
 *
 * Camera: drag to orbit; the knobs' buttons put it at the side, behind, in front, above, or at eye level among them.
 *
 * Seen from the side, frames standing square to the path leave the space between them empty; frames IN BETWEEN fill it
 * (a count of them, or one per frame time of the clip). A band along the path carrying the body's height profile was
 * tried and dropped (2026-11-23).
 * Each clip keeps its own set: the distance a frame carries the body and how long a frame is held, what state it is for
 * (standing, moving, moving fast, talking, or unused), and how it looks (height, width, ink, feet, colour, reversed, start,
 * playback speed, a ping-pong loop).
 * A DISTANCE HIERARCHY: near, middle and far from the eye (blended at their borders) — each tier scales the afterimages,
 * the ink, the blur and the flowing colour; far off a card may face the eye and a profile clip walks across.
 * Front shots only, square to the way they go — a silhouette's front and back are one (the artist, 2026-11-23).
 * Inside the silhouettes a colour may flow (a three-colour gradient that waves along the height, through space, or with
 * a copy's age), from one of five colour combinations (one for all, or each walker their own). Old copies blur with
 * their age; the body now stays sharp. What is fainter than a threshold is not drawn, and a frame's own border is always
 * empty (a faint box round a frame).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { button, folder, useControls } from "leva";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { savable } from "./levaSave";
import { LAB_GROUP } from "./mobileLab";
import { loadSpriteSheet, type SpriteIndex } from "./spritePeople";

const MAX_CARDS = 4096;
const TAU = Math.PI * 2;

type Path = "across" | "circle" | "toward" | "wander" | "scatter";
/** What a clip is for in the interaction (the artist, 2026-11-23: "서있을 때, 이동중일 때, 소통중일 때 등등 인터랙션 로직별
 *  케이스따라") — standing, moving, moving fast, talking (asking / answering), or not decided yet. */
type ClipState = "none" | "stand" | "walk" | "brisk" | "run" | "talk";
/** A clip's own set (the artist, 2026-11-23: front shots only, stood square to the way they go — a silhouette's front and
 *  back are the same, so no view): what it is for, mirrored, how a body walks in it, and how it looks — height, width,
 *  ink, foot level, a colour laid over it, played backwards, where its loop starts. */
interface ClipSet {
  id: string;
  state: ClipState;
  flip: boolean;
  dist: number;
  gap: number;
  height: number;
  width: number;
  ink: number;
  lift: number;
  tint: [number, number, number];
  tintAmt: number;
  reverse: boolean;
  offset: number;
  /** Playback speed × (every state — for standing and talking clips the only one), and a ping-pong loop (a → back → a). */
  play: number;
  pingpong: boolean;
  /** The body's share of its frame's height (a wide pose made the window taller): the card is enlarged by its inverse. */
  fill: number;
  /** Seen far off walking across: this profile clip is used (the distance hierarchy's far tier). */
  farSide: boolean;
}
type Facing = "eye" | "along" | "across";
/** A walker's state for its afterimages: walking, walking briskly, running, standing, talking. */
type StateKey = "walk" | "brisk" | "run" | "stand" | "talk";
/** How a state's afterimages are left and age: how long they stay (s), their ink, how many and how far apart in time
 *  (when copies are left by time, not by samples), the frames between two of them (count, ink ×), and with their age —
 *  size ×, rise (m), scatter (m), turn (rad), colour faded, blur (a share of the frame's width). */
interface Trail {
  life: number;
  ink: number;
  copies: number;
  gap: number;
  betweenN: number;
  betweenInk: number;
  scale: number;
  rise: number;
  scatter: number;
  turn: number;
  desat: number;
  blur: number;
}

interface Look {
  count: number;
  path: Path;
  spread: number;
  dist: number;
  /** The clips' sets (a row of the sheet each), the fixed clip (0 = by state and view), the share of people standing. */
  clips: ClipSet[];
  row: number;
  standShare: number;
  /** THE DISTANCE HIERARCHY (the artist, 2026-11-23: "한 번 잘 위계화 해봐"): near / middle / far by the distance from the eye,
   *  blended over `band` m at r1 and r2 — each tier multiplies the afterimages, the ink, adds blur and scales the flowing
   *  colour; far off, cards may face the eye and profile clips walk across. */
  tier: { r1: number; r2: number; band: number; farEye: boolean; farSide: boolean; trail: [number, number, number]; ink: [number, number, number]; blur: [number, number, number]; grad: [number, number, number] };
  /** How fast people go: 0 by the clips' sets, 1 each their own speed (base ± variety); faster than runFrom they run. */
  speedMode: number;
  speedBase: number;
  speedVar: number;
  runFrom: number;
  briskFrom: number;
  /** The card turned from its walking direction (rad); what fills between two copies (0 none · 2 a count of frames · 3 one per frame time). */
  yaw: number;
  between: number;
  /** The afterimages by the walker's state (the artist, 2026-11-23: "서있을 때 잔상 날리는 거랑 처리하는 것도 따로 모드별로"). */
  trails: Record<StateKey, Trail>;
  /** The colour flowing inside: how much, three colours, the size of a wave, its speed, along what (0 height · 1 space ·
   *  2 age), how much it wavers. */
  gradAmt: number;
  /** Five combinations of three colours (15 "#rrggbb"), which one (0 = each walker their own, 1 … 5), the faint-alpha
   *  threshold. */
  pals: string[];
  gradPick: number;
  edgeTh: number;
  /** The cut's softness above the threshold; the colour's contrast and brightness. */
  edgeW: number;
  con: number;
  bright: number;
  gradScale: number;
  gradSpeed: number;
  gradDir: number;
  gradWarp: number;
  /** The side fill between frames (0 … 1). */
  stamp: boolean;
  sampleSec: number;
  dashSec: number;
  fall: number;
  ink: number;
  facing: Facing;
  stretch: number;
  stretchKind: number; // 0 streak · 1 widen the frame
  streakSoft: number;
  slit: number;
  multiply: boolean;
  floor: boolean;
}

interface Stamp {
  t: number;
  x: number;
  z: number;
  h: number;
  ph: number;
}

interface Walker {
  hash: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  // the path's own parameter (distance along it, or an angle)
  s: number;
  dir: number;
  // wander: the point it walks to
  gx: number;
  gz: number;
  hist: Stamp[];
  stamps: Stamp[];
  lastHist: number;
  lastSample: number;
  // its clip (a row of the sheet), standing or not, its pace (m/s) and how long a frame is held (s)
  home: number;
  standing: boolean;
  speed: number;
  gap: number;
  // seconds a phase cycle takes (the clip's frames once — twice for a ping-pong loop)
  cycle: number;
}

const VERT = /* glsl */ `
uniform float uCols;
uniform float uRows;
uniform float uAspect;
uniform float uFacing;     // 0 eye · 1 along the path · 2 across it
uniform float uStretch;
uniform float uSlit;
attribute vec4 iA;         // x, z, height, alpha
attribute vec4 iB;         // row, frame, mirror, heading
attribute vec4 iC;         // previous copy x, z, has one (0/1), lift (m)
attribute vec4 iD;         // colour faded (0 … 1), the clip's colour laid over (0 … 1), age (0 … 1), colour combination
attribute vec4 iE;         // the clip's colour (linear rgb), width ×
attribute vec4 iF;         // blur at this card's age and distance (a share of the frame's width), the flowing colour ×, faces the eye (1), 0
varying vec2 vUv;          // the frame's own u (may run outside 0 … 1 on the stretched side), v
varying float vAlpha;
varying float vSide;       // the trailing side (−1 left, +1 right) in the card's own u
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
flat varying float vDesat;
flat varying vec4 vTint;
varying vec3 vWorld;
flat varying float vAge;
flat varying float vPal;
flat varying float vBlur;
flat varying float vGradK;
void main() {
  vec3 feet = vec3(iA.x, 0.0, iA.y);
  vec3 right;
  // (far off a card may face the eye whatever the knob says — the distance hierarchy)
  float fac = iF.z > 0.5 ? 0.0 : uFacing;
  if (fac < 0.5) {
    vec3 toEye = cameraPosition - feet;
    toEye.y = 0.0;
    vec3 f = normalize(toEye + vec3(1e-5, 0.0, 0.0));
    right = vec3(f.z, 0.0, -f.x);
  } else {
    vec3 fwd = vec3(sin(iB.w), 0.0, cos(iB.w));
    right = fac < 1.5 ? fwd : vec3(fwd.z, 0.0, -fwd.x);
  }
  float h = iA.z;
  float w = h * uAspect * (iE.w > 0.0 ? iE.w : 1.0);
  // the move to the copy before, across the card (in card widths): the stretch reaches towards it
  float e = 0.0;
  if (iC.z > 0.5) e = dot(vec3(iC.x, 0.0, iC.y) - feet, right) / max(w, 1e-4) * uStretch;
  float slitHalf = 0.5 * uSlit;
  float xl = min(-slitHalf, e), xr = max(slitHalf, e);
  float x = position.x < 0.0 ? xl : xr;
  vec3 p = feet + right * x * w + vec3(0.0, position.y * h + iC.w, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = vec2(x, position.y);
  vSide = e >= 0.0 ? 1.0 : -1.0;
  vAlpha = iA.w;
  // (the frame's row and column, and the mirror: flat, the same over the card)
  vRow = iB.x;
  vFrame = floor(mod(iB.y, uCols));
  vMirror = iB.z;
  vDesat = iD.x;
  vTint = vec4(iE.rgb, iD.y);
  vWorld = p;
  vAge = iD.z;
  vPal = iD.w;
  vBlur = iF.x;
  vGradK = iF.y;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform float uCols;
uniform float uRows;
uniform float uSlit;
uniform float uStretchKind;
uniform float uStreakSoft;
uniform float uMultiply;
flat varying float vBlur; // this card's blur (its state's, at its age)
flat varying float vGradK;
varying vec2 vUv;
varying float vAlpha;
varying float vSide;
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
flat varying float vDesat;
flat varying vec4 vTint;
varying vec3 vWorld;
flat varying float vAge;
flat varying float vPal;
uniform float uEdgeTh;    // the alpha below which nothing is drawn (a faint box round a frame — the artist, 2026-11-23)
uniform float uEdgeW;     // how soft the cut is (the width of the ramp above the threshold; small = a hard edge — 2026-11-23)
uniform float uCon;       // the colour's contrast about mid-grey, and its brightness
uniform float uBright;
vec4 cell(float u, float v) {
  float uu = vMirror < 0.0 ? 1.0 - u : u;
  vec4 t = texture2D(uSheet, vec2((vFrame + clamp(uu, 0.001, 0.999)) / uCols, (uRows - 1.0 - vRow + clamp(v, 0.001, 0.999)) / uRows));
  // the frame's own border is always empty (shrunk far off, the sheet's neighbouring frames bleed into it), and what is
  // fainter than the threshold is not there (a faint box round a frame)
  float edge = smoothstep(0.0, 0.035, uu) * smoothstep(0.0, 0.035, 1.0 - uu) * smoothstep(0.0, 0.006, v) * smoothstep(0.0, 0.02, 1.0 - v);
  t.a = smoothstep(uEdgeTh, min(1.0, uEdgeTh + uEdgeW), t.a) * edge;
  return t;
}
// an old copy blurred (the artist, 2026-11-23: "오래된 잔상에는 블러"): two rings of taps round the point, their radius the
// copy's age × the knob (the body now stays sharp)
vec4 cellB(float u, float v) {
  float r = vBlur;
  if (r < 0.002) return cell(u, v);
  vec4 acc = cell(u, v) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a) * 0.5);
    acc += cell(u + o.x * r, v + o.y * r) * 0.06 + cell(u + o.x * r * 0.5 + o.y * r * 0.2, v + o.y * r * 0.5) * 0.04;
  }
  return acc;
}
void main() {
  float x = vUv.x;              // card widths from the card's middle
  float slitHalf = 0.5 * uSlit;
  vec4 t;
  float a;
  if (abs(x) <= slitHalf) {
    t = cellB(x + 0.5, vUv.y);
    a = t.a;
  } else {
    // the stretched part: beyond the frame's slit, towards the copy before
    float beyond = abs(x) - slitHalf;
    if (uStretchKind > 0.5) {
      // the frame itself widened: the whole stretch maps onto the slit
      float span = max(abs(x), slitHalf);
      t = cellB(0.5 + x / span * slitHalf, vUv.y);
      a = t.a;
    } else {
      // a streak: the body's middle (just inside the slit's trailing edge) pulled sideways, fading with the distance
      float edge = 0.5 + vSide * min(slitHalf, 0.12);
      t = cellB(edge, vUv.y);
      a = t.a * exp(-beyond / max(0.02, uStreakSoft));
    }
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  t.rgb = mix(t.rgb, vTint.rgb, vTint.a);
  t.rgb = mix(t.rgb, gradAt(vWorld, vUv.y, vAge, vPal), uGradAmt * vGradK);
  t.rgb = mix(t.rgb, vec3(dot(t.rgb, vec3(0.299, 0.587, 0.114))), vDesat);
  t.rgb = clamp((t.rgb - 0.5) * uCon + 0.5 + uBright, 0.0, 1.0);
  if (uMultiply > 0.5) gl_FragColor = vec4(mix(vec3(1.0), t.rgb, a), 1.0);
  else gl_FragColor = vec4(t.rgb, a);
}`;

/** THE COLOUR FLOWING INSIDE (the artist, 2026-11-23: "안에 그래디언트로 색 출렁이는 효과 한 번 넣어보자"): inside the
 *  silhouettes, a gradient of three colours that waves — along the height, through space as they walk, or with a
 *  copy's age — warped a little so it never runs straight. Mixed over the body's own colour by an amount. */
const GRAD_GLSL = /* glsl */ `
uniform float uGradAmt;
uniform vec3 uPal[15];     // five combinations of three colours
uniform float uGradScale;
uniform float uGradSpeed;
uniform float uGradDir;
uniform float uGradWarp;
uniform float uTime;
vec3 gradAt(vec3 world, float v, float age, float pal) {
  int p = int(clamp(pal, 0.0, 4.0) + 0.5) * 3;
  float x = uGradDir < 0.5 ? v * 1.7 : (uGradDir < 1.5 ? (world.x + world.z) * 0.35 : age * 2.0);
  x = x * uGradScale + uTime * uGradSpeed * 0.25;
  x += uGradWarp * 0.25 * sin(world.y * 3.1 + uTime * 0.9 + world.x * 1.3) + uGradWarp * 0.15 * sin(v * 9.0 - uTime * 1.7);
  float t = 0.5 + 0.5 * sin(x * 6.2831853);
  float t2 = 0.5 + 0.5 * sin(x * 6.2831853 * 0.5 + 1.7);
  return mix(mix(uPal[p], uPal[p + 1], t), uPal[p + 2], t2 * t2);
}`;

function gradUniforms(): Record<string, THREE.IUniform> {
  return {
    uGradAmt: { value: 0 },
    uPal: { value: Array.from({ length: 15 }, () => new THREE.Color()) },
    uGradScale: { value: 1 },
    uGradSpeed: { value: 1 },
    uGradDir: { value: 0 },
    uGradWarp: { value: 0.6 },
    uTime: { value: 0 },
  };
}

function makeMaterial(): THREE.ShaderMaterial {
  // (three turns attribute/varying/texture2D/gl_FragColor into GLSL 3 for WebGL2; "flat varying" becomes flat out/in)
  return new THREE.ShaderMaterial({
    uniforms: {
      uSheet: { value: null },
      uCols: { value: 16 },
      uRows: { value: 1 },
      uAspect: { value: 0.5 },
      uFacing: { value: 0 },
      uStretch: { value: 1 },
      uSlit: { value: 1 },
      uStretchKind: { value: 0 },
      uStreakSoft: { value: 0.6 },
      uMultiply: { value: 1 },
      uEdgeTh: { value: 0.15 },
      uEdgeW: { value: 0.15 },
      uCon: { value: 1 },
      uBright: { value: 0 },
      ...gradUniforms(),
    },
    vertexShader: VERT,
    // (the flowing colour's chunk, put in when the material is made — GRAD_GLSL is declared further down)
    fragmentShader: FRAG.replace("vec4 cell(", `${GRAD_GLSL}\nvec4 cell(`),
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

function setBlend(m: THREE.ShaderMaterial, multiply: boolean): void {
  if (multiply) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
  } else m.blending = THREE.NormalBlending;
  m.needsUpdate = true;
}

const frac = (x: number) => x - Math.floor(x);
const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function histAt(H: Stamp[], t: number): Stamp | null {
  if (!H.length || t < H[0].t) return null;
  let lo = 0, hi = H.length - 1;
  if (t >= H[hi].t) return H[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (H[m].t <= t) lo = m;
    else hi = m;
  }
  const a = H[lo], b = H[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  let dh = b.h - a.h;
  dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  let dp = b.ph - a.ph;
  if (dp < -0.5) dp += 1;
  else if (dp > 0.5) dp -= 1;
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + dh * u, ph: a.ph + dp * u };
}

/** Where a walker is on its path at parameter s, and which way it goes. */
function onPath(w: Walker, L: Look, i: number, n: number): { x: number; z: number; h: number } {
  const lane = (i - (n - 1) / 2) * L.spread;
  if (L.path === "across") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: s, z: -L.dist + lane, h: w.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  if (L.path === "toward") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: lane, z: -L.dist + s, h: w.dir > 0 ? 0 : Math.PI };
  }
  if (L.path === "circle") {
    const r = Math.max(1, L.dist + lane);
    const a = (w.s / r) * w.dir + (i / Math.max(1, n)) * TAU;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r - 0, h: a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) };
  }
  return { x: w.x, z: w.z, h: w.h };
}

function Scene({ L, viewRef }: { L: Look; viewRef: React.MutableRefObject<string | null> }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (const name of ["iA", "iB", "iC", "iD", "iE", "iF"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const mat = useMemo(() => makeMaterial(), []);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  const idx = useRef<SpriteIndex | null>(null);
  useEffect(() => {
    let live = true;
    loadSpriteSheet().then(({ index, texture }) => {
      if (!live) return;
      idx.current = index;
      mat.uniforms.uSheet.value = texture;
      mat.uniforms.uCols.value = index.sheet.cols;
      mat.uniforms.uRows.value = Math.max(1, index.sheet.rows.length);
      mat.uniforms.uAspect.value = index.sheet.cellW / index.sheet.cellH;
    });
    return () => {
      live = false;
    };
  }, [mat]);
  useEffect(() => {
    setBlend(mat, L.multiply);
  }, [mat, L.multiply]);
  const walkers = useRef<Walker[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    // the camera's places (the knobs' buttons)
    if (viewRef.current) {
      const v = viewRef.current;
      viewRef.current = null;
      const d = Math.max(4, L.dist + 6);
      const at: Record<string, [number, number, number]> = { side: [d, 1.5, -L.dist], back: [0, 1.6, -L.dist + d * (L.path === "toward" ? -1 : 1)], front: [0, 1.6, -L.dist - d], top: [0.01, d * 1.6, -L.dist], eye: [0, 1.6, 0] };
      const p = at[v] ?? at.side;
      camera.position.set(...p);
      const target = v === "eye" ? new THREE.Vector3(0, 1.4, -L.dist) : new THREE.Vector3(0, 0.9, -L.dist);
      controls.current?.target.copy(target);
      camera.lookAt(target);
      controls.current?.update();
    }
    // the walkers: as many as asked, kept between changes
    const W = walkers.current;
    while (W.length < L.count) {
      const i = W.length;
      const hash = frac(Math.sin(i * 91.7 + 3.1) * 43758.5);
      W.push({ hash, x: (hash - 0.5) * 8, z: -L.dist + (frac(hash * 7.3) - 0.5) * 8, h: hash * TAU, ph: hash, s: hash * 16, dir: i % 2 ? -1 : 1, gx: 0, gz: 0, hist: [], stamps: [], lastHist: -1, lastSample: -1, home: 0, standing: false, speed: 1.3, gap: 0.04, cycle: 0.64 });
    }
    W.length = Math.min(W.length, L.count);
    // each walker's clip: the one fixed, or one for their state (standing: a standing or talking clip; walking: a
    // walking one), by their own hash; their pace and frame time from that clip's set
    const CL = L.clips;
    const rowsOf = (...st: ClipState[]) => CL.map((c, i) => (st.includes(c.state) ? i : -1)).filter((i) => i >= 0);
    const byHash = (list: number[], h: number) => (list.length ? list[Math.floor(frac(h * 13.7) * list.length) % list.length] : 0);
    /** The state a walker's afterimages follow: standing (talking, when its clip is for talking) or moving (fast, when
     *  its clip runs). */
    const stateOf = (w: Walker): StateKey => {
      const st = CL[w.home]?.state;
      return w.standing ? (st === "talk" ? "talk" : "stand") : st === "run" ? "run" : st === "brisk" ? "brisk" : "walk";
    };
    const keepSec = Math.max(...Object.values(L.trails).map((t) => Math.max(t.life, t.copies * t.gap)));
    // (a clip left 미지정 is never chosen — the artist, 2026-11-23: "미지정 하면 그 클립은 안 쓰는 걸로"; a state with no clip
    // of its own borrows any clip that is in use; none in use: nobody is drawn)
    const walkRows = rowsOf("walk"), briskRows = rowsOf("brisk"), runRows = rowsOf("run"), standRows = rowsOf("stand", "talk");
    const usedRows = rowsOf("walk", "brisk", "run", "stand", "talk");
    const first = (...lists: number[][]) => lists.find((l) => l.length) ?? usedRows;
    for (const w of W) {
      w.standing = frac(w.hash * 5.1) < L.standShare;
      // THE SPEED (the artist, 2026-11-23: "속도 threshold 정해서 특정 수준 이상은 '뛰기'에 넣고, 뛰기 케이스는 내가 따로 지정"):
      // by the clips' own sets (for matching a clip), or each person their own speed — above the threshold they run, and
      // take a clip set as running
      const vOwn = L.speedBase * Math.max(0.1, 1 + L.speedVar * (frac(w.hash * 11.3) * 2 - 1));
      // (the artist, 2026-11-23: "'경보'랑 '뛰기' 나눠줘" — a brisk walk between walking and running, each its own clips)
      const pace = L.speedMode !== 1 || w.standing ? 0 : vOwn >= L.runFrom ? 2 : vOwn >= L.briskFrom ? 1 : 0;
      const moving = pace === 2 ? first(runRows, briskRows, walkRows) : pace === 1 ? first(briskRows, walkRows, runRows) : first(walkRows, briskRows, runRows);
      w.home = L.row > 0 ? Math.min(CL.length, L.row) - 1 : w.standing ? byHash(standRows.length ? standRows : usedRows, w.hash) : byHash(moving, w.hash);
      if (L.row === 0 && !usedRows.length) w.home = -1;
      const set = CL[w.home];
      const still = w.standing || !set || set.state === "stand" || set.state === "talk";
      w.speed = still ? 0 : L.speedMode === 1 ? vOwn : set.dist / Math.max(1e-3, set.gap);
      // (the frames follow the speed: a frame for each of the clip's own steps, so the feet keep to the ground)
      w.gap = !set ? 0.04 : w.speed > 0 && L.speedMode === 1 ? set.dist / w.speed : set.gap;
      // the clip's playback speed: its frames faster or slower (moving by the clip's set, the pace with them — the feet
      // stay matched); a ping-pong loop takes twice the frames a cycle
      const play = Math.max(0.05, set?.play ?? 1);
      w.gap /= play;
      if (L.speedMode !== 1) w.speed *= play;
      w.cycle = w.gap * (idx.current?.sheet.cols ?? 16) * (set?.pingpong ? 2 : 1);
    }
    W.forEach((w, i) => {
      // move
      w.s += w.speed * dt;
      if (L.path === "scatter") {
        // the scattered crowd: round the eye from near to far, each walking straight its own way; gone far, back somewhere
        const far = Math.hypot(w.x, w.z) > 45;
        if (w.gx === 0 || far) {
          const r1 = frac(Math.sin((now + 1) * 7.13 + i * 3.7) * 9187.3), r2 = frac(Math.sin((now + 2) * 5.31 + i * 1.9) * 7151.1);
          const a = r1 * TAU, rr = 3 + 37 * Math.sqrt(r2);
          w.x = Math.sin(a) * rr;
          w.z = Math.cos(a) * rr;
          w.h = frac(r1 * 13.7 + r2 * 5.1) * TAU;
          w.gx = 1;
          w.hist.length = 0;
          w.stamps.length = 0;
        }
        w.x += Math.sin(w.h) * w.speed * dt;
        w.z += Math.cos(w.h) * w.speed * dt;
      } else if (L.path === "wander") {
        const dx = w.gx - w.x, dz = w.gz - w.z;
        if (Math.hypot(dx, dz) < 0.4 || (w.gx === 0 && w.gz === 0)) {
          const a = frac(Math.sin(now * 13.1 + i * 7.7) * 9187.3) * TAU, r = 2 + frac(Math.sin(now * 3.3 + i) * 517.1) * Math.max(2, L.dist);
          w.gx = Math.sin(a) * r;
          w.gz = -L.dist + Math.cos(a) * r * 0.6;
        }
        const want = Math.atan2(w.gx - w.x, w.gz - w.z);
        let d = want - w.h;
        d = ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        w.h += Math.max(-1.5 * dt, Math.min(1.5 * dt, d));
        w.x += Math.sin(w.h) * w.speed * dt;
        w.z += Math.cos(w.h) * w.speed * dt;
      } else {
        const p = onPath(w, L, i, L.count);
        const jump = Math.hypot(p.x - w.x, p.z - w.z) > 3;
        w.x = p.x;
        w.z = p.z;
        w.h = p.h;
        if (jump) {
          w.hist.length = 0;
          w.stamps.length = 0;
        }
      }
      // the frames run at their own rate (× the clip's own tempo), apart from how fast the body travels — the artist finds
      // each clip's best match of the two ("이동속도랑 프레임 속도 내가 조절할 수 있도록 … 클립별 베스트 매치")
      w.ph = (w.ph + dt / Math.max(1e-3, w.cycle)) % 1;
      if (now - w.lastHist >= 1 / 30) {
        w.lastHist = now;
        w.hist.push({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      const keep = now - keepSec - 0.5;
      let drop = 0;
      while (drop < w.hist.length && w.hist[drop].t < keep) drop++;
      if (drop) w.hist.splice(0, drop);
      if (L.stamp && now - w.lastSample >= L.sampleSec) {
        w.lastSample = now;
        w.stamps.unshift({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      while (w.stamps.length && now - w.stamps[w.stamps.length - 1].t > L.trails[stateOf(w)].life + L.sampleSec) w.stamps.pop();
    });
    // the cards
    const A = (geom.getAttribute("iA") as THREE.InstancedBufferAttribute).array as Float32Array;
    const B = (geom.getAttribute("iB") as THREE.InstancedBufferAttribute).array as Float32Array;
    const C = (geom.getAttribute("iC") as THREE.InstancedBufferAttribute).array as Float32Array;
    const Dd = (geom.getAttribute("iD") as THREE.InstancedBufferAttribute).array as Float32Array;
    const Ee = (geom.getAttribute("iE") as THREE.InstancedBufferAttribute).array as Float32Array;
    const Ff = (geom.getAttribute("iF") as THREE.InstancedBufferAttribute).array as Float32Array;

    let n = 0;
    const I = idx.current;
    const cols = I?.sheet.cols ?? 16;
    /** The row a card shows and its mirror: the walker's own clip (front shots only — a silhouette's front and back are
     *  one), mirrored by the clip's knob and, for variety, by the walker. */
    const cam = camera.position;
    const sideRows = CL.map((c, i) => (c.farSide ? i : -1)).filter((i) => i >= 0);
    const rowFor = (w: Walker, s: Stamp, far: number): { row: number; mirror: number } => {
      // far off and walking across the view: a profile clip, mirrored by the way they go
      if (L.tier.farSide && far > 0.5 && sideRows.length && !w.standing) {
        const rel = s.h - Math.atan2(cam.x - s.x, cam.z - s.z);
        const a = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(Math.sin(a)) > 0.6) {
          const row = byHash(sideRows, w.hash * 1.7);
          return { row, mirror: (CL[row]?.flip ? -1 : 1) * (a > 0 ? 1 : -1) };
        }
      }
      return { row: w.home, mirror: (CL[w.home]?.flip ? -1 : 1) * (frac(w.hash * 3.3) > 0.5 ? -1 : 1) };
    };
    /** A walker's place in the distance hierarchy: the tiers' multipliers blended by its distance from the eye. */
    const tierOf = (w: Walker) => {
      const Tr = L.tier;
      const d = Math.hypot(w.x - cam.x, w.z - cam.z);
      const ta = smooth01((d - (Tr.r1 - Tr.band / 2)) / Math.max(0.01, Tr.band));
      const tb = smooth01((d - (Tr.r2 - Tr.band / 2)) / Math.max(0.01, Tr.band));
      const m = (k: [number, number, number]) => k[0] + (k[1] - k[0]) * ta + (k[2] - k[1]) * tb;
      return { trail: m(Tr.trail), ink: m(Tr.ink), blur: m(Tr.blur), grad: m(Tr.grad), far: tb };
    };
    type Tier = ReturnType<typeof tierOf>;
    /** One card: a copy (or the body now) at its place, its age 0 … 1, the copy before it (for the stretch). */
    const put = (w: Walker, s: Stamp, alpha: number, prev: Stamp | null, u: number, T: Trail, Q: Tier) => {
      if (n >= MAX_CARDS || alpha < 0.004 || !I || w.home < 0) return;
      const pick = rowFor(w, s, Q.far);
      const set = CL[pick.row];
      // with age: scattered sideways (each copy its own way), grown or shrunk, risen or sunk, turned, faded in colour
      const seedA = frac(Math.sin(s.t * 12.9898 + w.hash * 78.233) * 43758.5453) * TAU;
      A[n * 4] = s.x + Math.sin(seedA) * T.scatter * u;
      A[n * 4 + 1] = s.z + Math.cos(seedA) * T.scatter * u;
      A[n * 4 + 2] = ((set?.height ?? 1.72) / Math.max(0.2, set?.fill ?? 1)) * (0.97 + 0.06 * w.hash) * (1 + (T.scale - 1) * u);
      A[n * 4 + 3] = alpha * (set?.ink ?? 1) * Q.ink;
      B[n * 4] = pick.row;
      const ph = (set?.reverse ? -s.ph : s.ph) + (set?.offset ?? 0);
      const pf = ((ph % 1) + 1) % 1;
      // (ping-pong: the frames forward, then back — the artist, 2026-11-23: "a->a리버스->a 로 재생해서 루프")
      B[n * 4 + 1] = set?.pingpong ? (pf < 0.5 ? 2 * pf : 2 - 2 * pf) * (cols - 1) + 0.5 : pf * cols;
      B[n * 4 + 2] = pick.mirror;
      B[n * 4 + 3] = s.h + L.yaw + T.turn * u;
      C[n * 4] = prev ? prev.x : 0;
      C[n * 4 + 1] = prev ? prev.z : 0;
      C[n * 4 + 2] = prev ? 1 : 0;
      C[n * 4 + 3] = T.rise * u + (set?.lift ?? 0);
      Dd[n * 4] = T.desat * u;
      Ff[n * 4] = T.blur * u + Q.blur;
      Ff[n * 4 + 1] = Q.grad;
      Ff[n * 4 + 2] = L.tier.farEye && Q.far > 0.5 ? 1 : 0;
      Dd[n * 4 + 1] = set?.tintAmt ?? 0;
      Dd[n * 4 + 2] = u;
      // the colour combination: one for all, or each walker their own
      Dd[n * 4 + 3] = L.gradPick > 0 ? L.gradPick - 1 : Math.floor(frac(w.hash * 7.91) * 5);
      Ee[n * 4] = set?.tint[0] ?? 0;
      Ee[n * 4 + 1] = set?.tint[1] ?? 0;
      Ee[n * 4 + 2] = set?.tint[2] ?? 0;
      Ee[n * 4 + 3] = set?.width ?? 1;
      n++;
    };
    const lerpStamp = (a: Stamp, b: Stamp, f: number): Stamp => {
      let dh = b.h - a.h;
      dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
      let dp = b.ph - a.ph;
      if (dp < -0.5) dp += 1;
      else if (dp > 0.5) dp -= 1;
      return { t: a.t + (b.t - a.t) * f, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + dh * f, ph: a.ph + dp * f };
    };
    for (const w of W) {
      const T = L.trails[stateOf(w)];
      const Q = tierOf(w);
      // the copies, oldest first, each reaching towards the one before it
      const list: { s: Stamp; age: number }[] = [];
      if (L.stamp) {
        // "슉": each sample left where it came; the body now sweeps from the last sample to where it is
        const s0 = w.stamps[0];
        for (let k = w.stamps.length - 1; k >= 1; k--) list.push({ s: w.stamps[k], age: now - w.stamps[k - 1].t });
        if (s0) {
          // the sweep at an even pace (an eased one pulsed every sample — the artist, 2026-11-23: "0.5로 맞춰도 0.02일 때처럼
          // 부드럽지는 않아"), and the walk's frames running on through it: the phase at the moment the place stands for
          const e = Math.min(1, Math.max(0, (now - s0.t) / Math.max(0.02, L.dashSec)));
          const from = w.stamps[1] ?? s0;
          let dh = s0.h - from.h;
          dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          const tAt = from.t + (s0.t - from.t) * e;
          // (the walker's own frame time — its speed over the clip's step — so the feet keep to the ground)
          const ph = from.ph + (tAt - from.t) / Math.max(1e-3, w.cycle);
          list.push({ s: { t: tAt, x: from.x + (s0.x - from.x) * e, z: from.z + (s0.z - from.z) * e, h: from.h + dh * e, ph }, age: 0 });
        }
      } else {
        for (let k = T.copies; k >= 1; k--) {
          const hh = histAt(w.hist, now - k * T.gap);
          if (hh) list.push({ s: hh, age: k * T.gap });
        }
        list.push({ s: { t: now, x: w.x, z: w.z, h: w.h, ph: w.ph }, age: 0 });
      }
      let prev: Stamp | null = null;
      let prevAlpha = 0;
      let prevAge = 0;
      const life = Math.max(0.05, T.life);
      for (const { s, age } of list) {
        const isNow = age === 0;
        const fade = isNow ? 1 : Math.pow(Math.max(0, 1 - age / life), L.fall);
        const alpha = (isNow ? L.ink : T.ink * Q.trail) * fade;
        // between this copy and the one before: frames of its own in between (place, step, way and age carried over)
        let last = prev;
        // (standing, copies stand on one spot: in-betweens there only when their age effects move them apart)
        if (prev && (L.between === 2 || L.between === 3) && (Math.hypot(s.x - prev.x, s.z - prev.z) > 1e-3 || T.rise !== 0 || T.scatter > 0)) {
          // 3 — BY THE CLIP'S OWN BEAT (the artist, 2026-11-23: "사이를 메우는 게, 걷는 속도랑 프레임 머무는 시간이랑 매치가
          // 되어야"): one card for each time a frame of the clip is held between the two copies — at the place the body
          // was then, the clip's next frame each (the phase counted on by time, never the short way round); 2 — a count
          const span = Math.max(0, s.t - prev.t);
          const nIn = L.between === 3 ? Math.min(80, Math.max(0, Math.round(span / Math.max(1e-3, w.gap)) - 1)) : Math.round(T.betweenN * Q.trail);
          for (let k = 1; k <= nIn; k++) {
            const f = k / (nIn + 1);
            const mid = lerpStamp(prev, s, f);
            // (the step counted on by time in both ways — a short-way-round blend ran the walk backwards)
            mid.ph = prev.ph + (f * span) / Math.max(1e-3, w.cycle);
            const ag = prevAge + (age - prevAge) * f;
            put(w, mid, (prevAlpha + (alpha - prevAlpha) * f) * T.betweenInk, last, Math.min(1, ag / life), T, Q);
            last = mid;
          }
        }
        put(w, s, alpha, last, Math.min(1, age / life), T, Q);
        prev = s;
        prevAlpha = alpha;
        prevAge = age;
      }
    }
    geom.instanceCount = n;
    // (a readout for the console, like __street)
    (window as unknown as { __frames?: unknown }).__frames = { cards: n, walkers: W.length, sheet: I ? I.sheet.rows.length : 0 };
    for (const name of ["iA", "iB", "iC", "iD", "iE", "iF"]) {
      const at = geom.getAttribute(name) as THREE.InstancedBufferAttribute;
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
    for (const m of [mat]) {
      const g = m.uniforms;
      g.uGradAmt.value = L.gradAmt;
      const pal = g.uPal.value as THREE.Color[];
      L.pals.forEach((hex, i) => pal[i]?.set(hex).convertSRGBToLinear());
      g.uGradScale.value = L.gradScale;
      g.uGradSpeed.value = L.gradSpeed;
      g.uGradDir.value = L.gradDir;
      g.uGradWarp.value = L.gradWarp;
      g.uTime.value = now;
      if (g.uEdgeTh) g.uEdgeTh.value = L.edgeTh;
      if (g.uEdgeW) g.uEdgeW.value = L.edgeW;
      if (g.uCon) g.uCon.value = L.con;
      if (g.uBright) g.uBright.value = L.bright;
    }
    const u = mat.uniforms;
    u.uFacing.value = L.facing === "eye" ? 0 : L.facing === "along" ? 1 : 2;
    u.uStretch.value = L.stretch;
    u.uSlit.value = L.slit;
    u.uStretchKind.value = L.stretchKind;
    u.uStreakSoft.value = L.streakSoft;
    u.uMultiply.value = L.multiply ? 1 : 0;
  });

  return (
    <>
      <OrbitControls ref={controls} makeDefault target={[0, 0.9, -L.dist]} enableDamping dampingFactor={0.12} />
      <mesh geometry={geom} material={mat} frustumCulled={false} />
      {L.floor && <gridHelper args={[40, 40, "#e4e4e4", "#efefef"]} position={[0, 0, -L.dist]} />}
    </>
  );
}

/** "#rrggbb" → linear rgb. */
function hexLin(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x141414;
  const c = (x: number) => Math.pow(x / 255, 2.2);
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}

/** The colour combinations' first colours (the artist makes her own over them): warm against blue; teal-violet-pink;
 *  orange on cream with black; moss and lime on paper; greys. */
const PALETTE_DEFAULTS: readonly (readonly [string, string, string])[] = [
  ["#ff4a2e", "#2b5dff", "#ffd23a"],
  ["#00c2a8", "#6a3cff", "#ff7ac6"],
  ["#ff6a00", "#ffe8c2", "#1a1a1a"],
  ["#2f6b3a", "#c8f560", "#f4f1e8"],
  ["#111111", "#8a8a8a", "#f0f0f0"],
];

const STATE_NAMES: Record<StateKey, string> = { walk: "이동 중", brisk: "경보", run: "뛰기", stand: "서 있을 때", talk: "소통 중" };
/** Each state's afterimages to begin with (the turn in degrees): walking and running leave a trail; standing ones blow
 *  away — rising, scattering, growing a little, fading and blurring (the artist: "서있을 때 잔상 날리는"). */
const TRAIL_DEFAULTS: Record<StateKey, Omit<Trail, "turn"> & { turn: number }> = {
  walk: { life: 2, ink: 0.45, copies: 10, gap: 0.12, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.08 },
  brisk: { life: 1.6, ink: 0.42, copies: 10, gap: 0.1, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.1 },
  run: { life: 1.2, ink: 0.4, copies: 10, gap: 0.08, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.12 },
  stand: { life: 3, ink: 0.35, copies: 8, gap: 0.35, betweenN: 4, betweenInk: 0.4, scale: 1.12, rise: 0.7, scatter: 0.5, turn: 12, desat: 0.4, blur: 0.22 },
  talk: { life: 2.5, ink: 0.4, copies: 8, gap: 0.3, betweenN: 4, betweenInk: 0.4, scale: 1.05, rise: 0.25, scatter: 0.25, turn: 0, desat: 0.2, blur: 0.15 },
};

const STATES: Record<string, ClipState> = { "이동 중 (걷기)": "walk", "경보 (빠른 걸음)": "brisk", "뛰기": "run", "서 있을 때 (머무름)": "stand", "소통 중 (말 걸기 · 응답)": "talk", "미지정": "none" };
const PATHS: Record<string, Path> = { "흩어진 군중 — 가까이부터 멀리까지 (나를 둘러)": "scatter", "가로지름 (옆으로 지나감)": "across", "원 (나를 둘러 돔)": "circle", "다가옴 · 멀어짐": "toward", "흩어진 산책": "wander" };
// (the artist, 2026-11-23: "본인 진행방향대로 프레임이 서야지, 지금은 나랑 무조건 정면인데" — the default stands each frame as the
// clip was shot: square to the way they walk; seen from the side the frames stand in a row along the path)
const FACINGS: Record<string, Facing> = { "진행 방향대로 (걷는 방향에 수직 — 영상이 찍힌 그대로)": "across", "진행 방향을 따라 (옆에서 정면)": "along", "나를 향함 (빌보드)": "eye" };

export default function FrameLab() {
  const G = LAB_GROUP.frames;
  const viewRef = useRef<string | null>("side");
  // THE CLIPS' OWN SETS (the artist, 2026-11-23: "영상마다 골라서 이동거리랑 프레임 간격 세트로 저장"): for each clip of the
  // sheet, how far a frame carries the body (m) and how long a frame is held (s) — speed = distance / interval. Saved with
  // the group, a pair of knobs a clip (keys by the clip's name, so a clip keeps its set when others are added)
  const [clips, setClips] = useState<{ id: string; strideSec: number; loop: number; lum: number; side: boolean; walking: boolean; fill: number }[]>([]);
  useEffect(() => {
    loadSpriteSheet()
      .then(({ index }) =>
        setClips(index.sheet.rows.map((r) => ({ id: r.id, strideSec: r.strideSec, loop: (r as { loop?: number }).loop ?? 1, lum: (r as { lum?: number }).lum ?? 0, side: r.view === "side", walking: (r as { walking?: boolean }).walking ?? true, fill: (r as { fill?: number }).fill ?? 1 }))),
      )
      .catch(() => undefined);
  }, []);
  const ck = (id: string) => id.replace(/[^A-Za-z0-9]/g, "_");
  const clipRoot = `${G}.클립 — 이동거리 · 프레임 간격`;
  const clipSchema = useMemo(() => {
    const s: Record<string, unknown> = {
      clipPick: { options: { "상태로 자동 (사람마다 그 상태의 클립 하나)": 0, ...Object.fromEntries(clips.map((c, i) => [`${i + 1} · ${c.id}`, i + 1])) }, value: 0, label: "쓰는 클립 (고정하면 모두 그 클립)" },
    };
    clips.forEach((c, i) => {
      // (defaults: what looked natural with the man's clip — 3.9 m/s with the frames at 3 × the clip's own tempo)
      const gap = c.strideSec / 16 / 3;
      s[`${i + 1} · ${c.id}`] = folder({
        // (walking in profile — the pipeline sees the feet spread wide — is not used by default: front shots only; a clip
        // whose legs do not walk starts as standing)
        [`ct_${ck(c.id)}`]: { options: STATES, value: (c.side ? "none" : c.walking ? "walk" : "stand") as ClipState, label: "언제 쓰나 (상태 · 미지정 = 안 씀)" },
        [`cf_${ck(c.id)}`]: { value: false, label: "좌우 뒤집기" },
        [`ch_${ck(c.id)}`]: { value: 1.72, min: 0.8, max: 2.3, step: 0.01, label: "키 (m)" },
        [`cw_${ck(c.id)}`]: { value: 1, min: 0.5, max: 1.8, step: 0.01, label: "폭 ×" },
        [`ci_${ck(c.id)}`]: { value: 1, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
        [`cy_${ck(c.id)}`]: { value: 0, min: -0.4, max: 0.4, step: 0.005, label: "발 높이 보정 (m)" },
        // (a bright body — a white matte — is invisible on white paper: dark by default)
        [`cc_${ck(c.id)}`]: { value: "#141414", label: "몸 색 칠하기 — 색" },
        [`ca_${ck(c.id)}`]: { value: c.lum > 0.7 ? 1 : 0, min: 0, max: 1, step: 0.05, label: "몸 색 칠하기 — 세기 (0 = 영상 그대로)" },
        [`cp_${ck(c.id)}`]: { value: 1, min: 0.05, max: 4, step: 0.01, label: "재생 빠르기 × (서 있음·소통에도)" },
        [`cb_${ck(c.id)}`]: { value: false, label: "왕복 재생 — a → 거꾸로 → a 루프" },
        [`cs_${ck(c.id)}`]: { value: c.side, label: "멀리서 옆모습으로 쓰기 (거리 위계의 먼 단계)" },
        [`cr_${ck(c.id)}`]: { value: false, label: "거꾸로 재생" },
        [`co_${ck(c.id)}`]: { value: 0, min: 0, max: 1, step: 0.01, label: "시작 위상 (0 … 1)" },
        // (finer steps — the artist: "한 프레임당 가는 거리 더 촘촘하게")
        // (the distance only for a moving clip: standing or talking, the frames' time and the playback speed say it all)
        [`cd_${ck(c.id)}`]: {
          value: +(3.9 * gap).toFixed(3),
          min: 0.001,
          max: 0.4,
          step: 0.001,
          label: "이동: 영상 한 장 동안 가는 거리 (m)",
          render: (get: (path: string) => unknown) => ["walk", "brisk", "run"].includes(String(get(`${clipRoot}.${i + 1} · ${c.id}.ct_${ck(c.id)}`))),
        },
        [`cg_${ck(c.id)}`]: { value: +gap.toFixed(3), min: 0.005, max: 0.5, step: 0.001, label: "영상 한 장이 머무는 시간 (s)" },
      });
    });
    return s;
  }, [clips]);
  const cs = useControls(clipRoot, savable(clipRoot, clipSchema) as Parameters<typeof useControls>[1], { collapsed: false }, [clips.length]) as unknown as Record<string, number>;
  const pick = Number(cs.clipPick ?? 0);
  const sets: ClipSet[] = clips.map((cl) => {
    const k = ck(cl.id);
    const raw = cs as unknown as Record<string, unknown>;
    return {
      id: cl.id,
      state: (raw[`ct_${k}`] as ClipState) ?? "walk",
      flip: !!raw[`cf_${k}`],
      dist: Number(raw[`cd_${k}`] ?? 0.15),
      gap: Number(raw[`cg_${k}`] ?? 0.04),
      height: Number(raw[`ch_${k}`] ?? 1.72),
      width: Number(raw[`cw_${k}`] ?? 1),
      ink: Number(raw[`ci_${k}`] ?? 1),
      lift: Number(raw[`cy_${k}`] ?? 0),
      tint: hexLin(String(raw[`cc_${k}`] ?? "#141414")),
      tintAmt: Number(raw[`ca_${k}`] ?? 0),
      reverse: !!raw[`cr_${k}`],
      play: Number(raw[`cp_${k}`] ?? 1),
      pingpong: !!raw[`cb_${k}`],
      fill: cl.fill,
      farSide: !!raw[`cs_${k}`],
      offset: Number(raw[`co_${k}`] ?? 0),
    };
  });
  const c = useControls(
    G,
    savable(G, {
      "보기": folder({
        "옆에서": button(() => {
          viewRef.current = "side";
        }),
        "뒤에서": button(() => {
          viewRef.current = "back";
        }),
        "앞에서": button(() => {
          viewRef.current = "front";
        }),
        "위에서": button(() => {
          viewRef.current = "top";
        }),
        "눈높이 (나)": button(() => {
          viewRef.current = "eye";
        }),
        flFloor: { value: false, label: "바닥 격자 (위치 가늠용)" },
      }),
      "사람": folder({
        flCount: { value: 3, min: 1, max: 24, step: 1, label: "사람 수" },
        flStand: { value: 0, min: 0, max: 1, step: 0.05, label: "멈춰 있는 사람의 몫 (서 있음·소통 클립)" },
        flSpeedMode: { options: { "클립 세트대로 (클립 맞추기)": 0, "사람마다 빠르기 지정 — 문턱 넘으면 뛰기": 1 }, value: 0, label: "빠르기 정하는 법" },
        flSpeedBase: { value: 1.6, min: 0.2, max: 8, step: 0.05, label: "빠르기 (m/s, 지정일 때)" },
        flSpeedVar: { value: 0.6, min: 0, max: 1, step: 0.05, label: "사람마다 빠르기 차이 (±)" },
        flBriskFrom: { value: 1.9, min: 0.5, max: 8, step: 0.05, label: "경보 문턱 (m/s) — 넘으면 '경보' 클립" },
        flRunFrom: { value: 2.5, min: 0.5, max: 8, step: 0.05, label: "뛰기 문턱 (m/s) — 넘으면 '뛰기' 클립" },
        flPath: { options: PATHS, value: "across" as Path, label: "길" },
        flSpread: { value: 1.6, min: 0, max: 6, step: 0.1, label: "사람 사이 간격 (m)" },
        flDist: { value: 6, min: 1, max: 20, step: 0.5, label: "나와의 거리 (m)" },
      }),
      // (the clips' sets above say how a body WALKS; this folder only says when copies of it are left behind)
      "잔상 남기기": folder({
        flStamp: { value: true, label: "표본마다 슉 — 위치가 도착할 때 쓸려 가며 그 자리에 잔상 (끄면: 이어 걷고 일정 시간마다 잔상)" },
        flSample: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: "슉: 위치가 도착하는 간격 (s)" },
        flDash: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: "슉 — 쓸려 가는 시간 (s)" },
        flFall: { value: 1.3, min: 0.3, max: 4, step: 0.05, label: "잔상이 옅어지는 곡선" },
        flInk: { value: 1, min: 0.1, max: 1, step: 0.05, label: "지금 몸의 진하기" },
      }),
      "거리 위계 — 가까이 · 중간 · 멀리": folder({
        flR1: { value: 6, min: 1, max: 30, step: 0.5, label: "가까이 → 중간 경계 (m)" },
        flR2: { value: 15, min: 2, max: 60, step: 0.5, label: "중간 → 멀리 경계 (m)" },
        flBand: { value: 3, min: 0.2, max: 10, step: 0.1, label: "경계에서 섞이는 폭 (m)" },
        flFarEye: { value: true, label: "멀리: 판이 나를 향함" },
        flFarSide: { value: true, label: "멀리: 가로지르면 옆모습 클립" },
        "가까이": folder({
          flNTrail: { value: 1, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
          flNInk: { value: 1, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
          flNBlur: { value: 0, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
          flNGrad: { value: 1, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
        }),
        "중간": folder({
          flMTrail: { value: 0.5, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
          flMInk: { value: 0.85, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
          flMBlur: { value: 0.04, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
          flMGrad: { value: 0.7, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
        }),
        "멀리": folder({
          flFTrail: { value: 0.15, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
          flFInk: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
          flFBlur: { value: 0.12, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
          flFGrad: { value: 0.3, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
        }),
      }),
      "늘어놓기": folder({
        flFacing: { options: FACINGS, value: "across" as Facing, label: "프레임이 서는 방향" },
        flYaw: { value: 0, min: -90, max: 90, step: 1, label: "판 기울기 — 진행 방향에서 튼 각도 (°)" },
        // (the artist, 2026-11-23: "사이 프레임은 박자보단 개수가 낫다")
        flBetween: { options: { "사이 프레임 — 개수로": 2, "사이 프레임 — 클립 박자대로 (영상 한 장마다 한 판)": 3, "없음": 0 }, value: 2, label: "잔상 사이 채우기" },
        // (by the clip's beat the count follows from the time between two copies and the clip's frame time)
        flStretch: { value: 1, min: 0, max: 1.5, step: 0.05, label: "늘어짐 — 나를 향함·진행 방향을 따라일 때만 (이전 프레임까지, 상대 각도만큼)" },
        flKind: { options: { "번짐 — 몸 가운데가 옆으로 끌림": 0, "프레임 자체가 넓어짐": 1 }, value: 0, label: "늘어나는 방식" },
        flSoft: { value: 0.8, min: 0.05, max: 4, step: 0.05, label: "번짐 길이 (프레임 폭)" },
        flEdge: { value: 0.15, min: 0, max: 0.95, step: 0.01, label: "테두리 지우기 — 알파 문턱 (옅은 테두리·네모를 날림)" },
        flEdgeW: { value: 0.15, min: 0.005, max: 0.8, step: 0.005, label: "테두리 단단함 — 작을수록 칼같이 (문턱 위 경사 폭)" },
        flCon: { value: 1, min: 0.2, max: 4, step: 0.05, label: "색 대비 ×" },
        flBright: { value: 0, min: -0.6, max: 0.6, step: 0.01, label: "밝기 ±" },
        flSlit: { value: 1, min: 0.05, max: 1, step: 0.01, label: "슬릿 — 프레임의 가운데 몫만 (1 = 전체)" },
        flMultiply: { value: true, label: "곱하기로 겹침 (끄면 보통 겹침)" },
      }),
      "안쪽 색 출렁임": folder({
        flGradAmt: { value: 0.8, min: 0, max: 1, step: 0.05, label: "세기 (0 = 원래 색)" },
        flGradPick: { options: { "사람마다 다르게": 0, "조합 1": 1, "조합 2": 2, "조합 3": 3, "조합 4": 4, "조합 5": 5 }, value: 1, label: "쓰는 색 조합" },
        ...Object.fromEntries(
          PALETTE_DEFAULTS.map((d, i) => [
            `조합 ${i + 1}`,
            folder(Object.fromEntries(d.map((hex, j) => [`flP${i + 1}${"abc"[j]}`, { value: hex, label: `색 ${j + 1}` }])), { collapsed: i > 0 }),
          ]),
        ),
        flGradDir: { options: { "높이를 따라 (세로로 흐르는 띠)": 0, "공간을 따라 (걸어가며 바뀜)": 1, "잔상의 나이를 따라 (지금 → 오래된 것)": 2 }, value: 0, label: "흐르는 방향" },
        flGradScale: { value: 1, min: 0.1, max: 6, step: 0.05, label: "물결 크기 (작을수록 넓게)" },
        flGradSpeed: { value: 1, min: 0, max: 6, step: 0.05, label: "출렁이는 속도" },
        flGradWarp: { value: 0.6, min: 0, max: 3, step: 0.05, label: "일렁임" },
      }),
      // the afterimages by state (each its own folder; standing ones blow away by default)
      ...Object.fromEntries(
        (Object.keys(TRAIL_DEFAULTS) as StateKey[]).map((st) => {
          const d = TRAIL_DEFAULTS[st];
          const k = (n: string) => `t_${st}_${n}`;
          return [
            `잔상 · ${STATE_NAMES[st]}`,
            folder(
              {
                [k("life")]: { value: d.life, min: 0.1, max: 10, step: 0.1, label: "남는 시간 (s)" },
                [k("ink")]: { value: d.ink, min: 0, max: 1, step: 0.05, label: "진하기" },
                [k("copies")]: { value: d.copies, min: 0, max: 60, step: 1, label: "일정 시간마다: 잔상 수" },
                [k("gap")]: { value: d.gap, min: 0.02, max: 1.5, step: 0.01, label: "일정 시간마다: 잔상 사이 시간 (s)" },
                [k("betweenN")]: { value: d.betweenN, min: 0, max: 30, step: 1, label: "사이 프레임 수" },
                [k("betweenInk")]: { value: d.betweenInk, min: 0, max: 1, step: 0.05, label: "사이 프레임 진하기 ×" },
                [k("scale")]: { value: d.scale, min: 0.3, max: 2.5, step: 0.01, label: "나이 들며: 크기 ×" },
                [k("rise")]: { value: d.rise, min: -2, max: 3, step: 0.01, label: "나이 들며: 떠오름 (+) · 가라앉음 (−) (m)" },
                [k("scatter")]: { value: d.scatter, min: 0, max: 4, step: 0.01, label: "나이 들며: 흩어짐 (m)" },
                [k("turn")]: { value: d.turn, min: -180, max: 180, step: 1, label: "나이 들며: 돌아감 (°)" },
                [k("desat")]: { value: d.desat, min: 0, max: 1, step: 0.05, label: "나이 들며: 색이 바램" },
                [k("blur")]: { value: d.blur, min: 0, max: 0.4, step: 0.005, label: "나이 들며: 흐려짐 (프레임 폭 비율)" },
              },
              { collapsed: st !== "walk" && st !== "stand" },
            ),
          ];
        }),
      ),
    }),
    { collapsed: false },
  ) as unknown as Record<string, unknown>;
  const L: Look = {
    count: Number(c.flCount),
    path: c.flPath as Path,
    spread: Number(c.flSpread),
    dist: Number(c.flDist),
    clips: sets,
    row: pick,
    standShare: Number(c.flStand),
    tier: {
      r1: Number(c.flR1),
      r2: Number(c.flR2),
      band: Number(c.flBand),
      farEye: !!c.flFarEye,
      farSide: !!c.flFarSide,
      trail: [Number(c.flNTrail), Number(c.flMTrail), Number(c.flFTrail)],
      ink: [Number(c.flNInk), Number(c.flMInk), Number(c.flFInk)],
      blur: [Number(c.flNBlur), Number(c.flMBlur), Number(c.flFBlur)],
      grad: [Number(c.flNGrad), Number(c.flMGrad), Number(c.flFGrad)],
    },
    speedMode: Number(c.flSpeedMode),
    speedBase: Number(c.flSpeedBase),
    speedVar: Number(c.flSpeedVar),
    runFrom: Number(c.flRunFrom),
    briskFrom: Number(c.flBriskFrom),
    yaw: (Number(c.flYaw) * Math.PI) / 180,
    between: Number(c.flBetween),
    trails: Object.fromEntries(
      (Object.keys(TRAIL_DEFAULTS) as StateKey[]).map((st) => {
        const d = TRAIL_DEFAULTS[st];
        const g = (n: keyof Trail) => Number(c[`t_${st}_${n}`] ?? d[n]);
        return [st, { life: g("life"), ink: g("ink"), copies: g("copies"), gap: g("gap"), betweenN: g("betweenN"), betweenInk: g("betweenInk"), scale: g("scale"), rise: g("rise"), scatter: g("scatter"), turn: (g("turn") * Math.PI) / 180, desat: g("desat"), blur: g("blur") }];
      }),
    ) as Record<StateKey, Trail>,
    gradAmt: Number(c.flGradAmt),
    pals: PALETTE_DEFAULTS.flatMap((d, i) => d.map((hex, j) => String(c[`flP${i + 1}${"abc"[j]}`] ?? hex))),
    gradPick: Number(c.flGradPick),
    edgeTh: Number(c.flEdge),
    edgeW: Number(c.flEdgeW),
    con: Number(c.flCon),
    bright: Number(c.flBright),
    gradScale: Number(c.flGradScale),
    gradSpeed: Number(c.flGradSpeed),
    gradDir: Number(c.flGradDir),
    gradWarp: Number(c.flGradWarp),
    stamp: !!c.flStamp,
    sampleSec: Number(c.flSample),
    dashSec: Number(c.flDash),
    fall: Number(c.flFall),
    ink: Number(c.flInk),
    facing: c.flFacing as Facing,
    stretch: Number(c.flStretch),
    stretchKind: Number(c.flKind),
    streakSoft: Number(c.flSoft),
    slit: Number(c.flSlit),
    multiply: !!c.flMultiply,
    floor: !!c.flFloor,
  };
  return (
    <div className="absolute inset-0 bg-white">
      <Canvas camera={{ position: [10, 1.5, -6], fov: 45, near: 0.05, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor("#ffffff", 1)}>
        <Scene L={L} viewRef={viewRef} />
      </Canvas>
    </div>
  );
}
