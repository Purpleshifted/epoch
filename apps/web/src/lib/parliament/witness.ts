/**
 * parliament/witness.ts — what the player view SAYS about the visitor's situation: a machine record of who is near,
 * what they and the visitor are doing, what the ground underfoot is — and, since 2026-10-20, what the visitor's life
 * is doing to the ground (the ledger's lines, ledger.ts: pressed grass, worn ground, paths, concrete shares).
 *
 * The record is STRUCTURED: every line is a LogEntry { t, key, args, level }, worded by the apparatus in the chosen
 * language (script.ts LOG · formatEntry — English upper case, or Korean). The level says how much it matters on the
 * screen: 0 a fact (grey), 1 notable (white), 2 important (yellow). Until 2026-10-20 the record stated facts only and
 * never their consequence (docs/direction-2026-10-10.md §1); the artist withdrew that rule for the personal view.
 *
 *   observe()      one reading from the event log and the fold snapshot (pure)
 *   WitnessLog     turns the readings into entries: someone came near / left (with how long they were near), the
 *                  visitor or someone near started / stopped moving, the surface changed. Every change has to hold
 *                  for `settleSec` before it is written, so a tap on a key does not make a line. `note()` takes the
 *                  ledger's entries into the same record.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { ROLE_TAG } from "./session";
import type { PEvent, RoleId, Snapshot } from "./types";
import { wrapDelta, wrapDist } from "./world";

export type Surface = "open" | "trodden" | "sealed";

/** Someone in the record: their id and role (named by script.ts nameIn / nameOf). */
export interface Who {
  o: string;
  r: RoleId;
}

export type LogKey =
  | "you.state"
  | "you.moving"
  | "surface"
  | "near"
  | "other.moving"
  | "gone"
  | "attempt.tried"
  | "attempt.failed"
  | "grass.pressed"
  | "grass.recovered"
  | "ground.worn"
  | "ground.prePath"
  | "path.formed"
  | "concrete.share"
  | "sealed.under"
  | "alone.long";

/** 0 a fact · 1 notable · 2 important (how the HUD colours the line). */
export type LogLevel = 0 | 1 | 2;

export interface LogArgs {
  who?: Who;
  moving?: boolean;
  surface?: Surface;
  dist?: number;
  bearing?: string;
  forSec?: number;
  near?: number;
  n?: number;
  pct?: number;
  sec?: number;
  with?: Who[];
  /** Session seconds something was born (concrete). */
  at?: number;
}

export interface LogEntry {
  /** Session seconds. */
  t: number;
  key: LogKey;
  args: LogArgs;
  level: LogLevel;
}

/** The visitor's state now (the status line). */
export interface StatusArgs {
  moving: boolean;
  forSec: number;
  surface: Surface;
  near: number;
}

/** One of the others near now (the near list). */
export interface NearItemArgs {
  who: Who;
  dist: number;
  bearing: string;
  moving: boolean;
  forSec: number;
}

export interface Other {
  o: string;
  r: RoleId;
  /** World distance. */
  dist: number;
  /** 8-point compass bearing from the visitor (+z = N, +x = E). */
  bearing: string;
  moving: boolean;
  /** How old their latest sample is (s). */
  ageSec: number;
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
  /** Everyone within `farRadius` (the view), nearest first — for the markers on the ground (stakes). */
  far: Other[];
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
  /** World radius of `far` (the player's view). */
  farRadius: number;
}

export const DEFAULT_WITNESS: WitnessConfig = {
  nearRadius: 3,
  leaveFactor: 1.3,
  recentSec: 4,
  moveSpeed: 0.4,
  trodden: 0.3,
  sealedH: 0.15,
  settleSec: 1.5,
  keep: 5,
  farRadius: 24,
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
  const far: Other[] = [];
  const byDist = (a: Other, b: Other) => a.dist - b.dist || (a.o < b.o ? -1 : 1);
  for (const e of last.values()) {
    const dx = wrapDelta(e.x - me.x), dz = wrapDelta(e.z - me.z);
    const dist = Math.hypot(dx, dz);
    if (dist > cfg.farRadius) continue;
    const p = prev.get(e.o);
    const ds = p ? e.s - p.s : 0;
    const v = p && ds > 0 ? wrapDist(e.x, e.z, p.x, p.z) / ds : 0;
    const o: Other = { o: e.o, r: e.r, dist, bearing: bearingOf(dx, dz), moving: v > cfg.moveSpeed, ageSec: Math.max(0, sNow - e.s) };
    far.push(o);
    if (dist <= watch) others.push(o);
  }
  others.sort(byDist);
  far.sort(byDist);

  const key = `${Math.floor(me.x / CELL_SIZE)},${Math.floor(me.z / CELL_SIZE)}`;
  let surface: Surface = "open";
  if (snap) {
    if (snap.slabs.some((s) => s.key === key && s.h >= cfg.sealedH)) surface = "sealed";
    else if (snap.paths.some((p) => p.key === key && p.p >= cfg.trodden)) surface = "trodden";
  }
  const speed = Math.hypot(me.vx, me.vz);
  return { t: inp.t, moving: speed > cfg.moveSpeed, speed, surface, others, far };
}

