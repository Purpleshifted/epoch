"use client";
/**
 * FuturePresence — THE FUTURE UNDER THE VISITOR'S FEET, in the personal view (a trial; the artist, 2026-11-22: "현재
 * 행동하고 interact 하되, 그로 인한 미래의 변형을 실시간으로 느낄 수 있게"). The wall infers what is found after the
 * people are gone off the whole block (futureVillage.ts, in its worker); here the same inference runs small, on this
 * view's own log (lib/parliament/futurePresence.ts), read at the visitor's own slot every few seconds — so what the
 * visitor does now (stands, stays, is joined by others) is in the layer within that time.
 *
 * Drawn in the personal view's own language (black, white, one green): the edges of the parts that are left, white
 * points for the mounds, grey for the dark earth, green clouds for the plants, the visitor's own traces as squares.
 * Three ways of showing it (the artist chooses — docs/future-presence.md):
 *   overlay   the remains stand on the present's ground, among the grass and the others
 *   peek      F held (a phone: the button held) — the present goes dark, the future alone stands where it was
 *   lens      as overlay, within a radius of the visitor only
 * Its folders (the mobile view lab, 2026-11-23): scan (future) — labKnobsScanFuture.ts — for the place, bot (future) —
 * labKnobsBotFuture.ts — for the observers; `?future=overlay|peek|lens` (the place) or `?future=window|…` (the observers).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { futurePresence, type PresenceConfig, type PresenceResult } from "@/lib/parliament/futurePresence";
import { CELL_SIZE } from "@/lib/stratum/field";
import { plantBaseGeometry, plantMaterial, setPlantClouds } from "./plantCloudsGpu";
import { useScanFutureKnobs } from "./labKnobsScanFuture";
import { LOOKS, useBotFutureKnobs, type Look } from "./labKnobsBotFuture";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";

export type PresenceMode = "encounter" | "overlay" | "peek" | "lens";
export type { Look } from "./labKnobsBotFuture";

export interface FuturePresenceVisual extends PresenceConfig {
  /** Anything of the future runs (overlayOn || encounterOn). */
  on: boolean;
  /** scan (future) — THE PLACE (the mobile view lab, 2026-11-23): the future's remains drawn over the present, in the
   *  way `mode` says (overlay · lens · peek). Runs beside the observers (encounterOn), not instead of them. */
  overlayOn: boolean;
  /** bot (future) — THE OBSERVERS (FutureEncounter.tsx): the future's archaeologists and their look (windows, frames…). */
  encounterOn: boolean;
  /** How the place is shown (overlay · lens · peek; "encounter" only in old saves). */
  mode: PresenceMode;
  /** Seconds between two readings of the layer. */
  everySec: number;
  /** Read at the newest built slot near (the wall's way) instead of the visitor's own slot. */
  readLatest: boolean;
  showRemains: boolean;
  showPlants: boolean;
  showDeposits: boolean;
  showTraces: boolean;
  edgeColor: string;
  plantColor: string;
  /** THE ENCOUNTER (mode "encounter" — FutureEncounter.tsx, excavators.ts): how many archaeologists walk the future,
   *  in what disc, how long a leg; how near one must come; how far round the visitor the future shows; the points'
   *  size and how many on a part's surface; the plants over ground nobody kept; the gathering, holding and streaming
   *  away (s); how long one archaeologist waits before it may meet the visitor again. */
  excCount: number;
  excRoam: number;
  excLegSec: number;
  meetR: number;
  cloudR: number;
  pointSize: number;
  surface: number;
  wild: number;
  inSec: number;
  holdSec: number;
  outSec: number;
  cooldownSec: number;
  /** The present goes dark while the future holds (and comes back as it streams away). */
  darkPresent: boolean;
  /** The passing's sound (futureSound.ts): its level, 0 = none. */
  fxLevel: number;
  /** THE DREAM (the reference study of 2026-11-22: Pointcloud Walks, To paint time, the 4D captures): the cloud
   *  sampled finer and thinner with distance, drifting, soft round points of many sizes blurred near and far, cut by
   *  a ragged window of noise, coming and going point by point — over the present, which stays. Off = as before. */
  dream: boolean;
  /** The dream's piece of the future: its radius (world) and its points' size (px). */
  dreamR: number;
  dreamPx: number;
  /** THE SCAN (the artist, 2026-11-22: "내가 미래의 그 장소에 있다 생각하고 둘러볼 때마다 생성되는 2d 프레임을 점으로 렌더해서
   *  쌓고 그 잔흔이 합쳐져서 … 홀로그래픽 하도록" · "변화량이나 이런 거 감지해서 포인트 거리 정하게 하는 방식"): each look
   *  round is a small depth frame of the future taken from the eye, kept as points; the frames stack into a residue, and
   *  each frame keeps its points where it changes (edges, outlines, what was not seen a moment ago) and few where it is
   *  flat. FutureEncounter.tsx; over the dream's sampling of the place. */
  scan: boolean;
  scanR: number;
  /** Points in one frame (thousands; a phone half), frames kept, the turn (degrees) or the wait (s) that takes another. */
  scanPix: number;
  scanFrames: number;
  scanTurn: number;
  scanStill: number;
  /** What a frame keeps: on a flat surface (0 … 1), how much an edge adds, how much what is new adds. */
  scanBase: number;
  scanGain: number;
  scanNew: number;
  /** A point's size (px), its light (added), a surface sample's size in the frame (world), how long one may look (s). */
  scanPx: number;
  scanGlow: number;
  scanSplat: number;
  scanHold: number;
  /** The present dark while one looks round the future. */
  scanDark: boolean;
  /** THE PLACE COMES (the artist, 2026-11-22: "나는 가만히 있고 풍경이 닥쳐오듯"): it rushes in from this far ahead in this
   *  long (B); and while it holds the visitor stands still, their walking drawing the place to them (A). */
  scanArrive: boolean;
  scanArriveDist: number;
  scanArriveSec: number;
  scanFlow: boolean;
  /** THE FRAMES (the artist, 2026-11-22 night: "연속적으로 닥쳐오는 2D 프레임 … 그 자리의 미래도시 스냅샷 … 반투명하게 렌더돼서
   *  공간감을 주도록 배열" — futureFrames.ts): the future round the visitor taken from their eye as small pictures, each a
   *  translucent plate that comes from the archaeologist, through the visitor and away. */
  frames: boolean;
  /** The piece of the future the pictures are of (its radius, world). */
  frameR: number;
  /** Another picture every … s, or when the eye has turned … degrees or moved … (world). */
  frameEvery: number;
  frameTurn: number;
  frameMove: number;
  /** Plates at once (≤ 12), how long one lives (s), its height (world). */
  frameMax: number;
  /** The least the frames stay (s) — longer while the archaeologist is in reach. */
  frameHold: number;
  frameLife: number;
  frameH: number;
  /** The picture's opacity, the sheet's own veil, how heavy the ink, a surface sample's size in the picture (world), the
   *  long exposure's sideways smear (of the picture's width), how much the plates are off from one another (world). */
  frameAlpha: number;
  frameFilm: number;
  frameInk: number;
  frameSplat: number;
  frameSmear: number;
  frameJitter: number;
  /** The coming: how long the rush (s), how far from the eye it has slowed (world), how fast it then drifts on (world/s). */
  frameArriveSec: number;
  frameRest: number;
  framePass: number;
  /** The white scan line's sweep (s); how the plates go; the archaeologist's body (the window's height, world). */
  frameRevealSec: number;
  frameOut: "melt" | "dots" | "line";
  frameBody: number;
  /** Paper (dark ink on white) or the black ground (light ink): auto = as the street look's white ground says. */
  framePaper: "auto" | "paper" | "black";
  /** The plates' look, for the artist to turn over (2026-11-22 night: "레바 추가해서 어떤 게 좋나 보자. 디스토션이 있어도 좋을
   *  것 같고"): one tone for the whole picture or none (the plants green), how the picture is bent and how much, how soft
   *  the sheet's edge (of its width), the rush's curve (1 = even, higher = faster first), and how often the place is read
   *  again while the frames stand (s; 0 = once) — the living future. */
  frameTone: "rich" | "grey" | "sepia" | "blue" | "none";
  frameDistort: "none" | "stretch" | "slit" | "glitch" | "glass";
  frameDistortAmt: number;
  frameEdge: number;
  frameCurve: number;
  frameReread: number;
  /** THE WINDOWS (the artist, 2026-11-22 night: "미래 관찰자 창을 더 크게 해서 미래 관찰자가 지나간 자리에 남고, 일정 범위
   *  이상 가까우면 현재에 겹쳐서 내 화면이 꽉 차게 그 시야각을 보여주도록" — futureWindows.ts): the observer is a large
   *  window onto the future; it leaves windows where it has passed; near one, the future fills the screen over the
   *  present. Takes the frames' picture knobs (ink, smudge, tone, bend, ground). */
  windows: boolean;
  /** The piece of the future shown (radius, world); how far off the observer and its windows are seen (world). */
  winR: number;
  winSeeR: number;
  /** A window's height (world), its shape, how far the observer walks between two it leaves (world), how long one
   *  stays (s), how many at once (≤ 12). */
  winH: number;
  winShape: "body" | "sheet" | "person" | "clip";
  /** The cut-out (winShape "clip"): "auto" = each observer its own of the few clips (futureWindows OBSERVER_CLIPS), or
   *  one clip's id for all. */
  winClip: string;
  /** The cut-out smeared behind its way (of its cell's width; 0 = none). */
  winTrail: number;
  /** THE OBSERVER AS A PERSON IN A LONG EXPOSURE (winShape "person"): how much of the future shows through them
   *  (0 = clothes only … 1 = a window only), the exposure's length (s), the view's up-and-down shake while it is open
   *  (of the screen's height), clothes in colour or in black and white. */
  winSee: number;
  winExposure: number;
  winShake: number;
  /** How far the body is dragged within one frame while the shutter is open (of its height): the smear inside it. */
  winDrag: number;
  winBoost: number;
  /** A person's height (world) when the observer is a person. */
  winPersonH: number;
  /** THE FUTURE AS A SIGNAL THAT ARRIVES BROKEN (in the observer's body): how far its three colours come apart (of the
   *  screen), how much of it is torn sideways in bands, how many blocks jump out of place (0 = none … 1). */
  winAberr: number;
  winTear: number;
  winGlitch: number;
  /** The drips under (and a few over) the body, as a long exposure leaves them: the longest's length (of the screen's
   *  height; each column its own). */
  winStreak: number;
  winGap: number;
  winStay: number;
  winMax: number;
  /** The screen fills from this distance to a window (world), is full at this one; how opaque then; how it comes. */
  winFillR: number;
  winFillFull: number;
  winFillAlpha: number;
  winFillHow: "fade" | "scan";
}

