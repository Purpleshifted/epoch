"use client";
/**
 * RoleField — what the player's role leaves behind, seen from the player's own time.
 *
 * - Emits spacetime events: a presence sample every `sampleSec` seconds (all roles).
 * - The visitor has an assigned time s(t) = wall seconds since the epoch + a personal offset;
 *   it flows while they are here. Only events with s <= s(now) are folded and drawn, so a
 *   visitor never sees what later visitors leave.
 * - Events are mirrored into localStorage (stand-in for the shared server) every second.
 *
 * Emitting and mirroring run on a wall-clock ticker (useTicker), NOT in useFrame: rAF stops in a hidden
 * tab, and the player tab is hidden exactly when you look at /global/space in another tab — the bots used
 * to freeze then, and no concrete was ever generated. Only the fold and drawing stay in useFrame.
 *
 * V2 session (useLifeSession): the visitor only leaves presence while their session is LIVE; near the end the
 * headset goes dull (muffleSound); after every fold a dry reading of who is near is put in `witnessRef` (HUD), and
 * the LEDGER of this life (lib/parliament/ledger.ts: what my own samples did to the ground) in `ledgerRef`. The fold
 * is read for the whole world (the region only chose what was read; the ledger needs the world's totals).
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import {
  LS_PARLIAMENT_ME_KEY,
  ONE_FLOCK,
  SEAL_H,
  botActor,
  DEFAULT_WITNESS,
  ledgerAt,
  botPlan,
  dueSamples,
  steerBot,
  getEpochMs,
  pickOffset,
  DEFAULT_LIFE,
  saveMerged,
  setKeepFrom,
  observe,
  sessionSeconds,
  SESSION_ROLES,
  StressState,
  NAME_GAP_SEC,
  aliveOwners,
  concreteLines,
  dandelionsIn,
  wordSpots,
  type Dandelion,
  type WordSpot,
  otherMarks,
  wrapCoord,
  type Actor,
  type Flock,
  type FoldConfig,
  type Ledger,
  type LedgerConfig,
  type NatureConfig,
  type Observation,
  type PEvent,
  type RoleId,
  type Snapshot,
  worldNow,
} from "@/lib/parliament";
import { KEY_NAMES, personalSignals, worldKey, type Motif, type WorldKey } from "@/lib/sound";
import { DitherGround } from "./DitherGround";
import { newLook } from "./mobileLab";
import { FuturePresence, futurePeek, type FuturePresenceVisual } from "./FuturePresence";
import { FutureEncounter, futureMeet } from "./FutureEncounter";
import { NatureCloud, type GrassReaction } from "./NatureCloud";
import { AnswerBurst, ConcreteLines, ConcreteOutline, OtherDots, type BurstAt, type MarksData } from "./Marks";
import { PathLines } from "./PathLines";
import { useTicker } from "./useTicker";
import { blockFrameFor, botServerOn, livingBotsNear, useVisitorLink, watchCentre } from "./useBotServer";
import { onLifeEvent } from "./lifeEvents";
import { learnWords, newWordMotifOf } from "@/lib/parliament/glyph";
import { blockSeatOffset, herdSeatOffset } from "@/lib/parliament/rise";
import type { SoundSetup } from "./useSound";
import { useFoldState, useStressState, useWorld } from "./useWorld";
import { muffleSound, type LifeSignal } from "./useLifeSession";
import { markSpan } from "./usePerfMeter";
import type { GrassVisual, MarksVisual } from "./usePersonalVisuals";
import { FutureResidue } from "./FutureResidue";

/** The answer starts on the next bar's edge, or the one after when that is nearer than this (ms). */
const ANSWER_REST_MS = 600;
const VIEW_RADIUS = 24;
const FOLD_EVERY = 0.5;
const BURST_Y = 0.2; // an answer's burst goes off at the height of the visitor's own square
/** Someone who has sent nothing new for this long (wall ms) is not here (the log reaches other tabs in about a second). */
const ALIVE_HOLD_MS = 6000;
/** V2: how often the ledger reads the WHOLE world (its totals and my far slabs); the drawing reads a region. */
const LEDGER_EVERY = 2;
const TICK_MS = 250; // emitter tick (wall clock; keeps running in a hidden tab)
const SAVE_EVERY_MS = 1000; // between mirrors to localStorage (the 3D view shows live markers from it)
const KEEP_EVERY_MS = 30_000; // how often (world time) the history window moves on (older events are dropped everywhere)
const KEEP_MIN_WALL_MS = 3000; // … but not more often than this in wall time (a fast world clock)

export interface ParliamentDebug {
  role: RoleId;
  s: number;
  offset: number;
  /** How the life was seated in time: the clock's top (no block told) · a random height of the window · beside a bot. */
  seat?: "clock" | "random" | "herd";
  /** How many others the record counts as here now (aliveOwners). */
  alive?: number;
  events: number;
  slabs: number;
  paths: number;
  /** V2: the headset sound's state (one line). */
  sound?: string;
  /** The growing fold's state (foldState.ts stats), one line. */
  fold?: string;
  /** V2: the ledger's size and cost, one line. */
  ledger?: string;
  /** Where the player stands (canonical world coordinates). */
  x?: number;
  z?: number;
}

