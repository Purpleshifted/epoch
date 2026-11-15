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
 *             2.5–3 min), uniform inside a band.
 *   LEAVING   most walk OUT at the end (`leaveShare`): they set off for a door (their own if they came in by one, else
 *             the nearest) when what is left of their life is about the walk there (at most `leaveSec` before the
 *             end), so they reach it as their life ends — and are gone there. The ways
 *             between the doors and the places inside are walked again and again, and become paths (the artist,
 *             2026-10-31: "이러니깐 길이 잘 안 생기네"). The others die where they stand, like a visitor.
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
  /** Share of the bots that walk out through a door at the end (the rest die where they stand). */
  leaveShare: number;
  /** They set off for the door when what is left of their life is about the walk there — at most this long before the
   *  end (s); reaching the door ends the life. */
  leaveSec: number;
  /**
   * MEETING A BUILDING ON THE WAY (the artist, 2026-11-12: "건물이 있으면 우회/머무르기 선택하도록"): the share of
   * such meetings in which the walker goes no further — it walks to the building and stays there; in the others it
   * goes round (the route, LifecycleInputs.planRoute). Absent or 0 = it always goes round. Needs LifecycleInputs.meet.
   */
  meetStay?: number;
  memory: { staySec: number; mergeR: number; halfLifeSec: number; forgetSec: number };
  /** HERDS (absent = none: the bots arrive by the rate above, alone or in the old loose company). With it the
   *  arrivals by rate stop: the population is `count` herds and `loners` bots, each replaced when it is gone. */
  herd?: HerdConfig;
}

/**
 * HERDS IN THE BLOCK (the artist, 2026-11-12: "봇 몰려다니는 로직", "무리 = 시간축을 높이로 둔 공간에서 3차원 밀도/거리로").
 * The wall draws time as height, so a herd is defined in that one 3D space: its members live within `radius` of their
 * leader — sideways on the ground AND up and down in assigned time (height = seconds × metersPerSec) — and a new herd
 * is born at least `gap` (3D) from every living one. A herd moves as one: the leader goes, stays and looks about as a
 * bot does; the others set off for the same place one after another, stand around it while it stays, and live about
 * as long. Each herd is seated at its own depth of the block (`depthSec` below the present) and rises with time.
 */
export interface HerdConfig {
  /** HOW MANY: living herds kept at once (one is born when one is gone), and bots that go about alone. */
  count: number;
  /** The fewest herds at once (absent or ≥ count: always `count`): the number wanted swings slowly between the two,
   *  one swing about every `countWaveSec` (two waves over each other, so it does not tick like a clock). */
  countMin?: number;
  countWaveSec?: number;
  loners: number;
  /** Members of a herd, leader included. */
  sizeMin: number;
  sizeMax: number;
  /** 3D radius of a herd around its leader (world units; time counts as height): its members' places and times. */
  radius: number;
  /** 3D distance a new herd keeps from every living herd (world units); it is seated at the best of a few tries. */
  gap: number;
  /** World units of height per second of assigned time (the wall: one slot's height / its seconds). */
  metersPerSec: number;
  /** THE BLOCK: a fixed piece of spacetime, the times 0 … this many seconds; herds are born at times of it and live
   *  upwards from there (0 = no block: all at the present, as the clock goes). */
  depthSec: number;
  /** WHEN (height): "strata" = the depth is cut into as many bands as there are herds and a new herd takes one of
   *  the emptiest — herds at every time of the block; "any" = anywhere in the depth. */
  layout: "strata" | "any";
  /** WHERE (ground): "even" = anywhere within originR of the origin; "doors" = the origin or one of the epoch's four
   *  doors (the old entries); "built" = near a place others have stayed at (even, while there is none);
   *  "villages" = in one of the epoch's village sites (`villages`), and every herd stays in its own. */
  origin: "even" | "doors" | "built" | "villages";
  originR: number;
  /**
   * VILLAGES (the artist, 2026-11-15: "마을 시작"): sites of the epoch within originR of the origin. A herd (and a
   * loner) belongs to one alive at its time — the one with fewest herds living, mostly — is born in it and goes about
   * inside its `radius` only: its stays, its round, the places it follows.
   * IN TIME (the artist, 2026-11-15: "마을은 시간대별로 거점이 다를 수 있어야"): with `lifeSec` > 0 and a block, a
   * site lives for a span of the block's time (lifeSec × 0.6 … 1.4); `count` villages are alive at any time, each
   * followed by the next of its line a little before it ends — near it with `carry` (the village moved), elsewhere
   * otherwise (abandoned; a new one founded). The lines are out of step, so no time of the block is a border of eras.
   * A herd whose village ends while it lives walks over to the one that follows it: a way between the two. Sites keep
   * `gap` from the sites alive at the same time. lifeSec 0 = every site for the whole block (a column).
   * WAYS BETWEEN THEM (step 2): roaming herds and loners have a home village; leaving a stay at home, they go to a
   * neighbour alive at their time with `travel` (the nearer, much the likelier: the same pairs again and again), stay
   * there a while and come back — the walks between two villages are taken again and again and become the roads.
   * HOUSES (the artist, 2026-11-15: "마을에 건물이 여러채보다는 한 덩어리가 되는 느낌이라 아쉬움"): a village has
   * `plots` house plots (± 1 by its own draw) on a ring at 0.75 of its radius around an open middle; every stay in a
   * village is at one of them — a settler mostly at its own — so a village is several buildings round a court, not
   * one mass. 0 = anywhere in the village (one mass).
   * TWO KINDS OF WAY (the artist, 2026-11-15: "마을 속 길이랑 마을간 긴 로직을 좀 나눠서 최적화", "마을간 길은 좀 더
   * 유동적이도록"): a walk inside a village is a LANE — from where it is to the court's middle and on to where it goes
   * (straight when the two are near), no search over the grid at all, so the lanes of a village are the same few lines
   * walked again and again. A walk between two villages is a ROAD — searched over the grid (the tails, round the
   * buildings) through a waypoint off the straight line between the two villages, swung sideways by up to `fluid` × 35 %
   * of their distance, drifting slowly with the block's time (minutes): walks of about the same time take the same
   * road, and over time the road wanders. 0 = the straight search between them.
   * CHARACTER (step 4; the artist, 2026-11-15: "마을마다 다른 성격으로"): every site draws its own — SIZE (its radius
   * × 0.6 … 1.6, and as many houses as fit), STAY (how long its people stay, × 0.5 … 1.9: a staying village builds
   * tall), TRAVEL (how often its roamers go visiting, × 0.2 … 1.8: open or closed) and SETTLED (its herds more settlers
   * or more roamers) — all scaled by `character` (0 = every village alike). A moved village keeps its line's character
   * (a little drifted); a newly founded one draws its own.
   */
  villages?: { count: number; radius: number; gap: number; lifeSec?: number; carry?: number; travel?: number; plots?: number; fluid?: number; character?: number };
  /** HOW THEY MOVE, as shares of the herds: settlers (long stays, short hops, back to their places), roamers (short
   *  stays, long walks) and those on a round (the same three or four places, again and again — paths between them). */
  mix: { settle: number; roam: number; tour: number };
  /** 0..1: how loosely the members keep (wider around the leader, a new place at every stop, later to set off). */
  loose: number;
  /** TIME: each herd rises through the block a little faster or slower than the clock — its rate is 1 ± this (0 = all
   *  with the clock). A herd's members share it, so a herd stays together in time. */
  drift: number;
}

