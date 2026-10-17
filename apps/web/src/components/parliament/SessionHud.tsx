"use client";
/**
 * SessionHud — what the player view says (V2), in a retro terminal face, greys only:
 *   - before the life: the title screen, the notices, a consent with only yes, the headset, the choice (intake.ts)
 *   - the ROLE SLOT: spins like a slot reel and stops on the role drawn — the choice made before is not looked at
 *   - the verdict: requested / assigned
 *   - while live: the dry record (lib/parliament/witness.ts) — facts only, never what they amount to; for a worker,
 *     a banner now and then saying how to stop living, the dark that comes up while X is held, and the line when it fails
 *   - at the end: the cause of death (intake.ts, from the record) and the totals
 * The words are lib/parliament/script.ts (ko / en); the machine log stays English. VT323 has no Hangul, so the
 * Korean lines use the pixel face `.hud-ko` (globals.css). Mount it with key = sessionNo: a new visitor, a new record.
 */

import { VT323 } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import {
  CAUSE_NAME,
  HOLD_SEC,
  NOTICE_LINE_SEC,
  ROLE_NAME,
  ROLE_TAG,
  SCRIPT,
  SESSION_ROLES,
  WitnessLog,
  causeOfDeath,
  fmtClock,
  linesShown,
  pageDone,
  reelAt,
  titleFor,
  type Lang,
  type Observation,
  type RoleId,
  type SessionPhase,
  type Surface,
} from "@/lib/parliament";
import type { LifeSession } from "./useLifeSession";

const mono = VT323({ weight: "400", subsets: ["latin"], display: "swap" });

const POLL_MS = 250;

/** How dark the screen is in each phase (0 = the world, 1 = black). */
const DARK: Record<SessionPhase, number> = { idle: 0.94, notice: 0.94, consent: 0.94, headset: 0.94, choose: 0.94, draw: 0.94, verdict: 0.94, live: 0, ended: 1 };

/** The phases whose text comes on line by line or whose reel runs: the HUD follows the frame clock then. */
const ANIMATED: readonly SessionPhase[] = ["notice", "headset", "draw", "verdict"];

interface WitnessView {
  lines: string[];
  status: string;
  near: string[];
  /** Totals so far (the end screen shows the last ones). */
  t: number;
  stillSec: number;
  nearSec: number;
  met: number;
  metByRole: Partial<Record<RoleId, number>>;
  surface: Surface;
  attempts: number;
}

const EMPTY: WitnessView = { lines: [], status: "", near: [], t: 0, stillSec: 0, nearSec: 0, met: 0, metByRole: {}, surface: "open", attempts: 0 };

/** A block in the middle of the screen. */
function Centre({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className={`w-full max-w-[30rem] ${className}`}>{children}</div>
    </div>
  );
}

/** Lines that come on one after another, `lineSec` apart (hard cuts); the ones not yet up keep their room. */
function Lines({ lines, since, lineSec = NOTICE_LINE_SEC, className = "" }: { lines: string[]; since: number; lineSec?: number; className?: string }) {
  const n = linesShown(lines.length, since, lineSec);
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={className} style={{ visibility: i < n ? "visible" : "hidden" }}>
          {l}
        </div>
      ))}
    </>
  );
}

