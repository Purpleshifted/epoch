/**
 * longExposure — TIME ACCUMULATED, as a Feedback TOP does it (the artist, 2026-11-22 night: "장노출 사진이 어쩌다보니 먹처럼
 * 보이는 게 좋은 거지, 억지로 먹 효과 넣는 건 싫어"). A half-float buffer that keeps the last frame × decay and takes the new
 * frame on top: what stays grows dense and sharp, what moves smears and thins, what overlaps darkens — by time, not by
 * drawing. Screen space, no reprojection: when the eye turns, the world drags, as a long exposure's does.
 *
 * Two ways in: `accumulate` takes a texture (a layer drawn elsewhere); `decayInto` only decays and hands back the target
 * for the caller to draw into additively (with the renderer's autoClear off). `texture` is the latest state.
 * Owned by the street-feel session (InkPaper uses it); a byte-identical copy may live on other branches until they meet.
 */

import * as THREE from "three";

/**
 * THE EXPOSURE'S WEIGHT this frame: 1 − decay^dtFrames. A layer drawn additively into the feedback multiplies by it, so the
 * buffer is a time-weighted AVERAGE of the frames (a long exposure proper): a body that stands converges to its own
 * density, no more; one that walks leaves the fraction of the time it covered a pixel; two at once add. Set per frame by
 * whoever runs the feedback (InkPaper); read by the layers (PointPeople).
 */
export const exposureRate = { weight: 0.06 };
export function setExposureWeight(decay: number, dtFrames: number): void {
  exposureRate.weight = 1 - Math.pow(Math.max(0, Math.min(0.999, decay)), Math.max(0.01, dtFrames));
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uSrc;
uniform float uDecay;
uniform float uGain;
uniform float uHasSrc;
varying vec2 vUv;
void main() {
  vec3 kept = texture2D(uPrev, vUv).rgb * uDecay;
  vec3 added = uHasSrc > 0.5 ? texture2D(uSrc, vUv).rgb * uGain : vec3(0.0);
  gl_FragColor = vec4(kept + added, 1.0);
}`;

function target(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
}

export class LongExposure {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private ping = 0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly scene: THREE.Scene;
  private readonly cam: THREE.OrthographicCamera;
  private readonly geom: THREE.PlaneGeometry;

  constructor(width: number, height: number) {
    this.a = target(width, height);
    this.b = target(width, height);
    this.geom = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uPrev: { value: null }, uSrc: { value: null }, uDecay: { value: 0.94 }, uGain: { value: 1 }, uHasSrc: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(this.geom, this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** The latest accumulation. */
  get texture(): THREE.Texture {
    return (this.ping === 0 ? this.a : this.b).texture;
  }

  /** Keep the last state × decay^dtFrames (decay per 1/60 s; dtFrames = dt × 60 keeps it rate-independent) and add `source` × gain. */
  accumulate(gl: THREE.WebGLRenderer, source: THREE.Texture | null, decay: number, gain = 1, dtFrames = 1): THREE.WebGLRenderTarget {
    const to = this.decayInto(gl, decay, dtFrames, source, gain);
    gl.setRenderTarget(null);
    return to;
  }

  /**
   * Only decay (and add `source` if given), leaving the target BOUND for the caller to draw into additively — set the
   * renderer's autoClear off around that drawing, then restore it and the render target.
   */
  decayInto(gl: THREE.WebGLRenderer, decay: number, dtFrames = 1, source: THREE.Texture | null = null, gain = 1): THREE.WebGLRenderTarget {
    const from = this.ping === 0 ? this.a : this.b;
    const to = this.ping === 0 ? this.b : this.a;
    this.ping ^= 1;
    const u = this.mat.uniforms;
    u.uPrev.value = from.texture;
    u.uSrc.value = source;
    u.uHasSrc.value = source ? 1 : 0;
    u.uGain.value = gain;
    u.uDecay.value = Math.pow(Math.max(0, Math.min(0.999, decay)), Math.max(0.01, dtFrames));
    gl.setRenderTarget(to);
    gl.render(this.scene, this.cam);
    return to;
  }

  /** Start again from nothing (a new life, a new seat). */
  clear(gl: THREE.WebGLRenderer): void {
    const rt = gl.getRenderTarget();
    for (const t of [this.a, this.b]) {
      gl.setRenderTarget(t);
      gl.clear(true, false, false);
    }
    gl.setRenderTarget(rt);
  }

  resize(width: number, height: number): void {
    this.a.setSize(Math.max(1, width), Math.max(1, height));
    this.b.setSize(Math.max(1, width), Math.max(1, height));
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.mat.dispose();
    this.geom.dispose();
  }
}