/** The wall's time axis: one slot of 20 s is 1 world unit high. */
export const DEFAULT_HERD: HerdConfig = {
  count: 6,
  loners: 2,
  sizeMin: 4,
  sizeMax: 6,
  radius: 2,
  gap: 20,
  metersPerSec: 1 / 20,
  depthSec: 900,
  layout: "strata",
  origin: "villages",
  // (the ground narrowed for villages, the artist 2026-11-15 "땅 좁히기": the block reads as a column, the wall's grids
  // over all buildings — water, walkways — are smaller; 44, not less: villages of different sizes need the room)
  originR: 44,
  villages: { count: 5, radius: 12, gap: 30, lifeSec: 400, carry: 0.5, travel: 0.5, plots: 5, fluid: 0.5, character: 0.6 },
  mix: { settle: 1, roam: 1, tour: 1 },
  loose: 0.3,
  drift: 0,
};

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
  leaveShare: 0.8,
  leaveSec: 45,
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
  /** It will walk out at the end (drawn at birth), and is on its way out now. */
  leaves: boolean;
  leaving: boolean;
  /** The door it came in by (−1: it began at the origin). */
  door: number;
  /** Draws made so far. */
  k: number;
  /** HERD: the leader's id (absent: a leader or a bot of its own), its place around the leader (m), how long after
   *  the leader it sets off (s), where it is heading with the herd and from when it may go (wall ms). */
  lead?: string;
  /** It is on its way to a building it met and will stay at (meetStay). */
  met?: boolean;
  /** HERD: what it is in the population ("leader" of a herd, or a "loner"), how its herd moves, the round it walks
   *  (flat x, z list) and where on it it is, and how fast it rises through time relative to the clock (0 = with it). */
  kind?: "leader" | "loner";
  temper?: "settle" | "roam" | "tour";
  tour?: number[];
  ti?: number;
  drift?: number;
  hx?: number;
  hz?: number;
  /** VILLAGES: the village it is in now (an index of villageSites; absent = none), and the one it lives in (a
   *  roamer's or loner's home, which it leaves to visit a neighbour and comes back to; absent = vil). */
  vil?: number;
  home?: number;
  /** VILLAGES: its own house plot in the village it is in (an index of the site's plots). */
  plot?: number;
  lag?: number;
  tx?: number;
  tz?: number;
  holdMs?: number;
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
  /** (`s` = the walker's own assigned time: the ground it plans over is the ground of its time, tails.ts) */
  planRoute?: (ax: number, az: number, bx: number, bz: number, s?: number) => number[];
  /** The first building a straight walk from A to B would meet at time `s`, well before B — where it would enter it;
   *  null = none. */
  meet?: (ax: number, az: number, bx: number, bz: number, s: number) => [number, number] | null;
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
    leaves: false,
    leaving: false,
    door: -1,
    k: 0,
  };
  v.lifeMs = lifeFromBands(draw(v, epochMs, 1), draw(v, epochMs, 2), cfg) * 1000;
  v.off = draw(v, epochMs, 3) * Math.max(0, cfg.timeSpreadSec);
  v.ch = characterOf(v, epochMs, cfg);
  v.leaves = draw(v, epochMs, 10) < cfg.leaveShare;
  let x: number, z: number;
  if (at) [x, z] = [at[0] + (draw(v, epochMs, 4) - 0.5) * 2, at[1] + (draw(v, epochMs, 5) - 0.5) * 2];
  else if (draw(v, epochMs, 6) < cfg.originShare) [x, z] = [(draw(v, epochMs, 4) - 0.5) * 4, (draw(v, epochMs, 5) - 0.5) * 4];
  else {
    const doors = doorsOf(epochMs);
    v.door = Math.min(3, Math.floor(draw(v, epochMs, 7) * 4));
    const d = doors[v.door];
    [x, z] = [d[0] + (draw(v, epochMs, 4) - 0.5) * 3, d[1] + (draw(v, epochMs, 5) - 0.5) * 3];
  }
  v.x = v.ex = wrapCoord(x);
  v.z = v.ez = wrapCoord(z);
  // a newcomer looks about first
  v.head = draw(v, epochMs, 8) * 2 * Math.PI;
  v.untilMs = wallMs + range(draw(v, epochMs, 9), 3, 8) * 1000;
  return v;
}

// ── herds ───────────────────────────────────────────────────────────────────

/** 3D distance between two bots on the wall: the ground's (round the torus) and their assigned times as height. */
function dist3(ax: number, az: number, aoff: number, bx: number, bz: number, boff: number, h: HerdConfig): number {
  return Math.hypot(wrapDist(ax, az, bx, bz), (aoff - boff) * h.metersPerSec);
}

/** How many herds are wanted at second `sec`: between countMin and count, swinging slowly. */
export function herdsWanted(sec: number, h: HerdConfig): number {
  const hi = Math.max(0, Math.round(h.count)), lo = Math.max(0, Math.min(hi, Math.round(h.countMin ?? hi)));
  if (lo >= hi) return hi;
  const P = Math.max(30, h.countWaveSec ?? 600);
  const w = 0.5 + 0.3 * Math.cos((2 * Math.PI * sec) / P) + 0.2 * Math.cos((2 * Math.PI * sec) / (P * 0.37) + 1.3);
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, w)));
}

// ── villages ────────────────────────────────────────────────────────────────

/** A village site: its ground, the block times it lives (from ≤ t < to), and the site that follows it (−1: none). */
export interface VillageSite {
  x: number;
  z: number;
  from: number;
  to: number;
  next: number;
  /** Its house plots (canonical ground), round an open middle; empty = none (anywhere in the village). */
  plots: [number, number][];
  /** Its CHARACTER (HerdConfig.villages.character): multipliers of its radius, of its people's stays and of its
   *  roamers' visits, and its lean towards settlers (> 0) or roamers (< 0, −1 … 1). */
  ch: { size: number; stay: number; travel: number; settled: number };
}

/** A site's radius (its village's character × the radius of the knobs). */
export function siteRadius(s: VillageSite, h: HerdConfig): number {
  return Math.max(1, (h.villages?.radius ?? 1) * s.ch.size);
}

