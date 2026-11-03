/**
 * The ledger (ledger.ts): what one life did to the ground, from the visitor's own samples and the folded world —
 * pressed grass and its recovery, trodden ground and paths (new, or there before me), concrete with my share, the
 * world's totals, time alone; and the watch that tells it, held, one line at a time, the important first.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FLOW, DEFAULT_FOLD, DEFAULT_LEDGER, DEFAULT_NATURE, LedgerWatch, foldWorld, ledgerAt, ledgerSummary, stressMap, type Ledger, type LogEntry, type PEvent, type Surface } from "./index";

const ev = (o: string, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });
const sorted = (e: PEvent[]) => [...e].sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
const V2 = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };
const ME = "v_me";

/** Walking back and forth along x ∈ [a, b] at z, one sample per second, for `secs` seconds from t0. */
function shuttle(o: string, a: number, b: number, z: number, t0: number, secs: number, speed = 1): PEvent[] {
  const out: PEvent[] = [];
  const L = b - a;
  for (let t = 0; t < secs; t++) {
    const d = (t * speed) % (2 * L);
    out.push(ev(o, d < L ? a + d : b - (d - L), z, t0 + t));
  }
  return out;
}
/** Standing (with a little sway) at (x, z) for `secs` seconds. */
function stand(o: string, x: number, z: number, t0: number, secs: number): PEvent[] {
  return Array.from({ length: secs }, (_, t) => ev(o, x + Math.sin(t) * 0.05, z, t0 + t));
}

/** One reading at assigned second sNow, t seconds into a life that began at sStart (the samples up to sNow count). */
function read(prev: Ledger | null, all: PEvent[], sNow: number, sStart: number, nearCount: number): Ledger {
  const upTo = sorted(all).filter((e) => e.s <= sNow);
  const mine = upTo.filter((e) => e.o === ME);
  const last = mine[mine.length - 1];
  return ledgerAt({
    me: { id: ME, x: last?.x ?? 0, z: last?.z ?? 0 },
    mine,
    sNow,
    t: sNow - sStart,
    snap: foldWorld(upTo, sNow, V2),
    stress: stressMap(upTo, sNow, DEFAULT_NATURE),
    natureCfg: DEFAULT_NATURE,
    flow: DEFAULT_FLOW,
    nearCount,
    prev,
  });
}

