/**
 * THE RENDER FOLDER (렌더): every setting that costs pixels or GPU time, as live knobs on the wall (the artist,
 * 2026-11-16) — the wall is pixel-bound (fps falls with canvas width; dpr 1 and shadows off helped), so these are what
 * to turn while watching the frame rate.
 *
 * Each knob that the test render (세계 › 테스트 렌더) or the hidden "렌더 · 성능" group already decides has an "자동"
 * value: it then does what it did before (the saved value, capped by the test render / performance mode). Any other
 * value overrides both. With every knob on its default the picture is exactly what it was. Saved like every other
 * group (savable: the save / reload row, the server). V1 (frozen) ignores the folder.
 *
 * The fine sliders of the hidden groups (AO radius / falloff / strength, the sun, the grain amount, the depth of
 * field, LOD) are here too (the artist, the same day: "켬, 끔 이상으로 … 세세한 조정도"): they start from the values
 * those groups hold (saved or default) until 렌더 itself is saved, and from then on 렌더's own saved values win.
 *
 * antialias and preserveDrawingBuffer are fixed when the WebGL context is made: the Canvas is remounted (its key)
 * when they change — the scene inside is rebuilt, the world outside the Canvas goes on.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { folder, useControls } from "leva";
import * as THREE from "three";
import { BlendFunction, Effect } from "postprocessing";
import { savable } from "./levaSave";

type Tri = "auto" | "on" | "off";
export type AoQuality = "performance" | "low" | "medium" | "high" | "ultra";
export type ShadowType = "basic" | "percentage" | "variance";
type TestPerf = "off" | "light" | "min";

const GROUP = "렌더";
const AUTO_LABEL = "자동 (저장값 · 테스트 렌더 따름)";
const tri = (label: string) => ({ options: { [AUTO_LABEL]: "auto", "켬": "on", "끔": "off" } as Record<string, Tri>, value: "auto" as Tri, label });

export interface RenderInputs {
  isV2: boolean;
  testPerf: TestPerf;
  /** 렌더 · 성능 › 성능 모드 (hidden group, saved value). */
  perfMode: boolean;
  /** The exhibition wall (ui=0): the drawing buffer is not kept by default. */
  wall: boolean;
  /** THE HERO SHOT (HeroShot.tsx): every knob on 자동 takes its best, whatever the test render or performance mode
   *  says; a knob set to 끔 by hand stays off (it is part of the look). */
  hero?: boolean;
  /** While a hero shot is being saved: the pixel ratio it is drawn at and the composer's MSAA (lower above a size). */
  shot?: { dpr: number; msaa: number } | null;
  /** The values the picture used so far (the hidden groups' saved values). */
  saved: {
    dprMax: number;
    shadows: boolean;
    aoOn: boolean;
    aoQuality: AoQuality;
    aoHalfRes: boolean;
    grain: number;
    dof: boolean;
    transmissionScale: number;
    aoRadius: number;
    distanceFalloff: number;
    aoIntensity: number;
    azimuth: number;
    elevation: number;
    sunIntensity: number;
    softness: number;
    dofRange: number;
    dofBokeh: number;
    lodNear: number;
    lodMid: number;
    /** 전시 카메라 › 해 (자동 운행): minutes for one turn of the sun's azimuth (0 = fixed). */
    sunTurnMin: number;
  };
}

/** The fine values (the sliders of the pre-redesign 렌더 · 성능 / 보기 groups, brought into 렌더). */
export interface RenderDetail {
  aoRadius: number;
  distanceFalloff: number;
  aoIntensity: number;
  azimuth: number;
  elevation: number;
  sunIntensity: number;
  softness: number;
  dofRange: number;
  dofBokeh: number;
  /** Where the focus is: following the click / the view's centre, or at `dofDist` from the camera. */
  dofFocus: "follow" | "dist";
  /** The focus's distance from the camera (world), when `dofFocus` is "dist". */
  dofDist: number;
  lodNear: number;
  lodMid: number;
}

export interface RenderOptions {
  dpr: number | [number, number];
  antialias: boolean;
  preserveDrawingBuffer: boolean;
  /** Changes when the GL context must be made anew (antialias, preserveDrawingBuffer): the Canvas's key. */
  canvasKey: string;
  shadowsOn: boolean;
  shadowType: ShadowType;
  shadowMapSize: number;
  ao: boolean;
  aoQuality: AoQuality;
  aoHalfRes: boolean;
  /** 0 = no grain pass. */
  grain: number;
  /** The grain stands still (the same pattern every frame) instead of changing every frame. */
  grainStill: boolean;
  /** The sun's turn: null = as 전시 카메라 › 해 says; otherwise minutes for one turn (0 = the sun stands). */
  sunTurnMin: number | null;
  dof: boolean;
  /** Any post-processing pass on. */
  composerOn: boolean;
  composerMsaa: number;
  /** false = the resin's transmission (refraction pass) off. */
  refraction: boolean;
  transmissionScale: number;
  /** The vegetation points actually drawn, from the folder's count. */
  vegCount: (n: number) => number;
  detail: RenderDetail;
}

