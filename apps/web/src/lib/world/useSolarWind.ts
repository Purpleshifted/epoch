"use client";

import { useEffect, useRef, useState } from "react";

export interface SolarWindState {
  protonSpeed: number;   // km/s, 일반 300~800
  protonDensity: number; // n/cm³, 일반 0~20
  kpIndex: number;       // 0~9, 지자기 활동 지수
  // 파생 파라미터 (씬에 직접 쓰일 것들)
  waveAmplitude: number; // 0~1
  waveSpeed: number;     // 0~1
  stormLevel: number;    // 0~1 (Kp 기반)
  isDataFresh: boolean;
}

const DEFAULT_STATE: SolarWindState = {
  protonSpeed: 450,
  protonDensity: 5,
  kpIndex: 2,
  waveAmplitude: 0.3,
  waveSpeed: 0.4,
  stormLevel: 0.2,
  isDataFresh: false,
};

// NOAA API는 CORS를 허용하지 않으므로 Next.js API route를 통해 프록시
const WIND_URL = "/api/solar-wind";
const KP_URL = "/api/kp-index";

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

function deriveParams(speed: number, density: number, kp: number): Omit<SolarWindState, "protonSpeed" | "protonDensity" | "kpIndex" | "isDataFresh"> {
  // speed: 300~800 → 0~1
  const normSpeed = clamp((speed - 300) / 500, 0, 1);
  // density: 0~20 → 0~1
  const normDensity = clamp(density / 20, 0, 1);
  // kp: 0~9 → 0~1
  const normKp = clamp(kp / 9, 0, 1);

  return {
    // 파동 진폭: 태양풍 밀도 + kp 폭풍 영향
    waveAmplitude: clamp(normDensity * 0.6 + normKp * 0.4, 0.05, 1),
    // 파동 속도: 태양풍 속도 기반
    waveSpeed: clamp(normSpeed * 0.7 + 0.15, 0.1, 1),
    // 폭풍 레벨: Kp가 지배
    stormLevel: normKp,
  };
}

export function useSolarWind(intervalMs = 60_000): SolarWindState {
  const [state, setState] = useState<SolarWindState>(DEFAULT_STATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const [windRes, kpRes] = await Promise.all([
        fetch(WIND_URL),
        fetch(KP_URL),
      ]);

      const windData = await windRes.json();
      const kpData = await kpRes.json();

      const speed = windData.protonSpeed ?? 450;
      const density = windData.protonDensity ?? 5;
      const kp = kpData.kpIndex ?? 2;

      setState({
        protonSpeed: speed,
        protonDensity: density,
        kpIndex: kp,
        ...deriveParams(speed, density, kp),
        isDataFresh: true,
      });
    } catch (err) {
      console.warn("[useSolarWind] fetch failed, using defaults", err);
      setState((prev) => ({ ...prev, isDataFresh: false }));
    }
  };

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs]);

  return state;
}
