import { describe, expect, it } from "vitest";
import { WORLD_HALF } from "@/lib/parliament/world";
import {
  CHUNK_MS,
  CLOSE_GRACE_MS,
  MAX_EVENTS_PER_POST,
  chunkEndMs,
  chunkOf,
  cleanEvent,
  cleanEvents,
  isClosed,
  isWorldName,
  joinEventTexts,
  keepFromAt,
  lastClosedChunk,
  pageWindow,
  worldMsAt,
} from "./protocol";

const event = { id: "bot3:1000", o: "bot3", r: "worker", k: "p", x: 1.234, z: -5.678, s: 12.345 };

describe("chunks", () => {
  it("a moment belongs to the chunk whose span holds it", () => {
    expect(chunkOf(0)).toBe(0);
    expect(chunkOf(CHUNK_MS - 1)).toBe(0);
    expect(chunkOf(CHUNK_MS)).toBe(1);
    expect(chunkEndMs(0)).toBe(CHUNK_MS);
  });

  it("a chunk closes only after its end plus the grace", () => {
    const k = 500;
    const end = chunkEndMs(k);
    expect(isClosed(k, end)).toBe(false);
    expect(isClosed(k, end + CLOSE_GRACE_MS - 1)).toBe(false);
    expect(isClosed(k, end + CLOSE_GRACE_MS)).toBe(true);
    expect(lastClosedChunk(end + CLOSE_GRACE_MS)).toBe(k);
  });

  it("an insert stamped at the last moment of a chunk is still inside a chunk that is not yet closed", () => {
    const stamp = chunkEndMs(7) - 1;
    expect(chunkOf(stamp)).toBe(7);
    expect(isClosed(7, stamp + 100)).toBe(false);
  });
});

describe("the world clock", () => {
  const anchor = { r: 1000, v: 5000, rate: 2 };

  it("runs from the anchor at the rate", () => {
    expect(worldMsAt(anchor, 1000)).toBe(5000);
    expect(worldMsAt(anchor, 2000)).toBe(7000);
    expect(worldMsAt({ ...anchor, rate: 0 }, 9000)).toBe(5000);
  });

  it("gives every tab the same cut-off", () => {
    const st = { anchor: { r: 0, v: 100_000, rate: 1 }, epochMs: 40_000, keepWindowSec: 20 };
    expect(keepFromAt(st, 0)).toBe(40);
    expect(keepFromAt(st, 10_000)).toBe(50);
  });
});

describe("world names", () => {
  it("takes the rehearsal, the exhibition and test worlds", () => {
    for (const n of ["rehearsal", "exhibition", "dev-3014", "test-a1"]) expect(isWorldName(n)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const n of ["", "other", "dev-", "DEV-1", "dev-1;drop", `dev-${"a".repeat(25)}`]) expect(isWorldName(n)).toBe(false);
  });
});

describe("cleaning events", () => {
  it("keeps the seven fields, rounded as log.ts stores them", () => {
    expect(cleanEvent({ ...event, extra: 1 })).toEqual({ id: "bot3:1000", o: "bot3", r: "worker", k: "p", x: 1.23, z: -5.68, s: 12.35 });
  });

  it("wraps coordinates into the world", () => {
    expect(cleanEvent({ ...event, x: WORLD_HALF + 1 })?.x).toBeCloseTo(-WORLD_HALF + 1);
  });

  it("refuses what is not an event", () => {
    const bad = [null, 1, {}, { ...event, r: "ghost" }, { ...event, k: "x" }, { ...event, x: Infinity }, { ...event, s: "1" }, { ...event, id: "" }, { ...event, id: "a".repeat(81) }, { ...event, o: "a".repeat(41) }];
    for (const e of bad) expect(cleanEvent(e)).toBeNull();
  });

  it("drops bad events from a list and refuses a list that is too long", () => {
    expect(cleanEvents([event, { nope: 1 }])).toHaveLength(1);
    expect(cleanEvents("nope")).toBeNull();
    expect(cleanEvents(new Array(MAX_EVENTS_PER_POST + 1).fill(event))).toBeNull();
  });
});

describe("joining stored rows", () => {
  it("makes one array, skipping empty rows", () => {
    expect(JSON.parse(joinEventTexts(['[{"a":1}]', "[]", '[{"b":2},{"c":3}]']))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(joinEventTexts([])).toBe("[]");
  });
});

describe("the window's pages", () => {
  const row = (chunk: number, size = 10) => ({ chunk, events: "x".repeat(size) });

  it("returns everything when it fits", () => {
    expect(pageWindow([row(1), row(2)])).toEqual({ texts: ["x".repeat(10), "x".repeat(10)], next: null });
  });

  it("stops at a chunk's edge when the bytes run out", () => {
    const { texts, next } = pageWindow([row(1), row(1), row(2), row(3)], 100, 25);
    expect(texts).toHaveLength(2);
    expect(next).toBe(2);
  });

  it("never cuts inside a chunk at the row limit", () => {
    const { texts, next } = pageWindow([row(1), row(2), row(2)], 3);
    expect(texts).toHaveLength(1);
    expect(next).toBe(2);
  });

  it("does not stall when one chunk fills a whole page", () => {
    const { texts, next } = pageWindow([row(1), row(1)], 2);
    expect(texts).toHaveLength(2);
    expect(next).toBeNull();
  });
});
