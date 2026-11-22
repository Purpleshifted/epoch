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
import { LongExposure } from "./longExposure";
import { EXPOSE_GLSL, paperLook } from "./paperLook";
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
 * THE OBSERVER AS A PERSON IN A LONG EXPOSURE (uShape "person" — the artist, 2026-11-22 night: "사람 레퍼런스처럼 만들도록 …
 * 색감도 말이야"; the references: walkers seen from behind in long exposures, IMG_1575 · 1576 in colour, 1580 · 1582 in
 * black and white). Not a filter: a person is drawn — a back view in a person's proportions, the clothes flat fields of
 * colour (top, trousers, hair, skin, shoes), the legs thinning out towards the ground — into a picture that is never
 * cleared, only faded (previous × decay + this frame: TouchDesigner's Feedback), while the view shakes up and down as a
 * hand-held camera's does. What stays in it is the smear the references have: drawn out vertically, the sides crisper,
 * the stride a ghost. The future shows through the body as through the window before.
 */
const PERSON_VERT = `
uniform vec2 uShake;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // (the camera's own movement while the shutter is open: the same for everyone in the picture)
  gl_Position.xy += uShake * gl_Position.w;
}`;
const PERSON_FRAG = `
uniform float uA, uPose, uWalk, uGain, uHem, uHairLen, uBuild, uLean, uBend;
uniform vec2 uDrag;
uniform float uTick;
varying vec2 vUv;
float capT(vec2 p, vec2 a, vec2 b, float ra, float rb) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(ra, rb, h); }
float ell(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
// (a rounded trapezoid about the body's axis: half-width w0 at y0 to w1 at y1)
float trap(vec2 p, float y0, float w0, float y1, float w1, float r) {
  float w = mix(w0, w1, clamp((p.y - y0) / (y1 - y0), 0.0, 1.0));
  vec2 d = vec2(abs(p.x) - w, max(y0 - p.y, p.y - y1)) + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void lay(inout float cov, float d) {
  // (soft, and nothing darker at its rim: no outline is drawn)
  cov = max(cov, 1.0 - smoothstep(-0.014, 0.014, d));
}
// (the person at one instant, seen at p: rgb the colour × how much is there, a how much is there)
vec4 figure(vec2 p, float sw) {
  // (a weight on one leg, a shoulder lower: nobody stands as a diagram)
  // (nobody stands as a diagram: the body leans from its feet, the spine curves, the stride turns the shoulders)
  p.x += uLean * (p.y - 0.1) + 0.014 * sin(p.y * 3.1 + uLean * 30.0) + sw * 0.012 * (p.y - 0.5);
  // (a slighter or a broader body)
  p.x /= uBuild;
  float cov = 0.0;
  float fl = -0.062 - sw * 0.085, fr = 0.062 + sw * 0.085;
  lay(cov, ell(p, vec2(fl, 0.02), vec2(0.03, 0.018)));
  lay(cov, ell(p, vec2(fr, 0.02), vec2(0.03, 0.018)));
  // (each leg in two: thigh to knee, knee to ankle — the knee gives a little as it swings)
  vec2 kl = vec2(-0.054 - sw * 0.05, 0.3 + abs(sw) * 0.012), kr = vec2(0.054 + sw * 0.05, 0.3 + abs(sw) * 0.012);
  float dq;
  dq = capT(p, vec2(-0.05, 0.53), kl, 0.046, 0.034); lay(cov, dq);
  dq = capT(p, vec2(0.05, 0.53), kr, 0.046, 0.034); lay(cov, dq);
  dq = capT(p, kl, vec2(fl, 0.05), 0.034, 0.021); lay(cov, dq);
  dq = capT(p, kr, vec2(fr, 0.05), 0.034, 0.021); lay(cov, dq);
  dq = ell(p, vec2(0.0, 0.55), vec2(0.09, 0.05)); lay(cov, dq);
  // (one arm hangs, the other is bent — a hand at a strap, in a pocket)
  float hl = -0.158 + sw * 0.05, hr = 0.158 - sw * 0.05 - uBend * 0.05;
  float wl = 0.5, wr = 0.5 + uBend * 0.11;
  dq = capT(p, vec2(-0.13, 0.8), vec2(hl, wl), 0.032, 0.02); lay(cov, dq);
  dq = capT(p, vec2(0.13, 0.8), vec2(hr, wr), 0.032, 0.02); lay(cov, dq);
  lay(cov, ell(p, vec2(hl, wl - 0.022), vec2(0.019, 0.025)));
  lay(cov, ell(p, vec2(hr, wr - 0.022), vec2(0.019, 0.025)));
  // (the top to its hem: a shirt to the waist, a jacket over the hips, a coat to the thigh — a little wider at the hem)
  dq = trap(p, uHem, 0.086 + (0.54 - uHem) * 0.12, 0.83, 0.122, 0.045); lay(cov, dq);
  lay(cov, capT(p, vec2(0.0, 0.825), vec2(0.0, 0.888), 0.026, 0.022));
  // (hair: cropped, or falling over the shoulders)
  if (uHairLen > 0.01) { dq = trap(p, 0.93 - uHairLen, 0.062, 0.93, 0.05, 0.03); lay(cov, dq); }
  lay(cov, ell(p, vec2(0.0, 0.933), vec2(0.046, 0.057)));
  // (the legs thin out towards the ground, as an exposure loses what moves most)
  cov *= mix(0.12, 1.0, smoothstep(0.0, 0.24, p.y));
  // (only where the body is: it has no colour of its own — it is a window, and its colour is the future's)
  return vec4(vec3(cov), cov);
}
void main() {
  // (1 = the body's height; the sheet it is drawn on is 0.6 of that wide)
  vec2 p = vec2((vUv.x - 0.5) * 0.6, vUv.y);
  float sw = sin(uPose * 6.0) * uWalk;
  // THE SHUTTER IS OPEN WHILE THE BODY MOVES: within this one frame the person is taken at eight instants along the
  // way it is dragged (the camera's drift, the stride a little further on at each) and they are averaged — so the
  // smear is in the body, not round it: the hem runs into the trousers, the hair into the shoulders, the hands into
  // the hips; and nothing has an edge of its own.
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    // (the instants fall elsewhere each frame, so the exposure evens them out: no stipple is left at the soft edges)
    float t = (float(i) + fract(sin(dot(gl_FragCoord.xy + uTick * 61.7, vec2(12.9898, 78.233))) * 43758.5453)) / 8.0 - 0.5;
    sum += figure(p - uDrag * t, sw + t * 0.5 * uWalk);
  }
  sum /= 8.0;
  float a = uA * uGain;
  if (sum.a * a < 1e-5) discard;
  gl_FragColor = vec4(sum.rgb * a, 1.0);
}`;
/** The exposure laid on the screen: where it has gathered, the person — and through them, the future. */
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
uniform float uSee, uPaper, uBlur, uBoost, uAberr, uTear, uGlitch;
varying vec2 vUv;
float hh(float x) { return fract(sin(x * 91.7 + 1.3) * 43758.5453); }
float hh2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec2 broken(vec2 uv) {
  float tk = floor(uTime * 9.0), band = floor(uv.y * 70.0);
  uv.x += step(1.0 - 0.3 * uTear, hh(band * 1.7 + tk * 0.37)) * (hh(band + tk) - 0.5) * 0.16 * uTear;
  vec2 cell = floor(uv * vec2(9.0, 16.0));
  float tb = floor(uTime * 5.0);
  uv += step(1.0 - 0.18 * uGlitch, hh2(cell + tb)) * (vec2(hh2(cell + tb + 3.1), hh2(cell + tb + 7.7)) - 0.5) * vec2(0.14, 0.03) * uGlitch;
  return uv;
}
// (the picture dragged down the body as the body itself was: what stands above and below runs together in it)
vec4 through(vec2 uv) {
  vec4 k = vec4(0.0);
  for (int i = 0; i < 5; i++) k += inkAt(uv + vec2(0.0, (float(i) / 4.0 - 0.5) * uBlur), uSmear * 3.0);
  return k / 5.0;
}
void main() {
  vec2 uv = broken(vUv);
  float m = clamp(texture2D(uAcc, uv).r, 0.0, 1.0);
  // (nothing here: leave what is behind exactly as it is — no rim where the exposure thins out to nothing)
  if (m < 0.0015) discard;
  inkBoost = uBoost;
  vec2 ab = vec2(uAberr * 0.5, uAberr);
  vec4 kr = through(uv + ab), kg = through(uv), kb = through(uv - ab);
  vec4 k = vec4(kr.r, kg.g, kb.b, max(kr.a, max(kg.a, kb.a)));
  float g = filmGrain(gl_FragCoord.xy, uTime, 0.01) * m;
  float see = m * uSee;
  if (uPaper > 0.5) {
    // (multiplied onto what is behind: a little of the body's own shade, so it is there where the future is bare)
    vec3 seen = mix(vec3(0.86), k.rgb * 0.94, k.a);
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
}

export interface WindowsTick {
  gl: THREE.WebGLRenderer;
  cam: THREE.Camera;
  now: number;
  /** Since the encounter began (s). */
  t: number;
  /** The observer (nearest image to the visitor), or null when it is not known this frame. */
  ex: { x: number; z: number; standing: boolean } | null;
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
  private readonly exPos = new THREE.Vector3();
  private readonly capMat: THREE.ShaderMaterial;
  private readonly capScene = new THREE.Scene();
  private readonly winGeom: THREE.BufferGeometry;
  // (the exposure: two pictures, each frame the one faded into the other with the people drawn over)
  private acc: LongExposure | null = null;
  private accW = 0;
  private accH = 0;
  private readonly personScene = new THREE.Scene();
  private people: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly exposedMat: THREE.ShaderMaterial;
  private readonly exposedMesh: THREE.Mesh;
  private readonly shake = { value: new THREE.Vector2() };
  private readonly gain = { value: 0.1 };
  private readonly tick = { value: 0 };
  /** The way the body is dragged while the shutter is open (of its height): mostly down, turning slowly. */
  private readonly drag = { value: new THREE.Vector2(0, 0.1) };
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
      uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: 0.61 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uRich: S.uRich, uOnWhite: S.uOnWhite, uAcc: { value: null }, uSee: { value: 0.9 }, uPaper: { value: 0 }, uBlur: { value: 0.2 }, uBoost: { value: 3 }, uAberr: { value: 0.006 }, uTear: { value: 0.5 }, uGlitch: { value: 0.35 } },
    });
    this.exposedMesh = new THREE.Mesh(f, this.exposedMat);
    this.exposedMesh.frustumCulled = false;
    this.exposedMesh.visible = false;
    this.exposedMesh.renderOrder = 3;
    this.group.add(this.exposedMesh);
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
      for (const q of this.people) {
        q.mat.dispose();
        this.personScene.remove(q.mesh);
      }
      this.wins = [];
      this.people = [];
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
        this.wins.push({ mesh, mat, born: 0, alive: false });
        const pm = new THREE.ShaderMaterial({
          vertexShader: PERSON_VERT,
          fragmentShader: PERSON_FRAG,
          // (added to what the exposure already holds)
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneFactor,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: { uShake: this.shake, uDrag: this.drag, uTick: this.tick, uGain: this.gain, uA: { value: 0 }, uPose: { value: 0 }, uWalk: { value: 0 }, uHem: { value: 0.54 }, uHairLen: { value: 0 }, uBuild: { value: 1 }, uLean: { value: 0 }, uBend: { value: 0 } },
        });
        const person = new THREE.Mesh(this.winGeom, pm);
        person.frustumCulled = false;
        person.visible = false;
        this.personScene.add(person);
        this.people.push({ mesh: person, mat: pm });
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
      for (const q of this.people) q.mesh.visible = true;
      this.acc.decayInto(gl, 0.9);
      gl.autoClear = false;
      gl.render(this.personScene, cam);
      this.acc.clear(gl);
      for (const q of this.people) q.mesh.visible = false;
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
  }

  end(): void {
    for (const w of this.wins) {
      w.alive = false;
      w.mesh.visible = false;
    }
    this.fillMesh.visible = false;
    this.exposedMesh.visible = false;
    for (const q of this.people) q.mesh.visible = false;
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
    const wide = shape ? h * 0.75 : person ? h * 0.6 : h;
    if (o.ex) this.exPos.set(o.ex.x, 0, o.ex.z);
    this.walk += ((o.ex && !o.ex.standing ? 1 : 0) - this.walk) * 0.1;
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
        }
        this.dropped = true;
        this.last.copy(this.exPos);
      }
    }
    let alive = 0, near = 0;
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
      const here = w.alive && a > 0.01, q = this.people[i];
      // (as a person it is drawn into the exposure, not straight to the screen)
      w.mesh.visible = here && !person;
      q.mesh.visible = here && person;
      if (!here) continue;
      alive++;
      // (upright, turned to the eye)
      w.mesh.rotation.set(0, Math.atan2(eye.x - w.mesh.position.x, eye.z - w.mesh.position.z), 0);
      w.mesh.scale.set(wide, h, 1);
      U.uA.value = a;
      U.uShape.value = shape;
      if (person) {
        q.mesh.position.copy(w.mesh.position);
        q.mesh.rotation.copy(w.mesh.rotation);
        q.mesh.scale.copy(w.mesh.scale);
        const P = q.mat.uniforms;
        P.uA.value = a;
        P.uPose.value = U.uPose.value;
        P.uWalk.value = U.uWalk.value;
        // (its outline — the cut of what it wears, its hair, its build, its lean — by its number)
        const n = this.who;
        P.uHem.value = [0.54, 0.47, 0.54, 0.38, 0.5][(n * 5 + 1) % 5];
        P.uHairLen.value = [0, 0.16, 0, 0.1, 0.22][(n * 3 + 2) % 5];
        P.uBuild.value = [1, 0.9, 1.08, 0.95, 1.14][(n * 11 + 4) % 5];
        P.uLean.value = [0.05, -0.035, 0.02, -0.06, 0.04, -0.015][(n * 5 + 3) % 6];
        P.uBend.value = [1, 0, 0.6, 0, 1, 0.3][(n * 7 + 1) % 6];
      }
      // ④ how near the visitor is to it
      const d = Math.hypot(w.mesh.position.x - me.x, w.mesh.position.z - me.z);
      const full = Math.min(cfg.winFillFull, cfg.winFillR - 0.01);
      near = Math.max(near, a * (1 - Math.max(0, Math.min(1, (d - full) / Math.max(0.01, cfg.winFillR - full)))));
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
    if (person && this.acc) {
      const tau = Math.max(0.03, cfg.winExposure), decay = Math.exp(-Math.max(dt, 1 / 240) / tau);
      this.exposing = alive > 0 ? 1 : this.exposing * decay;
      if (showEx) {
        this.gain.value = 1 - decay;
        // (a hand's drift, not a pendulum: three paces that never agree, so it dwells nowhere — and a little sideways)
        const sy = (Math.sin(now * 5.3) + Math.sin(now * 8.9 + 1.3) + Math.sin(now * 13.7 + 2.1)) / 3;
        const sx = (Math.sin(now * 4.1 + 0.7) + Math.sin(now * 9.7 + 2.9)) / 2;
        this.shake.value.set(cfg.winShake * 0.3 * sx, cfg.winShake * sy);
        this.tick.value = (this.tick.value + 1) % 1024;
        this.drag.value.set(cfg.winDrag * 0.25 * Math.sin(now * 0.9 + 0.4), cfg.winDrag * (0.8 + 0.2 * Math.sin(now * 1.7)));
        // (street-feel's feedback buffer: what it held × decay, left bound — the people are drawn into it, added)
        const prev = gl.getRenderTarget(), prevAuto = gl.autoClear;
        this.acc.decayInto(gl, decay, 1);
        gl.autoClear = false;
        gl.render(this.personScene, cam);
        gl.autoClear = prevAuto;
        gl.setRenderTarget(prev);
        this.exposedMat.uniforms.uAcc.value = this.acc.texture;
        this.exposedMat.blendSrc = paper ? THREE.DstColorFactor : THREE.OneFactor;
        this.exposedMat.blendDst = paper ? THREE.ZeroFactor : THREE.OneFactor;
      }
    }
    this.exposedMesh.visible = showEx;
    this.exposedMat.uniforms.uSee.value = cfg.winSee;
    this.exposedMat.uniforms.uBlur.value = cfg.winDrag * 1.6;
    this.exposedMat.uniforms.uBoost.value = cfg.winBoost;
    this.exposedMat.uniforms.uAberr.value = cfg.winAberr;
    this.exposedMat.uniforms.uTear.value = cfg.winTear;
    this.exposedMat.uniforms.uGlitch.value = cfg.winGlitch;
    this.exposedMat.uniforms.uPaper.value = paper ? 1 : 0;
    (window as unknown as { __futureWindows?: unknown }).__futureWindows = { alive, seen, fill: Math.round(this.fill * 100) / 100, near: Math.round(near * 100) / 100, W: this.rt.width, H: this.rt.height, ms: Math.round(this.ms * 100) / 100, t: Math.round(t * 10) / 10, paper };
    return alive;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.acc?.dispose();
    this.acc = null;
    for (const q of this.people) q.mat.dispose();
    this.people = [];
    this.exposedMat.dispose();
    for (const w of this.wins) w.mat.dispose();
    this.wins = [];
    this.capMat.dispose();
    this.fillMat.dispose();
    this.fillMesh.geometry.dispose();
    this.winGeom.dispose();
  }
}
