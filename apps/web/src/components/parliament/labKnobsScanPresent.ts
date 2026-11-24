"use client";
/**
 * scan (present) · 현재의 장소 — the eye, the distances, the log's place, the ground and the grass (DitherGround, NatureCloud, StreetHud).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page. Keys are the old 길거리 folder's (11/22–23), so the components read them as before
 * (usePersonalVisuals assembles them into StreetVisual / GrassVisual).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PEOPLE } from "./PointPeople";
import type { GrassMode } from "./NatureCloud";
import type { LogPlace } from "./StreetHud";
import { DEFAULT_LIDAR, setLidarLook, type LidarAxis, type LidarColour } from "./LidarScan";

const LIDAR_AXES: Record<string, LidarAxis> = {
  "진행방향 축 — 앞쪽 반구 (원들이 앞으로 날아가 표면을 읽음)": "heading",
  "세로축 — 나를 둘러싼 고리 (처음 것)": "vertical",
};

const LIDAR_COLOURS: Record<string, LidarColour> = {
  "거리 색 (사진처럼 — 가까이 민트, 멀리 분홍)": "distance",
  "흰색": "white",
  "회색": "grey",
};

const LOG_PLACES: Record<string, LogPlace | "auto"> = {
  "자동 — 눈높이면 랩탑은 왼쪽 패널 · 폰은 위쪽 띠, 아니면 아래": "auto",
  "아래 (지금)": "bottom",
  "왼쪽 세로 패널": "left",
  "위쪽 띠": "top",
};

const GRASS_OPTIONS: Record<string, GrassMode> = {
  "A0 끔 (접기대로, 0.25 s)": "off",
  "A1 바로 눌림 — 발밑·지나온 자리의 풀이 즉시 줄어듦": "press",
  "A2 눕고 마름 — 점이 바로 눕고 색이 마른 뒤 줄어듦": "flatten",
  "A3 내 길만 세게 — 내 흔적의 스트레스를 배율로 (남의 자리는 그대로)": "mine",
};

export function useScanPresentKnobs(isV2: boolean) {
  const v2 = () => isV2;
  const c = useControls(
    LAB_GROUP["scan-present"],
    savable(LAB_GROUP["scan-present"], {
      // the present read as a lidar scan round me (LidarScan.tsx; the artist 2026-11-23, after her photo: "포인트클라우드로
      // 시작") — for now drawn on this page only
      "라이다 스캔": folder({
        lidarOn: { value: DEFAULT_LIDAR.on, label: "라이다 스캔 (이 페이지에서만)", render: v2 },
        lidarBlack: { value: DEFAULT_LIDAR.black, label: "검은 바탕 (사진처럼)", render: v2 },
        lidarColour: { options: LIDAR_COLOURS, value: DEFAULT_LIDAR.colour, label: "점의 색", render: v2 },
        lidarAxis: { options: LIDAR_AXES, value: DEFAULT_LIDAR.axis, label: "스캔 축 (비교)", render: v2 },
        lidarCone: { value: DEFAULT_LIDAR.coneDeg, min: 1, max: 80, step: 1, label: "진행방향 축: 가장 앞 원 (° — 작을수록 멀리 앞)", render: v2 },
        lidarBeams: { value: DEFAULT_LIDAR.beams, min: 4, max: 128, step: 1, label: "빔 수 = 고리 수", render: v2 },
        lidarLow: { value: DEFAULT_LIDAR.lowDeg, min: -89, max: -2, step: 1, label: "세로축: 가장 아래 빔 (°) — 발밑 빈 원의 크기", render: v2 },
        lidarHigh: { value: DEFAULT_LIDAR.highDeg, min: -10, max: 89, step: 1, label: "세로축: 가장 위 빔 (°) — 벽에만 맞음 (85 = 거의 머리 위)", render: v2 },
        lidarAz: { value: DEFAULT_LIDAR.azimuths, min: 128, max: 2048, step: 64, label: "한 바퀴 점 수", render: v2 },
        lidarHz: { value: DEFAULT_LIDAR.hz, min: 0.5, max: 20, step: 0.5, label: "회전 (바퀴/초)", render: v2 },
        lidarDecay: { value: DEFAULT_LIDAR.decaySec, min: 0.1, max: 10, step: 0.1, label: "점이 남는 시간 (s)", render: v2 },
        lidarRange: { value: DEFAULT_LIDAR.range, min: 4, max: 48, step: 1, label: "닿는 거리 (월드)", render: v2 },
        lidarDot: { value: DEFAULT_LIDAR.dot, min: 0.5, max: 6, step: 0.25, label: "점 크기 (px)", render: v2 },
      }),
      "눈": folder({
        eyeOn: { value: true, label: "눈높이 카메라", render: v2 },
        // (1.6 → 1.1, lowered with the pictograms made smaller — the artist, 2026-11-24, in bot (present): "픽토그램 크기 전반적으로
        // 줄이면서 내 눈높이도 낮춰줘")
        eyeHeight: { value: 1.1, min: 0.6, max: 4, step: 0.05, label: "눈높이 (m)", render: v2 },
        eyeBack: { value: 0, min: 0, max: 8, step: 0.1, label: "뒤로 (m; 0 = 1인칭)", render: v2 },
        eyeLook: { value: 6, min: 2, max: 20, step: 0.5, label: "시선이 닿는 거리 (m)", render: v2 },
        walkSpeed: { value: 2.5, min: 0.5, max: 10, step: 0.5, label: "걷는 속도 (월드/s; 봇 2.2)", render: v2 },
        ppScale: { value: DEFAULT_PEOPLE.scale, min: 0.5, max: 8, step: 0.1, label: "척도 — 1 월드 = 몇 m", render: v2 },
      }),
      "거리": folder({
        paperBlot: { value: 8, min: 2, max: 24, step: 0.5, label: "여기서 그리는 반경 (월드; 밖은 스캔)", render: v2 },
        paperLabel: { value: 4, min: 0, max: 12, step: 0.5, label: "개체 라벨 거리 (월드; 0 = 없음)", render: v2 },
        hintsOn: { value: true, label: "안 보이는 이를 말로 — 방향 말", render: v2 },
        hintRadius: { value: 12, min: 4, max: 24, step: 0.5, label: "말이 닿는 거리 (월드)", render: v2 },
        hintEvery: { value: 6, min: 2, max: 20, step: 1, label: "말 사이 간격 (s)", render: v2 },
        viewOn: { value: false, label: "시야 반경 — 밖은 안 보임", render: v2 },
        viewRadius: { value: 8, min: 2, max: 24, step: 0.5, label: "시야 반경 (월드)", render: v2 },
      }),
      logPlace: { options: LOG_PLACES, value: "auto" as LogPlace | "auto", label: "로그의 자리", render: v2 },
      "땅": folder({
        groundOn: { value: true, label: "길이 난 칸의 닳음", render: v2 },
        groundWear: { value: 0.7, min: 0, max: 1, step: 0.05, label: "닳음 세기", render: v2 },
        groundGrey: { value: 0.42, min: 0.05, max: 1, step: 0.02, label: "닳은 땅의 회색", render: v2 },
        windDepth: { value: 0.5, min: 0, max: 1, step: 0.05, label: "바람 — 풀 면의 결", render: v2 },
        windSpeed: { value: 1, min: 0.2, max: 4, step: 0.1, label: "바람 속도", render: v2 },
        grassSway: { value: 0.5, min: 0, max: 2, step: 0.1, label: "네모 점 풀의 흔들림", render: v2 },
        groundOnPaper: { value: false, label: "흰 바탕에서도 땅 면을 그림", render: v2 },
      }),
      "풀 — 걷는 이에게 반응": folder({
        grassThick: { value: 2, min: 1, max: 6, step: 0.25, label: "두께 — 세로 분포 배율 (1 = 예전)", render: v2 },
        grassMode: { options: GRASS_OPTIONS, value: "press" as GrassMode, label: "걷는 사람에게 반응", render: v2 },
        reactRadius: { value: 1.5, min: 0.5, max: 4, step: 0.1, label: "반응 반경 (월드)", render: v2 },
        reactDose: { value: 0.6, min: 0, max: 3, step: 0.05, label: "반응 세기 (초당, 중심)", render: v2 },
        nearEvery: { value: 0.1, min: 0.05, max: 0.5, step: 0.05, label: "근접 갱신 (s)", render: v2 },
        nearRadius: { value: 3.5, min: 1.5, max: 8, step: 0.5, label: "근접 반경 (월드)", render: v2 },
        mineGain: { value: 2, min: 1, max: 6, step: 0.5, label: "A3: 내 스트레스 배율", render: v2 },
      }),
      "옛 (검은 바탕의 땅)": folder({
        streetFog: { value: false, label: "검은 바탕: 깊이 안개", render: v2 },
        groundSeam: { value: 0.6, min: 0, max: 1, step: 0.05, label: "옛: 턱", render: v2 },
        groundGrain: { value: 0.5, min: 0, max: 1, step: 0.05, label: "옛: 결", render: v2 },
      }, { collapsed: true }),
    }),
    { collapsed: false, order: 0.7, render: () => isV2 && labLists("scan-present") },
  );
  // (a plain module value, read per frame by LidarScan and at render by ParliamentScene — set before they read it)
  setLidarLook({
    on: isV2 && c.lidarOn,
    black: c.lidarBlack,
    colour: c.lidarColour,
    axis: c.lidarAxis,
    coneDeg: c.lidarCone,
    beams: c.lidarBeams,
    lowDeg: c.lidarLow,
    highDeg: c.lidarHigh,
    azimuths: c.lidarAz,
    hz: c.lidarHz,
    decaySec: c.lidarDecay,
    range: c.lidarRange,
    dot: c.lidarDot,
    // the sensor at the walker's eye (the same lengths the eye camera uses: metres ÷ scale)
    eyeH: c.eyeHeight / c.ppScale,
    eyeBack: c.eyeOn ? c.eyeBack / c.ppScale : 0,
  });
  return c;
}
