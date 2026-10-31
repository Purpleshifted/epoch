/**
 * parliament/foldState.ts
 *
 * The fold as a STATE that grows with the log, instead of being redone from scratch twice a second (foldWorld in
 * fold.ts reads every event of the history window each time: ~150 ms with twelve bots over twenty minutes, and
 * growing with the log — the player's stutter).
 *
 * The SAME rules as foldWorld (foldState.test.ts checks the two against each other), arranged so that each new
 * sample costs only what it touches:
 *
 *   SETTLED   samples up to the frontier F are folded once, in time order, into per-cell running state: the
 *             nucleation window, the growth totals, the spans, the tread sums. F = the earliest "latest sample" of
 *             every owner still arriving, minus the stay look-ahead — nothing before F can still arrive in order.
 *   TAIL      the samples after F (up to the viewer's time) are replayed on top of the settled state at every
 *             snapshot and taken off again: a few hundred samples (the bots' time spread). Their stay shares are
 *             provisional, exactly as the batch fold's are for its latest seconds.
 *   LATE      a sample that arrives behind F (a new owner whose assigned time is behind, a tab catching up after a
 *             freeze) makes the state rebuild itself once from its own timelines. The viewer's time going backwards
 *             (a new session, a horizon knob) does the same. `lateMarginSec` holds F that much further back, so an
 *             owner who joins a little behind the others (a resident born at −30 s, population.ts) is not late.
 *   REGION    a snapshot that reads only a region replays only the tail samples that can reach it (a cell's state
 *             is made of what was splatted and trodden into THAT cell): the player's ground costs what is near.
 *             `{ tail: false }` reads the settled state alone (what the bots walk on: seconds behind, cheap).
 *   FORGET    dropBefore(cut) prunes the timelines as log.ts does and replays only the cells it touched. (The one
 *             known difference to the batch fold: on a pruned log it recomputes the stay shares of the first staySec
 *             after the cut without their look-back; the state keeps the shares it had — a 20-minute-old second.)
 *
 * Coordinates are canonical and cells wrap (world.ts). Pure: no clocks, no storage. The viewer's region only
 * selects which cells are READ; everything that happens anywhere is folded, so the player's ground is the same
 * ground the global views fold.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoAge } from "@/lib/stratum/geoClock";
import { FOLD_EPS, FOLD_MIN_ALPHA, FOLD_MIN_FOOT, rawHeightOf, type Region } from "./fold";
import { MAX_STEP_SEC, flowP, stayShareOf, treadCells, type FlowConfig } from "./flow";
import type { NatureConfig } from "./nature";
import type { Contributor, FoldConfig, PathCell, PEvent, Slab, Snapshot } from "./types";
import { wrapCell, wrapCoord, wrapDelta, wrapDist } from "./world";

const nkOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const cmpRef = (a: Ref, b: Ref) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One owner's timeline, sorted by (s, id). */
interface Line {
  o: number;
  s: number[];
  x: number[];
  z: number[];
  id: string[];
  /** Stay share: final below `settled`, provisional (rewritten at every snapshot) above it. */
  stay: number[];
  settled: number;
  /** The snapshot tick at which this owner's latest sample arrived. */
  lastTick: number;
  /** V1 desire paths: the cell this owner was last seen in (numeric key). */
  lastCell: number;
}

interface Ref {
  L: Line;
  i: number;
  s: number;
  id: string;
}

