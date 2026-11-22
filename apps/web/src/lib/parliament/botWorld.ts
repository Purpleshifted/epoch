/**
 * parliament/botWorld.ts — THE BOTS WITHOUT A PAGE (the artist, 2026-11-17: "걍 봇 자체를 따로 돌려서 늘 어디서 열든
 * 봇은 돌아간 상태여야 하잖아" … "딜레이 없는 게 제일 중요"). docs/bot-server.md.
 *
 * What useGlobalBots does on the wall's main thread, as a plain object: the herds and villages (lifecycle.ts) stepped
 * on the world clock, planning their ways over the tails (tails.ts) round what is built (density.ts), the visitors
 * who are people drawing them, the block forgetting the oldest-written samples past `keep`. The bot server
 * (relay/bots, a Cloudflare Durable Object) holds one of these and steps it every half second whether a view is open
 * or not; the views only receive what it writes.
 *
 * The setup is what a view's knobs make of the bots (useGlobalBots: the LifecycleConfig, the tails' rules, the
 * density field's config the wall builds with), sent to the server as it is — one conversion, in one place.
 *
 * The samples lie on one grid from the epoch (epoch + k · period) and an event's id is the bot's and the sample's:
 * a sample written twice is the same event.
 */

import { DensityField, type DensityConfig } from "./density";
import { DEFAULT_FLOW, flowRoute, type FlowConfig } from "./flow";
import { initLifecycle, lifecycleActor, stepLifecycle, type Attractor, type LifecycleConfig, type LifecycleState } from "./lifecycle";
import { riseOf, risePause, syncRisePause } from "./rise";
import { DEFAULT_TAILS, TailField, type TailConfig } from "./tails";
import type { PEvent } from "./types";
import { CELL_SIZE } from "@/lib/stratum/field";

export interface BotSetup {
  /** The bots are on (the wall's 봇 활성화). Off: nothing is stepped, the state waits. */
  on: boolean;
  lc: LifecycleConfig;
  tails: TailConfig;
  /** How much the bots keep to the tails (0 = not at all). */
  trail: number;
  /** The most samples the block holds (hKeep); past it the oldest-written tenth goes. */
  keep: number;
  /** The wall's density field (what is built, for the bots to go round); null = nothing is built for them. */
  density: DensityConfig | null;
  /** The trodden ground's rules (the tails' route costs are in its unit). */
  flow: FlowConfig | null;
  /** Seconds between two samples of a bot. */
  sampleSec: number;
  /** The column's rise stopped (rise.ts). */
  riseStop: boolean;
  /** Slots of record kept under the risen window (hTail); below them the ground is forgotten. */
  tailSlots: number;
}

export type BotKind = "settle" | "roam" | "tour" | "loner";

/** Someone who is not a bot, seen in the last this many seconds, is a visitor the bots may go to. */
const VISITOR_RECENT_SEC = 4;
/** No further back than this is caught up after a pause (the shared world's server went 25 min back at most). */
const CATCH_UP_MAX_MS = 25 * 60_000;
/** How often the ground below the risen window is let go (world ms). */
const TRIM_EVERY_MS = 30_000;

export class BotWorld {
  st: LifecycleState | null = null;
  /** The last sample stepped (world ms). */
  lastMs = 0;
  tails = new TailField();
  built: DensityField | null = null;
  /** Every event held, in the order written (bots' and people's). */
  readonly events = new Map<string, PEvent>();
  /** Bumps when the block forgot its oldest (the views forget the same). */
  drops = 0;
  /**
   * The people (not bots) by id: their latest sample and WHEN IT CAME (world seconds; 2026-11-22). A visitor's sample
   * carries its time in the block, which is not the clock's — "recent" is when it arrived.
   */
  private people = new Map<string, { e: PEvent; seen: number }>();
  private trimmedAt = 0;

  constructor(
    readonly epochMs: number,
    public setup: BotSetup,
  ) {
    this.tails.configure(setup.tails);
    this.built = setup.density ? new DensityField(setup.density) : null;
  }

