/**
 * parliament/types.ts
 *
 * "Parliament of things": every visitor is given one ROLE; the role decides which trace the
 * visitor's movement leaves in the shared ground. The world is an append-only log of
 * spacetime events (x, z, s); everything that is drawn is a pure fold over that log.
 *
 * Time (s) is the visitor's ASSIGNED exhibition time, not the wall clock (see clock.ts):
 * later arrivals tend to be assigned later times, and a visitor only sees events with
 * s <= their own current time. That is what makes the ground a stratum.
 */

export type RoleId = "shepherd" | "wolf" | "worker" | "warrior" | "tree";

export const ROLES: readonly RoleId[] = ["shepherd", "wolf", "worker", "warrior", "tree"];

/** Which roles already have an effect in the fold (the rest only leave presence events). */
export const ROLE_IMPLEMENTED: Record<RoleId, boolean> = {
  shepherd: false,
  wolf: false,
  worker: true,
  warrior: false,
  tree: false,
};

/**
 * One spacetime event. Compact on purpose: the log is mirrored into localStorage.
 *   k = "p": presence sample (the visitor stood or walked here; stands for `sampleSec` seconds)
 *   k = "f": a cigarette filter left by a worker (labour fossil, wears away fast)
 */
export interface PEvent {
  id: string;
  /** Visitor (or bot) id. */
  o: string;
  r: RoleId;
  k: "p" | "f";
  x: number;
  z: number;
  /** Assigned exhibition seconds of the actor when the event happened. */
  s: number;
}

export interface FoldConfig {
  /** Spatial radius (world units) of the spacetime ball in which worker presence is counted. */
  radius: number;
  /** Temporal radius (exhibition seconds): presence further back than this does not count towards nucleation. */
  windowSec: number;
  /** Worker-seconds (kernel-weighted, each visitor capped at `visitorCap`) inside the ball that make a slab nucleate. */
  threshold: number;
  /** Extra worker-seconds (each visitor capped) that raise the slab by one more height unit after nucleation. */
  pourUnit: number;
  /** Most that ONE visitor can contribute to ONE cell (worker-seconds): a lone visitor cannot build alone. */
  visitorCap: number;
  /** Distinct visitors that must have been in the ball (inside the time window) before a slab can nucleate. */
  minVisitors: number;
  maxHeight: number;
  /** Seconds one presence event stands for. */
  sampleSec: number;
  /** e-folding time (model years) of an exposed slab once nobody keeps using it. */
  tauSlabYears: number;
  /** e-folding time (model years) of the buried footprint (foundation outline). */
  tauFootprintYears: number;
  /** e-folding time (model years) of a cigarette filter. */
  tauFilterYears: number;
  /** Worker visits (entries into a cell) after which a path is 63 % formed. */
  pathVisits: number;
  /** e-folding time (model years) of a path once nobody walks it. */
  tauPathYears: number;
  /**
   * A pause longer than this (exhibition seconds) in the presence around a slab splits its life into separate
   * spans: the time in between is EMPTY TIME, and the 3D timespace view leaves it empty (no boxes).
   */
  emptyGapSec: number;
}

export const DEFAULT_FOLD: FoldConfig = {
  radius: 3,
  windowSec: 600,
  threshold: 36,
  pourUnit: 15,
  visitorCap: 15,
  minVisitors: 3,
  maxHeight: 6,
  sampleSec: 1,
  tauSlabYears: 800,
  tauFootprintYears: 8000,
  tauFilterYears: 10,
  pathVisits: 5,
  tauPathYears: 3000,
  emptyGapSec: 30,
};


export interface Slab {
  key: string;
  x: number;
  z: number;
  /** Visible (worn) height in height units; 0 when only the footprint is left. */
  h: number;
  /** Height before any wear (h / raw = how intact the slab still is, 0..1). */
  raw: number;
  /** 0..1: how much of the buried foundation outline is left. */
  foot: number;
  /** Assigned time at which the slab nucleated. */
  bornS: number;
  /** Assigned time of the last presence that kept it in use. */
  lastS: number;
  /**
   * When somebody was actually around it, from its birth on: [from, to] in assigned seconds, sorted, separated by
   * pauses longer than `emptyGapSec`. Absent (hand-built slabs) = one span bornS … lastS.
   */
  spans?: [number, number][];
}

export interface FilterTrace {
  id: string;
  x: number;
  z: number;
  /** 1 = fresh .. 0 = gone. */
  alpha: number;
  s: number;
}

/** A desire path: a cell many workers have walked through. */
export interface PathCell {
  key: string;
  x: number;
  z: number;
  /** 0..1 how formed (and not yet worn away) the path is. */
  p: number;
  /** Raw visit count. */
  visits: number;
}

export interface Snapshot {
  slabs: Slab[];
  filters: FilterTrace[];
  paths: PathCell[];
}
