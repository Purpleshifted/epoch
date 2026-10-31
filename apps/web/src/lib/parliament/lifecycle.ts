/**
 * parliament/lifecycle.ts — bots that come in and leave like real visitors (docs/bot-lifecycle.md, the artist's OK of
 * 2026-10-31). Instead of a crowd that is always there, the world is visited:
 *
 *   ARRIVAL   a Poisson process, one draw per second: the rate swings slowly between the peak (meanGapSec, 5 a minute)
 *             and the quiet trough (× quietShare, 3 a minute) over wavePeriodSec — busy, then quiet, then busy
 *             (the artist: "기본이랑 한산 왔다갔다하게"). A quarter come in company (1–2 more at the same spot).
 *             No more than maxPresent at once: an arrival beyond that does not come.
 *   ENTRY     half at the origin (where a visitor's life begins in the personal view), half at one of four doors
 *             (fixed per epoch, 30–60 m out)
 *   LIFE      a lifespan from three bands of [lifeMinSec, lifeMaxSec] — short (first quarter), middle (the half
 *             between), long (last quarter) — with the artist's shares (default 20 / 40 / 40 %: 1–1.5, 1.5–2.5,
 *             2.5–3 min), uniform inside a band. A bot dies where it stands, like a visitor.
 *   CONDUCT   the life of the personal view's worker: LOOK about (a slow turning walk), GO somewhere (along the
 *             caller's route: the trodden ground, round the buildings), STAY (stands, swaying a little), again. In
 *             the last warnSec it slows as a visitor's controls do (the same warn curve).
 *   WHERE TO  someone else's place (FOLLOW: the places where somebody stayed in the last ten minutes — more, more
 *             recent and nearer first), its own earlier place (REVISIT), or somewhere new within its range
 *   CHARACTER drawn at birth from the bot's number and the epoch, fixed for its life: speed, wandering, how long it
 *             stays, follow and revisit propensities, range — `spread` widens or narrows them all
 *   PLACES    a stay of at least memory.staySec leaves the place in the memory (merged within memory.mergeR); it fades
 *             with halfLifeSec and is forgotten after forgetSec (the building rule's window): four visitors in ten
 *             minutes, without having to be there at the same time
 *
 * PURE and DETERMINISTIC: the state is plain data (JSON); `stepLifecycle(state, wallMs, inputs, cfg)` returns the
 * next one. Every random draw is a hash of (the epoch, the second, the bot's number, its draw count) — no Math.random,
 * no clock — so November's wall tab and December's shared-world server can run the same function.
 */

import { sessionSeconds } from "./clock";
import { hash2 } from "./nature";
import { nearestImage, wrapCoord, wrapDist } from "./world";
import type { Actor } from "./bots";

export interface LifeBands {
  /** Shares of the short / middle / long band (any scale; normalised). */
  short: number;
  middle: number;
  long: number;
}

export interface LifecycleConfig {
  /** Mean gap between arrivals at the busiest (s): the peak rate. */
  meanGapSec: number;
  /** The quiet trough's rate as a share of the peak (0.6: 5 → 3 a minute). 1 = always busy. */
  quietShare: number;
  /** One busy–quiet–busy swing (s). */
  wavePeriodSec: number;
  /** Most bots at once. */
  maxPresent: number;
  lifeMinSec: number;
  lifeMaxSec: number;
  bands: LifeBands;
  /** Chance that an arrival comes in company (1–2 more at the same spot). */
  groupP: number;
  /** Share that begin at the origin (the rest at one of the doors). */
  originShare: number;
  /** Mean propensities (0..1), widened per bot by `spread`. */
  follow: number;
  revisit: number;
  /** How widely the characters vary (0 = all the same bot, 1 = the plan's ranges, 2 = wider). */
  spread: number;
  /** Assigned-time offset of a bot: drawn in [0, timeSpreadSec) (s). Small: a bot more than ~35 s behind the others
   *  would make every growing fold rebuild itself. */
  timeSpreadSec: number;
  /** Walking speed (m/s) of an average bot. */
  speed: number;
  /** The last seconds of a life, in which it slows. */
  warnSec: number;
  memory: { staySec: number; mergeR: number; halfLifeSec: number; forgetSec: number };
}

