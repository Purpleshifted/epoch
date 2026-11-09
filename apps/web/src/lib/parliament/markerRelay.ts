/**
 * markerRelay.ts — a visitor's place on its way to the walls in a fraction of a second (relay/marker). It carries the
 * marker, the visitor's presence samples (what the wall builds from) and the moment a seed head is born: nothing here
 * enters the world's record, which goes on through the shared world's server (they arrive there later under the same
 * id, and the wall's log keeps one). It has no timers of its own: the caller's tick or frame drives it, so a page that
 * sleeps does no work.
 *
 * Off (no NEXT_PUBLIC_MARKER_RELAY, not in a shared world, `?relay=0`): no socket, the walls read the samples as before.
 * Lost or over its daily limit: the same, after a marker has not been heard for HEARD_MS.
 */

import { currentEpochKey } from "./log";
import { serverWorldName } from "./serverWorld";
import type { PEvent } from "./types";
import { wallNow } from "./worldClock";

export interface RelayedMark {
  o: string;
  x: number;
  z: number;
  s: number;
  /** Which way they face (rad). The wall does not draw it yet. */
  y: number;
  /** The epoch it belongs to: a world cleared just now must not leave a marker at the old world's time. */
  e: number;
  /** Server-corrected wall ms it was sent at. */
  t: number;
  /** The sender's last round trip to the relay (ms, -1 unknown). */
  r: number;
  /** This place is also a presence sample: its id in the record. */
  p?: string;
}

/** How often a walking visitor is sent; standing still, KEEP_SENDING_MS, so that the wall knows they are there. */
export const RELAY_SEND_MS = 125;
const KEEP_SENDING_MS = 1000;
/** After a sample, which is a place too: standing still, the next sample is the only line sent (and under HEARD_MS). */
const SAMPLE_KEEPS_MS = 1500;
/** A place that changed less than this (world) is not news. */
const MOVED = 0.01;
const TURNED = 0.01;
/** A marker not heard for this long goes back to the samples. */
export const HEARD_MS = 2000;
const PING_MS = 5000;
const NO_ANSWER_MS = 15_000;
/** Not sent while this much is still waiting in the socket: a place that arrives late is of no use. */
const MAX_BUFFERED = 1024;
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
const MAX_HEARD = 64;
const DELAYS_KEPT = 2000;
const VISITOR_ID = /^v_[a-z0-9]{1,12}$/;
const EVENT_ID = /^v_[a-z0-9]{1,12}:[a-z0-9]{1,12}:\d{1,12}$/;

const OPEN = 1;

/** One line of text per place; stays well inside the relay's limit. */
export function markText(m: RelayedMark): string {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return JSON.stringify({ o: m.o, x: r2(m.x), z: r2(m.z), s: Math.round(m.s * 10) / 10, y: r2(m.y), e: m.e, t: Math.round(m.t), r: Math.round(m.r) });
}

/** A presence sample as a line: a place, finer than `markText`, since what is built follows from it. */
export function sampleText(e: PEvent, y: number, epoch: number, t: number, r: number): string {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return JSON.stringify({ o: e.o, x: r4(e.x), z: r4(e.z), s: Math.round(e.s * 1000) / 1000, y: Math.round(y * 100) / 100, e: epoch, t: Math.round(t), r: Math.round(r), p: e.id });
}

/** A place from the relay; anyone can reach it, so a line is believed only if it could be a visitor's. */
export function parseMark(text: unknown): RelayedMark | null {
  if (typeof text !== "string" || text.length > 200) return null;
  try {
    const m = JSON.parse(text) as Partial<RelayedMark> | null;
    if (!m || typeof m.o !== "string" || !VISITOR_ID.test(m.o)) return null;
    for (const v of [m.x, m.z, m.s, m.y, m.e, m.t, m.r]) if (!Number.isFinite(v)) return null;
    const out: RelayedMark = { o: m.o, x: m.x as number, z: m.z as number, s: m.s as number, y: m.y as number, e: m.e as number, t: m.t as number, r: m.r as number };
    if (typeof m.p === "string" && EVENT_ID.test(m.p) && m.p.startsWith(`${m.o}:`)) out.p = m.p;
    return out;
  } catch {
    return null;
  }
}

