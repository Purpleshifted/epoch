"use client";
/**
 * PointPeople — THE OTHERS AS WALKING POINT SILHOUETTES (the artist, 2026-11-22: the personal view should feel like a
 * 길거리; "네모 대신 현실 삶과 이어지는 느낌" — criswvr Synthetic Urban 9, vinils' 4D captures). Leva 개인뷰 비주얼 › 길거리.
 *
 * Every being within the view (the record's `far` list, RoleField → witnessRef, renewed with the fold) is a body of a
 * few hundred grey points in the shape of a walking person (lib/parliament/pointPeople.ts: a stride baked as frames of
 * the same points, read here as a float texture). The record gives a place every half second or so; between them the
 * body EASES to its latest place with a top speed and an acceleration, turns to face where it goes, and its stride
 * runs with its speed — standing, the legs come together and the body breathes. Where it has just been it may leave a
 * TIME SMEAR (vinils: "the distance between people is time"): copies of the body at its places over the last seconds,
 * fading. One draw call for all bodies and copies (instanced points); an optional faint standing PLATE behind each
 * body (criswvr) is a second, instanced mesh. Greys only — human traces are achromatic.
 *
 * Nothing here decides who is there or where they stand (RoleField's seat and fold); this only draws.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_WITNESS, nearestImage, rhythmOf, stepAt, type Other } from "@/lib/parliament";
import { DEFAULT_BODY, DEFAULT_MOTION, bakeWalk, jointsAt, stepPerson, strideLength, type MotionConfig, type PersonMotion } from "@/lib/parliament/pointPeople";
import { onLifeEvent } from "./lifeEvents";

export type PeopleMode = "boxes" | "points";

export interface PeopleLook {
  /** How the others are drawn (the artist, 2026-11-22 night: "깜빡이는 상자 속에서 사람 실루엣이 걸어가는 것처럼 … 점 낭비 안 해도
   *  되고"): "boxes" = the old blinking square, body-high, with a walking silhouette inside (a sprite sheet, one draw);
   *  "points" = the point bodies. */
  mode: PeopleMode;
  /** The box's width as a share of its height, and its grey while the melody rests (the old square's SQUARE_REST). */
  boxAspect: number;
  boxRest: number;
  /** Whoever asks me something is cued: their box (or body) grows and brightens while the question is open. */
  cue: boolean;
  /** Points a body is made of on a desktop, and on a phone (a prefix of the same body). */
  points: number;
  pointsPhone: number;
  /** THE SCALE: metres a world unit is (the artist, 2026-11-22: the bodies were too big beside the buildings' bays and
   *  the vegetation) — every length below in metres is divided by it. */
  scale: number;
  /** A point's size (metres, shrinking with distance; never under 1 px, never over `maxPx`). */
  dot: number;
  maxPx: number;
  /** The grey of the points (0 … 1). */
  grey: number;
  /** Height of an average body (metres); bodies differ by `variety`. */
  height: number;
  /** How different the bodies are (0 = all alike, 1 = ±8 % height, ±10 % build, ±15 % pace). */
  variety: number;
  /** The legs never cycle faster than this (strides/s). */
  maxCadence: number;
  /** The faint standing plate behind each body, and its opacity. */
  plate: boolean;
  plateAlpha: number;
  /** The time smear: how many seconds back the copies reach (0 = none), and how many copies. Off on a phone. */
  smearSec: number;
  smearCopies: number;
  /** Breathing of a standing body (0 … 1). */
  breath: number;
  /** Whether the scene's fog takes the points. */
  fog: boolean;
  /** Top speed on the way to a sample (world/s). */
  maxSpeed: number;
  /** Seconds after the last sample from which the body fades (its age); the record's own recent window. */
  recentSec: number;
  /** A standing body turns to face the nearest other within `faceRadius` (metres; a group stands together, not in a row). */
  faceEach: boolean;
  faceRadius: number;
  /** The visitor's own body (seen from behind in the eye view) in place of the square; its points blink their melody. */
  meBody: boolean;
  /** The body's brightness while its melody rests (1 = no blink). */
  meRest: number;
}