export const DEFAULT_LIFECYCLE: LifecycleConfig = {
  meanGapSec: 12,
  quietShare: 0.6,
  wavePeriodSec: 15 * 60,
  maxPresent: 16,
  lifeMinSec: 60,
  lifeMaxSec: 180,
  bands: { short: 20, middle: 40, long: 40 },
  groupP: 0.25,
  originShare: 0.5,
  follow: 0.5,
  revisit: 0.3,
  spread: 1,
  timeSpreadSec: 10,
  speed: 2.2,
  warnSec: 40,
  memory: { staySec: 8, mergeR: 1.5, halfLifeSec: 300, forgetSec: 600 },
};

export interface Character {
  /** × cfg.speed. */
  speed: number;
  /** 0..1: how much it turns while looking about, and how often it looks about. */
  wander: number;
  /** Mean length of a stay (s). */
  stayMean: number;
  follow: number;
  revisit: number;
  /** How far from its entry it goes (m). */
  range: number;
}

export interface Visitor {
  /** The id in the log: `bot<second>` (+ `.<companion>`), unique in the epoch. */
  id: string;
  /** The arrival second (since the epoch) and the companion index: the seed of everything about it. */
  sec: number;
  j: number;
  bornMs: number;
  lifeMs: number;
  /** Assigned-time offset (s). */
  off: number;
  ch: Character;
  /** Where it came in (canonical). */
  ex: number;
  ez: number;
  x: number;
  z: number;
  mode: "look" | "go" | "stay";
  /** GO: route (continuous coordinates) and distance along it. */
  route: number[] | null;
  along: number;
  /** LOOK: heading. STAY: the spot it sways about. */
  head: number;
  sx: number;
  sz: number;
  /** LOOK / STAY: when it moves on (wall ms); STAY: when it began. */
  untilMs: number;
  sinceMs: number;
  /** Its own places this life. */
  stops: [number, number][];
  /** Draws made so far. */
  k: number;
}

export interface Place {
  x: number;
  z: number;
  /** Stays counted here (fading). */
  n: number;
  /** Wall ms of the last stay. */
  atMs: number;
}

export interface LifecycleState {
  epochMs: number;
  /** Wall ms of the last step; the last arrival second drawn. */
  lastMs: number;
  lastSec: number;
  maxPresent: number;
  present: Visitor[];
  places: Place[];
  /** Totals since the start (for the readout). */
  arrived: number;
  turnedAway: number;
  departed: number;
}

/** Somewhere a person is now (a visitor of the personal view): a place to go to, like a stay. */
export interface Attractor {
  x: number;
  z: number;
  w: number;
}

export interface LifecycleInputs {
  /** People who are not bots (the visitors), where they are now. */
  attractors?: readonly Attractor[];
  /** The way from A to B (a polyline A … B in continuous coordinates); absent = straight. */
  planRoute?: (ax: number, az: number, bx: number, bz: number) => number[];
  /** Most departures (routes planned) per step; the others wait a second. */
  maxRoutes?: number;
}

export interface LifecycleStep {
  state: LifecycleState;
  arrivals: Visitor[];
  /** Who died in this step, where they stood. */
  departures: Visitor[];
}

// ── draws ───────────────────────────────────────────────────────────────────

const salt = (epochMs: number) => Math.floor(epochMs / 1000) % 1_000_003;
const range = (u: number, a: number, b: number) => a + (b - a) * u;
/** The bot's next draw (advances its counter). */
const draw = (v: Visitor, epochMs: number, s: number) => hash2(v.sec * 4 + v.j, v.k++, salt(epochMs) * 7 + s);
/** A draw of the world (arrivals, doors) for second `sec`. */
const worldDraw = (epochMs: number, sec: number, s: number) => hash2(sec, s, salt(epochMs) * 13 + 3);

