/**
 * GRASS AND SCRUB DRAWN BY THE GPU (the artist, 2026-11-17: "느리게 느껴져. gpu 너 잘 쓸 방법 없나?" → "한꺼번에 넣어").
 * The worker sends one record a cloud (futureVillage.ts FutureResult.plantClouds); one shared set of 64 points — a soft
 * ball, thick at its middle — is drawn once per cloud, and the vertex shader places each point by the cloud's record
 * and the knobs: its width, height, flatness and jitter (grass a low carpet, scrub a dome sitting on the ground), how
 * many of its points show, their size, the plants' colours — and its FLOWERS (rules 1 and 4 of the literature: most
 * where grass meets scrub, white on long-used ground). Every knob is a uniform: turning it redraws nothing on the CPU.
 */
import * as THREE from "three";
import { useSyncExternalStore } from "react";

/**
 * THE FLOWERS' BLOOM (the artist, 2026-11-17: "아직도 블룸패스... 빛나는 느낌이 잘 안 느껴짐"): a real bloom pass —
 * selective by brightness — the flowers (and their glow) are drawn brighter than white while it is on, and the pass
 * takes only what is brighter than its threshold. Its knobs are the layer's (FutureUnder, 꽃); the pass is the wall's
 * (ParliamentSpace's composer), which reads them here.
 */
export interface FlowerBloom {
  on: boolean;
  intensity: number;
  threshold: number;
  radius: number;
}
let bloom: FlowerBloom = { on: false, intensity: 1, threshold: 1, radius: 0.6 };
const bloomSubs = new Set<() => void>();
export function setFlowerBloom(next: FlowerBloom): void {
  if (next.on === bloom.on && next.intensity === bloom.intensity && next.threshold === bloom.threshold && next.radius === bloom.radius) return;
  bloom = next;
  bloomSubs.forEach((f) => f());
}
export function useFlowerBloom(): FlowerBloom {
  return useSyncExternalStore(
    (f) => {
      bloomSubs.add(f);
      return () => bloomSubs.delete(f);
    },
    () => bloom,
    () => bloom,
  );
}

export const PLANT_PTS = 64;
const STRIDE = 12;

/** The shared points of one cloud: offsets in a unit ball (gaussian, the few beyond it on its rim) and a number each. */
export function plantBaseGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array(PLANT_PTS * 3), pu = new Float32Array(PLANT_PTS);
  let st = 0x2545f491;
  const rnd = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)) * Math.cos(2 * Math.PI * rnd());
  for (let i = 0; i < PLANT_PTS; i++) {
    const x = gauss() * 0.42, y = gauss() * 0.42, z = gauss() * 0.42, l = Math.hypot(x, y, z), k = l > 1 ? 1 / l : 1;
    pos.set([x * k, y * k, z * k], i * 3);
    // (an even spread of the numbers, so "how many show" grows smoothly)
    pu[i] = (i + 0.5) / PLANT_PTS;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("pu", new THREE.BufferAttribute(pu, 1));
  g.instanceCount = 0;
  return g;
}

/** Puts the clouds of a result in: three instanced attributes from the 12-a-cloud records (foot and height in world). */
export function setPlantClouds(g: THREE.InstancedBufferGeometry, rec: Float32Array, unit: number): void {
  const n = Math.floor(rec.length / STRIDE);
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4), c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    a.set([rec[o], rec[o + 2] * unit, rec[o + 1], rec[o + 3]], i * 4);
    b.set([rec[o + 4] * unit, rec[o + 5], rec[o + 6], rec[o + 7]], i * 4);
    c.set([rec[o + 8], rec[o + 9], rec[o + 10], rec[o + 11]], i * 4);
  }
  for (const [name, arr] of [["iA", a], ["iB", b], ["iC", c]] as const) {
    const old = g.getAttribute(name);
    g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, 4));
    if (old) (old as THREE.BufferAttribute).array = new Float32Array(0);
  }
  g.instanceCount = n;
}

export interface PlantUniforms {
  [k: string]: { value: unknown };
}

/**
 * The plants' points — or, with `halo`, THE FLOWERS' GLOW (the artist, 2026-11-17: "꽃에 selective bloom 이나 glow 적용
 * 가능?"): the same clouds drawn a second time, only their flowers, each a larger soft round spot that adds light where
 * it falls. Selective by itself, and cheap: no pass over the whole screen (the wall is bound by its pixels), only the
 * flowers' own points. Its strength and size are `uHalo` (the uniforms object is the one given, so both share it).
 */
