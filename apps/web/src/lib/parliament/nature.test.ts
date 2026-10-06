import { describe, expect, it } from "vitest";
import { DEFAULT_NATURE, baseGrass, foldWorld, grassDensity, hash2, stressMap, type PEvent } from "./index";

const C = 1.2;
const mid = C / 2;

function stand(o: string, x: number, z: number, s0: number, n: number): PEvent[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${o}:${s0}:${i}`, o, r: "worker" as const, k: "p" as const, x, z, s: s0 + i }));
}

describe("nature: hash and base field", () => {
  it("is deterministic and in 0..1", () => {
    expect(hash2(3, -4, 7)).toBe(hash2(3, -4, 7));
    for (let i = -20; i < 20; i++) {
      const h = hash2(i, i * 3, 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const g = baseGrass(i, -i);
      expect(g).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(g).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("nature: worker stress", () => {
  const S = (e: PEvent[], s: number) => stressMap(e, s, DEFAULT_NATURE).get("0,0") ?? 0;

  it("grows while a worker lingers", () => {
    const short = S(stand("a", mid, mid, 0, 3), 3);
    const long = S(stand("a", mid, mid, 0, 20), 20);
    expect(long).toBeGreaterThan(short);
    expect(grassDensity(0, 0, long, 0, false, DEFAULT_NATURE)).toBeLessThan(grassDensity(0, 0, short, 0, false, DEFAULT_NATURE));
  });

  it("falls with distance (kernel) and is zero beyond the radius", () => {
    const near = stressMap(stand("a", mid, mid, 0, 10), 10, DEFAULT_NATURE).get("0,0") ?? 0;
    const far = stressMap(stand("a", mid + 2.4, mid, 0, 10), 10, DEFAULT_NATURE).get("0,0") ?? 0;
    const out = stressMap(stand("a", mid + 20, mid, 0, 10), 10, DEFAULT_NATURE).get("0,0") ?? 0;
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
    expect(out).toBe(0);
  });

  it("recovers after the worker leaves", () => {
    const e = stand("a", mid, mid, 0, 20);
    const at20 = S(e, 20);
    const at80 = S(e, 80);
    const at400 = S(e, 400);
    expect(at80).toBeLessThan(at20);
    expect(at400).toBeLessThan(0.01);
  });

  it("is causal: events after the viewing time are not counted", () => {
    expect(S(stand("a", mid, mid, 50, 20), 10)).toBe(0);
  });
});

describe("desire paths", () => {
  const walk = (o: string, s0: number, laps: number): PEvent[] => {
    const out: PEvent[] = [];
    let s = s0;
    for (let l = 0; l < laps; l++) {
      out.push(...stand(o, mid, mid, s, 1)); // in cell 0,0
      s += 1;
      out.push(...stand(o, mid + 5 * C, mid, s, 1)); // away
      s += 1;
    }
    return out;
  };
  const p0 = (e: PEvent[], sView: number) => foldWorld(e, sView).paths.find((p) => p.key === "0,0");

  it("forms after repeated crossings and grows with them", () => {
    const few = p0(walk("a", 0, 2), 10);
    const many = p0(walk("a", 0, 12), 30);
    expect(many).toBeDefined();
    expect(many!.visits).toBe(12);
    expect(many!.p).toBeGreaterThan(few?.p ?? 0);
  });

  it("counts lingering in a cell as one visit", () => {
    const p = p0(stand("a", mid, mid, 0, 30), 40);
    expect(p?.visits).toBe(1);
  });

  it("wears away in model years once nobody walks it", () => {
    const e = walk("a", 0, 12);
    const fresh = p0(e, 30)!;
    const old = p0(e, 3000);
    expect((old?.p ?? 0)).toBeLessThan(fresh.p);
  });

  it("is invisible before it happens (causal)", () => {
    expect(p0(walk("a", 100, 12), 50)).toBeUndefined();
  });
});
