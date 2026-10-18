/**
 * parliament/population.ts — the RESIDENT POPULATION of the shared world (V2): bots that are always there, each with
 * its own lifespan and its own ways, so the ground is lived in whether or not a visitor is playing.
 *
 *   LIFE      every resident lives `lifeSec` (4–8 min, drawn at birth); when it is over it dies where it stands and a
 *             new one is born in its place in the population — somewhere else in the world, with a NEW id (the id is
 *             its motif and its home key, so every generation sounds and builds a little differently)
 *   ROLES     drawn at birth from `roles` (worker the majority); each role has its HABIT (speed, how social, how long
 *             it stays, how far it steps about while staying); a tree is rooted where it was born
 *   TRIPS     a resident is either TRAVELLING to an anchor (along a route: the caller's planRoute, e.g. the trodden
 *             ground and round the buildings) or STAYING at it (stepping about within `hop` of it, standing between)
 *   SOCIAL    when it leaves it goes, mostly, to COMPANY — another resident who is staying, a visitor, a building
 *             in use (weighted, nearer a little preferred) — otherwise somewhere else in the world (exploring, far);
 *             it stays long when others are near (`nearR`: what the building rule counts), and leaves soon when it is
 *             alone there: so staying together, and building together, happens often; leaving happens too
 *   TIME      a resident's assigned time is the player's at its birth ± timeSpread/2, fixed for its life
 *   COUNT     `capacity` residents (min … max); the caller moves it with the frame rate (nextCapacity): fewer when
 *             frames are slow, more when there is room
 *
 * PURE and DETERMINISTIC: the state is plain data (JSON) and `stepPopulation(state, wallMs, inputs)` returns the next
 * one; every random choice is a hash of (the resident's birth number, its draw counter, the epoch). No Math.random,
 * no clock. The player tab runs it now (November, one iMac); the shared-world server can run the same function
 * (December, docs/sync-server.md). Distances are the shortest way round the torus (world.ts).
 */

import { sessionSeconds } from "./clock";
import { hash2 } from "./nature";
import { WORLD_SIZE, nearestImage, wrapCoord, wrapDist } from "./world";
import type { Actor } from "./bots";
import type { RoleId } from "./types";

export interface Habit {
  /** World units per second while travelling (0 = rooted). */
  speed: number;
  /** 0 … 1: how much of its leaving goes to company (multiplies PopulationConfig.social). */
  social: number;
  /** Seconds it stays at an anchor at most, [min, max] (drawn on arrival). */
  stay: [number, number];
  /** Seconds alone at an anchor after which it leaves, [min, max]. */
  alone: [number, number];
  /** How far (world) it steps about its anchor while staying. */
  hop: number;
  /** Seconds between those steps, [min, max]. */
  hopEvery: [number, number];
}

const WORKER: Habit = { speed: 2.2, social: 1, stay: [60, 180], alone: [12, 35], hop: 1.2, hopEvery: [4, 14] };

export const HABITS: Record<RoleId, Habit> = {
  worker: WORKER,
  cat: { speed: 3.2, social: 0.45, stay: [15, 45], alone: [8, 25], hop: 3, hopEvery: [2, 8] },
  car: { speed: 5, social: 0.3, stay: [3, 12], alone: [3, 12], hop: 0, hopEvery: [60, 60] },
  tree: { speed: 0, social: 0, stay: [0, 0], alone: [0, 0], hop: 0, hopEvery: [60, 60] },
  shepherd: WORKER,
  wolf: WORKER,
  warrior: WORKER,
};

export interface PopulationConfig {
  /** Fewest and most residents (the frame rate moves the count between them). */
  min: number;
  max: number;
  /** Lifespan (s), [min, max], drawn at birth. */
  lifeSec: [number, number];
  /** Each resident's assigned time is the player's ± timeSpread/2 (drawn at birth). */
  timeSpread: number;
  /** 0 … 1: share of trips that go to company (times the role's habit). */
  social: number;
  /** Others within this distance (world) are company: the building rule's ball (FoldConfig.radius). */
  nearR: number;
  /** The roles residents are born as, with weights. */
  roles: readonly (readonly [RoleId, number])[];
}