describe("the ledger of one life", () => {
  it("standing alone presses the grass underfoot; once I am gone it stands back up", () => {
    const all = stand(ME, 0, 0, 0, 30);
    let l = read(null, all, 5, 0, 0);
    expect(l.grass.cells).toBeGreaterThanOrEqual(1);
    expect(l.grass.pressed).toBeGreaterThan(0);
    expect(l.ground.cells).toBe(0); // standing is not treading
    expect(l.alone.since).toBe(5);
    l = read(l, all, 30, 0, 0);
    expect(l.grass.pressed).toBeGreaterThanOrEqual(1);
    expect(l.grass.recovered).toBeLessThan(l.grass.pressed * 0.2);
    expect(l.alone.longest).toBe(25);
    // three recovery times later, with no new samples: what I pressed stands again (the peaks are kept)
    const pressedThen = l.grass.pressed;
    l = read(l, all, 30 + 3 * DEFAULT_NATURE.recoverSec, 0, 0);
    expect(l.grass.pressed).toBeCloseTo(pressedThen, 5);
    expect(l.grass.recovered / l.grass.pressed).toBeGreaterThan(0.9);
    expect(l.trail.length).toBe(3);
    expect(l.walkedM).toBeLessThan(2);
    expect(ledgerSummary(l)).toMatchObject({ recovered: true, trodden: 0, slabs: 0 });
  });

  it("walking a line that two others keep up: a path that was there before me; walking it with them from the start: a new path", () => {
    const bots = ["bot1", "bot2"].flatMap((o, i) => shuttle(o, 0, 20, 5, i * 7, 600));
    // I arrive at 300 and walk the same line for 60 s
    const late = [...bots, ...shuttle(ME, 0, 20, 5, 300, 60)];
    let l = read(null, late, 330, 300, 1);
    l = read(l, late, 360, 300, 1);
    expect(l.ground.cells).toBeGreaterThanOrEqual(10);
    expect(l.ground.prePath).toBeGreaterThanOrEqual(5);
    expect(l.ground.newPath).toBeLessThanOrEqual(2);
    expect(l.ground.prePath + l.ground.newPath).toBeLessThanOrEqual(l.ground.cells);
    expect(l.world.pathCells).toBeGreaterThanOrEqual(10);
    expect(l.world.pathTrodden).toBeGreaterThanOrEqual(5);
    expect(l.walkedM).toBeGreaterThan(50);
    expect(l.walkedM).toBeLessThan(66);
    expect(l.grass.underPaths).toBeGreaterThan(0);
    expect(l.alone.since).toBeNull();
    const sum = ledgerSummary(l);
    expect(sum.prePaths).toBeGreaterThan(sum.newPaths);
    // pacing a line of my own for two minutes: the cells were open when I first trod them, and they become a path
    const own = shuttle(ME, 30, 50, -20, 0, 120);
    let e = read(null, own, 10, 0, 0);
    e = read(e, own, 60, 0, 0);
    e = read(e, own, 120, 0, 0);
    expect(e.ground.newPath).toBeGreaterThanOrEqual(5);
    expect(e.ground.prePath).toBe(0);
    expect(e.alone.longest).toBeGreaterThanOrEqual(100);
  });

  it("standing with two others long enough: concrete with my share in it, under my feet", () => {
    const all = [...stand(ME, 0.3, 0.3, 0, 40), ...stand("bot1", 0.6, 0.3, 0, 40), ...stand("bot2", 0.3, 0.6, 0, 40)];
    const snap = foldWorld(sorted(all), 40, V2);
    expect(snap.slabs.some((s) => s.who?.some((w) => w.o === ME))).toBe(true);
    let l = read(null, all, 40, 0, 2);
    expect(l.concrete.cells).toBe(0); // first sight: not yet settled
    l = read(l, all, 42, 0, 2);
    expect(l.concrete.cells).toBeGreaterThanOrEqual(1);
    expect(l.concrete.mine / l.concrete.total).toBeGreaterThan(0.28);
    expect(l.concrete.mine / l.concrete.total).toBeLessThan(0.38);
    expect([...l.concrete.with].sort()).toEqual(["bot1", "bot2"]);
    expect(l.concrete.firstT).not.toBeNull();
    expect(l.concrete.firstT!).toBeGreaterThanOrEqual(0);
    expect(l.concrete.underMe).toBe(true);
    expect(l.grass.underSlabs).toBeGreaterThan(0);
    expect(l.world.slabCells).toBeGreaterThanOrEqual(1);
    const sum = ledgerSummary(l);
    expect(sum.slabs).toBeGreaterThanOrEqual(1);
    expect([...sum.with].sort()).toEqual(["bot1", "bot2"]);
  });

  it("only passing by a building: a trace in it, but it is not mine", () => {
    const others = ["bot1", "bot2", "bot3"].flatMap((o, i) => stand(o, 0.3 + i * 0.1, 0.3, 0, 40));
    const all = [...others, ...stand(ME, 0.3, 0.3, 40, 41)];
    const snap = foldWorld(sorted(all), 41, V2);
    expect(snap.slabs.some((s) => s.who?.some((w) => w.o === ME && w.amount > 0 && w.amount < DEFAULT_LEDGER.mineFrom))).toBe(true);
    let l = read(null, all, 41, 40, 3);
    l = read(l, all, 43, 40, 3);
    expect(l.concrete.cells).toBe(0);
    expect(l.concrete.fresh).toEqual([]);
  });

  it("a house going up is told from one that stands already", () => {
    const three = (t0: number, secs: number) => [...stand(ME, 0.3, 0.3, t0, secs), ...stand("bot1", 0.6, 0.3, t0, secs), ...stand("bot2", 0.3, 0.6, t0, secs)];
    // going up now: with my weight, and young
    let now = read(null, three(0, 40), 40, 0, 2);
    now = read(now, three(0, 40), 42, 0, 2);
    expect(now.concrete.fresh.length).toBeGreaterThanOrEqual(1);
    expect(now.concrete.freshHere).toBe(true);
    expect(now.nearNow).toBe(2);
    expect(now.passing).toBeNull();
    // long after, others' house: I only pass over it
    const built = ["bot1", "bot2", "bot3"].flatMap((o, i) => stand(o, 0.3 + i * 0.1, 0.3, 0, 40));
    const all = [...built, ...stand(ME, 0.3, 0.3, 400, 2)];
    const later = read(null, all, 401, 400, 0);
    expect(later.passing).not.toBeNull();
    expect(later.passing!.agoSec).toBeGreaterThan(DEFAULT_LEDGER.freshSec);
    expect(later.concrete.fresh).toEqual([]);
    // my own weight in a house that is no longer young: neither going up, nor someone else's
    const mine = [...three(0, 40), ...stand(ME, 0.3, 0.3, 400, 2)];
    let own = read(null, mine, 400, 0, 0);
    own = read(own, mine, 402, 0, 0);
    expect(own.concrete.cells).toBeGreaterThanOrEqual(1);
    expect(own.concrete.fresh).toEqual([]);
    expect(own.passing).toBeNull();
  });

  it("an empty life", () => {
    const l = read(null, [], 1, 0, 0);
    expect(ledgerSummary(l)).toMatchObject({ pressed: 0, recovered: false, trodden: 0, walkedM: 0, slabs: 0, with: [] });
  });
});

