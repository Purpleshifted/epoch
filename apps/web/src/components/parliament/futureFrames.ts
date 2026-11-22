/**
 * futureFrames — THE FUTURE COMES AS FRAMES (the artist, 2026-11-22 night, correcting the scan: "'닥쳐온다'라고 내가 묘사해서
 * 지시한 것도 연속적으로 닥쳐오는 2D 프레임을 원한 거였지 지형지물을 스캔해서 구현하라는 게 아니었음" · "그 자리의 미래도시
 * 스냅샷인데, 내가 둘러보고 움직임에 따라 새로 렌더되는 2D 뷰가 (Claire Harvey처럼) 반투명하게 렌더돼서 공간감을 주도록
 * 배열되게" · "세계 속에 선 판들이 줄지어 다가옴, 발굴자 반경에서 벗어나면 사라짐").
 *
 * ① TAKEN: while the archaeologist is near, the future round the visitor (the encounter's sampling of it, never drawn) is
 *   rendered from the visitor's eye into a small picture — one every half second, sooner when the eye has turned or moved.
 *   Not a depth image: INK, added up with no occlusion (a long exposure) — what is left of the buildings heavy, the ground
 *   a haze, the plants and the visitor's own cells in channels of their own.
 * ② STOOD: each picture is a translucent plate in the world, facing the gaze it was taken with, its edges soft (acetate),
 *   a little off in place and tilt.
 * ③ COMES: born at the archaeologist — the size of its body — it rushes to where the eye was, growing, slowing as it
 *   arrives, and drifts on through the visitor and away behind. A row of them: the layers' parallax is the depth.
 * ④ APPEARS under a white scan line, top to bottom.
 * ⑤ GOES when the archaeologist is out of reach: the picture runs down its columns (pixel-sorted), or its cells go out,
 *   or the scan line returns.
 * ⑥ THE ARCHAEOLOGIST is a window of a body's shape: inside it, the newest picture, where it belongs in the world.
 * ⑦ ON PAPER (paperLook, the street look's white ground) the ink is dark on white; on the black ground, light.
 *
 * Cost: one small offscreen pass a picture (≤ 2 a second), ≤ 12 plates (a draw call each) and the window.
 */

import * as THREE from "three";
import type { FuturePresenceVisual } from "./FuturePresence";
import { paperLook } from "./paperLook";
import { markSpan } from "./usePerfMeter";

/** The most plates at once (the artist's draft: 10 – 12). */
export const FRAMES_MAX = 12;
/** The skirt under a plate (of its height): where the picture runs down to as it goes. */
const SKIRT = 0.45;

const CAPTURE_VERT = `
attribute vec3 color;
attribute vec4 aSeed;
uniform float uScale, uSplat, uR;
uniform vec3 uOrigin;
varying vec3 vInk;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 p = position;
  // (the piece of the future has a ragged edge, as the dream's: it thins out, it is not cut)
  float win = 1.0 - length(p.xz - uOrigin.xz) / uR + n3(p * 0.35) * 0.55 + n3(p * 1.3) * 0.2 - 0.35;
  float edge = clamp(win * 3.0, 0.0, 1.0);
  float kind = aSeed.y;
  float lum = dot(color, vec3(0.3333));
  // how heavy its ink: the ground a haze (by its own tone), what is left of a building heavy, mounds and dark earth between
  float w = kind < 0.5 ? 0.1 + 0.7 * lum : kind < 1.5 ? 5.0 : kind < 2.5 ? 2.5 : kind < 3.5 ? 4.0 : kind < 4.5 ? 1.5 : kind < 5.5 ? 2.5 : 0.7;
  vInk = (kind > 5.5 ? vec3(0.0, 0.0, 1.0) : (kind > 1.5 && kind < 3.5) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)) * w * edge;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = edge <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  float s = (kind < 0.5 || kind > 3.5) ? uSplat : uSplat * 0.6;
  float px = s * uScale / max(0.1, -mv.z);
  float cl = clamp(px, 1.5, 40.0);
  // (the same ink whatever the size it had to be drawn at)
  vInk *= (px * px) / (cl * cl);
  gl_PointSize = cl;
}`;
const CAPTURE_FRAG = `
varying vec3 vInk;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  gl_FragColor = vec4(vInk * exp(-r * 3.0), 1.0);
}`;

