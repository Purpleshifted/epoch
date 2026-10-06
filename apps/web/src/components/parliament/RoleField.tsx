"use client";
/**
 * RoleField: the player view's world. The visitor (and optional debug bots) leave presence events
 * according to their role; what is drawn is the fold of the shared log at the visitor's ASSIGNED
 * time, so traces left by visitors who are "later" than this one are invisible.
 *
 * Only the worker role has an effect so far (slabs where workers crowd in spacetime, cigarette
 * filters now and then); the other roles still log presence for when their rules are written.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  getEpochMs,
  foldWorld,
  pickOffset,
  saveMerged,
  sessionSeconds,
  type FoldConfig,
  type PEvent,
  type RoleId,
  type Snapshot,
} from "@/lib/parliament";
import { StructureMesh } from "@/components/parliament/StructureMesh";
import { useWorld } from "@/components/parliament/useWorld";

const VIEW_RADIUS = 30;      // world units around the visitor in which structures are folded and drawn
const FOLD_EVERY = 0.5;      // s between folds
const WRITE_EVERY = 3;       // s between localStorage writes
const FILTER_EVERY_SEC = 15; // a working visitor lights a cigarette this often (assigned seconds)

interface Actor {
  id: string;
  role: RoleId;
  offset: number;
  lastFilterS: number;
}

export function RoleField({
  playerPosRef,
  role,
  botCount,
  botRole,
  cfg,
  offsetWindow,
  heightUnit = 0.6,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  role: RoleId;
  botCount: number;
  botRole: RoleId;
  cfg: FoldConfig;
  offsetWindow: number;
  heightUnit?: number;
}) {
  const world = useWorld();
  const log = world.log;
  const epochMs = useRef(0);
  const tag = useRef("");
  const me = useRef<Actor>({ id: "", role, offset: 0, lastFilterS: -1e9 });
  const bots = useRef(new Map<string, Actor>());
  const seq = useRef(0);
  const pending = useRef<PEvent[]>([]);
  const emitAcc = useRef(0);
  const foldAcc = useRef(FOLD_EVERY);
  const writeAcc = useRef(0);
  const clock = useRef(0);
  const snap = useRef<Snapshot | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    epochMs.current = getEpochMs();
    tag.current = Math.random().toString(36).slice(2, 7);
    me.current = { id: `v_${tag.current}`, role, offset: pickOffset(Math.random(), offsetWindow), lastFilterS: -1e9 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (a: Actor, k: "p" | "f", x: number, z: number, s: number) => {
    const e: PEvent = { id: `${a.id}:${tag.current}:${seq.current++}`, o: a.id, r: a.role, k, x, z, s };
    log.add(e);
    pending.current.push(e);
  };

  const step = (a: Actor, x: number, z: number, s: number) => {
    emit(a, "p", x, z, s);
    if (a.role === "worker" && s - a.lastFilterS >= FILTER_EVERY_SEC) {
      if (a.lastFilterS > -1e8) emit(a, "f", x, z, s); // the first interval only starts the clock
      a.lastFilterS = s;
    }
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.25);
    clock.current += dt;
    const now = Date.now();
    const sMe = sessionSeconds(now, epochMs.current, me.current.offset);
    me.current.role = roleRef.current;

    // ── bots: a few debug visitors who circle the origin, each with its own offset near ours ──
    for (let i = 0; i < botCount; i++) {
      const id = `bot${i}`;
      let b = bots.current.get(id);
      if (!b) {
        b = { id, role: botRole, offset: Math.max(0, me.current.offset - 20 + ((i * 7) % 25)), lastFilterS: -1e9 };
        bots.current.set(id, b);
      }
      b.role = botRole;
    }

    // ── emit presence samples ──
    emitAcc.current += dt;
    while (emitAcc.current >= cfgRef.current.sampleSec) {
      emitAcc.current -= cfgRef.current.sampleSec;
      const p = playerPosRef.current;
      step(me.current, p.x, p.z, sMe);
      for (let i = 0; i < botCount; i++) {
        const b = bots.current.get(`bot${i}`)!;
        const R = 1 + (i % 4) * 1.1;
        const w = (0.18 + 0.05 * (i % 4)) * (i % 2 ? 1 : -1);
        const ang = clock.current * w + i * 2.399963;
        step(b, Math.cos(ang) * R, Math.sin(ang) * R, sessionSeconds(now, epochMs.current, b.offset));
      }
    }

    // ── mirror to localStorage (stand-in for the server) ──
    writeAcc.current += dt;
    if (writeAcc.current >= WRITE_EVERY) {
      writeAcc.current = 0;
      if (pending.current.length) {
        saveMerged(pending.current);
        pending.current = [];
      }
    }

    // ── fold the world at my assigned time ──
    foldAcc.current += dt;
    if (foldAcc.current >= FOLD_EVERY) {
      foldAcc.current = 0;
      const p = playerPosRef.current;
      snap.current = foldWorld(log.all(), sMe, cfgRef.current, { x: p.x, z: p.z, r: VIEW_RADIUS });
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __parliament?: unknown }).__parliament = {
          role: roleRef.current,
          s: +sMe.toFixed(1),
          events: log.size,
          slabs: snap.current.slabs.length,
          filters: snap.current.filters.length,
        };
      }
    }
  });

  return <StructureMesh getSnapshot={() => snap.current} heightUnit={heightUnit} />;
}
