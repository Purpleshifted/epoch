"use client";

/**
 * A VIEW OF THE BOTS THAT RUN ON THEIR OWN (the artist, 2026-11-17: "봇 자체를 따로 돌려서 늘 어디서 열든 봇은 돌아간
 * 상태여야" — "딜레이 없는 게 제일 중요"). The bots run on the bot server (relay/bots, lib/parliament/botWorld.ts),
 * whether any view is open or not; a view joins it and only reads: the world's epoch and clock, every event the
 * moment it is written, the bots' kinds, the column's rise stop. It sends the bots' setup when its knobs change,
 * people's samples it has (the visitors the bots go to), and a clear of the world. docs/bot-server.md.
 *
 * What the view holds follows as before: its log (and this browser's storage, for the views that read only that),
 * the ground the wall feeds (botGround.built) and the tails, which the wall's vegetation reads.
 */

import { useCallback, useEffect, useRef } from "react";
import { LS_PARLIAMENT_EPOCH_KEY, LS_TIME_RATE_KEY, WORLD_CLEARED_EVENT, announceEpochWritten, botGround, currentEpochKey, keepWindowSec, saveMerged, setKeepFrom, tailField, timeRate, type EventLog, type PEvent } from "@/lib/parliament";
import type { BotKind, BotSetup } from "@/lib/parliament/botWorld";
import type { DensityConfig } from "@/lib/parliament/density";
import type { HerdConfig } from "@/lib/parliament/lifecycle";
import { risePause, type BlockFrame } from "@/lib/parliament/rise";

/** The bot server and the world on it. `?botserver=0` on a view's address: the old way (the bots in this tab). */
export const BOT_SERVER = process.env.NEXT_PUBLIC_BOT_SERVER ?? "wss://anthropocene-bots.anthropocene-hesse.workers.dev";
/**
 * WHICH WORLD ON THE BOT SERVER (the artist, 2026-11-22: "응, 분리해" — after a page that was not the exhibition's
 * cleared its world): production's own ("redesign", the exhibition's world, the one the artist's wall runs); everything
 * else — branch previews, `next dev`, every session's test page — "rehearsal", so nothing tried elsewhere reaches the
 * exhibition's bots or world. Production is known by its build (NEXT_PUBLIC_VERCEL_ENV) or, failing that, its
 * address. NEXT_PUBLIC_BOT_WORLD overrides both.
 */
const PRODUCTION_HOSTS = ["anthropocene-redesign.vercel.app", "anthropocene-redesign-hesse-parks-projects.vercel.app"];
function botWorldHere(): string {
  if (process.env.NEXT_PUBLIC_BOT_WORLD) return process.env.NEXT_PUBLIC_BOT_WORLD;
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") return "redesign";
  if (typeof window !== "undefined" && PRODUCTION_HOSTS.includes(window.location.hostname)) return "redesign";
  return "rehearsal";
}
export const BOT_WORLD = botWorldHere();
export function botServerOn(): boolean {
  if (typeof window === "undefined") return false;
  return !!BOT_SERVER && new URLSearchParams(window.location.search).get("botserver") !== "0";
}

/**
 * THE BOTS' OWNER (the artist, 2026-11-22: "응, 막아" — at 15:17 that day a view that was not hers cleared the shared
 * world and its setup switched the bots off): only a browser marked as the owner sends the bot server the bots' setup,
 * the clock's rate and a clear; every other view — a test tab, another session's browser, a visitor's phone — only
 * reads, and sends its people. A browser is marked by opening any page of the app once with `?botadmin=1`
 * (`?botadmin=0` unmarks it). Sessions never use it: they are not the owner. docs/bot-server.md.
 */
const BOT_ADMIN_KEY = "anthropocene:bot-admin:v1";
export function botAdmin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("botadmin");
    if (q === "1") localStorage.setItem(BOT_ADMIN_KEY, "1");
    else if (q === "0") localStorage.removeItem(BOT_ADMIN_KEY);
    return localStorage.getItem(BOT_ADMIN_KEY) === "1";
  } catch {
    return false;
  }
}

const SAVE_EVERY_MS = 2000;
const PEOPLE_EVERY_MS = 1000;
const RETRY_MS = [1000, 2000, 5000, 10000];