export const DEFAULT_PEOPLE: PeopleLook = { mode: "boxes", boxAspect: 0.55, boxRest: 0.22, cue: true, points: 480, pointsPhone: 200, scale: 2.5, dot: 0.07, maxPx: 6, grey: 0.78, height: 1.7, variety: 1, maxCadence: 2.2, plate: false, plateAlpha: 0.08, smearSec: 2.5, smearCopies: 6, breath: 1, fog: false, maxSpeed: 2.6, recentSec: 10, faceEach: true, faceRadius: 3, meBody: false, meRest: 0.4 };

/** The visitor, for their own body: where they stand and look (the controller's yaw), and their melody. */
export interface MeInput {
  get: () => { x: number; z: number; vx?: number; vz?: number; heading: number };
  rhythm: () => boolean[] | null;
}

const TAU = Math.PI * 2;
/** How fast a standing body turns to face someone (rad/s) — slower than a walker turns. */
const FACE_TURN = 1.5;

const MAX_PEOPLE = 96;
const MAX_COPIES = 8;
const MAX_INSTANCES = MAX_PEOPLE * (1 + MAX_COPIES);
/** A being gone from the list for this long (s) fades out and is dropped. */
const GONE_SEC = 2.5;
const FADE_SEC = 0.8;

interface Person extends PersonMotion {
  seen: number;
  /** 0 … 1 (the record's brightness × the fade when gone). */
  bright: number;
  alpha: number;
  trail: { x: number; z: number; heading: number; phase: number; t: number }[];
  lastTrailAt: number;
  hash: number;
  /** This body's own height factor, build factor and motion (variety). */
  hs: number;
  ws: number;
  motion: MotionConfig;
  /** Boxes: the silhouette walks leftwards on the screen (mirrored); kept while standing. */
  flip: number;
}

const SHEET_FRAMES = 16;
const SHEET_W = 48;
const SHEET_H = 96;

/**
 * The walking silhouette as a SPRITE SHEET: the stride's frames drawn side-on (the body walking to the right), white on
 * nothing, each frame SHEET_W × SHEET_H for a 1.9 m frame — the stroke of each limb is its thickness. Nearest-filtered:
 * the edge stays hard (brutal). Needs a document (a canvas).
 */