/** The peek (mode "peek"): held while F is down, or the phone's button. Read every frame by the drawers. */
export const futurePeek = { on: false };

/** THE WALL'S DENSITY RULE AS THE ARTIST HAD IT ON 2026-11-20 (.leva-live) — until the server's hello says its own. */
const FALLBACK_DENSITY: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: NO_PATHS }, slotSec: 20, gapSec: 20, maxBuilt: 8000, mergeGap: 3, mergeThick: 2, liveAt: 0.25, minVisitors: 4, step: 40, maxLevel: 6, ratio: 3, massRatio: 1.45, visitorCap: 60, radius: 2.75, timeSec: 60, down: 0.5 };



export function useFuturePresenceControls(isV2: boolean): FuturePresenceVisual {
  const [url] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("future")));
  // (?body=person|body|sheet: the observer's shape for a preview, over the knob)
  const [bodyUrl] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("body")));
  // scan (future) — the future's place over the present (the mobile view lab, 2026-11-23: the artist's own leaning,
  // "'겹침'모드에서 가느다란 선으로 보여주는 게 흰 배경에는 어울릴 듯함")
  const p = useScanFutureKnobs(isV2);
  // bot (future) — the future's archaeologists and how they show it (FutureEncounter.tsx)
  const k = useBotFutureKnobs(isV2, bodyUrl);
  return useMemo<FuturePresenceVisual>(() => {
    // (the address first: ?future=window|frames|scan|dream|encounter|overlay|peek|lens, 0 = off)
    // (?future=overlay|peek|lens: the place alone; window|frames|scan|dream|encounter: the observers alone; 0: neither)
    const all = Object.values(LOOKS) as string[];
    const urlPlace = url === "overlay" || url === "peek" || url === "lens" ? (url as PresenceMode) : null;
    const urlLook: Look | null = url === "encounter" ? "cloud" : url && all.includes(url) ? (url as Look) : null;
    const look: Look = urlLook ?? (k.look as Look);
    const mode: PresenceMode = urlPlace ?? (p.overlayMode as PresenceMode);
    const overlayOn = url ? !!urlPlace : p.overlayOn;
    const encounterOn = url ? !!urlLook : k.on;
    return {
      on: overlayOn || encounterOn,
      overlayOn,
      encounterOn,
      mode,
      radius: mode === "lens" ? p.radius : 0,
      everySec: p.everySec,
      readLatest: p.readLatest,
      unit: p.unit,
      band: p.band,
      ruin: p.ruin,
      maxBuildings: p.maxBuildings,
      strip: p.strip,
      lastSteel: p.lastSteel,
      lastPile: p.lastPile,
      traces: p.showTraces,
      showRemains: p.showRemains,
      showPlants: p.showPlants,
      showDeposits: p.showDeposits,
      showTraces: p.showTraces,
      edgeColor: p.edgeColor,
      plantColor: p.plantColor,
      excCount: k.excCount,
      excRoam: k.excRoam,
      excLegSec: k.excLegSec,
      meetR: k.meetR,
      cloudR: k.cloudR,
      pointSize: k.pointSize,
      surface: p.surface,
      wild: p.wild,
      inSec: k.inSec,
      holdSec: k.holdSec,
      outSec: k.outSec,
      cooldownSec: k.cooldownSec,
      darkPresent: k.darkPresent,
      fxLevel: k.fxLevel,
      dream: look === "dream",
      dreamR: k.dreamR,
      dreamPx: k.dreamPx,
      scan: look === "scan",
      scanR: k.scanR,
      scanPix: k.scanPix,
      scanFrames: k.scanFrames,
      scanTurn: k.scanTurn,
      scanStill: k.scanStill,
      scanBase: k.scanBase,
      scanGain: k.scanGain,
      scanNew: k.scanNew,
      scanPx: k.scanPx,
      scanGlow: k.scanGlow,
      scanSplat: k.scanSplat,
      scanHold: k.scanHold,
      scanDark: k.scanDark,
      scanArrive: k.scanArrive,
      scanArriveDist: k.scanArriveDist,
      scanArriveSec: k.scanArriveSec,
      scanFlow: k.scanFlow,
      frames: look === "frames",
      windows: look === "window",
      winR: k.winR,
      winSeeR: k.winSeeR,
      winH: k.winH,
      winShape: (bodyUrl === "person" || bodyUrl === "body" || bodyUrl === "sheet" || bodyUrl === "clip" ? bodyUrl : k.winShape) as FuturePresenceVisual["winShape"],
      winClip: k.winClip,
      winTrail: k.winTrail,
      winSee: k.winSee,
      winExposure: k.winExposure,
      winShake: k.winShake,
      winDrag: k.winDrag,
      winBoost: k.winBoost,
      winPersonH: k.winPersonH,
      winAberr: k.winAberr,
      winTear: k.winTear,
      winGlitch: k.winGlitch,
      winStreak: k.winStreak,
      winGap: k.winGap,
      winStay: k.winStay,
      winMax: Math.round(k.winMax),
      winFillR: k.winFillR,
      winFillFull: k.winFillFull,
      winFillAlpha: k.winFillAlpha,
      winFillHow: k.winFillHow as FuturePresenceVisual["winFillHow"],
      frameR: k.frameR,
      frameEvery: k.frameEvery,
      frameTurn: k.frameTurn,
      frameMove: k.frameMove,
      frameMax: Math.round(k.frameMax),
      frameHold: k.frameHold,
      frameLife: k.frameLife,
      frameH: k.frameH,
      frameAlpha: k.frameAlpha,
      frameFilm: k.frameFilm,
      frameInk: k.frameInk,
      frameSplat: k.frameSplat,
      frameSmear: k.frameSmear,
      frameJitter: k.frameJitter,
      frameArriveSec: k.frameArriveSec,
      frameRest: k.frameRest,
      framePass: k.framePass,
      frameRevealSec: k.frameRevealSec,
      frameBody: k.frameBody,
      frameOut: k.frameOut as FuturePresenceVisual["frameOut"],
      framePaper: k.framePaper as FuturePresenceVisual["framePaper"],
      frameTone: k.frameTone as FuturePresenceVisual["frameTone"],
      frameDistort: k.frameDistort as FuturePresenceVisual["frameDistort"],
      frameDistortAmt: k.frameDistortAmt,
      frameEdge: k.frameEdge,
      frameCurve: k.frameCurve,
      frameReread: k.frameReread,
    };
  }, [url, p.overlayOn, p.overlayMode, k.on, k.look, p.radius, p.everySec, p.readLatest, p.unit, p.band, p.ruin, p.maxBuildings, p.strip, p.lastSteel, p.lastPile, p.showTraces, p.showRemains, p.showPlants, p.showDeposits, p.edgeColor, p.plantColor, k.excCount, k.excRoam, k.excLegSec, k.meetR, k.cloudR, k.pointSize, p.surface, p.wild, k.inSec, k.holdSec, k.outSec, k.cooldownSec, k.darkPresent, k.fxLevel, k.dreamR, k.dreamPx, k.scanR, k.scanPix, k.scanFrames, k.scanTurn, k.scanStill, k.scanBase, k.scanGain, k.scanNew, k.scanPx, k.scanGlow, k.scanSplat, k.scanHold, k.scanDark, k.scanArrive, k.scanArriveDist, k.scanArriveSec, k.scanFlow, k.frameR, k.frameEvery, k.frameTurn, k.frameMove, k.frameMax, k.frameHold, k.frameLife, k.frameH, k.frameAlpha, k.frameFilm, k.frameInk, k.frameSplat, k.frameSmear, k.frameJitter, k.frameArriveSec, k.frameRest, k.framePass, k.frameRevealSec, k.frameBody, k.frameOut, k.framePaper, k.frameTone, k.frameDistort, k.frameDistortAmt, k.frameEdge, k.frameCurve, k.frameReread, k.winR, k.winSeeR, k.winH, k.winShape, k.winClip, k.winTrail, bodyUrl, k.winSee, k.winExposure, k.winShake, k.winDrag, k.winBoost, k.winPersonH, k.winAberr, k.winTear, k.winGlitch, k.winStreak, k.winGap, k.winStay, k.winMax, k.winFillR, k.winFillFull, k.winFillAlpha, k.winFillHow]);
}