class Cell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  // presence splats, in time order
  s: number[] = [];
  w: number[] = [];
  o: number[] = [];
  // treads, in time order: end time, amount, axis (cos 2θ, sin 2θ), start time (for pruning)
  ts: number[] = [];
  ta: number[] = [];
  tc: number[] = [];
  tq: number[] = [];
  t0: number[] = [];
  // ── live state: a function of the arrays above (replay rebuilds it) ──
  own = new Map<number, number>();
  lo = 0;
  capped = 0;
  nuc = -1;
  total = new Map<number, number>();
  first = new Map<number, number>();
  last = new Map<number, number>();
  mass = 0;
  growth: [number, number][] = [];
  spans: [number, number][] = [];
  /** Tread sums at reference time `ref`: all treads (nucleation is blocked by them) and the treads not on a building in use (paths). */
  ref = 0;
  gc = 0;
  gq = 0;
  pc = 0;
  pq = 0;
  pn = 0;
  /** V1 desire paths: entries and the last one. */
  vn = 0;
  vLast = -Infinity;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {
    this.key = `${cx},${cz}`;
    this.x = (cx + 0.5) * CELL_SIZE;
    this.z = (cz + 0.5) * CELL_SIZE;
  }

  reset(): void {
    this.own = new Map();
    this.lo = 0;
    this.capped = 0;
    this.nuc = -1;
    this.total = new Map();
    this.first = new Map();
    this.last = new Map();
    this.mass = 0;
    this.growth = [];
    this.spans = [];
    this.ref = 0;
    this.gc = this.gq = this.pc = this.pq = 0;
    this.pn = 0;
    this.vn = 0;
    this.vLast = -Infinity;
  }
}

interface Checkpoint {
  len: number;
  tlen: number;
  lo: number;
  capped: number;
  nuc: number;
  mass: number;
  own: Map<number, number>;
  total: Map<number, number>;
  first: Map<number, number>;
  last: Map<number, number>;
  growthLen: number;
  spansLen: number;
  spanTo: number;
  ref: number;
  gc: number;
  gq: number;
  pc: number;
  pq: number;
  pn: number;
  vn: number;
  vLast: number;
}

function checkpoint(c: Cell): Checkpoint {
  return {
    len: c.s.length,
    tlen: c.ts.length,
    lo: c.lo,
    capped: c.capped,
    nuc: c.nuc,
    mass: c.mass,
    own: new Map(c.own),
    total: new Map(c.total),
    first: new Map(c.first),
    last: new Map(c.last),
    growthLen: c.growth.length,
    spansLen: c.spans.length,
    spanTo: c.spans.length ? c.spans[c.spans.length - 1][1] : 0,
    ref: c.ref,
    gc: c.gc,
    gq: c.gq,
    pc: c.pc,
    pq: c.pq,
    pn: c.pn,
    vn: c.vn,
    vLast: c.vLast,
  };
}

function restore(c: Cell, k: Checkpoint): void {
  c.s.length = c.w.length = c.o.length = k.len;
  c.ts.length = c.ta.length = c.tc.length = c.tq.length = c.t0.length = k.tlen;
  c.lo = k.lo;
  c.capped = k.capped;
  c.nuc = k.nuc;
  c.mass = k.mass;
  c.own = k.own;
  c.total = k.total;
  c.first = k.first;
  c.last = k.last;
  c.growth.length = k.growthLen;
  c.spans.length = k.spansLen;
  if (k.spansLen) c.spans[k.spansLen - 1][1] = k.spanTo;
  c.ref = k.ref;
  c.gc = k.gc;
  c.gq = k.gq;
  c.pc = k.pc;
  c.pq = k.pq;
  c.pn = k.pn;
  c.vn = k.vn;
  c.vLast = k.vLast;
}

export interface FoldStateOptions {
  /** An owner whose latest sample arrived more than this many snapshots ago no longer holds the frontier back. */
  inactiveTicks?: number;
  /** The settled frontier is held this many seconds further back (a new owner up to this far behind is not late). */
  lateMarginSec?: number;
}

/** How a snapshot is read. */
export interface SnapshotOptions {
  /** false: the settled state only, without replaying the tail (up to ~staySec + lateMarginSec behind the viewer). */
  tail?: boolean;
}

/** A tail sample is replayed for a region when it, or the sample before it, lies within the region's reach plus this
 *  (a tread runs between the two; no step in MAX_STEP_SEC is longer). */
const TREAD_REACH = 10;

export interface FoldStateStats {
  cells: number;
  owners: number;
  samples: number;
  /** The settled frontier (assigned seconds). */
  frontier: number;
  /** Samples replayed at the last snapshot. */
  tail: number;
  rebuilds: number;
}