export function plantMaterial(halo = false, shared?: PlantUniforms): { mat: THREE.PointsMaterial; u: PlantUniforms } {
  const v3 = () => ({ value: new THREE.Color() });
  const u: PlantUniforms = shared ?? {
    uGrassA: v3(), uGrassB: v3(), uScrubA: v3(), uScrubB: v3(), uSoilA: v3(), uSoilB: v3(),
    uF1: v3(), uF2: v3(), uF3: v3(), uF4: v3(),
    uGrass: { value: new THREE.Vector4(1, 1, 0.5, 0.3) }, uScrub: { value: new THREE.Vector4(1, 1, 0, 0.3) },
    uDense: { value: new THREE.Vector2(1, 1) }, uDot: { value: new THREE.Vector2(0.1, 0.13) }, uDotJit: { value: new THREE.Vector2(0.4, 0.4) },
    uFlower: { value: new THREE.Vector4(0.35, 0.8, 1.4, 0) }, uShow: { value: new THREE.Vector2(1, 1) }, uSoilOn: { value: 1 },
    uHalo: { value: new THREE.Vector3(0, 6, 2) },
    // (how much brighter than its colour a flower is drawn — x its dot, y its glow; 1 = as it is, more only with the bloom)
    uBright: { value: new THREE.Vector2(1, 1) },
    // THE RUINS' COVER (kind 3 — the artist, 2026-11-18: "건물 잔해에 식생 덮이는 거"): the points on the sides and top of a
    // part that is left, x its spread past the part's faces, y its height share, z how thick, w its dot; and its colours
    uCover: { value: new THREE.Vector4(1, 1, 1, 0.09) }, uCoverA: v3(), uCoverB: v3(),
    // DISTANCE LOD ("미래뷰 식생점에 lod 추가하면 비용 덜 드는지"): past x the points thin, to (1 − z) of them at y, each
    // the bigger for it so the ground stays covered
    uLod: { value: new THREE.Vector3(30, 140, 0) },
  };
  const mat = new THREE.PointsMaterial({ vertexColors: true, size: 1, sizeAttenuation: true });
  if (halo) {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.toneMapped = false;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    if (halo)
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uHalo;")
        // (a soft round spot: brightest at its middle, nothing past its rim; uHalo.x its strength, uHalo.z how fast it fades —
        // the alpha SET here: the vertex part above writes only vColor's colour, so its alpha is nothing to multiply by.
        // The artist, 2026-11-17: "꽃 블룸패스 안보여" — it was multiplied, and so came out 0)
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\nfloat hd = length(gl_PointCoord - 0.5) * 2.0;\nif (hd > 1.0) discard;\ndiffuseColor.a = uHalo.x * exp(-hd * hd * uHalo.z) * (1.0 - hd);",
        );
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "attribute float pu;",
          "attribute vec4 iA;",
          "attribute vec4 iB;",
          "attribute vec4 iC;",
          "uniform vec3 uGrassA, uGrassB, uScrubA, uScrubB, uSoilA, uSoilB, uF1, uF2, uF3, uF4;",
          "uniform vec4 uGrass, uScrub, uFlower;",
          "uniform vec2 uDense, uDot, uDotJit, uShow;",
          "uniform float uSoilOn;",
          "uniform vec3 uHalo;",
          "uniform vec2 uBright;",
          "uniform vec4 uCover;",
          "uniform vec3 uCoverA, uCoverB, uLod;",
        ].join("\n"),
      )
      .replace(
        "#include <color_vertex>",
        [
          "bool scrub = iB.y > 0.5;",
          "vec4 P = scrub ? uScrub : uGrass;",
          "float own = iC.y;",
          "float jit = max(0.2, 1.0 + (own - 0.5) * 2.0 * P.w);",
          "float hB = fract(own * 91.7);",
          "float ca = cos(hB * 6.2832), sa = sin(hB * 6.2832);",
          "vec3 o = position;",
          "vec2 xz = vec2(ca * o.x - sa * o.z, sa * o.x + ca * o.z);",
          "float rad = iA.w * P.x * jit;",
          "float h = iB.x * P.y * (scrub ? jit : 1.0);",
          "float fl = P.z;",
          "vec3 tPos;",
          // (grass: a carpet, low and wide; scrub: a dome sitting on the ground — or, flatter, an open low spread)
          "if (scrub) tPos = vec3(iA.x + xz.x * rad * (1.0 + fl * 0.6), iA.y + (o.y * 0.5 + 0.5) * h * (1.0 - 0.5 * fl), iA.z + xz.y * rad * (1.0 + fl * 0.6));",
          "else tPos = vec3(iA.x + xz.x * rad, iA.y + abs(o.y) * h * (1.0 - 0.7 * fl), iA.z + xz.y * rad);",
          // (the ruins' cover: on the four sides of the part's box (its half widths iA.w, iC.w, its height iB.x) and a
          // share on its top; each point a little off the face, as a creeper or moss hangs)
          "bool cover = iB.y > 2.5;",
          "if (cover) {",
          "  vec2 sq = o.xz / max(max(abs(o.x), abs(o.z)), 1e-3);",
          "  float off = 1.0 + (0.04 + 0.1 * fract(pu * 17.3 + own)) * uCover.x;",
          "  float up = o.y * 0.5 + 0.5;",
          "  if (fract(pu * 5.1 + own * 3.7) < 0.3) { sq = o.xz * 1.6; up = 1.0 + 0.04 * fract(pu * 9.7); off = 1.0; }",
          "  float hh = 1.0 - pow(1.0 - up, 1.0 + uCover.y * 2.0);",
          "  tPos = vec3(iA.x + clamp(sq.x, -1.0, 1.0) * iA.w * off, iA.y + (up > 1.0 ? up : hh) * iB.x, iA.z + clamp(sq.y, -1.0, 1.0) * iC.w * off);",
          "}",
          "float vis = (pu < iC.z * (cover ? uCover.z : scrub ? uDense.y : uDense.x)) ? 1.0 : 0.0;",
          "vis *= iC.x > 0.5 ? uShow.y : uShow.x;",
          // (the LOD: fewer points the further, each the bigger)
          "float dist = -(modelViewMatrix * vec4(tPos, 1.0)).z;",
          "float lod = 1.0 - uLod.z * smoothstep(uLod.x, uLod.y, dist);",
          "if (fract(pu * 61.7 + own * 5.3) > lod) vis = 0.0;",
          "float fu = fract(pu * 13.37 + own * 7.1);",
          "bool flower = !cover && fu < iB.z * uFlower.x;",
          "float pScale = vis * (cover ? uCover.w : scrub ? uDot.y : uDot.x) * max(0.15, 1.0 + (fract(pu * 5.3 + own) - 0.5) * 2.0 * (scrub ? uDotJit.y : uDotJit.x)) * (flower ? uFlower.z : 1.0) * inversesqrt(max(lod, 0.1));",
          "float sh = fract(pu * 3.17 + own * 1.9);",
          "vec3 base = cover ? mix(uCoverA, uCoverB, sh) : scrub ? mix(uScrubA, uScrubB, sh) : mix(uGrassA, uGrassB, sh);",
          "if (!cover && fract(pu * 7.77 + own * 2.3) < iB.w * uSoilOn) base = mix(uSoilA, uSoilB, sh);",
          "base *= 0.82 + 0.28 * (o.y * 0.5 + 0.5);",
          "if (flower) {",
          "  float pick = fract(pu * 29.1 + own * 3.3);",
          "  vec3 fc = pick < 0.25 ? uF1 : pick < 0.5 ? uF2 : pick < 0.75 ? uF3 : uF4;",
          // (rule 4: on long-used ground the flowers go white — colour 1)
          "  if (fract(pu * 41.3 + own) < iB.w * uFlower.y) fc = uF1;",
          "  base = fc * uBright.x;",
          "}",
          // (vColor is a vec3 or a vec4 by the three.js build — a vec4 in this one: its colour part, either way)
          "vColor.rgb = base;",
          // (the glow: only the flowers, larger — uHalo.y times their dot; the rest not drawn)
          halo ? "pScale = flower ? pScale * uHalo.y : 0.0;\nvColor.rgb *= uBright.y / max(uBright.x, 1e-3);" : "",
        ].join("\n"),
      )
      .replace("#include <begin_vertex>", "vec3 transformed = tPos;")
      .replace("#include <fog_vertex>", "gl_PointSize *= pScale;\n#include <fog_vertex>");
  };
  mat.customProgramCacheKey = () => (halo ? "future-plant-flower-glow" : "future-plant-clouds");
  return { mat, u };
}
