import { describe, expect, it } from "vitest";
import {
  CAUSES_OF,
  CAUSE_NAME,
  INTAKE_PHASES,
  LANGS,
  NOTICE_LINE_SEC,
  ROLE_NAME,
  SCRIPT,
  SESSION_ROLES,
  HINT_AFTER_SEC,
  HOLD_SEC,
  attemptEnd,
  causeOfDeath,
  holdProgress,
  stopAllowed,
  linesShown,
  moveCursor,
  nextIntake,
  pageDone,
  quickRestart,
  roleForKey,
  verdictOf,
  type LifeRecord,
  type RoleId,
  type Surface,
} from "./index";

const rec = (over: Partial<LifeRecord> = {}): LifeRecord => ({
  lifeSec: 180,
  stillSec: 80,
  nearSec: 40,
  met: 2,
  metByRole: { worker: 2 },
  surface: "open",
  endedBy: "lifespan",
  ...over,
});

describe("the steps before the draw", () => {
  it("go notice → consent → headset → choose → draw", () => {
    expect(INTAKE_PHASES).toEqual(["notice", "consent", "headset", "choose"]);
    expect(nextIntake("notice")).toBe("consent");
    expect(nextIntake("consent")).toBe("headset");
    expect(nextIntake("headset")).toBe("choose");
    expect(nextIntake("choose")).toBe("draw");
  });
  it("are skipped for the same visitor starting again soon after the end", () => {
    expect(quickRestart(5_000, 1_000)).toBe(true);
    expect(quickRestart(21_000, 1_000)).toBe(true);
    expect(quickRestart(21_001, 1_000)).toBe(false);
    expect(quickRestart(5_000, 0)).toBe(false);
  });
  it("show a page's lines one after another and only let the page turn once all are up", () => {
    expect(linesShown(3, 0)).toBe(1);
    expect(linesShown(3, NOTICE_LINE_SEC * 1.5)).toBe(2);
    expect(linesShown(3, NOTICE_LINE_SEC * 2)).toBe(3);
    expect(linesShown(3, 100)).toBe(3);
    expect(pageDone(3, NOTICE_LINE_SEC * 1.9)).toBe(false);
    expect(pageDone(3, NOTICE_LINE_SEC * 2)).toBe(true);
    expect(pageDone(1, 0)).toBe(true);
  });
  it("map the number keys to the roles in order, on both rows", () => {
    expect(roleForKey("Digit1")).toBe(SESSION_ROLES[0]);
    expect(roleForKey("Numpad4")).toBe(SESSION_ROLES[3]);
    expect(roleForKey("Digit5")).toBeNull();
    expect(roleForKey("KeyW")).toBeNull();
    expect(roleForKey("Space")).toBeNull();
  });
  it("move the highlight around the four choices and start from either end", () => {
    expect(moveCursor(-1, 1, 4)).toBe(0);
    expect(moveCursor(-1, -1, 4)).toBe(3);
    expect(moveCursor(3, 1, 4)).toBe(0);
    expect(moveCursor(0, -1, 4)).toBe(3);
    expect(moveCursor(1, 1, 4)).toBe(2);
  });
});

describe("the verdict", () => {
  it("is lucky only when the slot happened to agree", () => {
    expect(verdictOf("tree", "tree")).toBe("lucky");
    expect(verdictOf("tree", "car")).toBe("unlucky");
    expect(verdictOf(null, "car")).toBe("unlucky");
  });
});

describe("stopping living", () => {
  it("is on offer to a worker only, once the hint is due, and not during a cooldown", () => {
    expect(stopAllowed("worker", HINT_AFTER_SEC, 1000, 0)).toBe(true);
    expect(stopAllowed("worker", HINT_AFTER_SEC - 1, 1000, 0)).toBe(false);
    expect(stopAllowed("worker", HINT_AFTER_SEC + 50, 1000, 2000)).toBe(false);
    expect(stopAllowed("cat", HINT_AFTER_SEC + 50, 1000, 0)).toBe(false);
    expect(stopAllowed(null, HINT_AFTER_SEC + 50, 1000, 0)).toBe(false);
  });
  it("counts the hold up to one and no further", () => {
    expect(holdProgress(0, 0)).toBe(0);
    expect(holdProgress(HOLD_SEC * 500, 0)).toBeCloseTo(0.5);
    expect(holdProgress(HOLD_SEC * 1000, 0)).toBe(1);
    expect(holdProgress(HOLD_SEC * 5000, 0)).toBe(1);
    expect(holdProgress(500, 1000)).toBe(0);
  });
  it("never succeeds at p = 0, always at p = 1, and otherwise by u", () => {
    for (const u of [0, 0.3, 0.999]) expect(attemptEnd(u, 0)).toBe(false);
    for (const u of [0, 0.3, 0.999]) expect(attemptEnd(u, 1)).toBe(true);
    expect(attemptEnd(0.2, 0.35)).toBe(true);
    expect(attemptEnd(0.5, 0.35)).toBe(false);
  });
});