/**
 * Joins the bot server while `active`. `getSetup` is what this view's knobs make of the bots, looked at every second
 * and sent when it changes — not on joining (the world goes on as it was set), unless the server was never told.
 * `kinds` is filled with the bots' kinds as the server says them.
 */
export function useBotServer(log: EventLog, active: boolean, getSetup: () => BotSetup | null, kinds: Map<string, BotKind>): void {
  const sock = useRef<WebSocket | null>(null);
  const setupOf = useRef(getSetup);
  setupOf.current = getSetup;
  // WHAT THIS VIEW OPENED WITH (its saved knobs), taken at its first render: the server's bots follow this view only
  // once its knobs differ from it — turned by hand, or by the address's link — not merely because it opened
  const opened = useRef<string | null>(null);
  if (opened.current === null) opened.current = handKey(getSetup());

  useEffect(() => {
    if (!active) return;
    let gone = false, tries = 0, retry = 0;
    let epoch = 0;
    let sentSetup: string | null = null;
    // only the owner's browser changes the server's bots, clock or world (botAdmin)
    const admin = botAdmin();
    let saidNotOwner = false;
    const notOwner = () => {
      if (saidNotOwner) return;
      saidNotOwner = true;
      console.info("[bots] this browser is not the bots' owner: its knobs and clears stay here (open the app once with ?botadmin=1 on the owner's browser)");
    };
    // the clock's rate as the server last said it: a rate set here (the 시간축 knob) is sent on
    let serverRate: number | null = null;
    let openedDensity: string | null = null;
    const json = () => {
      const s = setupOf.current();
      return s ? JSON.stringify(s) : "";
    };
    /** The knobs differ from what the view opened with (the density's: from the first config the wall gave). */
    const turned = () => {
      const s = setupOf.current();
      if (!s) return false;
      const d = JSON.stringify(s.density);
      if (openedDensity === null && s.density) openedDensity = d;
      return handKey(s) !== opened.current || (openedDensity !== null && d !== openedDensity);
    };
    const pending: PEvent[] = [];
    // what came from the server (not sent back as people) and how far the log was looked through for people
    const fromServer = new Set<string>();
    let looked = 0, lookedDrops = log.drops;
    // (a new epoch here: the view's own world ends first — useWorld empties the log on its next look — and what the
    // server sends meanwhile waits, or it would be emptied with it)
    let waitDrops = -1, waitUntil = 0;
    const held: PEvent[] = [];
    const waiting = () => {
      if (waitDrops < 0) return false;
      if (log.drops !== waitDrops || Date.now() > waitUntil) {
        waitDrops = -1;
        const list = held.splice(0);
        take(list);
        return false;
      }
      return true;
    };
    const take = (list: PEvent[]) => {
      if (waiting()) {
        held.push(...list);
        return;
      }
      for (const e of list) {
        fromServer.add(e.id);
        if (!log.add(e)) continue;
        pending.push(e);
        // (the ground the wall feeds, and the tails: the vegetation reads them)
        botGround.built?.add(e);
        tailField.add(e);
      }
    };
    const connect = () => {
      if (gone) return;
      const ws = new WebSocket(`${BOT_SERVER}/${BOT_WORLD}`);
      sock.current = ws;
      ws.onopen = () => {
        tries = 0;
      };
      ws.onmessage = (m) => {
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (d.t === "hello") {
          // THE WORLD IS THE SERVER'S: its epoch and its clock (anchored to this browser's wall clock)
          const skew = (d.serverNow as number) - Date.now();
          const clock = d.clock as { r: number; v: number; rate: number };
          try {
            localStorage.setItem(LS_TIME_RATE_KEY, JSON.stringify({ r: clock.r - skew, v: clock.v, rate: clock.rate }));
            serverRate = clock.rate;
            const prev = currentEpochKey();
            if (prev !== String(d.epochMs)) {
              // (this browser's world ends: useWorld empties the log, and the server's is taken)
              localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, String(d.epochMs));
              if (prev !== null) {
                waitDrops = log.drops;
                waitUntil = Date.now() + 4000;
              }
              announceEpochWritten(); // useWorld looks at once (not on its next poll)
            }
          } catch {
            // (no storage: this tab follows the server all the same)
          }
          epoch = d.epochMs as number;
          // (the block is the times 0 … its height: nothing in it is too old — as the bots' hook kept it)
          setKeepFrom(keepWindowSec());
          if (d.rise) Object.assign(risePause, d.rise);
          kinds.clear();
          for (const [id, k] of Object.entries((d.kinds as Record<string, BotKind>) ?? {})) kinds.set(id, k);
          (window as unknown as { __lifecycle?: unknown }).__lifecycle = d.readout ? { ...(d.readout as object), slowPerMin: 0, server: true } : undefined;
          // (a server that has never been told the bots' setup: this view's)
          const mine = json();
          if (mine && (!d.setup || turned())) {
            if (admin) {
              sentSetup = mine;
              ws.send(JSON.stringify({ t: "setup", setup: JSON.parse(mine) }));
            } else notOwner();
          }
          return;
        }
        if (d.t === "ev") {
          take((d.events as PEvent[]) ?? []);
          if (d.rise) Object.assign(risePause, d.rise);
          if (d.kinds) {
            kinds.clear();
            for (const [id, k] of Object.entries(d.kinds as Record<string, BotKind>)) kinds.set(id, k);
          }
          if (d.readout) (window as unknown as { __lifecycle?: unknown }).__lifecycle = { ...(d.readout as object), slowPerMin: 0, server: true };
          // the block forgot its oldest: so does this view
          if (typeof d.keep === "number") log.dropOldest(Math.floor(Math.max(1000, d.keep) * 0.9));
          return;
        }
        if (d.t === "clock") {
          const skew = (d.serverNow as number) - Date.now();
          const clock = d.clock as { r: number; v: number; rate: number };
          try {
            localStorage.setItem(LS_TIME_RATE_KEY, JSON.stringify({ r: clock.r - skew, v: clock.v, rate: clock.rate }));
            serverRate = clock.rate;
          } catch {
            // (this tab only)
          }
        }
      };
      ws.onclose = () => {
        if (sock.current === ws) sock.current = null;
        if (gone) return;
        retry = window.setTimeout(connect, RETRY_MS[Math.min(RETRY_MS.length - 1, tries++)]);
      };
    };
    connect();
    // THE WORLD WAS EMPTIED HERE (the wall's 지우고 다시 생성하기): the server begins a new one, and every view follows
    const onCleared = () => {
      const ws = sock.current;
      if (!admin) return notOwner();
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "clear" }));
    };
    window.addEventListener(WORLD_CLEARED_EVENT, onCleared);

    // this browser's storage, for the views that read only that (the personal view), and people's samples to the
    // server (the visitors the bots go to)
    const timer = window.setInterval(() => {
      waiting();
      if (pending.length && epoch && currentEpochKey() === String(epoch)) saveMerged(pending.splice(0), epoch);
      else if (pending.length > 50000) pending.length = 0;
      const ws = sock.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // the time rate set here (the wall's 시간축 knob): the world's clock follows, every view and phone with it
      const rate = timeRate();
      if (serverRate !== null && Math.abs(rate - serverRate) > 1e-6) {
        serverRate = rate;
        if (admin) ws.send(JSON.stringify({ t: "rate", rate }));
        else notOwner();
      }
      // the knobs turned here: the server's bots follow (the owner's browser only)
      const mine = json();
      if (mine && mine !== sentSetup && turned()) {
        sentSetup = mine;
        if (admin) ws.send(JSON.stringify({ t: "setup", setup: JSON.parse(mine) }));
        else notOwner();
      }
      const all = log.all();
      if (lookedDrops !== log.drops) {
        lookedDrops = log.drops;
        looked = Math.min(looked, all.length);
      }
      const people: PEvent[] = [];
      let i = looked;
      for (; i < all.length && people.length < 400; i++) {
        const e = all[i];
        if (!e.o.startsWith("bot") && !fromServer.has(e.id)) people.push(e);
      }
      looked = i;
      if (people.length) ws.send(JSON.stringify({ t: "people", events: people }));
    }, Math.min(SAVE_EVERY_MS, PEOPLE_EVERY_MS));

    return () => {
      gone = true;
      window.removeEventListener(WORLD_CLEARED_EVENT, onCleared);
      window.clearTimeout(retry);
      window.clearInterval(timer);
      sock.current?.close();
      sock.current = null;
      if (pending.length && epoch) saveMerged(pending, epoch);
    };
  }, [active, log, kinds]);
}

