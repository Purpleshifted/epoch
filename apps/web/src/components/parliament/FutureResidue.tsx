"use client";
/**
 * FutureResidue — THE SCAN'S RESIDUE BECOMES THE FUTURE (the artist, 2026-11-27: direction B of the scan (future) study,
 * then "있을 때만" and "미래 관찰자가 사라지면 이전 pointcloud 흩날려 사라지듯이"; docs/mobile-view-lab.md › scan (future)).
 *
 * While the lidar reads the present (LidarScan.tsx), the future's place round the visitor is read every few seconds as
 * the wall infers it (lib/parliament/futurePresence.ts): the parts that are left (as points on their faces), the plants
 * that take the ground, the mounds and the dark earth. None of it is drawn by itself. A part is FOUND when one of the
 * scan's readings lands within `find` of it — always (the default), or for a while after each F (as if an observer had
 * crossed the visitor), or only while one of the future's observers (lib/parliament/excavators.ts, the same walkers bot
 * (future) shows) is within `gateR` of the visitor (`showWhen`). A found part develops from where the reading
 * touched it outwards (`spread`), first in the colour the scan saw there, then its own — what is left pale (steel and
 * piles brightest), the plants in the night garden's colours of IMG_1586/1587 (her own palette) — and stays.
 *
 * When the observer goes (out of reach, or gone), everything found blows away: a gust sweeps through from upwind along
 * the observer's way, the plants lift and drift far like seed fluff, what is left sinks a little as dust before the wind
 * takes it, all through one swirling flow (points near one another turn together); each takes a petal's or a pollen's
 * colour as it goes and draws a thread behind it (the artist, 2026-11-27: "퍼질 때 점들이 연속적으로 이어져 보였으면",
 * "흩날림 더 자연스러워야").
 *
 * Shown where `residueActive()` says: the scan (future) lab page, and — with 개인뷰에 켜기 — wherever every asset runs
 * (the action preview, the experiment). `?futurepass=1` (the scan (future) page's test scene): one observer that walks
 * in, stands, walks away and is gone, every 32 s.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { futurePresence, type PresenceConfig, type PresenceResult } from "@/lib/parliament/futurePresence";
import { excavatorsAt, type Excavator } from "@/lib/parliament/excavators";
import { wrapDelta } from "@/lib/parliament/world";
import { CELL_SIZE } from "@/lib/stratum/field";
import { lidarActive, lidarLook, lidarTap } from "./LidarScan";
import { mobileLab, runsEveryAsset } from "./mobileLab";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";
import type { FuturePresenceVisual } from "./FuturePresence";

/** How one kind blows away: its flight (s), how far (world), how much it rises (world; below 0 it falls), how much the
 *  flow swirls it (0 = straight), and how much it takes its bloom colour as it goes (C; 0 = none … 1). */
export interface BlowKind {
  time: number;
  dist: number;
  rise: number;
  turb: number;
  bloom: number;
}

/**
 * EVERYTHING ONE KIND DOES, ITS OWN (the artist, 2026-11-27: "그 모든 효과를... 부재 / 줄기 / 식생 따로 정하게", "점 크기도
 * 그렇고 걍 전부 다"): the building parts (with the mounds and the earth), the stems, the plants (leaves, grass, flowers).
 */
export interface KindLook {
  /** Its dots: size on screen (CSS px), how much their sizes spread (0 = even), their edge (0 = crisp … 1 = a soft glow). */
  dot: number;
  sizeVar: number;
  soft: number;
  /** HOW MANY OF ITS POINTS (the artist, 2026-11-27: "각 레바별로 점 수나 밀도 정할 수 있게"): × what its own counts give
   *  (1 = as before; under 1 a steady share of them is left out, over 1 more are made the same way — more points on a
   *  part's faces, more leaf clumps in a crown and points in a meadow, more along a stem). */
  density: number;
  /** Found: how fast it develops from the touch outwards (world/s), seconds from the scan's colour to its own. */
  spread: number;
  develop: number;
  /** THE LONG EXPOSURE OF ITS READINGS ("실제 읽어오는 점 위치가 바뀌었을 때 그걸 겹쳐보이게"): each new layer off by a scan's
   *  error (world); the earlier layers' strength and how long they stay (s). */
  jitter: number;
  ghostAlpha: number;
  ghostLife: number;
  /** THE EARLIER LAYERS DAMAGED AS THEY AGE ("글리치나 번짐효과 … 점 크기나 밀도 포함"), each 0 … 1: dots larger and softer,
   *  bands torn sideways, columns dripping down (IMG_1589/1597), blocks dropping out or their dots grown, thinning out. */
  bleed: number;
  tear: number;
  drip: number;
  block: number;
  thin: number;
  /** Its blowing away when the observer leaves, and a smear along the way it moves (s; 0 = none) and its strength. */
  blow: BlowKind;
  smear: number;
  smearAlpha: number;
}

/** WHEN THE FUTURE CAN BE FOUND (the artist, 2026-11-27: "디폴트로는 미래가 항상 보이게, 다른 모드에서는 F 누를 때마다
 *  관찰자랑 겹쳤다고 가정하고 볼 수 있게, 또다른 모드에서는 실제 관찰자 지나갈 때만"): always; for `pressHold` seconds after
 *  each F (a phone: the button), as if an observer had crossed the visitor; or only while a real observer is near. */
export type ResidueShowWhen = "always" | "press" | "observer";

export interface ResidueLook {
  /** 개인뷰에 켜기: the residue where every asset runs (the preview, the experiment); the scan (future) page always. */
  on: boolean;
  showWhen: ResidueShowWhen;
  pressHold: number;
  /** An observer within this (world) of the visitor makes the future findable. */
  gateR: number;
  /** A reading within this (world) of a part finds it. */
  find: number;
  /** Seconds what was found stays AFTER the overlap ends (F, or an observer leaving) before it blows away (0 = at
   *  once); with "always" nothing ends, so it is not read. */
  life: number;
  /** How far off the residue shows (world; it fades from about half of it, never past the lidar's reach). */
  reach: number;
  /** A new layer of the reading every this many seconds; the gust's sweep through everything held when it blows (s). */
  layerSec: number;
  /** BOTH INTERVALS MOVE WITH HOW HARD THE VIEW IS WORKING (the artist, 2026-11-27: "미래 다시 읽는 간격이랑 다시 읽어
   *  겹치는 간격 성능 따라 유동적으로 범위 안에서"): on, the reading's interval (FuturePresenceVisual.everySec … everyMax)
   *  and the layers' (layerSec … layerMax) sit at their shortest while frames come as fast as this screen has lately
   *  done, and stretch toward their longest as frames slow or a reading itself grows costly; off, the shortest always. */
  adapt: boolean;
  everyMax: number;
  layerMax: number;
  stagger: number;
  /** What is left: its colour, and concrete's share of it (steel and piles full); the stems' colour. */
  colour: string;
  concrete: number;
  stemColour: string;
  /** THE PLANTS' COLOURS (A, her own palette): six leaf and five flower colours, their saturation, how many of a meadow's
   *  points flower; points of a plant cloud per square world unit; the trees' crowns filled out (×). */
  leaves: string[];
  flowers: string[];
  sat: number;
  flower: number;
  plantDensity: number;
  treeFull: number;
  /** THE PLANTS' COLOURS FLOW OVER TIME ("컬러팔레트가 시간에 따라 유기적으로 변하게 … 식생에 대해서만"): how much (0 = each
   *  keeps its own), one turn of the palette (s), the colour waves' size (world), and how much of the contrasting
   *  colours (her flowers') drift through the leaves (0 = none). */
  plantFlow: number;
  plantFlowSec: number;
  plantFlowScale: number;
  plantContrast: number;
  /** Each kind's own everything. */
  kinds: { part: KindLook; leaf: KindLook; stem: KindLook };
}

/** The references' palettes (read off IMG_1586 — a pale night garden — and IMG_1587 — a darker one), loaded into her
 *  pickers by the knobs' buttons; the garden is the default. */
export const RESIDUE_PRESETS = {
  garden: { leaves: ["#8fb39a", "#b9b65e", "#a294d6", "#7fa58a", "#c8c97a", "#9fc3b0"], flowers: ["#f07a86", "#e3a0b6", "#f2d572", "#ff5fa2", "#b08ce0"] },
  night: { leaves: ["#3f6f4a", "#6f9a5e", "#a8c48a", "#7d8f6a", "#5a7f6f", "#c0b090"], flowers: ["#ff6a3d", "#6c63e0", "#ffb38a", "#ff4f6d", "#f5e06a"] },
} as const;

/** HER COLOUR PROFILES (visual_reference_images/color_profiles, the artist 2026-11-27: "컬러 프로파일 찾아봄"): electric
 *  nature — cobalt and violet against vermilion, red and hot pink, acid chartreuse and mint for accents, dark olive and
 *  brown beneath, lavender white for the light. Each read off its picture (its main colours by k-means, then lifted to
 *  shine on the scan's black): six leaf colours, five flower colours, the parts' colour and the stems'. */
export const COLOUR_PROFILES: readonly { label: string; leaves: string[]; flowers: string[]; part: string; stem: string }[] = [
  { label: "코발트 · 주홍 (IMG_0637)", leaves: ["#2f6bff", "#4f8a34", "#6f8a2a", "#8a5cff", "#3d5fbf", "#5e7d3a"], flowers: ["#ff4a1c", "#ff7a2a", "#ff3fa8", "#e0261a", "#c24fd0"], part: "#f0edfa", stem: "#b07a4a" },
  { label: "Eco-Electric (IMG_1970)", leaves: ["#8987ec", "#598ffd", "#c7cc10", "#a8a6f2", "#7aa8ff", "#b5ba2a"], flowers: ["#c7cc10", "#f0edfa", "#8987ec", "#598ffd", "#e8ff40"], part: "#f0edfa", stem: "#9c8068" },
  { label: "보라 소용돌이 (IMG_1971)", leaves: ["#964cdc", "#ca97ce", "#b56bd8", "#9da65a", "#c8e06a", "#6a4fc0"], flowers: ["#ff7ab0", "#e86a5a", "#f0a080", "#ff5fd0", "#40d8e0"], part: "#f2e6f6", stem: "#b48aa0" },
  { label: "점묘 노을 (IMG_1973)", leaves: ["#58b89a", "#9dbf7a", "#2d8dca", "#c8b060", "#7ac0a0", "#4aa8c8"], flowers: ["#ff3a2a", "#ff7a3a", "#ff4fa0", "#ffc23a", "#e8e060"], part: "#f4ecd8", stem: "#b08a50" },
  { label: "라벤더 흘러내림 (IMG_1974)", leaves: ["#7998e4", "#8aa5e5", "#a0b4f0", "#7483ba", "#b0a8d8", "#6c7fd0"], flowers: ["#ff5a1a", "#ff8a3a", "#ffcc3a", "#e04a2a", "#ff6a8a"], part: "#dddcf0", stem: "#a87a4a" },
  { label: "들꽃 · 감지 상자 (IMG_1975)", leaves: ["#3a6ae0", "#5a80d0", "#4a7ac8", "#2f5fb8", "#6a8ae8", "#4f9a6a"], flowers: ["#ff1a3a", "#ffb020", "#ffffff", "#ff3fa0", "#3a8aff"], part: "#f4f4ff", stem: "#8a9ad0" },
  { label: "청록 엉겅퀴 (IMG_1976)", leaves: ["#4ec8c0", "#2c9ab0", "#6ae0c0", "#3a7ab8", "#8ad8d0", "#2aa0a0"], flowers: ["#ff2a2a", "#e0201f", "#ff5a3a", "#c0306a", "#ff8a6a"], part: "#e8eef0", stem: "#8a5a5a" },
];

