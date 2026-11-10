/**
 * parliament/serverWorld.ts
 *
 * THE SHARED WORLD, this tab's side (docs/shared-world-plan.md §3). The server owns the events' order, the epoch, the
 * world clock and the history window; one agent per tab keeps the localStorage keys the rest of the code already reads
 * equal to the server's, sends what this tab emits, and hands what the others emitted to this tab's event logs. So the
 * views, the sound and the fold need not know about the server, and when it cannot be reached they simply go on from
 * the last values (what piles up here is sent when it comes back).
 *
 * The network sits behind WorldTransport: a push service in place of polling would replace httpTransport and nothing else.
 *
 * Off (no NEXT_PUBLIC_WORLD, `?sync=0`, `?demo=1`, the lab, V1): no agent, no hook set, the code runs as it always did.
 */

import { sessionSeconds } from "./clock";
import { EventLog, LS_KEEP_FROM_KEY, adoptEpoch, currentEpochKey, dropStoredEvents, keepWindowSec, saveMerged, setWorldMirror, storeKeepWindowSec } from "./log";
import type { PEvent } from "./types";
import { adoptAnchor, setRateMirror, setWallOffset, wallNow, worldNow } from "./worldClock";
import { HOST_NOTE_MAX, MAX_EVENTS_PER_POST, MAX_RANGE_CHUNKS, chunkEndMs, isWorldName, lastClosedChunk, type WorldState } from "@/lib/world/protocol";

/** Chunks are looked for this often; what this tab emitted goes out this often. */
const TICK_MS = 500;
const SEND_EVERY_MS = 2000;
const STATE_EVERY_MS = 10_000;
const CLOCK_EVERY_MS = 60_000;
/** About ten minutes of samples: long enough to ride out a busy spell, short enough to follow a clock that was reset. */
const CLOCK_SAMPLES_KEPT = 10;
const KEEP_EVERY_MS = 30_000;
/** The server's events are copied into localStorage this often (only for a reload without network). */
const MIRROR_EVERY_MS = 10_000;
/** A hidden tab reads this seldom: nobody is looking, and a phone in a pocket should not poll. */
const HIDDEN_READ_MS = 10_000;
const RETRY_MS = 5000;
/** Further behind than this (20 minutes of chunks), reading the window is shorter than catching up. */
const MAX_CATCH_UP_CHUNKS = 600;
/** Asking for a chunk a moment after it closes by our clock: the server's clock may be a little behind. */
const READ_MARGIN_MS = 150;
const REQUEST_TIMEOUT_MS = 8000;
/** The most events kept waiting for the server: about 25 minutes of a full world. */
const MAX_OUTBOX = 30_000;
/** The bot host looks at its lease this often (the lease itself: protocol.ts HOST_LEASE_MS). */
const HOST_EVERY_MS = 5000;
/**
 * With no answer from the server for this long, a wall with bots on runs them itself: the exhibition must go on with
 * the network down. Should two walls end up doing so, their events carry the same ids and only one of each is kept.
 */
const OFFLINE_BOTS_AFTER_MS = 15_000;
/** The most chunks a sound's feed holds back: minutes, far more than any bar waits for. */
const MAX_FEED_QUEUE = 120;

const LS_OFFSET_KEY = "anthropocene:world:clock-offset:v1";
const LS_ADMIN_KEY = "anthropocene:world:admin:v1";

export type PostAnswer = { ended: false; state?: WorldState } | { ended: true; state: WorldState };
export type RangeAnswer = { early: true } | { early: false; events: PEvent[] };
export type WindowAnswer = { ended: true; state: WorldState } | { ended: false; events: PEvent[]; to: number; next: number | null };
export type WorldCommand = { op: "clear" } | { op: "rate"; rate: number } | { op: "window"; sec: number } | { op: "host"; id: string; force?: boolean; note?: string };

