/**
 * parliament/witness.ts — what the player view SAYS about the visitor's situation: a dry machine record of who is
 * near, what they and the visitor are doing, and what the ground underfoot is.
 *
 * On purpose it only states facts (distances, durations, states) and never their consequence: that the visitor's
 * staying with others is pouring concrete, or that their walking is wearing a path, is only seen in the global
 * view. Here it is meant not to land; there it lands (docs/direction-2026-10-10.md §1).
 *
 *   observe()      one reading from the event log and the fold snapshot (pure)
 *   WitnessLog     turns the readings into log lines: someone came near / left (with how long they were near),
 *                  the visitor or someone near started / stopped moving, the surface changed. Every change has to
 *                  hold for `settleSec` before it is written, so a tap on a key does not make a line.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { ROLE_TAG, fmtClock } from "./session";
import type { PEvent, RoleId, Snapshot } from "./types";
import { wrapDelta, wrapDist } from "./world";

export type Surface = "open" | "trodden" | "sealed";

export interface Other {
  o: string;
  r: RoleId;
  /** World distance. */
  dist: number;
  /** 8-point compass bearing from the visitor (+z = N, +x = E). */
  bearing: string;
  moving: boolean;
}

export interface Observation {
  /** Seconds since the session's role was fixed. */
  t: number;
  moving: boolean;
  /** World units per second. */
  speed: number;
  surface: Surface;
  /** Everyone whose latest sample is within `watchRadius`, nearest first. */
  others: Other[];
}

export interface WitnessConfig {
  /** Who counts as NEAR (world): the fold's presence ball, so "near" means exactly what the building rule counts. */
  nearRadius: number;
  /** Someone near is only "gone" once they are this many times nearRadius away (no flicker at the edge). */
  leaveFactor: number;
  /** A sample older than this (s, assigned time) is no longer someone's position. */
  recentSec: number;
  /** World units per second above which someone is moving. */
  moveSpeed: number;
  /** Path formation (0..1) from which the ground counts as trodden. */
  trodden: number;
  /** Slab height (units) from which the ground counts as sealed. */
  sealedH: number;
  /** A change must hold this long (s) before it is written. */
  settleSec: number;
  /** Lines kept. */
  keep: number;
}