const PLATE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PLATE_FRAG = `
uniform sampler2D uTex;
uniform float uAlpha, uFilm, uDens, uReveal, uOut, uOutMode, uSeed, uFade, uSmear, uEdge, uLineW;
uniform vec3 uInk, uPlant, uOwn, uFilmColor, uLine;
varying vec2 vUv;
float h1(float x) { return fract(sin(x * 127.1 + uSeed * 311.7) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 74.7) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  float show = 1.0, line = 0.0, streak = 0.0, gone = 0.0;
  // ④ it appears under a white scan line, top to bottom
  float yl = 1.0 - uReveal * 1.1;
  show *= smoothstep(yl, yl + 0.006, uv.y);
  if (uReveal < 0.999) line = 1.0 - smoothstep(0.0, uLineW, abs(uv.y - yl));
  // ⑤ it goes
  if (uOut > 0.0) {
    if (uOutMode < 0.5) {
      // … running down: each column at its own moment, its picture sliding down and drawn out into a streak
      float hc = h1(floor(uv.x * 110.0)), hw = h1(floor(uv.x * 19.0) + 50.0);
      float m = clamp((uOut - 0.5 * mix(hc, hw, 0.6)) / 0.5, 0.0, 1.0);
      streak = m * (0.25 + 0.9 * hc);
      uv.y += m * m * (0.5 + 0.8 * hw);
      gone = smoothstep(0.55, 1.0, m);
    } else if (uOutMode < 1.5) {
      // … its cells going out
      show *= step(uOut * 1.05, h2(floor(uv * vec2(44.0, 66.0))));
    } else {
      // … the scan line returning, bottom to top
      float y2 = uOut * 1.1 - 0.05;
      show *= smoothstep(y2, y2 + 0.006, uv.y);
      line = max(line, 1.0 - smoothstep(0.0, uLineW, abs(uv.y - y2)));
    }
  }
  // (the plate itself: 0 … 1 of its height; under it the skirt, where only what runs down is)
  float inY = step(0.0, uv.y) * step(uv.y, 1.0);
  vec2 e = smoothstep(vec2(0.0), vec2(uEdge), vec2(uv.x, uv.y)) * smoothstep(vec2(0.0), vec2(uEdge), 1.0 - vec2(uv.x, uv.y));
  float ex = e.x, edge = e.x * e.y * inY;
  // the picture: a long exposure's sideways smear, and (going) the streak of what was above
  vec3 s = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1);
    vec2 q = uv + vec2((t - 0.5) * uSmear, t * streak);
    s += texture2D(uTex, clamp(q, 0.0, 1.0)).rgb * step(0.0, q.y) * step(q.y, 1.0);
  }
  s /= float(TAPS);
  vec3 ink = 1.0 - exp(-uDens * s);
  float a = 1.0 - (1.0 - ink.r) * (1.0 - ink.g) * (1.0 - ink.b);
  vec3 c = (uInk * ink.r + uPlant * ink.g + uOwn * ink.b) / max(1e-3, ink.r + ink.g + ink.b);
  float aImg = a * uAlpha * (streak > 0.0 ? ex * smoothstep(-${SKIRT.toFixed(2)}, -${(SKIRT * 0.6).toFixed(2)}, vUv.y) : edge);
  float aFilm = uFilm * edge * (1.0 - uOut);
  float A = aFilm + (1.0 - aFilm) * aImg;
  vec3 C = (uFilmColor * aFilm + c * aImg * (1.0 - aFilm)) / max(1e-4, A);
  A *= show * uFade * (1.0 - gone);
  float la = line * 0.85 * ex * uFade * step(-0.02, vUv.y);
  float A2 = la + A * (1.0 - la);
  C = (uLine * la + C * A * (1.0 - la)) / max(1e-4, A2);
  if (A2 < 0.004) discard;
  gl_FragColor = vec4(C, A2);
}`;

