/**
 * spacetime/useSessionAngle.ts
 *
 * 관객이 처음 진입할 때 고유한 시공간 평면을 배정받음.
 * 동시성 초평면은 두 값으로 정의:
 *   φ (phi):  운동 방향 — XZ 평면에서 어느 방향으로 움직이나 (0 ~ 2π, 독립 무작위)
 *   β (beta): 속도 v/c (0.1 ~ 0.85) — 기울기 크기 (SR 광속 제한 이내)
 *
 * - 같은 브라우저 세션 = 같은 평면
 * - 탭 닫고 다시 열면 새 평면
 * - slotIndex: 12분할 → 색상 인덱스 (phi 기반으로 결정)
 */

"use client";

import { useMemo } from "react";
import {
  PLANE_COLORS,
  PLANE_SLOT_COUNT,
  SS_PLANE_KEY,
  type SessionPlane,
} from "../types";

export function useSessionAngle(): SessionPlane {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return { phi: 0, beta: 0.3, slotIndex: 0, color: PLANE_COLORS[0] };
    }

    const stored = sessionStorage.getItem(SS_PLANE_KEY);

    if (stored) {
      try {
        const data = JSON.parse(stored) as {
          slotIndex: number;
          phi: number;
          beta: number;
        };
        if (typeof data.phi === "number" && typeof data.beta === "number") {
          return {
            phi: data.phi,
            beta: data.beta,
            slotIndex: data.slotIndex,
            color: PLANE_COLORS[data.slotIndex % PLANE_SLOT_COUNT],
          };
        }
      } catch {}
      sessionStorage.removeItem(SS_PLANE_KEY);
    }

    // 신규 배정
    // φ: XZ 전방향 (0 ~ 2π) — 어느 방향으로 움직이는 관측자인지
    // β: 속도 v/c (0.1 ~ 0.85) — 광속 제한 이내에서 독립적으로 배정
    const phi      = Math.random() * Math.PI * 2;
    const beta     = 0.1 + Math.random() * 0.75;           // 0.1 ~ 0.85
    const slotIndex = Math.floor((phi / (Math.PI * 2)) * PLANE_SLOT_COUNT) % PLANE_SLOT_COUNT;

    sessionStorage.setItem(SS_PLANE_KEY, JSON.stringify({ slotIndex, phi, beta }));

    return { phi, beta, slotIndex, color: PLANE_COLORS[slotIndex] };
  }, []);
}
