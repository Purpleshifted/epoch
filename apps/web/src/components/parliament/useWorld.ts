"use client";

import { useEffect, useRef } from "react";
import { EventLog, LS_EVENTS_KEY, clearWorld, loadEvents } from "@/lib/parliament";

const POLL_MS = 3000;

/**
 * The shared world as seen by one browser tab: an EventLog that follows the localStorage mirror
 * (a `storage` event from another tab, plus a slow poll). With a server this hook is what changes.
 */
export function useWorld() {
  const ref = useRef<EventLog | null>(null);
  if (!ref.current) ref.current = new EventLog();
  const log = ref.current;

  useEffect(() => {
    log.addMany(loadEvents());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_EVENTS_KEY) return;
      if (e.newValue === null) log.clear(); // emptied elsewhere: start over with it
      else log.addMany(loadEvents());
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(() => log.addMany(loadEvents()), POLL_MS);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, [log]);

  return {
    log,
    reload: () => log.addMany(loadEvents()),
    clear: () => {
      clearWorld();
      log.clear();
    },
  };
}
