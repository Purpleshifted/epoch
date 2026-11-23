/**
 * futureWindows — THE FUTURE STAYS WITH ITS OBSERVER (the artist, 2026-11-22 night, of the frames that flew at her:
 * "미래를 허공에 이렇게 발사하는 느낌은 원한 게 아니었는데... 미래 모습은 그냥 미래 관찰자 창을 더 크게 해서 미래 관찰자가
 * 지나간 자리에 남고, 일정 범위 이상 가까우면 현재에 겹쳐서 내 화면이 꽉 차게 그 시야각을 보여주도록").
 *
 * ① The future round the visitor (the encounter's sampling of it, never drawn itself) is taken every frame from the
 *   visitor's own eye into one small picture — ink, added up, as the frames' (futureFrames.ts).
 * ② THE OBSERVER IS A WINDOW, large: a body's shape (or a plain sheet) through which that picture shows, each pixel
 *   where it belongs on the screen — so what is in the window is the future standing exactly behind it.
 * ③ IT LEAVES WINDOWS WHERE IT HAS PASSED: every so far along its walk one more stands where it was, in the stride it
 *   had there, and stays a while before it fades.
 * ④ NEAR ONE, THE FUTURE FILLS THE SCREEN: within a distance of any window the same picture is laid over the whole
 *   present, the more the nearer — the visitor's own view, as it will be.
 *
 * Nothing flies. Cost: one small offscreen pass a frame while a window stands, ≤ 12 windows (a draw call each), one
 * full-screen sheet.
 */

import * as THREE from "three";
import type { FuturePresenceVisual } from "./FuturePresence";
import { CAPTURE_FRAG, CAPTURE_VERT } from "./futureFrames";
import { BODY_BOX, BODY_GLSL, BodyPoses, cycleOf, makeBodyGeometry, personCode, poseOf } from "./bodySheet";
import { LongExposure, exposureRate } from "./longExposure";
import { EXPOSE_GLSL, EXPOSURE_LAYER, paperLook } from "./paperLook";
import { markSpan } from "./usePerfMeter";

export const WINDOWS_MAX = 12;

/** How a pixel reads the picture (the frames' tone and bend, the same knobs) and turns its ink into a colour. */
const INK = `
uniform sampler2D uTex;
uniform float uDens, uMono, uDistort, uDistAmt, uTime, uSeed, uSmear, uRich, uOnWhite;
// (how much denser the picture is read: 1 as it is; the observer's body reads it stronger)
float inkBoost = 1.0;
uniform vec3 uInk, uPlant, uOwn;
float h1(float x) { return fract(sin(x * 127.1 + uSeed * 311.7) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 74.7) * 43758.5453); }
vec2 warp(vec2 uv) {
  if (uDistort < 0.5) return uv;
  if (uDistort < 1.5) {
    float n = h1(floor(uv.x * 60.0) + 7.0), n2 = h1(floor(uv.x * 9.0) + 3.0);
    float y0 = 0.25 + 0.5 * n2;
    return vec2(uv.x, y0 + (uv.y - y0) * (1.0 - uDistAmt * 0.85 * mix(n, n2, 0.6)));
  }
  if (uDistort < 2.5) {
    float b = floor(uv.y * 28.0);
    return vec2(uv.x + uDistAmt * 0.18 * (h1(b + 11.0) - 0.5) * (0.6 + 0.4 * sin(uTime * (0.5 + h1(b)) + b)), uv.y);
  }
  if (uDistort < 3.5) {
    vec2 cell = floor(uv * vec2(6.0, 10.0));
    float tk = floor(uTime * 4.0);
    float on = step(0.9 - 0.35 * uDistAmt, h2(cell + tk));
    return uv + on * (vec2(h2(cell + tk + 3.1), h2(cell + tk + 7.7)) - 0.5) * vec2(0.3, 0.08);
  }
  return uv + uDistAmt * 0.035 * vec2(sin(uv.y * 38.0 + uSeed * 6.0 + uTime * 0.7) + sin(uv.y * 91.0 + uSeed), cos(uv.x * 33.0 + uSeed * 4.0) * 0.6);
}
// (rgb the colour, a how much ink)
vec4 inkAt(vec2 uv, float smear) {
  vec2 w = clamp(warp(uv), 0.0, 1.0);
  vec3 s = (texture2D(uTex, w - vec2(smear, 0.0)).rgb + texture2D(uTex, w).rgb + texture2D(uTex, w + vec2(smear, 0.0)).rgb) / 3.0;
  if (uRich > 0.5) {
    // (the picture in colour: on the white ground what is left of white light after its inks, on the black the light)
    vec3 t = exp(-uDens * inkBoost * 1.6 * s);
    if (uOnWhite > 0.5) return vec4(t, 1.0 - min(t.r, min(t.g, t.b)));
    vec3 l = 1.0 - t;
    float top = max(l.r, max(l.g, l.b));
    return vec4(l / max(top, 1e-4), top);
  }
  vec3 ink = 1.0 - exp(-uDens * inkBoost * s);
  float a = 1.0 - (1.0 - ink.r) * (1.0 - ink.g) * (1.0 - ink.b);
  vec3 c = uMono > 0.5 ? uInk : (uInk * ink.r + uPlant * ink.g + uOwn * ink.b) / max(1e-3, ink.r + ink.g + ink.b);
  return vec4(c, a);
}`;

const WINDOW_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** ② A window: a walking body's shape (uShape 0) or a soft-edged sheet (1); in it the picture, each pixel at its own
 *  place on the screen. */
