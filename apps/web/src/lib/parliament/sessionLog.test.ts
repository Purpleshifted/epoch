import { describe, expect, it } from "vitest";
import type { SessionLine } from "@/lib/world/analytics";
import { SessionLog, type SessionNow } from "./sessionLog";

const PAGE = { world: "test-log", device: "phone", lang: "ko", page: true } as const;

function setup() {
  const lines: SessionLine[] = [];
  let n = 0;
  const log = new SessionLog(PAGE, (l) => lines.push(l), () => `session${++n}`);
  const at = (over: Partial<SessionNow>): SessionNow => ({ no: 1, phase: "notice", o: "v_abc", lifeSec: 0, livedSec: 0, failed: 0, endedBy: null, ...over });
  return { log, lines, at };
}

describe("SessionLog", () => {
  it("says nothing before the first gesture", () => {
    const { log, lines, at } = setup();
    log.update(at({ no: 0, phase: "live" }));
    log.update(at({ phase: "idle" }));
    expect(lines).toEqual([]);
  });

  it("follows one session under one id, each change once", () => {
    const { log, lines, at } = setup();
    log.update(at({}));
    log.update(at({}));
    log.update(at({ phase: "live", lifeSec: 60 }));
    log.update(at({ phase: "live", lifeSec: 60, failed: 1, livedSec: 20 }));
    log.update(at({ phase: "ended", lifeSec: 60, failed: 1, livedSec: 31, endedBy: "self" }));
    expect(lines.map((l) => l.phase)).toEqual(["notice", "live", "live", "ended"]);
    expect(new Set(lines.map((l) => l.id))).toEqual(new Set(["session1"]));
    expect(lines[3]).toMatchObject({ attempts: 2, endedBy: "self", livedSec: 31, o: "v_abc", world: "test-log", device: "phone" });
  });

  it("gives the next visitor a new id, and one who came back from idle too", () => {
    const { log, lines, at } = setup();
    log.update(at({}));
    log.update(at({ phase: "idle" }));
    log.update(at({}));
    log.update(at({ no: 2, phase: "name" }));
    expect(lines.map((l) => l.id)).toEqual(["session1", "session2", "session3"]);
  });

  it("says the page left only during a life", () => {
    const { log, lines, at } = setup();
    log.update(at({}));
    log.leave(1);
    expect(lines).toHaveLength(1);
    log.update(at({ phase: "live", lifeSec: 60 }));
    log.leave(12);
    expect(lines[2]).toMatchObject({ phase: "live", endedBy: "left", livedSec: 12 });
    log.update(at({ phase: "ended", endedBy: "lifespan", livedSec: 60 }));
    log.leave(60);
    expect(lines).toHaveLength(4);
  });
});