export const DEFAULT_POPULATION: PopulationConfig = {
  min: 6,
  max: 24,
  lifeSec: [240, 480],
  timeSpread: 60,
  social: 0.75,
  nearR: 3,
  roles: [
    ["worker", 0.6],
    ["cat", 0.15],
    ["car", 0.15],
    ["tree", 0.1],
  ],
};

export interface Resident {
  /** Birth number (unique in the epoch): the id is `bot${n}`. */
  n: number;
  role: RoleId;
  bornMs: number;
  lifeMs: number;
  /** Its assigned-time offset (s): the player's at its birth ± timeSpread/2, then fixed — a new visitor (another
   *  offset) does not make every resident jump in time; the next generations are born around the new one. */
  off: number;
  /** Where it is (canonical). */
  x: number;
  z: number;
  mode: "travel" | "stay";
  /** The anchor it travels to / stays at (canonical). */
  ax: number;
  az: number;
  /** TRAVEL: the route (x, z pairs, continuous — may run past the edge) and how far along it is (world units). */
  route: number[] | null;
  along: number;
  /** STAY: when it leaves at the latest, when it leaves if it is still alone (lonelySince + aloneMs), the step it is
   *  walking to and when it takes the next. */
  untilMs: number;
  aloneMs: number;
  lonelySince: number | null;
  hx: number;
  hz: number;
  hopAtMs: number;
  /** Draws made so far (the hash counter). */
  k: number;
}

export interface PopulationState {
  epochMs: number;
  /** Wall ms of the last step. */
  lastMs: number;
  /** The next birth number. */
  nextN: number;
  capacity: number;
  residents: Resident[];
}

/** Somewhere others are (not residents): a visitor (weight ~3), a building in use (~1.5). */
export interface Site {
  x: number;
  z: number;
  w: number;
  /** A person (counts as company); a building does not. */
  person: boolean;
}

export interface StepInputs {
  /** The player's assigned-time offset now (s): the newborn are born around it. */
  refOffset?: number;
  /** Visitors and buildings in use, besides the residents themselves. */
  sites?: readonly Site[];
  /** The way from A to B for a role (a polyline from A to B, continuous coordinates); absent = straight. */
  planRoute?: (ax: number, az: number, bx: number, bz: number, role: RoleId) => number[];
  /** Most departures (routes planned) in one step; the others wait for the next (a route costs a few ms). */
  maxDepartures?: number;
}

/** Default of StepInputs.maxDepartures. */
export const MAX_DEPARTURES = 2;

export interface StepResult {
  state: PopulationState;
  /** Residents who died in this step (where they stood): their END events. */
  deaths: Resident[];
  births: Resident[];
}

/** An exploring trip goes this far (world units, [min, max]): a third of the world and more, in any direction. */
const EXPLORE: [number, number] = [24, 56];
/** Company further than this (world units) is not gone to (the route would be long; someone nearer will be). */
const COMPANY_REACH = 70;

/** Who counts as company (someone to go to, someone to stay with): not a tree (rooted), not a car (passing). */
const keepsCompany = (r: RoleId) => r !== "tree" && r !== "car";

// ── random draws ────────────────────────────────────────────────────────────

const epochSalt = (epochMs: number) => Math.floor(epochMs / 1000) % 1_000_003;

/** The resident's next draw, 0..1 (advances its counter). */
function draw(r: Resident, epochMs: number, salt: number): number {
  return hash2(r.n, r.k++, epochSalt(epochMs) * 7 + salt);
}
const range = (u: number, [a, b]: readonly [number, number]) => a + (b - a) * u;

function pickRole(u: number, roles: PopulationConfig["roles"]): RoleId {
  let total = 0;
  for (const [, w] of roles) total += Math.max(0, w);
  let acc = 0;
  for (const [r, w] of roles) {
    acc += Math.max(0, w) / Math.max(1e-9, total);
    if (u < acc) return r;
  }
  return roles[roles.length - 1]?.[0] ?? "worker";
}

// ── birth, trips, stays ─────────────────────────────────────────────────────