const KIND_BASE: Omit<KindLook, "blow"> = { dot: 2, sizeVar: 0.6, soft: 0.6, density: 1, spread: 5, develop: 1.2, jitter: 0.04, ghostAlpha: 0.45, ghostLife: 3, bleed: 0.5, tear: 0.3, drip: 0.4, block: 0.35, thin: 0.4, smear: 0, smearAlpha: 0.45 };

export const DEFAULT_RESIDUE: ResidueLook = {
  on: false,
  showWhen: "always",
  pressHold: 6,
  gateR: 12,
  find: 0.6,
  life: 3,
  reach: 14,
  layerSec: 0.5,
  adapt: true,
  everyMax: 6,
  layerMax: 1.5,
  stagger: 1.2,
  colour: "#ffffff",
  concrete: 0.7,
  // (a birch's stem, nearly white — IMG_1586/1587)
  stemColour: "#e8e4dc",
  leaves: [...RESIDUE_PRESETS.garden.leaves],
  flowers: [...RESIDUE_PRESETS.garden.flowers],
  sat: 1,
  flower: 0.5,
  plantDensity: 8,
  treeFull: 4,
  plantFlow: 0.6,
  plantFlowSec: 14,
  plantFlowScale: 6,
  plantContrast: 0.35,
  kinds: {
    // (rise, distance and swirl 0 by default — the artist, 2026-11-27: "떠오르는 정도, 흩날리는 거리, 소용돌이는 다 디폴트로
    // 0으로": letting go, they fade where they are)
    part: { ...KIND_BASE, sizeVar: 0.5, soft: 0.4, jitter: 0.03, bleed: 0.4, blow: { time: 2.2, dist: 0, rise: 0, turb: 0, bloom: 0.6 } },
    leaf: { ...KIND_BASE, sizeVar: 0.7, soft: 0.7, jitter: 0.05, bleed: 0.6, tear: 0.2, drip: 0.3, block: 0.3, blow: { time: 2.5, dist: 0, rise: 0, turb: 0, bloom: 0.8 } },
    stem: { ...KIND_BASE, sizeVar: 0.4, soft: 0.5, jitter: 0.03, bleed: 0.4, tear: 0.2, drip: 0.5, block: 0.3, thin: 0.3, blow: { time: 3, dist: 0, rise: 0, turb: 0, bloom: 0.4 } },
  },
};

/** The three kinds in the order the programs read them (x, y, z of their vec3s; the pool's kind numbers 0, 1, 2). */
const KIND_ORDER = ["part", "leaf", "stem"] as const;
/** One field of the three kinds as a vector (x = parts, y = plants, z = stems). */
function per(L: ResidueLook, f: (k: KindLook) => number, v: THREE.Vector3): THREE.Vector3 {
  return v.set(f(L.kinds.part), f(L.kinds.leaf), f(L.kinds.stem));
}
/** A point's kind look by its kind number (0 parts, 1 plants, 2 stems). */
function kindOf(L: ResidueLook, kind: number): KindLook {
  return L.kinds[KIND_ORDER[Math.max(0, Math.min(2, Math.round(kind)))]];
}

/** Set by the scan (future) knobs (labKnobsScanFuture.ts), read per frame here. */
export const residueLook: ResidueLook = { ...DEFAULT_RESIDUE };
export function setResidueLook(v: Partial<ResidueLook>): void {
  Object.assign(residueLook, v);
}

/** THE TWO INTERVALS AS THEY RUN NOW (ResidueLook.adapt): the reading's and the layers' (s), how slow the frames are
 *  (0 = as fast as this screen lately did … 1 = twice as slow), what one reading and one layer cost (ms) — the knobs'
 *  readout. */
export const residueTiming = { every: 2, layer: 0.5, load: 0, readMs: 0, layerMs: 0 };

/** F (a phone: FutureResiduePressButton) pressed: each press counts once, read by the residue's frame. */
export const residuePress = { count: 0 };
export function pressResidue(): void {
  if (residueLook.showWhen === "press") residuePress.count++;
}

/**
 * THE PRESS ON A PHONE (showWhen "press"): a button — each tap counts as an observer crossing the visitor. On a desktop a
 * faint line says the key. Rendered by ParliamentScene outside the Canvas while the life is live.
 */
export function FutureResiduePressButton({ coarse }: { coarse: boolean }) {
  if (!coarse) return <div className="hud-ko pointer-events-none absolute bottom-40 left-4 text-[13px] tracking-[0.05em] text-white/35">F — 미래와 겹치기</div>;
  return (
    <button
      type="button"
      data-hud-control
      onClick={pressResidue}
      onContextMenu={(e) => e.preventDefault()}
      className="hud-ko pointer-events-auto absolute left-4 top-8 select-none border border-white/40 bg-black/60 px-4 py-2 text-[17px] tracking-[0.04em] text-white/85 outline-none"
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
    >
      미래와 겹치기
    </button>
  );
}

/** Whether the residue runs on this page: under the lidar, on the scan (future) page, or where every asset runs and
 *  the place is switched on for the personal view. */
export function residueActive(): boolean {
  if (!lidarActive()) return false;
  return mobileLab() === "scan-future" || (runsEveryAsset() && residueLook.on);
}

/** THE WALL'S DENSITY RULE AS THE ARTIST HAD IT ON 2026-11-20 — until the server's hello says its own (as FuturePresence). */
const FALLBACK_DENSITY: DensityConfig = { ...DEFAULT_DENSITY, path: { ...DEFAULT_PATH, step: NO_PATHS }, slotSec: 20, gapSec: 20, maxBuilt: 8000, mergeGap: 3, mergeThick: 2, liveAt: 0.25, minVisitors: 4, step: 40, maxLevel: 6, ratio: 3, massRatio: 1.45, visitorCap: 60, radius: 2.75, timeSec: 60, down: 0.5 };
/** Samples put into the field in one frame. */
const FEED_PER_FRAME = 150;
/** The most points in the pool (the parts' faces, the plants, the mounds, what is still blowing away) — room for each
 *  kind's 점 수 turned up (only what is there is drawn). */
const CAP = 200_000;
/** A smear's ribbon: this many pieces along the way it went (it follows the swirl's curve). */
const STREAK_SEGS = 8;
/** The most smears at once (points blowing away). */
const STREAK_CAP = 40_000;
/** The earlier layers kept (a ring), and the most points one of them holds (what was shown when it was laid). */
const GHOSTS = 8;
const GHOST_CAP = 40_000;
/** Readings looked at in one frame (more are sampled evenly). */
const READ_PER_FRAME = 4000;
/** The parts' grid (world): a reading looks in its own bucket only, each part in every bucket it reaches into. */
const GRID = 2.4;
/** Rays of the residue's own onto the ground a frame (finding only, never drawn). */
const GROUND_RAYS = 240;
/** How wide the gust's sweep is reckoned (world): a point this far downwind of the visitor leaves the whole sweep later. */
const SWEEP = 24;

const DB = new THREE.Vector2();

const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** What a part has been through, kept across readings by its key. */
interface PartState {
  /** When it was found (s; 0 = not), when it was let go (s; 0 = not), where it was touched. */
  found: number;
  rel: number;
  hx: number;
  hy: number;
  hz: number;
  /** Its blowing direction (the observer's way when it was let go), and where the visitor stood then (the sweep's
   *  middle). */
  dx: number;
  dz: number;
  ox: number;
  oz: number;
  /** When it went from the future's reading (s; 0 = it is there): it fades out instead of popping. */
  died: number;
}

/** The longest a kind's flight takes (s). */
function longestFlight(L: ResidueLook): number {
  return Math.max(L.kinds.part.blow.time, L.kinds.leaf.blow.time, L.kinds.stem.blow.time);
}

/** When a point of a part let go starts to blow (s): the gust sweeps through from upwind (`stagger` for its whole
 *  width), each point a little on its own. */
function blowAt(ps: PartState, x: number, z: number, seed: number, stagger: number): number {
  const front = Math.max(0, Math.min(1, 0.5 + ((x - ps.ox) * ps.dx + (z - ps.oz) * ps.dz) / SWEEP));
  return ps.rel + stagger * (0.7 * front + 0.3 * seed);
}

/** The pool as built from one reading: the points (grouped by part) and the parts. */
interface Pool {
  n: number;
  pos: Float32Array;
  col: Float32Array;
  /** The colour a point takes as it blows away (C). */
  bloom: Float32Array;
  seed: Float32Array;
  /** Which way it blows away (ResidueLook.blow): 0 = what is left, a mound, the earth; 1 = a leaf, grass, a flower;
   *  2 = a stem. */
  kind: Float32Array;
  parts: { key: string; i0: number; i1: number; box: [number, number, number, number, number, number] }[];
  grid: Map<number, number[]>;
}

/** The shared half of both programs: where a point is after `rt` seconds of blowing, `k` its share of the flight. */
const BLOW_GLSL = /* glsl */ `
attribute vec2 aDir;
attribute float aSeed;
attribute float aKind;
// (each a vec3 of the three kinds: x = what is left of the buildings, the mounds and the earth; y = leaves and
// grass; z = stems — the artist, 2026-11-27: "줄기 / 잎 / 건물부재가 fade out 되는 방식을 따로")
uniform vec3 uDist3;
uniform vec3 uRise3;
uniform vec3 uTurb3;
uniform vec3 uScatter3;
uniform vec3 uBloom3;
uniform vec3 uSize3;
uniform vec3 uSizeVar3;
uniform vec3 uSoft3;
float byKind(vec3 v) {
  return aKind < 0.5 ? v.x : aKind < 1.5 ? v.y : v.z;
}
vec3 blowOffset(vec3 p0, float rt, float k) {
  // the wind along the observer's way, each a little to the side
  float ang = (fract(aSeed * 7.31) - 0.5) * 0.9;
  float ca = cos(ang), sa = sin(ang);
  vec2 d = vec2(aDir.x * ca - aDir.y * sa, aDir.x * sa + aDir.y * ca);
  float reach = byKind(uDist3) * (0.5 + 0.9 * fract(aSeed * 13.7));
  // a gust takes it slowly at first, then it rides the wind and loses speed (drag)
  float s = reach * (k * k * (3.0 - 2.0 * k) * 0.6 + k * 0.4);
  // how it rises (a negative rise falls): leaves lift at once and keep rising; a stem lifts late, as if uprooted;
  // what is left sinks a little as dust before the wind takes it
  float rise = byKind(uRise3);
  float up = aKind > 1.5 ? rise * k * k * (0.7 + 0.6 * fract(aSeed * 5.3))
    : aKind > 0.5 ? rise * k * (0.7 + 0.6 * fract(aSeed * 5.3))
    : rise * (0.45 * k * k - 0.12 * sin(3.14159 * min(1.0, k * 1.6)));
  vec3 off = vec3(d.x * s, up, d.y * s);
  // one flow that turns in space and time: points near one another swirl together
  vec3 q = p0 * 0.55 + off * 0.35;
  float t = rt * 0.9;
  vec3 turb = vec3(
    sin(q.z * 1.7 + t * 1.3 + sin(q.y * 2.3 + t * 0.7)),
    0.6 * sin(q.x * 1.3 - t * 1.1 + sin(q.z * 1.9)),
    cos(q.x * 1.9 + t * 0.9 + sin(q.y * 1.4 - t * 0.5))
  );
  off += turb * byKind(uTurb3) * (0.25 + 0.75 * k) * k * 0.9;
  return off;
}
float flightOf(float rt) {
  // (each its own flight time, a quarter shorter or longer)
  return clamp(rt / max(0.05, byKind(uScatter3) * (0.75 + 0.5 * fract(aSeed * 3.7))), 0.0, 1.0);
}`;