const MAX_EDGE_VERTS = 120000;
const MAX_PTS = 40000;
/** Samples put into the field in one frame (≈ 150 additions each). */
const FEED_PER_FRAME = 150;

function pointsGeom(cap: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

/** Writes points into a geometry: `put` fills position (3) and colour (3) for each record, returns false to skip. */
function fillPoints(g: THREE.BufferGeometry, recs: Float32Array, stride: number, put: (o: number, P: Float32Array, C: Float32Array, v: number) => number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute, col = g.getAttribute("color") as THREE.BufferAttribute;
  const P = pos.array as Float32Array, C = col.array as Float32Array;
  const cap = P.length / 3;
  let v = 0;
  for (let o = 0; o + stride - 1 < recs.length && v < cap - 64; o += stride) v = put(o, P, C, v);
  g.setDrawRange(0, Math.min(v, cap));
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function FuturePresence({ log, meRef, getS, playerPosRef, cfg }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; cfg: FuturePresenceVisual }) {
  const field = useRef<{ f: DensityField; key: string; fed: number; drops: number } | null>(null);
  const result = useRef<PresenceResult | null>(null);
  const timer = useRef(10);
  const group = useRef<THREE.Group>(null);
  const edges = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_EDGE_VERTS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mounds = useMemo(() => pointsGeom(MAX_PTS), []);
  const stains = useMemo(() => pointsGeom(MAX_PTS), []);
  const traces = useMemo(() => pointsGeom(4000), []);
  const trees = useMemo(() => pointsGeom(MAX_PTS), []);
  const plants = useMemo(() => plantBaseGeometry(), []);
  const plant = useMemo(() => plantMaterial(false), []);
  useEffect(() => () => {
    for (const g of [edges, mounds, stains, traces, trees, plants]) g.dispose();
    plant.mat.dispose();
  }, [edges, mounds, stains, traces, trees, plants, plant]);
  // the plants' colours: the personal view's one green, a darker and a lighter of it; no flowers, no other soil
  useEffect(() => {
    const c = new THREE.Color(cfg.plantColor);
    const dark = c.clone().multiplyScalar(0.55), light = c.clone().multiplyScalar(1.15);
    const u = plant.u;
    (u.uGrassA.value as THREE.Color).copy(dark);
    (u.uGrassB.value as THREE.Color).copy(light);
    (u.uScrubA.value as THREE.Color).copy(dark);
    (u.uScrubB.value as THREE.Color).copy(c);
    (u.uSoilA.value as THREE.Color).copy(dark);
    (u.uSoilB.value as THREE.Color).copy(c);
    (u.uFlower.value as THREE.Vector4).set(0, 0, 1, 0);
    (u.uDot.value as THREE.Vector2).set(0.1, 0.13);
    (u.uLod.value as THREE.Vector3).set(30, 140, 0.5);
    u.uSoilOn.value = 0;
  }, [cfg.plantColor, plant]);
  // THE PEEK: F held (a phone: the button, FuturePeekButton)
  useEffect(() => {
    if (cfg.mode !== "peek") {
      futurePeek.on = false;
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyF" && (e.target as HTMLElement | null)?.tagName !== "INPUT") futurePeek.on = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyF") futurePeek.on = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      futurePeek.on = false;
    };
  }, [cfg.mode]);

  useFrame((_, dt) => {
    if (group.current) group.current.visible = cfg.on && cfg.overlayOn && (cfg.mode !== "peek" || futurePeek.on);
    if (!cfg.on) return;
    // THE FIELD: this view's log through the wall's density rule (the server's, or the fallback until it says) — fed a
    // few hundred samples a frame (the world round the visitor comes as 4000 at once: all in one frame was 290 ms)
    const dcfg = visitorWorld.density ?? FALLBACK_DENSITY;
    const key = `${visitorWorld.version}:${JSON.stringify(dcfg)}`;
    let h = field.current;
    if (!h || h.key !== key || h.drops !== log.drops) h = field.current = { f: new DensityField(dcfg), key, fed: 0, drops: log.drops };
    const all = log.all();
    const t0 = performance.now();
    if (h.fed < all.length) {
      const to = Math.min(all.length, h.fed + FEED_PER_FRAME);
      for (let i = h.fed; i < to; i++) h.f.add(all[i]);
      h.fed = to;
      markSpan("future-feed", performance.now() - t0);
      if (h.fed < all.length) return;
    }
    timer.current += dt;
    if (timer.current < cfg.everySec) return;
    timer.current = 0;
    const s = getS();
    if (!(s > 0)) return;
    // THE SLOT READ: the visitor's own (their present), or the newest slot anything near is built in (the wall's way
    // — what the layer shows while nobody of the visitor's own time has built anything)
    const kMe = Math.floor(s / Math.max(1, dcfg.slotSec));
    let K = kMe;
    if (cfg.readLatest) {
      let kk = -Infinity;
      for (const sd of h.f.seeds()) if (sd.levels) for (const [k, lv] of sd.levels) if (lv >= 1 && k > kk && k <= K) kk = k;
      if (kk !== -Infinity) K = kk;
    }
    // (the parts' numbers: the wall's — its width and density; the districts as the wall's defaults)
    const box: BoxConfig = { ...DEFAULT_BOXES, secPerUnit: Math.max(1, dcfg.slotSec), unit: cfg.unit, width: 0.8, density: 1.4, variety: DEFAULT_VARIETY, buildSlots: 0 };
    const r = futurePresence(h.f, meRef.current.id, K, kMe, playerPosRef.current, cfg, box);
    markSpan("future", performance.now() - t0);
    result.current = r;
    (window as unknown as { __future?: unknown }).__future = { k: r.k, kMe, n: r.n, ms: r.ms, edges: r.edges.length / 6, plants: r.plantClouds.length / 12, trees: r.vegTree.length / 5, mounds: r.mounds.length / 4, stains: r.stains.length / 4, traces: r.traces.length / 4, cellSlots: h.f.stats.cellSlots, samples: h.f.stats.samples, events: all.length, density: visitorWorld.density ? "server" : "fallback", mode: cfg.mode };
    // ── the drawing ──
    {
      const pos = edges.getAttribute("position") as THREE.BufferAttribute;
      const n = Math.min(r.edges.length / 3, MAX_EDGE_VERTS);
      (pos.array as Float32Array).set(n * 3 === r.edges.length ? r.edges : r.edges.subarray(0, n * 3));
      edges.setDrawRange(0, n);
      pos.needsUpdate = true;
    }
    setPlantClouds(plants, r.plantClouds, cfg.unit);
    const green = new THREE.Color(cfg.plantColor);
    fillPoints(trees, r.vegTree, 5, (o, P, C, v) => {
      P[v * 3] = r.vegTree[o];
      P[v * 3 + 1] = r.vegTree[o + 1] * cfg.unit;
      P[v * 3 + 2] = r.vegTree[o + 2];
      const sh = 0.5 + r.vegTree[o + 3];
      C[v * 3] = green.r * sh;
      C[v * 3 + 1] = green.g * sh;
      C[v * 3 + 2] = green.b * sh;
      return v + 1;
    });
    // mounds: a dome of white points, the thicker the higher its score; dark earth: a few grey points flat on the ground
    fillPoints(mounds, r.mounds, 4, (o, P, C, v) => {
      const x = r.mounds[o], z = r.mounds[o + 1], score = r.mounds[o + 2], own = r.mounds[o + 3];
      const n = Math.min(48, 8 + Math.round(score * 8)), R = CELL_SIZE * 0.45 * Math.min(2, Math.sqrt(score)), H = cfg.unit * 0.3 * Math.min(1.5, score);
      const sd = Math.floor(own * 1e6);
      for (let i = 0; i < n; i++) {
        const u1 = hash(sd, i, 1), th = hash(sd, i, 2) * Math.PI * 2, rr = R * Math.sqrt(u1);
        P[v * 3] = x + Math.cos(th) * rr;
        P[v * 3 + 1] = 0.02 + H * (1 - u1);
        P[v * 3 + 2] = z + Math.sin(th) * rr;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = 0.75 + 0.25 * hash(sd, i, 3);
        v++;
      }
      return v;
    });
    fillPoints(stains, r.stains, 4, (o, P, C, v) => {
      const x = r.stains[o], z = r.stains[o + 1], share = r.stains[o + 2], own = r.stains[o + 3];
      const sd = Math.floor(own * 1e6), n = 4 + Math.round(share * 6);
      for (let i = 0; i < n; i++) {
        const th = hash(sd, i, 5) * Math.PI * 2, rr = CELL_SIZE * 0.4 * Math.sqrt(hash(sd, i, 6));
        P[v * 3] = x + Math.cos(th) * rr;
        P[v * 3 + 1] = 0.015;
        P[v * 3 + 2] = z + Math.sin(th) * rr;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = 0.3;
        v++;
      }
      return v;
    });
    // the visitor's own traces: a square a cell — alone dark grey, among others grey, decisive white
    fillPoints(traces, r.traces, 4, (o, P, C, v) => {
      P[v * 3] = r.traces[o];
      P[v * 3 + 1] = 0.04;
      P[v * 3 + 2] = r.traces[o + 1];
      const kind = r.traces[o + 3], w = r.traces[o + 2];
      const c = kind >= 1 ? 1 : kind > 0 ? 0.6 : 0.25 + 0.2 * w;
      C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = c;
      return v + 1;
    });
  });

  return (
    <group ref={group} visible={false}>
      {cfg.showRemains && (
        <lineSegments geometry={edges} frustumCulled={false}>
          <lineBasicMaterial color={cfg.edgeColor} fog={false} />
        </lineSegments>
      )}
      {cfg.showPlants && <points geometry={plants} material={plant.mat} frustumCulled={false} />}
      {cfg.showPlants && (
        <points geometry={trees} frustumCulled={false}>
          <pointsMaterial size={0.12} vertexColors sizeAttenuation fog={false} />
        </points>
      )}
      {cfg.showDeposits && (
        <points geometry={mounds} frustumCulled={false}>
          <pointsMaterial size={0.09} vertexColors sizeAttenuation fog={false} />
        </points>
      )}
      {cfg.showDeposits && (
        <points geometry={stains} frustumCulled={false}>
          <pointsMaterial size={0.08} vertexColors sizeAttenuation fog={false} />
        </points>
      )}
      {cfg.showTraces && (
        <points geometry={traces} frustumCulled={false}>
          <pointsMaterial size={0.26} vertexColors sizeAttenuation fog={false} />
        </points>
      )}
    </group>
  );
}

