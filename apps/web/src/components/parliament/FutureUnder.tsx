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
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { markSpan } from "./usePerfMeter";
import { button, folder, levaStore, useControls } from "leva";
import * as THREE from "three";
import type { FutureConfig } from "@/lib/parliament/futureVillage";
import { futureOnly } from "@/lib/parliament/futureOnly";
import { plantTone, tone as plantColor } from "@/lib/parliament/plantTone";
import { CELL_SIZE } from "@/lib/stratum/field";
import { futureLink } from "./FutureVillage";
import { edgeFade, futureEdgeU, futureLifeU, futureTicker, recSum, setFutureRender, lifeDissolve, lifePoints, liveAndFading, newKeyedLife, placeKey, setLifeAttr } from "./futureLife";
import { newPlantLife, plantBaseGeometry, plantMaterial, setFlowerBloom, setPlantClouds } from "./plantCloudsGpu";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
export const futureUnder: { cfg: Pick<FutureConfig, "under" | "moundAt" | "fate" | "succession" | "soil" | "tree" | "water" | "ground" | "smoothRoads" | "spread" | "partShare" | "last" | "strip" | "stones" | "grass" | "scrub" | "cover"> | null } = { cfg: null };

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
function growStem(seg: number[], far: number[], kind: number[], t: StemTree, i: number, bend: number, twigs: number, roots = 0): void {
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
  // (six pieces, as it was — the artist chose fewer trees instead: 나무 — 수; every tree's trunk is still drawn first)
  const NT = 6;
  for (let q = 1; q <= NT; q++) line(trunk((q - 1) / NT), trunk(q / NT), ((q - 1) / NT) * 0.3, (q / NT) * 0.3);
  // ROOTS (the artist, 2026-11-18: "나무 아래 돌이나 흙, 덤불, 뿌리도 (특히 큰 나무는) 있어야 자연스러울 듯"): a big
  // tree's foot spreads — buttresses leave the trunk a little above the ground, arch out over it and go into it,
  // turned round the trunk by the golden angle, some long, some short (they come with the trunk: kind 0)
  for (let j = 0; j < roots; j++) {
    const th = j * 2.39996 + (r(200 + j) - 0.5) * 1.3 + a1, L = t.R * (0.3 + 0.35 * r(210 + j));
    const S = trunk(0.01);
    S[1] = t.foot + trunkH * (0.025 + 0.04 * r(230 + j));
    const E: V3 = [t.x + Math.cos(th) * L, t.foot - trunkH * 0.015, t.z + Math.sin(th) * L];
    bow(S, E, [0, 0.05 * L, 0], 3, 0.12, 0.62);
  }
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
    // (NO BOUGH ENDS IN A STUMP — the artist, 2026-11-18: "줄기 끝은 무조건 잔가지로 갈라지게 하거나 굵기 좀 줄이면 안 돼?
    // 막대기 같아서": its tip forks into two short twigs, whatever the twigs knob)
    fork(pts[pts.length - 1], th, d * 0.22, 100 + j * 3);
  }
  // (…and the trunk's top forks into three)
  {
    cur = 2;
    const top = trunk(1);
    for (let w = 0; w < 3; w++) fork(top, a1 + w * 2.0944, t.R * 0.35, 150 + w * 5, 1);
  }
  function fork(at: V3, th: number, len: number, salt: number, n = 2): void {
    cur = 2;
    for (let w = 0; w < n; w++) {
      const tw = th + (n === 1 ? (r(salt) - 0.5) * 0.8 : (w ? 1 : -1) * (0.35 + 0.4 * r(salt + w))), l = len * (0.7 + 0.6 * r(salt + 2 + w));
      const E: V3 = [at[0] + Math.cos(tw) * l, at[1] + l * (t.cone ? 0.1 : 0.45 + 0.3 * r(salt + 4 + w)), at[2] + Math.sin(tw) * l];
      bow(at, E, [0, (t.cone ? -0.04 : 0.08) * bend * l, 0], 2, 0.8, 1);
    }
  }
}

const GROUP = "미래 마을 층 — 땅 아래";

/** A tree as grown and laid out once (FutureUnder's tree cache): its pieces' kinds and matrices, its stem's lightness,
 *  its leaves' points. */
