"use client";

/**
 * THE LAB'S WORLD IS THE WALL'S, TAKEN ONCE (the artist, 2026-11-20: "비주얼 다듬는 용 랩 … 실시간 봇 안 돌리고 저장된
 * 밸류 현황에서 한 번 따와서 레바 이터레이션 돌리는 용으로"). Tuning the look on the live wall is slow and noisy: the bots
 * go on changing the world under every knob. The lab takes the world as it stands — every sample the bot server's
 * block holds, its epoch, its clock and where its rise stands — once, when it opens, and then nothing is added: no
 * bots run here, nothing is built. Every knob is turned on the same buildings.
 *
 * It only READS the bot server: it joins as a view, takes what a joining view is sent (the hello, then the block in
 * pieces), and leaves; it never sends the bots' setup, a rate or a clear. Without the server (`?botserver=0`, or it
 * cannot be reached) it takes what this browser's own wall last mirrored into its storage.
 *
 * TIME IS THE LAB'S OWN (its clock, this tab only): put at the world's clock the moment the world was taken and
 * standing still until its rate is turned up (시간축 › 시간 배율) — what stands in the block ages by it, so the fossil
 * can be watched coming out and going, with nothing new built above. `skip` jumps ahead; `rewind` goes back to the
 * moment of taking (the same world, made again from nothing); `retake` takes the wall's world anew.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { currentEpochKey, loadEvents, tailField, worldNow, type EventLog, type LocalClock, type PEvent } from "@/lib/parliament";
import { LS_RISE, risePause } from "@/lib/parliament/rise";
import { BOT_SERVER, BOT_WORLD, botServerOn } from "./useBotServer";

type Rise = { at: number | null; lost: number; epoch: number };

export interface TakenWorld {
  /** Counts the takings and rewinds of this tab: the wall's model is made anew for each. */
  id: number;
  epochMs: number;
  /** The world's clock (world ms) the moment it was taken. */
  nowMs: number;
  /** This machine's clock then. */
  takenAt: number;
  count: number;
  from: "server" | "browser";
}

export interface LabWorld {
  world: TakenWorld | null;
  /** What to tell on the screen while there is no world: taking it, or why there is none. */
  note: string;
  retake: () => void;
  rewind: () => void;
  skip: (sec: number) => void;
}

interface Taken {
  epochMs: number;
  nowMs: number;
  rise: Rise | null;
  events: PEvent[];
  from: "server" | "browser";
}

const TAKE_TIMEOUT_MS = 20_000;

/**
 * WHEN A SAMPLE WAS WRITTEN, WHERE THE SERVER DID NOT SAY (2026-11-21; the artist: "비주얼 랩은 근데 화석화 만지는
 * 용도인데 거기 맞게 기능이 들어간 건지 모르겠네"). A part's age — what the fossil comes out by, and goes by — is counted
 * from the moment its samples were written (PEvent.w, spaceModel WallClock); a part whose samples carry none is
 * given an age estimated from its depth when a tab first sees it standing. The bot server as deployed sends no `w`
 * (0 of 19,171 samples, measured), and the lab sees the whole block at one moment: every part's age was that
 * estimate — deep = old, in a block where a deep part may have been built a moment ago — so the fossil the lab showed
 * was not the wall's. But a server bot's sample carries the moment in its id, `<owner>:<ms since the epoch>`
 * (botWorld.ts step — the same number `w` is made of), so it is read from there: the lab opens on parts of the ages
 * they really have (measured: 0 … 14 minutes, the fossil's whole life).
 */
function writtenAt(e: PEvent): PEvent {
  if (typeof e.w === "number" || !e.o.startsWith("bot") || !e.id.startsWith(`${e.o}:`)) return e;
  const ms = e.id.slice(e.o.length + 1);
  return /^\d+$/.test(ms) ? { ...e, w: Number(ms) / 1000 } : e;
}

