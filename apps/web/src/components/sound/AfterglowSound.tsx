"use client";
/**
 * AfterglowSound — after a life ends and its afterlife has rung out, the ROOM's sound (the speakers' low noise,
 * lib/sound/global.ts) comes into the headset faintly, until the next life begins (the artist, 2026-10-31: so the
 * sound met on taking the headset off is already known — a 여운). The same engine as the wall's, on the headset's
 * output, at the Leva level `죽은 뒤 여운`; silent when the headset is muted or its volume is 0.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFoldState, useWorld } from "@/components/parliament/useWorld";
import type { SoundSetup } from "@/components/parliament/useSound";
import { DEFAULT_FOLD, currentEpochKey, latestS, withoutWear } from "@/lib/parliament";
import { DEFAULT_GLOBAL, GlobalEngine, globalBuildings, presences } from "@/lib/sound/global";

/** The afterglow rises over this long (s). */
const RISE_SEC = 8;

export default function AfterglowSound({ sound }: { sound: SoundSetup }) {
  const log = useWorld(undefined, 3000);
  const foldCfg = useMemo(() => withoutWear(DEFAULT_FOLD), []);
  const fold = useFoldState(log, foldCfg);
  const engine = useMemo(() => new GlobalEngine({ role: "headset" }), []);
  const since = useRef<number | null>(null);
  const buildings = useRef<{ at: number; version: number; list: ReturnType<typeof globalBuildings> }>({ at: 0, version: -1, list: [] });
  const live = useRef(sound);
  useEffect(() => {
    live.current = sound;
  }, [sound]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = live.current;
      const over = s.engine.afterlifeOver;
      const wanted = over && !s.muted && s.params.master > 0 && s.params.afterglow > 0;
      if (!wanted) {
        if (since.current != null) {
          since.current = null;
          engine.stop();
        }
        return;
      }
      if (since.current == null) {
        since.current = Date.now();
        engine.start().catch(() => {});
      }
      const epoch = Number(currentEpochKey() ?? 0);
      const events = log.all();
      const now = Date.now();
      if (events.length && now - buildings.current.at > 4000 && buildings.current.version !== log.version) {
        buildings.current = { at: now, version: log.version, list: globalBuildings(fold.at(latestS(events)).slabs) };
      }
      const list = buildings.current.list;
      const rise = Math.min(1, (now - since.current) / 1000 / RISE_SEC);
      engine.update(presences(events, DEFAULT_GLOBAL.windowSec, list), list, epoch, { ...DEFAULT_GLOBAL, master: s.params.afterglow * rise });
    }, 1000);
    return () => {
      clearInterval(id);
      engine.dispose();
    };
  }, [engine, log, fold]);

  return null;
}
