"use client";

/**
 * FramePeopleLayer — THE BOTS AS THE FRAMES STUDY DRAWS PEOPLE (the artist, 2026-11-23: "이제 슬슬 봇 랩에 연결해보자").
 * PointPeople's mode "frames": every arrival of a bot's place (the bot server writes one a second) leaves a frame standing
 * where it came, facing the way it went, playing its clip at the original video's pace and fading with its state's
 * afterimage life; between arrivals the body now walks on at the pace and way the last two arrivals gave. Which clip, how
 * tall, what colour flows inside, the distance hierarchy, fading when passing through me or turning edge-on — all as
 * decided on /lab/mobile/frames (read from its saved values, framePeople.ts draws them). A bot standing still leaves a
 * frame where it stands once an arrival span. By default the body runs one arrival span behind, walking from each to
 * the next in a whole number of steps, both feet down as it arrives.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { nearestImage, type Other } from "@/lib/parliament";
import { savedGroup } from "./levaSave";
import { LAB_GROUP } from "./mobileLab";
import { loadSpriteList, loadSpriteSheet, type SpriteIndex } from "./spritePeople";
import {
  TAU,
  drawFrames,
  frac,
  gradStartFrom,
  keepSecOf,
  lookFromValues,
  makeFrameGeometry,
  makeMaterial,
  makeSideMaterial,
  multiplies,
  prepareWalkers,
  setBlend,
  setsFromValues,
  stateOfWalker,
  type ClipInfo,
  type Look,
  type Walker,
} from "./framePeople";

/** A bot as a walker of frames: its last place and when it came, its measured pace (m/s), still or not. */
interface BotWalker extends Walker {
  lastT: number;
  mps: number;
  still: boolean;
  seen: number;
}

/** A place this far from the last (m) is the world wrapping, not a walk: the frames start over. */
const JUMP_M = 20;
/** Below this pace (m/s) a bot stands. */
const STILL_MPS = 0.15;

