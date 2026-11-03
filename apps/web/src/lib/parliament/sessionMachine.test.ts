/**
 * The session machine (components/parliament/useLifeSession.ts) driven with a fake clock: the frame before a life,
 * the rules of stopping living (when X works, when it does not), the end, and the restart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMachine } from "@/components/parliament/useLifeSession";
import { FAIL_MSG_SEC, HINT_AFTER_SEC, NOTICE_LINE_SEC, SCRIPT, STOP_LAST_SEC, type LifeConfig } from "./index";

const key = (code: string, type: "keydown" | "keyup" = "keydown") => ({ type, code, repeat: false, target: null }) as unknown as KeyboardEvent;

const CFG: LifeConfig = { lifeSec: 60, warnSec: 10, endHoldSec: 1, rate: 1, selfP: 0 };

/** Let `ms` pass the way the interval would: a tick every 100 ms. */
function step(m: SessionMachine, ms: number) {
  for (let left = ms; left > 0; left -= 100) {
    vi.advanceTimersByTime(Math.min(100, left));
    m.tick();
  }
}

/** A gesture, with the gap the machine wants between two gestures. */
function press(m: SessionMachine, code: string) {
  vi.advanceTimersByTime(350);
  m.gesture(key(code));
}

function make(cfg: LifeConfig = CFG, rng: () => number = Math.random, getNear?: () => number): SessionMachine {
  const m = new SessionMachine(cfg, rng);
  m.configure(cfg, "ko", getNear);
  m.setEnabled(true);
  return m;
}

/** From the title screen into a life (the headset on, the name, 살아가기). */
function live(m: SessionMachine) {
  press(m, "Enter"); // idle → notice
  for (const page of SCRIPT.ko.notice) {
    step(m, (page.length - 1) * NOTICE_LINE_SEC * 1000 + 50);
    press(m, "Enter");
  }
  expect(m.view.phase).toBe("consent");
  press(m, "Enter");
  expect(m.view.phase).toBe("headset");
  press(m, "Enter");
  expect(m.view.phase).toBe("name");
  press(m, "KeyA"); // only 살아가기 goes on
  step(m, 8000); // the name waits
  expect(m.view.phase).toBe("name");
  m.beginLife();
  expect(m.view.phase).toBe("live");
}

/** Hold X for a full hold. */
function hold(m: SessionMachine) {
  m.holdKey(key("KeyX"));
  step(m, 2200);
  m.releaseKey(key("KeyX", "keyup"));
}

const tap = () => ({ type: "pointerdown", target: null }) as unknown as Event;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the frame before a life", () => {
  it("turns the notice's pages, then the consent, and goes back to the title when nobody presses anything", () => {
    const m = make();
    press(m, "Enter");
    expect(m.view.phase).toBe("notice");
    expect(m.view.page).toBe(0);
    press(m, "Enter");
    expect(m.view.page).toBe(1);
    press(m, "Enter");
    expect(m.view.phase).toBe("consent");
    step(m, 46_000);
    expect(m.view.phase).toBe("idle");
  });
  it("runs through to the life", () => {
    live(make());
  });
  it("a visitor who walks away from the name is forgotten", () => {
    const m = make();
    press(m, "Enter");
    press(m, "Enter");
    press(m, "Enter");
    press(m, "Enter");
    press(m, "Enter");
    expect(m.view.phase).toBe("name");
    step(m, 46_000);
    expect(m.view.phase).toBe("idle");
  });
});