export interface WorldTransport {
  /** The server's clock (ms). */
  now(): Promise<number>;
  state(): Promise<WorldState>;
  /** `host`: renews this tab's lease on the bots with the same request, and the answer carries the state. */
  send(epochMs: number, events: readonly PEvent[], host?: string, note?: string): Promise<PostAnswer>;
  /** A host leaving on purpose, as the tab closes: fire and forget. */
  release(id: string): void;
  range(epochMs: number, from: number, to: number): Promise<RangeAnswer>;
  window(epochMs: number, cursor: number): Promise<WindowAnswer>;
  /** The new state, or null when the server refused (the rate is locked, no admin key). */
  command(cmd: WorldCommand): Promise<WorldState | null>;
}

function adminKey(): string | null {
  try {
    const fromUrl = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("admin");
    if (fromUrl) localStorage.setItem(LS_ADMIN_KEY, fromUrl);
    return fromUrl ?? localStorage.getItem(LS_ADMIN_KEY);
  } catch {
    return null;
  }
}

/** The transport of the Vercel + Neon structure: /api/now, /api/world, /api/events. */
export function httpTransport(world: string): WorldTransport {
  const w = encodeURIComponent(world);
  const call = async (url: string, init?: RequestInit): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const post = (url: string, body: unknown, admin = false): Promise<Response> => {
    const key = admin ? adminKey() : null;
    return call(url, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-world-admin": key } : {}) }, body: JSON.stringify(body) });
  };
  const bad = (what: string, r: Response) => new Error(`${what}: ${r.status}`);
  return {
    async now() {
      const r = await call("/api/now", { cache: "no-store" });
      if (!r.ok) throw bad("now", r);
      return ((await r.json()) as { now: number }).now;
    },
    async state() {
      const r = await call(`/api/world?world=${w}`);
      if (!r.ok) throw bad("world", r);
      return ((await r.json()) as { state: WorldState }).state;
    },
    async send(epochMs, events, host, note) {
      const r = await post("/api/events", { world, epoch: epochMs, events, ...(host ? { host, ...(note ? { note } : {}) } : {}) });
      if (r.status === 409) return { ended: true, state: ((await r.json()) as { state: WorldState }).state };
      if (!r.ok) throw bad("send", r);
      return { ended: false, state: ((await r.json()) as { state?: WorldState }).state };
    },
    release(id) {
      try {
        navigator.sendBeacon("/api/world", JSON.stringify({ world, op: "release", id }));
      } catch {
        /* the lease runs out by itself */
      }
    },
    async range(epochMs, from, to) {
      const r = await call(`/api/events?world=${w}&epoch=${epochMs}&from=${from}&to=${to}`);
      if (r.status === 425) return { early: true };
      if (!r.ok) throw bad("range", r);
      return { early: false, events: ((await r.json()) as { events: PEvent[] }).events };
    },
    async window(epochMs, cursor) {
      const r = await call(`/api/events?world=${w}&epoch=${epochMs}&window=1${cursor ? `&cursor=${cursor}` : ""}`);
      if (r.status === 409) return { ended: true, state: ((await r.json()) as { state: WorldState }).state };
      if (!r.ok) throw bad("window", r);
      const o = (await r.json()) as { events: PEvent[]; to: number; next: number | null };
      return { ended: false, events: o.events, to: o.to, next: o.next };
    },
    async command(cmd) {
      const r = await post("/api/world", { world, ...cmd }, true);
      if (r.status === 403 || r.status === 423) return null;
      if (!r.ok) throw bad("command", r);
      return ((await r.json()) as { state: WorldState }).state;
    },
  };
}

export interface WorldStatus {
  world: string;
  online: boolean;
  /** Events waiting to be sent. */
  outbox: number;
  /** How old the newest chunk read is (s); null before the first. */
  lagSec: number | null;
  /** The clock correction against the server (ms). */
  offsetMs: number;
  events: number;
  /** Who runs the bots, as far as this tab knows: here, another tab, or nobody. */
  host: "here" | "other" | "none";
}

/**
 * A log that is given the server's chunks only when asked, up to a chunk: what a bar of the shared world's music is
 * written from (sound/score.ts). Unlike the views' logs it never sees this tab's own events before they come back, nor
 * anything from this browser's storage, so it holds the same on every wall at the same chunk.
 */
export class ScoreFeed {
  readonly log = new EventLog();
  /** The newest chunk read from the server, empty ones included: what a bar may be written from is known to be here. */
  readTo = -Infinity;
  private queue: { chunk: number; events: readonly PEvent[] }[] = [];

  push(chunk: number, events: readonly PEvent[]): void {
    if (events.length) this.queue.push({ chunk, events });
    // a sound that has not started (no gesture yet, or the afterglow waiting for a life to end) asks for nothing:
    // what no bar can still be held back from goes in, or this would grow for as long as the tab stays open
    if (this.queue.length > MAX_FEED_QUEUE) this.advanceTo(this.queue[this.queue.length - MAX_FEED_QUEUE].chunk);
  }

  advanceTo(chunk: number): void {
    let n = 0;
    while (n < this.queue.length && this.queue[n].chunk <= chunk) this.log.addMany(this.queue[n++].events);
    if (n) this.queue.splice(0, n);
  }

  clear(): void {
    this.queue = [];
    this.readTo = -Infinity;
    this.log.clear();
  }
}

export class WorldAgent {
  /** Everything of the current window this tab knows of the server: a log attached later starts from it. */
  readonly log = new EventLog();
  private state: WorldState | null = null;
  private readonly logs = new Set<EventLog>();
  private readonly feeds = new Set<ScoreFeed>();
  private outbox: PEvent[] = [];
  private mirrorQueue: PEvent[] = [];
  /** The newest chunk handed on; null until the window has been read. */
  private cursor: number | null = null;
  private needWindow = true;
  private windowCursor = 0;
  private windowTo = 0;
  private busyRead = false;
  private busySend = false;
  private busyState = false;
  private nextRead = 0;
  private nextSend = 0;
  private nextState = 0;
  private nextClock = 0;
  private nextKeep = 0;
  private nextMirror = 0;
  private online = false;
  private offsetMs = 0;
  private readonly clockSamples: { rtt: number; offset: number }[] = [];
  private lastContact = Date.now();
  // the bot host (useGlobalBots): only answers to this tab's own requests count; a cached read could be seconds old
  private wantHost = false;
  /**
   * This tab runs the bots, by the last answer it had. It stops when an answer says otherwise, not when the lease runs
   * out unseen: with the network gone the wall goes on without a gap, and if another wall has taken over meanwhile they
   * emit the same events until this one hears of it.
   */
  private hostHeld = false;
  private botStart: number | null = null;
  private nextHost = 0;
  private busyHost = false;
  private lastFlush = 0;
  private hostSeen: { id: string; untilMs: number } | null = null;

  constructor(
    readonly world: string,
    private readonly net: WorldTransport,
    private readonly hidden: () => boolean = () => false,
    /** This tab's name as a bot host. */
    private readonly hostId: string = `h_${Math.random().toString(36).slice(2, 10)}`,
    /** Nothing of the world goes into this browser's storage (WorldMirror.memoryOnly). */
    private readonly memoryOnly: boolean = false,
  ) {
    if (memoryOnly) dropStoredEvents();
    try {
      const saved = Number(localStorage.getItem(LS_OFFSET_KEY));
      if (Number.isFinite(saved) && saved !== 0) this.setOffset(saved);
    } catch {
      /* storage unavailable */
    }
  }

  /** The clock and the state, before the page mounts. Rejects when the server cannot be reached (the tick keeps trying). */
  async begin(): Promise<void> {
    await Promise.all([this.syncClock(3), this.refreshState()]);
  }

  /** Another event log of this tab: it gets what is known now and everything that arrives. Returns how to let go. */
  attach(log: EventLog): () => void {
    log.addMany(this.log.all());
    this.logs.add(log);
    return () => {
      this.logs.delete(log);
    };
  }

  /** A feed for this tab's sound: what is known now counts as already played, and every chunk read goes in. */
  attachFeed(feed: ScoreFeed): () => void {
    feed.log.addMany(this.log.all());
    if (this.cursor !== null) feed.readTo = this.cursor;
    this.feeds.add(feed);
    return () => {
      this.feeds.delete(feed);
    };
  }

  enqueue(events: Iterable<PEvent>): void {
    for (const e of events) this.outbox.push(e);
    if (this.outbox.length > MAX_OUTBOX) this.outbox.splice(0, this.outbox.length - MAX_OUTBOX);
  }

  status(): WorldStatus {
    const seen = this.hostSeen;
    const now = wallNow();
    return {
      world: this.world,
      online: this.online,
      outbox: this.outbox.length,
      lagSec: this.cursor === null ? null : (now - chunkEndMs(this.cursor)) / 1000,
      offsetMs: this.offsetMs,
      events: this.log.size,
      host: this.hostHeld ? "here" : seen && seen.id !== this.hostId && seen.untilMs > now ? "other" : "none",
    };
  }

  /** Asks the server to change the world for everybody. false = refused or not reached. */
  async command(cmd: WorldCommand): Promise<boolean> {
    try {
      const st = await this.net.command(cmd);
      if (!st) return false;
      this.contact();
      this.apply(st);
      if (cmd.op === "host") this.noteLease(st);
      return true;
    } catch {
      this.online = false;
      return false;
    }
  }

  /** What this tab says of itself when it renews its lease (the wall's fps …): read at /api/world by whoever asks. */
  hostNote = "";

  /** Whether a wall of this tab wants to run the bots. Switching off lets the lease go at once. */
  setWantHost(want: boolean): void {
    if (want === this.wantHost) return;
    this.wantHost = want;
    this.nextHost = 0;
    if (!want) this.releaseHost();
  }

  /** The tab is closing or the bots are off: the next wall need not wait for the lease to run out. */
  releaseHost(): void {
    if (this.hostHeld) this.net.release(this.hostId);
    this.hostHeld = false;
  }

  /** Takes the bots from whoever runs them (the rehearsal wall's button). false = refused. */
  async takeHost(): Promise<boolean> {
    this.wantHost = true;
    return this.command({ op: "host", id: this.hostId, force: true });
  }

  /** True when this tab is the one to emit the bots: it is the host, or the server has been silent for a while. */
  botsAllowed(): boolean {
    return this.hostHeld || Date.now() - this.lastContact > OFFLINE_BOTS_AFTER_MS;
  }

  /**
   * World ms the bots started at: shared, so that a new host's flocks go on from where the last one's were. null = wait
   * for the server's say; with the server silent, this tab's own start.
   */
  botStartMs(): number | null {
    if (this.botStart !== null) return this.botStart;
    if (Date.now() - this.lastContact <= OFFLINE_BOTS_AFTER_MS) return null;
    this.botStart = worldNow();
    return this.botStart;
  }

  private contact(): void {
    this.online = true;
    this.lastContact = Date.now();
  }

  private noteLease(st: WorldState): void {
    this.hostHeld = st.host?.id === this.hostId;
    if (this.hostHeld) this.botStart = st.botStartMs;
  }

  /** What a refused clear must undo: the wall empties its log at once, before the server has answered. */
  refeed(): void {
    for (const l of this.logs) l.addMany(this.log.all());
  }

  /** Called every TICK_MS, however late. Nothing here waits: each kind of request runs one at a time. */
  tick(): void {
    const t = Date.now();
    if (t >= this.nextClock) void this.syncClock(1);
    if (t >= this.nextState && !this.busyState) void this.refreshState().catch(() => {});
    if (t >= this.nextKeep) this.rollKeepFrom(t);
    if (t >= this.nextSend && !this.busySend && this.outbox.length && this.state) void this.flush(t);
    // a wall that is sending renews its lease with what it sends (flush): a request of its own only when it has stopped
    if (this.wantHost && t >= this.nextHost && !this.busyHost && this.state && !this.outbox.length && t - this.lastFlush > 2 * SEND_EVERY_MS) void this.lookAtLease(t);
    if (t >= this.nextMirror) this.flushMirror(t);
    if (t >= this.nextRead && !this.busyRead && this.state) void this.read(t);
  }

  private setOffset(ms: number): void {
    this.offsetMs = ms;
    setWallOffset(ms);
  }

  private async lookAtLease(t: number): Promise<void> {
    this.busyHost = true;
    this.nextHost = t + HOST_EVERY_MS;
    try {
      await this.command({ op: "host", id: this.hostId, ...(this.hostNote ? { note: this.hostNote } : {}) });
    } finally {
      this.busyHost = false;
    }
  }

  /**
   * The difference between the clocks barely moves, so the sample to believe is the one with the shortest round trip of
   * the last few (Cristian's method): a busy machine's slow answer says little (it moved the clock by 500 ms when each
   * minute's sample was simply taken).
   */
  private async syncClock(samples: number): Promise<void> {
    this.nextClock = Date.now() + CLOCK_EVERY_MS;
    let got = false;
    for (let i = 0; i < samples; i++) {
      try {
        const t0 = Date.now();
        const server = await this.net.now();
        const rtt = Date.now() - t0;
        this.clockSamples.push({ rtt, offset: server - (t0 + rtt / 2) });
        got = true;
      } catch {
        /* the next sample, or the next minute */
      }
    }
    if (!got) return;
    if (this.clockSamples.length > CLOCK_SAMPLES_KEPT) this.clockSamples.splice(0, this.clockSamples.length - CLOCK_SAMPLES_KEPT);
    const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.contact();
    this.setOffset(best.offset);
    try {
      localStorage.setItem(LS_OFFSET_KEY, String(Math.round(best.offset)));
    } catch {
      /* storage unavailable */
    }
    if (this.state) adoptAnchor(this.state.anchor);
  }

  private async refreshState(): Promise<void> {
    this.busyState = true;
    this.nextState = Date.now() + STATE_EVERY_MS;
    try {
      const st = await this.net.state();
      this.contact();
      this.apply(st);
    } catch (e) {
      this.online = false;
      this.nextState = Date.now() + RETRY_MS;
      throw e;
    } finally {
      this.busyState = false;
    }
  }

  /** The server's state into the keys everything reads. A state older than the one held (a cached read) changes nothing. */
  private apply(st: WorldState): void {
    const prev = this.state;
    if (prev && st.rev < prev.rev) return;
    this.state = st;
    this.hostSeen = st.host;
    if (currentEpochKey() !== String(st.epochMs)) adoptEpoch(st.epochMs);
    if (prev && prev.epochMs !== st.epochMs) {
      this.outbox = [];
      this.mirrorQueue = [];
      this.log.clear();
      for (const l of this.logs) l.clear();
      for (const f of this.feeds) f.clear();
      this.botStart = null;
      this.nextHost = 0; // the new epoch's bots start from the server's say, at the next look
    }
    if (!prev || prev.epochMs !== st.epochMs) {
      this.cursor = null;
      this.needWindow = true;
      this.windowCursor = 0;
      this.nextRead = 0;
    }
    adoptAnchor(st.anchor);
    storeKeepWindowSec(st.keepWindowSec);
    this.rollKeepFrom(Date.now());
  }

  /** The history window's cut-off, from the shared clock alone: the same in every tab of every machine. */
  private rollKeepFrom(t: number): void {
    this.nextKeep = t + KEEP_EVERY_MS;
    const key = currentEpochKey();
    if (key === null) return;
    const cut = sessionSeconds(worldNow(), Number(key), 0) - keepWindowSec();
    try {
      localStorage.setItem(LS_KEEP_FROM_KEY, String(cut));
    } catch {
      /* storage unavailable */
    }
    this.log.dropBefore(cut);
    for (const f of this.feeds) f.log.dropBefore(cut);
  }

  private async flush(t: number): Promise<void> {
    const st = this.state!;
    const batch = this.outbox.slice(0, MAX_EVENTS_PER_POST);
    const host = this.wantHost && t >= this.nextHost ? this.hostId : undefined;
    if (host) this.nextHost = t + HOST_EVERY_MS;
    this.busySend = true;
    this.nextSend = t + SEND_EVERY_MS;
    this.lastFlush = t;
    try {
      const a = await this.net.send(st.epochMs, batch, host, host ? this.hostNote : undefined);
      this.contact();
      if (a.ended) {
        this.apply(a.state);
      } else {
        if (this.state?.epochMs === st.epochMs) this.outbox.splice(0, batch.length);
        if (a.state) {
          this.apply(a.state);
          this.noteLease(a.state);
        }
      }
    } catch {
      // kept: sent again on the next try (the server files repeats, the logs drop them by id)
      this.online = false;
      this.nextSend = Date.now() + RETRY_MS;
    } finally {
      this.busySend = false;
    }
  }

  private flushMirror(t: number): void {
    this.nextMirror = t + MIRROR_EVERY_MS;
    if (!this.mirrorQueue.length || !this.state) return;
    saveMerged(this.mirrorQueue, this.state.epochMs, true);
    this.mirrorQueue = [];
  }

  private deliver(events: readonly PEvent[], chunk: number): void {
    if (!events.length) return;
    this.log.addMany(events);
    for (const l of this.logs) l.addMany(events);
    for (const f of this.feeds) f.push(chunk, events);
    if (!this.memoryOnly) for (const e of events) this.mirrorQueue.push(e);
  }

  private async read(t: number): Promise<void> {
    const st = this.state!;
    const target = lastClosedChunk(wallNow() - READ_MARGIN_MS);
    if (!this.needWindow && this.cursor !== null && target - this.cursor > MAX_CATCH_UP_CHUNKS) {
      this.needWindow = true;
      this.windowCursor = 0;
    }
    if (!this.needWindow && (this.cursor === null || this.cursor >= target)) return;
    this.busyRead = true;
    try {
      if (this.needWindow) {
        const a = await this.net.window(st.epochMs, this.windowCursor);
        if (a.ended) {
          this.apply(a.state);
        } else if (this.state?.epochMs === st.epochMs) {
          if (this.windowCursor === 0) this.windowTo = a.to;
          this.deliver(a.events, this.windowTo);
          if (a.next !== null) {
            this.windowCursor = a.next;
          } else {
            this.needWindow = false;
            this.windowCursor = 0;
            this.cursor = this.windowTo;
            for (const f of this.feeds) f.readTo = this.windowTo;
          }
        }
      } else {
        const from = this.cursor! + 1;
        const to = Math.min(target, from + MAX_RANGE_CHUNKS - 1);
        const a = await this.net.range(st.epochMs, from, to);
        if (!a.early && this.state?.epochMs === st.epochMs) {
          this.deliver(a.events, to);
          this.cursor = to;
          for (const f of this.feeds) f.readTo = to;
        }
      }
      this.contact();
      if (this.hidden()) this.nextRead = t + HIDDEN_READ_MS;
    } catch {
      this.online = false;
      this.nextRead = Date.now() + RETRY_MS;
    } finally {
      this.busyRead = false;
    }
  }
}

let agent: WorldAgent | null = null;
let stopAgent: (() => void) | null = null;

/** The world this tab should be in, or null when it runs on its own storage as before. */
export function serverWorldName(): string | null {
  if (typeof window === "undefined") return null;
  const configured = process.env.NEXT_PUBLIC_WORLD;
  if (!configured) return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("sync") === "0" || q.get("demo") === "1") return null;
  const path = window.location.pathname;
  if (path !== "/v2/mobile" && (!path.startsWith("/v2/global/") || path === "/v2/global/lab")) return null;
  const asked = q.get("world");
  return asked && isWorldName(asked) ? asked : configured;
}

