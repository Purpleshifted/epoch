"use client";
/**
 * AfterglowSound — after a life ends and its afterlife has rung out, the ROOM's sound (the speakers' low noise,
 * lib/sound/global.ts) comes into the headset faintly, until the next life begins (the artist, 2026-10-31: so the
 * sound met on taking the headset off is already known — a 여운). The same engine as the wall's, on the headset's
 * output, at the Leva level `죽은 뒤 여운`; silent when the headset is muted or its volume is 0.
 *
 * In the shared world it plays the same score as the wall (lib/sound/score.ts), with the wall's saved knobs: otherwise
 * its bar of 2 s runs against the wall's 2.8 s and the sound met on taking the headset off is not the one in the headset.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFoldState } from "@/components/parliament/useWorld";
import { useRoomLog } from "./useRoomLog";
import type { SoundSetup } from "@/components/parliament/useSound";
import { DEFAULT_FOLD, currentEpochKey, hasWorldMirror, latestS, withoutWear } from "@/lib/parliament";
import { ScoreFeed, attachScoreFeed } from "@/lib/parliament/serverWorld";
import { DEFAULT_GLOBAL, GlobalEngine, globalBuildings, presences, type GlobalParams } from "@/lib/sound/global";
import { BarScore } from "@/lib/sound/score";

/** The afterglow rises over this long (s). */
const RISE_SEC = 8;
/** Where the wall's sound knobs are saved (levaSave.ts: page path + group). */
const WALL_PAGE = "/v2/global/space";
const WALL_SOUND_KEY = `parliament.leva:${WALL_PAGE}:소리 (V2 · 스피커)`;

/** The wall's saved knobs over the defaults; the defaults alone when the server has none or cannot be reached. */
async function wallSoundParams(): Promise<GlobalParams> {
  try {
    const r = await fetch(`/api/presets?page=${encodeURIComponent(WALL_PAGE)}`);
    if (!r.ok) return DEFAULT_GLOBAL;
    const { presets } = (await r.json()) as { presets?: Record<string, { json?: Partial<GlobalParams> }> };
    return { ...DEFAULT_GLOBAL, ...presets?.[WALL_SOUND_KEY]?.json };
  } catch {
    return DEFAULT_GLOBAL;
  }
}

export default function AfterglowSound({ sound }: { sound: SoundSetup }) {
  const [feed] = useState(() => (hasWorldMirror() ? new ScoreFeed() : null));
  const roomLog = useRoomLog(3000, !feed); // everybody, including what this tab wrote (useRoomLog.ts)
  const log = feed ? feed.log : roomLog;
  const foldCfg = useMemo(() => withoutWear(DEFAULT_FOLD), []);
  const fold = useFoldState(log, foldCfg);
  const engine = useMemo(() => new GlobalEngine({ role: "headset" }), []);
  const since = useRef<number | null>(null);
  const buildings = useRef<{ at: number; version: number; list: ReturnType<typeof globalBuildings> }>({ at: 0, version: -1, list: [] });
  const live = useRef(sound);
  useEffect(() => {
    live.current = sound;
  }, [sound]);

  const baseRef = useRef<GlobalParams>(DEFAULT_GLOBAL);
  const score = useMemo(() => (feed ? new BarScore(feed, (s) => fold.at(s).slabs) : null), [feed, fold]);
  useEffect(() => {
    if (!feed || !score) return;
    void wallSoundParams().then((p) => {
      baseRef.current = p;
    });
    const detach = attachScoreFeed(feed);
    engine.setScore(
      (bar) => score.at(bar, Number(currentEpochKey() ?? 0), baseRef.current.barSec, baseRef.current.windowSec),
      (bar) => score.ready(bar, Number(currentEpochKey() ?? 0), baseRef.current.barSec),
    );
    return () => {
      engine.setScore(null);
      detach();
    };
  }, [engine, feed, score]);

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
      const rise = Math.min(1, (now - since.current) / 1000 / RISE_SEC);
      const params = { ...baseRef.current, master: s.params.afterglow * rise };
      if (score) {
        engine.update(score.last, [], epoch, params);
        return;
      }
      if (events.length && now - buildings.current.at > 4000 && buildings.current.version !== log.version) {
        buildings.current = { at: now, version: log.version, list: globalBuildings(fold.at(latestS(events)).slabs) };
      }
      const list = buildings.current.list;
      engine.update(presences(events, DEFAULT_GLOBAL.windowSec, list), list, epoch, params);
    }, 1000);
    return () => {
      clearInterval(id);
      engine.dispose();
    };
  }, [engine, log, fold, score]);

  return null;
}