let siteCache: { key: string; sites: VillageSite[] } | null = null;

/** Least distance (world) between the middles of two house plots on a village's ring. */
const PLOT_SPACING = 10;

/**
 * The epoch's village sites (HerdConfig.villages), by the epoch's draws only: `count` lines out of step, each a chain of
 * sites over the block's time (or one site for the whole block when lifeSec is 0 or there is no block). A site is the
 * best of 16 draws within originR — the farthest from the sites alive at the same time, or the first at least `gap`
 * from all of them; a moved village is drawn at gap × 0.5 … 0.9 from the one before it. Empty when the herds are not
 * in villages.
 */
export function villageSites(epochMs: number, h: HerdConfig | undefined): VillageSite[] {
  if (!h || h.origin !== "villages" || !h.villages) return [];
  const V = h.villages;
  const n = Math.max(1, Math.min(16, Math.round(V.count)));
  const depth = Math.max(0, h.depthSec);
  const life = depth > 0 ? Math.max(0, V.lifeSec ?? 0) : 0;
  const carry = Math.max(0, Math.min(1, V.carry ?? 0));
  const R = Math.max(0, h.originR);
  const chA = Math.max(0, Math.min(1, V.character ?? 0));
  const key = `${epochMs}|${n}|${R}|${V.gap}|${depth}|${life}|${carry}|${V.radius}|${V.plots ?? 0}|${chA}`;
  if (siteCache?.key === key) return siteCache.sites;
  const sites: VillageSite[] = [];
  let d = 0;
  const wd = (s: number) => worldDraw(epochMs, -1000 - d, s);
  /** A character: a new one by the draws `g`, or the one before it a little drifted (a moved village). */
  const charOf = (g: number, after: VillageSite | null): VillageSite["ch"] => {
    const u = (s: number) => worldDraw(epochMs, -4000 - g, s);
    if (after) {
      const dr = (s: number) => 1 + (u(s) - 0.5) * 0.2 * chA;
      return { size: after.ch.size * dr(1), stay: after.ch.stay * dr(2), travel: after.ch.travel * dr(3), settled: Math.max(-1, Math.min(1, after.ch.settled + (u(4) - 0.5) * 0.2 * chA)) };
    }
    return { size: 1 + chA * (u(1) * 1.0 - 0.4), stay: 1 + chA * (u(2) * 1.4 - 0.5), travel: 1 + chA * (u(3) * 1.6 - 0.8), settled: chA * (u(4) * 2 - 1) };
  };
  /** The best ground for a site alive over [from, to) of size `size`: far from the others then — the distance read
   *  against their mean size — and near `after`, a moved one. */
  const seat = (from: number, to: number, after: VillageSite | null, size = 1): [number, number] => {
    const others = sites.filter((o) => o.from < to && from < o.to && o !== after);
    let best: [number, number] = [0, 0], bestD = -1;
    // (48 tries; a moved village tries near the one before it first, and is founded elsewhere if there is no room)
    for (let c = 0; c < 48; c++, d++) {
      let x: number, z: number;
      if (after && c < 24) {
        const a = wd(1) * 2 * Math.PI, r = V.gap * (0.5 + 0.4 * wd(2));
        x = after.x + Math.sin(a) * r;
        z = after.z + Math.cos(a) * r;
        // never out past originR (the box of the ground stays off the world's edge)
        const L = Math.hypot(x, z);
        if (L > R && L > 0) [x, z] = [(x / L) * R, (z / L) * R];
      } else {
        const a = wd(1) * 2 * Math.PI, r = R * Math.sqrt(wd(2));
        [x, z] = [Math.sin(a) * r, Math.cos(a) * r];
      }
      x = wrapCoord(x);
      z = wrapCoord(z);
      let dMin = Infinity;
      for (const o of others) dMin = Math.min(dMin, wrapDist(x, z, o.x, o.z) / Math.max(1, (o.ch.size + size) / 2));
      if (dMin > bestD) {
        bestD = dMin;
        best = [x, z];
      }
      if (dMin >= V.gap) break;
    }
    return best;
  };
  if (!(life > 0)) {
    for (let i = 0; i < n; i++) {
      const ch = charOf(i, null);
      const [x, z] = seat(-Infinity, Infinity, null, ch.size);
      sites.push({ x, z, from: -Infinity, to: Infinity, next: -1, plots: [], ch });
    }
  } else {
    // the lines: each begins at its own phase below time 0, and the earliest next start is laid first, so a site
    // sees every site alive with it
    const lines = Array.from({ length: n }, (_, i) => ({ at: -worldDraw(epochMs, -900 - i, 1) * life, last: -1 }));
    for (let guard = 0; guard < 400; guard++) {
      let li = -1;
      for (let i = 0; i < n; i++) if (lines[i].at < depth && (li < 0 || lines[i].at < lines[li].at)) li = i;
      if (li < 0) break;
      const L = lines[li];
      const len = life * (0.6 + 0.8 * worldDraw(epochMs, -2000 - guard, 1));
      const prev = L.last >= 0 ? sites[L.last] : null;
      const moved = prev !== null && worldDraw(epochMs, -2000 - guard, 2) < carry;
      const ch = charOf(guard, moved ? prev : null);
      const [x, z] = seat(L.at, L.at + len, moved ? prev : null, ch.size);
      sites.push({ x, z, from: L.at, to: L.at + len, next: -1, plots: [], ch });
      if (prev) prev.next = sites.length - 1;
      L.last = sites.length - 1;
      // the next of the line comes a little before this one ends (the two are both lived in for a while)
      L.at += len - life * 0.1;
    }
  }
  // HOUSES: each site's plots on a ring round its open middle, evenly spaced with a little play
  const P = Math.max(0, Math.round(V.plots ?? 0));
  if (P > 0)
    sites.forEach((s, i) => {
      // (no more than fit on the ring PLOT_SPACING apart: closer, two houses would be built into one)
      // (a larger village: a wider ring and more houses on it)
      const ring0 = siteRadius(s, h) * 0.75, fit = Math.max(1, Math.floor((2 * Math.PI * ring0) / PLOT_SPACING));
      const m = Math.max(1, Math.min(fit, 12, Math.round(P * s.ch.size + (worldDraw(epochMs, -3000 - i, 1) - 0.5) * 2.2)));
      const a0 = worldDraw(epochMs, -3000 - i, 2) * 2 * Math.PI, ring = m === 1 ? 0 : ring0;
      for (let j = 0; j < m; j++) {
        const a = a0 + ((j + (worldDraw(epochMs, -3100 - i * 16 - j, 1) - 0.5) * 0.15) * 2 * Math.PI) / m;
        const r = ring * (0.92 + 0.16 * worldDraw(epochMs, -3100 - i * 16 - j, 2));
        s.plots.push([wrapCoord(s.x + Math.sin(a) * r), wrapCoord(s.z + Math.cos(a) * r)]);
      }
    });
  siteCache = { key, sites };
  return sites;
}

