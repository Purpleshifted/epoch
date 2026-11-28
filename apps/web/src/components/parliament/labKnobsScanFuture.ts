"use client";
/**
 * scan (future) · 미래의 장소 — the future's remains drawn over the present (FuturePresence.tsx, lib/parliament/futurePresence.ts).
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page; FuturePresence.tsx (useFuturePresenceControls) assembles it into FuturePresenceVisual. Before
 * 2026-11-23 one group, "미래 (개인뷰 · 시험)", held both future groups (its saves are not read any more).
 */

import { button, folder, levaStore, monitor, useControls } from "leva";
import * as THREE from "three";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PRESENCE } from "@/lib/parliament/futurePresence";
import type { PresenceMode } from "./FuturePresence";
import { COLOUR_PROFILES, DEFAULT_RESIDUE, RESIDUE_PRESETS, residueTiming, setResidueLook, type ResidueShowWhen } from "./FutureResidue";

/** The three kinds' everything as it starts (FutureResidue.tsx DEFAULT_RESIDUE): parts, plants, stems. */
const K = DEFAULT_RESIDUE.kinds;

const PLACE_GROUP = LAB_GROUP["scan-future"];

/** THE PLANTS' PALETTE, HER OWN (the artist, 2026-11-27: "색 팔레트 내가 고를 수 있게"): six leaf colours and five flower
 *  colours, each a picker; the buttons load a reference's set into them (then she saves as ever). */
const LEAF_KEYS = ["resLeaf1", "resLeaf2", "resLeaf3", "resLeaf4", "resLeaf5", "resLeaf6"] as const;
const FLOWER_KEYS = ["resFlower1", "resFlower2", "resFlower3", "resFlower4", "resFlower5"] as const;
/** Sets a knob of this group by its key, wherever its folder puts it (the store's path ends with the key). */
function setKnob(key: string, value: unknown): void {
  const data = levaStore.getData() as Record<string, unknown>;
  for (const path of Object.keys(data)) if (path.startsWith(PLACE_GROUP + ".") && path.endsWith("." + key)) levaStore.setValueAtPath(path, value, true);
}
function loadPalette(leaves: readonly string[], flowers: readonly string[], part?: string, stem?: string): void {
  LEAF_KEYS.forEach((k, i) => setKnob(k, leaves[i % leaves.length]));
  FLOWER_KEYS.forEach((k, i) => setKnob(k, flowers[i % flowers.length]));
  // (a colour profile also gives the parts and the stems theirs)
  if (part) setKnob("resColour", part);
  if (stem) setKnob("resStemColour", stem);
}
/** One of her colour profiles, loaded into every colour knob (FutureResidue.tsx COLOUR_PROFILES). */
const loadProfile = (i: number) => () => {
  const p = COLOUR_PROFILES[i];
  if (p) loadPalette(p.leaves, p.flowers, p.part, p.stem);
};
/** The old single green (식생 색), darker and lighter, as a palette. */
function greenPalette(hex: string): { leaves: string[]; flowers: string[] } {
  const c = new THREE.Color(hex), at = (m: number) => "#" + c.clone().multiplyScalar(m).getHexString();
  return { leaves: [at(0.55), at(0.8), at(1), at(1.15), at(0.7), at(1.3)], flowers: [at(1.5)] };
}
/** When the future can be found (FutureResidue.tsx showWhen). */
const SHOW_WHEN: Record<string, ResidueShowWhen> = {
  "늘 — 관찰자 없이도": "always",
  "F 누를 때 — 관찰자와 겹쳤다고 보고 (폰: 버튼)": "press",
  "관찰자가 지나갈 때만": "observer",
};
/** The two intervals as they run now (FutureResidue.tsx residueTiming), for the readout: "2.0 s · 0.50 s · 0 %". */
const timingNow = () => `${residueTiming.every.toFixed(1)} s · ${residueTiming.layer.toFixed(2)} s · ${Math.round(residueTiming.load * 100)} %`;
/** The present's share of its readings now, and the future's points on the screen: "50 % · 4 200". */
const presentNow = () => `${Math.round(residueTiming.present * 100)} % · ${residueTiming.shown.toLocaleString("en-US").replace(/,/g, " ")}`;
/** A knob the chosen way of seeing never reads (kept, saved values and all, but not listed). */
const HIDDEN = () => false;
/** "떠오르는 정도, 흩날리는 거리, 소용돌이는 다 디폴트로 0으로" (the artist, 2026-11-27): once, over what was saved before. */
const BLOW_STILL = { tag: "scan-future-blow-still-2026-11-27", set: Object.fromEntries(["kp", "kl", "ks"].flatMap((p) => [`${p}BlowRise`, `${p}BlowDist`, `${p}BlowTurb`].map((k) => [k, 0]))) };

