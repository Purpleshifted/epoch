import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_FOLD, DEFAULT_NATURE, DEFAULT_WATER, flowLevel, flowP, flowRoute, flowShape, flowSteer, flowTracks, foldWorld, natureHistory, seedsFromSnapshot, stayShares, waterLinks, withoutWear, type PEvent, type Seed } from "./index";

const ev = (o: string, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });
const sorted = (e: PEvent[]) => [...e].sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
const V2 = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };

/** A person walking back and forth along x ∈ [a, b] at z, one sample per second, for `secs` seconds from t0. */
function shuttle(o: string, a: number, b: number, z: number, t0: number, secs: number, speed = 1): PEvent[] {
  const out: PEvent[] = [];
  const L = b - a;
  for (let t = 0; t < secs; t++) {
    const d = (t * speed) % (2 * L);
    out.push(ev(o, d < L ? a + d : b - (d - L), z, t0 + t));
  }
  return out;
}
/** A person standing (with a little sway) at (x, z) for `secs` seconds. */
function stand(o: string, x: number, z: number, t0: number, secs: number): PEvent[] {
  return Array.from({ length: secs }, (_, t) => ev(o, x + Math.sin(t) * 0.05, z, t0 + t));
}
const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;

describe("flow: stays build, moves tread paths (V2)", () => {
  it("STAY / MOVE from space and time: standing is a stay, walking a move", () => {
    const st = sorted(stand("a", 0, 0, 0, 30));
    expect(Math.min(...stayShares(st, DEFAULT_FLOW))).toBeGreaterThan(0.95);
    const wk = sorted(shuttle("b", 0, 20, 0, 0, 30));
    const s = stayShares(wk, DEFAULT_FLOW);
    expect(s[10]).toBeLessThan(0.05);
  });

  it("only SUSTAINED flow is a path: one crossing fades, a kept-up route stays; it closes once abandoned", () => {
    const once = sorted(shuttle("a", 0, 20, 5, 0, 20));
    const kept = sorted(["a", "b", "c"].flatMap((o, i) => shuttle(o, 0, 20, 5, i * 7, 600)));
    const at = key(10, 5);
    const pOnce = flowP(flowLevel(flowTracks(once, stayShares(once, DEFAULT_FLOW)).get(at), 30, DEFAULT_FLOW.tauSec), DEFAULT_FLOW);
    const trKept = flowTracks(kept, stayShares(kept, DEFAULT_FLOW)).get(at);
    const pKept = flowP(flowLevel(trKept, 600, DEFAULT_FLOW.tauSec), DEFAULT_FLOW);
    expect(pOnce).toBeLessThan(0.4);
    expect(pKept).toBeGreaterThan(0.9);
    // abandoned: after a few regrowth times it is gone
    expect(flowP(flowLevel(trKept, 600 + DEFAULT_FLOW.tauSec * 4, DEFAULT_FLOW.tauSec), DEFAULT_FLOW)).toBeLessThan(pKept * 0.2);
    // and the fold reports it as a path (V2), along the segment, not only where samples landed
    const snap = foldWorld(kept, 600, V2);
    const cells = new Set(snap.paths.filter((p) => p.p > 0.5).map((p) => p.key));
    for (let x = 1; x < 19; x += CELL_SIZE) expect(cells.has(key(x, 5))).toBe(true);
  });

  it("only FLOW: milling around in one place for long does not make a path", () => {
    const mill: PEvent[] = [];
    for (let t = 0; t < 600; t++) mill.push(ev("m", Math.sin(t * 0.37) * 3 + Math.sin(t * 0.11) * 2, Math.cos(t * 0.29) * 3 + Math.sin(t * 0.17) * 2, t));
    const m = sorted(mill);
    const tr = flowTracks(m, stayShares(m, DEFAULT_FLOW));
    let best = 0;
    for (const t of tr.values()) best = Math.max(best, flowP(flowLevel(t, 600, DEFAULT_FLOW.tauSec), DEFAULT_FLOW));
    const kept = sorted(["a", "b", "c"].flatMap((o, i) => shuttle(o, 0, 20, 5, i * 7, 600)));
    const line = flowP(flowLevel(flowTracks(kept, stayShares(kept, DEFAULT_FLOW)).get(key(10, 5)), 600, DEFAULT_FLOW.tauSec), DEFAULT_FLOW);
    expect(best).toBeLessThan(line * 0.6);
  });

  it("PATH FIRST: a cell trodden into a path before a crowd lingers there gets no slab — the building moves aside", () => {
    const route = ["a", "b", "c", "d"].flatMap((o, i) => shuttle(o, -15, 15, 0, i * 5, 400, 1.5));
    const crowd = ["p", "q", "r", "s", "t"].flatMap((o) => stand(o, 0.3, 0.3, 400, 300));
    const evs = [...route, ...crowd];
    const v1 = foldWorld(evs, 700, DEFAULT_FOLD);
    const v2 = foldWorld(evs, 700, V2);
    const on = key(0.3, 0.3);
    expect(v1.slabs.some((s) => s.key === on)).toBe(true);
    expect(v2.slabs.some((s) => s.key === on)).toBe(false);
    // …but the crowd still builds around the path (off its cells)
    expect(v2.slabs.length).toBeGreaterThan(0);
  });

  it("BUILDING FIRST: a slab's cell is not trodden after its birth (the path goes round)", () => {
    const crowd = ["p", "q", "r", "s", "t"].flatMap((o) => stand(o, 0.3, 0.3, 0, 300));
    const route = ["a", "b", "c", "d"].flatMap((o, i) => shuttle(o, -15, 15, 0, 300 + i * 5, 400, 1.5));
    const snap = foldWorld([...crowd, ...route], 700, V2);
    const on = key(0.3, 0.3);
    expect(snap.slabs.some((s) => s.key === on)).toBe(true);
    expect(snap.paths.find((p) => p.key === on)?.p ?? 0).toBeLessThan(0.1);
    expect(snap.paths.find((p) => p.key === key(8, 0))?.p ?? 0).toBeGreaterThan(0.5); // elsewhere on the route: a path
  });

  it("BUNDLING / DETOUR: bots are drawn up trodden ground and out of built cells", () => {
    const level = (cx: number) => (cx === 5 ? 10 : cx === 4 || cx === 6 ? 4 : 0); // a trodden line at cx = 5
    const [x] = flowSteer((cx) => level(cx), 3.5 * CELL_SIZE, 0, DEFAULT_FLOW);
    expect(x).toBeGreaterThan(3.5 * CELL_SIZE); // drawn towards the path
    const [bx, bz] = flowSteer(() => 0, 0.5 * CELL_SIZE, 0.5 * CELL_SIZE, DEFAULT_FLOW, (cx, cz) => cx === 0 && cz === 0);
    expect(Math.floor(bx / CELL_SIZE) !== 0 || Math.floor(bz / CELL_SIZE) !== 0).toBe(true);
  });

  it("off (V1): the fold and the vegetation history are as before", () => {
    const evs = ["a", "b", "c", "d"].flatMap((o, i) => shuttle(o, -10, 10, i, i * 3, 300, 0.7));
    expect(foldWorld(evs, 300, { ...DEFAULT_FOLD, flow: { ...DEFAULT_FLOW, enabled: false } })).toEqual(foldWorld(evs, 300, DEFAULT_FOLD));
    const seeds = seedsFromSnapshot(foldWorld(evs, 300, withoutWear(DEFAULT_FOLD)));
    const base = { events: evs, seeds, secPerUnit: 20, k0: 0, k1: 15, margin: 2, nature: DEFAULT_NATURE };
    const v1 = natureHistory({ ...base, fold: DEFAULT_FOLD });
    const v2 = natureHistory({ ...base, fold: V2 });
    expect(v1.P).not.toEqual(v2.P); // V2 reads its paths from the flow
    expect(natureHistory({ ...base, fold: { ...DEFAULT_FOLD, flow: { ...DEFAULT_FLOW, enabled: false } } })).toEqual(v1);
  });
});

