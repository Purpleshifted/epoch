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

export function useFuturePresenceControls(isV2: boolean): FuturePresenceVisual {
  const [url] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("future")));
  const v2 = () => isV2;
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: true, label: "켜기 (주소의 ?future=encounter|overlay|peek|lens|0 이 우선)", render: v2 },
      mode: { options: MODES, value: "encounter" as PresenceMode, label: "방식", render: v2 },
      "마주침 (발굴자)": folder(
        {
          excCount: { value: 7, min: 1, max: 30, step: 1, label: "미래의 발굴자 수 (모든 화면에 같은 이들)", render: v2 },
          excRoam: { value: 44, min: 10, max: 96, step: 1, label: "발굴자가 도는 땅의 반경 (월드 · 세계 가운데에서)", render: v2 },
          excLegSec: { value: 24, min: 6, max: 120, step: 1, label: "한 곳에서 다음 곳까지 (s · 걷고 서 있는 시간)", render: v2 },
          meetR: { value: 4, min: 1, max: 15, step: 0.5, label: "마주치는 거리 (월드)", render: v2 },
          cloudR: { value: 12, min: 4, max: 30, step: 1, label: "보이는 미래의 반경 (월드)", render: v2 },
          pointSize: { value: 0.07, min: 0.02, max: 0.3, step: 0.005, label: "점 크기 (월드)", render: v2 },
          surface: { value: 30, min: 5, max: 120, step: 1, label: "부재 겉면의 점 밀도 (월드² 당)", render: v2 },
          wild: { value: 0.5, min: 0, max: 1, step: 0.05, label: "사람 없이 놔둔 땅의 숲 (0 = 없음)", render: v2 },
          inSec: { value: 1, min: 0.2, max: 4, step: 0.1, label: "모여드는 시간 (s)", render: v2 },
          holdSec: { value: 2.2, min: 0, max: 10, step: 0.1, label: "머무는 시간 (s · 발굴자가 곁에 있으면 더)", render: v2 },
          outSec: { value: 1.8, min: 0.3, max: 6, step: 0.1, label: "흩어지는 시간 (s · 발굴자가 가는 쪽으로)", render: v2 },
          cooldownSec: { value: 20, min: 2, max: 120, step: 1, label: "같은 발굴자를 다시 마주치기까지 (s)", render: v2 },
          darkPresent: { value: true, label: "미래가 머무는 동안 현재를 끔 (흩어질 때 돌아옴)", render: v2 },
          fxLevel: { value: 0.8, min: 0, max: 1, step: 0.05, label: "스쳐 가는 소리 크기 (꽃밭 = 반짝임 · 물 = 강물 · 발견 = 종 · 0 = 없음)", render: v2 },
          dream: { value: false, label: "꿈처럼 (레퍼런스 조리법: 표면 샘플 · 표류 · 둥근 점과 보케 · 너덜한 창 · 점 단위로 왔다 감 — 현재 위에 겹침)", render: v2 },
        },
        { collapsed: false },
      ),
      radius: { value: 14, min: 4, max: 40, step: 1, label: "렌즈 반경 (월드 · 렌즈 방식에서만)", render: v2 },
      everySec: { value: 2, min: 0.5, max: 10, step: 0.5, label: "미래를 다시 읽는 간격 (s)", render: v2 },
      readLatest: { value: true, label: "읽는 단 — 켬: 둘레에서 가장 최근에 지어진 단 (벽과 같음 · 혼자여도 남의 폐허가 보임) · 끔: 내 시각 (내 시간대에 지어진 것만)", render: v2 },
      unit: { value: DEFAULT_PRESENCE.unit, min: 0.1, max: 2, step: 0.05, label: "남은 것의 한 단 높이 (월드 · 벽은 1)", render: v2 },
      band: { value: DEFAULT_PRESENCE.band, min: 4, max: 40, step: 1, label: "변화를 읽는 범위 (단 · 벽과 같음)", render: v2 },
      ruin: { value: DEFAULT_PRESENCE.ruin, min: 0, max: 1, step: 0.05, label: "얼마나 삭았나 (벽과 같음)", render: v2 },
      maxBuildings: { value: DEFAULT_PRESENCE.maxBuildings, min: 10, max: 600, step: 10, label: "한 번에 부재를 만드는 건물 수 (가까운 것부터)", render: v2 },
      showRemains: { value: true, label: "보이기 — 남은 부재 (선)", render: v2 },
      showPlants: { value: true, label: "보이기 — 식생 (풀 · 덤불 · 나무)", render: v2 },
      showDeposits: { value: true, label: "보이기 — 둔덕 · 어두운 흙", render: v2 },
      showTraces: { value: true, label: "보이기 — 내 흔적 (내가 선 칸: 혼자 = 어둡게 · 함께 = 회색 · 나 때문에 지어짐 = 흰색)", render: v2 },
      edgeColor: { value: "#8c8c8c", label: "남은 부재의 선 색", render: v2 },
      plantColor: { value: "#2f8f3f", label: "식생 색 (개인뷰의 초록)", render: v2 },
      strip: { value: DEFAULT_PRESENCE.strip, min: 0, max: 1, step: 0.05, label: "먼저 버려진 건물이 뜯긴 정도 (벽과 같음)", render: v2 },
      lastSteel: { value: DEFAULT_PRESENCE.lastSteel, min: 0, max: 1, step: 0.05, label: "오래 남음 — 철골 (벽과 같음)", render: v2 },
      lastPile: { value: DEFAULT_PRESENCE.lastPile, min: 0, max: 1, step: 0.05, label: "오래 남음 — 말뚝 (벽과 같음)", render: v2 },
    }),
    { collapsed: true, order: 1.2, render: v2 },
  );
  return useMemo<FuturePresenceVisual>(() => {
    const urlMode = url === "dream" ? "encounter" : url && (Object.values(MODES) as string[]).includes(url) ? (url as PresenceMode) : null;
    const mode = (urlMode ?? k.mode) as PresenceMode;
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
      dream: url === "dream" ? true : k.dream,
    };
  }, [url, k.on, k.mode, k.radius, k.everySec, k.readLatest, k.unit, k.band, k.ruin, k.maxBuildings, k.strip, k.lastSteel, k.lastPile, k.showTraces, k.showRemains, k.showPlants, k.showDeposits, k.edgeColor, k.plantColor, k.excCount, k.excRoam, k.excLegSec, k.meetR, k.cloudR, k.pointSize, k.surface, k.wild, k.inSec, k.holdSec, k.outSec, k.cooldownSec, k.darkPresent, k.fxLevel, k.dream]);
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
