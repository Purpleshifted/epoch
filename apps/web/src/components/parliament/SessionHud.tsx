"use client";
/**
 * SessionHud — what the player view says (V2), in a retro terminal face, greys only:
 *   - before the life: the title screen, the notice, a consent with only yes, the headset, the name (intake.ts); the
 *     life begins by itself after the name (2026-10-20: no choice of role, no slot, no verdict — always the worker)
 *   - while live: how to walk, faintly, for the first seconds; the record (lib/parliament/witness.ts) on a solid black
 *     block, in plain words in the chosen language: the visitor's own melody written down (Glyph), who comes and goes,
 *     what the life does to the ground (lib/parliament/ledger.ts), the important lines reversed, black on white;
 *     a banner now and then saying how to stop living, the dark that comes up while X is held, and the line when it fails
 *   - at the end: the being's record card in the voice of a specimen (script.ts ended, from the record and ledger.ts
 *     ledgerSummary), the cause of death (intake.ts) and, behind a knob, the footprint map (FootprintMap)
 * The words are lib/parliament/script.ts (ko / en), the record's too (LOG · formatEntry). VT323 has no Hangul, so the
 * Korean lines use the pixel face `.hud-ko` (globals.css). Mount it with key = sessionNo: a new visitor, a new record.
 */

import { VT323 } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAUSE_NAME,
  HOLD_SEC,
  LedgerWatch,
  NOTICE_LINE_SEC,
  SCRIPT,
  WitnessLog,
  causeOfDeath,
  fmtClock,
  formatEntry,
  formatStatus,
  glyphOf,
  individualNo,
  ledgerSummary,
  linesShown,
  pageDone,
  titleFor,
  type GlyphDot,
  type Lang,
  type Ledger,
  type LogEntry,
  type NearItemArgs,
  type Observation,
  type RoleId,
  type SessionPhase,
  type StatusArgs,
  type Surface,
} from "@/lib/parliament";
import { FootprintMap } from "./FootprintMap";
import { Glyph } from "./Glyph";
import type { LifeSession } from "./useLifeSession";

const mono = VT323({ weight: "400", subsets: ["latin"], display: "swap" });

const POLL_MS = 250;
/** How far into the dying (session.ts warn) someone near is said to keep watch. */
const WATCH_FROM_WARN = 0.5;
/** How long (s) the line saying how to walk stays up at the start of a life. */
const CONTROLS_SEC = 10;

/** How dark the screen is in each phase (0 = the world, 1 = black). */
const DARK: Record<SessionPhase, number> = { idle: 0.94, notice: 0.94, consent: 0.94, headset: 0.94, name: 0.94, live: 0, ended: 1 };

/** The phases whose text comes on line by line: the HUD follows the frame clock then. */
const ANIMATED: readonly SessionPhase[] = ["notice", "headset"];

interface WitnessView {
  /** The visitor's own id (empty before the first reading). */
  me: string;
  entries: LogEntry[];
  status: StatusArgs | null;
  near: NearItemArgs[];
  /** The ledger's last reading (null before the first). */
  ledger: Ledger | null;
  /** Totals so far (the end screen shows the last ones). */
  t: number;
  stillSec: number;
  nearSec: number;
  met: number;
  metByRole: Partial<Record<RoleId, number>>;
  surface: Surface;
  attempts: number;
  group: string[];
  newWords: GlyphDot[][];
  found: string[];
  ensembleSec: number;
  asked: number;
  /** Someone's question is open: the visitor can answer it. */
  asking: boolean;
  /** The line saying how to walk is up (the first seconds of the life; on a desktop counted from the pointer lock). */
  controls: boolean;
}

const EMPTY: WitnessView = { me: "", entries: [], status: null, near: [], ledger: null, t: 0, stillSec: 0, nearSec: 0, met: 0, metByRole: {}, surface: "open", attempts: 0, group: [], newWords: [], found: [], ensembleSec: 0, asked: 0, asking: false, controls: false };

/** How a record line reads by its level (witness.ts LogLevel): grey, white, reversed. */
const LEVEL_CLASS = ["text-[#8c8c8c]", "text-white", "bg-white text-black"];

/** A line of the record: the `{}`s in its words are where the melody is drawn. */
function RecordWords({ text, dots, className = "" }: { text: string; dots?: readonly GlyphDot[]; className?: string }) {
  const parts = text.split("{}");
  return (
    <span className={`flex min-w-0 items-center gap-[2px] ${className}`}>
      {parts.map((part, i) => (
        <span key={i} className="contents">
          {part && <span className="whitespace-pre">{part}</span>}
          {i < parts.length - 1 && dots && <Glyph dots={dots} cell={3} />}
        </span>
      ))}
    </span>
  );
}

