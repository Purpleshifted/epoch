/**
 * parliament/foldClient.ts — the player's growing fold (foldState.ts) off the main thread, in the shared world.
 *
 * With everybody's samples on the phone the fold can stop a page for seconds: someone joins behind the frontier and it
 * rebuilds, the history window moves on and it replays cells, a far-behind owner leaves and it settles half a minute at
 * once (measured 2026-11-02: 3.4 s, 0.5 s every 10 s, 0.9 s with the CPU at a quarter). The visitor's frames and the
 * sound's bookings run on the same thread. So the state lives in a worker (fold.worker.ts) and a reading is answered
 * from the last one that came back, the next one asked for at once: the ground is a moment behind instead of the page
 * standing still. What the fold computes does not change.
 *
 *   FoldClient   the page's side: follows the event log, asks for one reading per kind at a time
 *   FoldHost     the worker's side: the state itself
 */

import { FoldState, type FoldStateOptions, type FoldStateStats, type SnapshotOptions } from "./foldState";
import type { Region } from "./fold";
import type { EventLog } from "./log";
import type { FoldConfig, PEvent, Snapshot } from "./types";

export type FoldRequest =
  | { type: "events"; events: PEvent[] }
  | { type: "drop"; cut: number }
  | { type: "clear" }
  | { type: "read"; key: string; sView: number; region?: Region; opts?: SnapshotOptions };

export type FoldWorkerMessage = { type: "init"; cfg: FoldConfig; opts?: FoldStateOptions } | FoldRequest;

export interface FoldReply {
  key: string;
  snapshot: Snapshot;
  stats: FoldStateStats;
}

export class FoldHost {
  private readonly state: FoldState;

  constructor(cfg: FoldConfig, opts?: FoldStateOptions) {
    this.state = new FoldState(cfg, opts);
  }

  handle(m: FoldRequest): FoldReply | null {
    switch (m.type) {
      case "events":
        for (const e of m.events) this.state.add(e);
        return null;
      case "drop":
        this.state.dropBefore(m.cut);
        return null;
      case "clear":
        this.state.clear();
        return null;
      case "read":
        return { key: m.key, snapshot: this.state.snapshot(m.sView, m.region, m.opts), stats: this.state.stats };
    }
  }
}

/** A worker that has not answered for this long is asked again (it answers once it is through whatever held it up). */
const READ_RETRY_MS = 10_000;
const EMPTY: Snapshot = { slabs: [], paths: [] };

export class FoldClient {
  private fed = 0;
  private last: PEvent | null = null;
  private drops: number;
  private known: FoldStateStats | null = null;
  private readonly latest = new Map<string, Snapshot>();
  private readonly asked = new Map<string, number>();

  constructor(
    private readonly log: EventLog,
    private readonly post: (m: FoldRequest) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.drops = log.drops;
  }

  /** The last reading of this kind (empty before the first), and the next one on its way. */
  at(sView: number, region?: Region, opts?: SnapshotOptions): Snapshot {
    this.follow();
    const key = `${region ? "region" : "world"}${opts?.tailOf === undefined ? "" : ":own"}${opts?.tail === false ? ":settled" : ""}`;
    const since = this.asked.get(key);
    if (since === undefined || this.now() - since > READ_RETRY_MS) {
      this.asked.set(key, this.now());
      this.post({ type: "read", key, sView, region, opts });
    }
    return this.latest.get(key) ?? EMPTY;
  }

  receive(r: FoldReply): void {
    this.latest.set(r.key, r.snapshot);
    this.asked.delete(r.key);
    this.known = r.stats;
  }

  stats(): FoldStateStats | null {
    return this.known;
  }

  /** What arrived in the log since the last call, and its forgetting. */
  private follow(): void {
    if (this.drops !== this.log.drops) {
      this.drops = this.log.drops;
      if (this.log.droppedBefore === Infinity) {
        this.post({ type: "clear" });
        this.latest.clear();
        this.fed = 0;
        this.last = null;
      } else this.post({ type: "drop", cut: this.log.droppedBefore });
    }
    const all = this.log.all();
    // forgetting moved everything up: the last event given shows where the new ones begin (a known id is ignored anyway)
    if (this.fed > 0 && all[this.fed - 1] !== this.last) this.fed = this.last ? all.lastIndexOf(this.last) + 1 : 0;
    if (this.fed >= all.length) return;
    this.post({ type: "events", events: all.slice(this.fed) });
    this.fed = all.length;
    this.last = all[all.length - 1];
  }
}
