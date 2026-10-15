"use client";
/**
 * useDesk — the live desk (lib/sound/desk.ts) in a window that only LISTENS: the player tab, the speakers. It is
 * read on load and follows every change the workspace makes (the storage event, and the bus).
 */

import { useEffect, useState } from "react";
import { DESK_KEY, readDesk, type DeskState } from "@/lib/sound/desk";
import { openBus, type BusMessage } from "@/lib/sound/bus";

export function useDesk(): DeskState {
  const [desk, setDesk] = useState<DeskState>(() => readDesk());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DESK_KEY) setDesk(readDesk());
    };
    window.addEventListener("storage", onStorage);
    const bus = openBus();
    if (bus) bus.onmessage = (e: MessageEvent<BusMessage>) => {
      if (e.data?.type === "desk") setDesk(e.data.desk);
    };
    return () => {
      window.removeEventListener("storage", onStorage);
      bus?.close();
    };
  }, []);
  return desk;
}
