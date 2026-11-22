"use client";
/**
 * FutureEncounter — THE FUTURE PASSES WHERE THE VISITOR STANDS (the artist, 2026-11-22: "미래에서는 늘 고고학 봇 6-7개
 * 정도가 돌아다니고 … 걔들이랑 xy 좌표가 일정 범위 내로 겹칠 때 '미래가 당신을 응시합니다...' 혹은 '미래가 당신의 삶을
 * 발견했습니다' 등의 안내멘트 로그와 함께 그 인근 미래의 모습을 pointcloud 로 보여줬다가 쏴아 사라져서 잔상처럼").
 *
 * The future's archaeologists (lib/parliament/excavators.ts) walk the layer's ground, unseen. When one crosses where
 * the visitor stands, the future round the visitor is read once (lib/parliament/futurePresence.ts — what of the
 * buildings is left, the mounds and dark earth, the plants that took it, the visitor's own cells) and shown as a point
 * cloud: it gathers out of nothing from the visitor outwards, holds while the archaeologist is there, and streams away
 * the way it walks — then nothing is left of it but the line in the record. "Found" when the visitor's life is in that
 * ground (they stayed there: their own cells), "looked at" when it is not.
 *
 * One draw call (the points) and a line; the reading only at an encounter (≈ 5 – 40 ms once). Its knobs: the
 * personal view's folder 미래 (개인뷰 · 시험), mode 마주침.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, nearestImage, wrapDist, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { excavatorsAt } from "@/lib/parliament/excavators";
import { futurePresence, waterDistance } from "@/lib/parliament/futurePresence";
import { playFuturePassing } from "./futureSound";
import type { SoundSetup } from "./useSound";
import { CELL_SIZE } from "@/lib/stratum/field";
import type { FuturePresenceVisual } from "./FuturePresence";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";

/** The last encounter, for the record (RoleField puts it on the observation; witness.ts writes its line once); and
 *  whether the present is to be dark now (the future holds — RoleField hides its drawing). */
export const futureMeet: { last: { id: string; found: boolean } | null; dark: boolean } = { last: null, dark: false };

/** The wall's density rule as the artist had it (2026-11-20) — until the server's hello says its own. */
const FALLBACK_DENSITY: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: NO_PATHS }, slotSec: 20, gapSec: 20, maxBuilt: 8000, mergeGap: 3, mergeThick: 2, liveAt: 0.25, minVisitors: 4, step: 40, maxLevel: 6, ratio: 3, massRatio: 1.45, visitorCap: 60, radius: 2.75, timeSec: 60, down: 0.5 };
const FEED_PER_FRAME = 150;
const CAP = 90000;
/** How near (world) one's own cells must be for the future to have found one's life. */
const FOUND_NEAR = 5;

const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const VERT = `
attribute vec3 color;
attribute vec4 aSeed;
attribute float aSize;
uniform float uT, uIn, uOutAt, uOut, uSize, uScale;
uniform vec2 uDir;
uniform vec3 uOrigin;
varying vec3 vColor;
varying float vA;
void main() {
  float d = length(position.xz - uOrigin.xz);
  // gathers out of nothing, the nearest first
  float tin = clamp((uT - d * 0.045) / uIn, 0.0, 1.0);
  float gin = 1.0 - pow(1.0 - tin, 3.0);
  vec3 p = position + (aSeed.xyz * 3.5 + vec3(0.0, 2.0, 0.0)) * (1.0 - gin);
  // a scanned thing's tremor while it holds
  p += aSeed.xyz * 0.025 * sin(uT * 2.3 + aSeed.w * 40.0);
  // streams away the way the archaeologist walks, each point at its own moment
  float tout = clamp((uT - uOutAt - aSeed.w * 0.7 - d * 0.03) / uOut, 0.0, 1.0);
  float go = tout * tout;
  p += vec3(uDir.x, 0.0, uDir.y) * go * (4.0 + 6.0 * aSeed.w) + vec3(0.0, go * (1.5 + 2.5 * aSeed.w), 0.0) + aSeed.xyz * go * 1.5;
  vA = gin * (1.0 - tout);
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * aSize * uScale / max(0.1, -mv.z) * (1.0 - 0.5 * go));
}`;
const FRAG = `
varying vec3 vColor;
varying float vA;
void main() {
  if (vA < 0.01) discard;
  gl_FragColor = vec4(vColor, vA);
}`;