const WINDOW_VERT = `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** ⑥ A body's shape (head, trunk, two legs, two arms — a stride when it walks), and in it the newest picture where it
 *  belongs: the fragment's own place put through that picture's eye. */
const WINDOW_FRAG = `
uniform sampler2D uTex;
uniform mat4 uVP;
uniform float uHas, uA, uT, uWalk, uDens;
uniform vec3 uInk, uPlant, uOwn, uBack;
varying vec2 vUv;
varying vec3 vWorld;
float cap(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
void main() {
  vec2 p = vec2((vUv.x - 0.5) * 0.6, vUv.y);
  float sw = sin(uT * 6.0) * uWalk;
  float d = length(p - vec2(0.0, 0.905)) - 0.075;
  d = min(d, cap(p, vec2(0.0, 0.80), vec2(0.0, 0.52), 0.085));
  d = min(d, cap(p, vec2(-0.05, 0.50), vec2(-0.06 - sw * 0.09, 0.04), 0.045));
  d = min(d, cap(p, vec2(0.05, 0.50), vec2(0.06 + sw * 0.09, 0.04), 0.045));
  d = min(d, cap(p, vec2(-0.105, 0.78), vec2(-0.13 + sw * 0.06, 0.47), 0.032));
  d = min(d, cap(p, vec2(0.105, 0.78), vec2(0.13 - sw * 0.06, 0.47), 0.032));
  float m = 1.0 - smoothstep(-0.004, 0.006, d);
  if (m * uA < 0.01) discard;
  vec3 col = uBack;
  vec4 clip = uVP * vec4(vWorld, 1.0);
  vec2 q = clip.xy / max(1e-4, clip.w) * 0.5 + 0.5;
  if (uHas > 0.5 && clip.w > 0.0 && q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
    vec3 ink = 1.0 - exp(-uDens * 2.0 * texture2D(uTex, q).rgb);
    float a = 1.0 - (1.0 - ink.r) * (1.0 - ink.g) * (1.0 - ink.b);
    vec3 c = (uInk * ink.r + uPlant * ink.g + uOwn * ink.b) / max(1e-3, ink.r + ink.g + ink.b);
    col = mix(col, c, a);
  }
  gl_FragColor = vec4(col, m * uA);
}`;

interface Plate {
  rt: THREE.WebGLRenderTarget;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  vp: THREE.Matrix4;
  born: number;
  alive: boolean;
  /** Where it was born (the archaeologist), the way it goes (to where the eye was, and on), how far that was. */
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  /** How it is off: in place (at full size), in tilt (in its quaternion). */
  off: THREE.Vector3;
  s0: number;
}

export interface FramesTick {
  gl: THREE.WebGLRenderer;
  cam: THREE.Camera;
  /** Now (s), and the encounter's clock: since it began, when it goes, how long the going takes. */
  now: number;
  t: number;
  outAt: number;
  outLen: number;
  /** The archaeologist (nearest image to the visitor), or null when it is not known this frame. */
  ex: { x: number; z: number; standing: boolean } | null;
  cfg: FuturePresenceVisual;
}

const eye = new THREE.Vector3();
const fwd = new THREE.Vector3();
const v1 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const clearTmp = new THREE.Color();
/** A colour as it is to be on the screen (these shaders write their colours as they are). */
const shown = (c: THREE.Color, hex: string, k = 1) => c.set(hex).convertLinearToSRGB().multiplyScalar(k);

export class FutureFrames {
  readonly group = new THREE.Group();
  private plates: Plate[] = [];
  private W = 0;
  private H = 0;
  private taps = 0;
  private next = 0;
  private newest = -1;
  private n = 0;
  private lastAt = -Infinity;
  private lastDir = new THREE.Vector3();
  private lastPos = new THREE.Vector3();
  private ms = 0;
  private walk = 0;
  private exPos = new THREE.Vector3();
  private readonly capCam = new THREE.PerspectiveCamera();
  private readonly capMat: THREE.ShaderMaterial;
  private readonly capScene = new THREE.Scene();
  private readonly plateGeom: THREE.BufferGeometry;
  private readonly winGeom: THREE.BufferGeometry;
  private readonly winMat: THREE.ShaderMaterial;
  private readonly win: THREE.Mesh;
  private readonly plant = new THREE.Color("#2f8f3f");
  private readonly tones = { ink: new THREE.Color(), plant: new THREE.Color(), own: new THREE.Color(), film: new THREE.Color(), line: new THREE.Color(1, 1, 1), back: new THREE.Color() };

  /** `cloud`: the encounter's sampling of the future (position, color, aSeed.y = what a point is). */
  constructor(cloud: THREE.BufferGeometry) {
    this.capMat = new THREE.ShaderMaterial({
      vertexShader: CAPTURE_VERT,
      fragmentShader: CAPTURE_FRAG,
      // (added up, nothing hidden by anything: a long exposure)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uSplat: { value: 0.25 }, uR: { value: 10 }, uOrigin: { value: new THREE.Vector3() } },
    });
    const pts = new THREE.Points(cloud, this.capMat);
    pts.frustumCulled = false;
    this.capScene.add(pts);
    this.capCam.matrixAutoUpdate = false;
    this.capCam.matrixWorldAutoUpdate = false;
    // a plate: 1 wide, 1 high about its middle, and the skirt under it (uv.y below 0)
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5 - SKIRT, 0, 0.5, -0.5 - SKIRT, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, -SKIRT, 1, -SKIRT, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.plateGeom = g;
    // the window: 1 wide, 1 high, standing on its base
    const w = new THREE.BufferGeometry();
    w.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    w.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    w.setIndex([0, 1, 2, 0, 2, 3]);
    this.winGeom = w;
    this.winMat = new THREE.ShaderMaterial({
      vertexShader: WINDOW_VERT,
      fragmentShader: WINDOW_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTex: { value: null }, uVP: { value: new THREE.Matrix4() }, uHas: { value: 0 }, uA: { value: 0 }, uT: { value: 0 }, uWalk: { value: 0 }, uDens: { value: 0.03 }, uInk: { value: this.tones.ink }, uPlant: { value: this.tones.plant }, uOwn: { value: this.tones.own }, uBack: { value: this.tones.back } },
    });
    this.win = new THREE.Mesh(this.winGeom, this.winMat);
    this.win.frustumCulled = false;
    this.win.visible = false;
    this.win.renderOrder = 2;
    this.group.add(this.win);
  }

  /** The plates and their pictures (a phone: half the size each way, fewer taps) — made, and put on the GPU, before the
   *  first encounter. */
  ensure(gl: THREE.WebGLRenderer, phone: boolean, cfg: FuturePresenceVisual): void {
    const W = phone ? 256 : 512, H = phone ? 384 : 768, taps = phone ? 3 : 7;
    const K = Math.max(2, Math.min(FRAMES_MAX, Math.round(cfg.frameMax)));
    if (this.W === W && this.taps === taps && this.plates.length === K) return;
    for (const p of this.plates) {
      p.rt.dispose();
      p.mat.dispose();
      this.group.remove(p.mesh);
    }
    this.plates = [];
    Object.assign(this, { W, H, taps, next: 0, newest: -1 });
    for (let i = 0; i < K; i++) {
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
      const mat = new THREE.ShaderMaterial({
        vertexShader: PLATE_VERT,
        fragmentShader: PLATE_FRAG,
        defines: { TAPS: taps },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTex: { value: rt.texture }, uAlpha: { value: 0.45 }, uFilm: { value: 0.05 }, uDens: { value: 0.03 }, uReveal: { value: 0 }, uOut: { value: 0 }, uOutMode: { value: 0 }, uSeed: { value: i * 0.37 + 0.11 }, uFade: { value: 1 }, uSmear: { value: 0.012 }, uEdge: { value: 0.1 }, uLineW: { value: 0.012 }, uInk: { value: this.tones.ink }, uPlant: { value: this.tones.plant }, uOwn: { value: this.tones.own }, uFilmColor: { value: this.tones.film }, uLine: { value: this.tones.line } },
      });
      const mesh = new THREE.Mesh(this.plateGeom, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      gl.initRenderTarget(rt);
      this.plates.push({ rt, mesh, mat, vp: new THREE.Matrix4(), born: 0, alive: false, from: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), dist: 1, off: new THREE.Vector3(), s0: 0.2 });
    }
  }

  /** The three programs made before the first encounter (a compile at the encounter stalls its first frame). */
  compile(gl: THREE.WebGLRenderer, cam: THREE.Camera): void {
    const was = this.plates.map((p) => p.mesh.visible), winWas = this.win.visible;
    for (const p of this.plates) p.mesh.visible = true;
    this.win.visible = true;
    const tmp = new THREE.Scene();
    const parent = this.group.parent;
    tmp.add(this.group);
    gl.compile(tmp, cam);
    gl.compile(this.capScene, cam);
    // (and the taking's program as it is for a picture: one empty picture taken now)
    if (this.plates.length) {
      const prev = gl.getRenderTarget(), prevAuto = gl.autoClear;
      gl.setRenderTarget(this.plates[0].rt);
      gl.autoClear = false;
      gl.render(this.capScene, cam);
      gl.clear(true, false, false);
      gl.autoClear = prevAuto;
      gl.setRenderTarget(prev);
    }
    if (parent) parent.add(this.group);
    else tmp.remove(this.group);
    this.plates.forEach((p, i) => (p.mesh.visible = was[i]));
    this.win.visible = winWas;
  }

  /** An encounter begins: where the future's piece is, how far it reaches, the plants' colour. */
  begin(origin: { x: number; z: number }, R: number, plant: string): void {
    this.capMat.uniforms.uOrigin.value.set(origin.x, 0, origin.z);
    this.capMat.uniforms.uR.value = R;
    this.plant.set(plant);
    for (const p of this.plates) {
      p.alive = false;
      p.mesh.visible = false;
    }
    Object.assign(this, { next: 0, newest: -1, n: 0, lastAt: -Infinity, walk: 0 });
    this.winMat.uniforms.uHas.value = 0;
  }

  end(): void {
    for (const p of this.plates) {
      p.alive = false;
      p.mesh.visible = false;
    }
    this.win.visible = false;
  }

  /** ① One picture taken from the eye, ② stood as the next plate, born at the archaeologist. */
  private take(o: FramesTick): void {
    const { gl, cam, cfg, now } = o;
    const t0 = performance.now();
    const i = this.next, pl = this.plates[i];
    this.next = (i + 1) % this.plates.length;
    this.newest = i;
    this.n++;
    const pc = cam as THREE.PerspectiveCamera, c = this.capCam;
    c.fov = pc.isPerspectiveCamera ? pc.fov : 50;
    c.aspect = this.W / this.H;
    c.near = pc.isPerspectiveCamera ? pc.near : 0.1;
    c.far = pc.isPerspectiveCamera ? pc.far : 1000;
    c.updateProjectionMatrix();
    c.matrixWorld.copy(cam.matrixWorld);
    c.matrixWorldInverse.copy(cam.matrixWorldInverse);
    const tanH = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
    this.capMat.uniforms.uScale.value = this.H / 2 / tanH;
    this.capMat.uniforms.uSplat.value = cfg.frameSplat;
    const prev = gl.getRenderTarget(), prevAuto = gl.autoClear, prevA = gl.getClearAlpha();
    gl.getClearColor(clearTmp);
    gl.setRenderTarget(pl.rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    gl.autoClear = false;
    gl.render(this.capScene, c);
    gl.autoClear = prevAuto;
    gl.setClearColor(clearTmp, prevA);
    gl.setRenderTarget(prev);
    pl.vp.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    // ③ from the archaeologist (its body's middle) to where the eye is now, and on
    const body = cfg.frameBody;
    pl.from.set(this.exPos.x, body * 0.55, this.exPos.z);
    pl.dir.copy(eye).sub(pl.from);
    pl.dist = Math.max(0.5, pl.dir.length());
    if (pl.dir.lengthSq() < 1e-6) pl.dir.copy(fwd).negate();
    pl.dir.normalize();
    // (a little off: sideways and up, and in tilt)
    const j = cfg.frameJitter;
    v1.crossVectors(pl.dir, cam.up).normalize();
    pl.off.copy(v1).multiplyScalar((Math.random() - 0.5) * 2 * j).addScaledVector(cam.up, (Math.random() - 0.5) * 0.8 * j);
    cam.getWorldQuaternion(pl.mesh.quaternion);
    pl.mesh.quaternion.multiply(q1.setFromEuler(e1.set(0, (Math.random() - 0.5) * 0.3 * j, (Math.random() - 0.5) * 0.15 * j)));
    pl.s0 = Math.min(1, body / Math.max(0.5, cfg.frameH));
    pl.born = now;
    pl.alive = true;
    pl.mat.uniforms.uSeed.value = Math.random() * 10;
    this.winMat.uniforms.uTex.value = pl.rt.texture;
    this.winMat.uniforms.uVP.value.copy(pl.vp);
    this.winMat.uniforms.uHas.value = 1;
    this.lastAt = now;
    this.lastDir.copy(fwd);
    this.lastPos.copy(eye);
    this.ms = performance.now() - t0;
    markSpan("future-frame", this.ms);
  }

  update(o: FramesTick): void {
    const { cam, cfg, now, t, outAt, outLen } = o;
    if (!this.plates.length) return;
    cam.getWorldPosition(eye);
    cam.getWorldDirection(fwd);
    // ⑦ on paper, dark ink; on the black ground, light
    const paper = cfg.framePaper === "paper" || (cfg.framePaper === "auto" && paperLook.on);
    const T = this.tones;
    if (paper) {
      shown(T.ink, paperLook.ink);
      shown(T.own, "#000000");
      shown(T.film, paperLook.paper, 0.84);
      shown(T.back, paperLook.paper, 0.82);
      T.plant.copy(this.plant).convertLinearToSRGB().lerp(clearTmp.setRGB(0.62, 0.7, 0.6), 0.25);
    } else {
      shown(T.ink, "#e4e4e4");
      shown(T.own, "#ffffff");
      shown(T.film, "#303030");
      shown(T.back, "#2a2a2a");
      T.plant.copy(this.plant).convertLinearToSRGB().lerp(clearTmp.setRGB(0.7, 0.85, 0.7), 0.3);
    }
    const dens = 0.03 * cfg.frameInk;
    const going = Math.max(0, Math.min(1, (t - outAt) / Math.max(0.1, outLen)));
    // ⑥ the archaeologist: a window of a body's shape, upright, turned to the eye
    if (o.ex) this.exPos.set(o.ex.x, 0, o.ex.z);
    this.walk += ((o.ex && !o.ex.standing ? 1 : 0) - this.walk) * 0.1;
    const env = Math.min(1, t / Math.max(0.1, cfg.inSec)) * (1 - going);
    const W = this.winMat.uniforms;
    this.win.visible = env > 0.01;
    this.win.position.copy(this.exPos);
    this.win.rotation.set(0, Math.atan2(eye.x - this.exPos.x, eye.z - this.exPos.z), 0);
    this.win.scale.set(cfg.frameBody, cfg.frameBody, 1);
    W.uA.value = env;
    W.uT.value = now;
    W.uWalk.value = this.walk;
    W.uDens.value = dens;
    // ① another picture: every `frameEvery`, sooner when the eye has turned or moved (never so soon that a plate still
    // standing is taken for it)
    const life = Math.max(1, cfg.frameLife);
    if (t < outAt) {
      const since = now - this.lastAt, gap = Math.max(0.15, life / this.plates.length);
      const turned = THREE.MathUtils.radToDeg(fwd.angleTo(this.lastDir));
      if (this.n === 0 || since >= Math.max(gap, cfg.frameEvery) || (since >= gap && (turned >= cfg.frameTurn || eye.distanceTo(this.lastPos) >= cfg.frameMove))) this.take(o);
    }
    // ③ the plates come, slow, pass, and go
    let live = 0;
    for (const pl of this.plates) {
      const age = now - pl.born;
      if (!pl.alive || age > life) {
        pl.alive = false;
        pl.mesh.visible = false;
        continue;
      }
      // (going: the oldest first)
      const melt = t > outAt ? Math.max(0, Math.min(1, (t - outAt - (1 - age / life) * outLen * 0.25) / Math.max(0.1, outLen * 0.75))) : 0;
      if (melt >= 1) {
        pl.alive = false;
        pl.mesh.visible = false;
        continue;
      }
      live++;
      const rest = Math.min(cfg.frameRest, pl.dist * 0.6), approach = pl.dist - rest;
      const u = Math.min(1, age / Math.max(0.1, cfg.frameArriveSec));
      const come = 1 - Math.pow(1 - u, 2.5);
      const grown = Math.pow(come, 0.7);
      pl.mesh.position.copy(pl.from).addScaledVector(pl.dir, approach * come + cfg.framePass * age).addScaledVector(pl.off, grown);
      const sc = (pl.s0 + (1 - pl.s0) * grown) * cfg.frameH;
      pl.mesh.scale.set((sc * this.W) / this.H, sc, 1);
      pl.mesh.visible = true;
      const U = pl.mat.uniforms;
      // (soft where it passes through the eye; fading over the last fifth of its time)
      const near = Math.min(1, Math.max(0, (pl.mesh.position.distanceTo(eye) - 0.08) / 0.6));
      U.uFade.value = near * Math.min(1, (life - age) / (life * 0.2));
      U.uReveal.value = Math.min(1, age / Math.max(0.05, cfg.frameRevealSec));
      U.uOut.value = melt;
      U.uOutMode.value = cfg.frameOut === "dots" ? 1 : cfg.frameOut === "line" ? 2 : 0;
      U.uAlpha.value = cfg.frameAlpha;
      U.uFilm.value = cfg.frameFilm;
      U.uDens.value = dens;
      U.uSmear.value = cfg.frameSmear;
    }
    (window as unknown as { __futureFrames?: unknown }).__futureFrames = { n: this.n, live, W: this.W, H: this.H, ms: Math.round(this.ms * 100) / 100, t: Math.round(t * 10) / 10, outAt: Math.round(outAt * 10) / 10, paper, going: Math.round(going * 100) / 100 };
  }

  dispose(): void {
    for (const p of this.plates) {
      p.rt.dispose();
      p.mat.dispose();
    }
    this.plates = [];
    this.capMat.dispose();
    this.winMat.dispose();
    this.plateGeom.dispose();
    this.winGeom.dispose();
  }
}
