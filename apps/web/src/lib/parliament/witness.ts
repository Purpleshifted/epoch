/**
 * parliament/witness.ts — what the player view SAYS about the visitor's situation: a machine record of who is near,
 * what they and the visitor are doing, what the ground underfoot is — and, since 2026-10-20, what the visitor's life
 * is doing to the ground (the ledger's lines, ledger.ts: pressed grass, worn ground, paths, concrete shares).
 *
 * The record is STRUCTURED: every line is a LogEntry { t, key, args, level }, worded in the chosen language (script.ts
 * LOG · formatEntry, plain words about what is happening now). The level says how much it matters on the
 * screen: 0 a fact (grey), 1 notable (white), 2 important (yellow). Until 2026-10-20 the record stated facts only and
 * never their consequence (docs/direction-2026-10-10.md §1); the artist withdrew that rule for the personal view.
 *
 *   observe()      one reading from the event log and the fold snapshot (pure)
 *   WitnessLog     turns the readings into entries: someone came near / left (with how long they were near), the
 *                  visitor started / stopped moving, the surface changed, a long contact gave a new word, an ended
 *                  word left by an answer was found. Every change has to hold for `settleSec` before it is written, so a tap on a
 *                  key does not make a line. `note()` takes the ledger's entries into the same record.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { glyphOf, newWordOf, type GlyphDot } from "./glyph";
import type { WordSpot } from "./dandelion";
import type { PEvent, RoleId, Snapshot } from "./types";
import { wrapDelta, wrapDist } from "./world";

export type Surface = "open" | "trodden" | "sealed";

/** Someone in the record: their id and role (named by script.ts nameIn). */
export interface Who {
  o: string;
  r: RoleId;
}

export type LogKey =
  | "you.state"
  | "you.moving"
  | "surface"
  | "near"
  | "gone"
  | "word.new"
  | "word.asked"
  | "place.nth"
  | "word.answered"
  | "word.found"
  | "ensemble.start"
  | "ensemble.end"
  | "dying"
  | "dying.watched"
  | "attempt.tried"
  | "attempt.failed"
  | "grass.pressed"
  | "grass.recovered"
  | "ground.worn"
  | "ground.prePath"
  | "path.formed"
  | "concrete.share"
  | "concrete.passed"
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
  /** How many a house takes (the wall's rule). */
  need?: number;
  pct?: number;
  sec?: number;
  with?: Who[];
  /** Session seconds something was born (concrete). */
  at?: number;
  /** The melody this line writes down (glyph.ts), drawn beside the words. */
  dots?: GlyphDot[];
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
  /** Staying with someone else who stays: building together (the record calls it an ensemble). */
  together: boolean;
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
  /** Where their latest sample is (canonical world coordinates). */
  x: number;
  z: number;
  /** World distance. */
  dist: number;
  /** 8-point compass bearing from the visitor (+z = N, +x = E). */
  bearing: string;
  moving: boolean;
  /** How old their latest sample is (s). */
  ageSec: number;
}

export interface Observation {
  /** The visitor's own id. */
  me: string;
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
  /** Whose word (dandelion.ts wordSpots) is within `wordRadius` now. */
  wordsNear: string[];
  /** How many a house takes (absent: the record's own `buildNeeds`). */
  buildNeeds?: number;
  /** Standing still: who has stayed where I stand, as far as the record goes back. */
  place?: PlaceHere;
}