const WINDOW_FRAG = `
${INK}
float ign(vec2 f) { return fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715)))) - 0.5; }
uniform vec2 uRes;
uniform float uA, uPose, uWalk, uShape;
uniform vec3 uBack;
varying vec2 vUv;
float cap(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
void main() {
  float m;
  if (uShape < 0.5) {
    vec2 p = vec2((vUv.x - 0.5) * 0.6, vUv.y);
    float sw = sin(uPose * 6.0) * uWalk;
    float d = length(p - vec2(0.0, 0.905)) - 0.075;
    d = min(d, cap(p, vec2(0.0, 0.80), vec2(0.0, 0.52), 0.085));
    d = min(d, cap(p, vec2(-0.05, 0.50), vec2(-0.06 - sw * 0.09, 0.04), 0.045));
    d = min(d, cap(p, vec2(0.05, 0.50), vec2(0.06 + sw * 0.09, 0.04), 0.045));
    d = min(d, cap(p, vec2(-0.105, 0.78), vec2(-0.13 + sw * 0.06, 0.47), 0.032));
    d = min(d, cap(p, vec2(0.105, 0.78), vec2(0.13 - sw * 0.06, 0.47), 0.032));
    m = 1.0 - smoothstep(-0.004, 0.006, d);
  } else {
    vec2 e = smoothstep(vec2(0.0), vec2(0.06, 0.04), vUv) * smoothstep(vec2(0.0), vec2(0.06, 0.04), 1.0 - vUv);
    m = e.x * e.y;
  }
  if (m * uA < 0.01) discard;
  vec4 k = inkAt(gl_FragCoord.xy / uRes, uSmear);
  // (a half step of noise: no bands in the soft tones)
  float dn = ign(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4(mix(uBack, k.rgb, k.a) + dn, m * uA);
}`;
/**
 * THE OBSERVER AS A PERSON IN A LONG EXPOSURE (uShape "person" — the artist, 2026-11-22 night: "사람 레퍼런스처럼 만들도록 …";
 * 2026-11-23: "애초에 골격도 근데 너무 부자연스러운 픽토그램같어"; the body: "모캡 몸부터"). The body is the SHARED one —
 * street-feel's bodySheet.ts (its BODY_GLSL ray-marched through an instanced box on the CMU bones, read only), the same
 * body the present's people wear — seen from wherever the visitor's eye is. It has no colour of its own: it is drawn into
 * a picture that is never cleared, only faded (longExposure.ts), as how much of it is there and where on the future's
 * ground each bit of it reads, while the view drifts as a hand-held camera's does; the future is laid in it after.
 */
const OBS_VERT = `
attribute vec4 iBody;   // world x, z, heading (rad; forward = (sin h, 0, cos h)), world units a metre
attribute vec4 iBody2;  // pose row, alpha, 0, 0
uniform vec2 uShake;
varying vec3 vWorld;
varying vec4 vB;
varying vec4 vB2;
void main() {
  // (bodySheet.ts's own box, as its BODY_VERT places it)
  vec3 bmin = vec3(${BODY_BOX.min.join(", ")});
  vec3 bmax = vec3(${BODY_BOX.max.join(", ")});
  vec3 l = bmin + (position + 0.5) * (bmax - bmin);
  float c = cos(iBody.z), s = sin(iBody.z);
  vec3 w = vec3(iBody.x, 0.0, iBody.y) + vec3(l.x * c + l.z * s, l.y, -l.x * s + l.z * c) * iBody.w;
  vWorld = w;
  vB = iBody;
  vB2 = iBody2;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  // (the camera's own movement while the shutter is open: the same for everyone in the picture)
  gl_Position.xy += uShake * gl_Position.w;
}`;
const OBS_FRAG = `
uniform float uGain;
// (the chart of the future's ground: its middle (world x, z) and width (world); how much of it a body shows)
uniform vec2 uMapO, uMapSpan;
uniform float uMapW;
varying vec3 vWorld;
varying vec4 vB;
varying vec4 vB2;
${BODY_GLSL}
vec3 toLocal(vec3 w) {
  vec3 d = (w - vec3(vB.x, 0.0, vB.y)) / vB.w;
  float c = cos(vB.z), s = sin(vB.z);
  return vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
}
void main() {
  if (vB2.y < 0.01) discard;
  vec3 ro = toLocal(cameraPosition);
  vec3 rd = normalize(toLocal(vWorld) - ro);
  float pixAng = max(length(dFdx(rd)), length(dFdy(rd)));
  loadPose(vB2.x);
  vec3 at;
  float cover = marchBody(ro, rd, pixAng, at);
  if (cover < 0.004) discard;
  // (the floor is blown out, as in the references: the feet and shins dissolve into it)
  cover *= mix(0.04, 1.0, smoothstep(0.02, 0.55, at.y));
  // (and the light takes the bare skin and the head first: the references' faces and hands are nearly white)
  int part = bodyPart(at);
  if (part == 2) cover *= 0.12;
  else if (part == 3 && at.y > 1.3) cover *= 0.07;
  float a = cover * vB2.y * uGain;
  // (where on the future's ground this bit of the body reads — THE BODY CUT INTO THE PLACES IT SHOWS: each part of it,
  // the top, each leg, the bare skin, the dark of hair and shoes, is a window onto one place of the ground round where it
  // stands, so it comes in blocks of one colour as the references' people come in their clothes, the colour still the
  // future's; a quarter of the body's own extent kept inside each part, so a block lives. Gathered with the body, so it
  // smears as the body does)
  vec2 me = vec2(0.5 + (vB.x - uMapO.x) / uMapW, 0.5 - (vB.y - uMapO.y) / uMapW);
  vec2 anchor = part == 0 ? vec2(0.0, 0.3) : (part == 1 ? vec2(sign(at.x) * 0.22, -0.25) : (part == 2 ? vec2(0.38, 0.05) : vec2(-0.4, -0.45)));
  vec2 mapAt = me + (anchor + vec2(at.x / 0.9, at.y / 1.8 - 0.5) * 0.25) * uMapSpan;
  gl_FragColor = vec4(a, mapAt * a, 1.0);
}`;
/**
 * The exposure laid on the screen: where it has gathered, the body — and the body is THE FUTURE SEEN THROUGH IT, as a
 * signal from another time arrives (the artist, 2026-11-23: "미래 모습을 그냥 그렇게 번역만 할 게 아니라 비주얼 이펙트나
 * 글리치나 색수차나 다양하게"): its three colours come apart along the drag (chromatic aberration), bands of it are torn
 * sideways a few at a time, blocks of it jump out of place — and the body tears with it.
 */