/**
 * THE DREAM (FuturePresenceVisual.dream — the reference study of 2026-11-22): five details, all in the vertex shader.
 * ① the points are the future's surfaces sampled (finer, and thinner with distance: on the CPU, once an encounter);
 * ② they drift, breathing in a slow noise, and smear along the way the archaeologist walks as they go;
 * ③ soft round points of many sizes, blurred and fainter near and far (a bokeh without a depth-of-field pass), added
 *    lightly, their pixel size capped;
 * ④ a RAGGED WINDOW: what is shown is cut by a 3D noise threshold round the meeting, not by a circle;
 * ⑤ they come and go POINT BY POINT — each its own threshold against a density that rises and falls (where the
 *    visitor's own cells are the threshold is lower: they come first and stay longest).
 * No full-screen pass; the present stays under it.
 */
const DREAM_VERT = `
attribute vec3 color;
attribute vec4 aSeed;
attribute float aSize;
uniform float uT, uIn, uOutAt, uOut, uSize, uScale, uR, uMaxPx;
uniform vec2 uDir;
uniform vec3 uOrigin;
varying vec3 vColor;
varying float vA;
varying float vBlur;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 p = position;
  float d = length(p.xz - uOrigin.xz);
  // ④ the ragged window
  float edge = n3(p * 0.35 + vec3(0.0, uT * 0.05, 0.0)) * 0.55 + n3(p * 1.3) * 0.2;
  float win = 1.0 - d / uR + edge - 0.35;
  // ⑤ point by point
  float dens = smoothstep(0.0, uIn, uT) * (1.0 - smoothstep(uOutAt, uOutAt + uOut, uT));
  float keep = step(aSeed.w, dens * clamp(win * 3.0, 0.0, 1.0));
  // ② drift, and the smear as it goes
  float t = uT * 0.6;
  vec3 drift = vec3(n3(p * 0.5 + vec3(t, 0.0, 0.0)) - 0.5, n3(p * 0.5 + vec3(0.0, t, 7.0)) - 0.5, n3(p * 0.5 + vec3(3.0, 0.0, t)) - 0.5) * 0.35;
  float go = smoothstep(uOutAt, uOutAt + uOut, uT);
  p += drift + vec3(uDir.x, 0.0, uDir.y) * (aSeed.x * 0.6 + go * (1.5 + 3.0 * aSeed.w));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.1, -mv.z);
  // ③ blurred near and far
  float blur = smoothstep(4.0, 1.5, z) + smoothstep(uR * 1.2, uR * 2.5, z);
  vBlur = clamp(blur, 0.0, 1.0);
  vA = keep * (0.35 + 0.65 * clamp(win * 2.0, 0.0, 1.0)) * (1.0 - 0.6 * vBlur);
  vColor = color;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uMaxPx, max(1.0, uSize * aSize * uScale / z * (1.0 + 2.5 * vBlur)));
}`;
const DREAM_FRAG = `
varying vec3 vColor;
varying float vA;
varying float vBlur;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = vA * mix(1.0 - r, exp(-r * 3.0), vBlur) * 0.85;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;
const isCoarse = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;

export function FutureEncounter({ log, meRef, getS, getWorldSec, getEpochMs, getLive, playerPosRef, cfg, sound = null, getYaw }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; getWorldSec: () => number; getEpochMs: () => number; getLive: () => boolean; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; cfg: FuturePresenceVisual; sound?: SoundSetup | null; getYaw?: () => number }) {
  const field = useRef<{ f: DensityField; key: string; fed: number; drops: number } | null>(null);
  const st = useRef({ active: false, t0: 0, ex: -1, cool: new Map<number, number>(), outAt: 0 });
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(CAP * 4), 4));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(CAP), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // (uR and uMaxPx are the dream's; set on both materials alike)
        uniforms: { uT: { value: 0 }, uIn: { value: 1 }, uOutAt: { value: 3 }, uOut: { value: 1.8 }, uSize: { value: 0.07 }, uScale: { value: 400 }, uDir: { value: new THREE.Vector2(1, 0) }, uOrigin: { value: new THREE.Vector3() }, uR: { value: 12 }, uMaxPx: { value: 28 } },
      }),
    [],
  );
  const dreamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DREAM_VERT,
        fragmentShader: DREAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 0 }, uIn: { value: 1 }, uOutAt: { value: 3 }, uOut: { value: 1.8 }, uSize: { value: 0.07 }, uScale: { value: 400 }, uDir: { value: new THREE.Vector2(1, 0) }, uOrigin: { value: new THREE.Vector3() }, uR: { value: 12 }, uMaxPx: { value: 28 } },
      }),
    [],
  );
  // THE ARCHAEOLOGIST, while it is there: a thin white line standing on the ground where it walks
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, fog: false, depthWrite: false }), []);
  const points = useRef<THREE.Points>(null);
  useEffect(() => {
    futureMeet.last = null;
    futureMeet.dark = false;
    return () => {
      futureMeet.last = null;
      futureMeet.dark = false;
      geom.dispose();
      mat.dispose();
      dreamMat.dispose();
      line.dispose();
      lineMat.dispose();
    };
  }, [geom, mat, dreamMat, line, lineMat]);

  useFrame((state) => {
    // THE FIELD: this view's log through the wall's density rule, fed a little every frame
    const dcfg = visitorWorld.density ?? FALLBACK_DENSITY;
    const key = `${visitorWorld.version}:${JSON.stringify(dcfg)}`;
    let h = field.current;
    if (!h || h.key !== key || h.drops !== log.drops) h = field.current = { f: new DensityField(dcfg), key, fed: 0, drops: log.drops };
    const all = log.all();
    if (h.fed < all.length) {
      const t0 = performance.now(), to = Math.min(all.length, h.fed + FEED_PER_FRAME);
      for (let i = h.fed; i < to; i++) h.f.add(all[i]);
      h.fed = to;
      markSpan("future-feed", performance.now() - t0);
    }
    const now = performance.now() / 1000;
    const s = st.current;
    const p = playerPosRef.current;
    const epoch = getEpochMs();
    const exCfg = { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 };
    const exs = epoch > 0 ? excavatorsAt(epoch, getWorldSec(), exCfg) : [];
    // (the dream's own material, or today's — the same uniforms are set on both)
    const M = cfg.dream ? dreamMat : mat;
    if (points.current && points.current.material !== M) points.current.material = M;
    for (const m of [mat, dreamMat]) {
      m.uniforms.uScale.value = state.gl.domElement.height / 2;
      m.uniforms.uSize.value = cfg.pointSize;
    }
    if (s.active) {
      const t = now - s.t0;
      const ex = exs.find((e) => e.i === s.ex);
      const inside = !!ex && wrapDist(ex.x, ex.z, p.x, p.z) <= cfg.meetR * 1.6;
      // (it holds while the archaeologist is there, at least `hold` seconds; then it streams away)
      if (inside) s.outAt = Math.max(s.outAt, Math.min(t + 0.5, cfg.inSec + 12));
      M.uniforms.uT.value = t;
      M.uniforms.uOutAt.value = s.outAt;
      if (ex) {
        M.uniforms.uDir.value.set(ex.dx, ex.dz);
        const x = nearestImage(ex.x, p.x), z = nearestImage(ex.z, p.z);
        const a = line.getAttribute("position") as THREE.BufferAttribute;
        (a.array as Float32Array).set([x, 0, z, x, 6, z]);
        a.needsUpdate = true;
      }
      const env = Math.min(1, t / Math.max(0.1, cfg.inSec)) * (1 - Math.min(1, Math.max(0, (t - s.outAt) / Math.max(0.1, cfg.outSec))));
      lineMat.opacity = 0.7 * env;
      // (the present is dark while the future holds; it comes back as the cloud streams away — the afterimage)
      futureMeet.dark = cfg.darkPresent && !cfg.dream && t < s.outAt;
      if (t > s.outAt + cfg.outSec + 1) {
        s.active = false;
        futureMeet.dark = false;
        geom.setDrawRange(0, 0);
        lineMat.opacity = 0;
      }
      return;
    }
    if (!getLive() || h.fed < all.length) return;
    // AN ARCHAEOLOGIST CROSSES WHERE THE VISITOR STANDS
    const ex = exs.find((e) => wrapDist(e.x, e.z, p.x, p.z) <= cfg.meetR && (s.cool.get(e.i) ?? -Infinity) <= now);
    if (!ex) return;
    const t0 = performance.now();
    const sNow = getS();
    const kMe = Math.floor(sNow / Math.max(1, dcfg.slotSec));
    let K = kMe;
    if (cfg.readLatest) {
      let kk = -Infinity;
      for (const sd of h.f.seeds()) if (sd.levels) for (const [k, lv] of sd.levels) if (lv >= 1 && k > kk && k <= K) kk = k;
      if (kk !== -Infinity) K = kk;
    }
    const box: BoxConfig = { ...DEFAULT_BOXES, secPerUnit: Math.max(1, dcfg.slotSec), unit: cfg.unit, width: 0.8, density: 1.4, variety: DEFAULT_VARIETY, buildSlots: 0 };
    const me = meRef.current.id;
    const dream = cfg.dream, phone = isCoarse();
    const r = futurePresence(h.f, me, K, kMe, p, { ...cfg, radius: cfg.cloudR, surface: cfg.surface * (dream ? (phone ? 0.6 : 2.5) : 1), wild: cfg.wild, traces: true }, box);
    // FOUND: the visitor stayed in that ground (their own cells near, whenever in their life)
    let found = false;
    for (const c of h.f.cellsOf(me)) if (wrapDist((c.cx + 0.5) * CELL_SIZE, (c.cz + 0.5) * CELL_SIZE, p.x, p.z) <= FOUND_NEAR) {
      found = true;
      break;
    }
    futureMeet.last = { id: `${ex.i}:${Math.round(getWorldSec())}`, found };
    // ── the cloud ──
    const P = (geom.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const C = (geom.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
    const S = (geom.getAttribute("aSeed") as THREE.BufferAttribute).array as Float32Array;
    const Z = (geom.getAttribute("aSize") as THREE.BufferAttribute).array as Float32Array;
    let size = 1;
    let v = 0;
    const R = cfg.cloudR;
    // (the dream: up to 90 000 points — a phone a fifth — thinner the further from the visitor; the visitor's own cells
    // lower the threshold of what is near them: their life comes first and stays longest)
    const cap = dream ? Math.min(CAP, phone ? 18000 : 90000) : CAP;
    const mine: number[] = [];
    for (let o = 0; o + 3 < r.traces.length; o += 4) mine.push(r.traces[o], r.traces[o + 1]);
    const put = (x0: number, y: number, z0: number, r0: number, g0: number, b0: number) => {
      if (v >= cap) return;
      const x = nearestImage(x0, p.x), z = nearestImage(z0, p.z);
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 > R * R * (dream ? 1.6 : 1)) return;
      if (dream && hash(v, 23, Math.round(x * 7 + z * 13)) > 1 - 0.75 * Math.pow(Math.sqrt(d2) / (R * 1.26), 1.5)) return;
      P[v * 3] = x;
      P[v * 3 + 1] = y;
      P[v * 3 + 2] = z;
      C[v * 3] = r0;
      C[v * 3 + 1] = g0;
      C[v * 3 + 2] = b0;
      const a = hash(v, 17, 1) * Math.PI * 2, c = hash(v, 17, 2) * 2 - 1, q = Math.sqrt(1 - c * c);
      S[v * 4] = Math.cos(a) * q;
      S[v * 4 + 1] = c;
      S[v * 4 + 2] = Math.sin(a) * q;
      S[v * 4 + 3] = hash(v, 17, 3);
      if (dream) {
        S[v * 4] = hash(v, 17, 4) - 0.5;
        let nearMine = false;
        for (let m = 0; m + 1 < mine.length && !nearMine; m += 2) if ((x - nearestImage(mine[m], p.x)) ** 2 + (z - nearestImage(mine[m + 1], p.z)) ** 2 < 4) nearMine = true;
        if (nearMine) S[v * 4 + 3] *= 0.4;
      }
      // (sizes: the kind's, and in the dream each its own — from a third to twice)
      Z[v] = dream ? size * (0.35 + 1.65 * hash(v, 17, 5) ** 2) : size;
      v++;
    };
    // (the dream's plants paler: only the plants carry colour)
    const green = new THREE.Color(cfg.plantColor);
    if (dream) green.lerp(new THREE.Color("#ffffff"), 0.45);
    // the parts that are left, on their surfaces
    size = 1;
    for (let o = 0; o + 3 < r.surface.length; o += 4) {
      const sh = r.surface[o + 3];
      put(r.surface[o], r.surface[o + 1], r.surface[o + 2], sh, sh, sh);
    }
    // the plants: grass a low carpet, scrub a dome — each cloud a few dozen points
    size = 0.9;
    let flowering = 0;
    for (let o = 0; o + 11 < r.plantClouds.length; o += 12) {
      const x = r.plantClouds[o], z = r.plantClouds[o + 1], rad = r.plantClouds[o + 3], tall = r.plantClouds[o + 4] * cfg.unit, kind = r.plantClouds[o + 5], own = Math.floor(r.plantClouds[o + 9] * 1e6);
      if ((nearestImage(x, p.x) - p.x) ** 2 + (nearestImage(z, p.z) - p.z) ** 2 > (R + 2) ** 2) continue;
      const n = Math.min(120, 20 + Math.round(rad * rad * 25));
      if (r.plantClouds[o + 6] > 0.3) flowering++;
      for (let i = 0; i < n; i++) {
        const th = hash(own, i, 1) * Math.PI * 2, rr = rad * Math.sqrt(hash(own, i, 2)), u = hash(own, i, 3);
        const y = kind >= 1 ? tall * (1 - (rr / Math.max(1e-3, rad)) ** 2) * u : tall * u * 0.5 + 0.01;
        const k = (kind >= 1 ? 0.55 : 0.8) + 0.45 * hash(own, i, 4);
        put(x + Math.cos(th) * rr, y, z + Math.sin(th) * rr, green.r * k, green.g * k, green.b * k);
      }
    }
    // the trees' points
    for (let o = 0; o + 4 < r.vegTree.length; o += 5) {
      const k = 0.45 + r.vegTree[o + 3];
      put(r.vegTree[o], r.vegTree[o + 1] * cfg.unit, r.vegTree[o + 2], green.r * k, green.g * k, green.b * k);
    }
    // the mounds: domes of pale points; the dark earth: a few grey points flat on the ground
    for (let o = 0; o + 3 < r.mounds.length; o += 4) {
      const x = r.mounds[o], z = r.mounds[o + 1], score = r.mounds[o + 2], sd = Math.floor(r.mounds[o + 3] * 1e6);
      const n = Math.min(60, 10 + Math.round(score * 10)), Rm = CELL_SIZE * 0.5 * Math.min(2, Math.sqrt(score)), H = cfg.unit * 0.3 * Math.min(1.5, score);
      for (let i = 0; i < n; i++) {
        const u1 = hash(sd, i, 1), th = hash(sd, i, 2) * Math.PI * 2, rr = Rm * Math.sqrt(u1), c = 0.7 + 0.25 * hash(sd, i, 3);
        put(x + Math.cos(th) * rr, 0.02 + H * (1 - u1), z + Math.sin(th) * rr, c, c, c);
      }
    }
    for (let o = 0; o + 3 < r.stains.length; o += 4) {
      const x = r.stains[o], z = r.stains[o + 1], sd = Math.floor(r.stains[o + 3] * 1e6);
      for (let i = 0; i < 8; i++) {
        const th = hash(sd, i, 5) * Math.PI * 2, rr = CELL_SIZE * 0.45 * Math.sqrt(hash(sd, i, 6));
        put(x + Math.cos(th) * rr, 0.015, z + Math.sin(th) * rr, 0.3, 0.3, 0.3);
      }
    }
    // the visitor's own cells: a white patch each (a bright one where a building stands because of them)
    size = 1.5;
    for (let o = 0; o + 3 < r.traces.length; o += 4) {
      const x = r.traces[o], z = r.traces[o + 1], kind = r.traces[o + 3], sd = Math.floor((x * 131 + z * 71) * 100);
      const c = kind >= 1 ? 1 : kind > 0 ? 0.8 : 0.6;
      for (let i = 0; i < 14; i++) put(x + (hash(sd, i, 7) - 0.5) * CELL_SIZE, 0.03, z + (hash(sd, i, 8) - 0.5) * CELL_SIZE, c, c, c);
    }
    // the ground of the future, scanned: a sparse floor of small dark points
    size = 0.45;
    for (let i = 0; i < 1400; i++) {
      const th = hash(i, 91, Math.round(now)) * Math.PI * 2, rr = R * Math.sqrt(hash(i, 92, Math.round(now)));
      put(p.x + Math.cos(th) * rr, 0.005, p.z + Math.sin(th) * rr, 0.2, 0.2, 0.2);
    }
    geom.setDrawRange(0, v);
    M.uniforms.uR.value = R;
    for (const name of ["position", "color", "aSeed", "aSize"]) (geom.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    M.uniforms.uOrigin.value.set(p.x, 0, p.z);
    M.uniforms.uDir.value.set(ex.dx, ex.dz);
    M.uniforms.uIn.value = cfg.inSec;
    M.uniforms.uOut.value = cfg.outSec;
    M.uniforms.uT.value = 0;
    Object.assign(s, { active: true, t0: now, ex: ex.i, outAt: cfg.inSec + cfg.holdSec });
    s.cool.set(ex.i, now + cfg.cooldownSec);
    // THE PASSING, HEARD (futureSound.ts): glitter where the meadow flowers, a river where the future's water runs near,
    // from the side it comes from to the side it goes to (the listener's right: the camera's yaw)
    const wd = waterDistance(epoch, visitorWorld.herd, sNow, p.x, p.z);
    const yaw = getYaw?.() ?? 0, rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const side = Math.max(-1, Math.min(1, ex.dx * rx + ex.dz * rz));
    const heard = cfg.fxLevel > 0 && playFuturePassing(sound, { glitter: Math.min(1, flowering / 15), river: wd <= 10 ? 1 - wd / 10 : 0, found, panFrom: -side * 0.8, panTo: side * 0.8, dur: cfg.inSec + cfg.holdSec + cfg.outSec, level: cfg.fxLevel });
    markSpan("future-meet", performance.now() - t0);
    (window as unknown as { __futureMeet?: unknown }).__futureMeet = { at: Math.round(getWorldSec()), ex: ex.i, found, heard, flowering, water: Number.isFinite(wd) ? Math.round(wd * 10) / 10 : null, points: v, ms: Math.round(performance.now() - t0), k: K, kMe, n: r.n, surface: r.surface.length / 4, plants: r.plantClouds.length / 12, trees: r.vegTree.length / 5, mounds: r.mounds.length / 4, stains: r.stains.length / 4, traces: r.traces.length / 4 };
  });

  return (
    <>
      <points ref={points} geometry={geom} material={mat} frustumCulled={false} />
      <lineSegments geometry={line} material={lineMat} frustumCulled={false} />
    </>
  );
}

/** For the readout: where the archaeologists are now (a debugging helper; not drawn). */
export function excavatorsNear(epochMs: number, sec: number, at: { x: number; z: number }, cfg: FuturePresenceVisual): { i: number; d: number }[] {
  return excavatorsAt(epochMs, sec, { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 })
    .map((e) => ({ i: e.i, d: Math.round(wrapDist(e.x, e.z, at.x, at.z) * 10) / 10 }))
    .sort((a, b) => a.d - b.d);
}
