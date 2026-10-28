/**
 * parliament/ledger.ts — the LEDGER of one life: what this visitor's walking and staying did to the ground, derived
 * from their own samples and the world as it is folded now. 2026-10-20: the personal view now TELLS the visitor what
 * their life amounts to (until then it stated facts only — docs/direction-2026-10-10.md §1, withdrawn by the artist).
 *
 *   ledgerAt()      one reading (every fold, while LIVE): my own stress on the cells around my samples (nature.ts
 *                   stressMap over MY events only), my own treads (flow.ts flowTracks over my events), the slabs whose
 *                   `who` carries my id (the fold's attribution), the world's totals as denominators, how long I have
 *                   been alone. Cumulative fields (peaks, first times, "was it a path before I trod it") carry over
 *                   from the previous reading.
 *   LedgerWatch     turns readings into log entries (witness.ts LogEntry): the first pressed grass, grass that stood
 *                   back up, worn ground, a path that formed under my feet, concrete with my share in it, sealed
 *                   ground under me, a long time alone — each held for `settleSec` before it is told, at most one
 *                   every `gapSec`, the most important first.
 *   ledgerSummary() the end screen's rows: the same numbers as shares and percentages.
 *
 * Pure and deterministic. Cost per reading: my samples (≤ ~200 a life) × the stress kernel, plus one pass over the
 * world's paths and slabs.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { MAX_STEP_SEC, flowLevel, flowTracks, stayShares, type FlowConfig } from "./flow";
import { baseGrass, stressMap, type NatureConfig } from "./nature";
import type { PEvent, Snapshot } from "./types";
import type { LogEntry, LogKey, Surface, Who } from "./witness";
import { wrapDist } from "./world";

export interface LedgerConfig {
  /** My own stress S from which a cell counts as pressed by me (1 − e^−0.25 ≈ 22 % of its grass gone). */
  pressS: number;
  /** World path strength from which a cell is a path (the record's "trodden", witness.ts). */
  pathP: number;
  /** Slab height from which a cell is sealed. */
  sealedH: number;
  /** Still with nobody near for this long (s) = a fact worth a line. */
  aloneSec: number;
  /** My own trodden-ness (cell widths) from which I count as having trodden a cell. */
  gEps: number;
  /** A condition must hold this long (s) before its line is written (the fold's tail is provisional). */
  settleSec: number;
  /** At most one ledger line every this many seconds. */
  gapSec: number;
  /** A line not yet told after this long is dropped. */
  staleSec: number;
}

export const DEFAULT_LEDGER: LedgerConfig = {
  pressS: 0.25,
  pathP: 0.3,
  sealedH: 0.15,
  aloneSec: 60,
  gEps: 0.05,
  settleSec: 1.5,
  gapSec: 8,
  staleSec: 30,
};

export interface LedgerSlab {
  /** My weight in it (worker·s, capped like the fold's growth) and everybody's. */
  mine: number;
  total: number;
  h: number;
  bornS: number;
  /** The others who put weight into it. */
  with: string[];
}

export interface LedgerCell {
  key: string;
  cx: number;
  cz: number;
  /** Vegetation the cell had before anyone (nature.ts baseGrass). */
  grass: number;
  /** Session seconds when the cell first entered the ledger. */
  firstT: number;
  /** My own stress now and its peak. */
  s: number;
  sPeak: number;
  /** Grass pressed by my stress now (grass · (1 − e^−S)), its peak, and the grass pressed by everyone's stress now. */
  pressMine: number;
  pressPeak: number;
  pressAll: number;
  /** My own trodden-ness (flow.ts G) and the world's path strength and visit count on the cell. */
  g: number;
  pathP: number;
  visits: number;
  /** Session seconds when I first trod the cell (null: not trodden by me), and whether the OTHERS' treading alone
   * already made it a path then (the world's trodden-ness less mine). */
  trodT: number | null;
  prePath: boolean;
  /** A slab with my weight in it on this cell, once it has been seen for settleSec (null otherwise). */
  slab: LedgerSlab | null;
  slabSeenT: number | null;
}

