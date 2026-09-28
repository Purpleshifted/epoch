/**
 * spacetime/useSessionAngle.ts
 *
 * 관객이 처음 진입할 때 고유한 시공간 평면 각도를 배정받음.
 * - 같은 브라우저 세션 = 같은 각도
 * - 탭을 닫고 다시 열면 새 각도
 * - 12분할 슬롯으로 균등 분산
 *
 * 이 훅은 top/side/mobile 어디서든 import해서 "내 각도"를 알 수 있음.
 * top 뷰에서 별을 누가 만들었는지(creatorAngle)와 비교해 같은 평면인지 파악 가능.
 */

"use client";

import { useMemo } from "react";
import {
  PLANE_COLORS,
  PLANE_SLOT_COUNT,
  SS_PLANE_KEY,
  type SessionPlane,
} from "./types";

export function useSessionAngle(): SessionPlane {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return { angle: 0, slotIndex: 0, color: PLANE_COLORS[0] };
    }

    const stored = sessionStorage.getItem(SS_PLANE_KEY);

    if (stored) {
      try {
        const data = JSON.parse(stored) as { slotIndex: number; angle: number };
        return {
          angle: data.angle,
          slotIndex: data.slotIndex,
          color: PLANE_COLORS[data.slotIndex % PLANE_SLOT_COUNT],
        };
      } catch {
        sessionStorage.removeItem(SS_PLANE_KEY);
      }
    }

    // 신규 배정
    const slotIndex = Math.floor(Math.random() * PLANE_SLOT_COUNT);
    const angle     = (slotIndex / PLANE_SLOT_COUNT) * Math.PI * 2;
    sessionStorage.setItem(SS_PLANE_KEY, JSON.stringify({ slotIndex, angle }));

    return { angle, slotIndex, color: PLANE_COLORS[slotIndex] };
  }, []);
}
