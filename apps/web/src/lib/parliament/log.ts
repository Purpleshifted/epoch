/**
 * parliament/log.ts
 *
 * The append-only event log and its localStorage mirror (stand-in for the shared server:
 * the same interface — add / addMany / all — is what a socket channel would feed).
 */

import type { PEvent, RoleId } from "./types";
import { ROLES } from "./types";

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
export const MAX_EVENTS = 30000;

export class EventLog {
  private m = new Map<string, PEvent>();
  private cache: PEvent[] | null = null;
  /** Bumps on every change. */
  version = 0;

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

  clear(): void {
    this.m.clear();
    this.cache = null;
    this.version++;
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
    (o.k === "p" || o.k === "f") &&
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

/** The stored events of the CURRENT epoch ([] if the stored events belong to another one, or to none). */
export function loadEvents(): PEvent[] {
  try {
    const epoch = localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY);
    if (epoch === null || localStorage.getItem(LS_EVENTS_EPOCH_KEY) !== epoch) return [];
    const raw = localStorage.getItem(LS_EVENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter(isEvent) : [];
  } catch {
    return [];
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

let warnedQuota = false;

/**
 * Merge `local` (events of epoch `epochMs`) into the stored log (by id), keep the latest MAX_EVENTS by assigned time.
 * Stored events of another epoch are dropped (loadEvents ignores them). If `epochMs` is no longer the current epoch,
 * nothing is written: the caller is in a world that has ended and must rejoin (useWorld's onCleared).
 * When the browser's storage quota is hit (a long run with many bots), the oldest events are dropped until it
 * fits, instead of failing silently: a failed write used to freeze the shared world for every other tab.
 * Returns false when nothing was written.
 */
export function saveMerged(local: Iterable<PEvent>, epochMs: number): boolean {
  let all: PEvent[];
  try {
    if (localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY) !== String(epochMs)) return false;
    const merged = new Map<string, PEvent>();
    for (const e of loadEvents()) merged.set(e.id, e);
    for (const e of local) merged.set(e.id, { ...e, x: r2(e.x), z: r2(e.z), s: r2(e.s) });
    all = [...merged.values()].sort((a, b) => a.s - b.s).slice(-MAX_EVENTS);
  } catch {
    return false;
  }
  for (let keep = all.length; keep > 0; keep = Math.floor(keep * 0.75)) {
    try {
      localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(keep === all.length ? all : all.slice(-keep)));
      localStorage.setItem(LS_EVENTS_EPOCH_KEY, String(epochMs));
      if (keep < all.length && !warnedQuota) {
        warnedQuota = true;
        console.warn(`[parliament] storage quota: kept the latest ${keep} of ${all.length} events (older history dropped)`);
      }
      return true;
    } catch {
      /* quota: try with fewer */
    }
  }
  return false;
}

/** Wall-clock ms at which the exhibition epoch began (created on first use). */
export function getEpochMs(): number {
  try {
    const raw = localStorage.getItem(LS_PARLIAMENT_EPOCH_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

/** Empty the shared world and start a new epoch (the old stratum code shares the epoch key). */
export function clearWorld(): void {
  try {
    localStorage.removeItem(LS_EVENTS_KEY);
    localStorage.removeItem(LS_EVENTS_EPOCH_KEY);
    localStorage.removeItem(LS_PARLIAMENT_EPOCH_KEY);
  } catch {
    /* ignore */
  }
}
