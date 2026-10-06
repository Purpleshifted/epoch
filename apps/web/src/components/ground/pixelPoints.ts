"use client";
/**
 * ground/pixelPoints.ts
 *
 * One point-sprite pipeline shared by the mobile scene, the Top view and the Side view.
 * Every item is a GL point that is either a flat palette square (placeholder, `cell < 0`)
 * or a cell of the 16-colour sprite atlas. Stage -> look (dim / checker dither / outline)
 * is applied in the shader, so the same buffer layout serves every view.
 */

import * as THREE from "three";
import {
  MATERIAL_PALETTE_INDEX,
  PALETTE_HEX,
  dimIndex,
  stageTint,
  type MaterialId,
  type Stage,
} from "@/lib/stratum";
import { ATLAS_URL, ATLAS_COLS, ATLAS_ROWS, SPRITE_CELL } from "./atlas";

/** Palette as linear colours (the shader ends with colorspace_fragment, so linear is right everywhere). */
export const PALETTE_LINEAR: [number, number, number][] = PALETTE_HEX.map((hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
});

/**
 * Natural stock sub-palette (palette indices): dark grey, green, brown, light green, yellow,
 * light grey, white (bone), dark red. EARTH_DIM[i] is the darker twin used for the grain.
 */
const EARTH_INDICES = [8, 2, 6, 10, 14, 7, 15, 4];
const EARTH_DIM: Record<number, number> = { 8: 8, 2: 8, 6: 8, 10: 2, 14: 6, 7: 8, 15: 7, 4: 8 };

const VS = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aFlags;       // x: dither, y: outline, z: size scale, w: dim
  attribute float aCell;       // atlas cell, < 0 = flat square
  attribute float aKind;       // 1 = natural stock (earth sub-palette + grain), 0 = scattered item
  uniform float uCamConst;     // perspective: drawing-buffer height / (2 tan(fov/2))
  uniform float uSize;         // world units of a size-1 item
  uniform float uPxPerUnit;    // orthographic: drawing-buffer px per world unit
  uniform float uOrtho;
  uniform float uSnap;         // point sizes snap to multiples of this many px (crisp texels)
  uniform float uMinPx;
  varying vec3 vColor;
  varying vec4 vFlags;
  varying float vCell;
  varying float vKind;
  void main() {
    vColor = aColor;
    vFlags = aFlags;
    vCell = aCell;
    vKind = aKind;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = uOrtho > 0.5 ? uSize * aFlags.z * uPxPerUnit : uSize * aFlags.z * uCamConst / (-mv.z);
    gl_PointSize = max(uMinPx, floor(px / uSnap) * uSnap);
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uGrid;
  uniform float uHasAtlas;
  uniform float uCellPx;
  uniform vec3 uPal[16];
  uniform vec3 uDimPal[16];
  uniform vec3 uEarth[8];
  uniform vec3 uEarthDim[8];
  uniform float uGrain;
  varying vec3 vColor;
  varying vec4 vFlags;
  varying float vCell;
  varying float vKind;

  float alphaAt(vec2 org, vec2 q) {
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
    return texture2D(uAtlas, (org + q) / uGrid).a;
  }
  vec3 dimOf(vec3 c) {
    for (int i = 0; i < 16; i++) {
      if (distance(c, uPal[i]) < 0.02) return uDimPal[i];
    }
    return c * 0.5;
  }
  // Natural stock: snap to the earth sub-palette, then darken an irregular ~uGrain of the texels
  // (hash noise, unlike the regular checker used for weathering) so it reads as organic grain.
  vec3 earthOf(vec3 c, float seed) {
    float best = 1e9;
    vec3 o = uEarth[0];
    vec3 od = uEarthDim[0];
    for (int i = 0; i < 8; i++) {
      float d = distance(c, uEarth[i]);
      if (d < best) { best = d; o = uEarth[i]; od = uEarthDim[i]; }
    }
    float h = fract(sin(dot(floor(gl_PointCoord * uCellPx) + seed, vec2(12.9898, 78.233))) * 43758.5453);
    return h < uGrain ? od : o;
  }

  void main() {
    vec2 pc = gl_PointCoord;
    if (vFlags.x > 0.5) {
      // two-colour checkerboard, the only dither TempleOS has
      float chk = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
      if (chk < 0.5) discard;
    }
    vec3 col = vColor;
    if (vCell > -0.5 && uHasAtlas > 0.5) {
      vec2 org = vec2(mod(vCell, uGrid.x), floor(vCell / uGrid.x));
      vec4 t = texture2D(uAtlas, (org + pc) / uGrid);
      if (t.a < 0.5) {
        bool edge = false;
        if (vFlags.y > 0.5) {
          float e = 1.0 / uCellPx;
          edge = alphaAt(org, pc + vec2(e, 0.0)) > 0.5 || alphaAt(org, pc - vec2(e, 0.0)) > 0.5 ||
                 alphaAt(org, pc + vec2(0.0, e)) > 0.5 || alphaAt(org, pc - vec2(0.0, e)) > 0.5;
        }
        if (!edge) discard;
        col = uPal[15];
      } else {
        col = t.rgb;
        if (vKind > 0.5) col = earthOf(col, vCell * 7.0);
        if (vFlags.w > 0.5) col = dimOf(col);
      }
    } else if (vFlags.y > 0.5 && max(abs(pc.x - 0.5), abs(pc.y - 0.5)) > 0.34) {
      col = uPal[15];
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ── atlas texture, loaded once and shared ──
let atlasTex: THREE.Texture | null = null;
const waiting = new Set<THREE.ShaderMaterial>();

function applyAtlas(m: THREE.ShaderMaterial) {
  if (!atlasTex) return;
  m.uniforms.uAtlas.value = atlasTex;
  m.uniforms.uHasAtlas.value = 1;
}

function ensureAtlas(m: THREE.ShaderMaterial) {
  if (atlasTex) return applyAtlas(m);
  waiting.add(m);
  if (typeof window === "undefined" || ATLAS_ROWS <= 0) return;
  if (waiting.size > 1) return; // a load is already in flight
  new THREE.TextureLoader().load(
    ATLAS_URL,
    (tex) => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      atlasTex = tex;
      waiting.forEach(applyAtlas);
      waiting.clear();
    },
    undefined,
    () => { /* atlas missing: items fall back to flat squares */ },
  );
}

export function makePixelMaterial(opts: { ortho?: boolean; size?: number; snap?: number } = {}): THREE.ShaderMaterial {
  const dimPal = PALETTE_LINEAR.map((_, i) => new THREE.Vector3(...PALETTE_LINEAR[dimIndex(i)]));
  const pal = PALETTE_LINEAR.map((c) => new THREE.Vector3(...c));
  const m = new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    toneMapped: false,
    uniforms: {
      uCamConst: { value: 400 },
      uSize: { value: opts.size ?? 0.32 },
      uPxPerUnit: { value: 20 },
      uOrtho: { value: opts.ortho ? 1 : 0 },
      uSnap: { value: opts.snap ?? 1 },
      uMinPx: { value: 3 },
      uAtlas: { value: null },
      uGrid: { value: new THREE.Vector2(ATLAS_COLS, Math.max(1, ATLAS_ROWS)) },
      uHasAtlas: { value: 0 },
      uCellPx: { value: SPRITE_CELL },
      uPal: { value: pal },
      uDimPal: { value: dimPal },
      uEarth: { value: EARTH_INDICES.map((i) => new THREE.Vector3(...PALETTE_LINEAR[i])) },
      uEarthDim: { value: EARTH_INDICES.map((i) => new THREE.Vector3(...PALETTE_LINEAR[EARTH_DIM[i]])) },
      uGrain: { value: 0.3 },
    },
  });
  ensureAtlas(m);
  return m;
}