describe("flow with bots: migrations bundle into a path between flocks, buildings stay about as they were", () => {
  it("V2 bots on their routes tread a narrow path between two flocks", async () => {
    const { botActor, botPlan, dueSamples, steerBot, SEAL_H } = await import("./index");
    const run = (flow: boolean) => {
      const start = 1_800_000_000_000;
      const out: PEvent[] = [];
      let last = start - 1000;
      let ground: { level: Map<string, number>; built: Set<string> } | null = null;
      const routes = new Map<string, number[]>();
      const flock = { groups: 2, spread: 30 };
      for (let now = start; now <= start + 900_000; now += 1000) {
        const due = dueSamples(last, now, 1000);
        if (due.length) last = due[due.length - 1];
        if (flow && (now - start) % 5000 === 0) {
          const snap = foldWorld(out, (now - start) / 1000 + 60, V2);
          const level = new Map<string, number>();
          for (const pc of snap.paths) level.set(pc.key, -DEFAULT_FLOW.unit * Math.log(1 - Math.min(0.999, pc.p)));
          const built = new Set<string>();
          for (const sl of snap.slabs) if (sl.h >= SEAL_H) built.add(sl.key);
          ground = { level, built };
        }
        for (const w of due) for (let i = 0; i < 12; i++) {
          let a = botActor(i, "worker", w, start, start, 60, flock);
          if (ground) {
            const g = ground;
            const [x, z] = steerBot(a.o, botPlan(i, w, start, start, 60, flock), { level: (k) => g.level.get(k) ?? 0, built: (k) => g.built.has(k) }, DEFAULT_FLOW, routes);
            a = { ...a, x, z };
          }
          out.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s });
        }
      }
      return out;
    };
    const v1 = run(false), v2 = run(true);
    const t = Math.max(...v1.map((e) => e.s));
    const a = foldWorld(v1, t, DEFAULT_FOLD), b = foldWorld(v2, t, V2);
    const mass = (s: typeof a) => s.slabs.reduce((m, x) => m + x.raw, 0);
    expect(mass(b)).toBeGreaterThan(mass(a) * 0.7); // buildings about as they were
    const built = new Set(b.slabs.map((s) => s.key));
    expect(b.paths.filter((p) => p.p > 0.35 && !built.has(p.key)).length).toBeGreaterThan(8); // a path off the buildings
  }, 300_000);
});

