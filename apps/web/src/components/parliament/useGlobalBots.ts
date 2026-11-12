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
import { folder, levaStore, useControls } from "leva";
import {
  DEFAULT_HERD,
  DEFAULT_LIFECYCLE,
  SEAL_H,
  botActor,
  DEFAULT_FLOW,
  currentEpochKey,
  dueSamples,
  flowRoute,
  getEpochMs,
  initLifecycle,
  latestS,
  lifecycleActor,
  parseBotLink,
  readLifecycle,
  saveMerged,
  sharedClock,
  stepLifecycle,
  tailField,
  tailWalk,
  type Clock,
  sessionSeconds,
  setKeepFrom,
  wrapCell,
  type Actor,
  type Attractor,
  type EventLog,
  type FoldConfig,
  type LifecycleConfig,
  type LifecycleState,
  type PEvent,
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
const STALL_MS = 100;
/** SESSION: someone who is not a bot, seen in the last this many seconds, is a visitor the bots may go to. */
const VISITOR_RECENT_SEC = 4;
/** The bots' fold: someone who joins up to this far behind the others in assigned time is not late (no rebuild). */
const BOT_FOLD_OPTS = { lateMarginSec: 35 };

const LAYOUT_OPTIONS: Record<string, "strata" | "any"> = { "층마다 고르게 (무리 수만큼 나눠 빈 층에)": "strata", "아무 높이나": "any" };
const ORIGIN_OPTIONS: Record<string, "even" | "built" | "doors"> = { "세계에 고르게": "even", "지어진 곳 가까이": "built", "원점과 문 네 곳": "doors" };
/** The wall's time axis as the herds read it: one slot is 20 s and 1 world unit high (SPACE_BOXES). */
const SLOT_SEC = 20;
const SLOT_HEIGHT = 1;

/** How a bot's herd moves — for the markers' colours (the view's filter): by bot id, of the bots living now. */
export type BotKind = "settle" | "roam" | "tour" | "loner";
export const botKinds = new Map<string, BotKind>();

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
  return `bots (herds): ${l.present} now / max ${l.maxPresent} · arrived ${l.arrived} · left ${l.departed} · places ${l.places} · stalls ${l.slowPerMin}/min`;
}