function born(n: number, wallMs: number, epochMs: number, cfg: PopulationConfig, refOffset: number, ageShare = 0): Resident {
  const salt = epochSalt(epochMs);
  const u = (i: number) => hash2(n, i, salt * 13 + 5);
  const role = pickRole(u(0), cfg.roles);
  const lifeMs = range(u(1), cfg.lifeSec) * 1000;
  const x = wrapCoord((u(2) - 0.5) * WORLD_SIZE), z = wrapCoord((u(3) - 0.5) * WORLD_SIZE);
  return {
    n,
    role,
    // a resident of the first population is met at some age, so they do not all die together
    bornMs: wallMs - ageShare * lifeMs,
    lifeMs,
    off: Math.max(0, refOffset + (u(4) - 0.5) * cfg.timeSpread),
    x,
    z,
    mode: "stay",
    ax: x,
    az: z,
    route: null,
    along: 0,
    untilMs: wallMs, // leaves at once (a tree never does)
    aloneMs: 0,
    lonelySince: null,
    hx: x,
    hz: z,
    hopAtMs: wallMs,
    k: 8,
  };
}

/** Where `r` goes next: company (mostly) or anywhere (exploring). */
function nextAnchor(r: Resident, others: readonly Resident[], sites: readonly Site[], epochMs: number, cfg: PopulationConfig): [number, number] {
  const habit = HABITS[r.role];
  if (draw(r, epochMs, 1) < cfg.social * habit.social) {
    // company: residents staying (or arriving), visitors, buildings in use — weighted, nearer a little preferred
    const cands: [number, number, number][] = [];
    for (const o of others) {
      if (o.n === r.n || !keepsCompany(o.role)) continue; // a tree or a car is no one to stay with
      const w = o.mode === "stay" ? 1.5 : 0.5;
      if (wrapDist(r.x, r.z, o.ax, o.az) <= COMPANY_REACH) cands.push([o.ax, o.az, w]);
    }
    for (const s of sites) if (wrapDist(r.x, r.z, s.x, s.z) <= COMPANY_REACH) cands.push([s.x, s.z, s.w]);
    let total = 0;
    const ws = cands.map(([x, z, w]) => {
      const v = w / (1 + wrapDist(r.x, r.z, x, z) / 40);
      total += v;
      return v;
    });
    if (total > 0) {
      let u = draw(r, epochMs, 2) * total;
      for (let i = 0; i < cands.length; i++) {
        u -= ws[i];
        if (u <= 0 || i === cands.length - 1) {
          // a little to the side of them (within the building ball, not on top)
          const a = draw(r, epochMs, 3) * 2 * Math.PI, d = 0.6 + 1.2 * draw(r, epochMs, 4);
          return [wrapCoord(cands[i][0] + Math.sin(a) * d), wrapCoord(cands[i][1] + Math.cos(a) * d)];
        }
      }
    }
  }
  // exploring: somewhere else, EXPLORE[0] … EXPLORE[1] away in any direction (far, but a route that long stays cheap)
  const a = draw(r, epochMs, 5) * 2 * Math.PI, d = range(draw(r, epochMs, 6), EXPLORE);
  return [wrapCoord(r.x + Math.sin(a) * d), wrapCoord(r.z + Math.cos(a) * d)];
}

function routeLength(route: readonly number[]): number {
  let L = 0;
  for (let k = 2; k < route.length; k += 2) L += Math.hypot(route[k] - route[k - 2], route[k + 1] - route[k - 1]);
  return L;
}

function pointAlong(route: readonly number[], d: number): [number, number] {
  let left = Math.max(0, d);
  for (let k = 2; k < route.length; k += 2) {
    const seg = Math.hypot(route[k] - route[k - 2], route[k + 1] - route[k - 1]);
    if (left <= seg) {
      const t = seg > 0 ? left / seg : 1;
      return [route[k - 2] + (route[k] - route[k - 2]) * t, route[k - 1] + (route[k + 1] - route[k - 1]) * t];
    }
    left -= seg;
  }
  return [route[route.length - 2], route[route.length - 1]];
}

