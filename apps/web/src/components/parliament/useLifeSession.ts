"use client";
/**
 * useLifeSession — one visitor's session in the player view (V2; lib/parliament/session.ts and intake.ts have the rules):
 *   IDLE     → (any gesture)  NOTICE: the frame, a few pages; a gesture turns a page once all its lines are up
 *   NOTICE   → CONSENT (a question with only yes) → HEADSET
 *   HEADSET  → LIVE at once (2026-10-20: no choice of role, no slot, no verdict — every visitor is the worker): the
 *              lifespan runs (wall clock: it is the visitor's real time, not the world clock)
 *   LIVE     → ENDED: the visitor is taken off the ground; the end screen (with the cause of death) stays
 *   LIVE, worker only, from hintAfterSec on and not in the last stopLastSec (a banner says so now and then): X held
 *              for holdSec is an attempt to
 *              stop living — the dark comes up and
 *              the sound closes while it is held; at the end luck decides (selfP, less with every other being near —
 *              selfChance): ENDED by "self", or a failed line
 *              (and X works again at once, line or no line). Let go early and nothing happens.
 *   ENDED    → (SPACE, once endHoldSec have passed) NOTICE of the next session — or straight into LIVE when SPACE
 *              comes within QUICK_RESTART_SEC of the end (the same visitor again: the next life starts at once) —
 *              or (END_RETURN_SEC later) IDLE: `sessionNo` goes up, so the player parts remount as a NEW visitor
 *              (new id, new time slot)
 *   NOTICE … HEADSET → (IDLE_AFTER_SEC without input) IDLE: the visitor left before living; nothing was recorded
 *
 * The machine is a small store outside React (SessionMachine); the per-frame values (phase, seconds into the
 * session, warning level) are in `lifeRef`, read by the controller, the cursor and RoleField without re-rendering.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LIFE,
  END_RETURN_SEC,
  FAIL_MSG_SEC,
  GESTURE_GAP_MS,
  HINT_AFTER_SEC,
  HINT_PERIOD_SEC,
  HINT_SHOW_SEC,
  HOLD_SEC,
  NOTICE_LINE_SEC,
  SELF_NEAR_FACTOR,
  STOP_LAST_SEC,
  IDLE_AFTER_SEC,
  SCRIPT,
  quickRestart,
  attemptEnd,
  hintUp,
  holdProgress,
  isStopKey,
  lifeAt,
  pageDone,
  selfChance,
  stopAllowed,
  type EndedBy,
  type Lang,
  type LifeConfig,
  type SessionPhase,
} from "@/lib/parliament";
import type { SoundParams } from "@/lib/sound";

export interface LifeSignal {
  phase: SessionPhase;
  /** Seconds since the life began (LIVE / ENDED), 0 before. */
  t: number;
  /** 0 … 1 over the last warnSec of the lifespan. */
  warn: number;
  /** 0 … 1 while X is held to stop living (the dark, the sound and the dead controls follow it); 0 otherwise. */
  attempt: number;
}

export interface SessionView {
  phase: SessionPhase;
  /** Goes up by one for every new visitor. */
  sessionNo: number;
  /** ENDED, and endHoldSec have passed: SPACE starts the next session. */
  restartReady: boolean;
  /** NOTICE: which page. */
  page: number;
  /** Wall ms the current phase (or notice page) began: its lines come on from then. */
  phaseAt: number;
  /** ENDED: how the life ended. */
  endedBy: EndedBy | null;
  /** LIVE: how far the hold to stop living has got (0 … 1). */
  attempt: number;
  /** LIVE: stopping living is on offer right now (worker, within the rule's window) — the phone's button shows then. */
  stopOn: boolean;
  /** LIVE: the banner for stopping living is up (stopOn, now and then, not holding). */
  stopHint: boolean;
  /** LIVE: the line after a failed attempt is up. */
  attemptFailed: boolean;
  /** LIVE: how many attempts to stop living have failed so far (the record writes them) … */
  attempts: number;
  /** … and how many others were near at the last one. */
  lastAttemptNear: number;
}

export interface LifeSession extends SessionView {
  lifeRef: { readonly current: LifeSignal };
  /** LIVE: start / stop holding to stop living (the X key on a keyboard; a long press on a phone). */
  beginHold: () => void;
  endHold: () => void;
}

const TICK_MS = 100;

