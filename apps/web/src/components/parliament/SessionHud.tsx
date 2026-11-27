"use client";
/**
 * SessionHud — what the player view says (V2), in a retro terminal face, greys only:
 *   - before the life: the title screen, the notice, a consent with only yes, the headset, the name (intake.ts); the
 *     life begins by itself after the name (2026-10-20: no choice of role, no slot, no verdict — always the worker)
 *   - while live: how to walk, faintly, for the first seconds; the record (lib/parliament/witness.ts) on a solid black
 *     block, in plain words in the chosen language: the visitor's own melody written down (Glyph), who comes and goes,
 *     what the life does to the ground (lib/parliament/ledger.ts), the important lines reversed, black on white;
 *     a banner now and then saying how to stop living, the dark that comes up while X is held, and the line when it fails
 *   - at the end: the being's record card in the voice of a specimen as it was (script.ts ended, from the record and
 *     ledger.ts ledgerSummary), the cause of death (intake.ts) and, behind a knob, the footprint map (FootprintMap); under
 *     it 출력하기 (the gallery machine, `venue=gallery`) or 저장하기 (a phone, a remote screen) and 게시하기. Either
 *     opens the specimen card (SpecimenCard, lib/parliament/plate.ts — 2026-11-21: minimal, the life's worldline, its
 *     melody, its number, the QR of its recording) where the visitor picks the paper (white / black) and the way it
 *     stands (portrait / landscape), then prints or saves it, and posts it. Posting or printing keeps the life (and its
 *     recording) in the archive (/api/lives); a life neither posted nor printed is not kept. KR / EN at the top of the
 *     end's screens turns their words, in the same pixel face
 * The words are lib/parliament/script.ts (ko / en), the record's too (LOG · formatEntry). VT323 has no Hangul, so the
 * Korean lines use the pixel face `.hud-ko` (globals.css). Mount it with key = sessionNo: a new visitor, a new record.
 */

import { VT323 } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAUSE_NAME,
  GLYPH_COLS,
  HOLD_SEC,
  LedgerWatch,
  NAME_GAP_SEC,
  NOTICE_LINE_SEC,
  SCRIPT,
  STEP_MS,
  DEFAULT_WITNESS,
  WitnessLog,
  causeOfDeath,
  fmtClock,
  formatEntry,
  formatStatus,
  glyphOf,
  birthGlyphOf,
  individualNo,
  ledgerSummary,
  plateCells,
  venueName,
  linesShown,
  pageDone,
  titleFor,
  type GlyphDot,
  type Lang,
  type Ledger,
  type LogEntry,
  type NearItemArgs,
  type Observation,
  type PlateInput,
  type PlateOrient,
  type PlateTheme,
  type RoleId,
  type SessionPhase,
  type StatusArgs,
  type Surface,
} from "@/lib/parliament";
import type { Visitor } from "./RoleField";
import { newLook } from "./mobileLab";
import { FootprintMap } from "./FootprintMap";
import { Glyph } from "./Glyph";
import { qrModules } from "@/lib/qr";
import { emitLifeEvent } from "./lifeEvents";
import { setLifeNote } from "./useLifeRecording";
import { SpecimenCard, printCard, saveCard, type CardAct } from "./SpecimenCard";
import type { CardVisual } from "./usePersonalVisuals";
import type { LifeSession } from "./useLifeSession";

const mono = VT323({ weight: "400", subsets: ["latin"], display: "swap" });

const POLL_MS = 250;
/** One round of the name's melody and its gap (a bar of 8 steps); the keys count this long after the name comes up. */
const NAME_LOOP_MS = STEP_MS * GLYPH_COLS + NAME_GAP_SEC * 1000;
const NAME_KEY_AFTER_MS = NAME_LOOP_MS;
/** How far into the dying (session.ts warn) someone near is said to keep watch. */
const WATCH_FROM_WARN = 0.5;
/** How long (s) the line saying how to walk stays up at the start of a life. */
const CONTROLS_SEC = 10;

/** How dark the screen is in each phase (0 = the world, 1 = black). */
const DARK: Record<SessionPhase, number> = { idle: 0.94, notice: 0.94, consent: 0.94, headset: 0.94, name: 0.94, live: 0, ended: 1 };

