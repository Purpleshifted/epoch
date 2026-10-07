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
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  LS_PARLIAMENT_ME_KEY,
  ONE_FLOCK,
  botActor,
  dueSamples,
  getEpochMs,
  foldWorld,
  pickOffset,
  saveMerged,
  setKeepFrom,
  sessionSeconds,
  stressMap,
  type Actor,
  type Flock,
  type FoldConfig,
  type NatureConfig,
  type PEvent,
  type RoleId,
  type Snapshot,
} from "@/lib/parliament";
import { NatureCloud } from "./NatureCloud";
import { useTicker } from "./useTicker";
import { useWorld } from "./useWorld";

const VIEW_RADIUS = 24;
const FOLD_EVERY = 0.5;
const TICK_MS = 250; // emitter tick (wall clock; keeps running in a hidden tab)
const SAVE_EVERY_MS = 1000; // between mirrors to localStorage (the 3D view shows live markers from it)

export interface ParliamentDebug {
  role: RoleId;
  s: number;
  offset: number;
  events: number;
  slabs: number;
  paths: number;
}

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
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  role: RoleId;
  cfg: FoldConfig;
  natureCfg: NatureConfig;
  pointSize: number;
  offsetWindow: number;
  botCount: number;
  botRole: RoleId;
  /** How the bots spread over the ground (flocks). */
  botFlock?: Flock;
}) {
  const pending = useRef<PEvent[]>([]);
  const log = useWorld(() => {
    pending.current = [];
    epochMs.current = getEpochMs(); // the world was cleared: join the NEW epoch (and its history window is unset)
  });
  const epochMs = useRef(0);
  const me = useRef({ id: "v_anon", offset: 0, tag: "t" });
  const seq = useRef(0);
  const lastSampleMs = useRef(0);
  const botStartMs = useRef(0);
  const lastSaveMs = useRef(0);
  const foldTimer = useRef(10);
  // the ticker reads the latest Leva values through this ref
  const live = useRef({ role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec });
  useEffect(() => {
    live.current = { role, botCount, botRole, botFlock, sampleSec: cfg.sampleSec };
  }, [role, botCount, botRole, botFlock, cfg.sampleSec]);
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
    setKeepFrom(sessionSeconds(Date.now(), epochMs.current, me.current.offset));
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
    const e: PEvent = { id: `${o}:${me.current.tag}:${seq.current++}`, o, r, k, x, z, s };
    log.add(e);
    pending.current.push(e);
  };

  // ── emit presence and mirror to localStorage: wall clock, also while hidden ──
  useTicker(TICK_MS, () => {
    if (epochMs.current === 0) return;
    const now = Date.now();
    const { role: myRole, botCount: nBots, botRole: theirRole, botFlock: flock, sampleSec } = live.current;
    const period = Math.max(50, sampleSec * 1000);
    if (lastSampleMs.current === 0) lastSampleMs.current = now - period;
    const due = dueSamples(lastSampleMs.current, now, period);
    if (due.length) lastSampleMs.current = due[due.length - 1];
    if (nBots <= 0) botStartMs.current = 0;
    else if (botStartMs.current === 0) botStartMs.current = now;
    const p = playerPosRef.current;

    for (const w of due) {
      const actors: Actor[] = [];
      // the visitor is only where they stand NOW: after a freeze their missed samples are not backfilled
      if (now - w < period * 1.5) actors.push({ o: me.current.id, r: myRole, x: p.x, z: p.z, s: sessionSeconds(w, epochMs.current, me.current.offset) });
      for (let i = 0; i < nBots; i++) actors.push(botActor(i, theirRole, w, botStartMs.current, epochMs.current, me.current.offset, flock));
      for (const a of actors) emit(a.o, a.r, "p", a.x, a.z, a.s);
    }

    if (now - lastSaveMs.current >= SAVE_EVERY_MS) {
      lastSaveMs.current = now;
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
    const sMe = sessionSeconds(Date.now(), epochMs.current, me.current.offset);
    const p = playerPosRef.current;

    // ── fold what this visitor can see at their own time ──
    foldTimer.current += dt;
    if (foldTimer.current >= FOLD_EVERY) {
      foldTimer.current = 0;
      const events = log.all();
      snap.current = foldWorld(events, sMe, cfg, { x: p.x, z: p.z, r: VIEW_RADIUS });
      stress.current = stressMap(events, sMe, natureCfg, { x: p.x, z: p.z, r: VIEW_RADIUS });
      (window as unknown as { __parliament?: ParliamentDebug }).__parliament = {
        role,
        s: +sMe.toFixed(1),
        offset: +me.current.offset.toFixed(1),
        events: log.size,
        slabs: snap.current.slabs.length,
        paths: snap.current.paths.length,
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
