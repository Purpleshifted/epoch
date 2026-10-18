import { beforeEach, describe, expect, it } from "vitest";
import { EventLog, KEEP_WINDOW_SEC, LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_EVENTS_TOKEN_KEY, LS_KEEP_FROM_KEY, MAX_EVENTS, eventsWrittenHere, LS_KEEP_WINDOW_KEY, LS_PARLIAMENT_EPOCH_KEY, clearWorld, getEpochMs, keepFromS, keepWindowSec, loadEvents, saveMerged, setKeepFrom, setKeepWindowSec, type PEvent } from "./index";

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

describe("history window: a shared setting of the browser", () => {
  it("defaults to KEEP_WINDOW_SEC, follows the setting, and setKeepFrom applies it", () => {
    localStorage.removeItem(LS_KEEP_WINDOW_KEY);
    expect(keepWindowSec()).toBe(KEEP_WINDOW_SEC);
    setKeepFrom(5000);
    expect(keepFromS()).toBe(5000 - KEEP_WINDOW_SEC);
    setKeepWindowSec(300);
    expect(keepWindowSec()).toBe(300);
    setKeepFrom(5000);
    expect(keepFromS()).toBe(4700);
    setKeepWindowSec(0); // nonsense clears the setting
    expect(keepWindowSec()).toBe(KEEP_WINDOW_SEC);
  });
});

describe("log: saving appends to what this tab wrote (no re-reading, no re-serializing everything)", () => {
  it("one writer: the stored log is every event, sorted by assigned time, whatever order they came in", () => {
    const epoch = getEpochMs();
    saveMerged([ev("a", 5), ev("b", 3)], epoch);
    saveMerged([ev("c", 4), ev("a", 6), ev("b", 3)], epoch); // b:3 again: kept once
    saveMerged([ev("d", 1)], epoch);
    const raw = JSON.parse(localStorage.getItem(LS_EVENTS_KEY)!) as PEvent[];
    expect(raw.map((e) => e.id)).toEqual(["d:1", "b:3", "c:4", "a:5", "a:6"]);
    expect(eventsWrittenHere()).toBe(true);
  });

  it("someone else wrote in between: their events are merged, and the next poll is told to read", () => {
    const epoch = getEpochMs();
    saveMerged([ev("me", 1)], epoch);
    eventsWrittenHere();
    // another tab (its own token) adds its events
    const stored = JSON.parse(localStorage.getItem(LS_EVENTS_KEY)!) as PEvent[];
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify([...stored, ev("other", 2)]));
    localStorage.setItem(LS_EVENTS_TOKEN_KEY, "someone-else");
    expect(eventsWrittenHere()).toBe(false);
    saveMerged([ev("me", 3)], epoch);
    expect(loadEvents().map((e) => e.id)).toEqual(["me:1", "other:2", "me:3"]);
    expect(eventsWrittenHere()).toBe(false); // once: the poll reads what came from the other tab
    expect(eventsWrittenHere()).toBe(true);
  });

  it("the history window moves on: the head is forgotten in the stored log too", () => {
    const epoch = getEpochMs();
    saveMerged([ev("a", 10), ev("a", 20), ev("a", 30)], epoch);
    localStorage.setItem(LS_KEEP_FROM_KEY, "15");
    saveMerged([ev("a", 40)], epoch);
    expect(loadEvents().map((e) => e.s)).toEqual([20, 30, 40]);
  });

  it("keeps the latest MAX_EVENTS by assigned time", () => {
    const epoch = getEpochMs();
    const many: PEvent[] = [];
    for (let i = 0; i < MAX_EVENTS + 50; i++) many.push(ev("bot", i));
    saveMerged(many, epoch);
    const got = loadEvents();
    expect(got.length).toBe(MAX_EVENTS);
    expect(got[0].s).toBe(50);
  });

  it("clear world starts over: nothing of the old cache comes back", () => {
    const epoch = getEpochMs();
    saveMerged([ev("old", 1)], epoch);
    clearWorld();
    const next = getEpochMs();
    saveMerged([ev("new", 2)], next);
    expect(loadEvents().map((e) => e.o)).toEqual(["new"]);
  });
});
