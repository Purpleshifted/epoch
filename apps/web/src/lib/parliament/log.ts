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

export function loadEvents(): PEvent[] {
  try {
    const raw = localStorage.getItem(LS_EVENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter(isEvent) : [];
  } catch {
    return [];
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Merge `local` into the stored log (by id), keep the latest MAX_EVENTS by assigned time. */
export function saveMerged(local: Iterable<PEvent>): void {
  try {
    const merged = new Map<string, PEvent>();
    for (const e of loadEvents()) merged.set(e.id, e);
    for (const e of local) merged.set(e.id, { ...e, x: r2(e.x), z: r2(e.z), s: r2(e.s) });
    const all = [...merged.values()].sort((a, b) => a.s - b.s);
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(all.slice(-MAX_EVENTS)));
  } catch {
    /* quota */
  }
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
    localStorage.removeItem(LS_PARLIAMENT_EPOCH_KEY);
  } catch {
    /* ignore */
  }
}
