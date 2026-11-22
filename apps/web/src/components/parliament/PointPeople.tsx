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
import { nearestImage, type Other } from "@/lib/parliament";
import { DEFAULT_BODY, DEFAULT_MOTION, bakeWalk, stepPerson, strideLength, type PersonMotion } from "@/lib/parliament/pointPeople";

export interface PeopleLook {
  /** Points a body is made of on a desktop, and on a phone (a prefix of the same body). */
  points: number;
  pointsPhone: number;
  /** A point's size (world units, shrinking with distance; never under 1 px). */
  dot: number;
  /** The grey of the points (0 … 1). */
  grey: number;
  /** Height of a body (world units = metres). */
  height: number;
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
  /** A standing body turns to face the nearest other within `faceRadius` (a group stands together, not in a row). */
  faceEach: boolean;
  faceRadius: number;
}

export const DEFAULT_PEOPLE: PeopleLook = { points: 480, pointsPhone: 200, dot: 0.045, grey: 0.78, height: 1.7, plate: false, plateAlpha: 0.08, smearSec: 2.5, smearCopies: 6, breath: 1, fog: false, maxSpeed: 2.6, recentSec: 10, faceEach: true, faceRadius: 3 };

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
}

const VERT = /* glsl */ `
uniform sampler2D uBody;
uniform float uFrames;
uniform float uPoints;
uniform float uSize;
uniform float uScale;
uniform float uTime;
uniform float uBreath;
attribute float aPoint;
attribute vec4 iPos;   // x, y, z, heading
attribute vec4 iAnim;  // phase, alpha, standing (0 … 1), hash
varying float vAlpha;
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
  // a standing body breathes: the chest rises a little, slowly, each in its own time
  float breath = uBreath * iAnim.z * 0.012 * sin(uTime * 1.3 + iAnim.w * 6.2832);
  p.y *= 1.0 + breath * smoothstep(0.6, 1.5, p.y);
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + iPos.xyz;
  vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(1.0, uSize * (uScale / -mvPosition.z));
  vAlpha = iAnim.y;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uGrey;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(vec3(uGrey), vAlpha);
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
}: {
  /** Everyone within the view, nearest first (the record's `far`); null before the first fold. */
  getOthers: () => readonly Other[] | null;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  look?: PeopleLook;
  /** A phone: fewer points a body, no smear. */
  phone?: boolean;
}) {
  const points = Math.max(32, Math.round(phone ? look.pointsPhone : look.points));
  const copies = phone || look.smearSec <= 0 ? 0 : Math.min(MAX_COPIES, Math.max(0, Math.round(look.smearCopies)));
  const frames = DEFAULT_BODY.frames;

  // the stride as a float texture: one row a frame, one texel a point
  const body = useMemo(() => {
    const data = bakeWalk({ ...DEFAULT_BODY, points, height: look.height });
    const t = new THREE.DataTexture(data, points, frames, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [points, frames, look.height]);

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

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uBody: { value: null }, uFrames: { value: frames }, uPoints: { value: points }, uSize: { value: look.dot }, uScale: { value: 400 }, uTime: { value: 0 }, uBreath: { value: 1 }, uGrey: { value: look.grey } },
        ]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        fog: look.fog,
      }),
    // (the material is remade only when the fog switch or the body changes; the size and grey are set per frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [look.fog, points, frames],
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
  const motion = useMemo(() => ({ ...DEFAULT_MOTION, maxSpeed: look.maxSpeed, stride: strideLength(look.height) }), [look.maxSpeed, look.height]);

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
          P.set(o.o, { x: tx, z: tz, vx: 0, vz: 0, heading: h * Math.PI * 2, phase: h, tx, tz, seen: now, bright, alpha: 0, trail: [], lastTrailAt: now, hash: h });
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
    let n = 0;
    const plates = plateMesh.current;
    let np = 0;
    const smearEvery = copies > 0 ? look.smearSec / copies : Infinity;
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
      stepPerson(p, dt, motion);
      // standing near someone, the body turns to face the nearest of them (slowly): a group, not a row
      if (look.faceEach && Math.hypot(p.vx, p.vz) < motion.standBelow) {
        let best: Person | null = null, bd = look.faceRadius;
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
      if (n < MAX_INSTANCES) {
        A[n * 4] = p.x;
        A[n * 4 + 1] = 0;
        A[n * 4 + 2] = p.z;
        A[n * 4 + 3] = p.heading;
        B[n * 4] = p.phase;
        B[n * 4 + 1] = p.alpha;
        B[n * 4 + 2] = standing;
        B[n * 4 + 3] = p.hash;
        n++;
      }
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
        v3.set(p.x, look.height * 0.56, p.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        s3.set(0.95 * (look.height / 1.7), look.height * 1.12, 1);
        m4.compose(v3, q, s3);
        plates.setMatrixAt(np, m4);
        np++;
      }
    }
    setInstanceCount(geom, n);
    iPos.addUpdateRange(0, n * 4);
    iAnim.addUpdateRange(0, n * 4);
    iPos.needsUpdate = true;
    iAnim.needsUpdate = true;
    if (plates) {
      plates.count = look.plate ? np : 0;
      if (np) plates.instanceMatrix.needsUpdate = true;
    }
    setUniforms(mat.uniforms, { uBody: body, uSize: look.dot, uGrey: look.grey, uBreath: look.breath, uTime: now, uScale: (state.size.height * state.viewport.dpr) / 2 });
    // a readout for the console (like __parliament): how many bodies and copies are drawn, and the nearest body
    let nearest: { d: number; x: number; z: number; speed: number } | null = null;
    for (const p of P.values()) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (!nearest || d < nearest.d) nearest = { d: +d.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), speed: +Math.hypot(p.vx, p.vz).toFixed(2) };
    }
    (window as unknown as { __street?: unknown }).__street = { people: P.size, instances: n, points, copies, nearest, me: { x: +me.x.toFixed(1), z: +me.z.toFixed(1) } };
  });

  return (
    <>
      <points geometry={geom} material={mat} frustumCulled={false} renderOrder={9} />
      {look.plate && (
        <instancedMesh ref={plateMesh} args={[plateGeom, undefined, MAX_PEOPLE]} frustumCulled={false} renderOrder={8}>
          <meshBasicMaterial color="#ffffff" transparent opacity={look.plateAlpha} depthWrite={false} side={THREE.DoubleSide} fog={look.fog} />
        </instancedMesh>
      )}
    </>
  );
}
