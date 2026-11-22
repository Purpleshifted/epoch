"use client";
/**
 * usePersonalVisuals — the Leva folder "개인뷰 비주얼" (V2): what the player view adds on top of the ground so the
 * visitor's effect on it lands, and what stands in the frame — switchable, so the artist compares versions
 * (docs/session-logic.md §12).
 *   look        브루털: black, white, one green, hard edges, no fog / glow / grid (2026-11-01); 부드러움: what it was
 *   footprint   the end screen's record card: its footprint map (FootprintMap)
 *   card        the specimen card the record card leads on to (SpecimenCard, lib/parliament/plate.ts — 2026-11-21): its
 *               first paper and the way it first stands (the visitor picks both)
 *   grass       how the grass reacts to the walker at once and how it is drawn (DitherGround, NatureCloud)
 *   marks       the others, the concrete (Marks.tsx, lib/parliament/marks.ts), the seed heads the answers left
 *               (Dandelions.tsx); the paths stay on the ground (PathLines)
 *   street      길거리 (2026-11-22, a trial behind a switch; docs/street-feel.md): the others as walking point silhouettes
 *               (PointPeople.tsx), the eye at a person's height, a depth fog in the brutal look — off = the look as it was
 */

import { useEffect, useMemo } from "react";
import { folder, useControls } from "leva";
import type { PlateOrient, PlateTheme } from "@/lib/parliament";
import type { GrassMode } from "./NatureCloud";
import { DEFAULT_PEOPLE, type PeopleLook, type PeopleMode } from "./PointPeople";
import { setStreetGround } from "./streetLook";
import type { LogPlace } from "./StreetHud";
import { DEFAULT_INK, type InkPaperLook } from "./InkPaper";
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
  burst: { on: boolean; count: number; reach: number; lifeSec: number; dot: number };
  on: boolean;
}

export interface CardVisual {
  /** The paper the card first shows on (the visitor picks; the print is in one ink on that paper). */
  theme: PlateTheme;
  /** Which way the card first stands (54 × 86 or 86 × 54 mm; the visitor picks). */
  orient: PlateOrient;
}

/** 길거리 (2026-11-22): what the street trial switches on; `on` false = nothing of it runs. */
export interface StreetVisual {
  on: boolean;
  /** The others as walking point silhouettes (PointPeople) in place of the squares. */
  people: boolean;
  look: PeopleLook;
  /** The eye at a person's height just behind the walker, looking level. */
  eye: { on: boolean; height: number; back: number; look: number };
  /** A black depth fog in the brutal look (the 화면 folder's near / far). */
  fog: boolean;
  /** The walker's speed (world/s; 7 as it was — a person walks 1.4, a bot 2.2). */
  walkSpeed: number;
  /** 시야 반경 (2026-11-22 evening): the fog pulled in to this radius (world) — beyond it nothing shows, like a night street. */
  view: { on: boolean; radius: number };
  /** 방향 말: a line of words for the nearest one between the eye's reach and this radius (world), every so often. */
  hints: { on: boolean; radius: number; everySec: number };
  /** Where the log stands: "auto" = with the eye at a person's height, a left column on a laptop and a top strip on a phone. */
  logPlace: LogPlace | "auto";
  /** 흰 바탕 (오가닉): the personal view on paper (streetLook.ts). */
  paper: boolean;
  /** 먹과 종이: the finish pass (InkPaper). */
  ink: InkPaperLook;
}

const PEOPLE_MODES: Record<string, PeopleMode> = {
  "깜빡이는 상자 속 실루엣 — 상자는 지금 네모(멜로디로 깜빡임), 안에 걷는 실루엣": "boxes",
  "점 실루엣 — 점 480개의 몸": "points",
};

const LOG_PLACES: Record<string, LogPlace | "auto"> = {
  "자동 — 눈높이면 랩탑은 왼쪽 패널 · 폰은 위쪽 띠, 아니면 아래": "auto",
  "아래 (지금)": "bottom",
  "왼쪽 세로 패널": "left",
  "위쪽 띠": "top",
};