/** Where I stand as a place: I am the `n`-th to stay in it; `before` came just before me (null: nobody has). */
export interface PlaceHere {
  x: number;
  z: number;
  n: number;
  before: string | null;
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
  /** Near someone for this long (s) = group life with them (the end screen's count). */
  groupSec: number;
  /** Near someone for this long (s) = a new word from the contact (once per other). */
  wordAfterSec: number;
  /** A left word this close (world) is found. */
  wordRadius: number;
  /** At most one word line every this many seconds. */
  wordGapSec: number;
  /** Staying with someone else who stays for this long (s) = an ensemble. */
  ensembleSec: number;
  /** How many different people a house takes (the fold's minVisitors). */
  buildNeeds: number;
  /** While someone stays near, they ask something every this many seconds… */
  askEverySec: number;
  /** … and the question stays open for an answer this long. */
  askOpenSec: number;
  /** Someone has stayed in a place if this many of their samples lie in it (the fold's presence ball around me). */
  placeSamples: number;
  /** Who stayed here is said after standing still this long … */
  placeAfterSec: number;
  /** … not more often than this … */
  placeGapSec: number;
  /** … and once per place: a place is told again only this many near radii away. */
  placeApart: number;
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
  groupSec: 5,
  wordAfterSec: 6,
  wordRadius: 3,
  wordGapSec: 12,
  ensembleSec: 3,
  buildNeeds: 3,
  askEverySec: 16,
  askOpenSec: 7,
  placeSamples: 5,
  placeAfterSec: 4,
  placeGapSec: 15,
  placeApart: 2,
};

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function bearingOf(dx: number, dz: number): string {
  const a = Math.atan2(dx, dz); // 0 = +z
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** Where something lies for someone looking along their heading. */
export type Side = "front" | "frontRight" | "right" | "backRight" | "back" | "backLeft" | "left" | "frontLeft";
const SIDES: Side[] = ["front", "frontRight", "right", "backRight", "back", "backLeft", "left", "frontLeft"];

/** `yaw`: the player's heading (forward = (sin, cos), right = (−cos, sin); ParliamentScene). */
export function sideOf(dx: number, dz: number, yaw: number): Side {
  const fwd = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const rgt = -dx * Math.cos(yaw) + dz * Math.sin(yaw);
  return SIDES[((Math.round(Math.atan2(rgt, fwd) / (Math.PI / 4)) % 8) + 8) % 8];
}

export interface Gathering {
  /** How many stand together, and where they are from here. */
  n: number;
  side: Side;
}

/** The most people standing together within sight, the nearest such group if several: where to go, for someone alone. */
export function gatheringIn(far: readonly Other[], me: { x: number; z: number }, yaw: number, radius: number): Gathering | null {
  let best: Other | null = null;
  let most = 0;
  for (const a of far) {
    let n = 0;
    for (const b of far) if (wrapDist(a.x, a.z, b.x, b.z) <= radius) n++;
    if (n > most) {
      most = n;
      best = a;
    }
  }
  return best && { n: most, side: sideOf(wrapDelta(best.x - me.x), wrapDelta(best.z - me.z), yaw) };
}

export interface ObserveInputs {
  me: { id: string; x: number; z: number; vx: number; vz: number };
  events: readonly PEvent[];
  /** The visitor's assigned time. */
  sNow: number;
  snap: Snapshot | null;
  /** Session seconds (written into the observation). */
  t: number;
  /** Where others' words can be found (dandelion.ts wordSpots). */
  words?: readonly WordSpot[];
  /** Who is here now, whatever their assigned time (aliveOwners); absent = the last recentSec of mine. */
  alive?: ReadonlySet<string>;
  cfg?: WitnessConfig;
}

/**
 * Who is HERE now: everyone whose newest sample is still advancing, and whose assigned time is within `slotSec` of mine
 * (the artist, 2026-11-01). Every visitor lives in a time slot of their own, up to the assignment window apart, so "the
 * last few seconds of my time" left most people invisible for a whole life (19 resident bots: 0.56 on average, none for
 * 76 % of visitors). `seen` is kept by the caller: each owner's newest sample and the wall ms it advanced; owners already
 * in the log at the first look count as silent until they send a new one (a life that is over stays over).
 */
export function aliveOwners(events: readonly PEvent[], meId: string, seen: Map<string, { s: number; at: number }>, nowMs: number, holdMs: number, sNow: number, slotSec: number): Set<string> {
  const first = seen.size === 0;
  const latest = new Map<string, number>();
  for (const e of events) {
    if (e.k !== "p" || e.o === meId) continue;
    const l = latest.get(e.o);
    if (l === undefined || e.s > l) latest.set(e.o, e.s);
  }
  const alive = new Set<string>();
  for (const [o, s] of latest) {
    const prev = seen.get(o);
    const cur = !prev || s > prev.s ? { s, at: first && !prev ? -Infinity : nowMs } : prev;
    seen.set(o, cur);
    if (nowMs - cur.at <= holdMs && Math.abs(s - sNow) <= slotSec) alive.add(o);
  }
  return alive;
}

export function observe(inp: ObserveInputs): Observation {
  const cfg = inp.cfg ?? DEFAULT_WITNESS;
  const { me, events, sNow, snap, alive } = inp;
  const watch = cfg.nearRadius * cfg.leaveFactor;
  // the two latest samples of everyone here (alive), or else of everyone not from the future and not too old
  const last = new Map<string, PEvent>();
  const prev = new Map<string, PEvent>();
  for (const e of events) {
    if (e.k !== "p" || e.o === me.id) continue;
    if (alive ? !alive.has(e.o) : e.s > sNow || e.s < sNow - cfg.recentSec) continue;
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
    const o: Other = { o: e.o, r: e.r, x: e.x, z: e.z, dist, bearing: bearingOf(dx, dz), moving: v > cfg.moveSpeed, ageSec: alive ? 0 : Math.max(0, sNow - e.s) };
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
  const wordsNear = (inp.words ?? []).filter((w) => wrapDist(w.x, w.z, me.x, me.z) <= cfg.wordRadius).map((w) => w.o);
  const moving = speed > cfg.moveSpeed;
  return { me: me.id, t: inp.t, moving, speed, surface, others, far, wordsNear, buildNeeds: cfg.buildNeeds, place: moving ? undefined : placeHere(events, me, cfg) };
}

/** Who has stayed around (me.x, me.z), in the order they came (the artist, 2026-11-09: habitat is a place, not a space). */
function placeHere(events: readonly PEvent[], me: { id: string; x: number; z: number }, cfg: WitnessConfig): PlaceHere {
  const stayed = new Map<string, { n: number; first: number }>();
  for (const e of events) {
    if (e.k !== "p" || e.r !== "worker" || e.o === me.id || wrapDist(e.x, e.z, me.x, me.z) > cfg.nearRadius) continue;
    const c = stayed.get(e.o);
    if (!c) stayed.set(e.o, { n: 1, first: e.s });
    else {
      c.n++;
      if (e.s < c.first) c.first = e.s;
    }
  }
  let n = 1;
  let before: string | null = null;
  let last = -Infinity;
  for (const [o, c] of stayed) {
    if (c.n < cfg.placeSamples) continue;
    n++;
    if (c.first > last) {
      last = c.first;
      before = o;
    }
  }
  return { x: me.x, z: me.z, n, before };
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
  /** When they last dropped out of the watch (null: in it). They are only gone once that has held for settleSec. */
  missing: number | null;
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
  private totals = { stillSec: 0, nearSec: 0, met: new Set<string>(), metByRole: new Map<RoleId, number>(), attempts: 0, group: new Set<string>(), newWords: [] as GlyphDot[][], found: [] as string[], ensembleSec: 0, asked: 0 };
  /** What someone has asked and not yet had an answer to. */
  private question: { who: Who; t: number } | null = null;
  private ensemble: Settled<boolean> | null = null;
  /** How many are gathered, settled, and the most this ensemble has said so far. */
  private gathered: Settled<number> | null = null;
  private toldGathered = 0;
  private isDying = false;
  private watched = false;
  private worded = new Set<string>();
  private lastWordT = -Infinity;
  /** Since when I have been standing still (null: walking), and the places already told. */
  private stillSince: number | null = null;
  private toldPlaces: { x: number; z: number }[] = [];
  private lastPlaceT = -Infinity;

  constructor(cfg: WitnessConfig = DEFAULT_WITNESS) {
    this.cfg = cfg;
  }

  private write(t: number, key: LogKey, args: LogArgs, level: LogLevel): LogEntry {
    const e: LogEntry = { t, key, args, level };
    this.entries.push(e);
    if (this.entries.length > this.cfg.keep) this.entries.splice(0, this.entries.length - this.cfg.keep);
    return e;
  }

  private ask(t: number, who: Who): void {
    this.question = { who, t };
    this.totals.asked++;
  }

  /** Someone's question is open now. */
  asking(): boolean {
    return this.question !== null;
  }

  /** Whose question it is. */
  asker(): string | null {
    return this.question?.who.o ?? null;
  }

  /**
   * The visitor answers (SPACE, or the phone's button): one line with what came of it, a new word that goes on the
   * end screen's card. Display only: nothing here touches the sound or the ground. Null when nobody asked.
   */
  answer(t: number, me: string): LogEntry | null {
    if (!this.question) return null;
    const dots = newWordOf(me, this.question.who.o, Math.floor(t));
    const who = this.question.who;
    this.question = null;
    this.totals.newWords.push(dots);
    return this.write(t, "word.answered", { who, dots }, 1);
  }

  /** The end has begun to make itself felt (session.ts warn): one line. */
  dying(t: number): void {
    if (this.isDying) return;
    this.isDying = true;
    this.write(t, "dying", {}, 2);
  }

  /** Close to the end: whoever is near then (longest first) keeps watch, one line, once. */
  keptWatch(t: number): void {
    if (this.watched) return;
    let longest: { o: string; r: RoleId; since: number } | null = null;
    for (const [o, st] of this.near) if (st.missing === null && (!longest || st.since < longest.since)) longest = { o, r: st.r, since: st.since };
    if (!longest) return;
    this.watched = true;
    this.write(t, "dying.watched", { who: { o: longest.o, r: longest.r }, dots: glyphOf(longest.o) }, 2);
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
      if (this.ensemble?.value) this.totals.ensembleSec += dt;
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
          this.near.set(o.o, { r: o.r, since: obs.t, missing: null, moving: new Settled(o.moving, obs.t), lastDist: o.dist, lastBearing: o.bearing });
          w("near", { who: { o: o.o, r: o.r }, dist: o.dist, bearing: o.bearing, moving: o.moving, dots: glyphOf(o.o) });
        }
        continue;
      }
      st.missing = null;
      st.lastDist = o.dist;
      st.lastBearing = o.bearing;
      st.moving.feed(o.moving, obs.t, settleSec);
    }
    // someone whose samples sit at the edge of `recentSec` drops in and out: gone only once it has held
    for (const [o, st] of this.near) {
      if (seen.has(o)) continue;
      st.missing ??= obs.t;
      if (obs.t - st.missing < settleSec) continue;
      this.near.delete(o);
      w("gone", { who: { o, r: st.r }, forSec: st.missing - st.since, dots: glyphOf(o) });
    }
    // an ensemble: I stay, and someone near stays too, for a moment. It says how many there are and how many a house takes
    const staying = [...this.near.values()].filter((st) => st.missing === null && !st.moving.value).length;
    const together = !obs.moving && staying > 0;
    if (!this.ensemble) this.ensemble = new Settled(false, obs.t);
    if (!this.gathered) this.gathered = new Settled(staying + 1, obs.t);
    this.gathered.feed(staying + 1, obs.t, settleSec);
    const need = obs.buildNeeds ?? this.cfg.buildNeeds;
    const startedAt = this.ensemble.since;
    if (this.ensemble.feed(together, obs.t, this.cfg.ensembleSec)) {
      if (this.ensemble.value) {
        this.toldGathered = Math.max(2, this.gathered.value);
        w("ensemble.start", { n: this.toldGathered, need }, 2);
      } else w("ensemble.end", { forSec: this.ensemble.since - startedAt }, 0);
    } else if (this.ensemble.value && this.gathered.value > this.toldGathered) {
      this.toldGathered = this.gathered.value;
      w("ensemble.start", { n: this.toldGathered, need }, 2);
    }
    // group life, and the new word a long contact gives (one line at a time)
    for (const [o, st] of this.near) {
      const forSec = obs.t - st.since;
      if (forSec >= this.cfg.groupSec) this.totals.group.add(o);
      if (forSec >= this.cfg.wordAfterSec && !this.worded.has(o) && obs.t - this.lastWordT >= this.cfg.wordGapSec) {
        this.worded.add(o);
        this.lastWordT = obs.t;
        this.ask(obs.t, { o, r: st.r });
        w("word.new", { who: { o, r: st.r }, dots: glyphOf(o) }, 2);
      }
    }
    // the one near for longest asks again now and then: their melody, gone strange with mine in it
    if (this.question && obs.t - this.question.t > this.cfg.askOpenSec) this.question = null;
    if (!this.question && obs.t - this.lastWordT >= this.cfg.askEverySec) {
      let longest: { o: string; r: RoleId; since: number } | null = null;
      for (const [o, st] of this.near) if (st.missing === null && this.worded.has(o) && (!longest || st.since < longest.since)) longest = { o, r: st.r, since: st.since };
      if (longest) {
        const who = { o: longest.o, r: longest.r };
        this.lastWordT = obs.t;
        const n = this.totals.asked;
        this.ask(obs.t, who);
        w("word.asked", { who, n, dots: newWordOf(longest.o, obs.me, Math.floor(obs.t)) }, 2);
      }
    }
    // someone's word underfoot
    for (const o of obs.wordsNear) {
      if (this.totals.found.includes(o) || obs.t - this.lastWordT < this.cfg.wordGapSec) continue;
      this.totals.found.push(o);
      this.lastWordT = obs.t;
      w("word.found", { who: { o, r: "worker" }, dots: glyphOf(o) }, 2);
    }
    // standing still for a moment, in a place not told yet: who stayed here before me
    if (obs.moving) this.stillSince = null;
    else this.stillSince ??= obs.t;
    const here = obs.place;
    if (here && this.stillSince !== null && obs.t - this.stillSince >= this.cfg.placeAfterSec && obs.t - this.lastPlaceT >= this.cfg.placeGapSec && this.toldPlaces.every((p) => wrapDist(p.x, p.z, here.x, here.z) > nearRadius * this.cfg.placeApart)) {
      this.toldPlaces.push({ x: here.x, z: here.z });
      this.lastPlaceT = obs.t;
      w("place.nth", here.before ? { n: here.n, who: { o: here.before, r: "worker" }, dots: glyphOf(here.before) } : { n: here.n }, 2);
    }
    this.last = obs;
    return written;
  }

  /** The visitor's state now (null before the first reading). */
  status(): StatusArgs | null {
    if (!this.last || !this.moving || !this.surface) return null;
    const together = !!this.ensemble?.value;
    return { moving: this.moving.value, together, forSec: this.last.t - (together ? this.ensemble!.since : this.moving.since), surface: this.surface.value, near: this.near.size };
  }

  /**
   * Totals so far: seconds stationary, seconds with someone near, how many others came near (and by their role), the
   * ground underfoot now, who was near for long (group life), the new words and the left words found — what the end
   * screen and the cause of death (intake.ts) are made from.
   */
  summary(): { stillSec: number; nearSec: number; met: number; metByRole: Partial<Record<RoleId, number>>; surface: Surface; attempts: number; group: string[]; newWords: GlyphDot[][]; found: string[]; ensembleSec: number; asked: number } {
    const metByRole: Partial<Record<RoleId, number>> = {};
    for (const [r, n] of this.totals.metByRole) metByRole[r] = n;
    return {
      stillSec: this.totals.stillSec,
      nearSec: this.totals.nearSec,
      met: this.totals.met.size,
      metByRole,
      surface: this.surface?.value ?? "open",
      attempts: this.totals.attempts,
      group: [...this.totals.group],
      newWords: this.totals.newWords,
      found: this.totals.found,
      ensembleSec: this.totals.ensembleSec,
      asked: this.totals.asked,
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
