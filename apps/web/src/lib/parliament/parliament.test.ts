import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLD,
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

let uid = 0;
/** `secs` presence samples (one per second) of one visitor standing at (x, z) from assigned time s0. */
function stand(o: string, r: RoleId, x: number, z: number, s0: number, secs: number): PEvent[] {
  const out: PEvent[] = [];
  for (let i = 0; i < secs; i++) out.push({ id: `${o}:${uid++}`, o, r, k: "p", x, z, s: s0 + i });
  return out;
}
// the centre of ground cell (0,0): kernel weight 1 for that cell
const C = 0.6;

describe("worker slab nucleation (spacetime density)", () => {
  it("a short stay builds nothing, a long stay builds a slab on the visitor's cell", () => {
    const short = stand("a", "worker", C, C, 100, 5);
    expect(foldWorld(short, 200).slabs).toHaveLength(0);

    const long = stand("a", "worker", C, C, 100, 20);
    const snap = foldWorld(long, 119);
    const slab = snap.slabs.find((s) => s.key === "0,0");
    expect(slab).toBeDefined();
    expect(slab!.h).toBeGreaterThan(1.5); // 1 + (20 - 12) / 12
    expect(slab!.foot).toBeGreaterThan(0.99);
  });

  it("is causal: events after the viewer's time are invisible", () => {
    const ev = stand("a", "worker", C, C, 100, 30);
    expect(foldWorld(ev, 105).slabs).toHaveLength(0); // only 6 samples seen
    expect(foldWorld(ev, 129).slabs.length).toBeGreaterThan(0);
  });

  it("a crowd counts: three visitors standing together for 5 s each build what one cannot", () => {
    const one = stand("a", "worker", C, C, 100, 5);
    expect(foldWorld(one, 200).slabs).toHaveLength(0);
    const crowd = [...one, ...stand("b", "worker", C, C, 100, 5), ...stand("c", "worker", C, C, 100, 5)];
    expect(foldWorld(crowd, 105).slabs.length).toBeGreaterThan(0);
  });

  it("counts presence across TIME inside the window, not only at the same moment", () => {
    const a = stand("a", "worker", C, C, 0, 6);
    expect(foldWorld([...a, ...stand("b", "worker", C, C, 300, 6)], 400).slabs.length).toBeGreaterThan(0);
    // 700 s later the first visit is outside the 600 s window
    expect(foldWorld([...a, ...stand("b", "worker", C, C, 700, 6)], 800).slabs).toHaveLength(0);
  });

  it("counts presence across SPACE inside the radius only", () => {
    const far: PEvent[] = [];
    for (let i = 0; i < 12; i++) far.push(...stand(`f${i}`, "worker", C + i * 10, C, 100, 1));
    expect(foldWorld(far, 200).slabs).toHaveLength(0);
    const near: PEvent[] = [];
    // kernel weights at 0, 0.3 and 0.6 from the cell centre average 0.9, so 14 samples reach 12.6 >= 12
    for (let i = 0; i < 14; i++) near.push(...stand(`n${i}`, "worker", C + (i % 3) * 0.3, C, 100, 1));
    expect(foldWorld(near, 200).slabs.length).toBeGreaterThan(0);
  });

  it("other roles do not build slabs (yet)", () => {
    for (const r of ["wolf", "shepherd", "warrior", "tree"] as RoleId[]) {
      expect(foldWorld(stand("a", r, C, C, 100, 40), 200).slabs).toHaveLength(0);
    }
  });

  it("more presence raises the slab, up to the maximum", () => {
    const h = (secs: number) => foldWorld(stand("a", "worker", C, C, 100, secs), 100 + secs - 1).slabs.find((s) => s.key === "0,0")!.h;
    expect(h(60)).toBeGreaterThan(h(20));
    expect(h(2000)).toBeLessThanOrEqual(DEFAULT_FOLD.maxHeight + 1e-9);
  });
});

describe("wear: the slab goes first, the footprint stays longer", () => {
  const ev = stand("a", "worker", C, C, 100, 20);
  const lastS = 119;
  const now = foldWorld(ev, lastS).slabs.find((s) => s.key === "0,0")!;

  it("in a far future the exposed slab is gone but the outline remains", () => {
    const far = foldWorld(ev, horizonSeconds(lastS, 3000)).slabs.find((s) => s.key === "0,0");
    expect(far).toBeDefined();
    expect(far!.h).toBeLessThan(now.h * 0.1);
    expect(far!.foot).toBeGreaterThan(0.5);
  });

  it("in a very far future nothing is left", () => {
    expect(foldWorld(ev, horizonSeconds(lastS, 1e6)).slabs).toHaveLength(0);
  });

  it("continued use keeps the slab fresh (wear counts from the last presence)", () => {
    const more = [...ev, ...stand("a", "worker", C, C, 120, 200)];
    const later = foldWorld(more, 319).slabs.find((s) => s.key === "0,0")!;
    expect(later.lastS).toBe(319);
    expect(later.h).toBeGreaterThan(now.h);
  });
});

describe("cigarette filters", () => {
  const f: PEvent = { id: "x", o: "a", r: "worker", k: "f", x: 1, z: 1, s: 100 };
  it("are fresh when dropped and gone within a few model decades", () => {
    expect(foldWorld([f], 100).filters[0].alpha).toBeCloseTo(1, 5);
    expect(foldWorld([f], horizonSeconds(100, 100)).filters).toHaveLength(0);
  });
  it("only workers leave them", () => {
    expect(foldWorld([{ ...f, r: "wolf" }], 100).filters).toHaveLength(0);
  });
});

describe("assigned time", () => {
  it("flows with the wall clock and later arrivals tend to be later", () => {
    const epoch = 1_000_000;
    expect(sessionSeconds(epoch + 10_000, epoch, 60)).toBeCloseTo(70);
    expect(sessionSeconds(epoch + 20_000, epoch, 60)).toBeGreaterThan(sessionSeconds(epoch + 10_000, epoch, 60));
    // a visitor arriving 200 s later with the worst-case offset is still later than one with the best
    expect(sessionSeconds(epoch + 200_000, epoch, pickOffset(0))).toBeGreaterThan(sessionSeconds(epoch, epoch, pickOffset(0.999)));
  });
});

describe("event log and demo", () => {
  it("ignores duplicate ids", () => {
    const log = new EventLog();
    const e: PEvent = { id: "1", o: "a", r: "worker", k: "p", x: 0, z: 0, s: 0 };
    expect(log.add(e)).toBe(true);
    expect(log.add({ ...e })).toBe(false);
    expect(log.all()).toHaveLength(1);
  });

  it("the demo crowd is deterministic and builds a slab district around each centre", () => {
    const a = buildParliamentDemo(1);
    const b = buildParliamentDemo(1);
    expect(a).toEqual(b);
    const snap = foldWorld(a, latestS(a));
    for (const [x, z] of [[0, 0], [14, 6], [-10, -12]]) {
      expect(snap.slabs.some((s) => Math.hypot(s.x - x, s.z - z) < 4)).toBe(true);
    }
  });
});