/** The arrival rate (per second) at second `sec`: between the peak and the quiet trough, a cosine swing. */
export function arrivalRate(sec: number, cfg: LifecycleConfig = DEFAULT_LIFECYCLE): number {
  const peak = 1 / Math.max(1, cfg.meanGapSec);
  const q = Math.max(0, Math.min(1, cfg.quietShare));
  const period = Math.max(60, cfg.wavePeriodSec);
  // busy at sec 0 → quiet at half the period → busy again
  const swing = 0.5 + 0.5 * Math.cos((2 * Math.PI * sec) / period);
  return peak * (q + (1 - q) * swing);
}

/** A lifespan (s) from the three bands, for draws u (which band) and v (where in it). */
export function lifeFromBands(u: number, v: number, cfg: Pick<LifecycleConfig, "lifeMinSec" | "lifeMaxSec" | "bands"> = DEFAULT_LIFECYCLE): number {
  const lo = Math.min(cfg.lifeMinSec, cfg.lifeMaxSec);
  const hi = Math.max(cfg.lifeMinSec, cfg.lifeMaxSec);
  const span = hi - lo;
  const b = cfg.bands;
  const tot = Math.max(1e-9, Math.max(0, b.short) + Math.max(0, b.middle) + Math.max(0, b.long));
  const s = Math.max(0, b.short) / tot;
  const m = Math.max(0, b.middle) / tot;
  if (u < s) return range(v, lo, lo + span * 0.25);
  if (u < s + m) return range(v, lo + span * 0.25, lo + span * 0.75);
  return range(v, lo + span * 0.75, hi);
}

/** The four doors of an epoch (30–60 m out). */
export function doorsOf(epochMs: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.2 + 0.6 * worldDraw(epochMs, -1 - i, 1)) * (Math.PI / 2); // one per quarter, not bunched
    const d = 30 + 30 * worldDraw(epochMs, -1 - i, 2);
    out.push([wrapCoord(Math.sin(a) * d), wrapCoord(Math.cos(a) * d)]);
  }
  return out;
}

function characterOf(v: Visitor, epochMs: number, cfg: LifecycleConfig): Character {
  const w = Math.max(0, cfg.spread);
  // a trait around its mean, ± half its range × spread
  const around = (mean: number, half: number, s: number) => mean + (draw(v, epochMs, s) - 0.5) * 2 * half * w;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  return {
    speed: Math.max(0.3, around(1, 0.4, 20)),
    wander: clamp01(around(0.4, 0.4, 21)),
    stayMean: Math.max(4, around(24, 16, 22)),
    follow: clamp01(around(cfg.follow, 0.3, 23)),
    revisit: clamp01(around(cfg.revisit, 0.3, 24)),
    range: Math.max(5, around(35, 25, 25)),
  };
}

function bornAt(sec: number, j: number, wallMs: number, epochMs: number, cfg: LifecycleConfig, at?: [number, number]): Visitor {
  const v: Visitor = {
    id: j ? `bot${sec}.${j}` : `bot${sec}`,
    sec,
    j,
    bornMs: wallMs,
    lifeMs: 0,
    off: 0,
    ch: { speed: 1, wander: 0, stayMean: 0, follow: 0, revisit: 0, range: 0 },
    ex: 0,
    ez: 0,
    x: 0,
    z: 0,
    mode: "look",
    route: null,
    along: 0,
    head: 0,
    sx: 0,
    sz: 0,
    untilMs: wallMs,
    sinceMs: wallMs,
    stops: [],
    k: 0,
  };
  v.lifeMs = lifeFromBands(draw(v, epochMs, 1), draw(v, epochMs, 2), cfg) * 1000;
  v.off = draw(v, epochMs, 3) * Math.max(0, cfg.timeSpreadSec);
  v.ch = characterOf(v, epochMs, cfg);
  let x: number, z: number;
  if (at) [x, z] = [at[0] + (draw(v, epochMs, 4) - 0.5) * 2, at[1] + (draw(v, epochMs, 5) - 0.5) * 2];
  else if (draw(v, epochMs, 6) < cfg.originShare) [x, z] = [(draw(v, epochMs, 4) - 0.5) * 4, (draw(v, epochMs, 5) - 0.5) * 4];
  else {
    const doors = doorsOf(epochMs);
    const d = doors[Math.min(3, Math.floor(draw(v, epochMs, 7) * 4))];
    [x, z] = [d[0] + (draw(v, epochMs, 4) - 0.5) * 3, d[1] + (draw(v, epochMs, 5) - 0.5) * 3];
  }
  v.x = v.ex = wrapCoord(x);
  v.z = v.ez = wrapCoord(z);
  // a newcomer looks about first
  v.head = draw(v, epochMs, 8) * 2 * Math.PI;
  v.untilMs = wallMs + range(draw(v, epochMs, 9), 3, 8) * 1000;
  return v;
}