/** A setup as the knobs make it, without the density's config (that comes from the wall a moment later). */
function handKey(s: BotSetup | null): string {
  return s ? JSON.stringify({ ...s, density: null }) : "";
}

/** What the phone knows of the world's rules (from the server's hello): the buildings' density config, null until it
 *  came or when the server has none. `version` bumps when it changed (FuturePresence.tsx reads it). */
export const visitorWorld: { density: DensityConfig | null; herd: HerdConfig | null; version: number } = { density: null, herd: null, version: 0 };

/**
 * THE VISITOR'S SAMPLES TO THE BOT SERVER (the personal view, a phone): the phone joins the world's epoch and clock,
 * and what it sends is its visitor where they stand, a few times a second. The walls see them, and the bots go to
 * them. What the server writes NEAR the visitor (the bots, the others; the artist, 2026-11-17: "보여야겠지") comes
 * back into the phone's log — not the whole world, which a phone need not hold. Returns the function the player view gives each sample of
 * its visitor to, with the epoch it was made in (samples of another epoch — before the phone joined — are not sent).
 */
let visitorBlock: { epochMs: number; frame: BlockFrame; clock: { r: number; v: number; rate: number } } | null = null;

/**
 * The block of the world `epochMs` as the bot server last told this phone (its herd's window and the rise's stop), and
 * the world's seconds since its epoch NOW by the clock the server sent with it (not worldNow(), which reads storage
 * at most every 200 ms — a fresh browser seated by the wall clock stood 35 000 s too high); null when not told yet,
 * another world, or no block. Where the visitor is seated in time (rise.ts blockSeatOffset).
 */