/** THE PLANTS' COLOURS FLOW (the artist, 2026-11-27: "컬러팔레트가 시간에 따라 유기적으로 변하게 … 다채롭고 꿈같은 느낌 …
 *  식생에 대해서만", then "컬러팔레트 몇개에 대비되는 색 있는 게 좋은데 그게 마지막에만 확 번져서"): a slow field of colour
 *  that moves through space and time — neighbours turn together — carries each plant point round her palette: leaves
 *  through her six leaf colours, flowers through her five flower colours; and patches of the contrasting colours (her
 *  flowers') drift through the leaves too, so the contrast is there while they live, not only as they blow away.
 *  Needs aKind (a flower is 1.25: still the plants' kind) and aSeed declared before it. */
const FLOW_GLSL = /* glsl */ `
uniform vec3 uLeafPal[6];
uniform vec3 uFlowerPal[5];
uniform float uFlow;
uniform float uFlowT;
uniform float uFlowScale;
uniform float uContrast;
vec3 leafAt(float u) {
  float x = fract(u) * 6.0;
  int i = int(floor(x));
  return mix(uLeafPal[i], uLeafPal[(i + 1) % 6], smoothstep(0.0, 1.0, fract(x)));
}
vec3 flowerAt(float u) {
  float x = fract(u) * 5.0;
  int i = int(floor(x));
  return mix(uFlowerPal[i], uFlowerPal[(i + 1) % 5], smoothstep(0.0, 1.0, fract(x)));
}
// (a few sines out of step, bent by one another: slow drifting bands, never a grid)
float flowField(vec3 p, float t, float k) {
  vec3 q = p / max(0.5, uFlowScale);
  float a = sin(q.x * 1.3 + t * 0.7 + k + sin(q.z * 0.9 - t * 0.4));
  float b = sin(q.z * 1.1 - t * 0.5 + 2.0 * k + sin(q.x * 0.8 + t * 0.3));
  float c = sin((q.x + q.z) * 0.6 + q.y * 1.5 + t * 0.35 + 3.0 * k);
  return 0.5 + 0.18 * (a + b + c);
}
// the colour a plant point has now; base: the colour it was given
vec3 flowColour(vec3 p, vec3 base) {
  if (uFlow <= 0.0 || aKind < 0.5 || aKind > 1.5) return base;
  float u = flowField(p, uFlowT, 0.0) + 0.15 * fract(aSeed * 17.3);
  vec3 own;
  if (aKind > 1.1) own = flowerAt(u);
  else {
    // the contrast drifting through the leaves in patches of its own
    float c = flowField(p * 0.7, uFlowT * 0.6, 1.7);
    float edge = 1.0 - uContrast;
    own = mix(leafAt(u), flowerAt(u + 0.37), smoothstep(edge - 0.12, edge + 0.12, c) * step(0.001, uContrast));
  }
  return mix(base, own, uFlow);
}`;

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute vec3 aBloom;
attribute float aFound;
attribute float aDelay;
attribute float aRel;
attribute float aDie;
uniform float uTime;
uniform vec3 uDevelop3;
uniform float uLife;
uniform float uRange;
uniform float uLod;
uniform float uReach;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec3 vCol;
varying float vA;
varying float vPx;
varying float vSoft;
${BLOW_GLSL}
${FLOW_GLSL}
vec3 ramp(float t) {
  return t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0);
}
void main() {
  vec3 p = position;
  float a = 0.0;
  // (sizes spread, unlike the present's even dots: most small, a few large)
  float sv = fract(aSeed * 53.1);
  float px = byKind(uSize3) * mix(1.0, 0.55 + 1.5 * sv * sv, byKind(uSizeVar3));
  vec3 col = aCol;
  vSoft = byKind(uSoft3);
  if (aFound > 0.0) {
    float age = uTime - (aFound + aDelay);
    a = age < 0.0 ? 0.0 : 1.0;
    // developing: first as the scan saw it there (the lidar's colour by range from the eye), then its own
    vec4 mv0 = modelViewMatrix * vec4(p, 1.0);
    float dEye = -mv0.z;
    vec3 seen = ramp(clamp(dEye / uRange, 0.0, 1.0) * 3.0);
    float dev = byKind(uDevelop3);
    col = mix(seen, flowColour(position, aCol), dev > 0.0 ? smoothstep(0.0, dev, age) : 1.0);
    // far off, as sparse as the lidar's own far readings (kept with the chance (lod/d)²), and gone at the scanner's reach
    if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
    a *= 1.0 - smoothstep(uReach * 0.55, uReach, dEye);
    if (uLife > 0.0) a *= 1.0 - smoothstep(uLife * 0.7, uLife, age);
    // (gone from the future's reading: it fades in a second rather than popping)
    if (aDie > 0.0) a *= 1.0 - smoothstep(0.0, 1.0, uTime - aDie);
    // BLOWN AWAY when the observer went (aRel: when this point's gust comes)
    if (aRel > 0.0) {
      float rt = uTime - aRel;
      if (rt > 0.0) {
        float k = flightOf(rt);
        p += blowOffset(position, rt, k);
        a *= 1.0 - smoothstep(0.45, 1.0, k);
        // C: it blooms as it leaves — a petal's colour for a plant, a pale pollen for what is left — swelling a little
        // at first, then smaller as it goes
        float bloom = byKind(uBloom3);
        float bl = bloom * smoothstep(0.0, 0.3, k);
        col = mix(col, aBloom * (1.0 + 0.4 * bloom), bl);
        px *= (1.0 + 0.6 * bloom * sin(3.14159 * min(1.0, k * 2.5))) * (1.0 - 0.55 * k);
      }
    }
  }
  vA = a;
  vCol = col;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // (as the lidar's dots: one size on screen, a little larger right by the eye)
  vPx = px * clamp(3.0 / max(0.1, -mv.z), 1.0, 1.6);
  gl_PointSize = a > 0.0 ? vPx : 0.0;
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vPx;
varying float vSoft;
void main() {
  // a round dot: the lidar's one-pixel edge (soft 0) … a soft round glow falling off from its middle (soft 1)
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float crisp = clamp((1.0 - r) * vPx * 0.5 + 0.5, 0.0, 1.0);
  float glow = exp(-r * r * 3.0) * (1.0 - smoothstep(0.8, 1.0, r));
  float a = vA * mix(crisp, glow, vSoft);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/** The cores only (the depth pass of the layer of now): the dense middle of a dot, nothing of its rim. */
const CORE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vPx;
varying float vSoft;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float crisp = clamp((1.0 - r) * vPx * 0.5 + 0.5, 0.0, 1.0);
  float glow = exp(-r * r * 3.0) * (1.0 - smoothstep(0.8, 1.0, r));
  if (vA * mix(crisp, glow, vSoft) < 0.5) discard;
  gl_FragColor = vec4(0.0);
}`;

/** THE SMEAR: a blown point's way over the last uTail seconds, as a ribbon as wide as the dot along the very path it
 *  took (each cross-section where the point was at that moment, turned to the screen), strongest at the point and
 *  fading to nothing at the oldest end. In the world: the visitor's turning moves it as it moves the rest. */
const STREAK_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aCol;
attribute vec3 aBloom;
attribute float aRel;
uniform float uTime;
uniform vec3 uTail3;
uniform vec3 uStreak3;
uniform float uLod;
uniform float uReach;
uniform vec2 uRes;
varying vec3 vCol;
varying float vA;
varying float vSide;
varying float vSoft;
${BLOW_GLSL}
vec4 clipAt(float rt) {
  return projectionMatrix * modelViewMatrix * vec4(aOrigin + blowOffset(aOrigin, rt, flightOf(rt)), 1.0);
}
void main() {
  // (position: x = how far back along the smear, 0 at the point … 1 at the oldest; y = which side)
  float along = position.x, side = position.y;
  float rtH = uTime - aRel;
  float rt = rtH - along * byKind(uTail3);
  float rc = max(0.0, rt);
  vec4 c0 = clipAt(rc);
  // the way it goes on the screen there (a moment later), and across it
  vec4 c1 = clipAt(rc + 0.03);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  float len = length(d);
  vec2 perp = len > 1e-4 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
  float kh = flightOf(rtH), k = flightOf(rc);
  float a = rtH > 0.0 && rt > 0.0 ? byKind(uStreak3) * (1.0 - along) * (1.0 - smoothstep(0.45, 1.0, kh)) : 0.0;
  float dEye = c0.w;
  if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
  a *= 1.0 - smoothstep(uReach * 0.55, uReach, dEye);
  // (a little wider than the dot was then — a blur, not a thread — narrowing towards the oldest)
  float sv = fract(aSeed * 53.1);
  float px = 1.4 * byKind(uSize3) * mix(1.0, 0.55 + 1.5 * sv * sv, byKind(uSizeVar3)) * (1.0 - 0.55 * k) * (1.0 - 0.4 * along);
  vA = a;
  vSide = side;
  vSoft = byKind(uSoft3);
  float bloom = byKind(uBloom3);
  vCol = mix(aCol, aBloom * (1.0 + 0.4 * bloom), bloom * smoothstep(0.0, 0.3, k));
  gl_Position = c0 + vec4(perp * side * px / uRes * c0.w, 0.0, 0.0);
}`;
const STREAK_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vSide;
varying float vSoft;
void main() {
  // soft across, as the dot is
  float s = abs(vSide);
  float a = vA * mix(1.0 - smoothstep(0.6, 1.0, s), exp(-s * s * 3.0), vSoft);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/** The colour flow's uniforms (FLOW_GLSL), on the layer of now and on each earlier layer. */
const FLOW_UNIFORMS = () => ({
  uLeafPal: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
  uFlowerPal: { value: Array.from({ length: 5 }, () => new THREE.Color()) },
  uFlow: { value: 0 },
  uFlowT: { value: 0 },
  uFlowScale: { value: 6 },
  uContrast: { value: 0 },
});
/** Her palette into a material's flow uniforms (saturated by `sat`, as the pool's colours are). */
function setFlow(w: Record<string, THREE.IUniform>, L: ResidueLook, now: number, leaves: THREE.Color[], flowers: THREE.Color[]): void {
  (w.uLeafPal.value as THREE.Color[]).forEach((c, i) => c.copy(leaves[i % leaves.length]));
  (w.uFlowerPal.value as THREE.Color[]).forEach((c, i) => c.copy(flowers[i % flowers.length]));
  w.uFlow.value = Math.max(0, Math.min(1, L.plantFlow));
  w.uFlowT.value = (now * Math.PI * 2) / Math.max(1, L.plantFlowSec);
  w.uFlowScale.value = L.plantFlowScale;
  w.uContrast.value = Math.max(0, Math.min(1, L.plantContrast));
}
/** Her leaf and flower colours as the shaders take them (saturated by `sat`), kept until they or `sat` change. */
const flowPal = { key: "", leaves: [] as THREE.Color[], flowers: [] as THREE.Color[] };
function paletteOf(L: ResidueLook): { leaves: THREE.Color[]; flowers: THREE.Color[] } {
  const key = `${L.leaves.join()}|${L.flowers.join()}|${L.sat}`;
  if (key !== flowPal.key) {
    const satd = (hex: string) => {
      const c = new THREE.Color(hex);
      const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = Math.max(0, L.sat);
      return c.setRGB(l + (c.r - l) * s, l + (c.g - l) * s, l + (c.b - l) * s);
    };
    flowPal.key = key;
    flowPal.leaves = (L.leaves.length ? L.leaves : [...RESIDUE_PRESETS.garden.leaves]).map(satd);
    flowPal.flowers = (L.flowers.length ? L.flowers : [...RESIDUE_PRESETS.garden.flowers]).map(satd);
  }
  return flowPal;
}

const BLOW_UNIFORMS = () => ({ uDist3: { value: new THREE.Vector3(4, 5, 2.5) }, uRise3: { value: new THREE.Vector3(0.4, 1.2, 0.3) }, uTurb3: { value: new THREE.Vector3(0.8, 1, 0.6) }, uScatter3: { value: new THREE.Vector3(2.2, 2.5, 3) }, uBloom3: { value: new THREE.Vector3(0.6, 0.8, 0.4) }, uSize3: { value: new THREE.Vector3(2, 2, 2) }, uSizeVar3: { value: new THREE.Vector3(0.6, 0.6, 0.6) }, uSoft3: { value: new THREE.Vector3(0.6, 0.6, 0.6) } });

/** The pool's GPU side, made the first time the residue runs (the exhibition's view never makes it). */
function makePoints(): THREE.Points {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["aCol", 3], ["aBloom", 3], ["aFound", 1], ["aDelay", 1], ["aRel", 1], ["aDir", 2], ["aSeed", 1], ["aKind", 1], ["aDie", 1]] as const)
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(CAP * size), size).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...BLOW_UNIFORMS(),
      ...FLOW_UNIFORMS(),
      uTime: { value: 0 },
      uDevelop3: { value: new THREE.Vector3(1.2, 1.2, 1.2) },
      uLife: { value: 0 },
      uRange: { value: 22 },
      uLod: { value: 12 },
      uReach: { value: 14 },
      uC0: { value: new THREE.Color("#5ff0c8") },
      uC1: { value: new THREE.Color("#c6f06a") },
      uC2: { value: new THREE.Color("#ffb86b") },
      uC3: { value: new THREE.Color("#ff7eb0") },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // (the colour writes no depth: a soft dot's faint rim must not cut the dots behind it — the artist saw the crowns
    // as heaps of bubbles with dark rims, 2026-11-27: "검정 모서리가 간간이 보이는"; the cores' depth comes from the
    // pass below)
    depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  // THE CORES' DEPTH, drawn first (opaque, no colour): only the dense middle of each dot writes depth, so the
  // photograph's pass still softens the residue by its real distance and a near dot still hides what is behind its
  // core — while the rims only ever blend
  const depth = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: m.uniforms, vertexShader: VERT, fragmentShader: CORE_FRAG, colorWrite: false, depthWrite: true }));
  depth.frustumCulled = false;
  depth.renderOrder = 4;
  pts.add(depth);
  return pts;
}

