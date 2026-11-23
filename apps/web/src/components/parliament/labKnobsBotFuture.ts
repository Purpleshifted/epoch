"use client";
/**
 * bot (future) · 미래 발굴자 — the future's archaeologists and how they show it (FutureEncounter.tsx, futureWindows.ts, futureFrames.ts, excavators.ts).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page; FuturePresence.tsx (useFuturePresenceControls) assembles it into FuturePresenceVisual. Before
 * 2026-11-23 one group, "미래 (개인뷰 · 시험)", held both future groups (its saves are not read any more).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import type { PresenceMode } from "./FuturePresence";

const GROUP = LAB_GROUP["bot-future"];
const MODES: Record<string, PresenceMode> = {
  "마주침 — 미래의 발굴자가 내 자리를 지날 때만, 둘레의 미래가 점구름으로 모였다 흩어짐": "encounter",
  "겹침 — 현재의 땅 위에 미래의 남은 것이 함께 선다": "overlay",
  "들여다보기 — F 키 (폰: 버튼)를 누르는 동안 미래만": "peek",
  "렌즈 — 내 둘레 반경 안에서만 미래가 보인다": "lens",
};

/** HOW THE FUTURE IS SHOWN — one knob (the artist, 2026-11-22 night: "레바 좀 정리해가면서 하라고"): the observer's windows
 *  (her choice, the default), the plates that fly, the scan, the dream, the first point cloud, and the three early trials. */
export type Look = "window" | "frames" | "scan" | "dream" | "cloud";
export const LOOKS: Record<string, Look> = {
  "창 — 관찰자가 창, 지나간 자리에 남고 가까우면 화면을 채움": "window",
  "판 — 관찰자에게서 판이 날아옴": "frames",
  "스캔 — 둘러본 프레임이 점으로 쌓임": "scan",
  "꿈 — 점구름이 점 단위로 왔다 감": "dream",
  "점구름 — 모였다 흩어짐": "cloud",
};

/**
 * @param bodyUrl  ?body=person|body|sheet on the address: the observer's shape for a preview (shows its knobs)
 */