  get periodMs(): number {
    return Math.max(50, this.setup.sampleSec * 1000);
  }

  /** New rules: the tails and the built field laid again from what is held when theirs changed. */
  configure(setup: BotSetup): void {
    const prev = this.setup;
    this.setup = setup;
    const all = () => [...this.events.values()].sort((p, q) => p.s - q.s);
    if (this.tails.configure(setup.tails)) for (const e of all()) this.tails.add(e);
    if (JSON.stringify(prev.density) !== JSON.stringify(setup.density)) {
      this.built = setup.density ? new DensityField(setup.density) : null;
      if (this.built) for (const e of all()) this.built.add(e);
    }
  }

  /**
   * Takes an event (people's, or held ones on waking): false when it was there. `seenSec` = the world's seconds when a
   * person's sample arrived (without it, its own time: held ones, the old way).
   */
  add(e: PEvent, seenSec?: number): boolean {
    if (this.events.has(e.id)) return false;
    this.events.set(e.id, e);
    this.tails.add(e);
    this.built?.add(e);
    if (!e.o.startsWith("bot")) {
      const l = this.people.get(e.o);
      const seen = seenSec ?? e.s;
      if (!l || seen > l.seen || (seen === l.seen && e.s >= l.e.s)) this.people.set(e.o, { e, seen });
    }
    return true;
  }

  /** The rise's stop as kept (for waking up again), and put back. */
  riseState(): { at: number | null; lost: number; epoch: number } {
    return { ...risePause };
  }
  setRise(r: { at: number | null; lost: number; epoch: number } | null): void {
    if (r && r.epoch === this.epochMs) Object.assign(risePause, r);
  }