/** Joins the bot server as a view, takes the world it is sent, and leaves. Sends nothing. */
function takeFromServer(): Promise<Taken> {
  return new Promise((resolve, reject) => {
    let done = false;
    let head: { epochMs: number; nowMs: number; rise: Rise | null; held: number } | null = null;
    const events: PEvent[] = [];
    const ws = new WebSocket(`${BOT_SERVER}/${BOT_WORLD}`);
    const end = (err?: string) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // (already gone)
      }
      if (err || !head) reject(new Error(err ?? "no world"));
      else resolve({ epochMs: head.epochMs, nowMs: head.nowMs, rise: head.rise, events, from: "server" });
    };
    // (a slow line: what has come by then is a world too — the oldest part of the block may be missing)
    const timer = window.setTimeout(() => end(head && events.length ? undefined : "timeout"), TAKE_TIMEOUT_MS);
    ws.onmessage = (m) => {
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (d.t === "hello") {
        const c = d.clock as { r: number; v: number; rate: number };
        // (the world's clock on the server's own clock: no need of this machine's)
        head = { epochMs: Number(d.epochMs) || 0, nowMs: c.v + (Number(d.serverNow) - c.r) * c.rate, rise: (d.rise as Rise | null) ?? null, held: Number(d.held) || 0 };
        if (!head.epochMs) end("no world");
        else if (head.held === 0) end();
      } else if (d.t === "ev" && head) {
        for (const e of (d.events as PEvent[]) ?? []) events.push(writtenAt(e));
        if (events.length >= head.held) end();
      }
    };
    ws.onerror = () => end("unreachable");
    ws.onclose = () => end(head && events.length ? undefined : "closed");
  });
}

/** What this browser's own wall last mirrored into its storage (the old way's world, or the server's as last seen). */
function takeFromBrowser(): Taken | null {
  const epochMs = Number(currentEpochKey()) || 0;
  const events = loadEvents();
  if (!epochMs || !events.length) return null;
  let rise: Rise | null = null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LS_RISE) || "null") as Rise | null;
    if (raw && raw.epoch === epochMs && Number.isFinite(raw.lost)) rise = raw;
  } catch {
    rise = null;
  }
  return { epochMs, nowMs: worldNow(), rise, events, from: "browser" };
}

export function useLabWorld(log: EventLog, clock: LocalClock, enabled: boolean): LabWorld {
  const [world, setWorld] = useState<TakenWorld | null>(null);
  const [note, setNote] = useState(enabled ? "벽의 세계를 따오는 중…" : "");
  const kept = useRef<Taken | null>(null);
  const ids = useRef(0);
  const busy = useRef(false);

  /** Puts a taken world into this tab: the log, the clock at the moment of taking, the rise as it stood. */
  const put = useCallback(
    (t: Taken) => {
      kept.current = t;
      log.clear();
      log.addMany([...t.events].sort((p, q) => p.s - q.s));
      // (the tails are laid again from the log by the bots' hook, for this id: useGlobalBots `taken`)
      tailField.clear();
      clock.set(t.nowMs);
      Object.assign(risePause, t.rise ? { at: t.rise.at, lost: t.rise.lost, epoch: t.epochMs } : { at: null, lost: 0, epoch: 0 });
      setWorld({ id: ++ids.current, epochMs: t.epochMs, nowMs: t.nowMs, takenAt: Date.now(), count: log.size, from: t.from });
      setNote("");
    },
    [log, clock],
  );

  const retake = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setNote("벽의 세계를 따오는 중…");
    const fromBrowser = () => {
      const t = takeFromBrowser();
      if (t) put(t);
      else setNote("따올 세계가 없음 — 봇 서버에 닿지 않고, 이 브라우저에 남은 벽의 기록도 없음 (벽을 한 번 연 뒤 '다시 따오기')");
    };
    if (!botServerOn()) {
      fromBrowser();
      busy.current = false;
      return;
    }
    takeFromServer()
      .then(put, fromBrowser)
      .finally(() => {
        busy.current = false;
      });
  }, [put]);

  const rewind = useCallback(() => {
    if (kept.current && !busy.current) put(kept.current);
  }, [put]);

  const skip = useCallback(
    (sec: number) => {
      if (kept.current) clock.set(clock.now() + sec * 1000);
    },
    [clock],
  );

  useEffect(() => {
    if (enabled) retake();
  }, [enabled, retake]);

  return { world, note, retake, rewind, skip };
}
