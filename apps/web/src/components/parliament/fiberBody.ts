/**
 * fiberBody — THE PERSON AS POINTS ON THEIR BONES, EACH POINT A FIBER OF WHERE IT WENT (the artist, 2026-11-23: "걍 3d 몸을
 * 점으로 하면 td 랑도 비슷해지고 … 흩날리는 효과도 넣을 수 있고 gpu 도 쓸만하고 … 잔흔 계산해서 다 남길필요없이 점 자체에 fiber
 * 효과도"). A TouchDesigner-like instancing of points on a skeleton:
 *
 *   - a few thousand points are sampled ONCE on the surface of the shared body's shapes (bodySheet.ts: the trunk, the
 *     coat, the hips, the limbs, the shoulders, the neck, the head, the hands, the shoes), each remembering only its bone
 *     (two joints), where along it, at what angle round it, and how thick the body is there;
 *   - every frame the GPU puts each point where that person's bones are (BodyPoses rows: their archetype's joints,
 *     girth and clothes, as for the ray-marched body) — three times: now, a little ago, longer ago;
 *   - each point is drawn as a FIBER through those three places (two segments, round ends): standing, a dot; walking,
 *     a thread of where it went — the walk's spacetime mass without a body drawn twice. Its tail fades and scatters;
 *     a share of the points come loose and drift away (흩날림), each on its own time;
 *   - multiplied on the white (overlaps darken), depth-tested, one draw for everyone.
 */

import * as THREE from "three";
import { WALK_CYCLES } from "@/lib/parliament/pointPeople";
import { HAIRS, HEMS, PANTS, SKINS, TOPS, standOf, type BodyPoses } from "./bodySheet";

/** The fibers' look (bodyArchetypes.bodyTuning.fiber). */
export interface FiberLook {
  /** Points a person (desktop; a phone takes ~40 %). */
  count: number;
  /** A point's size (mm of the body) and the least it is on screen (px). */
  sizeMm: number;
  minPx: number;
  /** How far back a fiber reaches (s) and how much ink its tail keeps (0 … 1). */
  sec: number;
  tail: number;
  /** A point's ink (0 … 1; multiplied, so overlapping points darken). */
  ink: number;
  /** How far a fiber's tail scatters (cm, at its end). */
  scatterCm: number;
  /** Loose points: the share that drift away, how far (m) and how fast (cycles/s). */
  flyShare: number;
  flyM: number;
  flySpeed: number;
  /** The clothes' colour in the fibers (× saturation). */
  sat: number;
}

export const DEFAULT_FIBER: FiberLook = { count: 1800, sizeMm: 22, minPx: 1.2, sec: 0.7, tail: 0.25, ink: 0.55, scatterCm: 8, flyShare: 0.06, flyM: 0.9, flySpeed: 0.35, sat: 1.2 };

// the kinds of shape a point sits on (the shader places it by kind)
const LIMB = 0, TRUNK = 1, HEAD = 2, COAT = 3, HIPS = 4, SHOULDER = 5, HAND = 6, SHOE = 7, NECK = 8, HAIR = 9;
// what a point is dressed in: 0 the top's cloth (arms, shoulders, coat), 1 the legs (pants under the hem), 2 skin, 3 shoe, 4 head, 5 trunk, 6 hair
const P_TOP = 0, P_LEG = 1, P_SKIN = 2, P_SHOE = 3, P_HEAD = 4, P_TRUNK = 5, P_HAIR = 6;

interface Piece {
  kind: number;
  a: number;
  b: number;
  part: number;
  r0: number;
  r1: number;
  area: number;
}

