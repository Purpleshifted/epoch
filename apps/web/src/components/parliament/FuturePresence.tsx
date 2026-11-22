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
 * Its folder: 미래 (개인뷰 · 시험); `?future=overlay|peek|lens` on the address turns it on for a preview.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { folder, useControls } from "leva";
import { DEFAULT_BOXES, DEFAULT_DENSITY, DEFAULT_PATH, DEFAULT_VARIETY, DensityField, NO_PATHS, type BoxConfig, type DensityConfig, type EventLog } from "@/lib/parliament";
import { DEFAULT_PRESENCE, futurePresence, type PresenceConfig, type PresenceResult } from "@/lib/parliament/futurePresence";
import { CELL_SIZE } from "@/lib/stratum/field";
import { plantBaseGeometry, plantMaterial, setPlantClouds } from "./plantCloudsGpu";
import { savable } from "./levaSave";
import { visitorWorld } from "./useBotServer";
import { markSpan } from "./usePerfMeter";

export type PresenceMode = "encounter" | "overlay" | "peek" | "lens";

export interface FuturePresenceVisual extends PresenceConfig {
  on: boolean;
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
  winShape: "body" | "sheet" | "person";
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

const GROUP = "미래 (개인뷰 · 시험)";
const MODES: Record<string, PresenceMode> = {
  "마주침 — 미래의 발굴자가 내 자리를 지날 때만, 둘레의 미래가 점구름으로 모였다 흩어짐": "encounter",
  "겹침 — 현재의 땅 위에 미래의 남은 것이 함께 선다": "overlay",
  "들여다보기 — F 키 (폰: 버튼)를 누르는 동안 미래만": "peek",
  "렌즈 — 내 둘레 반경 안에서만 미래가 보인다": "lens",
};

/** HOW THE FUTURE IS SHOWN — one knob (the artist, 2026-11-22 night: "레바 좀 정리해가면서 하라고"): the observer's windows
 *  (her choice, the default), the plates that fly, the scan, the dream, the first point cloud, and the three early trials. */
export type Look = "window" | "frames" | "scan" | "dream" | "cloud" | "overlay" | "peek" | "lens";
const LOOKS: Record<string, Look> = {
  "창 — 관찰자가 창, 지나간 자리에 남고 가까우면 화면을 채움": "window",
  "판 — 관찰자에게서 판이 날아옴": "frames",
  "스캔 — 둘러본 프레임이 점으로 쌓임": "scan",
  "꿈 — 점구름이 점 단위로 왔다 감": "dream",
  "점구름 — 모였다 흩어짐": "cloud",
  "겹침 — 현재 위에 남은 것이 함께 섬": "overlay",
  "들여다보기 — F (폰: 버튼)를 누르는 동안": "peek",
  "렌즈 — 내 둘레 반경 안에서만": "lens",
};
const ENCOUNTER_LOOKS: readonly Look[] = ["window", "frames", "scan", "dream", "cloud"];

export function useFuturePresenceControls(isV2: boolean): FuturePresenceVisual {
  const [url] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("future")));
  // (?body=person|body|sheet: the observer's shape for a preview, over the knob)
  const [bodyUrl] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("body")));
  const v2 = () => isV2;
  const hidden = () => false;
  /** A folder shows only for the looks it belongs to (the knob `방식`). */
  const when = (looks: readonly Look[]) => (get: (path: string) => unknown) => looks.includes(get(`${GROUP}.look`) as Look);
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: true, label: "켜기 (주소의 ?future= 가 우선 · 0 = 끔)" },
      look: { options: LOOKS, value: "window" as Look, label: "방식" },
      "관찰자": folder(
        {
          excCount: { value: 7, min: 1, max: 30, step: 1, label: "관찰자 수" },
          excRoam: { value: 44, min: 10, max: 96, step: 1, label: "도는 땅의 반경" },
          excLegSec: { value: 24, min: 6, max: 120, step: 1, label: "한 구간 걷고 서는 시간 (s)" },
          meetR: { value: 4, min: 1, max: 15, step: 0.5, label: "마주치는 거리" },
          cooldownSec: { value: 20, min: 2, max: 120, step: 1, label: "같은 관찰자를 다시 만나기까지 (s)" },
          fxLevel: { value: 0.8, min: 0, max: 1, step: 0.05, label: "스쳐 가는 소리 크기 (0 = 없음)" },
        },
        { collapsed: true, render: when(ENCOUNTER_LOOKS) },
      ),
      "창": folder(
        {
          winH: { value: 2.4, min: 0.3, max: 8, step: 0.05, label: "창의 키" },
          winShape: { options: { "걷는 몸 모양": "body", "사각 창": "sheet", "장노출 사람 (시험 · 주소 ?body=person)": "person" }, value: "body", label: "창의 모양" },
          winSee: { value: 1, min: 0, max: 1, step: 0.05, label: "몸의 진하기 (몸으로 비치는 미래)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winPersonH: { value: 0.8, min: 0.3, max: 4, step: 0.05, label: "사람의 키 (월드 · 0.7 ≈ 1.7 m)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winBoost: { value: 12, min: 0.5, max: 40, step: 0.5, label: "몸 안의 색 진하기", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winAberr: { value: 0.006, min: 0, max: 0.04, step: 0.001, label: "색수차 (세 색이 갈라지는 폭 · 화면 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winTear: { value: 0.5, min: 0, max: 1, step: 0.05, label: "찢김 (가로 띠가 밀려남)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winGlitch: { value: 0.35, min: 0, max: 1, step: 0.05, label: "글리치 (블록이 튐)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winExposure: { value: 0.7, min: 0.03, max: 3, step: 0.01, label: "장노출 길이 (s · 길수록 끌림이 김)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winShake: { value: 0.035, min: 0, max: 0.1, step: 0.002, label: "세로 끌림 (화면 높이 대비)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winDrag: { value: 0.09, min: 0, max: 0.5, step: 0.01, label: "몸 안의 끌림 (키 대비 · 옷의 경계가 번지는 길이)", render: (get) => get(`${GROUP}.창.winShape`) === "person" || bodyUrl === "person" },
          winGap: { value: 2, min: 0.3, max: 6, step: 0.1, label: "창과 창 사이 (관찰자가 걸은 거리)" },
          winStay: { value: 20, min: 2, max: 120, step: 1, label: "창이 남는 시간 (s)" },
          winMax: { value: 10, min: 2, max: 12, step: 1, label: "서 있는 창 수" },
          winSeeR: { value: 16, min: 4, max: 40, step: 1, label: "관찰자가 보이는 거리" },
          winR: { value: 14, min: 4, max: 24, step: 0.5, label: "창에 비치는 미래의 반경" },
          winFillR: { value: 4, min: 0.5, max: 15, step: 0.25, label: "화면에 겹치기 시작하는 거리" },
          winFillFull: { value: 1.5, min: 0, max: 10, step: 0.25, label: "화면이 꽉 차는 거리" },
          winFillAlpha: { value: 0.85, min: 0.1, max: 1, step: 0.05, label: "꽉 찼을 때 불투명도" },
          winFillHow: { options: { "서서히 짙어짐": "fade", "흰 스캔 선이 위에서 쓸고 내려옴": "scan" }, value: "fade", label: "화면을 채우는 방식" },
        },
        { collapsed: false, render: when(["window"]) },
      ),
      "날아오는 판": folder(
        {
          frameEvery: { value: 0.5, min: 0.2, max: 2, step: 0.05, label: "새 판을 찍는 간격 (s)" },
          frameTurn: { value: 15, min: 2, max: 60, step: 1, label: "이만큼 돌아보면 새 판 (도)" },
          frameMove: { value: 0.4, min: 0.1, max: 3, step: 0.05, label: "이만큼 움직이면 새 판" },
          frameMax: { value: 12, min: 3, max: 12, step: 1, label: "살아 있는 판 수" },
          frameHold: { value: 6, min: 1, max: 30, step: 0.5, label: "적어도 머무는 시간 (s)" },
          frameLife: { value: 6, min: 2, max: 15, step: 0.5, label: "판 한 장의 수명 (s)" },
          frameH: { value: 4, min: 1, max: 10, step: 0.25, label: "판의 높이" },
          frameAlpha: { value: 0.5, min: 0.1, max: 1, step: 0.05, label: "그림의 불투명도" },
          frameEdge: { value: 0.1, min: 0, max: 0.45, step: 0.01, label: "가장자리 부드러움" },
          frameJitter: { value: 0.25, min: 0, max: 1.5, step: 0.05, label: "판끼리 어긋남" },
          frameArriveSec: { value: 2.5, min: 0.3, max: 10, step: 0.1, label: "닥쳐오는 시간 (s)" },
          frameCurve: { value: 2.5, min: 1, max: 6, step: 0.1, label: "속도 곡선 (클수록 처음에 빠름)" },
          frameRest: { value: 3, min: 0.5, max: 10, step: 0.25, label: "느려지는 거리" },
          framePass: { value: 0.5, min: 0, max: 4, step: 0.1, label: "그 뒤 다가오는 속도" },
          frameRevealSec: { value: 1, min: 0.1, max: 4, step: 0.1, label: "흰 스캔 선이 쓰는 시간 (s)" },
          frameOut: { options: { "세로로 흘러내림": "melt", "점 꺼짐": "dots", "스캔 선 되돌아감": "line" }, value: "melt", label: "사라지는 방식" },
          frameBody: { value: 1, min: 0.3, max: 4, step: 0.05, label: "관찰자의 키" },
          frameR: { value: 10, min: 3, max: 24, step: 0.5, label: "그림에 담기는 미래의 반경" },
        },
        { collapsed: true, render: when(["frames"]) },
      ),
      "그림": folder(
        {
          frameTone: { options: { "다채 — 미래의 것마다 제 색 (창에서)": "rich", "회색": "grey", "세피아": "sepia", "청회색": "blue", "없음 — 식생은 초록, 내 칸은 따로": "none" }, value: "grey", label: "톤" },
          frameDistort: { options: { "없음": "none", "세로 늘림": "stretch", "슬릿 띠": "slit", "글리치 블록": "glitch", "굴절 · 유리": "glass" }, value: "none", label: "왜곡" },
          frameDistortAmt: { value: 0.5, min: 0, max: 1, step: 0.05, label: "왜곡 세기" },
          frameInk: { value: 2, min: 0.2, max: 5, step: 0.1, label: "진하기" },
          frameSplat: { value: 0.3, min: 0.05, max: 0.8, step: 0.01, label: "번짐 한 점의 크기" },
          frameSmear: { value: 0.012, min: 0, max: 0.08, step: 0.002, label: "옆으로 끌리는 번짐" },
          frameFilm: { value: 0.05, min: 0, max: 0.3, step: 0.01, label: "빈 곳의 막" },
          framePaper: { options: { "자동 — 길거리의 흰 바탕을 따름": "auto", "흰 종이 위의 어두운 번짐": "paper", "검은 바탕 위의 밝은 번짐": "black" }, value: "auto", label: "바탕 (자동 = 길거리의 흰 바탕을 따름)" },
          frameReread: { value: 3, min: 0, max: 20, step: 0.5, label: "서 있는 동안 미래를 다시 읽는 간격 (s · 0 = 한 번)" },
        },
        { collapsed: true, render: when(["window", "frames"]) },
      ),
      "스캔": folder(
        {
          scanR: { value: 14, min: 3, max: 24, step: 0.5, label: "스캔되는 미래의 반경" },
          scanPix: { value: 20, min: 4, max: 60, step: 1, label: "한 프레임의 점 (천 개)" },
          scanFrames: { value: 32, min: 4, max: 48, step: 1, label: "쌓이는 프레임 수" },
          scanTurn: { value: 3, min: 0.5, max: 20, step: 0.5, label: "이만큼 돌아보면 한 장 더 (도)" },
          scanStill: { value: 0.6, min: 0.1, max: 3, step: 0.1, label: "가만히 있어도 한 장 더 (s)" },
          scanBase: { value: 0.12, min: 0, max: 1, step: 0.01, label: "변화 없는 면에 남는 점" },
          scanGain: { value: 2.5, min: 0, max: 10, step: 0.1, label: "모서리 · 윤곽이 더하는 점" },
          scanNew: { value: 0.8, min: 0, max: 3, step: 0.05, label: "방금 안 보이던 것이 더하는 점" },
          scanPx: { value: 1.6, min: 1, max: 5, step: 0.1, label: "점 크기 (px)" },
          scanGlow: { value: 0.6, min: 0.02, max: 1, step: 0.01, label: "점의 빛" },
          scanSplat: { value: 0.14, min: 0.03, max: 0.5, step: 0.01, label: "표면 조각의 크기" },
          scanHold: { value: 14, min: 3, max: 40, step: 1, label: "둘러볼 수 있는 시간 (s)" },
          scanDark: { value: true, label: "둘러보는 동안 현재를 끔" },
          scanArrive: { value: true, label: "미래가 앞에서 밀려옴" },
          scanArriveDist: { value: 40, min: 5, max: 120, step: 1, label: "밀려오는 거리" },
          scanArriveSec: { value: 2.5, min: 0.3, max: 10, step: 0.1, label: "밀려오는 시간 (s)" },
          scanFlow: { value: true, label: "나는 제자리 (걸으면 미래가 흘러옴)" },
        },
        { collapsed: true, render: when(["scan"]) },
      ),
      "점구름": folder(
        {
          cloudR: { value: 12, min: 4, max: 30, step: 1, label: "보이는 미래의 반경" },
          pointSize: { value: 0.07, min: 0.02, max: 0.3, step: 0.005, label: "점 크기" },
          dreamR: { value: 6, min: 2, max: 20, step: 0.5, label: "꿈 — 조각의 반경" },
          dreamPx: { value: 2.6, min: 1, max: 6, step: 0.1, label: "꿈 — 점 크기 (px)" },
          darkPresent: { value: true, label: "미래가 머무는 동안 현재를 끔" },
        },
        { collapsed: true, render: when(["cloud", "dream"]) },
      ),
      "나타남 · 사라짐": folder(
        {
          inSec: { value: 1, min: 0.2, max: 4, step: 0.1, label: "나타나는 시간 (s)" },
          holdSec: { value: 2.2, min: 0, max: 10, step: 0.1, label: "머무는 시간 (s)" },
          outSec: { value: 1.8, min: 0.3, max: 6, step: 0.1, label: "사라지는 시간 (s)" },
        },
        { collapsed: true, render: when(["cloud", "dream", "scan", "frames"]) },
      ),
      "겹침 · 렌즈": folder(
        {
          radius: { value: 14, min: 4, max: 40, step: 1, label: "렌즈 반경" },
          everySec: { value: 2, min: 0.5, max: 10, step: 0.5, label: "미래를 다시 읽는 간격 (s)" },
          showRemains: { value: true, label: "남은 부재" },
          showPlants: { value: true, label: "식생" },
          showDeposits: { value: true, label: "둔덕 · 어두운 흙" },
          showTraces: { value: true, label: "내 흔적" },
          edgeColor: { value: "#8c8c8c", label: "남은 부재의 선 색" },
        },
        { collapsed: true, render: when(["overlay", "peek", "lens"]) },
      ),
      "미래 읽기": folder(
        {
          readLatest: { value: true, label: "가장 최근에 지어진 단을 읽음 (끔 = 내 시각)" },
          unit: { value: DEFAULT_PRESENCE.unit, min: 0.1, max: 2, step: 0.05, label: "한 단의 높이" },
          band: { value: DEFAULT_PRESENCE.band, min: 4, max: 40, step: 1, label: "변화를 읽는 범위 (단)" },
          ruin: { value: DEFAULT_PRESENCE.ruin, min: 0, max: 1, step: 0.05, label: "얼마나 삭았나" },
          maxBuildings: { value: DEFAULT_PRESENCE.maxBuildings, min: 10, max: 600, step: 10, label: "읽는 건물 수" },
          strip: { value: DEFAULT_PRESENCE.strip, min: 0, max: 1, step: 0.05, label: "먼저 버려진 건물이 뜯긴 정도" },
          lastSteel: { value: DEFAULT_PRESENCE.lastSteel, min: 0, max: 1, step: 0.05, label: "오래 남음 — 철골" },
          lastPile: { value: DEFAULT_PRESENCE.lastPile, min: 0, max: 1, step: 0.05, label: "오래 남음 — 말뚝" },
          wild: { value: 0.5, min: 0, max: 1, step: 0.05, label: "놔둔 땅의 숲 (0 = 없음)" },
          surface: { value: 30, min: 5, max: 120, step: 1, label: "부재 겉면의 점 밀도" },
          plantColor: { value: "#2f8f3f", label: "식생 색" },
        },
        { collapsed: true },
      ),
      // (superseded by `방식` on 2026-11-22: kept so what was saved under them is not lost, not shown, not read)
      mode: { options: MODES, value: "encounter" as PresenceMode, label: "방식 (옛)", render: hidden },
      dream: { value: false, label: "dream (옛)", render: hidden },
      scan: { value: false, label: "scan (옛)", render: hidden },
      frames: { value: false, label: "frames (옛)", render: hidden },
      windows: { value: false, label: "windows (옛)", render: hidden },
      // (2026-11-23: the observer's body has no clothes of its own — what was saved under it is kept, not shown, not read)
      winColor: { value: "colour", label: "옷의 색 (옛)", render: hidden },
    }),
    { collapsed: true, order: 1.2, render: v2 },
  );
  return useMemo<FuturePresenceVisual>(() => {
    // (the address first: ?future=window|frames|scan|dream|encounter|overlay|peek|lens, 0 = off)
    const all = Object.values(LOOKS) as string[];
    const look: Look = url === "encounter" ? "cloud" : url && all.includes(url) ? (url as Look) : (k.look as Look);
    const mode: PresenceMode = look === "overlay" || look === "peek" || look === "lens" ? look : "encounter";
    return {
      on: url ? url !== "0" : k.on,
      mode,
      radius: mode === "lens" ? k.radius : 0,
      everySec: k.everySec,
      readLatest: k.readLatest,
      unit: k.unit,
      band: k.band,
      ruin: k.ruin,
      maxBuildings: k.maxBuildings,
      strip: k.strip,
      lastSteel: k.lastSteel,
      lastPile: k.lastPile,
      traces: k.showTraces,
      showRemains: k.showRemains,
      showPlants: k.showPlants,
      showDeposits: k.showDeposits,
      showTraces: k.showTraces,
      edgeColor: k.edgeColor,
      plantColor: k.plantColor,
      excCount: k.excCount,
      excRoam: k.excRoam,
      excLegSec: k.excLegSec,
      meetR: k.meetR,
      cloudR: k.cloudR,
      pointSize: k.pointSize,
      surface: k.surface,
      wild: k.wild,
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
      winShape: (bodyUrl === "person" || bodyUrl === "body" || bodyUrl === "sheet" ? bodyUrl : k.winShape) as FuturePresenceVisual["winShape"],
      winSee: k.winSee,
      winExposure: k.winExposure,
      winShake: k.winShake,
      winDrag: k.winDrag,
      winBoost: k.winBoost,
      winPersonH: k.winPersonH,
      winAberr: k.winAberr,
      winTear: k.winTear,
      winGlitch: k.winGlitch,
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
  }, [url, k.on, k.look, k.radius, k.everySec, k.readLatest, k.unit, k.band, k.ruin, k.maxBuildings, k.strip, k.lastSteel, k.lastPile, k.showTraces, k.showRemains, k.showPlants, k.showDeposits, k.edgeColor, k.plantColor, k.excCount, k.excRoam, k.excLegSec, k.meetR, k.cloudR, k.pointSize, k.surface, k.wild, k.inSec, k.holdSec, k.outSec, k.cooldownSec, k.darkPresent, k.fxLevel, k.dreamR, k.dreamPx, k.scanR, k.scanPix, k.scanFrames, k.scanTurn, k.scanStill, k.scanBase, k.scanGain, k.scanNew, k.scanPx, k.scanGlow, k.scanSplat, k.scanHold, k.scanDark, k.scanArrive, k.scanArriveDist, k.scanArriveSec, k.scanFlow, k.frameR, k.frameEvery, k.frameTurn, k.frameMove, k.frameMax, k.frameHold, k.frameLife, k.frameH, k.frameAlpha, k.frameFilm, k.frameInk, k.frameSplat, k.frameSmear, k.frameJitter, k.frameArriveSec, k.frameRest, k.framePass, k.frameRevealSec, k.frameBody, k.frameOut, k.framePaper, k.frameTone, k.frameDistort, k.frameDistortAmt, k.frameEdge, k.frameCurve, k.frameReread, k.winR, k.winSeeR, k.winH, k.winShape, bodyUrl, k.winSee, k.winExposure, k.winShake, k.winDrag, k.winBoost, k.winPersonH, k.winAberr, k.winTear, k.winGlitch, k.winGap, k.winStay, k.winMax, k.winFillR, k.winFillFull, k.winFillAlpha, k.winFillHow]);
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
    if (group.current) group.current.visible = cfg.on && (cfg.mode !== "peek" || futurePeek.on);
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