const pick = (t: Tri, auto: boolean) => (t === "auto" ? auto : t === "on");

export function useRenderOptions(inp: RenderInputs): RenderOptions {
  const { isV2, wall, saved } = inp;
  const hero = !!inp.hero && isV2;
  // (the hero shot: no test render, no performance mode)
  const testPerf: TestPerf = hero ? "off" : inp.testPerf;
  const perfMode = hero ? false : inp.perfMode;
  const k = useControls(
    GROUP,
    savable(GROUP, {
      dpr: {
        options: { [AUTO_LABEL]: 0, "0.5×": 0.5, "0.75×": 0.75, "1× (픽셀 하나에 하나)": 1, "1.25×": 1.25, "1.5×": 1.5, "2× (레티나 전부)": 2 } as Record<string, number>,
        value: 0,
        label: "해상도 (화면 픽셀 배율 · 비용이 가장 큼, 배율의 제곱으로 늘어남)",
      },
      antialias: { value: true, label: "안티앨리어싱 MSAA (후처리 없을 때만 보임 · 바꾸면 캔버스를 다시 만듦, 장면이 잠깐 끊김)" },
      keepBuffer: { ...tri("화면 버퍼 보존 (캡처용 · 자동 = 벽에선 끔 · 바꾸면 캔버스를 다시 만듦)") },
      "그림자": folder({
        shadows: tri("그림자 (끄면 해가 장면을 한 번 더 그리지 않음)"),
        shadowType: {
          options: { "PCF (지금까지)": "percentage", "기본 (딱딱한 가장자리 · 가장 쌈)": "basic", "VSM (부드러움 · 블러 패스 추가)": "variance" } as Record<string, ShadowType>,
          value: "percentage" as ShadowType,
          label: "그림자 방식",
        },
        shadowMap: {
          options: { "512": 512, "1024": 1024, "2048 (지금까지)": 2048, "4096": 4096 } as Record<string, number>,
          value: 2048,
          label: "그림자 맵 크기 (픽셀 · 클수록 선명하고 비쌈)",
        },
        "해 · 그림자 세부": folder(
          {
            azimuth: { value: saved.azimuth, min: 0, max: 360, step: 1, label: "해 방위 (°)" },
            elevation: { value: saved.elevation, min: 5, max: 89, step: 1, label: "해 고도 (°)" },
            sunIntensity: { value: saved.sunIntensity, min: 0, max: 4, step: 0.05, label: "해 세기 (그림자 대비)" },
            softness: { value: saved.softness, min: 0, max: 12, step: 0.5, label: "그림자 부드러움 (PCF · VSM에서만)" },
          },
          { collapsed: true },
        ),
      }),
      // THE SUN TURNS (the artist, 2026-11-17: "해 돌아가는 거 옵션 추가해 이전버전에 있던 거"): the pre-redesign wall's
      // sun day (전시 카메라 › 해 (자동 운행)), switched and paced here
      "해 돌기": folder(
        {
          sunSpin: { options: { "자동 (전시 카메라 › 해 값 따름)": "auto", "켬": "on", "끔 (해 고정)": "off" } as Record<string, Tri>, value: "auto" as Tri, label: "해가 돎" },
          sunSpinMin: { value: saved.sunTurnMin > 0 ? saved.sunTurnMin : 90, min: 0.5, max: 480, step: 0.5, label: "해 한 바퀴 (분 · 켬일 때)" },
        },
        { collapsed: false },
      ),
      "후처리": folder({
        composerMsaa: {
          options: { "0 (끔)": 0, "2": 2, "4": 4, "8 (지금까지)": 8 } as Record<string, number>,
          value: 8,
          label: "후처리 MSAA 샘플 (후처리가 켜져 있으면 계단은 이것이 지움 · 8 = 가장 비쌈)",
        },
        ao: tri("AO (그늘 · 화면 전체에 드는 패스)"),
        aoQuality: {
          options: { [AUTO_LABEL]: "auto", performance: "performance", low: "low", medium: "medium", high: "high", ultra: "ultra" } as Record<string, "auto" | AoQuality>,
          value: "auto" as "auto" | AoQuality,
          label: "AO 품질",
        },
        aoHalfRes: tri("AO 절반 해상도 (켬 = 비용 ¼)"),
        "AO 세부": folder(
          {
            aoRadius: { value: saved.aoRadius, min: 0.1, max: 12, step: 0.1, label: "AO 반경 (월드)" },
            distanceFalloff: { value: saved.distanceFalloff, min: 0.05, max: 4, step: 0.05, label: "AO 거리 감쇠" },
            aoIntensity: { value: saved.aoIntensity, min: 0, max: 12, step: 0.1, label: "AO 세기" },
          },
          { collapsed: true },
        ),
        grain: tri("그레인"),
        grainAmount: { value: saved.grain > 0 ? saved.grain : 0.18, min: 0.01, max: 1, step: 0.01, label: "그레인 양" },
        // (the artist, 2026-11-17: "그레인 고정시키고")
        grainStill: { value: true, label: "그레인 고정 (끄면 매 프레임 바뀌며 지글거림)" },
        dof: tri("피사계 심도 (흐림 · 비쌈)"),
        // THE FOCUS: WHERE IT IS AND HOW DEEP, APART (the artist, 2026-11-18: "초점 맞는 거리가 아니라 '폭'이랑 '거리'
        // 따로 … 지금 80까지로 걸려서 원하는 곳에 포커스 못 맞추고"): the distance is either followed (the click, the
        // view's centre — 보기 › 초점 · 시야) or set here; the width is how deep the sharp band is around it
        "피사계 심도 세부": folder(
          {
            dofFocus: {
              options: { "따라감 — 클릭한 곳 · 화면 중앙 (보기 › 초점 · 시야)": "follow", "거리로 정함 (아래 '초점 거리')": "dist" } as Record<string, "follow" | "dist">,
              value: "follow" as "follow" | "dist",
              label: "초점의 자리",
            },
            dofDist: { value: 120, min: 1, max: 800, step: 1, label: "초점 거리 (카메라에서 · 월드 · '거리로 정함'일 때)" },
            dofRange: { value: saved.dofRange, min: 0.5, max: 400, step: 0.5, label: "초점 폭 (초점 앞뒤로 이만큼이 또렷 · 월드 · 작을수록 얕은 심도)" },
            dofBokeh: { value: saved.dofBokeh, min: 0, max: 15, step: 0.5, label: "흐림 정도 (초점 밖이 얼마나 번지나)" },
          },
          { collapsed: true },
        ),
      }),
      "굴절": folder({
        refraction: tri("레진 굴절 (레진이 굴절 모드일 때만 · 장면을 매 프레임 한 번 더 그림)"),
        refractScale: {
          options: { [AUTO_LABEL]: 0, "0.25": 0.25, "0.5": 0.5, "0.75": 0.75, "1": 1 } as Record<string, number>,
          value: 0,
          label: "굴절 패스 해상도",
        },
      }),
      vegShare: {
        options: { [AUTO_LABEL]: 0, "1 (전부)": 1, "2/3": 0.66, "1/2": 0.5, "1/3": 0.33, "1/5": 0.2 } as Record<string, number>,
        value: 0,
        label: "식생 점 비율 (그리는 점 수)",
      },
      LOD: folder(
        {
          lodNear: { value: saved.lodNear, min: 5, max: 400, step: 5, label: "이 거리 안쪽: 막대 묶음 · 드립 다 그림 (월드 · 성능 모드면 25까지)" },
          lodMid: { value: saved.lodMid, min: 5, max: 600, step: 5, label: "이 거리까지: 막대 절반 · 드립 없음; 그 너머: 통짜 매스 (월드 · 성능 모드면 50까지)" },
        },
        { collapsed: true },
      ),
    }),
    { order: 0.45, collapsed: true, render: () => isV2 },
  );

  const perf = perfMode || testPerf !== "off";
  const post = testPerf === "off";
  const autoDpr: number | [number, number] = testPerf === "min" ? 0.6 : testPerf === "light" ? 1 : [1, perf ? Math.min(1.25, saved.dprMax) : saved.dprMax];
  const autoTransScale = perf ? Math.min(0.25, saved.transmissionScale) : saved.transmissionScale;
  const autoVeg = (n: number) => (testPerf === "min" ? Math.max(5000, Math.round(n / 3)) : n);

  const savedDetail: RenderDetail = {
    aoRadius: saved.aoRadius,
    distanceFalloff: saved.distanceFalloff,
    aoIntensity: saved.aoIntensity,
    azimuth: saved.azimuth,
    elevation: saved.elevation,
    sunIntensity: saved.sunIntensity,
    softness: saved.softness,
    dofRange: saved.dofRange,
    dofBokeh: saved.dofBokeh,
    dofFocus: "follow",
    dofDist: 120,
    lodNear: perf ? Math.min(saved.lodNear, 25) : saved.lodNear,
    lodMid: perf ? Math.min(saved.lodMid, 50) : saved.lodMid,
  };

  if (!isV2) {
    // V1 is frozen: the picture as it was, whatever the folder holds
    const ao = saved.aoOn && post;
    const grain = post ? saved.grain : 0;
    const dof = saved.dof && post;
    return {
      dpr: autoDpr,
      antialias: true,
      preserveDrawingBuffer: !wall,
      canvasKey: "gl",
      shadowsOn: saved.shadows && !perf,
      shadowType: "percentage",
      shadowMapSize: 2048,
      ao,
      aoQuality: perf ? "performance" : saved.aoQuality,
      aoHalfRes: perf || saved.aoHalfRes,
      grain,
      grainStill: false,
      sunTurnMin: null,
      dof,
      composerOn: ao || grain > 0 || dof,
      composerMsaa: 8,
      refraction: !perf,
      transmissionScale: autoTransScale,
      vegCount: autoVeg,
      detail: savedDetail,
    };
  }

  const dprPick = k.dpr as number;
  // an explicit ratio is an upper bound (a screen with fewer device pixels gets its own); below 1 it is exact
  // (the hero shot: 2 while composing — every screen pixel drawn four times over — and the shot's own while saving)
  const dpr: number | [number, number] = hero ? (inp.shot ? inp.shot.dpr : 2) : dprPick > 0 ? (dprPick < 1 ? dprPick : [1, dprPick]) : autoDpr;
  const antialias = hero ? true : (k.antialias as boolean);
  const preserveDrawingBuffer = pick(k.keepBuffer as Tri, !wall);
  const ao = pick(k.ao as Tri, (saved.aoOn || hero) && post);
  const grainOn = pick(k.grain as Tri, saved.grain > 0 && post);
  const grain = grainOn ? (k.grainAmount as number) : 0;
  const dof = pick(k.dof as Tri, saved.dof && post);
  const q = k.aoQuality as "auto" | AoQuality;
  const share = k.vegShare as number;
  const ts = k.refractScale as number;
  if (hero) {
    // THE HERO SHOT: the best of every knob left on 자동 — shadows, a large shadow map, AO at full resolution and its
    // highest quality, the refraction at full size, every vegetation point, the full detail at any distance, MSAA 8
    const shadowsOn = pick(k.shadows as Tri, true);
    return {
      dpr,
      antialias,
      preserveDrawingBuffer,
      canvasKey: `gl:aa:${preserveDrawingBuffer ? "keep" : "nokeep"}`,
      shadowsOn,
      shadowType: k.shadowType as ShadowType,
      shadowMapSize: Math.max(4096, k.shadowMap as number),
      ao,
      aoQuality: q === "auto" ? "ultra" : q,
      aoHalfRes: pick(k.aoHalfRes as Tri, false),
      grain,
      grainStill: k.grainStill as boolean,
      sunTurnMin: k.sunSpin === "on" ? (k.sunSpinMin as number) : k.sunSpin === "off" ? 0 : null,
      dof,
      composerOn: ao || grain > 0 || dof,
      composerMsaa: inp.shot ? inp.shot.msaa : 8,
      refraction: pick(k.refraction as Tri, true),
      transmissionScale: ts > 0 ? ts : 1,
      vegCount: share > 0 ? (n: number) => Math.max(1, Math.round(n * share)) : (n: number) => n,
      detail: {
        aoRadius: k.aoRadius as number,
        distanceFalloff: k.distanceFalloff as number,
        aoIntensity: k.aoIntensity as number,
        azimuth: k.azimuth as number,
        elevation: k.elevation as number,
        sunIntensity: k.sunIntensity as number,
        softness: k.softness as number,
        dofRange: k.dofRange as number,
        dofBokeh: k.dofBokeh as number,
        dofFocus: k.dofFocus as "follow" | "dist",
        dofDist: k.dofDist as number,
        lodNear: Math.max(400, k.lodNear as number),
        lodMid: Math.max(600, k.lodMid as number),
      },
    };
  }
  return {
    dpr,
    antialias,
    preserveDrawingBuffer,
    canvasKey: `gl:${antialias ? "aa" : "noaa"}:${preserveDrawingBuffer ? "keep" : "nokeep"}`,
    shadowsOn: pick(k.shadows as Tri, saved.shadows && !perf),
    shadowType: k.shadowType as ShadowType,
    shadowMapSize: k.shadowMap as number,
    ao,
    aoQuality: q === "auto" ? (perf ? "performance" : saved.aoQuality) : q,
    aoHalfRes: pick(k.aoHalfRes as Tri, perf || saved.aoHalfRes),
    grain,
    grainStill: k.grainStill as boolean,
    sunTurnMin: k.sunSpin === "on" ? (k.sunSpinMin as number) : k.sunSpin === "off" ? 0 : null,
    dof,
    composerOn: ao || grain > 0 || dof,
    composerMsaa: k.composerMsaa as number,
    refraction: pick(k.refraction as Tri, !perf),
    transmissionScale: ts > 0 ? ts : autoTransScale,
    vegCount: share > 0 ? (n: number) => Math.max(1, Math.round(n * share)) : autoVeg,
    detail: {
      aoRadius: k.aoRadius as number,
      distanceFalloff: k.distanceFalloff as number,
      aoIntensity: k.aoIntensity as number,
      azimuth: k.azimuth as number,
      elevation: k.elevation as number,
      sunIntensity: k.sunIntensity as number,
      softness: k.softness as number,
      dofRange: k.dofRange as number,
      dofBokeh: k.dofBokeh as number,
      dofFocus: k.dofFocus as "follow" | "dist",
      dofDist: k.dofDist as number,
      lodNear: perf ? Math.min(k.lodNear as number, 25) : (k.lodNear as number),
      lodMid: perf ? Math.min(k.lodMid as number, 50) : (k.lodMid as number),
    },
  };
}

