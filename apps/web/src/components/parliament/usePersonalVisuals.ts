"use client";
/**
 * usePersonalVisuals — the Leva folder "개인뷰 비주얼" (V2): what the player view adds on top of the ground so the
 * visitor's effect on it lands, and what stands in the frame — switchable, so the artist compares versions
 * (docs/session-logic.md §12). The pixel feel stays in the TEXT; the 3D is free of it (2026-10-28).
 *   footprint   the end screen's footprint map (FootprintMap)
 *   grass       how the grass reacts to the walker at once (NatureCloud GrassReaction) and how thick it stands
 *   marks       the others as square dots at eye height, the concrete as vertical lines, the paths as flat
 *               horizontal ribbons a little below the eye (Marks.tsx, lib/parliament/marks.ts)
 */

import { useMemo } from "react";
import { folder, useControls } from "leva";
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
  /** The vertical spread of the grass points (1 = the old spread). */
  thick: number;
}

export interface MarksVisual {
  others: { on: boolean; size: number; eyeOffset: number; bright: number; recentSec: number };
  concrete: { on: boolean; height: number; bright: number; radius: number };
  paths: { on: boolean; drop: number; bright: number; radius: number; per: number; width: number; opacity: number; groundLine: number };
  on: boolean;
}

export interface PersonalVisuals {
  footprint: boolean;
  grass: GrassVisual;
  marks: MarksVisual;
}

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
      "풀 (식생)": folder({
        grassThick: { value: 2, min: 1, max: 6, step: 0.25, label: "두께 — 세로 분포 배율 (1 = 예전)", render: v2 },
        grassMode: { options: GRASS_OPTIONS, value: "press" as GrassMode, label: "걷는 사람에게 반응", render: v2 },
        reactRadius: { value: 1.5, min: 0.5, max: 4, step: 0.1, label: "반응 반경 (월드)", render: v2 },
        reactDose: { value: 0.6, min: 0, max: 3, step: 0.05, label: "반응 세기 (초당, 중심)", render: v2 },
        nearEvery: { value: 0.1, min: 0.05, max: 0.5, step: 0.05, label: "근접 갱신 (s)", render: v2 },
        nearRadius: { value: 3.5, min: 1.5, max: 8, step: 0.5, label: "근접 반경 (월드)", render: v2 },
        mineGain: { value: 2, min: 1, max: 6, step: 0.5, label: "A3: 내 스트레스 배율", render: v2 },
      }),
      "타인 — 시야 높이 네모 점": folder({
        othersOn: { value: true, label: "켜기", render: v2 },
        otherSize: { value: 0.5, min: 0.05, max: 3, step: 0.05, label: "점 크기 (월드, 거리로 줄어듦)", render: v2 },
        otherEye: { value: 0, min: -4, max: 4, step: 0.1, label: "높이 — 시야 기준 (+위 / −아래)", render: v2 },
        otherBright: { value: 0.8, min: 0.1, max: 1, step: 0.05, label: "밝기", render: v2 },
        otherRecent: { value: 10, min: 1, max: 60, step: 1, label: "흐려지는 시간 (s, 마지막 표본 뒤)", render: v2 },
      }),
      "콘크리트 — 세로선": folder({
        concreteOn: { value: true, label: "켜기", render: v2 },
        concreteHeight: { value: 40, min: 1, max: 120, step: 1, label: "선 높이 (월드)", render: v2 },
        concreteBright: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: "밝기", render: v2 },
        concreteRadius: { value: 36, min: 6, max: 80, step: 1, label: "보이는 반경 (월드)", render: v2 },
      }),
      "길 — 시야 아래 수평 리본": folder({
        pathsOn: { value: true, label: "켜기", render: v2 },
        pathDrop: { value: 1.2, min: 0, max: 6, step: 0.1, label: "시야에서 내린 높이 (월드)", render: v2 },
        pathBright: { value: 0.9, min: 0.1, max: 1, step: 0.05, label: "밝기", render: v2 },
        pathRadius: { value: 30, min: 6, max: 80, step: 1, label: "보이는 반경 (월드)", render: v2 },
        pathPer: { value: 4, min: 1, max: 8, step: 1, label: "곡선 부드러움 (칸당 표본)", render: v2 },
        pathWidth: { value: 0.35, min: 0.05, max: 2, step: 0.05, label: "리본 폭 (월드)", render: v2 },
        pathOpacity: { value: 0.6, min: 0.05, max: 1, step: 0.05, label: "리본 불투명도", render: v2 },
        groundLine: { value: 0.3, min: 0, max: 1, step: 0.05, label: "바닥의 길 선 (배율; 곡선과 헷갈리면 0)", render: v2 },
      }),
    }),
    { collapsed: false, order: 1 },
  );
  const grass = useMemo<GrassVisual>(
    () => ({ mode: c.grassMode, reactRadius: c.reactRadius, dose: c.reactDose, nearEvery: c.nearEvery, nearRadius: c.nearRadius, mineGain: c.mineGain, thick: c.grassThick }),
    [c.grassMode, c.reactRadius, c.reactDose, c.nearEvery, c.nearRadius, c.mineGain, c.grassThick],
  );
  const marks = useMemo<MarksVisual>(
    () => ({
      others: { on: c.othersOn, size: c.otherSize, eyeOffset: c.otherEye, bright: c.otherBright, recentSec: c.otherRecent },
      concrete: { on: c.concreteOn, height: c.concreteHeight, bright: c.concreteBright, radius: c.concreteRadius },
      paths: { on: c.pathsOn, drop: c.pathDrop, bright: c.pathBright, radius: c.pathRadius, per: c.pathPer, width: c.pathWidth, opacity: c.pathOpacity, groundLine: c.groundLine },
      on: c.othersOn || c.concreteOn || c.pathsOn,
    }),
    [c.othersOn, c.otherSize, c.otherEye, c.otherBright, c.otherRecent, c.concreteOn, c.concreteHeight, c.concreteBright, c.concreteRadius, c.pathsOn, c.pathDrop, c.pathBright, c.pathRadius, c.pathPer, c.pathWidth, c.pathOpacity, c.groundLine],
  );
  return { footprint: c.footprint, grass, marks };
}
