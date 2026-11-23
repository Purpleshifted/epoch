"use client";
/**
 * bot (present) · 현재의 사람 — the others' bodies, walk, their windows in the long exposure, the asker's cue (PointPeople, bodySheet).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page. Keys are the old 길거리 folder's (11/22–23), so the components read them as before
 * (usePersonalVisuals assembles them into StreetVisual / GrassVisual).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PEOPLE, type PeopleMode } from "./PointPeople";

const PEOPLE_MODES: Record<string, PeopleMode> = {
  "깜빡이는 상자 속 실루엣 — 상자는 지금 네모(멜로디로 깜빡임), 안에 걷는 실루엣": "boxes",
  "점 실루엣 — 점 480개의 몸": "points",
};

export function useBotPresentKnobs(isV2: boolean) {
  const v2 = () => isV2;
  return useControls(
    LAB_GROUP["bot-present"],
    savable(LAB_GROUP["bot-present"], {
      "사람": folder({
        streetPeople: { value: true, label: "사람을 아래 방식으로 (끄면 옛 네모)", render: v2 },
        ppMode: { options: PEOPLE_MODES, value: DEFAULT_PEOPLE.mode, label: "그리기", render: v2 },
        ppGait: { options: { "모캡 걷기 — CMU 실제 보행 넷 (사람마다 하나)": "mocap", "사인 걷기 — 절차적 골격": "sine" } as Record<string, "mocap" | "sine">, value: DEFAULT_PEOPLE.gait, label: "걸음", render: v2 },
        ppColour: { value: DEFAULT_PEOPLE.colour, min: 0, max: 1, step: 0.05, label: "옷 색 (0 = 회색, 1 = 팔레트)", render: v2 },
        ppHeight: { value: DEFAULT_PEOPLE.height, min: 1, max: 2.4, step: 0.05, label: "키 (m, 평균)", render: v2 },
        ppVariety: { value: DEFAULT_PEOPLE.variety, min: 0, max: 1, step: 0.05, label: "다양성 — 키·체격·걸음", render: v2 },
        paperVariety: { value: 1, min: 0, max: 1, step: 0.05, label: "다양성 — 진하기·창의 기울기", render: v2 },
        ppMaxCadence: { value: DEFAULT_PEOPLE.maxCadence, min: 0.8, max: 4, step: 0.1, label: "걸음 박자 상한 (걸음/s)", render: v2 },
        ppFaceEach: { value: DEFAULT_PEOPLE.faceEach, label: "서 있으면 가까운 이를 마주 봄", render: v2 },
        ppFaceRadius: { value: DEFAULT_PEOPLE.faceRadius, min: 1, max: 8, step: 0.5, label: "마주 보는 거리 (m)", render: v2 },
      }),
      "지나간 자리 — 사람마다의 창": folder({
        paperInk: { value: 1, min: 0.2, max: 1, step: 0.05, label: "몸의 진하기", render: v2 },
        paperFlicker: { value: true, label: "표본마다 점프 (보간 없음)", render: v2 },
        paperStretch: { value: 1, min: 0, max: 3, step: 0.1, label: "창이 이동만큼 늘어남 (배수)", render: v2 },
        paperShake: { value: 2, min: 0, max: 8, step: 0.5, label: "표본이 올 때 떨림 (cm)", render: v2 },
        paperTail: { value: 1.6, min: 0.2, max: 6, step: 0.1, label: "사라질 때 꼬리 (s)", render: v2 },
        paperFrame: { value: 1, min: 0, max: 2, step: 0.1, label: "창 필름의 세기", render: v2 },
        paperAspectMin: { value: 0.5, min: 0.2, max: 2, step: 0.05, label: "창 비율 최소 (폭/키)", render: v2 },
        paperAspectMax: { value: 1.3, min: 0.2, max: 2.5, step: 0.05, label: "창 비율 최대", render: v2 },
      }),
      "말 걸기": folder({
        ppCue: { value: DEFAULT_PEOPLE.cue, label: "말 거는 이의 창이 커짐", render: v2 },
        askTurn: { value: true, label: "시선이 그쪽으로 돌아감 (손대면 멈춤)", render: v2 },
        askRipple: { value: true, label: "창에서 사각 파문", render: v2 },
        paperBubble: { value: true, label: "옆에 멜로디 기호 버블", render: v2 },
      }),
      "시험 (점 몸 · 옛 노브)": folder({
        ppPoints: { value: DEFAULT_PEOPLE.points, min: 64, max: 800, step: 16, label: "점 몸: 점 수", render: v2 },
        ppPointsPhone: { value: DEFAULT_PEOPLE.pointsPhone, min: 32, max: 480, step: 16, label: "점 몸: 폰 점 수", render: v2 },
        ppDot: { value: DEFAULT_PEOPLE.dot, min: 0.01, max: 0.3, step: 0.005, label: "점 몸: 점 크기 (m)", render: v2 },
        ppMaxPx: { value: DEFAULT_PEOPLE.maxPx, min: 2, max: 24, step: 1, label: "점 몸: 점 최대 (px)", render: v2 },
        ppGrey: { value: DEFAULT_PEOPLE.grey, min: 0.2, max: 1, step: 0.02, label: "점 몸: 회색", render: v2 },
        ppBreath: { value: DEFAULT_PEOPLE.breath, min: 0, max: 3, step: 0.1, label: "점 몸: 숨", render: v2 },
        ppSmearSec: { value: DEFAULT_PEOPLE.smearSec, min: 0, max: 8, step: 0.25, label: "점 몸: 번짐 (s)", render: v2 },
        ppSmearCopies: { value: DEFAULT_PEOPLE.smearCopies, min: 1, max: 8, step: 1, label: "점 몸: 번짐 복사본", render: v2 },
        ppPlate: { value: DEFAULT_PEOPLE.plate, label: "점 몸: 세운 판", render: v2 },
        ppPlateAlpha: { value: DEFAULT_PEOPLE.plateAlpha, min: 0.02, max: 0.5, step: 0.01, label: "점 몸: 판 불투명도", render: v2 },
        ppFog: { value: DEFAULT_PEOPLE.fog, label: "점 몸: 안개를 받음", render: v2 },
        ppMaxSpeed: { value: DEFAULT_PEOPLE.maxSpeed, min: 1, max: 6, step: 0.1, label: "보간 최고 속도 (월드/s)", render: v2 },
        meBody: { value: DEFAULT_PEOPLE.meBody, label: "나 = 내 등 (점 몸)", render: v2 },
        meRest: { value: DEFAULT_PEOPLE.meRest, min: 0, max: 1, step: 0.05, label: "내 몸: 쉴 때 밝기", render: v2 },
        ppBoxAspect: { value: DEFAULT_PEOPLE.boxAspect, min: 0.3, max: 1.2, step: 0.05, label: "검은 바탕 상자: 폭", render: v2 },
        ppBoxRest: { value: DEFAULT_PEOPLE.boxRest, min: 0.05, max: 0.6, step: 0.01, label: "검은 바탕 상자: 쉴 때 회색", render: v2 },
        // (hidden 11/23: the white ground's bodies are 3D now — bodySheet.ts — and no sheet is blurred; the value is kept)
        paperBlur: { value: 3, min: 0, max: 8, step: 0.5, label: "옛: 시트 번짐 (px)", render: () => false },
        paperFade: { value: 12, min: 3, max: 30, step: 0.5, label: "옛: 필름 옅어지는 거리", render: v2 },
      }, { collapsed: true }),
    }),
    { collapsed: false, order: 0.6, render: () => isV2 && labLists("bot-present") },
  );
}
