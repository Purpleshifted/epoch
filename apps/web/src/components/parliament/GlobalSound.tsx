"use client";
/**
 * GlobalSound — the room's speakers under every V2 global view (space / top / side): the low noise of everybody
 * present (lib/sound/global.ts; brought back from the warehouse for the November show, docs/sound-logic.md §10b).
 * Mounted by app/v2/global/layout.tsx so the views themselves stay untouched.
 *
 * - Starts on the first click or key on the page (browsers block sound before a gesture). ESC mutes this window —
 *   NOT on the exhibition wall (?ui=0): there ESC only leaves full screen, it must never silence the room unseen.
 * - On by default: the exhibition wall has no panel (?ui=0) — then there is no status line either.
 * - An empty world is silent by default (nobody present = no voices, no bed); `빈 세계의 바닥` keeps a floor of noise.
 * - ?sound=0 turns it off entirely (for checks in a Claude browser: no sound through the artist's speakers).
 * - The buildings come from the growing fold (useFoldState): cheap every few seconds, unlike a full fold.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { useFoldState, useWorld } from "./useWorld";
import { DEFAULT_FOLD, currentEpochKey, latestS, withoutWear } from "@/lib/parliament";
import { DEFAULT_GLOBAL, GlobalEngine, globalBuildings, presences, type GlobalParams } from "@/lib/sound/global";

const ROOT = "소리 (V2 · 스피커)";

function urlFlag(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function GlobalSound() {
  const [off] = useState(() => urlFlag("sound") === "0");
  const [bare] = useState(() => urlFlag("ui") === "0" || urlFlag("demo") === "1");
  const c = useControls(
    ROOT,
    savable(ROOT, {
      on: { value: true, label: "켜기 (첫 클릭/키 뒤 시작 · ESC 음소거)" },
      master: { value: DEFAULT_GLOBAL.master, min: 0, max: 1, step: 0.01, label: "음량" },
      cutoff: { value: DEFAULT_GLOBAL.cutoff, min: 80, max: 2000, step: 10, label: "저역통과 (Hz) — 걷는 사람이 많으면 조금 열림" },
      bedPer: { value: DEFAULT_GLOBAL.bedPer, min: 0, max: 0.05, step: 0.001, label: "노이즈 바닥: 한 사람당" },
      bedMax: { value: DEFAULT_GLOBAL.bedMax, min: 0, max: 0.6, step: 0.01, label: "노이즈 바닥: 최대" },
      bedFloor: { value: DEFAULT_GLOBAL.bedFloor, min: 0, max: 0.2, step: 0.005, label: "빈 세계의 바닥 (아무도 없을 때도 남는 노이즈, 0 = 무음)" },
      perVoice: { value: DEFAULT_GLOBAL.perVoice, min: 0, max: 0.4, step: 0.005, label: "한 사람의 낮은 목소리" },
      octavesDown: { value: DEFAULT_GLOBAL.octavesDown, min: 0, max: 4, step: 1, label: "목소리를 내리는 옥타브" },
      tickLevel: { value: DEFAULT_GLOBAL.tickLevel, min: 0, max: 1, step: 0.01, label: "리듬 흔적 (틱)" },
      hall: { value: DEFAULT_GLOBAL.hall, min: 0, max: 1, step: 0.01, label: "홀 (5 s)" },
      drive: { value: DEFAULT_GLOBAL.drive, min: 1, max: 8, step: 0.1, label: "포화 (1 = 없음)" },
      spread: { value: DEFAULT_GLOBAL.spread, min: 0, max: 1, step: 0.05, label: "좌우 퍼짐 (건물 = 덩어리)" },
      barSec: { value: DEFAULT_GLOBAL.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 (s) — 헤드셋과 같은 그리드" },
      windowSec: { value: DEFAULT_GLOBAL.windowSec, min: 60, max: 3600, step: 30, label: "있다고 치는 시간 창 (s)" },
    }),
    { collapsed: true, order: 5 },
  ) as unknown as GlobalParams & { on: boolean };
  const { on, master, cutoff, bedPer, bedMax, bedFloor, perVoice, octavesDown, tickLevel, hall, drive, spread, barSec, windowSec } = c;
  const params = useMemo<GlobalParams>(
    () => ({ master, cutoff, bedPer, bedMax, bedFloor, perVoice, octavesDown, tickLevel, hall, drive, spread, barSec, windowSec }),
    [master, cutoff, bedPer, bedMax, bedFloor, perVoice, octavesDown, tickLevel, hall, drive, spread, barSec, windowSec],
  );

  const log = useWorld(undefined, 3000);
  const foldCfg = useMemo(() => withoutWear(DEFAULT_FOLD), []);
  const fold = useFoldState(log, foldCfg);
  const engine = useMemo(() => (!off && typeof window !== "undefined" ? new GlobalEngine() : null), [off]);
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  }, [on]);

  const muted = useRef(false);
  const [status, setStatus] = useState("♪ 스피커 (글로벌 뷰) · 클릭하면 시작");
  useEffect(() => {
    if (!engine) return;
    (window as unknown as { __globalSound?: GlobalEngine }).__globalSound = engine;
    const start = () => {
      if (onRef.current && !muted.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      // the exhibition wall: ESC leaves full screen and nothing else (a mute there would be invisible)
      if (e.key === "Escape" && !bare) {
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
  }, [engine, bare]);

  useEffect(() => {
    if (!engine) return;
    if (on && !muted.current) engine.start().catch(() => {}); // a no-op until a gesture has unlocked the audio
    else engine.stop();
  }, [engine, on]);

  // who is present, every second; the buildings from the growing fold every few seconds
  const buildings = useRef<{ at: number; version: number; list: ReturnType<typeof globalBuildings> }>({ at: 0, version: -1, list: [] });
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const epoch = Number(currentEpochKey() ?? 0);
      if (!epoch) {
        // no world yet (a fresh origin): nobody to hear — only the empty world's floor, if any
        engine.update([], [], 0, params);
        return;
      }
      const events = log.all();
      const now = Date.now();
      if (events.length && now - buildings.current.at > 4000 && buildings.current.version !== log.version) {
        buildings.current = { at: now, version: log.version, list: globalBuildings(fold.at(latestS(events)).slabs) };
      }
      const list = buildings.current.list;
      engine.update(presences(events, params.windowSec, list), list, epoch, params);
      if (bare) return;
      const d = engine.debug;
      const why = !onRef.current ? "꺼짐 (Leva)" : muted.current ? "음소거 (ESC)" : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 스피커 (글로벌 뷰) · ${why} · ${d.voices}명 (건물에 ${d.atBuildings} · 걷는 중 ${d.moving}) · 건물 ${list.length} · bar ${d.bar} · → ${engine.output}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine, log, fold, params, bare]);

  if (!engine || bare) return null;
  return <div className="pointer-events-none fixed bottom-4 right-4 z-50 select-none font-mono text-[10px] text-black/45 mix-blend-difference">{status}</div>;
}