const EXPOSED_FRAG = `
${INK}
${EXPOSE_GLSL}
uniform sampler2D uAcc;
uniform float uSee, uPaper, uBlur, uBoost, uAberr, uTear, uGlitch, uStreak, uCols, uWeight;
varying vec2 vUv;
float hh(float x) { return fract(sin(x * 91.7 + 1.3) * 43758.5453); }
float hh2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
// THE DRIPS (the references): fine vertical lines under what was there — a few over it — each column its own length, as
// a long exposure leaves them when the camera slides while the shutter is open; lighter than the body they run from,
// carrying its colour (the exposure holds where on the future each bit reads, so a drip shows the same place)
vec3 streaked(vec2 uv) {
  vec3 c = texture2D(uAcc, uv).rgb;
  if (uStreak <= 0.0) return c;
  float col = floor(uv.x * uCols);
  // (neighbouring lines alike, each a little its own: drips that run, not a comb)
  float cs = col / 7.0, c0 = floor(cs);
  float r = mix(mix(hh(c0 * 0.731 + 4.1), hh((c0 + 1.0) * 0.731 + 4.1), smoothstep(0.0, 1.0, fract(cs))), hh(col * 1.913 + 2.7), 0.35);
  float len = uStreak * (0.15 + 1.7 * r * r);
  float dir = hh(col * 1.37 + 9.2) < 0.12 ? -0.3 : 1.0;
  float j = hh2(gl_FragCoord.xy + floor(uTime * 12.0) * 7.3);
  vec3 sum = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 8; i++) {
    float f = (float(i) + j) / 8.0;
    float w = 1.0 - f;
    sum += texture2D(uAcc, uv + vec2(0.0, f * len * dir)).rgb * w;
    ws += w;
  }
  return c + sum / ws * 0.6 * (1.0 - min(c.r, 1.0));
}
vec2 broken(vec2 uv) {
  float tk = floor(uTime * 9.0), band = floor(uv.y * 70.0);
  uv.x += step(1.0 - 0.3 * uTear, hh(band * 1.7 + tk * 0.37)) * (hh(band + tk) - 0.5) * 0.16 * uTear;
  vec2 cell = floor(uv * vec2(9.0, 16.0));
  float tb = floor(uTime * 5.0);
  uv += step(1.0 - 0.18 * uGlitch, hh2(cell + tb)) * (vec2(hh2(cell + tb + 3.1), hh2(cell + tb + 7.7)) - 0.5) * vec2(0.14, 0.03) * uGlitch;
  return uv;
}
// (the future's ground from above, in colour, read at one place: rgb the colour, a how much is there)
uniform sampler2D uMap;
vec4 ground(vec2 at) {
  // (its hue apart from how much of it there is: many points of one hue stay that hue, clear, instead of every channel
  // being taken at once and going to mud)
  vec3 g = texture2D(uMap, clamp(at, 0.0, 1.0)).rgb;
  float top = max(g.r, max(g.g, g.b));
  vec3 hue = g / max(top, 1e-4);
  float dens = 1.0 - exp(-uBoost * 0.25 * top);
  if (uPaper > 0.5) return vec4(1.0 - hue * 0.95, dens);
  return vec4(hue, dens);
}
// (dragged along the body as the body itself was: what lies ahead and behind runs together in it)
vec4 through(vec2 at) {
  vec4 k = vec4(0.0);
  for (int i = 0; i < 5; i++) k += ground(at + vec2(0.0, (float(i) / 4.0 - 0.5) * uBlur));
  return k / 5.0;
}
void main() {
  vec2 uv = broken(vUv);
  vec3 acc = streaked(uv);
  float m = clamp(acc.r, 0.0, 1.0);
  // (nothing here: leave what is behind exactly as it is — no rim where the exposure thins out to nothing)
  if (m < 0.0015) discard;
  // THE BODY IS THE FUTURE OF THE GROUND IT STANDS ON, seen through it: its three colours apart along the drag
  vec2 at = acc.gb / max(acc.r, 1e-4);
  vec2 ab = vec2(uAberr * 0.5, uAberr);
  vec4 kr = through(at + ab), kg = through(at), kb = through(at - ab);
  vec4 k = vec4(kr.r, kg.g, kb.b, max(kr.a, max(kg.a, kb.a)));
  float g = filmGrain(gl_FragCoord.xy, uTime, 0.01) * m;
  // (the body's middle is all there; only its drawn-out ends thin)
  float see = smoothstep(0.0, 0.3, m) * uSee;
  if (uPaper > 1.5) {
    // (INTO THE STREET'S OWN EXPOSURE (InkPaper), as an absorption × this frame's weight: the street's people and this
    // body are one photograph — its halation, overexposure and grain on both — and the body is no longer taken for
    // the far ground behind it and softened as that is)
    vec3 seen = mix(vec3(0.8), k.rgb * 0.92, k.a);
    gl_FragColor = vec4((vec3(1.0) - seen) * see * uWeight, 1.0);
  } else if (uPaper > 0.5) {
    // (multiplied onto what is behind: a little of the body's own shade, so it is there where the future is bare)
    vec3 seen = mix(vec3(0.8), k.rgb * 0.92, k.a);
    gl_FragColor = vec4(mix(vec3(1.0), seen, see) + g, 1.0);
  } else {
    gl_FragColor = vec4(mix(vec3(0.14), k.rgb, k.a) * see + g, 1.0);
  }
}`;
const FILL_VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
/** ④ The whole screen: the picture over the present — the more the nearer (uFill), either all of it growing denser
 *  (uHow 0) or a white scan line coming down the screen (1). */
