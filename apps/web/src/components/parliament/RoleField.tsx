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
 * headset goes dull (muffleSound); after every fold a dry reading of who is near is put in `witnessRef` (HUD).
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  LS_PARLIAMENT_ME_KEY,
  ONE_FLOCK,
  SEAL_H,
  botActor,
  DEFAULT_WITNESS,
  botPlan,
  dueSamples,
  steerBot,
  getEpochMs,
  pickOffset,
  saveMerged,
  setKeepFrom,
  observe,
  sessionSeconds,
  SESSION_ROLES,
  wrapCoord,
  type Actor,
  type Flock,
  type FoldConfig,
  type NatureConfig,
  type Observation,
  type PEvent,
  type RoleId,
  type Snapshot,
  worldNow,
} from "@/lib/parliament";
import { personalSignals } from "@/lib/sound";
import { NatureCloud } from "./NatureCloud";
import { useTicker } from "./useTicker";
import type { SoundSetup } from "./useSound";
import { useFoldState, useStressState, useWorld } from "./useWorld";
import { muffleSound, type LifeSignal } from "./useLifeSession";

const VIEW_RADIUS = 24;
const FOLD_EVERY = 0.5;
const TICK_MS = 250; // emitter tick (wall clock; keeps running in a hidden tab)
const SAVE_EVERY_MS = 1000; // between mirrors to localStorage (the 3D view shows live markers from it)
const KEEP_EVERY_MS = 30_000; // how often (world time) the history window moves on (older events are dropped everywhere)
const KEEP_MIN_WALL_MS = 3000; // … but not more often than this in wall time (a fast world clock)

export interface ParliamentDebug {
  role: RoleId;
  s: number;
  offset: number;
  events: number;
  slabs: number;
  paths: number;
  /** V2: the headset sound's state (one line). */
  sound?: string;
  /** The growing fold's state (foldState.ts stats), one line. */
  fold?: string;
  /** Where the player stands (canonical world coordinates). */
  x?: number;
  z?: number;
}

/** V2: how often the ground the bots walk on (trodden paths, buildings) is refolded. */
const BOT_GROUND_EVERY_MS = 5000;