function depart(r: Resident, others: readonly Resident[], inp: StepInputs, epochMs: number, cfg: PopulationConfig) {
  const [tx, tz] = nextAnchor(r, others, inp.sites ?? [], epochMs, cfg);
  // the nearest image of the anchor: the short way round the torus
  const bx = nearestImage(tx, r.x), bz = nearestImage(tz, r.z);
  r.route = inp.planRoute ? inp.planRoute(r.x, r.z, bx, bz, r.role) : [r.x, r.z, bx, bz];
  r.along = 0;
  r.ax = tx;
  r.az = tz;
  r.mode = "travel";
}

function arrive(r: Resident, wallMs: number, epochMs: number) {
  const habit = HABITS[r.role];
  r.mode = "stay";
  r.route = null;
  r.along = 0;
  r.untilMs = wallMs + range(draw(r, epochMs, 7), habit.stay) * 1000;
  r.aloneMs = range(draw(r, epochMs, 8), habit.alone) * 1000;
  r.lonelySince = null;
  r.hx = r.x;
  r.hz = r.z;
  r.hopAtMs = wallMs + range(draw(r, epochMs, 9), habit.hopEvery) * 1000;
}

/** People (residents who keep company, and visitor sites) within nearR of (x, z), not counting resident n. */
function companyAt(x: number, z: number, n: number, residents: readonly Resident[], sites: readonly Site[], nearR: number): number {
  let c = 0;
  for (const o of residents) if (o.n !== n && keepsCompany(o.role) && wrapDist(x, z, o.x, o.z) <= nearR) c++;
  for (const s of sites) if (s.person && wrapDist(x, z, s.x, s.z) <= nearR) c++;
  return c;
}

// ── the population ──────────────────────────────────────────────────────────

/** The first population: `capacity` residents met at random ages. */
export function initPopulation(epochMs: number, wallMs: number, capacity: number, cfg: PopulationConfig = DEFAULT_POPULATION, refOffset = 0): PopulationState {
  const cap = Math.max(cfg.min, Math.min(cfg.max, Math.round(capacity)));
  const residents: Resident[] = [];
  for (let n = 0; n < cap; n++) residents.push(born(n, wallMs, epochMs, cfg, refOffset, hash2(n, 3, epochSalt(epochMs)) * 0.85));
  return { epochMs, lastMs: wallMs, nextN: cap, capacity: cap, residents };
}

/**
 * The population one step on, at wall time `wallMs` (steps are the presence samples, ~1 s; a late step simply covers
 * a longer time). Order: deaths (and the population brought to `capacity`: deaths of the last-born when it is over,
 * one birth per step when it is under), then every resident moves — staying ones step about and maybe leave,
 * travelling ones go on along their route and maybe arrive. At most `maxDepartures` leave in one step (planning a
 * route costs a few ms; the rest leave in the next steps).
 */
