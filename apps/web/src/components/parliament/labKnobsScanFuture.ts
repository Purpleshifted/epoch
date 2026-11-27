"use client";
/**
 * scan (future) · 미래의 장소 — the future's remains drawn over the present (FuturePresence.tsx, lib/parliament/futurePresence.ts).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page; FuturePresence.tsx (useFuturePresenceControls) assembles it into FuturePresenceVisual. Before
 * 2026-11-23 one group, "미래 (개인뷰 · 시험)", held both future groups (its saves are not read any more).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PRESENCE } from "@/lib/parliament/futurePresence";
import type { PresenceMode } from "./FuturePresence";
import { setResidueLook } from "./FutureResidue";

const PLACE_GROUP = LAB_GROUP["scan-future"];
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
          resColour: { value: "#ffffff", label: "남은 부재의 색" },
          resConcrete: { value: 0.7, min: 0, max: 1, step: 0.05, label: "콘크리트 밝기 (철골·말뚝 = 1)" },
          resPlantDensity: { value: 14, min: 0, max: 60, step: 1, label: "식생 점 밀도" },
          resScatter: { value: 2.5, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
          resScatterDist: { value: 5, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
          resStagger: { value: 1.2, min: 0, max: 4, step: 0.1, label: "흩날림 엇갈림 (s)" },
          resRise: { value: 1.2, min: 0, max: 6, step: 0.1, label: "위로 뜨는 정도 (월드)" },
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
    scatter: v.resScatter,
    scatterDist: v.resScatterDist,
    stagger: v.resStagger,
    rise: v.resRise,
  });
  return v;
}
