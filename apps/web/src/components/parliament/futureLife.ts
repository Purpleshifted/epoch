/**
 * WHAT COMES AND GOES ON THE LAYER ABOVE DOES SO SOFTLY (the artist, 2026-11-18: "바로 나타나고 사라지는 것들 중에 더
 * 연속적으로 적용 가능한 거", and of the stones, the mounds, the dark earth and the buildings' parts that still came
 * and went at once: "여튼 그것들도 이어서 처리해").
 *
 * A thing of the layer is known from one layer to the next by a number of its own (its place, and what else tells it
 * from its neighbours). One that was not there before comes in over the grow time; one that is no longer there is kept
 * where it was and goes over the fade time; one that stays is left as it is. Each thing carries [born, died] (seconds of
 * performance.now; died 0 while it stands — so a mesh without the attribute shows everything whole) and the shader
 * reads it against `futureLifeU` [now, grow, fade]: points by their size, solid things by dissolving all over at once
 * (a screen-door: the fewer of their pixels the further gone), never piece by piece.
 */

import * as THREE from "three";

/** [now (s), grow (s), fade (s)] — set every frame by the layer (FutureUnder), read by every shader below. */
export const futureLifeU = { value: new THREE.Vector3(0, 0, 0) };

export type KeyedLife = {
  version: number;
  first: boolean;
  /** the keys of the last layer's things, in their order, and when each came */
  keys: Float64Array;
  born: Map<number, number>;
  prev: Map<number, Float32Array>;
  dying: { rec: Float32Array; born: number; died: number }[];
};

export const newKeyedLife = (): KeyedLife => ({ version: -1, first: true, keys: new Float64Array(0), born: new Map(), prev: new Map(), dying: [] });

/** A key of a place (to a 64th of a world unit) and a small number more (0 … 4095). */
export const placeKey = (x: number, z: number, more = 0): number => (Math.round(x * 64) * 65536 + Math.round(z * 64)) * 4096 + (Math.round(more) & 4095);

/**
 * This layer's things (`stride` numbers each) and those of the last that are gone and still fading, after them; with
 * each its [born, died]. Only a new `version` makes anything come or go — drawn again for a knob, it is all as it was.
 */
export function liveAndFading(L: KeyedLife, version: number, recs: Float32Array, stride: number, key: (a: Float32Array, o: number) => number, now: number, fade: number): { recs: Float32Array; life: Float32Array; n: number } {
  const n = Math.floor(recs.length / stride);
  if (L.version !== version) {
    const keys = new Float64Array(n), born = new Map<number, number>(), prev = new Map<number, Float32Array>();
    for (let i = 0; i < n; i++) {
      const kk = key(recs, i * stride);
      keys[i] = kk;
      if (born.has(kk)) continue;
      born.set(kk, L.first ? -1e9 : (L.born.get(kk) ?? now));
      prev.set(kk, recs.slice(i * stride, (i + 1) * stride));
    }
    const dying = L.dying.filter((d) => now - d.died < fade);
    if (!L.first && fade > 0) for (const [kk, rec] of L.prev) if (!born.has(kk)) dying.push({ rec, born: L.born.get(kk) ?? -1e9, died: now });
    Object.assign(L, { version, first: false, keys, born, prev, dying });
  }
  const all = n + L.dying.length;
  const out = new Float32Array(all * stride), life = new Float32Array(all * 2);
  out.set(recs.subarray(0, n * stride));
  for (let i = 0; i < n; i++) life[i * 2] = L.born.get(L.keys[i]) ?? -1e9;
  L.dying.forEach((d, j) => {
    out.set(d.rec, (n + j) * stride);
    life[(n + j) * 2] = d.born;
    life[(n + j) * 2 + 1] = d.died;
  });
  return { recs: out, life, n: all };
}

/** The GLSL of how far a thing has come (0 … 1) by its [born, died] and [now, grow, fade]. */
export const LIFE_GLSL = [
  "float futureLife(vec2 bd, vec3 u) {",
  "  float l = u.y > 0.0 ? smoothstep(0.0, u.y, u.x - bd.x) : 1.0;",
  "  if (bd.y > 0.0) l *= u.z > 0.0 ? 1.0 - smoothstep(0.0, u.z, u.x - bd.y) : 0.0;",
  "  return l;",
  "}",
].join("\n");

/** The screen-door: a pixel of a thing that is `l` there is kept or not (the same pattern on every thing, still). */
export const DISSOLVE_GLSL = "if (vFutureLife < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFutureLife) discard;";

/** POINTS of their own sizes (`psize`) that come and go by `aLife` — they grow from nothing and shrink back to it. */
export function lifePoints(shader: { uniforms: Record<string, unknown>; vertexShader: string }): void {
  shader.uniforms.uLife = futureLifeU;
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `attribute float psize;\nattribute vec2 aLife;\nuniform vec3 uLife;\n${LIFE_GLSL}\nvoid main() {`)
    .replace("gl_PointSize = size;", "gl_PointSize = size * psize * futureLife(aLife, uLife);");
}

/** SOLID THINGS (an instanced mesh with `aLife` on its geometry) that come and go by dissolving all over at once. */
export function lifeDissolve(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.uLife = futureLifeU;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nattribute vec2 aLife;\nuniform vec3 uLife;\nvarying float vFutureLife;\n${LIFE_GLSL}`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFutureLife = futureLife(aLife, uLife);");
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vFutureLife;").replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${DISSOLVE_GLSL}`);
}

/** Puts `aLife` on an instanced mesh's geometry (once) and fills it: [born, died] a thing. */
export function setLifeAttr(geo: THREE.BufferGeometry, cap: number, life: Float32Array, n: number): void {
  let a = geo.getAttribute("aLife") as THREE.InstancedBufferAttribute | undefined;
  if (!a || a.count < cap) {
    a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    geo.setAttribute("aLife", a);
  }
  const arr = a.array as Float32Array;
  arr.fill(0);
  arr.set(life.subarray(0, Math.min(n, cap) * 2));
  a.needsUpdate = true;
}