export class FoldState {
  private readonly lines = new Map<string, Line>();
  private readonly names: string[] = [];
  private readonly cells = new Map<number, Cell>();
  private readonly seen = new Set<string>();
  private F = -Infinity;
  private sView = -Infinity;
  private late = false;
  private tick = 0;
  private readonly inactiveTicks: number;
  private readonly lateMargin: number;
  readonly stats: FoldStateStats = { cells: 0, owners: 0, samples: 0, frontier: -Infinity, tail: 0, rebuilds: 0 };
  /** Latest assigned time among the samples added (0 when empty), like fold.ts latestS. */
  latestS = 0;

  constructor(
    readonly cfg: FoldConfig,
    opts: FoldStateOptions = {},
  ) {
    this.inactiveTicks = opts.inactiveTicks ?? 20;
    this.lateMargin = Math.max(0, opts.lateMarginSec ?? 0);
  }

  private get flow(): FlowConfig | null {
    return this.cfg.flow?.enabled ? this.cfg.flow : null;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** Adds one event (ignored when its id is known). Only worker presence shapes the ground. */
  add(e: PEvent): boolean {
    if (this.seen.has(e.id)) return false;
    this.seen.add(e.id);
    if (e.s > this.latestS) this.latestS = e.s;
    if (e.k !== "p" || e.r !== "worker") return true;
    let L = this.lines.get(e.o);
    if (!L) {
      L = { o: this.names.length, s: [], x: [], z: [], id: [], stay: [], settled: 0, lastTick: this.tick, lastCell: NaN };
      this.names.push(e.o);
      this.lines.set(e.o, L);
    }
    const x = wrapCoord(e.x);
    const z = wrapCoord(e.z);
    // sorted insert by (s, id)
    let lo = 0;
    let hi = L.s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (L.s[mid] < e.s || (L.s[mid] === e.s && L.id[mid] < e.id)) lo = mid + 1;
      else hi = mid;
    }
    L.s.splice(lo, 0, e.s);
    L.x.splice(lo, 0, x);
    L.z.splice(lo, 0, z);
    L.id.splice(lo, 0, e.id);
    L.stay.splice(lo, 0, NaN);
    L.lastTick = this.tick;
    this.stats.samples++;
    if (e.s <= this.F || lo < L.settled) this.late = true;
    return true;
  }

  addMany(list: Iterable<PEvent>): number {
    let n = 0;
    for (const e of list) if (this.add(e)) n++;
    return n;
  }

  /** Forgets the samples before assigned time `cut` (what log.ts drops) and refolds the cells they were in. */
  dropBefore(cut: number): number {
    let n = 0;
    for (const [name, L] of this.lines) {
      let k = 0;
      while (k < L.s.length && L.s[k] < cut) k++;
      if (!k) continue;
      for (let i = 0; i < k; i++) this.seen.delete(L.id[i]);
      L.s.splice(0, k);
      L.x.splice(0, k);
      L.z.splice(0, k);
      L.id.splice(0, k);
      L.stay.splice(0, k);
      L.settled = Math.max(0, L.settled - k);
      n += k;
      if (!L.s.length) this.lines.delete(name);
    }
    this.stats.samples -= n;
    if (!n) return 0;
    for (const [nk, c] of this.cells) {
      let ks = 0;
      while (ks < c.s.length && c.s[ks] < cut) ks++;
      let kt = 0;
      for (let i = 0; i < c.ts.length; i++) {
        if (c.t0[i] < cut) continue; // a walk that started before the cut: its start is forgotten, so is the walk
        c.ts[kt] = c.ts[i];
        c.ta[kt] = c.ta[i];
        c.tc[kt] = c.tc[i];
        c.tq[kt] = c.tq[i];
        c.t0[kt] = c.t0[i];
        kt++;
      }
      const dropped = ks || kt < c.ts.length;
      if (!dropped) continue;
      c.s.splice(0, ks);
      c.w.splice(0, ks);
      c.o.splice(0, ks);
      c.ts.length = c.ta.length = c.tc.length = c.tq.length = c.t0.length = kt;
      if (!c.s.length && !c.ts.length) this.cells.delete(nk);
      else this.replay(c);
    }
    return n;
  }

  /** Everything forgotten. */
  clear(): void {
    this.lines.clear();
    this.names.length = 0;
    this.cells.clear();
    this.seen.clear();
    this.F = -Infinity;
    this.sView = -Infinity;
    this.late = false;
    this.latestS = 0;
    this.stats.samples = 0;
  }

