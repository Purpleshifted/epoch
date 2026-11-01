"use client";
/**
 * usePersonalVisuals — the Leva folder "개인뷰 비주얼" (V2): what the player view adds on top of the ground so the
 * visitor's effect on it lands, and what stands in the frame — switchable, so the artist compares versions
 * (docs/session-logic.md §12).
 *   look        브루털: black, white, one green, hard edges, no fog / glow / grid (2026-11-01); 부드러움: what it was
 *   footprint   the end screen's footprint map (FootprintMap)
 *   grass       how the grass reacts to the walker at once and how it is drawn (DitherGround, NatureCloud)
 *   marks       the others, the concrete, the ended lives' words (Marks.tsx, lib/parliament/marks.ts); the paths stay on
 *               the ground (PathLines)
 */

import { useMemo } from "react";
import { folder, useControls } from "leva";
import type { GrassMode } from "./NatureCloud";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";

export type Look = "brutal" | "soft";
export type GrassStyle = "field" | "dither" | "squares" | "dots";
export type ConcreteStyle = "lines" | "outline";

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
  /** How it is drawn: a plain field (no pixels), a dithered field, hard square points, or the old soft dots. */
  style: GrassStyle;
  color: string;
  /** Dither: the size of a dot (CSS px), the density ×, and the radius of the lit circle (world). */
  ditherPx: number;
  density: number;
  radius: number;
  /** Square points: their size. */
  squareSize: number;
}

export interface MarksVisual {
  others: { on: boolean; size: number; height: number; bright: number; recentSec: number; halo: number; haloStrength: number; fog: boolean; pulseHz: number; holdSec: number; snap: boolean; square: boolean };
  concrete: { on: boolean; height: number; bright: number; radius: number; style: ConcreteStyle; outlineScale: number };
  words: { on: boolean; cell: number };
  on: boolean;
}

export interface PersonalVisuals {
  look: Look;
  footprint: boolean;
  grass: GrassVisual;
  marks: MarksVisual;
}

const ROOT = "개인뷰 비주얼";

const LOOK_OPTIONS: Record<string, Look> = {
  "브루털 — 검정·흰색·초록, 안개·빛번짐·격자 없음": "brutal",
  "부드러움 — 11/1 이전 (안개, 빛점, 격자)": "soft",
};

const GRASS_OPTIONS: Record<string, GrassMode> = {
  "A0 끔 (접기대로, 0.25 s)": "off",
  "A1 바로 눌림 — 발밑·지나온 자리의 풀이 즉시 줄어듦": "press",
  "A2 눕고 마름 — 점이 바로 눕고 색이 마른 뒤 줄어듦": "flatten",
  "A3 내 길만 세게 — 내 흔적의 스트레스를 배율로 (남의 자리는 그대로)": "mine",
};

const GRASS_STYLES: Record<string, GrassStyle> = {
  "면 — 픽셀 없이 밀도만큼 밝은 초록": "field",
  "디더 면 — 땅 전체가 초록·검정 두 값": "dither",
  "네모 점 — 점구름, 단색, 각진 점": "squares",
};

const CONCRETE_STYLES: Record<string, ConcreteStyle> = {
  "외곽선 — 건물의 테두리와 칸의 줄눈만, 속은 비침": "outline",
  "세로선 — 칸마다 1 px 선이 화면 위로": "lines",
};