describe("the watch: held, one line at a time, the important first", () => {
  const base = (t: number, over: Partial<Ledger> = {}): Ledger => ({
    t,
    sNow: t,
    sStart: 0,
    cells: new Map(),
    trail: [],
    walkedM: 0,
    grass: { pressed: 0, recovered: 0, underPaths: 0, underSlabs: 0, cells: 0 },
    ground: { cells: 0, newPath: 0, prePath: 0, prePathVisits: 0 },
    concrete: { cells: 0, mine: 0, total: 0, with: [], firstT: null, underMe: false, fresh: [], freshHere: false },
    passing: null,
    nearNow: 0,
    gathering: null,
    world: { pathCells: 0, slabCells: 0, pathTrodden: 0 },
    alone: { since: null, longest: 0 },
    ...over,
  });
  const keys = (es: LogEntry[]) => es.map((e) => e.key);
  const open: Surface = "open";

  it("a condition has to hold for settleSec; a one-reading flicker is nothing", () => {
    const w = new LedgerWatch();
    expect(keys(w.feed(base(1, { grass: { pressed: 2, recovered: 0, underPaths: 0, underSlabs: 0, cells: 3 } }), open))).toEqual([]);
    expect(keys(w.feed(base(1.5), open))).toEqual([]); // gone again
    expect(keys(w.feed(base(3, { grass: { pressed: 2, recovered: 0, underPaths: 0, underSlabs: 0, cells: 3 } }), open))).toEqual([]);
    expect(keys(w.feed(base(4.6, { grass: { pressed: 2, recovered: 0, underPaths: 0, underSlabs: 0, cells: 3 } }), open))).toEqual(["grass.pressed"]);
    // the next step of it only at 10 cell-equivalents
    expect(keys(w.feed(base(20, { grass: { pressed: 5, recovered: 0, underPaths: 0, underSlabs: 0, cells: 3 } }), open))).toEqual([]);
  });

  it("concrete first, then the path, then the grass — one every gapSec; a stale line is dropped", () => {
    const w = new LedgerWatch();
    const busy = (t: number) =>
      base(t, {
        grass: { pressed: 2, recovered: 0, underPaths: 0, underSlabs: 0, cells: 3 },
        ground: { cells: 12, newPath: 2, prePath: 0, prePathVisits: 0 },
        concrete: { cells: 1, mine: 5, total: 15, with: ["bot1"], firstT: 30, underMe: true, fresh: ["1,1"], freshHere: true },
        nearNow: 4,
      });
    w.feed(busy(40), "sealed");
    const first = w.feed(busy(42), "sealed");
    expect(keys(first)).toEqual(["concrete.share"]);
    expect(first[0]).toMatchObject({ level: 2, args: { n: 1, near: 5, with: [{ o: "bot1", r: "worker" }] } });
    expect(keys(w.feed(busy(45), "sealed"))).toEqual([]); // inside the gap
    expect(keys(w.feed(busy(42 + DEFAULT_LEDGER.gapSec), "sealed"))).toEqual(["path.formed"]);
    expect(keys(w.feed(busy(42 + 2 * DEFAULT_LEDGER.gapSec), "sealed"))).toEqual(["sealed.under"]);
    expect(keys(w.feed(busy(42 + 3 * DEFAULT_LEDGER.gapSec), "sealed"))).toEqual(["grass.pressed"]);
    // the worn-ground line waited too long (it was due at 42): dropped once stale
    expect(keys(w.feed(busy(42 + 4 * DEFAULT_LEDGER.gapSec), "sealed"))).toEqual([]);
  });

  it("alone: every aloneSec of it, saying who is gathered within sight and which way", () => {
    const w = new LedgerWatch();
    const alone = (t: number, since: number, gathering: Ledger["gathering"] = null) => w.feed(base(t, { alone: { since, longest: t - since }, gathering }), open);
    expect(keys(alone(30, 5))).toEqual([]);
    const first = alone(36, 5, { n: 3, side: "frontRight" });
    expect(keys(first)).toEqual(["alone.long"]);
    expect(first[0].args).toMatchObject({ sec: 30, n: 3, bearing: "frontRight" });
    expect(keys(alone(50, 5))).toEqual([]);
    const again = alone(66, 5, { n: 1, side: "left" });
    expect(keys(again)).toEqual(["alone.long"]);
    expect(again[0].args).toMatchObject({ sec: 60, n: 1, bearing: "left" });
    // a new stretch counts from its own beginning
    expect(keys(alone(200, 165))).toEqual(["alone.long"]);
  });

  it("a house going up: once, and again only when it has grown; a house that stands: told apart, not often", () => {
    const w = new LedgerWatch();
    const up = (t: number, fresh: string[]) => w.feed(base(t, { concrete: { cells: fresh.length, mine: 5, total: 15, with: [], firstT: t, underMe: false, fresh, freshHere: false } }), open);
    up(10, ["1,1"]);
    const first = up(12, ["1,1"]);
    expect(keys(first)).toEqual(["concrete.share"]);
    expect(first[0].args.near).toBeUndefined(); // not here: nobody to count
    expect(keys(up(22, ["1,1", "1,2"]))).toEqual([]); // one more cell is no news
    up(30, ["1,1", "1,2", "1,3", "1,4"]);
    expect(keys(up(32, ["1,1", "1,2", "1,3", "1,4"]))).toEqual(["concrete.share"]);

    const p = new LedgerWatch();
    const pass = (t: number) => p.feed(base(t, { passing: { agoSec: 372 } }), open);
    pass(10);
    const told = pass(12);
    expect(keys(told)).toEqual(["concrete.passed"]);
    expect(told[0].args.sec).toBe(372);
    expect(keys(pass(40))).toEqual([]);
    pass(72);
    expect(keys(pass(74))).toEqual(["concrete.passed"]);
  });
});