  // ── folding ──────────────────────────────────────────────────────────────────────────────────────────────

  private cell(cx: number, cz: number, touched?: Map<Cell, Checkpoint | null>): Cell {
    const nk = nkOf(cx, cz);
    let c = this.cells.get(nk);
    if (!c) {
      c = new Cell(cx, cz);
      this.cells.set(nk, c);
      if (touched) touched.set(c, null); // created during the tail: removed afterwards
    } else if (touched && !touched.has(c)) touched.set(c, checkpoint(c));
    return c;
  }

  private levelAt(c: Cell, gc: number, gq: number, t: number, tau: number): number {
    return Math.hypot(gc, gq) * Math.exp(-(t - c.ref) / tau);
  }

  private inUse(c: Cell, s: number): boolean {
    const tail = this.cfg.emptyGapSec;
    for (const sp of c.spans) if (sp[0] <= s && s <= sp[1] + tail) return true;
    return false;
  }

  /**
   * Folds tread entry `i` of the cell into the sums that block a building (fold.ts: a cell already trodden to blockAt
   * gets no slab). At one instant this comes BEFORE the presence of that instant: the batch fold's nucleation check
   * at time s sees every tread up to and including s.
   */
  private applyTreadBlock(c: Cell, i: number, flow: FlowConfig): void {
    const s = c.ts[i];
    const tau = flow.tauSec;
    if (s - c.ref > 30 * tau) {
      const f = Math.exp(-(s - c.ref) / tau);
      c.gc *= f;
      c.gq *= f;
      c.pc *= f;
      c.pq *= f;
      c.ref = s;
    }
    const k = Math.exp((s - c.ref) / tau) * c.ta[i];
    c.gc += k * c.tc[i];
    c.gq += k * c.tq[i];
  }

  /**
   * Folds tread entry `i` into the path sums — unless a building is in use on the cell at that instant (fold.ts:
   * concrete is not a path). This comes AFTER the presence of that instant: the batch fold judges "in use" by the
   * spans as they finally are, and the presence at time s is part of them.
   */
  private applyTreadPath(c: Cell, i: number, flow: FlowConfig): void {
    const s = c.ts[i];
    if (this.inUse(c, s)) return;
    const k = Math.exp((s - c.ref) / flow.tauSec) * c.ta[i];
    c.pc += k * c.tc[i];
    c.pq += k * c.tq[i];
    c.pn++;
  }

  /** Folds presence splat `j` of the cell into its window, totals and spans (fold.ts, per cell). */
  private applySplat(c: Cell, j: number, flow: FlowConfig | null): void {
    const cfg = this.cfg;
    const s = c.s[j];
    const w = c.w[j];
    const o = c.o[j];
    const dt = cfg.sampleSec;
    const cap = cfg.visitorCap;
    if (c.nuc < 0) {
      const prev = c.own.get(o) ?? 0;
      const next = prev + w * dt;
      c.own.set(o, next);
      c.capped += Math.min(cap, next) - Math.min(cap, prev);
      while (s - c.s[c.lo] >= cfg.windowSec) {
        const p = c.own.get(c.o[c.lo]) ?? 0;
        const q = p - c.w[c.lo] * dt;
        if (q <= FOLD_EPS) {
          c.own.delete(c.o[c.lo]);
          c.capped -= Math.min(cap, p);
        } else {
          c.own.set(c.o[c.lo], q);
          c.capped += Math.min(cap, q) - Math.min(cap, p);
        }
        c.lo++;
      }
      const blocked = !!flow && flowP(this.levelAt(c, c.gc, c.gq, s, flow.tauSec), flow) >= flow.blockAt;
      if (c.capped >= cfg.threshold - FOLD_EPS && c.own.size >= cfg.minVisitors && !blocked) c.nuc = j;
    }
    const prev = c.total.get(o) ?? 0;
    const next = prev + w * dt;
    c.total.set(o, next);
    c.mass += Math.min(cap, next) - Math.min(cap, prev);
    if (!c.first.has(o)) c.first.set(o, s);
    c.last.set(o, s);
    if (c.nuc >= 0) {
      const r = rawHeightOf(c.mass, cfg);
      if (!c.growth.length || r >= c.growth[c.growth.length - 1][1] + 0.05) c.growth.push([s, r]);
      if (c.nuc === j) c.spans.push([s, s]);
      else {
        const cur = c.spans[c.spans.length - 1];
        if (s - cur[1] > cfg.emptyGapSec) c.spans.push([s, s]);
        else cur[1] = s;
      }
    }
  }

