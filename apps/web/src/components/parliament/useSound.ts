"use client";
/**
 * useSound — the player's headset sound (V2 only): a Leva folder of its mapping ranges and the engine
 * (lib/sound/engine.ts), started on the first user gesture (mobile autoplay rules).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";
import { DEFAULT_SIGNALS, DEFAULT_SOUND, SoundEngine, canPickOutput, listOutputs, mutedBySolo, readSolo, setSolo, type OutputDevice, type SignalConfig, type SoundParams } from "@/lib/sound";
import { openBus, type BusState } from "@/lib/sound/bus";

export interface SoundSetup {
  engine: SoundEngine;
  params: SoundParams;
  sigCfg: SignalConfig;
  /** The NoiseCraft instrument (NoiseCraftHost.tsx): which patch file. */
  nc: { patch: string };
  /** One line for the screen: which window this is and whether it is playing (and why not). */
  status: string;
  /** Whether this window's sound is muted (ESC or the sound button), and the switch (SoundButton.tsx). */
  muted: boolean;
  toggleMute(): void;
}

const ROOT = "소리 (V2 · 헤드셋)";
const TRACK_A = `${ROOT}.트랙 A · 멜로디 (Web Audio)`;
const TRACK_B = `${ROOT}.트랙 B · 화성 (NoiseCraft 패치)`;
const ROOMS = `${ROOT}.방과 땅 (두 트랙 공통)`;
type TrackKeys = "melLevel" | "melRoom" | "melEcho" | "melFilter" | "melDelayMs" | "colourScale" | "noiseMix" | "jitterMax" | "othersLevel" | "botBlur" | "bassLevel" | "padLevel" | "ncLevel" | "ncRoom" | "ncFilter" | "ncRough" | "ncOctave" | "reverbMax" | "lpOpen" | "lpSealed" | "noiseMax";

