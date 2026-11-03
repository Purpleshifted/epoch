import { describe, expect, it } from "vitest";
import { foldWorld } from "./fold";
import { DEFAULT_FLOW } from "./flow";
import { DEFAULT_FOLD, type FoldConfig, type PEvent } from "./types";
import { SPACE_FOLD, followWallRule } from "./wallRule";

const own: FoldConfig = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };
/** What the exhibition's wall had saved on 2026-11-03. */
const FOLD = { radius: 2.5, pourUnit: 100, maxHeight: 15, threshold: 30, windowSec: 600, pathVisits: 5, visitorCap: 32, minVisitors: 4, tauPathYears: 3000, tauSlabYears: 1200, tauFootprintYears: 2000 };
const FLOW = { pull: 1.6, flowOn: true, tauSec: 200, blockAt: 0.6, staySec: 6, flowUnit: 4, gridShare: 0.3, moveShare: 0.5, stayRadius: 1.5 };

describe("a visitor goes by the rule the wall has saved", () => {
  it("what the wall saved replaces the phone's own values", () => {
    const rule = followWallRule(own, FOLD, FLOW);
    expect(rule).toMatchObject(FOLD);
    expect(rule.flow).toMatchObject({ enabled: true, tauSec: 200, blockAt: 0.6, unit: 4 });
  });

  it("nothing saved: the wall's defaults, not the phone's", () => {
    const rule = followWallRule(own, null, null);
    expect(rule).toMatchObject(SPACE_FOLD);
    expect(rule.flow).toMatchObject(DEFAULT_FLOW);
  });

  it("a value that is no number is not believed; paths turned off on the wall are off here", () => {
    expect(followWallRule(own, { minVisitors: "4", radius: 9 }, null)).toMatchObject({ minVisitors: SPACE_FOLD.minVisitors, radius: 9 });
    expect(followWallRule(own, null, { flowOn: false }).flow).toBeUndefined();
  });

  it("three who stay build nothing where the wall asks for four, as on the wall", () => {
    const stand = (o: string, x: number): PEvent[] => Array.from({ length: 60 }, (_, s) => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z: 0.3, s }));
    const three = ["a", "b", "c"].flatMap((o, i) => stand(o, 0.3 + i * 0.1));
    expect(foldWorld(three, 60, own).slabs.length).toBeGreaterThan(0);
    expect(foldWorld(three, 60, followWallRule(own, FOLD, FLOW)).slabs.length).toBe(0);
    expect(foldWorld([...three, ...stand("d", 0.6)], 60, followWallRule(own, FOLD, FLOW)).slabs.length).toBeGreaterThan(0);
  });
});