  /** Rebuilds a cell's live state from its arrays, instant by instant: treads block, presence, treads tread. */
  private replay(c: Cell): void {
    c.reset();
    const flow = this.flow;
    let i = 0;
    let j = 0;
    while (i < c.s.length || j < c.ts.length) {
      const t = Math.min(i < c.s.length ? c.s[i] : Infinity, j < c.ts.length ? c.ts[j] : Infinity);
      const j0 = j;
      while (j < c.ts.length && c.ts[j] === t) {
        if (flow) this.applyTreadBlock(c, j, flow);
        j++;
      }
      while (i < c.s.length && c.s[i] === t) {
        this.applySplat(c, i, flow);
        i++;
      }
      if (flow) for (let k = j0; k < j; k++) this.applyTreadPath(c, k, flow);
    }
  }

  /** Stay share of sample i of a line, from the owner's samples within ±staySec that are visible (≤ sMax). */
  private stayOf(L: Line, i: number, sMax: number, flow: FlowConfig): number {
    const s = L.s[i];
    const x = L.x[i];
    const z = L.z[i];
    let r = 0;
    for (let b = i - 1; b >= 0 && L.s[b] >= s - flow.staySec; b--) {
      const d = wrapDist(L.x[b], L.z[b], x, z);
      if (d > r) r = d;
    }
    for (let b = i + 1; b < L.s.length && L.s[b] <= s + flow.staySec && L.s[b] <= sMax; b++) {
      const d = wrapDist(L.x[b], L.z[b], x, z);
      if (d > r) r = d;
    }
    return stayShareOf(r, flow);
  }

  /** The tread of the segment ending at sample i (flow.ts flowTracks): entered and folded into the blocking sums; the path part follows the instant's presence. */
  private tread(ref: Ref, flow: FlowConfig, pending: [Cell, number][], touched?: Map<Cell, Checkpoint | null>): void {
    const { L, i } = ref;
    if (i === 0) return;
    const p = i - 1;
    if (L.s[i] - L.s[p] > MAX_STEP_SEC) return;
    const m = 1 - (L.stay[i] + L.stay[p]) / 2;
    if (m <= 0.01) return;
    const dx = wrapDelta(L.x[i] - L.x[p]);
    const dz = wrapDelta(L.z[i] - L.z[p]);
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const th = Math.atan2(dz, dx);
    const c2 = Math.cos(2 * th);
    const q2 = Math.sin(2 * th);
    const cells = treadCells(L.x[p], L.z[p], dx, dz);
    const amount = (m * len) / CELL_SIZE / cells.length;
    for (const [cx, cz] of cells) {
      const c = this.cell(cx, cz, touched);
      c.ts.push(L.s[i]);
      c.ta.push(amount);
      c.tc.push(c2);
      c.tq.push(q2);
      c.t0.push(L.s[p]);
      this.applyTreadBlock(c, c.ts.length - 1, flow);
      pending.push([c, c.ts.length - 1]);
    }
  }

