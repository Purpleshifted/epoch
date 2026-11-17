/**
 * WHAT IS LEFT UNDER THE GROUND of the layer above the column (stage 1 of the order of 2026-11-17; the artist: "1단계
 * 진행"). The layer is what is found after the people are gone (FutureVillage.tsx, lib/parliament/futureVillage.ts),
 * and of a settlement it is what lies under the ground that is kept best: shallow buried things — sewers, pipes,
 * foundations — are out of erosion's reach, far likelier to be preserved than anything standing on the surface
 * (Zalasiewicz, Waters & Williams 2014; the cuts of foundations and drains are themselves part of the deposit:
 * Edgeworth et al. 2015 — docs/future-village-literature.md T5, T4).
 *
 * And (stage 2, the same day: "2단계 진행") WHAT A PLACE'S WHOLE OCCUPATION LEAVES IN THE GROUND: a mound where it was
 * built for long or again and again, dark earth where it was only lightly built (futureVillage.ts `deposit`).
 *
 * Each with its knob (a folder of its own, 미래 마을 층 — 땅 아래, saved like every other group):
 *  - THE BUILDINGS GO FROM THE TOP DOWN, AND THEIR FOOTINGS STAY: asked of the worker with the layer's other knobs
 *    (`futureUnder.cfg`, merged into SpaceRequest.future by the wall; the rule is SpaceModel.computeFuture's);
 *  - THE PIPES LAID UNDER THE COLUMN ARE DRAWN UNDER THE LAYER'S GROUND, every run of them, as the column draws its
 *    own: tubes, in a grey.
 *
 * A file of its own, beside FutureVillage.tsx: it reads that layer's place from its knobs instead of being drawn
 * inside it.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { levaStore, useControls } from "leva";
import * as THREE from "three";
import type { FutureConfig } from "@/lib/parliament/futureVillage";
import { CELL_SIZE } from "@/lib/stratum/field";
import { futureLink } from "./FutureVillage";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
export const futureUnder: { cfg: Pick<FutureConfig, "under" | "moundAt" | "fate" | "succession" | "soil" | "tree"> | null } = { cfg: null };

/** A number 0 … 1 of a thing's own, by two numbers. */
const rnd = (a: number, b: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const GROUP = "미래 마을 층 — 땅 아래";
/** The layer's own folder (FutureVillage.tsx): where it stands is read from there. */
const LAYER = "미래 마을 층";
const CAP = 6000;
/** The most mounds, and the most patches of dark earth, that are drawn (the world is 160 × 160 ground cells). */
const DEP_CAP = 12000;

const knob = (path: string): unknown => {
  try {
    return levaStore.get(path);
  } catch {
    return undefined;
  }
};

export function FutureUnder({ unit, top }: { unit: number; top: THREE.IUniform<number> }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      under: { value: true, label: "땅 위가 먼저 사라지고 땅 아래가 남음 (위에서부터 몸체 → 바닥판 → 보 → 기둥 · 기단은 거의 남고 지하실과 말뚝은 남음 · 끄면 기둥의 침식 순서)" },
      pipes: { value: true, label: "묻힌 관을 그림 (층의 땅 아래 · 놓였던 것 전부)" },
      depth: { value: 1, min: 0, max: 6, step: 0.25, label: "관의 깊이 (단 · 층의 땅에서 아래로)" },
      radius: { value: 0.08, min: 0.02, max: 0.4, step: 0.01, label: "관의 굵기 (월드, 반지름)" },
      color: { value: "#7c7f84", label: "관의 색 (무채색)" },
      // THE DEPOSIT (stage 2; the artist, 2026-11-17: "2단계 진행")
      mound: { value: true, label: "오래 · 거듭 지어진 자리에 잔해 둔덕 (덩어리에 남아 있는 전부에서 셈 · 오래일수록 두껍고 넓음)" },
      moundAt: { value: 12, min: 2, max: 60, step: 1, label: "둔덕이 생기는 기준 (그 칸이 지어져 있던 단 수 · 다시 지어질 때마다 절반씩 더 침)" },
      moundMax: { value: 0.6, min: 0.05, max: 3, step: 0.05, label: "둔덕의 가장 두꺼운 높이 (단)" },
      moundColor: { value: "#5b5e63", label: "둔덕의 색 (무채색)" },
      stain: { value: true, label: "가볍게 스친 자리에 어두운 흙 한 겹 (기준에 못 미치고 건물이 거의 남지 않은 칸)" },
      stainColor: { value: "#17181a", label: "어두운 흙의 색 (무채색)" },
      // LIVED IN TO THE END, OR LEFT BEFORE IT (stage 3; the artist, 2026-11-17: "3단계 진행")
      fate: { value: true, label: "끝까지 서 있던 건물은 빠진 자재가 제 발치에 쓰러져 남고 · 끝나기 전에 버려진 건물은 몸체 · 바닥판 · 보가 뜯겨 나가 기둥과 기초만 (오래전에 버려졌을수록 많이)" },
      // THE ORDER IN WHICH THE PLANTS TAKE IT (stage 4; the artist, 2026-11-17: "4단계 진행")
      succession: { value: true, label: "식생이 차지하는 순서: 풀 → 덤불 → 나무 (층이 삭을수록 · 먼저 버려진 자리 · 물가 · 관 위에서 빨리, 지붕 위에서는 늦게 · 오래 걸은 길과 관을 따라 덤불 · 나무 옆의 길은 뿌리에 갈라짐)" },
      // THE GROUND REMEMBERS WHAT IT WAS USED FOR (stage 5; the artist, 2026-11-17: "5단계 진행")
      soil: { value: true, label: "오래 쓰인 땅에는 다른 식생 (오래 · 거듭 지어졌던 자리일수록 그 몫이 크고 짙음 · 건물이 사라진 옛 자리에도 남)" },
      soilColorA: { value: "#3c6e58", label: "다른 식생의 색 1 (자연색 · 어두운 쪽)" },
      soilColorB: { value: "#86b59a", label: "다른 식생의 색 2 (자연색 · 밝은 쪽)" },
      // HOW A TREE LOOKS (the artist, 2026-11-17: "나무 비주얼이랑 사이즈 조절하는 옵션 추가하고(레바)") — FutureConfig.tree
      // THE CROWN'S SHAPES AND THEIR SHARES (the artist, 2026-11-17: "기둥모양 나무는 아예 빼버리고 모양 비율도 정할 수 있게 해줘")
      treeBall: { value: 1, min: 0, max: 10, step: 0.1, label: "나무 — 둥근 공의 비율 (세 모양의 비율만 뜻이 있음 · 셋 다 0이면 모두 공)" },
      treeCone: { value: 0, min: 0, max: 10, step: 0.1, label: "나무 — 원뿔의 비율 (침엽수 — 줄기 중간부터 뾰족하게)" },
      treeUmbrella: { value: 0, min: 0, max: 10, step: 0.1, label: "나무 — 우산의 비율 (넓고 납작한 갓)" },
      treeHeight: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 키 (줄기 높이의 배수)" },
      treeCrown: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 수관의 너비 (배수)" },
      treeStem: { value: 1, min: 0, max: 6, step: 0.1, label: "나무 — 줄기의 굵기 (배수)" },
      treeStemShare: { value: 0.1, min: 0, max: 0.6, step: 0.02, label: "나무 — 줄기에 쓰는 점의 몫" },
      treeDense: { value: 1, min: 0.2, max: 4, step: 0.1, label: "나무 — 짙기 (점 수의 배수)" },
      treeAt: { value: 1.05, min: 0.6, max: 1.8, step: 0.05, label: "나무 — 서는 문턱 (낮을수록 일찍 · 많이 · 0.6 = 덤불 없이 바로 나무)" },
      // (the artist, the same day: "나무 모양이나 사이즈 지터도 옵션 넣어줘")
      treeSizeJitter: { value: 1, min: 0, max: 3, step: 0.1, label: "나무 — 크기의 지터 (0 = 모든 나무가 같은 키 · 너비 · 1 = 지금까지처럼 · 클수록 들쭉날쭉)" },
      treeShapeJitter: { value: 0, min: 0, max: 1.5, step: 0.05, label: "나무 — 모양의 지터 (수관이 나무마다 더 길쭉하거나 납작함)" },
      // ("점 사이즈랑 지터, 밀도 지터도") — the trees' points are drawn here, apart from the other plants'
      treeDenseJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "나무 — 짙기의 지터 (나무마다 점이 많고 적은 정도)" },
      treePointSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "나무 — 점의 크기 (월드 · 다른 식생과 따로)" },
      treePointJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "나무 — 점 크기의 지터 (점마다 크고 작은 정도)" },
      // ("줄기 점 대신 다른걸로 시각화 할 방법 있는지 고민해봐") — ways to try; the first is how it was
      treeStemMode: { options: { "점 (지금까지 — 줄기에 쓰는 점의 몫)": "points", "선 하나 (발치에서 수관 속까지)": "line", "가지 뻗은 선 (줄기에서 수관 속으로 갈라짐)": "branch", "없음 (수관만)": "none" }, value: "points" as "points" | "line" | "branch" | "none", label: "나무 — 줄기를 그리는 방식" },
      treeStemColor: { value: "#8a7a5c", label: "나무 — 줄기 선의 색 (자연색 · 선으로 그릴 때)" },
    }),
    { collapsed: true },
  );
  futureUnder.cfg = useMemo(
    () => ({
      under: k.under,
      moundAt: k.moundAt,
      fate: k.fate,
      succession: k.succession,
      soil: k.soil,
      // (the stem as points only in that mode: drawn another way, none of the tree's points are spent on it)
      tree: { at: k.treeAt, height: k.treeHeight, crown: k.treeCrown, stem: k.treeStem, stemShare: k.treeStemMode === "points" ? k.treeStemShare : 0, dense: k.treeDense, weights: { ball: k.treeBall, cone: k.treeCone, umbrella: k.treeUmbrella }, sizeJitter: k.treeSizeJitter, shapeJitter: k.treeShapeJitter, denseJitter: k.treeDenseJitter, apart: true },
    }),
    [k.under, k.moundAt, k.fate, k.succession, k.soil, k.treeAt, k.treeHeight, k.treeCrown, k.treeStem, k.treeStemShare, k.treeStemMode, k.treeDense, k.treeBall, k.treeCone, k.treeUmbrella, k.treeSizeJitter, k.treeShapeJitter, k.treeDenseJitter],
  );
  // THE OTHER PLANTS (stage 5): the points of FutureResult.vegOld, as FutureVillage draws the layer's plants — the
  // same size, at the same heights — in the two colours of this folder
  const other = useRef<THREE.Points>(null);
  const drawnOther = useRef("");
  // THE TREES, DRAWN APART (the artist, 2026-11-17: "점 사이즈랑 지터 … 줄기 점 대신 다른걸로 시각화 할 방법"): their
  // points (FutureResult.vegTree) with a size of their own, each point larger or smaller by its own number; their
  // stems (treeStems), when not points, as lines — one from the foot into the crown, or one that forks into it
  const treePts = useRef<THREE.Points>(null);
  const treeLines = useRef<THREE.LineSegments>(null);
  const drawnTrees = useRef("");
  const sizedPoints = useMemo(
    () => (shader: { vertexShader: string }) => {
      shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute float psize;\nvoid main() {").replace("gl_PointSize = size;", "gl_PointSize = size * psize;");
    },
    [],
  );
  useEffect(
    () => () => {
      futureUnder.cfg = null;
    },
    [],
  );

  const mesh = useRef<THREE.InstancedMesh>(null);
  const drawn = useRef("");
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3() }), []);

  const mounds = useRef<THREE.InstancedMesh>(null);
  const stains = useRef<THREE.InstancedMesh>(null);
  const drawnDep = useRef("");
  const tone = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color(), c: new THREE.Color() }), []);

  useFrame(() => {
    const r = futureLink.result;
    const layerOn = !!r && knob(`${LAYER}.on`) !== false;
    // WHERE THE LAYER'S GROUND IS — as FutureVillage places it: above the window's top (or above the slot it was read
    // from), the gap apart
    const gap = Number(knob(`${LAYER}.gap`) ?? 8);
    const base = ((knob(`${LAYER}.anchor`) === "built" && r ? r.k + 1 : top.value) + Math.max(0, Number.isFinite(gap) ? gap : 8)) * unit;

    // THE DEPOSIT (stage 2): on the layer's ground a mound where a place was built for long or again and again — a
    // low heap, the higher and wider the longer — and a patch of dark earth where one was only lightly built
    const mm = mounds.current, sm = stains.current;
    if (mm) mm.visible = layerOn && k.mound;
    if (sm) sm.visible = layerOn && k.stain;
    if (mm && sm && r && layerOn) {
      mm.position.y = base;
      sm.position.y = base + 0.012;
      const sig = `${futureLink.version}:${k.moundMax}:${k.stainColor}:${unit}`;
      if (sig !== drawnDep.current) {
        drawnDep.current = sig;
        const { m, p, q, s } = tmp;
        q.identity();
        const ms = r.mounds ?? new Float32Array(0), ss = r.stains ?? new Float32Array(0);
        const nm = Math.min(DEP_CAP, Math.floor(ms.length / 4)), ns = Math.min(DEP_CAP, Math.floor(ss.length / 4));
        for (let i = 0; i < nm; i++) {
          // (score 1 = it has only just become a mound … 4 and more = as thick as a mound gets)
          const f = Math.min(1, (ms[i * 4 + 2] - 1) / 3), rnd = ms[i * 4 + 3];
          const rad = CELL_SIZE * (0.7 + 0.35 * rnd + 0.35 * f);
          p.set(ms[i * 4] + (rnd - 0.5) * CELL_SIZE * 0.4, 0, ms[i * 4 + 1] + (((rnd * 7.31) % 1) - 0.5) * CELL_SIZE * 0.4);
          s.set(rad, Math.max(0.01, k.moundMax * unit * (0.3 + 0.7 * f) * (0.8 + 0.4 * rnd)), rad);
          mm.setMatrixAt(i, m.compose(p, q, s));
        }
        mm.count = nm;
        mm.instanceMatrix.needsUpdate = true;
        // (the darker the longer the place was built; the lightest is the layer's own ground)
        tone.a.set("#2a2d31");
        tone.b.set(k.stainColor);
        for (let i = 0; i < ns; i++) {
          const t = Math.max(0, Math.min(1, ss[i * 4 + 2])), rnd = ss[i * 4 + 3];
          const rad = CELL_SIZE * (0.55 + 0.5 * rnd) * (0.6 + 0.4 * t);
          p.set(ss[i * 4] + (rnd - 0.5) * CELL_SIZE * 0.5, 0, ss[i * 4 + 1] + (((rnd * 5.17) % 1) - 0.5) * CELL_SIZE * 0.5);
          s.set(rad, 0.01, rad);
          sm.setMatrixAt(i, m.compose(p, q, s));
          sm.setColorAt(i, tone.c.copy(tone.a).lerp(tone.b, 0.35 + 0.65 * t));
        }
        sm.count = ns;
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
      }
    }

    const op = other.current;
    if (op) {
      op.visible = layerOn && k.soil;
      if (r && layerOn) {
        op.position.y = base + 0.04;
        const size = Number(knob(`${LAYER}.vegSize`) ?? 0.12);
        const mat = op.material as THREE.PointsMaterial;
        if (Number.isFinite(size) && mat.size !== size) mat.size = size;
        const sig = `${futureLink.version}:${k.soilColorA}:${k.soilColorB}:${unit}`;
        if (sig !== drawnOther.current) {
          drawnOther.current = sig;
          const v = r.vegOld ?? new Float32Array(0);
          const np = Math.floor(v.length / 4);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3);
          tone.a.set(k.soilColorA);
          tone.b.set(k.soilColorB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 4];
            pos[i * 3 + 1] = v[i * 4 + 1] * unit;
            pos[i * 3 + 2] = v[i * 4 + 2];
            const sh = v[i * 4 + 3];
            col[i * 3] = tone.a.r + (tone.b.r - tone.a.r) * sh;
            col[i * 3 + 1] = tone.a.g + (tone.b.g - tone.a.g) * sh;
            col[i * 3 + 2] = tone.a.b + (tone.b.b - tone.a.b) * sh;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          op.geometry.dispose();
          op.geometry = geo;
        }
      }
    }

    const tp = treePts.current, tl = treeLines.current;
    if (tp && tl) {
      const lined = k.treeStemMode === "line" || k.treeStemMode === "branch";
      tp.visible = layerOn;
      tl.visible = layerOn && lined;
      if (r && layerOn) {
        tp.position.y = base + 0.04;
        tl.position.y = base + 0.04;
        // (the layer's own two colours of plants, and this folder's two for ground that was used)
        const cA = String(knob(`${LAYER}.vegColorA`) ?? "#5f7a3a"), cB = String(knob(`${LAYER}.vegColorB`) ?? "#a9b56a");
        const sig = `${futureLink.version}:${unit}:${k.treePointJitter}:${k.treeStemMode}:${cA}:${cB}:${k.soilColorA}:${k.soilColorB}`;
        if (sig !== drawnTrees.current) {
          drawnTrees.current = sig;
          const v = r.vegTree ?? new Float32Array(0);
          const np = Math.floor(v.length / 5);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3), ps = new Float32Array(np);
          const a = new THREE.Color(cA), b = new THREE.Color(cB), oa = new THREE.Color(k.soilColorA), ob = new THREE.Color(k.soilColorB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 5];
            pos[i * 3 + 1] = v[i * 5 + 1] * unit;
            pos[i * 3 + 2] = v[i * 5 + 2];
            const sh = v[i * 5 + 3], [c0, c1] = v[i * 5 + 4] > 0.5 ? [oa, ob] : [a, b];
            col[i * 3] = c0.r + (c1.r - c0.r) * sh;
            col[i * 3 + 1] = c0.g + (c1.g - c0.g) * sh;
            col[i * 3 + 2] = c0.b + (c1.b - c0.b) * sh;
            ps[i] = Math.max(0.15, 1 + (rnd(i, 3.1) - 0.5) * 2 * k.treePointJitter);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          geo.setAttribute("psize", new THREE.BufferAttribute(ps, 1));
          tp.geometry.dispose();
          tp.geometry = geo;
          // THE STEMS AS LINES: [x, z, foot, stem, crown's radius, crown from, crown to, its own number] a tree. One
          // line: from its foot to the middle of its crown (a cone: nearly to its tip). Forking: the trunk to where
          // the crown begins, and four or five boughs from there to places inside the crown — a cone keeps its
          // trunk to the tip and sends short boughs out along it
          const st = lined ? (r.treeStems ?? new Float32Array(0)) : new Float32Array(0);
          const seg: number[] = [];
          for (let i = 0; i + 7 < st.length; i += 8) {
            const x = st[i], z = st[i + 1], foot = st[i + 2] * unit, tall = st[i + 3] * unit, R = st[i + 4], lo = st[i + 5] * unit, hi = st[i + 6] * unit, own = st[i + 7];
            const cone = lo < tall * 0.8;
            if (k.treeStemMode === "line") {
              seg.push(x, foot, z, x, foot + (cone ? lo + (hi - lo) * 0.92 : lo + (hi - lo) * 0.5), z);
              continue;
            }
            const fork = foot + (cone ? lo + (hi - lo) * 0.92 : Math.max(tall * 0.45, lo));
            seg.push(x, foot, z, x, fork, z);
            const nb = 4 + (own > 0.6 ? 1 : 0);
            for (let j = 0; j < nb; j++) {
              const th = ((j + own) / nb) * Math.PI * 2 + (rnd(i, j) - 0.5) * 0.9, f = 0.25 + 0.55 * rnd(j, i + own);
              const y1 = foot + lo + f * (hi - lo), rad = R * (cone ? 0.75 * (1 - f) : 0.45 + 0.3 * rnd(i + 2, j));
              // (a cone's bough leaves the trunk a little under its tip's height; the others leave from the fork)
              seg.push(x, cone ? y1 - (hi - lo) * 0.06 : fork, z, x + Math.cos(th) * rad, y1, z + Math.sin(th) * rad);
            }
          }
          const lg = new THREE.BufferGeometry();
          lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
          tl.geometry.dispose();
          tl.geometry = lg;
        }
      }
    }

    const im = mesh.current;
    if (!im) return;
    const on = layerOn && k.pipes;
    im.visible = on;
    if (!on || !r) return;
    // (the pipes lie `depth` slots under the layer's ground)
    im.position.y = base - k.depth * unit;
    const sig = `${futureLink.version}:${k.radius}`;
    if (sig === drawn.current) return;
    drawn.current = sig;
    // (a result of a worker started before this was written has no pipes: nothing is drawn)
    const runs = r.pipes ?? new Float32Array(0);
    const n = Math.min(CAP, Math.floor(runs.length / 4));
    const { m, p, q, s, up, d } = tmp;
    for (let i = 0; i < n; i++) {
      const ax = runs[i * 4], az = runs[i * 4 + 1], bx = runs[i * 4 + 2], bz = runs[i * 4 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      p.set((ax + bx) / 2, 0, (az + bz) / 2);
      if (len > 1e-4) q.setFromUnitVectors(up, d.set((bx - ax) / len, 0, (bz - az) / len));
      else q.identity();
      s.set(k.radius, Math.max(1e-4, len), k.radius);
      im.setMatrixAt(i, m.compose(p, q, s));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh
        ref={(im) => {
          mesh.current = im;
          if (im && !drawn.current) im.count = 0;
        }}
        args={[undefined, undefined, CAP]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color={k.color} roughness={0.9} metalness={0} />
      </instancedMesh>
      {/* the mounds: low domes on the layer's ground (a unit half-sphere, scaled a mound) */}
      <instancedMesh
        ref={(im) => {
          mounds.current = im;
          if (im && !drawnDep.current) im.count = 0;
        }}
        args={[undefined, undefined, DEP_CAP]}
        frustumCulled={false}
        receiveShadow
      >
        <sphereGeometry args={[1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={k.moundColor} roughness={1} metalness={0} />
      </instancedMesh>
      {/* the dark earth: flat discs just over the layer's ground, each with its own darkness */}
      <instancedMesh
        ref={(im) => {
          stains.current = im;
          if (im && !im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEP_CAP * 3).fill(1), 3);
          if (im && !drawnDep.current) im.count = 0;
        }}
        args={[undefined, undefined, DEP_CAP]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
      </instancedMesh>
      {/* the trees: their points, each with its own size, and their stems as lines (when the knob says so) */}
      <points ref={treePts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={k.treePointSize} sizeAttenuation onBeforeCompile={sizedPoints} customProgramCacheKey={() => "future-tree-points"} />
      </points>
      <lineSegments ref={treeLines} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color={k.treeStemColor} />
      </lineSegments>
      {/* the other plants, of ground that was built on for long (stage 5) */}
      <points ref={other} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation />
      </points>
    </>
  );
}
