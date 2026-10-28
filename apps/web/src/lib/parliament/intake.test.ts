import { describe, expect, it } from "vitest";
import {
  CAUSES_OF,
  CAUSE_NAME,
  LANGS,
  NOTICE_LINE_SEC,
  ROLE_NAME,
  SCRIPT,
  SESSION_ROLES,
  HINT_AFTER_SEC,
  HINT_PERIOD_SEC,
  HINT_SHOW_SEC,
  HOLD_SEC,
  STOP_LAST_SEC,
  attemptEnd,
  causeOfDeath,
  selfChance,
  hintUp,
  holdProgress,
  isStopKey,
  stopAllowed,
  linesShown,
  pageDone,
  quickRestart,
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

describe("the steps before the life", () => {
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
});

describe("stopping living", () => {
  it("is on offer to a worker only, once the first banner is due", () => {
    expect(stopAllowed("worker", HINT_AFTER_SEC)).toBe(true);
    expect(stopAllowed("worker", HINT_AFTER_SEC - 1)).toBe(false);
    expect(stopAllowed("cat", HINT_AFTER_SEC + 50)).toBe(false);
    expect(stopAllowed(null, HINT_AFTER_SEC + 50)).toBe(false);
  });
  it("is withdrawn in the last seconds of the life, and follows the rule it is given", () => {
    expect(stopAllowed("worker", 100, STOP_LAST_SEC)).toBe(false);
    expect(stopAllowed("worker", 100, STOP_LAST_SEC + 0.1)).toBe(true);
    expect(stopAllowed("worker", 5, 0.5, { afterSec: 5, lastSec: 0 })).toBe(true);
    expect(stopAllowed("worker", 4.9, 100, { afterSec: 5, lastSec: 0 })).toBe(false);
    expect(stopAllowed("worker", 100, 30, { afterSec: 5, lastSec: 30 })).toBe(false);
  });
  it("is held on X, not on the walking keys", () => {
    expect(isStopKey("KeyX")).toBe(true);
    for (const k of ["Delete", "KeyW", "Space", "Enter"]) expect(isStopKey(k)).toBe(false);
  });
  it("shows its hint now and then from the twentieth second on", () => {
    expect(hintUp(HINT_AFTER_SEC - 0.1)).toBe(false);
    expect(hintUp(HINT_AFTER_SEC)).toBe(true);
    expect(hintUp(HINT_AFTER_SEC + HINT_SHOW_SEC - 0.1)).toBe(true);
    expect(hintUp(HINT_AFTER_SEC + HINT_SHOW_SEC)).toBe(false);
    expect(hintUp(HINT_AFTER_SEC + HINT_PERIOD_SEC)).toBe(true);
    expect(hintUp(HINT_AFTER_SEC + HINT_PERIOD_SEC + HINT_SHOW_SEC + 1)).toBe(false);
  });
  it("counts the hold up to one and no further", () => {
    expect(holdProgress(0, 0)).toBe(0);
    expect(holdProgress(HOLD_SEC * 500, 0)).toBeCloseTo(0.5);
    expect(holdProgress(HOLD_SEC * 1000, 0)).toBe(1);
    expect(holdProgress(HOLD_SEC * 5000, 0)).toBe(1);
    expect(holdProgress(500, 1000)).toBe(0);
  });
  it("gets less likely with every other being near, and stays the base chance alone", () => {
    expect(selfChance(0.4, 0)).toBe(0.4);
    expect(selfChance(0.4, 1)).toBeCloseTo(0.2);
    expect(selfChance(0.4, 2)).toBeCloseTo(0.1);
    expect(selfChance(0.4, 3, 0.1)).toBeCloseTo(0.0004);
    expect(selfChance(1, 5, 1)).toBe(1);
    expect(selfChance(0.4, 2, 0)).toBe(0);
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
      expect(s.headsetTouch.length).toBeLessThanOrEqual(3);
      // how to walk is said in the first seconds of the life (there is no verdict screen to say it on)
      expect(s.live.controls).toBeTruthy();
      expect(s.live.controlsTouch).toBeTruthy();
      // the apparatus does not exclaim
      const all = JSON.stringify(s);
      expect(all).not.toContain("!");
    }
  });
});