  /** The presence splat of sample i (fold.ts). */
  private splat(ref: Ref, flow: FlowConfig | null, touched?: Map<Cell, Checkpoint | null>): void {
    const { L, i } = ref;
    const cfg = this.cfg;
    const s = L.s[i];
    const x = L.x[i];
    const z = L.z[i];
    const cx0 = Math.floor(x / CELL_SIZE);
    const cz0 = Math.floor(z / CELL_SIZE);
    if (!flow) {
      // V1 desire paths: a visit = entering a cell
      const nk = nkOf(wrapCell(cx0), wrapCell(cz0));
      if (L.lastCell !== nk) {
        L.lastCell = nk;
        const c = this.cell(wrapCell(cx0), wrapCell(cz0), touched);
        c.vn++;
        c.vLast = s;
      }
    }
    const builds = flow ? L.stay[i] + (1 - L.stay[i]) * flow.moveShare : 1;
    const n = Math.ceil(cfg.radius / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const d = Math.hypot((cx0 + dx + 0.5) * CELL_SIZE - x, (cz0 + dz + 0.5) * CELL_SIZE - z);
        if (d >= cfg.radius) continue;
        const c = this.cell(wrapCell(cx0 + dx), wrapCell(cz0 + dz), touched);
        c.s.push(s);
        c.w.push((1 - d / cfg.radius) * builds);
        c.o.push(L.o);
        this.applySplat(c, c.s.length - 1, flow);
      }
    }
  }

  /** Folds `refs` (sorted by (s, id)) instant by instant: treads block, presence, treads tread (see applyTread*). */
  private process(refs: Ref[], flow: FlowConfig | null, touched?: Map<Cell, Checkpoint | null>): void {
    const pending: [Cell, number][] = [];
    let g = 0;
    while (g < refs.length) {
      let h = g + 1;
      while (h < refs.length && refs[h].s === refs[g].s) h++;
      if (flow) for (let k = g; k < h; k++) this.tread(refs[k], flow, pending, touched);
      for (let k = g; k < h; k++) this.splat(refs[k], flow, touched);
      if (flow) {
        for (const [c, i] of pending) this.applyTreadPath(c, i, flow);
        pending.length = 0;
      }
      g = h;
    }
  }

  private rebuild(): void {
    this.cells.clear();
    for (const L of this.lines.values()) {
      L.settled = 0;
      L.lastCell = NaN;
    }
    this.F = -Infinity;
    this.late = false;
    this.stats.rebuilds++;
  }

  /** Settles every sample up to F (per owner a prefix of its timeline). */
  private settle(sView: number): void {
    const flow = this.flow;
    const look = flow ? flow.staySec : 0;
    let minLast = sView;
    for (const L of this.lines.values()) {
      if (!L.s.length || this.tick - L.lastTick > this.inactiveTicks) continue;
      const last = L.s[L.s.length - 1];
      if (last < minLast) minLast = last;
    }
    const F = Math.max(this.F, minLast - look - this.lateMargin);
    if (F <= this.F && this.F !== -Infinity) return;
    const refs: Ref[] = [];
    for (const L of this.lines.values()) {
      let k = L.settled;
      while (k < L.s.length && L.s[k] <= F) {
        if (flow) L.stay[k] = this.stayOf(L, k, Infinity, flow);
        refs.push({ L, i: k, s: L.s[k], id: L.id[k] });
        k++;
      }
      L.settled = k;
    }
    refs.sort(cmpRef);
    this.process(refs, flow);
    this.F = F;
  }

  /**
   * What is on the ground at the viewer's time `sView` — the cells within `region` (centre + radius; absent = the
   * whole world). Same output as foldWorld over the same events.
   */
  snapshot(sView: number, region?: Region, opts: SnapshotOptions = {}): Snapshot {
    this.tick++;
    if (this.late || sView < this.sView) this.rebuild();
    this.sView = sView;
    this.settle(sView);
    if (opts.tail === false) {
      this.stats.tail = 0;
      this.stats.cells = this.cells.size;
      this.stats.owners = this.lines.size;
      this.stats.frontier = this.F;
      return this.read(sView, region);
    }

    // the tail: everything after the frontier up to the viewer's time, replayed on top and taken off again — for a
    // region (V2) only what can reach it: the stay shares of every tail sample, the splats and treads of those near
    const flow = this.flow;
    const refs: Ref[] = [];
    const lineCp = new Map<Line, number>();
    const reach = region && flow ? region.r + this.cfg.radius + CELL_SIZE * 2 + TREAD_REACH : Infinity;
    const near = (L: Line, k: number) =>
      reach === Infinity || wrapDist(L.x[k], L.z[k], region!.x, region!.z) <= reach || (k > 0 && wrapDist(L.x[k - 1], L.z[k - 1], region!.x, region!.z) <= reach);
    for (const L of this.lines.values()) {
      for (let k = L.settled; k < L.s.length && L.s[k] <= sView; k++) {
        if (flow) L.stay[k] = this.stayOf(L, k, sView, flow);
        if (near(L, k)) refs.push({ L, i: k, s: L.s[k], id: L.id[k] });
      }
      if (!flow) lineCp.set(L, L.lastCell);
    }
    refs.sort(cmpRef);
    const touched = new Map<Cell, Checkpoint | null>();
    this.process(refs, flow, touched);
    this.stats.tail = refs.length;

    const out = this.read(sView, region);

    for (const [c, cp] of touched) {
      if (cp) restore(c, cp);
      else this.cells.delete(nkOf(c.cx, c.cz));
    }
    for (const [L, lc] of lineCp) L.lastCell = lc;
    this.stats.cells = this.cells.size;
    this.stats.owners = this.lines.size;
    this.stats.frontier = this.F;
    return out;
  }

  private read(sView: number, region?: Region): Snapshot {
    const cfg = this.cfg;
    const flow = this.flow;
    const slabs: Slab[] = [];
    const paths: PathCell[] = [];
    const readCell = (c: Cell) => {
      if (c.nuc >= 0) {
        const lastS = c.s[c.s.length - 1];
        const age = geoAge(sView, lastS);
        const foot = Math.exp(-age / cfg.tauFootprintYears);
        if (foot >= FOLD_MIN_FOOT) {
          const raw = rawHeightOf(c.mass, cfg);
          const who: Contributor[] = [];
          for (const [o, v] of c.total) who.push({ o: this.names[o], first: c.first.get(o)!, last: c.last.get(o)!, amount: Math.min(cfg.visitorCap, v) });
          slabs.push({
            key: c.key,
            x: c.x,
            z: c.z,
            h: raw * Math.exp(-age / cfg.tauSlabYears),
            raw,
            foot,
            bornS: c.s[c.nuc],
            lastS,
            spans: c.spans.map((sp) => [sp[0], sp[1]] as [number, number]),
            who,
            growth: c.growth.map((g) => [g[0], g[1]] as [number, number]),
          });
        }
      }
      if (flow) {
        if (c.pn > 0) {
          const p = flowP(this.levelAt(c, c.pc, c.pq, sView, flow.tauSec), flow);
          if (p >= FOLD_MIN_ALPHA) paths.push({ key: c.key, x: c.x, z: c.z, p, visits: c.pn });
        }
      } else if (c.vn > 0) {
        const age = geoAge(sView, c.vLast);
        const p = (1 - Math.exp(-c.vn / cfg.pathVisits)) * Math.exp(-age / cfg.tauPathYears);
        if (p >= FOLD_MIN_ALPHA) paths.push({ key: c.key, x: c.x, z: c.z, p, visits: c.vn });
      }
    };
    if (region) {
      const reach = region.r + cfg.radius;
      const n = Math.ceil(reach / CELL_SIZE) + 1;
      const cx0 = Math.floor(region.x / CELL_SIZE);
      const cz0 = Math.floor(region.z / CELL_SIZE);
      for (let dx = -n; dx <= n; dx++) {
        for (let dz = -n; dz <= n; dz++) {
          const c = this.cells.get(nkOf(wrapCell(cx0 + dx), wrapCell(cz0 + dz)));
          if (!c || wrapDist(c.x, c.z, region.x, region.z) > reach) continue;
          readCell(c);
        }
      }
    } else for (const c of this.cells.values()) readCell(c);
    const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    slabs.sort(byKey);
    paths.sort(byKey);
    return { slabs, paths };
  }
}

