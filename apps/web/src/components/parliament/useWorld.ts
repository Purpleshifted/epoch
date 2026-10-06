"use client";

import { useEffect, useMemo } from "react";
import { useControls } from "leva";
import { DEFAULT_FOLD, EventLog, LS_EVENTS_KEY, loadEvents, type FoldConfig } from "@/lib/parliament";

/** The shared event log of this tab, kept in sync with localStorage (poll + storage events). */
export function useWorld(onCleared?: () => void): EventLog {
  const log = useMemo(() => new EventLog(), []);
  useEffect(() => {
    log.addMany(loadEvents());
    const poll = setInterval(() => log.addMany(loadEvents()), 3000);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_EVENTS_KEY) return;
      if (e.newValue === null) {
        log.clear();
        onCleared?.();
      } else log.addMany(loadEvents());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(poll);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);
  return log;
}

/** Leva knobs of the worker rule (same defaults in the player and top views). */
export function useFoldControls(): FoldConfig {
  const c = useControls("회사원 규칙 (시공간 밀집)", {
    radius: { value: DEFAULT_FOLD.radius, min: 1, max: 8, step: 0.25, label: "공간 반경 (월드 단위)" },
    windowSec: { value: DEFAULT_FOLD.windowSec, min: 10, max: 3600, step: 10, label: "시간 반경 (s)" },
    threshold: { value: DEFAULT_FOLD.threshold, min: 1, max: 200, step: 1, label: "생성 임계 (worker·s)" },
    pourUnit: { value: DEFAULT_FOLD.pourUnit, min: 1, max: 200, step: 1, label: "한 단 올리는 양 (worker·s)" },
    maxHeight: { value: DEFAULT_FOLD.maxHeight, min: 1, max: 20, step: 1, label: "최대 높이 (단)" },
    tauSlabYears: { value: DEFAULT_FOLD.tauSlabYears, min: 10, max: 30000, step: 10, label: "슬래브 마모 시간 (년)" },
    tauFootprintYears: { value: DEFAULT_FOLD.tauFootprintYears, min: 100, max: 300000, step: 100, label: "기초 윤곽 마모 시간 (년)" },
    tauFilterYears: { value: DEFAULT_FOLD.tauFilterYears, min: 1, max: 1000, step: 1, label: "담배필터 마모 시간 (년)" },
  });
  const { radius, windowSec, threshold, pourUnit, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears } = c;
  return useMemo(
    () => ({ ...DEFAULT_FOLD, radius, windowSec, threshold, pourUnit, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears }),
    [radius, windowSec, threshold, pourUnit, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears],
  );
}
