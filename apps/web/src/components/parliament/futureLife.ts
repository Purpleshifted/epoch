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

import { useSyncExternalStore } from "react";
import * as THREE from "three";

/**
 * WHAT THE VIEW OF THE LAYER ALONE SPENDS ON THE SCREEN (the artist, 2026-11-18: "여튼 최적화가 진짜 큰 문제"). Measured
 * on the artist's world and values (2048 × 1536): 13.7 fps as it was; the AO pass off 38; AO and the sun's shadows off
 * 51 (the AO at its lowest and at half resolution still 17 — its pass itself is the cost). In /rehearsal/future the layer
 * is points over a see-through ground that takes no shadow, so both are off there unless its own knobs say otherwise
 * (FutureUnder 보기); the wall keeps the 렌더 values as they are.
 */
export type FutureRender = { ao: boolean; shadows: boolean };
let futureRender: FutureRender = { ao: false, shadows: false };
const renderSubs = new Set<() => void>();
export function setFutureRender(v: FutureRender): void {
  if (v.ao === futureRender.ao && v.shadows === futureRender.shadows) return;
  futureRender = v;
  for (const f of renderSubs) f();
}
export function useFutureRender(): FutureRender {
  return useSyncExternalStore(
    (f) => {
      renderSubs.add(f);
      return () => renderSubs.delete(f);
    },
    () => futureRender,
    () => futureRender,
  );
}

/** [now (s), grow (s), fade (s)] — set every frame by the layer (FutureUnder), read by every shader below. */
export const futureLifeU = { value: new THREE.Vector3(0, 0, 0) };
/** [now (s), 0, 0]: THE TICKER'S — what reads it snaps in and out at its turn (the buildings' parts); and the ticker's
 *  length (s), set by the layer's knob (FutureUnder 보기 › ticker), for whoever lays out the turns. */
export const futureTickU = { value: new THREE.Vector3(0, 0, 0) };
export const futureTicker = { sec: 3 };

export type KeyedLife = {
  version: number;
  first: boolean;
  /** the keys of the last layer's things, in their order, and when each came */
  keys: Float64Array;
  born: Map<number, number>;
  /** where each of the last layer's things lies in its records (no copy of each: a layer can be 100 000 points) */
  prev: Map<number, number>;
  prevRecs: Float32Array;
  dying: { key: number; rec: Float32Array; born: number; died: number }[];
};

export const newKeyedLife = (): KeyedLife => ({ version: -1, first: true, keys: new Float64Array(0), born: new Map(), prev: new Map(), prevRecs: new Float32Array(0), dying: [] });

/** A key of a place (to a 64th of a world unit) and a small number more (0 … 4095). */
export const placeKey = (x: number, z: number, more = 0): number => (Math.round(x * 64) * 65536 + Math.round(z * 64)) * 4096 + (Math.round(more) & 4095);

/**
 * This layer's things (`stride` numbers each) and those of the last that are gone and still fading, after them; with
 * each its [born, died]. Only a new `version` makes anything come or go — drawn again for a knob, it is all as it was.
 * LIKE A TICKER (`ticker`, the artist, 2026-11-18: "건물은 티커처럼", "티커로 차자자작 지어지는 느낌이면 되는데"): what
 * changes does not change all at the same moment — the things that come take their turns one after another over
 * `ticker` seconds, in the order `order` gives (lowest first: a building from its foot up), and those that go the
 * other way round (from the top down); with a shader of no grow or fade time each turn is a snap.
 */
