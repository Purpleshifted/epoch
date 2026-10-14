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

export interface SoundSetup {
  engine: SoundEngine;
  params: SoundParams;
  sigCfg: SignalConfig;
  /** One line for the screen: which window this is and whether it is playing (and why not). */
  status: string;
}

const ROOT = "소리 (V2 · 헤드셋)";

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
      solo: { value: false, label: "이 창만 듣기 (다른 창은 음소거 — 창 사이에 공유됨)", render: v2 },
      output: { options: outputOptions, value: "default", label: canPickOutput() ? "출력 장치 (헤드셋 / 스피커)" : "출력 장치 — 이 브라우저는 선택 불가", render: v2 },
      master: { value: DEFAULT_SOUND.master, min: 0, max: 1, step: 0.01, label: "음량", render: v2 },
      barSec: { value: DEFAULT_SOUND.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s) — 모두가 같은 박자", render: v2 },
      speedMax: { value: DEFAULT_SOUND.speedMax, min: 1, max: 15, step: 0.5, label: "뛰는 속도 (월드/s): 마디에 두 번 · 그 1/10 아래 = 멈춤: 두 마디에 한 번", render: v2 },
      noiseMix: { value: DEFAULT_SOUND.noiseMix, min: 0, max: 1, step: 0.01, label: "식생을 가로지를 때 노이즈 비율 (최대) — 길·건물·함께 지을 땐 0", render: v2 },
      jitterMax: { value: DEFAULT_SOUND.jitterMax, min: 0, max: 0.1, step: 0.005, label: "식생을 가로지를 때 박자가 흐트러지는 폭 (s)", render: v2 },
      lockPull: { value: DEFAULT_SOUND.lockPull, min: 0, max: 1, step: 0.05, label: "순응할 때 내 음이 장소의 코드에 끌리는 정도 (0 = 모티프 불변)", render: v2 },
      stepEvery: { value: DEFAULT_SOUND.stepEvery, min: 1, max: 30, step: 0.5, label: "길 위에서 코드가 한 번 바뀌는 거리 (월드)", render: v2 },
      bassLevel: { value: DEFAULT_SOUND.bassLevel, min: 0, max: 1, step: 0.01, label: "길 위의 베이스 펄스 (근음)", render: v2 },
      padLevel: { value: DEFAULT_SOUND.padLevel, min: 0, max: 1, step: 0.01, label: "함께 머물 때 이어지는 코드 (패드)", render: v2 },
      reverbMax: { value: DEFAULT_SOUND.reverbMax, min: 0, max: 1, step: 0.01, label: "함께 지을 때 열리는 홀 잔향 (최대)", render: v2 },
      lpOpen: { value: DEFAULT_SOUND.lpOpen, min: 500, max: 16000, step: 100, label: "열린 땅의 밝기 (저역통과 Hz)", render: v2 },
      lpSealed: { value: DEFAULT_SOUND.lpSealed, min: 100, max: 8000, step: 50, label: "건물 위의 먹먹함 (저역통과 Hz)", render: v2 },
      sealRadius: { value: DEFAULT_SIGNALS.sealRadius, min: 0.5, max: 10, step: 0.25, label: "건물이 먹먹하게 들리는 거리 (월드)", render: v2 },
      noiseMax: { value: DEFAULT_SOUND.noiseMax, min: 0, max: 1, step: 0.01, label: "식생의 노이즈 밝기 (최대)", render: v2 },
      hearRadius: { value: DEFAULT_SOUND.hearRadius, min: 2, max: 40, step: 0.5, label: "다른 사람이 들리는 거리 (월드)", render: v2 },
      othersLevel: { value: DEFAULT_SOUND.othersLevel, min: 0, max: 1, step: 0.01, label: "다른 사람 목소리 크기 (바로 옆에서)", render: v2 },
      botBlur: { value: DEFAULT_SOUND.botBlur, min: 0, max: 1, step: 0.01, label: "봇(메아리)의 흐림", render: v2 },
      magenta: { value: DEFAULT_SOUND.magenta, label: "Magenta 변주 (네트워크, 몇 초 뒤 로드)", render: v2 },
    }),
    { collapsed: false, order: -1, render: v2 },
    [outputOptions],
  ) as unknown as SoundParams & { on: boolean; solo: boolean; output: string; sealRadius: number };

  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new SoundEngine() : null), [isV2]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // ESC mutes this window's sound (and un-mutes on the next ESC); the Leva switch is the other way to stop it;
  // another window's SOLO (output.ts) is the third
  const muted = useRef(false);
  const soloed = useRef(false);
  const [status, setStatus] = useState("♪ 헤드셋");
  useEffect(() => {
    if (!engine) return;
    const start = () => {
      if (onRef.current && !muted.current && !soloed.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        muted.current = !muted.current;
        if (muted.current) engine.stop();
        else if (onRef.current) engine.start().catch(() => {});
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
  }, [engine]);

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
      const why = !onRef.current ? "꺼짐 (Leva)" : muted.current ? "음소거 (ESC)" : other ? `음소거 (${readSolo() === "global" ? "글로벌" : "다른"} 창이 솔로)` : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 헤드셋 (모바일 뷰) · ${why}${c.solo ? " · 솔로" : ""}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine, c.solo]);

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

  const { master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, lockPull, noiseMix, stepEvery, sealRadius } = c;
  const params = useMemo<SoundParams>(
    () => ({ master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, lockPull, noiseMix, stepEvery }),
    [master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, lockPull, noiseMix, stepEvery],
  );
  const sigCfg = useMemo<SignalConfig>(() => ({ ...DEFAULT_SIGNALS, hearRadius, sealRadius }), [hearRadius, sealRadius]);
  return useMemo(() => (engine ? { engine, params, sigCfg, status } : null), [engine, params, sigCfg, status]);
}