/** The presence sample a place carries, as the record will have it. */
export function sampleOf(m: RelayedMark): PEvent | null {
  return m.p ? { id: m.p, o: m.o, r: "worker", k: "p", x: m.x, z: m.z, s: m.s } : null;
}

/** A seed head's event, for the walls (dandelion.ts): `h` is its id in the record. */
export function headText(e: PEvent, epoch: number): string {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return JSON.stringify({ h: e.id, o: e.o, x: r2(e.x), z: r2(e.z), s: Math.round(e.s * 100) / 100, e: epoch });
}

/** A seed head from the relay, believed like a place; null for anything else. */
export function parseHead(text: unknown): { event: PEvent; epoch: number } | null {
  if (typeof text !== "string" || text.length > 200) return null;
  try {
    const m = JSON.parse(text) as { h?: unknown; o?: unknown; x?: number; z?: number; s?: number; e?: number } | null;
    if (!m || typeof m.h !== "string" || !EVENT_ID.test(m.h) || typeof m.o !== "string" || !m.h.startsWith(`${m.o}:`)) return null;
    for (const v of [m.x, m.z, m.s, m.e]) if (!Number.isFinite(v)) return null;
    return { event: { id: m.h, o: m.o, r: "tree", k: "s", x: m.x as number, z: m.z as number, s: m.s as number }, epoch: m.e as number };
  } catch {
    return null;
  }
}

const BOT_ID = /^bot\d{1,4}$/;

/** A bot's question to this visitor is open until `until` (s): the wall keeps that bot where it stands (bots.ts stayWhileAsked). */
export function askText(bot: string, o: string, epoch: number, until: number): string {
  return JSON.stringify({ q: bot, o, e: epoch, u: Math.round(until * 10) / 10 });
}

export function parseAsk(text: unknown): { bot: string; until: number; epoch: number } | null {
  if (typeof text !== "string" || text.length > 200) return null;
  try {
    const m = JSON.parse(text) as { q?: unknown; o?: unknown; e?: number; u?: number } | null;
    if (!m || typeof m.q !== "string" || !BOT_ID.test(m.q) || typeof m.o !== "string" || !VISITOR_ID.test(m.o)) return null;
    if (!Number.isFinite(m.e) || !Number.isFinite(m.u)) return null;
    return { bot: m.q, until: m.u as number, epoch: m.e as number };
  } catch {
    return null;
  }
}

type MakeSocket = (url: string) => WebSocket;
const monotonic = () => performance.now();

/** A socket that comes back by itself whenever `poke` is called, later and later while it keeps failing. */
export class RelaySocket {
  private ws: WebSocket | null = null;
  private fails = 0;
  private nextTry = 0;
  private pingAt = Number.NEGATIVE_INFINITY;
  private pingSent = 0;
  private answerAt = 0;
  /** The way to the relay and back (ms), as last measured. */
  rttMs: number | null = null;

  constructor(
    private readonly url: string,
    private readonly onText: (text: string) => void,
    private readonly make: MakeSocket = (u) => new WebSocket(u),
    private readonly clock: () => number = monotonic,
  ) {}

  poke(): void {
    const now = this.clock();
    const ws = this.ws;
    if (!ws) {
      if (now >= this.nextTry) this.connect(now);
      return;
    }
    if (now - this.answerAt >= NO_ANSWER_MS) {
      this.letGo(ws);
      return;
    }
    if (ws.readyState === OPEN && now - this.pingAt >= PING_MS) {
      this.pingAt = this.pingSent = now;
      ws.send("ping");
    }
  }

  send(text: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || ws.bufferedAmount > MAX_BUFFERED) return false;
    ws.send(text);
    return true;
  }

  get connected(): boolean {
    return this.ws?.readyState === OPEN;
  }

  close(): void {
    this.nextTry = Number.POSITIVE_INFINITY;
    if (this.ws) this.letGo(this.ws);
  }

  private connect(now: number): void {
    // counted as failed until the relay has answered: a socket that opens and closes again must not retry at once
    this.nextTry = now + RETRY_MS[Math.min(this.fails, RETRY_MS.length - 1)];
    this.fails++;
    let ws: WebSocket;
    try {
      ws = this.make(this.url);
    } catch {
      return;
    }
    this.ws = ws;
    this.answerAt = now;
    this.pingAt = Number.NEGATIVE_INFINITY;
    ws.onmessage = (e) => {
      if (e.data !== "pong") {
        this.onText(e.data as string);
        return;
      }
      this.answerAt = this.clock();
      this.fails = 0;
      this.nextTry = this.answerAt + RETRY_MS[0];
      this.rttMs = this.answerAt - this.pingSent;
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
    };
  }

  private letGo(ws: WebSocket): void {
    this.ws = null;
    ws.onclose = ws.onmessage = null;
    ws.close();
  }
}