export function useBotFutureKnobs(isV2: boolean, bodyUrl: string | null) {
  const hidden = () => false;
  /** A folder shows only for the looks it belongs to (the knob `방식`). */
  const when = (looks: readonly Look[]) => (get: (path: string) => unknown) => looks.includes(get(`${GROUP}.look`) as Look);
  return useControls(
    GROUP,
    savable(GROUP, {
      on: { value: true, label: "개인뷰에 켜기 (주소의 ?future= 가 우선 · 0 = 끔)" },
      look: { options: LOOKS, value: "window" as Look, label: "방식" },
      "관찰자": folder(
        {
          excCount: { value: 7, min: 1, max: 30, step: 1, label: "관찰자 수" },
          excRoam: { value: 44, min: 10, max: 96, step: 1, label: "도는 땅의 반경" },
          excLegSec: { value: 24, min: 6, max: 120, step: 1, label: "한 구간 걷고 서는 시간 (s)" },
          meetR: { value: 4, min: 1, max: 15, step: 0.5, label: "마주치는 거리" },
          cooldownSec: { value: 20, min: 2, max: 120, step: 1, label: "같은 관찰자를 다시 만나기까지 (s)" },
          fxLevel: { value: 0.8, min: 0, max: 1, step: 0.05, label: "스쳐 가는 소리 크기 (0 = 없음)" },
        },
        { collapsed: true, render: () => true },
      ),
      "창": folder(
        {
          winH: { value: 2.4, min: 0.3, max: 8, step: 0.05, label: "창의 키" },
          winShape: { options: { "걷는 몸 모양": "body", "사각 창": "sheet", "장노출 사람 (시험 · 주소 ?body=person)": "person" }, value: "body", label: "창의 모양" },
          winSee: { value: 1, min: 0, max: 1, step: 0.05, label: "몸의 진하기 (몸으로 비치는 미래)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winPersonH: { value: 0.8, min: 0.3, max: 4, step: 0.05, label: "사람의 키 (월드 · 0.7 ≈ 1.7 m)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winBoost: { value: 12, min: 0.5, max: 40, step: 0.5, label: "몸 안의 색 진하기", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winAberr: { value: 0.006, min: 0, max: 0.04, step: 0.001, label: "색수차 (세 색이 갈라지는 폭 · 화면 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winTear: { value: 0.5, min: 0, max: 1, step: 0.05, label: "찢김 (가로 띠가 밀려남)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winGlitch: { value: 0.35, min: 0, max: 1, step: 0.05, label: "글리치 (블록이 튐)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winExposure: { value: 0.7, min: 0.03, max: 3, step: 0.01, label: "장노출 길이 (s · 길수록 끌림이 김)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winShake: { value: 0.014, min: 0, max: 0.1, step: 0.002, label: "세로 끌림 (화면 높이 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winStreak: { value: 0.07, min: 0, max: 0.3, step: 0.005, label: "흘러내림 (세로 줄 · 화면 높이 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winDrag: { value: 0.09, min: 0, max: 0.5, step: 0.01, label: "몸 안에 비치는 미래의 끌림 (키 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winGap: { value: 2, min: 0.3, max: 6, step: 0.1, label: "창과 창 사이 (관찰자가 걸은 거리)" },
          winStay: { value: 20, min: 2, max: 120, step: 1, label: "창이 남는 시간 (s)" },
          winMax: { value: 10, min: 2, max: 12, step: 1, label: "서 있는 창 수" },
          winSeeR: { value: 16, min: 4, max: 40, step: 1, label: "관찰자가 보이는 거리" },
          winR: { value: 14, min: 4, max: 24, step: 0.5, label: "창에 비치는 미래의 반경" },
          winFillR: { value: 4, min: 0.5, max: 15, step: 0.25, label: "화면에 겹치기 시작하는 거리" },
          winFillFull: { value: 1.5, min: 0, max: 10, step: 0.25, label: "화면이 꽉 차는 거리" },
          winFillAlpha: { value: 0.85, min: 0.1, max: 1, step: 0.05, label: "꽉 찼을 때 불투명도" },
          winFillHow: { options: { "서서히 짙어짐": "fade", "흰 스캔 선이 위에서 쓸고 내려옴": "scan" }, value: "fade", label: "화면을 채우는 방식" },
        },
        { collapsed: false, render: when(["window"]) },
      ),
      "날아오는 판": folder(
        {
          frameEvery: { value: 0.5, min: 0.2, max: 2, step: 0.05, label: "새 판을 찍는 간격 (s)" },
          frameTurn: { value: 15, min: 2, max: 60, step: 1, label: "이만큼 돌아보면 새 판 (도)" },
          frameMove: { value: 0.4, min: 0.1, max: 3, step: 0.05, label: "이만큼 움직이면 새 판" },
          frameMax: { value: 12, min: 3, max: 12, step: 1, label: "살아 있는 판 수" },
          frameHold: { value: 6, min: 1, max: 30, step: 0.5, label: "적어도 머무는 시간 (s)" },
          frameLife: { value: 6, min: 2, max: 15, step: 0.5, label: "판 한 장의 수명 (s)" },
          frameH: { value: 4, min: 1, max: 10, step: 0.25, label: "판의 높이" },
          frameAlpha: { value: 0.5, min: 0.1, max: 1, step: 0.05, label: "그림의 불투명도" },
          frameEdge: { value: 0.1, min: 0, max: 0.45, step: 0.01, label: "가장자리 부드러움" },
          frameJitter: { value: 0.25, min: 0, max: 1.5, step: 0.05, label: "판끼리 어긋남" },
          frameArriveSec: { value: 2.5, min: 0.3, max: 10, step: 0.1, label: "닥쳐오는 시간 (s)" },
          frameCurve: { value: 2.5, min: 1, max: 6, step: 0.1, label: "속도 곡선 (클수록 처음에 빠름)" },
          frameRest: { value: 3, min: 0.5, max: 10, step: 0.25, label: "느려지는 거리" },
          framePass: { value: 0.5, min: 0, max: 4, step: 0.1, label: "그 뒤 다가오는 속도" },
          frameRevealSec: { value: 1, min: 0.1, max: 4, step: 0.1, label: "흰 스캔 선이 쓰는 시간 (s)" },
          frameOut: { options: { "세로로 흘러내림": "melt", "점 꺼짐": "dots", "스캔 선 되돌아감": "line" }, value: "melt", label: "사라지는 방식" },
          frameBody: { value: 1, min: 0.3, max: 4, step: 0.05, label: "관찰자의 키" },
          frameR: { value: 10, min: 3, max: 24, step: 0.5, label: "그림에 담기는 미래의 반경" },
        },
        { collapsed: true, render: when(["frames"]) },
      ),
      "그림": folder(
        {
          frameTone: { options: { "다채 — 미래의 것마다 제 색 (창에서)": "rich", "회색": "grey", "세피아": "sepia", "청회색": "blue", "없음 — 식생은 초록, 내 칸은 따로": "none" }, value: "grey", label: "톤" },
          frameDistort: { options: { "없음": "none", "세로 늘림": "stretch", "슬릿 띠": "slit", "글리치 블록": "glitch", "굴절 · 유리": "glass" }, value: "none", label: "왜곡" },
          frameDistortAmt: { value: 0.5, min: 0, max: 1, step: 0.05, label: "왜곡 세기" },
          frameInk: { value: 2, min: 0.2, max: 5, step: 0.1, label: "진하기" },
          frameSplat: { value: 0.3, min: 0.05, max: 0.8, step: 0.01, label: "번짐 한 점의 크기" },
          frameSmear: { value: 0.012, min: 0, max: 0.08, step: 0.002, label: "옆으로 끌리는 번짐" },
          frameFilm: { value: 0.05, min: 0, max: 0.3, step: 0.01, label: "빈 곳의 막" },
          framePaper: { options: { "자동 — 길거리의 흰 바탕을 따름": "auto", "흰 종이 위의 어두운 번짐": "paper", "검은 바탕 위의 밝은 번짐": "black" }, value: "auto", label: "바탕 (자동 = 길거리의 흰 바탕을 따름)" },
          frameReread: { value: 3, min: 0, max: 20, step: 0.5, label: "서 있는 동안 미래를 다시 읽는 간격 (s · 0 = 한 번)" },
        },
        { collapsed: true, render: when(["window", "frames"]) },
      ),
      "스캔": folder(
        {
          scanR: { value: 14, min: 3, max: 24, step: 0.5, label: "스캔되는 미래의 반경" },
          scanPix: { value: 20, min: 4, max: 60, step: 1, label: "한 프레임의 점 (천 개)" },
          scanFrames: { value: 32, min: 4, max: 48, step: 1, label: "쌓이는 프레임 수" },
          scanTurn: { value: 3, min: 0.5, max: 20, step: 0.5, label: "이만큼 돌아보면 한 장 더 (도)" },
          scanStill: { value: 0.6, min: 0.1, max: 3, step: 0.1, label: "가만히 있어도 한 장 더 (s)" },
          scanBase: { value: 0.12, min: 0, max: 1, step: 0.01, label: "변화 없는 면에 남는 점" },
          scanGain: { value: 2.5, min: 0, max: 10, step: 0.1, label: "모서리 · 윤곽이 더하는 점" },
          scanNew: { value: 0.8, min: 0, max: 3, step: 0.05, label: "방금 안 보이던 것이 더하는 점" },
          scanPx: { value: 1.6, min: 1, max: 5, step: 0.1, label: "점 크기 (px)" },
          scanGlow: { value: 0.6, min: 0.02, max: 1, step: 0.01, label: "점의 빛" },
          scanSplat: { value: 0.14, min: 0.03, max: 0.5, step: 0.01, label: "표면 조각의 크기" },
          scanHold: { value: 14, min: 3, max: 40, step: 1, label: "둘러볼 수 있는 시간 (s)" },
          scanDark: { value: true, label: "둘러보는 동안 현재를 끔" },
          scanArrive: { value: true, label: "미래가 앞에서 밀려옴" },
          scanArriveDist: { value: 40, min: 5, max: 120, step: 1, label: "밀려오는 거리" },
          scanArriveSec: { value: 2.5, min: 0.3, max: 10, step: 0.1, label: "밀려오는 시간 (s)" },
          scanFlow: { value: true, label: "나는 제자리 (걸으면 미래가 흘러옴)" },
        },
        { collapsed: true, render: when(["scan"]) },
      ),
      "점구름": folder(
        {
          cloudR: { value: 12, min: 4, max: 30, step: 1, label: "보이는 미래의 반경" },
          pointSize: { value: 0.07, min: 0.02, max: 0.3, step: 0.005, label: "점 크기" },
          dreamR: { value: 6, min: 2, max: 20, step: 0.5, label: "꿈 — 조각의 반경" },
          dreamPx: { value: 2.6, min: 1, max: 6, step: 0.1, label: "꿈 — 점 크기 (px)" },
          darkPresent: { value: true, label: "미래가 머무는 동안 현재를 끔" },
        },
        { collapsed: true, render: when(["cloud", "dream"]) },
      ),
      "나타남 · 사라짐": folder(
        {
          inSec: { value: 1, min: 0.2, max: 4, step: 0.1, label: "나타나는 시간 (s)" },
          holdSec: { value: 2.2, min: 0, max: 10, step: 0.1, label: "머무는 시간 (s)" },
          outSec: { value: 1.8, min: 0.3, max: 6, step: 0.1, label: "사라지는 시간 (s)" },
        },
        { collapsed: true, render: when(["cloud", "dream", "scan", "frames"]) },
      ),
      // (superseded by `방식` on 2026-11-22: kept so what was saved under them is not lost, not shown, not read)
      mode: { options: MODES, value: "encounter" as PresenceMode, label: "방식 (옛)", render: hidden },
      dream: { value: false, label: "dream (옛)", render: hidden },
      scan: { value: false, label: "scan (옛)", render: hidden },
      frames: { value: false, label: "frames (옛)", render: hidden },
      windows: { value: false, label: "windows (옛)", render: hidden },
      // (2026-11-23: the observer's body has no clothes of its own — what was saved under it is kept, not shown, not read)
      winColor: { value: "colour", label: "옷의 색 (옛)", render: hidden },
    }),
    { collapsed: false, order: 0.9, render: () => isV2 && labLists("bot-future") },
  );
}