export function RoleField({
  playerPosRef,
  role,
  cfg,
  natureCfg,
  pointSize,
  offsetWindow,
  botCount,
  botRole,
  botFlock = ONE_FLOCK,
  sound = null,
  playerYawRef,
  lifeRef,
  witnessRef,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number; vx?: number; vz?: number }>;
  role: RoleId;
  cfg: FoldConfig;
  natureCfg: NatureConfig;
  pointSize: number;
  offsetWindow: number;
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
}) {
  const pending = useRef<PEvent[]>([]);
  const log = useWorld(() => {
    pending.current = [];
    epochMs.current = getEpochMs(); // the world was cleared: join the NEW epoch (and its history window is unset)
  });
  const epochMs = useRef(0);
  // the ground, folded as it grows (foldState.ts): the whole world is folded, the region only chooses what is read
  const fold = useFoldState(log, cfg);
  const stressAt = useStressState(log, natureCfg);
  const me = useRef({ id: "v_anon", offset: 0, tag: "t" });
  const seq = useRef(0);
  const lastSampleMs = useRef(0);
  const botStartMs = useRef(0);
  const lastSaveMs = useRef(0);
  const lastKeepMs = useRef(0);
  const lastKeepWall = useRef(0);
  const foldTimer = useRef(10);
  // the ticker reads the latest Leva values through this ref
  const live = useRef({ role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec, cfg, fold });
  // V2: what bots walk on — trodden ground (G per cell) and the cells buildings stand on; refreshed every few seconds
  const botGround = useRef<{ at: number; level: Map<string, number>; built: Set<string> } | null>(null);
  // V2: each migration's route, chosen once (on the ground as it was) and kept until it is over
  const botRoutes = useRef(new Map<string, number[]>());
  useEffect(() => {
    live.current = { role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec, cfg, fold };
  }, [role, botCount, botRole, botFlock, cfg, fold]);
  const snap = useRef<Snapshot | null>(null);
  const stress = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    epochMs.current = getEpochMs();
    me.current = {
      id: "v_" + Math.random().toString(36).slice(2, 7),
      offset: pickOffset(Math.random(), offsetWindow),
      tag: Math.random().toString(36).slice(2, 6),
    };
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

  const emit = (o: string, r: RoleId, k: PEvent["k"], x: number, z: number, s: number) => {
    // the world is finite and wraps (world.ts): every stored coordinate is canonical
    const e: PEvent = { id: `${o}:${me.current.tag}:${seq.current++}`, o, r, k, x: wrapCoord(x), z: wrapCoord(z), s };
    log.add(e);
    pending.current.push(e);
  };

  // ── emit presence and mirror to localStorage: world clock (worldClock.ts, may run faster than the wall clock) for
  //    the samples and the bots, wall clock for the work done between them; also while hidden ──
  useTicker(TICK_MS, () => {
    if (epochMs.current === 0) return;
    const now = worldNow();
    const wall = Date.now();
    const { role: myRole, botCount: nBots, botRole: theirRole, botFlock: flock, sampleSec, cfg: foldCfg, fold: theFold } = live.current;
    // V2: bots walk where others walked (bundling) and around buildings (detour)
    const flow = foldCfg.flow?.enabled ? foldCfg.flow : null;
    if (flow && nBots > 0 && (!botGround.current || wall - botGround.current.at >= BOT_GROUND_EVERY_MS)) {
      const tSess = sessionSeconds(now, epochMs.current, me.current.offset);
      const snapAll = theFold.at(tSess); // the whole world: what the bots walk on
      const level = new Map<string, number>();
      for (const pc of snapAll.paths) level.set(pc.key, -flow.unit * Math.log(1 - Math.min(0.999, pc.p)));
      const built = new Set<string>();
      // buildings in use now (a ruin — nobody around for longer than emptyGapSec — can be crossed)
      for (const sl of snapAll.slabs) if (sl.h >= SEAL_H && tSess - sl.lastS <= foldCfg.emptyGapSec) built.add(sl.key);
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
    if (now - lastKeepMs.current >= KEEP_EVERY_MS && wall - lastKeepWall.current >= KEEP_MIN_WALL_MS) {
      lastKeepMs.current = now;
      lastKeepWall.current = wall;
      setKeepFrom(sessionSeconds(now, epochMs.current, me.current.offset));
    }
    if (wall - lastSaveMs.current >= SAVE_EVERY_MS) {
      lastSaveMs.current = wall;
      if (pending.current.length) {
        // false = this tab's epoch has ended; useWorld's poll makes it join the new one
        saveMerged(pending.current, epochMs.current);
        pending.current = [];
      }
    }
  });

  useFrame((_, delta) => {
    if (epochMs.current === 0) return;
    const dt = Math.min(delta, 0.05);
    const sMe = sessionSeconds(worldNow(), epochMs.current, me.current.offset);
    const p = playerPosRef.current;

    // ── fold what this visitor can see at their own time ──
    foldTimer.current += dt;
    if (foldTimer.current >= FOLD_EVERY) {
      foldTimer.current = 0;
      const events = log.all();
      snap.current = fold.at(sMe, { x: p.x, z: p.z, r: VIEW_RADIUS });
      stress.current = stressAt(sMe, { x: p.x, z: p.z, r: VIEW_RADIUS });
      if (witnessRef) {
        witnessRef.current = observe({
          me: { id: me.current.id, x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 },
          events,
          sNow: sMe,
          snap: snap.current,
          t: lifeRef?.current.t ?? 0,
          cfg: { ...DEFAULT_WITNESS, nearRadius: cfg.radius },
        });
      }
      // the headset: what I hear, folded from the same events
      let soundLine: string | undefined;
      if (sound) {
        const sig = personalSignals({
          me: { id: me.current.id, x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 },
          events,
          sNow: sMe,
          snap: snap.current,
          stress: stress.current,
          natureCfg,
          cfg: sound.sigCfg,
        });
        // V2 session: the visitor's motif is only given once their role is fixed (LIVE); before that the engine hears
        // nobody (no id → no motif of mine, no voices of others) and is silent (muffleSound)
        const present = !lifeRef || lifeRef.current.phase === "live";
        sound.engine.update(
          present ? me.current.id : "",
          present ? sig : { ...sig, neighbours: [] },
          muffleSound(sound.params, lifeRef?.current),
          playerYawRef?.current ?? 0,
          epochMs.current,
        );
        const d = sound.engine.debug;
        soundLine = `${d.key}${d.building ? " (building " + d.building + ")" : " (home)"} · bar ${d.bar} ${d.chord} · stable ${d.stable.toFixed(2)} rough ${d.rough.toFixed(2)} lock ${d.lock.toFixed(2)} · ×${d.density}${d.answer ? " · answer" : ""} · near ${sig.neighbours.length} · path ${sig.pathP.toFixed(2)} stay ${sig.stay.toFixed(2)} sealed ${sig.sealed.toFixed(2)} · magenta ${d.magenta}${d.phrase ? " · " + d.phrase : ""}`;
      }
      (window as unknown as { __parliament?: ParliamentDebug }).__parliament = {
        role,
        s: +sMe.toFixed(1),
        offset: +me.current.offset.toFixed(1),
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
      };
    }
  });

  // Concrete (slabs) is a trace fossil: it is not felt within one visitor's life, so the player
  // view draws only what one life can feel: the point-cloud ground (worn by workers, with dust
  // where a path has formed). Slabs appear in the Top and Side views.
  return (
    <>
      <NatureCloud
        playerPosRef={playerPosRef}
        getStress={() => stress.current}
        getSnapshot={() => snap.current}
        cfg={natureCfg}
        pointSize={pointSize}
      />
    </>
  );
}
