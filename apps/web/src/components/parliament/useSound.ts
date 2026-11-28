"use client";
/**
 * useSound — the player's headset sound (V2 only): a Leva folder of its mapping ranges and the engine
 * (lib/sound/engine.ts), started on the first user gesture (mobile autoplay rules). The window's own mute (the ♪
 * button, SoundButton.tsx; ESC too when there is no session — with one, ESC is the look-release key) and a status
 * line for the screen (docs/sound-logic.md §13).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { folder, levaStore, useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";
import { newLook } from "./mobileLab";
import { onFutureCue } from "@/lib/sound/futureCue";
import { playFuturePassing } from "./futureSound";
import { DEFAULT_MOTIF_PRESET, DEFAULT_SIGNALS, DEFAULT_SOUND, MOTIF_PRESETS, MOTIF_PRESET_NAMES, SoundEngine, type SignalConfig, type SoundParams } from "@/lib/sound";

export interface SoundSetup {
  engine: SoundEngine;
  params: SoundParams;
  sigCfg: SignalConfig;
  /** One line for the screen: which window this is and whether it is playing (and why not). */
  status: string;
  /** This window's mute (the ♪ button / ESC) and its switch. */
  muted: boolean;
  toggleMute(): void;
  /** The life's recording (useLifeRecording): on, and at what bitrate (kbps). */
  record: { on: boolean; kbps: number };
}

export interface SoundOptions {
  /** ESC toggles the mute (true without a session; with one ESC releases the look instead). */
  escMute?: boolean;
}

const ROOT = "소리 (V2 · 헤드셋)";
const TIMBRE_FOLDER = "모티프 음색 (세부)";