function idHash(o: string): number {
  let h = 2166136261;
  for (let i = 0; i < o.length; i++) h = Math.imul(h ^ o.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export function FramePeopleLayer({
  getList,
  playerPosRef,
  unit,
  asking,
  hop = true,
  askSolid = true,
  askScale = 1.15,
}: {
  getList: () => readonly Other[] | null;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  unit: number;
  /** Who is asking me something, until when (performance.now ms) — PointPeople's, from the life events. */
  asking?: React.MutableRefObject<Map<string, number>>;
  hop?: boolean;
  askSolid?: boolean;
  askScale?: number;
}) {
  const gl = useThree((st) => st.gl);
  const camera = useThree((st) => st.camera);
  const geom = useMemo(() => makeFrameGeometry(), []);
  const mat = useMemo(() => {
    const m = makeMaterial();
    // (in the street the frames stand among things: behind a building they are hidden)
    m.depthTest = true;
    return m;
  }, []);
  const sideMat = useMemo(() => {
    const m = makeSideMaterial(mat);
    m.depthTest = true;
    return m;
  }, [mat]);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => sideMat.dispose(), [sideMat]);
  const idx = useRef<SpriteIndex | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  // the study's values as saved (this page does not show its knobs), the clips it uses packed into one texture
  useEffect(() => {
    let live = true;
    loadSpriteList()
      .then((sheet) => {
        if (!live) return;
        const G = LAB_GROUP.frames;
        const clips: ClipInfo[] = sheet.rows.map((r) => {
          const x = r as unknown as Record<string, unknown>;
          return { id: r.id, strideSec: r.strideSec, loop: Number(x.loop ?? 1), lum: Number(x.lum ?? 0), side: r.view === "side", walking: x.walking !== false, fill: Number(x.fill ?? 1), faces: Number(x.faces ?? 0), ds: Array.isArray(x.ds) ? (x.ds as number[]) : undefined };
        });
        const main = savedGroup(G);
        const sets = setsFromValues(savedGroup(`${G}.클립`, [`${G}.클립 — 이동거리 · 프레임 간격`]), clips);
        const old = (k: string, d: number) => {
          const v = Number(main[k]);
          return Number.isFinite(v) ? v : d;
        };
        // (bots: each by its own measured pace, a clip by its state — never the study's fixed clip)
        const L = { ...lookFromValues(main, sets, 0, gradStartFrom(old)), speedMode: 1, row: 0 };
        setLook(L);
        return loadSpriteSheet(gl, (_r, i) => sets[i]?.state !== "none").then(({ index, texture }) => {
          if (!live) return;
          idx.current = index;
          mat.uniforms.uSheet.value = texture;
          mat.uniforms.uCols.value = index.sheet.cols;
          mat.uniforms.uPer.value = index.per;
          mat.uniforms.uAtlasRows.value = index.atlasRows;
          mat.uniforms.uAspect.value = index.sheet.cellW / index.sheet.cellH;
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gl, mat]);
  useEffect(() => {
    if (!look) return;
    // (white pictograms lay over the ground; the street's ground itself is the scan's — black for them)
    setBlend(mat, multiplies(look));
    setBlend(sideMat, multiplies(look));
  }, [look, mat, sideMat]);

  const bots = useRef(new Map<string, BotWalker>());
  const lastList = useRef<readonly Other[] | null>(null);

  useFrame((state, delta) => {
    const L = look;
    if (!L) return;
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    const me = playerPosRef.current;
    const B = bots.current;
    const span = Math.max(1, L.sampleSec);
    // ARRIVALS: a bot's place changed → a frame where it came, facing the way it went
    const list = getList();
    if (list && list !== lastList.current) {
      lastList.current = list;
      for (const o of list) {
        const tx = nearestImage(o.x, me.x), tz = nearestImage(o.z, me.z);
        let w = B.get(o.o);
        if (!w) {
          const hash = idHash(o.o);
          w = { id: o.o, hash, x: tx, z: tz, h: hash * TAU, ph: hash, s: 0, dir: 1, gx: 0, gz: 0, hist: [], stamps: [{ t: now, x: tx, z: tz, h: hash * TAU, ph: 0 }], lastHist: -1, lastSample: now, home: 0, standing: !o.moving, speed: 0, gap: 0.08, cycle: 1.3, lastT: now, mps: 0, still: !o.moving, seen: now };
          B.set(o.o, w);
          continue;
        }
        w.seen = now;
        const dx = tx - w.x, dz = tz - w.z;
        const d = Math.hypot(dx, dz) / unit;
        if (d > 0.01) {
          if (d > JUMP_M) w.stamps.length = 0;
          else {
            const since = Math.min(3, Math.max(0.2, now - w.lastT));
            w.mps = d / since;
            w.h = Math.atan2(dx, dz);
          }
          w.x = tx;
          w.z = tz;
          w.lastT = now;
          w.lastSample = now;
          w.stamps.unshift({ t: now, x: tx, z: tz, h: w.h, ph: 0 });
        }
        w.still = !o.moving || w.mps < STILL_MPS;
      }
    }
    // a bot standing still: a frame where it stands once an arrival span; one gone from the list: dropped once faded
    const W: BotWalker[] = [];
    const nowMs = performance.now();
    for (const [id, w] of B) {
      // ASKING ME SOMETHING (a word asked, until answered or the question closes — PointPeople's `asking`, from the life
      // events): the head hops on its melody, it stays
      // solid near me, a little larger
      const askingMe = (asking?.current.get(id) ?? 0) > nowMs;
      w.talking = hop && askingMe;
      w.solid = askSolid && askingMe;
      w.boost = askingMe ? askScale : 1;
      if (w.still && now - w.lastSample >= span) {
        w.lastSample = now;
        w.stamps.unshift({ t: now, x: w.x, z: w.z, h: w.h, ph: 0 });
      }
      const life = L.trails[stateOfWalker(L, w)].life + span;
      while (w.stamps.length && now - w.stamps[w.stamps.length - 1].t > life) w.stamps.pop();
      if (now - w.seen > keepSecOf(L) + span && !w.stamps.length) {
        B.delete(id);
        continue;
      }
      w.ph = frac(w.ph + dt / Math.max(1e-3, w.cycle));
      W.push(w);
    }
    prepareWalkers(W, L, idx.current?.sheet.cols ?? 16, (w) => ({ speed: (w as BotWalker).mps, standing: (w as BotWalker).still }));
    const n = drawFrames(geom, mat, L, idx.current, W, camera.position, now, unit);
    (window as unknown as { __framesBots?: unknown }).__framesBots = { cards: n, bots: W.length };
  });

  // (pictograms: one card a bot, no thickness)
  const thickOn = !!look && !look.pix && (look.thick > 0 || look.thickFill) && look.thickInk > 0;
  return (
    <>
      <mesh geometry={geom} material={mat} frustumCulled={false} renderOrder={10} />
      {thickOn && <mesh geometry={geom} material={sideMat} frustumCulled={false} renderOrder={10} />}
    </>
  );
}
