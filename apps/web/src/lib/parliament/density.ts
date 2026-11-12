/**
 * parliament/density.ts — BUILDINGS FROM THE DENSITY OF SPACETIME (the artist, 2026-11-12: "건물 생성도 이제 공간이니
 * 시공간 밀도로", "바로바로 생기고, 변화 threshold 를 정해서 그 사이 구간 동안은 변화 안 하도록").
 *
 * The block is a grid of CELL-SLOTS: a ground cell (world.ts) × a slot of the time axis. Every presence sample adds a
 * little weight to the cell-slots around it — sideways within `radius`, and up and down in time within `timeSec` — and
 * that is all that happens: a sum, in no order. So a sample written deep in the block costs what a sample at the present
 * costs (≈ 150 additions), nothing is folded again, and nothing has to settle first.
 *
 * WHAT CHANGES A BUILDING is one number per cell-slot, its LEVEL:
 *
 *   0   nothing — fewer than `minVisitors` different people have stood here (a visitor counts from `visitorMin`), or
 *       their weights (each capped at `visitorCap`) do not yet add up to `step`
 *   1   the sum reached `step`           2   step × ratio           3   step × ratio²   …   up to `maxLevel`
 *
 * Between two thresholds nothing about the cell changes; `seeds()` hands the wall the same Seed for it (seeds.ts), so
 * its parts are not regenerated. One herd standing a few seconds reaches level 1; a visitor's weight is capped, so the
 * higher levels mean that OTHERS were here at this time too.
 *
 * The parts themselves are still made by seeds.ts boxesOfSeed (the look is the grammar's, unchanged): a ground cell is
 * one Seed whose spans are its runs of slots at level ≥ 1 and whose mass is its highest level's. Its id is the cell's,
 * whatever is written above or below later, so its parts keep their shapes.
 *
 * Pure: no clocks, no storage. Coordinates are canonical and cells wrap (world.ts).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { seedId, type Seed } from "./seeds";
import type { Contributor, PEvent } from "./types";
import { wrapCell, wrapCoord } from "./world";

export interface DensityConfig {
  /** Sideways reach of a presence (world units). */
  radius: number;
  /** Reach in time (s): a presence weighs on the slots within this of its own time. */
  timeSec: number;
  /** How much of that reach goes DOWN (to earlier slots): 0 = only its own time and later, 1 = as far down as up. */
  down: number;
  /** Seconds of one slot of the time axis. */
  slotSec: number;
  /** Weight one sample puts into the cell-slot it stands in (1 s of standing ≈ 0.8, as the old rule). */
  rate: number;
  /** Different visitors a cell-slot needs before it is anything, and the weight from which one counts as a visitor. */
  minVisitors: number;
  visitorMin: number;
  /** The most one visitor can put into one cell-slot. */
  visitorCap: number;
  /** The first threshold of the sum, and the factor from one threshold to the next. */
  step: number;
  ratio: number;
  maxLevel: number;
  /** A Seed's mass at level 1, and its factor per level (the parts' size follows the mass: seeds.ts recipe). */
  mass: number;
  massRatio: number;
}

export const DEFAULT_DENSITY: DensityConfig = {
  radius: 2.75,
  timeSec: 60,
  down: 0.5,
  slotSec: 20,
  rate: 0.8,
  minVisitors: 4,
  visitorMin: 2,
  visitorCap: 20,
  step: 40,
  ratio: 2,
  maxLevel: 5,
  mass: 1,
  massRatio: 1.6,
};

interface CellSlot {
  /** Per visitor (index): the weight put in, uncapped. */
  by: Map<number, number>;
  level: number;
}

interface Column {
  cx: number;
  cz: number;
  /** slot → cell-slot. */
  slots: Map<number, CellSlot>;
  /** The Seed as last made (null = none, undefined = to be made). */
  seed?: Seed | null;
}

/** The level of a cell-slot from what its visitors put in. */
export function levelOf(by: ReadonlyMap<number, number>, cfg: DensityConfig): number {
  let n = 0, sum = 0;
  for (const a of by.values()) {
    if (a >= cfg.visitorMin) n++;
    sum += Math.min(a, cfg.visitorCap);
  }
  if (n < cfg.minVisitors || sum < cfg.step) return 0;
  const r = Math.max(1.01, cfg.ratio);
  return Math.max(1, Math.min(Math.round(cfg.maxLevel), 1 + Math.floor(Math.log(sum / cfg.step) / Math.log(r) + 1e-9)));
}

const colKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class DensityField {
  readonly key: string;
  private cols = new Map<number, Column>();
  private owners = new Map<string, number>();
  private names: string[] = [];
  /** Columns whose Seed must be made again (a level changed in them). */
  private dirty = new Set<number>();
  private list: Seed[] = [];
  private listDirty = true;
  /** Counts for the readout: samples added, cell-slots held, level changes so far. */
  readonly stats = { samples: 0, cellSlots: 0, changes: 0 };
  /** Every level change bumps this: the seeds are the same list while it stands. */
  version = 0;

  constructor(readonly cfg: DensityConfig) {
    this.key = JSON.stringify(cfg);
  }

  /** Adds one presence sample (any order, any time of the block). */
  add(e: Pick<PEvent, "o" | "x" | "z" | "s" | "k">): void {
    if (e.k !== undefined && e.k !== "p") return;
    const c = this.cfg;
    let o = this.owners.get(e.o);
    if (o === undefined) {
      o = this.names.length;
      this.owners.set(e.o, o);
      this.names.push(e.o);
    }
    this.stats.samples++;
    const x = wrapCoord(e.x), z = wrapCoord(e.z);
    const R = Math.max(0.01, c.radius);
    // a cell's index is floor(x / CELL), its middle (index + 0.5) × CELL — as the fold's (fold.ts)
    const ci = Math.floor(x / CELL_SIZE), cj = Math.floor(z / CELL_SIZE);
    const reach = Math.ceil(R / CELL_SIZE);
    const up = Math.max(0, c.timeSec), dn = up * Math.max(0, Math.min(1, c.down));
    const k0 = Math.max(0, Math.floor((e.s - dn) / c.slotSec)), k1 = Math.floor((e.s + up) / c.slotSec);
    const kOwn = Math.floor(e.s / c.slotSec);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const dx = (ci + a + 0.5) * CELL_SIZE - x, dz = (cj + b + 0.5) * CELL_SIZE - z;
        const d2 = (dx * dx + dz * dz) / (R * R);
        if (d2 >= 1) continue;
        const g = (1 - d2) * c.rate;
        const cx = wrapCell(ci + a), cz = wrapCell(cj + b);
        const ck = colKey(cx, cz);
        let col = this.cols.get(ck);
        if (!col) this.cols.set(ck, (col = { cx, cz, slots: new Map() }));
        for (let k = k0; k <= k1; k++) {
          // the slot it stands in gets the whole weight; the others less the further their middle is from its time
          let t = 1;
          if (k !== kOwn) {
            const dt = (k + 0.5) * c.slotSec - e.s;
            const span = dt > 0 ? up : dn;
            if (span <= 0) continue;
            const q = Math.abs(dt) / span;
            if (q >= 1) continue;
            t = 1 - q * q;
          }
          let cs = col.slots.get(k);
          if (!cs) {
            col.slots.set(k, (cs = { by: new Map(), level: 0 }));
            this.stats.cellSlots++;
          }
          cs.by.set(o, (cs.by.get(o) ?? 0) + g * t);
          const lv = levelOf(cs.by, c);
          if (lv !== cs.level) {
            cs.level = lv;
            col.seed = undefined;
            this.dirty.add(ck);
            this.listDirty = true;
            this.stats.changes++;
            this.version++;
          }
        }
      }
    }
  }

  /** The level of a cell-slot (0 = nothing there). */
  levelAt(cx: number, cz: number, k: number): number {
    return this.cols.get(colKey(wrapCell(cx), wrapCell(cz)))?.slots.get(k)?.level ?? 0;
  }

  /** One Seed per ground cell that has anything: its runs of slots at level ≥ 1, its mass from its highest level. */
  seeds(): Seed[] {
    if (!this.listDirty) return this.list;
    const c = this.cfg;
    for (const ck of this.dirty) {
      const col = this.cols.get(ck)!;
      const ks: number[] = [];
      let top = 0;
      for (const [k, cs] of col.slots) {
        if (cs.level < 1) continue;
        ks.push(k);
        if (cs.level > top) top = cs.level;
      }
      if (!ks.length) {
        col.seed = null;
        continue;
      }
      ks.sort((p, q) => p - q);
      const spans: [number, number][] = [];
      let from = ks[0], prev = ks[0];
      for (let i = 1; i <= ks.length; i++) {
        if (i < ks.length && ks[i] === prev + 1) {
          prev = ks[i];
          continue;
        }
        spans.push([from * c.slotSec, (prev + 1) * c.slotSec - 0.001]);
        if (i < ks.length) from = prev = ks[i];
      }
      // who built it: every visitor of its living slots, first and last slot time, weight (capped per slot)
      const who = new Map<number, Contributor>();
      for (const k of ks) {
        for (const [o, a] of col.slots.get(k)!.by) {
          const t = k * c.slotSec, amt = Math.min(a, c.visitorCap);
          const w = who.get(o);
          if (w) {
            w.first = Math.min(w.first, t);
            w.last = Math.max(w.last, t + c.slotSec);
            w.amount += amt;
          } else who.set(o, { o: this.names[o], first: t, last: t + c.slotSec, amount: amt });
        }
      }
      col.seed = {
        // the cell's own id, whenever it began: what is written above or below later does not reshuffle its parts
        id: seedId(col.cx, col.cz, 0),
        material: "concrete",
        role: "worker",
        x: (col.cx + 0.5) * CELL_SIZE,
        z: (col.cz + 0.5) * CELL_SIZE,
        t0: spans[0][0],
        t1: spans[spans.length - 1][1],
        spans,
        mass: c.mass * Math.pow(Math.max(1, c.massRatio), top - 1),
        who: [...who.values()],
      };
    }
    this.dirty.clear();
    this.list = [];
    for (const col of this.cols.values()) if (col.seed) this.list.push(col.seed);
    this.listDirty = false;
    return this.list;
  }
}