const PLACE_MODES: Record<string, PresenceMode> = {
  "겹침 — 현재 위에 남은 것이 함께 섬": "overlay",
  "렌즈 — 내 둘레 반경 안에서만": "lens",
  "들여다보기 — F (폰: 버튼)를 누르는 동안": "peek",
};

export function useScanFutureKnobs(isV2: boolean) {
  const v = useControls(
    PLACE_GROUP,
    savable(PLACE_GROUP, {
      overlayOn: { value: false, label: "개인뷰에 켜기 (랩의 이 페이지에서는 늘 보임)" },
      // THE SCAN'S RESIDUE (the artist, 2026-11-27: B, "있을 때만"): while the lidar reads the place, what it reads near the
      // future's remains develops them — only while a future observer is near; they blow away when it leaves
      // (FutureResidue.tsx). Everything a kind does is set apart for each ("그 모든 효과를... 부재 / 줄기 / 식생 따로",
      // "점 크기도 그렇고 걍 전부 다").
      "잔류 — 공통": folder(
        {
          // (the artist, 2026-11-27: "디폴트로는 미래가 항상 보이게, 다른 모드에서는 F 누를 때마다 관찰자랑 겹쳤다고 가정하고 볼
          // 수 있게, 또다른 모드에서는 실제 관찰자 지나갈 때만 동작하게 스위치")
          resShowWhen: { options: SHOW_WHEN, value: DEFAULT_RESIDUE.showWhen as ResidueShowWhen, label: "미래가 보일 때" },
          resPressHold: { value: DEFAULT_RESIDUE.pressHold, min: 0.5, max: 30, step: 0.5, label: "F 한 번에 미래가 머무는 시간 (s)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resShowWhen`) === "press" },
          resGateR: { value: 12, min: 3, max: 40, step: 0.5, label: "관찰자가 있다고 보는 거리 (월드)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resShowWhen`) === "observer" },
          resFind: { value: 0.6, min: 0.1, max: 3, step: 0.05, label: "스캔이 부재를 찾는 거리 (월드)" },
          // ("남는 시간 늘려도 금방금방 사라지지..." — it had only capped the time while the overlap lasted; now: how long it
          // stays after the overlap ends; same key, so her saved value now means that)
          resLife: { value: DEFAULT_RESIDUE.life, min: 0, max: 120, step: 0.5, label: "남는 시간 — 겹침이 끝난 뒤 (s, 0 = 바로 흩날림)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resShowWhen`) !== "always" },
          // (the artist, 2026-11-28, via the coordinator: about every 30 s was too often — one arrival, then none for
          // this long; the guide's line and the daydream's sound come with each arrival, so they keep it too)
          resGap: { value: DEFAULT_RESIDUE.gap, min: 0, max: 300, step: 5, label: "다시 찾아오기까지 최소 (s) — 도착 뒤 이 시간 동안 새 도착 · 응시 없음 (안내 문구 · 소리 같이)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resShowWhen`) === "observer" },
          // (the artist, 2026-11-28: "현재 위치랑 그보다 큰 반경 내에서 겹침 -> 응시 (말로만 … '약한 백일몽'만 4초정도 …
          // 비주얼 효과 없음): 여기서 더 가까이 오면 발견")
          resGazeR: { value: DEFAULT_RESIDUE.gazeR, min: 0, max: 40, step: 0.5, label: "응시 거리 (월드) — 이 안에 오면 말과 약한 백일몽만, 관찰자 거리 안이면 발견 (관찰자 거리보다 커야 함)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resShowWhen`) === "observer" },
          "지금 — 다음 도착 (관찰자 모드)": monitor(() => (residueTiming.wait > 0 ? `${Math.ceil(residueTiming.wait)} s 뒤 다시 올 수 있음` : "지금 올 수 있음"), { graph: false, interval: 500 }),
          resReach: { value: 14, min: 4, max: 40, step: 0.5, label: "보이는 거리 (월드)" },
          // (the artist, 2026-11-27: "미래 다시 읽는 간격이랑 다시 읽어 겹치는 간격 성능 따라 유동적으로 범위 안에서": each
          // interval a range — its saved number is now the shortest — moved by FutureResidue's frame within it)
          resAdapt: { value: DEFAULT_RESIDUE.adapt, label: "두 간격을 성능 따라 자동으로 (끔 = 가장 짧게 고정)" },
          everySec: { value: 2, min: 0.5, max: 10, step: 0.5, label: "미래를 다시 읽는 간격 — 가장 짧게 (s)" },
          resEveryMax: { value: DEFAULT_RESIDUE.everyMax, min: 0.5, max: 20, step: 0.5, label: "미래를 다시 읽는 간격 — 가장 길게 (s)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resAdapt`) },
          resLayerSec: { value: 0.5, min: 0.1, max: 4, step: 0.05, label: "다시 읽어 겹치는 간격 — 가장 짧게 (s)" },
          resLayerMax: { value: DEFAULT_RESIDUE.layerMax, min: 0.1, max: 6, step: 0.05, label: "다시 읽어 겹치는 간격 — 가장 길게 (s)", render: (get) => get(`${PLACE_GROUP}.잔류 — 공통.resAdapt`) },
          "지금 간격 (읽기 · 겹침 · 느려짐)": monitor(timingNow, { graph: false, interval: 500 }),
          resStagger: { value: 1.2, min: 0, max: 4, step: 0.1, label: "흩날릴 때 바람이 훑고 지나가는 시간 (s)" },
        },
        { collapsed: false },
      ),
      // (the artist, 2026-11-27: "미래랑 현재는 거리 따라 lod/흐림/뭉침 적용하는 정도 따로", then "부재나 종류마다 정하지
      // 말고 그냥 미래/현재만 따로": one set for the whole future, by the present's rules at its own numbers; the present's
      // are scan (present)'s 먼 점 / 너무 가까운 점 knobs and the base's 가까운/먼 흐림)
      "거리 효과 — 미래 (멀리 성김 · 뭉침 · 흐림)": folder(
        {
          resFar: { value: DEFAULT_RESIDUE.far, min: 0, max: 40, step: 0.5, label: "멀리 — 시작 거리 (월드; 0 = 끔)" },
          resThinD: { value: DEFAULT_RESIDUE.thinD, min: 0, max: 3, step: 0.05, label: "멀리 성기게 — 정도 (0 = 그대로, 1 = 현재처럼)" },
          resClump: { value: DEFAULT_RESIDUE.clump, min: 0, max: 2, step: 0.05, label: "멀리 뭉치기 (점 커짐) — 정도 (0 = 그대로, 1 = 현재처럼)" },
          resNear: { value: DEFAULT_RESIDUE.near, min: 0, max: 8, step: 0.25, label: "너무 가까운 점 성기게 (월드; 현재처럼, 0 = 끔)" },
          // ("또렷한 거리는 없어야", "'현재' 점의 거리 효과랑은 너무 다르게", "너무 또렷하잖아": the photograph's own rule,
          // as the base's 가까운 / 먼 흐림 soften the present, at the future's own radii)
          resInkNear: { value: DEFAULT_RESIDUE.inkNear, min: 0, max: 8, step: 0.1, label: "가까운 흐림 (px — 현재의 '가까운 흐림'과 같은 방식)" },
          resInkFar: { value: DEFAULT_RESIDUE.inkFar, min: 0, max: 24, step: 0.5, label: "먼 흐림 (px — 현재의 '먼 흐림'과 같은 방식)" },
        },
        { collapsed: false },
      ),
      // (the artist, 2026-11-27: "미래가 나타났을 때 현재 렌더에 점 덜 쓰는 방식으로 성능 조절")
      "현재 점 줄이기 — 미래가 보일 때 (성능)": folder(
        {
          resPresentShare: { value: DEFAULT_RESIDUE.presentShare, min: 0.05, max: 1, step: 0.05, label: "미래가 보일 때 현재 점 비율 (1 = 줄이지 않음)" },
          resPresentFull: { value: DEFAULT_RESIDUE.presentFull, min: 100, max: 40000, step: 100, label: "미래 점이 이만큼 보이면 다 줄임 (점 수)" },
          "지금 현재 점 비율 · 보이는 미래 점": monitor(presentNow, { graph: false, interval: 500 }),
        },
        { collapsed: false },
      ),
      "건물 부재 (둔덕 · 흙 포함)": folder(
        {
          resColour: { value: "#ffffff", label: "부재 색" },
          resConcrete: { value: 0.7, min: 0, max: 1, step: 0.05, label: "콘크리트 밝기 (철골·말뚝 = 1)" },
          "건물 부재 (둔덕 · 흙 포함) · 점": folder(
            {
              kpDot: { value: K.part.dot, min: 0.5, max: 8, step: 0.1, label: "점 크기 (px)" },
              kpSizeVar: { value: K.part.sizeVar, min: 0, max: 1, step: 0.05, label: "점 크기 편차 (0 = 고르게)" },
              kpSoft: { value: K.part.soft, min: 0, max: 1, step: 0.05, label: "점 부드러움 (0 = 또렷)" },
              // (the artist, 2026-11-27: "각 레바별로 점 수나 밀도 정할 수 있게": each kind's count here, × what it makes)
              kpDensity: { value: K.part.density, min: 0, max: 4, step: 0.05, label: "점 수 (× — 1 = 지금, 0 = 없음; 둔덕·흙 포함)" },
              // (moved here from 미래 읽기, saved value and all)
              surface: { value: 30, min: 5, max: 120, step: 1, label: "겉면 점 밀도 (부재 한 면적당)" },
            },
            { collapsed: true },
          ),
          "건물 부재 (둔덕 · 흙 포함) · 나타남": folder(
            {
              kpSpread: { value: K.part.spread, min: 0.5, max: 30, step: 0.5, label: "찾은 자리에서 번지는 속도 (월드/s)" },
              kpDevelop: { value: K.part.develop, min: 0, max: 5, step: 0.1, label: "스캔 색에서 제 색으로 바래는 시간 (s)" },
            },
            { collapsed: true },
          ),
          // (the artist, 2026-11-28: "글리치는 녹아내릴(흩날릴) 때만 적용되도록" — held, the earlier layers are a clean
          // exposure; the five below act only as the future blows away)
          "건물 부재 (둔덕 · 흙 포함) · 장노출 (이전 읽기) · 글리치 (흩날릴 때만)": folder(
            {
              kpJitter: { value: K.part.jitter, min: 0, max: 0.3, step: 0.005, label: "읽을 때마다 어긋남 (월드)" },
              kpGhostAlpha: { value: K.part.ghostAlpha, min: 0, max: 1, step: 0.05, label: "이전 읽기의 진하기 (0 = 없음)" },
              kpGhostLife: { value: K.part.ghostLife, min: 0.2, max: 12, step: 0.1, label: "이전 읽기가 남는 시간 (s)" },
              kpBleed: { value: K.part.bleed, min: 0, max: 1, step: 0.05, label: "번짐 — 흩날릴 때 (점 커지고 흐려짐)" },
              kpTear: { value: K.part.tear, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 가로 찢김" },
              kpDrip: { value: K.part.drip, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 세로 흘러내림 (녹아내림)" },
              kpBlock: { value: K.part.block, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 블록 (빠짐 · 점 커짐)" },
              kpThin: { value: K.part.thin, min: 0, max: 1, step: 0.05, label: "성겨짐 — 흩날릴 때" },
            },
            { collapsed: true },
          ),
          "건물 부재 (둔덕 · 흙 포함) · 흩날림": folder(
            {
              kpBlowTime: { value: K.part.blow.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              kpBlowDist: { value: K.part.blow.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              kpBlowRise: { value: K.part.blow.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              kpBlowTurb: { value: K.part.blow.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              kpBlowBloom: { value: K.part.blow.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
              kpSmear: { value: K.part.smear, min: 0, max: 3, step: 0.05, label: "흩날릴 때 번짐 (s, 0 = 없음)" },
              kpSmearAlpha: { value: K.part.smearAlpha, min: 0, max: 1, step: 0.05, label: "흩날릴 때 번짐 진하기" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: false },
      ),
      "줄기": folder(
        {
          resStemColour: { value: DEFAULT_RESIDUE.stemColour, label: "줄기 색" },
          "줄기 · 점": folder(
            {
              ksDot: { value: K.stem.dot, min: 0.5, max: 8, step: 0.1, label: "점 크기 (px)" },
              ksSizeVar: { value: K.stem.sizeVar, min: 0, max: 1, step: 0.05, label: "점 크기 편차 (0 = 고르게)" },
              ksSoft: { value: K.stem.soft, min: 0, max: 1, step: 0.05, label: "점 부드러움 (0 = 또렷)" },
              ksDensity: { value: K.stem.density, min: 0, max: 4, step: 0.05, label: "점 수 (× — 1 = 지금, 0 = 없음)" },
            },
            { collapsed: true },
          ),
          "줄기 · 나타남": folder(
            {
              ksSpread: { value: K.stem.spread, min: 0.5, max: 30, step: 0.5, label: "찾은 자리에서 번지는 속도 (월드/s)" },
              ksDevelop: { value: K.stem.develop, min: 0, max: 5, step: 0.1, label: "스캔 색에서 제 색으로 바래는 시간 (s)" },
            },
            { collapsed: true },
          ),
          "줄기 · 장노출 (이전 읽기) · 글리치 (흩날릴 때만)": folder(
            {
              ksJitter: { value: K.stem.jitter, min: 0, max: 0.3, step: 0.005, label: "읽을 때마다 어긋남 (월드)" },
              ksGhostAlpha: { value: K.stem.ghostAlpha, min: 0, max: 1, step: 0.05, label: "이전 읽기의 진하기 (0 = 없음)" },
              ksGhostLife: { value: K.stem.ghostLife, min: 0.2, max: 12, step: 0.1, label: "이전 읽기가 남는 시간 (s)" },
              ksBleed: { value: K.stem.bleed, min: 0, max: 1, step: 0.05, label: "번짐 — 흩날릴 때 (점 커지고 흐려짐)" },
              ksTear: { value: K.stem.tear, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 가로 찢김" },
              ksDrip: { value: K.stem.drip, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 세로 흘러내림 (녹아내림)" },
              ksBlock: { value: K.stem.block, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 블록 (빠짐 · 점 커짐)" },
              ksThin: { value: K.stem.thin, min: 0, max: 1, step: 0.05, label: "성겨짐 — 흩날릴 때" },
            },
            { collapsed: true },
          ),
          "줄기 · 흩날림": folder(
            {
              ksBlowTime: { value: K.stem.blow.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              ksBlowDist: { value: K.stem.blow.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              ksBlowRise: { value: K.stem.blow.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              ksBlowTurb: { value: K.stem.blow.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              ksBlowBloom: { value: K.stem.blow.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
              ksSmear: { value: K.stem.smear, min: 0, max: 3, step: 0.05, label: "흩날릴 때 번짐 (s, 0 = 없음)" },
              ksSmearAlpha: { value: K.stem.smearAlpha, min: 0, max: 1, step: 0.05, label: "흩날릴 때 번짐 진하기" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: true },
      ),
      "식생 (잎 · 풀 · 꽃)": folder(
        {
          // (A + C, the artist 2026-11-27: "미래 색을 좀 더 꿈처럼 다채롭게", "색 팔레트 내가 고를 수 있게")
          "식생 팔레트 — 직접 고르기": folder(
            {
              "정원 IMG_1586 색 불러오기": button(() => loadPalette(RESIDUE_PRESETS.garden.leaves, RESIDUE_PRESETS.garden.flowers)),
              "밤 숲 IMG_1587 색 불러오기": button(() => loadPalette(RESIDUE_PRESETS.night.leaves, RESIDUE_PRESETS.night.flowers)),
              // (her colour profiles, 2026-11-27: "컬러 프로파일 찾아봄" — each also sets the parts' and the stems' colours)
              "프로파일 · 코발트 · 주홍 (0637)": button(loadProfile(0)),
              "프로파일 · Eco-Electric (1970)": button(loadProfile(1)),
              "프로파일 · 보라 소용돌이 (1971)": button(loadProfile(2)),
              "프로파일 · 점묘 노을 (1973)": button(loadProfile(3)),
              "프로파일 · 라벤더 흘러내림 (1974)": button(loadProfile(4)),
              "프로파일 · 들꽃 · 감지 상자 (1975)": button(loadProfile(5)),
              "프로파일 · 청록 엉겅퀴 (1976)": button(loadProfile(6)),
              "초록 하나 (식생 색) 불러오기": button(() => {
                const g = greenPalette(String((levaStore.getData() as Record<string, { value?: unknown }>)[`${PLACE_GROUP}.미래 읽기.plantColor`]?.value ?? "#2f8f3f"));
                loadPalette(g.leaves, g.flowers);
              }),
              resLeaf1: { value: RESIDUE_PRESETS.garden.leaves[0], label: "잎 1" },
              resLeaf2: { value: RESIDUE_PRESETS.garden.leaves[1], label: "잎 2" },
              resLeaf3: { value: RESIDUE_PRESETS.garden.leaves[2], label: "잎 3" },
              resLeaf4: { value: RESIDUE_PRESETS.garden.leaves[3], label: "잎 4" },
              resLeaf5: { value: RESIDUE_PRESETS.garden.leaves[4], label: "잎 5" },
              resLeaf6: { value: RESIDUE_PRESETS.garden.leaves[5], label: "잎 6" },
              resFlower1: { value: RESIDUE_PRESETS.garden.flowers[0], label: "꽃 1" },
              resFlower2: { value: RESIDUE_PRESETS.garden.flowers[1], label: "꽃 2" },
              resFlower3: { value: RESIDUE_PRESETS.garden.flowers[2], label: "꽃 3" },
              resFlower4: { value: RESIDUE_PRESETS.garden.flowers[3], label: "꽃 4" },
              resFlower5: { value: RESIDUE_PRESETS.garden.flowers[4], label: "꽃 5" },
            },
            { collapsed: true },
          ),
          resSat: { value: 1, min: 0, max: 1.8, step: 0.05, label: "식생 채도" },
          resFlower: { value: 0.5, min: 0, max: 1, step: 0.05, label: "꽃 비율" },
          // (the artist, 2026-11-27: "컬러팔레트가 시간에 따라 유기적으로 변하게 … 식생에 대해서만", "대비되는 색 … 마지막에만 확
          // 번져서")
          "식생 · 색의 흐름 (시간)": folder(
            {
              resPlantFlow: { value: DEFAULT_RESIDUE.plantFlow, min: 0, max: 1, step: 0.05, label: "팔레트를 따라 흐르는 정도 (0 = 고정)" },
              resPlantFlowSec: { value: DEFAULT_RESIDUE.plantFlowSec, min: 2, max: 120, step: 1, label: "팔레트 한 바퀴 (s)" },
              resPlantFlowScale: { value: DEFAULT_RESIDUE.plantFlowScale, min: 1, max: 40, step: 0.5, label: "색 물결의 크기 (월드)" },
              resPlantContrast: { value: DEFAULT_RESIDUE.plantContrast, min: 0, max: 1, step: 0.05, label: "대비 색(꽃 색)이 잎 사이로 번지는 정도" },
            },
            { collapsed: false },
          ),
          "식생 (잎 · 풀 · 꽃) · 점": folder(
            {
              klDot: { value: K.leaf.dot, min: 0.5, max: 8, step: 0.1, label: "점 크기 (px)" },
              klSizeVar: { value: K.leaf.sizeVar, min: 0, max: 1, step: 0.05, label: "점 크기 편차 (0 = 고르게)" },
              klSoft: { value: K.leaf.soft, min: 0, max: 1, step: 0.05, label: "점 부드러움 (0 = 또렷)" },
              klDensity: { value: K.leaf.density, min: 0, max: 4, step: 0.05, label: "점 수 (× — 1 = 지금, 0 = 없음; 나무·풀·꽃 전부)" },
              // (moved here from the 식생 folder, saved values and all)
              resPlantDensity: { value: 8, min: 0, max: 60, step: 1, label: "풀숲 점 밀도 (한 면적당)" },
              resTreeFull: { value: 4, min: 1, max: 10, step: 0.5, label: "나무 수관 풍성함 (× — 줄기 점 수도 따라감)" },
            },
            { collapsed: true },
          ),
          "식생 (잎 · 풀 · 꽃) · 나타남": folder(
            {
              klSpread: { value: K.leaf.spread, min: 0.5, max: 30, step: 0.5, label: "찾은 자리에서 번지는 속도 (월드/s)" },
              klDevelop: { value: K.leaf.develop, min: 0, max: 5, step: 0.1, label: "스캔 색에서 제 색으로 바래는 시간 (s)" },
            },
            { collapsed: true },
          ),
          "식생 (잎 · 풀 · 꽃) · 장노출 (이전 읽기) · 글리치 (흩날릴 때만)": folder(
            {
              klJitter: { value: K.leaf.jitter, min: 0, max: 0.3, step: 0.005, label: "읽을 때마다 어긋남 (월드)" },
              klGhostAlpha: { value: K.leaf.ghostAlpha, min: 0, max: 1, step: 0.05, label: "이전 읽기의 진하기 (0 = 없음)" },
              klGhostLife: { value: K.leaf.ghostLife, min: 0.2, max: 12, step: 0.1, label: "이전 읽기가 남는 시간 (s)" },
              klBleed: { value: K.leaf.bleed, min: 0, max: 1, step: 0.05, label: "번짐 — 흩날릴 때 (점 커지고 흐려짐)" },
              klTear: { value: K.leaf.tear, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 가로 찢김" },
              klDrip: { value: K.leaf.drip, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 세로 흘러내림 (녹아내림)" },
              klBlock: { value: K.leaf.block, min: 0, max: 1, step: 0.05, label: "글리치 — 흩날릴 때: 블록 (빠짐 · 점 커짐)" },
              klThin: { value: K.leaf.thin, min: 0, max: 1, step: 0.05, label: "성겨짐 — 흩날릴 때" },
            },
            { collapsed: true },
          ),
          "식생 (잎 · 풀 · 꽃) · 흩날림": folder(
            {
              klBlowTime: { value: K.leaf.blow.time, min: 0.3, max: 8, step: 0.1, label: "흩날리는 시간 (s)" },
              klBlowDist: { value: K.leaf.blow.dist, min: 0, max: 20, step: 0.5, label: "흩날리는 거리 (월드)" },
              klBlowRise: { value: K.leaf.blow.rise, min: -3, max: 6, step: 0.1, label: "떠오르는 정도 (월드, − = 떨어짐)" },
              klBlowTurb: { value: K.leaf.blow.turb, min: 0, max: 3, step: 0.05, label: "소용돌이 (0 = 곧게)" },
              klBlowBloom: { value: K.leaf.blow.bloom, min: 0, max: 1, step: 0.05, label: "흩날릴 때 피는 색" },
              klSmear: { value: K.leaf.smear, min: 0, max: 3, step: 0.05, label: "흩날릴 때 번짐 (s, 0 = 없음)" },
              klSmearAlpha: { value: K.leaf.smearAlpha, min: 0, max: 1, step: 0.05, label: "흩날릴 때 번짐 진하기" },
            },
            { collapsed: true },
          ),
        },
        { collapsed: true },
      ),
      // (the old overlay of lines on paper, FuturePresence.tsx — drawn only with the lidar off; hidden: the scan view never
      // reads them; saved values kept — the artist, 2026-11-27: "불필요한 레바 정리해줘")
      overlayMode: { options: PLACE_MODES, value: "overlay" as PresenceMode, label: "방식 (라이다가 꺼져 있을 때)", render: HIDDEN },
      radius: { value: 14, min: 4, max: 40, step: 1, label: "렌즈 반경", render: HIDDEN },
      showRemains: { value: true, label: "남은 부재", render: HIDDEN },
      showPlants: { value: true, label: "식생", render: HIDDEN },
      showDeposits: { value: true, label: "둔덕 · 어두운 흙", render: HIDDEN },
      showTraces: { value: true, label: "내 흔적", render: HIDDEN },
      edgeColor: { value: "#8c8c8c", label: "남은 부재의 선 색", render: HIDDEN },
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
          // (the old overlay's green, read only by the 초록 하나 palette button now)
          plantColor: { value: "#2f8f3f", label: "식생 색", render: HIDDEN },
        },
        { collapsed: true },
      ),
    }, [], [BLOW_STILL]),
    { collapsed: false, order: 0.8, render: () => isV2 && labLists("scan-future") },
  );
  // (a plain module value, read per frame by FutureResidue — set before it reads it, as the lidar's look is)
  setResidueLook({
    on: v.overlayOn,
    showWhen: v.resShowWhen as ResidueShowWhen,
    pressHold: v.resPressHold,
    gateR: v.resGateR,
    find: v.resFind,
    life: v.resLife,
    gap: v.resGap,
    gazeR: v.resGazeR,
    reach: v.resReach,
    layerSec: v.resLayerSec,
    adapt: v.resAdapt,
    everyMax: v.resEveryMax,
    layerMax: v.resLayerMax,
    presentShare: v.resPresentShare,
    presentFull: v.resPresentFull,
    far: v.resFar,
    thinD: v.resThinD,
    clump: v.resClump,
    near: v.resNear,
    inkNear: v.resInkNear,
    inkFar: v.resInkFar,
    stagger: v.resStagger,
    colour: v.resColour,
    concrete: v.resConcrete,
    stemColour: v.resStemColour,
    leaves: LEAF_KEYS.map((k) => v[k]),
    flowers: FLOWER_KEYS.map((k) => v[k]),
    sat: v.resSat,
    flower: v.resFlower,
    plantDensity: v.resPlantDensity,
    treeFull: v.resTreeFull,
    plantFlow: v.resPlantFlow,
    plantFlowSec: v.resPlantFlowSec,
    plantFlowScale: v.resPlantFlowScale,
    plantContrast: v.resPlantContrast,
    // (each kind's own everything, its 점 수 included)
    kinds: {
      part: { dot: v.kpDot, sizeVar: v.kpSizeVar, soft: v.kpSoft, density: v.kpDensity, spread: v.kpSpread, develop: v.kpDevelop, jitter: v.kpJitter, ghostAlpha: v.kpGhostAlpha, ghostLife: v.kpGhostLife, bleed: v.kpBleed, tear: v.kpTear, drip: v.kpDrip, block: v.kpBlock, thin: v.kpThin, blow: { time: v.kpBlowTime, dist: v.kpBlowDist, rise: v.kpBlowRise, turb: v.kpBlowTurb, bloom: v.kpBlowBloom }, smear: v.kpSmear, smearAlpha: v.kpSmearAlpha },
      leaf: { dot: v.klDot, sizeVar: v.klSizeVar, soft: v.klSoft, density: v.klDensity, spread: v.klSpread, develop: v.klDevelop, jitter: v.klJitter, ghostAlpha: v.klGhostAlpha, ghostLife: v.klGhostLife, bleed: v.klBleed, tear: v.klTear, drip: v.klDrip, block: v.klBlock, thin: v.klThin, blow: { time: v.klBlowTime, dist: v.klBlowDist, rise: v.klBlowRise, turb: v.klBlowTurb, bloom: v.klBlowBloom }, smear: v.klSmear, smearAlpha: v.klSmearAlpha },
      stem: { dot: v.ksDot, sizeVar: v.ksSizeVar, soft: v.ksSoft, density: v.ksDensity, spread: v.ksSpread, develop: v.ksDevelop, jitter: v.ksJitter, ghostAlpha: v.ksGhostAlpha, ghostLife: v.ksGhostLife, bleed: v.ksBleed, tear: v.ksTear, drip: v.ksDrip, block: v.ksBlock, thin: v.ksThin, blow: { time: v.ksBlowTime, dist: v.ksBlowDist, rise: v.ksBlowRise, turb: v.ksBlowTurb, bloom: v.ksBlowBloom }, smear: v.ksSmear, smearAlpha: v.ksSmearAlpha },
    },
  });

  return v;
}