export interface Ledger {
  /** Session seconds and assigned seconds of this reading; the assigned second the life began. */
  t: number;
  sNow: number;
  sStart: number;
  cells: Map<string, LedgerCell>;
  /** Where I was at every reading (canonical coordinates), and how far I walked (world units). */
  trail: { x: number; z: number; t: number }[];
  walkedM: number;
  grass: {
    /** Cell-equivalents of grass my stress pressed, at its peak per cell (cells with sPeak ≥ pressS). */
    pressed: number;
    /** Of that, what stands again now (whoever's stress it was). */
    recovered: number;
    /** Grass gone under the paths I trod (pathBite · p) and under the slabs I helped (1 − sealedLeft). */
    underPaths: number;
    underSlabs: number;
    /** Cells pressed by me. */
    cells: number;
  };
  ground: {
    /** Cells I trod (g ≥ gEps); of them, the ones that are paths now and were not when I first trod them; the ones
     * that already were. */
    cells: number;
    newPath: number;
    prePath: number;
    /** World visits on the latest path I stepped onto that was there before me. */
    prePathVisits: number;
  };
  concrete: {
    /** Slab cells with my weight in them, my weight, everybody's, and the others I built with. */
    cells: number;
    mine: number;
    total: number;
    with: string[];
    /** Session seconds the earliest of them was born (negative: before this life). */
    firstT: number | null;
    /** A slab with my weight in it is under my feet now. */
    underMe: boolean;
  };
  world: {
    /** The world's path cells (p ≥ pathP) and sealed slab cells now, and how many of its path cells I trod. */
    pathCells: number;
    slabCells: number;
    pathTrodden: number;
  };
  alone: { since: number | null; longest: number };
}

export interface LedgerInputs {
  me: { id: string; x: number; z: number };
  /** My own samples, in time order. */
  mine: readonly PEvent[];
  sNow: number;
  t: number;
  /** The whole world as folded now, and everyone's vegetation stress. */
  snap: Snapshot;
  stress: Map<string, number>;
  natureCfg: NatureConfig;
  flow: FlowConfig | null;
  /** Others within the presence radius now. */
  nearCount: number;
  /** The trail so far (every fold, finer than the ledger's own readings); absent = the ledger keeps its own. */
  trail?: readonly { x: number; z: number; t: number }[];
  cfg?: LedgerConfig;
  prev: Ledger | null;
}

const cellOf = (x: number, z: number): [number, number] => [Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)];