/** v's place in the block's time now (the seconds its samples carry: lifecycleActor). */
function blockSecOf(v: Visitor, wallMs: number, epochMs: number): number {
  const drift = (v.drift ?? 0) * ((wallMs - v.bornMs) / 1000);
  return Math.max(0, (wallMs - epochMs) / 1000 + v.off + (v.off < 0 ? Math.min(-v.off, drift) : 0));
}

/** The centre and radius of v's village, or null (no village). */
function villageOf(v: Visitor, epochMs: number, h: HerdConfig | undefined): { x: number; z: number; r: number; plots: [number, number][] } | null {
  if (v.vil === undefined || !h?.villages) return null;
  const s = villageSites(epochMs, h)[v.vil];
  return s ? { x: s.x, z: s.z, r: siteRadius(s, h), plots: s.plots } : null;
}

/**
 * A spot at a house plot of v's village (null: the village has none): its own plot with `own`, else any — and a plot
 * it has none of yet becomes its own. Within 0.8 of the plot's middle.
 */
function plotSpot(v: Visitor, vil: { plots: [number, number][] }, epochMs: number, own: number, s: number): [number, number] | null {
  const n = vil.plots.length;
  if (!n) return null;
  let i = v.plot !== undefined && v.plot < n && draw(v, epochMs, s) < own ? v.plot : Math.floor(draw(v, epochMs, s + 1) * n) % n;
  if (v.plot === undefined || v.plot >= n) v.plot = i;
  i = Math.min(n - 1, i);
  const p = vil.plots[i];
  return [wrapCoord(p[0] + (draw(v, epochMs, s + 2) - 0.5) * 1.6), wrapCoord(p[1] + (draw(v, epochMs, s + 3) - 0.5) * 1.6)];
}

/** A spot of v's village: within `share` of its radius, evenly over the disc (canonical). */
function spotIn(v: Visitor, vil: { x: number; z: number; r: number }, epochMs: number, share: number, s: number): [number, number] {
  const a = draw(v, epochMs, s) * 2 * Math.PI, d = vil.r * share * Math.sqrt(draw(v, epochMs, s + 1));
  return [wrapCoord(vil.x + Math.sin(a) * d), wrapCoord(vil.z + Math.cos(a) * d)];
}

/**
 * The village a new herd or loner joins at block time `t`: one alive then, weighted towards those with fewest of `kind`
 * living (1 / (1 + n)); none alive (past the top of the block) = the one whose span is nearest.
 */
function chooseVillage(v: Visitor, st: LifecycleState, epochMs: number, h: HerdConfig, kind: "leader" | "loner", t: number): number | undefined {
  const sites = villageSites(epochMs, h);
  if (!sites.length) return undefined;
  const alive: number[] = [];
  sites.forEach((s, i) => s.from <= t && t < s.to && alive.push(i));
  if (!alive.length) {
    let bi = 0, bd = Infinity;
    sites.forEach((s, i) => {
      const dd = t < s.from ? s.from - t : t - s.to;
      if (dd < bd) [bi, bd] = [i, dd];
    });
    return bi;
  }
  const living = new Map<number, number>();
  for (const p of st.present) if (p.kind === kind && p.vil !== undefined && p.id !== v.id) living.set(p.vil, (living.get(p.vil) ?? 0) + 1);
  let tot = 0;
  // (a larger village draws more people: its size over those living there)
  const ws = alive.map((i) => (tot += sites[i].ch.size / (1 + (living.get(i) ?? 0))));
  const u = draw(v, epochMs, 140) * tot;
  return alive[Math.max(0, ws.findIndex((w) => w >= u))];
}

