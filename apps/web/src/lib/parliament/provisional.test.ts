/**
 * A person's parts at once (provisional.ts).
 */
import { describe, expect, it } from "vitest";
import { PROVISIONAL_HOLD_SEC, gatherStanding, markBuilt, provisionalParts, type ProvisionalCell } from "./provisional";

const cfg = { radius: 2.5, afterSec: 0.4, growSec: 3 };

describe("provisional parts", () => {
  it("standing still: the cell underfoot first, within half a second, its neighbours within about a second; they grow", () => {
    const cells = new Map<string, ProvisionalCell>();
    let t = 0;
    const stand = (sec: number) => {
      for (let i = 0; i < sec * 60; i++) gatherStanding(cells, 30.6, 30.6, 100, 1 / 60, (t += 1 / 60), cfg);
    };
    stand(0.3);
    expect(provisionalParts(cells, t, cfg)).toEqual([]);
    stand(0.2);
    const first = provisionalParts(cells, t, cfg);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(first[0].top).toBe(100);
    stand(0.7);
    const soon = provisionalParts(cells, t, cfg);
    expect(soon.length).toBeGreaterThanOrEqual(9);
    stand(4);
    expect(Math.max(...provisionalParts(cells, t, cfg).map((p) => p.h))).toBe(1);
    expect(Math.max(...soon.map((p) => p.h))).toBeLessThan(1);
  });

  it("where the rule has built, nothing provisional is left; a place that was left is forgotten after a while", () => {
    const cells = new Map<string, ProvisionalCell>();
    for (let i = 0; i < 120; i++) gatherStanding(cells, 30.6, 30.6, 100, 1 / 60, i / 60, cfg);
    const before = provisionalParts(cells, 2, cfg).length;
    markBuilt(cells, [{ x: 30.6, z: 30.6 }]);
    expect(provisionalParts(cells, 2, cfg).length).toBe(before - 1);
    expect(provisionalParts(cells, 2 + PROVISIONAL_HOLD_SEC + 0.1, cfg)).toEqual([]);
    expect(cells.size).toBe(0);
  });
});
