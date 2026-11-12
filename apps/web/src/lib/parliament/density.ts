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
import { legSimilarity } from "./trails";
import type { Contributor, PEvent } from "./types";
import { wrapCell, wrapCoord, wrapDist } from "./world";

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
  /** EMPTY TIME: a building stands through a pause up to this long (s); after a longer one what is built is a new
   *  building — its plinth and basement laid again, its order of building from the beginning (seeds.ts buildKeep). */
  gapSec: number;
  /** A Seed's mass at level 1, and its factor per level (the parts' size follows the mass: seeds.ts recipe). */
  mass: number;
  massRatio: number;
  /** PATHS from the density of MOVEMENT, in the same grid (absent = none: every sample is a presence, as before). */
  path?: PathConfig;
}

/**
 * PATHS, THE SAME WAY (the artist, 2026-11-12: "오히려 시공간 덩어리니까 한 번에 density 처럼 해결할 방법이 있나?").
 * A sample that is a STEP (at least `minStep` from the walker's last sample, no more than `maxGapSec` after it) is not
 * a presence: it treads the cell-slots along the step — sideways within `radius`, and in time from a little before
 * (`downSec`) to long after (`upSec`: a way once trodden stays a while). A cell-slot is PATH when at least
 * `minWalkers` different walkers trod it (one counts from `walkerMin`, and for no more than `walkerCap`) and their
 * treads add up to `step`. One crossing by one herd is under the threshold (it stays a thread, trails.ts); the same
 * way taken again, or there and back, is over it.
 *
 * THE CONTEST: a cell-slot is a building's or a path's, never both — whichever is further over its own threshold.
 *
 * RAMPS need no rule: an old way and a newer branch of it overlap where they run together (the path there reaches
 * from the old time up to the new), while the branch alone begins at the new time; pathPlates() lets a path's surface
 * rise no faster than `rise` slots per cell from the lower surfaces it touches, so the branch climbs from the old way.
 */
export interface PathConfig {
  minStep: number;
  maxGapSec: number;
  radius: number;
  upSec: number;
  downSec: number;
  minWalkers: number;
  walkerMin: number;
  walkerCap: number;
  step: number;
  /**
   * A WAY IS ONE THING, END TO END (the artist, 2026-11-12: "길이면 쭉 이어져야 하는 거 아냐?"). A walk is not trodden
   * step by step where each walker happened to go — side by side, the cells under them came out uneven and the path in
   * pieces. A walk is a LEG (from setting off to stopping; shorter than `minLeg` it is no way anywhere), and a leg
   * belongs to a ROUTE: the most similar one there is (trails.ts legSimilarity ≥ `joinThreshold`, ends within
   * `joinRadius`, either direction), or a new one, whose line is this first walker's own track. Every leg of a route
   * treads THE ROUTE'S LINE. So along a route every cell gets the same, and the route is path from end to end or not
   * at all (but where a building has the cell).
   */
  minLeg: number;
  joinRadius: number;
  joinThreshold: number;
}
export const DEFAULT_PATH: PathConfig = { minStep: 0.6, maxGapSec: 3, radius: 1.5, upSec: 120, downSec: 20, minWalkers: 4, walkerMin: 0.5, walkerCap: 2, step: 6.5, minLeg: 3, joinRadius: 4, joinThreshold: 0.4 };

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
  gapSec: 20,
  mass: 1,
  massRatio: 1.6,
};

interface CellSlot {
  /** Per visitor (index): the weight put in, uncapped. */
  by: Map<number, number>;
  level: number;
  /** Per walker (index): what it trod in here; and whether the cell-slot is path (never with level ≥ 1). */
  mv?: Map<number, number>;
  path?: boolean;
}

/** A way: its line (x, z pairs — the first walker's track, its corners cut), from its one end to its other. */
interface PathRoute {
  pts: number[];
  ax: number;
  az: number;
  bx: number;
  bz: number;
  legs: number;
}

