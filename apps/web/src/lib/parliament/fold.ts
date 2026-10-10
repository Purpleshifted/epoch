/**
 * parliament/fold.ts
 *
 * Pure fold: events (log) + a viewing time `sView` -> what is on the ground at that moment.
 *
 * WORKER rule (the first role built). Concrete appears where worker presence is DENSE IN
 * SPACETIME, not only at the same moment: every presence sample (x, z, s) counts towards a
 * ground cell with a linear distance kernel inside the spatial radius, and a cell nucleates a
 * slab at the first moment the kernel-weighted presence inside the sliding window
 * (s - windowSec, s] reaches `threshold`. After that each further `pourUnit` raises the slab by
 * one unit. Nothing is counted from after `sView`, so the fold is causal.
 *
 * Wear is measured in MODEL years (geoClock, log-compressed wall time) since the last presence
 * that kept the slab in use. The exposed slab wears faster than the buried footprint, so in a far
 * future only the outline of where people crowded is left. Views that show the whole history (the 3D
 * timespace) fold with `withoutWear(cfg)`, so nothing that was ever built drops out of them.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { geoYears } from "@/lib/stratum/geoClock";
import { flowLevel, flowP, flowTracks, stayShares, type Track } from "./flow";
import { DEFAULT_FOLD, type FoldConfig, type PathCell, type PEvent, type Slab, type Snapshot } from "./types";

const MIN_FOOT = 0.03;
const MIN_ALPHA = 0.05;
const EPS = 1e-9;

export interface Region {
  x: number;
  z: number;
  r: number;
}

interface Acc {
  cx: number;
  cz: number;
  s: number[];
  w: number[];
  o: string[];
}

export function foldWorld(
  events: readonly PEvent[],
  sView: number,
  cfg: FoldConfig = DEFAULT_FOLD,
  region?: Region,
): Snapshot {
  const reach = region ? region.r + cfg.radius : Infinity;
  const vis: PEvent[] = [];
  for (const e of events) {
    if (e.s > sView) continue; // the future of this viewer: invisible
    if (region && Math.hypot(e.x - region.x, e.z - region.z) > reach) continue;
    vis.push(e);
  }
  vis.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // ties by id: same float sums in every view

  const yView = geoYears(sView);
  // numeric cell keys while splatting (every event touches ~(2·radius/cell)² cells); the "cx,cz" string only per slab
  const cells = new Map<number, Acc>();
  const n = Math.ceil(cfg.radius / CELL_SIZE);
  const lastCell = new Map<string, string>();
  const visits = new Map<string, { n: number; lastS: number; x: number; z: number }>();

  // V2: stays build, moves tread (flow.ts); a move still builds by moveShare
  const flow = cfg.flow?.enabled ? cfg.flow : null;
  const workers = flow ? vis.filter((e) => e.r === "worker") : [];
  const stay = flow ? stayShares(workers, flow) : null;
  let wi = -1;

  for (const e of vis) {
    if (e.r !== "worker") continue;
    wi++;
    const builds = flow && stay ? stay[wi] + (1 - stay[wi]) * flow.moveShare : 1;
    // a visit = entering a cell (standing still in it is one visit, not many)
    const vcx = Math.floor(e.x / CELL_SIZE);
    const vcz = Math.floor(e.z / CELL_SIZE);
    const vk = `${vcx},${vcz}`;
    if (lastCell.get(e.o) !== vk) {
      lastCell.set(e.o, vk);
      const v = visits.get(vk);
      if (v) {
        v.n++;
        v.lastS = e.s;
      } else visits.set(vk, { n: 1, lastS: e.s, x: (vcx + 0.5) * CELL_SIZE, z: (vcz + 0.5) * CELL_SIZE });
    }
    // presence: splat onto the cells whose centre lies inside the spatial radius
    const cx0 = Math.floor(e.x / CELL_SIZE);
    const cz0 = Math.floor(e.z / CELL_SIZE);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        const d = Math.hypot((cx + 0.5) * CELL_SIZE - e.x, (cz + 0.5) * CELL_SIZE - e.z);
        if (d >= cfg.radius) continue;
        const nk = (cx + 32768) * 65536 + (cz + 32768);
        let acc = cells.get(nk);
        if (!acc) {
          acc = { cx, cz, s: [], w: [], o: [] };
          cells.set(nk, acc);
        }
        acc.s.push(e.s);
        acc.w.push((1 - d / cfg.radius) * builds);
        acc.o.push(e.o);
      }
    }
  }

  // V2, the path came first: a cell already trodden to blockAt when it would nucleate gets no slab
  const treadA = flow && stay ? flowTracks(workers, stay) : null;
  const blocked = (key: string, s: number) => !!flow && !!treadA && flowP(flowLevel(treadA.get(key), s, flow.tauSec), flow) >= flow.blockAt;

  const cap = cfg.visitorCap;
  const slabs: Slab[] = [];
  for (const acc of cells.values()) {
    const key = `${acc.cx},${acc.cz}`;
    const { s, w, o } = acc;
    const dt = cfg.sampleSec;
    // sliding window with one running sum PER VISITOR; a visitor counts at most `cap`
    const own = new Map<string, number>();
    let lo = 0;
    let capped = 0;
    let nuc = -1;
    for (let j = 0; j < s.length; j++) {
      const prev = own.get(o[j]) ?? 0;
      const next = prev + w[j] * dt;
      own.set(o[j], next);
      capped += Math.min(cap, next) - Math.min(cap, prev);
      while (s[j] - s[lo] >= cfg.windowSec) {
        const p = own.get(o[lo]) ?? 0;
        const q = p - w[lo] * dt;
        if (q <= EPS) {
          own.delete(o[lo]);
          capped -= Math.min(cap, p);
        } else {
          own.set(o[lo], q);
          capped += Math.min(cap, q) - Math.min(cap, p);
        }
        lo++;
      }
      if (capped >= cfg.threshold - EPS && own.size >= cfg.minVisitors && !blocked(key, s[j])) {
        nuc = j;
        break;
      }
    }
    if (nuc < 0) continue;

    // growth: everything every visitor ever put in this cell, each visitor capped — followed through time, so the
    // slab knows when it grew (growth) and who built it (who)
    const total = new Map<string, number>();
    const firstOf = new Map<string, number>();
    const lastOf = new Map<string, number>();
    const growth: [number, number][] = [];
    let mass = 0;
    const rawOf = (m: number) => Math.min(cfg.maxHeight, 1 + Math.max(0, m - cfg.threshold) / cfg.pourUnit);
    for (let k = 0; k < s.length; k++) {
      const prev = total.get(o[k]) ?? 0;
      const next = prev + w[k] * dt;
      total.set(o[k], next);
      mass += Math.min(cap, next) - Math.min(cap, prev);
      if (!firstOf.has(o[k])) firstOf.set(o[k], s[k]);
      lastOf.set(o[k], s[k]);
      if (k >= nuc) {
        const r = rawOf(mass);
        if (!growth.length || r >= growth[growth.length - 1][1] + 0.05) growth.push([s[k], r]);
      }
    }
    const raw = rawOf(mass);
    const who = [...total].map(([id, v]) => ({ o: id, first: firstOf.get(id)!, last: lastOf.get(id)!, amount: Math.min(cap, v) }));

    const lastS = s[s.length - 1];
    // when somebody was around, from the birth on; a pause longer than emptyGapSec is empty time
    const spans: [number, number][] = [[s[nuc], s[nuc]]];
    for (let k = nuc + 1; k < s.length; k++) {
      const cur = spans[spans.length - 1];
      if (s[k] - cur[1] > cfg.emptyGapSec) spans.push([s[k], s[k]]);
      else cur[1] = s[k];
    }
    const age = Math.max(0, yView - geoYears(lastS));
    const foot = Math.exp(-age / cfg.tauFootprintYears);
    if (foot < MIN_FOOT) continue;
    const h = raw * Math.exp(-age / cfg.tauSlabYears);
    slabs.push({
      key,
      x: (acc.cx + 0.5) * CELL_SIZE,
      z: (acc.cz + 0.5) * CELL_SIZE,
      h,
      raw,
      foot,
      bornS: s[nuc],
      lastS,
      spans,
      who,
      growth,
    });
  }
  slabs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const paths: PathCell[] = [];
  if (flow && stay) {
    // V2: paths are the ground trodden by sustained flow; on a cell whose slab already stands nobody treads
    const born = new Map<string, number>();
    for (const sl of slabs) born.set(sl.key, sl.bornS);
    const tread: Map<string, Track> = flowTracks(workers, stay, (k) => born.get(k));
    for (const [key, tr] of tread) {
      const p = flowP(flowLevel(tr, sView, flow.tauSec), flow);
      if (p < MIN_ALPHA) continue;
      const [cx, cz] = key.split(",").map(Number);
      paths.push({ key, x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, p, visits: tr.s.length });
    }
    paths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { slabs, paths };
  }

  // desire paths: formed by repeated entries, worn away once nobody walks them
  for (const [key, v] of visits) {
    const age = Math.max(0, yView - geoYears(v.lastS));
    const p = (1 - Math.exp(-v.n / cfg.pathVisits)) * Math.exp(-age / cfg.tauPathYears);
    if (p < MIN_ALPHA) continue;
    paths.push({ key, x: v.x, z: v.z, p, visits: v.n });
  }
  paths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { slabs, paths };
}

/**
 * The same rule without wear: every slab that ever nucleated stays, at its full (raw) height. For views that
 * show history rather than one moment (the 3D timespace): with wear, a slab whose footprint had decayed by the
 * latest time simply vanished from them — after only a few minutes once the epoch is hours old, because model
 * years run faster and faster (geoClock).
 */
export function withoutWear(cfg: FoldConfig): FoldConfig {
  return { ...cfg, tauSlabYears: Infinity, tauFootprintYears: Infinity };
}

/** Latest event time in the log (0 for an empty log). */
export function latestS(events: readonly PEvent[]): number {
  let m = 0;
  for (const e of events) if (e.s > m) m = e.s;
  return m;
}

/** Latest presence time of one owner (visitor or bot), or null if they left nothing. */
export function latestOf(events: readonly PEvent[], owner: string | null | undefined): number | null {
  if (!owner) return null;
  let m: number | null = null;
  for (const e of events) if (e.o === owner && e.k === "p" && (m === null || e.s > m)) m = e.s;
  return m;
}
