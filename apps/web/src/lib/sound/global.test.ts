import { describe, expect, it } from "vitest";
import type { PEvent } from "@/lib/parliament";
import { presences } from "./global";

const ev = (o: string, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x: 0, z: 0, s });

describe("global: who is present, by weight", () => {
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
});