const FILL_FRAG = `
${INK}
float ign(vec2 f) { return fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715)))) - 0.5; }
uniform float uFill, uAlpha, uFilm, uHow;
uniform vec3 uFilmColor, uLine;
varying vec2 vUv;
void main() {
  if (uFill < 0.003) discard;
  vec4 k = inkAt(vUv, uSmear);
  float show = uFill, line = 0.0;
  if (uHow > 0.5) {
    float yl = 1.0 - uFill * 1.06;
    show = smoothstep(yl, yl + 0.004, vUv.y);
    line = (1.0 - smoothstep(0.0, 0.006, abs(vUv.y - yl))) * step(uFill, 0.995);
  }
  float aImg = k.a * uAlpha, aFilm = uFilm;
  float A = (aFilm + (1.0 - aFilm) * aImg) * show;
  vec3 C = (uFilmColor * aFilm + k.rgb * aImg * (1.0 - aFilm)) / max(1e-4, aFilm + (1.0 - aFilm) * aImg);
  float la = line * 0.85;
  float A2 = la + A * (1.0 - la);
  if (A2 < 0.004) discard;
  float dn = ign(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4((uLine * la + C * A * (1.0 - la)) / max(1e-4, A2) + dn, clamp(A2 + dn * 2.0, 0.0, 1.0));
}`;

interface Win {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
  /** As a person: where in its stride it is (0 … 1), the way it walks, how much it walks (0 stands … 1) — the observer's
   *  own, or as it was when left. */
  phase: number;
  fx: number;
  fz: number;
  walking: number;
}

export interface WindowsTick {
  gl: THREE.WebGLRenderer;
  cam: THREE.Camera;
  now: number;
  /** Since the encounter began (s). */
  t: number;
  /** The observer (nearest image to the visitor), or null when it is not known this frame. */
  ex: { x: number; z: number; dx: number; dz: number; standing: boolean } | null;
  /** Where the visitor stands. */
  me: { x: number; z: number };
  cfg: FuturePresenceVisual;
}

const eye = new THREE.Vector3();
const size = new THREE.Vector2();
const clearTmp = new THREE.Color();
const shown = (c: THREE.Color, hex: string, k = 1) => c.set(hex).convertLinearToSRGB().multiplyScalar(k);
/** Eased 0 … 1 (nothing comes or goes at a constant rate, or in under a fifth of a second). */
const ease = (x: number) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};

export class FutureWindows {
  readonly group = new THREE.Group();
  private rt: THREE.WebGLRenderTarget | null = null;
  private wins: Win[] = [];
  private next = 1;
  private readonly last = new THREE.Vector3();
  private dropped = false;
  private fill = 0;
  private walk = 0;
  private ms = 0;
  private lastNow = 0;
  private ownSeenAt = 0;
  private stepAt = 0;
  private readonly exPos = new THREE.Vector3();
  private readonly capMat: THREE.ShaderMaterial;
  private readonly capScene = new THREE.Scene();
  private readonly winGeom: THREE.BufferGeometry;
  // (the exposure: two pictures, each frame the one faded into the other with the people drawn over)
  private acc: LongExposure | null = null;
  private accW = 0;
  private accH = 0;
  private readonly personScene = new THREE.Scene();
  // (the shared body: one pose row a window, one instanced draw for all of them)
  private readonly poses = new BodyPoses(WINDOWS_MAX);
  private readonly bodyGeom = makeBodyGeometry(WINDOWS_MAX);
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly bodyMesh: THREE.Mesh;
  private readonly exposedMat: THREE.ShaderMaterial;
  private readonly exposedMesh: THREE.Mesh;
  private readonly shake = { value: new THREE.Vector2() };
  private readonly gain = { value: 0.1 };
  // (the future's ground from above, in colour: taken once each time the place is read)
  private map: THREE.WebGLRenderTarget | null = null;
  private readonly mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly mapSpan = { value: new THREE.Vector2(0.1, 0.3) };
  private mapStale = true;
  private mapR = 14;
  private who = 0;
  private exposing = 0;
  private readonly fillMat: THREE.ShaderMaterial;
  private readonly fillMesh: THREE.Mesh;
  private readonly plant = new THREE.Color("#2f8f3f");
  private readonly tones = { ink: new THREE.Color(), plant: new THREE.Color(), own: new THREE.Color(), film: new THREE.Color(), line: new THREE.Color(1, 1, 1), back: new THREE.Color() };
  /** The uniforms every window and the sheet share (one object each: set once a frame). */
  private readonly shared = { uTex: { value: null as THREE.Texture | null }, uDens: { value: 0.06 }, uMono: { value: 1 }, uDistort: { value: 0 }, uDistAmt: { value: 0.5 }, uTime: { value: 0 }, uInk: { value: this.tones.ink }, uPlant: { value: this.tones.plant }, uOwn: { value: this.tones.own }, uSmear: { value: 0.004 }, uRich: { value: 0 }, uOnWhite: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uBack: { value: this.tones.back } };