export function useGlobalBots(
  log: EventLog,
  cfg: FoldConfig,
  enabled: boolean,
  order = 1.5,
  opts?: { clock?: Clock; local?: boolean; setDepth?: (slots: number) => void },
): number {
  // the lab: its own clock, its own world — nothing written to the shared storage, no history window
  const clock = opts?.clock ?? sharedClock;
  const local = !!opts?.local;
  const show = () => enabled;
  // THE BOTS, ONE SYSTEM (the artist, 2026-11-12: "레바 지금 거 다 없애고 싹 다 새로 만들어도 되니까"): herds in the
  // block. The resident crowd, the arrivals by rate and their knobs are gone from the wall (lib/parliament/bots.ts and
  // the rate path of lifecycle.ts stay for the lab's test column and the tests).
  const b = useControls(
    GROUP,
    savable(GROUP, {
      botOn: { value: false, label: "봇 활성화", render: show },
      "무리": folder(
        {
          hCountMin: { value: DEFAULT_HERD.count, min: 0, max: 12, step: 1, label: "무리 수 최소 (동시)" },
          hCount: { value: DEFAULT_HERD.count, min: 0, max: 12, step: 1, label: "무리 수 최대 (동시)" },
          hCountWave: { value: 10, min: 1, max: 60, step: 1, label: "수가 오르내리는 주기 (분)" },
          hSizeMin: { value: DEFAULT_HERD.sizeMin, min: 1, max: 12, step: 1, label: "크기 최소 (명)" },
          hSizeMax: { value: DEFAULT_HERD.sizeMax, min: 1, max: 12, step: 1, label: "크기 최대 (명)" },
          hLoners: { value: DEFAULT_HERD.loners, min: 0, max: 12, step: 1, label: "혼자 다니는 봇 (명)" },
          hLifeMin: { value: DEFAULT_LIFECYCLE.lifeMinSec / 60, min: 0.25, max: 10, step: 0.25, label: "수명 최소 (분)" },
          hLifeMax: { value: DEFAULT_LIFECYCLE.lifeMaxSec / 60, min: 0.25, max: 10, step: 0.25, label: "수명 최대 (분)" },
        },
        { render: show },
      ),
      // the wall's 3D space: the ground and time as height (1 단 = 20 s = 높이 1)
      "자리 (3차원 · 1단 = 높이 1)": folder(
        {
          hDepth: { value: DEFAULT_HERD.depthSec / SLOT_SEC, min: 0, max: 240, step: 1, label: "덩어리 깊이 (단 · 60 = 20분)" },
          hLayout: { options: LAYOUT_OPTIONS, value: DEFAULT_HERD.layout, label: "높이 배치" },
          hOrigin: { options: ORIGIN_OPTIONS, value: DEFAULT_HERD.origin, label: "기점 (땅)" },
          hOriginR: { value: DEFAULT_HERD.originR, min: 5, max: 95, step: 1, label: "기점 반경 (월드)" },
          hGap: { value: DEFAULT_HERD.gap, min: 0, max: 120, step: 1, label: "무리 사이 거리 (3차원)" },
          hRadius: { value: DEFAULT_HERD.radius, min: 0, max: 20, step: 0.25, label: "무리 반경 (3차원)" },
        },
        { render: show },
      ),
      "움직임": folder(
        {
          hSettle: { value: DEFAULT_HERD.mix.settle, min: 0, max: 3, step: 0.1, label: "정착 무리 비중" },
          hRoam: { value: DEFAULT_HERD.mix.roam, min: 0, max: 3, step: 0.1, label: "유랑 무리 비중" },
          hTour: { value: DEFAULT_HERD.mix.tour, min: 0, max: 3, step: 0.1, label: "순회 무리 비중" },
          hFollow: { value: DEFAULT_LIFECYCLE.follow, min: 0, max: 1, step: 0.05, label: "남의 자리 따라가기" },
          hLoose: { value: DEFAULT_HERD.loose, min: 0, max: 1, step: 0.05, label: "무리의 느슨함" },
          hSpread: { value: DEFAULT_LIFECYCLE.spread, min: 0, max: 2, step: 0.1, label: "성격 변주 폭" },
          hDrift: { value: DEFAULT_HERD.drift, min: 0, max: 0.9, step: 0.05, label: "시간 속도 변주 (±)" },
        },
        { render: show },
      ),
    }),
    { order, collapsed: !enabled },
  );
  const on = enabled && b.botOn;
  const session = true;
  const sizeMin = Math.min(b.hSizeMin, b.hSizeMax), sizeMax = Math.max(b.hSizeMin, b.hSizeMax);
  /** The most at once: every herd at its largest and the loners (the hard ceiling is 60 events a second). */
  const herdsMax = Math.max(b.hCount, b.hCountMin), herdsMin = Math.min(b.hCount, b.hCountMin);
  const most = Math.min(60, Math.round(herdsMax) * sizeMax + Math.round(b.hLoners));
  const lc = useMemo<LifecycleConfig>(
    () => ({
      ...DEFAULT_LIFECYCLE,
      maxPresent: most,
      lifeMinSec: Math.min(b.hLifeMin, b.hLifeMax) * 60,
      lifeMaxSec: Math.max(b.hLifeMin, b.hLifeMax) * 60,
      follow: b.hFollow,
      spread: b.hSpread,
      leaveShare: 0,
      herd: {
        count: herdsMax,
        countMin: herdsMin,
        countWaveSec: b.hCountWave * 60,
        loners: b.hLoners,
        sizeMin,
        sizeMax,
        radius: b.hRadius,
        gap: b.hGap,
        metersPerSec: SLOT_HEIGHT / SLOT_SEC,
        depthSec: b.hDepth * SLOT_SEC,
        layout: b.hLayout,
        origin: b.hOrigin,
        originR: b.hOriginR,
        mix: { settle: b.hSettle, roam: b.hRoam, tour: b.hTour },
        loose: b.hLoose,
        drift: b.hDrift,
      },
    }),
    [most, sizeMin, sizeMax, herdsMax, herdsMin, b.hCountWave, b.hLoners, b.hLifeMin, b.hLifeMax, b.hFollow, b.hSpread, b.hRadius, b.hGap, b.hDepth, b.hLayout, b.hOrigin, b.hOriginR, b.hSettle, b.hRoam, b.hTour, b.hLoose, b.hDrift],
  );
  // the wall freezes no part's shape while the bots write below the present (ParliamentSpace)
  const setDepth = opts?.setDepth;
  const deep = on ? b.hDepth : 0;
  useEffect(() => {
    setDepth?.(deep);
  }, [setDepth, deep]);
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
      // the knobs sit in sub-folders: a key is found by its end
      const paths = Object.keys(data).filter((q) => q.startsWith(`${GROUP}.`));
      for (const k of keys) {
        const path = paths.find((q) => q === `${GROUP}.${k}` || q.endsWith(`.${k}`));
        if (path) levaStore.setValueAtPath(path, link.values[k], true);
      }
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

  const live = useRef({ on, cfg, fold, lc });
  useEffect(() => {
    live.current = { on, cfg, fold, lc };
  }, [on, cfg, fold, lc]);

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
    const { on: isOn, cfg: foldCfg, fold: theFold, lc: lcCfg } = live.current;
    const isSession = true;
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
      // every step leaves a tail (tails.ts): the field the walkers plan over and the wall draws
      tailField.add(e);
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
      // THE WAYS JOIN UP because of how the bots walk (tails.ts): a way is planned over the ground of the walker's own
      // time, and ground with tails on it is easier — a second walker takes the first one's cells where they go the same
      // way. (Buildings are not gone round yet: they are made in the wall's worker now, density.ts.)
      const tailFlow = { ...(flow ?? DEFAULT_FLOW), enabled: true, gridShare: 1 };
      const slotOf = (sec: number) => Math.floor(sec / tailField.cfg.slotSec);
      const planRoute = tailWalk.follow
        ? (ax: number, az: number, bx: number, bz: number, sec?: number) => {
            const k = slotOf(sec ?? sessionSeconds(now, epochMs.current, 0));
            return flowRoute(ax, az, bx, bz, { level: (key) => { const [ci, cj] = key.split(",").map(Number); return tailField.level(ci, cj, k) * tailFlow.unit; }, built: () => false }, tailFlow);
          }
        : flow && g
          ? (ax: number, az: number, bx: number, bz: number) => flowRoute(ax, az, bx, bz, { level: (k) => g.level.get(cell(k)) ?? 0, built: (k) => g.built.has(cell(k)) }, flow)
          : undefined;
      // the most at once follows the knobs (herds × their largest size + the loners)
      st = { ...st, maxPresent: lcCfg.maxPresent };
      for (const w of due) {
        // (the END event, k = "x", of who leaves comes with the role controls: docs/session-logic.md §2b)
        st = stepLifecycle(st, w, { attractors: g?.visitors ?? [], planRoute }, lcCfg).state;
        for (const v of st.present) add(lifecycleActor(v, w, epochMs.current));
      }
      // who is of which kind now (a member is of its leader's)
      botKinds.clear();
      const byId = new Map(st.present.map((v) => [v.id, v] as const));
      for (const v of st.present) {
        const lead = v.lead ? byId.get(v.lead) : v;
        botKinds.set(v.id, lead?.kind === "leader" ? (lead.temper ?? "settle") : "loner");
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
  return on ? Math.max(1, most) : 0;
}