export function useSound(): SoundSetup | null {
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const outputOptions = useMemo(() => {
    const o: Record<string, string> = { "기본 출력": "default" };
    for (const d of devices) if (d.id !== "default") o[d.label] = d.id;
    return o;
  }, [devices]);
  const c = useControls(
    ROOT,
    savable(ROOT, {
      on: { value: true, label: "켜기 (첫 클릭/터치 뒤 시작 · ESC = 이 창 음소거/해제)", render: v2 },
      instrument: {
        options: { "하이브리드: 멜로디는 Web Audio, 화성은 NoiseCraft 패치": "hybrid", "Web Audio만 (내장)": "webaudio", "NoiseCraft 패치만 (umwelt 방식)": "noisecraft" },
        value: DEFAULT_SOUND.instrument,
        label: "악기",
        render: v2,
      },
      ncPatch: {
        options: { "nc_noise_patch.ncft (umwelt 개인)": "nc_noise_patch.ncft", "Feedback_Synth.ncft (umwelt)": "Feedback_Synth.ncft", "global_audio.ncft (umwelt 글로벌)": "global_audio.ncft" },
        value: "nc_noise_patch.ncft",
        label: "NoiseCraft 패치 — 편집은 /v2/sound 에서",
        render: v2,
      },
      harmony: {
        options: {
          "화성 상태 H: 조성 = 누구의 무게 (홈 / 집단 / 건물) · 길 = 진행과 종지 · 접근 = 도미넌트 · 전조는 피벗으로": "fusion",
          "공유 월드 키 + 땅의 진행 · 전면 끌림 (10/14 오후 버전)": "world",
        },
        value: DEFAULT_SOUND.harmony,
        label: "화성 방식",
        render: v2,
      },
      solo: { value: false, label: "이 창만 듣기 (다른 창은 음소거 — 창 사이에 공유됨)", render: v2 },
      output: { options: outputOptions, value: "default", label: canPickOutput() ? "출력 장치 (헤드셋 / 스피커)" : "출력 장치 — 이 브라우저는 선택 불가", render: v2 },
      master: { value: DEFAULT_SOUND.master, min: 0, max: 1, step: 0.01, label: "음량 (마스터 — 두 트랙 합)", render: v2 },
      glue: { value: DEFAULT_SOUND.glue, label: "글루 컴프레서 (두 트랙을 한 버스에서 묶음)", render: v2 },
      barSec: { value: DEFAULT_SOUND.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s) — 모두가 같은 박자", render: v2 },
      speedMax: { value: DEFAULT_SOUND.speedMax, min: 1, max: 15, step: 0.5, label: "뛰는 속도 (월드/s): 마디에 두 번 · 그 1/10 아래 = 멈춤: 두 마디에 한 번", render: v2 },
      lockPull: { value: DEFAULT_SOUND.lockPull, min: 0, max: 1, step: 0.05, label: "순응할 때 강박의 음이 코드톤으로 끌리는 정도 (0 = 안 끌림; world 모드는 항상 1)", render: v2 },
      stepEvery: { value: DEFAULT_SOUND.stepEvery, min: 1, max: 30, step: 0.5, label: "길 위에서 코드가 한 번 바뀌는 거리 (월드)", render: v2 },
      sealRadius: { value: DEFAULT_SIGNALS.sealRadius, min: 0.5, max: 10, step: 0.25, label: "건물이 먹먹하게 들리는 거리 (월드)", render: v2 },
      hearRadius: { value: DEFAULT_SOUND.hearRadius, min: 2, max: 40, step: 0.5, label: "다른 사람이 들리는 거리 (월드) — 바깥: 질감·동반만", render: v2 },
      innerRadius: { value: DEFAULT_SOUND.innerRadius, min: 1, max: 20, step: 0.5, label: "성부로 들어오는 거리 (월드) — 안쪽: 그 사람의 모티프가 내 시퀀스에", render: v2 },
      magenta: { value: DEFAULT_SOUND.magenta, label: "Magenta 변주 (GPU를 three.js와 나눠 씀 → 봇 많으면 렉; 기본 꺼짐)", render: v2 },
    }),
    { collapsed: false, order: -1, render: v2 },
    [outputOptions],
  ) as unknown as Omit<SoundParams, TrackKeys> & { on: boolean; solo: boolean; output: string; sealRadius: number; ncPatch: string };
  // TRACK A — the melody (Web Audio): its own level, room send, echo, filter, latency, colour, roughness
  const a = useControls(
    TRACK_A,
    savable(TRACK_A, {
      melLevel: { value: DEFAULT_SOUND.melLevel, min: 0, max: 1, step: 0.01, label: "트랙 레벨", render: v2 },
      melRoom: { value: DEFAULT_SOUND.melRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (세 룸 공통 믹스 × 이 값)", render: v2 },
      melEcho: { value: DEFAULT_SOUND.melEcho, min: 0, max: 1, step: 0.01, label: "마디 에코 (3/16 마디; 되먹임은 순응할수록)", render: v2 },
      melFilter: { value: DEFAULT_SOUND.melFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도 (0 = 안 닫힘)", render: v2 },
      melDelayMs: { value: DEFAULT_SOUND.melDelayMs, min: 0, max: 200, step: 1, label: "지연 보정 (ms) — 패치 스트림의 지연만큼 멜로디를 늦춤", render: v2 },
      colourScale: { value: DEFAULT_SOUND.colourScale, min: 0, max: 1, step: 0.05, label: "미세음정 색 (1 = 서명의 센트 그대로, 0 = 평균율)", render: v2 },
      noiseMix: { value: DEFAULT_SOUND.noiseMix, min: 0, max: 1, step: 0.01, label: "식생을 가로지를 때 음의 노이즈 비율 (최대)", render: v2 },
      jitterMax: { value: DEFAULT_SOUND.jitterMax, min: 0, max: 0.1, step: 0.005, label: "식생을 가로지를 때 박자가 흐트러지는 폭 (s)", render: v2 },
      othersLevel: { value: DEFAULT_SOUND.othersLevel, min: 0, max: 1, step: 0.01, label: "다른 사람 목소리 크기 (바로 옆에서)", render: v2 },
      botBlur: { value: DEFAULT_SOUND.botBlur, min: 0, max: 1, step: 0.01, label: "봇(메아리)의 흐림", render: v2 },
      bassLevel: { value: DEFAULT_SOUND.bassLevel, min: 0, max: 1, step: 0.01, label: "베이스 펄스 (webaudio 악기일 때만)", render: v2 },
      padLevel: { value: DEFAULT_SOUND.padLevel, min: 0, max: 1, step: 0.01, label: "패드 (webaudio 악기일 때만)", render: v2 },
    }, [ROOT]),
    { collapsed: false, order: 0, render: v2 },
  ) as unknown as Pick<SoundParams, "melLevel" | "melRoom" | "melEcho" | "melFilter" | "melDelayMs" | "colourScale" | "noiseMix" | "jitterMax" | "othersLevel" | "botBlur" | "bassLevel" | "padLevel">;
  // TRACK B — the patch (NoiseCraft through the engine's bus): level, room send, filter, vegetation grain, register
  const b = useControls(
    TRACK_B,
    savable(TRACK_B, {
      ncLevel: { value: DEFAULT_SOUND.ncLevel, min: 0, max: 1.5, step: 0.01, label: "트랙 레벨", render: v2 },
      ncRoom: { value: DEFAULT_SOUND.ncRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (패치 자체 리버브 위에 더해짐)", render: v2 },
      ncFilter: { value: DEFAULT_SOUND.ncFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도", render: v2 },
      ncRough: { value: DEFAULT_SOUND.ncRough, min: 0, max: 1, step: 0.01, label: "식생의 거칢 (노이즈로 진폭을 갈아냄, 최대 깊이)", render: v2 },
      ncOctave: { value: DEFAULT_SOUND.ncOctave, min: -2, max: 1, step: 1, label: "텍스처 음 집합의 옥타브 (−1 = 멜로디 아래)", render: v2 },
    }, [ROOT]),
    { collapsed: false, order: 1, render: v2 },
  ) as unknown as Pick<SoundParams, "ncLevel" | "ncRoom" | "ncFilter" | "ncRough" | "ncOctave">;
  // THE ROOMS and the ground — common to both tracks
  const r = useControls(
    ROOMS,
    savable(ROOMS, {
      reverbMax: { value: DEFAULT_SOUND.reverbMax, min: 0, max: 1, step: 0.01, label: "함께 지을 때 열리는 홀 잔향 (최대; 바닥 1/10)", render: v2 },
      lpOpen: { value: DEFAULT_SOUND.lpOpen, min: 500, max: 16000, step: 100, label: "열린 땅의 밝기 (저역통과 Hz)", render: v2 },
      lpSealed: { value: DEFAULT_SOUND.lpSealed, min: 100, max: 8000, step: 50, label: "건물 위의 먹먹함 (저역통과 Hz)", render: v2 },
      noiseMax: { value: DEFAULT_SOUND.noiseMax, min: 0, max: 1, step: 0.01, label: "식생의 노이즈 밝기 (최대)", render: v2 },
    }, [ROOT]),
    { collapsed: true, order: 2, render: v2 },
  ) as unknown as Pick<SoundParams, "reverbMax" | "lpOpen" | "lpSealed" | "noiseMax">;

  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new SoundEngine() : null), [isV2]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // ESC mutes this window's sound (and un-mutes on the next ESC); the Leva switch is the other way to stop it;
  // another window's SOLO (output.ts) is the third
  const muted = useRef(false);
  const [mutedState, setMutedState] = useState(false);
  const soloed = useRef(false);
  const [status, setStatus] = useState("♪ 헤드셋");
  // the switch the ESC key and the sound button share
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
      if (onRef.current && !muted.current && !soloed.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleMute();
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
    if (c.on && !muted.current && !soloed.current) engine.start().catch(() => {}); // no-op until a gesture has unlocked the context
    else engine.stop();
  }, [engine, c.on]);

  // SOLO: claim or release the shared solo; every second obey another window's claim and refresh the status line
  useEffect(() => {
    if (!engine) return;
    if (c.solo) setSolo("mobile");
    else if (readSolo() === "mobile") setSolo(null);
  }, [engine, c.solo]);
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const other = mutedBySolo("mobile");
      if (other !== soloed.current) {
        soloed.current = other;
        if (other) engine.stop();
        else if (onRef.current && !muted.current) engine.start().catch(() => {});
      }
      const who = readSolo();
      const why = !onRef.current ? "꺼짐 (Leva)" : muted.current ? "음소거 (ESC)" : other ? `음소거 (${who === "global" ? "글로벌" : who === "manager" ? "매니저" : "다른"} 창이 솔로)` : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 헤드셋 (모바일 뷰) · ${why}${c.solo ? " · 솔로" : ""}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine, c.solo]);

  // THE BUS: twice a second this tab's state goes to the other windows (the manager page plans the same bars)
  useEffect(() => {
    if (!engine) return;
    const bus = openBus();
    if (!bus) return;
    const id = setInterval(() => {
      const sig = engine.signals;
      const d = engine.debug;
      if (!sig || !d.myId || !d.epochMs) return;
      const msg: BusState = { type: "state", myId: d.myId, sig, params: engine.params, epochMs: d.epochMs, yaw: d.yaw, at: Date.now() };
      bus.postMessage(msg);
    }, 500);
    return () => {
      clearInterval(id);
      bus.close();
    };
  }, [engine]);

  // OUTPUT DEVICE: list once the context exists (labels need a granted media permission; ids work regardless)
  useEffect(() => {
    if (!engine || !canPickOutput()) return;
    listOutputs().then(setDevices);
    const onChange = () => listOutputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    engine.setSink(c.output ?? "default").catch(() => {});
  }, [engine, c.output]);

  const { master, barSec, speedMax, hearRadius, innerRadius, magenta, lockPull, stepEvery, harmony, instrument, sealRadius, ncPatch, glue } = c;
  const { melLevel, melRoom, melEcho, melFilter, melDelayMs, colourScale, noiseMix, jitterMax, othersLevel, botBlur, bassLevel, padLevel } = a;
  const { ncLevel, ncRoom, ncFilter, ncRough, ncOctave } = b;
  const { reverbMax, lpOpen, lpSealed, noiseMax } = r;
  const params = useMemo<SoundParams>(
    () => ({ master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, innerRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, lockPull, noiseMix, stepEvery, harmony, instrument, melLevel, melRoom, melEcho, melFilter, melDelayMs, colourScale, ncLevel, ncRoom, ncFilter, ncRough, ncOctave, glue }),
    [master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, innerRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, lockPull, noiseMix, stepEvery, harmony, instrument, melLevel, melRoom, melEcho, melFilter, melDelayMs, colourScale, ncLevel, ncRoom, ncFilter, ncRough, ncOctave, glue],
  );
  const nc = useMemo(() => ({ patch: ncPatch || "nc_noise_patch.ncft" }), [ncPatch]);
  const sigCfg = useMemo<SignalConfig>(() => ({ ...DEFAULT_SIGNALS, hearRadius, sealRadius }), [hearRadius, sealRadius]);
  return useMemo(() => (engine ? { engine, params, sigCfg, status, nc, muted: mutedState, toggleMute } : null), [engine, params, sigCfg, status, nc, mutedState, toggleMute]);
}
