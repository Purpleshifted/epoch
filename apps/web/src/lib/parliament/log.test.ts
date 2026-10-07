import { beforeEach, describe, expect, it } from "vitest";
import { LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_PARLIAMENT_EPOCH_KEY, clearWorld, getEpochMs, loadEvents, saveMerged, type PEvent } from "./index";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const ev = (o: string, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x: 0, z: 0, s });

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe("log: the stored world belongs to one epoch (regression: an old epoch's events hid the live tab)", () => {
  it("events saved in the current epoch are loaded", () => {
    const epoch = getEpochMs();
    expect(saveMerged([ev("me", 10), ev("bot0", 11)], epoch)).toBe(true);
    expect(loadEvents().map((e) => e.o).sort()).toEqual(["bot0", "me"]);
  });

  it("events of another epoch are ignored, and replaced (not merged) by the next save", () => {
    // older code reset the shared epoch key and left the parliament events in place: they are far ahead in time
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, "1000");
    localStorage.setItem(LS_EVENTS_EPOCH_KEY, "1000");
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify([ev("old", 700)]));
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, "2000");
    expect(loadEvents()).toEqual([]);
    expect(saveMerged([ev("me", 20)], 2000)).toBe(true);
    expect(loadEvents().map((e) => e.o)).toEqual(["me"]);
  });

  it("stored events without an epoch tag (written before tagging) are ignored", () => {
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, "3000");
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify([ev("old", 700)]));
    expect(loadEvents()).toEqual([]);
  });

  it("a tab still in an ended epoch writes nothing", () => {
    const epoch = getEpochMs();
    saveMerged([ev("me", 5)], epoch);
    clearWorld();
    const next = getEpochMs() + 1;
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, String(next));
    expect(saveMerged([ev("ghost", 900)], epoch)).toBe(false);
    expect(loadEvents()).toEqual([]);
  });
});
