"use client";
/**
 * usePersonalVisuals — the Leva folder "개인뷰 비주얼" (V2): what the player view adds on top of the ground so the
 * visitor's effect on it lands — switchable VERSIONS, so the artist compares them one at a time
 * (docs/session-logic.md §12).
 *   footprint   the end screen's footprint map (FootprintMap)
 *   grass       how the grass reacts to the walker at once (NatureCloud GrassReaction; RoleField feeds the trail):
 *               A0 off · A1 press · A2 flatten and dry · A3 the walker's own stress raised
 *   stakes      markers stuck in the ground (Stakes): others · path junctions · building centres (stage 4b)
 */

import { useMemo } from "react";
import { folder, useControls } from "leva";
import { DEFAULT_STAKES, type StakesConfig } from "@/lib/parliament";
import type { GrassMode } from "./NatureCloud";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";

export interface GrassVisual {
  mode: GrassMode;
  /** World radius of the quick stress around each step, and how much it adds per second at the centre. */
  reactRadius: number;
  dose: number;
  /** How often (s) the trail is fed and the near cells laid out, and how far around the walker they reach. */
  nearEvery: number;
  nearRadius: number;
  /** A3: the walker's own folded stress × this. */
  mineGain: number;
}

export type StakesMode = "off" | "others" | "junctions" | "buildings" | "others+junctions" | "all";

export interface StakesVisual {
  mode: StakesMode;
  /** stakes.ts config (which kinds, heights, brightness …); `on` = any kind at all. */
  cfg: StakesConfig;
  on: boolean;
  width: number;
  blinkHz: number;
}

export interface PersonalVisuals {
  footprint: boolean;
  grass: GrassVisual;
  stakes: StakesVisual;
}

const STAKES_OPTIONS: Record<string, StakesMode> = {
  "B0 끔": "off",
  "B1 타인 — 시야 안 모두의 자리 (오래된 표본일수록 흐림, 움직이면 깜빡임)": "others",
  "B2 길 교차점 — 길이 만나는 칸 (세기만큼 높이)": "junctions",
  "B3 건물 — 붙어 있는 콘크리트의 중심 (높이만큼)": "buildings",
  "B1+B2": "others+junctions",
  "B1+B2+B3": "all",
};

const ROOT = "개인뷰 비주얼";

const GRASS_OPTIONS: Record<string, GrassMode> = {
  "A0 끔 (접기대로, 0.25 s)": "off",
  "A1 바로 눌림 — 발밑·지나온 자리의 풀이 즉시 줄어듦": "press",
  "A2 눕고 마름 — 점이 바로 눕고 색이 마른 뒤 줄어듦": "flatten",
  "A3 내 길만 세게 — 내 흔적의 스트레스를 배율로 (남의 자리는 그대로)": "mine",
};

export function usePersonalVisuals(): PersonalVisuals {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const c = useControls(
    ROOT,
    savable(ROOT, {
      footprint: { value: true, label: "퇴장 화면 발자국 지도", render: v2 },
      "풀 반응 (걷는 사람에게)": folder({
        grassMode: { options: GRASS_OPTIONS, value: "press" as GrassMode, label: "버전", render: v2 },
        reactRadius: { value: 1.5, min: 0.5, max: 4, step: 0.1, label: "반응 반경 (월드)", render: v2 },
        reactDose: { value: 0.6, min: 0, max: 3, step: 0.05, label: "반응 세기 (초당, 중심)", render: v2 },
        nearEvery: { value: 0.1, min: 0.05, max: 0.5, step: 0.05, label: "근접 갱신 (s)", render: v2 },
        nearRadius: { value: 3.5, min: 1.5, max: 8, step: 0.5, label: "근접 반경 (월드)", render: v2 },
        mineGain: { value: 2, min: 1, max: 6, step: 0.5, label: "A3: 내 스트레스 배율", render: v2 },
      }),
      "막대 (땅에 박힌 표식)": folder({
        stakesMode: { options: STAKES_OPTIONS, value: "off" as StakesMode, label: "버전", render: v2 },
        stakeHeight: { value: DEFAULT_STAKES.height, min: 0.2, max: 4, step: 0.1, label: "높이 (월드)", render: v2 },
        stakeWidth: { value: 0.04, min: 0.01, max: 0.3, step: 0.01, label: "굵기 (월드)", render: v2 },
        stakeBright: { value: DEFAULT_STAKES.bright, min: 0.1, max: 1, step: 0.05, label: "밝기", render: v2 },
        blinkHz: { value: 2, min: 0, max: 8, step: 0.5, label: "움직이는 타인 깜빡임 (Hz)", render: v2 },
        minNeighbours: { value: DEFAULT_STAKES.minNeighbours, min: 2, max: 4, step: 1, label: "교차점: 최소 이웃 길 칸 (4이웃)", render: v2 },
        recentSec: { value: DEFAULT_STAKES.recentSec, min: 1, max: 60, step: 1, label: "타인: 흐려지는 시간 (s)", render: v2 },
      }),
    }),
    { collapsed: false, order: 1 },
  );
  const grass = useMemo<GrassVisual>(
    () => ({ mode: c.grassMode, reactRadius: c.reactRadius, dose: c.reactDose, nearEvery: c.nearEvery, nearRadius: c.nearRadius, mineGain: c.mineGain }),
    [c.grassMode, c.reactRadius, c.reactDose, c.nearEvery, c.nearRadius, c.mineGain],
  );
  const stakes = useMemo<StakesVisual>(() => {
    const m = c.stakesMode;
    const cfg: StakesConfig = {
      ...DEFAULT_STAKES,
      others: m === "others" || m === "others+junctions" || m === "all",
      junctions: m === "junctions" || m === "others+junctions" || m === "all",
      buildings: m === "buildings" || m === "all",
      height: c.stakeHeight,
      bright: c.stakeBright,
      minNeighbours: c.minNeighbours,
      recentSec: c.recentSec,
    };
    return { mode: m, cfg, on: m !== "off", width: c.stakeWidth, blinkHz: c.blinkHz };
  }, [c.stakesMode, c.stakeHeight, c.stakeBright, c.minNeighbours, c.recentSec, c.stakeWidth, c.blinkHz]);
  return { footprint: c.footprint, grass, stakes };
}
