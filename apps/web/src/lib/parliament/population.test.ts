import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLD,
  DEFAULT_POPULATION,
  WORLD_HALF,
  foldWorld,
  initPopulation,
  nextCapacity,
  readPopulation,
  residentActor,
  stepPopulation,
  wrapDist,
  type PEvent,
  type PopulationConfig,
  type PopulationState,
  type Site,
} from "./index";

const EPOCH = 1_790_000_000_000;
const T0 = EPOCH + 60_000;

/** Run the population for `sec` seconds, one step a second; collect presence events and every death. */
function run(st: PopulationState, sec: number, cfg: PopulationConfig = DEFAULT_POPULATION, sites: Site[] = []) {
  const events: PEvent[] = [];
  const deaths: number[] = [];
  let s = st;
  for (let i = 1; i <= sec; i++) {
    const w = st.lastMs + i * 1000;
    const r = stepPopulation(s, w, { sites }, cfg);
    s = r.state;
    for (const d of r.deaths) deaths.push(d.n);
    for (const res of s.residents) {
      const a = residentActor(res, w, EPOCH, 60);
      events.push({ id: `${a.o}:${i}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s });
    }
  }
  return { state: s, events, deaths };
}

describe("the resident population", () => {
  it("is deterministic: the same state and inputs give the same population", () => {
    const a = run(initPopulation(EPOCH, T0, 12), 300);
    const b = run(initPopulation(EPOCH, T0, 12), 300);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    // and another epoch is another population
    const c = run(initPopulation(EPOCH + 5_000_000, T0, 12), 300);
    expect(JSON.stringify(c.state.residents.map((r) => [r.x, r.z]))).not.toBe(JSON.stringify(a.state.residents.map((r) => [r.x, r.z])));
  });

  it("stays on the torus: every position is canonical", () => {
    const { events } = run(initPopulation(EPOCH, T0, 24), 600);
    for (const e of events) {
      expect(e.x).toBeGreaterThanOrEqual(-WORLD_HALF);
      expect(e.x).toBeLessThan(WORLD_HALF);
      expect(e.z).toBeGreaterThanOrEqual(-WORLD_HALF);
      expect(e.z).toBeLessThan(WORLD_HALF);
    }
  });

  it("lives and dies: each resident lives its span, and a new one (a new id) is born in its place", () => {
    const cfg = { ...DEFAULT_POPULATION, lifeSec: [60, 90] as [number, number] };
    const st = initPopulation(EPOCH, T0, 8, cfg);
    const first = new Set(st.residents.map((r) => r.n));
    const { state, deaths } = run(st, 200, cfg);
    expect(deaths.length).toBeGreaterThanOrEqual(8); // everyone of the first population is gone by now
    for (const n of first) expect(state.residents.some((r) => r.n === n)).toBe(false);
    expect(state.residents.length).toBe(8);
    expect(new Set(state.residents.map((r) => r.n)).size).toBe(8);
    // the first population was met at different ages: they do not all die in the same second
    const st2 = initPopulation(EPOCH, T0, 8, cfg);
    const ends = st2.residents.map((r) => r.bornMs + r.lifeMs);
    expect(new Set(ends.map((e) => Math.floor(e / 1000))).size).toBeGreaterThan(4);
  });

  it("a fixed default keeps the spec's ±30 s, 4–8 min, 6–24", () => {
    expect(DEFAULT_POPULATION.timeSpread).toBe(60);
    expect(DEFAULT_POPULATION.lifeSec).toEqual([240, 480]);
    expect([DEFAULT_POPULATION.min, DEFAULT_POPULATION.max]).toEqual([6, 24]);
    for (const r of initPopulation(EPOCH, T0, 24).residents) {
      expect(Math.abs(r.dOff)).toBeLessThanOrEqual(30);
      expect(r.lifeMs).toBeGreaterThanOrEqual(240_000);
      expect(r.lifeMs).toBeLessThanOrEqual(480_000);
    }
  });

  it("roles are mixed, the worker the majority; a tree is rooted", () => {
    const st = initPopulation(EPOCH, T0, 24);
    const counts: Record<string, number> = {};
    // many births: the mix over 400 residents
    for (let n = 0; n < 400; n++) {
      const r = initPopulation(EPOCH + n * 1000, T0, 6).residents[0];
      counts[r.role] = (counts[r.role] ?? 0) + 1;
    }
    expect(counts.worker).toBeGreaterThan(200);
    expect(counts.worker).toBeGreaterThan(Math.max(counts.cat ?? 0, counts.car ?? 0, counts.tree ?? 0) * 2);
    const tree = st.residents.find((r) => r.role === "tree");
    if (tree) {
      const later = run(st, 120).state.residents.find((r) => r.n === tree.n);
      if (later) expect([later.x, later.z]).toEqual([tree.x, tree.z]);
    }
  });

  it("the count follows the capacity: down at once (the youngest go), up one birth a step", () => {
    const st = initPopulation(EPOCH, T0, 20);
    const down = stepPopulation({ ...st, capacity: 10 }, T0 + 1000);
    expect(down.state.residents.length).toBe(10);
    expect(down.deaths.length).toBe(10);
    let s = { ...down.state, capacity: 14 };
    for (let i = 0; i < 4; i++) s = stepPopulation(s, s.lastMs + 1000).state;
    expect(s.residents.length).toBe(14);
    // clamped to min … max
    expect(initPopulation(EPOCH, T0, 2).residents.length).toBe(6);
    expect(initPopulation(EPOCH, T0, 99).residents.length).toBe(24);
  });

  it("nextCapacity: fewer when frames are slow, more when they run clean", () => {
    expect(nextCapacity(12, 20)).toBe(10);
    expect(nextCapacity(12, 5)).toBe(11);
    expect(nextCapacity(12, 2)).toBe(12);
    expect(nextCapacity(12, 0)).toBe(13);
    expect(nextCapacity(6, 50)).toBe(6);
    expect(nextCapacity(24, 0)).toBe(24);
  });

  it("is social: residents stay together far more often than strangers would, and leave again", () => {
    const workers = { ...DEFAULT_POPULATION, roles: [["worker", 1]] as const };
    const together = (cfg: PopulationConfig) => {
      let s = initPopulation(EPOCH, T0, 12, cfg);
      let withCompany = 0, samples = 0, trips = 0;
      for (let i = 1; i <= 900; i++) {
        const prev = s;
        s = stepPopulation(s, T0 + i * 1000, {}, cfg).state;
        for (const r of s.residents) {
          const was = prev.residents.find((p) => p.n === r.n);
          if (was && was.mode === "stay" && r.mode === "travel") trips++;
          if (r.mode !== "stay") continue;
          samples++;
          if (s.residents.some((o) => o.n !== r.n && wrapDist(r.x, r.z, o.x, o.z) <= cfg.nearR)) withCompany++;
        }
      }
      return { share: withCompany / Math.max(1, samples), trips };
    };
    const social = together(workers);
    const loners = together({ ...workers, social: 0 });
    expect(social.share).toBeGreaterThan(0.4);
    expect(social.share).toBeGreaterThan(loners.share * 3);
    expect(social.trips).toBeGreaterThan(12); // and they do leave
  });

  it("goes to a visitor: a person site draws residents to it", () => {
    const workers = { ...DEFAULT_POPULATION, roles: [["worker", 1]] as const };
    const visitor: Site = { x: 40, z: -30, w: 3, person: true };
    const { state } = run(initPopulation(EPOCH, T0, 12, workers), 400, workers, [visitor]);
    const near = state.residents.filter((r) => wrapDist(r.x, r.z, visitor.x, visitor.z) <= 6).length;
    expect(near).toBeGreaterThanOrEqual(2);
  });

  it("builds: ten minutes of a worker population nucleate concrete", () => {
    const workers = { ...DEFAULT_POPULATION, roles: [["worker", 1]] as const };
    const { events } = run(initPopulation(EPOCH, T0, 12, workers), 600, workers);
    const sEnd = Math.max(...events.map((e) => e.s));
    const snap = foldWorld(events, sEnd, DEFAULT_FOLD);
    expect(snap.slabs.length).toBeGreaterThan(0);
  });

  it("travels far: an exploring trip goes a good part of the world away", () => {
    const cfg = { ...DEFAULT_POPULATION, social: 0 };
    let s = initPopulation(EPOCH, T0, 12, cfg);
    const trips: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const prev = s;
      s = stepPopulation(s, T0 + i * 1000, {}, cfg).state;
      for (const r of s.residents) {
        const was = prev.residents.find((p) => p.n === r.n);
        if (was && was.mode === "stay" && r.mode === "travel") trips.push(wrapDist(was.x, was.z, r.ax, r.az));
      }
    }
    expect(trips.length).toBeGreaterThan(8);
    for (const d of trips) expect(d).toBeGreaterThanOrEqual(23);
  });

  it("leaves a few at a time: at most maxDepartures routes are planned in one step", () => {
    let planned = 0;
    const st = initPopulation(EPOCH, T0, 20);
    stepPopulation(st, T0 + 1000, { planRoute: (ax, az, bx, bz) => (planned++, [ax, az, bx, bz]) });
    expect(planned).toBeLessThanOrEqual(2);
  });

  it("survives storage: JSON in, the same population out; another epoch is refused", () => {
    const { state } = run(initPopulation(EPOCH, T0, 10), 120);
    const back = readPopulation(JSON.parse(JSON.stringify(state)), EPOCH);
    expect(back).toEqual(state);
    expect(readPopulation(JSON.parse(JSON.stringify(state)), EPOCH + 1)).toBeNull();
    expect(readPopulation({ nope: 1 }, EPOCH)).toBeNull();
  });
});
