"use client";

/**
 * Bots driven from a GLOBAL view (V2), without opening /mobile. One Leva group "봇 (글로벌에서 돌리기)"; while on, every
 * bot's presence is emitted on the world clock (worldClock.ts), steered over the folded ground (paths, buildings) and
 * mirrored to localStorage like a player tab's, so every open view shares it. The history window rolls on as a player
 * tab would roll it.
 *
 * Two ways (`botMode`, the artist's switch):
 *   SESSION   (default) visitors that come in and leave (lib/parliament/lifecycle.ts, docs/bot-lifecycle.md): Poisson
 *             arrivals swinging between busy and quiet, lives of 1–3 min in the artist's bands, the worker's conduct,
 *             following others' places. The state is kept in localStorage, so a reload meets the same visitors. The
 *             most at once can follow the frame rate (frames over 50 ms per minute).
 *   RESIDENT  the old crowd: `botCount` bots always there, in flocks (bots.ts botActor).
 *
 * Only ONE emitter should run per browser: a player tab with its bots on, or one global view with this on.
 *
 * LINK (lib/parliament/botLink.ts): `?bots=session&max=24&rate=4` on the wall's address sets the group's knobs when
 * the view opens, as if turned by hand (nothing saved). `rate` sets the world clock — the lab's own; on a shared wall
 * only until the tab is closed (then ×1 again).
 */