describe("stopping living (worker)", () => {
  it("does nothing before the first banner is due", () => {
    const m = make();
    live(m);
    step(m, 10_000);
    hold(m);
    expect(m.view.phase).toBe("live");
    expect(m.view.attemptFailed).toBe(false);
  });
  it("works while the banner is hidden, fails at p = 0, counts the tries, and works again at once — line or no line", () => {
    const m = make();
    live(m);
    step(m, (HINT_AFTER_SEC + 6) * 1000); // the first banner has come and gone
    expect(m.view.stopHint).toBe(false);
    hold(m);
    expect(m.view.phase).toBe("live");
    expect(m.view.attemptFailed).toBe(true);
    expect(m.view.attempts).toBe(1);
    // the failed line still up: another try fails again (p = 0) …
    step(m, 500);
    hold(m);
    expect(m.view.attempts).toBe(2);
    expect(m.view.attemptFailed).toBe(true);
    // … and at p = 1 it ends the life, line or no line
    m.configure({ ...CFG, selfP: 1 }, "ko");
    step(m, 500);
    expect(m.view.attemptFailed).toBe(true);
    hold(m);
    expect(m.view.phase).toBe("ended");
    expect(m.view.endedBy).toBe("self");
    expect(FAIL_MSG_SEC).toBeGreaterThan(0);
  });
  it("the sound's hold releases as an envelope after a failed hold, while the dark cuts hard", () => {
    const m = make();
    live(m);
    step(m, (HINT_AFTER_SEC + 1) * 1000);
    m.holdKey(key("KeyX"));
    step(m, 600);
    expect(m.lifeRef.current.attempt).toBeGreaterThan(0.5);
    expect(m.lifeRef.current.attemptSound).toBeCloseTo(m.lifeRef.current.attempt, 2);
    step(m, 600); // the hold completes and fails (p = 0)
    expect(m.view.attemptFailed).toBe(true);
    expect(m.lifeRef.current.attempt).toBe(0);
    const a = m.lifeRef.current.attemptSound;
    expect(a).toBeGreaterThan(0.5);
    step(m, 700);
    const b = m.lifeRef.current.attemptSound;
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0.1);
    step(m, 3000);
    expect(m.lifeRef.current.attemptSound).toBe(0);
    m.releaseKey(key("KeyX", "keyup"));
  });
  it("is withdrawn in the last seconds of the life, which then ends by itself", () => {
    const m = make({ ...CFG, selfP: 1 });
    live(m);
    step(m, (CFG.lifeSec - STOP_LAST_SEC + 1) * 1000);
    expect(m.view.stopHint).toBe(false);
    hold(m);
    expect(m.view.phase).toBe("live");
    step(m, STOP_LAST_SEC * 1000);
    expect(m.view.phase).toBe("ended");
    expect(m.view.endedBy).toBe("lifespan");
  });
  it("does nothing when X is let go early", () => {
    const m = make({ ...CFG, selfP: 1 });
    live(m);
    step(m, (HINT_AFTER_SEC + 1) * 1000);
    m.holdKey(key("KeyX"));
    step(m, 400);
    expect(m.view.attempt).toBeGreaterThan(0);
    m.releaseKey(key("KeyX", "keyup"));
    step(m, 3000);
    expect(m.view.phase).toBe("live");
    expect(m.view.attempt).toBe(0);
  });
  it("is less likely to succeed with others near: the same luck ends the life alone, not in company", () => {
    const luck = () => 0.3; // against 0.5 alone, against 0.5 × 0.5² = 0.125 with two near
    let near = 2;
    const m = make({ ...CFG, selfP: 0.5 }, luck, () => near);
    live(m);
    step(m, (HINT_AFTER_SEC + 1) * 1000);
    hold(m);
    expect(m.view.phase).toBe("live");
    expect(m.view.lastAttemptNear).toBe(2);
    near = 0;
    step(m, 500);
    hold(m);
    expect(m.view.phase).toBe("ended");
    expect(m.view.endedBy).toBe("self");
  });
});

describe("the end and the restart", () => {
  it("SPACE soon after the end goes to a new name and the next life; later it is a new visitor with the notices", () => {
    const m = make();
    live(m);
    const no = m.view.sessionNo;
    step(m, 61_000);
    expect(m.view.phase).toBe("ended");
    step(m, 1100);
    expect(m.view.restartReady).toBe(true);
    press(m, "Space");
    expect(m.view.phase).toBe("name");
    expect(m.view.sessionNo).toBe(no + 1);
    m.beginLife();
    expect(m.view.phase).toBe("live");
    expect(m.lifeRef.current.t).toBe(0); // the lifespan starts afresh
    step(m, 61_000 + 1100);
    expect(m.view.phase).toBe("ended");
    step(m, 25_000);
    press(m, "Space");
    expect(m.view.phase).toBe("notice");
    expect(m.view.sessionNo).toBe(no + 2);
  });
  it("each life is given its own length when it begins, and ends then", () => {
    const m = make({ lifeSec: 180, lifeMinSec: 30, lifeMaxSec: 120, warnSec: 40, endHoldSec: 1, rate: 1, selfP: 0 }, () => 0);
    expect(m.view.lifeSec).toBe(0);
    live(m);
    expect(m.view.lifeSec).toBe(30);
    step(m, 29_000);
    expect(m.view.phase).toBe("live");
    step(m, 2000);
    expect(m.view.phase).toBe("ended");
    expect(m.view.lifeSec).toBe(30);
    expect(m.view.endedBy).toBe("lifespan");
    const n = make({ lifeSec: 180, lifeMinSec: 30, lifeMaxSec: 120, warnSec: 40, endHoldSec: 1, rate: 1, selfP: 0 }, () => 1);
    live(n);
    expect(n.view.lifeSec).toBe(120);
    step(n, 119_000);
    expect(n.view.phase).toBe("live");
    step(n, 2000);
    expect(n.view.phase).toBe("ended");
  });
  it("a tap restarts too (a phone has no SPACE), and the long press holds like X", () => {
    const m = make({ ...CFG, selfP: 1 });
    live(m);
    step(m, (HINT_AFTER_SEC + 1) * 1000);
    m.beginHold();
    step(m, 1200);
    m.endHold();
    expect(m.view.phase).toBe("ended");
    expect(m.view.endedBy).toBe("self");
    step(m, 1100);
    vi.advanceTimersByTime(350);
    m.gesture(tap());
    expect(m.view.phase).toBe("name");
  });
});