// ── places ──────────────────────────────────────────────────────────────────

/** A place's weight now: its stays, fading by halfLifeSec. */
function placeWeight(p: Place, wallMs: number, cfg: LifecycleConfig): number {
  return p.n * Math.pow(0.5, (wallMs - p.atMs) / 1000 / Math.max(1, cfg.memory.halfLifeSec));
}

function remember(places: Place[], x: number, z: number, wallMs: number, cfg: LifecycleConfig): void {
  for (const p of places) {
    if (wrapDist(p.x, p.z, x, z) <= cfg.memory.mergeR) {
      p.n = placeWeight(p, wallMs, cfg) + 1;
      p.atMs = wallMs;
      return;
    }
  }
  places.push({ x, z, n: 1, atMs: wallMs });
}

// ── conduct ─────────────────────────────────────────────────────────────────

function routeLength(r: readonly number[]): number {
  let L = 0;
  for (let k = 2; k < r.length; k += 2) L += Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]);
  return L;
}

function pointAlong(r: readonly number[], d: number): [number, number] {
  let left = Math.max(0, d);
  for (let k = 2; k < r.length; k += 2) {
    const seg = Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]);
    if (left <= seg) {
      const t = seg > 0 ? left / seg : 1;
      return [r[k - 2] + (r[k] - r[k - 2]) * t, r[k - 1] + (r[k + 1] - r[k - 1]) * t];
    }
    left -= seg;
  }
  return [r[r.length - 2], r[r.length - 1]];
}

/** Where `v` goes next: someone else's place, its own earlier place, or somewhere new within its range. */
function destination(v: Visitor, places: readonly Place[], attractors: readonly Attractor[], wallMs: number, epochMs: number, cfg: LifecycleConfig): [number, number] {
  if (draw(v, epochMs, 30) < v.ch.follow) {
    const cands: [number, number, number][] = [];
    for (const p of places) cands.push([p.x, p.z, placeWeight(p, wallMs, cfg)]);
    for (const a of attractors) cands.push([a.x, a.z, a.w]);
    let tot = 0;
    const ws = cands.map(([x, z, w]) => {
      const q = w / (1 + wrapDist(v.x, v.z, x, z) / 40);
      tot += q;
      return q;
    });
    if (tot > 1e-6) {
      let u = draw(v, epochMs, 31) * tot;
      for (let i = 0; i < cands.length; i++) {
        u -= ws[i];
        if (u <= 0 || i === cands.length - 1) {
          return [wrapCoord(cands[i][0] + (draw(v, epochMs, 32) - 0.5) * 1.5), wrapCoord(cands[i][1] + (draw(v, epochMs, 33) - 0.5) * 1.5)];
        }
      }
    }
  }
  if (v.stops.length && draw(v, epochMs, 34) < v.ch.revisit) {
    const s = v.stops[Math.min(v.stops.length - 1, Math.floor(draw(v, epochMs, 35) * v.stops.length))];
    return [wrapCoord(s[0] + (draw(v, epochMs, 36) - 0.5)), wrapCoord(s[1] + (draw(v, epochMs, 37) - 0.5))];
  }
  const a = draw(v, epochMs, 38) * 2 * Math.PI, d = v.ch.range * Math.sqrt(draw(v, epochMs, 39));
  return [wrapCoord(v.ex + Math.sin(a) * d), wrapCoord(v.ez + Math.cos(a) * d)];
}

