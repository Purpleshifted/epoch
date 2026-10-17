"use client";
/**
 * useLifeSession — one visitor's session in the player view (V2; lib/parliament/session.ts and intake.ts have the rules):
 *   IDLE     → (any gesture)  NOTICE: the frame, a few pages; a gesture turns a page once all its lines are up
 *   NOTICE   → CONSENT (a question with only yes) → HEADSET → CHOOSE (four roles: 1–4, arrows + Enter, or a click)
 *   CHOOSE   → DRAW: the role slot spins and stops on a role drawn at random — the choice is not looked at
 *   DRAW     → VERDICT: requested / assigned, for a few seconds
 *   VERDICT  → LIVE: the lifespan runs (wall clock: it is the visitor's real time, not the world clock)
 *   LIVE     → ENDED: the visitor is taken off the ground; the end screen (with the cause of death) stays
 *   ENDED    → (SPACE, once endHoldSec have passed) NOTICE of the next session, or (END_RETURN_SEC later) IDLE:
 *              `sessionNo` goes up, so the player parts remount as a NEW visitor (new id, new time slot)
 *   NOTICE … CHOOSE → (IDLE_AFTER_SEC without input) IDLE: the visitor left before living; nothing was recorded
 *
 * The machine is a small store outside React (SessionMachine); the per-frame values (phase, seconds into the
 * session, warning level) are in `lifeRef`, read by the controller, the cursor and RoleField without re-rendering.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  END_RETURN_SEC,
  GESTURE_GAP_MS,
  IDLE_AFTER_SEC,
  SCRIPT,
  SESSION_ROLES,
  VERDICT_SEC,
  assignRole,
  lifeAt,
  moveCursor,
  pageDone,
  planReel,
  reelDuration,
  roleForKey,
  verdictOf,
  type EndedBy,
  type Lang,
  type LifeConfig,
  type ReelPlan,
  type RoleId,
  type SessionPhase,
  type Verdict,
} from "@/lib/parliament";
import type { SoundParams } from "@/lib/sound";

export interface LifeSignal {
  phase: SessionPhase;
  /** Seconds since the role was fixed (LIVE / ENDED), 0 before. */
  t: number;
  /** 0 … 1 over the last warnSec of the lifespan. */
  warn: number;
}

export interface SessionView {
  phase: SessionPhase;
  /** The role of this session (null before the draw). */
  role: RoleId | null;
  /** The reel of this session's draw (null before the draw). */
  reel: ReelPlan | null;
  /** Wall ms when the draw started. */
  drawAt: number;
  /** Goes up by one for every new visitor. */
  sessionNo: number;
  /** ENDED, and endHoldSec have passed: SPACE starts the next session. */
  restartReady: boolean;
  /** The role the visitor asked for on the choice screen (null: not asked). The slot does not look at it. */
  wanted: RoleId | null;
  /** NOTICE: which page. */
  page: number;
  /** Wall ms the current phase (or notice page) began: its lines come on from then. */
  phaseAt: number;
  /** CHOOSE: the highlighted role (index into SESSION_ROLES; -1 = none). */
  cursor: number;
  /** VERDICT and after: whether the slot happened to agree with the choice. */
  verdict: Verdict | null;
  /** ENDED: how the life ended. */
  endedBy: EndedBy | null;
}

export interface LifeSession extends SessionView {
  lifeRef: { readonly current: LifeSignal };
  /** CHOOSE: pick a role (the buttons on the screen; the keys go through the machine itself). */
  choose: (role: RoleId) => void;
}

const TICK_MS = 100;

/** The phases before the life in which a visitor who walks away is forgotten (back to the title screen). */
const WAITING: readonly SessionPhase[] = ["notice", "consent", "headset", "choose"];

const FRESH: Omit<SessionView, "phase" | "sessionNo"> = {
  role: null,
  reel: null,
  drawAt: 0,
  restartReady: false,
  wanted: null,
  page: 0,
  phaseAt: 0,
  cursor: -1,
  verdict: null,
  endedBy: null,
};