/** The smears' GPU side: one ribbon (STREAK_SEGS pieces, both sides) drawn for every point that blows away, its origin,
 *  colours, gust time and way per instance — a ring filled as parts are let go. */
function makeStreaks(): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  const base: number[] = [], index: number[] = [];
  for (let i = 0; i <= STREAK_SEGS; i++) base.push(i / STREAK_SEGS, -1, 0, i / STREAK_SEGS, 1, 0);
  for (let i = 0; i < STREAK_SEGS; i++) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  g.setAttribute("position", new THREE.Float32BufferAttribute(base, 3));
  g.setIndex(index);
  for (const [name, size] of [["aOrigin", 3], ["aCol", 3], ["aBloom", 3], ["aRel", 1], ["aDir", 2], ["aSeed", 1], ["aKind", 1]] as const)
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(STREAK_CAP * size), size).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...BLOW_UNIFORMS(), uTime: { value: 0 }, uTail3: { value: new THREE.Vector3() }, uStreak3: { value: new THREE.Vector3() }, uLod: { value: 12 }, uReach: { value: 14 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    // (no depth: soft edges blend, never cut what is behind)
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ms = new THREE.Mesh(g, m);
  ms.frustumCulled = false;
  ms.renderOrder = 5;
  return ms;
}

/** AN EARLIER LAYER: the residue as it was shown when that layer was laid — where it stood then, in its colour then —
 *  fading with its age (and quickly, once the observer has gone). */