export function liveAndFading(L: KeyedLife, version: number, recs: Float32Array, stride: number, key: (a: Float32Array, o: number) => number, now: number, fade: number, ticker = 0, order?: (a: Float32Array, o: number) => number): { recs: Float32Array; life: Float32Array; n: number } {
  const n = Math.floor(recs.length / stride);
  if (L.version !== version) {
    // (the turns: each thing's time, by its rank among those that change the same way)
    const turns = (list: { o: number; a: Float32Array; i: number }[], down: boolean): Map<number, number> => {
      const t = new Map<number, number>();
      if (!(ticker > 0) || !order || list.length < 2) {
        for (const e of list) t.set(e.i, now);
        return t;
      }
      const ord = list.map((e) => ({ i: e.i, v: order(e.a, e.o) })).sort((p, q) => (down ? q.v - p.v : p.v - q.v));
      ord.forEach((e, r) => t.set(e.i, now + (r / ord.length) * ticker));
      return t;
    };
    const keys = new Float64Array(n), born = new Map<number, number>(), prev = new Map<number, number>();
    // (one still standing — gone from the last layer but not yet fading, its turn not come — and back in this one never left)
    const waiting = new Map<number, number>();
    for (const d of L.dying) if (d.died > now) waiting.set(d.key, d.born);
    const fresh: { o: number; a: Float32Array; i: number; k: number }[] = [];
    for (let i = 0; i < n; i++) {
      const kk = key(recs, i * stride);
      keys[i] = kk;
      if (born.has(kk)) continue;
      const was = L.first ? -1e9 : (L.born.get(kk) ?? waiting.get(kk));
      if (was === undefined) fresh.push({ o: i * stride, a: recs, i: fresh.length, k: kk });
      born.set(kk, was ?? now);
      prev.set(kk, i * stride);
    }
    const tIn = turns(fresh, false);
    for (const e of fresh) born.set(e.k, tIn.get(e.i) ?? now);
    const dying = L.dying.filter((d) => now - d.died < fade && !(d.died > now && born.has(d.key)));
    if (!L.first && fade > 0) {
      const gone: { o: number; a: Float32Array; i: number; k: number }[] = [];
      for (const [kk, off] of L.prev) if (!born.has(kk)) gone.push({ o: 0, a: L.prevRecs.slice(off, off + stride), i: gone.length, k: kk });
      const tOut = turns(gone, true);
      for (const e of gone) dying.push({ key: e.k, rec: e.a, born: L.born.get(e.k) ?? -1e9, died: tOut.get(e.i) ?? now });
    }
    // (the records are kept as they came — the caller makes a new array for every layer and never writes into it)
    Object.assign(L, { version, first: false, keys, born, prev, prevRecs: recs, dying });
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

/** A number 0 … 1 of a group's own (e.g. which neighbourhood's turn comes first in the ticker). */
export const tick = (g: number): number => {
  let h = Math.imul(Math.floor(g) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(g / 4294967296) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** The GLSL of how far a thing has come (0 … 1) by its [born, died] and [now, grow, fade]. */
export const LIFE_GLSL = [
  "float futureLife(vec2 bd, vec3 u) {",
  // (no grow or fade time: a snap at its turn — the ticker's)
  "  float l = u.y > 0.0 ? smoothstep(0.0, u.y, u.x - bd.x) : step(bd.x, u.x);",
  "  if (bd.y > 0.0) l *= u.z > 0.0 ? 1.0 - smoothstep(0.0, u.z, u.x - bd.y) : 1.0 - step(bd.y, u.x);",
  "  return l;",
  "}",
].join("\n");

/** The screen-door: a pixel of a thing that is `l` there is kept or not (the same pattern on every thing, still). */
export const DISSOLVE_GLSL = "if (vFutureLife < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFutureLife) discard;";

/** POINTS of their own sizes (`psize`) that come and go by `aLife` — they grow from nothing and shrink back to it. */
export function lifePoints(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.uLife = futureLifeU;
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `attribute float psize;\nattribute vec2 aLife;\nuniform vec3 uLife;\n${LIFE_GLSL}\nvoid main() {`)
    .replace("gl_PointSize = size;", "gl_PointSize = size * psize * futureLife(aLife, uLife);");
  edgeFade(shader);
}

/** SOLID THINGS (an instanced mesh with `aLife` on its geometry) that come and go by dissolving all over at once —
 *  or, read against futureTickU, snap in and out at their turns. */
export const lifeDissolve = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void => lifeDissolveBy(futureLifeU, shader);
export const lifeTick = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void => lifeDissolveBy(futureTickU, shader);
function lifeDissolveBy(u: { value: THREE.Vector3 }, shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.uLife = u;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nattribute vec2 aLife;\nuniform vec3 uLife;\nvarying float vFutureLife;\n${LIFE_GLSL}`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFutureLife = futureLife(aLife, uLife);");
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vFutureLife;").replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${DISSOLVE_GLSL}`);
  edgeFade(shader);
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

/**
 * A FINGERPRINT OF A LAYER'S RECORDS (the artist, 2026-11-18: "여튼 최적화가 진짜 큰 문제"): a new layer comes every slot,
 * but much of it is as it was — the stones change only with the water, the trees only with what grows — so a part of
 * the layer is drawn again only when its own records changed, not whenever a layer comes. Kept per array (an array is
 * never written into once it has come).
 */
const sums = new WeakMap<object, number>();
export function recSum(a: Float32Array | null | undefined): number {
  if (!a) return 0;
  let v = sums.get(a);
  if (v === undefined) {
    v = a.length;
    for (let i = 0; i < a.length; i++) v += a[i] * (1 + (i % 7) * 0.131) + (i % 13) * 1e-7 * a[i];
    sums.set(a, v);
  }
  return v;
}

/**
 * THE LAYER FADES OUT AT ITS EDGES (the artist, 2026-11-22: "미래에서 멀리서 바라봤을 때 … 경계가 잘려있는 게 마음에 안
 * 들어, 그라데이션으로 요소들이 사라지면 좋겠는데"): everything the layer draws thins out towards the edge of the ground
 * it was read from (FutureResult.ground) — fewer and fewer of its pixels kept, the same screen-door all over, so the
 * plants, the trees, the ruins, the ways and the ground itself go together, over `uEdgeW` (world) inside the edge.
 * Set every frame by the layer (FutureUnder 보기 › edgeFade); 0 = cut as it was.
 */
/** (uEdgeWorld: the world's width — it wraps, world.ts — so a layer read across the seam fades at its own edges) */
export const futureEdgeU = { uEdgeRect: { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) }, uEdgeW: { value: 0 }, uEdgeWorld: { value: 1e9 } };

/** Patches a material's shaders (any with <project_vertex> and <clipping_planes_fragment>) to fade at the edge. */
export function edgeFade(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  Object.assign(shader.uniforms, futureEdgeU);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec2 vEdgeXZ;")
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n{\n\tvec4 edgeWP = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n\tedgeWP = instanceMatrix * edgeWP;\n#endif\n\tvEdgeXZ = ( modelMatrix * edgeWP ).xz;\n}",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec2 vEdgeXZ;\nuniform vec4 uEdgeRect;\nuniform float uEdgeW, uEdgeWorld;")
    .replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif ( uEdgeW > 0.0 ) {\n\tvec2 edgeC = 0.5 * ( uEdgeRect.xy + uEdgeRect.zw ), edgeH = 0.5 * ( uEdgeRect.zw - uEdgeRect.xy );\n\tvec2 edgeP = vEdgeXZ - edgeC;\n\tedgeP -= uEdgeWorld * floor( edgeP / uEdgeWorld + 0.5 );\n\tvec2 edgeQ = edgeH - abs( edgeP );\n\tfloat edgeD = min( edgeQ.x, edgeQ.y );\n\tfloat edgeA = smoothstep( 0.0, 1.0, edgeD / uEdgeW );\n\tif ( edgeA < 0.999 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) + 0.31 ) ) > edgeA ) discard;\n}",
    );
}