/** One reading of the ledger (see the header). */
export function ledgerAt(inp: LedgerInputs): Ledger {
  const cfg = inp.cfg ?? DEFAULT_LEDGER;
  const { me, mine, sNow, t, snap, stress, natureCfg, flow, prev } = inp;
  const sStart = prev?.sStart ?? sNow - t;
  const cells = new Map<string, LedgerCell>();
  const at = (key: string): LedgerCell => {
    let c = cells.get(key);
    if (!c) {
      const p = prev?.cells.get(key);
      const [cx, cz] = key.split(",").map(Number);
      c = p
        ? { ...p, slab: p.slab }
        : { key, cx, cz, grass: baseGrass(cx, cz), firstT: t, s: 0, sPeak: 0, pressMine: 0, pressPeak: 0, pressAll: 0, g: 0, pathP: 0, visits: 0, trodT: null, prePath: false, slab: null, slabSeenT: null };
      cells.set(key, c);
    }
    return c;
  };
  // the world's paths and slabs by cell
  const pathAt = new Map<string, { p: number; visits: number }>();
  let pathCells = 0;
  for (const q of snap.paths) {
    pathAt.set(q.key, { p: q.p, visits: q.visits });
    if (q.p >= cfg.pathP) pathCells++;
  }
  const mySlabs = new Map<string, LedgerSlab>();
  let slabCells = 0;
  for (const sl of snap.slabs) {
    if (sl.h >= cfg.sealedH) slabCells++;
    const w = sl.who;
    if (!w) continue;
    const mineW = w.find((c) => c.o === me.id);
    if (!mineW || mineW.amount <= 0) continue;
    let total = 0;
    const others: string[] = [];
    for (const c of w) {
      total += c.amount;
      if (c.o !== me.id && c.amount > 0) others.push(c.o);
    }
    mySlabs.set(sl.key, { mine: mineW.amount, total, h: sl.h, bornS: sl.bornS, with: others });
  }
  // my own stress and treads
  const sMine = stressMap(mine, sNow, natureCfg);
  const tracks = flow ? flowTracks(mine, stayShares(mine, flow)) : new Map();
  // carry every cell of the previous reading (its peaks and slabs), then update what is current
  if (prev) for (const key of prev.cells.keys()) at(key);
  for (const key of sMine.keys()) at(key);
  for (const key of tracks.keys()) at(key);
  for (const key of mySlabs.keys()) at(key);

  const grass = { pressed: 0, recovered: 0, underPaths: 0, underSlabs: 0, cells: 0 };
  const ground = { cells: 0, newPath: 0, prePath: 0, prePathVisits: prev?.ground.prePathVisits ?? 0 };
  const concrete = { cells: 0, mine: 0, total: 0, with: new Set<string>(), firstT: null as number | null, underMe: false };
  let pathTrodden = 0;
  const [mcx, mcz] = cellOf(me.x, me.z);
  const myKey = `${mcx},${mcz}`;
  for (const c of cells.values()) {
    const S = sMine.get(c.key) ?? 0;
    c.s = S;
    c.sPeak = Math.max(c.sPeak, S);
    c.pressMine = c.grass * (1 - Math.exp(-S));
    c.pressPeak = Math.max(c.pressPeak, c.pressMine);
    c.pressAll = c.grass * (1 - Math.exp(-(stress.get(c.key) ?? 0)));
    const q = pathAt.get(c.key);
    c.pathP = q?.p ?? 0;
    c.visits = q?.visits ?? 0;
    c.g = flow ? flowLevel(tracks.get(c.key), sNow, flow.tauSec) : 0;
    if (c.g >= cfg.gEps && c.trodT === null) {
      c.trodT = t;
      // a path "before me": what the others trod there, without my own share of the trodden-ness
      const gWorld = flow ? -flow.unit * Math.log(1 - Math.min(0.999, c.pathP)) : 0;
      const pOthers = flow ? 1 - Math.exp(-Math.max(0, gWorld - c.g) / flow.unit) : 0;
      c.prePath = pOthers >= cfg.pathP;
      if (c.prePath) ground.prePathVisits = c.visits;
    }
    const sl = mySlabs.get(c.key);
    if (sl) {
      if (c.slabSeenT === null) c.slabSeenT = t;
      if (t - c.slabSeenT >= cfg.settleSec) c.slab = sl;
    } else c.slabSeenT = null;

    if (c.sPeak >= cfg.pressS) {
      grass.cells++;
      grass.pressed += c.pressPeak;
      grass.recovered += Math.max(0, c.pressPeak - c.pressAll);
    }
    if (c.trodT !== null) {
      ground.cells++;
      if (c.pathP >= cfg.pathP) {
        pathTrodden++;
        grass.underPaths += c.grass * natureCfg.pathBite * c.pathP;
        if (c.prePath) ground.prePath++;
        else ground.newPath++;
      }
    }
    if (c.slab) {
      concrete.cells++;
      concrete.mine += c.slab.mine;
      concrete.total += c.slab.total;
      for (const o of c.slab.with) concrete.with.add(o);
      const bornT = t - (sNow - c.slab.bornS);
      if (concrete.firstT === null || bornT < concrete.firstT) concrete.firstT = bornT;
      grass.underSlabs += c.grass * (1 - natureCfg.sealedLeft);
      if (c.key === myKey && c.slab.h >= cfg.sealedH) concrete.underMe = true;
    }
  }
  // how far I walked: my consecutive samples, when they are one walk
  let walkedM = 0;
  for (let i = 1; i < mine.length; i++) {
    const a = mine[i - 1], b = mine[i];
    if (b.s - a.s <= MAX_STEP_SEC) walkedM += wrapDist(a.x, a.z, b.x, b.z);
  }
  let trail: { x: number; z: number; t: number }[];
  if (inp.trail) trail = inp.trail.slice();
  else {
    trail = prev ? prev.trail.slice() : [];
    trail.push({ x: me.x, z: me.z, t });
  }
  const alone = inp.nearCount === 0 ? { since: prev?.alone.since ?? t, longest: prev?.alone.longest ?? 0 } : { since: null, longest: prev?.alone.longest ?? 0 };
  if (alone.since !== null) alone.longest = Math.max(alone.longest, t - alone.since);
  return {
    t,
    sNow,
    sStart,
    cells,
    trail,
    walkedM,
    grass,
    ground,
    concrete: { ...concrete, with: [...concrete.with] },
    world: { pathCells, slabCells, pathTrodden },
    alone,
  };
}

