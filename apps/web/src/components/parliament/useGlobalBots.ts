"use client";

/**
 * Bots driven from a GLOBAL view (V2): the same crowd a player tab runs (RoleField), without opening /mobile — for
 * watching the strata form. One Leva group "봇 (글로벌에서 돌리기)"; while on, every bot's presence is emitted on the
 * world clock (worldClock.ts), steered over the folded ground (paths, buildings) and mirrored to localStorage like a
 * player tab's, so every open view shares it. The history window rolls on as a player tab would roll it.
 *
 * Only ONE emitter should run per browser: a player tab with its bots on, or one global view with this on — two
 * emitters produce two crowds (different bot ids are not guaranteed: both are bot0 … botN).
 */

import { useEffect, useMemo, useRef } from "react";
import { useControls } from "leva";
import {
  SEAL_H,
  SESSION_ROLES,
  botActor,
  botPlan,
  currentEpochKey,
  dueSamples,
  getEpochMs,
  saveMerged,
  sessionSeconds,
  setKeepFrom,
  steerBot,
  worldNow,
  type Actor,
  type EventLog,
  type Flock,
  type FoldConfig,
  type PEvent,
  type RoleId,
} from "@/lib/parliament";
import { savable } from "./levaSave";
import { useTicker } from "./useTicker";
import { useFoldState } from "./useWorld";

const TICK_MS = 250;
const SAVE_EVERY_MS = 1000;
const KEEP_EVERY_MS = 30_000;
const KEEP_MIN_WALL_MS = 3000;
const BOT_GROUND_EVERY_MS = 5000;

const BOT_OPTIONS: Record<string, RoleId | "mixed"> = {
  "회사원 (worker)": "worker",
  "섞어서 (worker · cat · car · tree 차례로)": "mixed",
  "길고양이 (street cat)": "cat",
  "자동차 (car)": "car",
  "나무 (tree)": "tree",
};

/**
 * The bots' Leva group and emitter for a global view. `enabled` false (V1) renders nothing and emits nothing.
 * Returns how many bots run (0 = off), for the view's readout.
 */
