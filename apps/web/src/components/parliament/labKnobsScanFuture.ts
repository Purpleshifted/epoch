"use client";
/**
 * scan (future) · 미래의 장소 — the future's remains drawn over the present (FuturePresence.tsx, lib/parliament/futurePresence.ts).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page; FuturePresence.tsx (useFuturePresenceControls) assembles it into FuturePresenceVisual. Before
 * 2026-11-23 one group, "미래 (개인뷰 · 시험)", held both future groups (its saves are not read any more).
 */

import { button, folder, levaStore, useControls } from "leva";
import * as THREE from "three";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PRESENCE } from "@/lib/parliament/futurePresence";
import type { PresenceMode } from "./FuturePresence";
import { DEFAULT_RESIDUE, RESIDUE_PRESETS, setResidueLook } from "./FutureResidue";

/** The three kinds' blowing away as they start (FutureResidue.tsx DEFAULT_RESIDUE). */
const B = DEFAULT_RESIDUE.blow;

const PLACE_GROUP = LAB_GROUP["scan-future"];

/** THE PLANTS' PALETTE, HER OWN (the artist, 2026-11-27: "색 팔레트 내가 고를 수 있게"): six leaf colours and five flower
 *  colours, each a picker; the buttons load a reference's set into them (then she saves as ever). */
const LEAF_KEYS = ["resLeaf1", "resLeaf2", "resLeaf3", "resLeaf4", "resLeaf5", "resLeaf6"] as const;
const FLOWER_KEYS = ["resFlower1", "resFlower2", "resFlower3", "resFlower4", "resFlower5"] as const;
/** Sets a knob of this group by its key, wherever its folder puts it (the store's path ends with the key). */
function setKnob(key: string, value: unknown): void {
  const data = levaStore.getData() as Record<string, unknown>;
  for (const path of Object.keys(data)) if (path.startsWith(PLACE_GROUP + ".") && path.endsWith("." + key)) levaStore.setValueAtPath(path, value, true);
}
function loadPalette(leaves: readonly string[], flowers: readonly string[]): void {
  LEAF_KEYS.forEach((k, i) => setKnob(k, leaves[i % leaves.length]));
  FLOWER_KEYS.forEach((k, i) => setKnob(k, flowers[i % flowers.length]));
}
/** The old single green (식생 색), darker and lighter, as a palette. */
function greenPalette(hex: string): { leaves: string[]; flowers: string[] } {
  const c = new THREE.Color(hex), at = (m: number) => "#" + c.clone().multiplyScalar(m).getHexString();
  return { leaves: [at(0.55), at(0.8), at(1), at(1.15), at(0.7), at(1.3)], flowers: [at(1.5)] };
}
const PLACE_MODES: Record<string, PresenceMode> = {
  "겹침 — 현재 위에 남은 것이 함께 섬": "overlay",
  "렌즈 — 내 둘레 반경 안에서만": "lens",
  "들여다보기 — F (폰: 버튼)를 누르는 동안": "peek",
};

