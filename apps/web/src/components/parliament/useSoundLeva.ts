"use client";
/**
 * useSoundLeva — the sound Leva folders (docs/sound-logic.md §9), registered wherever they are shown: the PLAYER
 * page (the artist, 2026-10-15 night: "put the sound Leva on the mobile view instead of the global-view folders")
 * and the bench at /v2/sound (SoundControls.tsx, inline). Values start from DEFAULT_DESK (code) and are saved per
 * page with the usual save / reload row (levaSave.ts). Returns the desk the engine reads.
 */

import { useEffect, useMemo, useState } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { DEFAULT_SOUND, type SoundParams } from "@/lib/sound/engine";
import { DEFAULT_GLOBAL, type GlobalParams } from "@/lib/sound/global";
import { canPickOutput, listOutputs, type OutputDevice } from "@/lib/sound/output";
import { DEFAULT_DESK, type DeskState } from "@/lib/sound/desk";

export const HEADSET = "소리 (V2 · 헤드셋)";
export const TRACK_A = `${HEADSET}.트랙 A · 멜로디 (Web Audio)`;
export const TRACK_B = `${HEADSET}.트랙 B · 화성 (NoiseCraft 패치)`;
export const ROOMS = `${HEADSET}.방과 땅 (두 트랙 공통)`;
export const SPEAKERS = "소리 (V2 · 스피커)";

const PATCHES: Record<string, string> = { "nc_noise_patch.ncft (umwelt 개인)": "nc_noise_patch.ncft", "Feedback_Synth.ncft (umwelt)": "Feedback_Synth.ncft", "global_audio.ncft (umwelt 글로벌)": "global_audio.ncft" };

type HeadKeys = "master" | "glue" | "instrument" | "harmony" | "barSec" | "speedMax" | "lockPull" | "stepEvery" | "hearRadius" | "innerRadius" | "magenta" | "textureLevel";
type AKeys = "melLevel" | "melRoom" | "melEcho" | "melFilter" | "melDelayMs" | "colourScale" | "noiseMix" | "jitterMax" | "othersLevel" | "botBlur" | "bassLevel" | "padLevel" | "hrtf";
type BKeys = "ncLevel" | "ncRoom" | "ncFilter" | "ncRough" | "ncOctave";
type RKeys = "reverbMax" | "lpOpen" | "lpSealed" | "noiseMax";

export interface SoundLevaOptions {
  /** Show the headset folders (the player's engine). */
  headset?: boolean;
  /** Show "이 창만 듣기" in the headset folder (the player page; the bench has its own listening choice). */
  solo?: boolean;
  /** Show the speakers folder (the global views; the bench shows it too, for the record). */
  speakers?: boolean;
  /** Only render on V2 (the player page: V1 has no sound). */
  render?: () => boolean;
}

export interface SoundLeva {
  desk: DeskState;
  solo: boolean;
  speakersSolo: boolean;
}