export function useGlobalBots(log: EventLog, cfg: FoldConfig, enabled: boolean, order = 1.5): number {
  const b = useControls(
    "봇 (글로벌에서 돌리기)",
    savable("봇 (글로벌에서 돌리기)", {
      botOn: { value: false, label: "봇 활성화 (플레이어 탭 없이; 플레이어 탭의 봇과 같이 켜지 말 것)", render: () => enabled },
      botCount: { value: 12, min: 1, max: 30, step: 1, label: "봇 수", render: () => enabled },
      botRole: { options: BOT_OPTIONS, value: "worker" as RoleId | "mixed", label: "봇 역할", render: () => enabled },
      botGroups: { value: 4, min: 1, max: 10, step: 1, label: "봇 무리 수 (무리당 3명 이상이어야 콘크리트)", render: () => enabled },
      botSpread: { value: 14, min: 0, max: 60, step: 1, label: "무리 간 거리 (월드)", render: () => enabled },
      botTimeSpread: { value: 60, min: 0, max: 600, step: 5, label: "봇 시각 폭 (s, 지금 기준 ±절반에서 랜덤)", render: () => enabled },
    }),
    { order, collapsed: !enabled },
  );
  const nBots = enabled && b.botOn ? b.botCount : 0;
  const flock = useMemo<Flock>(() => ({ groups: b.botGroups, spread: b.botSpread, timeSpread: b.botTimeSpread }), [b.botGroups, b.botSpread, b.botTimeSpread]);
  // the ground the bots walk on, folded as it grows (the whole world)
  const fold = useFoldState(log, cfg);

  const live = useRef({ nBots, role: b.botRole, flock, cfg, fold });
  useEffect(() => {
    live.current = { nBots, role: b.botRole, flock, cfg, fold };
  }, [nBots, b.botRole, flock, cfg, fold]);

  const epochMs = useRef(0);
  const pending = useRef<PEvent[]>([]);
  const seq = useRef(0);
  const tag = useRef("");
  const lastSampleMs = useRef(0);
  const botStartMs = useRef(0);
  const lastSaveMs = useRef(0);
  const lastKeepMs = useRef(0);
  const lastKeepWall = useRef(0);
  const ground = useRef<{ at: number; level: Map<string, number>; built: Set<string> } | null>(null);
  const routes = useRef(new Map<string, number[]>());

  // the epoch is joined when the bots are switched on; off = what is pending is written, the next switch-on starts a
  // fresh crowd
  useEffect(() => {
    if (nBots > 0) {
      epochMs.current = getEpochMs();
      if (!tag.current) tag.current = Math.random().toString(36).slice(2, 6); // this view's crowd, unique ids
    } else {
      if (pending.current.length && epochMs.current) saveMerged(pending.current, epochMs.current);
      pending.current = [];
      botStartMs.current = 0;
      lastSampleMs.current = 0;
    }
  }, [nBots]);

  useTicker(TICK_MS, () => {
    const { nBots: n, role, flock: fl, cfg: foldCfg, fold: theFold } = live.current;
    if (n <= 0) return;
    // a cleared world (here or in another tab): join the new epoch with a fresh crowd
    if (currentEpochKey() !== String(epochMs.current)) {
      epochMs.current = getEpochMs();
      pending.current = [];
      botStartMs.current = 0;
      lastSampleMs.current = 0;
      ground.current = null;
      routes.current.clear();
    }
    const now = worldNow();
    const wall = Date.now();
    const flow = foldCfg.flow?.enabled ? foldCfg.flow : null;
    if (flow && (!ground.current || wall - ground.current.at >= BOT_GROUND_EVERY_MS)) {
      const tSess = sessionSeconds(now, epochMs.current, 0);
      const snap = theFold.at(tSess);
      const level = new Map<string, number>();
      for (const pc of snap.paths) level.set(pc.key, -flow.unit * Math.log(1 - Math.min(0.999, pc.p)));
      const built = new Set<string>();
      for (const sl of snap.slabs) if (sl.h >= SEAL_H && tSess - sl.lastS <= foldCfg.emptyGapSec) built.add(sl.key);
      ground.current = { at: wall, level, built };
      if (routes.current.size > n * 4) routes.current.clear();
    }
    const g = flow ? ground.current : null;
    const steer = (a: Actor, i: number, w: number): Actor => {
      if (!flow || !g) return a;
      const plan = botPlan(i, w, botStartMs.current, epochMs.current, 0, fl);
      const [x, z] = steerBot(a.o, plan, { level: (k) => g.level.get(k) ?? 0, built: (k) => g.built.has(k) }, flow, routes.current);
      return { ...a, x, z };
    };
    const period = Math.max(50, foldCfg.sampleSec * 1000);
    if (lastSampleMs.current === 0) lastSampleMs.current = now - period;
    const due = dueSamples(lastSampleMs.current, now, period);
    if (due.length) lastSampleMs.current = due[due.length - 1];
    if (botStartMs.current === 0) botStartMs.current = now;
    for (const w of due) {
      for (let i = 0; i < n; i++) {
        const a = steer(botActor(i, role === "mixed" ? SESSION_ROLES[i % SESSION_ROLES.length] : role, w, botStartMs.current, epochMs.current, 0, fl), i, w);
        const e: PEvent = { id: `${a.o}:${tag.current}:${seq.current++}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s };
        log.add(e);
        pending.current.push(e);
      }
    }
    if (now - lastKeepMs.current >= KEEP_EVERY_MS && wall - lastKeepWall.current >= KEEP_MIN_WALL_MS) {
      lastKeepMs.current = now;
      lastKeepWall.current = wall;
      setKeepFrom(sessionSeconds(now, epochMs.current, 0));
    }
    if (wall - lastSaveMs.current >= SAVE_EVERY_MS && pending.current.length) {
      lastSaveMs.current = wall;
      saveMerged(pending.current, epochMs.current);
      pending.current = [];
    }
  });

  return nBots;
}
