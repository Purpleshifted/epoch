import { describe, expect, it } from "vitest";
import { DEFAULT_SHARDS, buildPlanShards, buildShards, type Slab } from "./index";

const C = 1.2;
const cell = (cx: number, cz: number, h: number, raw = h): Slab => ({
  key: `${cx},${cz}`,
  x: (cx + 0.5) * C,
  z: (cz + 0.5) * C,
  h,
  raw,
  foot: 1,
  bornS: 0,
  lastS: 0,
});

const row = (n: number, h = 3): Slab[] => Array.from({ length: n }, (_, i) => cell(i, 0, h));
const count = (s: ReturnType<typeof buildShards>, k: string) => s.filter((x) => x.kind === k).length;

describe("shards", () => {
  it("is deterministic", () => {
    expect(buildShards(row(5), 1)).toEqual(buildShards(row(5), 1));
  });

  it("makes more fragments for a bigger cluster", () => {
    const small = buildShards(row(2), 1).length;
    const big = buildShards(row(10), 1).length;
    expect(big).toBeGreaterThan(small);
  });

  it("only a footprint leaves just the ground stroke", () => {
    const s = buildShards([cell(0, 0, 0.05, 3)], 1);
    expect(s.every((x) => x.kind === "ground")).toBe(true);
    expect(s.length).toBe(1);
  });

  it("wear makes fragments fall away one by one (monotone)", () => {
    const n = (intact: number) => buildShards(row(8).map((s) => ({ ...s, h: s.raw * intact })), 1).length;
    const a = n(1), b = n(0.6), c = n(0.2);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
    expect(a).toBeGreaterThan(c);
  });

  it("struts and panels only appear for clusters of 2+ cells", () => {
    const one = buildShards([cell(0, 0, 4)], 1);
    expect(count(one, "strut") + count(one, "panel")).toBe(0);
    const many = buildShards(row(6, 4), 1);
    expect(count(many, "strut")).toBeGreaterThan(0);
    expect(count(many, "panel")).toBeGreaterThan(0);
  });

  it("separate clusters are separate (no panel spans a gap)", () => {
    const two = buildShards([...row(3), cell(20, 0, 3), cell(21, 0, 3), cell(22, 0, 3)], 1);
    expect(count(two, "panel")).toBeGreaterThanOrEqual(2);
  });

  it("config scales the amounts", () => {
    const base = buildShards(row(8), 1, DEFAULT_SHARDS);
    const none = buildShards(row(8), 1, { density: 1, panels: 0, struts: 0 });
    expect(count(none, "panel") + count(none, "strut")).toBe(0);
    expect(base.length).toBeGreaterThan(none.length);
  });

  it("every shard has 4 finite corners above ground", () => {
    for (const s of buildShards(row(8, 5), 1)) {
      expect(s.p).toHaveLength(12);
      for (let i = 0; i < 12; i++) expect(Number.isFinite(s.p[i])).toBe(true);
      for (let i = 1; i < 12; i += 3) expect(s.p[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("plan shards (top view)", () => {
  const plan = (slabs: Slab[], cfg = DEFAULT_SHARDS) => buildPlanShards(slabs, [], cfg);

  it("is deterministic and finite", () => {
    expect(plan(row(6))).toEqual(plan(row(6)));
    for (const s of plan(row(6, 5))) for (let i = 0; i < 12; i++) expect(Number.isFinite(s.p[i])).toBe(true);
  });

  it("lies in the ground plane (corners of a fragment share y)", () => {
    for (const s of plan(row(6))) expect(new Set([s.p[1], s.p[4], s.p[7], s.p[10]]).size).toBe(1);
  });

  it("draws shadows and roofs for standing slabs, only a pale remnant for a footprint", () => {
    const s = plan(row(4));
    expect(s.some((x) => x.kind === "roof")).toBe(true);
    expect(s.some((x) => x.kind === "shadow")).toBe(true);
    const f = plan([cell(0, 0, 0.05, 3)]);
    expect(f.every((x) => x.kind === "ground")).toBe(true);
  });

  it("wear removes fragments monotonically", () => {
    const n = (k: number) => plan(row(8).map((s) => ({ ...s, h: s.raw * k }))).length;
    expect(n(1)).toBeGreaterThanOrEqual(n(0.6));
    expect(n(0.6)).toBeGreaterThanOrEqual(n(0.2));
  });

  it("paths become path fragments; config zero removes beams and axes", () => {
    const withPath = buildPlanShards([], [{ x: 0, z: 0, p: 0.8 }]);
    expect(withPath.map((x) => x.kind)).toEqual(["path"]);
    const none = plan(row(8), { density: 1, panels: 0, struts: 0 });
    expect(none.some((x) => x.kind === "beam" || x.kind === "axis")).toBe(false);
  });
});