/** What `v` does when its LOOK or STAY is over, or it has arrived. Returns true when it planned a route. */
function next(v: Visitor, st: LifecycleState, inp: LifecycleInputs, wallMs: number, cfg: LifecycleConfig, canRoute: boolean): boolean {
  const epochMs = st.epochMs;
  if (v.mode === "go" && draw(v, epochMs, 40) < 0.75) {
    // arrived: usually it stays
    startStay(v, wallMs, epochMs);
    return false;
  }
  const look = draw(v, epochMs, 41) < v.ch.wander * 0.5;
  if (!look && !canRoute) {
    // no route this second: it waits where it is a moment longer
    if (v.mode === "stay") v.untilMs = wallMs + 1000;
    else startStay(v, wallMs, epochMs, 1);
    return false;
  }
  // leaving a stay that was long enough: the place is remembered (by everyone) and is one of its own
  if (v.mode === "stay" && wallMs - v.sinceMs >= cfg.memory.staySec * 1000) {
    remember(st.places, v.sx, v.sz, wallMs, cfg);
    v.stops.push([v.sx, v.sz]);
  }
  if (look) {
    v.mode = "look";
    v.route = null;
    v.head = draw(v, epochMs, 42) * 2 * Math.PI;
    v.untilMs = wallMs + range(draw(v, epochMs, 43), 4, 14) * 1000;
    return false;
  }
  const [tx, tz] = destination(v, st.places, inp.attractors ?? [], wallMs, epochMs, cfg);
  const bx = nearestImage(tx, v.x), bz = nearestImage(tz, v.z);
  v.route = inp.planRoute ? inp.planRoute(v.x, v.z, bx, bz) : [v.x, v.z, bx, bz];
  v.along = 0;
  v.mode = "go";
  return true;
}

function startStay(v: Visitor, wallMs: number, epochMs: number, sec?: number): void {
  v.mode = "stay";
  v.route = null;
  v.sx = v.x;
  v.sz = v.z;
  v.sinceMs = wallMs;
  v.untilMs = wallMs + (sec ?? v.ch.stayMean * (0.5 + draw(v, epochMs, 44))) * 1000;
}

// ── the step ────────────────────────────────────────────────────────────────

export function initLifecycle(epochMs: number, wallMs: number, cfg: LifecycleConfig = DEFAULT_LIFECYCLE): LifecycleState {
  return {
    epochMs,
    lastMs: wallMs,
    lastSec: Math.floor((wallMs - epochMs) / 1000),
    maxPresent: cfg.maxPresent,
    present: [],
    places: [],
    arrived: 0,
    turnedAway: 0,
    departed: 0,
  };
}

/**
 * The world one step on, at wall time `wallMs` (steps are the presence samples, ~1 s; a late step covers more).
 * Order: departures (lives over), arrivals (one draw per elapsed second), then everyone moves.
 */
