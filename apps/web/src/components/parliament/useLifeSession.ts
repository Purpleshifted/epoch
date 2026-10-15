"use client";
/**
 * useLifeSession — one visitor's session in the player view (V2; lib/parliament/session.ts has the rules):
 *   IDLE  → (first touch / click / key)  DRAW: the role slot spins and stops on a role drawn at random
 *   DRAW  → LIVE: the lifespan runs (wall clock: it is the visitor's real time, not the world clock)
 *   LIVE  → ENDED: the visitor is taken off the ground; the end screen stays
 *   ENDED → (SPACE, once endHoldSec have passed) DRAW of the next session: `sessionNo` goes up, so the player parts
 *           remount as a NEW visitor (new id, new time slot) and a new role is drawn
 *
 * The machine is a small store outside React (SessionMachine); the per-frame values (phase, seconds into the
 * session, warning level) are in `lifeRef`, read by the controller, the cursor and RoleField without re-rendering.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  assignRole,
  lifeAt,
  planReel,
  reelDuration,
  type LifeConfig,
  type ReelPlan,
  type RoleId,
  type SessionPhase,
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
  /** The role of this session (null in IDLE). */
  role: RoleId | null;
  /** The reel of this session's draw (null in IDLE). */
  reel: ReelPlan | null;
  /** Wall ms when the draw started. */
  drawAt: number;
  /** Goes up by one for every new visitor. */
  sessionNo: number;
  /** ENDED, and endHoldSec have passed: SPACE starts the next session. */
  restartReady: boolean;
}

export interface LifeSession extends SessionView {
  lifeRef: { readonly current: LifeSignal };
}

const TICK_MS = 100;

/** A gesture on the Leva panel (tuning) does not start a session. */
function onPanel(e: Event): boolean {
  const el = e.target as Element | null;
  return !!el?.closest?.("[class*='leva-']");
}

class SessionMachine {
  view: SessionView = { phase: "live", role: null, reel: null, drawAt: 0, sessionNo: 0, restartReady: false };
  readonly lifeRef: { current: LifeSignal } = { current: { phase: "live", t: 0, warn: 0 } };
  cfg: LifeConfig;
  fixedRole: RoleId | null = null;
  private enabled = false;
  /** Lifespan seconds lived so far (advanced by the clock × rate) and the wall ms of the last tick. */
  private lived = 0;
  private lastTick = 0;
  private endAt = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: LifeConfig) {
    this.cfg = cfg;
  }

  configure(cfg: LifeConfig, fixedRole: RoleId | null) {
    this.cfg = cfg;
    this.fixedRole = fixedRole;
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

  /** Switched on: wait for the next visitor. Off (V1, Leva): always live, no lifespan. */
  setEnabled(on: boolean) {
    if (on === this.enabled && this.view.sessionNo > 0) return;
    this.enabled = on;
    this.lifeRef.current = { phase: on ? "idle" : "live", t: 0, warn: 0 };
    this.set({ phase: on ? "idle" : "live", role: null, reel: null, drawAt: 0, sessionNo: this.view.sessionNo + 1, restartReady: false });
  }

  /** IDLE → DRAW (any gesture); ENDED → DRAW of the next session (SPACE, once the end screen has held). */
  begin = (e: Event) => {
    if (!this.enabled || onPanel(e)) return;
    const v = this.view;
    const next = v.phase === "ended" && v.restartReady && e.type === "keydown" && (e as KeyboardEvent).code === "Space";
    if (v.phase !== "idle" && !next) return;
    const role = this.fixedRole ?? assignRole(Math.random());
    this.lifeRef.current = { phase: "draw", t: 0, warn: 0 };
    this.set({
      phase: "draw",
      role,
      reel: planReel(role),
      drawAt: Date.now(),
      restartReady: false,
      sessionNo: next ? v.sessionNo + 1 : v.sessionNo,
    });
  };

  /** The clock: DRAW → LIVE → ENDED (→ ready for SPACE). */
  tick = () => {
    if (!this.enabled) return;
    const now = Date.now();
    const v = this.view;
    if (v.phase === "draw" && v.reel && now - v.drawAt >= reelDuration(v.reel) * 1000) {
      this.lived = 0;
      this.lastTick = now;
      this.lifeRef.current = { phase: "live", t: 0, warn: 0 };
      this.set({ phase: "live" });
    } else if (v.phase === "live") {
      // the lifespan clock: wall time × rate (rate > 1 only for testing the end)
      this.lived += (Math.max(0, now - this.lastTick) / 1000) * Math.max(0, this.cfg.rate ?? 1);
      this.lastTick = now;
      const t = this.lived;
      const st = lifeAt(t, this.cfg);
      this.lifeRef.current = { phase: "live", t, warn: st.warn };
      if (st.over) {
        this.endAt = now;
        if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
        this.lifeRef.current = { phase: "ended", t, warn: 1 };
        this.set({ phase: "ended" });
      }
    } else if (v.phase === "ended" && !v.restartReady && now - this.endAt >= Math.max(0, this.cfg.endHoldSec) * 1000) {
      this.set({ restartReady: true });
    }
  };

  start() {
    if (this.timer) return;
    this.timer = setInterval(this.tick, TICK_MS);
    window.addEventListener("pointerdown", this.begin);
    window.addEventListener("keydown", this.begin);
    window.addEventListener("touchend", this.begin);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pointerdown", this.begin);
    window.removeEventListener("keydown", this.begin);
    window.removeEventListener("touchend", this.begin);
  }
}

/**
 * @param enabled  false (V1, or switched off in Leva): always LIVE with `fixedRole` (or worker), no lifespan
 * @param fixedRole  a role to give every session instead of drawing one (null = random)
 */
export function useLifeSession(enabled: boolean, cfg: LifeConfig, fixedRole: RoleId | null): LifeSession {
  const [m] = useState(() => new SessionMachine(cfg));
  useEffect(() => {
    m.configure(cfg, fixedRole);
  }, [m, cfg, fixedRole]);
  useEffect(() => {
    m.setEnabled(enabled);
  }, [m, enabled]);
  useEffect(() => {
    m.start();
    return () => m.stop();
  }, [m]);
  const view = useSyncExternalStore(m.subscribe, m.get, m.get);
  return { ...view, role: enabled ? view.role : fixedRole ?? "worker", lifeRef: m.lifeRef };
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