export function blockFrameFor(epochMs: number): { frame: BlockFrame; gone: number } | null {
  const b = visitorBlock;
  if (!b || b.epochMs !== epochMs) return null;
  return { frame: b.frame, gone: Math.max(0, (b.clock.v + (Date.now() - b.clock.r) * b.clock.rate - epochMs) / 1000) };
}

/**
 * THE BOTS LIVING NEAR THE VISITOR, as the server writes them (2026-11-22: a life is born where the bots are —
 * rise.ts herdSeatOffset): each bot's latest sample's block time and when it came (wall ms). The server sends a
 * phone what is written within 40 world units of where its visitor last stood — so these are the bots near in space;
 * one whose sample came in the last few seconds is living now (the first message is the world round the visitor as
 * it was: those bots may be long gone, so a reading waits for the live stream — `since`).
 */
const nearBots = new Map<string, { s: number; x: number; z: number; at: number }>();
/** Wall ms the first message of the world near the visitor came (0 = none yet). */
let nearSince = 0;
export function livingBotsNear(withinMs = 3000): { since: number; bots: { o: string; s: number; x: number; z: number }[] } {
  const now = Date.now(), bots: { o: string; s: number; x: number; z: number }[] = [];
  for (const [o, b] of nearBots) if (now - b.at <= withinMs) bots.push({ o, s: b.s, x: b.x, z: b.z });
  return { since: nearSince, bots };
}