import { useEffect, useMemo, useRef } from "react";
import { levaStore, useControls } from "leva";
import {
  DEFAULT_LIFECYCLE,
  SEAL_H,
  SESSION_ROLES,
  botActor,
  botPlan,
  currentEpochKey,
  dueSamples,
  flowRoute,
  getEpochMs,
  initLifecycle,
  latestS,
  lifecycleActor,
  nextMaxPresent,
  parseBotLink,
  readLifecycle,
  saveMerged,
  sharedClock,
  stepLifecycle,
  type Clock,
  sessionSeconds,
  setKeepFrom,
  steerBot,
  wrapCell,
  type Actor,
  type Attractor,
  type EventLog,
  type Flock,
  type FoldConfig,
  type LifecycleConfig,
  type LifecycleState,
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
/** SESSION: the visitors' state is mirrored this often, and a stored state older than STALE_MS is not met again. */
export const LS_LIFECYCLE_KEY = "anthropocene:parliament:lifecycle:v1";
const LIFECYCLE_SAVE_MS = 5000;
const STALE_MS = 10 * 60_000;
/**
 * SESSION: how often the most at once is reconsidered from the frame rate, its floor, and what counts as a slow frame:
 * a STALL (over 100 ms), not merely a frame under 20 fps — the wall's own drawing runs at 20–40 fps whatever the bots
 * do, and counting frames over 50 ms took the bots down to the floor within minutes (the artist, 2026-10-31: "길이 잘
 * 안 생기네").
 */
const CAPACITY_EVERY_MS = 20_000;
const AUTO_MIN = 8;
const STALL_MS = 100;
/** SESSION: someone who is not a bot, seen in the last this many seconds, is a visitor the bots may go to. */
const VISITOR_RECENT_SEC = 4;
/** The bots' fold: someone who joins up to this far behind the others in assigned time is not late (no rebuild). */
const BOT_FOLD_OPTS = { lateMarginSec: 35 };

const BOT_OPTIONS: Record<string, RoleId | "mixed"> = {
  "회사원 (worker)": "worker",
  "섞어서 (worker · cat · car · tree 차례로)": "mixed",
  "길고양이 (street cat)": "cat",
  "자동차 (car)": "car",
  "나무 (tree)": "tree",
};

const MODE_OPTIONS: Record<string, "session" | "resident"> = {
  "세션 (들어왔다 나감)": "session",
  "상주 (기존)": "resident",
};

const GROUP = "봇 (글로벌에서 돌리기)";

/**
 * The bots' Leva group and emitter for a global view. `enabled` false (V1) renders nothing and emits nothing.
 * Returns how many bots are there now (0 = off), for the view's readout.
 */
/** The session bots as one line for the view's readout (null when they are not running here). */
export function botReadout(): string | null {
  if (typeof window === "undefined") return null;
  const l = (window as unknown as { __lifecycle?: { present: number; maxPresent: number; arrived: number; departed: number; places: number; slowPerMin: number } }).__lifecycle;
  if (!l) return null;
  return `bots (session): ${l.present} now / max ${l.maxPresent} · arrived ${l.arrived} · left ${l.departed} · places ${l.places} · stalls ${l.slowPerMin}/min`;
}

export function useGlobalBots(log: EventLog, cfg: FoldConfig, enabled: boolean, order = 1.5, opts?: { clock?: Clock; local?: boolean }): number {
  // the lab: its own clock, its own world — nothing written to the shared storage, no history window
  const clock = opts?.clock ?? sharedClock;
  const local = !!opts?.local;
  const show = () => enabled;
  const b = useControls(
    GROUP,
    savable(GROUP, {
      botOn: { value: false, label: "봇 활성화 (플레이어 탭 없이; 플레이어 탭의 봇과 같이 켜지 말 것)", render: show },
      botMode: { options: MODE_OPTIONS, value: "session" as "session" | "resident", label: "봇 방식", render: show },
      // SESSION (docs/bot-lifecycle.md)
      lcGapSec: { value: DEFAULT_LIFECYCLE.meanGapSec, min: 3, max: 120, step: 1, label: "세션 › 붐빌 때 평균 도착 간격 (s)", render: show },
      lcQuiet: { value: DEFAULT_LIFECYCLE.quietShare, min: 0, max: 1, step: 0.05, label: "세션 › 한산할 때 도착 (붐빌 때의 몇 배)", render: show },
      lcWaveMin: { value: DEFAULT_LIFECYCLE.wavePeriodSec / 60, min: 1, max: 120, step: 1, label: "세션 › 붐빔↔한산 주기 (분)", render: show },
      lcMax: { value: DEFAULT_LIFECYCLE.maxPresent, min: 0, max: 40, step: 1, label: "세션 › 동시 최대", render: show },
      lcAuto: { value: true, label: "세션 › 동시 최대를 성능 따라 줄이기 (100 ms 넘는 멈춤/분, 바닥 8)", render: show },
      lcLifeMin: { value: DEFAULT_LIFECYCLE.lifeMinSec / 60, min: 0.25, max: 10, step: 0.25, label: "세션 › 수명 최소 (분)", render: show },
      lcLifeMax: { value: DEFAULT_LIFECYCLE.lifeMaxSec / 60, min: 0.25, max: 10, step: 0.25, label: "세션 › 수명 최대 (분)", render: show },
      lcShort: { value: DEFAULT_LIFECYCLE.bands.short, min: 0, max: 100, step: 5, label: "세션 › 짧은 삶 비율 (앞 1/4 구간)", render: show },
      lcMiddle: { value: DEFAULT_LIFECYCLE.bands.middle, min: 0, max: 100, step: 5, label: "세션 › 중간 삶 비율 (가운데 1/2)", render: show },
      lcLong: { value: DEFAULT_LIFECYCLE.bands.long, min: 0, max: 100, step: 5, label: "세션 › 긴 삶 비율 (뒤 1/4)", render: show },
      lcGroup: { value: DEFAULT_LIFECYCLE.groupP, min: 0, max: 1, step: 0.05, label: "세션 › 동행 도착 확률", render: show },
      lcOrigin: { value: DEFAULT_LIFECYCLE.originShare, min: 0, max: 1, step: 0.05, label: "세션 › 원점에서 시작하는 비율 (나머지는 문 네 곳)", render: show },
      lcFollow: { value: DEFAULT_LIFECYCLE.follow, min: 0, max: 1, step: 0.05, label: "세션 › 남이 머문 자리 따라가기 (평균)", render: show },
      lcRevisit: { value: DEFAULT_LIFECYCLE.revisit, min: 0, max: 1, step: 0.05, label: "세션 › 내 자리 다시 가기 (평균)", render: show },
      lcSpread: { value: DEFAULT_LIFECYCLE.spread, min: 0, max: 2, step: 0.1, label: "세션 › 변주 폭 (0 = 모두 같은 봇)", render: show },
      lcLeave: { value: DEFAULT_LIFECYCLE.leaveShare, min: 0, max: 1, step: 0.05, label: "세션 › 끝에 문으로 걸어 나가는 비율 (나머지는 선 자리에서)", render: show },
      // RESIDENT (the old crowd)
      botCount: { value: 12, min: 1, max: 30, step: 1, label: "상주 › 봇 수", render: show },
      botRole: { options: BOT_OPTIONS, value: "worker" as RoleId | "mixed", label: "상주 › 봇 역할", render: show },
      botGroups: { value: 4, min: 1, max: 10, step: 1, label: "상주 › 봇 무리 수 (무리당 3명 이상이어야 콘크리트)", render: show },
      botSpread: { value: 14, min: 0, max: 60, step: 1, label: "상주 › 무리 간 거리 (월드)", render: show },
      botTimeSpread: { value: 60, min: 0, max: 600, step: 5, label: "상주 › 봇 시각 폭 (s, 지금 기준 ±절반에서 랜덤)", render: show },
    }),
    { order, collapsed: !enabled },
  );
  const on = enabled && b.botOn;
  const session = b.botMode !== "resident";
  const nBots = on && !session ? b.botCount : 0;
  const flock = useMemo<Flock>(() => ({ groups: b.botGroups, spread: b.botSpread, timeSpread: b.botTimeSpread }), [b.botGroups, b.botSpread, b.botTimeSpread]);
  const lc = useMemo<LifecycleConfig>(
    () => ({
      ...DEFAULT_LIFECYCLE,
      meanGapSec: b.lcGapSec,
      quietShare: b.lcQuiet,
      wavePeriodSec: b.lcWaveMin * 60,
      maxPresent: b.lcMax,
      lifeMinSec: Math.min(b.lcLifeMin, b.lcLifeMax) * 60,
      lifeMaxSec: Math.max(b.lcLifeMin, b.lcLifeMax) * 60,
      bands: { short: b.lcShort, middle: b.lcMiddle, long: b.lcLong },
      groupP: b.lcGroup,
      originShare: b.lcOrigin,
      follow: b.lcFollow,
      revisit: b.lcRevisit,
      spread: b.lcSpread,
      leaveShare: b.lcLeave,
    }),
    [b.lcGapSec, b.lcQuiet, b.lcWaveMin, b.lcMax, b.lcLifeMin, b.lcLifeMax, b.lcShort, b.lcMiddle, b.lcLong, b.lcGroup, b.lcOrigin, b.lcFollow, b.lcRevisit, b.lcSpread, b.lcLeave],
  );
  // LINK: the address's query turns the knobs once, when the view opens (the controls exist by then: retried briefly)
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const link = parseBotLink(window.location.search);
    const keys = Object.keys(link.values);
    if (!keys.length && link.rate === undefined) return;
    let tries = 0;
    let timer = 0;
    const apply = () => {
      const data = levaStore.getData() as Record<string, unknown>;
      if (!data[`${GROUP}.botOn`] && tries++ < 20) {
        timer = window.setTimeout(apply, 150);
        return;
      }
      for (const k of keys) if (data[`${GROUP}.${k}`]) levaStore.setValueAtPath(`${GROUP}.${k}`, link.values[k], true);
      if (link.rate !== undefined) {
        // the view's time axis knob when there is one (it moves the clock), else the clock itself
        if (data["시간축.timeRate"]) levaStore.setValueAtPath("시간축.timeRate", link.rate, true);
        else clock.setRate(link.rate);
      }
    };
    timer = window.setTimeout(apply, 0);
    // a shared wall must not stay fast after the link's tab is gone
    const back = () => {
      if (!local && link.rate !== undefined && link.rate !== 1) clock.setRate(1);
    };
    window.addEventListener("pagehide", back);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", back);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the ground the bots walk on, folded as it grows (the whole world)
  const fold = useFoldState(log, cfg, BOT_FOLD_OPTS);

  const live = useRef({ on, session, nBots, role: b.botRole, flock, cfg, fold, lc, auto: b.lcAuto });
  useEffect(() => {
    live.current = { on, session, nBots, role: b.botRole, flock, cfg, fold, lc, auto: b.lcAuto };
  }, [on, session, nBots, b.botRole, flock, cfg, fold, lc, b.lcAuto]);

  const epochMs = useRef(0);
  const pending = useRef<PEvent[]>([]);
  const seq = useRef(0);
  const tag = useRef("");
  const lastSampleMs = useRef(0);
  const botStartMs = useRef(0);
  const lastSaveMs = useRef(0);
  const lastKeepMs = useRef(0);
  const lastKeepWall = useRef(0);
  const ground = useRef<{ at: number; level: Map<string, number>; built: Set<string>; visitors: Attractor[] } | null>(null);
  const routes = useRef(new Map<string, number[]>());
  // SESSION: the visitors, their last mirror, the frames over 50 ms of the last minute, and when the most-at-once was
  // reconsidered
  const visitors = useRef<LifecycleState | null>(null);
  const lastLcSave = useRef(0);
  const slow = useRef<number[]>([]);
  const lastFrame = useRef(0);
  const lastCapacity = useRef(0);

  // the frame rate (SESSION, auto): frames longer than 50 ms
  useEffect(() => {
    if (!on || !session) return;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      if (t - last > STALL_MS) slow.current.push(Date.now());
      last = t;
      lastFrame.current = Date.now();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, session]);

  // the epoch is joined when the bots are switched on; off = what is pending is written, the next switch-on starts
  // a fresh crowd (a session crowd goes on from its stored state)
  useEffect(() => {
    if (on) {
      // local: the bots go on from the end of what the log holds
      epochMs.current = local ? clock.now() - latestS(log.all()) * 1000 : getEpochMs();
      if (!tag.current) tag.current = Math.random().toString(36).slice(2, 6); // this view's crowd, unique ids
    } else {
      if (!local && pending.current.length && epochMs.current) saveMerged(pending.current, epochMs.current);
      pending.current = [];
      botStartMs.current = 0;
      lastSampleMs.current = 0;
      visitors.current = null;
      delete (window as unknown as { __lifecycle?: unknown }).__lifecycle;
    }
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  useTicker(TICK_MS, () => {
    const { on: isOn, session: isSession, nBots: n, role, flock: fl, cfg: foldCfg, fold: theFold, lc: lcCfg, auto } = live.current;
    if (!isOn) return;
    // a cleared world (here or in another tab): join the new epoch with a fresh crowd
    if (!local && currentEpochKey() !== String(epochMs.current)) {
      epochMs.current = getEpochMs();
      pending.current = [];
      botStartMs.current = 0;
      lastSampleMs.current = 0;
      ground.current = null;
      routes.current.clear();
      visitors.current = null;
    }
    const now = clock.now();
    const wall = Date.now();
    const flow = foldCfg.flow?.enabled ? foldCfg.flow : null;
    if (flow && (!ground.current || wall - ground.current.at >= BOT_GROUND_EVERY_MS)) {
      const tSess = sessionSeconds(now, epochMs.current, 0);
      // the whole world, settled part only (cheap; seconds behind)
      const snap = theFold.at(tSess, undefined, { tail: false });
      const settledTo = Math.min(tSess, theFold.stats()?.frontier ?? tSess);
      const level = new Map<string, number>();
      for (const pc of snap.paths) level.set(pc.key, -flow.unit * Math.log(1 - Math.min(0.999, pc.p)));
      const built = new Set<string>();
      for (const sl of snap.slabs) if (sl.h >= SEAL_H && settledTo - sl.lastS <= foldCfg.emptyGapSec) built.add(sl.key);
      // SESSION: the visitors of the personal view who are here now (not bots): places the bots may go to
      const seen: Attractor[] = [];
      if (isSession) {
        const all = log.all();
        const last = new Map<string, PEvent>();
        for (let i = all.length - 1, k = 0; i >= 0 && k < 4000; i--, k++) {
          const e = all[i];
          if (e.o.startsWith("bot") || e.s < tSess - VISITOR_RECENT_SEC - 120) continue;
          const l = last.get(e.o);
          if (!l || e.s > l.s) last.set(e.o, e);
        }
        for (const e of last.values()) seen.push({ x: e.x, z: e.z, w: 3 });
      }
      ground.current = { at: wall, level, built, visitors: seen };
      if (routes.current.size > Math.max(8, n * 4)) routes.current.clear();
    }
    const g = flow ? ground.current : null;
    const period = Math.max(50, foldCfg.sampleSec * 1000);
    if (lastSampleMs.current === 0) lastSampleMs.current = now - period;
    const due = dueSamples(lastSampleMs.current, now, period);
    if (due.length) lastSampleMs.current = due[due.length - 1];
    if (botStartMs.current === 0) botStartMs.current = now;

    const add = (a: Actor) => {
      const e: PEvent = { id: `${a.o}:${tag.current}:${seq.current++}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s };
      log.add(e);
      pending.current.push(e);
    };

    if (isSession) {
      // SESSION: the visitors one step on per sample; the ground's cells wrap round the torus
      let st = visitors.current;
      if (!st || st.epochMs !== epochMs.current) {
        let stored: LifecycleState | null = null;
        if (!local) {
          try {
            const raw = localStorage.getItem(LS_LIFECYCLE_KEY);
            stored = raw ? readLifecycle(JSON.parse(raw), epochMs.current) : null;
          } catch {
            stored = null;
          }
        }
        const from = due.length ? due[0] - period : now;
        st = stored && from - stored.lastMs < STALE_MS && stored.lastMs <= from ? stored : initLifecycle(epochMs.current, from, lcCfg);
      }
      const cell = (key: string) => {
        const [ci, cj] = key.split(",").map(Number);
        return `${wrapCell(ci)},${wrapCell(cj)}`;
      };
      const planRoute = flow && g ? (ax: number, az: number, bx: number, bz: number) => flowRoute(ax, az, bx, bz, { level: (k) => g.level.get(cell(k)) ?? 0, built: (k) => g.built.has(cell(k)) }, flow) : undefined;
      // the most at once: the knob, or (auto) what the frame rate allows under it — reconsidered every 20 s while the
      // view is drawn (a hidden tab says nothing)
      if (!auto) st = { ...st, maxPresent: lcCfg.maxPresent };
      else if (st.maxPresent > lcCfg.maxPresent) st = { ...st, maxPresent: lcCfg.maxPresent };
      else if (wall - lastCapacity.current >= CAPACITY_EVERY_MS) {
        lastCapacity.current = wall;
        const cut = wall - 60_000;
        slow.current = slow.current.filter((t) => t >= cut);
        if (wall - lastFrame.current < 2000) st = { ...st, maxPresent: nextMaxPresent(st.maxPresent, slow.current.length, Math.min(AUTO_MIN, lcCfg.maxPresent), lcCfg.maxPresent) };
      }
      for (const w of due) {
        // (the END event, k = "x", of who leaves comes with the role controls: docs/session-logic.md §2b)
        st = stepLifecycle(st, w, { attractors: g?.visitors ?? [], planRoute }, lcCfg).state;
        for (const v of st.present) add(lifecycleActor(v, w, epochMs.current));
      }
      visitors.current = st;
      (window as unknown as { __lifecycle?: unknown }).__lifecycle = {
        present: st.present.length,
        maxPresent: st.maxPresent,
        arrived: st.arrived,
        departed: st.departed,
        turnedAway: st.turnedAway,
        places: st.places.length,
        slowPerMin: slow.current.length,
      };
      if (!local && wall - lastLcSave.current >= LIFECYCLE_SAVE_MS) {
        lastLcSave.current = wall;
        try {
          localStorage.setItem(LS_LIFECYCLE_KEY, JSON.stringify(st));
        } catch {
          /* quota: the page's copy goes on */
        }
      }
    } else {
      // RESIDENT: the old crowd
      const steer = (a: Actor, i: number, w: number): Actor => {
        if (!flow || !g) return a;
        const plan = botPlan(i, w, botStartMs.current, epochMs.current, 0, fl);
        const [x, z] = steerBot(a.o, plan, { level: (k) => g.level.get(k) ?? 0, built: (k) => g.built.has(k) }, flow, routes.current);
        return { ...a, x, z };
      };
      for (const w of due) {
        for (let i = 0; i < n; i++) add(steer(botActor(i, role === "mixed" ? SESSION_ROLES[i % SESSION_ROLES.length] : role, w, botStartMs.current, epochMs.current, 0, fl), i, w));
      }
    }
    if (local) return; // the lab keeps everything, in memory
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

  // the readout: how many bots (session: the most at once the knob allows, as a stable number; resident: the count)
  return on ? (session ? Math.max(1, b.lcMax) : nBots) : 0;
}
