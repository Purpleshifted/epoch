import { beforeEach, describe, expect, it } from "vitest";
import { EventLog, KEEP_WINDOW_SEC, LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_PARLIAMENT_EPOCH_KEY, clearWorld, getEpochMs, keepFromS, loadEvents, saveMerged, setKeepFrom, type PEvent } from "./index";

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

describe("history window: only the last KEEP_WINDOW_SEC before the player's session", () => {
  it("loading and saving drop what is older than the cutoff; an open log forgets it", () => {
    const epoch = getEpochMs();
    saveMerged([ev("old", 100), ev("recent", 1500)], epoch);
    expect(loadEvents()).toHaveLength(2);
    setKeepFrom(100 + KEEP_WINDOW_SEC + 50); // a session that started 50 s after the window has passed "old"
    expect(loadEvents().map((e) => e.o)).toEqual(["recent"]);
    saveMerged([ev("older", 120)], epoch);
    expect(loadEvents().map((e) => e.o)).toEqual(["recent"]);
    const log = new EventLog();
    log.addMany([ev("old", 100), ev("recent", 1500)]);
    expect(log.dropBefore(keepFromS())).toBe(1);
    expect(log.all().map((e) => e.o)).toEqual(["recent"]);
  });

  it("clear world forgets the cutoff too", () => {
    setKeepFrom(5000);
    clearWorld();
    expect(keepFromS()).toBe(-Infinity);
  });
});