// ── telling ──────────────────────────────────────────────────────────────────

/** Which ledger line goes first when several are due. */
export const LEDGER_PRIORITY: Record<string, number> = {
  "concrete.share": 0,
  "path.formed": 1,
  "sealed.under": 2,
  "grass.pressed": 3,
  "grass.recovered": 4,
  "alone.long": 5,
  "ground.prePath": 6,
  "ground.worn": 7,
};

/** The pressed-grass steps (cell-equivalents) at which the ledger speaks of it. */
export const PRESSED_STEPS = [1, 10, 30, 60];

/**
 * Watches the ledger and writes its lines: each condition has to hold for `settleSec` (the fold's tail is
 * provisional), the lines queue and come out one every `gapSec`, the most important first; a line that waited
 * longer than `staleSec` is dropped.
 */
export class LedgerWatch {
  readonly cfg: LedgerConfig;
  private held = new Map<string, number>();
  private told = { pressedStep: 0, recovered: false, wornNext: 10, prePath: false, pathNext: 1, concreteCells: 0, concretePct: -1, sealed: false, aloneSince: null as number | null };
  private queue: LogEntry[] = [];
  private lastT = -Infinity;

  constructor(cfg: LedgerConfig = DEFAULT_LEDGER) {
    this.cfg = cfg;
  }

  /** Whether `cond` has held for settleSec by `t`. */
  private hold(name: string, cond: boolean, t: number): boolean {
    if (!cond) {
      this.held.delete(name);
      return false;
    }
    const since = this.held.get(name) ?? t;
    this.held.set(name, since);
    return t - since >= this.cfg.settleSec;
  }

