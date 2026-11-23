"use client";
/**
 * FrameLab — HOW A PERSON'S FRAMES ARE LAID OUT (the artist, 2026-11-23: "나와의 상대 각도 고려해서 프레임이 움직임에 따라
 * 늘어져서 옆에서 보면 동세 덩어리로 보이도록 … 랩에 아예 다른 슬랏을 추가해서 거기는 아무런 요소도 없이, 순수하게 사람
 * 프레임을 어떻게 늘어놓을 건지 결정하게"). A lab page of its own (/lab/mobile/frames): white space, no ground, no scan —
 * only people cut out of video (spritePeople's sheet) walking, and the frames they leave.
 *
 * Each walker leaves copies of their frame behind them (at a time spacing, or at each sample — "슉"), fading. A card
 * stands in one of three ways (facing the eye / along the path / across it). Each card may be STRETCHED towards the copy
 * before it by how much of the move between them lies across the eye's view — the relative angle: seen from behind the
 * copies pile into one figure, seen from the side they run together into a mass of the movement. The stretched part is
 * a streak of the silhouette's own colours (the body's middle pulled sideways, like a long exposure's drag), or the
 * frame itself widened. Cards may show only a vertical slit of their frame (slit-scan laid out in space).
 *
 * Camera: drag to orbit; the knobs' buttons put it at the side, behind, in front, above, or at eye level among them.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { button, folder, useControls } from "leva";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { savable } from "./levaSave";
import { LAB_GROUP } from "./mobileLab";
import { loadSpriteSheet, spriteRow, type SpriteIndex } from "./spritePeople";

const MAX_CARDS = 4096;
const TAU = Math.PI * 2;

type Path = "across" | "circle" | "toward" | "wander";
type Facing = "eye" | "along" | "across";

interface Look {
  count: number;
  path: Path;
  speed: number;
  spread: number;
  dist: number;
  tempo: number;
  row: number;
  height: number;
  stamp: boolean;
  sampleSec: number;
  dashSec: number;
  copies: number;
  gapSec: number;
  lifeSec: number;
  fall: number;
  ink: number;
  trailInk: number;
  facing: Facing;
  stretch: number;
  stretchKind: number; // 0 streak · 1 widen the frame
  streakSoft: number;
  slit: number;
  multiply: boolean;
  floor: boolean;
}

interface Stamp {
  t: number;
  x: number;
  z: number;
  h: number;
  ph: number;
}

interface Walker {
  hash: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  // the path's own parameter (distance along it, or an angle)
  s: number;
  dir: number;
  // wander: the point it walks to
  gx: number;
  gz: number;
  hist: Stamp[];
  stamps: Stamp[];
  lastHist: number;
  lastSample: number;
}

const VERT = /* glsl */ `
uniform float uCols;
uniform float uRows;
uniform float uAspect;
uniform float uFacing;     // 0 eye · 1 along the path · 2 across it
uniform float uStretch;
uniform float uSlit;
attribute vec4 iA;         // x, z, height, alpha
attribute vec4 iB;         // row, frame, mirror, heading
attribute vec4 iC;         // previous copy x, z, has one (0/1), 0
varying vec2 vUv;          // the frame's own u (may run outside 0 … 1 on the stretched side), v
varying float vAlpha;
varying float vSide;       // the trailing side (−1 left, +1 right) in the card's own u
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
void main() {
  vec3 feet = vec3(iA.x, 0.0, iA.y);
  vec3 right;
  if (uFacing < 0.5) {
    vec3 toEye = cameraPosition - feet;
    toEye.y = 0.0;
    vec3 f = normalize(toEye + vec3(1e-5, 0.0, 0.0));
    right = vec3(f.z, 0.0, -f.x);
  } else {
    vec3 fwd = vec3(sin(iB.w), 0.0, cos(iB.w));
    right = uFacing < 1.5 ? fwd : vec3(fwd.z, 0.0, -fwd.x);
  }
  float h = iA.z;
  float w = h * uAspect;
  // the move to the copy before, across the card (in card widths): the stretch reaches towards it
  float e = 0.0;
  if (iC.z > 0.5) e = dot(vec3(iC.x, 0.0, iC.y) - feet, right) / max(w, 1e-4) * uStretch;
  float slitHalf = 0.5 * uSlit;
  float xl = min(-slitHalf, e), xr = max(slitHalf, e);
  float x = position.x < 0.0 ? xl : xr;
  vec3 p = feet + right * x * w + vec3(0.0, position.y * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = vec2(x, position.y);
  vSide = e >= 0.0 ? 1.0 : -1.0;
  vAlpha = iA.w;
  // (the frame's row and column, and the mirror: flat, the same over the card)
  vRow = iB.x;
  vFrame = floor(mod(iB.y, uCols));
  vMirror = iB.z;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform float uCols;
uniform float uRows;
uniform float uSlit;
uniform float uStretchKind;
uniform float uStreakSoft;
uniform float uMultiply;
varying vec2 vUv;
varying float vAlpha;
varying float vSide;
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
vec4 cell(float u, float v) {
  float uu = vMirror < 0.0 ? 1.0 - u : u;
  return texture2D(uSheet, vec2((vFrame + clamp(uu, 0.001, 0.999)) / uCols, (uRows - 1.0 - vRow + clamp(v, 0.001, 0.999)) / uRows));
}
void main() {
  float x = vUv.x;              // card widths from the card's middle
  float slitHalf = 0.5 * uSlit;
  vec4 t;
  float a;
  if (abs(x) <= slitHalf) {
    t = cell(x + 0.5, vUv.y);
    a = t.a;
  } else {
    // the stretched part: beyond the frame's slit, towards the copy before
    float beyond = abs(x) - slitHalf;
    if (uStretchKind > 0.5) {
      // the frame itself widened: the whole stretch maps onto the slit
      float span = max(abs(x), slitHalf);
      t = cell(0.5 + x / span * slitHalf, vUv.y);
      a = t.a;
    } else {
      // a streak: the body's middle (just inside the slit's trailing edge) pulled sideways, fading with the distance
      float edge = 0.5 + vSide * min(slitHalf, 0.12);
      t = cell(edge, vUv.y);
      a = t.a * exp(-beyond / max(0.02, uStreakSoft));
    }
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  if (uMultiply > 0.5) gl_FragColor = vec4(mix(vec3(1.0), t.rgb, a), 1.0);
  else gl_FragColor = vec4(t.rgb, a);
}`;

