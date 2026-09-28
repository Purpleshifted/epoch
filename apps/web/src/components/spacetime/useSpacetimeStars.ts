/**
 * spacetime/useSpacetimeStars.ts
 *
 * localStorage를 주기적으로 폴링하여 영속 별 목록을 반환.
 * top/side 뷰 모두 이 훅으로 데이터를 가져옴.
 *
 * creatorAngle 기반으로 top/side 뷰에서:
 *   - top: 별 색상을 PLANE_COLORS[slot]으로 표시
 *   - side: Y 위치를 creatorAngle로 약간 기울여서 "동시성 평면" 시각화
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { LS_STARS_KEY, PLANE_COLORS, PLANE_SLOT_COUNT, type StarBody } from "./types";

interface Options {
  /** mainSequence+ 만 필터링할지 여부 (default: true) */
  permanentOnly?: boolean;
  /** 폴링 간격 ms (default: 3000) */
  pollMs?: number;
}

interface SpacetimeStarsResult {
  stars: StarBody[];
  /** 마지막으로 localStorage에서 읽은 시각 (Date.now()) */
  pollTime: number;
  /** star.creatorAngle로부터 PLANE_COLORS 색상 반환 */
  getPlaneColor: (star: StarBody) => string;
}

export function useSpacetimeStars(opts: Options = {}): SpacetimeStarsResult {
  const { permanentOnly = true, pollMs = 3000 } = opts;
  const [stars, setStars]       = useState<StarBody[]>([]);
  const pollTimeRef              = useRef<number>(Date.now());
  const [pollTime, setPollTime] = useState<number>(Date.now());

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(LS_STARS_KEY);
        if (!raw) return;
        const all: StarBody[] = JSON.parse(raw);
        const filtered = permanentOnly
          ? all.filter(
              (s) =>
                s.isPermanent ||
                s.phase === "redGiant" ||
                s.phase === "remnant"
            )
          : all;
        pollTimeRef.current = Date.now();
        setStars(filtered);
        setPollTime(pollTimeRef.current);
      } catch {
        // localStorage parse error → ignore
      }
    };

    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [permanentOnly, pollMs]);

  const getPlaneColor = (star: StarBody): string => {
    if (star.creatorAngle == null) return "#ffffff";
    // angle → slotIndex 역산
    const slot =
      Math.round(
        ((star.creatorAngle / (Math.PI * 2)) * PLANE_SLOT_COUNT + PLANE_SLOT_COUNT) %
          PLANE_SLOT_COUNT
      ) % PLANE_SLOT_COUNT;
    return PLANE_COLORS[slot];
  };

  return { stars, pollTime, getPlaneColor };
}

/** pollTime ref 버전 — useFrame과 함께 쓰는 side view용 */
export function useSpacetimeStarsWithRef(opts: Options = {}) {
  const result      = useSpacetimeStars(opts);
  const pollTimeRef = useRef<number>(result.pollTime);

  useEffect(() => {
    pollTimeRef.current = result.pollTime;
  }, [result.pollTime]);

  return { ...result, pollTimeRef };
}