export function useSound(opts: SoundOptions = {}): SoundSetup | null {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const escMuteRef = useRef(opts.escMute ?? true);
  useEffect(() => {
    escMuteRef.current = opts.escMute ?? true;
  }, [opts.escMute]);
  const c = useControls(
    ROOT,
    savable(ROOT, {
      on: { value: true, label: "켜기 (첫 클릭/터치 뒤 시작)", render: v2 },
      master: { value: DEFAULT_SOUND.master, min: 0, max: 1, step: 0.01, label: "음량", render: v2 },
      barSec: { value: DEFAULT_SOUND.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s) — 모두가 같은 박자", render: v2 },
      speedMax: { value: DEFAULT_SOUND.speedMax, min: 1, max: 15, step: 0.5, label: "뛰는 속도 (월드/s): 마디에 두 번 · 그 1/10 아래 = 멈춤: 두 마디에 한 번", render: v2 },
      jitterMax: { value: DEFAULT_SOUND.jitterMax, min: 0, max: 0.1, step: 0.005, label: "자유로울 때 박자가 흐트러지는 폭 (s) — 길 위·함께 지을 땐 0", render: v2 },
      bassLevel: { value: DEFAULT_SOUND.bassLevel, min: 0, max: 1, step: 0.01, label: "길의 심장박동 (근음, 낮게) 세기", render: v2 },
      bassFrom: { value: DEFAULT_SOUND.bassFrom, min: 0.02, max: 0.8, step: 0.01, label: "심장박동이 시작되는 길의 세기 (낮을수록 너그러움)", render: v2 },
      pathRadius: { value: DEFAULT_SIGNALS.pathRadius, min: 0.5, max: 6, step: 0.25, label: "길로 치는 반경 (월드) — 이 안의 길이 발밑으로", render: v2 },
      bassDub: { value: DEFAULT_SOUND.bassDub, min: 0, max: 1, step: 0.05, label: "심장박동: 두 번째 박 세기", render: v2 },
      bassSpread: { value: DEFAULT_SOUND.bassSpread, min: 0, max: 1, step: 0.05, label: "심장박동: 퍼짐 (방·홀로)", render: v2 },
      bassDuck: { value: DEFAULT_SOUND.bassDuck, min: 0, max: 1, step: 0.05, label: "심장박동이 올 때 모티프·타인이 눌리는 정도", render: v2 },
      bassDrop: { value: DEFAULT_SOUND.bassDrop, min: 0, max: 1, step: 0.05, label: "심장박동: 음정 낙하 (0 = 둔탁한 쿵, 1 = 전자 킥)", render: v2 },
      padLevel: { value: DEFAULT_SOUND.padLevel, min: 0, max: 1, step: 0.01, label: "함께 머물 때 이어지는 코드 (패드)", render: v2 },
      reverbMax: { value: DEFAULT_SOUND.reverbMax, min: 0, max: 1, step: 0.01, label: "함께 지을 때 열리는 홀 잔향 (최대)", render: v2 },
      lpOpen: { value: DEFAULT_SOUND.lpOpen, min: 500, max: 16000, step: 100, label: "열린 땅의 밝기 (저역통과 Hz)", render: v2 },
      lpSealed: { value: DEFAULT_SOUND.lpSealed, min: 100, max: 8000, step: 50, label: "건물 위의 먹먹함 (저역통과 Hz)", render: v2 },
      sealRadius: { value: DEFAULT_SIGNALS.sealRadius, min: 0.5, max: 10, step: 0.25, label: "건물이 먹먹하게 들리는 거리 (월드)", render: v2 },
      noiseMax: { value: DEFAULT_SOUND.noiseMax, min: 0, max: 1, step: 0.01, label: "식생의 노이즈 밝기 (최대)", render: v2 },
      hearRadius: { value: DEFAULT_SOUND.hearRadius, min: 2, max: 40, step: 0.5, label: "다른 사람이 들리는 거리 (월드)", render: v2 },
      othersLevel: { value: DEFAULT_SOUND.othersLevel, min: 0, max: 1, step: 0.01, label: "다른 사람 목소리 크기 (바로 옆에서)", render: v2 },
      botBlur: { value: DEFAULT_SOUND.botBlur, min: 0, max: 1, step: 0.01, label: "봇(메아리)의 흐림", render: v2 },
      magenta: { value: DEFAULT_SOUND.magenta, label: "Magenta 변주 (기본 꺼짐 — 켜면 네트워크 + GPU를 three.js와 나눔)", render: v2 },
      instrument: {
        value: DEFAULT_SOUND.instrument,
        options: { "둘 다 — Web Audio 전체 + NoiseCraft 패치 (병행)": "both", "NoiseCraft 패치가 화성, Web Audio는 모티프만": "noisecraft", "Web Audio만 (가벼운 판)": "webaudio" },
        label: "악기",
        render: v2,
      },
      clockPull: { value: DEFAULT_SOUND.clockPull, min: 0, max: 0.3, step: 0.01, label: "음악 클록: 길·함께 지을 때 마디가 죄어드는 비율 (패치가 켜졌을 때)", render: v2 },
      motifEvery: { value: DEFAULT_SOUND.motifEvery, min: 1, max: 6, step: 0.1, label: "내 모티프: 평균 몇 마디에 한 번 (소수점 = 확률)", render: v2 },
      motifOctaveEvery: { value: DEFAULT_SOUND.motifOctaveEvery, min: 0, max: 8, step: 0.5, label: "내 모티프: 옥타브 이동 — 연주 몇 번에 한 번 (0 = 안 함)", render: v2 },
      motifOctaveRange: { value: DEFAULT_SOUND.motifOctaveRange, min: 1, max: 2, step: 1, label: "옥타브 이동 폭 (1 = 한 옥타브, 2 = 두 옥타브까지)", render: v2 },
      zoneTonality: { value: DEFAULT_SOUND.zoneTonality, label: "건물의 조성 — 지은 사람들의 모티프에 맞춘 키 (A4)", render: v2 },
      zoneRing: { value: DEFAULT_SOUND.zoneRing, min: 0, max: 12, step: 0.5, label: "건물 바깥 고리 폭 (월드) — 거기선 도미넌트", render: v2 },
      zoneMargin: { value: DEFAULT_SOUND.zoneMargin, min: 0, max: 1, step: 0.05, label: "조성이 바뀌는 문턱 (클수록 잘 안 바뀜)", render: v2 },
      bandCells: { value: DEFAULT_SOUND.bandCells, min: 2, max: 32, step: 1, label: "땅의 띠 폭 (셀) — 이만큼 걸어야 코드가 바뀜", render: v2 },
      arrival: { value: DEFAULT_SOUND.arrival, label: "도착의 종지 — 같이 짓기 시작 · 건물 탄생 때 도미넌트 → 으뜸", render: v2 },
      arrivalHall: { value: DEFAULT_SOUND.arrivalHall, min: 0, max: 1, step: 0.05, label: "도착 때 홀이 열리는 정도", render: v2 },
      arrivalWave: { value: DEFAULT_SOUND.arrivalWave, min: 0, max: 1, step: 0.05, label: "도착의 파도 — 도미넌트 마디에 밀려와 으뜸에서 부서짐", render: v2 },
      waveVerb: { value: DEFAULT_SOUND.waveVerb, min: 0, max: 1, step: 0.05, label: "파도의 잔향 (올릴수록 직접음이 줄고 젖음)", render: v2 },
      waveHit: { value: DEFAULT_SOUND.waveHit, min: 0, max: 1, step: 0.05, label: "파도의 때림 (정점 뒤 첫 박에 부서지는 세기 + 낮은 쿵)", render: v2 },
      grassVerb: { value: DEFAULT_SOUND.grassVerb, min: 0, max: 1, step: 0.05, label: "식생 노이즈의 잔향", render: v2 },
      arrivalGapMs: { value: DEFAULT_SOUND.arrivalGapMs, min: 0, max: 400, step: 10, label: "으뜸 직전의 숨 (ms, 전부 잠깐 비움 — 0 = 없음; 파도 정점에서 먹히는 느낌의 원인이었음)", render: v2 },
      afterglow: { value: DEFAULT_SOUND.afterglow, min: 0, max: 0.5, step: 0.01, label: "죽은 뒤 여운: 스피커(글로벌) 소리를 헤드셋에 얇게 (0 = 없음)", render: v2 },
      afterlifeTail: { value: DEFAULT_SOUND.afterlifeTail, min: 1, max: 30, step: 0.5, label: "죽음의 잔향 (s) — 끝난 뒤 들리는 유일한 것; 뒤 절반에 페이드가 겹침", render: v2 },
      // a word another left, found underfoot (witness word.found): the leaver's melody once, on the next bar, in the name's voice
      foundLevel: { value: DEFAULT_SOUND.foundLevel, min: 0, max: 1.5, step: 0.05, label: "찾은 말의 멜로디 크기 — 남긴 이의 이름 멜로디가 다음 마디에 한 번 (1 = 이름과 같은 크기, 0 = 안 들림)", render: v2 },
      // asking and answering as counterpoint (sound-logic §13d) — the redesigned personal view only (lab pages,
      // /rehearsal/experiment): the exhibition's view keeps its sound whatever is saved here
      askCounterpoint: { value: DEFAULT_SOUND.askCounterpoint, label: "묻고 답하기를 대위로 (개편 개인뷰만) — 묻는 이는 한 마디 부르고 한 마디 비움 · 대답은 두 선이 벌어져 맞물렸다가 새 어휘로 하나 · 그 뒤 내 멜로디 = 새 어휘 (끄면 전처럼)", render: () => isV2 && newLook() },
      // building together as an ensemble (sound-logic §13e) — the same pages only
      ensembleCounterpoint: { value: DEFAULT_SOUND.ensembleCounterpoint, label: "함께 짓기를 합주로 (개편 개인뷰만) — 실제로 같이 지을 때(기록 '합주 중') 곁의 셋까지 한 마디씩 차례로 들어옴: 반 마디 늦은 카논 · 모두 밑의 베이스 · 안쪽 선 · 도착의 으뜸에 같이 착지 · 그 사이 말을 걸면 합주 위의 솔로 (끄면 전처럼)", render: () => isV2 && newLook() },
      // (the artist, 2026-11-27: "같이 지으면 오히려 홀이랑 패드는 강해져야" — the hall and the pad grow while building)
      ensembleSwell: { value: DEFAULT_SOUND.ensembleSwell, min: 1, max: 2.5, step: 0.05, label: "합주 중 홀·패드 (×, 1 = 곁에 머물 때와 같음 — 줄지 않음)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ensembleCounterpoint`) },
      // (the artist, 2026-11-27: "같은 음역대에 좀 겹치면 어때 꼭 대위적으로 서로 피해갈 이유는 없음")
      apartness: { value: DEFAULT_SOUND.apartness, min: 0, max: 1, step: 0.05, label: "대화·합주의 선들이 서로 피하는 정도 (0 = 같은 음역·같은 박에 겹쳐도 됨, 1 = 옥타브 벌리고 박 비킴)", render: () => isV2 && newLook() },
      askDuck: { value: DEFAULT_SOUND.askDuck, min: 0, max: 1, step: 0.05, label: "누가 말 걸 때 나머지를 죽이는 정도 (0 = 그대로, 1 = 묻는 이의 멜로디만) — 패드·베이스·풀숲 노이즈·패치·다른 목소리", render: () => isV2 && newLook() },
      futureSound: { value: DEFAULT_SOUND.futureSound, label: "미래가 스칠 때 소리 — 엠비언트 백일몽 (개편 개인뷰만): 낮은 안개 화음이 천천히 차오르고, 먼 전파 잡음이 흐르고, 내 멜로디가 느리게 미래에서 들려옴 + 꽃밭의 반짝임 + 패치의 꽃", render: () => isV2 && newLook() },
      futureLevel: { value: DEFAULT_SOUND.futureLevel, min: 0, max: 1.5, step: 0.05, label: "· 크기", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureDur: { value: DEFAULT_SOUND.futureDur, min: 2, max: 16, step: 0.5, label: "· 길이 (초, 떠날 땐 절반)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureHaze: { value: DEFAULT_SOUND.futureHaze, min: 0, max: 1.5, step: 0.05, label: "· 안개 화음 (그 자리의 리디안 근음·5·9·#11을 낮게, 필터가 천천히 열렸다 닫힘, 떨림 없음)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureRadio: { value: DEFAULT_SOUND.futureRadio, min: 0, max: 1.5, step: 0.05, label: "· 먼 전파 (어두운 잡음 대역이 멀리서 맞춰지듯 흐름, 휘파람 없음)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureEcho: { value: DEFAULT_SOUND.futureEcho, min: 0, max: 1.5, step: 0.05, label: "· 미래에서 온 내 멜로디 (한 번, 절반 빠르기, 부드러운 라디오 목소리, 지나가며 음이 살짝 내려감)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureGlitter: { value: DEFAULT_SOUND.futureGlitter, min: 0, max: 1.5, step: 0.05, label: "· 꽃밭의 반짝임 (원래의 꽃 효과)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      futureBloom: { value: DEFAULT_SOUND.futureBloom, min: 0, max: 2, step: 0.05, label: "· 패치의 꽃 (크로스딜레이·코드층이 핌, 패치 반응이 켜져 있을 때)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.futureSound`) },
      // more turns in the harmony (sound-logic §13f; the artist, 2026-11-27: "화성이 좀 더 ... 진행이 다양했으면")
      harmonyTurns: { value: DEFAULT_SOUND.harmonyTurns, label: "화성을 더 다양하게 (개편 개인뷰만) — 머물면 그 자리의 진행이 돎(빌려온 코드·반음계 중음·나폴리·페달) · 걸을 땐 가끔 sus·add9 · 도착은 버금딸림 → 딸림 → (가끔 거짓 종지) → 으뜸 (끄면 전처럼)", render: () => isV2 && newLook() },
      turnAmount: { value: DEFAULT_SOUND.turnAmount, min: 0, max: 1, step: 0.05, label: "머물 때 진행이 움직이는 정도 (0 = 한 코드)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) },
      colourAmount: { value: DEFAULT_SOUND.colourAmount, min: 0, max: 1, step: 0.05, label: "걸을 때 코드 색 (sus·add9) 비율", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) },
      tension: { value: DEFAULT_SOUND.tension, min: 0, max: 1, step: 0.05, label: "모이면 긴장 (최대치, 0 = 끔) — 모여 있는 동안 쌓이고(반음 하행 베이스·감7·7b9/#9/#5·딸림 페달·트라이톤 대리), 함께 지으면 다 풀림 · 응답하면 반 · 정이 들면 서서히 · 오래 아무 일 없으면 아멘 · 흩어지면 거짓 종지", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) },
      crowdFull: { value: DEFAULT_SOUND.crowdFull, min: 1, max: 6, step: 1, label: "몇 명이 들리면 가장 빨리 쌓임", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) && (get(`${ROOT}.tension`) as number) > 0 },
      buildBars: { value: DEFAULT_SOUND.buildBars, min: 2, max: 48, step: 1, label: "긴장이 다 차는 시간 (마디, 다 모였을 때) — 쌓이는 동안 으뜸은 안 옴", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) && (get(`${ROOT}.tension`) as number) > 0 },
      bondSec: { value: DEFAULT_SOUND.bondSec, min: 0, max: 300, step: 5, label: "같은 사람과 이만큼(초) 있으면 서서히 풀림 (0 = 안 풀림)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) && (get(`${ROOT}.tension`) as number) > 0 },
      patienceBars: { value: DEFAULT_SOUND.patienceBars, min: 0, max: 96, step: 4, label: "아무 일 없으면 이만큼(마디) 붙든 뒤 저절로 풀림 iv→I (0 = 안 풀림)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.harmonyTurns`) && (get(`${ROOT}.tension`) as number) > 0 },
      // the life's recording (useLifeRecording.ts, docs/recording.md): the headset's mix from the name's melody to the
      // end of the reverb, kept here and sent up; the specimen card's QR opens it
      record: { value: true, label: "녹음 — 이름의 멜로디부터 죽음의 잔향 끝까지, 헤드셋 믹스만 (표본 카드의 QR)", render: v2 },
      recordKbps: { value: 64, min: 24, max: 160, step: 8, label: "녹음 비트레이트 (kbps) — 64 ≈ 3분에 1.4 MB", render: v2 },
      microtone: { value: DEFAULT_SOUND.microtone, min: 0, max: 1, step: 0.05, label: "모티프 미세음정 양 (0 = 패치와 같은 조율)", render: v2 },
      motifEcho: { value: DEFAULT_SOUND.motifEcho, min: 0, max: 1, step: 0.05, label: "모티프 에코 (마디에 맞춘 메아리)", render: v2 },
      motifPreset: {
        value: DEFAULT_MOTIF_PRESET,
        options: MOTIF_PRESET_NAMES,
        label: "모티프 음색 프리셋 (고르면 아래 세부 값이 바뀜)",
        onChange: (v: string, _path: string, ctx: { initial: boolean }) => {
          if (ctx.initial) return;
          const preset = MOTIF_PRESETS[v];
          if (!preset) return;
          // a preset puts a whole timbre into the knobs (by their Leva paths); the knobs are then turned from there
          const values: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(preset)) values[k === "motifEcho" ? `${ROOT}.${k}` : `${ROOT}.${TIMBRE_FOLDER}.${k}`] = val;
          levaStore.set(values, false);
        },
        render: v2,
      },
      [TIMBRE_FOLDER]: folder(
        {
          motifSynth: { value: DEFAULT_SOUND.motifSynth, options: { "감산 (파형 · 배음 · 필터)": "subtractive", "FM (사인을 휘는 변조)": "fm" }, label: "합성 방식", render: v2 },
          fmRatio: { value: DEFAULT_SOUND.fmRatio, min: 0.25, max: 8, step: 0.01, label: "FM: 변조 비율 (정수 = 배음, 소수 = 금속)", render: v2 },
          fmIndex: { value: DEFAULT_SOUND.fmIndex, min: 0, max: 12, step: 0.1, label: "FM: 변조 깊이", render: v2 },
          fmDecayMs: { value: DEFAULT_SOUND.fmDecayMs, min: 10, max: 2000, step: 10, label: "FM: 깊이가 가라앉는 시간 (ms)", render: v2 },
          motifWave: { value: DEFAULT_SOUND.motifWave, options: { "삼각 (부드러움)": "triangle", "사인 (가장 순수)": "sine", "톱니 (밝고 거침)": "sawtooth", "사각 (속이 빈)": "square" }, label: "파형 (감산)", render: v2 },
          motifTranspose: { value: DEFAULT_SOUND.motifTranspose, min: -24, max: 12, step: 1, label: "음역 이동 (반음)", render: v2 },
          motifLevel: { value: DEFAULT_SOUND.motifLevel, min: 0, max: 1.5, step: 0.05, label: "모티프 음량", render: v2 },
          motifAttackMs: { value: DEFAULT_SOUND.motifAttackMs, min: 2, max: 400, step: 1, label: "어택 (ms)", render: v2 },
          motifDecayMs: { value: DEFAULT_SOUND.motifDecayMs, min: 10, max: 1000, step: 5, label: "디케이 (ms)", render: v2 },
          motifSustain: { value: DEFAULT_SOUND.motifSustain, min: 0, max: 1, step: 0.05, label: "서스테인 (0–1)", render: v2 },
          motifRelease: { value: DEFAULT_SOUND.motifRelease, min: 0, max: 2, step: 0.05, label: "릴리즈 (음 길이의 배)", render: v2 },
          motifCutoff: { value: DEFAULT_SOUND.motifCutoff, min: 300, max: 12000, step: 50, label: "저역통과 (Hz)", render: v2 },
          motifQ: { value: DEFAULT_SOUND.motifQ, min: 0.3, max: 8, step: 0.1, label: "필터 공명 (Q)", render: v2 },
          motifFilterEnv: { value: DEFAULT_SOUND.motifFilterEnv, min: 0, max: 3, step: 0.1, label: "어택 때 필터 열림 (옥타브)", render: v2 },
          motifOctaveLevel: { value: DEFAULT_SOUND.motifOctaveLevel, min: 0, max: 1, step: 0.05, label: "옥타브 위 배음", render: v2 },
          motifFifthLevel: { value: DEFAULT_SOUND.motifFifthLevel, min: 0, max: 1, step: 0.05, label: "5도 위 배음", render: v2 },
          motifDetune: { value: DEFAULT_SOUND.motifDetune, min: 0, max: 30, step: 1, label: "디튠 두 겹 (센트; 0 = 한 겹)", render: v2 },
          motifVibrato: { value: DEFAULT_SOUND.motifVibrato, min: 0, max: 40, step: 1, label: "비브라토 깊이 (센트)", render: v2 },
          motifVibratoHz: { value: DEFAULT_SOUND.motifVibratoHz, min: 0.5, max: 9, step: 0.1, label: "비브라토 속도 (Hz)", render: v2 },
          motifBreath: { value: DEFAULT_SOUND.motifBreath, min: 0, max: 1, step: 0.05, label: "숨 (음에 섞이는 노이즈 — 전파의 잡음)", render: v2 },
          motifTremolo: { value: DEFAULT_SOUND.motifTremolo, min: 0, max: 1, step: 0.05, label: "트레몰로 (전파의 떨림, 비브라토 속도로)", render: v2 },
          motifVerb: { value: DEFAULT_SOUND.motifVerb, min: 0, max: 1, step: 0.05, label: "먼 공간 (4초 잔향 — 보내진 신호의 꼬리)", render: v2 },
        },
        { collapsed: true, render: v2 },
      ),
      ncDull: { value: DEFAULT_SOUND.ncDull, min: 0, max: 1, step: 0.05, label: "패치도 건물에서 먹먹해지는 정도 (0 = 안 먹먹)", render: v2 },
      ncMap: { value: DEFAULT_SOUND.ncMap, label: "패치 노브 실시간 매핑 (사람·존·콘크리트·속도·함께 → 패치의 노브 아홉 개)", render: v2 },
      ncMapDepth: { value: DEFAULT_SOUND.ncMapDepth, min: 0, max: 1, step: 0.05, label: "패치 노브가 움직이는 깊이 (0 = 작가가 저장한 값 그대로)", render: v2 },
      ncReact: { value: DEFAULT_SOUND.ncReact, label: "패치가 변화에 반응 (개편 개인뷰만; 끄면 전처럼) — 아래 여덟 가지의 폭", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) },
      reactTension: { value: DEFAULT_SOUND.reactTension, min: 0, max: 2, step: 0.05, label: "· 폭: 긴장 → 음색 (톱니 241·247·249·256, 디튠 206, 컷오프 57·64 — 으뜸에서 확 열림) (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactChange: { value: DEFAULT_SOUND.reactChange, min: 0, max: 2, step: 0.05, label: "· 폭: 코드 바뀔 때 튕김 (필터 엔벨로프 깊이 56·63·121) (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactAsk: { value: DEFAULT_SOUND.reactAsk, min: 0, max: 2, step: 0.05, label: "· 폭: 물음 → 에코가 남음 (피드백 138·152) (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactAnswer: { value: DEFAULT_SOUND.reactAnswer, min: 0, max: 2, step: 0.05, label: "· 폭: 내 응답 → 튕김 (56·63·121) (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactEnsemble: { value: DEFAULT_SOUND.reactEnsemble, min: 0, max: 2, step: 0.05, label: "· 폭: 합주 → 한 방 (크로스딜레이로 301) (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactBloom: { value: DEFAULT_SOUND.reactBloom, min: 0, max: 2, step: 0.05, label: "· 폭: 해결의 꽃 — 풀리는 마디에 크로스딜레이 되먹임 76·81, 코드층 필터 287·288 (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactPath: { value: DEFAULT_SOUND.reactPath, min: 0, max: 2, step: 0.05, label: "· 폭: 길 위 또렷함 — 에코 저역 걷힘 142·156, 먼 종 밝게 122 (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
      reactFound: { value: DEFAULT_SOUND.reactFound, min: 0, max: 2, step: 0.05, label: "· 폭: 찾은 말 일렁임 — 먼 종 음높이 흔들림 271, 사인 254 (0 = 끔, 1 = 기본, 2 = 두 배)", render: (get: (path: string) => unknown) => isV2 && newLook() && !!get(`${ROOT}.ncMap`) && !!get(`${ROOT}.ncReact`) },
    }, [], [
      // EACH WITH THE DAY IT WAS WRITTEN (`at`, from the history; the artist, 2026-11-21: "저장값으로 맞춰"). Without a
      // date every one of these ran again on a phone that had never opened the page — over the values it had just
      // taken from the server: a new visitor heard the heartbeat at 0.9 / 0.7 / 0.45, the tail at 5 s and no breath,
      // where the artist had saved 0.97 / 1 / 0.7, 6.5 s and 80 ms on 11/01. A save dated after a migration's day is
      // left as saved (levaSave migrateSaved).
      { tag: "v4-a1-magenta-off", at: "2026-10-15", set: { magenta: false } }, // a saved "on" from before v4 A1 is switched off once
      { tag: "v4-a2b-both", at: "2026-10-15", set: { instrument: "both" } }, // the artist (A2 test): both instruments side by side
      { tag: "v4-a2d-heartbeat", at: "2026-10-15", set: { bassLevel: 0.9 } }, // the artist: the heartbeat louder, in front
      { tag: "v4-a2e-heartbeat2", at: "2026-10-15", set: { bassSpread: 0.7, bassDub: 0.45 } }, // heavier, spreading
      { tag: "v4-a4b-scale", at: "2026-10-18", set: { zoneRing: 8 } }, // the harmony's scale widened (the artist: changes too fine to feel)
      { tag: "v4-a5e-tail-5", at: "2026-10-18", set: { afterlifeTail: 5 } }, // the artist: 10 s was too long
      { tag: "v4-a5p-no-breath", at: "2026-10-31", set: { arrivalGapMs: 0 } }, // the artist (10/31): the breath at the wave's peak = the sound eaten
      { tag: "v4-a5v-wave-wet", at: "2026-11-01", set: { waveVerb: 0.85, waveHit: 0.5 } }, // the artist (11/01): the wave dry, its strike abrupt
      // the artist: the motif as a signal sent into space (Interstellar, 전파) — the preset on top of saved values once
      { tag: "v4-a2f-radio", at: "2026-10-15", set: { motifWave: "sine", motifAttackMs: 60, motifDecayMs: 200, motifSustain: 0.8, motifRelease: 1.2, motifCutoff: 6000, motifOctaveLevel: 0.1, motifDetune: 4, motifBreath: 0.15, motifEcho: 0.6 } },
    ]),
    { collapsed: false, order: -1, render: v2 },
  ) as unknown as SoundParams & { on: boolean; sealRadius: number; pathRadius: number; record: boolean; recordKbps: number };

  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new SoundEngine() : null), [isV2]);
  useEffect(() => {
    // for measuring from DevTools / a hidden tab (debug.nc, running): no UI reads this
    (window as unknown as { __soundEngine?: SoundEngine | null }).__soundEngine = engine;
  }, [engine]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // the window's own mute: the ♪ button, and ESC when there is no session (with one ESC releases the look)
  const muted = useRef(false);
  const [mutedState, setMutedState] = useState(false);
  const [status, setStatus] = useState("♪ 헤드셋 (모바일 뷰)");
  const toggleMute = useMemo(
    () => () => {
      if (!engine) return;
      muted.current = !muted.current;
      setMutedState(muted.current);
      if (muted.current) engine.stop();
      else if (onRef.current) engine.start().catch(() => {});
    },
    [engine],
  );

  useEffect(() => {
    if (!engine) return;
    const start = () => {
      if (onRef.current && !muted.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (escMuteRef.current) toggleMute();
        return;
      }
      start();
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchend", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchend", start);
      engine.dispose();
    };
  }, [engine, toggleMute]);

  useEffect(() => {
    if (!engine) return;
    if (c.on && !muted.current) engine.start().catch(() => {}); // no-op until a gesture has unlocked the context
    else engine.stop();
  }, [engine, c.on]);

  // the status line, once a second
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const why = !onRef.current ? "꺼짐 (Leva)" : muted.current ? "음소거 (♪ 버튼)" : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 헤드셋 (모바일 뷰) · ${why}${engine.running ? ` · → ${engine.output}` : ""}${engine.limiterDb < -1 ? ` · 리미터 ${engine.limiterDb.toFixed(1)} dB` : ""}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine]);

  const {
    master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, sealRadius, instrument, clockPull, motifEvery, microtone, motifEcho, ncDull, ncMap, ncMapDepth, ncReact, reactTension, reactChange, reactAsk, reactAnswer, reactEnsemble, reactBloom, reactPath, reactFound, bassSpread, bassDub, bassDuck, bassDrop,
    motifWave, motifTranspose, motifLevel, motifAttackMs, motifDecayMs, motifSustain, motifRelease, motifCutoff, motifQ, motifFilterEnv, motifOctaveLevel, motifFifthLevel, motifDetune, motifVibrato, motifVibratoHz, motifBreath, motifTremolo, motifVerb,
    motifSynth, fmRatio, fmIndex, fmDecayMs, motifOctaveEvery, motifOctaveRange, zoneTonality, zoneRing, zoneMargin, bandCells, arrival, arrivalHall, arrivalWave, arrivalGapMs, waveVerb, waveHit, grassVerb,
    bassFrom, pathRadius, afterlifeTail, afterglow, foundLevel, askCounterpoint, ensembleCounterpoint, ensembleSwell, apartness, harmonyTurns, turnAmount, colourAmount, tension, crowdFull, buildBars, bondSec, patienceBars, askDuck, futureSound, futureLevel, futureDur, futureHaze, futureRadio, futureEcho, futureGlitter, futureBloom,
  } = c;
  const params = useMemo<SoundParams>(
    () => ({
      master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, instrument, clockPull, motifEvery, microtone, motifEcho, ncDull, ncMap, ncMapDepth, ncReact: ncReact && newLook(), reactTension, reactChange, reactAsk, reactAnswer, reactEnsemble, reactBloom, reactPath, reactFound, bassSpread, bassDub, bassDuck, bassDrop,
      motifWave, motifTranspose, motifLevel, motifAttackMs, motifDecayMs, motifSustain, motifRelease, motifCutoff, motifQ, motifFilterEnv, motifOctaveLevel, motifFifthLevel, motifDetune, motifVibrato, motifVibratoHz, motifBreath, motifTremolo, motifVerb,
      motifSynth, fmRatio, fmIndex, fmDecayMs, motifOctaveEvery, motifOctaveRange, zoneTonality, zoneRing, zoneMargin, bandCells, arrival, arrivalHall, arrivalWave, arrivalGapMs, waveVerb, waveHit, grassVerb,
      bassFrom, afterlifeTail, afterglow, foundLevel, dead: false,
      // (the URL decides newLook — the experiment address — so it is read once per change of the switch)
      askCounterpoint: askCounterpoint && newLook(),
      ensembleCounterpoint: ensembleCounterpoint && newLook(),
      ensembleSwell,
      apartness,
      harmonyTurns: harmonyTurns && newLook(),
      turnAmount,
      colourAmount,
      tension,
      crowdFull,
      buildBars,
      bondSec,
      patienceBars,
      askDuck: newLook() ? askDuck : 0,
      futureSound: futureSound && newLook(),
      futureLevel,
      futureDur,
      futureHaze,
      futureRadio,
      futureEcho,
      futureGlitter,
      futureBloom,
    }),
    [master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, instrument, clockPull, motifEvery, microtone, motifEcho, ncDull, ncMap, ncMapDepth, ncReact, reactTension, reactChange, reactAsk, reactAnswer, reactEnsemble, reactBloom, reactPath, reactFound, bassSpread, bassDub, bassDuck, bassDrop, motifWave, motifTranspose, motifLevel, motifAttackMs, motifDecayMs, motifSustain, motifRelease, motifCutoff, motifQ, motifFilterEnv, motifOctaveLevel, motifFifthLevel, motifDetune, motifVibrato, motifVibratoHz, motifBreath, motifTremolo, motifVerb, motifSynth, fmRatio, fmIndex, fmDecayMs, motifOctaveEvery, motifOctaveRange, zoneTonality, zoneRing, zoneMargin, bandCells, arrival, arrivalHall, arrivalWave, arrivalGapMs, waveVerb, waveHit, grassVerb, bassFrom, afterlifeTail, afterglow, foundLevel, askCounterpoint, ensembleCounterpoint, ensembleSwell, apartness, harmonyTurns, turnAmount, colourAmount, tension, crowdFull, buildBars, bondSec, patienceBars, askDuck, futureSound, futureLevel, futureDur, futureHaze, futureRadio, futureEcho, futureGlitter, futureBloom],
  );
  const sigCfg = useMemo<SignalConfig>(() => ({ ...DEFAULT_SIGNALS, hearRadius, sealRadius, pathRadius }), [hearRadius, sealRadius, pathRadius]);
  const { record: recordOn, recordKbps } = c;
  const record = useMemo(() => ({ on: recordOn, kbps: recordKbps }), [recordOn, recordKbps]);
  const setup = useMemo(() => (engine ? { engine, params, sigCfg, status, muted: mutedState, toggleMute, record } : null), [engine, params, sigCfg, status, mutedState, toggleMute, record]);
  // THE FUTURE PASSING AS A DAYDREAM (§13k): the scan's future arriving (an observer overlapping me, an F, a find after
  // a quiet while) or let go (futureCue.ts) → the engine's daydream, and on arriving the old meadow's glitter
  const setupRef = useRef<SoundSetup | null>(null);
  setupRef.current = setup;
  useEffect(
    () =>
      onFutureCue((cue) => {
        const s = setupRef.current;
        if (!s || s.muted || !s.params.futureSound) return;
        if (!s.engine.daydream(cue.kind, cue.panFrom, cue.panTo)) return;
        const P = s.params;
        if (cue.kind === "arrive" && P.futureGlitter > 0)
          playFuturePassing(s, { glitter: Math.min(1, P.futureGlitter), river: 0, found: false, panFrom: cue.panFrom, panTo: cue.panTo, dur: P.futureDur, level: Math.min(1, P.futureLevel * Math.max(0.5, P.futureGlitter)) });
      }),
    [],
  );
  return setup;
}