export function useSoundLeva(opts: SoundLevaOptions = {}): SoundLeva {
  const showHead = opts.headset !== false;
  const showSpeakers = opts.speakers === true;
  const v = opts.render ?? (() => true);
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const outputOptions = useMemo(() => {
    const o: Record<string, string> = { "기본 출력": "default" };
    for (const d of devices) if (d.id !== "default") o[d.label] = d.id;
    return o;
  }, [devices]);
  useEffect(() => {
    if (!canPickOutput()) return;
    listOutputs().then(setDevices);
    const onChange = () => listOutputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);
  const h0 = DEFAULT_DESK.headset;
  const s0 = DEFAULT_DESK.speakers;
  const hidden = () => false;
  const rh = showHead ? v : hidden;
  const rs = showSpeakers ? v : hidden;

  const hd = useControls(
    HEADSET,
    savable(HEADSET, {
      on: { value: DEFAULT_DESK.on, label: "켜기 (첫 클릭/터치 뒤 시작 · ESC / ♪ 버튼 = 음소거/해제)", render: rh },
      ...(opts.solo ? { solo: { value: false, label: "이 창만 듣기 (다른 창은 음소거 — 창 사이에 공유됨)", render: rh } } : {}),
      output: { options: outputOptions, value: DEFAULT_DESK.output, label: canPickOutput() ? "출력 장치 (헤드셋 / 스피커)" : "출력 장치 — 이 브라우저는 선택 불가", render: rh },
      ncPatch: { options: PATCHES, value: DEFAULT_DESK.ncPatch, label: "NoiseCraft 패치 — 편집은 /v2/sound 에서", render: rh },
      master: { value: h0.master, min: 0, max: 1, step: 0.01, label: "음량 (마스터 — 두 트랙 합)", render: rh },
      glue: { value: h0.glue, label: "글루 컴프레서 (두 트랙을 한 버스에서 묶음)", render: rh },
      instrument: { options: { "Web Audio (가벼움 · 즉각적 — 기본)": "webaudio", "하이브리드: 멜로디는 Web Audio, 화성은 NoiseCraft 패치 (무거움)": "hybrid", "NoiseCraft 패치만 (umwelt 방식)": "noisecraft" }, value: h0.instrument, label: "악기", render: rh },
      harmony: { options: { "화성 상태 H: 조성 = 누구의 무게 · 길 = 진행과 종지 · 접근 = 도미넌트 · 전조는 피벗으로": "fusion", "공유 월드 키 + 땅의 진행 · 전면 끌림 (10/14 오후 버전)": "world" }, value: h0.harmony, label: "화성 방식", render: rh },
      barSec: { value: h0.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s) — 모두가 같은 박자", render: rh },
      speedMax: { value: h0.speedMax, min: 1, max: 15, step: 0.5, label: "뛰는 속도 (월드/s): 마디에 두 번 · 그 1/10 아래 = 멈춤: 확대", render: rh },
      lockPull: { value: h0.lockPull, min: 0, max: 1, step: 0.05, label: "순응할 때 강박의 음이 코드톤으로 끌리는 정도", render: rh },
      stepEvery: { value: h0.stepEvery, min: 1, max: 30, step: 0.5, label: "코드가 바뀌는 거리 (월드) — 땅의 띠 폭 (x+z 방향)", render: rh },
      textureLevel: { value: h0.textureLevel, min: 0, max: 1, step: 0.01, label: "텍스처 — 코드 음의 방울 (Web Audio; 함께 있을수록 많이)", render: rh },
      sealRadius: { value: DEFAULT_DESK.sealRadius, min: 0.5, max: 10, step: 0.25, label: "건물이 먹먹하게 들리는 거리 (월드)", render: rh },
      hearRadius: { value: h0.hearRadius, min: 2, max: 40, step: 0.5, label: "다른 사람이 들리는 거리 (월드) — 바깥: 질감·동반만", render: rh },
      innerRadius: { value: h0.innerRadius, min: 1, max: 20, step: 0.5, label: "성부로 들어오는 거리 (월드)", render: rh },
      magenta: { value: h0.magenta, label: "Magenta 선 (GPU를 three.js와 나눠 씀; 기본 꺼짐)", render: rh },
    }),
    { collapsed: false, order: -1, render: rh },
    [outputOptions],
  ) as unknown as Pick<SoundParams, HeadKeys> & { on: boolean; solo?: boolean; output: string; ncPatch: string; sealRadius: number };
  const a = useControls(
    TRACK_A,
    savable(TRACK_A, {
      melLevel: { value: h0.melLevel, min: 0, max: 1, step: 0.01, label: "트랙 레벨", render: rh },
      melRoom: { value: h0.melRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (세 룸 공통 믹스 × 이 값)", render: rh },
      melEcho: { value: h0.melEcho, min: 0, max: 1, step: 0.01, label: "마디 에코 (3/16 마디; 되먹임은 순응할수록)", render: rh },
      melFilter: { value: h0.melFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도 (0 = 안 닫힘)", render: rh },
      melDelayMs: { value: h0.melDelayMs, min: 0, max: 200, step: 1, label: "지연 보정 (ms) — 패치 스트림의 지연만큼 멜로디를 늦춤", render: rh },
      colourScale: { value: h0.colourScale, min: 0, max: 1, step: 0.05, label: "미세음정 색 (1 = 서명의 센트 그대로, 0 = 평균율)", render: rh },
      noiseMix: { value: h0.noiseMix, min: 0, max: 1, step: 0.01, label: "식생을 가로지를 때 음의 노이즈 비율 (최대)", render: rh },
      jitterMax: { value: h0.jitterMax, min: 0, max: 0.1, step: 0.005, label: "식생을 가로지를 때 박자가 흐트러지는 폭 (s)", render: rh },
      othersLevel: { value: h0.othersLevel, min: 0, max: 1, step: 0.01, label: "다른 사람 목소리 크기 (바로 옆에서)", render: rh },
      botBlur: { value: h0.botBlur, min: 0, max: 1, step: 0.01, label: "봇(메아리)의 흐림", render: rh },
      bassLevel: { value: h0.bassLevel, min: 0, max: 1, step: 0.01, label: "베이스 펄스 (Web Audio 악기)", render: rh },
      padLevel: { value: h0.padLevel, min: 0, max: 1, step: 0.01, label: "패드 (Web Audio 악기)", render: rh },
      hrtf: { value: h0.hrtf, label: "이웃을 HRTF로 (무거움; 끄면 좌우 패닝) — 새로 들리는 이웃부터", render: rh },
    }),
    { collapsed: true, order: 0, render: rh },
  ) as unknown as Pick<SoundParams, AKeys>;
  const b = useControls(
    TRACK_B,
    savable(TRACK_B, {
      ncLevel: { value: h0.ncLevel, min: 0, max: 1.5, step: 0.01, label: "트랙 레벨", render: rh },
      ncRoom: { value: h0.ncRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (패치 자체 리버브 위에 더해짐)", render: rh },
      ncFilter: { value: h0.ncFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도", render: rh },
      ncRough: { value: h0.ncRough, min: 0, max: 1, step: 0.01, label: "식생의 거칢 (노이즈로 진폭을 갈아냄, 최대 깊이)", render: rh },
      ncOctave: { value: h0.ncOctave, min: -2, max: 1, step: 1, label: "텍스처 음 집합의 옥타브 (−1 = 멜로디 아래)", render: rh },
    }),
    { collapsed: true, order: 1, render: rh },
  ) as unknown as Pick<SoundParams, BKeys>;
  const r = useControls(
    ROOMS,
    savable(ROOMS, {
      reverbMax: { value: h0.reverbMax, min: 0, max: 1, step: 0.01, label: "함께 지을 때 열리는 홀 잔향 (최대; 바닥 1/10)", render: rh },
      lpOpen: { value: h0.lpOpen, min: 500, max: 16000, step: 100, label: "열린 땅의 밝기 (저역통과 Hz)", render: rh },
      lpSealed: { value: h0.lpSealed, min: 100, max: 8000, step: 50, label: "건물 위의 먹먹함 (저역통과 Hz)", render: rh },
      noiseMax: { value: h0.noiseMax, min: 0, max: 1, step: 0.01, label: "식생의 노이즈 밝기 (최대)", render: rh },
    }),
    { collapsed: true, order: 2, render: rh },
  ) as unknown as Pick<SoundParams, RKeys>;
  const sp = useControls(
    SPEAKERS,
    savable(SPEAKERS, {
      on: { value: DEFAULT_DESK.speakersOn, label: "켜기 (기본 꺼짐 · 첫 클릭 뒤 시작 · ESC = 음소거/해제)", render: rs },
      solo: { value: false, label: "이 창만 듣기 (다른 창은 음소거 — 창 사이에 공유됨)", render: rs },
      output: { options: outputOptions, value: DEFAULT_DESK.speakersOutput, label: canPickOutput() ? "출력 장치 (헤드셋 / 스피커)" : "출력 장치 — 이 브라우저는 선택 불가", render: rs },
      master: { value: s0.master, min: 0, max: 1, step: 0.01, label: "음량", render: rs },
      barSec: { value: s0.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s)", render: rs },
      octavesDown: { value: s0.octavesDown, min: 0, max: 4, step: 1, label: "모티프를 내리는 옥타브", render: rs },
      cutoff: { value: s0.cutoff, min: 80, max: 4000, step: 10, label: "전체 저역통과 (Hz)", render: rs },
      hall: { value: s0.hall, min: 0, max: 1, step: 0.01, label: "홀 (8 s)", render: rs },
      perVoice: { value: s0.perVoice, min: 0, max: 0.5, step: 0.005, label: "한 사람의 목소리 크기 (모두 합산됨)", render: rs },
      tickLevel: { value: s0.tickLevel, min: 0, max: 1, step: 0.01, label: "한 사람의 리듬 흔적 크기", render: rs },
      spread: { value: s0.spread, min: 0, max: 1, step: 0.01, label: "뭉침의 좌우 폭 (건물·사람 위치)", render: rs },
      drive: { value: s0.drive, min: 1, max: 8, step: 0.1, label: "뭉개짐 (새추레이션)", render: rs },
      windowSec: { value: s0.windowSec, min: 30, max: 1200, step: 30, label: "존재로 세는 창 (s)", render: rs },
    }),
    { collapsed: true, order: -1, render: rs },
    [outputOptions],
  ) as unknown as GlobalParams & { on: boolean; solo: boolean; output: string };

  const { on, solo, output, ncPatch, sealRadius, ...head } = hd;
  const { on: speakersOn, solo: speakersSolo, output: speakersOutput, ...speakers } = sp;
  const desk = useMemo<DeskState>(
    () => ({
      headset: { ...DEFAULT_SOUND, ...head, ...a, ...b, ...r },
      on,
      output,
      ncPatch,
      sealRadius,
      speakers: { ...DEFAULT_GLOBAL, ...speakers },
      speakersOn,
      speakersOutput,
      overrides: {},
      at: 0,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hd, a, b, r, sp],
  );
  return { desk, solo: !!solo, speakersSolo };
}