/** Growable-free point buffer with the attribute layout the shader above expects. */
export class PointBuffer {
  readonly geometry = new THREE.BufferGeometry();
  readonly cap: number;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private flg: THREE.BufferAttribute;
  private cel: THREE.BufferAttribute;
  private kin: THREE.BufferAttribute;

  constructor(cap: number) {
    this.cap = cap;
    this.pos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.flg = new THREE.BufferAttribute(new Float32Array(cap * 4), 4);
    this.cel = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.kin = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.geometry.setAttribute("position", this.pos);
    this.geometry.setAttribute("aColor", this.col);
    this.geometry.setAttribute("aFlags", this.flg);
    this.geometry.setAttribute("aCell", this.cel);
    this.geometry.setAttribute("aKind", this.kin);
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Write point `n`. `cell < 0` draws the material's flat placeholder colour.
   * `natural` marks the pre-existing natural stock (not scattered by visitors): it is drawn
   * in an earth-tone sub-palette with an irregular grain, so it does not read as an icon.
   */
  set(n: number, x: number, y: number, z: number, cell: number, material: MaterialId, stage: Stage, size: number, natural = false) {
    if (n >= this.cap) return;
    const tint = stageTint(stage);
    let pi = MATERIAL_PALETTE_INDEX[material];
    if (tint.dim) pi = dimIndex(pi);
    const c = PALETTE_LINEAR[pi];
    this.pos.setXYZ(n, x, y, z);
    this.col.setXYZ(n, c[0], c[1], c[2]);
    this.flg.setXYZW(n, tint.dither ? 1 : 0, tint.outline ? 1 : 0, cell < 0 ? size * 0.45 : size, tint.dim ? 1 : 0);
    this.cel.setX(n, cell);
    this.kin.setX(n, natural ? 1 : 0);
    this.pos.needsUpdate = this.col.needsUpdate = this.flg.needsUpdate = this.cel.needsUpdate = this.kin.needsUpdate = true;
  }

  draw(count: number) {
    this.geometry.setDrawRange(0, Math.min(count, this.cap));
  }

  dispose() {
    this.geometry.dispose();
  }
}
