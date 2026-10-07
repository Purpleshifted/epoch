"use client";

import { useEffect, useMemo } from "react";
import { useControls } from "leva";
import { DEFAULT_COLLAGE, DEFAULT_FOLD, DEFAULT_NATURE, DEFAULT_SHARDS, EventLog, LS_EVENTS_KEY, currentEpochKey, loadEvents, type CollageConfig, type FoldConfig, type NatureConfig, type ShardConfig } from "@/lib/parliament";
import type { ArchStyle } from "./Architecture";

/**
 * The shared event log of this tab, kept in sync with localStorage (poll + storage events).
 * When the epoch changes (clear world here or in another tab, or older code resetting the shared epoch key), the
 * world this tab holds has ended: the log is emptied and `onCleared` lets a player tab join the new epoch.
 */
export function useWorld(onCleared?: () => void, pollMs = 3000): EventLog {
  const log = useMemo(() => new EventLog(), []);
  useEffect(() => {
    let epoch = currentEpochKey();
    const sync = () => {
      const now = currentEpochKey();
      // null → an epoch is only the first player tab creating one: there was no world to end
      if (now !== epoch && epoch !== null) {
        log.clear();
        onCleared?.();
      }
      epoch = now;
      log.addMany(loadEvents());
    };
    sync();
    const poll = setInterval(sync, pollMs);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_EVENTS_KEY) return;
      if (e.newValue === null) {
        log.clear();
        onCleared?.();
        epoch = currentEpochKey();
      } else sync();
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

/**
 * Leva knobs of the worker rule. Defaults are DEFAULT_FOLD (the player and Top views), overridable per view — the 3D
 * timespace has its own (SPACE_FOLD in ParliamentSpace).
 */
const NO_OVERRIDES: Partial<FoldConfig> = {};

export function useFoldControls(defaults: Partial<FoldConfig> = NO_OVERRIDES): FoldConfig {
  // pass a constant: a new object every render would rebuild the config every render
  const D = useMemo(() => ({ ...DEFAULT_FOLD, ...defaults }), [defaults]);
  const c = useControls("회사원 규칙 (시공간 밀집)", {
    radius: { value: D.radius, min: 1, max: 8, step: 0.25, label: "공간 반경 (월드 단위)" },
    windowSec: { value: D.windowSec, min: 10, max: 3600, step: 10, label: "시간 반경 (s)" },
    threshold: { value: D.threshold, min: 1, max: 400, step: 1, label: "생성 임계 (worker·s, 1인당 상한 적용)" },
    pourUnit: { value: D.pourUnit, min: 1, max: 200, step: 1, label: "한 단 올리는 양 (worker·s)" },
    minVisitors: { value: D.minVisitors, min: 1, max: 12, step: 1, label: "생성에 필요한 서로 다른 방문자 수" },
    visitorCap: { value: D.visitorCap, min: 1, max: 120, step: 1, label: "방문자 1명이 한 칸에 낼 수 있는 최대 (worker·s)" },
    maxHeight: { value: D.maxHeight, min: 1, max: 20, step: 1, label: "최대 높이 (단)" },
    tauSlabYears: { value: D.tauSlabYears, min: 10, max: 30000, step: 10, label: "슬래브 마모 시간 (년)" },
    tauFootprintYears: { value: D.tauFootprintYears, min: 100, max: 300000, step: 100, label: "기초 윤곽 마모 시간 (년)" },
    tauFilterYears: { value: D.tauFilterYears, min: 1, max: 1000, step: 1, label: "담배필터 마모 시간 (년)" },
    pathVisits: { value: D.pathVisits, min: 1, max: 50, step: 1, label: "길이 되는 통과 횟수 (63 %)" },
    tauPathYears: { value: D.tauPathYears, min: 100, max: 100000, step: 100, label: "길 마모 시간 (년)" },
  });
  const { radius, windowSec, threshold, pourUnit, minVisitors, visitorCap, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears, pathVisits, tauPathYears } = c;
  return useMemo(
    () => ({ ...D, radius, windowSec, threshold, pourUnit, minVisitors, visitorCap, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears, pathVisits, tauPathYears }),
    [D, radius, windowSec, threshold, pourUnit, minVisitors, visitorCap, maxHeight, tauSlabYears, tauFootprintYears, tauFilterYears, pathVisits, tauPathYears],
  );
}

/** Leva knobs of the vegetation point cloud (placeholder formulas, see lib/parliament/nature.ts). */
export function useNatureControls(): { cfg: NatureConfig; pointSize: number } {
  const c = useControls("자연 (초목 point cloud)", {
    lingerRadius: { value: DEFAULT_NATURE.lingerRadius, min: 1, max: 10, step: 0.25, label: "머문 회사원의 영향 반경" },
    dose: { value: DEFAULT_NATURE.dose, min: 0.01, max: 1, step: 0.01, label: "초당 훼손량 (중심)" },
    recoverSec: { value: DEFAULT_NATURE.recoverSec, min: 5, max: 600, step: 5, label: "떠난 뒤 회복 시간 (s)" },
    pathBite: { value: DEFAULT_NATURE.pathBite, min: 0, max: 1, step: 0.05, label: "길이 초목을 지우는 정도" },
    sealedLeft: { value: DEFAULT_NATURE.sealedLeft, min: 0, max: 1, step: 0.05, label: "콘크리트 아래 남는 초목" },
    pointsPerCell: { value: DEFAULT_NATURE.pointsPerCell, min: 4, max: 80, step: 1, label: "셀당 최대 점 수" },
    pointSize: { value: 0.11, min: 0.03, max: 0.4, step: 0.01, label: "점 크기" },
  });
  const { lingerRadius, dose, recoverSec, pathBite, sealedLeft, pointsPerCell, pointSize } = c;
  const cfg = useMemo(
    () => ({ lingerRadius, dose, recoverSec, pathBite, sealedLeft, pointsPerCell }),
    [lingerRadius, dose, recoverSec, pathBite, sealedLeft, pointsPerCell],
  );
  return { cfg, pointSize };
}

/** Leva knobs of how concrete is drawn in Top / Side. */
export function useArchControls(
  defaultUnit: number,
  defaultStyle: ArchStyle = "block",
): { style: ArchStyle; showPaths: boolean; heightUnit: number; shards: ShardConfig; collage: CollageConfig } {
  const c = useControls("건축 재료 (콘크리트)", {
    style: {
      value: defaultStyle,
      options: {
        "사진 파편 (생성 이미지)": "photo",
        "파편 콜라주 (절차 생성)": "shards",
        "블록 (lit)": "block",
        "선화 (wireframe)": "lines",
        "점 껍질 (LiDAR)": "points",
      },
      label: "재료",
    },
    showPaths: { value: true, label: "길(콘크리트 판) 표시" },
    heightUnit: { value: defaultUnit, min: 0.05, max: 3, step: 0.05, label: "한 단 높이 (월드 단위)" },
    photoDensity: { value: DEFAULT_COLLAGE.density, min: 0.2, max: 3, step: 0.1, label: "사진: 셀당 장수" },
    photoScale: { value: DEFAULT_COLLAGE.scale, min: 0.3, max: 2.5, step: 0.05, label: "사진: 크기" },
    shardDensity: { value: DEFAULT_SHARDS.density, min: 0.2, max: 3, step: 0.1, label: "파편: 셀당 밀도" },
    shardPanels: { value: DEFAULT_SHARDS.panels, min: 0, max: 3, step: 0.1, label: "파편: 기울어진 패널" },
    shardStruts: { value: DEFAULT_SHARDS.struts, min: 0, max: 3, step: 0.1, label: "파편: 검은 스트럿" },
  });
  const { shardDensity, shardPanels, shardStruts, photoDensity, photoScale } = c;
  const shards = useMemo(() => ({ density: shardDensity, panels: shardPanels, struts: shardStruts }), [shardDensity, shardPanels, shardStruts]);
  const collage = useMemo(() => ({ density: photoDensity, scale: photoScale }), [photoDensity, photoScale]);
  return { style: c.style as ArchStyle, showPaths: c.showPaths, heightUnit: c.heightUnit, shards, collage };
}
