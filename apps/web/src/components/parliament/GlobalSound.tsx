"use client";
/**
 * GlobalSound — the room's speakers under every V2 global view (space / top / side): the mass of everybody present,
 * folded into a monotonous landscape of noise (lib/sound/global.ts). Mounted by app/v2/global/layout.tsx so the
 * views themselves stay untouched. Starts on the first gesture on the page (autoplay rules). Its controls are the
 * DESK's (lib/sound/desk.ts, the workspace at /v2/sound); no Leva here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParliamentVersion } from "./version";
import { useWorld } from "./useWorld";
import { useDesk } from "./useDesk";
import { DEFAULT_FOLD, currentEpochKey, foldWorld, latestS, withoutWear, type Slab } from "@/lib/parliament";
import { GlobalEngine, presences } from "@/lib/sound/global";
import { mutedBySolo, readSolo } from "@/lib/sound/output";

export default function GlobalSound() {
  const isV2 = useParliamentVersion() === "v2";
  const desk = useDesk();
  const c = { on: desk.speakersOn, output: desk.speakersOutput };
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
    engine.setSink(c.output ?? "default").catch(() => {});
  }, [engine, c.output]);

  const params = desk.speakers;

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
      const who = readSolo();
      const why = !onRef.current ? "꺼짐 (작업실)" : muted.current ? "음소거 (ESC)" : other ? `음소거 (${who === "mobile" ? "모바일" : who === "manager" ? "작업실" : "다른"} 창이 솔로)` : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 스피커 (글로벌 뷰) · ${why}${who === "global" ? " · 솔로" : ""} · ${d.voices}명 (건물에 ${d.atBuildings} · 걷는 중 ${d.moving}) · bar ${d.bar}`);
      (window as unknown as { __globalSound?: unknown }).__globalSound = { ...d, running: engine.running };
    }, 1000);
    return () => clearInterval(id);
  }, [engine, log, params]);

  if (!engine) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 select-none font-mono text-[10px] text-black/45">
      {status}
    </div>
  );
}