export function useVisitorLink(active: boolean, log: EventLog): (e: PEvent, epochMs: number) => void {
  const queue = useRef<{ e: PEvent; epochMs: number }[]>([]);
  useEffect(() => {
    if (!active) return;
    let gone = false, tries = 0, retry = 0;
    let ws: WebSocket | null = null;
    let epoch = 0;
    // (the phone's own world ending: until useWorld has emptied the log, nothing of the server's is put in it)
    let waitDrops = -1;
    const joined = () => {
      if (waitDrops >= 0 && log.drops !== waitDrops) waitDrops = -1;
      return waitDrops < 0;
    };
    const connect = () => {
      if (gone) return;
      const sock = new WebSocket(`${BOT_SERVER}/${BOT_WORLD}?as=visitor`);
      ws = sock;
      sock.onopen = () => {
        tries = 0;
      };
      sock.onmessage = (m) => {
        let d: { t?: string; epochMs?: number; serverNow?: number; clock?: { r: number; v: number; rate: number } };
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (d.t === "ev") {
          const evs = (d as { events?: PEvent[] }).events ?? [];
          // (the bots near, as they write: livingBotsNear)
          const at = Date.now();
          if (!nearSince && evs.length) nearSince = at;
          for (const e of evs) {
            if (e.k !== "p" || !e.o.startsWith("bot")) continue;
            const b = nearBots.get(e.o);
            if (!b || e.s >= b.s) nearBots.set(e.o, { s: e.s, x: e.x, z: e.z, at });
          }
          // (only once the phone's own world has ended and it is in the server's: useWorld empties the log on the
          // epoch's change, and what came before would go with it)
          if (epoch && currentEpochKey() === String(epoch) && joined()) log.addMany(evs);
          return;
        }
        // THE WORLD'S RULES, FOR THE FUTURE UNDER THE VISITOR'S FEET (futurePresence.ts, 2026-11-22): the server's
        // buildings' density rule — the wall's, as it last sent it — so the phone infers the same layer the wall does
        if (d.t === "hello" || d.t === "setup") {
          const su = (d as { setup?: { density?: DensityConfig | null; lc?: { herd?: HerdConfig } } | null }).setup;
          visitorWorld.density = su?.density ?? null;
          // (and the herds' setup: where the villages are, and so where the future's water runs — futurePresence.ts)
          visitorWorld.herd = su?.lc?.herd ?? null;
          visitorWorld.version++;
          if (d.t === "setup") return;
        }
        if ((d.t !== "hello" && d.t !== "clock") || !d.clock || typeof d.serverNow !== "number") return;
        const skew = d.serverNow - Date.now();
        try {
          localStorage.setItem(LS_TIME_RATE_KEY, JSON.stringify({ r: d.clock.r - skew, v: d.clock.v, rate: d.clock.rate }));
          // (the player view's own world ends and it joins the server's epoch: useWorld's onCleared)
          if (d.t === "hello" && typeof d.epochMs === "number" && currentEpochKey() !== String(d.epochMs)) {
            if (currentEpochKey() !== null) waitDrops = log.drops;
            localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, String(d.epochMs));
            // useWorld looks at once: the life ends its own world and joins this one (its first life too — before
            // 2026-11-21 a fresh browser's first life missed the change and stayed alone in a world of its own)
            announceEpochWritten();
          }
        } catch {
          // (no storage)
        }
        if (d.t === "hello" && typeof d.epochMs === "number") {
          if (epoch !== d.epochMs) {
            nearBots.clear();
            nearSince = 0;
          }
          epoch = d.epochMs;
          // the block the bots live in: the visitor is seated in its time (RoleField), not at "seconds since the epoch"
          const h = (d as { setup?: { lc?: { herd?: { shift?: number; depthSec?: number } } } }).setup?.lc?.herd;
          const rise = (d as { rise?: { at: number | null; lost: number; epoch: number } | null }).rise;
          visitorBlock = h && Number(h.depthSec) > 0
            ? { epochMs: d.epochMs, frame: { shift: Number(h.shift) || 0, depthSec: Number(h.depthSec), rise: rise && rise.epoch === d.epochMs ? { at: rise.at, lost: rise.lost } : null }, clock: { r: d.clock.r - skew, v: d.clock.v, rate: d.clock.rate } }
            : null;
        }
      };
      sock.onclose = () => {
        if (ws === sock) ws = null;
        if (gone) return;
        retry = window.setTimeout(connect, RETRY_MS[Math.min(RETRY_MS.length - 1, tries++)]);
      };
    };
    connect();
    const timer = window.setInterval(() => {
      const q = queue.current;
      if (!q.length || !ws || ws.readyState !== WebSocket.OPEN || !epoch) return;
      const events = q.filter((x) => x.epochMs === epoch).map((x) => x.e);
      q.length = 0;
      if (events.length) ws.send(JSON.stringify({ t: "people", events }));
    }, 250);
    return () => {
      gone = true;
      window.clearTimeout(retry);
      window.clearInterval(timer);
      ws?.close();
    };
  }, [active, log]);
  return useCallback(
    (e: PEvent, epochMs: number) => {
      if (!active) return;
      const q = queue.current;
      q.push({ e, epochMs });
      if (q.length > 400) q.splice(0, q.length - 400);
    },
    [active],
  );
}