/**
 * THE PEEK ON A PHONE (mode "peek"): a button held — the present goes dark, the future alone stands. On a desktop a
 * faint line says the key. Rendered by ParliamentScene outside the Canvas while the life is live.
 */
export function FuturePeekButton({ coarse }: { coarse: boolean }) {
  if (!coarse) return <div className="hud-ko pointer-events-none absolute bottom-40 left-4 text-[13px] tracking-[0.05em] text-white/35">F — 미래 들여다보기</div>;
  return (
    <button
      type="button"
      data-hud-control
      onTouchStart={() => {
        futurePeek.on = true;
      }}
      onTouchEnd={() => {
        futurePeek.on = false;
      }}
      onTouchCancel={() => {
        futurePeek.on = false;
      }}
      onMouseDown={() => {
        futurePeek.on = true;
      }}
      onMouseUp={() => {
        futurePeek.on = false;
      }}
      onMouseLeave={() => {
        futurePeek.on = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="hud-ko pointer-events-auto absolute left-4 top-8 select-none border border-white/40 bg-black/60 px-4 py-2 text-[17px] tracking-[0.04em] text-white/85 outline-none"
      style={{ touchAction: "none", WebkitTapHighlightColor: "transparent", WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
    >
      미래 — 누르는 동안
    </button>
  );
}
