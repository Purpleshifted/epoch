import { describe, expect, it } from "vitest";
import { bakedKey, clearBaked, hasBakeStore, loadBaked, saveBaked } from "./bakeStore";

describe("bakeStore: the baked layers on disk", () => {
  it("degrades to nothing where IndexedDB is not available (here), without throwing", async () => {
    expect(hasBakeStore()).toBe(false);
    await expect(loadBaked("e1")).resolves.toEqual([]);
    await expect(clearBaked("e1")).resolves.toBeUndefined();
    await expect(
      saveBaked({ key: bakedKey("e1", 0), epoch: "e1", c0: 0, c1: 9, final: false, t0: 0, parts: [], basis: [], decay: [], standing: [], history: null, x0: 0, z0: 0, nx: 1, nz: 1, unit: 1, sediment: { tNow: 0, secPerUnit: 20, timeScale: 1, tauYears: 600, graceSlots: 0 }, boxes: [], shade: new Float32Array(0), nature: null }),
    ).resolves.toBeUndefined();
    expect(bakedKey("e1", 30)).toBe("e1:30");
  });
});
