/**
 * markerRelay.ts — a visitor's place on its way to the walls in a fraction of a second (relay/marker). It carries only the
 * marker: nothing here enters the world's record, which goes on through the shared world's server. It has no timers of
 * its own: the caller's tick or frame drives it, so a page that sleeps does no work.
 *
 * Off (no NEXT_PUBLIC_MARKER_RELAY, not in a shared world, `?relay=0`): no socket, the walls read the samples as before.
 * Lost or over its daily limit: the same, after a marker has not been heard for HEARD_MS.
 */

import { serverWorldName } from "./serverWorld";

export interface RelayedMark {
  o: string;
  x: number;
  z: number;
  s: number;
}

/** How often a walking visitor is sent; standing still, KEEP_SENDING_MS, so that the wall knows they are there. */
export const RELAY_SEND_MS = 250;
const KEEP_SENDING_MS = 1000;
/** A place that changed less than this (world) is not news. */
const MOVED = 0.01;
/** A marker not heard for this long goes back to the samples. */
export const HEARD_MS = 2000;
const PING_MS = 5000;
const NO_ANSWER_MS = 15_000;
/** Not sent while this much is still waiting in the socket: a place that arrives late is of no use. */
const MAX_BUFFERED = 1024;
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
const MAX_HEARD = 64;
const VISITOR_ID = /^v_[a-z0-9]{1,12}$/;

const OPEN = 1;

/** One line of text per place; stays well inside the relay's limit. */
export function markText(m: RelayedMark): string {
  return JSON.stringify({ o: m.o, x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, s: Math.round(m.s * 10) / 10 });
}

/** A place from the relay; anyone can reach it, so a line is believed only if it could be a visitor's. */
export function parseMark(text: unknown): RelayedMark | null {
  if (typeof text !== "string" || text.length > 200) return null;
  try {
    const m = JSON.parse(text) as Partial<RelayedMark> | null;
    if (!m || typeof m.o !== "string" || !VISITOR_ID.test(m.o)) return null;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || !Number.isFinite(m.s)) return null;
    return { o: m.o, x: m.x as number, z: m.z as number, s: m.s as number };
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
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly socket: RelaySocket,
    private readonly clock: () => number = monotonic,
  ) {}

  tick(m: RelayedMark): void {
    this.socket.poke();
    const now = this.clock();
    const moved = !(Math.abs(m.x - this.lastX) < MOVED && Math.abs(m.z - this.lastZ) < MOVED);
    if (!moved && now - this.lastAt < KEEP_SENDING_MS) return;
    if (!this.socket.send(markText(m))) return;
    this.lastX = m.x;
    this.lastZ = m.z;
    this.lastAt = now;
  }

  close(): void {
    this.socket.close();
  }
}

/** The wall's side: what has been heard since the last frame, and who is being heard at all. */
export class MarkerListener {
  private news: RelayedMark[] = [];
  private readonly heard = new Map<string, { m: RelayedMark; at: number }>();
  private readonly hearing = new Map<string, RelayedMark>();
  private readonly socket: RelaySocket;

  constructor(
    url: string,
    make?: MakeSocket,
    private readonly clock: () => number = monotonic,
  ) {
    this.socket = new RelaySocket(url, (text) => this.hear(text), make, clock);
  }

  private hear(text: string): void {
    const m = parseMark(text);
    if (!m) return;
    if (this.heard.size >= MAX_HEARD && !this.heard.has(m.o)) return;
    this.heard.set(m.o, { m, at: this.clock() });
    if (this.news.length < MAX_HEARD * 4) this.news.push(m);
  }

  /** The places that came in since the last call. */
  drain(): readonly RelayedMark[] {
    this.socket.poke();
    if (this.news.length === 0) return NOTHING;
    const out = this.news;
    this.news = [];
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

  status(): { connected: boolean; rttMs: number | null; heard: number } {
    return { connected: this.socket.connected, rttMs: this.socket.rttMs, heard: this.heard.size };
  }

  close(): void {
    this.socket.close();
  }
}

const NOTHING: readonly RelayedMark[] = [];

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
  return listener;
}

let senderSocket: RelaySocket | null = null;
let wallListener: MarkerListener | null = null;

/** The relay as one line for the wall's readout (null when it is off). */
export function markerRelayReadout(): string | null {
  if (!wallListener) return null;
  const s = wallListener.status();
  return `relay: ${s.connected ? "on" : "off (markers on the samples)"} · ${s.rttMs === null ? "-" : `${Math.round(s.rttMs)} ms`} there and back · hearing ${s.heard}`;
}

/** What a phone reports with `?perf=1`, to measure the way from a real phone. */
export function markerRelayReport(): { relayOn: boolean; relayRttMs: number | null } | null {
  return senderSocket ? { relayOn: senderSocket.connected, relayRttMs: senderSocket.rttMs } : null;
}