function makeMaterial(): THREE.ShaderMaterial {
  // (three turns attribute/varying/texture2D/gl_FragColor into GLSL 3 for WebGL2; "flat varying" becomes flat out/in)
  return new THREE.ShaderMaterial({
    uniforms: {
      uSheet: { value: null },
      uCols: { value: 16 },
      uRows: { value: 1 },
      uAspect: { value: 0.5 },
      uFacing: { value: 0 },
      uStretch: { value: 1 },
      uSlit: { value: 1 },
      uStretchKind: { value: 0 },
      uStreakSoft: { value: 0.6 },
      uMultiply: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

function setBlend(m: THREE.ShaderMaterial, multiply: boolean): void {
  if (multiply) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
  } else m.blending = THREE.NormalBlending;
  m.needsUpdate = true;
}

const frac = (x: number) => x - Math.floor(x);
const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function histAt(H: Stamp[], t: number): Stamp | null {
  if (!H.length || t < H[0].t) return null;
  let lo = 0, hi = H.length - 1;
  if (t >= H[hi].t) return H[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (H[m].t <= t) lo = m;
    else hi = m;
  }
  const a = H[lo], b = H[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  let dh = b.h - a.h;
  dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  let dp = b.ph - a.ph;
  if (dp < -0.5) dp += 1;
  else if (dp > 0.5) dp -= 1;
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + dh * u, ph: a.ph + dp * u };
}

/** Where a walker is on its path at parameter s, and which way it goes. */
function onPath(w: Walker, L: Look, i: number, n: number): { x: number; z: number; h: number } {
  const lane = (i - (n - 1) / 2) * L.spread;
  if (L.path === "across") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: s, z: -L.dist + lane, h: w.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  if (L.path === "toward") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: lane, z: -L.dist + s, h: w.dir > 0 ? 0 : Math.PI };
  }
  if (L.path === "circle") {
    const r = Math.max(1, L.dist + lane);
    const a = (w.s / r) * w.dir + (i / Math.max(1, n)) * TAU;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r - 0, h: a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) };
  }
  return { x: w.x, z: w.z, h: w.h };
}