/** A gesture on the Leva panel (tuning) does not count. */
function onPanel(e: Event): boolean {
  const el = e.target as Element | null;
  return !!el?.closest?.("[class*='leva-']");
}

class SessionMachine {
  view: SessionView = { ...FRESH, phase: "live", sessionNo: 0 };
  readonly lifeRef: { current: LifeSignal } = { current: { phase: "live", t: 0, warn: 0 } };
  cfg: LifeConfig;
  fixedRole: RoleId | null = null;
  lang: Lang = "ko";
  private enabled = false;
  /** Lifespan seconds lived so far (advanced by the clock × rate) and the wall ms of the last tick. */
  private lived = 0;
  private lastTick = 0;
  private endAt = 0;
  private lastGestureAt = 0;
  private lastInputAt = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: LifeConfig) {
    this.cfg = cfg;
  }

  configure(cfg: LifeConfig, fixedRole: RoleId | null, lang: Lang) {
    this.cfg = cfg;
    this.fixedRole = fixedRole;
    this.lang = lang;
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

  /** A new visitor: everything fresh, `sessionNo` up, starting at `phase`. */
  private next(phase: "idle" | "notice") {
    this.lifeRef.current = { phase, t: 0, warn: 0 };
    this.set({ ...FRESH, phase, phaseAt: Date.now(), sessionNo: this.view.sessionNo + 1 });
  }

  /** Switched on: wait for the next visitor. Off (V1, Leva): always live, no lifespan. */
  setEnabled(on: boolean) {
    if (on === this.enabled && this.view.sessionNo > 0) return;
    this.enabled = on;
    this.lifeRef.current = { phase: on ? "idle" : "live", t: 0, warn: 0 };
    this.set({ ...FRESH, phase: on ? "idle" : "live", phaseAt: Date.now(), sessionNo: this.view.sessionNo + 1 });
  }

  /** CHOOSE → DRAW: the choice is kept to be shown, the role is drawn regardless of it. */
  choose = (wanted: RoleId) => {
    if (!this.enabled || this.view.phase !== "choose") return;
    const role = this.fixedRole ?? assignRole(Math.random());
    this.lifeRef.current = { phase: "draw", t: 0, warn: 0 };
    this.enter("draw", { wanted, role, reel: planReel(role), drawAt: Date.now(), verdict: null });
  };

  /** Any gesture (pointer, touch, key): what it does depends on the phase. */
  gesture = (e: Event) => {
    if (!this.enabled || onPanel(e)) return;
    let code = "";
    if (e.type === "keydown") {
      const k = e as KeyboardEvent;
      if (k.repeat || (k.target as HTMLElement | null)?.tagName === "INPUT") return;
      code = k.code;
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
        if (!pageDone(lines, (now - v.phaseAt) / 1000)) return;
        if (v.page + 1 < pages.length) this.set({ page: v.page + 1, phaseAt: now });
        else this.enter("consent");
        return;
      }
      case "consent":
        // whatever is pressed, it is yes
        this.enter("headset");
        return;
      case "headset":
        this.enter("choose", { cursor: -1 });
        return;
      case "choose": {
        if (e.type !== "keydown") return; // clicks go to the buttons (choose)
        const r = roleForKey(code);
        if (r) return this.choose(r);
        if (code === "ArrowLeft" || code === "ArrowRight") {
          this.set({ cursor: moveCursor(v.cursor, code === "ArrowLeft" ? -1 : 1, SESSION_ROLES.length) });
          return;
        }
        if ((code === "Enter" || code === "Space") && v.cursor >= 0) this.choose(SESSION_ROLES[v.cursor]);
        return;
      }
      case "ended":
        if (v.restartReady && code === "Space") this.next("notice");
        return;
      default:
        return; // draw, verdict, live: the screen runs on its own (the controls are the Controller's)
    }
  };

  /** The clock: DRAW → VERDICT → LIVE → ENDED (→ ready for SPACE → back to the title); the waiting timeouts. */
  tick = () => {
    if (!this.enabled) return;
    const now = Date.now();
    const v = this.view;
    if (v.phase === "draw") {
      if (v.reel && v.role && now - v.drawAt >= reelDuration(v.reel) * 1000) this.enter("verdict", { verdict: verdictOf(v.wanted, v.role) });
    } else if (v.phase === "verdict") {
      if (now - v.phaseAt >= VERDICT_SEC * 1000) {
        this.lived = 0;
        this.lastTick = now;
        this.lifeRef.current = { phase: "live", t: 0, warn: 0 };
        this.enter("live");
      }
    } else if (v.phase === "live") {
      // the lifespan clock: wall time × rate (rate > 1 only for testing the end)
      this.lived += (Math.max(0, now - this.lastTick) / 1000) * Math.max(0, this.cfg.rate ?? 1);
      this.lastTick = now;
      const t = this.lived;
      const st = lifeAt(t, this.cfg);
      this.lifeRef.current = { phase: "live", t, warn: st.warn };
      if (st.over) this.end("lifespan", t);
    } else if (v.phase === "ended") {
      const held = now - this.endAt;
      if (!v.restartReady && held >= Math.max(0, this.cfg.endHoldSec) * 1000) this.set({ restartReady: true });
      else if (v.restartReady && held >= (Math.max(0, this.cfg.endHoldSec) + END_RETURN_SEC) * 1000) this.next("idle");
    } else if (WAITING.includes(v.phase)) {
      if (now - this.lastInputAt >= IDLE_AFTER_SEC * 1000) this.enter("idle", { wanted: null, page: 0, cursor: -1 });
    }
  };

  /** LIVE → ENDED. */
  private end(by: EndedBy, t: number) {
    this.endAt = Date.now();
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    this.lifeRef.current = { phase: "ended", t, warn: 1 };
    this.enter("ended", { endedBy: by });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(this.tick, TICK_MS);
    window.addEventListener("pointerdown", this.gesture);
    window.addEventListener("keydown", this.gesture);
    window.addEventListener("touchend", this.gesture);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pointerdown", this.gesture);
    window.removeEventListener("keydown", this.gesture);
    window.removeEventListener("touchend", this.gesture);
  }
}