interface TreeGrown {
  kinds: Uint8Array;
  mat: Float32Array;
  lum: number;
  lp: Float32Array;
  lc: Float32Array;
  lz: Float32Array;
}
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
  // (the screenshot button: set once the canvas is known)
  const shoot = useRef<(() => void) | null>(null);
  // THE SCREENSHOT, WHERE IT IS SEEN (the artist, 2026-11-18: "스샷버튼은 언제 넣어줄래" — it was inside 보기, folded up):
  // a group of its own, open, at the top of the view of the layer alone
  useControls(
    "미래 마을 층 — 스크린샷",
    {
      // THE LAYER ON AND OFF, WHERE IT IS SEEN (the artist, 2026-11-18: "미래 모습 껐다 켜는 옵션 추가해줘"): the layer's
      // own switch (미래 마을 층 › 켜기 — it also stops the layer being worked out) was the first knob of a folded
      // folder; this button turns that same switch
      "미래 모습 켜기 / 끄기": button(() => {
        try {
          levaStore.setValueAtPath(`${LAYER}.on`, knob(`${LAYER}.on`) === false, true);
        } catch {
          // (the layer's folder is not there: nothing to switch)
        }
      }),
      "스크린샷 (PNG로 저장)": button(() => shoot.current?.()),
      "미래 층으로 카메라 이동": button(() => {
        goTo.current = true;
      }),
    },
    { collapsed: false, order: -10 },
  );
  const k = useControls(
    GROUP,
    savable(GROUP, {
      "보기": folder(
        {
          // (the artist, 2026-11-17: "처음에 어딘지 모르겠는 이슈 있어서; 카메라 자동 찾아가기 버튼좀")
          "미래 층으로 카메라 이동": button(() => {
            goTo.current = true;
          }),
          // ("미래 뷰에도 스크린샷 버튼 넣고") — the canvas as it is now, saved as a PNG
          "스크린샷 (PNG로 저장)": button(() => shoot.current?.()),
          // WALKING ON THE LAYER (the artist, 2026-11-18: "워크인뷰 모드 토글도 가능하면 추가"): the eye on the layer's ground
          // — W A S D (or the arrows) to walk, Shift to run, drag to look round; off: back to turning round the layer
          walk: { value: false, label: "걷기 모드 (W A S D · 방향키로 걷기 · Shift 달리기 · 끌어서 둘러보기)" },
          walkSpeed: { value: 4, min: 0.5, max: 30, step: 0.5, label: "걷기 — 빠르기 (월드 / 초)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.보기.walk`) },
          walkEye: { value: 0.9, min: 0.1, max: 10, step: 0.05, label: "걷기 — 눈높이 (월드 · 땅에서)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.보기.walk`) },
          // ("미래뷰 식생점에 lod 추가하면 비용 덜 드는지"): the plants' points thin with distance, each the bigger
          // (step 3 of re-laying only what changed: what comes grows in, what goes fades — "더 자연스러워 보일 방법")
          // ("건물이 막 서서히 나타날 이유는 없음, 티커로 차자자작 지어지는 느낌이면 되는데. 나무도 그렇고", 2026-11-18)
          // (the screen's two dearest passes, in this view alone — futureLife.ts FutureRender: off = 13.7 → 51 fps measured)
          renderAo: { value: false, label: "AO (그늘 패스 · 미래 뷰에서만 · 켜면 가장 무거움)" },
          renderShadows: { value: false, label: "해 그림자 (미래 뷰에서만 · 켜면 무거움)" },
          ticker: { value: 3, min: 0, max: 12, step: 0.5, label: "건물 · 나무가 바뀌는 차례가 다 도는 시간 (초 · 하나씩 탁탁 붙고 떨어짐 · 0 = 한꺼번에)" },
          // ("미래에서 멀리서 바라봤을 때 … 경계가 잘려있는 게 마음에 안 들어, 그라데이션으로 요소들이 사라지면", 2026-11-22)
          edgeFade: { value: 14, min: 0, max: 60, step: 1, label: "층의 가장자리에서 서서히 사라짐 (칸 · 가장자리 안쪽 이만큼에 걸쳐 성글어짐 · 0 = 잘린 그대로)" },
          lifeGrow: { value: 8, min: 0, max: 60, step: 0.5, label: "식생이 새로 나타나는 데 걸리는 시간 (초 · 점이 하나씩 · 0 = 곧바로)" },
          lifeFade: { value: 8, min: 0, max: 60, step: 0.5, label: "식생이 사라지는 데 걸리는 시간 (초 · 0 = 곧바로)" },
          lod: { value: 0.6, min: 0, max: 0.95, step: 0.05, label: "식생 점 LOD — 먼 곳에서 줄이는 몫 (0 = 끔 · 먼 점일수록 크게 그려 덮임은 유지)" },
          lodNear: { value: 30, min: 2, max: 200, step: 1, label: "식생 점 LOD — 줄이기 시작하는 거리 (월드)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.보기.lod`)) > 0 },
          lodFar: { value: 140, min: 10, max: 600, step: 5, label: "식생 점 LOD — 가장 많이 줄이는 거리 (월드)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.보기.lod`)) > 0 },
          showInferred: { value: true, label: "보이기 — 추론된 식생 (다녀간 곳 둘레 · 물가 · 버려진 자리)" },
          // ("전체에 흩어진 식생 '실제 추론된 식생'이랑 분리해서 껐다 켤 수 있게 해줘. 헷갈림")
          showWild: { value: true, label: "보이기 — 사람 없이 놔둔 땅의 숲 (나무 포함)" },
        },
        { collapsed: true },
      ),
      // THE RUINS' COVER (the artist, 2026-11-18: "건물 잔해에 식생 덮이는 거")
      "잔해를 덮는 식생": folder(
        {
          cover: { value: 0.6, min: 0, max: 1, step: 0.05, label: "덮인 잔해의 몫 (남은 부재 중 덩굴 · 이끼가 오른 것 · 오래 버려진 건물일수록 많음 · 0 = 없음)" },
          coverDense: { value: 1, min: 0.1, max: 3, step: 0.05, label: "덮개 — 짙기 (점 수의 배수)" },
          coverHigh: { value: 0.6, min: 0, max: 2, step: 0.05, label: "덮개 — 아래에 몰린 정도 (0 = 고르게 · 클수록 밑동에 짙고 위는 성김)" },
          coverOff: { value: 1, min: 0, max: 4, step: 0.1, label: "덮개 — 면에서 떠 있는 정도 (늘어진 덩굴)" },
          coverDot: { value: 0.07, min: 0.01, max: 0.4, step: 0.005, label: "덮개 — 점의 크기 (월드)" },
          coverColorA: { value: "#3f5a2c", label: "덮개 — 색 1 (자연색 · 그늘진 이끼)" },
          coverColorB: { value: "#7d9a46", label: "덮개 — 색 2 (자연색 · 덩굴 잎)" },
        },
        { collapsed: true },
      ),
      "건물": folder(
        {
          under: { value: true, label: "땅 위가 먼저 사라지고 땅 아래가 남음 (위에서부터 몸체 → 바닥판 → 보 → 기둥 · 기단은 거의 남고 지하실과 말뚝은 남음 · 끄면 기둥의 침식 순서)" },
          // LIVED IN TO THE END, OR LEFT BEFORE IT (stage 3; the artist, 2026-11-17: "3단계 진행")
          fate: { value: true, label: "끝까지 서 있던 건물은 빠진 자재가 제 발치에 쓰러져 남고 · 끝나기 전에 버려진 건물은 몸체 · 바닥판 · 보가 뜯겨 나가 기둥과 기초만 (오래전에 버려졌을수록 많이)" },
          // ("건물 부재 왜 땅 위로는...? 안 올라오는 거야")
          strip: { value: 0.4, min: 0, max: 1, step: 0.05, label: "먼저 버려진 건물이 뜯긴 정도 (0 = 안 뜯김 · 1 = 몸체 · 바닥판 · 보가 다 뜯겨 기초만)" },
          // ("철골이랑 말뚝만 관리하는 것도 추가해줘. 걔들은 오래 남을 것 같아서")
          lastSteel: { value: 0.6, min: 0, max: 1, step: 0.05, label: "오래 남음 — 철골 (기둥 · 보 · 가새가 삭음과 뜯김을 버티는 정도 · 1 = 다른 것이 다 사라져도 섬)" },
          lastPile: { value: 0.8, min: 0, max: 1, step: 0.05, label: "오래 남음 — 말뚝 (1 = 끝까지 남음)" },
          // ("건축물 부재 비중도 간단하게 조절 가능하도록 해줘") — the share of each kind of part that is kept
          shareMass: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 몸체 (mass)" },
          shareSlab: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 바닥판 (slab)" },
          shareColumn: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 기둥 (column)" },
          shareBeam: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 보 · 가새 (beam · brace)" },
          shareFoot: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 기단 · 지하실 · 말뚝" },
          sharePile: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 말뚝 (기단 · 지하실과 따로)" },
          shareDrip: { value: 1, min: 0, max: 1, step: 0.05, label: "부재 비중 — 늘어진 것 (drip)" },
        },
        { collapsed: true },
      ),
      "식생": folder(
        {
          // ("나무랑 식생 다채로웠으면", "지금 식생 색도 죽어있어서;;") — every plant of the layer: plantTone.ts
          plantVivid: { value: 1.6, min: 0.3, max: 3, step: 0.05, label: "식생 색 — 채도 (1 = 그대로 · 클수록 생생함)" },
          plantLight: { value: 1.15, min: 0.5, max: 1.8, step: 0.05, label: "식생 색 — 밝기" },
          plantHue: { value: 0.5, min: 0, max: 2, step: 0.05, label: "식생 색 — 색상의 흩어짐 (점마다 노랑 쪽 · 파랑 쪽으로 벗어나는 정도)" },
          groundVeg: { value: 0.5, min: 0, max: 1, step: 0.05, label: "사람 없이 놔둔 땅의 숲 (권역마다 다름 · 마을 한가운데서 멀수록 짙음 · 권역 사이는 성김 · 0 = 없음)" },
          // ("퍼진 정도 조절할 수 있게 해줘, 권역별 딱딱 나뉘는 느낌에서")
          spread: { value: 0.5, min: 0, max: 3, step: 0.05, label: "퍼진 정도 (식생 · 둔덕 · 흙이 제 칸에서 벗어나는 정도 · 물길 비움의 가장자리도 부드럽게 · 0 = 칸에 딱딱)" },
          // THE ORDER IN WHICH THE PLANTS TAKE IT (stage 4; the artist, 2026-11-17: "4단계 진행")
          succession: { value: true, label: "식생이 차지하는 순서: 풀 → 덤불 → 나무 (층이 삭을수록 · 먼저 버려진 자리 · 물가 · 관 위에서 빨리, 지붕 위에서는 늦게 · 오래 걸은 길과 관을 따라 덤불 · 나무 옆의 길은 뿌리에 갈라짐)" },
          // THE GROUND REMEMBERS WHAT IT WAS USED FOR (stage 5; the artist, 2026-11-17: "5단계 진행")
          soil: { value: true, label: "오래 쓰인 땅에는 다른 식생 (오래 · 거듭 지어졌던 자리일수록 그 몫이 크고 짙음 · 건물이 사라진 옛 자리에도 남)" },
          soilColorA: { value: "#3c6e58", label: "다른 식생의 색 1 (자연색 · 어두운 쪽)" },
          soilColorB: { value: "#86b59a", label: "다른 식생의 색 2 (자연색 · 밝은 쪽)" },
        },
        { collapsed: true },
      ),
      // ("덤불에서 나무 되는 … 요소별 레바 다 따로") — grass and scrub, each its own look
      "풀": folder(
        {
          grassWide: { value: 1, min: 0.2, max: 4, step: 0.05, label: "풀 — 너비 (배수)" },
          grassHigh: { value: 1, min: 0.1, max: 5, step: 0.05, label: "풀 — 높이 (배수)" },
          grassDense: { value: 1, min: 0.1, max: 5, step: 0.05, label: "풀 — 짙기 (점 수의 배수)" },
          grassFlat: { value: 0.5, min: 0, max: 1, step: 0.05, label: "풀 — 납작함 (0 = 가운데 볼록 · 1 = 깔린 깔개)" },
          grassJitter: { value: 0.3, min: 0, max: 1, step: 0.05, label: "풀 — 크기의 지터" },
          // ("덤불은 따로 조정 가능해야함(색상도)") — grass and scrub each drawn with their own colours
          grassColorA: { value: "#6f9a3c", label: "풀 — 색 1 (자연색 · 안쪽 · 아래)" },
          grassColorB: { value: "#c3d46a", label: "풀 — 색 2 (자연색 · 바깥 · 위)" },
          grassDot: { value: 0.1, min: 0.02, max: 0.6, step: 0.01, label: "풀 — 점의 크기 (월드)" },
          grassDotJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "풀 — 점 크기의 지터" },
        },
        { collapsed: true },
      ),
      "덤불": folder(
        {
          scrubAt: { value: 0.6, min: 0.05, max: 1.5, step: 0.05, label: "덤불 — 풀에서 덤불이 되는 문턱 (낮을수록 일찍 · 많이 · 나무가 되는 문턱은 나무 › 서는 문턱)" },
          scrubWide: { value: 1, min: 0.2, max: 4, step: 0.05, label: "덤불 — 너비 (배수)" },
          scrubHigh: { value: 1, min: 0.1, max: 5, step: 0.05, label: "덤불 — 높이 (배수)" },
          scrubDense: { value: 1, min: 0.1, max: 5, step: 0.05, label: "덤불 — 짙기 (점 수의 배수)" },
          scrubFlat: { value: 0, min: 0, max: 1, step: 0.05, label: "덤불 — 퍼짐 (0 = 둥근 더미 · 1 = 낮게 흩어진 덤불)" },
          scrubJitter: { value: 0.3, min: 0, max: 1, step: 0.05, label: "덤불 — 크기의 지터" },
          scrubColorA: { value: "#3e6b3a", label: "덤불 — 색 1 (자연색 · 안쪽 · 아래)" },
          scrubColorB: { value: "#8fae55", label: "덤불 — 색 2 (자연색 · 바깥 · 위)" },
          scrubDot: { value: 0.13, min: 0.02, max: 0.6, step: 0.01, label: "덤불 — 점의 크기 (월드)" },
          scrubDotJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "덤불 — 점 크기의 지터" },
        },
        { collapsed: true },
      ),
      // FLOWERS (the artist chose rules 1 and 4, 2026-11-17): most where grass meets scrub, white on long-used ground
      "꽃": folder(
        {
          flowerAmount: { value: 0.35, min: 0, max: 1, step: 0.01, label: "꽃 — 양 (풀과 덤불이 만나는 단계에서 가장 많음 · 숲이 닫히면 없음)" },
          flowerWhite: { value: 0.8, min: 0, max: 1, step: 0.05, label: "꽃 — 오래 쓰인 땅에서 흰 꽃으로 모이는 정도" },
          flowerDot: { value: 1.4, min: 0.3, max: 4, step: 0.05, label: "꽃 — 점 크기 (식물 점의 배수)" },
          flowerColor1: { value: "#f3f1e7", label: "꽃 — 색 1 (흰색 · 오래 쓰인 땅의 꽃)" },
          flowerColor2: { value: "#e8c547", label: "꽃 — 색 2" },
          flowerColor3: { value: "#e7a7c0", label: "꽃 — 색 3" },
          flowerColor4: { value: "#9a7fd0", label: "꽃 — 색 4" },
          // THE FLOWERS' GLOW ("꽃에 selective bloom 이나 glow 적용 가능?"): each flower a soft spot of added light, larger
          // than its dot — only the flowers, and no pass over the whole screen
          flowerGlow: { value: 0.3, min: 0, max: 3, step: 0.02, label: "꽃 — 빛 번짐의 세기 (0 = 없음 · 꽃에만)" },
          flowerGlowSize: { value: 6, min: 1, max: 24, step: 0.5, label: "꽃 — 빛 번짐의 크기 (꽃 점의 배수)" },
          // (a real bloom pass: "아직도 블룸패스... 빛나는 느낌이 잘 안 느껴짐")
          flowerBloom: { value: 0.5, min: 0, max: 5, step: 0.05, label: "꽃 — 블룸의 세기 (화면에 번지는 빛 · 0 = 끔 · 꽃만 밝게 그려 꽃만 번짐)" },
          flowerBloomBright: { value: 1.8, min: 1, max: 10, step: 0.1, label: "꽃 — 블룸에서 꽃의 밝기 (흰색의 몇 배 · 문턱을 넘는 만큼 번짐)" },
          flowerBloomThreshold: { value: 1.1, min: 0.3, max: 4, step: 0.05, label: "꽃 — 블룸의 문턱 (이보다 밝은 것만 번짐 · 낮추면 건물 등도 번짐)" },
          flowerBloomRadius: { value: 0.65, min: 0, max: 1, step: 0.05, label: "꽃 — 블룸이 퍼지는 넓이" },
          flowerBloomWall: { value: false, label: "꽃 — 블룸을 전시 벽에서도 (끄면 미래 뷰에서만 · 화면 전체에 한 번 더 그리는 비용)" },
          flowerGlowFall: { value: 2, min: 0.2, max: 8, step: 0.1, label: "꽃 — 빛 번짐이 가장자리로 옅어지는 정도 (클수록 가운데만)" },
        },
        { collapsed: true },
      ),
      "나무": folder(
        {
          // HOW A TREE LOOKS (the artist, 2026-11-17: "나무 비주얼이랑 사이즈 조절하는 옵션 추가하고(레바)") — FutureConfig.tree
          // THE CROWN'S SHAPES AND THEIR SHARES (the artist, 2026-11-17: "기둥모양 나무는 아예 빼버리고 모양 비율도 정할 수 있게 해줘")
          treeBall: { value: 1, min: 0, max: 10, step: 0.1, label: "나무 — 둥근 공의 비율 (세 모양의 비율만 뜻이 있음 · 셋 다 0이면 모두 공)" },
          treeCone: { value: 0, min: 0, max: 10, step: 0.1, label: "나무 — 원뿔의 비율 (침엽수 — 줄기 중간부터 뾰족하게)" },
          treeUmbrella: { value: 0, min: 0, max: 10, step: 0.1, label: "나무 — 우산의 비율 (넓고 납작한 갓)" },
          treeHeight: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 키 (줄기 높이의 배수)" },
          treeCrown: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 수관의 너비 (배수)" },
          treeStem: { value: 1, min: 0, max: 6, step: 0.1, label: "나무 — 줄기의 굵기 (배수)" },
          treeStemShare: { value: 0.1, min: 0, max: 0.6, step: 0.02, label: "나무 — 줄기에 쓰는 점의 몫", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeStemMode`) === "points" },
          treeDense: { value: 1, min: 0.2, max: 4, step: 0.1, label: "나무 — 짙기 (점 수의 배수)" },
          // (the artist, 2026-11-17: "걍 나무 수를 줄이고 원래 조각대로 가지 그리는 게 나을 것 같은데")
          treeShare: { value: 0.4, min: 0, max: 1, step: 0.05, label: "나무 — 수 (나무가 설 자리 중 실제로 서는 몫 · 나머지는 덤불 · 1 = 전부)" },
          treeAt: { value: 1.05, min: 0.6, max: 1.8, step: 0.05, label: "나무 — 서는 문턱 (낮을수록 일찍 · 많이 · 0.6 = 덤불 없이 바로 나무)" },
          // (the artist, the same day: "나무 모양이나 사이즈 지터도 옵션 넣어줘")
          treeSizeJitter: { value: 1, min: 0, max: 3, step: 0.1, label: "나무 — 크기의 지터 (0 = 모든 나무가 같은 키 · 너비 · 1 = 지금까지처럼 · 클수록 들쭉날쭉)" },
          treeShapeJitter: { value: 0, min: 0, max: 1.5, step: 0.05, label: "나무 — 모양의 지터 (수관이 나무마다 더 길쭉하거나 납작함)" },
          // ("점 사이즈랑 지터, 밀도 지터도") — the trees' points are drawn here, apart from the other plants'
          treeDenseJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "나무 — 짙기의 지터 (나무마다 점이 많고 적은 정도)" },
          treePointSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "나무 — 점의 크기 (월드 · 다른 식생과 따로)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) !== "clumps" },
          treePointJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "나무 — 점 크기의 지터 (점마다 크고 작은 정도)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) !== "clumps" },
          // ("줄기 점 대신 다른걸로 시각화 할 방법 있는지 고민해봐") — ways to try; the first is how it was
          treeStemMode: { options: { "점 (지금까지 — 줄기에 쓰는 점의 몫)": "points", "선 하나 (발치에서 수관 속까지)": "line", "가지 뻗은 선 (줄기에서 수관 속으로 갈라짐)": "branch", "없음 (수관만)": "none" }, value: "points" as "points" | "line" | "branch" | "none", label: "나무 — 줄기를 그리는 방식" },
          treeStemColor: { value: "#8a7a5c", label: "나무 — 줄기의 색 (자연색 · 선으로 그릴 때 · 끝으로 갈수록 수관의 색으로 풀림)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeStemRough: { value: 1, min: 0, max: 1, step: 0.05, label: "나무 — 줄기의 거칠기 (0 = 매끈하게 빛을 받음 · 1 = 거침)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeStemThickJitter: { value: 0.3, min: 0, max: 1, step: 0.05, label: "나무 — 줄기 굵기의 지터 (나무마다 굵고 가는 정도)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeStemColorJitter: { value: 0.8, min: 0, max: 2, step: 0.05, label: "나무 — 줄기 명암의 지터 (나무마다 · 가지마다 밝고 어두운 정도 · 1 = 거의 검은 것부터 두 배 밝은 것까지)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          // ("나무에 쓰이는 점 느낌이 안 사는데. 이거 '현재' 층에서 건물에 모이는 식생이랑 같은 방식으로") — the crown as clumps:
          // small soft balls of points, each drawn by the GPU from one centre (as the present's gatherings are)
          treeCrownMode: { options: { "잎 (가지에 붙은 점 — 가볍고 줄기와 이어짐)": "leaves", "덩이 (현재 층 식생처럼 — 작은 점 뭉치들)": "clumps", "점 (지금까지)": "points" }, value: "clumps" as "leaves" | "clumps" | "points", label: "나무 — 수관을 그리는 방식" },
          treeClumps: { value: 7, min: 1, max: 24, step: 1, label: "나무 — 수관의 덩이 수", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeClumpSize: { value: 0.45, min: 0.1, max: 1.5, step: 0.05, label: "나무 — 덩이의 크기 (수관 반지름의 몇 배)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeClumpJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "나무 — 덩이 크기의 지터", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeClumpPts: { value: 40, min: 6, max: 160, step: 2, label: "나무 — 덩이 하나의 점 수", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeClumpDot: { value: 0.08, min: 0.01, max: 0.5, step: 0.005, label: "나무 — 덩이 점의 크기 (월드)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          // ("어떻게 하면 자연스럽게 줄기에 붙은 잎 느낌 낼 수 있을지") — the leaves on the twigs; their dot is 나무 — 점의 크기
          // ("'큰'나무 옆에는 작은 나무 거리 두고 자라지 않나?") — young trees in a ring outside a big one's crown
          treeKin: { value: 3, min: 0, max: 10, step: 1, label: "나무 — 큰 나무 둘레의 어린 나무 수 (수관 밖에 거리를 두고 · 0 = 없음)" },
          treeKinFar: { value: 2.2, min: 1, max: 6, step: 0.1, label: "나무 — 어린 나무까지의 거리 (큰 나무 수관 반지름의 몇 배)" },
          // ("큰 나무 근처로 잎 몰아주기랑 … 밀집지역에 몰아주기 인터폴레이션도"; "나무 밑에 덤불이나 풀 없어도 좀 어색한듯")
          // (the artist, 2026-11-18: "큰 나무면 점도 많아야 자연스러울 듯": its clumps — so its points — by its crown's size)
          treeDotsBySize: { value: 0.7, min: 0, max: 2, step: 0.05, label: "나무 — 큰 나무일수록 점이 많음 (크기에 비례하는 정도 · 0 = 크기와 무관 · 1 = 수관 크기에 그대로 비례)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeGather: { value: 0.7, min: 0, max: 2, step: 0.05, label: "나무 — 큰 나무에 덩이 몰아주기 (0 = 모든 나무 같은 수 · 클수록 큰 나무는 짙고 작은 나무는 성김)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeCrowd: { value: 0.6, min: 0, max: 2, step: 0.05, label: "나무 — 빽빽한 숲일수록 수관이 크고 짙음 (이웃 나무 수로 보간 · 숲이 닫혀 수관이 이어짐 · 외딴 나무는 그대로)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          // ("숲 가장자리 나무의 수관이 바깥쪽으로 더 뻗게")
          treeEdgeLean: { value: 0.6, min: 0, max: 2, step: 0.05, label: "나무 — 숲 가장자리 나무의 수관이 바깥(빈 쪽)으로 뻗는 정도 (빛을 향해)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          treeCrowdR: { value: 3, min: 1, max: 8, step: 0.5, label: "나무 — 이웃으로 세는 거리 (칸)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "clumps" },
          // ("큰 나무 아래 덤불을 더 짙게")
          treeUnderBig: { value: 0.8, min: 0, max: 2, step: 0.05, label: "나무 — 큰 나무일수록 밑의 덤불이 짙고 덤불이 많음 (0 = 크기와 무관)" },
          treeUnder: { value: 0.7, min: 0, max: 1, step: 0.05, label: "나무 — 밑의 덤불 · 풀 (나무 발치를 덮는 낮은 식물의 짙기 · 0 = 맨땅)" },
          treeKinSize: { value: 0.45, min: 0.1, max: 1, step: 0.05, label: "나무 — 어린 나무의 크기 (큰 나무에 대한 비)" },
          // ("식생다양화가 진짜 절실하다") — kinds of tree: each tree is one of them, its colours turned its kind's way
          treeSpecies: { value: 4, min: 1, max: 6, step: 1, label: "나무 — 종류 수 (아래 종류마다의 색 중 앞에서부터 몇 개)" },
          // ("나무 종류 따라 색을 내가 지정할 수 있는 게 좋을 것 같은데") — each kind's crown colour; a crown shades from a
          // darker to a lighter of it (나무 — 수관의 명암 폭)
          treeKind1: { value: "#3f6a34", label: "나무 — 종류 1의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 1 },
          treeKind2: { value: "#76a33f", label: "나무 — 종류 2의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 2 },
          treeKind3: { value: "#9aa63a", label: "나무 — 종류 3의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 3 },
          treeKind4: { value: "#4f8068", label: "나무 — 종류 4의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 4 },
          treeKind5: { value: "#b08436", label: "나무 — 종류 5의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 5 },
          treeKind6: { value: "#a2432f", label: "나무 — 종류 6의 색", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 6 },
          treeKindShade: { value: 0.18, min: 0, max: 0.4, step: 0.01, label: "나무 — 수관의 명암 폭 (아래·안쪽은 어둡게, 위·바깥은 밝게)" },
          // ("나무 종류(색)랑 모양이랑 어느정도 연동되도록") — each kind its own shape and size; how strictly kind decides shape
          treeKindLink: { value: 0.8, min: 0, max: 1, step: 0.05, label: "나무 — 종류와 모양의 연동 (0 = 모양은 위의 비율대로 · 1 = 늘 그 종류의 모양)" },
          treeKindShape1: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "cone" as "ball" | "cone" | "umbrella", label: "나무 — 종류 1의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 1 },
          treeKindScale1: { value: 1.2, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 1의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 1 },
          treeKindShape2: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "ball" as "ball" | "cone" | "umbrella", label: "나무 — 종류 2의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 2 },
          treeKindScale2: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 2의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 2 },
          treeKindShape3: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "umbrella" as "ball" | "cone" | "umbrella", label: "나무 — 종류 3의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 3 },
          treeKindScale3: { value: 0.9, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 3의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 3 },
          treeKindShape4: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "ball" as "ball" | "cone" | "umbrella", label: "나무 — 종류 4의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 4 },
          treeKindScale4: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 4의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 4 },
          treeKindShape5: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "ball" as "ball" | "cone" | "umbrella", label: "나무 — 종류 5의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 5 },
          treeKindScale5: { value: 0.8, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 5의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 5 },
          treeKindShape6: { options: { "둥근 공": "ball", "원뿔": "cone", "우산": "umbrella" }, value: "umbrella" as "ball" | "cone" | "umbrella", label: "나무 — 종류 6의 모양", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 6 },
          treeKindScale6: { value: 0.9, min: 0.3, max: 2.5, step: 0.05, label: "나무 — 종류 6의 크기 (배수)", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.나무.treeSpecies`)) >= 6 },
          treeLeaves: { value: 10, min: 1, max: 40, step: 1, label: "나무 — 잎 (가지 한 마디에 점 몇 개)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "leaves" },
          treeLeafSpread: { value: 1, min: 0.2, max: 4, step: 0.05, label: "나무 — 잎이 가지에서 퍼진 정도", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeCrownMode`) === "leaves" },
          // ("물가 식생 색 다르게 하는거 나무에 적용돼서 느낌이 안 삶") — the trees' own two colours, whatever ground they stand on
          treeColorJitter: { value: 0.25, min: 0, max: 1, step: 0.05, label: "나무 — 수관 색의 지터" },
          // ("나무 기둥이랑 줄기 굵기 따로 조절할 수 있게 해") — the stem is thin cylinders, each kind its thickness
          // (the artist, 2026-11-18: "나무 사이즈랑 줄기 두께 연동을 좀 해야할듯")
          // ("줄기 명도도 나무 종류랑 코릴레이션 있게 해줘", 2026-11-18): a kind's stem lighter or darker as its crown's colour is
          // ("막대기 같아서 굵기 올리기 부담스러울 때가 있음", 2026-11-18): how much thinner the wood gets towards its tips
          treeTaper: { value: 0.85, min: 0, max: 0.97, step: 0.01, label: "나무 — 끝으로 갈수록 가늘어지는 정도 (0 = 끝까지 같은 굵기 · 0.85 = 잔가지 끝은 밑동의 1/7)" },
          treeStemKindLink: { value: 0.8, min: 0, max: 2, step: 0.05, label: "나무 — 줄기 명도를 나무 종류(수관 색의 밝기)에 맞춤 (0 = 종류와 무관)" },
          // (the foot of a big tree: "나무 아래 돌이나 흙, 덤불, 뿌리도 (특히 큰 나무는)")
          treeRoots: { value: 6, min: 0, max: 12, step: 1, label: "나무 — 뿌리 (가장 큰 나무의 갈래 수 · 작은 나무는 없음 · 줄기 방식이 가지일 때)" },
          treeFoot: { value: 1, min: 0, max: 4, step: 0.05, label: "나무 — 발치의 흙과 돌 (큰 나무일수록 넓고 많음 · 0 = 없음)" },
          treeStemBySize: { value: 0.9, min: 0, max: 2, step: 0.05, label: "나무 — 줄기 굵기를 나무 크기에 맞춤 (0 = 모든 나무 같은 굵기 · 1 = 크기에 비례 · 어린 나무는 가늘게)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeTrunkR: { value: 0.035, min: 0.002, max: 0.4, step: 0.002, label: "나무 — 기둥의 굵기 (월드, 반지름)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeBoughR: { value: 0.014, min: 0.001, max: 0.2, step: 0.001, label: "나무 — 가지의 굵기 (반지름)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          treeTwigR: { value: 0.006, min: 0.001, max: 0.1, step: 0.001, label: "나무 — 잔가지의 굵기 (반지름)", render: (get: (path: string) => unknown) => ["line", "branch"].includes(String(get(`${GROUP}.나무.treeStemMode`))) },
          // ("줄기 갈라지는 거 좋긴 한데... 좀 더 유기물같이 안 되나...?") — the forking stem grows: growStem
          treeBend: { value: 1, min: 0, max: 2.5, step: 0.05, label: "나무 — 가지의 굽이 (가지 뻗은 선 · 0 = 곧은 선 · 클수록 휘고 기욺)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeStemMode`) === "branch" },
          treeTwigs: { value: 2, min: 0, max: 3, step: 1, label: "나무 — 잔가지 (가지 하나에 몇 개)", render: (get: (path: string) => unknown) => get(`${GROUP}.나무.treeStemMode`) === "branch" },
        },
        { collapsed: true },
      ),
      "물": folder(
        {
          // ("물길은 '비움'으로 … 그 경계에 식생이 더 빽빽하게") and ("전역에 식생이 있어야")
          waterGap: { value: 1, min: 0, max: 6, step: 1, label: "물길 — 비움 (물길에서 몇 칸까지 식생이 없음 · 0 = 비우지 않음)" },
          // ("물길 생길 때 여전히 갑작스러운 변화로 느껴짐 … 변화되는 정도가 비슷하게 느껴져야")
          waterGrow: { value: 4, min: 0, max: 20, step: 1, label: "물길 — 새 물길이 열리는 데 걸리는 단 (0 = 곧바로)" },
          waterFade: { value: 6, min: 0, max: 30, step: 1, label: "물길 — 마른 물길이 식생에 덮이는 데 걸리는 단 (0 = 곧바로)" },
          waterEdgeJitter: { value: 0.5, min: 0, max: 1, step: 0.05, label: "물길 — 가장자리 식생이 바깥으로 퍼진 폭의 지터 (물길을 따라 넓고 좁아짐 · 0 = 어디나 같은 폭)" },
          waterEdge: { value: 2, min: 0, max: 6, step: 1, label: "물길 — 가장자리의 빽빽한 식생 (비움 바깥 몇 칸)" },
          // THE WATER AS A BELT OF PLANTS ("물길은 그냥 선 말고 식생 띠로 보이게 해줘")
          // ("물가 근처에는 돌 같이 보이도록 추가 점 배열")
          stones: { value: true, label: "물가의 돌 (물길을 따라 흩어진 점)" },
          stoneDense: { value: 1, min: 0.1, max: 5, step: 0.1, label: "물가의 돌 — 밀도", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
          stoneWide: { value: 1.2, min: 0.2, max: 5, step: 0.1, label: "물가의 돌 — 물길에서 퍼진 너비 (칸)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
          stoneSize: { value: 0.14, min: 0.02, max: 1, step: 0.01, label: "물가의 돌 — 크기 (월드)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
          stoneJitter: { value: 0.7, min: 0, max: 1, step: 0.05, label: "물가의 돌 — 크기의 지터", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
          // (the artist, 2026-11-18: "돌 명암 지터도")
          stoneShade: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: "물가의 돌 — 명암의 지터 (돌마다 밝고 어두운 정도)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
          stoneColor: { value: "#8d9096", label: "물가의 돌 — 색 (무채색)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.물.stones`) },
        },
        { collapsed: true },
      ),
      "둔덕 · 흙": folder(
        {
          // THE DEPOSIT (stage 2; the artist, 2026-11-17: "2단계 진행")
          mound: { value: true, label: "오래 · 거듭 지어진 자리에 잔해 둔덕 (덩어리에 남아 있는 전부에서 셈 · 오래일수록 두껍고 넓음)" },
          moundAt: { value: 12, min: 2, max: 60, step: 1, label: "둔덕이 생기는 기준 (그 칸이 지어져 있던 단 수 · 다시 지어질 때마다 절반씩 더 침)" },
          moundMax: { value: 0.6, min: 0.05, max: 3, step: 0.05, label: "둔덕의 가장 두꺼운 높이 (단)" },
          moundColor: { value: "#5b5e63", label: "둔덕의 색 (무채색)" },
          // ("둔덕도 지금 썩 마음에 들진 않아서 다양한 옵션 추가해주고") — the defaults are the mound as it was
          moundShape: { options: { "반구 (지금까지)": "dome", "납작한 대 (윗면이 평평한 둔덕)": "mesa", "원뿔 더미": "cone", "각진 판 (무너진 기단처럼)": "slab", render: (get: (path: string) => unknown) => !get(`${GROUP}.둔덕 · 흙.depositPoints`) }, value: "dome" as "dome" | "mesa" | "cone" | "slab", label: "둔덕 — 모양" },
          moundWide: { value: 1, min: 0.3, max: 4, step: 0.05, label: "둔덕 — 너비 (배수)" },
          moundSizeJitter: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 크기의 지터 (둔덕마다 크고 작은 정도)", render: (get: (path: string) => unknown) => !get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundSquash: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 찌그러짐 (둥글지 않고 길쭉한 정도 · 제각각 돌아감)", render: (get: (path: string) => unknown) => !get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundTiers: { value: 1, min: 1, max: 5, step: 1, label: "둔덕 — 단 (거듭 지어진 자리일수록 여러 겹으로 쌓임 · 1 = 한 덩이)", render: (get: (path: string) => unknown) => !get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundStep: { value: 0.25, min: 0.05, max: 0.6, step: 0.05, label: "둔덕 — 단마다 줄어드는 정도", render: (get: (path: string) => unknown) => Number(get(`${GROUP}.둔덕 · 흙.moundTiers`)) > 1 },
          moundScatter: { value: 0.5, min: 0, max: 2, step: 0.05, label: "둔덕 — 자리의 흐트러짐 (칸 한가운데에서 벗어나는 정도)", render: (get: (path: string) => unknown) => !get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundTone: { value: 0, min: 0, max: 1, step: 0.05, label: "둔덕 — 명도의 지터 (둔덕마다 밝고 어두운 정도)" },
          // ("둔덕이랑 흙 이런 건 다 점으로 하는 게 나을 것 같은데 — 사이즈랑 지터 조절 가능한!! 밀도도!!")
          depositPoints: { value: true, label: "둔덕과 어두운 흙을 점으로 (끄면 덩어리)" },
          moundPtDense: { value: 1, min: 0.1, max: 6, step: 0.1, label: "둔덕 점 — 밀도 (배수)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundPtSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "둔덕 점 — 크기 (월드)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          moundPtJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "둔덕 점 — 크기의 지터", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          stain: { value: true, label: "가볍게 스친 자리에 어두운 흙 한 겹 (기준에 못 미치고 건물이 거의 남지 않은 칸)" },
          stainColor: { value: "#17181a", label: "어두운 흙의 색 (무채색)" },
          stainPtDense: { value: 1, min: 0.1, max: 6, step: 0.1, label: "어두운 흙 점 — 밀도 (배수)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          stainPtSize: { value: 0.1, min: 0.02, max: 1, step: 0.01, label: "어두운 흙 점 — 크기 (월드)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
          stainPtJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "어두운 흙 점 — 크기의 지터", render: (get: (path: string) => unknown) => !!get(`${GROUP}.둔덕 · 흙.depositPoints`) },
        },
        { collapsed: true },
      ),
      "관 · 길": folder(
        {
          pipes: { value: true, label: "묻힌 관을 그림 (층의 땅 아래 · 놓였던 것 전부)" },
          depth: { value: 1, min: 0, max: 6, step: 0.25, label: "관의 깊이 (단 · 층의 땅에서 아래로)" },
          radius: { value: 0.08, min: 0.02, max: 0.4, step: 0.01, label: "관의 굵기 (월드, 반지름)" },
          color: { value: "#7c7f84", label: "관의 색 (무채색)" },
          // ("매끄러운 선이 나음")
          smoothRoads: { value: true, label: "길 — 걷는 길의 매끄러운 선 그대로 (끄면 칸 격자)" },
        },
        { collapsed: true },
      ),
    }),
    { collapsed: true },
  );
  // (the plants' colours, livelier: plantTone.ts — read by this file's drawing and by FutureVillage's)
  useEffect(() => {
    Object.assign(plantTone, { vivid: k.plantVivid, light: k.plantLight, hue: k.plantHue });
    plantTone.version++;
  }, [k.plantVivid, k.plantLight, k.plantHue]);
  futureUnder.cfg = useMemo(
    () => ({
      under: k.under,
      moundAt: k.moundAt,
      fate: k.fate,
      strip: k.strip,
      cover: k.cover,
      stones: k.stones ? { dense: k.stoneDense, wide: k.stoneWide } : undefined,
      succession: k.succession,
      soil: k.soil,
      water: { belt: false, gap: k.waterGap, edge: k.waterEdge, edgeJitter: k.waterEdgeJitter, grow: k.waterGrow, fade: k.waterFade },
      ground: { density: k.groundVeg },
      // (grass and scrub: only the threshold is the worker's — their shapes are the shader's, plantCloudsGpu.ts)
      scrub: { at: k.scrubAt },
      last: { steel: k.lastSteel, pile: k.lastPile },
      partShare: { mass: k.shareMass, slab: k.shareSlab, column: k.shareColumn, beam: k.shareBeam, brace: k.shareBeam, plinth: k.shareFoot, basement: k.shareFoot, pile: k.sharePile, drip: k.shareDrip },
      smoothRoads: k.smoothRoads,
      spread: k.spread,
      // (the stem as points only in that mode: drawn another way, none of the tree's points are spent on it)
      tree: { share: k.treeShare, under: k.treeUnder, underBig: k.treeUnderBig, at: k.treeAt, height: k.treeHeight, crown: k.treeCrown, stem: k.treeStem, stemShare: k.treeStemMode === "points" ? k.treeStemShare : 0, dense: k.treeDense, weights: { ball: k.treeBall, cone: k.treeCone, umbrella: k.treeUmbrella }, sizeJitter: k.treeSizeJitter, shapeJitter: k.treeShapeJitter, denseJitter: k.treeDenseJitter, apart: true, kin: k.treeKin, kinFar: k.treeKinFar, kinSize: k.treeKinSize, gpu: true, points: k.treeCrownMode === "points", kinds: { count: k.treeSpecies, link: k.treeKindLink, shapes: [k.treeKindShape1, k.treeKindShape2, k.treeKindShape3, k.treeKindShape4, k.treeKindShape5, k.treeKindShape6] as ("ball" | "cone" | "umbrella")[], scale: [k.treeKindScale1, k.treeKindScale2, k.treeKindScale3, k.treeKindScale4, k.treeKindScale5, k.treeKindScale6] } },
    }),
    [k.scrubAt, k.treeShare, k.treeUnder, k.treeUnderBig, k.treeKindLink, k.treeKindShape1, k.treeKindShape2, k.treeKindShape3, k.treeKindShape4, k.treeKindShape5, k.treeKindShape6, k.treeKindScale1, k.treeKindScale2, k.treeKindScale3, k.treeKindScale4, k.treeKindScale5, k.treeKindScale6, k.treeSpecies, k.treeCrownMode, k.under, k.moundAt, k.fate, k.strip, k.stones, k.stoneDense, k.stoneWide, k.succession, k.soil, k.waterGap, k.waterEdge, k.waterEdgeJitter, k.waterGrow, k.waterFade, k.groundVeg, k.smoothRoads, k.spread, k.shareMass, k.shareSlab, k.shareColumn, k.shareBeam, k.shareFoot, k.shareDrip, k.sharePile, k.lastSteel, k.lastPile, k.cover, k.treeAt, k.treeHeight, k.treeCrown, k.treeStem, k.treeStemShare, k.treeStemMode, k.treeDense, k.treeBall, k.treeCone, k.treeUmbrella, k.treeSizeJitter, k.treeShapeJitter, k.treeDenseJitter, k.treeKin, k.treeKinFar, k.treeKinSize],
  );
  // THE OTHER PLANTS (stage 5): the points of FutureResult.vegOld, as FutureVillage draws the layer's plants — the
  // same size, at the same heights — in the two colours of this folder
  const other = useRef<THREE.Points>(null);
  const drawnOther = useRef("");
  // THE TREES, DRAWN APART (the artist, 2026-11-17: "점 사이즈랑 지터 … 줄기 점 대신 다른걸로 시각화 할 방법"): their
  // points (FutureResult.vegTree) with a size of their own, each point larger or smaller by its own number; their
  // stems (treeStems), when not points, as lines — one from the foot into the crown, or one that forks into it
  const treePts = useRef<THREE.Points>(null);
  const footPts = useRef<THREE.Points>(null);
  const depCache = useRef<{ sig: string; map: Map<string, { p: Float32Array; c: Float32Array; s: Float32Array }> }>({ sig: "", map: new Map() });
  const treeCache = useRef<{ sig: string; map: Map<string, TreeGrown>; used: Set<string> }>({ sig: "", map: new Map(), used: new Set() });
  const treeStemMesh = useRef<THREE.InstancedMesh>(null);
  // THE CROWN AS CLUMPS: one soft ball of points (a gaussian spread, thick at its middle) drawn once per clump by the
  // GPU from the clump's centre, radius and colour — as the present's gatherings are (ParliamentSpace cloudGeometry)
  const clumps = useRef<THREE.Points>(null);
  // (the time and the life's lengths, and the distance LOD, shared by the crowns' and the stems' shaders —
  // the life's uniform is the layer's one: futureLife.ts — the ground's things and the buildings' parts read it too)
  const lifeU = futureLifeU;
  const lodU = useMemo(() => ({ value: new THREE.Vector3(30, 140, 0) }), []);
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
    g.setAttribute("iLife", new THREE.InstancedBufferAttribute(new Float32Array(CLUMP_CAP * 2), 2));
    g.instanceCount = 0;
    return g;
  }, [k.treeClumpPts]);
  useEffect(() => () => clumpGeo.dispose(), [clumpGeo]);
  const clumpMat = useMemo(() => {
    const m = new THREE.PointsMaterial({ vertexColors: true, size: 0.08, sizeAttenuation: true });
    // (a tree that has come grows in: its clumps widen from small, their points from nothing; one gone fades the same
    // way back — uLife as the plants'; and far off fewer points, each the bigger — uLod as the plants')
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLife = lifeU;
      shader.uniforms.uLod = lodU;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 iCenter;\nattribute vec2 iLife;\nuniform vec3 uLife, uLod;\nfloat cLife, cDie;")
        .replace(
          "#include <begin_vertex>",
          [
            "float hB = fract(sin(dot(iCenter.xyz, vec3(39.346, 11.135, 83.155))) * 24634.6345);",
            "float ca = cos(hB * 6.2832), sa = sin(hB * 6.2832);",
            "vec3 off = vec3(ca * position.x - sa * position.z, position.y, sa * position.x + ca * position.z);",
            // (THE TICKER — the artist, 2026-11-18: "티커로 차자자작 지어지는 느낌이면 되는데. 나무도 그렇고": at its tree's
            // turn and after its wood, each clump snaps on; a tree gone, its clumps snap off, then its wood whole)
            "float cH = fract(sin(dot(iCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);",
            "cLife = step(iLife.x + 0.4 + 0.3 * cH, uLife.x);",
            "cDie = iLife.y >= 0.0 ? 1.0 - step(iLife.y + 0.25 * cH, uLife.x) : 1.0;",
            "vec3 transformed = iCenter.xyz + off * iCenter.w;",
          ].join("\n"),
        )
        .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb *= 0.82 + 0.25 * position.y;")
        .replace(
          "#include <fog_vertex>",
          [
            "float cLod = 1.0 - uLod.z * smoothstep(uLod.x, uLod.y, -mvPosition.z);",
            "float cU = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719)) + iCenter.x * 0.37) * 43758.5453);",
            "gl_PointSize *= cLife * cDie * (cU > cLod ? 0.0 : inversesqrt(max(cLod, 0.1)));",
            "#include <fog_vertex>",
          ].join("\n"),
        );
      edgeFade(shader);
    };
    m.customProgramCacheKey = () => "future-tree-clumps";
    return m;
  }, [lifeU, lodU]);
  useEffect(() => () => clumpMat.dispose(), [clumpMat]);
  // (the wild forest's other plants: FutureResult.vegWild, in the layer's own two colours)
  const wildPts = useRef<THREE.Points>(null);
  // (grass and scrub, apart: FutureResult.vegGrass / vegScrub)
  const grassPts = useRef<THREE.Points>(null);
  // GRASS AND SCRUB ON THE GPU (plantCloudsGpu.ts): one record a cloud, the points made in the shader
  const plantGeo = useMemo(() => plantBaseGeometry(), []);
  const plant = useMemo(() => plantMaterial(), []);
  // (the flowers' glow: the same clouds and the same uniforms, its own material)
  const glow = useMemo(() => plantMaterial(true, plant.u), [plant]);
  useEffect(() => () => {
    plantGeo.dispose();
    plant.mat.dispose();
    glow.mat.dispose();
  }, [plantGeo, plant, glow]);
  const glowPts = useRef<THREE.Points>(null);
  const plantPts = useRef<THREE.Points>(null);
  // (which clouds were there, and since when: plantCloudsGpu PlantLife; the trees' the same, by their own number)
  const plantLife = useRef(newPlantLife());
  // (the trees of the last layer by their own number, when each came, and those gone, fading — as the plants')
  const treeLife = useRef<{ version: number; first: boolean; recs: Map<number, Float32Array>; born: Map<number, number>; dying: { rec: Float32Array; born: number; died: number }[] }>({ version: -1, first: true, recs: new Map(), born: new Map(), dying: [] });
  // THE STEMS' OWN SHADER (the artist, 2026-11-18: "lod 는 식생 점이랑 가지에 적용 가능하냐는 거였는데", and "바로 나타나고
  // 사라지는 것들 중에 더 연속적으로"): each piece knows its kind (0 trunk, 1 bough, 2 twig) and its tree's coming and
  // going — a tree grows its trunk first, then its boughs, then its twigs, each piece lengthening from its base; and
  // far off the twigs, then the boughs, thin out
  const stemGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 5);
    g.setAttribute("iStem", new THREE.InstancedBufferAttribute(new Float32Array(STEM_CAP * 3), 3));
    return g;
  }, []);
  useEffect(() => () => stemGeo.dispose(), [stemGeo]);
  const stemMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLife = lifeU;
      shader.uniforms.uLod = lodU;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 iStem;\nuniform vec3 uLife, uLod;")
        .replace(
          "#include <begin_vertex>",
          [
            "#include <begin_vertex>",
            // (THE TICKER — the artist, 2026-11-18: "티커로 차자자작 지어지는 느낌이면 되는데. 나무도 그렇고": at its tree's
            // turn the trunk snaps on, a moment later the boughs, then the twigs, one by one. A TREE GONE IS NOT TAKEN
            // APART ("줄기줄기 사라지면 안 되지 않냐? 허공에서 분해되는 느낌"): after its crown, its wood goes whole, at once)
            "float sH = fract(float(gl_InstanceID) * 0.754877);",
            "float sAt = iStem.x < 0.5 ? 0.0 : iStem.x < 1.5 ? 0.12 + 0.1 * sH : 0.25 + 0.15 * sH;",
            "float kG = step(iStem.y + sAt, uLife.x);",
            "if (iStem.z >= 0.0 && uLife.x >= iStem.z + 0.45) kG = 0.0;",
            // (far off: the twigs go first, then the boughs — by a number of each piece's own)
            "vec4 sW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);",
            "float sFar = smoothstep(uLod.x, uLod.y, distance(cameraPosition, sW.xyz)) * uLod.z;",
            "float sKeep = iStem.x > 1.5 ? 1.0 - 1.2 * sFar : iStem.x > 0.5 ? 1.0 - 0.7 * sFar : 1.0;",
            "if (fract(float(gl_InstanceID) * 0.6180339) > sKeep) kG = 0.0;",
            "transformed.xz *= kG;",
            "transformed.y = (transformed.y + 0.5) * kG - 0.5;",
          ].join("\n"),
        );
      edgeFade(shader);
    };
    m.customProgramCacheKey = () => "future-tree-stems";
    return m;
  }, [lifeU, lodU]);
  useEffect(() => () => stemMat.dispose(), [stemMat]);
  const plantSeen = useRef(-1);
  const scrubPts = useRef<THREE.Points>(null);
  const drawnGS = useRef("");
  // (the stones by the water: FutureResult.stones)
  const stonePts = useRef<THREE.Points>(null);
  const drawnStones = useRef("");
  // (the stones', the deposit's and the dark earth's coming and going, by their places: futureLife.ts)
  const stoneLife = useRef(newKeyedLife());
  const depPtLife = useRef(newKeyedLife());
  const moundLife = useRef(newKeyedLife());
  const stainLife = useRef(newKeyedLife());
  const drawnWild = useRef("");
  const depPts = useRef<THREE.Points>(null);
  const drawnDepPts = useRef("");
  const drawnTrees = useRef("");
  // THE LAYER ALONE (/rehearsal/future, lib/parliament/futureOnly.ts): the camera is set on the layer once — looking
  // down at its ground from a side — and then left to the hand
  const three = useThree();
  // (walking: the keys held and where the eye looks — 보기 › walk)
  const walkKeys = useRef(new Set<string>());
  const walkState = useRef({ on: false, yaw: 0, pitch: 0, drag: false, lx: 0, ly: 0 });
  useEffect(() => {
    if (!k.walk) return;
    const el = three.gl.domElement, L = walkState.current;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const kd = (e: KeyboardEvent) => {
      if (!typing(e)) walkKeys.current.add(e.code);
    };
    const ku = (e: KeyboardEvent) => walkKeys.current.delete(e.code);
    const pd = (e: PointerEvent) => {
      L.drag = true;
      L.lx = e.clientX;
      L.ly = e.clientY;
    };
    const pm = (e: PointerEvent) => {
      if (!L.drag) return;
      L.yaw -= (e.clientX - L.lx) * 0.004;
      L.pitch = Math.max(-1.3, Math.min(1.3, L.pitch - (e.clientY - L.ly) * 0.004));
      L.lx = e.clientX;
      L.ly = e.clientY;
    };
    const pu = () => {
      L.drag = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    return () => {
      walkKeys.current.clear();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      el.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
    };
  }, [k.walk, three.gl]);
  const placed = useRef(false);
  // THE SCREENSHOT: the scene drawn once more and read straight back (the canvas keeps no picture between frames),
  // saved as a PNG named by the time
  shoot.current = () => {
    try {
      // (with the drawing buffer kept — 렌더 › preserveDrawingBuffer — the frame as it is on the screen, bloom and all;
      // without it the scene is drawn once more, plain, and read straight back)
      if (!three.gl.getContextAttributes()?.preserveDrawingBuffer) three.gl.render(three.scene, three.camera);
      three.gl.domElement.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a"), d = new Date(), z = (v: number) => String(v).padStart(2, "0");
        a.href = URL.createObjectURL(blob);
        a.download = `future-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, "image/png");
    } catch (e) {
      console.warn("[parliament] the screenshot could not be taken:", e);
    }
  };
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
    () => (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) => {
      shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute float psize;\nvoid main() {").replace("gl_PointSize = size;", "gl_PointSize = size * psize;");
      edgeFade(shader);
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

  // (its frame, timed: a frame of it over 4 ms is kept as a span — __perfSpans() — to find what stalls the screen)
  useFrame((state, dt) => {
    const t0 = performance.now();
    frame(state, dt);
    const ms = performance.now() - t0;
    if (ms > 4) markSpan("future layer (FutureUnder)", ms);
  });
  const frame = (state: RootState, dt: number): void => {
    // (each section's time, kept as a span when it is long — what stalls the screen when a layer arrives)
    let lapAt = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      if (now - lapAt > 3) markSpan(`future layer › ${name}`, now - lapAt);
      lapAt = now;
    };
    const r = futureLink.result;
    const layerOn = !!r && (knob(`${LAYER}.on`) === true || futureOnly());
    // WHERE THE LAYER'S GROUND IS — as FutureVillage places it: above the window's top (or above the slot it was read
    // from), the gap apart
    const gap = Number(knob(`${LAYER}.gap`) ?? 8);
    const base = ((knob(`${LAYER}.anchor`) === "built" && r ? r.k + 1 : top.value) + Math.max(0, Number.isFinite(gap) ? gap : 8)) * unit;
    // WALKING ON THE LAYER: the turning round it stops; the eye stands on its ground and goes by the keys and the drag
    {
      const L = walkState.current, ctl = three.controls as unknown as { enabled: boolean; target: THREE.Vector3; update: () => void } | null, cam = state.camera;
      if (k.walk && r) {
        if (!L.on) {
          L.on = true;
          if (ctl) {
            ctl.enabled = false;
            L.yaw = Math.atan2(cam.position.x - ctl.target.x, cam.position.z - ctl.target.z);
            cam.position.set(ctl.target.x, 0, ctl.target.z);
          }
          L.pitch = -0.08;
        }
        const keys = walkKeys.current, fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw);
        const fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
        const side = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
        const v = k.walkSpeed * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1) * Math.min(0.1, dt);
        cam.position.x += (fx * fwd - fz * side) * v;
        cam.position.z += (fz * fwd + fx * side) * v;
        cam.position.y = base + k.walkEye;
        cam.rotation.set(L.pitch, L.yaw, 0, "YXZ");
      } else if (L.on) {
        L.on = false;
        if (ctl) {
          ctl.target.set(cam.position.x - Math.sin(L.yaw) * 12, base, cam.position.z - Math.cos(L.yaw) * 12);
          ctl.enabled = true;
          ctl.update();
        }
      }
    }

    lap("walk");
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
        // (drawn again only when its own records or its knobs changed — futureLife.ts recSum)
        const dKnobs = `${unit}:${k.mound}:${k.stain}:${k.moundMax}:${k.moundWide}:${k.moundColor}:${k.stainColor}:${k.moundPtDense}:${k.moundPtSize}:${k.moundPtJitter}:${k.stainPtDense}:${k.stainPtSize}:${k.stainPtJitter}:${k.moundTone}`;
        const sig = `${recSum(r.mounds)}:${recSum(r.stains)}:${dKnobs}`;
        if (sig !== drawnDepPts.current) {
          drawnDepPts.current = sig;
          // A MOUND AS POINTS: a heap of them, thick at its middle and low at its rim, as high as the mound; DARK
          // EARTH as a flat scatter — every point its own size (the size knob × its jitter)
          const ms = r.mounds ?? new Float32Array(0), ss = r.stains ?? new Float32Array(0);
          const mc = new THREE.Color(k.moundColor), sc0 = new THREE.Color("#2a2d31"), sc1 = new THREE.Color(k.stainColor);
          const CAPP = 120000;
          // EACH MOUND MADE ONCE, COMING AND GOING WHOLE (the artist, 2026-11-18: "여튼 최적화가 진짜 큰 문제" — on the
          // artist's world this took 530 ms, up to a second, every layer: every point of every mound made again and
          // traced one by one): a mound's (or a patch of dark earth's) points depend only on its record and the knobs,
          // so they are kept by both; what comes and goes is the mound, by its place and score — [kind 0 mound / 1
          // earth, x, z, score, own] a record (futureLife.ts)
          const DC = depCache.current, dSig = dKnobs;
          if (DC.sig !== dSig) {
            DC.map.clear();
            DC.sig = dSig;
          }
          const nM = k.mound ? Math.floor(ms.length / 4) : 0, nSt = k.stain ? Math.floor(ss.length / 4) : 0, drec = new Float32Array((nM + nSt) * 5);
          for (let i = 0; i < nM; i++) drec.set([0, ms[i * 4], ms[i * 4 + 1], ms[i * 4 + 2], ms[i * 4 + 3]], i * 5);
          for (let i = 0; i < nSt; i++) drec.set([1, ss[i * 4], ss[i * 4 + 1], ss[i * 4 + 2], ss[i * 4 + 3]], (nM + i) * 5);
          const lv = liveAndFading(depPtLife.current, futureLink.version, drec, 5, (a, o) => placeKey(a[o + 1], a[o + 2], a[o] * 2048 + Math.round(a[o + 3] * 16)), performance.now() / 1000, k.lifeFade);
          const made = (o: number): { p: Float32Array; c: Float32Array; s: Float32Array } => {
            const a = lv.recs, key = `${a[o]}|${a[o + 1]}|${a[o + 2]}|${a[o + 3]}|${a[o + 4]}`;
            let m = DC.map.get(key);
            if (m) return m;
            const p: number[] = [], c: number[] = [], z: number[] = [];
            const x0 = a[o + 1], z0 = a[o + 2], own = a[o + 4];
            if (a[o] < 0.5) {
              const f = Math.min(1, (a[o + 3] - 1) / 3);
              const rad = CELL_SIZE * (0.7 + 0.35 * own + 0.35 * f) * k.moundWide, high = k.moundMax * unit * (0.3 + 0.7 * f) * (0.8 + 0.4 * own);
              const np = Math.round((14 + 30 * f) * k.moundPtDense);
              // (every number of a mound's own by its place's — not by where it stands in the list, which moves as mounds
              // come and go — so that one that stays keeps its points)
              const sd = own * 997.13;
              const shade = Math.max(0.3, 1 + (rnd(own * 7, sd) - 0.5) * k.moundTone);
              for (let j = 0; j < np; j++) {
                const u = rnd(sd + 0.5, j), th = rnd(j, sd + own) * Math.PI * 2, rr = rad * Math.sqrt(u);
                p.push(x0 + Math.cos(th) * rr, high * Math.sqrt(Math.max(0, 1 - u)) * rnd(j * 3, sd), z0 + Math.sin(th) * rr);
                c.push(mc.r * shade, mc.g * shade, mc.b * shade);
                z.push(k.moundPtSize * Math.max(0.15, 1 + (rnd(sd, j * 1.7) - 0.5) * 2 * k.moundPtJitter));
              }
            } else {
              const t = Math.max(0, Math.min(1, a[o + 3]));
              const rad = CELL_SIZE * (0.55 + 0.5 * own) * (0.6 + 0.4 * t), np = Math.round((6 + 14 * t) * k.stainPtDense);
              tone.c.copy(sc0).lerp(sc1, 0.35 + 0.65 * t);
              const sd = own * 991.71;
              for (let j = 0; j < np; j++) {
                const u = rnd(sd + 0.25, j), th = rnd(j + 0.5, sd + own) * Math.PI * 2, rr = rad * Math.sqrt(u);
                p.push(x0 + Math.cos(th) * rr, 0.01 * rnd(j, sd), z0 + Math.sin(th) * rr);
                c.push(tone.c.r, tone.c.g, tone.c.b);
                z.push(k.stainPtSize * Math.max(0.15, 1 + (rnd(sd * 1.3, j) - 0.5) * 2 * k.stainPtJitter));
              }
            }
            m = { p: Float32Array.from(p), c: Float32Array.from(c), s: Float32Array.from(z) };
            DC.map.set(key, m);
            return m;
          };
          // (the points: all of each mound, with the mound's [born, died])
          const parts: { p: Float32Array; c: Float32Array; s: Float32Array }[] = [];
          let total = 0;
          for (let i = 0; i < lv.n && total < CAPP; i++) {
            const m = made(i * 5);
            parts.push(m);
            total += m.s.length;
          }
          const P = new Float32Array(total * 3), C = new Float32Array(total * 3), S = new Float32Array(total), Lf = new Float32Array(total * 2);
          let w = 0;
          parts.forEach((m, i) => {
            const n = Math.min(m.s.length, total - w);
            P.set(m.p.subarray(0, n * 3), w * 3);
            C.set(m.c.subarray(0, n * 3), w * 3);
            S.set(m.s.subarray(0, n), w);
            const b = lv.life[i * 2], d = lv.life[i * 2 + 1];
            for (let q = 0; q < n; q++) {
              Lf[(w + q) * 2] = b;
              Lf[(w + q) * 2 + 1] = d;
            }
            w += n;
          });
          // (what is no longer drawn is let go: a mound gone and faded is not kept)
          if (DC.map.size > 4 * (lv.n + 64)) DC.map.clear();
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
          geo.setAttribute("psize", new THREE.BufferAttribute(S, 1));
          geo.setAttribute("aLife", new THREE.BufferAttribute(Lf, 2));
          dp.geometry.dispose();
          dp.geometry = geo;
        }
      }
    }
    if (mm && sm && r && layerOn && !k.depositPoints) {
      mm.position.y = base;
      sm.position.y = base + 0.012;
      const sig = `${futureLink.version}:${k.moundMax}:${k.stainColor}:${unit}:${k.moundColor}:${k.moundWide}:${k.moundSizeJitter}:${k.moundSquash}:${k.moundTiers}:${k.moundStep}:${k.moundScatter}:${k.moundTone}:${moundGeo.id}`;
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
        // (each tier as [its matrix, its colour] — then kept from one layer to the next by its place: futureLife.ts)
        const MS = 19, mrec = new Float32Array(DEP_CAP * MS);
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
            m.compose(p, q, s).toArray(mrec, nm * MS);
            tone.c.copy(base0).multiplyScalar(Math.max(0.2, shade * (1 + t * 0.06))).toArray(mrec, nm * MS + 16);
            nm++;
          }
        }
        q.identity();
        const nowS = performance.now() / 1000;
        // (a mound that comes rises out of the ground's dissolve, one gone dissolves where it was; one grown higher gives
        // way to its new self the same way)
        const ml = liveAndFading(moundLife.current, futureLink.version, mrec.subarray(0, nm * MS), MS, (a, o) => placeKey(a[o + 12], a[o + 14], a[o + 13] * 64 + a[o + 5] * 512), nowS, k.lifeFade);
        const nM = Math.min(DEP_CAP, ml.n);
        for (let i = 0; i < nM; i++) {
          mm.setMatrixAt(i, m.fromArray(ml.recs, i * MS));
          mm.setColorAt(i, tone.c.fromArray(ml.recs, i * MS + 16));
        }
        setLifeAttr(mm.geometry, DEP_CAP, ml.life, nM);
        mm.count = nM;
        mm.instanceMatrix.needsUpdate = true;
        if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
        // (the darker the longer the place was built; the lightest is the layer's own ground)
        tone.a.set("#2a2d31");
        tone.b.set(k.stainColor);
        const srec = new Float32Array(ns * MS);
        for (let i = 0; i < ns; i++) {
          const t = Math.max(0, Math.min(1, ss[i * 4 + 2])), rnd = ss[i * 4 + 3];
          const rad = CELL_SIZE * (0.55 + 0.5 * rnd) * (0.6 + 0.4 * t);
          p.set(ss[i * 4] + (rnd - 0.5) * CELL_SIZE * 0.5, 0, ss[i * 4 + 1] + (((rnd * 5.17) % 1) - 0.5) * CELL_SIZE * 0.5);
          s.set(rad, 0.01, rad);
          m.compose(p, q, s).toArray(srec, i * MS);
          tone.c.copy(tone.a).lerp(tone.b, 0.35 + 0.65 * t).toArray(srec, i * MS + 16);
        }
        const sl = liveAndFading(stainLife.current, futureLink.version, srec, MS, (a, o) => placeKey(a[o + 12], a[o + 14], a[o] * 512), nowS, k.lifeFade);
        const nS = Math.min(DEP_CAP, sl.n);
        for (let i = 0; i < nS; i++) {
          sm.setMatrixAt(i, m.fromArray(sl.recs, i * MS));
          sm.setColorAt(i, tone.c.fromArray(sl.recs, i * MS + 16));
        }
        setLifeAttr(sm.geometry, DEP_CAP, sl.life, nS);
        sm.count = nS;
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
      }
    }

    lap("deposit");
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

    if (((futureOnly() && !placed.current) || goTo.current) && r && top.value > 0) {
      const ctl = three.controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      if (ctl) {
        placed.current = true;
        goTo.current = false;
        ctl.target.set(0, base, 0);
        three.camera.position.set(70, base + 75, 95);
        ctl.update();
      }
    }
    lap("other plants");
    // (the water's belt of plants is retired: the water is shown as emptiness — 물 › 비움)
    const wp = waterPts.current;
    if (wp) wp.visible = false;
    // THE STONES BY THE WATER: grey points of their own sizes, darker and lighter by their own number
    const stp = stonePts.current;
    if (stp) {
      stp.visible = layerOn && k.stones;
      if (r && stp.visible) {
        stp.position.y = base + 0.02;
        const sig = `${recSum(r.stones)}:${unit}:${k.stoneSize}:${k.stoneJitter}:${k.stoneColor}:${k.stoneShade}`;
        if (sig !== drawnStones.current) {
          drawnStones.current = sig;
          // (a stone that was not there comes in, one no longer there goes, where it lay: futureLife.ts)
          const lv = liveAndFading(stoneLife.current, futureLink.version, r.stones ?? new Float32Array(0), 5, (a, o) => placeKey(a[o], a[o + 2], a[o + 3] * 4000), performance.now() / 1000, k.lifeFade);
          const v = lv.recs, np = lv.n, c0 = new THREE.Color(k.stoneColor);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3), ps = new Float32Array(np);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 5];
            pos[i * 3 + 1] = v[i * 5 + 1] * unit;
            pos[i * 3 + 2] = v[i * 5 + 2];
            const sh = Math.max(0.08, 0.95 + (v[i * 5 + 4] - 0.5) * 2 * k.stoneShade * (0.6 + 0.8 * v[i * 5 + 3]));
            col[i * 3] = c0.r * sh;
            col[i * 3 + 1] = c0.g * sh;
            col[i * 3 + 2] = c0.b * sh;
            ps[i] = k.stoneSize * Math.max(0.15, 1 + (v[i * 5 + 3] - 0.35) * 2 * k.stoneJitter);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          geo.setAttribute("psize", new THREE.BufferAttribute(ps, 1));
          geo.setAttribute("aLife", new THREE.BufferAttribute(lv.life, 2));
          stp.geometry.dispose();
          stp.geometry = geo;
        }
      }
    }
    lap("stones");
    // GRASS AND SCRUB, each in its own colours, dot size and jitter; the wild forest's shown or not with its knob,
    // the inferred ones with theirs
    const pp = plantPts.current;
    if (pp) {
      pp.visible = layerOn;
      if (r && layerOn) {
        pp.position.y = base + 0.04;
        const pSum = recSum(r.plantClouds);
        if (plantSeen.current !== pSum) {
          plantSeen.current = pSum;
          setPlantClouds(plantGeo, r.plantClouds ?? new Float32Array(0), unit, plantLife.current, performance.now() / 1000, k.lifeFade);
        }
        // (every knob a uniform: the colours made livelier by plantTone on the CPU, ten of them)
        const U = plant.u, col = (key: string, hex: string) => {
          const c = new THREE.Color(hex);
          plantColor(U[key].value as THREE.Color, c.r, c.g, c.b, 0.5);
        };
        col("uGrassA", k.grassColorA);
        col("uGrassB", k.grassColorB);
        col("uScrubA", k.scrubColorA);
        col("uScrubB", k.scrubColorB);
        col("uSoilA", k.soilColorA);
        col("uSoilB", k.soilColorB);
        (U.uF1.value as THREE.Color).set(k.flowerColor1);
        (U.uF2.value as THREE.Color).set(k.flowerColor2);
        (U.uF3.value as THREE.Color).set(k.flowerColor3);
        (U.uF4.value as THREE.Color).set(k.flowerColor4);
        (U.uGrass.value as THREE.Vector4).set(k.grassWide, k.grassHigh, k.grassFlat, k.grassJitter);
        (U.uScrub.value as THREE.Vector4).set(k.scrubWide, k.scrubHigh, k.scrubFlat, k.scrubJitter);
        (U.uDense.value as THREE.Vector2).set(k.grassDense, k.scrubDense);
        (U.uDot.value as THREE.Vector2).set(k.grassDot, k.scrubDot);
        (U.uDotJit.value as THREE.Vector2).set(k.grassDotJitter, k.scrubDotJitter);
        (U.uFlower.value as THREE.Vector4).set(k.flowerAmount, k.flowerWhite, k.flowerDot, 0);
        (U.uShow.value as THREE.Vector2).set(k.showInferred ? 1 : 0, k.showWild ? 1 : 0);
        col("uCoverA", k.coverColorA);
        col("uCoverB", k.coverColorB);
        (U.uCover.value as THREE.Vector4).set(k.coverOff, k.coverHigh, k.coverDense, k.coverDot);
        (U.uLod.value as THREE.Vector3).set(k.lodNear, Math.max(k.lodNear + 1, k.lodFar), k.lod);
        (U.uLife.value as THREE.Vector3).set(performance.now() / 1000, k.lifeGrow, k.lifeFade);
        lifeU.value.set(performance.now() / 1000, k.lifeGrow, k.lifeFade);
        // (the layer's edge: the ground it was read from — everything thins out over edgeFade cells inside it)
        if (r.ground && r.ground.length >= 4) futureEdgeU.uEdgeRect.value.set(r.ground[0], r.ground[1], r.ground[2], r.ground[3]);
        futureEdgeU.uEdgeW.value = Math.max(0, k.edgeFade) * CELL_SIZE;
        futureEdgeU.uEdgeWorld.value = 160 * CELL_SIZE;
        futureTicker.sec = k.ticker;
        setFutureRender({ ao: k.renderAo, shadows: k.renderShadows });
        lodU.value.set(k.lodNear, Math.max(k.lodNear + 1, k.lodFar), k.lod);
        (U.uHalo.value as THREE.Vector3).set(k.flowerGlow, k.flowerGlowSize, k.flowerGlowFall);
        const bloomOn = k.flowerBloom > 0 && k.flowerAmount > 0 && (futureOnly() || k.flowerBloomWall);
        (U.uBright.value as THREE.Vector2).set(bloomOn ? k.flowerBloomBright : 1, bloomOn ? k.flowerBloomBright : 1);
        setFlowerBloom({ on: bloomOn && layerOn, intensity: k.flowerBloom, threshold: k.flowerBloomThreshold, radius: k.flowerBloomRadius });
      }
    }
    const gw = glowPts.current;
    if (gw) {
      gw.visible = !!pp?.visible && k.flowerGlow > 0 && k.flowerAmount > 0;
      if (pp) gw.position.y = pp.position.y;
    }
    // (no layer drawn, no bloom pass)
    if (!(pp && r && layerOn)) setFlowerBloom({ on: false, intensity: 1, threshold: 1, radius: 0.6 });
    const gp = grassPts.current, sp2 = scrubPts.current;
    if (gp && sp2) {
      gp.visible = sp2.visible = layerOn;
      if (r && layerOn) {
        gp.position.y = sp2.position.y = base + 0.04;
        const sig = `${futureLink.version}:${unit}:${k.grassColorA}:${k.grassColorB}:${k.grassDot}:${k.grassDotJitter}:${k.scrubColorA}:${k.scrubColorB}:${k.scrubDot}:${k.scrubDotJitter}:${k.showWild}:${k.showInferred}:${plantTone.version}`;
        if (sig !== drawnGS.current) {
          drawnGS.current = sig;
          const fill = (pt: THREE.Points, v: Float32Array, ca: string, cb: string, dot: number, jit: number, salt: number) => {
            const a = new THREE.Color(ca), b = new THREE.Color(cb), c = new THREE.Color();
            const pos: number[] = [], col: number[] = [], ps: number[] = [];
            for (let i = 0; i * 5 + 4 < v.length; i++) {
              const wild = v[i * 5 + 4] > 0.5;
              if (wild ? !k.showWild : !k.showInferred) continue;
              pos.push(v[i * 5], v[i * 5 + 1] * unit, v[i * 5 + 2]);
              const sh = v[i * 5 + 3];
              plantColor(c, a.r + (b.r - a.r) * sh, a.g + (b.g - a.g) * sh, a.b + (b.b - a.b) * sh, rnd(i, salt));
              col.push(c.r, c.g, c.b);
              ps.push(dot * Math.max(0.15, 1 + (rnd(i, salt + 1.3) - 0.5) * 2 * jit));
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
            geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
            geo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(ps), 1));
            pt.geometry.dispose();
            pt.geometry = geo;
          };
          fill(gp, r.vegGrass ?? new Float32Array(0), k.grassColorA, k.grassColorB, k.grassDot, k.grassDotJitter, 2.1);
          fill(sp2, r.vegScrub ?? new Float32Array(0), k.scrubColorA, k.scrubColorB, k.scrubDot, k.scrubDotJitter, 3.7);
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
        const sig = `${futureLink.version}:${unit}:${cA}:${cB}:${plantTone.version}`;
        if (sig !== drawnWild.current) {
          drawnWild.current = sig;
          const v = r.vegWild ?? new Float32Array(0), np = Math.floor(v.length / 4);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3), a = new THREE.Color(cA), b = new THREE.Color(cB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 4];
            pos[i * 3 + 1] = v[i * 4 + 1] * unit;
            pos[i * 3 + 2] = v[i * 4 + 2];
            const sh = v[i * 4 + 3];
            plantColor(tone.c, a.r + (b.r - a.r) * sh, a.g + (b.g - a.g) * sh, a.b + (b.b - a.b) * sh, rnd(i, 5.3));
            col[i * 3] = tone.c.r;
            col[i * 3 + 1] = tone.c.g;
            col[i * 3 + 2] = tone.c.b;
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
    lap("plant clouds");
    const inferred = three.scene.getObjectByName("future-veg");
    if (inferred) inferred.visible = k.showInferred;
    const tp = treePts.current, tl = treeStemMesh.current, cl = clumps.current;
    // (a handle for measuring — what each part of the layer costs is found by hiding it: perf is measured on the real world)
    (window as unknown as { __futureTrees?: unknown }).__futureTrees = { tp, tl, cl, clumpGeo, life: lifeU.value, r, three };
    if (tp && tl && cl) {
      const lined = k.treeStemMode === "line" || k.treeStemMode === "branch";
      const asClumps = k.treeCrownMode === "clumps";
      tp.visible = layerOn && !asClumps;
      // (the leaves are points too: treePts)
      tl.visible = layerOn && lined;
      cl.visible = layerOn && asClumps;
      if (footPts.current) footPts.current.visible = layerOn && k.treeFoot > 0;
      if (r && layerOn) {
        tp.position.y = tl.position.y = cl.position.y = base + 0.04;
        if (footPts.current) footPts.current.position.y = base + 0.03;
        clumpMat.size = k.treeClumpDot;
        (tl.material as THREE.MeshStandardMaterial).roughness = k.treeStemRough;
        const sig = `${recSum(r.treeStems)}:${unit}:${k.treePointJitter}:${k.treeStemMode}:${k.treeCrownMode}:${k.treeKind1}:${k.treeKind2}:${k.treeKind3}:${k.treeKind4}:${k.treeKind5}:${k.treeKind6}:${k.treeKindShade}:${k.treeColorJitter}:${k.treeStemColor}:${k.treeBend}:${k.treeTwigs}:${k.treeTrunkR}:${k.treeBoughR}:${k.treeTwigR}:${k.treeStemThickJitter}:${k.treeStemColorJitter}:${k.treeClumps}:${k.treeClumpSize}:${k.treeClumpJitter}:${k.showWild}:${clumpGeo.id}:${k.treeLeaves}:${k.treeLeafSpread}:${plantTone.version}:${k.treeSpecies}:${k.treeGather}:${k.treeCrowd}:${k.treeCrowdR}:${k.treeEdgeLean}:${k.treeStemBySize}:${k.treeDotsBySize}:${k.treeStemKindLink}:${k.treeTaper}:${k.treeRoots}:${k.treeFoot}:${k.stainColor}:${k.stoneColor}:${k.stoneSize}:${k.stainPtSize}`;
        if (sig !== drawnTrees.current) {
          drawnTrees.current = sig;
          const kindCols = [k.treeKind1, k.treeKind2, k.treeKind3, k.treeKind4, k.treeKind5, k.treeKind6].map((c) => new THREE.Color(c));
          const a = kindCols[0].clone().offsetHSL(0, 0, -k.treeKindShade), b = kindCols[0].clone().offsetHSL(0, 0.04, k.treeKindShade), tc = new THREE.Color();
          const asLeaves = k.treeCrownMode === "leaves";
          // THE CROWN AS POINTS (as before; the trees' own colours — the wild forest's left out when it is hidden)
          const pos: number[] = [], col: number[] = [], ps: number[] = [];
          if (!asClumps && !asLeaves) {
            const v = r.vegTree ?? new Float32Array(0);
            for (let i = 0; i * 5 + 4 < v.length; i++) {
              if (!k.showWild && v[i * 5 + 4] > 1.5) continue;
              pos.push(v[i * 5], v[i * 5 + 1] * unit, v[i * 5 + 2]);
              const sh = v[i * 5 + 3];
              plantColor(tc, a.r + (b.r - a.r) * sh, a.g + (b.g - a.g) * sh, a.b + (b.b - a.b) * sh, rnd(i, 7.7));
              col.push(tc.r, tc.g, tc.b);
              ps.push(Math.max(0.15, 1 + (rnd(i, 3.1) - 0.5) * 2 * k.treePointJitter));
            }
          }
          // EACH TREE: [x, z, foot, stem, crown's radius, crown from, crown to, its own number, shape, wild, kind] (11)
          const st0 = r.treeStems ?? new Float32Array(0), STRIDE = 11;
          // (the trees that came and those that went, by their own number — kept from one layer to the next)
          const TL = treeLife.current, nowS = performance.now() / 1000;
          if (TL.version !== futureLink.version) {
            // (the trees that come take their turns one after another over the ticker's seconds, those that go too —
            // in an order of their own numbers: a wood fills and empties tree by tree, 차자자작)
            const T = Math.max(0, k.ticker), turn = (id: number) => nowS + rnd(id * 13.7, 4.1) * T;
            const recs = new Map<number, Float32Array>(), born = new Map<number, number>();
            for (let i = 0; i + STRIDE - 1 < st0.length; i += STRIDE) recs.set(st0[i + 7], st0.subarray(i, i + STRIDE));
            for (const id of recs.keys()) born.set(id, TL.first ? -1e9 : (TL.born.get(id) ?? turn(id)));
            const dying = TL.dying.filter((dd) => nowS - dd.died < T + 1);
            if (!TL.first) for (const [id, rec] of TL.recs) if (!recs.has(id)) dying.push({ rec: Float32Array.from(rec), born: TL.born.get(id) ?? -1e9, died: turn(id) });
            Object.assign(TL, { version: futureLink.version, first: false, recs, born, dying });
          }
          const nLive = Math.floor(st0.length / STRIDE);
          const st = new Float32Array((nLive + TL.dying.length) * STRIDE);
          st.set(st0.subarray(0, nLive * STRIDE));
          TL.dying.forEach((dd, j) => st.set(dd.rec, (nLive + j) * STRIDE));
          const lifeOf = (ti: number): [number, number] => (ti < nLive ? [TL.born.get(st[ti * STRIDE + 7]) ?? -1e9, -1] : [TL.dying[ti - nLive].born, TL.dying[ti - nLive].died]);
          // (every piece of wood drawn: its kind, the tree it is of and its place there, and the tree's coming and going;
          // the trees whose leaves are drawn)
          const kinds: number[] = [], ownerLife: number[] = [], pieceG: TreeGrown[] = [], pieceL: number[] = [], leafG: TreeGrown[] = [];
          // (the trees grown so far, by what they are and the knobs they were grown with — kept while those knobs stay)
          const TC = treeCache.current, shapeSig = sig.slice(sig.indexOf(":") + 1);
          if (TC.sig !== shapeSig) {
            TC.map.clear();
            TC.sig = shapeSig;
          }
          TC.used.clear();
          // (THE FOOT: dark earth and stones round a big tree's foot — points of their own, coming and going with it)
          const footP: number[] = [], footC: number[] = [], footS: number[] = [], footL: number[] = [];
          const footSoil = new THREE.Color(k.stainColor), footStone = new THREE.Color(k.stoneColor);
          // (each kind's crown lightness against the mean of the kinds: its stem as much lighter or darker)
          const kindL = kindCols.map((c) => c.getHSL({ h: 0, s: 0, l: 0 }).l), meanL = kindL.slice(0, Math.max(1, Math.min(6, k.treeSpecies))).reduce((x, y) => x + y, 0) / Math.max(1, Math.min(6, k.treeSpecies));
          const cen = clumpGeo.getAttribute("iCenter") as THREE.InstancedBufferAttribute, ccol = clumpGeo.getAttribute("color") as THREE.InstancedBufferAttribute;
          const cLifeA = clumpGeo.getAttribute("iLife") as THREE.InstancedBufferAttribute, cla = cLifeA.array as Float32Array;
          const ca = cen.array as Float32Array, cc = ccol.array as Float32Array;
          let nc = 0;
          const LEAF_CAP = 90000;
          // (how many clumps a tree's crown wants: by its size and by the wood round it)
          const plannedClumps = (q: number, shape: number): number => Math.max(1, Math.round(k.treeClumps * (shape > 1.5 ? 1.3 : 1) * Math.max(0.3, Math.min(3, 1 + k.treeGather * (Math.sqrt(relSize[q]) - 1))) * (1 + k.treeCrowd * crowd[q]) * Math.max(0.25, Math.min(6, Math.pow(Math.max(0.1, relSize[q]), k.treeDotsBySize)))));
          let clumpShare = 1;
          // (each tree's size against the middle one's, and how many trees stand round it — the crowns fuller on the big
          // trees and where the wood is thick, so that they close over it; a lone tree stays as it is)
          const nTree = Math.floor(st.length / STRIDE), relSize = new Float32Array(nTree).fill(1), crowd = new Float32Array(nTree);
          // (and which way the wood is open from it: away from its neighbours' middle, by how lopsided they stand — a
          // tree at the wood's edge reaches out to the light, one inside or alone does not)
          const leanX = new Float32Array(nTree), leanZ = new Float32Array(nTree);
          if (asClumps && nTree > 1 && (k.treeGather > 0 || k.treeCrowd > 0 || k.treeEdgeLean > 0 || k.treeDotsBySize > 0)) {
            const reach = Math.max(0.5, k.treeCrowdR) * 1.2, grid = new Map<string, number[]>();
            for (let q = 0; q < nTree; q++) {
              const o = q * STRIDE, g = `${Math.floor(st[o] / reach)},${Math.floor(st[o + 1] / reach)}`;
              relSize[q] = st[o + 4] * Math.max(1e-4, st[o + 6] - st[o + 5]);
              const cellList = grid.get(g);
              if (cellList) cellList.push(q);
              else grid.set(g, [q]);
            }
            // (against the mean tree of the knobs — not the middle one of the trees there are now, which moved with each)
            const mid = Math.max(1e-6, 1.3 * k.treeCrown * CELL_SIZE * 0.6 * 1.3 * k.treeCrown);
            for (let q = 0; q < nTree; q++) {
              const o = q * STRIDE, gx = Math.floor(st[o] / reach), gz = Math.floor(st[o + 1] / reach);
              let near = 0, mx = 0, mz = 0;
              for (let dx = -1; dx <= 1; dx++)
                for (let dz = -1; dz <= 1; dz++)
                  for (const w of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
                    const ox = st[w * STRIDE] - st[o], oz = st[w * STRIDE + 1] - st[o + 1];
                    if (w === q || Math.hypot(ox, oz) >= reach) continue;
                    near++;
                    mx += ox;
                    mz += oz;
                  }
              crowd[q] = Math.min(1, near / 6);
              if (near > 0) {
                // (the neighbours' middle, against the reach: 0 = all round it … 1 = all on one side)
                mx /= near * reach;
                mz /= near * reach;
                leanX[q] = -mx;
                leanZ[q] = -mz;
              }
              relSize[q] /= mid;
            }
          }
          // EVERY TREE ITS CROWN (the artist, 2026-11-18: "외곽에 잎도 없이 나는 줄기가 좀 흉함"): the clumps were handed out in
          // the trees' order until the cap ran out, and the trees last in it — those furthest out — stood bare. Now the
          // clumps all the trees want are counted first, and every tree's share is cut down alike to fit the cap
          if (asClumps) {
            let want = 0;
            for (let i = 0; i + STRIDE - 1 < st.length; i += STRIDE) if (k.showWild || st[i + 9] <= 0.5) want += plannedClumps(i / STRIDE, st[i + 8]);
            clumpShare = Math.min(1, CLUMP_CAP / Math.max(1, want));
          }
          for (let i = 0; i + STRIDE - 1 < st.length; i += STRIDE) {
            if (!k.showWild && st[i + 9] > 0.5) continue;
            // (ti: its place among the trees now, for the arrays of this pass; t: ITS OWN NUMBER, for everything drawn by
            // chance — not its place, which moved with every tree that came or went: step 1, 2026-11-18)
            const ti = i / STRIDE, t = (st[i + 7] * 997.13) % 1000;
            const [bornT, diedT] = lifeOf(ti);
            const tr: StemTree = { x: st[i], z: st[i + 1], foot: st[i + 2] * unit, tall: st[i + 3] * unit, R: st[i + 4], lo: st[i + 5] * unit, hi: st[i + 6] * unit, own: st[i + 7], cone: st[i + 8] > 0.5 && st[i + 8] < 1.5 };
            const shape = st[i + 8];
            // (its kind: the crown's two colours turned along the hue its kind's way — treeSpecies)
            // (its kind: the worker's — FutureConfig.tree.kinds — so its colour goes with its shape and size)
            const sp = Math.max(0, Math.min(k.treeSpecies - 1, Math.round(st[i + 10] ?? 0)));
            const kc = kindCols[sp] ?? a, sa = kc.clone().offsetHSL(0, 0, -k.treeKindShade), sb = kc.clone().offsetHSL(0, 0.04, k.treeKindShade);
            // (and the tree's size against the knobs' mean tree — its crown's width and its stem's height: a stem as thick
            // as its tree is big)
            const sizeF = Math.sqrt(Math.max(0.01, (st[i + 4] / Math.max(1e-4, 1.3 * k.treeCrown * CELL_SIZE)) * (st[i + 3] / Math.max(1e-4, 1.55 * k.treeHeight))));
            // (how big it is for its foot: nothing under the mean tree, all of it at twice its size)
            const bigF = Math.max(0, Math.min(1, (sizeF - 0.8) / 0.9));
            // EACH TREE GROWN ONCE (the artist, 2026-11-18: "여튼 최적화가 진짜 큰 문제" — measured on the artist's world, the
            // trees took 190 ms, up to 450, every time a layer came, every tree's branches and leaves grown again): a tree's
            // wood and leaves depend only on its record and the knobs, so they are kept by both and only a tree that is
            // new, or changed, is grown
            const gKey = `${st[i + 7]}|${st[i]}|${st[i + 1]}|${st[i + 2]}|${st[i + 3]}|${st[i + 4]}|${st[i + 5]}|${st[i + 6]}|${st[i + 8]}|${st[i + 10]}`;
            let g = TC.map.get(gKey);
            if (!g) {
              const gs: number[] = [], gf: number[] = [], gk: number[] = [];
              if (k.treeStemMode === "line") {
                gs.push(tr.x, tr.foot, tr.z, tr.x, tr.foot + tr.lo + (tr.hi - tr.lo) * (tr.cone ? 0.92 : 0.5), tr.z);
                gf.push(0, 0.6);
                gk.push(0);
              } else if (k.treeStemMode === "branch") growStem(gs, gf, gk, tr, t, k.treeBend, k.treeTwigs, Math.round(k.treeRoots * bigF));
              const lp: number[] = [], lc: number[] = [], lz: number[] = [];
              // LEAVES ON THE TWIGS (the artist, 2026-11-17: "어떻게 하면 자연스럽게 줄기에 붙은 잎 느낌 낼 수 있을지" — and the
              // clumps cost more): a few points on the outer half of every bough and along every twig, thickest at the
              // tips, held close to the wood — the crown is where the branches end. The branches are grown for it even
              // when they are not drawn.
              if (asLeaves) {
                let ls = gs, lf = gf, lk = gk;
                if (k.treeStemMode !== "branch") {
                  ls = [];
                  lf = [];
                  lk = [];
                  growStem(ls, lf, lk, tr, t, k.treeBend, Math.max(1, k.treeTwigs));
                }
                const H = Math.max(1e-4, tr.hi - tr.lo), hold = tr.R * 0.18 * k.treeLeafSpread;
                for (let q2 = 0; q2 < lk.length; q2++) {
                  const f0 = lf[q2 * 2], f1 = lf[q2 * 2 + 1];
                  if (f1 < 0.45) continue;
                  const nL = Math.round(k.treeLeaves * (lk[q2] === 2 ? 1 : 0.6) * (0.5 + f1));
                  for (let j = 0; j < nL; j++) {
                    const u = Math.pow(rnd(q2 + t * 13.1, j), 0.6), th = rnd(j * 3.1, q2 + t) * 6.2832, rr = hold * Math.sqrt(rnd(q2, j * 1.7 + t));
                    const ax = ls[q2 * 6], ay = ls[q2 * 6 + 1], az = ls[q2 * 6 + 2], bx = ls[q2 * 6 + 3], by = ls[q2 * 6 + 4], bz = ls[q2 * 6 + 5];
                    const y = ay + (by - ay) * u + (rnd(j, q2 * 2.3) - 0.35) * hold;
                    lp.push(ax + (bx - ax) * u + Math.cos(th) * rr, y, az + (bz - az) * u + Math.sin(th) * rr);
                    const upS = Math.max(0, Math.min(1, ((y - tr.foot - tr.lo) / H) * 0.7 + (f0 + (f1 - f0) * u) * 0.3));
                    const jit = 1 + (rnd(t, j * 0.7 + q2) - 0.5) * 2 * k.treeColorJitter * 0.5;
                    plantColor(tc, (sa.r + (sb.r - sa.r) * upS) * jit, (sa.g + (sb.g - sa.g) * upS) * jit, (sa.b + (sb.b - sa.b) * upS) * jit, rnd(t * 1.3, j + q2));
                    lc.push(tc.r, tc.g, tc.b);
                    lz.push(Math.max(0.15, 1 + (rnd(j * 1.1, q2 + 0.3) - 0.5) * 2 * k.treePointJitter));
                  }
                }
              }
              // (its pieces laid out once: each as thick as its kind's knob, thinning to the tips, the tree thicker or
              // thinner by its own number and by its size; and its stem's one lightness, by its own number and its kind)
              const gm = new Float32Array(gk.length * 16), { m: M, p: P3, q: Q, s: SV, up: UP, d: D } = tmp;
              const thick = Math.max(0.2, 1 + (rnd(tr.own * 97, 5.3) - 0.5) * 2 * k.treeStemThickJitter) * Math.pow(Math.max(0.05, sizeF), k.treeStemBySize);
              for (let q2 = 0; q2 < gk.length; q2++) {
                const ax = gs[q2 * 6], ay = gs[q2 * 6 + 1], az = gs[q2 * 6 + 2], bx = gs[q2 * 6 + 3], by = gs[q2 * 6 + 4], bz = gs[q2 * 6 + 5];
                const len = Math.hypot(bx - ax, by - ay, bz - az);
                P3.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
                if (len > 1e-5) Q.setFromUnitVectors(UP, D.set((bx - ax) / len, (by - ay) / len, (bz - az) / len));
                else Q.identity();
                const f = (gf[q2 * 2] + gf[q2 * 2 + 1]) / 2, kd = gk[q2];
                const rr = (kd === 0 ? k.treeTrunkR : kd === 1 ? k.treeBoughR : k.treeTwigR) * (1 - k.treeTaper * f) * thick;
                SV.set(rr, Math.max(1e-4, len * 1.04), rr);
                M.compose(P3, Q, SV).toArray(gm, q2 * 16);
              }
              Q.identity();
              const kindF = Math.max(0.4, Math.min(1.8, 1 + k.treeStemKindLink * ((kindL[sp] ?? meanL) - meanL) * 2.5));
              const lum = Math.max(0.08, (1 + (rnd(tr.own * 53, 9.1) - 0.5) * 2 * k.treeStemColorJitter) * kindF);
              g = { kinds: Uint8Array.from(gk), mat: gm, lum, lp: Float32Array.from(lp), lc: Float32Array.from(lc), lz: Float32Array.from(lz) };
              TC.map.set(gKey, g);
            }
            TC.used.add(gKey);
            // (the stem)
            const before = kinds.length;
            for (let q2 = 0; q2 < g.kinds.length; q2++) {
              kinds.push(g.kinds[q2]);
              pieceG.push(g);
              pieceL.push(q2);
              ownerLife.push(bornT, diedT);
            }
            // THE FOOT: dark earth spread round it, thickest at the trunk, and stones among it — the more and the wider
            // the bigger the tree (the earth its leaves have made, the stones its roots have lifted)
            if (k.treeFoot > 0 && bigF > 0) {
              const nS = Math.round(40 * bigF * k.treeFoot), nR = Math.round(6 * bigF * k.treeFoot), rad = tr.R * (0.35 + 0.35 * bigF);
              for (let j = 0; j < nS + nR; j++) {
                const stone = j >= nS, u = rnd(t + j * 0.71, 3.3), th = rnd(j * 1.37, t + 5.1) * 6.2832, rr = rad * (stone ? 0.25 + 0.6 * u : Math.pow(u, 0.8));
                footP.push(tr.x + Math.cos(th) * rr, tr.foot + (stone ? 0.02 : 0.005) * unit * rnd(j, t), tr.z + Math.sin(th) * rr);
                const sh = stone ? 0.75 + 0.5 * rnd(t, j * 2.3) : 0.8 + 0.3 * rnd(j * 3.1, t);
                const c = stone ? footStone : footSoil;
                footC.push(c.r * sh, c.g * sh, c.b * sh);
                footS.push(stone ? k.stoneSize * (0.6 + 0.9 * rnd(j, t * 1.3)) : k.stainPtSize * (0.6 + 0.8 * rnd(t * 0.7, j)));
                footL.push(bornT < -1e8 ? -1e9 : bornT, diedT >= 0 ? diedT + 0.45 : 0);
              }
            }
            if (asLeaves) {
              leafG.push(g);
              continue;
            }
            const H = Math.max(1e-4, tr.hi - tr.lo);
            // (the crown's clumps, by its shape: a ball round the crown's middle, a cone narrowing upward, an umbrella flat
            // at the top — each clump its own size, the colour lighter up and out)
            if (!asClumps) continue;
            const nClump = Math.max(1, Math.round(plannedClumps(ti, shape) * clumpShare));
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
              rad *= Math.max(0.2, 1 + (rnd(c, t * 1.7) - 0.5) * 2 * k.treeClumpJitter) * (1 + 0.35 * k.treeCrowd * crowd[ti]);
              // (reaching out at the wood's edge: the upper clumps the more)
              const out = k.treeEdgeLean * tr.R * 1.2 * (0.4 + 0.6 * Math.max(0, Math.min(1, (y - tr.lo) / H)));
              ca[nc * 4] = tr.x + Math.cos(th) * rx + leanX[ti] * out;
              ca[nc * 4 + 1] = tr.foot + y;
              ca[nc * 4 + 2] = tr.z + Math.sin(th) * rx + leanZ[ti] * out;
              ca[nc * 4 + 3] = rad;
              cla[nc * 2] = bornT;
              cla[nc * 2 + 1] = diedT;
              const up = Math.max(0, Math.min(1, (y - tr.lo) / H * 0.7 + (rx / Math.max(1e-4, tr.R)) * 0.3));
              const jit = 1 + (rnd(t, c * 2.3) - 0.5) * 2 * k.treeColorJitter * 0.5;
              plantColor(tc, (sa.r + (sb.r - sa.r) * up) * jit, (sa.g + (sb.g - sa.g) * up) * jit, (sa.b + (sb.b - sa.b) * up) * jit, rnd(t * 2.1, c));
              cc[nc * 3] = tc.r;
              cc[nc * 3 + 1] = tc.g;
              cc[nc * 3 + 2] = tc.b;
              nc++;
            }
          }
          for (const key of TC.map.keys()) if (!TC.used.has(key)) TC.map.delete(key);
          cen.needsUpdate = true;
          cLifeA.needsUpdate = true;
          ccol.needsUpdate = true;
          clumpGeo.instanceCount = nc;
          const geo = new THREE.BufferGeometry();
          if (asLeaves) {
            // (the leaves, copied whole from each tree's — as far as the cap goes)
            let nl = 0;
            for (const lg of leafG) nl += lg.lz.length;
            nl = Math.min(nl, LEAF_CAP);
            const LP = new Float32Array(nl * 3), LC = new Float32Array(nl * 3), LZ = new Float32Array(nl);
            let w = 0;
            for (const lg of leafG) {
              const c = Math.min(lg.lz.length, nl - w);
              if (c <= 0) break;
              LP.set(lg.lp.subarray(0, c * 3), w * 3);
              LC.set(lg.lc.subarray(0, c * 3), w * 3);
              LZ.set(lg.lz.subarray(0, c), w);
              w += c;
            }
            geo.setAttribute("position", new THREE.BufferAttribute(LP, 3));
            geo.setAttribute("color", new THREE.BufferAttribute(LC, 3));
            geo.setAttribute("psize", new THREE.BufferAttribute(LZ, 1));
          } else {
            geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
            geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
            geo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(ps), 1));
          }
          tp.geometry.dispose();
          tp.geometry = geo;
          // THE STEM AS THIN CYLINDERS — the trunk, the boughs and the twigs each as thick as its knob says, thinning a
          // little towards the tips, each tree thicker or thinner and lighter or darker by its own number; the colour
          // from the stem's at the foot into the crown's
          const sc = new THREE.Color(k.treeStemColor);
          // EVERY TREE ITS TRUNK FIRST (the artist, 2026-11-17: "어떤 나무는 줄기가 안 보임" — the pieces past the cap were
          // the later trees' whole stems): all trunks, then the boughs, then the twigs, as far as the cap goes
          const total = kinds.length, order: number[] = [];
          const stemInfoA = stemGeo.getAttribute("iStem") as THREE.InstancedBufferAttribute, stemInfo = stemInfoA.array as Float32Array;
          for (const want of [0, 1, 2]) for (let j = 0; j < total && order.length < STEM_CAP; j++) if (kinds[j] === want) order.push(j);
          const n = order.length, marr = tl.instanceMatrix.array as Float32Array, carr = tl.instanceColor ? (tl.instanceColor.array as Float32Array) : null;
          // (each piece copied as its tree laid it out — the tree's one lightness; ONE COLOUR A TREE, the artist,
          // 2026-11-18: "줄기 명도 지터는 ㅋㅋㅋ 한 나무 안에서는 색이 같아야지...")
          for (let o = 0; o < n; o++) {
            const i = order[o], g2 = pieceG[i], li = pieceL[i];
            marr.set(g2.mat.subarray(li * 16, li * 16 + 16), o * 16);
            stemInfo[o * 3] = kinds[i];
            stemInfo[o * 3 + 1] = ownerLife[i * 2] ?? -1e9;
            stemInfo[o * 3 + 2] = ownerLife[i * 2 + 1] ?? -1;
            if (carr) {
              carr[o * 3] = sc.r * g2.lum;
              carr[o * 3 + 1] = sc.g * g2.lum;
              carr[o * 3 + 2] = sc.b * g2.lum;
            }
          }
          tl.count = n;
          // (the feet)
          const fp = footPts.current;
          if (fp) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(footP), 3));
            geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(footC), 3));
            geo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(footS), 1));
            geo.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(footL), 2));
            fp.geometry.dispose();
            fp.geometry = geo;
          }
          stemInfoA.needsUpdate = true;
          tl.instanceMatrix.needsUpdate = true;
          if (tl.instanceColor) tl.instanceColor.needsUpdate = true;
        }
      }
    }

    lap("trees");
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
  };

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
        <meshStandardMaterial color={k.color} roughness={0.9} metalness={0} onBeforeCompile={edgeFade} customProgramCacheKey={() => "future-edge-pipes"} />
      </instancedMesh>
      {/* the water's belt of plants (stage: "물길은 … 식생 띠로") */}
      <points ref={waterPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation onBeforeCompile={edgeFade} customProgramCacheKey={() => "future-edge-points"} />
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
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} onBeforeCompile={lifeDissolve} customProgramCacheKey={() => "future-life-dissolve"} />
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
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} onBeforeCompile={lifeDissolve} customProgramCacheKey={() => "future-life-dissolve"} />
      </instancedMesh>
      {/* the trees: their points, each with its own size, and their stems as lines (when the knob says so) */}
      {/* the feet of the big trees: their dark earth and stones (나무 › treeFoot) */}
      <points ref={footPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={lifePoints} customProgramCacheKey={() => "future-life-points"} />
      </points>
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
        args={[stemGeo, stemMat, STEM_CAP]}
        frustumCulled={false}
      />
      <points ref={clumps} geometry={clumpGeo} material={clumpMat} frustumCulled={false} />
      <points ref={plantPts} geometry={plantGeo} material={plant.mat} frustumCulled={false} />
      <points ref={glowPts} geometry={plantGeo} material={glow.mat} frustumCulled={false} renderOrder={2} />
      <points ref={grassPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={sizedPoints} customProgramCacheKey={() => "future-tree-points"} />
      </points>
      <points ref={scrubPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={sizedPoints} customProgramCacheKey={() => "future-tree-points"} />
      </points>
      <points ref={stonePts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={lifePoints} customProgramCacheKey={() => "future-life-points"} />
      </points>
      <points ref={wildPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation onBeforeCompile={edgeFade} customProgramCacheKey={() => "future-edge-points"} />
      </points>
      {/* the mounds and the dark earth as points (the knob depositPoints), each point with its own size */}
      <points ref={depPts} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={1} sizeAttenuation onBeforeCompile={lifePoints} customProgramCacheKey={() => "future-life-points"} />
      </points>
      {/* the other plants, of ground that was built on for long (stage 5) */}
      <points ref={other} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation onBeforeCompile={edgeFade} customProgramCacheKey={() => "future-edge-points"} />
      </points>
    </>
  );
}