function Scene({ L, viewRef }: { L: Look; viewRef: React.MutableRefObject<string | null> }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (const name of ["iA", "iB", "iC"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const mat = useMemo(() => makeMaterial(), []);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  const idx = useRef<SpriteIndex | null>(null);
  useEffect(() => {
    let live = true;
    loadSpriteSheet().then(({ index, texture }) => {
      if (!live) return;
      idx.current = index;
      mat.uniforms.uSheet.value = texture;
      mat.uniforms.uCols.value = index.sheet.cols;
      mat.uniforms.uRows.value = Math.max(1, index.sheet.rows.length);
      mat.uniforms.uAspect.value = index.sheet.cellW / index.sheet.cellH;
    });
    return () => {
      live = false;
    };
  }, [mat]);
  useEffect(() => setBlend(mat, L.multiply), [mat, L.multiply]);
  const walkers = useRef<Walker[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    // the camera's places (the knobs' buttons)
    if (viewRef.current) {
      const v = viewRef.current;
      viewRef.current = null;
      const d = Math.max(4, L.dist + 6);
      const at: Record<string, [number, number, number]> = { side: [d, 1.5, -L.dist], back: [0, 1.6, -L.dist + d * (L.path === "toward" ? -1 : 1)], front: [0, 1.6, -L.dist - d], top: [0.01, d * 1.6, -L.dist], eye: [0, 1.6, 0] };
      const p = at[v] ?? at.side;
      camera.position.set(...p);
      const target = v === "eye" ? new THREE.Vector3(0, 1.4, -L.dist) : new THREE.Vector3(0, 0.9, -L.dist);
      controls.current?.target.copy(target);
      camera.lookAt(target);
      controls.current?.update();
    }
    // the walkers: as many as asked, kept between changes
    const W = walkers.current;
    while (W.length < L.count) {
      const i = W.length;
      const hash = frac(Math.sin(i * 91.7 + 3.1) * 43758.5);
      W.push({ hash, x: (hash - 0.5) * 8, z: -L.dist + (frac(hash * 7.3) - 0.5) * 8, h: hash * TAU, ph: hash, s: hash * 16, dir: i % 2 ? -1 : 1, gx: 0, gz: 0, hist: [], stamps: [], lastHist: -1, lastSample: -1 });
    }
    W.length = Math.min(W.length, L.count);
    const strideSec = (row: number) => idx.current?.sheet.rows[row]?.strideSec ?? 1.1;
    W.forEach((w, i) => {
      // move
      w.s += L.speed * dt;
      if (L.path === "wander") {
        const dx = w.gx - w.x, dz = w.gz - w.z;
        if (Math.hypot(dx, dz) < 0.4 || (w.gx === 0 && w.gz === 0)) {
          const a = frac(Math.sin(now * 13.1 + i * 7.7) * 9187.3) * TAU, r = 2 + frac(Math.sin(now * 3.3 + i) * 517.1) * Math.max(2, L.dist);
          w.gx = Math.sin(a) * r;
          w.gz = -L.dist + Math.cos(a) * r * 0.6;
        }
        const want = Math.atan2(w.gx - w.x, w.gz - w.z);
        let d = want - w.h;
        d = ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        w.h += Math.max(-1.5 * dt, Math.min(1.5 * dt, d));
        w.x += Math.sin(w.h) * L.speed * dt;
        w.z += Math.cos(w.h) * L.speed * dt;
      } else {
        const p = onPath(w, L, i, L.count);
        const jump = Math.hypot(p.x - w.x, p.z - w.z) > 3;
        w.x = p.x;
        w.z = p.z;
        w.h = p.h;
        if (jump) {
          w.hist.length = 0;
          w.stamps.length = 0;
        }
      }
      w.ph = (w.ph + (dt / strideSec(0)) * L.tempo * (L.speed / 1.3)) % 1;
      if (now - w.lastHist >= 1 / 30) {
        w.lastHist = now;
        w.hist.push({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      const keep = now - Math.max(L.lifeSec, L.copies * L.gapSec) - 0.5;
      let drop = 0;
      while (drop < w.hist.length && w.hist[drop].t < keep) drop++;
      if (drop) w.hist.splice(0, drop);
      if (L.stamp && now - w.lastSample >= L.sampleSec) {
        w.lastSample = now;
        w.stamps.unshift({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      while (w.stamps.length && now - w.stamps[w.stamps.length - 1].t > L.lifeSec + L.sampleSec) w.stamps.pop();
    });
    // the cards
    const A = (geom.getAttribute("iA") as THREE.InstancedBufferAttribute).array as Float32Array;
    const B = (geom.getAttribute("iB") as THREE.InstancedBufferAttribute).array as Float32Array;
    const C = (geom.getAttribute("iC") as THREE.InstancedBufferAttribute).array as Float32Array;
    let n = 0;
    const I = idx.current;
    const cols = I?.sheet.cols ?? 16;
    const cam = camera.position;
    const put = (w: Walker, s: Stamp, alpha: number, prev: Stamp | null) => {
      if (n >= MAX_CARDS || alpha < 0.004 || !I) return;
      const rel = s.h - Math.atan2(cam.x - s.x, cam.z - s.z);
      const pick = L.row > 0 ? { row: Math.min(I.sheet.rows.length, L.row) - 1, mirror: 1 } : spriteRow(I, rel, false, w.hash);
      A[n * 4] = s.x;
      A[n * 4 + 1] = s.z;
      A[n * 4 + 2] = L.height * (0.94 + 0.12 * w.hash);
      A[n * 4 + 3] = alpha;
      B[n * 4] = pick.row;
      B[n * 4 + 1] = (((s.ph % 1) + 1) % 1) * cols;
      B[n * 4 + 2] = pick.mirror;
      B[n * 4 + 3] = s.h;
      C[n * 4] = prev ? prev.x : 0;
      C[n * 4 + 1] = prev ? prev.z : 0;
      C[n * 4 + 2] = prev ? 1 : 0;
      C[n * 4 + 3] = 0;
      n++;
    };
    for (const w of W) {
      // the copies, oldest first, each reaching towards the one before it
      const list: { s: Stamp; age: number }[] = [];
      if (L.stamp) {
        // "슉": each sample left where it came; the body now sweeps from the last sample to where it is
        const s0 = w.stamps[0];
        for (let k = w.stamps.length - 1; k >= 1; k--) list.push({ s: w.stamps[k], age: now - w.stamps[k - 1].t });
        if (s0) {
          const e = smooth01((now - s0.t) / Math.max(0.02, L.dashSec));
          const from = w.stamps[1] ?? s0;
          list.push({ s: { ...s0, x: from.x + (s0.x - from.x) * e, z: from.z + (s0.z - from.z) * e }, age: 0 });
        }
      } else {
        for (let k = L.copies; k >= 1; k--) {
          const hh = histAt(w.hist, now - k * L.gapSec);
          if (hh) list.push({ s: hh, age: k * L.gapSec });
        }
        list.push({ s: { t: now, x: w.x, z: w.z, h: w.h, ph: w.ph }, age: 0 });
      }
      let prev: Stamp | null = null;
      for (const { s, age } of list) {
        const isNow = age === 0;
        const fade = isNow ? 1 : Math.pow(Math.max(0, 1 - age / Math.max(0.05, L.lifeSec)), L.fall);
        put(w, s, (isNow ? L.ink : L.trailInk) * fade, prev);
        prev = s;
      }
    }
    geom.instanceCount = n;
    // (a readout for the console, like __street)
    (window as unknown as { __frames?: unknown }).__frames = { cards: n, walkers: W.length, sheet: I ? I.sheet.rows.length : 0 };
    for (const name of ["iA", "iB", "iC"]) {
      const at = geom.getAttribute(name) as THREE.InstancedBufferAttribute;
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
    const u = mat.uniforms;
    u.uFacing.value = L.facing === "eye" ? 0 : L.facing === "along" ? 1 : 2;
    u.uStretch.value = L.stretch;
    u.uSlit.value = L.slit;
    u.uStretchKind.value = L.stretchKind;
    u.uStreakSoft.value = L.streakSoft;
    u.uMultiply.value = L.multiply ? 1 : 0;
  });

  return (
    <>
      <OrbitControls ref={controls} makeDefault target={[0, 0.9, -L.dist]} enableDamping dampingFactor={0.12} />
      <mesh geometry={geom} material={mat} frustumCulled={false} />
      {L.floor && <gridHelper args={[40, 40, "#e4e4e4", "#efefef"]} position={[0, 0, -L.dist]} />}
    </>
  );
}

const PATHS: Record<string, Path> = { "가로지름 (옆으로 지나감)": "across", "원 (나를 둘러 돔)": "circle", "다가옴 · 멀어짐": "toward", "흩어진 산책": "wander" };
const FACINGS: Record<string, Facing> = { "나를 향함 (빌보드)": "eye", "진행 방향을 따라 (옆에서 정면)": "along", "진행 방향에 수직 (앞뒤에서 정면)": "across" };

export default function FrameLab() {
  const G = LAB_GROUP.frames;
  const viewRef = useRef<string | null>("side");
  const c = useControls(
    G,
    savable(G, {
      "보기": folder({
        "옆에서": button(() => {
          viewRef.current = "side";
        }),
        "뒤에서": button(() => {
          viewRef.current = "back";
        }),
        "앞에서": button(() => {
          viewRef.current = "front";
        }),
        "위에서": button(() => {
          viewRef.current = "top";
        }),
        "눈높이 (나)": button(() => {
          viewRef.current = "eye";
        }),
        flFloor: { value: false, label: "바닥 격자 (위치 가늠용)" },
      }),
      "사람": folder({
        flCount: { value: 3, min: 1, max: 24, step: 1, label: "사람 수" },
        flPath: { options: PATHS, value: "across" as Path, label: "길" },
        flSpeed: { value: 1.3, min: 0.2, max: 5, step: 0.05, label: "빠르기 (m/s)" },
        flSpread: { value: 1.6, min: 0, max: 6, step: 0.1, label: "사람 사이 간격 (m)" },
        flDist: { value: 6, min: 1, max: 20, step: 0.5, label: "나와의 거리 (m)" },
        flTempo: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: "걸음 박자 ×" },
        flRow: { value: 0, min: 0, max: 8, step: 1, label: "클립 (0 = 보는 각도로 자동, 1… = 그 줄)" },
        flHeight: { value: 1.72, min: 1.2, max: 2.2, step: 0.01, label: "키 (m)" },
      }),
      "프레임 남기기": folder({
        flStamp: { value: true, label: "표본마다 슉 (끄면 일정 간격)" },
        flSample: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: "표본 간격 (s)" },
        flDash: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: "슉 — 쓸려 가는 시간 (s)" },
        flCopies: { value: 10, min: 0, max: 60, step: 1, label: "간격 모드: 남는 프레임 수" },
        flGap: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "간격 모드: 프레임 간격 (s)" },
        flLife: { value: 2, min: 0.1, max: 10, step: 0.1, label: "남는 시간 (s)" },
        flFall: { value: 1.3, min: 0.3, max: 4, step: 0.05, label: "옅어지는 곡선" },
        flInk: { value: 1, min: 0.1, max: 1, step: 0.05, label: "지금 프레임 진하기" },
        flTrailInk: { value: 0.45, min: 0, max: 1, step: 0.05, label: "남은 프레임 진하기" },
      }),
      "늘어놓기": folder({
        flFacing: { options: FACINGS, value: "eye" as Facing, label: "프레임이 서는 방향" },
        flStretch: { value: 1, min: 0, max: 1.5, step: 0.05, label: "늘어짐 (이전 프레임까지, 상대 각도만큼)" },
        flKind: { options: { "번짐 — 몸 가운데가 옆으로 끌림": 0, "프레임 자체가 넓어짐": 1 }, value: 0, label: "늘어나는 방식" },
        flSoft: { value: 0.8, min: 0.05, max: 4, step: 0.05, label: "번짐 길이 (프레임 폭)" },
        flSlit: { value: 1, min: 0.05, max: 1, step: 0.01, label: "슬릿 — 프레임의 가운데 몫만 (1 = 전체)" },
        flMultiply: { value: true, label: "곱하기로 겹침 (끄면 보통 겹침)" },
      }),
    }),
    { collapsed: false },
  ) as unknown as Record<string, unknown>;
  const L: Look = {
    count: Number(c.flCount),
    path: c.flPath as Path,
    speed: Number(c.flSpeed),
    spread: Number(c.flSpread),
    dist: Number(c.flDist),
    tempo: Number(c.flTempo),
    row: Number(c.flRow),
    height: Number(c.flHeight),
    stamp: !!c.flStamp,
    sampleSec: Number(c.flSample),
    dashSec: Number(c.flDash),
    copies: Number(c.flCopies),
    gapSec: Number(c.flGap),
    lifeSec: Number(c.flLife),
    fall: Number(c.flFall),
    ink: Number(c.flInk),
    trailInk: Number(c.flTrailInk),
    facing: c.flFacing as Facing,
    stretch: Number(c.flStretch),
    stretchKind: Number(c.flKind),
    streakSoft: Number(c.flSoft),
    slit: Number(c.flSlit),
    multiply: !!c.flMultiply,
    floor: !!c.flFloor,
  };
  return (
    <div className="absolute inset-0 bg-white">
      <Canvas camera={{ position: [10, 1.5, -6], fov: 45, near: 0.05, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor("#ffffff", 1)}>
        <Scene L={L} viewRef={viewRef} />
      </Canvas>
    </div>
  );
}