export function useScanFutureKnobs(isV2: boolean) {
  const v = useControls(
    PLACE_GROUP,
    savable(PLACE_GROUP, {
      overlayOn: { value: false, label: "개인뷰에 켜기 (랩의 이 페이지에서는 늘 보임)" },
      // THE SCAN'S RESIDUE (the artist, 2026-11-27: B, "있을 때만"): while the lidar reads the place, what it reads near the
      // future's remains develops them — only while a future observer is near; they blow away the way it walks when it
      // leaves (FutureResidue.tsx)
      "잔류 — 라이다 위의 미래": folder(
        {
          resGateR: { value: 12, min: 3, max: 40, step: 0.5, label: "관찰자가 있다고 보는 거리 (월드)" },
          resFind: { value: 0.6, min: 0.1, max: 3, step: 0.05, label: "스캔이 부재를 찾는 거리 (월드)" },
          resSpread: { value: 5, min: 0.5, max: 30, step: 0.5, label: "찾은 부재에 번지는 속도 (월드/s)" },
          resDevelop: { value: 1.2, min: 0, max: 5, step: 0.1, label: "하얗게 바래는 시간 (s)" },
          resLife: { value: 0, min: 0, max: 120, step: 1, label: "남는 시간 (s, 0 = 관찰자가 떠날 때까지)" },
          resDot: { value: 2, min: 0.5, max: 6, step: 0.1, label: "점 크기 (px)" },
          resReach: { value: 14, min: 4, max: 40, step: 0.5, label: "보이는 거리 (월드)" },
          resColour: { value: "#ffffff", label: "남은 부재의 색" },
          resConcrete: { value: 0.7, min: 0, max: 1, step: 0.05, label: "콘크리트 밝기 (철골·말뚝 = 1)" },
          resPlantDensity: { value: 8, min: 0, max: 60, step: 1, label: "식생 점 밀도" },
          // (A + C, the artist 2026-11-27: "미래 색을 좀 더 꿈처럼 다채롭게")
          "식생 팔레트 — 직접 고르기": folder(
            {
              "정원 IMG_1586 색 불러오기": button(() => loadPalette(RESIDUE_PRESETS.garden.leaves, RESIDUE_PRESETS.garden.flowers)),
              "밤 숲 IMG_1587 색 불러오기": button(() => loadPalette(RESIDUE_PRESETS.night.leaves, RESIDUE_PRESETS.night.flowers)),
              "초록 하나 (식생 색) 불러오기": button(() => {
                const g = greenPalette(String((levaStore.getData() as Record<string, { value?: unknown }>)[`${PLACE_GROUP}.미래 읽기.plantColor`]?.value ?? "#2f8f3f"));
                loadPalette(g.leaves, g.flowers);
              }),
              resLeaf1: { value: RESIDUE_PRESETS.garden.leaves[0], label: "잎 1" },
              resLeaf2: { value: RESIDUE_PRESETS.garden.leaves[1], label: "잎 2" },
              resLeaf3: { value: RESIDUE_PRESETS.garden.leaves[2], label: "잎 3" },
              resLeaf4: { value: RESIDUE_PRESETS.garden.leaves[3], label: "잎 4" },
              resLeaf5: { value: RESIDUE_PRESETS.garden.leaves[4], label: "잎 5" },
              resLeaf6: { value: RESIDUE_PRESETS.garden.leaves[5], label: "잎 6" },
              resFlower1: { value: RESIDUE_PRESETS.garden.flowers[0], label: "꽃 1" },
              resFlower2: { value: RESIDUE_PRESETS.garden.flowers[1], label: "꽃 2" },
              resFlower3: { value: RESIDUE_PRESETS.garden.flowers[2], label: "꽃 3" },
              resFlower4: { value: RESIDUE_PRESETS.garden.flowers[3], label: "꽃 4" },
              resFlower5: { value: RESIDUE_PRESETS.garden.flowers[4], label: "꽃 5" },
            },
            { collapsed: false },
          ),
          resSat: { value: 1, min: 0, max: 1.8, step: 0.05, label: "식생 채도" },
          resFlower: { value: 0.5, min: 0, max: 1, step: 0.05, label: "꽃 비율" },
          resTreeFull: { value: 4, min: 1, max: 10, step: 0.5, label: "나무 풍성함 (×)" },
          resSizeVar: { value: 0.6, min: 0, max: 1, step: 0.05, label: "점 크기 편차" },
          resSoft: { value: 0.6, min: 0, max: 1, step: 0.05, label: "점 부드러움 (0 = 현재처럼 또렷)" },
          // (the artist, 2026-11-27: "이 노출은 흩날리는 거 강조용보다는 실제 읽어오는 점 위치가 바뀌었을 때 그걸
          // 겹쳐보이게" — the readings' layers overlap; the blowing smear only an option, off)
          resLayerSec: { value: 0.5, min: 0.1, max: 4, step: 0.05, label: "미래 장노출 — 다시 읽어 겹치는 간격 (s)" },
          resJitter: { value: 0.04, min: 0, max: 0.3, step: 0.005, label: "미래 장노출 — 읽을 때마다 어긋남 (월드)" },
          resGhostLife: { value: 3, min: 0.2, max: 12, step: 0.1, label: "미래 장노출 — 이전 읽기가 남는 시간 (s)" },
          resGhostAlpha: { value: 0.45, min: 0, max: 1, step: 0.05, label: "미래 장노출 — 이전 읽기의 진하기 (0 = 없음)" },
          // (the artist, 2026-11-27: "글리치나 번짐효과 같은 것도 넣고 싶음" — on the earlier layers, more as they age)
          resBleed: { value: 0.5, min: 0, max: 1, step: 0.05, label: "이전 읽기 — 번짐" },
          resTear: { value: 0.3, min: 0, max: 1, step: 0.05, label: "이전 읽기 — 글리치: 가로 찢김" },
          resDrip: { value: 0.4, min: 0, max: 1, step: 0.05, label: "이전 읽기 — 글리치: 세로 흘러내림" },
          // ("점 크기나 밀도 포함")
          resBlock: { value: 0.35, min: 0, max: 1, step: 0.05, label: "이전 읽기 — 글리치: 블록 (빠짐 · 점 커짐)" },
          resThin: { value: 0.4, min: 0, max: 1, step: 0.05, label: "이전 읽기 — 오래될수록 성겨짐" },
          resExpose: { value: 0, min: 0, max: 3, step: 0.05, label: "흩날릴 때 번짐 (s, 0 = 없음)" },
          resStreak: { value: 0.45, min: 0, max: 1, step: 0.05, label: "흩날릴 때 번짐 진하기" },
          resStagger: { value: 1.2, min: 0, max: 4, step: 0.1, label: "바람이 훑고 지나가는 시간 (s)" },
          // (the artist, 2026-11-27: "줄기 / 잎/ 건물부재가 fade out 되는 방식을 따로 정하고 싶음 뭐 떠오르는 정도나 등등")
          "흩날림 — 건물 부재 (둔덕 · 흙 포함)": folder(
            {
              resBlowPartTime: { value: B.part.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              resBlowPartDist: { value: B.part.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              resBlowPartRise: { value: B.part.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              resBlowPartTurb: { value: B.part.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              resBlowPartBloom: { value: B.part.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
            },
            { collapsed: true },
          ),
          "흩날림 — 잎 (풀 · 꽃 포함)": folder(
            {
              resBlowLeafTime: { value: B.leaf.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              resBlowLeafDist: { value: B.leaf.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              resBlowLeafRise: { value: B.leaf.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              resBlowLeafTurb: { value: B.leaf.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              resBlowLeafBloom: { value: B.leaf.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
            },
            { collapsed: true },
          ),
          "흩날림 — 줄기": folder(
            {
              resBlowStemTime: { value: B.stem.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              resBlowStemDist: { value: B.stem.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              resBlowStemRise: { value: B.stem.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              resBlowStemTurb: { value: B.stem.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              resBlowStemBloom: { value: B.stem.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: false },
      ),
      overlayMode: { options: PLACE_MODES, value: "overlay" as PresenceMode, label: "방식 (라이다가 꺼져 있을 때)" },
      "보이는 것": folder(
        {
          radius: { value: 14, min: 4, max: 40, step: 1, label: "렌즈 반경" },
          everySec: { value: 2, min: 0.5, max: 10, step: 0.5, label: "미래를 다시 읽는 간격 (s)" },
          showRemains: { value: true, label: "남은 부재" },
          showPlants: { value: true, label: "식생" },
          showDeposits: { value: true, label: "둔덕 · 어두운 흙" },
          showTraces: { value: true, label: "내 흔적" },
          edgeColor: { value: "#8c8c8c", label: "남은 부재의 선 색" },
        },
        { collapsed: false },
      ),
      "미래 읽기": folder(
        {
          readLatest: { value: true, label: "가장 최근에 지어진 단을 읽음 (끔 = 내 시각)" },
          unit: { value: DEFAULT_PRESENCE.unit, min: 0.1, max: 2, step: 0.05, label: "한 단의 높이" },
          band: { value: DEFAULT_PRESENCE.band, min: 4, max: 40, step: 1, label: "변화를 읽는 범위 (단)" },
          ruin: { value: DEFAULT_PRESENCE.ruin, min: 0, max: 1, step: 0.05, label: "얼마나 삭았나" },
          maxBuildings: { value: DEFAULT_PRESENCE.maxBuildings, min: 10, max: 600, step: 10, label: "읽는 건물 수" },
          strip: { value: DEFAULT_PRESENCE.strip, min: 0, max: 1, step: 0.05, label: "먼저 버려진 건물이 뜯긴 정도" },
          lastSteel: { value: DEFAULT_PRESENCE.lastSteel, min: 0, max: 1, step: 0.05, label: "오래 남음 — 철골" },
          lastPile: { value: DEFAULT_PRESENCE.lastPile, min: 0, max: 1, step: 0.05, label: "오래 남음 — 말뚝" },
          wild: { value: 0.5, min: 0, max: 1, step: 0.05, label: "놔둔 땅의 숲 (0 = 없음)" },
          surface: { value: 30, min: 5, max: 120, step: 1, label: "부재 겉면의 점 밀도" },
          plantColor: { value: "#2f8f3f", label: "식생 색" },
        },
        { collapsed: true },
      ),
    }),
    { collapsed: false, order: 0.8, render: () => isV2 && labLists("scan-future") },
  );
  // (a plain module value, read per frame by FutureResidue — set before it reads it, as the lidar's look is)
  setResidueLook({
    on: v.overlayOn,
    gateR: v.resGateR,
    find: v.resFind,
    spread: v.resSpread,
    develop: v.resDevelop,
    life: v.resLife,
    dot: v.resDot,
    colour: v.resColour,
    concrete: v.resConcrete,
    plantDensity: v.resPlantDensity,
    leaves: LEAF_KEYS.map((k) => v[k]),
    flowers: FLOWER_KEYS.map((k) => v[k]),
    reach: v.resReach,
    expose: v.resExpose,
    streak: v.resStreak,
    layerSec: v.resLayerSec,
    jitter: v.resJitter,
    ghostLife: v.resGhostLife,
    ghostAlpha: v.resGhostAlpha,
    bleed: v.resBleed,
    tear: v.resTear,
    drip: v.resDrip,
    block: v.resBlock,
    thin: v.resThin,
    treeFull: v.resTreeFull,
    sat: v.resSat,
    flower: v.resFlower,
    sizeVar: v.resSizeVar,
    soft: v.resSoft,
    stagger: v.resStagger,
    blow: {
      part: { time: v.resBlowPartTime, dist: v.resBlowPartDist, rise: v.resBlowPartRise, turb: v.resBlowPartTurb, bloom: v.resBlowPartBloom },
      leaf: { time: v.resBlowLeafTime, dist: v.resBlowLeafDist, rise: v.resBlowLeafRise, turb: v.resBlowLeafTurb, bloom: v.resBlowLeafBloom },
      stem: { time: v.resBlowStemTime, dist: v.resBlowStemDist, rise: v.resBlowStemRise, turb: v.resBlowStemTurb, bloom: v.resBlowStemBloom },
    },
  });
  return v;
}
