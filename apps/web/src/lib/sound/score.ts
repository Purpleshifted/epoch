/**
 * sound/score.ts — THE SAME MUSIC ON EVERY WALL OF THE SHARED WORLD (docs/shared-world-plan.md §4).
 *
 * Motifs, keys and rhythm are already pure functions of a person's id and the bar. What differed between walls was the
 * material: who is present, read from a log that fills whenever a poll happens to arrive. So in the shared world bar B
 * is written from the log as it stood SCORE_MARGIN_MS before the bar's start: the chunks closed by then, which every wall
 * has read by the time it plans the bar. The same chunks give the same people in the same order, whenever the page was
 * opened and whatever the timers are doing. A landscape of noise does not mind hearing a change some seconds late.
 */

import { latestS, type EventLog, type Slab } from "@/lib/parliament";
import { lastClosedChunk } from "@/lib/world/protocol";
import { globalBuildings, presences, type Presence, type ScoreBar } from "./global";
import type { BuildingSignal } from "./signals";

/** The planning lookahead (global.ts, 3.5 s) + reading a chunk once it closes + a stall of the wall's main thread. */
export const SCORE_MARGIN_MS = 6500;
/** Buildings change slowly and folding costs something: every few bars, on bars that are the same on every wall. */
export const BUILDINGS_EVERY_BARS = 4;

/** The log a bar's score reads, filled up to a chunk on demand (serverWorld.ts ScoreFeed). */
export interface ScoreSource {
  readonly log: EventLog;
  /** The newest chunk read from the server so far. */
  readonly readTo: number;
  advanceTo(chunk: number): void;
}

export class BarScore {
  private buildings: BuildingSignal[] = [];
  private epochMs = 0;
  /** The people of the bar written last (the status line, the bed of noise). */
  last: Presence[] = [];

  constructor(
    private readonly source: ScoreSource,
    private readonly slabsAt: (s: number) => readonly Slab[],
  ) {}

  get buildingCount(): number {
    return this.buildings.length;
  }

  private cutOf(bar: number, epochMs: number, barSec: number): number {
    return lastClosedChunk(epochMs + bar * barSec * 1000 - SCORE_MARGIN_MS);
  }

  /** Whether the chunks bar `bar` is written from have been read. A bar written too early would differ from the other walls'. */
  ready(bar: number, epochMs: number, barSec: number): boolean {
    return this.source.readTo >= this.cutOf(bar, epochMs, barSec);
  }

  at(bar: number, epochMs: number, barSec: number, windowSec: number): ScoreBar {
    const first = epochMs !== this.epochMs;
    if (first) {
      this.epochMs = epochMs;
      this.buildings = [];
    }
    this.source.advanceTo(this.cutOf(bar, epochMs, barSec));
    const events = this.source.log.all();
    if (events.length && (first || bar % BUILDINGS_EVERY_BARS === 0)) this.buildings = globalBuildings(this.slabsAt(latestS(events)));
    this.last = presences(events, windowSec, this.buildings);
    return { people: this.last, buildings: this.buildings };
  }
}
