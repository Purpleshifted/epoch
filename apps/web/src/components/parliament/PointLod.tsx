"use client";
/**
 * PointLod — THE FAR GREENERY ON THE WALL, BY ONE RULE (the artist, 2026-11-28: "글로벌 보편에서 먼 점은 뭉쳐보이는 lod
 * 추가해서 레바로 조절할 수 있게 하고, 그게 히어로샷에도 반영되어 그려지도록"; "personal 에서 거리 따라 흐린 정도, 뭉치는 정도
 * 설정한 것처럼 범위만 다르게 해서 안 되나?"; then, of two clumpings acting apart: "거리 따라 뭉치는 거랑 밀도 따라 뭉치는 거
 * 따로 적용되는 게 헷갈림, 이 lod 식생 폴더로 옮기면서 알고리즘 통일 검토좀" → one rule, the blur's start the one start).
 *
 * DISTANCE DECIDES HOW MUCH GOES FAR; DENSITY DECIDES WHAT IT BECOMES THERE. Before 시작 거리 (world, from the eye) every
 * point is as it was; from there to 끝 거리 a growing share of them (by a hash of each point, so the change is gradual)
 * is handed to THE FAR SIDE; past 끝, all of them. A point on the far side, at the share t of the range where it stands:
 *   1 · FEWER AND LARGER — the phone's rule for its far readings (FutureResidue, LidarScan): drawn g times larger, g = 1 at
 *       시작 → 멀리서 점이 커지는 정도 at 끝, and kept with the chance 1 / g² — the area a cloud covers stays, the points
 *       drawn fall (the wall lighter);
 *   2 · SOFTENED — the photograph's rule of the personal view (InkPaper: a wide blur, fading with distance), made light:
 *       drawn in a frame a quarter of the picture's size while PointFrame runs (in the wall's composer), smaller there by
 *       the frame's scale with its light kept, hidden where the wall's depth is nearer, paler by 옅어짐 × t; that frame is
 *       blurred widely (흐림) and laid over the picture;
 *   3 · MASS OR FADE BY DENSITY — where the blurred far greenery looks dense (its coverage over 뭉치는 밀도) it closes into
 *       a solid mass, where sparse it fades, by 뭉침 (0 = as blurred).
 * A point that stays near is the wall's own render's, as crisp and as fine as ever: it never grows. Without the composer
 * (no frame) the far side is 1 only. (Before: a growth of its own — 뭉치기 시작 거리 · 세기 — on every point past its start,
 * near ones too, beside the blur's own range: two clumpings, by distance and by density, acting apart.)
 *
 * THE KNOBS stand in 식생 (사람의 반대) › 먼 식생 (거리 따라 뭉침): what they act on is the present's greenery (below).
 *
 * Applied to the PRESENT's point clouds that have a size in the world: a PointsMaterial with size attenuation, or a
 * point shader of its own (a ShaderMaterial on a Points that writes gl_PointSize). That is, as of 2026-11-28:
 *   - the present's plants on the ground: Vegetation's clouds (ParliamentSpace VEG shader);
 *   - Dandelions (seed heads, ghosts, dust), which stand in the present.
 * Left as they are, marked userData.noPointLod (nothing under such a mark is touched): THE FUTURE LAYER, all of it (the
 * artist, 2026-11-28: "이거 미래 층에는 적용되면 안 됨" — FutureVillage and FutureUnder stand in marked groups); THE
 * VEGETATION ON THE BUILDINGS ("건물 식생에도 적용 안 되게 해줘" — the gathered plants' points). And points with a size on
 * the screen (no size attenuation — the walkways' end dots).
 *
 * How: a few lines at the end of each one's shaders (its own onBeforeCompile kept, run first), found by walking the scene
 * once a second; a material its component replaces, or whose hook React sets again, is patched again then. The
 * distance is the eye's depth: the hero shot draws with the same camera, only zoomed, so a still at any size has the
 * same far points; its frame's blur is scaled by the still's pixels per screen pixel. The same patch draws the finest
 * points of a hero shot at the still's own fineness (startPointShot).
 *
 * (85428a7 · 2fe9753 · a9f8079 — the points pulled into a lattice's clumps, a lighter core, additive cloud copies — are
 * gone with their knobs 뭉침 · 덩어리 크기 · 구름: "들어가는 게 너무 적어서 … 이 방식으로 뭉치는 게 맞나?")
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import * as THREE from "three";
import { savable } from "./levaSave";

/** Where the knobs are: a folder in the vegetation's (ParliamentSpace VEG_GROUP — they act on the present's greenery
 *  only), saved with it; what was saved in the group they had before is read until something is saved here. */
