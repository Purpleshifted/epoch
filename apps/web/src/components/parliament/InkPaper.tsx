"use client";
/**
 * InkPaper — the LONG EXPOSURE (the artist, 2026-11-22 night: "난 장노출 사진이 어쩌다보니 먹처럼 보이는 게 좋은 거지, 억지로 먹 효과
 * 넣는 건 싫어"). No ink, no paper grain, no brush: the look is TIME ACCUMULATED, as a Feedback TOP does it.
 *
 *   1. the scene (the ground, the buildings, the future's things) is drawn into a half-float target with its depth;
 *   2. everything on EXPOSURE_LAYER (the people; whatever else chooses it) is drawn additively, as a density, into a
 *      feedback buffer that keeps the last frame × decay — a standing body grows dense and sharp by itself, a walking one
 *      smears and thins by itself, two overlapping grow darker by themselves;
 *   3. the frame is composed: the scene, softened a little by depth (near sharp, far soft — the one rule), darkened by
 *      the accumulated density; the highlights blow out softly into the paper's neutral white like an overexposed
 *      photograph (the white itself stays 255 — 2026-11-23); a photographic grain of ~1 % and a dither against banding,
 *      none on the blown white. Nothing else is drawn in.
 *
 * The pass takes over the frame (useFrame priority 1); the HUD is DOM and unaffected.
 */
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LongExposure, setExposureWeight } from "./longExposure";
import { EXPOSE_GLSL, EXPOSURE_LAYER } from "./paperLook";
import { lidarActive } from "./LidarScan";
export { EXPOSURE_LAYER };

export interface InkPaperLook {
  /** Blur radii in px of the drawing buffer (the narrow and the wide softening by depth). */
  narrow: number;
  wide: number;
  /** The feedback: how much of the last frame stays each 1/60 s (0.9 … 0.985), and how much a frame exposes (gain). */
  decay: number;
  gain: number;
  /** How dark the accumulated density gets at most (1 = black). */
  density: number;
  /** How much farther things pale (0 … 1 at the fog's far). */
  fade: number;
  /** The photograph's grain (0 … 0.03). */
  grain: number;
  /** The highlights' soft roll-off (0 = none). */
  rolloff: number;
  /** The hand-held shake while the exposure is open (% of the screen's height, vertical; across, 30 % of it): only the
   *  exposed layer (the people) is shaken, so they drag into vertical streaks as in the references while the world stays. */
  shake: number;
  /** Halation: how much of a blurred copy of the exposure is mixed in (0 … 1) — the white bleeds into the bodies' edges. */
  halo: number;
  /** Overexposure: the accumulated density raised to this power (1 = as it is; > 1 lifts the mid-tones, blacks stay). */
  burn: number;
}

export const DEFAULT_INK: InkPaperLook = { narrow: 1.2, wide: 6, decay: 0.965, gain: 0.5, density: 0.97, fade: 0.25, grain: 0.01, rolloff: 0.5, shake: 1.5, halo: 0.5, burn: 1.4 };



