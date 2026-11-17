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
import { useFrame, useThree } from "@react-three/fiber";
import { button, levaStore, useControls } from "leva";
import * as THREE from "three";
import type { FutureConfig } from "@/lib/parliament/futureVillage";
import { FUTURE_ONLY } from "@/lib/parliament/futureOnly";
import { CELL_SIZE } from "@/lib/stratum/field";
import { futureLink } from "./FutureVillage";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
export const futureUnder: { cfg: Pick<FutureConfig, "under" | "moundAt" | "fate" | "succession" | "soil" | "tree" | "water" | "ground" | "smoothRoads" | "spread" | "partShare"> | null } = { cfg: null };

/** A number 0 … 1 of a thing's own, by two numbers. */
const rnd = (a: number, b: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

type V3 = [number, number, number];
/** A tree as its stem is drawn from: its place, its foot, its stem's height, its crown's radius, from where to where
 *  above its foot the crown reaches (all world), a number of its own, and whether its crown is a cone. */
interface StemTree {
  x: number;
  z: number;
  foot: number;
  tall: number;
  R: number;
  lo: number;
  hi: number;
  own: number;
  cone: boolean;
}

/**
 * A STEM THAT GREW (the artist, 2026-11-17, of the stem that forked from one point in straight lines: "줄기 갈라지는
 * 거 좋긴 한데... 좀 더 유기물같이 안 되나...?"). Nothing of it is straight or even: THE TRUNK leans and sways as it
 * rises; THE BOUGHS leave it at heights of their own, turned round it by the golden angle (as buds stand round a
 * shoot), and ARCH — out and up, then over — to places of their own inside the crown, some long, some short; each
 * bough bears TWIGS that turn off it and bend on. A cone keeps its trunk to its tip and its boughs droop before
 * they lift. Written as line segments into `seg` ([x, y, z, x, y, z] each), and for every end how far along the
 * tree it is into `far` (0 at the foot … 1 at a twig's tip: the line fades into the crown's colour by it).
 * `bend` 0 = straight lines, 1 = as meant, more = wilder; `twigs` a bough (0 … 3).
 */
function growStem(seg: number[], far: number[], kind: number[], t: StemTree, i: number, bend: number, twigs: number): void {
  const r = (a: number) => rnd(i * 7.13 + a, t.own * 91.7 + a * 0.37);
  // (what a segment is: 0 the trunk, 1 a bough, 2 a twig — each has a thickness of its own)
  let cur = 0;
  const H = Math.max(1e-4, t.hi - t.lo);
  const line = (a: V3, b: V3, fa: number, fb: number) => {
    seg.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    far.push(fa, fb);
    kind.push(cur);
  };
  // (a curve from a to b that bows by `c` at its middle, in `n` pieces; returns its points)
  const bow = (a: V3, b: V3, c: V3, n: number, fa: number, fb: number): V3[] => {
    const pts: V3[] = [a];
    for (let q = 1; q <= n; q++) {
      const u = q / n, w = 4 * u * (1 - u);
      const p: V3 = [a[0] + (b[0] - a[0]) * u + c[0] * w, a[1] + (b[1] - a[1]) * u + c[1] * w, a[2] + (b[2] - a[2]) * u + c[2] * w];
      line(pts[q - 1], p, fa + ((fb - fa) * (q - 1)) / n, fa + ((fb - fa) * q) / n);
      pts.push(p);
    }
    return pts;
  };
  // (the crown's half-width at the share f of its height)
  const wide = (f: number) => (t.cone ? t.R * 0.95 * (1 - f) : t.R * Math.sqrt(Math.max(0.06, 1 - Math.pow(2 * f - 1, 2))));
  // THE TRUNK: to the middle of the crown (a cone: nearly to its tip), leaning one way and swaying
  const trunkH = t.lo + H * (t.cone ? 0.92 : 0.5);
  const sway = bend * 0.14 * t.R, a1 = r(1) * 6.283, a2 = r(2) * 6.283;
  const trunk = (s: number): V3 => {
    const lean = s * s * sway * 1.4, wob = Math.sin(s * 3.4 + a1) * sway * s;
    return [t.x + Math.cos(a2) * lean + Math.cos(a1 + 1.7) * wob, t.foot + s * trunkH, t.z + Math.sin(a2) * lean + Math.sin(a1 + 1.7) * wob];
  };
  const NT = 6;
  for (let q = 1; q <= NT; q++) line(trunk((q - 1) / NT), trunk(q / NT), ((q - 1) / NT) * 0.3, (q / NT) * 0.3);
  // THE BOUGHS
  const nb = 4 + Math.floor(r(3) * 3);
  for (let j = 0; j < nb; j++) {
    // (where it leaves the trunk: a cone's all the way up it, the others' from where the crown begins)
    const s0 = t.cone ? 0.28 + 0.66 * ((j + r(10 + j)) / nb) : Math.min(0.97, Math.max(0.35, t.lo / trunkH - 0.15) + (1 - Math.max(0.35, t.lo / trunkH - 0.15)) * r(10 + j));
    const S = trunk(s0);
    const th = j * 2.39996 + (r(20 + j) - 0.5) * 1.1 * Math.max(0.3, bend) + a1;
    const f = t.cone ? Math.min(0.96, Math.max(0.02, (S[1] - t.foot - t.lo) / H + 0.03 + 0.08 * r(30 + j))) : 0.22 + 0.68 * r(30 + j);
    const rad = wide(f) * (0.5 + 0.45 * r(40 + j));
    const T: V3 = [t.x + Math.cos(th) * rad, t.foot + t.lo + f * H, t.z + Math.sin(th) * rad];
    const d = Math.hypot(T[0] - S[0], T[1] - S[1], T[2] - S[2]);
    // (it bows: up — a cone's down — and to one side)
    const side = (r(50 + j) - 0.5) * 0.5 * bend * d;
    const C: V3 = [-Math.sin(th) * side, (t.cone ? -0.1 : 0.2) * bend * d, Math.cos(th) * side];
    cur = 1;
    const pts = bow(S, T, C, 5, 0.3, 0.75);
    cur = 2;
    // THE TWIGS: off the bough's outer half, turned aside, bending on
    for (let w = 0; w < twigs; w++) {
      const at = pts[Math.min(pts.length - 2, 2 + ((w + Math.floor(r(60 + j * 4 + w) * 2)) % 3))];
      const tw = th + (w % 2 ? 1 : -1) * (0.5 + 0.7 * r(70 + j * 4 + w)), len = d * (0.25 + 0.3 * r(80 + j * 4 + w));
      const E: V3 = [at[0] + Math.cos(tw) * len, at[1] + len * (t.cone ? 0.05 : 0.25 + 0.3 * r(90 + j * 4 + w)), at[2] + Math.sin(tw) * len];
      bow(at, E, [0, (t.cone ? -0.06 : 0.12) * bend * len, 0], 3, 0.6, 1);
    }
  }
}

const GROUP = "미래 마을 층 — 땅 아래";
/** The layer's own folder (FutureVillage.tsx): where it stands is read from there. */
const LAYER = "미래 마을 층";
const CAP = 6000;
const STEM_CAP = 40000;
/** The most clumps of the trees' crowns that are drawn. */
const CLUMP_CAP = 30000;
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
  // (the button: the camera goes to the layer on the next frame)
  const goTo = useRef(false);
  const k = useControls(
    GROUP,
    savable(GROUP, {
      // (the artist, 2026-11-17: "처음에 어딘지 모르겠는 이슈 있어서; 카메라 자동 찾아가기 버튼좀")
      "미래 층으로 카메라 이동": button(() => {
        goTo.current = true;
      }),
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
      // ("둔덕도 지금 썩 마음에 들진 않아서 다양한 옵션 추가해주고") — the defaults are the mound as it was
      moundShape: { options: { "반구 (지금까지)": "dome", "납작한 대 (윗면이 평평한 둔덕)": "mesa", "원뿔 더미": "cone", "각진 판 (무너진 기단처럼)": "slab" }, value: "dome" as "dome" | "mesa" | "cone" | "slab", label: "둔덕 — 모양" },
      moundWide: { value: 1, min: 0.3, max: 4, step: 0.05, label: "둔덕 — 너비 (배수)" },
      moundSizeJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 크기의 지터 (둔덕마다 크고 작은 정도)" },
      moundSquash: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 찌그러짐 (둥글지 않고 길쭉한 정도 · 제각각 돌아감)" },
      moundTiers: { value: 1, min: 1, max: 5, step: 1, label: "둔덕 — 단 (거듭 지어진 자리일수록 여러 겹으로 쌓임 · 1 = 한 덩이)" },
      moundStep: { value: 0.25, min: 0.05, max: 0.6, step: 0.05, label: "둔덕 — 단마다 줄어드는 정도", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.moundTiers`)) > 1 },
      moundScatter: { value: 0.5, min: 0, max: 2, step: 0.05, label: "둔덕 — 자리의 흐트러짐 (칸 한가운데에서 벗어나는 정도)" },
      moundTone: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 명도의 지터 (둔덕마다 밝고 어두운 정도)" },
      // ("둔덕이랑 흙 이런 건 다 점으로 하는 게 나을 것 같은데 — 사이즈랑 지터 조절 가능한!! 밀도도!!")
      depositPoints: { value: true, label: "둔덕과 어두운 흙을 점으로 (끄면 덩어리)" },
      moundPtDense: { value: 1, min: 0.1, max: 6, step: 0.1, label: "둔덕 점 — 밀도 (배수)" },
      moundPtSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "둔덕 점 — 크기 (월드)" },
      moundPtJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "둔덕 점 — 크기의 지터" },
      stainPtDense: { value: 1, min: 0.1, max: 6, step: 0.1, label: "어두운 흙 점 — 밀도 (배수)" },
      stainPtSize: { value: 0.1, min: 0.02, max: 1, step: 0.01, label: "어두운 흙 점 — 크기 (월드)" },
      stainPtJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "어두운 흙 점 — 크기의 지터" },
      // ("물길은 '비움'으로 … 그 경계에 식생이 더 빽빽하게") and ("전역에 식생이 있어야")
      waterGap: { value: 1, min: 0, max: 6, step: 1, label: "물길 — 비움 (물길에서 몇 칸까지 식생이 없음 · 0 = 비우지 않음)" },
      waterEdge: { value: 2, min: 0, max: 6, step: 1, label: "물길 — 가장자리의 빽빽한 식생 (비움 바깥 몇 칸)" },
      groundVeg: { value: 0.5, min: 0, max: 1, step: 0.05, label: "사람 없이 놔둔 땅의 숲 (권역마다 다름 · 마을 한가운데서 멀수록 짙음 · 권역 사이는 성김 · 0 = 없음)" },
      // ("전체에 흩어진 식생 '실제 추론된 식생'이랑 분리해서 껐다 켤 수 있게 해줘. 헷갈림")
      showWild: { value: true, label: "보이기 — 사람 없이 놔둔 땅의 숲 (나무 포함)" },
      showInferred: { value: true, label: "보이기 — 추론된 식생 (다녀간 곳 둘레 · 물가 · 버려진 자리)" },
      // ("건축물 부재 비중도 간단하게 조절 가능하도록 해줘") — the share of each kind of part that is kept
      shareMass: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 몸체 (mass)" },
      shareSlab: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 바닥판 (slab)" },
      shareColumn: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 기둥 (column)" },
      shareBeam: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 보 · 가새 (beam · brace)" },
      shareFoot: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 기단 · 지하실 · 말뚝" },
      shareDrip: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 늘어진 것 (drip)" },
      // ("매끄러운 선이 나음")
      smoothRoads: { value: true, label: "길 — 걷는 길의 매끄러운 선 그대로 (끄면 칸 격자)" },
      // ("퍼진 정도 조절할 수 있게 해줘, 권역별 딱딱 나뉘는 느낌에서")
      spread: { value: 0.5, min: 0, max: 3, step: 0.05, label: "퍼진 정도 (식생 · 둔덕 · 흙이 제 칸에서 벗어나는 정도 · 물길 비움의 가장자리도 부드럽게 · 0 = 칸에 딱딱)" },
      // THE WATER AS A BELT OF PLANTS ("물길은 그냥 선 말고 식생 띠로 보이게 해줘")
      waterBelt: { value: true, label: "물길을 선 대신 식생 띠로 (끄면 회색 선)" },
      waterWide: { value: 1, min: 0.3, max: 4, step: 0.05, label: "물가 식생 띠 — 너비 (배수)" },
      waterDense: { value: 1, min: 0.1, max: 4, step: 0.05, label: "물가 식생 띠 — 짙기 (배수)" },
      waterColorA: { value: "#2f7d73", label: "물가 식생의 색 1 (자연색 · 어두운 쪽)" },
      waterColorB: { value: "#7fcfb8", label: "물가 식생의 색 2 (자연색 · 밝은 쪽)" },
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
      treeStemColor: { value: "#8a7a5c", label: "나무 — 줄기의 색 (자연색 · 선으로 그릴 때 · 끝으로 갈수록 수관의 색으로 풀림)" },
      treeStemRough: { value: 1, min: 0, max: 1, step: 0.05, label: "나무 — 줄기의 거칠기 (0 = 매끈하게 빛을 받음 · 1 = 거침)" },
      treeStemThickJitter: { value: 0.3, min: 0, max: 1, step: 0.05, label: "나무 — 줄기 굵기의 지터 (나무마다 굵고 가는 정도)" },
      treeStemColorJitter: { value: 0.2, min: 0, max: 1, step: 0.05, label: "나무 — 줄기 색의 지터 (나무마다 밝고 어두운 정도)" },
      // ("나무에 쓰이는 점 느낌이 안 사는데. 이거 '현재' 층에서 건물에 모이는 식생이랑 같은 방식으로") — the crown as clumps:
      // small soft balls of points, each drawn by the GPU from one centre (as the present's gatherings are)
      treeCrownMode: { options: { "덩이 (현재 층 식생처럼 — 작은 점 뭉치들)": "clumps", "점 (지금까지)": "points" }, value: "clumps" as "clumps" | "points", label: "나무 — 수관을 그리는 방식" },
      treeClumps: { value: 7, min: 1, max: 24, step: 1, label: "나무 — 수관의 덩이 수", render: (get: (path: string) => unknown) => get(`${GROUP}.treeCrownMode`) === "clumps" },
      treeClumpSize: { value: 0.45, min: 0.1, max: 1.5, step: 0.05, label: "나무 — 덩이의 크기 (수관 반지름의 몇 배)", render: (get: (path: string) => unknown) => get(`${GROUP}.treeCrownMode`) === "clumps" },
      treeClumpJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "나무 — 덩이 크기의 지터", render: (get: (path: string) => unknown) => get(`${GROUP}.treeCrownMode`) === "clumps" },
      treeClumpPts: { value: 40, min: 6, max: 160, step: 2, label: "나무 — 덩이 하나의 점 수", render: (get: (path: string) => unknown) => get(`${GROUP}.treeCrownMode`) === "clumps" },
      treeClumpDot: { value: 0.08, min: 0.01, max: 0.5, step: 0.005, label: "나무 — 덩이 점의 크기 (월드)", render: (get: (path: string) => unknown) => get(`${GROUP}.treeCrownMode`) === "clumps" },
      // ("물가 식생 색 다르게 하는거 나무에 적용돼서 느낌이 안 삶") — the trees' own two colours, whatever ground they stand on
      treeColorA: { value: "#3f6a34", label: "나무 — 수관의 색 1 (자연색 · 아래 · 안쪽)" },
      treeColorB: { value: "#93b25e", label: "나무 — 수관의 색 2 (자연색 · 위 · 바깥)" },
      treeColorJitter: { value: 0.25, min: 0, max: 1, step: 0.05, label: "나무 — 수관 색의 지터" },
      // ("나무 기둥이랑 줄기 굵기 따로 조절할 수 있게 해") — the stem is thin cylinders, each kind its thickness
      treeTrunkR: { value: 0.035, min: 0.002, max: 0.4, step: 0.002, label: "나무 — 기둥의 굵기 (월드, 반지름)" },
      treeBoughR: { value: 0.014, min: 0.001, max: 0.2, step: 0.001, label: "나무 — 가지의 굵기 (반지름)" },
      treeTwigR: { value: 0.006, min: 0.001, max: 0.1, step: 0.001, label: "나무 — 잔가지의 굵기 (반지름)" },
      // ("줄기 갈라지는 거 좋긴 한데... 좀 더 유기물같이 안 되나...?") — the forking stem grows: growStem
      treeBend: { value: 1, min: 0, max: 2.5, step: 0.05, label: "나무 — 가지의 굽이 (가지 뻗은 선 · 0 = 곧은 선 · 클수록 휘고 기욺)" },
      treeTwigs: { value: 2, min: 0, max: 3, step: 1, label: "나무 — 잔가지 (가지 하나에 몇 개)" },
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
      water: { belt: k.waterBelt, wide: k.waterWide, dense: k.waterDense, gap: k.waterGap, edge: k.waterEdge },
      ground: { density: k.groundVeg },
      partShare: { mass: k.shareMass, slab: k.shareSlab, column: k.shareColumn, beam: k.shareBeam, brace: k.shareBeam, plinth: k.shareFoot, basement: k.shareFoot, pile: k.shareFoot, drip: k.shareDrip },
      smoothRoads: k.smoothRoads,
      spread: k.spread,
      // (the stem as points only in that mode: drawn another way, none of the tree's points are spent on it)
      tree: { at: k.treeAt, height: k.treeHeight, crown: k.treeCrown, stem: k.treeStem, stemShare: k.treeStemMode === "points" ? k.treeStemShare : 0, dense: k.treeDense, weights: { ball: k.treeBall, cone: k.treeCone, umbrella: k.treeUmbrella }, sizeJitter: k.treeSizeJitter, shapeJitter: k.treeShapeJitter, denseJitter: k.treeDenseJitter, apart: true },
    }),
    [k.under, k.moundAt, k.fate, k.succession, k.soil, k.waterBelt, k.waterWide, k.waterDense, k.waterGap, k.waterEdge, k.groundVeg, k.smoothRoads, k.spread, k.shareMass, k.shareSlab, k.shareColumn, k.shareBeam, k.shareFoot, k.shareDrip, k.treeAt, k.treeHeight, k.treeCrown, k.treeStem, k.treeStemShare, k.treeStemMode, k.treeDense, k.treeBall, k.treeCone, k.treeUmbrella, k.treeSizeJitter, k.treeShapeJitter, k.treeDenseJitter],
  );
  // THE OTHER PLANTS (stage 5): the points of FutureResult.vegOld, as FutureVillage draws the layer's plants — the
  // same size, at the same heights — in the two colours of this folder
  const other = useRef<THREE.Points>(null);
  const drawnOther = useRef("");
  // THE TREES, DRAWN APART (the artist, 2026-11-17: "점 사이즈랑 지터 … 줄기 점 대신 다른걸로 시각화 할 방법"): their
  // points (FutureResult.vegTree) with a size of their own, each point larger or smaller by its own number; their
  // stems (treeStems), when not points, as lines — one from the foot into the crown, or one that forks into it
  const treePts = useRef<THREE.Points>(null);
  const treeStemMesh = useRef<THREE.InstancedMesh>(null);
  // THE CROWN AS CLUMPS: one soft ball of points (a gaussian spread, thick at its middle) drawn once per clump by the
  // GPU from the clump's centre, radius and colour — as the present's gatherings are (ParliamentSpace cloudGeometry)
  const clumps = useRef<THREE.Points>(null);
  const clumpGeo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const n = Math.max(6, Math.round(k.treeClumpPts)), off = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const g1 = Math.sqrt(-2 * Math.log(1 - rnd(i, 0.3) * 0.999)), t1 = rnd(i, 0.7) * 6.2832, u = rnd(i, 1.1) * 2 - 1;
      const l = Math.min(1, g1 * 0.42), sq = Math.sqrt(1 - u * u);
      off[i * 3] = Math.cos(t1) * sq * l;
      off[i * 3 + 1] = u * l;
      off[i * 3 + 2] = Math.sin(t1) * sq * l;
    }
    g.setAttribute("position", new THREE.BufferAttribute(off, 3));
    g.setAttribute("iCenter", new THREE.InstancedBufferAttribute(new Float32Array(CLUMP_CAP * 4), 4));
    g.setAttribute("color", new THREE.InstancedBufferAttribute(new Float32Array(CLUMP_CAP * 3), 3));
    g.instanceCount = 0;
    return g;
  }, [k.treeClumpPts]);
  useEffect(() => () => clumpGeo.dispose(), [clumpGeo]);
  const clumpMat = useMemo(() => {
    const m = new THREE.PointsMaterial({ vertexColors: true, size: 0.08, sizeAttenuation: true });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 iCenter;")
        .replace(
          "#include <begin_vertex>",
          [
            "float hB = fract(sin(dot(iCenter.xyz, vec3(39.346, 11.135, 83.155))) * 24634.6345);",
            "float ca = cos(hB * 6.2832), sa = sin(hB * 6.2832);",
            "vec3 off = vec3(ca * position.x - sa * position.z, position.y, sa * position.x + ca * position.z);",
            "vec3 transformed = iCenter.xyz + off * iCenter.w;",
          ].join("\n"),
        )
        .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb *= 0.82 + 0.25 * position.y;");
    };
    m.customProgramCacheKey = () => "future-tree-clumps";
    return m;
  }, []);
  useEffect(() => () => clumpMat.dispose(), [clumpMat]);
  // (the wild forest's other plants: FutureResult.vegWild, in the layer's own two colours)
  const wildPts = useRef<THREE.Points>(null);
  const drawnWild = useRef("");
  const depPts = useRef<THREE.Points>(null);
  const drawnDepPts = useRef("");
  const drawnTrees = useRef("");
  // THE LAYER ALONE (/rehearsal/future, lib/parliament/futureOnly.ts): the camera is set on the layer once — looking
  // down at its ground from a side — and then left to the hand
  const three = useThree();
  const placed = useRef(false);
  // (the mound's unit shape, standing on y = 0 and 1 high: the knob's)
  const moundGeo = useMemo(() => {
    if (k.moundShape === "mesa") return new THREE.CylinderGeometry(0.78, 1, 1, 14).translate(0, 0.5, 0);
    if (k.moundShape === "cone") return new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0);
    if (k.moundShape === "slab") return new THREE.BoxGeometry(1.7, 1, 1.7).translate(0, 0.5, 0);
    return new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  }, [k.moundShape]);
  useEffect(() => () => moundGeo.dispose(), [moundGeo]);
  // (the water's belt of plants: FutureResult.vegWater, in this folder's two colours of the water's edge, at the size
  // of the layer's other plants)
  const waterPts = useRef<THREE.Points>(null);
  const drawnWater = useRef("");
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
    if (mm) mm.visible = layerOn && k.mound && !k.depositPoints;
    if (sm) sm.visible = layerOn && k.stain && !k.depositPoints;
    const dp = depPts.current;
    if (dp) {
      dp.visible = layerOn && k.depositPoints && (k.mound || k.stain);
      if (r && dp.visible) {
        dp.position.y = base + 0.02;
        const sig = `${futureLink.version}:${unit}:${k.mound}:${k.stain}:${k.moundMax}:${k.moundWide}:${k.moundColor}:${k.stainColor}:${k.moundPtDense}:${k.moundPtSize}:${k.moundPtJitter}:${k.stainPtDense}:${k.stainPtSize}:${k.stainPtJitter}:${k.moundTone}`;
        if (sig !== drawnDepPts.current) {
          drawnDepPts.current = sig;
          // A MOUND AS POINTS: a heap of them, thick at its middle and low at its rim, as high as the mound; DARK
          // EARTH as a flat scatter — every point its own size (the size knob × its jitter)
          const ms = r.mounds ?? new Float32Array(0), ss = r.stains ?? new Float32Array(0);
          const pos: number[] = [], col: number[] = [], ps: number[] = [];
          const mc = new THREE.Color(k.moundColor), sc0 = new THREE.Color("#2a2d31"), sc1 = new THREE.Color(k.stainColor);
          const CAPP = 120000;
          if (k.mound) for (let i = 0; i * 4 + 3 < ms.length && pos.length < CAPP * 3; i++) {
            const f = Math.min(1, (ms[i * 4 + 2] - 1) / 3), own = ms[i * 4 + 3];
            const rad = CELL_SIZE * (0.7 + 0.35 * own + 0.35 * f) * k.moundWide, high = k.moundMax * unit * (0.3 + 0.7 * f) * (0.8 + 0.4 * own);
            const np = Math.round((14 + 30 * f) * k.moundPtDense);
            const shade = Math.max(0.3, 1 + (rnd(own * 7, i) - 0.5) * k.moundTone);
            for (let j = 0; j < np; j++) {
              const u = rnd(i + 0.5, j), th = rnd(j, i + own) * Math.PI * 2, rr = rad * Math.sqrt(u);
              pos.push(ms[i * 4] + Math.cos(th) * rr, high * Math.sqrt(Math.max(0, 1 - u)) * rnd(j * 3, i), ms[i * 4 + 1] + Math.sin(th) * rr);
              col.push(mc.r * shade, mc.g * shade, mc.b * shade);
              ps.push((k.moundPtSize / 1) * Math.max(0.15, 1 + (rnd(i, j * 1.7) - 0.5) * 2 * k.moundPtJitter));
            }
          }
          if (k.stain) for (let i = 0; i * 4 + 3 < ss.length && pos.length < CAPP * 3; i++) {
            const t = Math.max(0, Math.min(1, ss[i * 4 + 2])), own = ss[i * 4 + 3];
            const rad = CELL_SIZE * (0.55 + 0.5 * own) * (0.6 + 0.4 * t), np = Math.round((6 + 14 * t) * k.stainPtDense);
            tone.c.copy(sc0).lerp(sc1, 0.35 + 0.65 * t);
            for (let j = 0; j < np; j++) {
              const u = rnd(i + 0.25, j), th = rnd(j + 0.5, i + own) * Math.PI * 2, rr = rad * Math.sqrt(u);
              pos.push(ss[i * 4] + Math.cos(th) * rr, 0.01 * rnd(j, i), ss[i * 4 + 1] + Math.sin(th) * rr);
              col.push(tone.c.r, tone.c.g, tone.c.b);
              ps.push(k.stainPtSize * Math.max(0.15, 1 + (rnd(i * 1.3, j) - 0.5) * 2 * k.stainPtJitter));
            }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
          geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
          geo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(ps), 1));
          dp.geometry.dispose();
          dp.geometry = geo;
        }
      }
    }
    if (mm && sm && r && layerOn && !k.depositPoints) {
      mm.position.y = base;
      sm.position.y = base + 0.012;
      const sig = `${futureLink.version}:${k.moundMax}:${k.stainColor}:${unit}:${k.moundColor}:${k.moundWide}:${k.moundSizeJitter}:${k.moundSquash}:${k.moundTiers}:${k.moundStep}:${k.moundScatter}:${k.moundTone}`;
      if (sig !== drawnDep.current) {
        drawnDep.current = sig;
        const { m, p, q, s } = tmp;
        const ms = r.mounds ?? new Float32Array(0), ss = r.stains ?? new Float32Array(0);
        const ns = Math.min(DEP_CAP, Math.floor(ss.length / 4));
        // THE MOUND'S LOOK (the artist, 2026-11-17: "둔덕도 지금 썩 마음에 들진 않아서 다양한 옵션 추가해주고") — its
        // shape is the mesh's (the knob: a dome, a flat mesa, a cone, a slab with corners); here its width, how much
        // one differs from the next in size, how far from round it is (and turned its own way), TIERS — a place built
        // again and again leaves a layer each time (Dueppen & Gallagher 2023: 지층 T6), each tier smaller, set on the
        // one under it — how far it lies from its cell's middle, and its own shade
        const tiers = Math.max(1, Math.round(k.moundTiers)), base0 = new THREE.Color(k.moundColor);
        let nm = 0;
        for (let i = 0; i * 4 + 3 < ms.length && nm < DEP_CAP; i++) {
          // (score 1 = it has only just become a mound … 4 and more = as thick as a mound gets)
          const f = Math.min(1, (ms[i * 4 + 2] - 1) / 3), own = ms[i * 4 + 3];
          const j1 = rnd(own * 53, i), j2 = rnd(i, own * 71), j3 = rnd(own * 13 + 1, i * 3);
          const size = Math.max(0.2, 1 + (j1 - 0.5) * 2 * k.moundSizeJitter);
          const rad = CELL_SIZE * (0.7 + 0.35 * own + 0.35 * f) * k.moundWide * size;
          const high = Math.max(0.01, k.moundMax * unit * (0.3 + 0.7 * f) * (0.8 + 0.4 * own) * size);
          const sq = 1 + (j2 - 0.5) * 2 * k.moundSquash * 0.8;
          const cx = ms[i * 4] + (own - 0.5) * CELL_SIZE * 0.8 * k.moundScatter, cz = ms[i * 4 + 1] + (j3 - 0.5) * CELL_SIZE * 0.8 * k.moundScatter;
          q.setFromAxisAngle(tmp.up, j3 * Math.PI);
          // (how many tiers this one has: more the higher its score, up to the knob's)
          const nt = Math.max(1, Math.min(tiers, 1 + Math.floor(f * tiers + own * 0.5)));
          const shade = 1 + (j2 - 0.5) * 2 * k.moundTone * 0.5;
          for (let t = 0; t < nt && nm < DEP_CAP; t++) {
            const sh = Math.pow(Math.max(0.2, 1 - k.moundStep), t), th = high / nt;
            p.set(cx + (rnd(i, t + 9) - 0.5) * rad * 0.25 * t * k.moundScatter, th * t, cz + (rnd(t + 4, i) - 0.5) * rad * 0.25 * t * k.moundScatter);
            s.set(rad * sh * Math.max(0.3, sq), nt > 1 ? th * 1.15 : high, (rad * sh) / Math.max(0.3, sq));
            mm.setMatrixAt(nm, m.compose(p, q, s));
            mm.setColorAt(nm, tone.c.copy(base0).multiplyScalar(Math.max(0.2, shade * (1 + t * 0.06))));
            nm++;
          }
        }
        q.identity();
        mm.count = nm;
        mm.instanceMatrix.needsUpdate = true;
        if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
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
      op.visible = layerOn && k.soil && k.showInferred;
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

    if (((FUTURE_ONLY && !placed.current) || goTo.current) && r && top.value > 0) {
      const ctl = three.controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      if (ctl) {
        placed.current = true;
        goTo.current = false;
        ctl.target.set(0, base, 0);
        three.camera.position.set(70, base + 75, 95);
        ctl.update();
      }
    }
    const wp = waterPts.current;
    if (wp) {
      wp.visible = layerOn && k.waterBelt;
      if (r && layerOn && k.waterBelt) {
        wp.position.y = base + 0.04;
        const size = Number(knob(`${LAYER}.vegSize`) ?? 0.12), mat = wp.material as THREE.PointsMaterial;
        if (Number.isFinite(size) && mat.size !== size) mat.size = size;
        const sig = `${futureLink.version}:${unit}:${k.waterColorA}:${k.waterColorB}`;
        if (sig !== drawnWater.current) {
          drawnWater.current = sig;
          const v = r.vegWater ?? new Float32Array(0), np = Math.floor(v.length / 4);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3);
          const a = new THREE.Color(k.waterColorA), b = new THREE.Color(k.waterColorB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 4];
            pos[i * 3 + 1] = v[i * 4 + 1] * unit;
            pos[i * 3 + 2] = v[i * 4 + 2];
            const sh = v[i * 4 + 3];
            col[i * 3] = a.r + (b.r - a.r) * sh;
            col[i * 3 + 1] = a.g + (b.g - a.g) * sh;
            col[i * 3 + 2] = a.b + (b.b - a.b) * sh;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          wp.geometry.dispose();
          wp.geometry = geo;
        }
      }
    }
    const wpl = wildPts.current;
    if (wpl) {
      wpl.visible = layerOn && k.showWild;
      if (r && wpl.visible) {
        wpl.position.y = base + 0.04;
        const size = Number(knob(`${LAYER}.vegSize`) ?? 0.12), mat = wpl.material as THREE.PointsMaterial;
        if (Number.isFinite(size) && mat.size !== size) mat.size = size;
        const cA = String(knob(`${LAYER}.vegColorA`) ?? "#5f7a3a"), cB = String(knob(`${LAYER}.vegColorB`) ?? "#a9b56a");
        const sig = `${futureLink.version}:${unit}:${cA}:${cB}`;
        if (sig !== drawnWild.current) {
          drawnWild.current = sig;
          const v = r.vegWild ?? new Float32Array(0), np = Math.floor(v.length / 4);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3), a = new THREE.Color(cA), b = new THREE.Color(cB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 4];
            pos[i * 3 + 1] = v[i * 4 + 1] * unit;
            pos[i * 3 + 2] = v[i * 4 + 2];
            const sh = v[i * 4 + 3];
            col[i * 3] = a.r + (b.r - a.r) * sh;
            col[i * 3 + 1] = a.g + (b.g - a.g) * sh;
            col[i * 3 + 2] = a.b + (b.b - a.b) * sh;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          wpl.geometry.dispose();
          wpl.geometry = geo;
        }
      }
    }
    // (the inferred plants are the layer's own points — FutureVillage — shown or not by this folder's knob)
    const inferred = three.scene.getObjectByName("future-veg");
    if (inferred) inferred.visible = k.showInferred;
    const tp = treePts.current, tl = treeStemMesh.current, cl = clumps.current;
    if (tp && tl && cl) {
      const lined = k.treeStemMode === "line" || k.treeStemMode === "branch";
      const asClumps = k.treeCrownMode === "clumps";
      tp.visible = layerOn && !asClumps;
      tl.visible = layerOn && lined;
      cl.visible = layerOn && asClumps;
      if (r && layerOn) {
        tp.position.y = tl.position.y = cl.position.y = base + 0.04;
        clumpMat.size = k.treeClumpDot;
        (tl.material as THREE.MeshStandardMaterial).roughness = k.treeStemRough;
        const sig = `${futureLink.version}:${unit}:${k.treePointJitter}:${k.treeStemMode}:${k.treeCrownMode}:${k.treeColorA}:${k.treeColorB}:${k.treeColorJitter}:${k.treeStemColor}:${k.treeBend}:${k.treeTwigs}:${k.treeTrunkR}:${k.treeBoughR}:${k.treeTwigR}:${k.treeStemThickJitter}:${k.treeStemColorJitter}:${k.treeClumps}:${k.treeClumpSize}:${k.treeClumpJitter}:${k.showWild}:${clumpGeo.id}`;
        if (sig !== drawnTrees.current) {
          drawnTrees.current = sig;
          const a = new THREE.Color(k.treeColorA), b = new THREE.Color(k.treeColorB);
          // THE CROWN AS POINTS (as before; the trees' own colours — the wild forest's left out when it is hidden)
          const v = r.vegTree ?? new Float32Array(0);
          const pos: number[] = [], col: number[] = [], ps: number[] = [];
          for (let i = 0; i * 5 + 4 < v.length; i++) {
            if (!k.showWild && v[i * 5 + 4] > 1.5) continue;
            pos.push(v[i * 5], v[i * 5 + 1] * unit, v[i * 5 + 2]);
            const sh = v[i * 5 + 3];
            col.push(a.r + (b.r - a.r) * sh, a.g + (b.g - a.g) * sh, a.b + (b.b - a.b) * sh);
            ps.push(Math.max(0.15, 1 + (rnd(i, 3.1) - 0.5) * 2 * k.treePointJitter));
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
          geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
          geo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(ps), 1));
          tp.geometry.dispose();
          tp.geometry = geo;
          // EACH TREE: [x, z, foot, stem, crown's radius, crown from, crown to, its own number, shape, wild] (10)
          const st = r.treeStems ?? new Float32Array(0), STRIDE = 10;
          const seg: number[] = [], far: number[] = [], kinds: number[] = [], owner: number[] = [];
          const cen = clumpGeo.getAttribute("iCenter") as THREE.InstancedBufferAttribute, ccol = clumpGeo.getAttribute("color") as THREE.InstancedBufferAttribute;
          const ca = cen.array as Float32Array, cc = ccol.array as Float32Array;
          let nc = 0;
          for (let i = 0; i + STRIDE - 1 < st.length; i += STRIDE) {
            if (!k.showWild && st[i + 9] > 0.5) continue;
            const t = i / STRIDE;
            const tr: StemTree = { x: st[i], z: st[i + 1], foot: st[i + 2] * unit, tall: st[i + 3] * unit, R: st[i + 4], lo: st[i + 5] * unit, hi: st[i + 6] * unit, own: st[i + 7], cone: st[i + 8] > 0.5 && st[i + 8] < 1.5 };
            const shape = st[i + 8];
            // (the stem)
            const before = kinds.length;
            if (k.treeStemMode === "line") {
              seg.push(tr.x, tr.foot, tr.z, tr.x, tr.foot + tr.lo + (tr.hi - tr.lo) * (tr.cone ? 0.92 : 0.5), tr.z);
              far.push(0, 0.6);
              kinds.push(0);
            } else if (k.treeStemMode === "branch") growStem(seg, far, kinds, tr, t, k.treeBend, k.treeTwigs);
            for (let q2 = before; q2 < kinds.length; q2++) owner.push(tr.own);
            // (the crown's clumps, by its shape: a ball round the crown's middle, a cone narrowing upward, an umbrella flat
            // at the top — each clump its own size, the colour lighter up and out)
            if (!asClumps) continue;
            const H = Math.max(1e-4, tr.hi - tr.lo), nClump = Math.max(1, Math.round(k.treeClumps * (shape > 1.5 ? 1.3 : 1)));
            for (let c = 0; c < nClump && nc < CLUMP_CAP; c++) {
              const u1 = rnd(t * 3.7 + c, 1.3), u2 = rnd(c * 1.9, t + 0.7), u3 = rnd(t + c * 0.31, 2.9);
              const th = u2 * 6.2832;
              let rx: number, y: number, rad: number;
              if (shape > 0.5 && shape < 1.5) {
                const f = Math.pow(u1, 0.8);
                rx = tr.R * (1 - f) * 0.65 * Math.sqrt(u3);
                y = tr.lo + f * H;
                rad = tr.R * k.treeClumpSize * (1 - f * 0.65);
              } else if (shape > 1.5) {
                rx = tr.R * 0.95 * Math.sqrt(u1);
                y = tr.hi - H * 0.25 * u3;
                rad = tr.R * k.treeClumpSize * 0.8;
              } else {
                const rr = Math.cbrt(u1), v2 = u3 * 2 - 1;
                rx = tr.R * 0.62 * rr * Math.sqrt(1 - v2 * v2);
                y = tr.lo + H * (0.5 + 0.35 * rr * v2);
                rad = tr.R * k.treeClumpSize;
              }
              rad *= Math.max(0.2, 1 + (rnd(c, t * 1.7) - 0.5) * 2 * k.treeClumpJitter);
              ca[nc * 4] = tr.x + Math.cos(th) * rx;
              ca[nc * 4 + 1] = tr.foot + y;
              ca[nc * 4 + 2] = tr.z + Math.sin(th) * rx;
              ca[nc * 4 + 3] = rad;
              const up = Math.max(0, Math.min(1, (y - tr.lo) / H * 0.7 + (rx / Math.max(1e-4, tr.R)) * 0.3));
              const jit = 1 + (rnd(t, c * 2.3) - 0.5) * 2 * k.treeColorJitter * 0.5;
              cc[nc * 3] = (a.r + (b.r - a.r) * up) * jit;
              cc[nc * 3 + 1] = (a.g + (b.g - a.g) * up) * jit;
              cc[nc * 3 + 2] = (a.b + (b.b - a.b) * up) * jit;
              nc++;
            }
          }
          cen.needsUpdate = true;
          ccol.needsUpdate = true;
          clumpGeo.instanceCount = nc;
          // THE STEM AS THIN CYLINDERS — the trunk, the boughs and the twigs each as thick as its knob says, thinning a
          // little towards the tips, each tree thicker or thinner and lighter or darker by its own number; the colour
          // from the stem's at the foot into the crown's
          const sc = new THREE.Color(k.treeStemColor), { m, p, q, s: sv, up, d } = tmp;
          const n = Math.min(STEM_CAP, Math.floor(seg.length / 6));
          for (let i = 0; i < n; i++) {
            const ax = seg[i * 6], ay = seg[i * 6 + 1], az = seg[i * 6 + 2], bx = seg[i * 6 + 3], by = seg[i * 6 + 4], bz = seg[i * 6 + 5];
            const len = Math.hypot(bx - ax, by - ay, bz - az);
            p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
            if (len > 1e-5) q.setFromUnitVectors(up, d.set((bx - ax) / len, (by - ay) / len, (bz - az) / len));
            else q.identity();
            const f = (far[i * 2] + far[i * 2 + 1]) / 2, kd = kinds[i], own = owner[i] ?? 0.5;
            const thick = Math.max(0.2, 1 + (rnd(own * 97, 5.3) - 0.5) * 2 * k.treeStemThickJitter);
            const rr = (kd === 0 ? k.treeTrunkR : kd === 1 ? k.treeBoughR : k.treeTwigR) * (1 - 0.45 * f) * thick;
            sv.set(rr, Math.max(1e-4, len * 1.04), rr);
            tl.setMatrixAt(i, m.compose(p, q, sv));
            const w = Math.pow(f, 1.5) * 0.6, lum = Math.max(0.2, 1 + (rnd(own * 53, 9.1) - 0.5) * 2 * k.treeStemColorJitter * 0.6);
            tl.setColorAt(i, tone.c.set((sc.r + (a.r - sc.r) * w) * lum, (sc.g + (a.g - sc.g) * w) * lum, (sc.b + (a.b - sc.b) * w) * lum));
          }
          tl.count = n;
          tl.instanceMatrix.needsUpdate = true;
          if (tl.instanceColor) tl.instanceColor.needsUpdate = true;
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
      {/* the water's belt of plants (stage: "물길은 … 식생 띠로") */}
      <points ref={waterPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation />
      </points>
      {/* the mounds on the layer's ground: a unit shape standing on y = 0 (the knob's), scaled a mound, a tier */}
      <instancedMesh
        ref={(im) => {
          mounds.current = im;
          if (im && !im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEP_CAP * 3).fill(1), 3);
          if (im && !drawnDep.current) im.count = 0;
        }}
        args={[undefined, undefined, DEP_CAP]}
        geometry={moundGeo}
        frustumCulled={false}
        receiveShadow
      >
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
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
      <instancedMesh
        ref={(im) => {
          treeStemMesh.current = im;
          if (im && !im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STEM_CAP * 3).fill(1), 3);
          if (im && !drawnTrees.current) im.count = 0;
        }}
        args={[undefined, undefined, STEM_CAP]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
      </instancedMesh>
      <points ref={clumps} geometry={clumpGeo} material={clumpMat} frustumCulled={false} />
      <points ref={wildPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation />
      </points>
      {/* the mounds and the dark earth as points (the knob depositPoints), each point with its own size */}
      <points ref={depPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={sizedPoints} customProgramCacheKey={() => "future-tree-points"} />
      </points>
      {/* the other plants, of ground that was built on for long (stage 5) */}
      <points ref={other} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation />
      </points>
    </>
  );
}