const ROOT = "식생 (사람의 반대).먼 식생 (거리 따라 뭉침)";
const ROOT_OLD = "먼 점 뭉치기 (LOD)";
/** The layer the patched points are drawn on while their own frame is drawn (PointFrame): out of the wall's render.
 *  (2 is InkPaper's EXPOSURE_LAYER, 5 PICTO_LAYER, 6 FUTURE_LAYER) */
const POINT_LAYER = 9;

/** Shared by every patched shader: switch, how much the far side grows at 끝 (×); a hero shot's pixels per screen pixel
 *  and its size; the wall's own depth (to hide the points behind it in their own frame); the range (시작 → 끝), the fade. */
const pointLodU = {
  uPlodOn: { value: 0 },
  uPlodMax: { value: 3 },
  uPlodShot: { value: 1 },
  uPlodView: { value: new THREE.Vector2(1, 1) },
  uPlodOccTex: { value: null as THREE.Texture | null },
  /** 1 while the small frame is being drawn (PointFrameEffect): the far points draw there, hidden behind the wall */
  uPlodOccOn: { value: 0 },
  uPlodOccRes: { value: new THREE.Vector2(1, 1) },
  /** 1 while the small frame is in the composer: the points are parted between the wall's render and the frame */
  uPlodSplit: { value: 0 },
  uPlodFrom: { value: 110 },
  uPlodTo: { value: 260 },
  uPlodFade: { value: 0.3 },
  /** the small frame's height over the picture's: a point is that much smaller there */
  uPlodFrameScale: { value: 0.25 },
};

/**
 * A HERO SHOT'S FINER PIXELS (the artist, 2026-11-28, of a hero shot: "이것봐, 히어로샷에서 식생 진짜 안 보여", then, of a
 * first fix that held every point to two of the still's pixels: "그냥 *2만 하니깐 화질이 너무 떨어짐"). A GPU draws no point
 * smaller than a pixel: on the screen the present's finest plant dots (a hundredth of a world wide) come out under one,
 * are drawn one screen pixel wide, and read as greenery. A still of the same frame has `r` times the pixels each way, so
 * the same floor covers 1/r² of what it did and the dots all but vanish; one square r pixels wide (the first fix) is the
 * same green, but coarse. So in a still a point stays at its own size and is drawn in several COPIES, scattered over
 * about the width the screen's pixel had, as many as it takes to cover what that pixel covered (r² for the finest, one
 * for a point already r wide): the same green, at the still's own fineness. Copy 0 is the point itself.
 *
 * startPointShot (HeroShot HeroCapture, once the shot's size is applied) makes the copies — each patched Points of the
 * scene gets children sharing its geometry and its program, each with its copy's number — and gives the function that
 * takes them away; pointShotView tells the shaders the still's size in pixels.
 */
const copyUs = new WeakMap<THREE.Material, { value: number }>();
const copyU = (m: THREE.Material): { value: number } => {
  let u = copyUs.get(m);
  if (!u) copyUs.set(m, (u = { value: 0 }));
  return u;
};

/** A material as another draw of the same points: the same hooks and key (the same program), its own uniforms object
 *  for a point shader of its own (its live uniforms shared, not copied). */
function copyMaterial(m: THREE.Material): THREE.Material {
  const cm = m.clone();
  if ((m as THREE.ShaderMaterial).isShaderMaterial) (cm as THREE.ShaderMaterial).uniforms = { ...(m as THREE.ShaderMaterial).uniforms };
  cm.onBeforeCompile = m.onBeforeCompile;
  cm.customProgramCacheKey = m.customProgramCacheKey;
  return cm;
}

export function pointShotView(w: number, h: number): void {
  pointLodU.uPlodView.value.set(Math.max(1, w), Math.max(1, h));
}