/** The visitor's side: called every RELAY_SEND_MS with where they are. */
export class MarkerSender {
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastY = Number.NaN;
  private keepAt = Number.NEGATIVE_INFINITY;
  private walking = false;

  constructor(
    private readonly socket: RelaySocket,
    private readonly clock: () => number = monotonic,
    private readonly sentAt: () => number = wallNow,
  ) {}

  tick(m: Omit<RelayedMark, "t" | "r">): void {
    this.socket.poke();
    const now = this.clock();
    const moved = !(Math.abs(m.x - this.lastX) < MOVED && Math.abs(m.z - this.lastZ) < MOVED && Math.abs(m.y - this.lastY) < TURNED);
    // the first tick standing still goes too: a marker walking ahead (walkToHeard) learns at once that they stopped
    if (!moved && !this.walking && now < this.keepAt) return;
    if (!this.socket.send(markText({ ...m, t: this.sentAt(), r: this.socket.rttMs ?? -1 }))) return;
    this.lastX = m.x;
    this.lastZ = m.z;
    this.lastY = m.y;
    this.keepAt = now + KEEP_SENDING_MS;
    this.walking = moved;
  }

  /** A presence sample, at once: the wall builds from it seconds before the record brings it. */
  sample(e: PEvent, y: number, epoch: number): void {
    if (this.socket.send(sampleText(e, y, epoch, this.sentAt(), this.socket.rttMs ?? -1))) this.keepAt = this.clock() + SAMPLE_KEEPS_MS;
  }

  /** Who is asking me now: sent again while the question is open (the wall holds that bot until `until`). */
  ask(bot: string, o: string, epoch: number, until: number): void {
    this.socket.send(askText(bot, o, epoch, until));
  }