export function stepLifecycle(prev: LifecycleState, wallMs: number, inp: LifecycleInputs = {}, cfg: LifecycleConfig = DEFAULT_LIFECYCLE): LifecycleStep {
  const epochMs = prev.epochMs;
  const dt = Math.max(0, (wallMs - prev.lastMs) / 1000);
  const st: LifecycleState = {
    ...prev,
    lastMs: wallMs,
    present: prev.present.map((v) => ({ ...v, route: v.route ? v.route.slice() : null, stops: v.stops.map((s) => [s[0], s[1]] as [number, number]) })),
    places: prev.places.map((p) => ({ ...p })),
  };
  const arrivals: Visitor[] = [];
  const departures: Visitor[] = [];
  const cap = Math.max(0, Math.round(st.maxPresent));

  // LIFE: who has lived their span dies where they stand
  st.present = st.present.filter((v) => {
    if (wallMs - v.bornMs < v.lifeMs) return true;
    departures.push(v);
    return false;
  });
  // the places: forgotten after forgetSec
  st.places = st.places.filter((p) => wallMs - p.atMs < cfg.memory.forgetSec * 1000);

  // ARRIVALS: one draw for every second since the last step (a catch-up draws each of them)
  const nowSec = Math.floor((wallMs - epochMs) / 1000);
  for (let sec = Math.max(st.lastSec + 1, nowSec - 600); sec <= nowSec; sec++) {
    if (worldDraw(epochMs, sec, 10) >= arrivalRate(sec, cfg)) continue;
    const group = worldDraw(epochMs, sec, 11) < cfg.groupP ? 1 + Math.floor(worldDraw(epochMs, sec, 12) * 2) : 0;
    let lead: Visitor | null = null;
    for (let j = 0; j <= group; j++) {
      if (st.present.length >= cap) {
        st.turnedAway++;
        continue;
      }
      const v = bornAt(sec, j, wallMs, epochMs, cfg, lead ? [lead.x, lead.z] : undefined);
      if (!lead) lead = v;
      st.present.push(v);
      arrivals.push(v);
      st.arrived++;
    }
  }
  st.lastSec = Math.max(st.lastSec, nowSec);
  st.departed += departures.length;

  // MOVE
  let routes = 0;
  const maxRoutes = Math.max(1, inp.maxRoutes ?? 2);
  for (const v of st.present) {
    // the end draws near: it slows as a visitor's controls do (session.ts lifeAt warn)
    const left = (v.lifeMs - (wallMs - v.bornMs)) / 1000;
    const t = cfg.warnSec > 0 ? Math.max(0, Math.min(1, 1 - left / cfg.warnSec)) : 0;
    const speed = cfg.speed * v.ch.speed * (1 - 0.6 * t * t);
    if (v.mode === "go") {
      const route = v.route ?? [v.x, v.z, v.x, v.z];
      v.along += speed * dt;
      const L = routeLength(route);
      if (v.along >= L) {
        v.x = wrapCoord(route[route.length - 2]);
        v.z = wrapCoord(route[route.length - 1]);
        if (next(v, st, inp, wallMs, cfg, routes < maxRoutes)) routes++;
      } else {
        const [x, z] = pointAlong(route, v.along);
        v.x = wrapCoord(x);
        v.z = wrapCoord(z);
      }
      continue;
    }
    if (v.mode === "look") {
      v.head += (draw(v, epochMs, 50) - 0.5) * 1.2 * (0.3 + v.ch.wander);
      v.x = wrapCoord(v.x + Math.sin(v.head) * speed * 0.6 * dt);
      v.z = wrapCoord(v.z + Math.cos(v.head) * speed * 0.6 * dt);
    } else {
      // staying: swaying a little about the spot
      v.x = wrapCoord(v.sx + (draw(v, epochMs, 51) - 0.5) * 0.3);
      v.z = wrapCoord(v.sz + (draw(v, epochMs, 52) - 0.5) * 0.3);
    }
    if (wallMs >= v.untilMs && next(v, st, inp, wallMs, cfg, routes < maxRoutes)) routes++;
  }
  return { state: st, arrivals, departures };
}

/** A bot as an actor at wall time `wallMs`: its presence sample (a worker, at its own assigned time). */
export function lifecycleActor(v: Visitor, wallMs: number, epochMs: number): Actor {
  return { o: v.id, r: "worker", x: v.x, z: v.z, s: sessionSeconds(wallMs, epochMs, v.off) };
}

/**
 * The most bots at once after a minute of frames (`slowPerMin` = frames over 50 ms in the last minute): down by 2 when
 * it lags (> 8), by 1 when a little heavy (> 3), up by 1 towards `max` when clean (≤ 1); never below `min`.
 */
export function nextMaxPresent(cur: number, slowPerMin: number, min: number, max: number): number {
  let n = cur;
  if (slowPerMin > 8) n -= 2;
  else if (slowPerMin > 3) n -= 1;
  else if (slowPerMin <= 1) n += 1;
  return Math.max(Math.min(min, max), Math.min(max, n));
}

/** The state from storage, or null (not a lifecycle state, or another epoch's). */
export function readLifecycle(raw: unknown, epochMs: number): LifecycleState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as LifecycleState;
  if (s.epochMs !== epochMs || !Array.isArray(s.present) || !Array.isArray(s.places) || typeof s.lastMs !== "number" || typeof s.lastSec !== "number") return null;
  for (const v of s.present) if (typeof v?.id !== "string" || typeof v.x !== "number" || typeof v.lifeMs !== "number" || !v.ch) return null;
  return s;
}