export function startPointShot(scene: THREE.Object3D, r: number): () => void {
  const R = Number.isFinite(r) ? Math.max(1, r) : 1;
  pointLodU.uPlodShot.value = R;
  // (how many copies the finest point takes: r², at most 16)
  const n = Math.min(16, Math.ceil(R * R - 1e-3));
  const made: { p: THREE.Points; m: THREE.Material }[] = [];
  if (n > 1) {
    const hosts: THREE.Points[] = [];
    scene.traverse((o) => {
      const pts = o as THREE.Points;
      if (!pts.isPoints || pts.userData.plodCopy || Array.isArray(pts.material) || !patched.has(pts.material) || markedOut(pts)) return;
      hosts.push(pts);
    });
    for (const pts of hosts) {
      const m = pts.material as THREE.Material;
      for (let c = 1; c < n; c++) {
        // (the same program, built once; only its copy's number is its own)
        const cm = copyMaterial(m);
        copyUs.set(cm, { value: c });
        const p = new THREE.Points(pts.geometry, cm);
        Object.assign(p.userData, { plodCopy: c, noPointLod: true });
        p.frustumCulled = pts.frustumCulled;
        p.renderOrder = pts.renderOrder;
        // (on the layer its points are on: in their own frame, or the wall's)
        p.layers.mask = pts.layers.mask;
        pts.add(p);
        made.push({ p, m: cm });
      }
    }
  }
  return () => {
    pointLodU.uPlodShot.value = 1;
    for (const { p, m } of made) {
      p.removeFromParent();
      m.dispose();
    }
  };
}

const HEAD = "uniform float uPlodOn, uPlodMax, uPlodShot, uPlodCopy, uPlodOccOn, uPlodSplit, uPlodFrom, uPlodTo, uPlodFade, uPlodFrameScale;\nuniform vec2 uPlodView;\nvarying float vPlodLight;\n";
const TAIL = `
  // ONE RULE BY DISTANCE (PointLod.tsx): a share of the points by distance — none before 시작, all past 끝 — is the far
  // side (by a hash of each point, so the change is gradual); t is where in the range it stands
  vPlodLight = 1.0;
  float plodT = 0.0;
  bool plodFar = false;
  if ( uPlodOn > 0.5 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    plodT = smoothstep( uPlodFrom, max( uPlodFrom + 1.0, uPlodTo ), gl_Position.w );
    uint plodQ = uint( gl_VertexID ) * 3266489917u + 668265263u;
    plodQ = ( plodQ ^ ( plodQ >> 15u ) ) * 2246822519u;
    plodQ = plodQ ^ ( plodQ >> 13u );
    plodFar = float( plodQ >> 8u ) * ( 1.0 / 16777216.0 ) < plodT;
  }
  // 1 · THE FAR SIDE FEWER AND LARGER: grown g times (1 at 시작 → uPlodMax at 끝), kept with the chance 1 / g^2
  if ( plodFar && uPlodMax > 1.0 ) {
    float plodG = mix( 1.0, uPlodMax, plodT );
    uint plodH = uint( gl_VertexID ) * 747796405u + 2891336453u;
    plodH = ( ( plodH >> ( ( plodH >> 28u ) + 4u ) ) ^ plodH ) * 277803737u;
    plodH = ( plodH >> 22u ) ^ plodH;
    if ( float( plodH ) * ( 1.0 / 4294967296.0 ) * plodG * plodG > 1.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else gl_PointSize *= plodG;
  }
  // A HERO SHOT'S FINER PIXELS (startPointShot): at its own size, in as many scattered copies as it takes to cover what the
  // screen's pixel covered (copy 0 where it is; the rest within about that pixel's width; the ones not needed left out)
  if ( uPlodShot > 1.0 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    float plodS = max( gl_PointSize, 1.0 );
    float plodN = ceil( uPlodShot * uPlodShot / ( plodS * plodS ) - 0.001 );
    if ( uPlodCopy > plodN - 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else if ( uPlodCopy > 0.5 ) {
      uint plodK = ( uint( gl_VertexID ) * 2654435761u ) ^ ( uint( uPlodCopy ) * 2246822519u + 3266489917u );
      plodK = ( plodK ^ ( plodK >> 15u ) ) * 2246822519u;
      plodK = plodK ^ ( plodK >> 13u );
      vec2 plodR = vec2( float( plodK & 65535u ), float( plodK >> 16u ) ) / 65535.0 - 0.5;
      gl_Position.xy += plodR * ( 1.4 * uPlodShot ) * 2.0 / uPlodView * gl_Position.w;
    }
  }
  // 2 · NEAR IN THE WALL'S RENDER, THE FAR SIDE IN THE SMALL FRAME (PointFrame): each point drawn once, and there smaller
  // by the frame's scale, its light kept (a point under one of the frame's pixels is drawn one wide, dimmed by what it
  // covers: the screen's one-pixel floor counted in), paler the further (3 · mass or fade is the frame's, COMPOSE_FRAG)
  if ( uPlodSplit > 0.5 ) {
    if ( uPlodOccOn < 0.5 ) {
      if ( plodFar ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    } else if ( !plodFar || uPlodCopy > 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else {
      float plodF = max( gl_PointSize, uPlodShot ) * uPlodFrameScale;
      gl_PointSize = max( plodF, 1.0 );
      vPlodLight = min( 1.0, plodF * plodF ) * ( 1.0 - uPlodFade * plodT );
    }
  }
`;
/** The fragment side: in the small frame, the points hide where the wall's own picture is nearer (PointFrame), and
 *  carry the light the vertex side gave them (premultiplied: colour and coverage together). */
