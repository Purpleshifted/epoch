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
import { paperLook } from "./paperLook";
import { markSpan } from "./usePerfMeter";

export const WINDOWS_MAX = 12;

/** How a pixel reads the picture (the frames' tone and bend, the same knobs) and turns its ink into a colour. */
const INK = `
uniform sampler2D uTex;
uniform float uDens, uMono, uDistort, uDistAmt, uTime, uSeed;
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
  vec3 ink = 1.0 - exp(-uDens * s);
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
uniform vec2 uRes;
uniform float uA, uPose, uWalk, uShape, uSmear;
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
  gl_FragColor = vec4(mix(uBack, k.rgb, k.a), m * uA);
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
uniform float uFill, uAlpha, uFilm, uHow, uSmear;
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
  gl_FragColor = vec4((uLine * la + C * A * (1.0 - la)) / max(1e-4, A2), A2);
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
  private readonly exPos = new THREE.Vector3();
  private readonly capMat: THREE.ShaderMaterial;
  private readonly capScene = new THREE.Scene();
  private readonly winGeom: THREE.BufferGeometry;
  private readonly fillMat: THREE.ShaderMaterial;
  private readonly fillMesh: THREE.Mesh;
  private readonly plant = new THREE.Color("#2f8f3f");
  private readonly tones = { ink: new THREE.Color(), plant: new THREE.Color(), own: new THREE.Color(), film: new THREE.Color(), line: new THREE.Color(1, 1, 1), back: new THREE.Color() };
  /** The uniforms every window and the sheet share (one object each: set once a frame). */
  private readonly shared = { uTex: { value: null as THREE.Texture | null }, uDens: { value: 0.06 }, uMono: { value: 1 }, uDistort: { value: 0 }, uDistAmt: { value: 0.5 }, uTime: { value: 0 }, uInk: { value: this.tones.ink }, uPlant: { value: this.tones.plant }, uOwn: { value: this.tones.own }, uSmear: { value: 0.004 }, uRes: { value: new THREE.Vector2(1, 1) }, uBack: { value: this.tones.back } };

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
      uniforms: { uScale: { value: 400 }, uSplat: { value: 0.3 }, uR: { value: 14 }, uOrigin: { value: new THREE.Vector3() } },
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
      uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: 0.37 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uFill: { value: 0 }, uAlpha: { value: 0.85 }, uFilm: { value: 0.08 }, uHow: { value: 0 }, uFilmColor: { value: this.tones.film }, uLine: { value: this.tones.line } },
    });
    const f = new THREE.BufferGeometry();
    f.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fillMesh = new THREE.Mesh(f, this.fillMat);
    this.fillMesh.frustumCulled = false;
    this.fillMesh.visible = false;
    this.fillMesh.renderOrder = 999;
    this.group.add(this.fillMesh);
  }

  /** The picture (of the screen's shape; a phone smaller) and the windows — made, and put on the GPU, ahead. */
  ensure(gl: THREE.WebGLRenderer, phone: boolean, cfg: FuturePresenceVisual): void {
    gl.getDrawingBufferSize(size);
    // (small: it is a smudge, and it is taken every frame — at 512 high the taking halved the frame rate)
    const H = phone ? 216 : 288, W = Math.max(64, Math.min(640, Math.round((H * size.x) / Math.max(1, size.y))));
    if (!this.rt || this.rt.width !== W || this.rt.height !== H) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
      gl.initRenderTarget(this.rt);
      this.shared.uTex.value = this.rt.texture;
    }
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
          uniforms: { uTex: S.uTex, uDens: S.uDens, uMono: S.uMono, uDistort: S.uDistort, uDistAmt: S.uDistAmt, uTime: S.uTime, uSeed: { value: i * 0.37 + 0.11 }, uInk: S.uInk, uPlant: S.uPlant, uOwn: S.uOwn, uSmear: S.uSmear, uRes: S.uRes, uBack: S.uBack, uA: { value: 0 }, uPose: { value: 0 }, uWalk: { value: 0 }, uShape: { value: 0 } },
        });
        const mesh = new THREE.Mesh(this.winGeom, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.wins.push({ mesh, mat, born: 0, alive: false });
      }
    }
  }

  /** The programs made before the first encounter (and the taking's, as it is for a picture). */
  compile(gl: THREE.WebGLRenderer, cam: THREE.Camera): void {
    if (!this.rt) return;
    const vis = this.wins.map((w) => w.mesh.visible), fillVis = this.fillMesh.visible;
    for (const w of this.wins) w.mesh.visible = true;
    this.fillMesh.visible = true;
    const tmp = new THREE.Scene(), parent = this.group.parent;
    tmp.add(this.group);
    gl.compile(tmp, cam);
    if (parent) parent.add(this.group);
    else tmp.remove(this.group);
    this.wins.forEach((w, i) => (w.mesh.visible = vis[i]));
    this.fillMesh.visible = fillVis;
    const prev = gl.getRenderTarget(), prevAuto = gl.autoClear;
    gl.setRenderTarget(this.rt);
    gl.autoClear = false;
    gl.render(this.capScene, cam);
    gl.clear(true, false, false);
    gl.autoClear = prevAuto;
    gl.setRenderTarget(prev);
  }

  begin(origin: { x: number; z: number }, R: number, plant: string): void {
    this.place(origin, R);
    this.plant.set(plant);
    for (const w of this.wins) {
      w.alive = false;
      w.mesh.visible = false;
    }
    Object.assign(this, { next: 1, dropped: false, fill: 0, walk: 0 });
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
    S.uDistort.value = cfg.frameDistort === "stretch" ? 1 : cfg.frameDistort === "slit" ? 2 : cfg.frameDistort === "glitch" ? 3 : cfg.frameDistort === "glass" ? 4 : 0;
    S.uDistAmt.value = cfg.frameDistortAmt;
    S.uTime.value = now % 1000;
    S.uSmear.value = cfg.frameSmear * 0.35;
    gl.getDrawingBufferSize(S.uRes.value);
    // ② the observer's own window (the first), while it is in sight; ③ one more left where it was, every so far
    const stay = Math.max(1, cfg.winStay), h = cfg.winH, shape = cfg.winShape === "sheet" ? 1 : 0;
    const wide = shape ? h * 0.75 : h;
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
          a = Math.min(1, age / 0.6) * (seen ? 1 : 0);
          if (!seen) w.alive = false;
        } else {
          a = Math.min(1, age / 0.4) * Math.max(0, Math.min(1, (stay - age) / (stay * 0.3)));
          if (age >= stay) w.alive = false;
        }
      }
      w.mesh.visible = w.alive && a > 0.01;
      if (!w.mesh.visible) continue;
      alive++;
      // (upright, turned to the eye)
      w.mesh.rotation.set(0, Math.atan2(eye.x - w.mesh.position.x, eye.z - w.mesh.position.z), 0);
      w.mesh.scale.set(wide, h, 1);
      U.uA.value = a;
      U.uShape.value = shape;
      // ④ how near the visitor is to it
      const d = Math.hypot(w.mesh.position.x - me.x, w.mesh.position.z - me.z);
      const full = Math.min(cfg.winFillFull, cfg.winFillR - 0.01);
      near = Math.max(near, a * (1 - Math.max(0, Math.min(1, (d - full) / Math.max(0.01, cfg.winFillR - full)))));
    }
    this.fill += (near - this.fill) * 0.08;
    if (this.fill < 0.002 && near === 0) this.fill = 0;
    const F = this.fillMat.uniforms;
    this.fillMesh.visible = this.fill > 0.003;
    F.uFill.value = this.fill;
    F.uAlpha.value = cfg.winFillAlpha;
    F.uFilm.value = cfg.frameFilm;
    F.uHow.value = cfg.winFillHow === "scan" ? 1 : 0;
    // ① the picture, from the visitor's own eye, while there is anything to show it in
    if (alive > 0 || this.fillMesh.visible) {
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
    (window as unknown as { __futureWindows?: unknown }).__futureWindows = { alive, seen, fill: Math.round(this.fill * 100) / 100, near: Math.round(near * 100) / 100, W: this.rt.width, H: this.rt.height, ms: Math.round(this.ms * 100) / 100, t: Math.round(t * 10) / 10, paper };
    return alive;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    for (const w of this.wins) w.mat.dispose();
    this.wins = [];
    this.capMat.dispose();
    this.fillMat.dispose();
    this.fillMesh.geometry.dispose();
    this.winGeom.dispose();
  }
}
