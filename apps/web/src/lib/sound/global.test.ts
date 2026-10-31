import { describe, expect, it } from "vitest";
import type { PEvent } from "@/lib/parliament";
import { presences } from "./global";
import type { BuildingSignal } from "./signals";

const ev = (o: string, s: number, x = 0, z = 0): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });

describe("global: who is present, by weight, where, how fast, in which building's zone", () => {
  it("counts samples in the window before the latest time, capped at 1, heaviest first", () => {
    const events = [...Array.from({ length: 50 }, (_, t) => ev("v_a", 1000 - t)), ...Array.from({ length: 10 }, (_, t) => ev("bot2", 1000 - t)), ev("v_old", 1000 - 700)];
    const p = presences(events, 600);
    expect(p.map((x) => x.o)).toEqual(["v_a", "bot2"]);
    expect(p[0].weight).toBeCloseTo(50 / 600);
    expect(p[1].weight).toBeCloseTo(10 / 600);
    expect(presences([], 600)).toEqual([]);
    expect(presences(Array.from({ length: 700 }, (_, t) => ev("v_f", 2000 - t)), 600)[0].weight).toBe(1);
  });

  it("last position, speed from the last two samples, the building zone they stand in", () => {
    const b: BuildingSignal = { id: "4,4", x: 5, z: 5, dist: 0, radius: 3, mass: 4, who: [{ o: "v_s", amount: 3 }] };
    const events = [ev("v_w", 98, 0, 0), ev("v_w", 99, 2, 0), ev("v_w", 100, 4, 0), ev("v_s", 99, 5.5, 5), ev("v_s", 100, 5.5, 5)];
    const p = presences(events, 600, [b]);
    const w = p.find((x) => x.o === "v_w")!;
    const s = p.find((x) => x.o === "v_s")!;
    expect(w.x).toBe(4);
    expect(w.speed).toBeCloseTo(2);
    expect(w.building).toBeNull();
    expect(s.speed).toBe(0);
    expect(s.building).toBe("4,4");
    expect(s.bx).toBe(5);
  });
});