/** The phases before the life in which a visitor who walks away is forgotten (back to the title screen). */
const WAITING: readonly SessionPhase[] = ["notice", "consent", "headset"];

const FRESH: Omit<SessionView, "phase" | "sessionNo"> = {
  restartReady: false,
  page: 0,
  phaseAt: 0,
  endedBy: null,
  attempt: 0,
  stopOn: false,
  stopHint: false,
  attemptFailed: false,
  attempts: 0,
  lastAttemptNear: 0,
};

/** A gesture on the Leva panel (tuning) does not count. */
function onPanel(e: Event): boolean {
  const el = e.target as Element | null;
  return !!el?.closest?.("[class*='leva-']");
}

export class SessionMachine {
  view: SessionView = { ...FRESH, phase: "live", sessionNo: 0 };
  readonly lifeRef: { current: LifeSignal } = { current: { phase: "live", t: 0, warn: 0, attempt: 0 } };
  cfg: LifeConfig;
  lang: Lang = "ko";
  /** How many others are near the visitor right now (the record's NEAR radius); 0 when unknown. */
  getNear: () => number = () => 0;
  private readonly rng: () => number;
  private enabled = false;
  /** Lifespan seconds lived so far (advanced by the clock × rate) and the wall ms of the last tick. */
  private lived = 0;
  private lastTick = 0;
  private endAt = 0;
  private lastGestureAt = 0;
  private lastInputAt = 0;
  /** B — stopping living: X is down since holdStart; the failed line is up until failedUntil. */
  private holding = false;
  private holdStart = 0;
  private failedUntil = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: LifeConfig, rng: () => number = Math.random) {
    this.cfg = cfg;
    this.rng = rng;
  }

  configure(cfg: LifeConfig, lang: Lang, getNear?: () => number) {
    this.cfg = cfg;
    this.lang = lang;
    if (getNear) this.getNear = getNear;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  get = () => this.view;

  private set(patch: Partial<SessionView>) {
    this.view = { ...this.view, ...patch };
    if (patch.phase) this.lifeRef.current = { ...this.lifeRef.current, phase: patch.phase };
    for (const fn of this.listeners) fn();
  }

  /** Go to `phase` now (its lines come on from now). */
  private enter(phase: SessionPhase, patch: Partial<SessionView> = {}) {
    this.set({ ...patch, phase, phaseAt: Date.now() });
  }

  /** A new visitor: everything fresh, `sessionNo` up, starting at `phase` (`live`: the same visitor again, at once). */
  private next(phase: "idle" | "notice" | "live") {
    this.holding = false;
    this.failedUntil = 0;
    this.lifeRef.current = { phase, t: 0, warn: 0, attempt: 0 };
    this.set({ ...FRESH, phase, phaseAt: Date.now(), sessionNo: this.view.sessionNo + 1 });
    if (phase === "live") this.begin();
  }

  /** The life begins: the lifespan clock starts from zero (after the headset, or on a quick restart). */
  private begin() {
    this.lived = 0;
    this.lastTick = Date.now();
    this.lifeRef.current = { phase: "live", t: 0, warn: 0, attempt: 0 };
    this.enter("live");
  }

  /** Switched on: wait for the next visitor. Off (V1, Leva): always live, no lifespan. */
  setEnabled(on: boolean) {
    if (on === this.enabled && this.view.sessionNo > 0) return;
    this.enabled = on;
    this.lifeRef.current = { phase: on ? "idle" : "live", t: 0, warn: 0, attempt: 0 };
    this.set({ ...FRESH, phase: on ? "idle" : "live", phaseAt: Date.now(), sessionNo: this.view.sessionNo + 1 });
  }

  /** The stop-living rule from the config (Leva), with intake.ts's defaults. */
  private stopRule() {
    return { afterSec: this.cfg.hintAfterSec ?? HINT_AFTER_SEC, lastSec: this.cfg.stopLastSec ?? STOP_LAST_SEC };
  }

  /** B — X pressed while live: within the rule's window it starts holding to stop living (line or no line). */
  holdKey = (e: KeyboardEvent) => {
    if (!isStopKey(e.code) || e.repeat || onPanel(e)) return;
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
    this.beginHold();
  };

  /** Start holding to stop living (within the rule's window; otherwise nothing). */
  beginHold = () => {
    if (!this.enabled) return;
    const v = this.view;
    const t = this.lifeRef.current.t;
    if (v.phase !== "live" || this.holding || !stopAllowed("worker", t, lifeAt(t, this.cfg).left, this.stopRule())) return;
    this.holding = true;
    this.holdStart = Date.now();
  };

  /** Let go before the hold is complete: nothing happens, the dark cuts back. */
  releaseKey = (e: KeyboardEvent) => {
    if (!isStopKey(e.code)) return;
    this.endHold();
  };

  /** Let go: nothing happens if the hold was not complete (the dark cuts back). */
  endHold = () => {
    if (!this.holding) return;
    this.holding = false;
    this.lifeRef.current = { ...this.lifeRef.current, attempt: 0 };
    if (this.view.attempt !== 0) this.set({ attempt: 0 });
  };

  /** Any gesture (pointer, touch, key): what it does depends on the phase. */
  gesture = (e: Event) => {
    if (!this.enabled || onPanel(e)) return;
    let code = "";
    if (e.type === "keydown") {
      const k = e as KeyboardEvent;
      if (k.repeat || (k.target as HTMLElement | null)?.tagName === "INPUT") return;
      code = k.code;
      // ESC is the sound's mute / the look-release key, never a session gesture (sound wiring)
      if (code === "Escape") return;
    }
    const now = Date.now();
    if (now - this.lastGestureAt < GESTURE_GAP_MS) return;
    this.lastGestureAt = now;
    this.lastInputAt = now;
    const v = this.view;
    switch (v.phase) {
      case "idle":
        this.enter("notice", { page: 0 });
        return;
      case "notice": {
        const pages = SCRIPT[this.lang].notice;
        const lines = pages[v.page]?.length ?? 1;
        if (!pageDone(lines, (now - v.phaseAt) / 1000, this.cfg.noticeLineSec ?? NOTICE_LINE_SEC)) return;
        if (v.page + 1 < pages.length) this.set({ page: v.page + 1, phaseAt: now });
        else this.enter("consent");
        return;
      }
      case "consent":
        // whatever is pressed, it is yes
        this.enter("headset");
        return;
      case "headset":
        // the headset is on: the life begins at once (the worker)
        this.begin();
        return;
      case "ended":
        // SPACE — or a tap / click (a phone has no keys) — once the end screen has held; soon after the end it is the
        // same visitor again: the next life starts at once, without the notices
        if (v.restartReady && (code === "Space" || e.type !== "keydown")) this.next(quickRestart(now, this.endAt) ? "live" : "notice");
        return;
      default:
        return; // live: the screen runs on its own (the controls are the Controller's)
    }
  };

  /** The clock: LIVE → ENDED (→ ready for SPACE → back to the title); the waiting timeouts. */
  tick = () => {
    if (!this.enabled) return;
    const now = Date.now();
    const v = this.view;
    if (v.phase === "live") {
      // the lifespan clock: wall time × rate (rate > 1 only for testing the end)
      this.lived += (Math.max(0, now - this.lastTick) / 1000) * Math.max(0, this.cfg.rate ?? 1);
      this.lastTick = now;
      const t = this.lived;
      const st = lifeAt(t, this.cfg);
      // B — the hold to stop living: the dark comes up with it; when it is complete, luck decides
      let attempt = 0;
      let tried = 0;
      let near = v.lastAttemptNear;
      if (this.holding) {
        attempt = holdProgress(now, this.holdStart, this.cfg.holdSec ?? HOLD_SEC);
        if (attempt >= 1) {
          this.holding = false;
          attempt = 0;
          near = Math.max(0, Math.floor(this.getNear()));
          const p = selfChance(this.cfg.selfP ?? DEFAULT_LIFE.selfP ?? 0, near, this.cfg.selfNearFactor ?? SELF_NEAR_FACTOR);
          if (attemptEnd(this.rng(), p)) {
            this.end("self", t);
            return;
          }
          this.failedUntil = now + FAIL_MSG_SEC * 1000;
          tried = 1;
        }
      }
      this.lifeRef.current = { phase: "live", t, warn: st.warn, attempt };
      if (st.over) {
        this.end("lifespan", t);
        return;
      }
      const rule = this.stopRule();
      const stopOn = stopAllowed("worker", t, st.left, rule);
      const stopHint = stopOn && !this.holding && hintUp(t, rule.afterSec, this.cfg.hintPeriodSec ?? HINT_PERIOD_SEC, this.cfg.hintShowSec ?? HINT_SHOW_SEC);
      const attemptFailed = now < this.failedUntil;
      if (tried || attempt !== v.attempt || stopOn !== v.stopOn || stopHint !== v.stopHint || attemptFailed !== v.attemptFailed) {
        this.set({ attempt, stopOn, stopHint, attemptFailed, attempts: v.attempts + tried, lastAttemptNear: near });
      }
    } else if (v.phase === "ended") {
      const held = now - this.endAt;
      if (!v.restartReady && held >= Math.max(0, this.cfg.endHoldSec) * 1000) this.set({ restartReady: true });
      else if (v.restartReady && held >= (Math.max(0, this.cfg.endHoldSec) + END_RETURN_SEC) * 1000) this.next("idle");
    } else if (WAITING.includes(v.phase)) {
      if (now - this.lastInputAt >= IDLE_AFTER_SEC * 1000) this.enter("idle", { page: 0 });
    }
  };

  /** LIVE → ENDED. */
  private end(by: EndedBy, t: number) {
    this.holding = false;
    this.endAt = Date.now();
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    this.lifeRef.current = { phase: "ended", t, warn: 1, attempt: 0 };
    this.enter("ended", { endedBy: by, attempt: 0, stopOn: false, stopHint: false, attemptFailed: false });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(this.tick, TICK_MS);
    window.addEventListener("pointerdown", this.gesture);
    window.addEventListener("keydown", this.gesture);
    window.addEventListener("touchend", this.gesture);
    window.addEventListener("keydown", this.holdKey);
    window.addEventListener("keyup", this.releaseKey);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pointerdown", this.gesture);
    window.removeEventListener("keydown", this.gesture);
    window.removeEventListener("touchend", this.gesture);
    window.removeEventListener("keydown", this.holdKey);
    window.removeEventListener("keyup", this.releaseKey);
  }
}