export function SessionHud({
  session,
  witnessRef,
  locked,
  lifeSec,
  lang = "ko",
  helpLine = false,
  holdSec = HOLD_SEC,
  noticeLineSec = NOTICE_LINE_SEC,
  coarse = false,
}: {
  session: LifeSession;
  witnessRef: React.MutableRefObject<Observation | null>;
  /** Pointer lock (desktop): a "click the screen" banner while live and unlocked (the controls are dead until then). */
  locked: boolean;
  /** The lifespan (s): what the end screen says the visitor was present for. */
  lifeSec: number;
  /** The language the apparatus speaks (the machine log stays English). */
  lang?: Lang;
  /** After a suicide, one line of where to get help (the artist's call). */
  helpLine?: boolean;
  /** How long X is held to stop living (what the banner says). */
  holdSec?: number;
  /** Seconds between one notice line coming on and the next. */
  noticeLineSec?: number;
  /** A phone-like device: the lines say tap / tilt / hold instead of keys, click and mouse; no pointer lock. */
  coarse?: boolean;
}) {
  const { phase, role, reel, drawAt, wanted, page, phaseAt, cursor, verdict, attempt, stopOn, stopHint, attemptFailed, attempts } = session;
  const S = SCRIPT[lang];
  const names = ROLE_NAME[lang];
  const say = lang === "ko" ? "hud-ko" : "";
  const [log] = useState(() => new WitnessLog());
  const lastObs = useRef<Observation | null>(null);
  const [rec, setRec] = useState<WitnessView>(EMPTY);
  const [now, setNow] = useState(0);
  // one draw per session: which of two equally fitting causes the end screen names
  const [u] = useState(() => Math.random());

  // the lines and the reel run on the frame clock
  useEffect(() => {
    if (!ANIMATED.includes(phase)) return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // the record, read from RoleField's latest reading
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      const obs = witnessRef.current;
      if (!obs || obs === lastObs.current) return;
      lastObs.current = obs;
      log.push(obs);
      setRec({ lines: [...log.lines], status: log.status(), near: log.nearNow(), t: obs.t, ...log.summary() });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, witnessRef, log]);

  // a failed attempt to stop living goes into the record as two flat lines
  const seenAttempts = useRef(0);
  useEffect(() => {
    if (attempts <= seenAttempts.current) return;
    seenAttempts.current = attempts;
    log.attempt(session.lifeRef.current.t, session.lastAttemptNear);
    setRec((r) => ({ ...r, lines: [...log.lines], ...log.summary() }));
  }, [attempts, log, session.lifeRef, session.lastAttemptNear]);

  const since = Math.max(0, (now - phaseAt) / 1000);

  const slot = (() => {
    if (!role) return { text: "", lit: true, fixed: false };
    if (phase === "draw" && reel) {
      const r = reelAt(reel, Math.max(0, (now - drawAt) / 1000));
      return { text: r.label, lit: r.lit, fixed: r.settled };
    }
    return { text: ROLE_TAG[role], lit: true, fixed: true };
  })();

  const endedBy = session.endedBy ?? "lifespan";
  const cause =
    phase === "ended" && role
      ? causeOfDeath(role, { lifeSec, stillSec: rec.stillSec, nearSec: rec.nearSec, met: rec.met, metByRole: rec.metByRole, surface: rec.surface, endedBy }, u)
      : null;
  const title = titleFor(lang);

  return (
    <div className={`${mono.className} pointer-events-none absolute inset-0 select-none text-white`}>
      {/* the dark: almost black before the life (only the words and the slot show), black after the end; while X is
          held (X) to stop living it comes up with the hold. Hard cuts (digital) — the only fade is the dying one, into the end. */}
      <div
        className="absolute inset-0 bg-black transition-opacity"
        style={{ opacity: phase === "live" ? attempt * 0.9 : DARK[phase], transitionDuration: phase === "ended" ? "2000ms" : "0ms" }}
      />
      {/* hints blink on / off (steps, no fade) */}
      <style>{`@keyframes hud-blink { 50% { opacity: 0; } } .hud-blink { animation: hud-blink 1.1s steps(1, end) infinite; }`}</style>

      {/* the title screen */}
      {phase === "idle" && (
        <Centre className="text-center">
          <div className={`${say} text-[44px] leading-none tracking-[0.1em] text-white/85`}>{title.main}</div>
          {title.sub && <div className="mt-2 text-[16px] tracking-[0.3em] text-white/40">{title.sub}</div>}
          <div className={`${say} hud-blink mt-12 text-[18px] tracking-[0.2em] text-white/45`}>{coarse ? S.idle.pressTouch : S.idle.press}</div>
          <div className={`${say} mt-3 text-[14px] tracking-[0.05em] text-white/30`}>{S.idle.duration(Math.max(1, Math.round(lifeSec / 60)))}</div>
        </Centre>
      )}

      {/* the notice: a few pages, their lines coming on one after another */}
      {phase === "notice" && (
        <Centre className={`${say} text-[20px] leading-[1.6] tracking-[0.02em] text-white/80`}>
          <Lines lines={S.notice[page] ?? []} since={since} lineSec={noticeLineSec} />
          <div className="mt-6 h-4 text-[12px] text-white/35">
            {pageDone((S.notice[page] ?? []).length, since, noticeLineSec) && <span className="hud-blink">▪</span>}
          </div>
        </Centre>
      )}

      {/* the consent: whatever is pressed, it is yes */}
      {phase === "consent" && (
        <Centre className={`${say} text-center`}>
          <div className="text-[22px] leading-[1.5] text-white/85">{S.consent.question}</div>
          <div className="mt-8 flex items-start justify-center gap-8 text-[20px]">
            <div className="border border-white/50 px-6 py-2 text-white/90">{S.consent.yes}</div>
            <div>
              <div className="border border-white/15 px-6 py-2 text-white/20">{S.consent.no}</div>
              <div className="mt-1 text-[12px] text-white/20">{S.consent.noNote}</div>
            </div>
          </div>
        </Centre>
      )}

      {/* the headset */}
      {phase === "headset" && (
        <Centre className={`${say} text-center text-[20px] leading-[1.6] text-white/80`}>
          <Lines lines={coarse ? S.headsetTouch : S.headset} since={since} lineSec={noticeLineSec} />
        </Centre>
      )}

      {/* the choice: four roles; the slot will not look at it */}
      {phase === "choose" && (
        <Centre className={`${say} text-center`}>
          <div className="text-[22px] text-white/85">{S.choose.question}</div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SESSION_ROLES.map((r, i) => (
              <button
                key={r}
                type="button"
                onClick={() => session.choose(r)}
                className={`pointer-events-auto cursor-pointer border bg-black/40 px-2 py-3 text-white/85 outline-none ${cursor === i ? "border-white/80" : "border-white/30"}`}
              >
                <div className="text-[12px] text-white/40">[{i + 1}]</div>
                <div className="mt-1 text-[22px] leading-none">{names[r]}</div>
                <div className={`${mono.className} mt-2 text-[11px] tracking-[0.25em] text-white/35`}>{ROLE_TAG[r]}</div>
              </button>
            ))}
          </div>
        </Centre>
      )}

      {/* the verdict: requested / assigned */}
      {phase === "verdict" && role && (
        <Centre className={`${say} text-[20px] leading-[1.6] text-white/80`}>
          <div className="grid grid-cols-[auto_1fr] gap-x-6">
            <div className="text-white/45">{S.verdict.requested}</div>
            <div>{wanted ? names[wanted] : "—"}</div>
            <div className="text-white/45">{S.verdict.assigned}</div>
            <div>{names[role]}</div>
          </div>
          <div className="mt-4 text-[18px] text-white/70">
            <Lines lines={verdict === "lucky" ? [S.verdict.lucky] : [S.verdict.received, S.verdict.cannotHelp]} since={Math.max(0, since - 0.6)} />
          </div>
          <div className="mt-5 border-t border-white/15 pt-3 text-[14px] tracking-[0.15em] text-white/35">{coarse ? S.verdict.controlsTouch : S.verdict.controls}</div>
        </Centre>
      )}

      {/* live, before the pointer is locked */}
      {phase === "live" && !coarse && !locked && !attemptFailed && (
        <Centre className={`${say} flex justify-center text-center`}>
          <div className="border border-white/40 bg-black/70 px-6 py-3 text-[20px] text-white/90">{S.live.look}</div>
        </Centre>
      )}
      {/* a phone: how to walk, once more for the first seconds of the life */}
      {phase === "live" && coarse && rec.t < 10 && !attemptFailed && (
        <div className="absolute inset-x-0 bottom-28 flex justify-center px-6">
          <div className={`${say} text-[14px] tracking-[0.05em] text-white/40`}>{S.verdict.controlsTouch}</div>
        </div>
      )}
      {/* stopping living (worker): on a desktop a banner at the top, now and then (the key works regardless); on a phone
          a button, up the whole time it is on offer — held for holdSec it is the attempt (the dark follows the hold) */}
      {phase === "live" && !coarse && stopHint && (
        <div className="absolute inset-x-0 top-8 flex justify-center px-6">
          <div className={`${say} border border-white/30 bg-black/50 px-4 py-1.5 text-[17px] tracking-[0.04em] text-white/85`}>{S.live.stop(holdSec)}</div>
        </div>
      )}
      {phase === "live" && coarse && stopOn && (
        <div className="absolute inset-x-0 top-8 flex justify-center px-6">
          <button
            type="button"
            onTouchStart={session.beginHold}
            onTouchEnd={session.endHold}
            onTouchCancel={session.endHold}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={session.beginHold}
            onMouseUp={session.endHold}
            onMouseLeave={session.endHold}
            className={`${say} pointer-events-auto select-none border bg-black/60 px-5 py-2 text-[17px] tracking-[0.04em] text-white/85 outline-none ${attempt > 0 ? "border-white/90" : "border-white/40"}`}
            style={{ touchAction: "none", WebkitTapHighlightColor: "transparent", WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
          >
            {S.live.stopTouch(holdSec)}
          </button>
        </div>
      )}
      {/* the line when an attempt fails */}
      {phase === "live" && attemptFailed && (
        <Centre className={`${say} flex justify-center text-center`}>
          <div className="border border-white/40 bg-black/70 px-6 py-4 text-[20px] leading-[1.6] text-white/90">{S.attempt.failed}</div>
        </Centre>
      )}

      {/* the record + the role slot (from the draw on) */}
      {(phase === "draw" || phase === "verdict" || phase === "live") && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
          <div className="w-full max-w-[30rem]">
            {phase === "live" && (
              <div className="mb-3 text-[15px] leading-[1.15] tracking-[0.04em]">
                {rec.lines.map((l, i) => (
                  <div key={`${i}:${l}`} className="truncate" style={{ opacity: 0.18 + (0.4 * (i + 1)) / Math.max(1, rec.lines.length) }}>
                    {l}
                  </div>
                ))}
                {rec.near.length > 0 && (
                  <div className="mt-2 text-white/55">
                    {rec.near.slice(0, 4).map((n) => (
                      <div key={n} className="truncate">
                        · {n}
                      </div>
                    ))}
                  </div>
                )}
                {rec.status && <div className="mt-2 truncate text-white/80">{rec.status}</div>}
              </div>
            )}
            <div className="text-center text-[12px] tracking-[0.4em] text-white/30">
              {phase === "draw" ? <span className={say}>{S.draw.assigning}</span> : "ROLE"}
            </div>
            <div className="mt-1 flex h-[52px] items-center justify-center border border-white/25 bg-black/40">
              <span
                className="text-[40px] leading-none tracking-[0.12em]"
                style={{ opacity: slot.text ? (slot.lit ? (slot.fixed ? 0.92 : 0.7) : 0.08) : 0 }}
              >
                {slot.text || " "}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the end */}
      {phase === "ended" && role && cause && (
        <Centre className={`${say} text-[18px] leading-tight tracking-[0.03em] text-white/75`}>
          <div className="text-[26px] text-white/90">{S.ended.title}</div>
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <div className="text-white/45">{S.ended.cause}</div>
            <div className="text-[22px] leading-none text-white/90">{CAUSE_NAME[lang][cause]}</div>
            <div className="mt-3 text-white/45">{S.ended.role}</div>
            <div className="mt-3">
              {names[role]}
              {wanted && <span className="text-white/45">{`  (${S.ended.requested}: ${names[wanted]})`}</span>}
            </div>
            <div className="text-white/45">{S.ended.present}</div>
            <div>{fmtClock(endedBy === "self" ? rec.t : lifeSec)}</div>
            <div className="text-white/45">{S.ended.still}</div>
            <div>{fmtClock(rec.stillSec)}</div>
            <div className="text-white/45">{S.ended.near}</div>
            <div>
              {fmtClock(rec.nearSec)} · {rec.met} {S.ended.metUnit}
            </div>
            {rec.attempts > 0 && (
              <>
                <div className="text-white/45">{S.ended.stop}</div>
                <div>{S.ended.tried(rec.attempts)}</div>
              </>
            )}
          </div>
          <div className="pt-5 text-white/35">{S.ended.kept}</div>
          <div className="text-white/35">{S.ended.read}</div>
          {helpLine && cause === "suicide" && <div className="pt-3 text-white/35">{S.ended.help}</div>}
          {session.restartReady && <div className="hud-blink pt-8 text-[16px] tracking-[0.2em] text-white/45">{coarse ? S.ended.nextTouch : S.ended.next}</div>}
        </Centre>
      )}
    </div>
  );
}