  /**
   * The bots up to world time `now`: the events written, in order. A long gap is caught up as far back as the block
   * remembers, at most `budgetMs` of computing at a time (the rest on the next call).
   */
  step(now: number, budgetMs = 200): PEvent[] {
    const out: PEvent[] = [];
    const { on, lc, flow, trail, keep } = this.setup;
    // the rise's state belongs to this world (rise.ts is one state per page — here one per object)
    if (risePause.epoch !== this.epochMs) Object.assign(risePause, { at: null, lost: 0, epoch: this.epochMs });
    syncRisePause(this.setup.riseStop, Math.max(0, (now - this.epochMs) / 1000), this.epochMs, false);
    if (!on) return out;
    const period = this.periodMs;
    const grid = (t: number) => this.epochMs + Math.floor((t - this.epochMs) / period) * period;
    const back = Math.min(CATCH_UP_MAX_MS, (Math.max(1000, keep) / Math.max(1, lc.maxPresent)) * period);
    if (!this.st || this.lastMs <= 0 || now - this.lastMs > back) {
      const from = grid(now - (this.st ? back : 0)) - period;
      // (a world nobody stepped for longer than it remembers begins again that far back: those who were there have
      // long gone; a world never stepped begins now)
      this.st = initLifecycle(this.epochMs, from, lc);
      this.lastMs = from;
    }
    const sec = (w: number) => (w - this.epochMs) / 1000;
    const slotOf = (s: number) => Math.floor(s / Math.max(1, this.setup.density?.slotSec ?? this.setup.tails.slotSec));
    const tailFlow = { ...(flow ?? DEFAULT_FLOW), enabled: true, gridShare: 1 };
    const builtAt = (ci: number, cj: number, k: number) => (this.built ? this.built.levelAt(ci, cj, k) >= 1 : false);
    const t0 = Date.now();
    let st: LifecycleState = { ...this.st, maxPresent: lc.maxPresent };
    for (let w = this.lastMs + period; w <= now; w += period) {
      const at = sec(w);
      const planRoute = (ax: number, az: number, bx: number, bz: number, s?: number) => {
        const k = slotOf(s ?? at);
        const cellOf = (key: string) => key.split(",").map(Number) as [number, number];
        return flowRoute(
          ax,
          az,
          bx,
          bz,
          {
            level: (key) => this.tails.level(cellOf(key)[0], cellOf(key)[1], k) * tailFlow.unit * Math.max(0, trail),
            built: (key) => builtAt(cellOf(key)[0], cellOf(key)[1], k),
          },
          tailFlow,
        );
      };
      const meet = (ax: number, az: number, bx: number, bz: number, s: number): [number, number] | null => {
        if (!this.built) return null;
        const k = slotOf(s);
        const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.6);
        let out = false;
        for (let i = 1; i < n; i++) {
          const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
          if (L - (L * i) / n < 4) break;
          const inside = builtAt(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE), k);
          if (!inside) out = true;
          else if (out) return [x, z];
        }
        return null;
      };
      const attractors: Attractor[] = [];
      for (const { e, seen } of this.people.values()) if (seen >= at - VISITOR_RECENT_SEC - 120) attractors.push({ x: e.x, z: e.z, w: 3 });
      st = stepLifecycle(st, w, { attractors, planRoute, meet }, lc).state;
      for (const v of st.present) {
        const a = lifecycleActor(v, w, this.epochMs, lc.herd);
        const e: PEvent = { id: `${a.o}:${Math.round(w - this.epochMs)}`, o: a.o, r: a.r, k: "p", x: r2(a.x), z: r2(a.z), s: r2(a.s), w: r2(Math.max(0, (w - this.epochMs) / 1000)) };
        if (this.add(e)) out.push(e);
      }
      this.lastMs = w;
      if (Date.now() - t0 > budgetMs) break;
    }
    this.st = st;
    // forgetting in the block: by the order of writing (useGlobalBots), the oldest tenth and more at once
    const cap = Math.max(1000, keep);
    if (this.events.size > cap) {
      let n = this.events.size - Math.floor(cap * 0.9);
      for (const id of this.events.keys()) {
        if (n-- <= 0) break;
        this.events.delete(id);
      }
      this.drops++;
    }
    for (const [o, p] of this.people) if (p.seen < sec(now) - 600) this.people.delete(o);
    // THE GROUND BELOW THE RISEN WINDOW is let go (what the tails and the built field hold grows with every slot the
    // window rises through: 85 MB a quarter of an hour, measured 2026-11-17) — no further up than the window's foot
    // less the record kept under it
    const shift = lc.herd?.shift ?? 0;
    if (shift > 0 && this.lastMs - this.trimmedAt >= TRIM_EVERY_MS) {
      this.trimmedAt = this.lastMs;
      const slotSec = Math.max(1, this.setup.density?.slotSec ?? this.setup.tails.slotSec);
      const floor = Math.floor(riseOf(shift, sec(this.lastMs)).bottom / slotSec) - Math.max(0, this.setup.tailSlots) - 1;
      if (floor > 0) {
        this.tails.dropBelow(floor);
        this.built?.dropBelow(floor);
        // (what was lived in, for the vegetation's gathering on the wall: nobody reads it here)
        this.built?.takeLived();
      }
    }
    return out;
  }

  /** Who is of which kind now (a member is of its leader's): for the markers' colours. */
  kinds(): Record<string, BotKind> {
    const out: Record<string, BotKind> = {};
    if (!this.st) return out;
    const byId = new Map(this.st.present.map((v) => [v.id, v] as const));
    for (const v of this.st.present) {
      const lead = v.lead ? byId.get(v.lead) : v;
      out[v.id] = lead?.kind === "leader" ? (lead.temper ?? "settle") : "loner";
    }
    return out;
  }

  /** The numbers of the readout. */
  readout(): { present: number; maxPresent: number; arrived: number; departed: number; places: number } | null {
    const s = this.st;
    return s ? { present: s.present.length, maxPresent: s.maxPresent, arrived: s.arrived, departed: s.departed, places: s.places.length } : null;
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The default setup (before any view has told the server its knobs): the bots off. */
export const DEFAULT_BOT_SETUP: Omit<BotSetup, "lc"> = { on: false, tails: DEFAULT_TAILS, trail: 1, keep: 20000, density: null, flow: null, sampleSec: 1, riseStop: false, tailSlots: 0 };