/** A round of 3–4 spots of v's village (a tour herd's, again when its village is followed by another). */
function villageTour(v: Visitor, vil: { x: number; z: number; r: number; plots: [number, number][] }, epochMs: number): number[] {
  const n = 3 + Math.floor(draw(v, epochMs, 122) * 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(...(plotSpot(v, vil, epochMs, 0, 150 + 4 * i) ?? spotIn(v, vil, epochMs, 1, 150 + 2 * i)));
  return out;
}

/** One ground candidate for a new herd, by the config's way of choosing it. */
function groundCandidate(v: Visitor, places: readonly Place[], wallMs: number, epochMs: number, cfg: LifecycleConfig, h: HerdConfig, c: number): [number, number] {
  const even = (): [number, number] => {
    const a = draw(v, epochMs, 70 + c) * 2 * Math.PI, d = Math.max(0, h.originR) * Math.sqrt(draw(v, epochMs, 80 + c));
    return [wrapCoord(Math.sin(a) * d), wrapCoord(Math.cos(a) * d)];
  };
  const vil = villageOf(v, epochMs, h);
  if (vil) return plotSpot(v, vil, epochMs, 0, 70 + 4 * c) ?? spotIn(v, vil, epochMs, 0.7, 70 + 2 * c);
  if (h.origin === "doors") {
    if (draw(v, epochMs, 70 + c) < cfg.originShare) return [wrapCoord((draw(v, epochMs, 80 + c) - 0.5) * 4), wrapCoord((draw(v, epochMs, 90 + c) - 0.5) * 4)];
    const d = doorsOf(epochMs)[Math.min(3, Math.floor(draw(v, epochMs, 80 + c) * 4))];
    return [wrapCoord(d[0] + (draw(v, epochMs, 90 + c) - 0.5) * 3), wrapCoord(d[1] + (draw(v, epochMs, 100 + c) - 0.5) * 3)];
  }
  if (h.origin === "built" && places.length) {
    let tot = 0;
    const ws = places.map((p) => (tot += placeWeight(p, wallMs, cfg)));
    const u = draw(v, epochMs, 70 + c) * tot;
    const p = places[Math.max(0, ws.findIndex((w) => w >= u))];
    const a = draw(v, epochMs, 80 + c) * 2 * Math.PI, d = 3 + 9 * draw(v, epochMs, 90 + c);
    return [wrapCoord(p.x + Math.sin(a) * d), wrapCoord(p.z + Math.cos(a) * d)];
  }
  return even();
}

/**
 * Seats a new herd's leader in the block: its time (a band of the depth nobody is in, or anywhere), its ground, `gap`
 * away (3D) from the living herds if it can — the best of eight tries.
 */
function seatHerd(v: Visitor, st: LifecycleState, wallMs: number, epochMs: number, cfg: LifecycleConfig, h: HerdConfig): void {
  // THE BLOCK IS A FIXED PIECE OF SPACETIME (the artist, 2026-11-12: "정해진 시공간에서 태어났다가 나가는 건데 왜
  // 자꾸 위로 올라가는 거냐"): it is the times 0 … depthSec, whatever the clock says — a herd is born at a time of the
  // block (off = that time − now), lives its span upwards from there and is gone. Nothing follows the present: the
  // block does not climb with the clock. (A life begins low enough to end within the block.)
  const elapsed = Math.max(0, (wallMs - epochMs) / 1000);
  const depth = Math.max(0, h.depthSec);
  const span = Math.max(0, depth - v.lifeMs / 1000);
  const leaders = st.present.filter((p) => p.kind === "leader" && p.id !== v.id);
  const offNow = (p: Visitor) => p.off + (p.drift ?? 0) * ((wallMs - p.bornMs) / 1000);
  // STRATA: the bands of the depth and how many herds live in each
  const bands = Math.max(1, Math.round(h.count));
  const inBand = new Array<number>(bands).fill(0);
  if (depth > 0) for (const p of leaders) inBand[Math.min(bands - 1, Math.max(0, Math.floor(((elapsed + offNow(p)) / depth) * bands)))]++;
  const fewest = Math.min(...inBand);
  const free = inBand.map((n, i) => (n === fewest ? i : -1)).filter((i) => i >= 0);
  let best: [number, number, number] = [v.x, v.z, v.off], bestD = -1, bestVil: number | undefined;
  for (let c = 0; c < 8; c++) {
    let off = v.off;
    if (depth > 0) {
      if (h.layout === "strata") {
        const band = free[Math.min(free.length - 1, Math.floor(draw(v, epochMs, 60 + c) * free.length))];
        off = Math.min(span, ((band + draw(v, epochMs, 110 + c)) / bands) * depth) - elapsed;
      } else off = draw(v, epochMs, 60 + c) * span - elapsed;
    }
    // VILLAGES: one alive at this try's time (its ground candidates are spots of it)
    if (h.origin === "villages") v.vil = chooseVillage(v, st, epochMs, h, "leader", Math.max(0, elapsed + off));
    const [x, z] = groundCandidate(v, st.places, wallMs, epochMs, cfg, h, c);
    let dMin = Infinity;
    for (const p of leaders) dMin = Math.min(dMin, dist3(x, z, off, p.x, p.z, offNow(p), h));
    if (dMin > bestD) {
      bestD = dMin;
      best = [x, z, off];
      bestVil = v.vil;
    }
    if (dMin >= h.gap) break;
  }
  [v.x, v.z, v.off] = best;
  v.vil = bestVil;
  v.ex = v.x;
  v.ez = v.z;
  v.kind = "leader";
  v.drift = (draw(v, epochMs, 120) - 0.5) * 2 * Math.max(0, Math.min(0.9, h.drift));
  // HOW IT MOVES: one of three ways, by the shares (in a village: leaning as the village does, settlers or roamers)
  const site = v.vil !== undefined ? villageSites(epochMs, h)[v.vil] : undefined;
  const lean = site?.ch.settled ?? 0;
  const m = { settle: h.mix.settle * (1 + lean), roam: h.mix.roam * (1 - lean), tour: h.mix.tour };
  const tot = Math.max(1e-6, m.settle + m.roam + m.tour), u = draw(v, epochMs, 121) * tot;
  v.temper = u < m.settle ? "settle" : u < m.settle + m.roam ? "roam" : "tour";
  if (v.temper === "settle") v.ch = { ...v.ch, stayMean: Math.min(70, v.ch.stayMean * 2), range: Math.max(4, v.ch.range * 0.35), revisit: 0.7, follow: v.ch.follow * 0.3, wander: v.ch.wander * 0.5 };
  else if (v.temper === "roam") v.ch = { ...v.ch, stayMean: Math.max(4, v.ch.stayMean * 0.35), range: Math.min(90, v.ch.range * 2.2), revisit: 0, follow: v.ch.follow * 0.5, speed: v.ch.speed * 1.2 };
  else {
    v.ch = { ...v.ch, stayMean: v.ch.stayMean * 0.8, follow: 0, revisit: 0 };
    const vil = villageOf(v, epochMs, h);
    // in a village: its round is spots of the village
    const n = vil ? 0 : 3 + Math.floor(draw(v, epochMs, 122) * 2);
    v.tour = vil ? villageTour(v, vil, epochMs) : [];
    for (let i = 0; i < n; i++) {
      const a = draw(v, epochMs, 123 + i) * 2 * Math.PI, d = v.ch.range * (0.4 + 0.6 * draw(v, epochMs, 130 + i));
      v.tour.push(wrapCoord(v.ex + Math.sin(a) * d), wrapCoord(v.ez + Math.cos(a) * d));
    }
    v.ti = 0;
  }
  // its village's character: a staying village's people stay longer
  if (site) v.ch = { ...v.ch, stayMean: v.ch.stayMean * site.ch.stay };
  // a herd in the block dies where it stands (the doors are the old present's)
  v.leaves = false;
}

/** A loner of the population: seated like a herd of one (its own time and ground), nothing else changed. */
function seatLoner(v: Visitor, st: LifecycleState, wallMs: number, epochMs: number, cfg: LifecycleConfig, h: HerdConfig): void {
  const depth = Math.max(0, h.depthSec);
  // (a time of the fixed block, as a herd's: seatHerd)
  if (depth > 0) v.off = draw(v, epochMs, 60) * Math.max(0, depth - v.lifeMs / 1000) - Math.max(0, (wallMs - epochMs) / 1000);
  if (h.origin === "villages") v.vil = chooseVillage(v, st, epochMs, h, "loner", Math.max(0, (wallMs - epochMs) / 1000 + v.off));
  const site = v.vil !== undefined ? villageSites(epochMs, h)[v.vil] : undefined;
  if (site) v.ch = { ...v.ch, stayMean: v.ch.stayMean * site.ch.stay };
  [v.x, v.z] = groundCandidate(v, st.places, wallMs, epochMs, cfg, h, 0);
  v.ex = v.x;
  v.ez = v.z;
  v.kind = "loner";
  v.leaves = false;
}

/** A member of `lead`'s herd: a place within the herd's 3D radius (sideways and in time), a life about as long. */
function joinHerd(v: Visitor, lead: Visitor, wallMs: number, epochMs: number, h: HerdConfig, aheadSec: number): void {
  const a = draw(v, epochMs, 60) * 2 * Math.PI, r = Math.max(0, h.radius) * Math.cbrt(draw(v, epochMs, 61)), c = 2 * draw(v, epochMs, 62) - 1;
  const flat = r * Math.sqrt(1 - c * c);
  v.hx = Math.sin(a) * flat;
  v.hz = Math.cos(a) * flat;
  const elapsed = Math.max(0, (wallMs - epochMs) / 1000);
  // within the herd's radius in time too — but not before time 0, and no further ahead of the present than any bot
  v.off = Math.min(Math.max(lead.off, aheadSec), Math.max(-elapsed, lead.off + (h.metersPerSec > 0 ? (r * c) / h.metersPerSec : 0)));
  v.x = v.ex = wrapCoord(lead.x + v.hx);
  v.z = v.ez = wrapCoord(lead.z + v.hz);
  v.lifeMs = lead.lifeMs * (0.9 + 0.2 * draw(v, epochMs, 63));
  v.drift = lead.drift;
  v.vil = lead.vil;
  v.leaves = lead.leaves;
  v.door = lead.door;
  v.lead = lead.id;
  v.lag = (1 + v.j * (1 + 2 * draw(v, epochMs, 64))) * (1 + 3 * Math.max(0, h.loose) * draw(v, epochMs, 65));
  v.tx = v.x;
  v.tz = v.z;
  v.holdMs = 0;
}

/**
 * A member keeps with its leader: it heads for its own place around where the leader is staying or going, sets off
 * `lag` seconds after the leader's aim changed, and stands there for as long as the leader stays. True = it planned a route.
 */
function keepWithHerd(v: Visitor, lead: Visitor, st: LifecycleState, inp: LifecycleInputs, wallMs: number, cfg: LifecycleConfig, canRoute: boolean): boolean {
  const epochMs = st.epochMs;
  const end = lead.mode === "go" && lead.route && lead.route.length >= 2;
  const ax = lead.mode === "stay" ? lead.sx : end ? lead.route![lead.route!.length - 2] : lead.x;
  const az = lead.mode === "stay" ? lead.sz : end ? lead.route![lead.route!.length - 1] : lead.z;
  let tx = wrapCoord(ax + (v.hx ?? 0)), tz = wrapCoord(az + (v.hz ?? 0));
  if (v.tx === undefined || v.tz === undefined || wrapDist(tx, tz, v.tx, v.tz) > 1) {
    // the herd's aim moved: a loose member takes a new place around it (never further than the herd's radius, widened)
    const h = cfg.herd;
    if (h && h.loose > 0 && (lead.mode === "stay" || end)) {
      const a = draw(v, epochMs, 66) * 2 * Math.PI, r = h.radius * (1 + h.loose) * Math.sqrt(draw(v, epochMs, 67));
      v.hx = Math.sin(a) * r;
      v.hz = Math.cos(a) * r;
      tx = wrapCoord(ax + v.hx);
      tz = wrapCoord(az + v.hz);
    }
    v.tx = tx;
    v.tz = tz;
    v.holdMs = wallMs + (v.lag ?? 1) * 1000;
  }
  const hx = v.mode === "stay" ? v.sx : v.x, hz = v.mode === "stay" ? v.sz : v.z;
  if (wrapDist(hx, hz, v.tx, v.tz) <= 1.2) {
    // there: it stands with the herd
    if (v.mode !== "stay") startStay(v, wallMs, epochMs, 2);
    else v.untilMs = wallMs + 1000;
    return false;
  }
  if (wallMs < (v.holdMs ?? 0) || !canRoute) {
    // not yet: it waits where it is
    if (v.mode !== "stay") startStay(v, wallMs, epochMs, 1);
    else v.untilMs = wallMs + 1000;
    return false;
  }
  if (v.mode === "stay" && wallMs - v.sinceMs >= cfg.memory.staySec * 1000) {
    remember(st.places, v.sx, v.sz, wallMs, cfg);
    v.stops.push([v.sx, v.sz]);
  }
  const bx = nearestImage(v.tx, v.x), bz = nearestImage(v.tz, v.z);
  v.route = planWay(v, inp, wallMs, epochMs, cfg, bx, bz);
  v.along = 0;
  v.mode = "go";
  return true;
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

/**
 * VILLAGES, WAYS BETWEEN THEM: a roaming herd's leader or a loner, leaving a stay — at home it goes to a neighbour alive
 * at its time with `travel` (weight (1 + d / gap)^−3: the nearest by far the likeliest), away it goes home again half
 * the time (else it stays about the village it visits). Null = it goes about where it is.
 */
function villageTrip(v: Visitor, wallMs: number, epochMs: number, h: HerdConfig | undefined): [number, number] | null {
  if (!h?.villages || v.vil === undefined || !(v.temper === "roam" || v.kind === "loner")) return null;
  const home = v.home ?? v.vil;
  v.home = home;
  const sites = villageSites(epochMs, h);
  // (an open village's people go visiting more, a closed one's less)
  const travel = Math.max(0, Math.min(1, (h.villages.travel ?? 0) * (sites[home]?.ch.travel ?? 1)));
  if (!(travel > 0)) return null;
  if (v.vil !== home) {
    if (draw(v, epochMs, 160) >= 0.5) return null;
    v.vil = home;
  } else {
    if (draw(v, epochMs, 161) >= travel) return null;
    const t = blockSecOf(v, wallMs, epochMs), me = sites[home];
    if (!me) return null;
    const cands: number[] = [], ws: number[] = [];
    let tot = 0;
    sites.forEach((s, i) => {
      if (i === home || !(s.from <= t && t < s.to)) return;
      cands.push(i);
      ws.push((tot += Math.pow(1 + wrapDist(me.x, me.z, s.x, s.z) / Math.max(1, h.villages!.gap), -3)));
    });
    if (!cands.length) return null;
    const u = draw(v, epochMs, 162) * tot;
    v.vil = cands[Math.max(0, ws.findIndex((w) => w >= u))];
  }
  v.stops = [];
  v.plot = undefined;
  const vil = villageOf(v, epochMs, h);
  return vil ? plotSpot(v, vil, epochMs, 0, 163) ?? spotIn(v, vil, epochMs, 0.6, 163) : null;
}

/** Where `v` goes next: someone else's place, its own earlier place, or somewhere new within its range. */
function destination(v: Visitor, places: readonly Place[], attractors: readonly Attractor[], wallMs: number, epochMs: number, cfg: LifecycleConfig): [number, number] {
  // ON A ROUND: the next of its places
  if (v.tour && v.tour.length >= 2) {
    const n = v.tour.length / 2;
    v.ti = ((v.ti ?? 0) + 1) % n;
    return [wrapCoord(v.tour[v.ti * 2] + (draw(v, epochMs, 36) - 0.5)), wrapCoord(v.tour[v.ti * 2 + 1] + (draw(v, epochMs, 37) - 0.5))];
  }
  // VILLAGES: to a neighbour village and back (roamers, loners) …
  const trip = villageTrip(v, wallMs, epochMs, cfg.herd);
  if (trip) return trip;
  // … else it goes about inside its village — at its houses (a settler mostly at its own), or, without houses, the
  // places it follows are the village's, a new place a spot of it
  const vil = villageOf(v, epochMs, cfg.herd);
  const house = vil ? plotSpot(v, vil, epochMs, v.temper === "settle" ? 0.75 : 0.35, 170) : null;
  if (house) return house;
  if (draw(v, epochMs, 30) < v.ch.follow) {
    const cands: [number, number, number][] = [];
    for (const p of places) if (!vil || wrapDist(p.x, p.z, vil.x, vil.z) <= vil.r * 1.2) cands.push([p.x, p.z, placeWeight(p, wallMs, cfg)]);
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
  if (vil) return spotIn(v, vil, epochMs, 1, 38);
  const a = draw(v, epochMs, 38) * 2 * Math.PI, d = v.ch.range * Math.sqrt(draw(v, epochMs, 39));
  return [wrapCoord(v.ex + Math.sin(a) * d), wrapCoord(v.ez + Math.cos(a) * d)];
}

/** Smooth 1D value noise, 0..1 (a road's slow swing). */
function swing(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const a = hash2(i, seed, 173), b = hash2(i + 1, seed, 173);
  return a + (b - a) * u;
}

/**
 * The way from where v is to (bx, bz) (nearest images). In villages (HerdConfig.villages): a LANE when both ends are in
 * its village — through the court's middle, no grid search; a ROAD when one end is not — the caller's search through a
 * slowly drifting waypoint between the two villages (`fluid`). Otherwise the caller's search (or straight).
 */
function planWay(v: Visitor, inp: LifecycleInputs, wallMs: number, epochMs: number, cfg: LifecycleConfig, bx: number, bz: number): number[] {
  const sec = (wallMs - epochMs) / 1000 + v.off;
  const search = (ax: number, az: number, cx: number, cz: number) => (inp.planRoute ? inp.planRoute(ax, az, cx, cz, sec) : [ax, az, cx, cz]);
  const h = cfg.herd;
  const vil = villageOf(v, epochMs, h);
  if (!vil || !h?.villages) return search(v.x, v.z, bx, bz);
  const near = (x: number, z: number) => wrapDist(x, z, vil.x, vil.z) <= vil.r * 1.3;
  const inA = near(v.x, v.z), inB = near(wrapCoord(bx), wrapCoord(bz));
  if (inA && inB) {
    // LANE: straight when the two ends are near each other (one house), else by the court's middle
    if (Math.hypot(bx - v.x, bz - v.z) < vil.r * 0.5) return [v.x, v.z, bx, bz];
    const cx = nearestImage(vil.x, v.x) + (draw(v, epochMs, 180) - 0.5) * 1.2, cz = nearestImage(vil.z, v.z) + (draw(v, epochMs, 181) - 0.5) * 1.2;
    return [v.x, v.z, cx, cz, bx, bz];
  }
  // ROAD between two villages: the one it leaves (nearest to it) and the one it goes to (or the other way round)
  const sites = villageSites(epochMs, h);
  const nearestSite = (x: number, z: number) => {
    let bi = -1, bd = Infinity;
    sites.forEach((q, i) => {
      const d = wrapDist(x, z, q.x, q.z);
      if (d < bd) [bi, bd] = [i, d];
    });
    return bi;
  };
  const i = nearestSite(v.x, v.z), j = nearestSite(wrapCoord(bx), wrapCoord(bz));
  const fluid = Math.max(0, Math.min(1, h.villages.fluid ?? 0));
  if (i < 0 || j < 0 || i === j || !(fluid > 0)) return search(v.x, v.z, bx, bz);
  // the waypoint: the middle, swung across the line from the lower-numbered village to the other (the same side
  // whichever way it is walked), drifting with the block's time
  const [lo, hi] = i < j ? [sites[i], sites[j]] : [sites[j], sites[i]];
  const lx = nearestImage(lo.x, v.x), lz = nearestImage(lo.z, v.z), hx = nearestImage(hi.x, lx), hz = nearestImage(hi.z, lz);
  const L = Math.hypot(hx - lx, hz - lz);
  if (L < 1) return search(v.x, v.z, bx, bz);
  const side = (swing(Math.max(0, sec) / 150, Math.min(i, j) * 977 + Math.max(i, j)) - 0.5) * 2 * fluid * 0.35 * L;
  const along = 0.5 + (swing(Math.max(0, sec) / 210, Math.min(i, j) * 911 + Math.max(i, j) + 7) - 0.5) * 0.3 * fluid;
  const wx = lx + (hx - lx) * along + (-(hz - lz) / L) * side, wz = lz + (hz - lz) * along + ((hx - lx) / L) * side;
  const a = search(v.x, v.z, wx, wz), b = search(wx, wz, bx, bz);
  return [...a, ...b.slice(2)];
}

/** What `v` does when its LOOK or STAY is over, or it has arrived. Returns true when it planned a route. */
function next(v: Visitor, st: LifecycleState, inp: LifecycleInputs, wallMs: number, cfg: LifecycleConfig, canRoute: boolean): boolean {
  const epochMs = st.epochMs;
  if (v.mode === "go" && (v.met || draw(v, epochMs, 40) < 0.75)) {
    // arrived: usually it stays (at a building it stopped at on its way, always)
    v.met = false;
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
  let bx = nearestImage(tx, v.x), bz = nearestImage(tz, v.z);
  // a building on the way: stop there and stay, or go round it
  if (inp.meet && (cfg.meetStay ?? 0) > 0) {
    const hit = inp.meet(v.x, v.z, bx, bz, (wallMs - epochMs) / 1000 + v.off);
    if (hit && draw(v, epochMs, 45) < cfg.meetStay!) {
      bx = nearestImage(hit[0], v.x);
      bz = nearestImage(hit[1], v.z);
      v.met = true;
    }
  }
  v.route = planWay(v, inp, wallMs, epochMs, cfg, bx, bz);
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

  const nowSec = Math.floor((wallMs - epochMs) / 1000);
  const hc = cfg.herd;
  if (hc) {
    // THE POPULATION: `count` herds and `loners` bots; who is gone is replaced — a herd at the seconds ≡ 0 (mod 4),
    // a loner at ≡ 3, one at a time (so the draws of those born in one second never overlap, and nobody comes in a crowd)
    for (let sec = Math.max(st.lastSec + 1, nowSec - 600); sec <= nowSec; sec++) {
      if (sec % 4 === 0 && st.present.filter((p) => p.kind === "leader").length < herdsWanted(sec, hc)) {
        const lo = Math.max(1, Math.round(Math.min(hc.sizeMin, hc.sizeMax))), hi = Math.max(lo, Math.min(12, Math.round(Math.max(hc.sizeMin, hc.sizeMax))));
        const n = Math.min(hi, lo + Math.floor(worldDraw(epochMs, sec, 12) * (hi - lo + 1)));
        // a herd comes whole or not at all
        if (st.present.length + n > cap) {
          st.turnedAway += n;
          continue;
        }
        let lead: Visitor | null = null;
        for (let j = 0; j < n; j++) {
          const v = bornAt(sec, j, wallMs, epochMs, cfg, lead ? [lead.x, lead.z] : undefined);
          if (!lead) seatHerd(v, st, wallMs, epochMs, cfg, hc);
          else joinHerd(v, lead, wallMs, epochMs, hc, cfg.timeSpreadSec);
          if (!lead) lead = v;
          st.present.push(v);
          arrivals.push(v);
          st.arrived++;
        }
      } else if (sec % 4 === 3 && st.present.filter((p) => p.kind === "loner").length < Math.round(hc.loners) && st.present.length < cap) {
        const v = bornAt(sec, 0, wallMs, epochMs, cfg);
        seatLoner(v, st, wallMs, epochMs, cfg, hc);
        st.present.push(v);
        arrivals.push(v);
        st.arrived++;
      }
    }
  } else
    // ARRIVALS BY RATE: one draw for every second since the last step (a catch-up draws each of them)
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
  const doors = doorsOf(epochMs);
  const byId = new Map(st.present.map((v) => [v.id, v] as const));
  for (const v of st.present) {
    // HERD: a member whose leader is gone goes on by itself
    const leader = v.lead ? byId.get(v.lead) : undefined;
    if (v.lead && !leader) v.lead = undefined;
    // VILLAGES IN TIME: its village has ended at its time — it goes over to the one that follows (a member: its
    // leader's); a stay is cut short so it sets off now, a round is laid anew in the new village
    if (hc && v.vil !== undefined) {
      const sites = villageSites(epochMs, hc);
      const t = blockSecOf(v, wallMs, epochMs);
      const after = (i: number) => (sites[i] && sites[i].next >= 0 && t >= sites[i].to ? sites[i].next : i);
      // its home too (a roamer away from it comes back to the one that follows it)
      if (v.home !== undefined) v.home = after(v.home);
      const to = leader ? leader.vil : after(v.vil);
      if (to !== undefined && to !== v.vil) {
        v.vil = to;
        // its own earlier places (and its house) were the old village's
        v.stops = [];
        v.plot = undefined;
        const nv = villageOf(v, epochMs, hc);
        if (nv && v.tour) {
          v.tour = villageTour(v, nv, epochMs);
          v.ti = v.tour.length / 2 - 1;
        }
        if (!leader && v.mode !== "go") v.untilMs = wallMs;
      }
    }
    // the end draws near: it slows as a visitor's controls do (session.ts lifeAt warn)
    const left = (v.lifeMs - (wallMs - v.bornMs)) / 1000;
    // LEAVING: time to walk out — to its own door, else the nearest — when the life left is about the walk there
    // (the way round is ~1.3 × the straight line; the end's slowing adds a little)
    if (v.leaves && !v.leaving && left <= cfg.leaveSec && routes < maxRoutes) {
      let d = v.door >= 0 ? doors[v.door] : doors[0];
      if (v.door < 0) for (const c of doors) if (wrapDist(v.x, v.z, c[0], c[1]) < wrapDist(v.x, v.z, d[0], d[1])) d = c;
      const walk = (wrapDist(v.x, v.z, d[0], d[1]) * 1.3) / Math.max(0.3, cfg.speed * v.ch.speed * 0.8) + 2;
      if (left <= walk) {
        const bx = nearestImage(d[0], v.x), bz = nearestImage(d[1], v.z);
        v.route = inp.planRoute ? inp.planRoute(v.x, v.z, bx, bz, (wallMs - epochMs) / 1000 + v.off) : [v.x, v.z, bx, bz];
        v.along = 0;
        v.mode = "go";
        v.leaving = true;
        routes++;
      }
    }
    const t = cfg.warnSec > 0 ? Math.max(0, Math.min(1, 1 - left / cfg.warnSec)) : 0;
    const speed = cfg.speed * v.ch.speed * (1 - 0.6 * t * t);
    if (v.mode === "go") {
      const route = v.route ?? [v.x, v.z, v.x, v.z];
      v.along += speed * dt;
      const L = routeLength(route);
      if (v.along >= L) {
        v.x = wrapCoord(route[route.length - 2]);
        v.z = wrapCoord(route[route.length - 1]);
        // out through the door: the life ends here (it is gone at the next step)
        if (v.leaving) {
          v.lifeMs = Math.min(v.lifeMs, wallMs - v.bornMs);
          continue;
        }
        if (leader) startStay(v, wallMs, epochMs, 2);
        else if (next(v, st, inp, wallMs, cfg, routes < maxRoutes)) routes++;
      } else {
        const [x, z] = pointAlong(route, v.along);
        v.x = wrapCoord(x);
        v.z = wrapCoord(z);
      }
      continue;
    }
    if (v.mode === "look") {
      v.head += (draw(v, epochMs, 50) - 0.5) * 1.2 * (0.3 + v.ch.wander);
      // VILLAGES: looking about past the village's edge, it turns back towards its middle
      const vil = villageOf(v, epochMs, hc);
      if (vil && wrapDist(v.x, v.z, vil.x, vil.z) > vil.r) v.head = Math.atan2(nearestImage(vil.x, v.x) - v.x, nearestImage(vil.z, v.z) - v.z);
      v.x = wrapCoord(v.x + Math.sin(v.head) * speed * 0.6 * dt);
      v.z = wrapCoord(v.z + Math.cos(v.head) * speed * 0.6 * dt);
    } else {
      // staying: swaying a little about the spot
      v.x = wrapCoord(v.sx + (draw(v, epochMs, 51) - 0.5) * 0.3);
      v.z = wrapCoord(v.sz + (draw(v, epochMs, 52) - 0.5) * 0.3);
    }
    if (leader && !v.leaving) {
      if (keepWithHerd(v, leader, st, inp, wallMs, cfg, routes < maxRoutes)) routes++;
      continue;
    }
    if (wallMs >= v.untilMs && next(v, st, inp, wallMs, cfg, routes < maxRoutes)) routes++;
  }
  return { state: st, arrivals, departures };
}

/** A bot as an actor at wall time `wallMs`: its presence sample (a worker, at its own assigned time). */
export function lifecycleActor(v: Visitor, wallMs: number, epochMs: number): Actor {
  // a herd may rise a little faster or slower than the clock (drift) — never before time 0, never ahead of its start
  const drift = (v.drift ?? 0) * ((wallMs - v.bornMs) / 1000);
  const s = sessionSeconds(wallMs, epochMs, v.off + (v.off < 0 ? Math.min(-v.off, drift) : 0));
  return { o: v.id, r: "worker", x: v.x, z: v.z, s: Math.max(0, s) };
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
  for (const v of s.present) if (typeof v?.id !== "string" || typeof v.x !== "number" || typeof v.lifeMs !== "number" || !v.ch || typeof v.leaves !== "boolean") return null;
  return s;
}
