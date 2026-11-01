"use client";
/**
 * useRoomLog — the shared event log as the room's sound needs it: EVERYBODY in the world, including what this very tab
 * wrote. useWorld skips reading storage when the stored log is just what this tab wrote (log.ts eventsWrittenHere —
 * right for the view, whose own log already holds those events). The sound keeps a log of its own, so in a tab that
 * writes events — the wall running the resident bots, the player tab — it stayed EMPTY: the wall's sound heard nobody
 * (measured 2026-11-01: 15 bots, 510 events, 0 voices). Here the stored events are read regardless, every few seconds.
 *
 * `enabled` false: nothing is read (the shared world's sound writes its bars from the server's chunks: score.ts).
 */

import { useEffect } from "react";
import { useWorld } from "@/components/parliament/useWorld";
import { eventsWrittenHere, loadEvents, type EventLog } from "@/lib/parliament";

export function useRoomLog(pollMs = 3000, enabled = true): EventLog {
  const log = useWorld(undefined, pollMs, enabled);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      // the case useWorld leaves out (the other case it reads itself)
      if (eventsWrittenHere()) log.addMany(loadEvents());
    };
    const first = setTimeout(read, 0);
    const id = setInterval(read, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [log, pollMs, enabled]);
  return log;
}
