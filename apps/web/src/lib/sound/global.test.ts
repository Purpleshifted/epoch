import { describe, expect, it } from "vitest";
import type { PEvent, Slab } from "@/lib/parliament";
import { panOf, presences } from "./global";

const ev = (o: string, s: number, x = 0, z = 0): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });

describe("global: who is present, by weight, where, how fast, at which building", () => {
  it("counts samples in the window before the latest time, capped at 1, heaviest first", () => {
    const events = [
      ...Array.from({ length: 50 }, (_, t) => ev("v_a", 1000 - t)),
      ...Array.from({ length: 10 }, (_, t) => ev("bot2", 1000 - t)),
      ev("v_old", 1000 - 700),
    ];
    const p = presences(events, 600);
    expect(p.map((x) => x.o)).toEqual(["v_a", "bot2"]);
    expect(p[0].weight).toBeCloseTo(50 / 600);
    expect(p[1].weight).toBeCloseTo(10 / 600);
    expect(presences([], 600)).toEqual([]);
    const full = presences(Array.from({ length: 700 }, (_, t) => ev("v_f", 2000 - t)), 600);
    expect(full[0].weight).toBe(1);
  });

  it("last position, speed from the last two samples, the building they are at", () => {
    const slab: Slab = { key: "4,4", x: 5, z: 5, h: 2, raw: 2, foot: 1, bornS: 0, lastS: 100 };
    const events = [ev("v_w", 98, 0, 0), ev("v_w", 99, 2, 0), ev("v_w", 100, 4, 0), ev("v_s", 99, 5.5, 5), ev("v_s", 100, 5.5, 5)];
    const p = presences(events, 600, [slab]);
    const w = p.find((x) => x.o === "v_w")!;
    const s = p.find((x) => x.o === "v_s")!;
    expect(w.x).toBe(4);
    expect(w.speed).toBeCloseTo(2);
    expect(w.building).toBeNull();
    expect(s.speed).toBe(0);
    expect(s.building).toBe("4,4");
    expect(s.bx).toBe(5);
    // pan: by the building's x when at one, else own x
    expect(panOf(s, 10, 1)).toBeCloseTo(0.5);
    expect(panOf(w, 10, 0.8)).toBeCloseTo(0.32);
    expect(panOf({ ...w, x: -50 }, 10, 1)).toBe(-1);
  });
});
