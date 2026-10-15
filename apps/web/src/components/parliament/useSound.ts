"use client";
/**
 * useSound — the player's headset sound (V2 only): a Leva folder of its mapping ranges and the engine
 * (lib/sound/engine.ts), started on the first user gesture (mobile autoplay rules). The window's own mute (the ♪
 * button, SoundButton.tsx; ESC too when there is no session — with one, ESC is the look-release key) and a status
 * line for the screen (docs/sound-logic.md §13).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";
import { DEFAULT_SIGNALS, DEFAULT_SOUND, SoundEngine, type SignalConfig, type SoundParams } from "@/lib/sound";

export interface SoundSetup {
  engine: SoundEngine;
  params: SoundParams;
  sigCfg: SignalConfig;
  /** One line for the screen: which window this is and whether it is playing (and why not). */
  status: string;
  /** This window's mute (the ♪ button / ESC) and its switch. */
  muted: boolean;
  toggleMute(): void;
}

export interface SoundOptions {
  /** ESC toggles the mute (true without a session; with one ESC releases the look instead). */
  escMute?: boolean;
}

const ROOT = "소리 (V2 · 헤드셋)";

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
      bassDub: { value: DEFAULT_SOUND.bassDub, min: 0, max: 1, step: 0.05, label: "심장박동: 두 번째 박 세기", render: v2 },
      bassSpread: { value: DEFAULT_SOUND.bassSpread, min: 0, max: 1, step: 0.05, label: "심장박동: 퍼짐 (방·홀로)", render: v2 },
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
      motifEvery: { value: DEFAULT_SOUND.motifEvery, min: 1, max: 4, step: 1, label: "내 모티프: 몇 마디에 한 번", render: v2 },
      microtone: { value: DEFAULT_SOUND.microtone, min: 0, max: 1, step: 0.05, label: "모티프 미세음정 양 (0 = 패치와 같은 조율)", render: v2 },
      motifEcho: { value: DEFAULT_SOUND.motifEcho, min: 0, max: 1, step: 0.05, label: "모티프 에코 (마디에 맞춘 메아리)", render: v2 },
      motifSoft: { value: DEFAULT_SOUND.motifSoft, min: 0, max: 1, step: 0.05, label: "모티프 부드럽게 (느린 어택 · 어두운 음색)", render: v2 },
      ncDull: { value: DEFAULT_SOUND.ncDull, min: 0, max: 1, step: 0.05, label: "패치도 건물에서 먹먹해지는 정도 (0 = 안 먹먹)", render: v2 },
    }, [], [
      { tag: "v4-a1-magenta-off", set: { magenta: false } }, // a saved "on" from before v4 A1 is switched off once
      { tag: "v4-a2b-both", set: { instrument: "both" } }, // the artist (A2 test): both instruments side by side
    ]),
    { collapsed: false, order: -1, render: v2 },
  ) as unknown as SoundParams & { on: boolean; sealRadius: number };

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
      setStatus(`♪ 헤드셋 (모바일 뷰) · ${why}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine]);

  const { master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, sealRadius, instrument, clockPull, motifEvery, microtone, motifEcho, motifSoft, ncDull, bassSpread, bassDub } = c;
  const params = useMemo<SoundParams>(
    () => ({ master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, instrument, clockPull, motifEvery, microtone, motifEcho, motifSoft, ncDull, bassSpread, bassDub }),
    [master, barSec, speedMax, reverbMax, jitterMax, lpOpen, lpSealed, noiseMax, hearRadius, othersLevel, botBlur, bassLevel, padLevel, magenta, instrument, clockPull, motifEvery, microtone, motifEcho, motifSoft, ncDull, bassSpread, bassDub],
  );
  const sigCfg = useMemo<SignalConfig>(() => ({ ...DEFAULT_SIGNALS, hearRadius, sealRadius }), [hearRadius, sealRadius]);
  return useMemo(() => (engine ? { engine, params, sigCfg, status, muted: mutedState, toggleMute } : null), [engine, params, sigCfg, status, mutedState, toggleMute]);
}
