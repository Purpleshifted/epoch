/**
 * parliament/log.ts
 *
 * The append-only event log and its localStorage mirror (stand-in for the shared server:
 * the same interface — add / addMany / all — is what a socket channel would feed).
 */

import type { PEvent, RoleId } from "./types";
import { ROLES } from "./types";
import { worldNow } from "./worldClock";
import { wrapEvent } from "./world";

export const LS_EVENTS_KEY = "anthropocene:parliament:v1";
/** Shared with the older stratum code: the wall-clock moment the exhibition epoch began. */
export const LS_PARLIAMENT_EPOCH_KEY = "anthropocene:epoch:v1";
/** The visitor id of the most recently opened player tab (so the 3D view can mark "me"). */
export const LS_PARLIAMENT_ME_KEY = "anthropocene:parliament:me";
/**
 * The epoch the stored events belong to. Assigned times only mean something within one epoch, and the epoch key
 * is shared with older code that resets it without touching these events: events of another epoch are a dead world
 * (their times can be far ahead of the present) and are ignored, then replaced on the next save.
 */
export const LS_EVENTS_EPOCH_KEY = "anthropocene:parliament:events-epoch:v1";
/**
 * Who wrote the stored log last: a token every saveMerged writes with it. A tab that finds its own token there knows
 * nobody else has written since — it can append to what it wrote instead of reading and re-serializing everything
 * (saveMerged), and it has nothing new to read (useWorld's poll, eventsUnchangedSince).
 */
export const LS_EVENTS_TOKEN_KEY = "anthropocene:parliament:events-token:v1";
export const MAX_EVENTS = 30000;

export class EventLog {
  private m = new Map<string, PEvent>();
  private cache: PEvent[] | null = null;
  /** Bumps on every change. */
  version = 0;
  /** Bumps whenever events were forgotten (dropBefore, clear); `droppedBefore` is the last cutoff. */
  drops = 0;
  droppedBefore = -Infinity;

  get size(): number {
    return this.m.size;
  }

  add(e: PEvent): boolean {
    if (this.m.has(e.id)) return false;
    this.m.set(e.id, e);
    this.cache = null;
    this.version++;
    return true;
  }

  addMany(list: Iterable<PEvent>): number {
    let n = 0;
    for (const e of list) if (this.add(e)) n++;
    return n;
  }

  /** Forgets the events before assigned time `s` (see keepFromS). Returns how many went. */
  dropBefore(s: number): number {
    let n = 0;
    for (const [id, e] of this.m) {
      if (e.s < s) {
        this.m.delete(id);
        n++;
      }
    }
    if (n) {
      this.cache = null;
      this.version++;
      this.drops++;
      this.droppedBefore = s;
    }
    return n;
  }

  clear(): void {
    this.m.clear();
    this.cache = null;
    this.version++;
    this.drops++;
    this.droppedBefore = Infinity;
  }

  all(): PEvent[] {
    if (!this.cache) this.cache = [...this.m.values()];
    return this.cache;
  }
}

function isEvent(e: unknown): e is PEvent {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.o === "string" &&
    typeof o.x === "number" &&
    typeof o.z === "number" &&
    typeof o.s === "number" &&
    o.k === "p" &&
    typeof o.r === "string" &&
    (ROLES as readonly string[]).includes(o.r as RoleId)
  );
}

/** The current epoch key as stored (null = no epoch yet). Does not create one. */
export function currentEpochKey(): string | null {
  try {
    return localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY);
  } catch {
    return null;
  }
}

/**
 * HISTORY WINDOW (for performance, for now): only the last `keepWindowSec()` before the player's present are kept.
 * A player tab writes the cutoff (its assigned time − window) when it loads and every 30 s after, so the window
 * rolls on; loading and saving drop older events, and open views forget them (useWorld). The window's length is a
 * SHARED SETTING of this browser (LS_KEEP_WINDOW_KEY, default KEEP_WINDOW_SEC): the global views have a Leva knob
 * for it (useWorld.ts useKeepWindowControl) — short while working on something else, so little data gathers.
 */