/**
 * @param enabled  false (V1, or switched off in Leva): always LIVE with `fixedRole` (or worker), no lifespan
 * @param fixedRole  a role to give every session instead of drawing one (null = random)
 * @param lang  the language the apparatus speaks (how many lines each notice page has)
 */
export function useLifeSession(enabled: boolean, cfg: LifeConfig, fixedRole: RoleId | null, lang: Lang = "ko"): LifeSession {
  const [m] = useState(() => new SessionMachine(cfg));
  useEffect(() => {
    m.configure(cfg, fixedRole, lang);
  }, [m, cfg, fixedRole, lang]);
  useEffect(() => {
    m.setEnabled(enabled);
  }, [m, enabled]);
  useEffect(() => {
    m.start();
    return () => m.stop();
  }, [m]);
  const view = useSyncExternalStore(m.subscribe, m.get, m.get);
  return { ...view, role: enabled ? view.role : fixedRole ?? "worker", lifeRef: m.lifeRef, choose: m.choose };
}

/** Log-interpolate a frequency towards `to` by k (0 … 1). */
const towards = (f: number, to: number, k: number) => f * Math.pow(to / Math.max(1, f), k);

/**
 * The headset near the end: the low-pass closes (as if through a wall), the others fade first, then everything.
 * Silent whenever the session is not live: before the role is drawn, while it is drawn, and after the end.
 */
export function muffleSound(p: SoundParams, life: LifeSignal | undefined): SoundParams {
  if (!life) return p;
  if (life.phase !== "live") return { ...p, master: 0 };
  const w = life.warn;
  if (!(w > 0)) return p;
  const k = Math.pow(w, 0.7);
  return {
    ...p,
    master: p.master * (1 - 0.5 * w),
    lpOpen: towards(p.lpOpen, 220, k),
    lpSealed: Math.min(p.lpSealed, towards(p.lpSealed, 150, k)),
    othersLevel: p.othersLevel * (1 - 0.6 * w),
    noiseMax: p.noiseMax * (1 - 0.7 * w),
  };
}
