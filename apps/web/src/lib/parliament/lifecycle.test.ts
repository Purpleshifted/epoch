import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLOW,
  DEFAULT_FOLD,
  DEFAULT_LIFECYCLE,
  WORLD_HALF,
  arrivalRate,
  doorsOf,
  foldWorld,
  initLifecycle,
  lifeFromBands,
  lifecycleActor,
  nextMaxPresent,
  readLifecycle,
  stepLifecycle,
  wrapDist,
  type FoldConfig,
  type LifecycleConfig,
  type LifecycleState,
  type PEvent,
} from "./index";

const EPOCH = 1_790_000_000_000;
/** The wall's building rule (ParliamentSpace SPACE_FOLD). */
const WALL: FoldConfig = { ...DEFAULT_FOLD, radius: 2.75, threshold: 40, pourUnit: 111, minVisitors: 4, visitorCap: 20, maxHeight: 18, tauFootprintYears: 2000, emptyGapSec: 20, flow: DEFAULT_FLOW };

/** Run `sec` seconds, one step a second; collect presence, arrivals, departures and the most present at once. */
function run(sec: number, cfg: LifecycleConfig = DEFAULT_LIFECYCLE, from: LifecycleState = initLifecycle(EPOCH, EPOCH, cfg)) {
  let st = from;
  const events: PEvent[] = [];
  const born: { id: string; x: number; z: number; sec: number; j: number; lifeMs: number }[] = [];
  const died: { id: string; ageMs: number }[] = [];
  let most = 0;
  for (let i = 1; i <= sec; i++) {
    const w = from.lastMs + i * 1000;
    const r = stepLifecycle(st, w, {}, cfg);
    st = r.state;
    // where they came in (they have already taken their first step by the end of the step)
    for (const v of r.arrivals) born.push({ id: v.id, x: v.ex, z: v.ez, sec: v.sec, j: v.j, lifeMs: v.lifeMs });
    for (const v of r.departures) died.push({ id: v.id, ageMs: w - v.bornMs });
    most = Math.max(most, st.present.length);
    for (const v of st.present) {
      const a = lifecycleActor(v, w, EPOCH);
      events.push({ id: `${a.o}:${i}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s });
    }
  }
  return { st, events, born, died, most };
}

/** Building sites: slab cells joined to their 8 neighbours. */
function sites(keys: string[]): number {
  const set = new Set(keys);
  const seen = new Set<string>();
  let n = 0;
  for (const k of set) {
    if (seen.has(k)) continue;
    n++;
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const [i, j] = stack.pop()!.split(",").map(Number);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const nk = `${i + a},${j + b}`;
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
  }
  return n;
}

describe("lifecycle: when they come", () => {
  it("the rate swings between the peak (5 a minute) and the quiet trough (3 a minute)", () => {
    const peak = arrivalRate(0) * 60;
    const trough = arrivalRate(DEFAULT_LIFECYCLE.wavePeriodSec / 2) * 60;
    expect(peak).toBeCloseTo(5, 5);
    expect(trough).toBeCloseTo(3, 5);
    expect(arrivalRate(DEFAULT_LIFECYCLE.wavePeriodSec) * 60).toBeCloseTo(5, 5);
    expect(arrivalRate(123, { ...DEFAULT_LIFECYCLE, quietShare: 1 }) * 60).toBeCloseTo(5, 5);
  });

  it("over an hour: about 4 a minute, more in the busy part of the swing than in the quiet part", () => {
    const { born: all } = run(3600, { ...DEFAULT_LIFECYCLE, maxPresent: 999 });
    const born = all.filter((b) => b.j === 0); // the arrivals (their companions come on top)
    const perMin = born.length / 60;
    expect(perMin).toBeGreaterThan(3.2);
    expect(perMin).toBeLessThan(5.2);
    const P = DEFAULT_LIFECYCLE.wavePeriodSec;
    const phase = (s: number) => ((s % P) + P) % P / P;
    const busy = born.filter((b) => phase(b.sec) < 0.125 || phase(b.sec) >= 0.875).length;
    const quiet = born.filter((b) => phase(b.sec) >= 0.375 && phase(b.sec) < 0.625).length;
    expect(busy).toBeGreaterThan(quiet);
  });

  it("no more than maxPresent at once: the rest are turned away", () => {
    const cfg = { ...DEFAULT_LIFECYCLE, maxPresent: 4 };
    const { most, st } = run(900, cfg);
    expect(most).toBeLessThanOrEqual(4);
    expect(st.turnedAway).toBeGreaterThan(0);
  });

  it("some come in company: at the same second, beside the one they came with", () => {
    const { born } = run(1800, { ...DEFAULT_LIFECYCLE, maxPresent: 999 });
    const companions = born.filter((b) => b.j > 0);
    expect(companions.length).toBeGreaterThan(born.length * 0.1);
    for (const c of companions) {
      const lead = born.find((b) => b.sec === c.sec && b.j === 0)!;
      expect(wrapDist(lead.x, lead.z, c.x, c.z)).toBeLessThan(2.5);
    }
    expect(new Set(born.map((b) => b.id)).size).toBe(born.length);
  });

  it("half begin at the origin, the rest at the epoch's four doors", () => {
    const { born } = run(3600, { ...DEFAULT_LIFECYCLE, maxPresent: 999, groupP: 0 });
    const doors = doorsOf(EPOCH);
    const atOrigin = born.filter((b) => Math.hypot(b.x, b.z) <= 3).length;
    const atDoor = born.filter((b) => doors.some((d) => wrapDist(d[0], d[1], b.x, b.z) <= 2.5)).length;
    expect(atOrigin + atDoor).toBe(born.length);
    expect(atOrigin / born.length).toBeGreaterThan(0.35);
    expect(atOrigin / born.length).toBeLessThan(0.65);
    for (const d of doors) expect(Math.hypot(d[0], d[1])).toBeGreaterThanOrEqual(29.9);
  });
});

describe("lifecycle: how long they live", () => {
  it("three bands with the artist's shares (20 / 40 / 40 %: 1–1.5, 1.5–2.5, 2.5–3 min)", () => {
    const lives: number[] = [];
    for (let i = 0; i < 1000; i++) lives.push(lifeFromBands((i + 0.5) / 1000, ((i * 7919) % 1000) / 1000));
    const share = (a: number, b: number) => lives.filter((l) => l >= a && l < b).length / lives.length;
    expect(share(60, 90)).toBeCloseTo(0.2, 2);
    expect(share(90, 150)).toBeCloseTo(0.4, 2);
    expect(share(150, 180.001)).toBeCloseTo(0.4, 2);
    // the shares are knobs
    const onlyShort = lifeFromBands(0.99, 0.5, { lifeMinSec: 60, lifeMaxSec: 180, bands: { short: 1, middle: 0, long: 0 } });
    expect(onlyShort).toBeGreaterThanOrEqual(60);
    expect(onlyShort).toBeLessThanOrEqual(90);
  });

  it("everyone dies at the end of their span, where they stand, and leaves the world", () => {
    const { born, died, st } = run(900);
    expect(died.length).toBeGreaterThan(10);
    const life = new Map(born.map((b) => [b.id, b.lifeMs]));
    for (const d of died) {
      expect(d.ageMs).toBeGreaterThanOrEqual(life.get(d.id)!);
      expect(d.ageMs - life.get(d.id)!).toBeLessThan(1000);
    }
    for (const v of st.present) expect(v.lifeMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe("lifecycle: how they behave", () => {
  it("is deterministic: the same epoch and steps give the same world", () => {
    const a = run(600).st;
    const b = run(600).st;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = run(600, DEFAULT_LIFECYCLE, initLifecycle(EPOCH + 7_000_000, EPOCH + 7_000_000)).st;
    expect(JSON.stringify(c.present.map((v) => [v.x, v.z]))).not.toBe(JSON.stringify(a.present.map((v) => [v.x, v.z])));
  });

  it("stays on the torus, and keeps its assigned time within the small spread (no fold rebuilds)", () => {
    const { events } = run(900);
    for (const e of events) {
      expect(Math.abs(e.x)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(e.z)).toBeLessThanOrEqual(WORLD_HALF);
    }
    const s0 = (w: number) => (w - EPOCH) / 1000;
    for (const e of events.slice(-200)) {
      const i = Number(e.id.split(":")[1]);
      const dt = e.s - s0(EPOCH + i * 1000);
      expect(dt).toBeGreaterThanOrEqual(0);
      expect(dt).toBeLessThan(DEFAULT_LIFECYCLE.timeSpreadSec);
    }
  });

  it("characters differ (speed, stays, range) — and spread 0 makes them all the same", () => {
    const { st } = run(600, { ...DEFAULT_LIFECYCLE, maxPresent: 999 });
    const speeds = new Set(st.present.map((v) => v.ch.speed.toFixed(2)));
    expect(speeds.size).toBeGreaterThan(st.present.length / 2);
    const flat = run(600, { ...DEFAULT_LIFECYCLE, maxPresent: 999, spread: 0 }).st;
    expect(new Set(flat.present.map((v) => v.ch.speed)).size).toBe(1);
    expect(new Set(flat.present.map((v) => v.ch.stayMean)).size).toBe(1);
  });

  it("plans at most maxRoutes routes in one step", () => {
    let st = run(300).st;
    let most = 0;
    for (let i = 1; i <= 120; i++) {
      let planned = 0;
      st = stepLifecycle(st, st.lastMs + 1000, { planRoute: (ax, az, bx, bz) => (planned++, [ax, az, bx, bz]) }).state;
      most = Math.max(most, planned);
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(2);
  });

  it("goes to a visitor: an attractor draws the followers", () => {
    const cfg = { ...DEFAULT_LIFECYCLE, follow: 1, spread: 0 };
    let st = initLifecycle(EPOCH, EPOCH, cfg);
    const at = { x: 20, z: -15, w: 50 };
    let near = 0;
    for (let i = 1; i <= 900; i++) {
      st = stepLifecycle(st, EPOCH + i * 1000, { attractors: [at] }, cfg).state;
      if (i > 300) near += st.present.filter((v) => wrapDist(v.x, v.z, at.x, at.z) <= 3).length;
    }
    expect(near / 600).toBeGreaterThan(1);
  });
});

describe("lifecycle: the building rule is met without being there together", () => {
  it("half an hour on the wall's rule: several building sites, paths, and the places remembered", () => {
    const { events, st } = run(1800);
    const snap = foldWorld(events, 1800, WALL);
    const keys = snap.slabs.filter((s) => s.raw > 0).map((s) => s.key);
    expect(keys.length).toBeGreaterThan(20);
    expect(sites(keys)).toBeGreaterThanOrEqual(4);
    expect(snap.paths.filter((p) => p.p >= 0.3).length).toBeGreaterThan(50);
    expect(st.places.length).toBeGreaterThan(0);
  });

  it("following others' places pours more concrete; following very much gathers it into a few sites", () => {
    const fold = (follow: number) => {
      const { events } = run(1800, { ...DEFAULT_LIFECYCLE, follow });
      const slabs = foldWorld(events, 1800, WALL).slabs.filter((s) => s.raw > 0);
      return { mass: slabs.reduce((a, s) => a + s.raw, 0), sites: sites(slabs.map((s) => s.key)) };
    };
    const none = fold(0), mid = fold(0.5), much = fold(0.8);
    expect(mid.mass).toBeGreaterThan(none.mass * 2);
    expect(much.sites).toBeLessThan(mid.sites);
  }, 600_000);
});

describe("lifecycle: plumbing", () => {
  it("nextMaxPresent: fewer when frames are slow, more when clean, within min … max", () => {
    expect(nextMaxPresent(16, 20, 4, 16)).toBe(14);
    expect(nextMaxPresent(16, 5, 4, 16)).toBe(15);
    expect(nextMaxPresent(12, 2, 4, 16)).toBe(12);
    expect(nextMaxPresent(12, 0, 4, 16)).toBe(13);
    expect(nextMaxPresent(16, 0, 4, 16)).toBe(16);
    expect(nextMaxPresent(4, 50, 4, 16)).toBe(4);
  });

  it("survives storage: JSON in, the same state out; another epoch is refused", () => {
    const { st } = run(300);
    expect(readLifecycle(JSON.parse(JSON.stringify(st)), EPOCH)).toEqual(st);
    expect(readLifecycle(JSON.parse(JSON.stringify(st)), EPOCH + 1)).toBeNull();
    expect(readLifecycle({ nope: 1 }, EPOCH)).toBeNull();
  });

  it("a late step catches up: the arrivals of every missed second are drawn", () => {
    const steady = run(120);
    const late = stepLifecycle(initLifecycle(EPOCH, EPOCH), EPOCH + 120_000);
    // the same seconds drew arrivals (where they are differs: the late one did not walk in between)
    expect(late.state.arrived).toBe(steady.st.arrived);
  });
});