/** The phases whose text comes on line by line: the HUD follows the frame clock then. */
const ANIMATED: readonly SessionPhase[] = ["notice", "headset", "name"];

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

/** A choice on the card's step (paper, which way it stands): the picked one filled. */
const pick = (on: boolean) => `pointer-events-auto border px-3 py-1 outline-none ${on ? "border-white bg-white text-black" : "border-white/40 text-white/70"}`;

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

/** How long 갤러리 보기 waits for the recording to finish going up before it leaves anyway (ms). */
const GALLERY_WAIT_MS = 30_000;

/** The gallery from the end card: its language, the venue (the gallery machine's gallery comes back by itself) and the
 * way back to this experience, as it was opened. */
function galleryHref(lang: Lang, venue: string | null | undefined): string {
  const q = new URLSearchParams();
  if (lang === "en") q.set("lang", "en");
  if (venue) q.set("venue", venue);
  if (typeof window !== "undefined") q.set("back", window.location.pathname + window.location.search);
  return `/exhibition/gallery?${q.toString()}`;
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
  visitorRef,
  ledgerRef,
  locked,
  lifeSec,
  lang: langProp = "ko",
  helpLine = false,
  holdSec = HOLD_SEC,
  noticeLineSec = NOTICE_LINE_SEC,
  coarse = false,
  footprint = true,
  logPlace = "bottom",
  card = { theme: "paper", orient: "portrait" },
  venue = null,
  recordingUrl,
  cardUrl,
  uploadRecording,
  onAnswer,
  onFound,
}: {
  session: LifeSession;
  witnessRef: React.MutableRefObject<Observation | null>;
  /** Who this life's visitor is (RoleField): their name. After a life the last reading in witnessRef is still the last visitor's. */
  visitorRef: React.MutableRefObject<Visitor | null>;
  /** The ledger of this life (RoleField writes it while live; the end screen reads its last reading). */
  ledgerRef: React.MutableRefObject<Ledger | null>;
  /** Pointer lock (desktop): a "click the screen" banner while live and unlocked (the controls are dead until then). */
  locked: boolean;
  /** The lifespan (s): what the end screen says the visitor was present for. */
  lifeSec: number;
  /** The language the apparatus speaks (the machine log stays English). */
  lang?: Lang;
  /** 길거리 (2026-11-22 evening, the artist: "폰에서는 로그가 위쪽에 뜨는 게 맞는 것 같고 랩탑은 왼쪽에 패널처럼"): where the LIVE
   *  record stands — "bottom" as it was; "left", a column at the left edge, the newest line lowest and the old ones fading
   *  upwards, the middle of the view left empty; "top", a short strip under the top edge with the newest line first. */
  logPlace?: "bottom" | "left" | "top";
  /** After a suicide, one line of where to get help (the artist's call). */
  helpLine?: boolean;
  /** How long X is held to stop living (what the banner says). */
  holdSec?: number;
  /** Seconds between one notice line coming on and the next. */
  noticeLineSec?: number;
  /** A phone-like device: the lines say tap / tilt / hold instead of keys, click and mouse; no pointer lock. */
  coarse?: boolean;
  /** The record card's footprint map (Leva 개인뷰 비주얼; the record card of 11/01 only). */
  footprint?: boolean;
  /** The specimen card's first paper and the way it first stands (Leva 개인뷰 비주얼; the visitor turns both). */
  card?: CardVisual;
  /** The `venue` URL parameter, kept with the card; "gallery" is the exhibition's own machine (출력하기, not 저장하기). */
  venue?: string | null;
  /** The life's recording page (/rec/<id>: there from the end, before the recording has gone up — the page waits for it)
   * and the card's own page, when there are such: the card carries the QR of the one there is (the recording first);
   * without either its place stays empty. */
  recordingUrl?: string;
  cardUrl?: string;
  /** Sends the life's recording up (it goes by itself at the end; this joins that upload), giving its URL: for a post or
   * a print when the recording page was not known yet. */
  uploadRecording?: () => Promise<string | null>;
  /** The visitor answered someone (whom, and the new word's seed): it leaves a seed head carrying that word (RoleField). */
  onAnswer?: (to?: string, seed?: number) => void;
  /** A word another left was found (the record's `word.found`): whose it is — the headset plays their melody once. */
  onFound?: (o: string) => void;
}) {
  const { phase, page, phaseAt, attempt, stopOn, stopHint, attemptFailed, attempts } = session;
  // the end's screens have their own KR / EN (the visitor's pick), set in the Korean pixel face either way
  const [endLang, setEndLang] = useState<Lang | null>(null);
  const lang = phase === "ended" && endLang ? endLang : langProp;
  const S = SCRIPT[lang];
  const say = lang === "ko" || phase === "ended" ? "hud-ko" : "";
  // (the story's and the bond's lines only with the lab's new look: the exhibition's personal view keeps its record —
  // the rule of 2026-11-27, mobileLab.newLook)
  const [log] = useState(() => new WitnessLog(newLook() ? { ...DEFAULT_WITNESS, tales: true } : undefined));
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
      // a word another left, found: its melody sounds once (ParliamentScene → SoundEngine.found)
      for (const e of log.push(obs)) if (e.key === "word.found" && e.args.who) onFound?.(e.args.who.o);
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
  }, [phase, witnessRef, ledgerRef, log, watch, locked, coarse, session.lifeRef, onFound]);

  // 살아가기: into the world, taking the pointer on the way (a click or a key is what the browser wants for that); the
  // keys count only once the name has been up a moment, so a key pressed for the headset does not go straight through
  const enterWorld = useCallback(() => {
    session.beginLife();
    if (coarse) return;
    const c = document.querySelector("canvas");
    if (c && typeof c.requestPointerLock === "function") void Promise.resolve(c.requestPointerLock()).catch(() => {});
  }, [session, coarse]);
  useEffect(() => {
    if (phase !== "name") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Enter" || e.code === "Space") && !e.repeat && Date.now() - phaseAt > NAME_KEY_AFTER_MS) enterWorld();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, phaseAt, enterWorld]);

  // someone asked: SPACE answers
  const answer = useCallback(() => {
    const me = witnessRef.current?.me;
    const said = me ? log.answer(session.lifeRef.current.t, me) : null;
    if (!said) return;
    // whom to and the word's seed (the line's own time, as the sound's answer takes it — RoleField answerDue)
    onAnswer?.(said.args.who?.o, Math.floor(said.t));
    setRec((r) => ({ ...r, entries: [...log.entries], ...log.summary(), asking: false }));
  }, [log, session.lifeRef, witnessRef, onAnswer]);
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
  /** The life seconds of the failed attempts (the card marks them on the worldline). */
  const attemptsAt = useRef<number[]>([]);
  useEffect(() => {
    if (attempts <= seenAttempts.current) return;
    seenAttempts.current = attempts;
    attemptsAt.current.push(session.lifeRef.current.t);
    log.attempt(session.lifeRef.current.t, session.lastAttemptNear);
    setRec((r) => ({ ...r, entries: [...log.entries], ...log.summary() }));
  }, [attempts, log, session.lifeRef, session.lastAttemptNear]);

  // every new line of the record goes out once as an event (lifeEvents.ts): the life's recording keeps it as a marker
  const emitted = useRef(new WeakSet<LogEntry>());
  useEffect(() => {
    for (const e of rec.entries) {
      if (emitted.current.has(e)) continue;
      emitted.current.add(e);
      // (with: a story's voices; n: its count, or the bond's conversations — for what is drawn round the people)
      emitLifeEvent({ kind: e.key, text: formatEntry(e, lang).text.replace(/\{\}/g, "♪"), level: e.level, lifeT: e.t, who: (e.args as { who?: { o?: string } } | undefined)?.who?.o, with: e.args.with?.map((x) => x.o), n: e.args.n });
    }
  }, [rec.entries, lang]);

  const since = Math.max(0, (now - phaseAt) / 1000);


  const endedBy = session.endedBy ?? "lifespan";
  const cause =
    phase === "ended"
      ? causeOfDeath("worker", { lifeSec, stillSec: rec.stillSec, nearSec: rec.nearSec, met: rec.met, metByRole: rec.metByRole, surface: rec.surface, endedBy }, u)
      : null;
  const title = titleFor(lang);
  const sum = phase === "ended" && rec.ledger ? ledgerSummary(rec.ledger) : null;

  // the specimen card: what the record and the ledger hold at the end, nothing else
  const gallery = venue === "gallery";
  const qrUrl = recordingUrl ?? cardUrl;
  const lived = endedBy === "self" ? rec.t : lifeSec;
  const plate = useMemo<PlateInput | null>(() => {
    if (phase !== "ended" || !cause || !rec.me) return null;
    const s = rec.ledger ? ledgerSummary(rec.ledger) : null;
    return {
      lang,
      me: rec.me,
      lifeSec: lived,
      group: rec.group,
      ensembleSec: rec.ensembleSec,
      newWords: rec.newWords,
      asked: rec.asked,
      found: rec.found,
      stillSec: rec.stillSec,
      attempts: rec.attempts,
      attemptsAt: attemptsAt.current.slice(),
      sum: s,
      unmet: (s?.with ?? []).filter((o) => !rec.group.includes(o)).length,
      cause: CAUSE_NAME[lang][cause],
      venue: venueName(venue, lang),
      endedAt: phaseAt,
      trail: rec.ledger?.trail ?? [],
      cells: rec.ledger ? plateCells(rec.ledger) : [],
      qr: qrUrl ? qrModules(qrUrl) : null,
    };
  }, [phase, cause, rec, lang, lived, venue, phaseAt, qrUrl]);
  // the life's summary goes up with its recording: the 발굴노트 its QR page links to (the record's numbers, not the
  // worldline's trail and cells)
  useEffect(() => {
    if (!plate) return;
    const note: Record<string, unknown> = { ...plate };
    delete note.trail;
    delete note.cells;
    delete note.qr;
    setLifeNote(plate.me, note);
  }, [plate]);
  // white paper only (the artist, 2026-11-22: the label printer's head is 48 mm on 54 mm paper, so a black card prints
  // with white strips at its sides — "그냥 흰색만 제공하고 검정색 선택하는 ui 는 없애자")
  const paper: PlateTheme | null = "paper";
  const [turned, setTurned] = useState<PlateOrient | null>(null);
  const theme = paper ?? card.theme;
  const orient = turned ?? card.orient;
  const look = useMemo(() => ({ theme, orient }), [theme, orient]);
  // the end's two steps: the record as it was, then (출력하기 / 저장하기 / 게시하기) the card, where the paper and the
  // way it stands are picked and the acts are made: print (the gallery machine) or save (elsewhere), and post
  const [step, setStep] = useState<"record" | "card">("record");
  const primary: CardAct = gallery ? "print" : "save";
  const [acts, setActs] = useState<Partial<Record<CardAct, "busy" | "done" | "failed" | "noServer">>>({});
  const kept = useRef(false);
  const name = useMemo(() => {
    if (!plate) return "specimen";
    const d = new Date(plate.endedAt);
    const two = (v: number) => String(v).padStart(2, "0");
    return `specimen-${individualNo(plate.me)}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  }, [plate]);
  /** The recording's page: known from the end (the life's own /rec/<id>), else the upload's (it waits for the afterlife's
   * reverb if the recorder is still taking it). */
  const recordingNow = useCallback(async () => recordingUrl ?? (uploadRecording ? await uploadRecording().catch(() => null) : null), [recordingUrl, uploadRecording]);
  /** Keep the life in the gallery: the card's values and its recording's page to the archive (/api/lives). */
  const keep = useCallback(
    async (via: "post" | "print", got?: string | null): Promise<"done" | "failed" | "noServer"> => {
      if (!plate) return "failed";
      const url = got !== undefined ? got : await recordingNow();
      const r = await fetch("/api/lives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: name, card: { ...plate, qr: null }, look, via, venue, recordingUrl: url }),
      }).catch(() => null);
      if (r?.status === 503) return "noServer";
      return r?.ok ? "done" : "failed";
    },
    [plate, recordingNow, name, look, venue],
  );
  const doAct = useCallback(
    async (a: CardAct) => {
      if (!plate || acts[a] === "busy") return;
      const set = (v: "busy" | "done" | "failed" | "noServer" | undefined) => setActs((s) => ({ ...s, [a]: v }));
      set("busy");
      try {
        if (a === "save") {
          const r = await saveCard(plate, look, name);
          set(r === "cancelled" ? undefined : "done");
          return;
        }
        // the printed card carries the recording's QR: the recording goes up first
        const url = a === "print" ? await recordingNow() : undefined;
        if (a === "print" && (await printCard(url ? { ...plate, qr: qrModules(url) } : plate, look)) === "failed") return set("failed");
        const k = await keep(a, url);
        if (k === "done") kept.current = true;
        // a print that the archive did not take is still a print (게시하기 stays to try again)
        set(a === "print" && k !== "done" ? "done" : k);
      } catch {
        set("failed");
      }
    },
    [plate, acts, look, name, keep, recordingNow],
  );
  /** The print kept the life: the two said at once, no 게시하기 after it. */
  const printKept = acts.print === "done" && kept.current;
  /** The life is in the gallery now: the way there opens (the artist, 2026-11-22). */
  const inGallery = acts.post === "done" || printKept;
  /** 갤러리 보기 pressed: the recording goes up first — leaving the page now would cut its upload off (it would go up
   * only behind the next life, and the card's QR would find nothing until then). At most GALLERY_WAIT_MS. */
  const [leaving, setLeaving] = useState(false);
  const toGallery = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (leaving) return;
      const href = e.currentTarget.href;
      setLeaving(true);
      if (uploadRecording) await Promise.race([uploadRecording().catch(() => null), new Promise((r) => setTimeout(r, GALLERY_WAIT_MS))]);
      window.location.href = href;
    },
    [leaving, uploadRecording],
  );

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

      {/* the name: the melody the visitor is given, written down, its notes coming on as it sounds (RoleField → engine),
          over and over; 살아가기 is the way into the world */}
      {phase === "name" && visitorRef.current?.no === session.sessionNo && (
        <Centre className={`${say} text-center`}>
          <div className="flex items-center justify-center gap-3 text-[26px] text-white">
            {S.live.mine} (<Glyph dots={glyphOf(visitorRef.current.id)} cell={8} playFrom={phaseAt + 100} playEvery={NAME_LOOP_MS} />)
          </div>
          <button type="button" onClick={enterWorld} className="pointer-events-auto mt-10 border border-white/50 px-6 py-2 text-[20px] text-white/90 outline-none hover:bg-white hover:text-black">
            {S.live.enter}
          </button>
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
        <div
          className={
            logPlace === "left"
              ? "absolute bottom-24 left-4 top-20 flex w-[min(24vw,22rem)] flex-col justify-end [mask-image:linear-gradient(to_bottom,transparent,black_30%)]"
              : logPlace === "top"
                ? "absolute inset-x-0 top-14 flex justify-center px-3 [&>div>div:nth-child(2)]:flex [&>div>div:nth-child(2)]:max-h-[4.6rem] [&>div>div:nth-child(2)]:min-h-0 [&>div>div:nth-child(2)]:flex-col-reverse [&>div>div:nth-child(2)]:justify-end [&>div>div:nth-child(2)]:overflow-hidden"
                : "absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4"
          }
        >
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

      {/* KR / EN on the end's screens (the visitor's pick), large enough to read as a choice */}
      {phase === "ended" && cause && (
        <div className={`hud-ko absolute flex ${coarse ? "right-4 top-[14px] gap-1.5 text-[18px]" : "right-6 top-5 gap-2 text-[20px]"}`}>
          {(["ko", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              data-hud-control
              onClick={() => setEndLang(l)}
              className={`pointer-events-auto border outline-none ${coarse ? "min-h-[44px] min-w-[56px] px-3.5 py-2" : "min-h-[48px] min-w-[68px] px-[18px] py-2"} ${lang === l ? "border-white bg-white text-black" : "border-white/40 text-white/70"}`}
            >
              {l === "ko" ? "KR" : "EN"}
            </button>
          ))}
        </div>
      )}

      {/* the end, second step: the specimen card at the printed card's proportion; the paper (white / black) and the way
          it stands (portrait / landscape) on one row, the acts (출력하기 or 저장하기, 게시하기) and the way back on the next */}
      {phase === "ended" && cause && step === "card" && plate && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden px-4 ${coarse ? "pb-5 pt-[72px]" : "py-5"}`}>
          <SpecimenCard
            plate={plate}
            look={look}
            className="min-h-0 shrink outline outline-1 outline-white/20"
            style={{
              height: `min(calc(100dvh - ${coarse ? 20.5 : 12.5}rem), calc((100vw - 2rem) * ${orient === "landscape" ? "54 / 86" : "86 / 54"}))`,
            }}
          />
          {/* the way it stands (white paper only since 2026-11-22) */}
          <div className={`${say} flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[15px]`}>
            <span className="flex gap-2">
              {(["portrait", "landscape"] as const).map((o) => (
                <button key={o} type="button" data-hud-control onClick={() => setTurned(o)} className={pick(orient === o)}>
                  {o === "portrait" ? S.ended.orientPortrait : S.ended.orientLandscape}
                </button>
              ))}
            </span>
          </div>
          <div className={`${say} flex shrink-0 flex-wrap items-center justify-center gap-2 text-[15px]`}>
            <button
              type="button"
              data-hud-control
              onClick={() => doAct(primary)}
              disabled={acts[primary] === "busy" || printKept}
              className="pointer-events-auto border border-white bg-white px-4 py-1 text-black outline-none"
            >
              {printKept ? S.ended.printedKept : acts[primary] ? S.ended.actState(primary, acts[primary]) : S.ended.act[primary]}
            </button>
            {!printKept && (
              <button
                type="button"
                data-hud-control
                onClick={() => doAct("post")}
                disabled={acts.post === "busy" || acts.post === "done"}
                className="pointer-events-auto border border-white px-4 py-1 text-white outline-none"
              >
                {acts.post ? S.ended.actState("post", acts.post) : S.ended.act.post}
              </button>
            )}
            {inGallery && (
              <a
                href={galleryHref(lang, venue)}
                onClick={toGallery}
                data-hud-control
                className="pointer-events-auto border border-white px-4 py-1 text-white outline-none"
              >
                {leaving ? S.ended.galleryWait : S.ended.viewGallery}
              </a>
            )}
            <button type="button" data-hud-control onClick={() => setStep("record")} className="pointer-events-auto border border-white/40 px-3 py-1 text-white/70 outline-none">
              {S.ended.back}
            </button>
          </div>
          <div className={`${say} max-w-[30rem] shrink-0 text-center text-[13px] leading-[1.5] text-white/45`}>{S.ended.keepNote}</div>
          <div className={`${say} h-5 shrink-0 text-[15px] tracking-[0.2em] text-white`}>{session.restartReady && <span className="hud-blink">{coarse ? S.ended.nextTouch : S.ended.next}</span>}</div>
        </div>
      )}

      {/* the end, first step, as it was on 11/01: the being's record card, with the footprint (Leva 개인뷰 비주얼 › 기록표의
          발자국 지도); under it the way on to the card: 출력하기 on the gallery machine, 저장하기 elsewhere, and 게시하기 */}
      {phase === "ended" && cause && step === "record" && (
        <div className={`absolute inset-0 flex items-center justify-center overflow-hidden px-6 ${coarse ? "pb-7 pt-20" : ""}`}>
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
                {/* (고유 어휘 = the melody born with; what it became is the next row's — glyphOf follows the newest word) */}
                <CardRow label={S.ended.own}>{rec.me && <Glyph dots={birthGlyphOf(rec.me)} cell={5} />}</CardRow>
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
            {plate && (
              <div className="flex flex-wrap items-center gap-2 pt-4 text-[16px]">
                {([gallery ? "print" : "save", "post"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    data-hud-control
                    onClick={() => setStep("card")}
                    className="pointer-events-auto border border-white px-4 py-1 text-white outline-none hover:bg-white hover:text-black"
                  >
                    {S.ended.act[a]}
                  </button>
                ))}
              </div>
            )}
            {helpLine && cause === "suicide" && <div className="pt-3 text-[#8c8c8c]">{S.ended.help}</div>}
            {session.restartReady && <div className="hud-blink pt-4 text-[16px] tracking-[0.2em] text-white">{coarse ? S.ended.nextTouch : S.ended.next}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
