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

import type { FlowConfig } from "./flow";

export type RoleId = "shepherd" | "wolf" | "worker" | "warrior" | "tree" | "cat" | "car";

export const ROLES: readonly RoleId[] = ["shepherd", "wolf", "worker", "warrior", "tree", "cat", "car"];

/** Which roles already have an effect in the fold (the rest only leave presence events). */
export const ROLE_IMPLEMENTED: Record<RoleId, boolean> = {
  shepherd: false,
  wolf: false,
  worker: true,
  warrior: false,
  tree: false,
  cat: false,
  car: false,
};

/**
 * One spacetime event. Compact on purpose: the log is mirrored into localStorage.
 *   k = "p": presence sample (the visitor stood or walked here; stands for `sampleSec` seconds)
 *   k = "s": a seed head an answer left here (dandelion.ts; role "tree", so nothing counts it as presence)
 */
export interface PEvent {
  id: string;
  /** Visitor (or bot) id. */
  o: string;
  r: RoleId;
  k: "p" | "s";
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
  /**
   * What a person's presence counts for against a bot's: what they put in and the most they can put in, both this many
   * times, so that one person shows among the bots (the artist, 2026-11-03). It does not make them several people for
   * `minVisitors`.
   */
  playerWeight: number;
  /**
   * How many visitors a person is for `minVisitors` (a bot: one), so that a person among a few bots can start a house
   * (the artist, 2026-11-09: weight alone changes nothing while the count is short).
   */
  playerHeads: number;
  /** Distinct visitors that must have been in the ball (inside the time window) before a slab can nucleate. */
  minVisitors: number;
  maxHeight: number;
  /** Seconds one presence event stands for. */
  sampleSec: number;
  /** e-folding time (model years) of an exposed slab once nobody keeps using it. */
  tauSlabYears: number;
  /** e-folding time (model years) of the buried footprint (foundation outline). */
  tauFootprintYears: number;
  /** Worker visits (entries into a cell) after which a path is 63 % formed. */
  pathVisits: number;
  /** e-folding time (model years) of a path once nobody walks it. */
  tauPathYears: number;
  /**
   * A pause longer than this (exhibition seconds) in the presence around a slab splits its life into separate
   * spans: the time in between is EMPTY TIME, and the 3D timespace view leaves it empty (no boxes).
   */
  emptyGapSec: number;
  /** V2 — PATHS AS SUSTAINED FLOW (flow.ts): stays build, moves tread paths. Absent / disabled = V1. */
  flow?: FlowConfig;
}

export const DEFAULT_FOLD: FoldConfig = {
  radius: 3,
  windowSec: 600,
  threshold: 36,
  pourUnit: 15,
  visitorCap: 15,
  playerWeight: 1,
  playerHeads: 1,
  minVisitors: 3,
  maxHeight: 6,
  sampleSec: 1,
  tauSlabYears: 800,
  tauFootprintYears: 8000,
  pathVisits: 5,
  tauPathYears: 3000,
  emptyGapSec: 30,
};

/** What a presence of `o` counts for (FoldConfig.playerWeight): a bot once. */
export const presenceWeight = (o: string, cfg: FoldConfig): number => (o.startsWith("bot") ? 1 : cfg.playerWeight);
/** How many visitors `o` is for `minVisitors` (FoldConfig.playerHeads): a bot one. */
export const presenceHeads = (o: string, cfg: FoldConfig): number => (o.startsWith("bot") ? 1 : cfg.playerHeads);


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
  /** Who built it: every visitor (or bot) who put weight into the cell — first / last time and how much (capped). */
  who?: Contributor[];
  /** How it grew: [assigned time, raw height] each time the raw height rose by ≥ 0.05 (from the birth on). */
  growth?: [number, number][];
}

export interface Contributor {
  o: string;
  first: number;
  last: number;
  /** Weight put in (worker·s), capped at visitorCap like the growth. */
  amount: number;
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
  paths: PathCell[];
}