function walkSheet(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = SHEET_W * SHEET_FRAMES;
  c.height = SHEET_H;
  const g = c.getContext("2d")!;
  const k = SHEET_H / 1.9; // px a metre
  g.strokeStyle = "#fff";
  g.fillStyle = "#fff";
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let f = 0; f < SHEET_FRAMES; f++) {
    const J = jointsAt(f / SHEET_FRAMES);
    const ox = f * SHEET_W + SHEET_W / 2, oy = SHEET_H - 2;
    const X = (p: readonly number[]) => ox + p[2] * k;
    const Y = (p: readonly number[]) => oy - p[1] * k;
    const limb = (a: readonly number[], b: readonly number[], w: number) => {
      g.lineWidth = w * k;
      g.beginPath();
      g.moveTo(X(a), Y(a));
      g.lineTo(X(b), Y(b));
      g.stroke();
    };
    limb(J.hipR, J.kneeR, 0.13);
    limb(J.kneeR, J.ankleR, 0.11);
    limb(J.ankleR, J.toeR, 0.08);
    limb(J.shR, J.elbowR, 0.1);
    limb(J.elbowR, J.wristR, 0.08);
    limb(J.pelvis, J.shoulders, 0.3);
    limb(J.shoulders, J.head, 0.1);
    g.beginPath();
    g.arc(X(J.head), Y(J.head), 0.11 * k, 0, Math.PI * 2);
    g.fill();
    limb(J.hipL, J.kneeL, 0.13);
    limb(J.kneeL, J.ankleL, 0.11);
    limb(J.ankleL, J.toeL, 0.08);
    limb(J.shL, J.elbowL, 0.1);
    limb(J.elbowL, J.wristL, 0.08);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const BOX_VERT = /* glsl */ `
uniform float uFrames;
uniform float uAspect;
attribute vec4 iBox;      // x, z, height, flip
attribute vec4 iBoxAnim;  // phase, lit, alpha, cue
varying vec2 vUv;
varying float vLit;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float h = iBox.z;
  float w = h * uAspect;
  // a billboard: the box stands facing the eye, its foot on the ground
  vec4 mvPosition = modelViewMatrix * vec4(iBox.x, 0.0, iBox.y, 1.0);
  mvPosition.xy += vec2(position.x * w, position.y * h);
  gl_Position = projectionMatrix * mvPosition;
  float u = position.x + 0.5;
  if (iBox.w > 0.5) u = 1.0 - u;
  float f = floor(fract(iBoxAnim.x) * uFrames);
  vUv = vec2((f + u) / uFrames, position.y);
  vLit = iBoxAnim.y;
  vAlpha = iBoxAnim.z;
  #include <fog_vertex>
}`;

const BOX_FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform float uRest;
varying vec2 vUv;
varying float vLit;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  // the box blinks the being's melody as the square did (white on a beat, dark grey at rest); the silhouette inside is
  // the other way round, so it reads in both
  float s = texture2D(uSheet, vUv).a;
  vec3 box = mix(vec3(uRest), vec3(1.0), vLit);
  vec3 sil = mix(vec3(0.82), vec3(0.05), vLit);
  gl_FragColor = vec4(mix(box, sil, step(0.5, s)), vAlpha);
  #include <fog_fragment>
}`;

/** The same functions of a body's hash the vertex shader uses: its height and build factors (variety 0 … 1). */
const frac = (x: number) => x - Math.floor(x);
const heightFactor = (hash: number, variety: number) => 1 + variety * (0.16 * frac(hash * 7.31) - 0.08);
const buildFactor = (hash: number, variety: number) => 1 + variety * (0.2 * frac(hash * 13.7) - 0.1);
const paceFactor = (hash: number, variety: number) => 1 + variety * (0.3 * frac(hash * 3.17) - 0.15);

const VERT = /* glsl */ `
uniform sampler2D uBody;
uniform float uFrames;
uniform float uPoints;
uniform float uSize;
uniform float uScale;
uniform float uTime;
uniform float uBreath;
uniform float uVariety;
uniform float uMaxPx;
attribute float aPoint;
attribute vec4 iPos;   // x, cue (0 … 1), z, heading
attribute vec4 iAnim;  // phase, alpha, standing (0 … 1), hash
varying float vAlpha;
varying float vCue;
#include <fog_pars_vertex>
void main() {
  float f = fract(iAnim.x) * uFrames;
  float f0 = floor(f);
  float f1 = mod(f0 + 1.0, uFrames);
  float ft = f - f0;
  float u = (aPoint + 0.5) / uPoints;
  vec3 p0 = texture2D(uBody, vec2(u, (f0 + 0.5) / uFrames)).xyz;
  vec3 p1 = texture2D(uBody, vec2(u, (f1 + 0.5) / uFrames)).xyz;
  vec3 p = mix(p0, p1, ft);
  // this body's own height and build (the same functions of its hash as the CPU's stride uses)
  float hs = 1.0 + uVariety * (0.16 * fract(iAnim.w * 7.31) - 0.08);
  float ws = 1.0 + uVariety * (0.2 * fract(iAnim.w * 13.7) - 0.1);
  p.y *= hs;
  p.xz *= ws;
  // a standing body breathes: the chest rises a little, slowly, each in its own time
  float breath = uBreath * iAnim.z * 0.012 * sin(uTime * 1.3 + iAnim.w * 6.2832);
  p.y *= 1.0 + breath * smoothstep(0.6, 1.5, p.y / hs);
  // cued (asking me something): a little larger
  p *= 1.0 + 0.15 * iPos.y;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + vec3(iPos.x, 0.0, iPos.z);
  vCue = iPos.y;
  vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(uSize * (uScale / -mvPosition.z), 1.0, uMaxPx);
  vAlpha = iAnim.y;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uGrey;
varying float vAlpha;
varying float vCue;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(vec3(mix(uGrey, 1.0, vCue)), vAlpha);
  #include <fog_fragment>
}`;

/** The instanced draw's count and the uniforms are set through these (plain functions on the objects, every frame). */
function setInstanceCount(g: THREE.InstancedBufferGeometry, n: number): void {
  g.instanceCount = n;
}
function setUniforms(u: Record<string, THREE.IUniform>, values: Record<string, unknown>): void {
  for (const k in values) u[k].value = values[k];
}

function idHash(o: string): number {
  let h = 0;
  for (let i = 0; i < o.length; i++) h = (Math.imul(h, 31) + o.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export function PointPeople({
  getOthers,
  playerPosRef,
  look = DEFAULT_PEOPLE,
  phone = false,
  me: selfIn,
  viewFog = false,
}: {
  /** Everyone within the view, nearest first (the record's `far`); null before the first fold. */
  getOthers: () => readonly Other[] | null;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  look?: PeopleLook;
  /** A phone: fewer points a body, no smear. */
  phone?: boolean;
  /** The visitor themself (drawn as a body when look.meBody). */
  me?: MeInput;
  /** 시야 반경: the points take the scene's fog whatever look.fog says. */
  viewFog?: boolean;
}) {
  const fogOn = look.fog || !!viewFog;
  const points = Math.max(32, Math.round(phone ? look.pointsPhone : look.points));
  const copies = phone || look.smearSec <= 0 ? 0 : Math.min(MAX_COPIES, Math.max(0, Math.round(look.smearCopies)));
  const frames = DEFAULT_BODY.frames;
  // metres → world units
  const k = 1 / Math.max(0.1, look.scale);
  const heightU = look.height * k;

  // the stride as a float texture: one row a frame, one texel a point (an average body; each differs by its hash)
  const body = useMemo(() => {
    const data = bakeWalk({ ...DEFAULT_BODY, points, height: heightU });
    const t = new THREE.DataTexture(data, points, frames, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [points, frames, heightU]);

  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    // the base: one vertex a point of the body (its index); a position is needed for the draw count only
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 3), 3));
    const idx = new Float32Array(points);
    for (let i = 0; i < points; i++) idx[i] = i;
    g.setAttribute("aPoint", new THREE.BufferAttribute(idx, 1));
    g.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iAnim", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [points]);

  // the boxes: a billboard quad an instance, the walking silhouette as a sprite sheet
  const sheet = useMemo(() => walkSheet(), []);
  const boxGeom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("iBox", new THREE.InstancedBufferAttribute(new Float32Array(MAX_PEOPLE * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iBoxAnim", new THREE.InstancedBufferAttribute(new Float32Array(MAX_PEOPLE * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const boxMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSheet: { value: null }, uFrames: { value: SHEET_FRAMES }, uAspect: { value: 0.55 }, uRest: { value: 0.22 } }]),
        vertexShader: BOX_VERT,
        fragmentShader: BOX_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: fogOn,
      }),
    [fogOn],
  );
  useEffect(
    () => () => {
      boxGeom.dispose();
      boxMat.dispose();
      sheet.dispose();
    },
    [boxGeom, boxMat, sheet],
  );
  // whoever asks me something (the record's lines, as RoleField hears them for the sound): cued while the question is open
  const asking = useRef(new Map<string, number>());
  useEffect(
    () =>
      onLifeEvent((e) => {
        if ((e.kind === "word.new" || e.kind === "word.asked") && e.who) asking.current.set(e.who, performance.now() + DEFAULT_WITNESS.askOpenSec * 1000);
        else if (e.kind === "word.answered" && e.who) asking.current.delete(e.who);
      }),
    [],
  );

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uBody: { value: null }, uFrames: { value: frames }, uPoints: { value: points }, uSize: { value: look.dot }, uScale: { value: 400 }, uTime: { value: 0 }, uBreath: { value: 1 }, uGrey: { value: look.grey }, uVariety: { value: 1 }, uMaxPx: { value: 6 } },
        ]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        fog: fogOn,
      }),
    // (the material is remade only when the fog switch or the body changes; the size and grey are set per frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fogOn, points, frames],
  );
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
      body.dispose();
    },
    [geom, mat, body],
  );

  // the plates (criswvr): one faint standing quad behind each body
  const plateMesh = useRef<THREE.InstancedMesh>(null);
  const plateGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => plateGeom.dispose(), [plateGeom]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const s3 = useMemo(() => new THREE.Vector3(), []);

  const people = useRef(new Map<string, Person>());
  const lastList = useRef<readonly Other[] | null>(null);
  const motion = useMemo<MotionConfig>(() => ({ ...DEFAULT_MOTION, maxSpeed: look.maxSpeed, stride: strideLength(heightU), maxCadence: look.maxCadence }), [look.maxSpeed, heightU, look.maxCadence]);
  /** This body's own motion: its pace and its stride follow its height and pace factors. */
  const motionOf = (hash: number): MotionConfig => {
    const hs = heightFactor(hash, look.variety), pace = paceFactor(hash, look.variety);
    return { ...motion, maxSpeed: motion.maxSpeed * pace, accel: motion.accel * pace, stride: motion.stride * hs, turnRate: motion.turnRate * (0.8 + 0.4 * frac(hash * 5.3)) };
  };
  // the visitor's own body (look.meBody): its stride runs with their speed; its points blink their melody
  const self = useRef({ phase: 0, breathe: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    const me = playerPosRef.current;
    const P = people.current;
    // the record's latest places (a new list after every fold)
    const list = getOthers();
    if (list && list !== lastList.current) {
      lastList.current = list;
      for (const o of list) {
        const tx = nearestImage(o.x, me.x), tz = nearestImage(o.z, me.z);
        const bright = Math.exp(-o.ageSec / Math.max(0.1, look.recentSec));
        const p = P.get(o.o);
        if (!p) {
          if (P.size >= MAX_PEOPLE) continue;
          const h = idHash(o.o);
          P.set(o.o, { x: tx, z: tz, vx: 0, vz: 0, heading: h * Math.PI * 2, phase: h, tx, tz, seen: now, bright, alpha: 0, trail: [], lastTrailAt: now, hash: h, hs: heightFactor(h, look.variety), ws: buildFactor(h, look.variety), motion: motionOf(h), flip: 0 });
        } else {
          // the record's place is drawn where it lies round the walker (the world wraps): a far jump is the wrap, not a walk
          p.tx = tx;
          p.tz = tz;
          p.seen = now;
          p.bright = bright;
        }
      }
    }
    // every body moves on; a gone one fades and is dropped
    const iPos = geom.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    const iAnim = geom.getAttribute("iAnim") as THREE.InstancedBufferAttribute;
    const A = iPos.array as Float32Array, B = iAnim.array as Float32Array;
    const iBox = boxGeom.getAttribute("iBox") as THREE.InstancedBufferAttribute;
    const iBoxAnim = boxGeom.getAttribute("iBoxAnim") as THREE.InstancedBufferAttribute;
    const BX = iBox.array as Float32Array, BY = iBoxAnim.array as Float32Array;
    const boxes = look.mode === "boxes";
    let n = 0, nb = 0;
    const plates = plateMesh.current;
    let np = 0;
    const smearEvery = copies > 0 ? look.smearSec / copies : Infinity;
    // the melody's step now, and the eye's right (for which way a silhouette walks on the screen)
    const step = stepAt(performance.now());
    const cm = state.camera.matrixWorld.elements;
    const rightX = cm[0], rightZ = cm[2];
    const nowMs = performance.now();
    for (const [id, p] of P) {
      const gone = now - p.seen > GONE_SEC;
      if (gone && p.alpha <= 0.01) {
        P.delete(id);
        continue;
      }
      // the wrap: if the walker crossed the edge since, the body's place is re-imaged beside its target
      if (Math.abs(p.x - p.tx) > motion.snapDist || Math.abs(p.z - p.tz) > motion.snapDist) {
        p.x = p.tx;
        p.z = p.tz;
        p.trail.length = 0;
      }
      stepPerson(p, dt, p.motion);
      // standing near someone, the body turns to face the nearest of them (slowly): a group, not a row
      if (look.faceEach && Math.hypot(p.vx, p.vz) < motion.standBelow) {
        let best: Person | null = null, bd = look.faceRadius * k;
        for (const q of P.values()) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        if (best) {
          let diff = Math.atan2(best.x - p.x, best.z - p.z) - p.heading;
          diff = ((((diff + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          const maxTurn = FACE_TURN * dt;
          p.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
        }
      }
      const target = gone ? 0 : p.bright;
      p.alpha += (target - p.alpha) * Math.min(1, dt / FADE_SEC) * (gone ? 1 : 3);
      const speed = Math.hypot(p.vx, p.vz);
      const standing = 1 - Math.min(1, speed / motion.standBelow);
      // the smear: a copy of the body where it was, every smearEvery seconds, kept smearSec
      if (copies > 0) {
        if (now - p.lastTrailAt >= smearEvery && speed > motion.standBelow * 0.5) {
          p.lastTrailAt = now;
          p.trail.push({ x: p.x, z: p.z, heading: p.heading, phase: p.phase, t: now });
          if (p.trail.length > copies) p.trail.shift();
        }
        while (p.trail.length && now - p.trail[0].t > look.smearSec) p.trail.shift();
      } else if (p.trail.length) p.trail.length = 0;
      const askUntil = asking.current.get(id);
      const cue = look.cue && askUntil !== undefined && nowMs < askUntil ? 1 : 0;
      if (boxes) {
        if (nb < MAX_PEOPLE) {
          // which way the silhouette walks on the screen: with the eye's right, or mirrored; a standing one keeps its way
          const along = p.vx * rightX + p.vz * rightZ;
          if (speed > motion.standBelow) p.flip = along < 0 ? 1 : 0;
          BX[nb * 4] = p.x;
          BX[nb * 4 + 1] = p.z;
          BX[nb * 4 + 2] = heightU * p.hs * (1 + 0.2 * cue);
          BX[nb * 4 + 3] = p.flip;
          BY[nb * 4] = p.phase;
          BY[nb * 4 + 1] = rhythmOf(id)[step] ? 1 : 0;
          BY[nb * 4 + 2] = p.alpha;
          BY[nb * 4 + 3] = cue;
          nb++;
        }
      } else if (n < MAX_INSTANCES) {
        A[n * 4] = p.x;
        A[n * 4 + 1] = cue;
        A[n * 4 + 2] = p.z;
        A[n * 4 + 3] = p.heading;
        B[n * 4] = p.phase;
        B[n * 4 + 1] = p.alpha;
        B[n * 4 + 2] = standing;
        B[n * 4 + 3] = p.hash;
        n++;
      }
      if (boxes) p.trail.length = 0;
      for (const c of p.trail) {
        if (n >= MAX_INSTANCES) break;
        const age = (now - c.t) / Math.max(0.1, look.smearSec);
        A[n * 4] = c.x;
        A[n * 4 + 1] = 0;
        A[n * 4 + 2] = c.z;
        A[n * 4 + 3] = c.heading;
        B[n * 4] = c.phase;
        B[n * 4 + 1] = p.alpha * 0.55 * (1 - age) * (1 - age);
        B[n * 4 + 2] = 0;
        B[n * 4 + 3] = p.hash;
        n++;
      }
      if (plates && look.plate && np < MAX_PEOPLE) {
        v3.set(p.x, heightU * p.hs * 0.56, p.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        s3.set(0.95 * heightU * p.ws * (1 / 1.7), heightU * p.hs * 1.12, 1);
        m4.compose(v3, q, s3);
        plates.setMatrixAt(np, m4);
        np++;
      }
    }
    // THE VISITOR'S OWN BODY (the artist, 2026-11-22: with the eye at a person's height, must "me" be a square in front
    // of the gaze? — and then how is the melody carried?): their back, a body like the others, walking as they walk;
    // its points go dim while their melody rests and bright on its beats (the square's blink, carried by the body)
    if (selfIn && look.meBody && !boxes && n < MAX_INSTANCES) {
      const m = selfIn.get();
      const speed = Math.hypot(m.vx ?? 0, m.vz ?? 0);
      const s = self.current;
      if (speed > motion.standBelow) s.phase = (s.phase + Math.min(motion.maxCadence, speed / motion.stride) * dt) % 1;
      else {
        const target = s.phase > 0.25 && s.phase < 0.75 ? 0.5 : s.phase < 0.5 ? 0 : 1;
        s.phase += (target - s.phase) * Math.min(1, 6 * dt);
        if (s.phase >= 1) s.phase -= 1;
      }
      const r = selfIn.rhythm();
      const lit = !r || r[stepAt(performance.now())];
      A[n * 4] = m.x;
      A[n * 4 + 1] = 0;
      A[n * 4 + 2] = m.z;
      A[n * 4 + 3] = m.heading;
      B[n * 4] = s.phase;
      B[n * 4 + 1] = lit ? 1 : look.meRest;
      B[n * 4 + 2] = 1 - Math.min(1, speed / motion.standBelow);
      B[n * 4 + 3] = 0.5;
      n++;
    }
    setInstanceCount(geom, n);
    iPos.addUpdateRange(0, n * 4);
    iAnim.addUpdateRange(0, n * 4);
    iPos.needsUpdate = true;
    iAnim.needsUpdate = true;
    setInstanceCount(boxGeom, nb);
    iBox.addUpdateRange(0, nb * 4);
    iBoxAnim.addUpdateRange(0, nb * 4);
    iBox.needsUpdate = true;
    iBoxAnim.needsUpdate = true;
    setUniforms(boxMat.uniforms, { uSheet: sheet, uAspect: look.boxAspect, uRest: look.boxRest });
    if (plates) {
      plates.count = look.plate ? np : 0;
      if (np) plates.instanceMatrix.needsUpdate = true;
    }
    setUniforms(mat.uniforms, { uBody: body, uSize: look.dot * k, uMaxPx: look.maxPx, uGrey: look.grey, uBreath: look.breath, uVariety: look.variety, uTime: now, uScale: (state.size.height * state.viewport.dpr) / 2 });
    // a readout for the console (like __parliament): how many bodies and copies are drawn, and the nearest body
    let nearest: { d: number; x: number; z: number; speed: number } | null = null;
    for (const p of P.values()) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (!nearest || d < nearest.d) nearest = { d: +d.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), speed: +Math.hypot(p.vx, p.vz).toFixed(2) };
    }
    (window as unknown as { __street?: unknown }).__street = { mode: look.mode, people: P.size, instances: boxes ? nb : n, points, copies, nearest, me: { x: +me.x.toFixed(1), z: +me.z.toFixed(1) } };
  });

  return (
    <>
      {look.mode === "boxes" ? <mesh geometry={boxGeom} material={boxMat} frustumCulled={false} renderOrder={9} /> : <points geometry={geom} material={mat} frustumCulled={false} renderOrder={9} />}
      {look.plate && look.mode === "points" && (
        <instancedMesh ref={plateMesh} args={[plateGeom, undefined, MAX_PEOPLE]} frustumCulled={false} renderOrder={8}>
          <meshBasicMaterial color="#ffffff" transparent opacity={look.plateAlpha} depthWrite={false} side={THREE.DoubleSide} fog={fogOn} />
        </instancedMesh>
      )}
    </>
  );
}