export function usePersonalVisuals(): PersonalVisuals {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const c = useControls(
    ROOT,
    savable(ROOT, {
      look: { options: LOOK_OPTIONS, value: "brutal" as Look, label: "판", render: v2 },
      footprint: { value: true, label: "퇴장 화면 발자국 지도", render: v2 },
      "브루털": folder({
        grassStyle: { options: GRASS_STYLES, value: "field" as GrassStyle, label: "풀", render: v2 },
        grassColor: { value: "#2f8f3f", label: "풀 색", render: v2 },
        ditherPx: { value: 2, min: 1, max: 8, step: 1, label: "디더: 점 크기 (px)", render: v2 },
        grassDensity: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: "면·디더: 밀도 ×", render: v2 },
        grassRadius: { value: 22, min: 8, max: 40, step: 1, label: "면·디더: 보이는 원 반경 (월드)", render: v2 },
        squareSize: { value: 0.16, min: 0.04, max: 0.6, step: 0.01, label: "네모 점: 크기", render: v2 },
        concreteStyle: { options: CONCRETE_STYLES, value: "outline" as ConcreteStyle, label: "콘크리트", render: v2 },
        outlineScale: { value: 1, min: 0.25, max: 6, step: 0.25, label: "외곽선: 높이 × 슬래브", render: v2 },
        otherSquare: { value: 0.8, min: 0.2, max: 2, step: 0.05, label: "타인 네모 크기", render: v2 },
      }),
      "남긴 말": folder({
        wordsOn: { value: true, label: "땅의 판 켜기", render: v2 },
        wordCell: { value: 0.3, min: 0.1, max: 1, step: 0.05, label: "점 하나 크기 (월드)", render: v2 },
      }),
      "풀 (식생)": folder({
        grassThick: { value: 2, min: 1, max: 6, step: 0.25, label: "두께 — 세로 분포 배율 (1 = 예전)", render: v2 },
        grassMode: { options: GRASS_OPTIONS, value: "press" as GrassMode, label: "걷는 사람에게 반응", render: v2 },
        reactRadius: { value: 1.5, min: 0.5, max: 4, step: 0.1, label: "반응 반경 (월드)", render: v2 },
        reactDose: { value: 0.6, min: 0, max: 3, step: 0.05, label: "반응 세기 (초당, 중심)", render: v2 },
        nearEvery: { value: 0.1, min: 0.05, max: 0.5, step: 0.05, label: "근접 갱신 (s)", render: v2 },
        nearRadius: { value: 3.5, min: 1.5, max: 8, step: 0.5, label: "근접 반경 (월드)", render: v2 },
        mineGain: { value: 2, min: 1, max: 6, step: 0.5, label: "A3: 내 스트레스 배율", render: v2 },
      }),
      "타인 — 땅 위의 빛점 (glow)": folder({
        othersOn: { value: true, label: "켜기", render: v2 },
        otherSize: { value: 0.5, min: 0.05, max: 3, step: 0.05, label: "심 크기 (월드, 거리로 줄어듦)", render: v2 },
        otherHalo: { value: 4, min: 0, max: 12, step: 0.5, label: "후광 크기 (심의 배수; 0 = 없음)", render: v2 },
        otherHaloStrength: { value: 0.35, min: 0, max: 1, step: 0.05, label: "후광 세기", render: v2 },
        otherHeight: { value: 0.02, min: 0, max: 6, step: 0.05, label: "높이 (월드; 0 = 격자와 같은 높이)", render: v2 },
        otherBright: { value: 0.8, min: 0.1, max: 1.5, step: 0.05, label: "밝기", render: v2 },
        otherFog: { value: true, label: "안개를 받음 (끄면 멀리서도 희미하게 빛남)", render: v2 },
        otherPulse: { value: 0, min: 0, max: 3, step: 0.1, label: "맥동 (Hz; 0 = 고정)", render: v2 },
        otherHold: { value: 4, min: 0.5, max: 20, step: 0.5, label: "자리 옮기는 간격 (s; 타인마다 ±25 % 어긋남)", render: v2 },
        otherSnap: { value: true, label: "격자 칸 가운데에 맞춤", render: v2 },
        otherRecent: { value: 10, min: 1, max: 60, step: 1, label: "흐려지는 시간 (s, 마지막 표본 뒤)", render: v2 },
      }),
      "콘크리트 — 세로선": folder({
        concreteOn: { value: true, label: "켜기", render: v2 },
        concreteHeight: { value: 40, min: 1, max: 120, step: 1, label: "선 높이 (월드)", render: v2 },
        concreteBright: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: "밝기", render: v2 },
        concreteRadius: { value: 36, min: 6, max: 80, step: 1, label: "보이는 반경 (월드)", render: v2 },
      }),
    }),
    { collapsed: false, order: 1 },
  );
  const brutal = c.look === "brutal";
  const grass = useMemo<GrassVisual>(
    () => ({
      mode: c.grassMode,
      reactRadius: c.reactRadius,
      dose: c.reactDose,
      nearEvery: c.nearEvery,
      nearRadius: c.nearRadius,
      mineGain: c.mineGain,
      thick: c.grassThick,
      style: brutal ? c.grassStyle : "dots",
      color: c.grassColor,
      ditherPx: c.ditherPx,
      density: c.grassDensity,
      radius: c.grassRadius,
      squareSize: c.squareSize,
    }),
    [c.grassMode, c.reactRadius, c.reactDose, c.nearEvery, c.nearRadius, c.mineGain, c.grassThick, brutal, c.grassStyle, c.grassColor, c.ditherPx, c.grassDensity, c.grassRadius, c.squareSize],
  );
  const marks = useMemo<MarksVisual>(
    () => ({
      others: {
        on: c.othersOn,
        size: brutal ? c.otherSquare : c.otherSize,
        height: brutal ? 0.2 : c.otherHeight,
        bright: c.otherBright,
        recentSec: c.otherRecent,
        halo: c.otherHalo,
        haloStrength: c.otherHaloStrength,
        fog: c.otherFog,
        pulseHz: brutal ? 0 : c.otherPulse,
        holdSec: c.otherHold,
        snap: c.otherSnap,
        square: brutal,
      },
      concrete: { on: c.concreteOn, height: c.concreteHeight, bright: brutal ? 1 : c.concreteBright, radius: c.concreteRadius, style: brutal ? c.concreteStyle : "lines", outlineScale: c.outlineScale },
      words: { on: c.wordsOn, cell: c.wordCell },
      on: c.othersOn || c.concreteOn || c.wordsOn,
    }),
    [brutal, c.othersOn, c.otherSquare, c.otherSize, c.otherHeight, c.otherBright, c.otherRecent, c.otherHalo, c.otherHaloStrength, c.otherFog, c.otherPulse, c.otherHold, c.otherSnap, c.concreteOn, c.concreteHeight, c.concreteBright, c.concreteRadius, c.concreteStyle, c.outlineScale, c.wordsOn, c.wordCell],
  );
  return { look: c.look, footprint: c.footprint, grass, marks };
}