describe("flow shapes: paths where they were walked, not on the grid", () => {
  it("a cell's shape is the mean position and direction of its treads", () => {
    const evs = sorted(["a", "b", "c"].flatMap((o, i) => shuttle(o, 0, 20, 5.3, i * 7, 300)));
    const tr = flowTracks(evs, stayShares(evs, DEFAULT_FLOW)).get(key(10, 5.3))!;
    const sh = flowShape(tr, 300, DEFAULT_FLOW.tauSec)!;
    expect(sh.z).toBeCloseTo(5.3, 1); // on the walked line, not the cell centre (5.4)
    expect(Math.abs(sh.dx)).toBeGreaterThan(0.99); // along x
  });
  it("bot routes are curves, not 45° steps", () => {
    const g = { level: () => 0, built: (k: string) => k === "3,1" || k === "3,2" || k === "3,0" };
    const r = flowRoute(0, 0, 10, 4, g, DEFAULT_FLOW);
    const angles = new Set<number>();
    for (let i = 2; i + 1 < r.length; i += 2) angles.add(Math.round((Math.atan2(r[i + 1] - r[i - 1], r[i] - r[i - 2]) * 180) / Math.PI));
    expect([...angles].some((a) => a % 45 !== 0)).toBe(true);
  });
  it("water links skip buildings nearer than minApart (a path splitting one building)", () => {
    const who = [{ o: "a", first: 0, last: 900, amount: 20 }];
    const seed = (id: number, x: number): Seed => ({ id, material: "concrete", role: "worker", x, z: 0, t0: 0, t1: 900, mass: 5, who, growth: [[10, 5]] }) as Seed;
    const seeds = [seed(1, 0), seed(2, 3.6 * 0.7)];
    expect(waterLinks(seeds, DEFAULT_WATER, 900).length).toBe(1);
    expect(waterLinks(seeds, { ...DEFAULT_WATER, minApart: 3.6 }, 900).length).toBe(0);
  });
});