/**
 * @param enabled  false (V1, or switched off in Leva): always LIVE, no lifespan
 * @param lang  the language the apparatus speaks (how many lines each notice page has)
 * @param getNear  how many others are near right now (for the chance of stopping living); absent = alone
 */
export function useLifeSession(enabled: boolean, cfg: LifeConfig, lang: Lang = "ko", getNear?: () => number): LifeSession {
  const [m] = useState(() => new SessionMachine(cfg));
  useEffect(() => {
    m.configure(cfg, lang, getNear);
  }, [m, cfg, lang, getNear]);
  useEffect(() => {
    m.setEnabled(enabled);
  }, [m, enabled]);
  useEffect(() => {
    m.start();
    return () => m.stop();
  }, [m]);
  const view = useSyncExternalStore(m.subscribe, m.get, m.get);
  return { ...view, lifeRef: m.lifeRef, beginHold: m.beginHold, endHold: m.endHold };
}

/** Log-interpolate a frequency towards `to` by k (0 … 1). */
const towards = (f: number, to: number, k: number) => f * Math.pow(to / Math.max(1, f), k);

/**
 * The headset near the end: the low-pass closes (as if through a wall), the others fade first, then everything.
 * The same closing while X is held to stop living (over the hold, all the way). Silent whenever the session is not
 * live: before the life (the title, the notices, the consent, the headset) and after the end.
 */
export function muffleSound(p: SoundParams, life: LifeSignal | undefined): SoundParams {
  if (!life) return p;
  // ended: the engine plays the AFTERLIFE (nothing but the reverb of the last sound, from the master where it was)
  // and fades itself (sound wiring, v4 A5d/A5g)
  if (life.phase === "ended") return { ...p, dead: true };
  if (life.phase !== "live") return { ...p, master: 0, dead: false };
  // dying — the lifespan's last stretch, or X held to stop — is only this muffling (the artist, 10/18: simple, as before)
  const w = Math.max(life.warn, life.attempt ?? 0);
  if (!(w > 0)) return { ...p, dead: false };
  const k = Math.pow(w, 0.7);
  return {
    ...p,
    dead: false,
    master: p.master * (1 - 0.5 * w),
    lpOpen: towards(p.lpOpen, 220, k),
    lpSealed: Math.min(p.lpSealed, towards(p.lpSealed, 150, k)),
    othersLevel: p.othersLevel * (1 - 0.6 * w),
    noiseMax: p.noiseMax * (1 - 0.7 * w),
  };
}
