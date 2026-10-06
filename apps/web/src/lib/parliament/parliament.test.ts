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

function stand(o: string, r: RoleId, x: number, z: number, s0: number, n: number, k: "p" | "f" = "p"): PEvent[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${o}:${k}${s0}:${i}`, o, r, k, x, z, s: s0 + i }));
}
const at0 = (e: PEvent[], sView: number) => foldWorld(e, sView).slabs.find((s) => s.key === "0,0");

describe("worker slab: spacetime density", () => {
  it("does not nucleate below the threshold, does at it", () => {
    const e = stand("a", "worker", C / 2, C / 2, 0, 12);
    expect(at0(e.slice(0, 11), 100)).toBeUndefined();
    expect(at0(e, 100)).toBeDefined();
  });

  it("is causal: nothing is counted after the viewing time", () => {
    const e = stand("a", "worker", C / 2, C / 2, 0, 20);
    expect(at0(e, 5)).toBeUndefined();
    expect(at0(e, 11)).toBeDefined();
  });

  it("grows with further presence and is capped", () => {
    const short = at0(stand("a", "worker", C / 2, C / 2, 0, 12), 12)!;
    const longer = at0(stand("a", "worker", C / 2, C / 2, 0, 60), 60)!;
    const huge = at0(stand("a", "worker", C / 2, C / 2, 0, 500), 500)!;
    expect(longer.h).toBeGreaterThan(short.h);
    expect(huge.h).toBeLessThanOrEqual(DEFAULT_FOLD.maxHeight + 1e-9);
  });

  it("counts several visitors at different times (not only the same moment)", () => {
    const e = [0, 1, 2, 3].flatMap((i) => stand(`w${i}`, "worker", C / 2, C / 2, i * 100, 4)); // 4 s each, 100 s apart
    expect(at0(e, 400)).toBeDefined();
    expect(at0(stand("w0", "worker", C / 2, C / 2, 0, 4), 400)).toBeUndefined();
  });

  it("forgets presence further apart in time than the window", () => {
    const apart = [...stand("a", "worker", C / 2, C / 2, 0, 8), ...stand("b", "worker", C / 2, C / 2, 700, 8)];
    const near = [...stand("a", "worker", C / 2, C / 2, 0, 8), ...stand("b", "worker", C / 2, C / 2, 100, 8)];
    expect(at0(apart, 720)).toBeUndefined();
    expect(at0(near, 120)).toBeDefined();
  });

  it("does not gather presence that is spread out in space", () => {
    const e = Array.from({ length: 30 }, (_, i) => stand(`a${i}`, "worker", i * 10 + C / 2, C / 2, i, 1)[0]);
    expect(foldWorld(e, 100).slabs).toHaveLength(0);
  });

  it("other roles leave no slab (yet)", () => {
    for (const r of ["shepherd", "wolf", "warrior", "tree"] as const) {
      expect(foldWorld(stand("a", r, C / 2, C / 2, 0, 200), 200).slabs).toHaveLength(0);
    }
  });

  it("is independent of the order of the log", () => {
    const e = [...stand("a", "worker", 1, 1, 0, 30), ...stand("b", "worker", 2, 1.5, 10, 30)];
    const a = foldWorld(e, 80);
    const b = foldWorld([...e].reverse(), 80);
    expect(b).toEqual(a);
  });
});

describe("wear: the exposed slab goes first, the footprint outlasts it", () => {
  const e = stand("a", "worker", C / 2, C / 2, 0, 20);
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

describe("cigarette filter", () => {
  it("is visible at once and gone within a few seconds of exhibition time", () => {
    const f = stand("a", "worker", 3, 3, 0, 1, "f");
    expect(foldWorld(f, 1).filters).toHaveLength(1);
    expect(foldWorld(f, 20).filters).toHaveLength(0);
  });
  it("is not drawn for other roles", () => {
    expect(foldWorld(stand("a", "tree", 3, 3, 0, 1, "f"), 1).filters).toHaveLength(0);
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
    expect(far.filters).toHaveLength(0);
  });
  it("a visitor who is earlier than the crowd sees none of it", () => {
    expect(foldWorld(demo, 5).slabs).toHaveLength(0);
  });
});
