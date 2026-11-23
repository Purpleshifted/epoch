"use client";
/**
 * 바탕 · 종이와 노출 — the ground every asset stands on: the white paper and the long exposure (InkPaper, longExposure).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page. Keys are the old 길거리 folder's (11/22–23), so the components read them as before
 * (usePersonalVisuals assembles them into StreetVisual / GrassVisual).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_INK } from "./InkPaper";

export function useBaseKnobs(isV2: boolean) {
  const v2 = () => isV2;
  return useControls(
    LAB_GROUP.base,
    savable(LAB_GROUP.base, {
      streetOn: { value: true, label: "길거리 켜기 (끄면 아래 모두 꺼짐)", render: v2 },
      paperOn: { value: true, label: "흰 바탕 — 장노출 (끄면 검은 바탕의 상자)", render: v2 },
      "장노출": folder({
        paperExposure: { value: 0.5, min: 0.05, max: 2, step: 0.05, label: "노출 — 한 프레임이 남기는 양", render: v2 },
        inkDecay: { value: DEFAULT_INK.decay, min: 0.8, max: 0.99, step: 0.005, label: "잔상 — 프레임당 남는 비율", render: v2 },
        inkDensity: { value: DEFAULT_INK.density, min: 0.2, max: 1, step: 0.02, label: "쌓인 것의 최대 어두움", render: v2 },
      }),
      "사진": folder({
        inkNarrow: { value: DEFAULT_INK.narrow, min: 0, max: 8, step: 0.1, label: "가까운 흐림 (px)", render: v2 },
        inkWide: { value: DEFAULT_INK.wide, min: 0, max: 24, step: 0.5, label: "먼 흐림 (px)", render: v2 },
        inkFade: { value: DEFAULT_INK.fade, min: 0, max: 1, step: 0.05, label: "멀수록 옅어짐", render: v2 },
        inkRolloff: { value: DEFAULT_INK.rolloff, min: 0, max: 1, step: 0.05, label: "밝은 쪽이 부드럽게 날아감", render: v2 },
        inkShake: { value: DEFAULT_INK.shake, min: 0, max: 5, step: 0.1, label: "손떨림 — 사람만 세로로 끌림 (화면 높이 %)", render: v2 },
        inkHalo: { value: DEFAULT_INK.halo, min: 0, max: 1, step: 0.05, label: "빛 번짐 — 흰빛이 몸 가장자리로 스밈", render: v2 },
        inkBurn: { value: DEFAULT_INK.burn, min: 1, max: 3, step: 0.05, label: "노출 과다 — 중간 톤이 밝아짐", render: v2 },
        inkGrain: { value: DEFAULT_INK.grain, min: 0, max: 0.03, step: 0.001, label: "입자", render: v2 },
      }),
    }),
    { collapsed: false, order: 0.5, render: () => isV2 && labLists("base") },
  );
}