const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += (texture2D(uTex, vUv + uStep * 1.3846153846).rgb + texture2D(uTex, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(uTex, vUv + uStep * 3.2307692308).rgb + texture2D(uTex, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uNear;
uniform sampler2D uWide;
uniform sampler2D uFeed;
uniform sampler2D uFeedSoft;
uniform float uHalo;
uniform float uBurn;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uCamNear;
uniform float uCamFar;
uniform float uFogFar;
uniform float uTime;
uniform float uDensity;
uniform float uFade;
uniform float uGrain;
uniform float uRolloff;
uniform float uSharp;
varying vec2 vUv;
${EXPOSE_GLSL}
float linDepth(float z) {
  float zn = z * 2.0 - 1.0;
  return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - zn * (uCamFar - uCamNear));
}
void main() {
  vec3 sc = texture2D(uScene, vUv).rgb;
  vec3 bn = texture2D(uNear, vUv).rgb;
  vec3 bw = texture2D(uWide, vUv).rgb;
  float d = clamp(linDepth(texture2D(uDepth, vUv).r) / uFogFar, 0.0, 1.0);
  // the one depth rule: near sharp, far soft and pale — while the lidar scan is the place, soft by depth as well (its
  // points write their depth: the artist, 2026-11-24, "여기엔 왜 흐림 적용이 안 되지"), but never paled: the fade to
  // white would lift the scan's black to grey
  vec3 col = mix(mix(sc, bn, 0.35), bw, smoothstep(0.1, 0.85, d));
  col = mix(col, vec3(1.0), uFade * d * 0.5 * (1.0 - uSharp));
  // the exposure: what accumulated darkens the frame (a standing body dense, a walking one thin — by time, not by drawing)
  // overexposed: the white bleeds into the edges (a soft copy mixed in) and the mid-tones lift (a power), blacks stay
  vec3 feed = mix(texture2D(uFeed, vUv).rgb, texture2D(uFeedSoft, vUv).rgb, uHalo);
  feed = pow(clamp(feed, 0.0, 1.0), vec3(uBurn));
  col = exposeOnWhite(col, feed, uDensity);
  // an overexposed photograph: the highlights blow out softly into the white; a fine living grain and a dither — none on
  // the blown white itself (a clipped highlight is clean: the paper stays 255)
  col = exposeTone(col, uRolloff);
  col += filmGrain(vUv * uRes, uTime, uGrain) * blownGrain(col);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The scene's background is set through this (a plain function on the object): the exposure pass must not see it. */
function setBackground(sc: { background: THREE.Color | THREE.Texture | THREE.CubeTexture | null }, v: THREE.Color | THREE.Texture | THREE.CubeTexture | null): void {
  sc.background = v;
}

/** The renderer's auto-clear is switched through this (a plain function on the object). */
function setAutoClear(r: { autoClear: boolean }, v: boolean): void {
  r.autoClear = v;
}

/** A lens shift of the projection (NDC units), for the exposed layer's shake: set, render, set back (0, 0 = the saved). */
function shiftProjection(m: THREE.Matrix4, saved: [number, number], dx: number, dy: number): void {
  m.elements[8] = saved[0] - dx;
  m.elements[9] = saved[1] - dy;
}

/** Three sines out of step (Hz 1.3 · 2.1 · 0.7): a hand's shake that never rests at its ends, slow enough that the
 *  frames' copies run together into a drag rather than stand as steps; −1 … 1. */
function handShake(t: number, phase: number): number {
  return 0.5 * Math.sin(Math.PI * 2 * 1.3 * t + phase) + 0.3 * Math.sin(Math.PI * 2 * 2.1 * t + 1.3 + phase) + 0.2 * Math.sin(Math.PI * 2 * 0.7 * t + 2.1 + phase);
}

function setUniforms(u: Record<string, THREE.IUniform>, values: Record<string, unknown>): void {
  for (const k in values) u[k].value = values[k];
}

function target(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, stencilBuffer: false });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
  }
  return rt;
}

