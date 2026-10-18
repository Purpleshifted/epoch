/**
 * residents — where the player page keeps the resident population (lib/parliament/population.ts) between steps.
 *
 * The population belongs to the WORLD, not to a visitor: RoleField remounts for every new session, the population
 * goes on. So it lives here, once per page, and is mirrored into localStorage every few seconds so a reload (or the
 * next page of the same epoch) meets the same residents where they were. A new epoch (the world was cleared) starts
 * a new population.
 */

import { initPopulation, readPopulation, type PopulationConfig, type PopulationState } from "@/lib/parliament";

export const LS_POPULATION_KEY = "anthropocene:parliament:population:v1";
const SAVE_EVERY_MS = 5000;
/** A stored population older than this (wall) is not met again: they would all have died long ago. */
const STALE_MS = 10 * 60_000;

let current: PopulationState | null = null;
let lastSave = 0;

/** The population of `epochMs` at wall time `wallMs`: this page's, else the stored one, else a first one. */
export function residentsOf(epochMs: number, wallMs: number, capacity: number, cfg: PopulationConfig, refOffset = 0): PopulationState {
  if (current && current.epochMs === epochMs) return current;
  let stored: PopulationState | null = null;
  try {
    const raw = localStorage.getItem(LS_POPULATION_KEY);
    stored = raw ? readPopulation(JSON.parse(raw), epochMs) : null;
  } catch {
    stored = null;
  }
  current = stored && wallMs - stored.lastMs < STALE_MS && stored.lastMs <= wallMs ? stored : initPopulation(epochMs, wallMs, capacity, cfg, refOffset);
  return current;
}

/** Keep the population after a step (and mirror it now and then). */
export function keepResidents(st: PopulationState, wallMs: number): void {
  current = st;
  if (wallMs - lastSave < SAVE_EVERY_MS) return;
  lastSave = wallMs;
  try {
    localStorage.setItem(LS_POPULATION_KEY, JSON.stringify(st));
  } catch {
    /* quota: the page's copy goes on */
  }
}
