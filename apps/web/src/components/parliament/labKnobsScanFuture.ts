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

const PLACE_GROUP = LAB_GROUP["scan-future"];
const PLACE_MODES: Record<string, PresenceMode> = {
  "겹침 — 현재 위에 남은 것이 함께 섬": "overlay",
  "렌즈 — 내 둘레 반경 안에서만": "lens",
  "들여다보기 — F (폰: 버튼)를 누르는 동안": "peek",
};

export function useScanFutureKnobs(isV2: boolean) {
  return useControls(
    PLACE_GROUP,
    savable(PLACE_GROUP, {
      overlayOn: { value: false, label: "개인뷰에 켜기 (랩의 이 페이지에서는 늘 보임)" },
      overlayMode: { options: PLACE_MODES, value: "overlay" as PresenceMode, label: "방식" },
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
}