export function stepPopulation(prev: PopulationState, wallMs: number, inp: StepInputs = {}, cfg: PopulationConfig = DEFAULT_POPULATION): StepResult {
  const dt = Math.max(0, (wallMs - prev.lastMs) / 1000);
  const epochMs = prev.epochMs;
  const sites = inp.sites ?? [];
  const deaths: Resident[] = [];
  const births: Resident[] = [];
  let nextN = prev.nextN;
  // copies: the step returns a new state
  let residents = prev.residents.map((r) => ({ ...r, route: r.route ? r.route.slice() : null }));

  // LIFE: who has lived their span dies; a new one is born in their place
  residents = residents.map((r) => {
    if (wallMs - r.bornMs < r.lifeMs) return r;
    deaths.push(r);
    const b = born(nextN++, wallMs, epochMs, cfg, inp.refOffset ?? 0);
    births.push(b);
    return b;
  });
  // COUNT
  const cap = Math.max(cfg.min, Math.min(cfg.max, Math.round(prev.capacity)));
  while (residents.length > cap) {
    // the youngest go first (they have the least to leave)
    let yi = 0;
    for (let i = 1; i < residents.length; i++) if (residents[i].bornMs > residents[yi].bornMs) yi = i;
    deaths.push(residents[yi]);
    residents.splice(yi, 1);
  }
  if (residents.length < cap) {
    const b = born(nextN++, wallMs, epochMs, cfg, inp.refOffset ?? 0);
    births.push(b);
    residents.push(b);
  }

  // MOVE
  let departures = 0;
  const maxDepartures = Math.max(1, inp.maxDepartures ?? MAX_DEPARTURES);
  for (const r of residents) {
    const habit = HABITS[r.role];
    if (habit.speed === 0) continue; // rooted
    if (r.mode === "stay") {
      // company now? alone too long, or stayed long enough → leave
      const company = companyAt(r.x, r.z, r.n, residents, sites, cfg.nearR * 1.2);
      if (company > 0) r.lonelySince = null;
      else if (r.lonelySince === null) r.lonelySince = wallMs;
      const lonely = r.lonelySince !== null && wallMs - r.lonelySince >= r.aloneMs;
      if ((wallMs >= r.untilMs || lonely) && departures < maxDepartures) {
        departures++;
        depart(r, residents, inp, epochMs, cfg);
      } else {
        // stepping about the anchor, standing between the steps
        if (habit.hop > 0 && wallMs >= r.hopAtMs) {
          const a = draw(r, epochMs, 10) * 2 * Math.PI, d = habit.hop * Math.sqrt(draw(r, epochMs, 11));
          r.hx = wrapCoord(r.ax + Math.sin(a) * d);
          r.hz = wrapCoord(r.az + Math.cos(a) * d);
          r.hopAtMs = wallMs + range(draw(r, epochMs, 12), habit.hopEvery) * 1000;
        }
        const tx = nearestImage(r.hx, r.x), tz = nearestImage(r.hz, r.z);
        const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
        const step = Math.min(d, 0.8 * dt);
        if (d > 1e-6) {
          r.x = wrapCoord(r.x + (dx / d) * step);
          r.z = wrapCoord(r.z + (dz / d) * step);
        }
        continue;
      }
    }
    // TRAVEL
    const route = r.route ?? [r.x, r.z, r.ax, r.az];
    r.along += habit.speed * dt;
    const L = routeLength(route);
    if (r.along >= L) {
      r.x = wrapCoord(route[route.length - 2]);
      r.z = wrapCoord(route[route.length - 1]);
      arrive(r, wallMs, epochMs);
    } else {
      const [x, z] = pointAlong(route, r.along);
      r.x = wrapCoord(x);
      r.z = wrapCoord(z);
    }
  }

  return { state: { epochMs, lastMs: wallMs, nextN, capacity: cap, residents }, deaths, births };
}

/** A resident as an actor at wall time `wallMs`: its presence sample at its own assigned time. */
export function residentActor(r: Resident, wallMs: number, epochMs: number): Actor {
  return { o: `bot${r.n}`, r: r.role, x: r.x, z: r.z, s: sessionSeconds(wallMs, epochMs, r.off) };
}

/**
 * The population size after a minute of frames: `slowPerMin` = frames longer than 50 ms in the last minute. Down
 * by 2 when it lags (> 8), by 1 when it is a little heavy (> 3), up by 1 when it runs clean (0 – 1); between, kept.
 */
export function nextCapacity(cur: number, slowPerMin: number, cfg: Pick<PopulationConfig, "min" | "max"> = DEFAULT_POPULATION): number {
  let n = cur;
  if (slowPerMin > 8) n -= 2;
  else if (slowPerMin > 3) n -= 1;
  else if (slowPerMin <= 1) n += 1;
  return Math.max(cfg.min, Math.min(cfg.max, n));
}

/** The state from storage, or null when it is not a population (or another epoch's). */
export function readPopulation(raw: unknown, epochMs: number): PopulationState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as PopulationState;
  if (s.epochMs !== epochMs || !Array.isArray(s.residents) || typeof s.lastMs !== "number" || typeof s.nextN !== "number") return null;
  for (const r of s.residents) if (typeof r?.n !== "number" || typeof r.x !== "number" || typeof r.z !== "number" || typeof r.role !== "string" || typeof r.off !== "number") return null;
  return s;
}
