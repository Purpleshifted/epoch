"use client";
/** Puts a visitor's session in the exhibition's record (lib/parliament/sessionLog.ts) when its phase changes; never on a frame. */

import { useEffect, useRef, type RefObject } from "react";
import { openSessionLog, SessionLog } from "@/lib/parliament/sessionLog";
import type { Lang } from "@/lib/parliament";
import type { LifeSession } from "./useLifeSession";

export function useSessionLog(on: boolean, session: LifeSession, visitorRef: RefObject<{ no: number; id: string } | null>, lang: Lang): void {
  const log = useRef<SessionLog | null>(null);
  const { lifeRef, phase, sessionNo, lifeSec, attempts, endedBy } = session;
  useEffect(() => {
    if (!on) return;
    const opened = openSessionLog(lang);
    log.current = opened;
    if (!opened) return;
    const leave = () => opened.leave(lifeRef.current.t);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      log.current = null;
    };
  }, [on, lang, lifeRef]);
  useEffect(() => {
    const say = () => {
      const visitor = visitorRef.current?.no === sessionNo ? visitorRef.current : null;
      log.current?.update({ no: sessionNo, phase, o: visitor?.id ?? null, lifeSec, livedSec: lifeRef.current.t, failed: attempts, endedBy });
      return visitor !== null;
    };
    if (say() || phase !== "live") return;
    // the visitor is named inside the Canvas, a moment after the life begins (RoleField)
    const looking = setInterval(() => {
      if (say()) clearInterval(looking);
    }, 1000);
    return () => clearInterval(looking);
  }, [phase, sessionNo, lifeSec, attempts, endedBy, visitorRef, lifeRef]);
}
