"use client";
/**
 * ground/useGround.ts: the shared ground, read from the localStorage mirror that the mobile
 * scene writes (stand-in for the server). Used by the Top and Side views.
 *
 * The views never wipe the ground by themselves: `reload()` re-reads the storage, `clear()` empties
 * it (deposits + crossings) and starts a new exhibition epoch. Both are meant for a manual button.
 */

import { useEffect, useRef } from "react";
import {
  GroundStore,
  LS_DEPOSITS_KEY,
  LS_EPOCH_KEY,
  LS_STEPS_KEY,
  type DepositRecord,
  type StepRecord,
} from "@/lib/stratum";

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
}

export interface GroundHandle {
  store: GroundStore;
  /** Exhibition seconds right now. */
  now: () => number;
  /** Pull new records from the storage into the store (adds only). */
  pull: () => void;
  /** Drop the in-memory ground and read the storage again. */
  reload: () => void;
  /** Empty the storage (deposits, crossings) and begin a new epoch. Other open tabs follow. */
  clear: () => void;
}

/**
 * Returns a stable handle; the store fills itself on mount, on `storage` events and every
 * `pollMs` (a view may be open in the same tab-group before anything was written).
 */
export function useGround(pollMs = 3000): GroundHandle {
  const handle = useRef<GroundHandle | null>(null);
  if (!handle.current) {
    const store = new GroundStore();
    let epoch = 0;
    const readEpoch = () => {
      try {
        const raw = localStorage.getItem(LS_EPOCH_KEY);
        epoch = raw ? Number(raw) : Date.now();
      } catch {
        epoch = Date.now();
      }
    };
    const pull = () => {
      for (const r of load<DepositRecord>(LS_DEPOSITS_KEY)) if (typeof r.item === "string") store.addDeposit(r);
      for (const s of load<StepRecord>(LS_STEPS_KEY)) store.addStep(s);
    };
    handle.current = {
      store,
      pull,
      now: () => {
        if (!epoch) readEpoch();
        return (Date.now() - epoch) / 1000;
      },
      reload: () => {
        store.clear();
        epoch = 0;
        pull();
      },
      clear: () => {
        try {
          localStorage.removeItem(LS_STEPS_KEY);
          localStorage.removeItem(LS_DEPOSITS_KEY);
          localStorage.setItem(LS_EPOCH_KEY, String(Date.now()));
        } catch { /* storage unavailable */ }
        store.clear();
        epoch = 0;
      },
    };
  }

  useEffect(() => {
    const h = handle.current!;
    h.pull();
    const onStorage = (e: StorageEvent) => {
      if ((e.key === LS_DEPOSITS_KEY || e.key === LS_STEPS_KEY) && e.newValue === null) {
        // emptied from another tab: forget as well, otherwise old records would linger here
        h.reload();
      } else if (e.key === LS_DEPOSITS_KEY || e.key === LS_STEPS_KEY) h.pull();
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(h.pull, pollMs);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, [pollMs]);

  return handle.current;
}