describe("the cause of death", () => {
  it("is suicide whenever the visitor stopped living, whatever the role", () => {
    for (const r of SESSION_ROLES) expect(causeOfDeath(r, rec({ endedBy: "self" }), 0.5)).toBe("suicide");
  });
  it("follows what the visitor did", () => {
    expect(causeOfDeath("worker", rec({ stillSec: 150, nearSec: 120, surface: "sealed" }), 0.1)).toBe("overwork");
    expect(causeOfDeath("worker", rec({ met: 0, metByRole: {} }), 0.1)).toBe("lonely");
    expect(causeOfDeath("worker", rec({ stillSec: 20, surface: "trodden" }), 0.1)).toBe("traffic");
    expect(causeOfDeath("worker", rec(), 0.1)).toBe("illness");
    expect(causeOfDeath("worker", rec(), 0.9)).toBe("cardiac");
    expect(causeOfDeath("cat", rec({ surface: "trodden", metByRole: { car: 1 } }), 0.1)).toBe("roadkill");
    expect(causeOfDeath("cat", rec({ met: 0, metByRole: {}, stillSec: 10 }), 0.1)).toBe("starved");
    expect(causeOfDeath("cat", rec({ stillSec: 170 }), 0.1)).toBe("cold");
    expect(causeOfDeath("cat", rec({ metByRole: { worker: 3 }, met: 3 }), 0.1)).toBe("captured");
    expect(causeOfDeath("car", rec({ stillSec: 10, nearSec: 100 }), 0.1)).toBe("collision");
    expect(causeOfDeath("car", rec({ stillSec: 170, met: 0, metByRole: {} }), 0.1)).toBe("abandoned");
    expect(causeOfDeath("car", rec({ surface: "sealed" }), 0.1)).toBe("seized");
    expect(causeOfDeath("car", rec(), 0.1)).toBe("scrapped");
    expect(causeOfDeath("tree", rec({ surface: "sealed" }), 0.1)).toBe("felled");
    expect(causeOfDeath("tree", rec({ surface: "trodden" }), 0.1)).toBe("road");
    expect(causeOfDeath("tree", rec({ met: 0, metByRole: {} }), 0.1)).toBe("lightning");
    expect(causeOfDeath("tree", rec(), 0.1)).toBe("withered");
    expect(causeOfDeath("tree", rec(), 0.9)).toBe("blight");
  });
  it("always answers with one of the role's causes, and every cause has a name in every language", () => {
    const surfaces: Surface[] = ["open", "trodden", "sealed"];
    let k = 0;
    for (const r of SESSION_ROLES) {
      for (const s of surfaces) {
        for (const still of [0, 60, 120, 180]) {
          for (const near of [0, 90, 180]) {
            for (const met of [0, 1, 3]) {
              const by: Partial<Record<RoleId, number>> = met ? { worker: met, car: (k++ % 2) as number } : {};
              const c = causeOfDeath(r, rec({ surface: s, stillSec: still, nearSec: near, met, metByRole: by }), (k % 10) / 10);
              expect(CAUSES_OF[r]).toContain(c);
            }
          }
        }
      }
    }
    for (const lang of LANGS) {
      for (const r of SESSION_ROLES) {
        expect(ROLE_NAME[lang][r]).toBeTruthy();
        for (const c of CAUSES_OF[r]) expect(CAUSE_NAME[lang][c]).toBeTruthy();
      }
    }
  });
});

describe("the script", () => {
  it("has the same shape in both languages and keeps every screen to at most three lines", () => {
    for (const lang of LANGS) {
      const s = SCRIPT[lang];
      expect(s.notice.length).toBe(SCRIPT.ko.notice.length);
      for (const page of s.notice) expect(page.length).toBeGreaterThan(0);
      for (const page of s.notice) expect(page.length).toBeLessThanOrEqual(3);
      expect(s.headset.length).toBeLessThanOrEqual(3);
      // the apparatus does not exclaim
      const all = JSON.stringify(s);
      expect(all).not.toContain("!");
    }
  });
});