export interface PersonalVisuals {
  look: Look;
  footprint: boolean;
  card: CardVisual;
  grass: GrassVisual;
  marks: MarksVisual;
  street: StreetVisual;
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

const CARD_THEMES: Record<string, PlateTheme> = {
  "흰 바탕 — 인쇄(열전사)와 같음": "paper",
  "검은 바탕": "screen",
};

const CARD_ORIENTS: Record<string, PlateOrient> = {
  "세로 — 54 × 86 mm": "portrait",
  "가로 — 86 × 54 mm": "landscape",
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
      cardTheme: { options: CARD_THEMES, value: "paper" as PlateTheme, label: "표본 카드 바탕 (처음; 관객이 바꿀 수 있음)", render: v2 },
      cardOrient: { options: CARD_ORIENTS, value: "portrait" as PlateOrient, label: "표본 카드 방향 (처음; 관객이 바꿀 수 있음)", render: v2 },
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
      "응답의 터짐": folder({
        burstOn: { value: true, label: "켜기", render: v2 },
        burstCount: { value: 70, min: 5, max: 400, step: 5, label: "점 수", render: v2 },
        burstReach: { value: 2.6, min: 0.3, max: 10, step: 0.1, label: "퍼지는 거리 (월드)", render: v2 },
        burstLife: { value: 1.2, min: 0.2, max: 5, step: 0.1, label: "지속 (s)", render: v2 },
        burstDot: { value: 0.07, min: 0.02, max: 0.4, step: 0.01, label: "점 크기 (월드)", render: v2 },
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
      // 길거리 (2026-11-22): a trial — everything here is off by default, so the look stays what it was
      "길거리 (시험 · 11/22)": folder(
        {
          streetOn: { value: false, label: "켜기 (끄면 아래 모두 꺼짐)", render: v2 },
          streetPeople: { value: true, label: "사람 — 아래 방식으로 (끄면 지금 네모)", render: v2 },
          ppMode: { options: PEOPLE_MODES, value: DEFAULT_PEOPLE.mode, label: "사람 =", render: v2 },
          ppBoxAspect: { value: DEFAULT_PEOPLE.boxAspect, min: 0.3, max: 1.2, step: 0.05, label: "상자: 폭 (키의 배수)", render: v2 },
          ppBoxRest: { value: DEFAULT_PEOPLE.boxRest, min: 0.05, max: 0.6, step: 0.01, label: "상자: 멜로디가 쉴 때 회색", render: v2 },
          ppCue: { value: DEFAULT_PEOPLE.cue, label: "말 거는 이에게 큐 — 질문이 열린 동안 상자/몸이 커지고 밝아짐", render: v2 },
          ppScale: { value: DEFAULT_PEOPLE.scale, min: 0.5, max: 8, step: 0.1, label: "척도 — 1 월드 = 몇 m (아래 m 값을 나눔; 칸 1.2 월드)", render: v2 },
          ppPoints: { value: DEFAULT_PEOPLE.points, min: 64, max: 800, step: 16, label: "몸 하나의 점 수", render: v2 },
          ppPointsPhone: { value: DEFAULT_PEOPLE.pointsPhone, min: 32, max: 480, step: 16, label: "폰: 점 수", render: v2 },
          ppDot: { value: DEFAULT_PEOPLE.dot, min: 0.01, max: 0.3, step: 0.005, label: "점 크기 (m)", render: v2 },
          ppMaxPx: { value: DEFAULT_PEOPLE.maxPx, min: 2, max: 24, step: 1, label: "점 최대 크기 (px; 코앞의 몸이 뭉개지지 않게)", render: v2 },
          ppGrey: { value: DEFAULT_PEOPLE.grey, min: 0.2, max: 1, step: 0.02, label: "회색 밝기", render: v2 },
          ppHeight: { value: DEFAULT_PEOPLE.height, min: 1, max: 2.4, step: 0.05, label: "키 (m, 평균)", render: v2 },
          ppVariety: { value: DEFAULT_PEOPLE.variety, min: 0, max: 1, step: 0.05, label: "사람마다 다르게 — 키 ±8 % · 체격 ±10 % · 걸음 ±15 %", render: v2 },
          ppMaxCadence: { value: DEFAULT_PEOPLE.maxCadence, min: 0.8, max: 4, step: 0.1, label: "걸음 박자 상한 (걸음/s; 넘으면 미끄러짐)", render: v2 },
          ppMaxSpeed: { value: DEFAULT_PEOPLE.maxSpeed, min: 1, max: 6, step: 0.1, label: "표본 사이 최고 속도 (월드/s)", render: v2 },
          ppBreath: { value: DEFAULT_PEOPLE.breath, min: 0, max: 3, step: 0.1, label: "서 있을 때 숨 (0 = 없음)", render: v2 },
          ppSmearSec: { value: DEFAULT_PEOPLE.smearSec, min: 0, max: 8, step: 0.25, label: "시간의 번짐 — 몇 초 뒤까지 (0 = 없음; 폰은 늘 없음)", render: v2 },
          ppSmearCopies: { value: DEFAULT_PEOPLE.smearCopies, min: 1, max: 8, step: 1, label: "번짐 복사본 수", render: v2 },
          ppPlate: { value: DEFAULT_PEOPLE.plate, label: "세운 판 (criswvr; 희미하게)", render: v2 },
          ppPlateAlpha: { value: DEFAULT_PEOPLE.plateAlpha, min: 0.02, max: 0.5, step: 0.01, label: "판 불투명도", render: v2 },
          ppFog: { value: DEFAULT_PEOPLE.fog, label: "점이 안개를 받음", render: v2 },
          eyeOn: { value: true, label: "눈높이 — 카메라를 사람 키에, 걷는 이 바로 뒤", render: v2 },
          eyeHeight: { value: 1.6, min: 0.6, max: 4, step: 0.05, label: "눈높이 (m)", render: v2 },
          eyeBack: { value: 0, min: 0, max: 8, step: 0.1, label: "걷는 이에서 뒤로 (m; 0 = 1인칭 — 작가 결정 11/22 밤; 내 상자는 발밑)", render: v2 },
          eyeLook: { value: 6, min: 2, max: 20, step: 0.5, label: "시선이 닿는 거리 (m)", render: v2 },
          meBody: { value: DEFAULT_PEOPLE.meBody, label: "나 = 내 등 (점 몸; 사각형 대신 — 멜로디는 몸이 깜박임)", render: v2 },
          meRest: { value: DEFAULT_PEOPLE.meRest, min: 0, max: 1, step: 0.05, label: "멜로디가 쉴 때 내 몸의 밝기", render: v2 },
          streetFog: { value: false, label: "깊이 안개 (브루털에도; 화면 › fogNear/fogFar)", render: v2 },
          // "가까이 가야 안다" (2026-11-22 evening): the three rings — sound (as it is) · words · the eye
          viewOn: { value: false, label: "시야 반경 — 바깥은 밤길처럼 안 보임 (안개를 바싹 당김; 외곽선도)", render: v2 },
          viewRadius: { value: 8, min: 2, max: 24, step: 0.5, label: "시야 반경 (월드)", render: v2 },
          hintsOn: { value: true, label: "방향 말 — 안 보이는 거리의 누군가를 로그 곁에 한 줄로", render: v2 },
          hintRadius: { value: 12, min: 4, max: 24, step: 0.5, label: "말이 닿는 거리 (월드; 시야 반경 밖 ~ 여기)", render: v2 },
          hintEvery: { value: 6, min: 2, max: 20, step: 1, label: "말 사이 간격 (s)", render: v2 },
          logPlace: { options: LOG_PLACES, value: "auto" as LogPlace | "auto", label: "로그의 자리", render: v2 },
          // 흰 바탕 (오가닉) — 2026-11-22 night: paper, the long exposure's smear, the overlap of sheets
          paperOn: { value: false, label: "흰 바탕 (오가닉) — 종이 위 장노출의 번짐; 선·격자·외곽선·네모를 버림", render: v2 },
          paperInk: { value: 0.9, min: 0.2, max: 1, step: 0.05, label: "종이: 사람 얼룩의 진하기", render: v2 },
          paperBlur: { value: 3, min: 0, max: 8, step: 0.5, label: "종이: 얼룩 가장자리의 번짐 (px)", render: v2 },
          paperFade: { value: 12, min: 3, max: 30, step: 0.5, label: "종이: 멀수록 옅어지는 거리 (월드)", render: v2 },
          paperLabel: { value: 4, min: 0, max: 12, step: 0.5, label: "종이: 이 안이면 개체 라벨과 지시선 (월드; 0 = 없음)", render: v2 },
          // 각자의 창 (2026-11-22 night): the window stretches by the move between the server's samples; the walk is a flicker
          paperFlicker: { value: true, label: "종이: 의도적 플리커링 — 표본(0.5 s)이 올 때 창이 떨리고 자리를 옮김 (보간 없음)", render: v2 },
          paperStretch: { value: 1, min: 0, max: 3, step: 0.1, label: "종이: 창이 표본 사이 이동만큼 늘어남 (배수)", render: v2 },
          paperShake: { value: 2, min: 0, max: 8, step: 0.5, label: "종이: 표본이 올 때의 떨림 (cm)", render: v2 },
          paperBlot: { value: 8, min: 2, max: 24, step: 0.5, label: "종이: 번짐 반경 (월드) — 그 밖은 스캔 점(future-presence); 시야 반경을 켜면 그 값", render: v2 },
          paperBubble: { value: true, label: "종이: 말 거는 이 옆에 사각 테두리 + 멜로디 기호 버블", render: v2 },
          paperAspectMin: { value: 0.5, min: 0.2, max: 2, step: 0.05, label: "종이: 창 비율 최소 (폭/키; 봇마다 씨앗으로 정함)", render: v2 },
          paperAspectMax: { value: 1.3, min: 0.2, max: 2.5, step: 0.05, label: "종이: 창 비율 최대", render: v2 },
          paperTail: { value: 1.6, min: 0.2, max: 6, step: 0.1, label: "종이: 사라질 때 꼬리가 남는 시간 (s)", render: v2 },
          paperVariety: { value: 1, min: 0, max: 1, step: 0.05, label: "종이: 사람 다양성 — 걷는 법 4종 · 진하기 · 번짐 · 창의 기울기", render: v2 },
          paperExposure: { value: 0.5, min: 0.05, max: 2, step: 0.05, label: "장노출: 한 프레임의 노출 (겹치고 머물수록 진해짐)", render: v2 },
          paperFrame: { value: 1, min: 0, max: 2, step: 0.1, label: "종이: 창 테두리 세기 (모서리 브래킷; 박자·말 걸 때 굵어짐)", render: v2 },
          askTurn: { value: true, label: "말 걸면 시선이 1.2 s 동안 그쪽으로 돌아감 (손대면 멈춤)", render: v2 },
          askRipple: { value: true, label: "말 걸면 창에서 사각 파문이 퍼짐", render: v2 },
          // 먹과 종이 — the finish pass (InkPaper.tsx)
          inkDecay: { value: DEFAULT_INK.decay, min: 0.8, max: 0.99, step: 0.005, label: "장노출: 잔상이 남는 정도 (프레임당 감쇠)", render: v2 },
          inkDensity: { value: DEFAULT_INK.density, min: 0.2, max: 1, step: 0.02, label: "장노출: 쌓인 것의 최대 어두움", render: v2 },
          inkNarrow: { value: DEFAULT_INK.narrow, min: 0, max: 8, step: 0.1, label: "깊이: 가까운 흐림 (px)", render: v2 },
          inkWide: { value: DEFAULT_INK.wide, min: 0, max: 24, step: 0.5, label: "깊이: 먼 흐림 (px)", render: v2 },
          inkFade: { value: DEFAULT_INK.fade, min: 0, max: 1, step: 0.05, label: "깊이: 멀수록 옅어짐", render: v2 },
          inkRolloff: { value: DEFAULT_INK.rolloff, min: 0, max: 1, step: 0.05, label: "사진: 밝은 쪽이 부드럽게 날아감", render: v2 },
          inkGrain: { value: DEFAULT_INK.grain, min: 0, max: 0.03, step: 0.001, label: "사진: 입자", render: v2 },
          walkSpeed: { value: 2.5, min: 0.5, max: 10, step: 0.5, label: "걷는 속도 (월드/s; 전엔 7 · 봇 2.2)", render: v2 },
          ppFaceEach: { value: DEFAULT_PEOPLE.faceEach, label: "서 있을 때 가까운 이를 마주 봄", render: v2 },
          ppFaceRadius: { value: DEFAULT_PEOPLE.faceRadius, min: 1, max: 8, step: 0.5, label: "마주 보는 거리 (m)", render: v2 },
          // the ground (streetLook.ts → DitherGround / NatureCloud)
          groundOn: { value: true, label: "땅: 길이 난 칸의 닳음 (무채색)", render: v2 },
          groundWear: { value: 0.7, min: 0, max: 1, step: 0.05, label: "닳음 세기", render: v2 },
          groundGrey: { value: 0.42, min: 0.05, max: 1, step: 0.02, label: "닳은 땅의 회색", render: v2 },
          groundSeam: { value: 0.6, min: 0, max: 1, step: 0.05, label: "턱 — 칸 사이 줄눈의 어두움", render: v2 },
          groundGrain: { value: 0.5, min: 0, max: 1, step: 0.05, label: "결 — 닳은 땅의 알갱이", render: v2 },
          windDepth: { value: 0.5, min: 0, max: 1, step: 0.05, label: "바람: 풀 면을 지나는 결 (0 = 없음)", render: v2 },
          windSpeed: { value: 1, min: 0.2, max: 4, step: 0.1, label: "바람 속도", render: v2 },
          grassSway: { value: 0.5, min: 0, max: 2, step: 0.1, label: "네모 점 풀의 흔들림 (0 = 없음)", render: v2 },
        },
        { collapsed: false },
      ),
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
        // the street trial's silhouettes stand in for the squares
        on: c.othersOn && !(c.streetOn && c.streetPeople),
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
      burst: { on: c.burstOn, count: c.burstCount, reach: c.burstReach, lifeSec: c.burstLife, dot: c.burstDot },
      on: c.othersOn || c.concreteOn,
    }),
    [brutal, c.othersOn, c.streetOn, c.streetPeople, c.otherSquare, c.otherSize, c.otherHeight, c.otherBright, c.otherRecent, c.otherHalo, c.otherHaloStrength, c.otherFog, c.otherPulse, c.otherHold, c.otherSnap, c.concreteOn, c.concreteHeight, c.concreteBright, c.concreteRadius, c.concreteStyle, c.outlineScale, c.burstOn, c.burstCount, c.burstReach, c.burstLife, c.burstDot],
  );
  const card = useMemo<CardVisual>(() => ({ theme: c.cardTheme, orient: c.cardOrient }), [c.cardTheme, c.cardOrient]);
  const street = useMemo<StreetVisual>(
    () => ({
      on: c.streetOn,
      people: c.streetOn && c.streetPeople,
      look: {
        mode: c.ppMode,
        paper: c.streetOn && c.paperOn,
        ink: c.paperInk,
        blur: c.paperBlur,
        fadeDist: c.paperFade,
        labelDist: c.paperLabel,
        flicker: c.paperFlicker,
        stretchGain: c.paperStretch,
        shake: c.paperShake,
        blotDist: c.viewOn ? c.viewRadius : c.paperBlot,
        bubble: c.paperBubble,
        aspectMin: Math.min(c.paperAspectMin, c.paperAspectMax),
        aspectMax: Math.max(c.paperAspectMin, c.paperAspectMax),
        tailSec: c.paperTail,
        exposure: c.paperExposure,
        frame: c.paperFrame,
        askTurn: c.askTurn,
        ripple: c.askRipple,
        paperVariety: c.paperVariety,
        boxAspect: c.ppBoxAspect,
        boxRest: c.ppBoxRest,
        cue: c.ppCue,
        points: c.ppPoints,
        pointsPhone: c.ppPointsPhone,
        scale: c.ppScale,
        dot: c.ppDot,
        maxPx: c.ppMaxPx,
        grey: c.ppGrey,
        height: c.ppHeight,
        variety: c.ppVariety,
        maxCadence: c.ppMaxCadence,
        plate: c.ppPlate,
        plateAlpha: c.ppPlateAlpha,
        smearSec: c.ppSmearSec,
        smearCopies: c.ppSmearCopies,
        breath: c.ppBreath,
        fog: c.ppFog,
        maxSpeed: c.ppMaxSpeed,
        recentSec: c.otherRecent,
        faceEach: c.ppFaceEach,
        faceRadius: c.ppFaceRadius,
        meBody: c.meBody,
        meRest: c.meRest,
      },
      // the eye's lengths are metres: divided by the scale into world units
      eye: { on: c.streetOn && c.eyeOn, height: c.eyeHeight / c.ppScale, back: c.eyeBack / c.ppScale, look: c.eyeLook / c.ppScale },
      fog: c.streetOn && c.streetFog,
      walkSpeed: c.streetOn ? c.walkSpeed : 7,
      view: { on: c.streetOn && c.viewOn, radius: c.viewRadius },
      hints: { on: c.streetOn && c.hintsOn, radius: c.hintRadius, everySec: c.hintEvery },
      logPlace: c.streetOn ? c.logPlace : "bottom",
      paper: c.streetOn && c.paperOn,
      ink: { narrow: c.inkNarrow, wide: c.inkWide, decay: c.inkDecay, gain: c.paperExposure, density: c.inkDensity, fade: c.inkFade, grain: c.inkGrain, rolloff: c.inkRolloff },
    }),
    [c.streetOn, c.streetPeople, c.paperOn, c.paperInk, c.paperBlur, c.paperFade, c.paperLabel, c.paperFlicker, c.paperStretch, c.paperShake, c.paperBlot, c.paperBubble, c.paperAspectMin, c.paperAspectMax, c.paperTail, c.paperVariety, c.paperExposure, c.paperFrame, c.askTurn, c.askRipple, c.inkNarrow, c.inkWide, c.inkDecay, c.inkDensity, c.inkFade, c.inkGrain, c.inkRolloff, c.ppMode, c.ppBoxAspect, c.ppBoxRest, c.ppCue, c.ppPoints, c.ppPointsPhone, c.ppScale, c.ppDot, c.ppMaxPx, c.viewOn, c.viewRadius, c.hintsOn, c.hintRadius, c.hintEvery, c.logPlace, c.ppGrey, c.ppHeight, c.ppVariety, c.ppMaxCadence, c.ppPlate, c.ppPlateAlpha, c.ppSmearSec, c.ppSmearCopies, c.ppBreath, c.ppFog, c.ppMaxSpeed, c.otherRecent, c.ppFaceEach, c.ppFaceRadius, c.meBody, c.meRest, c.eyeOn, c.eyeHeight, c.eyeBack, c.eyeLook, c.streetFog, c.walkSpeed],
  );
  // the ground's part of the street look goes to the components RoleField mounts, through the module value
  useEffect(() => {
    setStreetGround({ on: c.streetOn, wear: c.groundOn ? c.groundWear : 0, wearGrey: c.groundGrey, seam: c.groundSeam, grain: c.groundGrain, wind: c.windDepth, windSpeed: c.windSpeed, sway: c.grassSway, viewFog: c.streetOn && c.viewOn, paper: c.streetOn && c.paperOn, ink: c.paperInk, blur: c.paperBlur, fadeDist: c.paperFade, labelDist: c.paperLabel, blotDist: c.viewOn ? c.viewRadius : c.paperBlot });
  }, [c.streetOn, c.groundOn, c.groundWear, c.groundGrey, c.groundSeam, c.groundGrain, c.windDepth, c.windSpeed, c.grassSway, c.viewOn, c.viewRadius, c.paperOn, c.paperInk, c.paperBlur, c.paperFade, c.paperLabel, c.paperBlot]);
  return { look: c.look, footprint: c.footprint, card, grass, marks, street };
}
