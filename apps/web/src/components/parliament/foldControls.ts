"use client";

import { useControls } from "leva";
import { DEFAULT_FOLD, type FoldConfig } from "@/lib/parliament";

/**
 * Leva knobs for the fold rule, shared by the player view and the Top view so both start from the
 * same defaults. (With a server, the config would live there so every view agrees.)
 */
export function useFoldControls(): FoldConfig {
  const c = useControls("Worker rule (회사원)", {
    radius: { value: DEFAULT_FOLD.radius, min: 1, max: 8, step: 0.5, label: "공간 반경 (units)" },
    windowSec: { value: DEFAULT_FOLD.windowSec, min: 10, max: 3600, step: 10, label: "시간 반경 (s)" },
    threshold: { value: DEFAULT_FOLD.threshold, min: 1, max: 200, step: 1, label: "콘크리트가 생기는 밀도 (사람·초)" },
    pourUnit: { value: DEFAULT_FOLD.pourUnit, min: 1, max: 200, step: 1, label: "한 단 올라가는 데 필요한 양" },
    tauSlabYears: { value: DEFAULT_FOLD.tauSlabYears, min: 10, max: 20000, step: 10, label: "지상부 마모 (model y)" },
    tauFootprintYears: { value: DEFAULT_FOLD.tauFootprintYears, min: 100, max: 200000, step: 100, label: "기초 윤곽 마모 (model y)" },
    tauFilterYears: { value: DEFAULT_FOLD.tauFilterYears, min: 1, max: 1000, step: 1, label: "담배필터 마모 (model y)" },
  });
  return { ...DEFAULT_FOLD, ...c };
}
