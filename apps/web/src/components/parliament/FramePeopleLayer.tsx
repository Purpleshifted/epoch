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
import { DEFAULT_WITNESS, individualNo, nearestImage, rhythmOf, type Other } from "@/lib/parliament";
import { musicNow } from "./musicClock";
import { onLifeEvent } from "./lifeEvents";
import { savedGroup } from "./levaSave";
import { lidarActive } from "./LidarScan";
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
  personHeight,
  PICTO_LAYER,
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
type Rect = { x0: number; y0: number; x1: number; y1: number };

interface BotWalker extends Walker {
  lastT: number;
  mps: number;
  still: boolean;
  seen: number;
  /** Asking me something now (the tracking box's bold one). */
  asks?: boolean;
  /** Where it is held while its question is open, and when it was let go (it walks back over 0.8 s). */
  pin?: { x: number; z: number };
  relAt?: number;
}

/** A body in the street as PointPeople keeps it: its place, way and pace (world units), its fade; on the white ground the
 *  body that walks on its own between the samples. */
export interface StreetBody {
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  alpha: number;
  body: { x: number; z: number; vx: number; vz: number; heading: number };
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
  size = 1,
  blur = 0,
  track = 2,
  trackRadius = 4,
  pins,
  getPeople,
  paper = false,
}: {
  getList: () => readonly Other[] | null;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  unit: number;
  /** Who is asking me something, until when (performance.now ms) — PointPeople's, from the life events. */
  asking?: React.MutableRefObject<Map<string, number>>;
  hop?: boolean;
  askSolid?: boolean;
  askScale?: number;
  /** The pictograms' size × (all of them; the bot lab's knob). */
  size?: number;
  /** The pictograms' own blur (0 = crisp; the bot lab's knob). */
  blur?: number;
  /** TRACKED (the artist, 2026-11-25: "나랑 interact 중인애들한테 touchdesigner blob 처럼 사각형 실시간으로 트랙되도록"): a
   *  shape drawn round each one with me on the screen, every frame — 0 none, 1 who asks me something and who builds with
   *  me, 2 those and whoever is within `trackRadius` (m). */
  track?: number;
  trackRadius?: number;
  /** Where those held while they talk with me are drawn (for the melody bubble over their heads). */
  pins?: React.MutableRefObject<Map<string, { x: number; z: number }>>;
  /** THE PEOPLE WHERE THE STREET ALREADY HAS THEM (the artist, 2026-11-24: "픽토그램 이거 이 자리에서 그려내도록 하면 안
   *  되나? … 그냥 네모 상자일 때는 안 이랬잖아"): PointPeople's own moving bodies — a pictogram drawn right there, one a
   *  person, facing me, no arrivals, no lag. Given, it replaces the arrivals' frames. */
  getPeople?: () => ReadonlyMap<string, StreetBody>;
  /** The white ground: the body that walks on its own (`body`), else the person's own place. */
  paper?: boolean;
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
    setBlend(mat, !look.pix && multiplies(look));
    setBlend(sideMat, !look.pix && multiplies(look));
  }, [look, mat, sideMat]);

  // the tracking boxes: a 2D canvas over the scene's (nothing on the GPU), cleared and drawn each frame
  const overlay = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2";
    parent.appendChild(cv);
    overlay.current = cv;
    return () => {
      cv.remove();
      overlay.current = null;
    };
  }, [gl]);
  // building together, as the record says it ("합주 중… 함께 집을 짓습니다" → until it ends): I stay, and someone near
  // stays too (witness.ts)
  const together = useRef(false);
  const storyRef = useRef<{ ids: string[]; n: number; until: number } | null>(null);
  const bondsRef = useRef(new Map<string, number>());
  useEffect(
    () =>
      onLifeEvent((e) => {
        // (a story's voices stay bound for nine seconds; a bond stays for the life)
        if (e.kind === "story.born") storyRef.current = { ids: e.with ?? [], n: e.n ?? (e.with?.length ?? 2), until: performance.now() + 9000 };
        else if (e.kind === "bond.again" && e.who) bondsRef.current.set(e.who, e.n ?? 2);
        if (e.kind === "life.begin") bondsRef.current.clear();
        if (e.kind === "ensemble.start") together.current = true;
        else if (e.kind === "ensemble.end" || e.kind === "life.begin" || e.kind === "ended") together.current = false;
      }),
    [],
  );
  const bots = useRef(new Map<string, BotWalker>());
  const lastList = useRef<readonly Other[] | null>(null);

  useFrame((state, delta) => {
    if (!look) return;
    // (in the street the pictograms stand where the bodies are: nothing left at arrivals, no delay — always facing me, the
    // pictogram's own)
    // (the pictogram's ink by the street's ground — black on the white paper, white on the black, the lidar's included
    // (it reads the white pipeline onto black) — laid over, never multiplied; its blur its own)
    const pixOwn = { pixBlur: blur, pixWhite: !paper || lidarActive(), multiply: look.pix ? false : look.multiply };
    const L: Look = getPeople ? { ...look, standMode: false, stamp: false, ...pixOwn } : { ...look, ...pixOwn };
    // (their own layer: the street's plain render draws it with the rest; InkPaper leaves it out of its softening)
    state.camera.layers.enable(PICTO_LAYER); // (InkPaper sets the camera's layers for each of its passes itself)
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    const me = playerPosRef.current;
    const B = bots.current;
    const span = Math.max(1, L.sampleSec);
    // ARRIVALS: a bot's place changed → a frame where it came, facing the way it went
    const list = getPeople ? null : getList();
    if (getPeople) {
      const P = getPeople();
      const heldNowMs = performance.now();
      for (const [id, p] of P) {
        const src = paper ? p.body : p;
        let w = B.get(id);
        if (!w) {
          const hash = idHash(id);
          w = { id, hash, x: src.x, z: src.z, h: src.heading, ph: hash, s: 0, dir: 1, gx: 0, gz: 0, hist: [], stamps: [], lastHist: -1, lastSample: now, home: 0, standing: true, speed: 0, gap: 0.08, cycle: 1.3, lastT: now, mps: 0, still: true, seen: now };
          B.set(id, w);
        }
        // HELD WHILE WE TALK (the artist, 2026-11-27: "대화 오가는 동안은 멜로디 쌓일 때까지 그 봇이 달아나거나 블롭이
        // 사라지지 않도록"): whoever has a question open with me stays drawn where they stood when they asked — the bot
        // itself goes on in the world (the server's) — and walks back to its own place once it closes
        const held = (asking?.current.get(id) ?? 0) > heldNowMs;
        if (held) {
          w.pin ??= { x: w.x, z: w.z };
          w.relAt = undefined;
        } else if (w.pin && w.relAt === undefined) w.relAt = now;
        let back = 1;
        if (w.pin) {
          back = held ? 0 : Math.min(1, (now - (w.relAt ?? now)) / 0.8);
          w.x = w.pin.x + (src.x - w.pin.x) * back;
          w.z = w.pin.z + (src.z - w.pin.z) * back;
          if (back >= 1) w.pin = w.relAt = undefined;
        } else {
          w.x = src.x;
          w.z = src.z;
        }
        w.mps = held ? 0 : Math.hypot(src.vx, src.vz) / unit;
        if (w.mps > STILL_MPS) w.h = Math.atan2(src.vx, src.vz);
        w.still = w.mps < STILL_MPS;
        w.fade = held ? 1 : p.alpha;
        w.seen = now;
        if (held) pins?.current.set(id, { x: w.x, z: w.z });
        else pins?.current.delete(id);
      }
      // (one gone from the street while its question is open stays, held, until it closes)
      for (const id of [...B.keys()]) {
        if (P.has(id)) continue;
        if ((asking?.current.get(id) ?? 0) > heldNowMs) continue;
        B.delete(id);
        pins?.current.delete(id);
      }
    }
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
      w.asks = askingMe;
      w.talking = hop && askingMe;
      w.solid = askSolid && askingMe;
      w.boost = (askingMe ? askScale : 1) * size;
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
    // THE BLOB TRACKING (TouchDesigner's look), A SHAPE A KIND OF BEING-WITH (the artist, 2026-11-27: "같이 지을 때 blob,
    // 말 걸 때 blob 등 다양하게 느껴지게"). No colour (human traces are achromatic): the line's shape, what is bound to
    // what, and the beat say which —
    //   near me            corner brackets only, thin, still; its number and distance
    //   asking me          a bold box that beats on ITS melody's notes, a line from it to me; its number and ♪
    //   building together  everyone in it inside ONE dashed box that beats on the shared bar, their feet chained, each in
    //                      double brackets; "함께 N" on the box (N counts me)
    const cv = overlay.current;
    let tracked = 0;
    let nearest: string | null = null;
    let nearD = Infinity;
    const distM = (w: BotWalker) => Math.hypot(w.x - camera.position.x, w.z - camera.position.z) / unit;
    for (const w of W) {
      const d = distM(w);
      if (d < nearD) {
        nearD = d;
        nearest = w.id ?? null;
      }
    }
    if (cv) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = gl.domElement.clientWidth, ch = gl.domElement.clientHeight;
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr);
        cv.height = Math.round(ch * dpr);
      }
      const ctx = cv.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        if (track > 0 && L.pix) {
          const ink = L.pixWhite ? "255,255,255" : "12,12,12";
          const col = (a: number) => `rgba(${ink},${a})`;
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
          const v = new THREE.Vector3();
          ctx.font = "10px ui-monospace, monospace";
          // (the beat everything here keeps: the music's own bar when it sounds — musicClock.ts)
          const { step, into: inStep } = musicNow();
          const story = storyRef.current && storyRef.current.until > performance.now() ? storyRef.current : null;
          const storyRects: Rect[] = [];
          /** The pictogram's body on the screen (its height, 10 of its card's 15 units across), padded; null off it. */
          const rectOf = (w: BotWalker): Rect | null => {
            const h = personHeight(L, w, undefined) * (w.boost ?? 1) * unit;
            const half = (h * 0.5 * (10 / 15)) / 2;
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (const [sx, sy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const) {
              v.set(w.x + right.x * half * sx, h * sy, w.z + right.z * half * sx).project(camera);
              if (v.z > 1) return null;
              const px = (v.x * 0.5 + 0.5) * cw, py = (1 - (v.y * 0.5 + 0.5)) * ch;
              x0 = Math.min(x0, px);
              x1 = Math.max(x1, px);
              y0 = Math.min(y0, py);
              y1 = Math.max(y1, py);
            }
            if (x1 < 0 || x0 > cw || y1 < 0 || y0 > ch) return null;
            return { x0: Math.round(x0 - 4) + 0.5, y0: Math.round(y0 - 4) + 0.5, x1: Math.round(x1 + 4) + 0.5, y1: Math.round(y1 + 4) + 0.5 };
          };
          const brackets = (r: Rect, grow: number) => {
            const x0 = r.x0 - grow, y0 = r.y0 - grow, x1 = r.x1 + grow, y1 = r.y1 + grow;
            const k = Math.max(3, Math.min(9, (x1 - x0) * 0.3, (y1 - y0) * 0.3));
            ctx.beginPath();
            for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
              ctx.moveTo(cx + dx * k, cy);
              ctx.lineTo(cx, cy);
              ctx.lineTo(cx, cy + dy * k);
            }
            ctx.stroke();
          };
          // who builds with me: the record's rule (I stay, and someone near stays too) — or the lab's test
          const test = (window as unknown as { __framesBuildTest?: boolean }).__framesBuildTest === true;
          const me2 = playerPosRef.current;
          const nearU = DEFAULT_WITNESS.nearRadius;
          let builders: BotWalker[] = [];
          // (the test: the four nearest that are in my view — the nearest of all may stand behind me)
          if (test) builders = [...W].filter((w) => rectOf(w)).sort((p, q) => distM(p) - distM(q)).slice(0, 4);
          else if (together.current) builders = W.filter((w) => w.still && Math.hypot(w.x - me2.x, w.z - me2.z) <= nearU);
          const inBuild = new Set(builders);
          ctx.setLineDash([]);
          for (const w of W) {
            if (inBuild.has(w)) continue;
            const d = distM(w);
            const asks = !!w.asks;
            const told = !!story && story.ids.includes(w.id ?? "");
            if (!(asks || told || (track === 2 && d < trackRadius))) continue;
            const r = rectOf(w);
            if (!r) continue;
            // THE BOND (someone I have answered before): a second line inside, and how many conversations
            const bond = bondsRef.current.get(w.id ?? "") ?? 0;
            const tag = bond >= 2 ? `  ×${bond}` : "";
            if (bond >= 2) {
              ctx.strokeStyle = col(0.8);
              ctx.lineWidth = 1;
              ctx.strokeRect(r.x0 + 3, r.y0 + 3, Math.max(1, r.x1 - r.x0 - 6), Math.max(1, r.y1 - r.y0 - 6));
            }
            if (told) storyRects.push(r);
            if (asks) {
              // ASKING ME: bold, beating on its own melody's notes (out a little and back within the step), a line to me
              const on = rhythmOf(w.id ?? "")[step];
              const beat = on ? Math.max(0, 1 - inStep / 0.45) : 0;
              const g = 3 * beat;
              ctx.strokeStyle = col(1);
              ctx.lineWidth = 2 + beat;
              ctx.strokeRect(r.x0 - g, r.y0 - g, r.x1 - r.x0 + 2 * g, r.y1 - r.y0 + 2 * g);
              ctx.lineWidth = 1;
              ctx.strokeStyle = col(0.6);
              ctx.beginPath();
              ctx.moveTo((r.x0 + r.x1) / 2, r.y1 + g);
              ctx.lineTo(cw / 2, ch);
              ctx.stroke();
              ctx.fillStyle = col(1);
              ctx.fillText(`${individualNo(w.id ?? "")}  ♪${tag}`, r.x0 - g, r.y0 - g - 4);
            } else if (told) {
              // A VOICE OF THE STORY: a whole thin box, beating with the others on the bar
              const bar = step % 2 === 0 ? Math.max(0, 1 - inStep / 0.45) : 0;
              ctx.strokeStyle = col(0.85 + 0.15 * bar);
              ctx.lineWidth = 1 + bar;
              ctx.strokeRect(r.x0 - 2 * bar, r.y0 - 2 * bar, r.x1 - r.x0 + 4 * bar, r.y1 - r.y0 + 4 * bar);
              ctx.fillStyle = col(0.9);
              ctx.fillText(`${individualNo(w.id ?? "")}${tag}`, r.x0, r.y0 - 4);
            } else {
              // NEAR ME: the corners only
              ctx.strokeStyle = col(0.7);
              ctx.lineWidth = 1;
              brackets(r, 0);
              ctx.fillStyle = col(0.7);
              ctx.fillText(`${individualNo(w.id ?? "")}  ${d.toFixed(1)}m${tag}`, r.x0, r.y0 - 4);
            }
            tracked++;
          }
          // THE STORY (voices in counterpoint while we build): its voices bound to ONE ANOTHER — every pair a line, head
          // to head — and what it is, over the leftmost
          if (story && storyRects.length) {
            ctx.strokeStyle = col(0.7);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < storyRects.length; i++)
              for (let j = i + 1; j < storyRects.length; j++) {
                ctx.moveTo((storyRects[i].x0 + storyRects[i].x1) / 2, storyRects[i].y0);
                ctx.lineTo((storyRects[j].x0 + storyRects[j].x1) / 2, storyRects[j].y0);
              }
            ctx.stroke();
            const left = storyRects.reduce((a, b) => (a.x0 <= b.x0 ? a : b));
            ctx.fillStyle = col(1);
            ctx.fillText(story.n >= 3 ? `서사 · ${story.n}` : "이야기 · 2", left.x0, left.y0 - 16);
          }
          // (for the lab's tests: the three nearest in view)
          (window as unknown as { __framesInView?: string[] }).__framesInView = [...W].filter((w) => rectOf(w)).sort((p, q) => distM(p) - distM(q)).slice(0, 3).map((w) => w.id ?? "");
          // BUILDING TOGETHER: one box round all of them, beating on the shared bar; their feet chained; double brackets each
          const shown: Rect[] = [];
          for (const w of builders) {
            const r = rectOf(w);
            if (!r) continue;
            shown.push(r);
            ctx.strokeStyle = col(0.9);
            ctx.lineWidth = 1;
            brackets(r, 0);
            brackets(r, 3);
            tracked++;
          }
          if (shown.length) {
            const bar = step % 4 === 0 ? Math.max(0, 1 - inStep / 0.45) : 0;
            const g = 10 + 3 * bar;
            const u: Rect = { x0: Math.min(...shown.map((r) => r.x0)) - g, y0: Math.min(...shown.map((r) => r.y0)) - g, x1: Math.max(...shown.map((r) => r.x1)) + g, y1: Math.max(...shown.map((r) => r.y1)) + g };
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = col(0.75 + 0.25 * bar);
            ctx.lineWidth = 1.5 + bar;
            ctx.strokeRect(u.x0, u.y0, u.x1 - u.x0, u.y1 - u.y0);
            ctx.setLineDash([]);
            // (their feet, left to right: bound to one another, not to me)
            const feet = shown.map((r) => [(r.x0 + r.x1) / 2, r.y1] as const).sort((p, q) => p[0] - q[0]);
            if (feet.length > 1) {
              ctx.strokeStyle = col(0.5);
              ctx.lineWidth = 1;
              ctx.beginPath();
              feet.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
              ctx.stroke();
            }
            ctx.fillStyle = col(1);
            ctx.fillText(`함께 ${builders.length + 1}`, u.x0, u.y0 - 5);
          }
        }
      }
    }
    (window as unknown as { __framesBots?: unknown }).__framesBots = { cards: n, bots: W.length, tracked };
    // (the lab's "말 걸기 시험" asks with the nearest one)
    (window as unknown as { __framesNearest?: string | null }).__framesNearest = nearest;
    // (a handle for the headless checks: the material, to switch the layer off and see what else draws)
    if (process.env.NODE_ENV === "development") (window as unknown as { __framesLayer?: unknown }).__framesLayer = { mat, sideMat, geom };
  });

  // (pictograms: one card a bot, no thickness)
  const thickOn = !!look && !look.pix && (look.thick > 0 || look.thickFill) && look.thickInk > 0;
  return (
    <>
      <mesh ref={(m) => m?.layers.set(PICTO_LAYER)} geometry={geom} material={mat} frustumCulled={false} renderOrder={10} />
      {thickOn && <mesh ref={(m) => m?.layers.set(PICTO_LAYER)} geometry={geom} material={sideMat} frustumCulled={false} renderOrder={10} />}
    </>
  );
}