const FRAG_HEAD = "uniform sampler2D uPlodOccTex;\nuniform float uPlodOccOn;\nuniform vec2 uPlodOccRes;\nvarying float vPlodLight;\n";
const FRAG_BODY = `
  if ( uPlodOccOn > 0.5 && gl_FragCoord.z > texture2D( uPlodOccTex, gl_FragCoord.xy / uPlodOccRes ).r + 1e-5 ) discard;
`;
const FRAG_TAIL = "\n  if ( uPlodOccOn > 0.5 ) gl_FragColor *= vPlodLight;\n";

type Compile = THREE.Material["onBeforeCompile"];
type Shader = Parameters<Compile>[0];

function lodShader(shader: Shader, m: THREE.Material): void {
  const vs = shader.vertexShader;
  const end = vs.lastIndexOf("}");
  if (end < 0 || !vs.includes("gl_PointSize")) return;
  Object.assign(shader.uniforms, pointLodU);
  // (each material its own copy's number — a hero shot's copies are materials of their own: startPointShot)
  shader.uniforms.uPlodCopy = copyU(m);
  shader.vertexShader = HEAD + vs.slice(0, end) + TAIL + vs.slice(end);
  const fs = shader.fragmentShader;
  const main = /void\s+main\s*\(\s*\)\s*\{/.exec(fs);
  const close = fs.lastIndexOf("}");
  if (main && close > main.index) {
    const at = main.index + main[0].length;
    shader.fragmentShader = FRAG_HEAD + fs.slice(0, at) + FRAG_BODY + fs.slice(at, close) + FRAG_TAIL + fs.slice(close);
  }
}

/** What was put on a material — to know when its component has put its own hook or key back (React sets the props
 *  again on a render), and what to build on then: its own key (null: the default, which is the hook's text). */
interface Rec {
  compile: Compile;
  key: () => string;
  base: (() => string) | null;
  prevText: string;
}
const patched = new WeakMap<THREE.Material, Rec>();

function wanted(m: THREE.Material): boolean {
  if ((m as THREE.PointsMaterial).isPointsMaterial) return (m as THREE.PointsMaterial).sizeAttenuation;
  return !!(m as THREE.ShaderMaterial).isShaderMaterial && /gl_PointSize/.test((m as THREE.ShaderMaterial).vertexShader);
}

/** Whether `o` or anything it stands in is marked out of all this (userData.noPointLod — the future layer's groups). */
function markedOut(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (p.userData.noPointLod) return true;
  return false;
}

/** Patches `m` (again, if its hook or key was set back); true when its shader must be built anew. */
function ensure(m: THREE.Material): boolean {
  const had = patched.get(m);
  const hookLost = !had || m.onBeforeCompile !== had.compile;
  const keyLost = !had || m.customProgramCacheKey !== had.key;
  if (!hookLost && !keyLost) return false;
  let compile = had?.compile;
  let prevText = had?.prevText ?? "";
  if (hookLost || !compile) {
    const prev = m.onBeforeCompile;
    prevText = prev.toString();
    compile = function (this: THREE.Material, shader, renderer) {
      prev.call(this, shader, renderer);
      lodShader(shader, this);
    };
    m.onBeforeCompile = compile;
  }
  // (its program is told apart from the same material unpatched: its own key + "|plod", or — the default key being the
  // hook's text, which is now this wrapper's for all — the text of the hook it had)
  let base = had?.base ?? null;
  if (keyLost) {
    const cur = m.customProgramCacheKey;
    base = cur !== THREE.Material.prototype.customProgramCacheKey ? cur : null;
  }
  const b = base, t = prevText;
  const key = b ? () => `${b.call(m)}|plod` : () => `${t}|plod`;
  m.customProgramCacheKey = key;
  patched.set(m, { compile, key, base, prevText });
  if (hookLost) m.needsUpdate = true;
  return hookLost;
}

/** THE FRAME'S LOOK (the knobs of PointLod, read by PointFrameEffect) and whether the effect is in the composer now. */
const frame = { mounted: false, want: false, far: 8, from: 110, to: 260, fade: 0.3, clump: 0.6, clumpAt: 0.12 };
const frameOn = (): boolean => frame.mounted && frame.want;
/** The small frame's size against the picture's (each way). */
const FRAME_SCALE = 0.25;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
/** A separable gaussian step on all four channels (the frame is premultiplied: its coverage blurs with it) — InkPaper's. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv) * 0.2270270270;
  c += (texture2D(uTex, vUv + uStep * 1.3846153846) + texture2D(uTex, vUv - uStep * 1.3846153846)) * 0.3162162162;
  c += (texture2D(uTex, vUv + uStep * 3.2307692308) + texture2D(uTex, vUv - uStep * 3.2307692308)) * 0.0702702703;
  gl_FragColor = c;
}`;
/**
 * The far points' frame, softened, laid over the picture (premultiplied) — and CLUMPED BY HOW DENSE THEY LOOK (the
 * artist, 2026-11-28: "특정 거리 이상은 식생 보이는 밀도 따라 뭉치는 가중치 넣도록 하면 …" → "1번 해보자"): the blurred
 * frame's coverage IS how dense the far greenery looks there, so a soft threshold on it (뭉치는 밀도) closes what is
 * denser into a solid mass and lets what is sparser fade, by 밀도 따라 뭉침 (0 = as blurred). A curve in this pass, no
 * pass more.
 */
const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D uFarTex;
uniform float uOn;
uniform float uClump;
uniform float uClumpAt;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uOn < 0.5) {
    outputColor = inputColor;
    return;
  }
  vec4 c = texture2D(uFarTex, uv);
  if (uClump > 0.0 && c.a > 1e-4) {
    float a = min(c.a, 1.0);
    float t = max(uClumpAt, 1e-3);
    float clumped = smoothstep(t * 0.5, t * 1.5, a);
    float a2 = mix(a, clumped, uClump);
    c = vec4(c.rgb / c.a * a2, a2);
  }
  outputColor = vec4(inputColor.rgb * (1.0 - min(c.a, 1.0)) + c.rgb, inputColor.a);
}`;

const target = (w: number, h: number, depth = false): THREE.WebGLRenderTarget => {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, stencilBuffer: false });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
  }
  return rt;
};

/**
 * THE FAR POINTS' SMALL FRAME, IN THE WALL'S COMPOSER: each frame (update) the far points (the share the vertex side
 * gives them) alone into a frame a quarter of the picture's size — hidden where the wall's depth is nearer — blurred
 * widely (twice each way, as InkPaper) and laid over the picture (mainImage). The near points are the wall's own
 * render's. (Before: every point into a frame of the picture's own size, parted and blurred there — "1번 한 번 해보자".)
 */
class PointFrameEffect extends Effect {
  scene: THREE.Scene | null = null;
  cam: THREE.Camera | null = null;
  private depthTex: THREE.Texture | null = null;
  private rt = target(1, 1, true);
  private fA = target(1, 1);
  private fB = target(1, 1);
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private blur = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null }, uStep: { value: new THREE.Vector2() } }, vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
  private clear = new THREE.Color();

  constructor() {
    super("PointFrameEffect", COMPOSE_FRAG, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["uFarTex", new THREE.Uniform(null)],
        ["uOn", new THREE.Uniform(0)],
        ["uClump", new THREE.Uniform(0.6)],
        ["uClumpAt", new THREE.Uniform(0.12)],
      ]),
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTex = depthTexture;
  }

  private pass(renderer: THREE.WebGLRenderer, src: THREE.Texture, dst: THREE.WebGLRenderTarget, dx: number, dy: number, radius: number): void {
    this.blur.uniforms.uTex.value = src;
    (this.blur.uniforms.uStep.value as THREE.Vector2).set((dx * radius) / dst.width, (dy * radius) / dst.height);
    renderer.setRenderTarget(dst);
    renderer.render(this.quadScene, this.quadCam);
  }

  update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    const scene = this.scene, cam = this.cam as THREE.PerspectiveCamera | null;
    const on = frameOn() && !!scene && !!cam;
    (this.uniforms.get("uOn") as THREE.Uniform<number>).value = on ? 1 : 0;
    if (!on || !scene || !cam) return;
    const w = Math.max(1, Math.round(inputBuffer.width * FRAME_SCALE)), h = Math.max(1, Math.round(inputBuffer.height * FRAME_SCALE));
    if (this.rt.width !== w || this.rt.height !== h) for (const t of [this.rt, this.fA, this.fB]) t.setSize(w, h);
    pointLodU.uPlodFrameScale.value = h / Math.max(1, inputBuffer.height);
    // 1 · THE FAR POINTS ALONE, hidden where the wall stands nearer (its depth, from the composer)
    const mask = cam.layers.mask, bg = scene.background, auto = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeed = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(this.clear);
    const clearA = renderer.getClearAlpha();
    cam.layers.set(POINT_LAYER);
    scene.background = null;
    renderer.autoClear = false;
    // (no shadow map is drawn again for this: the wall's own render made it)
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    pointLodU.uPlodOccTex.value = this.depthTex;
    pointLodU.uPlodOccOn.value = 1;
    pointLodU.uPlodOccRes.value.set(w, h);
    renderer.render(scene, cam);
    pointLodU.uPlodOccOn.value = 0;
    cam.layers.mask = mask;
    scene.background = bg;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = shadowNeed;
    renderer.setClearColor(this.clear, clearA);
    // 2 · SOFTENED WIDELY (the knob in the screen's pixels; the frame has FRAME_SCALE as many; a hero shot's still more)
    const rW = Math.max(0, frame.far) * 0.25 * pointLodU.uPlodShot.value * FRAME_SCALE;
    let far: THREE.Texture = this.rt.texture;
    if (rW > 0.01) {
      this.pass(renderer, this.rt.texture, this.fB, 1, 0, rW);
      this.pass(renderer, this.fB.texture, this.fA, 0, 1, rW);
      this.pass(renderer, this.fA.texture, this.fB, 1, 0, rW);
      this.pass(renderer, this.fB.texture, this.fA, 0, 1, rW);
      far = this.fA.texture;
    }
    renderer.autoClear = auto;
    // 3 · laid over the picture (mainImage)
    (this.uniforms.get("uFarTex") as THREE.Uniform<THREE.Texture | null>).value = far;
    (this.uniforms.get("uClump") as THREE.Uniform<number>).value = Math.max(0, Math.min(1, frame.clump));
    (this.uniforms.get("uClumpAt") as THREE.Uniform<number>).value = Math.max(0.001, frame.clumpAt);
  }

  dispose(): void {
    for (const t of [this.rt, this.fA, this.fB]) t.dispose();
    this.blur.dispose();
    this.quad.geometry.dispose();
    super.dispose();
  }
}

/** In the wall's composer (ParliamentSpace): the points' own frame. Without the composer it is not there, and the points
 *  are drawn in the wall's own render as before. */
export function PointFrame() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new PointFrameEffect(), []);
  effect.scene = scene;
  effect.cam = camera;
  useEffect(() => {
    frame.mounted = true;
    return () => {
      frame.mounted = false;
      effect.dispose();
    };
  }, [effect]);
  return <primitive object={effect} dispose={null} />;
}

export function PointLod() {
  // ONE RULE, ONE SET (the header): the keys of the knobs it keeps are the old ones, so what she saved comes with them —
  // the one start is the blur's (흐림 시작 거리, her pick); gone, their saved values kept: 뭉치기 시작 거리 · 뭉치기 세기
  // (the growth follows the one range) and the blur's own switch (one switch for all)
  const k = useControls(
    ROOT,
    savable(
      ROOT,
      {
        on: { value: true, label: "켜기 (먼 식생: 거리만큼 먼 쪽으로 넘어가 성기고 크게 · 흐리게 · 옅게, 빽빽해 보이는 곳은 덩어리로)" },
        blurFrom: { value: 110, min: 0, max: 600, step: 5, label: "시작 거리 (눈에서 · 월드 · 여기까지는 그대로 또렷하게)" },
        blurTo: { value: 260, min: 10, max: 800, step: 5, label: "끝 거리 (여기부터 전부 먼 쪽 · 그 사이는 점점 더 많이)" },
        max: { value: 3, min: 1, max: 6, step: 0.1, label: "멀리서 점이 커지는 정도 (× · 끝 거리에서 · 그 제곱만큼 성겨져 가벼워짐 · 덮는 면적은 그대로)" },
        blurFar: { value: 8, min: 0, max: 40, step: 0.5, label: "흐림 (px · 먼 쪽만 · 렌더 후처리가 켜져 있을 때)" },
        blurFade: { value: 0.3, min: 0, max: 1, step: 0.05, label: "옅어짐 (먼 쪽이 멀수록)" },
        clump: { value: 0.6, min: 0, max: 1, step: 0.05, label: "뭉침 (먼 쪽이 빽빽해 보이는 곳은 덩어리로, 성긴 곳은 옅게 · 0 = 흐린 그대로)" },
        clumpAt: { value: 0.12, min: 0.01, max: 0.6, step: 0.01, label: "뭉치는 밀도 (흐린 먼 쪽이 이보다 짙으면 덩어리)" },
      },
      [ROOT_OLD],
    ),
    // (right under the vegetation's own switch and its motion: ParliamentSpace gives those order -1)
    { collapsed: true, order: -0.5 },
  ) as unknown as { on: boolean; max: number; blurFar: number; blurFrom: number; blurTo: number; blurFade: number; clump: number; clumpAt: number };
  const scene = useThree((s) => s.scene);
  const last = useRef(-Infinity);
  /** Every patched Points, and the layers it had of its own (the frame's layer is added while the frame is drawn). */
  const hosts = useRef(new Map<THREE.Points, number>());
  const drawSize = useRef(new THREE.Vector2());
  useEffect(
    () => () => {
      for (const [pts, mask] of hosts.current) pts.layers.mask = mask;
      hosts.current.clear();
    },
    [],
  );
  useFrame((state) => {
    pointLodU.uPlodOn.value = k.on ? 1 : 0;
    pointLodU.uPlodMax.value = Math.max(1, k.max);
    Object.assign(frame, { want: k.on, far: k.blurFar, from: k.blurFrom, to: k.blurTo, fade: k.blurFade, clump: k.clump, clumpAt: k.clumpAt });
    state.gl.getDrawingBufferSize(drawSize.current);
    pointShotView(drawSize.current.x, drawSize.current.y);
    // (while the small frame is drawn: each point on its own layers — the wall's render, the near ones — and on the
    // frame's — the far ones; the vertex side parts them)
    const inFrame = frameOn();
    pointLodU.uPlodSplit.value = inFrame ? 1 : 0;
    pointLodU.uPlodFrom.value = Math.max(0, k.blurFrom);
    pointLodU.uPlodTo.value = Math.max(0, k.blurTo);
    pointLodU.uPlodFade.value = Math.max(0, Math.min(1, k.blurFade));
    for (const [pts, mask] of hosts.current) pts.layers.mask = inFrame ? mask | (1 << POINT_LAYER) : mask;
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    let n = 0, fresh = 0;
    const seen = new Set<THREE.Points>();
    // (a marked object and everything in it is passed over — the future layer: markedOut)
    const walk = (o: THREE.Object3D): void => {
      if (o.userData.noPointLod) return;
      const pts = o as THREE.Points, m = pts.material;
      if (pts.isPoints && !Array.isArray(m) && wanted(m)) {
        n++;
        if (ensure(m)) fresh++;
        seen.add(pts);
        if (!hosts.current.has(pts)) {
          const own = pts.layers.mask & ~(1 << POINT_LAYER);
          hosts.current.set(pts, own || 1);
          if (inFrame) pts.layers.mask = (own || 1) | (1 << POINT_LAYER);
        }
      }
      for (const c of o.children) walk(c);
    };
    walk(scene);
    // (gone from the scene, or now under a mark: its own layers back, and off the list)
    for (const [pts, mask] of hosts.current) {
      if (seen.has(pts)) continue;
      pts.layers.mask = mask;
      hosts.current.delete(pts);
    }
    (window as unknown as { __pointLod?: unknown }).__pointLod = { on: k.on, materials: n, patchedNow: fresh, frame: inFrame };
  });
  return null;
}