/**
 * The vegetation stress (nature.ts stressMap) as a state: S(cell, t) = Σ dose · w · e^(−(t − s)/recoverSec) is a sum
 * whose order does not matter, so every sample is added once (when the viewer's time has reached it) as
 * dose · w · e^((s − ref)/recoverSec), and a reading is the per-cell sum times e^(−(t − ref)/recoverSec).
 */
export class StressState {
  private readonly seen = new Set<string>();
  private readonly s: number[] = [];
  private readonly x: number[] = [];
  private readonly z: number[] = [];
  private readonly id: string[] = [];
  private absorbed = 0;
  private sView = -Infinity;
  private ref = 0;
  private readonly a = new Map<number, { cx: number; cz: number; v: number }>();

  constructor(readonly cfg: NatureConfig) {}

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(e: PEvent): boolean {
    if (this.seen.has(e.id)) return false;
    this.seen.add(e.id);
    if (e.k !== "p" || e.r !== "worker") return true;
    let lo = 0;
    let hi = this.s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] < e.s || (this.s[mid] === e.s && this.id[mid] < e.id)) lo = mid + 1;
      else hi = mid;
    }
    this.s.splice(lo, 0, e.s);
    this.x.splice(lo, 0, wrapCoord(e.x));
    this.z.splice(lo, 0, wrapCoord(e.z));
    this.id.splice(lo, 0, e.id);
    if (lo < this.absorbed) {
      // behind the viewer's time already: a sum does not mind the order
      this.absorbed++;
      this.apply(lo, 1);
    }
    return true;
  }

  addMany(list: Iterable<PEvent>): number {
    let n = 0;
    for (const e of list) if (this.add(e)) n++;
    return n;
  }

  private apply(i: number, sign: number): void {
    const cfg = this.cfg;
    const k = sign * cfg.dose * Math.exp((this.s[i] - this.ref) / cfg.recoverSec);
    const x = this.x[i];
    const z = this.z[i];
    const cx0 = Math.floor(x / CELL_SIZE);
    const cz0 = Math.floor(z / CELL_SIZE);
    const n = Math.ceil(cfg.lingerRadius / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const d = Math.hypot((cx0 + dx + 0.5) * CELL_SIZE - x, (cz0 + dz + 0.5) * CELL_SIZE - z);
        if (d >= cfg.lingerRadius) continue;
        const cx = wrapCell(cx0 + dx);
        const cz = wrapCell(cz0 + dz);
        const nk = nkOf(cx, cz);
        const cell = this.a.get(nk);
        if (cell) cell.v += k * (1 - d / cfg.lingerRadius);
        else this.a.set(nk, { cx, cz, v: k * (1 - d / cfg.lingerRadius) });
      }
    }
  }

  clear(): void {
    this.seen.clear();
    this.s.length = this.x.length = this.z.length = this.id.length = 0;
    this.absorbed = 0;
    this.sView = -Infinity;
    this.a.clear();
  }

  /** Forgets the samples before `cut` (what log.ts drops). */
  dropBefore(cut: number): number {
    let k = 0;
    while (k < this.s.length && this.s[k] < cut) k++;
    if (!k) return 0;
    for (let i = 0; i < Math.min(k, this.absorbed); i++) this.apply(i, -1);
    for (let i = 0; i < k; i++) this.seen.delete(this.id[i]);
    this.s.splice(0, k);
    this.x.splice(0, k);
    this.z.splice(0, k);
    this.id.splice(0, k);
    this.absorbed = Math.max(0, this.absorbed - k);
    return k;
  }

  /** Stress per cell ("cx,cz" → S) at the viewer's time, within `region` (absent = everywhere). */
  at(sView: number, region?: Region): Map<string, number> {
    const cfg = this.cfg;
    if (sView < this.sView) {
      this.a.clear();
      this.absorbed = 0;
      this.ref = sView;
    }
    if (sView - this.ref > 30 * cfg.recoverSec) {
      const f = Math.exp(-(sView - this.ref) / cfg.recoverSec);
      for (const cell of this.a.values()) cell.v *= f;
      this.ref = sView;
    }
    while (this.absorbed < this.s.length && this.s[this.absorbed] <= sView) this.apply(this.absorbed++, 1);
    this.sView = sView;
    const f = Math.exp(-(sView - this.ref) / cfg.recoverSec);
    const out = new Map<string, number>();
    const reach = region ? region.r + cfg.lingerRadius : Infinity;
    for (const cell of this.a.values()) {
      const S = cell.v * f;
      if (S < 1e-4) continue;
      if (region && wrapDist((cell.cx + 0.5) * CELL_SIZE, (cell.cz + 0.5) * CELL_SIZE, region.x, region.z) > reach) continue;
      out.set(`${cell.cx},${cell.cz}`, S);
    }
    return out;
  }
}