  /** `cloud`: the encounter's sampling of the future (position, color, aSeed.y = what a point is). */
  constructor(cloud: THREE.BufferGeometry) {
    this.capMat = new THREE.ShaderMaterial({
      vertexShader: CAPTURE_VERT,
      fragmentShader: CAPTURE_FRAG,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uSplat: { value: 0.3 }, uR: { value: 14 }, uOrigin: { value: new THREE.Vector3() }, uRich: { value: 0 }, uOnWhite: { value: 0 } },
    });
    const pts = new THREE.Points(cloud, this.capMat);
    pts.frustumCulled = false;
    this.capScene.add(pts);
    const w = new THREE.BufferGeometry();
    w.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    w.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    w.setIndex([0, 1, 2, 0, 2, 3]);
    this.winGeom = w;
    const S = this.shared;
    this.fillMat = new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: 0.37 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uRich: S.uRich, uOnWhite: S.uOnWhite, uFill: { value: 0 }, uAlpha: { value: 0.85 }, uFilm: { value: 0.08 }, uHow: { value: 0 }, uFilmColor: { value: this.tones.film }, uLine: { value: this.tones.line } },
    });
    const f = new THREE.BufferGeometry();
    f.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fillMesh = new THREE.Mesh(f, this.fillMat);
    this.fillMesh.frustumCulled = false;
    this.fillMesh.visible = false;
    this.fillMesh.renderOrder = 999;
    this.group.add(this.fillMesh);
    this.exposedMat = new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: EXPOSED_FRAG,
      transparent: true,
      // (set each frame: multiplied on the white ground, added on the black)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: 0.61 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uRich: S.uRich, uOnWhite: S.uOnWhite, uAcc: { value: null }, uSee: { value: 0.9 }, uPaper: { value: 0 }, uBlur: { value: 0.2 }, uBoost: { value: 3 }, uMap: { value: null }, uAberr: { value: 0.006 }, uTear: { value: 0.5 }, uGlitch: { value: 0.35 }, uStreak: { value: 0.07 }, uCols: { value: 400 }, uWeight: { value: 0.06 } },
    });
    this.exposedMesh = new THREE.Mesh(f, this.exposedMat);
    this.exposedMesh.frustumCulled = false;
    this.exposedMesh.visible = false;
    this.exposedMesh.renderOrder = 3;
    this.group.add(this.exposedMesh);
    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: OBS_VERT,
      fragmentShader: OBS_FRAG,
      // (added to what the exposure already holds; the box seen from inside too, as bodySheet's own material)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: { uPoses: { value: this.poses.texture }, uShake: this.shake, uGain: this.gain, uMapO: { value: new THREE.Vector2() }, uMapW: { value: 40 }, uMapSpan: this.mapSpan },
    });
    this.bodyMesh = new THREE.Mesh(this.bodyGeom, this.bodyMat);
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.visible = false;
    this.personScene.add(this.bodyMesh);
  }

  /** The picture (of the screen's shape; a phone smaller) and the windows — made, and put on the GPU, ahead. */
  ensure(gl: THREE.WebGLRenderer, phone: boolean, cfg: FuturePresenceVisual): void {
    gl.getDrawingBufferSize(size);
    const H = phone ? 384 : 512, W = Math.max(64, Math.min(1024, Math.round((H * size.x) / Math.max(1, size.y))));
    if (!this.rt || this.rt.width !== W || this.rt.height !== H) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
      gl.initRenderTarget(this.rt);
      this.shared.uTex.value = this.rt.texture;
    }
    // (the exposure at the screen's own size — people are fine things — up to 1600 on the long side)
    const k = Math.min(1, 1600 / Math.max(size.x, size.y, 1)), aw = Math.max(16, Math.round(size.x * k)), ah = Math.max(16, Math.round(size.y * k));
    if (!this.acc) this.acc = new LongExposure(aw, ah);
    else if (this.accW !== aw || this.accH !== ah) this.acc.resize(aw, ah);
    this.accW = aw;
    this.accH = ah;
    const K = Math.max(2, Math.min(WINDOWS_MAX, Math.round(cfg.winMax)));
    if (this.wins.length !== K) {
      for (const w of this.wins) {
        w.mat.dispose();
        this.group.remove(w.mesh);
      }
      this.wins = [];
      const S = this.shared;
      for (let i = 0; i < K; i++) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: WINDOW_VERT,
          fragmentShader: WINDOW_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: i * 0.37 + 0.11 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uRich: S.uRich, uOnWhite: S.uOnWhite, uRes: S.uRes, uBack: S.uBack, uA: { value: 0 }, uPose: { value: 0 }, uWalk: { value: 0 }, uShape: { value: 0 } },
        });
        const mesh = new THREE.Mesh(this.winGeom, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.wins.push({ mesh, mat, born: 0, alive: false, phase: 0, fx: 0, fz: 1, walking: 0 });
      }
    }
  }

  /** The programs made before the first encounter (and the taking's, as it is for a picture). */
  compile(gl: THREE.WebGLRenderer, cam: THREE.Camera): void {
    if (!this.rt) return;
    const vis = this.wins.map((w) => w.mesh.visible), fillVis = this.fillMesh.visible;
    for (const w of this.wins) w.mesh.visible = true;
    this.fillMesh.visible = true;
    this.exposedMesh.visible = true;
    const tmp = new THREE.Scene(), parent = this.group.parent;
    tmp.add(this.group);
    gl.compile(tmp, cam);
    if (parent) parent.add(this.group);
    else tmp.remove(this.group);
    this.wins.forEach((w, i) => (w.mesh.visible = vis[i]));
    this.fillMesh.visible = fillVis;
    this.exposedMesh.visible = false;
    const prev = gl.getRenderTarget(), prevAuto = gl.autoClear;
    const exVis = this.exposedMesh.visible;
    if (this.acc) {
      this.bodyMesh.visible = true;
      this.bodyGeom.instanceCount = 1;
      this.acc.decayInto(gl, 0.9);
      gl.autoClear = false;
      gl.render(this.personScene, cam);
      this.acc.clear(gl);
      this.bodyGeom.instanceCount = 0;
      this.bodyMesh.visible = false;
    }
    this.exposedMesh.visible = exVis;
    gl.setRenderTarget(this.rt);
    gl.autoClear = false;
    gl.render(this.capScene, cam);
    gl.clear(true, false, false);
    gl.autoClear = prevAuto;
    gl.setRenderTarget(prev);
  }

  /** `who`: the observer's number (its clothes). */
  begin(origin: { x: number; z: number }, R: number, plant: string, who = 0): void {
    this.who = who;
    this.place(origin, R);
    this.plant.set(plant);
    for (const w of this.wins) {
      w.alive = false;
      w.mesh.visible = false;
    }
    Object.assign(this, { next: 1, dropped: false, fill: 0, walk: 0, lastNow: 0 });
  }

  /** The place read again (the living future): where its piece is now. */
  place(origin: { x: number; z: number }, R: number): void {
    this.capMat.uniforms.uOrigin.value.set(origin.x, 0, origin.z);
    this.capMat.uniforms.uR.value = R;
    this.mapR = R;
    this.mapStale = true;
  }

  end(): void {
    for (const w of this.wins) {
      w.alive = false;
      w.mesh.visible = false;
    }
    this.fillMesh.visible = false;
    this.exposedMesh.visible = false;
    this.bodyMesh.visible = false;
    this.bodyGeom.instanceCount = 0;
    this.fill = 0;
  }

  /** One frame. Returns how many windows stand (the observer's own among them). */
  update(o: WindowsTick): number {
    const { gl, cam, cfg, now, t, me } = o;
    if (!this.rt || !this.wins.length) return 0;
    cam.getWorldPosition(eye);
    // on paper, dark ink; on the black ground, light — and the tone (as the frames')
    const paper = cfg.framePaper === "paper" || (cfg.framePaper === "auto" && paperLook.on);
    const T = this.tones, tone = cfg.frameTone, S = this.shared;
    if (paper) {
      shown(T.ink, tone === "sepia" ? "#4b3421" : tone === "blue" ? "#26364a" : paperLook.ink);
      shown(T.own, "#000000");
      shown(T.film, paperLook.paper, 0.84);
      shown(T.back, paperLook.paper, 0.86);
      T.plant.copy(this.plant).convertLinearToSRGB().lerp(clearTmp.setRGB(0.62, 0.7, 0.6), 0.25);
    } else {
      shown(T.ink, tone === "sepia" ? "#ead7b4" : tone === "blue" ? "#c2d3e8" : "#e4e4e4");
      shown(T.own, "#ffffff");
      shown(T.film, "#303030");
      shown(T.back, "#242424");
      T.plant.copy(this.plant).convertLinearToSRGB().lerp(clearTmp.setRGB(0.7, 0.85, 0.7), 0.3);
    }
    S.uDens.value = 0.03 * cfg.frameInk;
    S.uMono.value = tone === "none" ? 0 : 1;
    // (the future in colour: taken so, and read so)
    // (a person's body is always the future in colour)
    const rich = tone === "rich";
    S.uRich.value = rich ? 1 : 0;
    S.uOnWhite.value = paper ? 1 : 0;
    this.capMat.uniforms.uRich.value = rich ? 1 : 0;
    this.capMat.uniforms.uOnWhite.value = paper ? 1 : 0;
    S.uDistort.value = cfg.frameDistort === "stretch" ? 1 : cfg.frameDistort === "slit" ? 2 : cfg.frameDistort === "glitch" ? 3 : cfg.frameDistort === "glass" ? 4 : 0;
    S.uDistAmt.value = cfg.frameDistortAmt;
    S.uTime.value = now % 1000;
    S.uSmear.value = cfg.frameSmear * 0.35;
    gl.getDrawingBufferSize(S.uRes.value);
    // ② the observer's own window (the first), while it is in sight; ③ one more left where it was, every so far
    const stay = Math.max(1, cfg.winStay), h = cfg.winH, shape = cfg.winShape === "sheet" ? 1 : 0, person = cfg.winShape === "person" && !!this.acc;
    // (as a person it is a person's size)
    const tall = person ? cfg.winPersonH : h, wide = shape ? h * 0.75 : person ? tall * 0.8 : h;
    // THE GROUND'S FUTURE FROM ABOVE, in colour — what a person's body shows: taken when the place has been read
    if (person && (this.mapStale || !this.map)) {
      this.mapStale = false;
      if (!this.map) {
        this.map = new THREE.WebGLRenderTarget(384, 384, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
        this.exposedMat.uniforms.uMap.value = this.map.texture;
      }
      const o = this.capMat.uniforms.uOrigin.value as THREE.Vector3, R = this.mapR * 1.4, c = this.mapCam, CU = this.capMat.uniforms;
      c.left = -R;
      c.right = R;
      c.top = R;
      c.bottom = -R;
      c.updateProjectionMatrix();
      c.position.set(o.x, 80, o.z);
      c.up.set(0, 0, -1);
      c.lookAt(o.x, 0, o.z);
      c.updateMatrixWorld(true);
      const was = [CU.uScale.value, CU.uSplat.value, CU.uRich.value, CU.uOnWhite.value];
      // (a point's size in the picture: its size on the ground, whatever its height)
      CU.uScale.value = (384 / (2 * R)) * 80;
      CU.uSplat.value = Math.max(cfg.frameSplat, 0.35);
      CU.uRich.value = 1;
      CU.uOnWhite.value = paper ? 1 : 0;
      const prevT = gl.getRenderTarget(), prevAuto = gl.autoClear, prevA = gl.getClearAlpha();
      gl.getClearColor(clearTmp);
      gl.setRenderTarget(this.map);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      gl.autoClear = false;
      gl.render(this.capScene, c);
      gl.autoClear = prevAuto;
      gl.setClearColor(clearTmp, prevA);
      gl.setRenderTarget(prevT);
      [CU.uScale.value, CU.uSplat.value, CU.uRich.value, CU.uOnWhite.value] = was;
    }
    // (a body shows the ground 3 across and 9 along where it stands)
    this.mapSpan.value.set(3 / (2 * this.mapR * 1.4), 9 / (2 * this.mapR * 1.4));
    if (o.ex) this.exPos.set(o.ex.x, 0, o.ex.z);
    this.walk += ((o.ex && !o.ex.standing ? 1 : 0) - this.walk) * 0.1;
    // (as a person: its own stride goes on at a person's pace while it walks, and comes to the feet together as it stops;
    // it faces the way it walks)
    // (its walk is its own: bodySheet chooses the captured gait by the observer's number; standing, the pose eases to
    // that gait's mean stance)
    const hash = (Math.imul(this.who + 1, 2654435761) >>> 0) / 4294967296;
    const cycle = cycleOf(hash);
    const sdt = Math.max(0, Math.min(0.1, now - this.stepAt));
    this.stepAt = now;
    {
      const w0 = this.wins[0];
      w0.phase = (w0.phase + (sdt / (cycle?.cycleSec ?? 1.1)) * this.walk) % 1;
      w0.walking = this.walk;
      const dl = o.ex ? Math.hypot(o.ex.dx, o.ex.dz) : 0;
      if (o.ex && dl > 1e-4) {
        w0.fx = o.ex.dx / dl;
        w0.fz = o.ex.dz / dl;
      }
    }
    const seen = !!o.ex && Math.hypot(this.exPos.x - me.x, this.exPos.z - me.z) <= cfg.winSeeR;
    const own = this.wins[0];
    if (seen && !own.alive) {
      own.alive = true;
      own.born = now;
    }
    if (seen) {
      if (!this.dropped || this.last.distanceTo(this.exPos) >= cfg.winGap) {
        if (this.dropped) {
          const w = this.wins[this.next];
          this.next = this.next + 1 >= this.wins.length ? 1 : this.next + 1;
          w.alive = true;
          w.born = now;
          w.mesh.position.copy(this.last);
          w.mat.uniforms.uPose.value = now;
          w.mat.uniforms.uWalk.value = this.walk;
          // (as a person, it stays in the stride it had there, still)
          Object.assign(w, { phase: this.wins[0].phase, fx: this.wins[0].fx, fz: this.wins[0].fz, walking: this.wins[0].walking });
        }
        this.dropped = true;
        this.last.copy(this.exPos);
      }
    }
    let alive = 0, near = 0, bodies = 0;
    const iB = this.bodyGeom.getAttribute("iBody") as THREE.InstancedBufferAttribute, iB2 = this.bodyGeom.getAttribute("iBody2") as THREE.InstancedBufferAttribute;
    const build = [1, 0.92, 1.06, 0.96, 1.1][((this.who * 11 + 4) % 5 + 5) % 5], code = personCode(hash);
    // (world units a metre: the person's height in the world over a body's 1.75 m)
    const perMetre = tall / 1.75;
    for (let i = 0; i < this.wins.length; i++) {
      const w = this.wins[i], U = w.mat.uniforms;
      let a = 0;
      if (w.alive) {
        const age = now - w.born;
        if (i === 0) {
          // (its own: there as long as it is in sight; gone a little after)
          w.mesh.position.copy(this.exPos);
          U.uPose.value = now;
          U.uWalk.value = this.walk;
          // (in over 0.6 s; out over 0.5 s once it is out of sight)
          if (seen) this.ownSeenAt = now;
          a = ease(age / 0.6) * ease(1 - (now - this.ownSeenAt) / 0.5);
          if (now - this.ownSeenAt >= 0.5) w.alive = false;
        } else {
          a = ease(age / 0.5) * ease((stay - age) / Math.max(0.3, stay * 0.3));
          if (age >= stay) w.alive = false;
        }
      }
      const here = w.alive && a > 0.01;
      // (as a person it is drawn into the exposure, not straight to the screen)
      w.mesh.visible = here && !person;
      if (!here) continue;
      alive++;
      // (upright, turned to the eye)
      w.mesh.rotation.set(0, Math.atan2(eye.x - w.mesh.position.x, eye.z - w.mesh.position.z), 0);
      w.mesh.scale.set(wide, tall, 1);
      U.uA.value = a;
      U.uShape.value = shape;
      if (person) {
        // (the shared body: this window's pose in row `bodies`, its place and heading in the instance)
        this.poses.write(bodies, poseOf(cycle, w.phase, 1 - w.walking), build, code);
        iB.setXYZW(bodies, w.mesh.position.x, w.mesh.position.z, Math.atan2(w.fx, w.fz), perMetre);
        iB2.setXYZW(bodies, bodies, a, 0, 0);
        bodies++;
      }
      // ④ how near the visitor is to it
      const d = Math.hypot(w.mesh.position.x - me.x, w.mesh.position.z - me.z);
      const full = Math.min(cfg.winFillFull, cfg.winFillR - 0.01);
      near = Math.max(near, a * (1 - Math.max(0, Math.min(1, (d - full) / Math.max(0.01, cfg.winFillR - full)))));
    }
    this.bodyGeom.instanceCount = bodies;
    this.bodyMesh.visible = bodies > 0;
    if (bodies > 0) {
      iB.needsUpdate = true;
      iB2.needsUpdate = true;
      this.poses.commit();
      const O = this.capMat.uniforms.uOrigin.value as THREE.Vector3;
      (this.bodyMat.uniforms.uMapO.value as THREE.Vector2).set(O.x, O.z);
      this.bodyMat.uniforms.uMapW.value = 2 * this.mapR * 1.4;
    }
    // (the same at any frame rate: two thirds of the way in a quarter second)
    const dt = Math.max(0, Math.min(0.1, now - this.lastNow));
    this.lastNow = now;
    this.fill += (near - this.fill) * (1 - Math.exp(-dt / 0.25));
    if (this.fill < 0.002 && near === 0) this.fill = 0;
    const F = this.fillMat.uniforms;
    this.fillMesh.visible = this.fill > 0.003;
    F.uFill.value = this.fill;
    F.uAlpha.value = cfg.winFillAlpha;
    F.uFilm.value = cfg.frameFilm;
    F.uHow.value = cfg.winFillHow === "scan" ? 1 : 0;
    // ① the picture, from the visitor's own eye, while there is anything to show it in
    if (alive > 0 || this.fillMesh.visible || (person && this.exposing > 0.004)) {
      const t0 = performance.now();
      const pc = cam as THREE.PerspectiveCamera;
      const tanH = Math.tan(THREE.MathUtils.degToRad(pc.isPerspectiveCamera ? pc.fov : 50) / 2);
      this.capMat.uniforms.uScale.value = this.rt.height / 2 / tanH;
      this.capMat.uniforms.uSplat.value = cfg.frameSplat;
      const prev = gl.getRenderTarget(), prevAuto = gl.autoClear, prevA = gl.getClearAlpha();
      gl.getClearColor(clearTmp);
      gl.setRenderTarget(this.rt);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      gl.autoClear = false;
      gl.render(this.capScene, cam);
      gl.autoClear = prevAuto;
      gl.setClearColor(clearTmp, prevA);
      gl.setRenderTarget(prev);
      this.ms = performance.now() - t0;
      markSpan("future-window", this.ms);
    }
    // THE EXPOSURE: what it held, faded; the people as they are this frame, added — and the view's own shake
    const showEx = person && (alive > 0 || this.exposing > 0.004);
    // (on the street's white ground the body goes into the street's own exposure, which holds it a while longer: this one
    // holds it only the rest of the knob's time, so the two together keep it as long as the knob says)
    const inStreet = paper && paperLook.on;
    const w = Math.min(0.999, Math.max(1e-4, exposureRate.weight));
    const theirs = inStreet ? -Math.max(dt, 1 / 240) / Math.log(1 - w) : 0;
    if (person && this.acc) {
      const tau = Math.max(0.03, cfg.winExposure - theirs), decay = Math.exp(-Math.max(dt, 1 / 240) / tau);
      this.exposing = alive > 0 ? 1 : this.exposing * decay;
      if (showEx) {
        this.gain.value = 1 - decay;
        // (the camera SLIDES up and down while the shutter is open, slowly, hardly sideways: the body is drawn out along
        // the slide with its sides kept sharp, as the references' are — a quick jitter only blurred it all round)
        const sy = Math.sin(now * 1.9) * 0.6 + Math.sin(now * 4.3 + 1.3) * 0.3 + Math.sin(now * 11.7 + 2.1) * 0.1;
        const sx = Math.sin(now * 2.3 + 0.7);
        this.shake.value.set(cfg.winShake * 0.06 * sx, cfg.winShake * sy);
        // (street-feel's feedback buffer: what it held × decay, left bound — the people are drawn into it, added)
        const prev = gl.getRenderTarget(), prevAuto = gl.autoClear;
        this.acc.decayInto(gl, decay, 1);
        gl.autoClear = false;
        gl.render(this.personScene, cam);
        gl.autoClear = prevAuto;
        gl.setRenderTarget(prev);
        this.exposedMat.uniforms.uAcc.value = this.acc.texture;
        this.exposedMat.blendSrc = paper && !inStreet ? THREE.DstColorFactor : THREE.OneFactor;
        this.exposedMat.blendDst = paper && !inStreet ? THREE.ZeroFactor : THREE.OneFactor;
        this.exposedMat.uniforms.uWeight.value = w;
      }
    }
    this.exposedMesh.visible = showEx;
    this.exposedMat.uniforms.uSee.value = cfg.winSee;
    this.exposedMat.uniforms.uBlur.value = cfg.winDrag * 0.5;
    this.exposedMat.uniforms.uBoost.value = cfg.winBoost;
    this.exposedMat.uniforms.uAberr.value = cfg.winAberr;
    this.exposedMat.uniforms.uTear.value = cfg.winTear;
    this.exposedMat.uniforms.uGlitch.value = cfg.winGlitch;
    this.exposedMat.uniforms.uStreak.value = cfg.winStreak;
    this.exposedMat.uniforms.uCols.value = this.accW / 2.5;
    this.exposedMat.uniforms.uPaper.value = inStreet ? 2 : paper ? 1 : 0;
    this.exposedMesh.layers.set(inStreet ? EXPOSURE_LAYER : 0);
    (window as unknown as { __futureWindows?: unknown }).__futureWindows = { alive, seen, fill: Math.round(this.fill * 100) / 100, near: Math.round(near * 100) / 100, W: this.rt.width, H: this.rt.height, ms: Math.round(this.ms * 100) / 100, t: Math.round(t * 10) / 10, paper };
    return alive;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.acc?.dispose();
    this.acc = null;
    this.map?.dispose();
    this.map = null;
    this.poses.dispose();
    this.bodyGeom.dispose();
    this.bodyMat.dispose();
    this.exposedMat.dispose();
    for (const w of this.wins) w.mat.dispose();
    this.wins = [];
    this.capMat.dispose();
    this.fillMat.dispose();
    this.fillMesh.geometry.dispose();
    this.winGeom.dispose();
  }
}
