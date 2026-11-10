import { afterEach, describe, expect, it, vi } from "vitest";
import type { PEvent } from "@/lib/parliament/types";
import { analyticsOn, cleanSessionLine, copyVisitorEvents, isVisitorEvent, writeSession, type SessionLine } from "./analytics";

const LINE: SessionLine = { id: "abcd1234efgh", world: "test-log", no: 3, o: "v_abc12", phase: "live", device: "phone", lang: "ko", page: true, lifeSec: 61.27, livedSec: 0, attempts: 0, endedBy: null };
const event = (o: string): PEvent => ({ id: `${o}:t:1`, o, r: "worker", k: "p", x: 1, z: 2, s: 3 });

afterEach(() => vi.unstubAllEnvs());

describe("cleanSessionLine", () => {
  it("keeps a line, rounded", () => {
    expect(cleanSessionLine(LINE)).toEqual({ ...LINE, lifeSec: 61.3 });
  });

  it("takes a line with no visitor yet", () => {
    expect(cleanSessionLine({ ...LINE, o: null })?.o).toBeNull();
  });

  it.each([
    ["a short id", { id: "ab" }],
    ["a phase that is not logged", { phase: "idle" }],
    ["an owner who is not a visitor", { o: "bot3" }],
    ["another device", { device: "Mozilla/5.0" }],
    ["a way of ending that does not exist", { endedBy: "other" }],
    ["a negative time", { livedSec: -1 }],
    ["a fractional count", { attempts: 1.5 }],
  ])("refuses %s", (_, over) => {
    expect(cleanSessionLine({ ...LINE, ...over })).toBeNull();
  });

  it("keeps nothing it does not know", () => {
    expect(cleanSessionLine({ ...LINE, ip: "1.2.3.4", ua: "Mozilla/5.0" })).toEqual({ ...LINE, lifeSec: 61.3 });
  });
});

describe("who is recorded", () => {
  it("visitors, never bots", () => {
    expect(isVisitorEvent(event("v_abc12"))).toBe(true);
    expect(isVisitorEvent(event("bot3"))).toBe(false);
  });
});

describe("with no database, or switched off", () => {
  it("does nothing and does not fail", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(analyticsOn()).toBe(false);
    await expect(copyVisitorEvents("test-log", 1, [event("v_abc12")])).resolves.toBeUndefined();
    await expect(writeSession(LINE)).resolves.toBe(false);
  });

  it("WORLD_ANALYTICS=0 turns it off with the database there", () => {
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/db");
    expect(analyticsOn()).toBe(true);
    vi.stubEnv("WORLD_ANALYTICS", "0");
    expect(analyticsOn()).toBe(false);
  });
});