  /** A seed head, at once. If the socket is down the wall has it from the record a few seconds later, as before. */
  head(e: PEvent, epoch: number): void {
    this.socket.send(headText(e, epoch));
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * How the way from a phone to this wall measures up. Two views of one thing: `delay` is by the server-corrected clocks,
 * which may be off by half a round trip to Vercel (some 130 ms), about as much as is being measured; half of each round
 * trip added up needs no clocks.
 */
export interface RelayStatus {
  connected: boolean;
  /** This wall to the relay and back (ms). */
  rttMs: number | null;
  /** The newest sender to the relay and back (ms). */
  senderRttMs: number | null;
  heard: number;
  count: number;
  delayP50: number | null;
  delayP95: number | null;
}

/** The wall's side: what has been heard since the last frame, and who is being heard at all. */
export class MarkerListener {
  /** Each visitor's newest place since the last frame: a tab that was not drawing has no use for the older ones. */
  private readonly news = new Map<string, RelayedMark>();
  /** Seed heads and presence samples for the wall's log; whatever does not fit comes with the record. */
  private events: PEvent[] = [];
  private delays: number[] = [];
  private senderRttMs: number | null = null;
  private readonly heard = new Map<string, { m: RelayedMark; at: number }>();
  private readonly hearing = new Map<string, RelayedMark>();
  /** The bots asked to stay, each until when (s). */
  private readonly staying = new Map<string, number>();
  private readonly socket: RelaySocket;

  constructor(
    url: string,
    make?: MakeSocket,
    private readonly clock: () => number = monotonic,
    private readonly epoch: () => string | null = currentEpochKey,
    private readonly heardAt: () => number = wallNow,
  ) {
    this.socket = new RelaySocket(url, (text) => this.hear(text), make, clock);
  }

  private hear(text: string): void {
    const head = parseHead(text);
    if (head) {
      if (String(head.epoch) === this.epoch() && this.events.length < MAX_HEARD) this.events.push(head.event);
      return;
    }
    const ask = parseAsk(text);
    if (ask) {
      if (String(ask.epoch) === this.epoch() && (this.staying.size < MAX_HEARD || this.staying.has(ask.bot))) this.staying.set(ask.bot, ask.until);
      return;
    }
    const m = parseMark(text);
    if (!m || String(m.e) !== this.epoch()) return;
    if (this.heard.size >= MAX_HEARD && !this.heard.has(m.o)) return;
    const sample = sampleOf(m);
    if (sample && this.events.length < MAX_HEARD) this.events.push(sample);
    this.heard.set(m.o, { m, at: this.clock() });
    this.news.set(m.o, m);
    this.delays.push(this.heardAt() - m.t);
    if (this.delays.length > DELAYS_KEPT) this.delays.splice(0, this.delays.length - DELAYS_KEPT);
    if (m.r >= 0) this.senderRttMs = m.r;
  }

  /** The places that came in since the last call. */
  drain(): readonly RelayedMark[] {
    this.socket.poke();
    if (this.news.size === 0) return NOTHING;
    const out = [...this.news.values()];
    this.news.clear();
    return out;
  }

  /** The seed heads and presence samples that came in since the last call. */
  drainEvents(): readonly PEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Who has been heard in the last HEARD_MS, each at their last place. */
  live(): ReadonlyMap<string, RelayedMark> {
    const now = this.clock();
    this.hearing.clear();
    for (const [id, h] of this.heard) {
      if (now - h.at > HEARD_MS) this.heard.delete(id);
      else this.hearing.set(id, h.m);
    }
    return this.hearing;
  }

  /** The bots asked to stay; those whose time is up (before `now`, s) are forgotten. */
  asked(now: number): ReadonlyMap<string, number> {
    for (const [bot, until] of this.staying) if (until <= now) this.staying.delete(bot);
    return this.staying;
  }

  status(): RelayStatus {
    const sorted = [...this.delays].sort((a, b) => a - b);
    const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);
    return { connected: this.socket.connected, rttMs: this.socket.rttMs, senderRttMs: this.senderRttMs, heard: this.heard.size, count: sorted.length, delayP50: at(0.5), delayP95: at(0.95) };
  }

  /** A new measurement starts from here. */
  clearDelays(): void {
    this.delays = [];
  }

  close(): void {
    this.socket.close();
  }
}

const NOTHING: readonly RelayedMark[] = [];
const NO_EVENTS: readonly PEvent[] = [];

function relayUrl(as: "phone" | "wall"): string | null {
  const base = process.env.NEXT_PUBLIC_MARKER_RELAY;
  const world = serverWorldName();
  if (!base || !world) return null;
  if (new URLSearchParams(window.location.search).get("relay") === "0") return null;
  return `${base.replace(/\/$/, "")}/${world}?as=${as}`;
}

/** Null when the relay is off: then nobody sends and the walls read the samples. */
export function openMarkerSender(): MarkerSender | null {
  const url = relayUrl("phone");
  if (!url) return null;
  const socket = new RelaySocket(url, () => {});
  senderSocket = socket;
  return new MarkerSender(socket);
}

export function openMarkerListener(): MarkerListener | null {
  const url = relayUrl("wall");
  if (!url) return null;
  const listener = new MarkerListener(url);
  wallListener = listener;
  (window as unknown as { __relay?: unknown }).__relay = { status: () => listener.status(), clearDelays: () => listener.clearDelays() };
  return listener;
}

let senderSocket: RelaySocket | null = null;
let wallListener: MarkerListener | null = null;

/** The bots whose question to a visitor is open, each until when (s); null when no wall listens here. */
export function askedBots(now: number): ReadonlyMap<string, number> | null {
  return wallListener ? wallListener.asked(now) : null;
}

/** The relay as one line for the wall's readout (null when it is off). */
export function markerRelayReadout(): string | null {
  if (!wallListener) return null;
  const s = wallListener.status();
  const ms = (v: number | null) => (v === null ? "-" : `${Math.round(v)} ms`);
  return `relay: ${s.connected ? "on" : "off (markers on the samples)"} · hearing ${s.heard} · phone→wall ${ms(s.delayP50)} · there and back: wall ${ms(s.rttMs)}, phone ${ms(s.senderRttMs)}`;
}

/** What a phone reports with `?perf=1`, to measure the way from a real phone. */
export function markerRelayReport(): { relayOn: boolean; relayRttMs: number | null } | null {
  return senderSocket ? { relayOn: senderSocket.connected, relayRttMs: senderSocket.rttMs } : null;
}