const GHOST_VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aSeed;
attribute float aKind;
uniform float uAge;
uniform float uKill;
uniform float uLayer;
uniform float uLod;
uniform float uReach;
uniform vec3 uLife3;
uniform vec3 uAlpha3;
uniform vec3 uSize3;
uniform vec3 uSizeVar3;
uniform vec3 uSoft3;
uniform vec3 uBleed3;
uniform vec3 uTear3;
uniform vec3 uDrip3;
uniform vec3 uBlock3;
uniform vec3 uThin3;
varying vec3 vCol;
varying float vA;
varying float vPx;
varying float vSoft;
${FLOW_GLSL}
float byKind(vec3 v) {
  return aKind < 0.5 ? v.x : aKind < 1.5 ? v.y : v.z;
}
float h1(float x) { return fract(sin(x * 12.9898 + uLayer * 78.233) * 43758.5453); }
void main() {
  // (o: how old the layer is for this kind, 0 just laid … 1 gone)
  float o = clamp(uAge / max(0.05, byKind(uLife3)), 0.0, 1.0);
  float f = 1.0 - o;
  float a = byKind(uAlpha3) * uKill * f * f;
  float bleed = byKind(uBleed3), tear = byKind(uTear3), drip = byKind(uDrip3), block = byKind(uBlock3);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dEye = -mv.z;
  if (uLod > 0.0 && dEye > uLod && fract(aSeed * 91.7) > (uLod / dEye) * (uLod / dEye)) a = 0.0;
  a *= 1.0 - smoothstep(uReach * 0.55, uReach, dEye);
  float sv = fract(aSeed * 53.1);
  // BLEED: the older a layer, the larger and softer its dots
  float px = byKind(uSize3) * mix(1.0, 0.55 + 1.5 * sv * sv, byKind(uSizeVar3)) * (1.0 + 2.5 * bleed * o);
  vSoft = min(1.0, byKind(uSoft3) + bleed * o);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  // DENSITY: an older layer thins out (each point its own threshold)
  if (fract(aSeed * 37.1) < byKind(uThin3) * o) a = 0.0;
  // BLOCKS: the screen in blocks; in each layer a few blocks drop out and a few have their dots grown (IMG_1597)
  vec2 cell = floor((ndc * 0.5 + 0.5) * vec2(10.0, 16.0));
  float hk = h1(cell.x * 17.0 + cell.y * 131.0 + 7.0), bo = block * (0.3 + 0.7 * o);
  if (hk < 0.25 * bo) a = 0.0;
  else if (hk > 1.0 - 0.25 * bo) px *= 1.0 + 3.0 * block;
  // TEAR: the screen in bands, a few of each layer's own torn sideways — more as it ages
  float band = floor((ndc.y * 0.5 + 0.5) * 28.0);
  float hb = h1(band + 3.0);
  ndc.x += step(1.0 - 0.4 * tear, hb) * (h1(band + 41.0) - 0.5) * 0.3 * tear * (0.25 + o);
  // DRIP: a few columns of each layer slide down as it ages (IMG_1589 / 1597)
  float colm = floor((ndc.x * 0.5 + 0.5) * 56.0);
  float hc = h1(colm * 1.7 + 101.0);
  ndc.y -= step(1.0 - 0.5 * drip, hc) * o * o * drip * 0.45 * (0.4 + hc);
  clip.xy = ndc * clip.w;
  vA = a;
  // (an earlier layer flows on with the rest: it is the same plants, a moment ago)
  vCol = flowColour(position, aCol);
  gl_Position = clip;
  vPx = px * clamp(3.0 / max(0.1, dEye), 1.0, 1.6);
  gl_PointSize = a > 0.003 ? vPx : 0.0;
}`;

function makeGhost(): THREE.Points {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["aCol", 3], ["aSeed", 1], ["aKind", 1]] as const)
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(GHOST_CAP * size), size).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...FLOW_UNIFORMS(),
      ...Object.fromEntries([
        ...["uAge", "uKill", "uLayer", "uLod", "uReach"].map((n) => [n, { value: n === "uAge" ? 1e6 : n === "uKill" ? 1 : 0 }]),
        ...["uLife3", "uAlpha3", "uSize3", "uSizeVar3", "uSoft3", "uBleed3", "uTear3", "uDrip3", "uBlock3", "uThin3"].map((n) => [n, { value: new THREE.Vector3() }]),
      ]),
    },
    vertexShader: GHOST_VERT,
    fragmentShader: FRAG,
    transparent: true,
    // (no depth: an earlier layer's soft rims must not cut the dots behind them — they only blend; drawn after the
    // layer of now)
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 6;
  return p;
}

/** The pool from one reading of the future: the parts' faces, the trees, the plant clouds, the mounds, the dark earth. */
function buildPool(r: PresenceResult, unit: number, look: ResidueLook): Pool {
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), bloom = new Float32Array(CAP * 3), seed = new Float32Array(CAP), kind = new Float32Array(CAP);
  const parts: Pool["parts"] = [];
  let n = 0;
  const white = new THREE.Color(look.colour), stem = new THREE.Color(look.stemColour);
  // her leaf and flower colours (A), saturated by `sat` (round their own lightness)
  const satd = (hex: string) => {
    const c = new THREE.Color(hex);
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = Math.max(0, look.sat);
    return c.setRGB(l + (c.r - l) * s, l + (c.g - l) * s, l + (c.b - l) * s);
  };
  const leaves = (look.leaves.length ? look.leaves : [...RESIDUE_PRESETS.garden.leaves]).map(satd);
  const flowers = (look.flowers.length ? look.flowers : [...RESIDUE_PRESETS.garden.flowers]).map(satd);
  // (C: what each point turns as it blows away — a petal's colour for the plants, a pale pollen of the whole palette
  // for what is left)
  const petals = flowers, pollen = [...flowers, ...leaves].map((c) => c.clone().lerp(new THREE.Color(1, 1, 1), 0.35));
  const pick = <T,>(list: T[], u: number): T => list[Math.min(list.length - 1, Math.floor(u * list.length))];
  const tmp = new THREE.Color();
  let part: Pool["parts"][number] | null = null;
  const open = (tag: string) => {
    part = { key: tag, i0: n, i1: n, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
  };
  const close = () => {
    const p = part;
    part = null;
    if (!p || n <= p.i0) return;
    p.i1 = n;
    const b = p.box;
    p.key = `${p.key}:${Math.round(b[0] * 100)},${Math.round(b[1] * 100)},${Math.round(b[2] * 100)},${Math.round(b[3] * 100)},${Math.round(b[4] * 100)},${Math.round(b[5] * 100)}`;
    parts.push(p);
  };
  const add = (x: number, y: number, z: number, c: THREE.Color, k: number, s: number, bc: THREE.Color, light: number): boolean => {
    if (n >= CAP || !part) return false;
    const p = part as Pool["parts"][number];
    pos[n * 3] = x;
    pos[n * 3 + 1] = y;
    pos[n * 3 + 2] = z;
    col[n * 3] = c.r * k;
    col[n * 3 + 1] = c.g * k;
    col[n * 3 + 2] = c.b * k;
    bloom[n * 3] = bc.r;
    bloom[n * 3 + 1] = bc.g;
    bloom[n * 3 + 2] = bc.b;
    seed[n] = s;
    kind[n] = light;
    const b = p.box;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x;
    if (y > b[4]) b[4] = y;
    if (z > b[5]) b[5] = z;
    n++;
    return true;
  };
  // WHAT IS LEFT: the parts' faces (steel and piles full, concrete paler; each point its own small tone)
  const S = r.surface, SP = r.surfacePart;
  let cur = -1;
  for (let i = 0, o = 0; o + 3 < S.length && i < SP.length; i++, o += 4) {
    if (SP[i] !== cur) {
      close();
      cur = SP[i];
      open("p");
    }
    const k = (r.partSteel[cur] ? 1 : look.concrete) * (0.82 + 0.36 * hash(i, cur, 31));
    add(S[o], S[o + 1], S[o + 2], white, k, hash(i, cur, 37), pick(pollen, hash(i, cur, 41)), 0);
  }
  close();
  // THE TREES, one part a cell — fuller ("나무는 더 풍성해보여야"): the crown filled with leaf clumps round its own
  // points (the dappled crowns of IMG_1586/1587), the stem drawn whole from the ground to the crown
  const T = r.vegTree;
  const trees = new Map<number, number[]>();
  for (let o = 0; o + 4 < T.length; o += 5) {
    const q = Math.floor(T[o] / CELL_SIZE) * 65536 + Math.floor(T[o + 2] / CELL_SIZE);
    const l = trees.get(q);
    if (l) l.push(o);
    else trees.set(q, [o]);
  }
  const full = Math.max(1, look.treeFull);
  // (each kind's 점 수: a leaf's, a stem's — a point left out by its own steady hash, so a rebuild leaves out the same ones)
  const dLeaf = Math.max(0, look.kinds.leaf.density), dStem = Math.max(0, look.kinds.stem.density);
  for (const [q, list] of trees) {
    // (a tree its own leaf colour, a little of another in it; the stem a birch's near-white)
    const crown = pick(leaves, hash(q, 17, 3)), alt = pick(leaves, hash(q, 19, 5));
    open("t");
    // (the crown's points as the future gave them; the crown filled to × 나무 풍성함 × 잎 점 수 — under its own count,
    // some of its own left out)
    let cn = 0;
    for (const o of list) if (T[o + 3] >= 0.2) cn++;
    const crownWant = cn * full * dLeaf, keepCrown = cn > 0 ? Math.min(1, crownWant / cn) : 0;
    let cx = 0, cy = 0, cz = 0, sx = 0, sz = 0, sn = 0, crownLow = Infinity;
    for (const o of list) {
      const s = hash(Math.round(T[o] * 97), Math.round(T[o + 2] * 89), o);
      const isStem = T[o + 3] < 0.2, y = T[o + 1] * unit;
      if (isStem) {
        sx += T[o];
        sz += T[o + 2];
        sn++;
      } else {
        cx += T[o];
        cy += y;
        cz += T[o + 2];
        crownLow = Math.min(crownLow, y);
      }
      if (hash(o, q, 211) >= (isStem ? Math.min(1, dStem) : keepCrown)) continue;
      const c = isStem ? stem : tmp.copy(crown).lerp(alt, 0.35 * hash(o, q, 7));
      add(T[o], y, T[o + 2], c, isStem ? 0.85 : 0.75 + 0.6 * T[o + 3], s, pick(isStem ? pollen : petals, hash(o, q, 9)), isStem ? 2 : 1);
    }
    if (cn > 0) {
      cx /= cn;
      cy /= cn;
      cz /= cn;
      // the crown's reach from its middle
      let rx = 0.2, ry = 0.2, rz = 0.2;
      for (const o of list) {
        if (T[o + 3] < 0.2) continue;
        rx = Math.max(rx, Math.abs(T[o] - cx));
        ry = Math.max(ry, Math.abs(T[o + 1] * unit - cy));
        rz = Math.max(rz, Math.abs(T[o + 2] - cz));
      }
      // leaf clumps over the crown (most near its outside), points gathered round each
      const extra = Math.max(0, Math.round(crownWant - cn)), clumps = 6 + Math.floor(hash(q, 23, 1) * 8);
      for (let i = 0; i < extra; i++) {
        const cl = i % clumps;
        const ca = hash(q, cl, 29) * Math.PI * 2, cc = hash(q, cl, 31) * 2 - 1, cr = Math.pow(hash(q, cl, 37), 0.35);
        const cq = Math.sqrt(1 - cc * cc);
        const kx = cx + Math.cos(ca) * cq * cr * rx, ky = cy + cc * cr * ry * 0.85, kz = cz + Math.sin(ca) * cq * cr * rz;
        // (a clump's points: roughly a ball a third of the crown wide)
        const g1 = hash(q, i, 41) + hash(q, i, 43) + hash(q, i, 47) - 1.5, g2 = hash(q, i, 53) + hash(q, i, 59) + hash(q, i, 61) - 1.5, g3 = hash(q, i, 67) + hash(q, i, 71) + hash(q, i, 73) - 1.5;
        const sp = 0.38;
        const shade = 0.6 + 0.6 * hash(q, i, 79);
        add(kx + g1 * rx * sp, Math.max(0.1, ky + g2 * ry * sp), kz + g3 * rz * sp, tmp.copy(crown).lerp(alt, hash(q, cl, 83) * 0.6), shade, hash(q, i, 89), pick(petals, hash(i, q, 97)), 1);
      }
      // the stem whole: from the ground up into the crown, leaning a little, with a birch's dark marks
      if (sn > 0) {
        sx /= sn;
        sz /= sn;
        const top = Math.max(0.3, Math.min(cy, crownLow + ry * 0.4)), cntS = Math.round((18 + 10 * full) * dStem);
        const lean = (hash(q, 101, 1) - 0.5) * 0.15;
        for (let i = 0; i < cntS; i++) {
          const u = hash(q, i, 103), y = u * top;
          const mark = hash(q, i, 107) < 0.18;
          add(sx + lean * y + (hash(q, i, 109) - 0.5) * 0.06, y, sz + lean * 0.5 * y + (hash(q, i, 113) - 0.5) * 0.06, stem, mark ? 0.35 : 0.9, hash(q, i, 127), pick(pollen, hash(i, q, 131)), 2);
        }
      }
    }
    close();
  }
  // THE PLANT CLOUDS (grass and scrub: x, z, foot, radius, height …): points in a low dome over their ground
  const PC = r.plantClouds;
  for (let o = 0; o + 11 < PC.length; o += 12) {
    const x = PC[o], z = PC[o + 1], foot = PC[o + 2] * unit, R = Math.max(0.05, PC[o + 3]), H = PC[o + 4] * unit;
    // (× 잎 점 수: the least and the most a cloud holds scaled with it)
    const cnt = Math.max(Math.round(4 * Math.min(1, dLeaf)), Math.min(Math.round(80 * Math.max(1, dLeaf)), Math.round(Math.PI * R * R * look.plantDensity * dLeaf)));
    const sx = Math.round(x * 100), sz = Math.round(z * 100);
    // (a cloud its own leaf colour, a little of a neighbour's in it; a meadow flowers by its own flower share — PC[o + 6]
    // — × 꽃 비율)
    const fam = pick(leaves, hash(sx, sz, 97)), nb = pick(leaves, hash(sz, sx, 101)), fl = Math.min(1, PC[o + 6] * look.flower * 1.6);
    open("g");
    for (let i = 0; i < cnt; i++) {
      const a = hash(sx, sz, i * 3 + 1) * Math.PI * 2, rr = R * Math.sqrt(hash(sx, sz, i * 3 + 2));
      const y = foot + 0.02 + H * (1 - (rr / R) * (rr / R)) * (0.3 + 0.7 * hash(sx, sz, i * 3 + 3));
      const flowering = hash(sx, sz, i * 7 + 5) < fl;
      const c = flowering ? pick(flowers, hash(sx, i, 103)) : tmp.copy(fam).lerp(nb, 0.3 * hash(sz, i, 107));
      add(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, c, flowering ? 1.1 : 0.75 + 0.5 * hash(sz, sx, i), hash(sx, i, sz), pick(petals, hash(i, sz, 109)), flowering ? 1.25 : 1);
    }
    close();
  }
  // THE MOUNDS: a dome of pale points, fuller the higher their score; THE DARK EARTH: a few grey points flat
  // (× 부재 점 수, as the parts' faces — FutureResidue's futurePresence call)
  const dPart = Math.max(0, look.kinds.part.density);
  const M = r.mounds;
  for (let o = 0; o + 3 < M.length; o += 4) {
    const x = M[o], z = M[o + 1], score = M[o + 2], sd = Math.floor(M[o + 3] * 1e6);
    const cnt = Math.round(Math.min(48, 8 + Math.round(score * 8)) * dPart), R = CELL_SIZE * 0.45 * Math.min(2, Math.sqrt(score)), H = unit * 0.3 * Math.min(1.5, score);
    open("m");
    for (let i = 0; i < cnt; i++) {
      const u1 = hash(sd, i, 1), th = hash(sd, i, 2) * Math.PI * 2, rr = R * Math.sqrt(u1);
      add(x + Math.cos(th) * rr, 0.02 + H * (1 - u1), z + Math.sin(th) * rr, white, 0.75 + 0.2 * hash(sd, i, 3), hash(sd, i, 4), pick(pollen, hash(sd, i, 8)), 0);
    }
    close();
  }
  const E = r.stains;
  for (let o = 0; o + 3 < E.length; o += 4) {
    const x = E[o], z = E[o + 1], share = E[o + 2], sd = Math.floor(E[o + 3] * 1e6);
    const cnt = Math.round((4 + Math.round(share * 6)) * dPart);
    open("e");
    for (let i = 0; i < cnt; i++) {
      const th = hash(sd, i, 5) * Math.PI * 2, rr = CELL_SIZE * 0.4 * Math.sqrt(hash(sd, i, 6));
      add(x + Math.cos(th) * rr, 0.02, z + Math.sin(th) * rr, white, 0.4, hash(sd, i, 7), pick(pollen, hash(sd, i, 9)), 0);
    }
    close();
  }
  // (the parts' buckets: each part in every bucket its box, grown by the finding distance, reaches into)
  const grid = new Map<number, number[]>();
  const f = Math.max(0, look.find);
  parts.forEach((p, i) => {
    const b = p.box;
    for (let gx = Math.floor((b[0] - f) / GRID); gx <= Math.floor((b[3] + f) / GRID); gx++)
      for (let gz = Math.floor((b[2] - f) / GRID); gz <= Math.floor((b[5] + f) / GRID); gz++) {
        const q = (gx + 32768) * 65536 + (gz + 32768);
        const l = grid.get(q);
        if (l) l.push(i);
        else grid.set(q, [i]);
      }
  });
  return { n, pos, col, bloom, seed, kind, parts, grid };
}

export function FutureResidue({ log, meRef, getS, playerPosRef, getEpochMs, getWorldSec, getLive, cfg }: { log: EventLog; meRef: React.MutableRefObject<{ id: string }>; getS: () => number; playerPosRef: React.MutableRefObject<{ x: number; z: number }>; getEpochMs: () => number; getWorldSec: () => number; getLive: () => boolean; cfg: FuturePresenceVisual }) {
  const group = useRef<THREE.Group>(null);
  const pts = useRef<THREE.Points | null>(null);
  const streaks = useRef<THREE.Mesh | null>(null);
  const ghosts = useRef<THREE.Points[]>([]);
  const field = useRef<{ f: DensityField; dens: DensityConfig | null; version: unknown; fed: number; drops: number } | null>(null);
  const st = useRef({ timer: 10, pool: null as Pool | null, states: new Map<string, PartState>(), tapFrame: -1, present: false, obs: null as Excavator | null, pass: null as null | { x: number; z: number; fx: number; fz: number; t0: number }, streakHead: 0, streakFilled: 0, streakUntil: 0, layerT: 0, ghostHead: 0, ghostBorn: new Array<number>(GHOSTS).fill(-1e9), ghostKill: 0, pressSeen: residuePress.count, pressUntil: 0, releaseAt: 0, dtAvg: 0, dtBest: 0, readMs: 0, layerMs: 0, every: NaN, layer: NaN });
  // F counts as an observer crossing the visitor (showWhen "press"; pressResidue checks the mode)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyF" && !e.repeat && (e.target as HTMLElement | null)?.tagName !== "INPUT") pressResidue();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  useEffect(
    () => () => {
      for (const o of [pts.current, streaks.current, ...ghosts.current]) {
        if (!o) continue;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        // (the cores' depth pass, a child sharing the geometry)
        for (const c of o.children) ((c as THREE.Points).material as THREE.Material).dispose();
      }
    },
    [],
  );

  useFrame((state, dt) => {
    const on = residueActive();
    if (pts.current) pts.current.visible = on;
    const K3 = residueLook.kinds, anySmear = [K3.part, K3.leaf, K3.stem].some((k) => k.smear > 0 && k.smearAlpha > 0), anyGhost = [K3.part, K3.leaf, K3.stem].some((k) => k.ghostAlpha > 0);
    if (streaks.current) streaks.current.visible = on && anySmear;
    for (const gh of ghosts.current) gh.visible = on && anyGhost;
    if (!on) return;
    if (!pts.current && group.current) {
      pts.current = makePoints();
      streaks.current = makeStreaks();
      ghosts.current = Array.from({ length: GHOSTS }, makeGhost);
      group.current.add(pts.current, streaks.current, ...ghosts.current);
    }
    const P = pts.current, SM = streaks.current;
    if (!P || !SM) return;
    const L = residueLook, s = st.current, now = state.clock.elapsedTime, me = playerPosRef.current;
    const t0 = performance.now();

    // THE FIELD: this view's log through the wall's density rule, fed a little every frame (as FuturePresence)
    const dcfg = visitorWorld.density ?? FALLBACK_DENSITY;
    let h = field.current;
    if (!h || h.dens !== visitorWorld.density || h.version !== visitorWorld.version || h.drops !== log.drops) h = field.current = { f: new DensityField(dcfg), dens: visitorWorld.density, version: visitorWorld.version, fed: 0, drops: log.drops };
    const all = log.all();
    if (h.fed < all.length) {
      const to = Math.min(all.length, h.fed + FEED_PER_FRAME);
      for (let i = h.fed; i < to; i++) h.f.add(all[i]);
      h.fed = to;
    }

    // THE OBSERVERS: the future's walkers (a pure function of the world's clock), or the test scene's one
    const g = P.geometry;
    const A = (name: string) => g.getAttribute(name) as THREE.BufferAttribute;
    const fFound = A("aFound").array as Float32Array, fDelay = A("aDelay").array as Float32Array, fRel = A("aRel").array as Float32Array, fDir = A("aDir").array as Float32Array;
    let dirty0 = Infinity, dirty1 = -1;
    let near: Excavator | null = null, nearD = Infinity;
    // WHEN IT CAN BE FOUND (showWhen): always — no observer needed; at F — each press counts as an observer standing
    // across the visitor for pressHold seconds; else only while a real observer is near (below)
    const live = getLive();
    let pressing = false;
    if (L.showWhen === "press" && live) {
      if (residuePress.count !== s.pressSeen) {
        s.pressSeen = residuePress.count;
        s.pressUntil = now + Math.max(0.5, L.pressHold);
        // (as if it stood a few steps ahead and walks off across the view when the time is up)
        const d = new THREE.Vector3();
        state.camera.getWorldDirection(d);
        d.y = 0;
        if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
        d.normalize();
        s.obs = { i: 0, x: me.x + d.x * 3, z: me.z + d.z * 3, dx: -d.z, dz: d.x, standing: false };
      }
      pressing = now < s.pressUntil;
    }
    if (L.showWhen === "observer" && live) {
      let obs: Excavator[] = [];
      const passOn = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("futurepass") === "1";
      if (passOn) {
        // (the test scene: one observer comes from 18 ahead to 3.5 ahead (6 s), stands (12 s), walks off sideways out
        // of reach (6 s), and is gone (8 s); again and again, from where the visitor first stood and looked)
        if (!s.pass) {
          const d = new THREE.Vector3();
          state.camera.getWorldDirection(d);
          d.y = 0;
          if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
          d.normalize();
          s.pass = { x: me.x, z: me.z, fx: d.x, fz: d.z, t0: now };
        }
        const q = s.pass, u = (now - q.t0) % 32, sm = (v: number) => v * v * (3 - 2 * v);
        const sx = -q.fz, sz = q.fx;
        if (u < 6) {
          const a = 18 + (3.5 - 18) * sm(u / 6);
          obs = [{ i: 0, x: q.x + q.fx * a, z: q.z + q.fz * a, dx: -q.fx, dz: -q.fz, standing: false }];
        } else if (u < 18) obs = [{ i: 0, x: q.x + q.fx * 3.5, z: q.z + q.fz * 3.5, dx: sx, dz: sz, standing: true }];
        else if (u < 24) {
          const b = 18 * sm((u - 18) / 6);
          obs = [{ i: 0, x: q.x + q.fx * 3.5 + sx * b, z: q.z + q.fz * 3.5 + sz * b, dx: sx, dz: sz, standing: false }];
        }
      } else {
        const epoch = getEpochMs();
        if (epoch > 0) obs = excavatorsAt(epoch, getWorldSec(), { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 });
      }
      for (const o of obs) {
        const d = Math.hypot(wrapDelta(o.x - me.x), wrapDelta(o.z - me.z));
        if (d < nearD) {
          nearD = d;
          near = o;
        }
      }
    }
    // (an observer in reach, with a little give so it does not flicker at the edge)
    const wasPresent = s.present;
    s.present = L.showWhen === "always" ? live : L.showWhen === "press" ? pressing : near !== null && nearD <= (wasPresent ? L.gateR * 1.1 : L.gateR);
    if (near) s.obs = near;
    // LET GO — `life` seconds AFTER the overlap ends (the artist, 2026-11-27: "남는 시간 늘려도 금방금방 사라지지... 진짜
    // 겹칠 때에만 잠깐 생기는 거 같고"; 0 = at once): then everything held blows away the observer's way, the gust
    // sweeping through from upwind, and the earlier layers fade out. A new overlap before then keeps it all.
    if (wasPresent && !s.present) s.releaseAt = now + Math.max(0, L.life);
    if (s.present) s.releaseAt = 0;
    if (!wasPresent && s.present && s.ghostKill > 0) {
      s.ghostKill = 0;
      s.ghostBorn.fill(-1e9);
    }
    const letGo = !s.present && s.releaseAt > 0 && now >= s.releaseAt;
    if (letGo) {
      s.releaseAt = 0;
      s.ghostKill = now;
    }
    if (letGo && s.pool) {
      const o = s.obs, pool = s.pool;
      let dx = o ? o.dx : 1, dz = o ? o.dz : 0;
      if (o && o.standing) {
        // (it stood: the way from the visitor to it)
        const ax = wrapDelta(o.x - me.x), az = wrapDelta(o.z - me.z), l = Math.hypot(ax, az);
        if (l > 1e-3) [dx, dz] = [ax / l, az / l];
      }
      const fPos = A("position").array as Float32Array;
      // (each point that had appeared also gets its smear: a ribbon instance with its origin, colours, gust and way)
      const SG = SM.geometry as THREE.InstancedBufferGeometry, I = (name: string) => SG.getAttribute(name) as THREE.InstancedBufferAttribute;
      const iOrig = I("aOrigin").array as Float32Array, iCol = I("aCol").array as Float32Array, iBloom = I("aBloom").array as Float32Array, iRel = I("aRel").array as Float32Array, iDir = I("aDir").array as Float32Array, iSeed = I("aSeed").array as Float32Array, iKind = I("aKind").array as Float32Array;
      let wrote = 0;
      pool.parts.forEach((p) => {
        const ps = s.states.get(p.key);
        if (!ps || ps.found <= 0 || ps.rel > 0 || ps.died > 0) return;
        Object.assign(ps, { rel: now, dx, dz, ox: me.x, oz: me.z });
        for (let i = p.i0; i < p.i1; i++) {
          fRel[i] = blowAt(ps, fPos[i * 3], fPos[i * 3 + 2], pool.seed[i], L.stagger);
          fDir[i * 2] = dx;
          fDir[i * 2 + 1] = dz;
          const kl = kindOf(L, pool.kind[i]);
          if (kl.smear <= 0 || kl.smearAlpha <= 0 || ps.found + fDelay[i] > now || wrote >= STREAK_CAP) continue;
          const j = s.streakHead;
          iOrig.set(pool.pos.subarray(i * 3, i * 3 + 3), j * 3);
          iCol.set(pool.col.subarray(i * 3, i * 3 + 3), j * 3);
          iBloom.set(pool.bloom.subarray(i * 3, i * 3 + 3), j * 3);
          iRel[j] = fRel[i];
          iDir[j * 2] = dx;
          iDir[j * 2 + 1] = dz;
          iSeed[j] = pool.seed[i];
          iKind[j] = pool.kind[i];
          s.streakHead = (s.streakHead + 1) % STREAK_CAP;
          s.streakFilled = Math.min(STREAK_CAP, s.streakFilled + 1);
          wrote++;
        }
        dirty0 = Math.min(dirty0, p.i0);
        dirty1 = Math.max(dirty1, p.i1);
      });
      if (wrote) {
        for (const name of ["aOrigin", "aCol", "aBloom", "aRel", "aDir", "aSeed", "aKind"]) I(name).needsUpdate = true;
        SG.instanceCount = s.streakFilled;
        // (when every smear of this release has run out, the ribbons are not drawn at all)
        s.streakUntil = now + L.stagger + longestFlight(L) * 1.25 + Math.max(L.kinds.part.smear, L.kinds.leaf.smear, L.kinds.stem.smear) + 0.5;
      }
    }
    // (nothing blowing: no ribbons to draw)
    if (s.streakFilled > 0 && now > s.streakUntil) {
      s.streakFilled = 0;
      s.streakHead = 0;
      (SM.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
    }

    // AN EARLIER LAYER: what is shown now (held and already appeared, where it stands now) copied into the next slot of
    // the ring, to stay there and fade over ghostLife
    const layGhost = () => {
      const pool0 = s.pool, gh = ghosts.current[s.ghostHead];
      if (!pool0 || !gh || ![L.kinds.part, L.kinds.leaf, L.kinds.stem].some((k) => k.ghostAlpha > 0) || !s.present) return;
      const GA = (name: string) => gh.geometry.getAttribute(name) as THREE.BufferAttribute;
      const gPos = GA("position").array as Float32Array, gCol = GA("aCol").array as Float32Array, gSeed = GA("aSeed").array as Float32Array, gKind = GA("aKind").array as Float32Array;
      const cPos = A("position").array as Float32Array, cCol = A("aCol").array as Float32Array, cSeed = A("aSeed").array as Float32Array;
      // (more shown than a layer holds — 점 수 turned up: an even share of every kind, not the first ones only)
      let shown = 0;
      for (const p of pool0.parts) {
        const ps = s.states.get(p.key);
        if (ps && ps.found > 0 && ps.rel <= 0 && ps.died <= 0) shown += p.i1 - p.i0;
      }
      const share = Math.min(1, GHOST_CAP / Math.max(1, shown));
      let m = 0, acc = 0;
      for (const p of pool0.parts) {
        const ps = s.states.get(p.key);
        if (!ps || ps.found <= 0 || ps.rel > 0 || ps.died > 0) continue;
        for (let i = p.i0; i < p.i1 && m < GHOST_CAP; i++) {
          if (ps.found + fDelay[i] > now) continue;
          acc += share;
          if (acc < 1) continue;
          acc -= 1;
          for (let c = 0; c < 3; c++) {
            gPos[m * 3 + c] = cPos[i * 3 + c];
            gCol[m * 3 + c] = cCol[i * 3 + c];
          }
          gSeed[m] = cSeed[i];
          gKind[m] = pool0.kind[i];
          m++;
        }
      }
      gh.geometry.setDrawRange(0, m);
      for (const name of ["position", "aCol", "aSeed", "aKind"]) {
        const a = GA(name);
        a.clearUpdateRanges();
        a.addUpdateRange(0, m * a.itemSize);
        a.needsUpdate = true;
      }
      s.ghostBorn[s.ghostHead] = now;
      // (each layer its own bands torn and columns dripping)
      (gh.material as THREE.ShaderMaterial).uniforms.uLayer.value = Math.random() * 100;
      s.ghostHead = (s.ghostHead + 1) % GHOSTS;
    };
    // A NEW LAYER: every point where the reading puts it, off by a scan's error drawn anew
    const layNew = (pool0: Pool) => {
      const fp = A("position").array as Float32Array, J = [L.kinds.part.jitter, L.kinds.leaf.jitter, L.kinds.stem.jitter];
      for (let i = 0; i < pool0.n; i++) {
        const j = Math.max(0, J[Math.round(pool0.kind[i])] ?? 0);
        for (let c = 0; c < 3; c++) fp[i * 3 + c] = pool0.pos[i * 3 + c] + (j > 0 ? (Math.random() * 2 - 1) * j : 0);
      }
      const a = A("position");
      a.clearUpdateRanges();
      a.addUpdateRange(0, pool0.n * 3);
      a.needsUpdate = true;
    };

    // HOW HARD THE VIEW IS WORKING ("성능 따라 유동적으로 범위 안에서"): the frames against the fastest this screen has
    // lately done (a 30 Hz screen is not read as slow; the fastest forgets slowly, ~0.2 ms a second), and what a reading
    // and a layer themselves cost — each interval at its shortest when all is well, toward its longest as frames slow
    // (twice the fastest = the longest) or as one reading would take more than 2 % of the time (a layer 3 %)
    const fd = Math.min(0.25, Math.max(0.001, dt));
    if (!(s.dtAvg > 0)) s.dtAvg = s.dtBest = fd;
    s.dtAvg += (fd - s.dtAvg) * Math.min(1, dt * 2);
    s.dtBest = Math.min(s.dtAvg, s.dtBest + dt * 0.0002);
    const load = Math.min(1, Math.max(0, (s.dtAvg / s.dtBest - 1.15) / 0.85));
    const fin = (x: number, d: number) => (Number.isFinite(x) ? x : d);
    const eLo = Math.max(0.5, fin(cfg.everySec, 2)), eHi = Math.max(eLo, fin(L.everyMax, eLo));
    const lLo = Math.max(0.05, fin(L.layerSec, 0.5)), lHi = Math.max(lLo, fin(L.layerMax, lLo));
    const eWant = L.adapt ? Math.min(eHi, Math.max(eLo + (eHi - eLo) * load, s.readMs / 1000 / 0.02)) : eLo;
    const lWant = L.adapt ? Math.min(lHi, Math.max(lLo + (lHi - lLo) * load, s.layerMs / 1000 / 0.03)) : lLo;
    // (longer quickly, ~0.7 s; shorter again slowly, ~4 s — so it does not flutter)
    const ease = (cur: number, want: number) => (Number.isFinite(cur) ? cur + (want - cur) * Math.min(1, dt / (want > cur ? 0.7 : 4)) : want);
    s.every = ease(s.every, eWant);
    s.layer = ease(s.layer, lWant);
    Object.assign(residueTiming, { every: s.every, layer: s.layer, load, readMs: s.readMs, layerMs: s.layerMs });

    // THE READING OF THE FUTURE, every few seconds: the pool built anew, what each part has been through carried by
    // its key; a part gone from the reading fades out where it was (or finishes blowing away)
    s.timer += dt;
    const sNow = getS();
    if (s.timer >= s.every && h.fed >= all.length && sNow > 0) {
      s.timer = 0;
      const tRead = performance.now();
      const kMe = Math.floor(sNow / Math.max(1, dcfg.slotSec));
      let K = kMe;
      if (cfg.readLatest) {
        let kk = -Infinity;
        for (const sd of h.f.seeds()) if (sd.levels) for (const [k, lv] of sd.levels) if (lv >= 1 && k > kk && k <= K) kk = k;
        if (kk !== -Infinity) K = kk;
      }
      const box: BoxConfig = { ...DEFAULT_BOXES, secPerUnit: Math.max(1, dcfg.slotSec), unit: cfg.unit, width: 0.8, density: 1.4, variety: DEFAULT_VARIETY, buildSlots: 0 };
      // (the parts' faces × 부재 점 수: the points a face's area gives, the most on one part and on all of them, scaled)
      const dPart = Math.max(0, L.kinds.part.density), dUp = Math.max(1, dPart);
      const pcfg: PresenceConfig = { band: cfg.band, ruin: cfg.ruin, unit: cfg.unit, radius: lidarLook.range + 4, maxBuildings: cfg.maxBuildings, strip: cfg.strip, lastSteel: cfg.lastSteel, lastPile: cfg.lastPile, traces: false, surface: cfg.surface * dPart, surfaceCap: Math.round(160 * dUp), surfaceMax: Math.round(Math.min(CAP * 0.75, 60000 * dUp)), wild: cfg.wild };
      const r = futurePresence(h.f, meRef.current.id, K, kMe, me, pcfg, box);
      const pool = buildPool(r, cfg.unit, L);
      // (what is shown until now stays as an earlier layer: where the new reading moves something, both are seen)
      layGhost();
      s.layerT = 0;
      // (what was found and has left the reading: carried over to fade, or to finish blowing away)
      const old = s.pool;
      const keys = new Set(pool.parts.map((p) => p.key));
      // (one that had faded out and is back in the reading is new: it waits to be found again)
      for (const k of keys) if ((s.states.get(k)?.died ?? 0) > 0) s.states.delete(k);
      // (a part of the same kind where a found one stood a moment ago: the future changed it — it stays found, and the
      // old one fades beside it)
      if (old)
        for (const p of pool.parts) {
          if (s.states.has(p.key)) continue;
          const b = p.box, list = old.grid.get((Math.floor((b[0] + b[3]) / 2 / GRID) + 32768) * 65536 + (Math.floor((b[2] + b[5]) / 2 / GRID) + 32768));
          if (!list) continue;
          for (const oi of list) {
            const op = old.parts[oi];
            if (keys.has(op.key) || op.key[0] !== p.key[0]) continue;
            const os = s.states.get(op.key);
            if (!os || os.found <= 0 || os.rel > 0 || os.died > 0) continue;
            const ob = op.box;
            if (ob[0] > b[3] || ob[3] < b[0] || ob[2] > b[5] || ob[5] < b[2] || ob[1] > b[4] + 0.3 || ob[4] < b[1] - 0.3) continue;
            s.states.set(p.key, { ...os });
            break;
          }
        }
      const gone = longestFlight(L) * 1.25 + L.stagger + 0.5;
      if (old)
        for (const p of old.parts) {
          if (keys.has(p.key)) continue;
          const ps = s.states.get(p.key);
          if (!ps || ps.found <= 0) continue;
          if (ps.rel > 0 ? now - ps.rel > gone : ps.died > 0 && now - ps.died > 1.2) continue;
          if (ps.rel <= 0 && ps.died <= 0) ps.died = now;
          if (pool.n + (p.i1 - p.i0) > CAP) continue;
          const i0 = pool.n;
          pool.pos.set(old.pos.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.col.set(old.col.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.bloom.set(old.bloom.subarray(p.i0 * 3, p.i1 * 3), i0 * 3);
          pool.seed.set(old.seed.subarray(p.i0, p.i1), i0);
          pool.kind.set(old.kind.subarray(p.i0, p.i1), i0);
          pool.n += p.i1 - p.i0;
          pool.parts.push({ key: p.key, i0, i1: pool.n, box: p.box });
          keys.add(p.key);
        }
      // (the states of parts long gone or long blown away are forgotten: they may be found again)
      for (const [k, ps] of s.states) {
        if (!keys.has(k) || (ps.rel > 0 && now - ps.rel > gone)) s.states.delete(k);
      }
      // the GPU side anew: positions, colours, seeds, kinds, and what each part has been through
      const fPos = A("position").array as Float32Array, fDie = A("aDie").array as Float32Array;
      layNew(pool);
      (A("aCol").array as Float32Array).set(pool.col.subarray(0, pool.n * 3));
      (A("aBloom").array as Float32Array).set(pool.bloom.subarray(0, pool.n * 3));
      (A("aSeed").array as Float32Array).set(pool.seed.subarray(0, pool.n));
      (A("aKind").array as Float32Array).set(pool.kind.subarray(0, pool.n));
      for (const p of pool.parts) {
        const ps = s.states.get(p.key);
        for (let i = p.i0; i < p.i1; i++) {
          if (!ps || ps.found <= 0) {
            fFound[i] = 0;
            fDelay[i] = 0;
            fRel[i] = 0;
            fDie[i] = 0;
            continue;
          }
          fFound[i] = ps.found;
          fDelay[i] = Math.hypot(fPos[i * 3] - ps.hx, fPos[i * 3 + 1] - ps.hy, fPos[i * 3 + 2] - ps.hz) / Math.max(0.1, kindOf(L, pool.kind[i]).spread) + 0.08 * pool.seed[i];
          fRel[i] = ps.rel > 0 ? blowAt(ps, fPos[i * 3], fPos[i * 3 + 2], pool.seed[i], L.stagger) : 0;
          fDir[i * 2] = ps.dx;
          fDir[i * 2 + 1] = ps.dz;
          fDie[i] = ps.died;
        }
      }
      // (the buckets were made from the new parts only; the carried ones cannot be found again)
      s.pool = pool;
      for (const at of ["position", "aCol", "aBloom", "aSeed", "aKind", "aDie", "aFound", "aDelay", "aRel", "aDir"]) {
        const a = A(at);
        a.clearUpdateRanges();
        a.addUpdateRange(0, pool.n * a.itemSize);
        a.needsUpdate = true;
      }
      dirty0 = Infinity;
      dirty1 = -1;
      g.setDrawRange(0, pool.n);
      const byKind = [0, 0, 0];
      for (let i = 0; i < pool.n; i++) byKind[Math.min(2, Math.round(pool.kind[i]))]++;
      (window as unknown as { __residue?: unknown }).__residue = { k: K, kMe, parts: pool.parts.length, points: pool.n, part: byKind[0], leaf: byKind[1], stem: byKind[2], held: [...s.states.values()].filter((q) => q.found > 0 && q.rel <= 0).length, present: s.present, observer: Math.round(nearD * 10) / 10, ms: r.ms, every: Math.round(s.every * 100) / 100, layer: Math.round(s.layer * 100) / 100, load: Math.round(load * 100) / 100 };
      // (what this reading cost, all of it — the next intervals weigh it)
      const readMs = performance.now() - tRead;
      s.readMs = s.readMs > 0 ? s.readMs * 0.5 + readMs * 0.5 : readMs;
    }

    // BETWEEN READINGS, a layer every `layer` seconds (layerSec … layerMax): the one shown stays behind as an earlier
    // layer, the points laid anew
    s.layerT += dt;
    if (s.pool && s.present && s.layerT >= s.layer) {
      s.layerT = 0;
      const tLayer = performance.now();
      layGhost();
      layNew(s.pool);
      const layerMs = performance.now() - tLayer;
      s.layerMs = s.layerMs > 0 ? s.layerMs * 0.7 + layerMs * 0.3 : layerMs;
    }

    // FINDING: the scan's readings near a part find it — only while an observer is near
    const pool = s.pool;
    if (pool && s.present) {
      const f = Math.max(0, L.find);
      const fSeed = A("aSeed").array as Float32Array, fPos = A("position").array as Float32Array;
      const findAt = (x: number, y: number, z: number) => {
        const list = pool.grid.get((Math.floor(x / GRID) + 32768) * 65536 + (Math.floor(z / GRID) + 32768));
        if (!list) return;
        for (const pi of list) {
          const p = pool.parts[pi];
          let ps = s.states.get(p.key);
          if (ps && ps.found > 0 && ps.rel <= 0 && ps.died <= 0) continue;
          if (ps && ps.died > 0) continue;
          const b = p.box;
          const ddx = Math.max(b[0] - x, 0, x - b[3]), ddy = Math.max(b[1] - y, 0, y - b[4]), ddz = Math.max(b[2] - z, 0, z - b[5]);
          if (ddx * ddx + ddy * ddy + ddz * ddz > f * f) continue;
          // FOUND: it develops from here outwards
          if (!ps) {
            ps = { found: 0, rel: 0, hx: 0, hy: 0, hz: 0, dx: 1, dz: 0, ox: 0, oz: 0, died: 0 };
            s.states.set(p.key, ps);
          }
          Object.assign(ps, { found: now, rel: 0, hx: x, hy: y, hz: z, died: 0 });
          for (let i = p.i0; i < p.i1; i++) {
            fFound[i] = now;
            fDelay[i] = Math.hypot(fPos[i * 3] - x, fPos[i * 3 + 1] - y, fPos[i * 3 + 2] - z) / Math.max(0.1, kindOf(L, pool.kind[i]).spread) + 0.08 * fSeed[i];
            fRel[i] = 0;
          }
          dirty0 = Math.min(dirty0, p.i0);
          dirty1 = Math.max(dirty1, p.i1);
        }
      };
      // …the lidar's own readings of this frame (walls, roofs, and the ground when its radar draws dots)…
      if (lidarTap.pos && lidarTap.frame !== s.tapFrame) {
        s.tapFrame = lidarTap.frame;
        const Pt = lidarTap.pos, cap = lidarTap.cap, n = lidarTap.n, stride = Math.max(1, Math.ceil(n / READ_PER_FRAME));
        for (let j = 0; j < n; j += stride) {
          const k = (lidarTap.start + j) % cap;
          findAt(Pt[k * 3], Pt[k * 3 + 1], Pt[k * 3 + 2]);
        }
      }
      // …and a few rays of its own through the view onto the ground (not drawn): the ground's radar may draw lines,
      // which leave no readings, and the plants and mounds lie on the ground
      const cam = state.camera as THREE.PerspectiveCamera, e = cam.matrixWorld.elements;
      const th = Math.tan(((cam.fov ?? 60) * Math.PI) / 360), asp = cam.aspect ?? 1, cy = Math.max(0.05, cam.position.y);
      for (let i = 0; i < GROUND_RAYS; i++) {
        const px = (Math.random() * 2 - 1) * th * asp, py = (Math.random() * 2 - 1) * th;
        const dx = -e[8] + e[0] * px + e[4] * py, dy = -e[9] + e[1] * px + e[5] * py, dz = -e[10] + e[2] * px + e[6] * py;
        if (dy > -1e-3) continue;
        const t = cy / -dy;
        if (t * Math.hypot(dx, dy, dz) > Math.min(L.reach, lidarLook.range)) continue;
        findAt(cam.position.x + dx * t, 0.02, cam.position.z + dz * t);
      }
    }
    if (dirty1 > dirty0) {
      for (const at of ["aFound", "aDelay", "aRel", "aDir"]) {
        const a = A(at);
        a.clearUpdateRanges();
        a.addUpdateRange(dirty0 * a.itemSize, (dirty1 - dirty0) * a.itemSize);
        a.needsUpdate = true;
      }
    }

    // the look
    const u = (P.material as THREE.ShaderMaterial).uniforms, su = (SM.material as THREE.ShaderMaterial).uniforms;
    for (const w of [u, su]) {
      w.uTime.value = now;
      // (x = what is left, y = leaves, z = stems)
      const bp = L.kinds.part.blow, bl = L.kinds.leaf.blow, bs = L.kinds.stem.blow;
      (w.uScatter3.value as THREE.Vector3).set(bp.time, bl.time, bs.time);
      (w.uDist3.value as THREE.Vector3).set(bp.dist, bl.dist, bs.dist);
      (w.uRise3.value as THREE.Vector3).set(bp.rise, bl.rise, bs.rise);
      (w.uTurb3.value as THREE.Vector3).set(bp.turb, bl.turb, bs.turb);
      (w.uBloom3.value as THREE.Vector3).set(bp.bloom, bl.bloom, bs.bloom);
      w.uLod.value = lidarLook.lod;
      w.uReach.value = Math.min(L.reach, lidarLook.range);
      per(L, (k) => k.sizeVar, w.uSizeVar3.value as THREE.Vector3);
      per(L, (k) => k.soft, w.uSoft3.value as THREE.Vector3);
      // (a soft dot is larger, so a little bigger on screen to keep its weight)
      per(L, (k) => k.dot * state.viewport.dpr * (1 + 0.6 * k.soft), w.uSize3.value as THREE.Vector3);
    }
    per(L, (k) => k.smear, su.uTail3.value as THREE.Vector3);
    per(L, (k) => k.smearAlpha, su.uStreak3.value as THREE.Vector3);
    state.gl.getDrawingBufferSize(DB);
    (su.uRes.value as THREE.Vector2).copy(DB);
    u.uRange.value = lidarLook.range;
    per(L, (k) => k.develop, u.uDevelop3.value as THREE.Vector3);
    // the plants' colours flowing through her palette (the layer of now and every earlier layer alike)
    const pal = paletteOf(L);
    setFlow(u, L, now, pal.leaves, pal.flowers);
    // (the found no longer fade while they are held: 남는 시간 is how long they stay after the overlap — above)
    u.uLife.value = 0;
    (u.uC0.value as THREE.Color).set(lidarLook.c0);
    (u.uC1.value as THREE.Color).set(lidarLook.c1);
    (u.uC2.value as THREE.Color).set(lidarLook.c2);
    (u.uC3.value as THREE.Color).set(lidarLook.c3);
    // the earlier layers: their age, and gone within a moment once the observer has left
    const kill = s.ghostKill > 0 ? 1 - Math.min(1, (now - s.ghostKill) / 0.6) : 1;
    ghosts.current.forEach((gh, i) => {
      const gu = (gh.material as THREE.ShaderMaterial).uniforms;
      gu.uAge.value = now - s.ghostBorn[i];
      gu.uKill.value = kill;
      gu.uLod.value = lidarLook.lod;
      gu.uReach.value = Math.min(L.reach, lidarLook.range);
      per(L, (k) => k.ghostLife, gu.uLife3.value as THREE.Vector3);
      per(L, (k) => k.ghostAlpha, gu.uAlpha3.value as THREE.Vector3);
      (gu.uSize3.value as THREE.Vector3).copy(u.uSize3.value as THREE.Vector3);
      per(L, (k) => k.sizeVar, gu.uSizeVar3.value as THREE.Vector3);
      per(L, (k) => k.soft, gu.uSoft3.value as THREE.Vector3);
      per(L, (k) => k.bleed, gu.uBleed3.value as THREE.Vector3);
      per(L, (k) => k.tear, gu.uTear3.value as THREE.Vector3);
      per(L, (k) => k.drip, gu.uDrip3.value as THREE.Vector3);
      per(L, (k) => k.block, gu.uBlock3.value as THREE.Vector3);
      per(L, (k) => k.thin, gu.uThin3.value as THREE.Vector3);
      setFlow(gu, L, now, pal.leaves, pal.flowers);
    });
    markSpan("residue", performance.now() - t0);
  });

  return <group ref={group} />;
}