/** One row of the record card: its label and what it reads. */
function CardRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-x-3 border-t border-white px-3 py-1.5">
      <div className="text-[#8c8c8c]">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-white">{children}</div>
    </div>
  );
}

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
  ledgerRef,
  locked,
  lifeSec,
  lang = "ko",
  helpLine = false,
  holdSec = HOLD_SEC,
  noticeLineSec = NOTICE_LINE_SEC,
  coarse = false,
  footprint = true,
}: {
  session: LifeSession;
  witnessRef: React.MutableRefObject<Observation | null>;
  /** The ledger of this life (RoleField writes it while live; the end screen reads its last reading). */
  ledgerRef: React.MutableRefObject<Ledger | null>;
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
  /** The end screen's footprint map (Leva 개인뷰 비주얼). */
  footprint?: boolean;
}) {
  const { phase, page, phaseAt, attempt, stopOn, stopHint, attemptFailed, attempts } = session;
  const S = SCRIPT[lang];
  const say = lang === "ko" ? "hud-ko" : "";
  const [log] = useState(() => new WitnessLog());
  const [watch] = useState(() => new LedgerWatch());
  const lastObs = useRef<Observation | null>(null);
  /** Wall ms the pointer was locked (0 = not locked): the hands reach the keys only then. */
  const lockedAt = useRef(0);
  const [rec, setRec] = useState<WitnessView>(EMPTY);
  const [now, setNow] = useState(0);
  // one draw per session: which of two equally fitting causes the end screen names
  const [u] = useState(() => Math.random());

  // the lines come on with the frame clock
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

  // the record, read from RoleField's latest reading (and whether the line saying how to walk is still up)
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      if (!locked) lockedAt.current = 0;
      else if (lockedAt.current === 0) lockedAt.current = Date.now();
      const obs = witnessRef.current;
      if (!obs || obs === lastObs.current) return;
      lastObs.current = obs;
      log.push(obs);
      // the ledger's lines go into the same record
      const L = ledgerRef.current;
      if (L) for (const e of watch.feed(L, obs.surface, log.roleOf)) log.note(e);
      const warn = session.lifeRef.current.warn;
      if (warn > 0) log.dying(obs.t);
      if (warn >= WATCH_FROM_WARN) log.keptWatch(obs.t);
      const controls = coarse ? obs.t < CONTROLS_SEC : locked && Date.now() - lockedAt.current < CONTROLS_SEC * 1000;
      setRec({ me: obs.me, entries: [...log.entries], status: log.status(), near: log.nearNow(), ledger: L, t: obs.t, ...log.summary(), asking: log.asking(), controls });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, witnessRef, ledgerRef, log, watch, locked, coarse, session.lifeRef]);

  // someone asked: SPACE answers
  const answer = useCallback(() => {
    const me = witnessRef.current?.me;
    if (!me || !log.answer(session.lifeRef.current.t, me)) return;
    setRec((r) => ({ ...r, entries: [...log.entries], ...log.summary(), asking: false }));
  }, [log, session.lifeRef, witnessRef]);
  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) answer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, answer]);

  // a failed attempt to stop living goes into the record as two flat lines
  const seenAttempts = useRef(0);
  useEffect(() => {
    if (attempts <= seenAttempts.current) return;
    seenAttempts.current = attempts;
    log.attempt(session.lifeRef.current.t, session.lastAttemptNear);
    setRec((r) => ({ ...r, entries: [...log.entries], ...log.summary() }));
  }, [attempts, log, session.lifeRef, session.lastAttemptNear]);

  const since = Math.max(0, (now - phaseAt) / 1000);


  const endedBy = session.endedBy ?? "lifespan";
  const cause =
    phase === "ended"
      ? causeOfDeath("worker", { lifeSec, stillSec: rec.stillSec, nearSec: rec.nearSec, met: rec.met, metByRole: rec.metByRole, surface: rec.surface, endedBy }, u)
      : null;
  const title = titleFor(lang);
  const sum = phase === "ended" && rec.ledger ? ledgerSummary(rec.ledger) : null;

  return (
    <div className={`${mono.className} pointer-events-none absolute inset-0 select-none text-white`}>
      {/* the dark: almost black before the life (only the words show), black after the end; while X is
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

      {/* the name: the melody the visitor is given, written down, its notes coming on as it sounds (RoleField → engine) */}
      {phase === "name" && witnessRef.current && (
        <Centre className={`${say} flex items-center justify-center gap-3 text-[26px] text-white`}>
          {S.live.mine} (<Glyph dots={glyphOf(witnessRef.current.me)} cell={8} playFrom={phaseAt + 100} />)
        </Centre>
      )}

      {/* live, before the pointer is locked */}
      {phase === "live" && !coarse && !locked && !attemptFailed && (
        <Centre className={`${say} flex justify-center text-center`}>
          <div className="border border-white/40 bg-black/70 px-6 py-3 text-[20px] text-white/90">{S.live.look}</div>
        </Centre>
      )}
      {/* how to walk, faintly, for the first seconds of the life (the life begins right after the headset) */}
      {phase === "live" && rec.controls && !attemptFailed && (
        <div className="absolute inset-x-0 bottom-28 flex justify-center px-6">
          <div className={`${say} text-[14px] tracking-[0.05em] text-white/40`}>{coarse ? S.live.controlsTouch : S.live.controls}</div>
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

      {/* the record: on a solid block, so it reads over the field. The T+ prefix in the machine face, the words in the
          apparatus's language; the level says how much a line matters (LEVEL_CLASS); a line about someone's melody
          writes it down beside the words */}
      {phase === "live" && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
          <div className="w-full max-w-[36rem] border border-white bg-black text-[15px] leading-[1.25] tracking-[0.04em]">
            {rec.me && (
              <div className="flex items-center gap-3 border-b border-white px-3 py-2 text-white">
                <div className={`${say} shrink-0`}>{S.live.mine}</div>
                <span className="flex shrink-0 items-center gap-[2px]">
                  (<Glyph dots={rec.newWords[rec.newWords.length - 1] ?? glyphOf(rec.me)} cell={4} live />)
                </span>
                {rec.status && <div className={`${say} ml-auto truncate text-[#8c8c8c]`}>{formatStatus(rec.status, lang)}</div>}
              </div>
            )}
            <div className="min-h-[6.5rem] px-3 py-2">
              {rec.entries.map((e, i) => {
                const { prefix, text } = formatEntry(e, lang);
                return (
                  <div key={`${i}:${e.t}:${e.key}`} className={`flex items-center gap-2 ${LEVEL_CLASS[e.level]}`}>
                    <span className="shrink-0 whitespace-pre">{prefix}</span>
                    <RecordWords text={text} dots={e.args.dots} className={say} />
                  </div>
                );
              })}
            </div>
            {(rec.near.length > 0 || rec.asking) && (
              <div className="flex items-center gap-2 border-t border-white px-3 py-1.5 text-white">
                {rec.near.slice(0, 8).map((n) => (
                  <Glyph key={n.who.o} dots={glyphOf(n.who.o)} cell={3} />
                ))}
                {rec.asking &&
                  (coarse ? (
                    <button type="button" onClick={answer} className={`${say} pointer-events-auto ml-auto border border-white px-3 py-0.5`}>
                      {S.live.answerTouch}
                    </button>
                  ) : (
                    <span className={`${say} hud-blink ml-auto`}>{S.live.answer}</span>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* the end: the being's record card, with the footprint (Leva 개인뷰 비주얼 › 퇴장 화면 발자국 지도) */}
      {phase === "ended" && cause && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-6">
          <div className={`${say} w-full max-w-[46rem] text-[17px] leading-[1.3] tracking-[0.03em]`}>
            <div className="mb-3 text-[24px] text-white">{S.ended.title}</div>
            <div className="flex flex-wrap items-stretch border border-white">
              <div className="min-w-[20rem] flex-1">
                <div className="flex items-baseline justify-between px-3 py-2">
                  <span className="text-[20px] text-white">{S.ended.who(individualNo(rec.me))}</span>
                  <span className="text-[#8c8c8c]">
                    {S.ended.life} {fmtClock(endedBy === "self" ? rec.t : lifeSec)}
                  </span>
                </div>
                <CardRow label={S.ended.own}>{rec.me && <Glyph dots={glyphOf(rec.me)} cell={5} />}</CardRow>
                <CardRow label={S.ended.group}>{S.ended.groupRow(rec.group.length, rec.ensembleSec)}</CardRow>
                <CardRow label={S.ended.word}>
                  <span>{S.ended.wordRow(rec.newWords.length, rec.asked)}</span>
                  {rec.newWords.length > 0 && <Glyph dots={rec.newWords[rec.newWords.length - 1]} cell={4} />}
                </CardRow>
                {rec.found.length > 0 && (
                  <CardRow label={S.ended.found}>
                    <span>{S.ended.foundRow(individualNo(rec.found[0]), rec.found.length - 1)}</span>
                    <Glyph dots={glyphOf(rec.found[0])} cell={4} />
                  </CardRow>
                )}
                <CardRow label={S.ended.built}>{S.ended.builtRow(sum?.slabs ?? 0, sum?.with.length ?? 0, (sum?.with ?? []).filter((o) => !rec.group.includes(o)).length)}</CardRow>
                <CardRow label={S.ended.moved}>{S.ended.movedRow(sum, rec.stillSec)}</CardRow>
                <CardRow label={S.ended.veg}>{S.ended.vegRow(sum)}</CardRow>
                {rec.attempts > 0 && <CardRow label={S.ended.stop}>{S.ended.tried(rec.attempts)}</CardRow>}
                <CardRow label={S.ended.cause}>
                  <span className="text-[20px]">{CAUSE_NAME[lang][cause]}</span>
                </CardRow>
              </div>
              {footprint && rec.ledger && (
                <div className="flex items-center justify-center border-l border-white p-3">
                  <FootprintMap ledger={rec.ledger} size={160} />
                </div>
              )}
            </div>
            <div className="pt-3 text-[#8c8c8c]">{S.ended.kept}</div>
            <div className="text-[#8c8c8c]">{S.ended.read}</div>
            {helpLine && cause === "suicide" && <div className="pt-3 text-[#8c8c8c]">{S.ended.help}</div>}
            {session.restartReady && <div className="hud-blink pt-4 text-[16px] tracking-[0.2em] text-white">{coarse ? S.ended.nextTouch : S.ended.next}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
