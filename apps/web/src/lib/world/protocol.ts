/**
 * world/protocol.ts — what the shared world's server and its tabs agree on (docs/shared-world-plan.md §3). Pure: no
 * clocks, no storage, no network.
 *
 * The server stores what it receives as it received it, one row per POST, under the 2 s CHUNK its arrival falls in. A
 * chunk is CLOSED once its end lies CLOSE_GRACE_MS in the past: from then on it can never change, so the CDN keeps it
 * for good and every tab reads the same chunks in the same order, however many tabs there are. The grace covers an
 * insert that was stamped just before the end of its chunk and commits just after.
 */

import { ROLES, type PEvent, type RoleId } from "@/lib/parliament/types";
import { wrapCoord } from "@/lib/parliament/world";

export const CHUNK_MS = 2000;
export const CLOSE_GRACE_MS = 1500;
/** Most chunks one range read may ask for (5 minutes): a function's response is limited to 4.5 MB. */
export const MAX_RANGE_CHUNKS = 150;
/** A wall at ×40 with 30 bots posts 2400 events per 2 s. */
export const MAX_EVENTS_PER_POST = 4000;
export const MAX_POST_BYTES = 512 * 1024;
/** One page of the window read: below the function's 4.5 MB, cut at a chunk's edge. */
export const WINDOW_PAGE_ROWS = 800;
export const WINDOW_PAGE_BYTES = 3 * 1024 * 1024;
/**
 * The bot host's lease. A lost host: 10 s + the 5 s between looks at it + the first sample stays under `emptyGapSec`
 * (20 s), so a handover leaves no empty time (12 s measured 18 s, too close).
 */
export const HOST_LEASE_MS = 10_000;
/** The history window (log.ts KEEP_WINDOW_SEC is the same default) and the most any wall may raise it to. */
export const DEFAULT_KEEP_WINDOW_SEC = 20 * 60;
export const MAX_KEEP_WINDOW_SEC = 2 * 60 * 60;
/** The exhibition's world runs at real speed: the rate is locked there (plan §7.2). */
export const LOCKED_RATE_WORLD = "exhibition";

export interface WorldAnchor {
  /** Server wall ms of the anchor. */
  r: number;
  /** World ms at the anchor. */
  v: number;
  rate: number;
}

export interface WorldHost {
  id: string;
  untilMs: number;
}

/** What the server is the one authority on, besides the events. */
export interface WorldState {
  world: string;
  /** Rises with every change of the epoch, the clock or the window: a cached read older than what a tab holds changes nothing. */
  rev: number;
  epochMs: number;
  anchor: WorldAnchor;
  keepWindowSec: number;
  /** World ms the bots started at: kept here so a new host's flocks go on from the same places. */
  botStartMs: number | null;
  host: WorldHost | null;
}

export function chunkOf(ms: number): number {
  return Math.floor(ms / CHUNK_MS);
}

export function chunkEndMs(chunk: number): number {
  return (chunk + 1) * CHUNK_MS;
}

/** The newest chunk that is closed at `nowMs`. */
export function lastClosedChunk(nowMs: number): number {
  return chunkOf(nowMs - CLOSE_GRACE_MS) - 1;
}

export function isClosed(chunk: number, nowMs: number): boolean {
  return chunk <= lastClosedChunk(nowMs);
}

/** World ms at server wall ms `wallMs` (worldClock.ts does the same on the client). */
export function worldMsAt(a: WorldAnchor, wallMs: number): number {
  return a.v + (wallMs - a.r) * a.rate;
}

/** Assigned time before which events are forgotten. From the shared clock alone: no tab's offset moves it. */
export function keepFromAt(st: Pick<WorldState, "anchor" | "epochMs" | "keepWindowSec">, wallMs: number): number {
  return (worldMsAt(st.anchor, wallMs) - st.epochMs) / 1000 - st.keepWindowSec;
}

/** Names a tab may ask for. Production takes only its own world; the rest are for rehearsal and testing. */
export function isWorldName(name: string): boolean {
  return /^(rehearsal|exhibition|(dev|test)-[a-z0-9-]{1,24})$/.test(name);
}

const isRole = (r: unknown): r is RoleId => (ROLES as readonly unknown[]).includes(r);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** One event as stored (canonical coordinates, rounded as log.ts stores them), or null when it is not an event. */
export function cleanEvent(e: unknown): PEvent | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || o.id.length > 80) return null;
  if (typeof o.o !== "string" || !o.o || o.o.length > 40) return null;
  if (o.k !== "p" || !isRole(o.r)) return null;
  const { x, z, s } = o;
  if (typeof x !== "number" || typeof z !== "number" || typeof s !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(s)) return null;
  return { id: o.id, o: o.o, r: o.r, k: "p", x: r2(wrapCoord(x)), z: r2(wrapCoord(z)), s: r2(s) };
}

/** The events of a POST that are events; null when it is not a list or asks for too much. */
export function cleanEvents(raw: unknown): PEvent[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS_PER_POST) return null;
  const out: PEvent[] = [];
  for (const e of raw) {
    const c = cleanEvent(e);
    if (c) out.push(c);
  }
  return out;
}

/** Several stored rows (each a JSON array) as one JSON array, without parsing them. */
export function joinEventTexts(texts: readonly string[]): string {
  const parts: string[] = [];
  for (const t of texts) {
    const inner = t.slice(1, -1);
    if (inner) parts.push(inner);
  }
  return `[${parts.join(",")}]`;
}

export interface WindowRow {
  chunk: number;
  events: string;
}

/**
 * One page of the window read: rows in (chunk, seq) order up to the limits, always cut at a chunk's edge so the next
 * page starts on a whole chunk. `next` is the chunk the next page starts from (null: this was the last page).
 */
export function pageWindow(rows: readonly WindowRow[], maxRows = WINDOW_PAGE_ROWS, maxBytes = WINDOW_PAGE_BYTES): { texts: string[]; next: number | null } {
  const texts: string[] = [];
  let bytes = 0;
  let chunkStart = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const newChunk = i > 0 && row.chunk !== rows[i - 1].chunk;
    if (newChunk) chunkStart = i;
    if (newChunk && bytes + row.events.length > maxBytes) return { texts, next: row.chunk };
    texts.push(row.events);
    bytes += row.events.length;
  }
  // a full page may have stopped inside its last chunk: that chunk goes to the next page, whole
  if (rows.length >= maxRows && chunkStart > 0) return { texts: texts.slice(0, chunkStart), next: rows[chunkStart].chunk };
  return { texts, next: null };
}