export const DEFAULT_WITNESS: WitnessConfig = {
  nearRadius: 3,
  leaveFactor: 1.3,
  recentSec: 4,
  moveSpeed: 0.4,
  trodden: 0.3,
  sealedH: 0.15,
  settleSec: 1.5,
  keep: 6,
};

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function bearingOf(dx: number, dz: number): string {
  const a = Math.atan2(dx, dz); // 0 = +z
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** "bot3" → "WORKER #03", "v_ab12c" → "CAR AB12C". */
export function nameOf(o: string, r: RoleId): string {
  const tag = ROLE_TAG[r] ?? r.toUpperCase();
  if (o.startsWith("bot")) return `${tag} #${o.slice(3).padStart(2, "0")}`;
  return `${tag} ${o.replace(/^v_/, "").toUpperCase()}`;
}

export interface ObserveInputs {
  me: { id: string; x: number; z: number; vx: number; vz: number };
  events: readonly PEvent[];
  /** The visitor's assigned time. */
  sNow: number;
  snap: Snapshot | null;
  /** Session seconds (written into the observation). */
  t: number;
  cfg?: WitnessConfig;
}

export function observe(inp: ObserveInputs): Observation {
  const cfg = inp.cfg ?? DEFAULT_WITNESS;
  const { me, events, sNow, snap } = inp;
  const watch = cfg.nearRadius * cfg.leaveFactor;
  // the two latest samples of everyone else (not from the future, not too old)
  const last = new Map<string, PEvent>();
  const prev = new Map<string, PEvent>();
  for (const e of events) {
    if (e.k !== "p" || e.o === me.id || e.s > sNow || e.s < sNow - cfg.recentSec) continue;
    const l = last.get(e.o);
    if (!l || e.s > l.s) {
      if (l) prev.set(e.o, l);
      last.set(e.o, e);
    } else {
      const p = prev.get(e.o);
      if (e.s < l.s && (!p || e.s > p.s)) prev.set(e.o, e);
    }
  }
  const others: Other[] = [];
  for (const e of last.values()) {
    const dx = wrapDelta(e.x - me.x), dz = wrapDelta(e.z - me.z);
    const dist = Math.hypot(dx, dz);
    if (dist > watch) continue;
    const p = prev.get(e.o);
    const ds = p ? e.s - p.s : 0;
    const v = p && ds > 0 ? wrapDist(e.x, e.z, p.x, p.z) / ds : 0;
    others.push({ o: e.o, r: e.r, dist, bearing: bearingOf(dx, dz), moving: v > cfg.moveSpeed });
  }
  others.sort((a, b) => a.dist - b.dist || (a.o < b.o ? -1 : 1));

  const key = `${Math.floor(me.x / CELL_SIZE)},${Math.floor(me.z / CELL_SIZE)}`;
  let surface: Surface = "open";
  if (snap) {
    if (snap.slabs.some((s) => s.key === key && s.h >= cfg.sealedH)) surface = "sealed";
    else if (snap.paths.some((p) => p.key === key && p.p >= cfg.trodden)) surface = "trodden";
  }
  const speed = Math.hypot(me.vx, me.vz);
  return { t: inp.t, moving: speed > cfg.moveSpeed, speed, surface, others };
}

/** A state that is only taken over once a new value has held for `settleSec`. */
class Settled<T> {
  value: T;
  /** When `value` was taken over. */
  since: number;
  private cand: T;
  private candSince: number;
  constructor(v: T, t: number) {
    this.value = v;
    this.cand = v;
    this.since = t;
    this.candSince = t;
  }
  /** Feed a reading; true when the value changed now. */
  feed(v: T, t: number, settleSec: number): boolean {
    if (v === this.value) {
      this.cand = v;
      return false;
    }
    if (v !== this.cand) {
      this.cand = v;
      this.candSince = t;
    }
    if (t - this.candSince >= settleSec) {
      this.value = v;
      this.since = this.candSince;
      return true;
    }
    return false;
  }
}

interface NearState {
  r: RoleId;
  since: number;
  moving: Settled<boolean>;
  lastDist: number;
  lastBearing: string;
}

const SURFACE_WORD: Record<Surface, string> = { open: "OPEN GROUND", trodden: "TRODDEN GROUND", sealed: "SEALED GROUND" };

export class WitnessLog {
  readonly cfg: WitnessConfig;
  lines: string[] = [];
  private moving: Settled<boolean> | null = null;
  private surface: Settled<Surface> | null = null;
  private near = new Map<string, NearState>();
  private last: Observation | null = null;
  /** Totals over the session (for the end screen). */
  private totals = { stillSec: 0, nearSec: 0, met: new Set<string>(), metByRole: new Map<RoleId, number>() };

  constructor(cfg: WitnessConfig = DEFAULT_WITNESS) {
    this.cfg = cfg;
  }

  private write(t: number, text: string) {
    this.lines.push(`T+${fmtClock(t)}  ${text}`);
    if (this.lines.length > this.cfg.keep) this.lines.splice(0, this.lines.length - this.cfg.keep);
  }

  /** Feed one observation; returns the lines written by it. */
  push(obs: Observation): string[] {
    const written: string[] = [];
    const w = (text: string) => {
      this.write(obs.t, text);
      written.push(this.lines[this.lines.length - 1]);
    };
    const { settleSec, nearRadius } = this.cfg;

    if (this.last && this.moving) {
      const dt = Math.max(0, obs.t - this.last.t);
      if (!this.moving.value) this.totals.stillSec += dt;
      if (this.near.size > 0) this.totals.nearSec += dt;
    }

    if (!this.moving || !this.surface) {
      this.moving = new Settled(obs.moving, obs.t);
      this.surface = new Settled(obs.surface, obs.t);
      w(`YOU  ${obs.moving ? "MOVING" : "STATIONARY"} · ${SURFACE_WORD[obs.surface]}`);
    } else {
      if (this.moving.feed(obs.moving, obs.t, settleSec)) w(`YOU  ${obs.moving ? "MOVING" : "STATIONARY"}`);
      if (this.surface.feed(obs.surface, obs.t, settleSec)) w(`SURFACE  ${SURFACE_WORD[obs.surface]}`);
    }

    // who came near / left
    const seen = new Set<string>();
    for (const o of obs.others) {
      seen.add(o.o);
      const st = this.near.get(o.o);
      if (!st) {
        if (o.dist <= nearRadius) {
          if (!this.totals.met.has(o.o)) this.totals.metByRole.set(o.r, (this.totals.metByRole.get(o.r) ?? 0) + 1);
          this.totals.met.add(o.o);
          this.near.set(o.o, { r: o.r, since: obs.t, moving: new Settled(o.moving, obs.t), lastDist: o.dist, lastBearing: o.bearing });
          w(`${nameOf(o.o, o.r)}  NEAR · ${o.dist.toFixed(1)} M ${o.bearing} · ${o.moving ? "MOVING" : "STATIONARY"}`);
        }
        continue;
      }
      st.lastDist = o.dist;
      st.lastBearing = o.bearing;
      if (st.moving.feed(o.moving, obs.t, settleSec)) w(`${nameOf(o.o, st.r)}  ${o.moving ? "MOVING" : "STATIONARY"} · ${o.dist.toFixed(1)} M ${o.bearing}`);
    }
    for (const [o, st] of this.near) {
      if (seen.has(o)) continue;
      this.near.delete(o);
      w(`${nameOf(o, st.r)}  GONE · NEAR FOR ${fmtClock(obs.t - st.since)}`);
    }
    this.last = obs;
    return written;
  }

  /** The visitor's state now, in one line. */
  status(): string {
    if (!this.last || !this.moving || !this.surface) return "";
    const o = this.last;
    const mv = `${this.moving.value ? "MOVING" : "STATIONARY"} ${fmtClock(o.t - this.moving.since)}`;
    return `YOU  ${mv} · ${SURFACE_WORD[this.surface.value]} · NEAR ${this.near.size}`;
  }

  /**
   * Totals so far: seconds stationary, seconds with someone near, how many others came near (and by their role), and
   * the ground underfoot now — what the end screen and the cause of death (intake.ts) are made from.
   */
  summary(): { stillSec: number; nearSec: number; met: number; metByRole: Partial<Record<RoleId, number>>; surface: Surface } {
    const metByRole: Partial<Record<RoleId, number>> = {};
    for (const [r, n] of this.totals.metByRole) metByRole[r] = n;
    return { stillSec: this.totals.stillSec, nearSec: this.totals.nearSec, met: this.totals.met.size, metByRole, surface: this.surface?.value ?? "open" };
  }

  /** The others near now, one short entry each, nearest first. */
  nearNow(): string[] {
    const out: string[] = [];
    const list = [...this.near.entries()].sort((a, b) => a[1].lastDist - b[1].lastDist);
    for (const [o, st] of list) {
      out.push(`${nameOf(o, st.r)} ${st.lastDist.toFixed(1)} M ${st.lastBearing} · ${st.moving.value ? "MOVING" : "STATIONARY"} · ${fmtClock((this.last?.t ?? 0) - st.since)}`);
    }
    return out;
  }
}
