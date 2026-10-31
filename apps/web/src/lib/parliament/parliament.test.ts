import { describe, expect, it } from "vitest";
import { geoYears } from "@/lib/stratum/geoClock";
import {
  DEFAULT_FOLD,
  DEMO_END_SEC,
  EventLog,
  buildParliamentDemo,
  foldWorld,
  horizonSeconds,
  latestS,
  pickOffset,
  sessionSeconds,
  type PEvent,
  type RoleId,
} from "./index";

const C = 1.2; // cell size: (0.6, 0.6) is the centre of cell "0,0"

function stand(o: string, r: RoleId, x: number, z: number, s0: number, n: number): PEvent[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${o}:p${s0}:${i}`, o, r, k: "p" as const, x, z, s: s0 + i }));
}
const at0 = (e: PEvent[], sView: number) => foldWorld(e, sView).slabs.find((s) => s.key === "0,0");

/** n visitors, each standing `secs` seconds at the centre of cell "0,0", visitor i arriving at s0 + i·gap. */
const crowd = (n: number, s0: number, secs: number, gap = 0, r: RoleId = "worker"): PEvent[] =>
  Array.from({ length: n }, (_, i) => stand(`w${i}`, r, C / 2, C / 2, s0 + i * gap, secs)).flat();

describe("worker slab: spacetime density of SEVERAL visitors", () => {
  it("a lone visitor never builds, however long he stays", () => {
    expect(at0(stand("a", "worker", C / 2, C / 2, 0, 500), 500)).toBeUndefined();
    expect(at0(crowd(2, 0, 200), 200)).toBeUndefined(); // two are still not enough (minVisitors = 3)
  });

  it("does not nucleate below the threshold, does at it", () => {
    expect(at0(crowd(3, 0, 11), 100)).toBeUndefined(); // 3 × 11 = 33 < 36
    expect(at0(crowd(3, 0, 12), 100)).toBeDefined(); // 3 × 12 = 36
  });

  it("is causal: nothing is counted after the viewing time", () => {
    const e = crowd(3, 0, 20);
    expect(at0(e, 5)).toBeUndefined();
    expect(at0(e, 11)).toBeDefined();
  });

  it("grows with further visitors and is capped; one visitor counts at most visitorCap", () => {
    const three = at0(crowd(3, 0, 15), 15)!;
    const five = at0(crowd(5, 0, 15), 15)!;
    const huge = at0(crowd(40, 0, 15), 15)!;
    expect(five.h).toBeGreaterThan(three.h);
    expect(huge.h).toBeLessThanOrEqual(DEFAULT_FOLD.maxHeight + 1e-9);
    // the same three visitors staying 10× longer add nothing beyond their cap
    expect(at0(crowd(3, 0, 150), 150)!.raw).toBeCloseTo(three.raw, 6);
  });

  it("counts several visitors at different times (not only the same moment)", () => {
    const e = crowd(3, 0, 15, 100); // 15 s each, 100 s apart
    expect(at0(e, 400)).toBeDefined();
    expect(at0(crowd(1, 0, 15), 400)).toBeUndefined();
  });

  it("forgets presence further apart in time than the window", () => {
    const apart = [...stand("a", "worker", C / 2, C / 2, 0, 15), ...stand("b", "worker", C / 2, C / 2, 100, 15), ...stand("c", "worker", C / 2, C / 2, 700, 15)];
    const near = [...stand("a", "worker", C / 2, C / 2, 0, 15), ...stand("b", "worker", C / 2, C / 2, 100, 15), ...stand("c", "worker", C / 2, C / 2, 200, 15)];
    expect(at0(apart, 720)).toBeUndefined();
    expect(at0(near, 220)).toBeDefined();
  });

  it("does not gather presence that is spread out in space", () => {
    const e = Array.from({ length: 30 }, (_, i) => stand(`a${i}`, "worker", i * 10 + C / 2, C / 2, i, 1)[0]);
    expect(foldWorld(e, 100).slabs).toHaveLength(0);
  });

  it("other roles leave no slab (yet)", () => {
    for (const r of ["shepherd", "wolf", "warrior", "tree"] as const) {
      expect(foldWorld(crowd(5, 0, 200, 0, r), 200).slabs).toHaveLength(0);
    }
  });

  it("is independent of the order of the log", () => {
    const e = [...stand("a", "worker", 1, 1, 0, 30), ...stand("b", "worker", 2, 1.5, 10, 30), ...stand("c", "worker", 1.5, 1, 15, 30)];
    const a = foldWorld(e, 80);
    const b = foldWorld([...e].reverse(), 80);
    expect(a.slabs.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe("wear: the exposed slab goes first, the footprint outlasts it", () => {
  const e = crowd(3, 0, 20);
  it("slab shrinks with model years, footprint decays slower", () => {
    const fresh = at0(e, 19)!;
    const later = at0(e, 200)!;
    expect(later.h).toBeLessThan(fresh.h);
    expect(later.foot).toBeLessThan(fresh.foot);
    expect(later.h / fresh.h).toBeLessThan(later.foot / fresh.foot);
  });
  it("in a far future only the outline is left, then nothing", () => {
    const far = at0(e, 1000)!;
    expect(far.h).toBeLessThan(0.01);
    expect(far.foot).toBeGreaterThan(0.1);
    expect(at0(e, 3000)).toBeUndefined();
  });
  it("continued presence keeps the slab alive (wear counts from the last use)", () => {
    const kept = [...e, ...stand("b", "worker", C / 2, C / 2, 900, 30)];
    expect(at0(kept, 930)!.h).toBeGreaterThan(at0(e, 930)?.h ?? 0);
  });
});

describe("clock", () => {
  it("offset lies inside its window and the session clock runs forward", () => {
    expect(pickOffset(0.5, 120)).toBe(60);
    expect(pickOffset(0.999, 120)).toBeLessThan(120);
    const a = sessionSeconds(10_000, 0, 30);
    const b = sessionSeconds(15_000, 0, 30);
    expect(b - a).toBeCloseTo(5, 6);
    expect(a).toBeCloseTo(40, 6);
  });
  it("a later arrival tends to be later (offset window smaller than the gap)", () => {
    const early = sessionSeconds(0, 0, pickOffset(0.9));
    const late = sessionSeconds(300_000, 0, pickOffset(0.1));
    expect(late).toBeGreaterThan(early);
  });
  it("the horizon lies the requested number of model years after the latest event", () => {
    const s = 100;
    expect(horizonSeconds(s, 0)).toBeCloseTo(s, 4);
    const h = horizonSeconds(s, 3000);
    expect(geoYears(h) - geoYears(s)).toBeCloseTo(3000, 2);
  });
});

describe("event log", () => {
  it("ignores duplicate ids and bumps its version", () => {
    const log = new EventLog();
    const e = stand("a", "worker", 0, 0, 0, 3);
    expect(log.addMany(e)).toBe(3);
    const v = log.version;
    expect(log.addMany(e)).toBe(0);
    expect(log.version).toBe(v);
    expect(log.all()).toHaveLength(3);
    log.add({ ...e[0], id: "new" });
    expect(log.all()).toHaveLength(4);
  });
});

describe("demo crowd", () => {
  const demo = buildParliamentDemo();
  it("is deterministic", () => {
    expect(buildParliamentDemo()).toEqual(demo);
  });
  it("builds slabs now and leaves outlines in a far future", () => {
    const end = latestS(demo);
    expect(end).toBeLessThan(DEMO_END_SEC + 150);
    const now = foldWorld(demo, end);
    expect(now.slabs.length).toBeGreaterThan(5);
    const far = foldWorld(demo, horizonSeconds(end, 3000));
    expect(far.slabs.length).toBeGreaterThan(0);
    expect(Math.max(...far.slabs.map((s) => s.h))).toBeLessThan(0.15);
  });
  it("a visitor who is earlier than the crowd sees none of it", () => {
    expect(foldWorld(demo, 5).slabs).toHaveLength(0);
  });
});