/** A seeded random. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The body's pieces with their surface areas (on the standing captured body), for sampling by area. */
function pieces(): Piece[] {
  const S = WALK_CYCLES.length ? standOf(WALK_CYCLES[0]) : null;
  const d = (i: number, j: number, fallback: number) => {
    if (!S) return fallback;
    const k = ["pelvis", "shoulders", "head", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const;
    const A = S[k[i]], B = S[k[j]];
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  };
  const cone = (len: number, r0: number, r1: number) => Math.PI * (r0 + r1) * len;
  const list: Piece[] = [];
  const add = (kind: number, a: number, b: number, part: number, r0: number, r1: number, area: number) => list.push({ kind, a, b, part, r0, r1, area });
  const trunkLen = Math.max(0.2, d(0, 1, 0.38) - 0.2);
  add(TRUNK, 0, 1, P_TRUNK, 0.128, 0.165, cone(trunkLen, 0.128 * 1.2, 0.165 * 1.2));
  add(COAT, 0, 1, P_TOP, 0.2, 0.175, cone(0.5, 0.24, 0.21) * 0.8);
  add(HIPS, 3, 4, P_LEG, 0.095, 0.095, 4 * Math.PI * 0.095 * 0.095 + cone(0.17, 0.095, 0.095));
  for (const [sh, el, wr] of [[11, 13, 15], [12, 14, 16]]) {
    add(SHOULDER, sh, sh, P_TOP, 0.06, 0.06, cone(0.12, 0.06, 0.06));
    add(LIMB, sh, el, P_TOP, 0.058, 0.047, cone(d(sh, el, 0.28), 0.058, 0.047));
    add(LIMB, el, wr, P_TOP, 0.046, 0.036, cone(d(el, wr, 0.25), 0.046, 0.036));
    add(HAND, el, wr, P_SKIN, 0.04, 0.04, 4 * Math.PI * 0.04 * 0.04);
  }
  for (const [hip, knee, ankle, toe] of [[3, 5, 7, 9], [4, 6, 8, 10]]) {
    add(LIMB, hip, knee, P_LEG, 0.08, 0.056, cone(d(hip, knee, 0.4), 0.08, 0.056));
    add(LIMB, knee, ankle, P_LEG, 0.055, 0.04, cone(d(knee, ankle, 0.4), 0.055, 0.04));
    add(SHOE, ankle, toe, P_SHOE, 0.048, 0.04, cone(0.2, 0.048, 0.04));
  }
  add(NECK, 1, 2, P_SKIN, 0.058, 0.05, cone(0.12, 0.058, 0.05));
  add(HEAD, 2, 2, P_HEAD, 0.09, 0.09, 4 * Math.PI * 0.095 * 0.095);
  // long hair (shown only for those whose cut has it): from the crown down behind the neck
  add(HAIR, 2, 1, P_HAIR, 0.084, 0.09, cone(0.22, 0.084, 0.09) * 0.6);
  return list;
}

/**
 * The fibers' base geometry: `count` points sampled on the body by area, each drawn as two quads (the fiber's two
 * segments: now → a little ago → longer ago). Attributes: aBone (joint a, joint b, kind, part), aShape (t, angle, r0,
 * r1), aRnd, aQuad (along −1/1, across −1/1, segment 0/1). Instanced per person (iNow, iMid, iOld, iRows).
 */
export function makeFiberGeometry(count: number, maxPeople: number): THREE.InstancedBufferGeometry {
  const P = pieces();
  const total = P.reduce((s, p) => s + p.area, 0);
  const r = rng(20261123);
  const n = Math.max(64, Math.round(count));
  const V = n * 8; // two segments × four corners
  const bone = new Float32Array(V * 4), shape = new Float32Array(V * 4), rnd = new Float32Array(V), quad = new Float32Array(V * 3);
  const index: number[] = [];
  // the points, piece by piece (by area), the rest to the trunk
  const per = P.map((p) => Math.floor((p.area / total) * n));
  per[0] += n - per.reduce((s, x) => s + x, 0);
  let i = 0;
  for (let pi = 0; pi < P.length; pi++) {
    const p = P[pi];
    for (let c = 0; c < per[pi]; c++, i++) {
      // where on the piece: along (t) and round (angle); a sphere's point by its height (t in −1 … 1)
      const sphere = p.kind === HEAD || p.kind === HAND;
      const t = sphere ? r() * 2 - 1 : r();
      const ang = r() * Math.PI * 2;
      const rr = r();
      for (let s = 0; s < 2; s++) {
        for (let q = 0; q < 4; q++) {
          const v = i * 8 + s * 4 + q;
          bone.set([p.a, p.b, p.kind, p.part], v * 4);
          shape.set([t, ang, p.r0, p.r1], v * 4);
          rnd[v] = rr;
          quad.set([q === 0 || q === 3 ? -1 : 1, q < 2 ? -1 : 1, s], v * 3);
        }
        const b = i * 8 + s * 4;
        index.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(index);
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  g.setAttribute("aBone", new THREE.BufferAttribute(bone, 4));
  g.setAttribute("aShape", new THREE.BufferAttribute(shape, 4));
  g.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
  g.setAttribute("aQuad", new THREE.BufferAttribute(quad, 3));
  for (const name of ["iNow", "iMid", "iOld", "iRows"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(maxPeople * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const lin = (c: readonly [number, number, number]) => new THREE.Vector3(...c.map((x) => Math.pow(x, 2.2)));

const FIBER_VERT = /* glsl */ `
uniform sampler2D uPoses;
uniform vec2 uView;        // the drawing buffer (px)
uniform float uSize;       // a point's size (m of the body)
uniform float uMinPx;
uniform float uScatter;    // the tail's scatter (m of the body)
uniform float uFlyShare, uFlyM, uFlySpeed, uTime;
attribute vec4 aBone;      // joint a, joint b, kind, part
attribute vec4 aShape;     // t, angle, r0, r1
attribute float aRnd;
attribute vec3 aQuad;      // along −1/1, across −1/1, segment 0/1
attribute vec4 iNow;       // world x, z, heading, world units a body metre
attribute vec4 iMid;
attribute vec4 iOld;
attribute vec4 iRows;      // pose rows now, mid, old; alpha
varying float vS;          // 0 at the point now … 1 at the fiber's end
varying vec2 vLoc;         // px from the segment's start along it, and across
varying float vLen;
varying float vW;
varying float vAlpha;
varying vec3 vCol;
uniform vec3 uTops[${TOPS.length}];
uniform vec3 uPants[${PANTS.length}];
uniform vec3 uHairs[${HAIRS.length}];
uniform vec3 uSkins[${SKINS.length}];
uniform float uSat;
const vec3 HEAD_C = vec3(0.0, 0.05, 0.03);
vec3 jt(int j, int r) { return texelFetch(uPoses, ivec2(j, r), 0).xyz; }
// (set by pointAt for a long-hair point: 1 when this person's cut has long hair)
float hairLong = 1.0;
float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
// a point of the body (its own metres) in the pose of row r; also its height on the body and whether it is face
vec3 pointAt(float rowF, out float hemY, out float face) {
  int r = int(rowF + 0.5);
  vec4 q = texelFetch(uPoses, ivec2(${17}, r), 0);
  vec4 g = texelFetch(uPoses, ivec2(${18}, r), 0);
  float build = q.x > 0.0 ? q.x : 1.0;
  float limb = g.x > 0.0 ? g.x : 1.0, girth = g.y > 0.0 ? g.y : 1.0, belly = g.z > 0.0 ? g.z : 1.0, headS = g.w > 0.0 ? g.w : 1.0;
  float cut = q.y;
  float rest = cut - floor(cut / 6.0 + 0.001) * 6.0;
  float hem = rest - floor(rest / 3.0 + 0.001) * 3.0;
  hemY = hem < 0.5 ? ${HEMS.waist.toFixed(3)} : (hem < 1.5 ? ${HEMS.hip.toFixed(3)} : ${HEMS.thigh.toFixed(3)});
  face = 0.0;
  int ja = int(aBone.x + 0.5), jb = int(aBone.y + 0.5);
  float kind = aBone.z;
  float t = aShape.x, ang = aShape.y;
  vec3 pel = jt(0, r);
  vec3 A, B;
  float rad = mix(aShape.z, aShape.w, clamp(t, 0.0, 1.0));
  float squash = 1.0;
  vec3 p;
  if (kind > 1.5 && kind < 2.5 || kind > 5.5 && kind < 6.5) {
    // a head or a hand: an ellipsoid round its centre, the point by its height (t) and angle
    vec3 c, rr;
    if (kind < 2.5) { c = jt(2, r) + HEAD_C * headS; rr = vec3(0.08, 0.108, 0.098) * headS; }
    else { vec3 e = jt(ja, r), w = jt(jb, r); c = w + normalize(w - e + vec3(1e-4)) * 0.06; rr = vec3(0.032, 0.05, 0.04) * mix(1.0, limb, 0.5); }
    float s = sqrt(max(0.0, 1.0 - t * t));
    vec3 dir = vec3(s * cos(ang), t, s * sin(ang));
    if (kind < 2.5) face = (dir.z > 0.3 && dir.y < 0.35) ? 1.0 : 0.0;
    p = c + dir * rr;
  } else {
    if (kind < 0.5) { A = jt(ja, r); B = jt(jb, r); rad *= (aBone.w > 0.5 && aBone.w < 1.5) || aBone.w < 0.5 ? limb : 1.0; }
    else if (kind < 1.5) { A = pel + vec3(0.0, 0.1, 0.0); B = jt(1, r) - vec3(0.0, 0.1, 0.0); rad = mix(0.128 * girth * belly, 0.165 * girth, t); squash = 1.0 / 1.45; }
    else if (kind < 3.5) {
      // the coat: from the hem to the chest, only when the top reaches below the waist
      A = vec3(pel.x, hemY, pel.z); B = jt(1, r) - vec3(0.0, 0.14, 0.0);
      rad = mix(hemY < 0.6 ? 0.205 : 0.19, 0.175, t) * girth * mix(1.0, belly, 0.5); squash = 1.0 / 1.35;
    }
    else if (kind < 4.5) { vec3 hc = 0.5 * (jt(3, r) + jt(4, r)) + vec3(0.0, 0.045, 0.0), hh = 0.425 * (jt(3, r) - jt(4, r)); A = hc + hh; B = hc - hh; rad *= girth * mix(1.0, belly, 0.5); }
    else if (kind < 5.5) { A = 0.5 * (jt(11, r) + jt(12, r)) + vec3(0.0, 0.03, 0.0); B = jt(ja, r) - vec3(0.0, 0.02, 0.0); rad *= mix(1.0, girth, 0.6); }
    else if (kind < 7.5) { A = jt(ja, r) - vec3(0.0, 0.02, 0.03); B = jt(jb, r) + vec3(0.0, 0.02, 0.0); }
    else if (kind < 8.5) { A = jt(1, r) - vec3(0.0, 0.03, 0.0); B = jt(2, r) + vec3(0.0, -0.01, 0.01); rad *= mix(1.0, girth, 0.5); }
    else { A = jt(2, r) + vec3(0.0, 0.06, -0.025) * headS; B = jt(1, r) + vec3(0.0, 0.0, -0.065); rad *= headS; hairLong = floor(cut / 6.0 + 0.001); }
    vec3 d = B - A;
    float L = max(length(d), 1e-4);
    vec3 ax = d / L;
    vec3 ref = abs(ax.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(cross(ax, ref)), v = cross(ax, u);
    vec3 off = (u * cos(ang) + v * sin(ang)) * rad;
    off.z *= squash;
    p = A + d * t + off;
  }
  p.x = pel.x + (p.x - pel.x) * build;
  return p;
}
vec3 toWorld(vec3 l, vec4 I) {
  float c = cos(I.z), s = sin(I.z);
  return vec3(I.x, 0.0, I.y) + vec3(l.x * c + l.z * s, l.y, -l.x * s + l.z * c) * I.w;
}
void main() {
  float hemY, face, h2, f2;
  float seg = aQuad.z;
  // the fiber's two ends for this segment: now → mid, or mid → old
  vec3 l0 = pointAt(seg < 0.5 ? iRows.x : iRows.y, hemY, face);
  vec3 l1 = pointAt(seg < 0.5 ? iRows.y : iRows.z, h2, f2);
  float s0 = seg * 0.5, s1 = s0 + 0.5;
  vec3 w0 = toWorld(l0, seg < 0.5 ? iNow : iMid);
  vec3 w1 = toWorld(l1, seg < 0.5 ? iMid : iOld);
  // the tail scatters (each point its own way); a share of the points come loose and drift off, each on its own time
  vec3 dir = normalize(vec3(hash1(aRnd * 3.1) - 0.5, hash1(aRnd * 5.7) - 0.35, hash1(aRnd * 9.3) - 0.5) + vec3(1e-4));
  w0 += dir * uScatter * iNow.w * s0 * s0;
  w1 += dir * uScatter * iNow.w * s1 * s1;
  float alpha = iRows.w;
  if (aRnd > 1.0 - uFlyShare) {
    float ph = fract(uTime * uFlySpeed * (0.6 + 0.8 * hash1(aRnd * 13.0)) + aRnd * 17.0);
    vec3 drift = (dir + vec3(0.0, 0.25, 0.0)) * uFlyM * iNow.w * ph;
    w0 += drift;
    w1 += drift;
    alpha *= 1.0 - ph * ph;
  }
  vec4 c0 = projectionMatrix * viewMatrix * vec4(w0, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(w1, 1.0);
  // to pixels; the width of a point at each end (its size in the body's metres seen from here)
  vec2 hv = 0.5 * uView;   // ("half" is reserved in GLSL)
  vec2 p0 = c0.xy / c0.w * hv, p1 = c1.xy / c1.w * hv;
  float k = projectionMatrix[1][1] * hv.y;
  float wd0 = max(uMinPx, uSize * iNow.w * k / max(c0.w, 1e-3));
  float wd1 = max(uMinPx, uSize * iNow.w * k / max(c1.w, 1e-3));
  vec2 dv = p1 - p0;
  float len = length(dv);
  vec2 dn = len > 1e-3 ? dv / len : vec2(1.0, 0.0);
  vec2 nn = vec2(-dn.y, dn.x);
  bool atEnd = aQuad.x > 0.0;
  float wd = atEnd ? wd1 : wd0;
  vec2 pp = (atEnd ? p1 + dn * wd * 0.5 : p0 - dn * wd * 0.5) + nn * aQuad.y * wd * 0.5;
  vec4 cc = atEnd ? c1 : c0;
  gl_Position = vec4(pp / hv * cc.w, cc.z, cc.w);
  float wa = 0.5 * (wd0 + wd1);
  vLoc = vec2(atEnd ? len + wa * 0.5 : -wa * 0.5, aQuad.y * wa * 0.5);
  vLen = len;
  vW = wa;
  vS = atEnd ? s1 : s0;
  vAlpha = (c0.w > 0.0 && c1.w > 0.0) ? alpha : 0.0;
  // the colour: the person's clothes (their own, or the palette), by where the point is on the body
  int r = int(iRows.x + 0.5);
  vec4 q = texelFetch(uPoses, ivec2(${17}, r), 0);
  vec4 own = texelFetch(uPoses, ivec2(${19}, r), 0);
  vec3 ownP = texelFetch(uPoses, ivec2(${20}, r), 0).rgb;
  float w = q.z;
  int ti = int(mod(w, 16.0) + 0.5); w = floor(w / 16.0 + 0.001);
  int pi = int(mod(w, 8.0) + 0.5); w = floor(w / 8.0 + 0.001);
  int hi = int(mod(w, 4.0) + 0.5); w = floor(w / 4.0 + 0.001);
  int si = int(w + 0.5);
  vec3 top = own.a > 0.5 ? own.rgb : uTops[ti];
  vec3 pants = own.a > 0.5 ? ownP : uPants[pi];
  float part = aBone.w;
  vec3 col;
  if (part < 0.5) col = top;
  else if (part < 1.5) col = l0.y > hemY ? top : pants;
  else if (part < 2.5) col = uSkins[si];
  else if (part < 3.5) col = vec3(0.012);
  else if (part < 4.5) col = face > 0.5 ? uSkins[si] : uHairs[hi];
  else if (part < 5.5) col = l0.y > hemY ? top : pants;
  else col = uHairs[hi];
  // the coat only when the top reaches below the waist; long hair only for those who have it
  if (aBone.z > 2.5 && aBone.z < 3.5 && hemY > 0.9) vAlpha = 0.0;
  if (aBone.z > 8.5 && hairLong < 0.5) vAlpha = 0.0;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vCol = clamp(mix(vec3(lum), col, uSat), 0.0, 1.0);
  // the floor is blown out: the feet melt into it
  vAlpha *= mix(0.35, 1.0, smoothstep(0.02, 0.45, l0.y));
}`;

const FIBER_FRAG = /* glsl */ `
uniform float uInk;
uniform float uTail;
uniform float uColour;
varying float vS;
varying vec2 vLoc;
varying float vLen;
varying float vW;
varying float vAlpha;
varying vec3 vCol;
void main() {
  if (vAlpha < 0.004) discard;
  // a round-ended thread: the distance to the segment, in its own half-widths
  float dx = max(0.0, max(-vLoc.x, vLoc.x - vLen));
  float d = length(vec2(dx, vLoc.y)) / max(vW * 0.5, 1e-3);
  float a = (1.0 - smoothstep(0.55, 1.0, d)) * vAlpha * uInk * mix(1.0, uTail, vS);
  if (a < 0.003) discard;
  vec3 col = mix(vec3(dot(vCol, vec3(0.299, 0.587, 0.114))), vCol, uColour);
  gl_FragColor = vec4(mix(vec3(1.0), col, clamp(a, 0.0, 1.0)), 1.0);
}`;

/** The fibers' material: multiplied on the white, depth-tested against the scene, both faces. */
export function makeFiberMaterial(poses: BodyPoses): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uPoses: { value: poses.texture },
      uView: { value: new THREE.Vector2(1, 1) },
      uSize: { value: 0.022 },
      uMinPx: { value: 1.2 },
      uScatter: { value: 0.08 },
      uFlyShare: { value: 0.06 },
      uFlyM: { value: 0.9 },
      uFlySpeed: { value: 0.35 },
      uTime: { value: 0 },
      uInk: { value: 0.55 },
      uTail: { value: 0.25 },
      uSat: { value: 1.2 },
      uColour: { value: 1 },
      uTops: { value: TOPS.map(lin) },
      uPants: { value: PANTS.map(lin) },
      uHairs: { value: HAIRS.map(lin) },
      uSkins: { value: SKINS.map(lin) },
    },
    vertexShader: FIBER_VERT,
    fragmentShader: FIBER_FRAG,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
  });
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.ZeroFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}