export const KEEP_WINDOW_SEC = 20 * 60;
export const LS_KEEP_FROM_KEY = "anthropocene:parliament:keep-from:v1";
export const LS_KEEP_WINDOW_KEY = "anthropocene:parliament:keep-window-sec:v1";

/** The history window's length (seconds): the shared setting, or KEEP_WINDOW_SEC. */
export function keepWindowSec(): number {
  try {
    const raw = localStorage.getItem(LS_KEEP_WINDOW_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && v > 0 ? v : KEEP_WINDOW_SEC;
  } catch {
    return KEEP_WINDOW_SEC;
  }
}

/** Sets the shared history window (seconds); the next setKeepFrom (every player tab, every 30 s) applies it. */
export function setKeepWindowSec(sec: number): void {
  try {
    if (Number.isFinite(sec) && sec > 0) localStorage.setItem(LS_KEEP_WINDOW_KEY, String(sec));
    else localStorage.removeItem(LS_KEEP_WINDOW_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Assigned time before which events are dropped (−Infinity: keep everything). */
export function keepFromS(): number {
  try {
    const raw = localStorage.getItem(LS_KEEP_FROM_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : -Infinity;
  } catch {
    return -Infinity;
  }
}

/** A player session that starts at assigned time `sessionStartS` keeps the window (keepWindowSec) before it. */
export function setKeepFrom(sessionStartS: number): void {
  try {
    localStorage.setItem(LS_KEEP_FROM_KEY, String(sessionStartS - keepWindowSec()));
  } catch {
    /* storage unavailable */
  }
}

export function loadEvents(): PEvent[] {
  try {
    const epoch = localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY);
    if (epoch === null || localStorage.getItem(LS_EVENTS_EPOCH_KEY) !== epoch) return [];
    const raw = localStorage.getItem(LS_EVENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    const from = keepFromS();
    // the world is finite and wraps (world.ts): whatever was stored is read back in canonical coordinates
    return Array.isArray(arr) ? arr.filter((e): e is PEvent => isEvent(e) && e.s >= from).map(wrapEvent) : [];
  } catch {
    return [];
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

let warnedQuota = false;

/**
 * What this tab last wrote: the stored events (sorted by assigned time, rounded as stored), each one's JSON, their
 * ids, and the token written with them. Valid while the stored token is still this one (nobody else has written).
 */
interface WriteCache {
  epochMs: number;
  token: string;
  list: PEvent[];
  json: string[];
  ids: Set<string>;
}
let cache: WriteCache | null = null;
/** The last token this tab wrote, and whether its last write merged events written by someone else. */
let lastToken: string | null = null;
let mergedForeign = false;
let tokenSeq = 0;

function readToken(): string | null {
  try {
    return localStorage.getItem(LS_EVENTS_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The stored log's writer token (null: none written yet, or older code wrote it). */
export function eventsToken(): string | null {
  return readToken();
}

/**
 * True when the stored log is exactly what this tab wrote last and that write had nothing in it from anyone else: a
 * poll has nothing new to read. (Once per foreign merge it says false, so the poll picks those events up.)
 */
export function eventsWrittenHere(): boolean {
  const t = readToken();
  if (t === null || t !== lastToken) return false;
  if (mergedForeign) {
    mergedForeign = false;
    return false;
  }
  return true;
}

/**
 * Merge `local` (events of epoch `epochMs`) into the stored log (by id), keep the latest MAX_EVENTS by assigned time.
 * Stored events of another epoch are dropped (loadEvents ignores them). If `epochMs` is no longer the current epoch,
 * nothing is written: the caller is in a world that has ended and must rejoin (useWorld's onCleared).
 * When the browser's storage quota is hit (a long run with many bots), the oldest events are dropped until it
 * fits, instead of failing silently: a failed write used to freeze the shared world for every other tab.
 * Returns false when nothing was written.
 */
export function saveMerged(local: Iterable<PEvent>, epochMs: number): boolean {
  let c: WriteCache;
  try {
    if (localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY) !== String(epochMs)) return false;
    // what is stored: what this tab wrote last (its token is still there), else read it all once
    if (cache && cache.epochMs === epochMs && readToken() === cache.token && localStorage.getItem(LS_EVENTS_EPOCH_KEY) === String(epochMs)) c = cache;
    else {
      const stored = loadEvents().sort((a, b) => a.s - b.s);
      c = { epochMs, token: "", list: stored, json: stored.map((e) => JSON.stringify(e)), ids: new Set(stored.map((e) => e.id)) };
      mergedForeign = stored.length > 0;
    }
    // the history window: forget the head
    const from = keepFromS();
    let k = 0;
    while (k < c.list.length && c.list[k].s < from) k++;
    if (k) {
      for (let i = 0; i < k; i++) c.ids.delete(c.list[i].id);
      c.list.splice(0, k);
      c.json.splice(0, k);
    }
    // the new events, in assigned-time order (mostly at the end: a binary search from the back)
    for (const e of local) {
      if (e.s < from || c.ids.has(e.id)) continue;
      const r: PEvent = { ...e, x: r2(e.x), z: r2(e.z), s: r2(e.s) };
      let lo = 0;
      let hi = c.list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c.list[mid].s <= r.s) lo = mid + 1;
        else hi = mid;
      }
      c.list.splice(lo, 0, r);
      c.json.splice(lo, 0, JSON.stringify(r));
      c.ids.add(r.id);
    }
    // keep the latest MAX_EVENTS by assigned time
    if (c.list.length > MAX_EVENTS) {
      const cut = c.list.length - MAX_EVENTS;
      for (let i = 0; i < cut; i++) c.ids.delete(c.list[i].id);
      c.list.splice(0, cut);
      c.json.splice(0, cut);
    }
  } catch {
    cache = null;
    return false;
  }
  const n = c.json.length;
  for (let keep = n; keep > 0; keep = Math.floor(keep * 0.75)) {
    try {
      const token = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.${tokenSeq++}`;
      localStorage.setItem(LS_EVENTS_KEY, "[" + (keep === n ? c.json : c.json.slice(-keep)).join(",") + "]");
      localStorage.setItem(LS_EVENTS_EPOCH_KEY, String(epochMs));
      localStorage.setItem(LS_EVENTS_TOKEN_KEY, token);
      if (keep < n) {
        const cut = n - keep;
        for (let i = 0; i < cut; i++) c.ids.delete(c.list[i].id);
        c.list.splice(0, cut);
        c.json.splice(0, cut);
        if (!warnedQuota) {
          warnedQuota = true;
          console.warn(`[parliament] storage quota: kept the latest ${keep} of ${n} events (older history dropped)`);
        }
      }
      c.token = token;
      cache = c;
      lastToken = token;
      return true;
    } catch {
      /* quota: try with fewer */
    }
  }
  cache = null;
  return false;
}

/** World-clock ms (worldClock.ts) at which the exhibition epoch began (created on first use). */
export function getEpochMs(): number {
  try {
    const raw = localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY);
    if (raw) return Number(raw);
    const now = worldNow();
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, String(now));
    return now;
  } catch {
    return worldNow();
  }
}

/** Empty the shared world and start a new epoch (the old stratum code shares the epoch key). */
export function clearWorld(): void {
  cache = null;
  lastToken = null;
  try {
    localStorage.removeItem(LS_EVENTS_TOKEN_KEY);
    localStorage.removeItem(LS_EVENTS_KEY);
    localStorage.removeItem(LS_KEEP_FROM_KEY);
    localStorage.removeItem(LS_EVENTS_EPOCH_KEY);
    localStorage.removeItem(LS_PARLIAMENT_EPOCH_KEY);
  } catch {
    /* ignore */
  }
}
