import { describe, expect, it } from "vitest";
import { DEFAULT_SHARDS, buildShards, type Slab } from "./index";

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
