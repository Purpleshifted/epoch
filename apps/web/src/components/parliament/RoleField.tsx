"use client";
/**
 * RoleField — what the player's role leaves behind, seen from the player's own time.
 *
 * - Emits spacetime events: a presence sample every `sampleSec` seconds (all roles) and, for
 *   the worker, a cigarette filter every FILTER_EVERY seconds.
 * - The visitor has an assigned time s(t) = wall seconds since the epoch + a personal offset;
 *   it flows while they are here. Only events with s <= s(now) are folded and drawn, so a
 *   visitor never sees what later visitors leave.
 * - Events are mirrored into localStorage (stand-in for the shared server) every 3 s.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  getEpochMs,
  foldWorld,
  pickOffset,
  saveMerged,
  sessionSeconds,
  stressMap,
  type FoldConfig,
  type NatureConfig,
  type PEvent,
  type RoleId,
  type Snapshot,
} from "@/lib/parliament";
import { FilterMesh } from "./FilterMesh";
import { NatureCloud } from "./NatureCloud";
import { useWorld } from "./useWorld";

const VIEW_RADIUS = 24;
const FOLD_EVERY = 0.5;
const SAVE_EVERY = 3;
const FILTER_EVERY = 15; // a worker's smoking break, in assigned seconds

export interface ParliamentDebug {
  role: RoleId;
  s: number;
  offset: number;
  events: number;
  slabs: number;
  filters: number;
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
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  role: RoleId;
  cfg: FoldConfig;
  natureCfg: NatureConfig;
  pointSize: number;
  offsetWindow: number;
  botCount: number;
  botRole: RoleId;
}) {
  const pending = useRef<PEvent[]>([]);
  const log = useWorld(() => {
    pending.current = [];
  });
  const epochMs = useRef(0);
  const me = useRef({ id: "v_anon", offset: 0, tag: "t" });
  const seq = useRef(0);
  const clock = useRef(0);
  const sampleTimer = useRef(0);
  const foldTimer = useRef(10);
  const saveTimer = useRef(0);
  const sinceFilter = useRef(new Map<string, number>());
  const snap = useRef<Snapshot | null>(null);
  const stress = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    epochMs.current = getEpochMs();
    me.current = {
      id: "v_" + Math.random().toString(36).slice(2, 7),
      offset: pickOffset(Math.random(), offsetWindow),
      tag: Math.random().toString(36).slice(2, 6),
    };
    const flush = () => {
      if (pending.current.length) {
        saveMerged(pending.current);
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

  useFrame((_, delta) => {
    if (epochMs.current === 0) return;
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const wall = Date.now();
    const sMe = sessionSeconds(wall, epochMs.current, me.current.offset);
    const p = playerPosRef.current;

    // ── emit presence (and the worker's filter) ──
    sampleTimer.current += dt;
    while (sampleTimer.current >= cfg.sampleSec) {
      sampleTimer.current -= cfg.sampleSec;
      const actors: { o: string; r: RoleId; x: number; z: number; s: number }[] = [
        { o: me.current.id, r: role, x: p.x, z: p.z, s: sMe },
      ];
      for (let i = 0; i < botCount; i++) {
        const R = 1 + (i % 4) * 1.1;
        const w = (0.18 + 0.05 * (i % 4)) * (i % 2 ? 1 : -1);
        const a = clock.current * w + i * 2.399963;
        // bots live in nearly the same time slot as the player (some a little ahead: invisible at first)
        const off = Math.max(0, me.current.offset - 20 + ((i * 7) % 25));
        actors.push({ o: `bot${i}`, r: botRole, x: Math.cos(a) * R, z: Math.sin(a) * R, s: sessionSeconds(wall, epochMs.current, off) });
      }
      for (const a of actors) {
        emit(a.o, a.r, "p", a.x, a.z, a.s);
        if (a.r === "worker") {
          const t = (sinceFilter.current.get(a.o) ?? 0) + cfg.sampleSec;
          if (t >= FILTER_EVERY) {
            emit(a.o, a.r, "f", a.x, a.z, a.s);
            sinceFilter.current.set(a.o, 0);
          } else sinceFilter.current.set(a.o, t);
        }
      }
    }

    // ── mirror to localStorage ──
    saveTimer.current += dt;
    if (saveTimer.current >= SAVE_EVERY) {
      saveTimer.current = 0;
      if (pending.current.length) {
        saveMerged(pending.current);
        pending.current = [];
      }
    }

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
        filters: snap.current.filters.length,
        paths: snap.current.paths.length,
      };
    }
  });

  // Concrete (slabs) is a trace fossil: it is not felt within one visitor's life, so the player
  // view draws only what one life can feel: the point-cloud ground (worn by workers, with dust
  // where a path has formed) and the short-lived filters. Slabs appear in the Top and Side views.
  return (
    <>
      <NatureCloud
        playerPosRef={playerPosRef}
        getStress={() => stress.current}
        getSnapshot={() => snap.current}
        cfg={natureCfg}
        pointSize={pointSize}
      />
      <FilterMesh getSnapshot={() => snap.current} />
    </>
  );
}
