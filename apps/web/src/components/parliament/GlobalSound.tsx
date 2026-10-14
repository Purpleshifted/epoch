"use client";
/**
 * GlobalSound — the room's speakers under every V2 global view (space / top / side): the mass of everybody present,
 * folded into a monotonous landscape of noise (lib/sound/global.ts). Mounted by app/v2/global/layout.tsx so the
 * views themselves stay untouched. Starts on the first gesture on the page (autoplay rules).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";
import { useWorld } from "./useWorld";
import { DEFAULT_FOLD, currentEpochKey, foldWorld, latestS, withoutWear, type Slab } from "@/lib/parliament";
import { DEFAULT_GLOBAL, GlobalEngine, presences, type GlobalParams } from "@/lib/sound/global";
import { canPickOutput, listOutputs, mutedBySolo, readSolo, setSolo, type OutputDevice } from "@/lib/sound/output";

const ROOT = "소리 (V2 · 스피커)";

export default function GlobalSound() {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const outputOptions = useMemo(() => {
    const o: Record<string, string> = { "기본 출력": "default" };
    for (const d of devices) if (d.id !== "default") o[d.label] = d.id;
    return o;
  }, [devices]);
  const c = useControls(
    ROOT,
    savable(ROOT, {
      on: { value: false, label: "켜기 (기본 꺼짐 · 첫 클릭 뒤 시작 · ESC = 음소거/해제)", render: v2 },
      solo: { value: false, label: "이 창만 듣기 (다른 창은 음소거 — 창 사이에 공유됨)", render: v2 },
      output: { options: outputOptions, value: "default", label: canPickOutput() ? "출력 장치 (헤드셋 / 스피커)" : "출력 장치 — 이 브라우저는 선택 불가", render: v2 },
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
    [outputOptions],
  ) as unknown as GlobalParams & { on: boolean; solo: boolean; output: string };
  const log = useWorld(undefined, 1000);
  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new GlobalEngine() : null), [isV2]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // ESC mutes this window's sound (and un-mutes on the next ESC); another window's SOLO (output.ts) too
  const muted = useRef(false);
  const soloed = useRef(false);
  const [status, setStatus] = useState("♪ 스피커 (글로벌 뷰) · 꺼짐 (Leva)");
  useEffect(() => {
    if (!engine) return;
    const start = () => {
      if (onRef.current && !muted.current && !soloed.current) engine.start().catch(() => {});
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
    if (c.on && !muted.current && !soloed.current) engine.start().catch(() => {});
    else engine.stop();
  }, [engine, c.on]);

  useEffect(() => {
    if (!engine) return;
    if (c.solo) setSolo("global");
    else if (readSolo() === "global") setSolo(null);
  }, [engine, c.solo]);

  useEffect(() => {
    if (!engine || !canPickOutput()) return;
    listOutputs().then(setDevices);
    const onChange = () => listOutputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    engine.setSink(c.output ?? "default").catch(() => {});
  }, [engine, c.output]);

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
      // obey another window's solo
      const other = mutedBySolo("global");
      if (other !== soloed.current) {
        soloed.current = other;
        if (other) engine.stop();
        else if (onRef.current && !muted.current) engine.start().catch(() => {});
      }
      const d = engine.debug;
      const why = !onRef.current ? "꺼짐 (Leva)" : muted.current ? "음소거 (ESC)" : other ? `음소거 (${readSolo() === "mobile" ? "모바일" : "다른"} 창이 솔로)` : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 스피커 (글로벌 뷰) · ${why}${c.solo ? " · 솔로" : ""} · ${d.voices}명 (건물에 ${d.atBuildings} · 걷는 중 ${d.moving}) · bar ${d.bar}`);
      (window as unknown as { __globalSound?: unknown }).__globalSound = { ...d, running: engine.running };
    }, 1000);
    return () => clearInterval(id);
  }, [engine, log, params, c.solo]);

  if (!engine) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 select-none font-mono text-[10px] text-black/45">
      {status}
    </div>
  );
}