/** A state that is only taken over once a new value has held for `settleSec`. */
export class Settled<T> {
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

export class WitnessLog {
  readonly cfg: WitnessConfig;
  /** The record, oldest first (at most `keep`). */
  entries: LogEntry[] = [];
  private moving: Settled<boolean> | null = null;
  private surface: Settled<Surface> | null = null;
  private near = new Map<string, NearState>();
  private last: Observation | null = null;
  /** Roles seen for ids (to name whom I built with); unknown ids are workers (the bots mostly are). */
  private roles = new Map<string, RoleId>();
  /** Totals over the session (for the end screen). */
  private totals = { stillSec: 0, nearSec: 0, met: new Set<string>(), metByRole: new Map<RoleId, number>(), attempts: 0 };

  constructor(cfg: WitnessConfig = DEFAULT_WITNESS) {
    this.cfg = cfg;
  }

  private write(t: number, key: LogKey, args: LogArgs, level: LogLevel): LogEntry {
    const e: LogEntry = { t, key, args, level };
    this.entries.push(e);
    if (this.entries.length > this.cfg.keep) this.entries.splice(0, this.entries.length - this.cfg.keep);
    return e;
  }

  /** The ledger's line (ledger.ts), into the same record. */
  note(e: LogEntry): void {
    this.write(e.t, e.key, e.args, e.level);
  }

  /** The role last seen for an id (the bots' ids carry their role in every sample); a worker when unknown. */
  roleOf = (o: string): RoleId => this.roles.get(o) ?? "worker";

  /**
   * The visitor tried to stop living and it failed (a success ends the session instead): two flat lines, one more
   * try; `near` = how many others were around then (company makes it less likely — the record only states the number).
   */
  attempt(t: number, near = 0): LogEntry[] {
    this.totals.attempts += 1;
    return [this.write(t, "attempt.tried", { near }, 1), this.write(t, "attempt.failed", {}, 1)];
  }

  /** Feed one observation; returns the entries written by it. */
  push(obs: Observation): LogEntry[] {
    const written: LogEntry[] = [];
    const w = (key: LogKey, args: LogArgs, level: LogLevel = 0) => written.push(this.write(obs.t, key, args, level));
    const { settleSec, nearRadius } = this.cfg;

    if (this.last && this.moving) {
      const dt = Math.max(0, obs.t - this.last.t);
      if (!this.moving.value) this.totals.stillSec += dt;
      if (this.near.size > 0) this.totals.nearSec += dt;
    }

    if (!this.moving || !this.surface) {
      this.moving = new Settled(obs.moving, obs.t);
      this.surface = new Settled(obs.surface, obs.t);
      w("you.state", { moving: obs.moving, surface: obs.surface });
    } else {
      if (this.moving.feed(obs.moving, obs.t, settleSec)) w("you.moving", { moving: obs.moving });
      if (this.surface.feed(obs.surface, obs.t, settleSec)) w("surface", { surface: obs.surface });
    }

    // who came near / left
    const seen = new Set<string>();
    for (const o of obs.far) this.roles.set(o.o, o.r);
    for (const o of obs.others) {
      seen.add(o.o);
      const st = this.near.get(o.o);
      if (!st) {
        if (o.dist <= nearRadius) {
          if (!this.totals.met.has(o.o)) this.totals.metByRole.set(o.r, (this.totals.metByRole.get(o.r) ?? 0) + 1);
          this.totals.met.add(o.o);
          this.near.set(o.o, { r: o.r, since: obs.t, moving: new Settled(o.moving, obs.t), lastDist: o.dist, lastBearing: o.bearing });
          w("near", { who: { o: o.o, r: o.r }, dist: o.dist, bearing: o.bearing, moving: o.moving });
        }
        continue;
      }
      st.lastDist = o.dist;
      st.lastBearing = o.bearing;
      if (st.moving.feed(o.moving, obs.t, settleSec)) w("other.moving", { who: { o: o.o, r: st.r }, moving: o.moving, dist: o.dist, bearing: o.bearing });
    }
    for (const [o, st] of this.near) {
      if (seen.has(o)) continue;
      this.near.delete(o);
      w("gone", { who: { o, r: st.r }, forSec: obs.t - st.since });
    }
    this.last = obs;
    return written;
  }

  /** The visitor's state now (null before the first reading). */
  status(): StatusArgs | null {
    if (!this.last || !this.moving || !this.surface) return null;
    return { moving: this.moving.value, forSec: this.last.t - this.moving.since, surface: this.surface.value, near: this.near.size };
  }

  /**
   * Totals so far: seconds stationary, seconds with someone near, how many others came near (and by their role), and
   * the ground underfoot now — what the end screen and the cause of death (intake.ts) are made from.
   */
  summary(): { stillSec: number; nearSec: number; met: number; metByRole: Partial<Record<RoleId, number>>; surface: Surface; attempts: number } {
    const metByRole: Partial<Record<RoleId, number>> = {};
    for (const [r, n] of this.totals.metByRole) metByRole[r] = n;
    return {
      stillSec: this.totals.stillSec,
      nearSec: this.totals.nearSec,
      met: this.totals.met.size,
      metByRole,
      surface: this.surface?.value ?? "open",
      attempts: this.totals.attempts,
    };
  }

  /** The others near now, nearest first. */
  nearNow(): NearItemArgs[] {
    const out: NearItemArgs[] = [];
    const list = [...this.near.entries()].sort((a, b) => a[1].lastDist - b[1].lastDist);
    for (const [o, st] of list) out.push({ who: { o, r: st.r }, dist: st.lastDist, bearing: st.lastBearing, moving: st.moving.value, forSec: (this.last?.t ?? 0) - st.since });
    return out;
  }
}