/** A phone or tablet: never a bot host, the world stays out of its storage, and it replays only its own steps on the ground. */
export function touchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.maxTouchPoints > 0 || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
}

/** A timer that keeps running in a hidden tab (see useTicker.ts). Returns how to stop it. */
function workerInterval(ms: number, fire: () => void): () => void {
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const fallback = () => {
    worker?.terminate();
    worker = null;
    if (timer === null) timer = setInterval(fire, ms);
  };
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms});`], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = fire;
    worker.onerror = fallback;
  } catch {
    fallback();
  }
  return () => {
    worker?.terminate();
    if (timer !== null) clearInterval(timer);
  };
}

/**
 * Starts this tab's agent (once) and waits for the server's values at most `timeoutMs`, so the page mounts in the right
 * epoch and on the right clock. The ground never waits longer: past that the page mounts on the last values and joins
 * when the answer comes.
 */
export async function startServerWorld(timeoutMs = 2500): Promise<void> {
  const name = serverWorldName();
  if (!name) return;
  if (!agent) {
    const memoryOnly = touchDevice();
    const a = new WorldAgent(name, httpTransport(name), () => document.visibilityState === "hidden", undefined, memoryOnly);
    agent = a;
    setWorldMirror({
      memoryOnly,
      enqueue: (events) => a.enqueue(events),
      clear: () => {
        void a.command({ op: "clear" }).then((ok) => {
          if (ok) return;
          a.refeed(); // the wall emptied its log at once; the world is still there
          window.alert("세계를 지우지 못했습니다 (관리 키가 없거나 서버에 닿지 않음).");
        });
      },
      setKeepWindow: (sec) => void a.command({ op: "window", sec }),
    });
    setRateMirror((rate) => void a.command({ op: "rate", rate }));
    const onHide = () => a.releaseHost();
    window.addEventListener("pagehide", onHide);
    (window as unknown as { __world?: WorldAgent }).__world = a;
    const begun = a.begin().catch(() => {});
    const stopTimer = workerInterval(TICK_MS, () => a.tick());
    stopAgent = () => {
      stopTimer();
      window.removeEventListener("pagehide", onHide);
      a.setWantHost(false);
      setWorldMirror(null);
      setRateMirror(null);
      setWallOffset(0);
      delete (window as unknown as { __world?: WorldAgent }).__world;
    };
    await Promise.race([begun, new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

/**
 * Leaving the pages of the shared world for one that is not (V1, the home page) without a page load: the agent lives in
 * the tab's modules and would go on, and those pages would write into the shared world.
 */
export function stopServerWorld(): void {
  stopAgent?.();
  stopAgent = null;
  agent = null;
}

/** Connects one of this tab's event logs to the server; returns how to let go (nothing to do when the agent is off). */
export function attachToServerWorld(log: EventLog): () => void {
  if (!agent) return () => {};
  return agent.attach(log);
}

/** Connects a sound's feed to the server; returns how to let go. */
export function attachScoreFeed(feed: ScoreFeed): () => void {
  return agent ? agent.attachFeed(feed) : () => {};
}

/** The wall's word about itself, sent with every renewal of its lease (fps, size, compute): the artist, 2026-11-11, "can the Mac mini's state be checked remotely?". */
export function setHostNote(note: string): void {
  if (agent) agent.hostNote = note.slice(0, HOST_NOTE_MAX);
}

/** Asks to run the bots from this tab, or stops asking. A phone never hosts: it is locked or pocketed at any moment. */
export function wantBotHost(want: boolean): void {
  if (!agent) return;
  agent.setWantHost(want && !touchDevice());
}

/** Whether this tab emits the bots now (always true when the agent is off: then it is the tab's own world). */
export function mayEmitBots(): boolean {
  return agent ? agent.botsAllowed() : true;
}

export function sharedBotStartMs(): number | null {
  return agent ? agent.botStartMs() : null;
}

/** The rehearsal wall's button: the bots from here on run from this tab, with this tab's knobs. */
export function takeBotHost(): void {
  void agent?.takeHost().then((ok) => {
    if (!ok) window.alert("봇 호스트를 가져오지 못했습니다 (관리 키가 없거나 서버에 닿지 않음).");
  });
}

/** The shared world as one line for a view's readout (null when this tab is not in one). */
export function worldReadout(): string | null {
  if (!agent) return null;
  const s = agent.status();
  return `sync: ${s.world} · ${s.online ? "on" : "off (running on the last values)"} · ${s.events} events · queued ${s.outbox} · lag ${s.lagSec === null ? "-" : s.lagSec.toFixed(1)} s · clock ${s.offsetMs >= 0 ? "+" : ""}${Math.round(s.offsetMs)} ms · bots ${s.host === "here" ? "here" : s.host === "other" ? "in another tab" : "nobody"}`;
}