export function InkPaper({ look = DEFAULT_INK, fogFar }: { look?: InkPaperLook; fogFar: number }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const w = Math.max(2, Math.round(size.width * viewport.dpr));
  const h = Math.max(2, Math.round(size.height * viewport.dpr));
  const rts = useMemo(() => {
    const sceneRT = target(w, h, true);
    const nA = target(w >> 1, h >> 1), nB = target(w >> 1, h >> 1);
    const wA = target(w >> 2, h >> 2), wB = target(w >> 2, h >> 2);
    const fA = target(w >> 2, h >> 2), fB = target(w >> 2, h >> 2);
    return { sceneRT, nA, nB, wA, wB, fA, fB };
  }, [w, h]);
  // the exposure (half size): the feedback that keeps the last frame × decay and takes the exposed layer on top
  const exposure = useMemo(() => new LongExposure(w >> 1, h >> 1), [w, h]);
  useEffect(() => () => exposure.dispose(), [exposure]);
  const quad = useMemo(() => {
    const geom = new THREE.PlaneGeometry(2, 2);
    const blur = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null }, uStep: { value: new THREE.Vector2() } }, vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    const compose = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null },
        uNear: { value: null },
        uWide: { value: null },
        uFeed: { value: null },
        uFeedSoft: { value: null },
        uHalo: { value: 0.5 },
        uBurn: { value: 1.4 },
        uDepth: { value: null },
        uRes: { value: new THREE.Vector2() },
        uCamNear: { value: 0.1 },
        uCamFar: { value: 1000 },
        uFogFar: { value: 80 },
        uTime: { value: 0 },
        uDensity: { value: 0.9 },
        uFade: { value: 0.4 },
        uGrain: { value: 0.01 },
        uRolloff: { value: 0.6 },
        uSharp: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    // two quads in two scenes: one softens, one composes (no material swapping per frame)
    const sBlur = new THREE.Scene();
    sBlur.add(new THREE.Mesh(geom, blur));
    const sCompose = new THREE.Scene();
    sCompose.add(new THREE.Mesh(geom, compose));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { geom, blur, compose, sBlur, sCompose, cam };
  }, []);
  useEffect(
    () => () => {
      for (const rt of Object.values(rts)) rt.dispose();
    },
    [rts],
  );
  useEffect(
    () => () => {
      quad.geom.dispose();
      quad.blur.dispose();
      quad.compose.dispose();
    },
    [quad],
  );

  useFrame((state, delta) => {
    const { sceneRT, nA, nB, wA, wB, fA, fB } = rts;
    // 1. the scene, without the exposed layer
    camera.layers.set(0);
    gl.setRenderTarget(sceneRT);
    gl.clear();
    gl.render(scene, camera);
    // 2. the exposure: the last frame kept × decay (rate-independent), then the exposed layer added on top
    const dtFrames = Math.min(4, delta * 60);
    exposure.decayInto(gl, look.decay, dtFrames);
    setExposureWeight(look.decay, dtFrames);
    // (the exposed layer alone — three would paint the scene's background too, and it would accumulate into a fog of its own)
    camera.layers.set(EXPOSURE_LAYER);
    const bg = scene.background;
    setBackground(scene, null);
    const auto = gl.autoClear;
    setAutoClear(gl, false);
    // the hand's shake, for the exposed layer only (NDC: the screen's height is 2)
    const pm = camera.projectionMatrix;
    const saved: [number, number] = [pm.elements[8], pm.elements[9]];
    if (look.shake > 0) {
      const t = state.clock.elapsedTime, a = look.shake * 0.02;
      shiftProjection(pm, saved, 0.3 * a * handShake(t, 0.7), a * handShake(t, 0));
    }
    gl.render(scene, camera);
    shiftProjection(pm, saved, 0, 0);
    setAutoClear(gl, auto);
    setBackground(scene, bg);
    camera.layers.set(0);
    // 3. the two softenings by depth (separable; the wide one runs twice)
    const pass = (src: THREE.Texture, dst: THREE.WebGLRenderTarget, dx: number, dy: number, radius: number) => {
      setUniforms(quad.blur.uniforms, { uTex: src });
      (quad.blur.uniforms.uStep.value as THREE.Vector2).set((dx * radius) / dst.width, (dy * radius) / dst.height);
      gl.setRenderTarget(dst);
      gl.render(quad.sBlur, quad.cam);
    };
    const rN = look.narrow * 0.5, rW = look.wide * 0.25;
    pass(sceneRT.texture, nA, 1, 0, rN);
    pass(nA.texture, nB, 0, 1, rN);
    pass(nB.texture, wA, 1, 0, rW);
    pass(wA.texture, wB, 0, 1, rW);
    pass(wB.texture, wA, 1, 0, rW);
    pass(wA.texture, wB, 0, 1, rW);
    // the halation's soft copy of the exposure (quarter size, ~12 px of the frame)
    if (look.halo > 0) {
      pass(exposure.texture, fA, 1, 0, 2.5);
      pass(fA.texture, fB, 0, 1, 2.5);
    }
    // 4. the frame
    const u = quad.compose.uniforms;
    (u.uRes.value as THREE.Vector2).set(w, h);
    const pc = camera as THREE.PerspectiveCamera;
    setUniforms(u, { uScene: sceneRT.texture, uNear: nB.texture, uWide: wB.texture, uFeed: exposure.texture, uFeedSoft: look.halo > 0 ? fB.texture : exposure.texture, uHalo: look.halo, uBurn: look.burn, uDepth: sceneRT.depthTexture, uCamNear: pc.near, uCamFar: pc.far, uFogFar: fogFar, uTime: state.clock.elapsedTime, uDensity: look.density, uFade: look.fade, uGrain: look.grain, uRolloff: look.rolloff, uSharp: lidarActive() ? 1 : 0 });
    gl.setRenderTarget(null);
    gl.render(quad.sCompose, quad.cam);
  }, 1);

  return null;
}
