"use client";
/**
 * GlobalSound — the room's speakers under every V2 global view (space / top / side): the mass of everybody present,
 * folded into a monotonous landscape of noise (lib/sound/global.ts). Mounted by app/v2/global/layout.tsx so the
 * views themselves stay untouched. Starts on the first gesture on the page (autoplay rules).
 */

import { useEffect, useMemo, useRef } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";
import { useWorld } from "./useWorld";
import { DEFAULT_FOLD, currentEpochKey, foldWorld, latestS, withoutWear, type Slab } from "@/lib/parliament";
import { DEFAULT_GLOBAL, GlobalEngine, presences, type GlobalParams } from "@/lib/sound/global";

const ROOT = "소리 (V2 · 스피커)";

export default function GlobalSound() {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const c = useControls(
    ROOT,
    savable(ROOT, {
      on: { value: true, label: "켜기 (첫 클릭 뒤 시작 · ESC = 이 창 음소거/해제)", render: v2 },
      master: { value: DEFAULT_GLOBAL.master, min: 0, max: 1, step: 0.01, label: "음량", render: v2 },
      octavesDown: { value: DEFAULT_GLOBAL.octavesDown, min: 0, max: 4, step: 1, label: "모티프를 내리는 옥타브", render: v2 },
      cutoff: { value: DEFAULT_GLOBAL.cutoff, min: 80, max: 4000, step: 10, label: "전체 저역통과 (Hz)", render: v2 },
      hall: { value: DEFAULT_GLOBAL.hall, min: 0, max: 1, step: 0.01, label: "홀 (8 s)", render: v2 },
      perVoice: { value: DEFAULT_GLOBAL.perVoice, min: 0, max: 0.5, step: 0.005, label: "한 사람의 목소리 크기 (모두 합산됨)", render: v2 },
      tickLevel: { value: DEFAULT_GLOBAL.tickLevel, min: 0, max: 1, step: 0.01, label: "한 사람의 리듬 흔적 크기", render: v2 },
      spread: { value: DEFAULT_GLOBAL.spread, min: 0, max: 1, step: 0.01, label: "뭉침의 좌우 폭 (건물·사람 위치)", render: v2 },
      drive: { value: DEFAULT_GLOBAL.drive, min: 1, max: 8, step: 0.1, label: "뭉개짐 (새추레이션)", render: v2 },
      windowSec: { value: DEFAULT_GLOBAL.windowSec, min: 30, max: 1200, step: 30, label: "존재로 세는 창 (s)", render: v2 },
    }),
    { collapsed: true, order: -1, render: v2 },
  ) as unknown as GlobalParams & { on: boolean };
  const log = useWorld(undefined, 1000);
  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new GlobalEngine() : null), [isV2]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // ESC mutes this window's sound (and un-mutes on the next ESC)
  const muted = useRef(false);
  useEffect(() => {
    if (!engine) return;
    const start = () => {
      if (onRef.current && !muted.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        muted.current = !muted.current;
        if (muted.current) engine.stop();
        else if (onRef.current) engine.start().catch(() => {});
        return;
      }
      start();
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", onKey);
      engine.dispose();
    };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    if (c.on && !muted.current) engine.start().catch(() => {});
    else engine.stop();
  }, [engine, c.on]);

  const { master, barSec, octavesDown, cutoff, hall, perVoice, tickLevel, spread, drive, windowSec } = { ...DEFAULT_GLOBAL, ...c };
  const params = useMemo<GlobalParams>(
    () => ({ master, barSec, octavesDown, cutoff, hall, perVoice, tickLevel, spread, drive, windowSec }),
    [master, barSec, octavesDown, cutoff, hall, perVoice, tickLevel, spread, drive, windowSec],
  );

  // the buildings (for the keys and the clumps): folded every few seconds, without wear (the whole history)
  const slabs = useRef<{ at: number; version: number; slabs: Slab[] }>({ at: 0, version: -1, slabs: [] });
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const epoch = Number(currentEpochKey() ?? 0);
      if (!epoch) return;
      const events = log.all();
      const now = Date.now();
      if (now - slabs.current.at > 4000 && slabs.current.version !== log.version && events.length) {
        slabs.current = { at: now, version: log.version, slabs: foldWorld(events, latestS(events), withoutWear(DEFAULT_FOLD)).slabs };
      }
      engine.update(presences(events, params.windowSec, slabs.current.slabs), epoch, params);
      (window as unknown as { __globalSound?: unknown }).__globalSound = { ...engine.debug, running: engine.running };
    }, 1000);
    return () => clearInterval(id);
  }, [engine, log, params]);

  return null;
}