/**
 * Inside the Canvas: the shadow map's size on every shadow-casting light (the Sun declares 2048 in its JSX, which
 * React does not apply again while it stays 2048), and a recompile of the materials when the shadow type changes
 * (three.js keys programs by it but does not notice the change on its own). The type itself is the Canvas's
 * `shadows` prop.
 */
export function RenderTuning({ shadowType, shadowMapSize, shadowsOn }: { shadowType: ShadowType; shadowMapSize: number; shadowsOn: boolean }) {
  const scene = useThree((s) => s.scene);
  const lights = useRef<THREE.Light[]>([]);
  const frame = useRef(0);

  const collect = () => {
    const out: THREE.Light[] = [];
    scene.traverse((o) => {
      const l = o as THREE.Light & { shadow?: THREE.LightShadow };
      if (l.isLight && l.shadow) out.push(l);
    });
    lights.current = out;
  };
  const sizeShadows = () => {
    for (const l of lights.current) {
      const s = (l as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
      if (!s || (s.mapSize.x === shadowMapSize && s.mapSize.y === shadowMapSize)) continue;
      s.mapSize.set(shadowMapSize, shadowMapSize);
      // the render target is made at the old size: let three.js make it again
      s.map?.dispose();
      s.map = null;
      s.needsUpdate = true;
    }
  };

  useEffect(() => {
    collect();
    sizeShadows();
  }, [scene, shadowMapSize, shadowsOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstType = useRef(true);
  useEffect(() => {
    if (firstType.current) {
      firstType.current = false;
      return;
    }
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else m.needsUpdate = true;
    });
  }, [scene, shadowType]);

  // a light mounted later (or remounted) gets the size too: looked for again now and then
  useFrame(() => {
    if (++frame.current % 120 !== 0) return;
    collect();
    sizeShadows();
  });
  return null;
}

/**
 * THE GRAIN STANDS STILL (the artist, 2026-11-17: "그레인 고정시키고"): postprocessing's NoiseEffect draws a new pattern
 * every frame (its random is seeded by the time); this one is seeded by the pixel alone — the same grain every frame.
 * Premultiplied and screened as the wall's Noise was.
 */
class StillNoiseEffect extends Effect {
  constructor() {
    super(
      "StillNoiseEffect",
      "void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){vec3 noise=vec3(rand(uv*1.618+0.137));outputColor=vec4(min(inputColor.rgb*noise,vec3(1.0)),inputColor.a);}",
      { blendFunction: BlendFunction.SCREEN },
    );
  }
}

export function StillNoise({ opacity }: { opacity: number }) {
  const effect = useMemo(() => new StillNoiseEffect(), []);
  useEffect(() => () => effect.dispose(), [effect]);
  effect.blendMode.opacity.value = opacity;
  return <primitive object={effect} dispose={null} />;
}