interface PathRun {
  cx: number;
  cz: number;
  k0: number;
  k1: number;
  /** Its surface's height (slots), and how trodden it is at its most. */
  h: number;
  w: number;
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
  /** Every change of what is path bumps this (pathPlates is the same while it stands). */
  pathVersion = 0;
  /** Each walker's last sample (canonical), to tell a step from a presence. */
  private last = new Map<number, { x: number; z: number; s: number }>();
  /** Each walker's walk under way (x, z, s triples), and the routes so far. */
  private open = new Map<number, number[]>();
  private routes: PathRoute[] = [];
  private plates: { key: string; out: Float32Array } | null = null;
  private lines: { key: string; out: Float32Array } | null = null;

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
    const pc = c.path;
    if (pc) {
      const prev = this.last.get(o);
      this.last.set(o, { x, z, s: e.s });
      if (prev) {
        const dt = e.s - prev.s, d = Math.hypot(x - prev.x, z - prev.z);
        const step = dt > 0 && dt <= pc.maxGapSec && d >= pc.minStep;
        // (a step over the world's edge is short round the torus but long on the map: the walk ends before it)
        if (step && d <= wrapDist(prev.x, prev.z, x, z) + 1e-6) {
          const leg = this.open.get(o) ?? [prev.x, prev.z, prev.s];
          leg.push(x, z, e.s);
          this.open.set(o, leg);
          return;
        }
        // it stopped (or paused, or went over the edge): the walk it was on is a leg now
        this.closeLeg(o, pc);
        if (step) return;
      }
    }
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
          this.settle(col, ck, cs);
        }
      }
    }
  }

  /** A walk has ended: it joins the most similar route (or begins one) and treads that route's line, at its own time. */
  private closeLeg(o: number, pc: PathConfig): void {
    const leg = this.open.get(o);
    if (!leg) return;
    this.open.delete(o);
    const n = leg.length / 3;
    const ax = leg[0], az = leg[1], bx = leg[(n - 1) * 3], bz = leg[(n - 1) * 3 + 1];
    if (n < 2 || Math.hypot(bx - ax, bz - az) < pc.minLeg) return;
    let route: PathRoute | null = null, best = Math.max(1e-9, pc.joinThreshold);
    for (const r of this.routes) {
      const sim = Math.max(legSimilarity(ax, az, bx, bz, r, pc.joinRadius), legSimilarity(bx, bz, ax, az, r, pc.joinRadius));
      if (sim >= best) [route, best] = [r, sim];
    }
    if (!route) {
      // a new way: this walker's own track, its corners cut twice (the ends stay)
      let pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(leg[i * 3], leg[i * 3 + 1]);
      for (let it = 0; it < 2 && pts.length > 4; it++) {
        const q = [pts[0], pts[1]];
        for (let i = 0; i + 3 < pts.length; i += 2) {
          q.push(0.75 * pts[i] + 0.25 * pts[i + 2], 0.75 * pts[i + 1] + 0.25 * pts[i + 3]);
          q.push(0.25 * pts[i] + 0.75 * pts[i + 2], 0.25 * pts[i + 1] + 0.75 * pts[i + 3]);
        }
        q.push(pts[pts.length - 2], pts[pts.length - 1]);
        pts = q;
      }
      route = { pts, ax, az, bx, bz, legs: 0 };
      this.routes.push(route);
      this.lines = null;
    }
    route.legs++;
    const s = (leg[2] + leg[(n - 1) * 3 + 2]) / 2;
    const p = route.pts;
    for (let i = 0; i + 3 < p.length; i += 2) if (p[i] !== p[i + 2] || p[i + 1] !== p[i + 3]) this.tread(o, p[i], p[i + 1], p[i + 2], p[i + 3], s, pc);
  }

  /** A step from (ax, az) to (bx, bz) arriving at `s`: its treads into the cell-slots along it. */
  private tread(o: number, ax: number, az: number, bx: number, bz: number, s: number, pc: PathConfig): void {
    const c = this.cfg;
    const R = Math.max(0.01, pc.radius);
    // the cells within R of the step, each with the share of its crossing this step is: the length of the step that
    // lies within R of the cell's middle, over 2R — so one whole crossing over a cell's middle adds up to exactly 1,
    // however the walk is cut into steps
    const cells = new Map<number, [number, number, number]>();
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const i0 = Math.floor((Math.min(ax, bx) - R) / CELL_SIZE), i1 = Math.floor((Math.max(ax, bx) + R) / CELL_SIZE);
    const j0 = Math.floor((Math.min(az, bz) - R) / CELL_SIZE), j1 = Math.floor((Math.max(az, bz) + R) / CELL_SIZE);
    for (let ci = i0; ci <= i1; ci++) {
      for (let cj = j0; cj <= j1; cj++) {
        const px = (ci + 0.5) * CELL_SIZE - ax, pz = (cj + 0.5) * CELL_SIZE - az;
        const along = px * ux + pz * uz, off = Math.abs(px * uz - pz * ux);
        if (off >= R) continue;
        const half = Math.sqrt(R * R - off * off);
        const len = Math.min(L, along + half) - Math.max(0, along - half);
        if (len <= 0) continue;
        const cx = wrapCell(ci), cz = wrapCell(cj);
        cells.set(colKey(cx, cz), [cx, cz, len / (2 * R)]);
      }
    }
    const up = Math.max(0, pc.upSec), dn = Math.max(0, pc.downSec);
    const k0 = Math.max(0, Math.floor((s - dn) / c.slotSec)), k1 = Math.floor((s + up) / c.slotSec), kOwn = Math.floor(s / c.slotSec);
    for (const [ck, [cx, cz, g]] of cells) {
      let col = this.cols.get(ck);
      if (!col) this.cols.set(ck, (col = { cx, cz, slots: new Map() }));
      for (let k = k0; k <= k1; k++) {
        let t = 1;
        if (k !== kOwn) {
          const dt = (k + 0.5) * c.slotSec - s;
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
        if (!cs.mv) cs.mv = new Map();
        cs.mv.set(o, (cs.mv.get(o) ?? 0) + g * t);
        this.settle(col, ck, cs);
      }
    }
  }

  /** What a cell-slot is after something was put into it: a building's level, or path, or nothing (THE CONTEST). */
  private settle(col: Column, ck: number, cs: CellSlot): void {
    const c = this.cfg, pc = c.path;
    let lv = levelOf(cs.by, c);
    let path = false;
    if (pc && cs.mv) {
      let n = 0, sum = 0;
      for (const a of cs.mv.values()) {
        if (a >= pc.walkerMin) n++;
        sum += Math.min(a, pc.walkerCap);
      }
      if (n >= pc.minWalkers && sum >= pc.step) {
        let stay = 0;
        if (lv > 0) for (const a of cs.by.values()) stay += Math.min(a, c.visitorCap);
        // whichever is further over its own threshold
        if (!(lv > 0 && stay / c.step >= sum / pc.step)) {
          path = true;
          lv = 0;
        }
      }
    }
    if (path !== !!cs.path) {
      cs.path = path;
      this.pathVersion++;
      this.plates = null;
      this.lines = null;
    }
    if (lv !== cs.level) {
      cs.level = lv;
      col.seed = undefined;
      this.dirty.add(ck);
      this.listDirty = true;
      this.stats.changes++;
      this.version++;
    }
  }

  /** Whether a cell-slot is path. */
  pathAt(cx: number, cz: number, k: number): boolean {
    return !!this.cols.get(colKey(wrapCell(cx), wrapCell(cz)))?.slots.get(k)?.path;
  }

  /**
   * THE PATHS' SURFACES: one per cell and run of path slots, at the slot the run begins in, or lower: no surface is
   * more than `rise` slots per cell above a surface it touches (a neighbouring cell's run that lives at the same time),
   * so a branch climbs from the way it leaves instead of hanging over it. `w` = how trodden the run is at its most.
   */
  private pathRuns(rise: number): { runs: PathRun[]; at: Map<number, PathRun[]> } {
    const pc = this.cfg.path;
    const runs: PathRun[] = [];
    const at = new Map<number, PathRun[]>();
    for (const [ck, col] of this.cols) {
      const ks: number[] = [];
      for (const [k, cs] of col.slots) if (cs.path) ks.push(k);
      if (!ks.length) continue;
      ks.sort((p, q) => p - q);
      const mine: PathRun[] = [];
      let from = ks[0], prev = ks[0];
      for (let i = 1; i <= ks.length; i++) {
        if (i < ks.length && ks[i] === prev + 1) {
          prev = ks[i];
          continue;
        }
        let w = 0;
        for (let k = from; k <= prev; k++) {
          let sum = 0;
          for (const a of col.slots.get(k)!.mv?.values() ?? []) sum += Math.min(a, pc?.walkerCap ?? Infinity);
          if (sum > w) w = sum;
        }
        mine.push({ cx: col.cx, cz: col.cz, k0: from, k1: prev, h: from, w });
        if (i < ks.length) from = prev = ks[i];
      }
      at.set(ck, mine);
      for (const r of mine) runs.push(r);
    }
    // lower each surface towards the lower ones it touches, at most `rise` per cell (lowest first, until nothing moves)
    const step = Math.max(0, rise);
    const queue = [...runs].sort((p, q) => p.h - q.h);
    for (let qi = 0; qi < queue.length && qi < runs.length * 64; qi++) {
      const a = queue[qi];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const near = at.get(colKey(wrapCell(a.cx + dx), wrapCell(a.cz + dz)));
          if (!near) continue;
          const cand = a.h + step * (dx && dz ? Math.SQRT2 : 1);
          for (const b of near) {
            if (b.k0 > a.k1 + 1 || b.k1 < a.k0 - 1 || cand >= b.h - 1e-9) continue;
            b.h = cand;
            queue.push(b);
          }
        }
      }
    }
    return { runs, at };
  }

  /** The surfaces as plates: [x, height in slots, z] per cell and run. */
  pathPlates(rise: number): Float32Array {
    const key = `${this.pathVersion}:${rise}`;
    if (this.plates && this.plates.key === key) return this.plates.out;
    const { runs } = this.pathRuns(rise);
    const out = new Float32Array(runs.length * 3);
    runs.forEach((r, i) => out.set([(r.cx + 0.5) * CELL_SIZE, r.h, (r.cz + 0.5) * CELL_SIZE], i * 3));
    this.plates = { key, out };
    return out;
  }

  /**
   * THE PATHS AS CURVES (the artist, 2026-11-12: "판 말고 걍 예전처럼 선으로", "선분 말고 곡선", "길이면 쭉 이어져야"):
   * each route's own line, drawn wherever and whenever the cells under it are path — at their surfaces' heights (so
   * where a branch leaves an older way it climbs, pathRuns), the heights evened `smooth` times. A route is trodden
   * evenly from end to end, so its line is unbroken from end to end (it stops only where a building has the cell);
   * the same way taken again much later is the same curve again, higher up. [x, height in slots, z, x, height, z] per
   * short segment.
   */
  pathLines(rise: number, smooth = 4): Float32Array {
    const key = `${this.pathVersion}:${this.routes.length}:${rise}:${smooth}`;
    if (this.lines && this.lines.key === key) return this.lines.out;
    const { at } = this.pathRuns(rise);
    const out: number[] = [];
    const passes = Math.max(0, Math.round(smooth));
    const emit = (ch: number[][]) => {
      if (ch.length < 2) return;
      for (let it = 0; it < passes; it++) {
        const h = ch.map((p) => p[1]);
        for (let i = 1; i < ch.length - 1; i++) ch[i][1] = 0.25 * h[i - 1] + 0.5 * h[i] + 0.25 * h[i + 1];
      }
      for (let i = 1; i < ch.length; i++) out.push(ch[i - 1][0], ch[i - 1][1], ch[i - 1][2], ch[i][0], ch[i][1], ch[i][2]);
    };
    for (const r of this.routes) {
      // the route's line, a point every half cell
      const pts: [number, number][] = [];
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const L = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
        const n = Math.max(1, Math.ceil(L / (CELL_SIZE / 2)));
        for (let j = i === 0 ? 0 : 1; j <= n; j++) pts.push([r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * j) / n, r.pts[i + 1] + ((r.pts[i + 3] - r.pts[i + 1]) * j) / n]);
      }
      // along it, the runs of path under each point; a run goes on into the next point's run that lives at the same
      // time — a chain per time the way was a path
      let live: { run: PathRun; chain: number[][] }[] = [];
      for (const [x, z] of pts) {
        const runs = at.get(colKey(wrapCell(Math.floor(x / CELL_SIZE)), wrapCell(Math.floor(z / CELL_SIZE)))) ?? [];
        const next: { run: PathRun; chain: number[][] }[] = [];
        for (const b of runs) {
          const from = live.find((l) => l.run === b || (b.k0 <= l.run.k1 + 1 && b.k1 >= l.run.k0 - 1 && !next.some((n) => n.chain === l.chain)));
          const chain = from ? from.chain : [];
          chain.push([x, b.h, z]);
          next.push({ run: b, chain });
        }
        for (const l of live) if (!next.some((n) => n.chain === l.chain)) emit(l.chain);
        live = next;
      }
      for (const l of live) emit(l.chain);
    }
    this.lines = { key, out: Float32Array.from(out) };
    return this.lines.out;
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
        // the next living slot continues the building when the empty time between is no longer than gapSec
        if (i < ks.length && (ks[i] - prev - 1) * c.slotSec <= Math.max(0, c.gapSec)) {
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
        levels: new Map(ks.map((k) => [k, col.slots.get(k)!.level] as const)),
      };
    }
    this.dirty.clear();
    this.list = [];
    for (const col of this.cols.values()) if (col.seed) this.list.push(col.seed);
    this.listDirty = false;
    return this.list;
  }
}