/** V2: how often the ground the bots walk on (trodden paths, buildings) is refolded. */
const BOT_GROUND_EVERY_MS = 5000;

/**
 * The player's growing fold: the settled frontier held 35 s further back, so someone who joins up to that far behind
 * the others in assigned time (a bot of the wall, born ±30 s around now) is not "late" — which would make the whole
 * fold rebuild itself (foldState.ts lateMarginSec).
 */
const PLAYER_FOLD_OPTS = { lateMarginSec: 35 };

/** Who a life's visitor is. */
export interface Visitor {
  /** The session (useLifeSession's sessionNo) they belong to. */
  no: number;
  id: string;
}

export function RoleField({
  playerPosRef,
  role,
  cfg,
  natureCfg,
  pointSize,
  pathDots = 1,
  pathLine = 1,
  offsetWindow,
  lifeSec = DEFAULT_LIFE.lifeSec,
  botCount,
  botRole,
  botFlock = ONE_FLOCK,
  sound = null,
  playerYawRef,
  lifeRef,
  witnessRef,
  ledgerRef,
  ledgerCfg,
  grass,
  marks,
  answers,
  answerWord,
  sessionNo = 0,
  visitorRef,
  future,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number; vx?: number; vz?: number }>;
  role: RoleId;
  /** THE FUTURE UNDER THE VISITOR'S FEET (FuturePresence.tsx, a trial of 2026-11-22): the layer of what is found after
   *  the people are gone, read off this view's own log at the visitor's slot; absent / off = nothing. */
  future?: FuturePresenceVisual;
  cfg: FoldConfig;
  natureCfg: NatureConfig;
  pointSize: number;
  /** How many dust points a trodden cell gets (× the base 14 at full strength); the artist wanted the paths visible. */
  pathDots?: number;
  /** Brightness of the path LINES (PathLines; 0 = none, 1 = white). */
  pathLine?: number;
  offsetWindow: number;
  /** The life's length (s): a visitor seated in the bots' block ends their life under its top (blockSeatOffset). */
  lifeSec?: number;
  botCount: number;
  /** "mixed" (V2): the bots take the session roles in turn. */
  botRole: RoleId | "mixed";
  /** How the bots spread over the ground (flocks). */
  botFlock?: Flock;
  /** V2: the headset sound — fed the player's signals (lib/sound/signals.ts) after every fold. */
  sound?: SoundSetup | null;
  /** Where the camera looks (radians), for panning the others' voices. */
  playerYawRef?: React.MutableRefObject<number>;
  /** V2: the visitor's session; absent = always present (V1). */
  lifeRef?: { readonly current: LifeSignal };
  /** V2: a dry reading of the visitor's situation, renewed after every fold (lib/parliament/witness.ts). */
  witnessRef?: React.MutableRefObject<Observation | null>;
  /** V2: the ledger of this life (lib/parliament/ledger.ts), renewed after every fold while LIVE, kept after the end. */
  ledgerRef?: React.MutableRefObject<Ledger | null>;
  ledgerCfg?: LedgerConfig;
  /** V2: how the grass reacts to the walker at once (Leva 개인뷰 비주얼; NatureCloud). */
  grass?: GrassVisual;
  /** V2: the marks in the frame — others, concrete, paths (Leva 개인뷰 비주얼; lib/parliament/marks.ts, Marks.tsx). */
  marks?: MarksVisual;
  /** Which life this is, and where to say who its visitor is (the name screen). */
  sessionNo?: number;
  visitorRef?: React.MutableRefObject<Visitor | null>;
  /** How many answers the visitor has given (SessionHud): each leaves a seed head where they stand. */
  answers?: React.MutableRefObject<number>;
  /** The last answer's word — whom it was to and its seed (SessionHud): the seed head carries it (sound-logic §13d). */
  answerWord?: React.MutableRefObject<{ to: string; seed: number } | null>;
}) {
  const pending = useRef<PEvent[]>([]);
  /** The epoch changed under this life: the history window is set again on the next frame, in the new epoch's time. */
  const rejoined = useRef(false);
  const log = useWorld(() => {
    pending.current = [];
    epochMs.current = getEpochMs(); // the world was cleared: join the NEW epoch (and its history window is unset)
    // (the old cutoff was in the old epoch's time: joining the bot server's world it threw away everything the server
    // sent as hours too old)
    rejoined.current = true;
  });
  const epochMs = useRef(0);
  // the visitor where they stand, to the bot server: the walls see them and the bots go to them; and what is written
  // round them (the bots, the others) comes back into this log (useBotServer.ts)
  const toServer = useVisitorLink(typeof window !== "undefined" && botServerOn(), log);
  // the ground, folded as it grows (foldState.ts): the whole world is folded, the region only chooses what is read
  const fold = useFoldState(log, cfg, PLAYER_FOLD_OPTS);
  const stressAt = useStressState(log, natureCfg);
  /** `rand`: where in the block's window this life is seated; `seatEpoch`: the world it was seated in (0 = not yet). */
  const me = useRef({ id: "v_anon", offset: 0, tag: "t", rand: 0.5, seatEpoch: 0, rand2: 0.5, herdEpoch: 0, seat: "clock" as "clock" | "random" | "herd" });
  /** How many others the record counts as here (aliveOwners), as of the last fold: the readout. */
  const aliveN = useRef(0);
  /** `?seat=random`: the life keeps its random seat in the window (no moving beside the bots) — for comparing. */
  const seatRandomOnly = useRef(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("seat") === "random");
  /** My own samples, in time order (what the ledger reads; a life is a few hundred). */
  const myEvents = useRef<PEvent[]>([]);
  const ledgerMs = useRef(0);
  const seq = useRef(0);
  const lastSampleMs = useRef(0);
  const botStartMs = useRef(0);
  const lastSaveMs = useRef(0);
  const lastKeepMs = useRef(0);
  const lastKeepWall = useRef(0);
  const foldTimer = useRef(10);
  const ledgerTimer = useRef(10);
  // THE INTERVALS STRETCH WITH THEIR COST (the artist, 2026-11-24: "쓰로틀링/디바운싱 역치를 동적으로"): a reading of the
  // world that took long waits longer before the next — the fold at most ~6 % of the time, the ledger ~4 % — never
  // shorter than their base intervals, so a light world reads as before
  const foldEvery = useRef(FOLD_EVERY);
  const ledgerEvery = useRef(LEDGER_EVERY);
  /** My trail at the fold's cadence (the footprint map draws it; the ledger itself reads the world less often). */
  const trail = useRef<{ x: number; z: number; t: number }[]>([]);
  // the ticker reads the latest Leva values through this ref
  const live = useRef({ role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec, cfg, fold, lifeSec });
  // V2: what bots walk on — trodden ground (G per cell) and the cells buildings stand on; refreshed every few seconds
  const botGround = useRef<{ at: number; level: Map<string, number>; built: Set<string> } | null>(null);
  // V2: each migration's route, chosen once (on the ground as it was) and kept until it is over
  const botRoutes = useRef(new Map<string, number[]>());
  useEffect(() => {
    live.current = { role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec, cfg, fold, lifeSec };
  }, [role, botCount, botRole, botFlock, cfg, fold, lifeSec]);
  const snap = useRef<Snapshot | null>(null);
  const stress = useRef<Map<string, number> | null>(null);
  // the grass reaction (NatureCloud): the walker's own recent trail as a second, visual-only stress state, fed from
  // the player's position every `nearEvery` seconds (not from the sampled events), and the walker's own folded
  // stress from the ledger (A3)
  const quick = useRef<StressState | null>(null);
  const quickMap = useRef<Map<string, number> | null>(null);
  const quickTimer = useRef(0);
  const quickSeq = useRef(0);
  const mineMap = useRef<Map<string, number> | null>(null);
  // the marks (others, concrete, paths), renewed with the fold from the record's far list and the snapshot
  const marksRef = useRef<MarksData | null>(null);
  // the seed heads the answers left (dandelion.ts, drawn on the wall only): where others' words can be found
  const heads = useRef<Dandelion[]>([]);
  const wordsRef = useRef<WordSpot[]>([]);
  // answers already turned into a seed head (the count lives in ParliamentScene, across lives), and the last one's burst here
  const answered = useRef(answers?.current ?? 0);
  // THE CALL AND THE ANSWER IN THE SOUND (the artist, 2026-11-10, on the shared-world branch; the redesign never had it
  // until 2026-11-22 — "말을 걸고 대답했을 때의 소리가 안 들어가고"): whoever asks me something is the clearest voice
  // around while the question is open (engine ASKER_LEVEL), and my answer is heard on the next bar's edge — my melody
  // and theirs together for a bar, then the new word the record wrote down (engine.playAnswer). From the record's lines
  // (lifeEvents: SessionHud's witness), so the sound and the stream say the same thing.
  // (word: what a question asked again says, as the record writes it — their melody with mine in it; the engine's call
  // plays it when the ask is heard as counterpoint, sound-logic §13d)
  const askerNow = useRef<{ o: string; until: number; word: Motif | null } | null>(null);
  const answerDue = useRef<{ other: string; seed: number } | null>(null);
  // the record's 합주 (witness ensemble.start … end): the sound plays it as an ensemble (sound-logic §13e)
  const ensembleNow = useRef(false);
  useEffect(
    () =>
      onLifeEvent((e) => {
        if (e.kind === "ensemble.start") ensembleNow.current = true;
        else if (e.kind === "ensemble.end" || e.kind === "life.begin" || e.kind === "ended") ensembleNow.current = false;
        if ((e.kind === "word.new" || e.kind === "word.asked") && e.who)
          askerNow.current = {
            o: e.who,
            until: performance.now() + DEFAULT_WITNESS.askOpenSec * 1000,
            word: e.kind === "word.asked" ? newWordMotifOf(e.who, me.current.id, Math.floor(e.lifeT ?? 0)) : null,
          };
        else if (e.kind === "word.answered" && e.who) {
          askerNow.current = null;
          answerDue.current = { other: e.who, seed: Math.floor(e.lifeT ?? 0) };
        }
      }),
    [],
  );
  useFrame(() => {
    const a = answerDue.current;
    if (!a || !sound) return;
    answerDue.current = null;
    const m = sound.engine.musicStep;
    if (!m) return;
    const now = performance.now();
    const stepMs = (sound.engine.musicBarSec() * 1000) / 8;
    let startMs = now + (8 - (m.step + m.into)) * stepMs;
    if (startMs - now < ANSWER_REST_MS) startMs += 8 * stepMs;
    sound.engine.playAnswer(startMs, stepMs, a.other, newWordMotifOf(me.current.id, a.other, a.seed));
  });
  const burst = useRef<BurstAt | null>(null);
  // who has been sending samples (aliveOwners)
  const seenOwners = useRef(new Map<string, { s: number; at: number }>());
  // V2 sound: the epoch's tonal field (harmony.ts), made once per epoch
  const tonal = useRef<{ epochMs: number; key: WorldKey } | null>(null);
  // the visitor's assigned time as of the last frame (the future layer reads its slot), and the present's drawing
  const sNow = useRef(0);
  const present = useRef<THREE.Group>(null);

  useEffect(() => {
    epochMs.current = getEpochMs();
    if (ledgerRef) ledgerRef.current = null; // a new life, a new ledger
    me.current = {
      id: "v_" + Math.random().toString(36).slice(2, 7),
      offset: pickOffset(Math.random(), offsetWindow),
      tag: Math.random().toString(36).slice(2, 6),
      rand: Math.random(),
      seatEpoch: 0,
      rand2: Math.random(),
      herdEpoch: 0,
      seat: "clock",
    };
    if (visitorRef) visitorRef.current = { no: sessionNo, id: me.current.id };
    try {
      localStorage.setItem(LS_PARLIAMENT_ME_KEY, me.current.id);
    } catch {
      /* ignore */
    }
    // only the last KEEP_WINDOW_SEC before this session are kept (performance, for now)
    setKeepFrom(sessionSeconds(worldNow(), epochMs.current, me.current.offset));
    const flush = () => {
      if (pending.current.length) {
        saveMerged(pending.current, epochMs.current);
        pending.current = [];
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
    // the offset is drawn once per page load (a visitor's time slot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (o: string, r: RoleId, k: PEvent["k"], x: number, z: number, s: number, word?: { to: string; seed: number }) => {
    // the world is finite and wraps (world.ts): every stored coordinate is canonical
    const e: PEvent = { id: `${o}:${me.current.tag}:${seq.current++}`, o, r, k, x: wrapCoord(x), z: wrapCoord(z), s, ...(word ? { to: word.to, seed: word.seed } : {}) };
    log.add(e);
    pending.current.push(e);
    if (o === me.current.id && k === "p") {
      myEvents.current.push(e);
      toServer(e, epochMs.current);
    }
  };

  // ── emit presence and mirror to localStorage: world clock (worldClock.ts, may run faster than the wall clock) for
  //    the samples and the bots, wall clock for the work done between them; also while hidden ──
  useTicker(TICK_MS, () => {
    if (epochMs.current === 0) return;
    const now = worldNow();
    const wall = Date.now();
    // SEATED IN THE BLOCK (2026-11-22): the bots live in the block's time (a window of depthSec seconds), not at
    // "seconds since the epoch" — a visitor left there stood hours above them and saw none of them. Once the bot server
    // has told this world's block, the life is seated in it as a loner bot is (once per world; the history window
    // follows on this frame)
    if (me.current.seatEpoch !== epochMs.current) {
      const b = blockFrameFor(epochMs.current);
      const off = b ? blockSeatOffset(b.frame, b.gone, live.current.lifeSec, me.current.rand) : null;
      if (off !== null) {
        me.current.offset = off;
        me.current.seatEpoch = epochMs.current;
        me.current.seat = "random";
        rejoined.current = true;
      }
    }
    // BORN WHERE THE BOTS ARE (the artist, 2026-11-22: "봇이 어느 정도 있는 시간대면 좋겠는데. 무작위로"): the server tells
    // a phone what is written near its visitor only once it has had a sample of them — so the life begins at its
    // random seat, and a few seconds into it, once the live stream of the bots near has run for a moment, it is seated
    // again beside one of them (rise.ts herdSeatOffset: a random one of the living bots near, within ±20 s). Once per
    // world; with no bot near within 8 s the random seat stays. The first few samples stand at the random seat.
    if (!seatRandomOnly.current && me.current.seatEpoch === epochMs.current && me.current.herdEpoch !== epochMs.current && (!lifeRef || lifeRef.current.phase === "live")) {
      // (the first message is the world round the visitor as it was — its bots may be long gone: only what came after
      // it, in the last 3 s, is living; so the reading waits past that message)
      const near = livingBotsNear(3000);
      const listened = near.since > 0 ? wall - near.since : 0;
      if (listened >= 4500) {
        const b = blockFrameFor(epochMs.current);
        const off = b && near.bots.length ? herdSeatOffset(b.frame, b.gone, live.current.lifeSec, near.bots.map((q) => q.s), me.current.rand, me.current.rand2) : null;
        if (off !== null) {
          me.current.offset = off;
          me.current.seat = "herd";
          me.current.herdEpoch = epochMs.current;
          rejoined.current = true;
        } else if (listened >= 8000) me.current.herdEpoch = epochMs.current;
      }
    }
    const { role: myRole, botCount: nBots, botRole: theirRole, botFlock: flock, sampleSec, cfg: foldCfg, fold: theFold } = live.current;
    // V2: bots walk where others walked (bundling) and around buildings (detour)
    const flow = foldCfg.flow?.enabled ? foldCfg.flow : null;
    if (flow && nBots > 0 && (!botGround.current || wall - botGround.current.at >= BOT_GROUND_EVERY_MS)) {
      const tSess = sessionSeconds(now, epochMs.current, me.current.offset);
      // the whole world, settled part only (cheap; seconds behind): what the bots walk on
      const tBot = performance.now();
      const snapAll = theFold.at(tSess, undefined, { tail: false });
      markSpan("bot-fold", performance.now() - tBot);
      const settledTo = Math.min(tSess, theFold.stats()?.frontier ?? tSess);
      const level = new Map<string, number>();
      for (const pc of snapAll.paths) level.set(pc.key, -flow.unit * Math.log(1 - Math.min(0.999, pc.p)));
      const built = new Set<string>();
      // buildings in use now (a ruin — nobody around for longer than emptyGapSec — can be crossed)
      for (const sl of snapAll.slabs) if (sl.h >= SEAL_H && settledTo - sl.lastS <= foldCfg.emptyGapSec) built.add(sl.key);
      botGround.current = { at: wall, level, built };
      if (botRoutes.current.size > nBots * 4) botRoutes.current.clear(); // old migrations
    }
    const ground = flow ? botGround.current : null;
    const steer = (a: Actor, i: number, w: number): Actor => {
      if (!flow || !ground) return a;
      const plan = botPlan(i, w, botStartMs.current, epochMs.current, me.current.offset, flock);
      const [x, z] = steerBot(a.o, plan, { level: (k) => ground.level.get(k) ?? 0, built: (k) => ground.built.has(k) }, flow, botRoutes.current);
      return { ...a, x, z };
    };
    const period = Math.max(50, sampleSec * 1000);
    if (lastSampleMs.current === 0) lastSampleMs.current = now - period;
    const due = dueSamples(lastSampleMs.current, now, period);
    if (due.length) lastSampleMs.current = due[due.length - 1];
    if (nBots <= 0) botStartMs.current = 0;
    else if (botStartMs.current === 0) botStartMs.current = now;
    const p = playerPosRef.current;

    for (const w of due) {
      const actors: Actor[] = [];
      // the visitor is only where they stand NOW: after a freeze their missed samples are not backfilled;
      // V2: and only while their session is live (before the role is drawn, and after the end, they leave nothing)
      const present = !lifeRef || lifeRef.current.phase === "live";
      if (present && now - w < period * 1.5) actors.push({ o: me.current.id, r: myRole, x: p.x, z: p.z, s: sessionSeconds(w, epochMs.current, me.current.offset) });
      for (let i = 0; i < nBots; i++) actors.push(steer(botActor(i, theirRole === "mixed" ? SESSION_ROLES[i % SESSION_ROLES.length] : theirRole, w, botStartMs.current, epochMs.current, me.current.offset, flock), i, w));
      for (const a of actors) emit(a.o, a.r, "p", a.x, a.z, a.s);
    }

    // the history window rolls on: only the last KEEP_WINDOW_SEC before now are kept (performance, for now)
    // (in world time, but at most every KEEP_MIN_WALL_MS of wall time when the clock runs fast)
    if (rejoined.current || (now - lastKeepMs.current >= KEEP_EVERY_MS && wall - lastKeepWall.current >= KEEP_MIN_WALL_MS)) {
      rejoined.current = false;
      lastKeepMs.current = now;
      lastKeepWall.current = wall;
      setKeepFrom(sessionSeconds(now, epochMs.current, me.current.offset));
    }
    if (wall - lastSaveMs.current >= SAVE_EVERY_MS) {
      lastSaveMs.current = wall;
      if (pending.current.length) {
        // false = this tab's epoch has ended; useWorld's poll makes it join the new one
        const tSave = performance.now();
        saveMerged(pending.current, epochMs.current);
        markSpan("save", performance.now() - tSave);
        pending.current = [];
      }
    }
  });

  // the name is up: the visitor's melody, with a gap, over and over; it stops when the life begins
  const nameDue = useRef<number | null>(null);
  useFrame(() => {
    if (!sound) return;
    if (lifeRef?.current.phase !== "name") {
      if (nameDue.current !== null) sound.engine.hushName();
      nameDue.current = null;
      return;
    }
    const now = performance.now();
    if (!tonal.current || (nameDue.current !== null && now < nameDue.current)) return;
    sound.engine.announce(me.current.id, tonal.current.key, sound.params.master);
    nameDue.current = now + (sound.params.barSec + NAME_GAP_SEC) * 1000;
  });

  useFrame((_, delta) => {
    if (epochMs.current === 0) return;
    const dt = Math.min(delta, 0.05);
    const sMe = sessionSeconds(worldNow(), epochMs.current, me.current.offset);
    sNow.current = sMe;
    // (the peek into the future: the present's drawing goes dark while F — the phone's button — is held)
    if (present.current) present.current.visible = !(future?.on && ((future.overlayOn && future.mode === "peek" && futurePeek.on) || (future.encounterOn && futureMeet.dark)));
    if (answers && answers.current > answered.current) {
      answered.current = answers.current;
      const { x, z } = playerPosRef.current;
      // the seed head carries the word the answer made (whom to, its seed) when the answer is heard as counterpoint
      // (the redesigned view): from it every page that reads the log learns this visitor's new melody (glyph.ts)
      const word = sound?.params.askCounterpoint ? answerWord?.current ?? undefined : undefined;
      emit(me.current.id, "tree", "s", x, z, sMe, word);
      burst.current = { id: `${me.current.id}:${answers.current}`, x, y: BURST_Y, z, atMs: performance.now() };
    }
    const p = playerPosRef.current;
    // (a tab watching the exhibition's world takes in only what is near the walker: useBotServer.ts)
    watchCentre.x = p.x;
    watchCentre.z = p.z;
    watchCentre.set = true;

    // ── the grass reaction's quick stress: where the walker IS, every nearEvery seconds, while live ──
    if (grass && grass.mode !== "off" && (!lifeRef || lifeRef.current.phase === "live")) {
      quickTimer.current += dt;
      if (quickTimer.current >= grass.nearEvery) {
        quickTimer.current = 0;
        const q = quick.current;
        const dose = grass.dose * grass.nearEvery; // per feed, so `dose` reads per second at the centre
        if (!q || q.cfg.dose !== dose || q.cfg.lingerRadius !== grass.reactRadius || q.cfg.recoverSec !== natureCfg.recoverSec) {
          quick.current = new StressState({ ...natureCfg, dose, lingerRadius: grass.reactRadius });
        }
        const qs = quick.current!;
        qs.add({ id: `q:${quickSeq.current++}`, o: me.current.id, r: "worker", k: "p", x: p.x, z: p.z, s: sMe });
        if (quickSeq.current % 200 === 0) qs.dropBefore(sMe - 8 * natureCfg.recoverSec);
        quickMap.current = qs.at(sMe, { x: p.x, z: p.z, r: VIEW_RADIUS });
      }
    } else if (quickMap.current) {
      quickMap.current = null;
      quick.current = null;
    }

    // ── fold what this visitor can see at their own time ──
    foldTimer.current += dt;
    if (foldTimer.current >= foldEvery.current) {
      const sinceFold = foldTimer.current;
      foldTimer.current = 0;
      const events = log.all();
      const tFold = performance.now();
      // the region the drawing, the sound and the marks read (the fold itself is always the whole world)
      const readR = Math.max(VIEW_RADIUS, marks?.concrete.on ? marks.concrete.radius : 0);
      // who is here now: everyone within the assignment window, whatever time slot they live in
      heads.current = dandelionsIn(events);
      // each answerer's newest word, from the seed heads (glyph.ts): every melody drawn or sung follows it
      learnWords(events);
      const alive = aliveOwners(events, me.current.id, seenOwners.current, performance.now(), ALIVE_HOLD_MS, sMe, Math.max(offsetWindow, DEFAULT_WITNESS.recentSec));
      aliveN.current = alive.size;
      snap.current = fold.at(sMe, { x: p.x, z: p.z, r: readR });
      stress.current = stressAt(sMe, { x: p.x, z: p.z, r: VIEW_RADIUS });
      const foldMs = performance.now() - tFold;
      markSpan("fold", foldMs);
      // (only on the lab's pages and the experiment: the exhibition's personal view reads at its old fixed pace)
      if (newLook()) foldEvery.current = Math.min(3, Math.max(FOLD_EVERY, foldMs / 1000 / 0.06));
      if (witnessRef) {
        witnessRef.current = observe({
          me: { id: me.current.id, x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 },
          events,
          sNow: sMe,
          snap: snap.current,
          t: lifeRef?.current.t ?? 0,
          words: wordsRef.current,
          alive,
          cfg: { ...DEFAULT_WITNESS, nearRadius: cfg.radius, farRadius: VIEW_RADIUS },
        });
        // (the future passed where the visitor stands: FutureEncounter.tsx — the record writes it once)
        if (future?.on && future.encounterOn) witnessRef.current.future = futureMeet.last;
        // the ledger of this life: only while LIVE (after the end it keeps the life's last reading); it reads the
        // WHOLE world (its totals, my slabs wherever they are), so less often than the drawing
        ledgerTimer.current += sinceFold;
        if (ledgerRef && lifeRef?.current.phase === "live") trail.current.push({ x: p.x, z: p.z, t: lifeRef.current.t });
        if (ledgerRef && lifeRef?.current.phase === "live" && ledgerTimer.current >= ledgerEvery.current) {
          ledgerTimer.current = 0;
          const tLed = performance.now();
          wordsRef.current = wordSpots(heads.current, me.current.id, sMe);
          const obs = witnessRef.current;
          ledgerRef.current = ledgerAt({
            me: { id: me.current.id, x: p.x, z: p.z },
            mine: myEvents.current,
            sNow: sMe,
            t: lifeRef.current.t,
            snap: fold.at(sMe),
            stress: stressAt(sMe),
            natureCfg,
            flow: cfg.flow?.enabled ? cfg.flow : null,
            nearCount: obs.others.filter((o) => o.dist <= cfg.radius).length,
            trail: trail.current,
            cfg: ledgerCfg,
            prev: ledgerRef.current,
          });
          ledgerMs.current = performance.now() - tLed;
          markSpan("ledger", ledgerMs.current);
          if (newLook()) ledgerEvery.current = Math.min(10, Math.max(LEDGER_EVERY, ledgerMs.current / 1000 / 0.04));
        }
        // the marks: others within the view, the sealed cells (marks.ts)
        if (marks?.on) {
          const tMk = performance.now();
          marksRef.current = {
            others: marks.others.on ? otherMarks(witnessRef.current.far, p, VIEW_RADIUS, marks.others.recentSec) : [],
            concrete: marks.concrete.on ? concreteLines(snap.current.slabs, p, marks.concrete.radius, SEAL_H) : [],
          };
          markSpan("marks", performance.now() - tMk);
        } else marksRef.current = null;
        // A3: the walker's own folded stress per cell, from the ledger
        if (grass?.mode === "mine" && ledgerRef?.current) {
          const m = new Map<string, number>();
          for (const c of ledgerRef.current.cells.values()) if (c.s > 0) m.set(c.key, c.s);
          mineMap.current = m;
        } else mineMap.current = null;
      }
      // the headset: what I hear, folded from the same events
      let soundLine: string | undefined;
      const tSound = performance.now();
      if (sound) {
        if (!tonal.current || tonal.current.epochMs !== epochMs.current) tonal.current = { epochMs: epochMs.current, key: worldKey(String(epochMs.current)) };
        const sig = personalSignals({
          me: { id: me.current.id, x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 },
          events,
          sNow: sMe,
          snap: snap.current,
          stress: stress.current,
          natureCfg,
          cfg: sound.sigCfg,
          alive,
        });
        // V2 session: the visitor's motif is only given once their role is fixed (LIVE); before that the engine hears
        // nobody (no id → no motif of mine, no voices of others) and is silent (muffleSound)
        const present = !lifeRef || lifeRef.current.phase === "live";
        const asked = askerNow.current && performance.now() < askerNow.current.until ? askerNow.current : null;
        sound.engine.update(
          present ? me.current.id : "",
          present ? { ...sig, asker: asked?.o ?? null, askerWord: asked?.word ?? null, ensemble: ensembleNow.current } : { ...sig, neighbours: [] },
          muffleSound(sound.params, lifeRef?.current),
          playerYawRef?.current ?? 0,
          epochMs.current,
          tonal.current.key,
        );
        const d = sound.engine.debug;
        const k = tonal.current.key;
        soundLine = `${sound.status} · ${KEY_NAMES[k.root]} ${k.mode.name} · bar ${d.bar} ${d.chord} · lock ${d.lock.toFixed(2)} · ×${d.density}${d.answer ? " · answer" : ""} · near ${sig.neighbours.length} · path ${sig.pathP.toFixed(2)} stay ${sig.stay.toFixed(2)} sealed ${sig.sealed.toFixed(2)} · magenta ${d.magenta}${d.place ? " · 건물 " + d.place : ""}${d.phrase ? " · " + d.phrase : ""}${d.nc ? " · " + d.nc : ""}${d.found.played || d.found.waiting ? ` · 찾은 말 ${d.found.played}${d.found.last ? " (" + d.found.last + ")" : ""}${d.found.waiting ? " 대기 " + d.found.waiting : ""}` : ""}${d.dialogue ? " · " + d.dialogue : ""}${present ? "" : ` · 세션 ${lifeRef!.current.phase} (무음)`}`;
      }
      if (sound) markSpan("sound", performance.now() - tSound);
      (window as unknown as { __parliament?: ParliamentDebug }).__parliament = {
        role,
        s: +sMe.toFixed(1),
        offset: +me.current.offset.toFixed(1),
        seat: me.current.seat,
        alive: aliveN.current,
        events: log.size,
        x: +p.x.toFixed(1),
        z: +p.z.toFixed(1),
        slabs: snap.current.slabs.length,
        paths: snap.current.paths.length,
        sound: soundLine,
        fold: (() => {
          const st = fold.stats();
          return st ? `fold: cells ${st.cells} · tail ${st.tail} · rebuilds ${st.rebuilds}` : undefined;
        })(),
        ledger: ledgerRef?.current ? `ledger: ${ledgerRef.current.cells.size} cells · ${ledgerMs.current.toFixed(1)} ms` : undefined,
      };
    }
  });

  const grassReaction: GrassReaction | undefined = grass ? { mode: grass.mode, nearRadius: grass.nearRadius, nearEvery: grass.nearEvery, mineGain: grass.mineGain, thick: grass.thick } : undefined;
  // Concrete (slabs) is a trace fossil: it is not felt within one visitor's life, so the player
  // view draws only what one life can feel: the point-cloud ground (worn by workers, with dust
  // where a path has formed). Slabs appear in the Top and Side views.
  return (
    <>
      {future?.on && future.overlayOn && <FuturePresence log={log} meRef={me} getS={() => sNow.current} playerPosRef={playerPosRef} cfg={future} />}
      {future?.on && future.encounterOn && (
        <FutureEncounter log={log} meRef={me} getS={() => sNow.current} getWorldSec={() => (worldNow() - epochMs.current) / 1000} getEpochMs={() => epochMs.current} getLive={() => !lifeRef || lifeRef.current.phase === "live"} playerPosRef={playerPosRef} cfg={future} sound={sound} getYaw={() => playerYawRef?.current ?? 0} />
      )}
      {/* the scan's residue: the future found where the lidar reads while an observer is near (FutureResidue.tsx; it
          checks per frame whether it runs — under the lidar, on the scan (future) page or where every asset runs) */}
      {future && (
        <FutureResidue log={log} meRef={me} getS={() => sNow.current} getWorldSec={() => (worldNow() - epochMs.current) / 1000} getEpochMs={() => epochMs.current} getLive={() => !lifeRef || lifeRef.current.phase === "live"} playerPosRef={playerPosRef} cfg={future} />
      )}
      <group ref={present}>
      {grass?.style === "dither" || grass?.style === "field" ? (
        <DitherGround
          playerPosRef={playerPosRef}
          getStress={() => stress.current}
          getSnapshot={() => snap.current}
          getQuick={() => quickMap.current}
          cfg={natureCfg}
          radius={grass.radius}
          pixel={grass.ditherPx}
          dither={grass.style === "dither"}
          color={grass.color}
          density={grass.density}
        />
      ) : (
        <NatureCloud
          playerPosRef={playerPosRef}
          getStress={() => stress.current}
          getSnapshot={() => snap.current}
          cfg={natureCfg}
          pointSize={grass?.style === "squares" ? grass.squareSize : pointSize}
          pathDots={pathDots}
          getQuick={() => quickMap.current}
          getMine={() => mineMap.current}
          grass={grassReaction}
          flat={grass?.style === "squares" ? grass.color : undefined}
        />
      )}
      <PathLines playerPosRef={playerPosRef} getSnapshot={() => snap.current} brightness={pathLine} radius={VIEW_RADIUS} />
      {marks?.burst.on && <AnswerBurst getBurst={() => burst.current} count={marks.burst.count} reach={marks.burst.reach} lifeSec={marks.burst.lifeSec} dot={marks.burst.dot} />}
      {marks?.others.on && (
        <OtherDots
          getMarks={() => marksRef.current}
          size={marks.others.size}
          height={marks.others.height}
          bright={marks.others.bright}
          halo={marks.others.halo}
          haloStrength={marks.others.haloStrength}
          fog={marks.others.fog}
          pulseHz={marks.others.pulseHz}
          holdSec={marks.others.holdSec}
          snap={marks.others.snap}
          square={marks.others.square}
        />
      )}
      {marks?.concrete.on && marks.concrete.style === "lines" && <ConcreteLines getMarks={() => marksRef.current} height={marks.concrete.height} bright={marks.concrete.bright} />}
      {marks?.concrete.on && marks.concrete.style === "outline" && <ConcreteOutline getMarks={() => marksRef.current} scale={marks.concrete.outlineScale} />}
      </group>
    </>
  );
}