  /** Feed a reading; `roleOf` names the others I built with. Returns the line to write now, if any. */
  feed(l: Ledger, surface: Surface, roleOf: (o: string) => Who["r"] = () => "worker"): LogEntry[] {
    const { t } = l;
    const cfg = this.cfg;
    const told = this.told;
    const add = (key: LogKey, args: LogEntry["args"], level: LogEntry["level"]) => this.queue.push({ t, key, args, level });

    const step = PRESSED_STEPS[told.pressedStep];
    if (step !== undefined && this.hold("pressed", l.grass.pressed >= step, t)) {
      add("grass.pressed", { n: Math.round(l.grass.pressed) }, 1);
      told.pressedStep++;
      this.held.delete("pressed");
    }
    if (!told.recovered && this.hold("recovered", l.grass.pressed >= 1 && l.grass.recovered / l.grass.pressed >= 0.5, t)) {
      add("grass.recovered", { pct: Math.round((100 * l.grass.recovered) / l.grass.pressed) }, 1);
      told.recovered = true;
    }
    if (this.hold("worn", l.ground.cells >= told.wornNext, t)) {
      add("ground.worn", { n: l.ground.cells }, 0);
      told.wornNext = l.ground.cells + 20;
      this.held.delete("worn");
    }
    if (!told.prePath && this.hold("prePath", l.ground.prePath >= 1, t)) {
      add("ground.prePath", { n: l.ground.prePathVisits }, 0);
      told.prePath = true;
    }
    if (this.hold("path", l.ground.newPath >= told.pathNext, t)) {
      add("path.formed", { n: l.ground.newPath }, 2);
      told.pathNext = l.ground.newPath + 5;
      this.held.delete("path");
    }
    const pct = l.concrete.total > 0 ? Math.round((100 * l.concrete.mine) / l.concrete.total) : 0;
    const concreteNews = l.concrete.cells > 0 && (told.concreteCells === 0 || l.concrete.cells >= told.concreteCells + 3 || Math.abs(pct - told.concretePct) >= 10);
    if (this.hold("concrete", concreteNews, t)) {
      add("concrete.share", { n: l.concrete.cells, pct, with: l.concrete.with.map((o) => ({ o, r: roleOf(o) })), at: l.concrete.firstT ?? undefined }, 2);
      told.concreteCells = l.concrete.cells;
      told.concretePct = pct;
      this.held.delete("concrete");
    }
    if (!told.sealed && this.hold("sealed", surface === "sealed" && l.concrete.underMe, t)) {
      add("sealed.under", { pct: 5 }, 1);
      told.sealed = true;
    }
    if (l.alone.since !== null && told.aloneSince !== l.alone.since && t - l.alone.since >= cfg.aloneSec) {
      add("alone.long", { sec: cfg.aloneSec }, 1);
      told.aloneSince = l.alone.since;
    }

    // out: one at a time, the most important first, nothing stale
    this.queue = this.queue.filter((e) => t - e.t <= cfg.staleSec);
    if (!this.queue.length || t - this.lastT < cfg.gapSec) return [];
    this.queue.sort((a, b) => (LEDGER_PRIORITY[a.key] ?? 9) - (LEDGER_PRIORITY[b.key] ?? 9) || a.t - b.t);
    const e = this.queue.shift()!;
    this.lastT = t;
    return [e];
  }
}

// ── the end screen ───────────────────────────────────────────────────────────

export interface LedgerSummary {
  /** Grass: cell-equivalents pressed, the share of it standing again (null: nothing pressed), and what lies under
   * the paths I trod and the slabs I helped. */
  pressed: number;
  recoveredPct: number | null;
  under: number;
  /** Ground: cells trodden, metres walked, the share that became paths, the share that were paths already. */
  trodden: number;
  walkedM: number;
  newPathPct: number;
  prePathPct: number;
  /** Concrete: cells with my weight, my share of them, how many others I built with. */
  slabs: number;
  sharePct: number;
  withN: number;
  /** The world: the share of its path cells I trod and of its slab cells I have a share in (null: none exist). */
  worldPathPct: number | null;
  worldSlabPct: number | null;
  /** Nothing to show at all. */
  empty: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function ledgerSummary(l: Ledger): LedgerSummary {
  const pressed = round1(l.grass.pressed);
  const trodden = l.ground.cells;
  const slabs = l.concrete.cells;
  return {
    pressed,
    recoveredPct: l.grass.pressed >= 0.05 ? Math.round((100 * l.grass.recovered) / l.grass.pressed) : null,
    under: round1(l.grass.underPaths + l.grass.underSlabs),
    trodden,
    walkedM: Math.round(l.walkedM / 10) * 10,
    newPathPct: trodden ? Math.round((100 * l.ground.newPath) / trodden) : 0,
    prePathPct: trodden ? Math.round((100 * l.ground.prePath) / trodden) : 0,
    slabs,
    sharePct: l.concrete.total > 0 ? Math.round((100 * l.concrete.mine) / l.concrete.total) : 0,
    withN: l.concrete.with.length,
    worldPathPct: l.world.pathCells ? round1((100 * l.world.pathTrodden) / l.world.pathCells) : null,
    worldSlabPct: l.world.slabCells ? round1((100 * slabs) / l.world.slabCells) : null,
    empty: pressed < 0.05 && trodden === 0 && slabs === 0,
  };
}
