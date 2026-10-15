"use client";
/**
 * SoundControls — every sound control of the work, in the workspace (docs/sound-logic.md §9).
 *
 * The artist: "put all the sound Leva into the workspace, linked to the player in real time". The folders that
 * lived on the player's page (headset: root, track A, track B, the rooms) and on the global views (speakers) are
 * here, rendered inline with Leva (`fill flat`), and every change goes to the DESK (lib/sound/desk.ts): written
 * to localStorage and posted on the bus, so the player tab and the speakers follow at once. The desk is also the
 * persistence (umwelt's autosave); the snapshot row keeps a checkpoint to come back to, and the JSON buttons
 * export / import the whole desk as a file (umwelt's Save / Load).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Leva, buttonGroup, levaStore, useControls } from "leva";
import { DEFAULT_SOUND, type SoundParams } from "@/lib/sound/engine";
import { DEFAULT_GLOBAL, type GlobalParams } from "@/lib/sound/global";
import { DEFAULT_SIGNALS } from "@/lib/sound/signals";
import { canPickOutput, listOutputs, type OutputDevice } from "@/lib/sound/output";
import { DESK_SNAPSHOT_KEY, exportDesk, parseDeskFile, readDesk, writeDesk, mergeDesk, type DeskState } from "@/lib/sound/desk";
import { openBus, type BusDesk } from "@/lib/sound/bus";

const HEADSET = "헤드셋 (플레이어 창)";
const TRACK_A = "트랙 A · 멜로디 (Web Audio)";
const TRACK_B = "트랙 B · 화성 (NoiseCraft 패치)";
const ROOMS = "방과 땅 (두 트랙 공통)";
const SPEAKERS = "스피커 (글로벌 창)";

const PATCHES: Record<string, string> = { "nc_noise_patch.ncft (umwelt 개인)": "nc_noise_patch.ncft", "Feedback_Synth.ncft (umwelt)": "Feedback_Synth.ncft", "global_audio.ncft (umwelt 글로벌)": "global_audio.ncft" };

type HeadsetKeys = "on" | "output" | "ncPatch" | "master" | "glue" | "instrument" | "harmony" | "barSec" | "speedMax" | "lockPull" | "stepEvery" | "sealRadius" | "hearRadius" | "innerRadius" | "magenta";
type AKeys = "melLevel" | "melRoom" | "melEcho" | "melFilter" | "melDelayMs" | "colourScale" | "noiseMix" | "jitterMax" | "othersLevel" | "botBlur" | "bassLevel" | "padLevel";
type BKeys = "ncLevel" | "ncRoom" | "ncFilter" | "ncRough" | "ncOctave";
type RKeys = "reverbMax" | "lpOpen" | "lpSealed" | "noiseMax";

/** Leva values written back from a desk (a snapshot, a file): every input of every folder. */
function applyDesk(d: DeskState): void {
  const set = (path: string, v: unknown) => {
    try {
      levaStore.setValueAtPath(path, v, true);
    } catch {
      /* an input that is not rendered */
    }
  };
  const h = d.headset;
  set(`${HEADSET}.on`, d.on);
  set(`${HEADSET}.output`, d.output);
  set(`${HEADSET}.ncPatch`, d.ncPatch);
  set(`${HEADSET}.sealRadius`, d.sealRadius);
  for (const k of ["master", "glue", "instrument", "harmony", "barSec", "speedMax", "lockPull", "stepEvery", "hearRadius", "innerRadius", "magenta"] as const) set(`${HEADSET}.${k}`, h[k]);
  for (const k of ["melLevel", "melRoom", "melEcho", "melFilter", "melDelayMs", "colourScale", "noiseMix", "jitterMax", "othersLevel", "botBlur", "bassLevel", "padLevel"] as const) set(`${TRACK_A}.${k}`, h[k]);
  for (const k of ["ncLevel", "ncRoom", "ncFilter", "ncRough", "ncOctave"] as const) set(`${TRACK_B}.${k}`, h[k]);
  for (const k of ["reverbMax", "lpOpen", "lpSealed", "noiseMax"] as const) set(`${ROOMS}.${k}`, h[k]);
  set(`${SPEAKERS}.speakersOn`, d.speakersOn);
  set(`${SPEAKERS}.speakersOutput`, d.speakersOutput);
  for (const k of Object.keys(DEFAULT_GLOBAL) as (keyof GlobalParams)[]) set(`${SPEAKERS}.${k}`, d.speakers[k]);
}

export interface SoundControlsProps {
  /** The desk as it is now (the workspace reads it once on load; the controls start from it). */
  initial: DeskState;
  /** Every change (throttled) — the workspace keeps the desk for its own engine too. */
  onChange(desk: DeskState): void;
}

export default function SoundControls({ initial, onChange }: SoundControlsProps) {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const outputOptions = useMemo(() => {
    const o: Record<string, string> = { "기본 출력": "default" };
    for (const d of devices) if (d.id !== "default") o[d.label] = d.id;
    if (initial.output !== "default" && !Object.values(o).includes(initial.output)) o[`(저장됨) ${initial.output.slice(0, 8)}`] = initial.output;
    if (initial.speakersOutput !== "default" && !Object.values(o).includes(initial.speakersOutput)) o[`(저장됨) ${initial.speakersOutput.slice(0, 8)}`] = initial.speakersOutput;
    return o;
  }, [devices, initial.output, initial.speakersOutput]);
  useEffect(() => {
    if (!canPickOutput()) return;
    listOutputs().then(setDevices);
    const onChange = () => listOutputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  const h0 = initial.headset;
  const s0 = initial.speakers;
  const hd = useControls(
    HEADSET,
    {
      on: { value: initial.on, label: "플레이어 소리 켜기 (그 창의 첫 클릭 뒤 시작 · ESC / ♪ 버튼 = 음소거)" },
      output: { options: outputOptions, value: initial.output, label: canPickOutput() ? "플레이어 출력 장치 (헤드셋)" : "출력 장치 — 이 브라우저는 선택 불가" },
      ncPatch: { options: PATCHES, value: initial.ncPatch, label: "플레이어가 연주하는 패치" },
      master: { value: h0.master, min: 0, max: 1, step: 0.01, label: "음량 (마스터 — 두 트랙 합)" },
      glue: { value: h0.glue, label: "글루 컴프레서 (두 트랙을 한 버스에서 묶음)" },
      instrument: { options: { "하이브리드: 멜로디는 Web Audio, 화성은 NoiseCraft 패치": "hybrid", "Web Audio만 (내장)": "webaudio", "NoiseCraft 패치만 (umwelt 방식)": "noisecraft" }, value: h0.instrument, label: "악기" },
      harmony: { options: { "화성 상태 H: 조성 = 누구의 무게 · 길 = 진행과 종지 · 접근 = 도미넌트 · 전조는 피벗으로": "fusion", "공유 월드 키 + 땅의 진행 · 전면 끌림 (10/14 오후 버전)": "world" }, value: h0.harmony, label: "화성 방식" },
      barSec: { value: h0.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s) — 모두가 같은 박자" },
      speedMax: { value: h0.speedMax, min: 1, max: 15, step: 0.5, label: "뛰는 속도 (월드/s): 마디에 두 번 · 그 1/10 아래 = 멈춤: 확대" },
      lockPull: { value: h0.lockPull, min: 0, max: 1, step: 0.05, label: "순응할 때 강박의 음이 코드톤으로 끌리는 정도" },
      stepEvery: { value: h0.stepEvery, min: 1, max: 30, step: 0.5, label: "길 위에서 코드가 한 번 바뀌는 거리 (월드)" },
      sealRadius: { value: initial.sealRadius, min: 0.5, max: 10, step: 0.25, label: "건물이 먹먹하게 들리는 거리 (월드)" },
      hearRadius: { value: h0.hearRadius, min: 2, max: 40, step: 0.5, label: "다른 사람이 들리는 거리 (월드) — 바깥: 질감·동반만" },
      innerRadius: { value: h0.innerRadius, min: 1, max: 20, step: 0.5, label: "성부로 들어오는 거리 (월드)" },
      magenta: { value: h0.magenta, label: "Magenta 선 (GPU를 three.js와 나눠 씀; 기본 꺼짐)" },
      __snap: buttonGroup({
        label: "스냅샷",
        opts: {
          "지금 값 저장": () => {
            try {
              window.localStorage.setItem(DESK_SNAPSHOT_KEY, JSON.stringify(readDesk()));
            } catch {
              /* storage unavailable */
            }
          },
          "되돌리기": () => {
            const d = readDesk(DESK_SNAPSHOT_KEY);
            if (d.at) applyDesk(d);
          },
          "기본값": () => applyDesk(mergeDesk({})),
        },
      }),
    },
    { order: 0 },
    [outputOptions],
  ) as unknown as Pick<SoundParams, Exclude<HeadsetKeys, "on" | "output" | "ncPatch" | "sealRadius">> & { on: boolean; output: string; ncPatch: string; sealRadius: number };
  const a = useControls(
    TRACK_A,
    {
      melLevel: { value: h0.melLevel, min: 0, max: 1, step: 0.01, label: "트랙 레벨" },
      melRoom: { value: h0.melRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (세 룸 공통 믹스 × 이 값)" },
      melEcho: { value: h0.melEcho, min: 0, max: 1, step: 0.01, label: "마디 에코 (3/16 마디; 되먹임은 순응할수록)" },
      melFilter: { value: h0.melFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도 (0 = 안 닫힘)" },
      melDelayMs: { value: h0.melDelayMs, min: 0, max: 200, step: 1, label: "지연 보정 (ms) — 패치 스트림의 지연만큼 멜로디를 늦춤" },
      colourScale: { value: h0.colourScale, min: 0, max: 1, step: 0.05, label: "미세음정 색 (1 = 서명의 센트 그대로, 0 = 평균율)" },
      noiseMix: { value: h0.noiseMix, min: 0, max: 1, step: 0.01, label: "식생을 가로지를 때 음의 노이즈 비율 (최대)" },
      jitterMax: { value: h0.jitterMax, min: 0, max: 0.1, step: 0.005, label: "식생을 가로지를 때 박자가 흐트러지는 폭 (s)" },
      othersLevel: { value: h0.othersLevel, min: 0, max: 1, step: 0.01, label: "다른 사람 목소리 크기 (바로 옆에서)" },
      botBlur: { value: h0.botBlur, min: 0, max: 1, step: 0.01, label: "봇(메아리)의 흐림" },
      bassLevel: { value: h0.bassLevel, min: 0, max: 1, step: 0.01, label: "베이스 펄스 (webaudio 악기일 때만)" },
      padLevel: { value: h0.padLevel, min: 0, max: 1, step: 0.01, label: "패드 (webaudio 악기일 때만)" },
    },
    { order: 1 },
  ) as unknown as Pick<SoundParams, AKeys>;
  const b = useControls(
    TRACK_B,
    {
      ncLevel: { value: h0.ncLevel, min: 0, max: 1.5, step: 0.01, label: "트랙 레벨" },
      ncRoom: { value: h0.ncRoom, min: 0, max: 1, step: 0.01, label: "방으로 보내는 양 (패치 자체 리버브 위에 더해짐)" },
      ncFilter: { value: h0.ncFilter, min: 0, max: 1, step: 0.01, label: "건물의 먹먹함을 따르는 정도" },
      ncRough: { value: h0.ncRough, min: 0, max: 1, step: 0.01, label: "식생의 거칢 (노이즈로 진폭을 갈아냄, 최대 깊이)" },
      ncOctave: { value: h0.ncOctave, min: -2, max: 1, step: 1, label: "텍스처 음 집합의 옥타브 (−1 = 멜로디 아래)" },
    },
    { order: 2 },
  ) as unknown as Pick<SoundParams, BKeys>;
  const r = useControls(
    ROOMS,
    {
      reverbMax: { value: h0.reverbMax, min: 0, max: 1, step: 0.01, label: "함께 지을 때 열리는 홀 잔향 (최대; 바닥 1/10)" },
      lpOpen: { value: h0.lpOpen, min: 500, max: 16000, step: 100, label: "열린 땅의 밝기 (저역통과 Hz)" },
      lpSealed: { value: h0.lpSealed, min: 100, max: 8000, step: 50, label: "건물 위의 먹먹함 (저역통과 Hz)" },
      noiseMax: { value: h0.noiseMax, min: 0, max: 1, step: 0.01, label: "식생의 노이즈 밝기 (최대)" },
    },
    { order: 3, collapsed: true },
  ) as unknown as Pick<SoundParams, RKeys>;
  const sp = useControls(
    SPEAKERS,
    {
      speakersOn: { value: initial.speakersOn, label: "스피커 소리 켜기 (글로벌 창의 첫 클릭 뒤 시작 · 기본 꺼짐)" },
      speakersOutput: { options: outputOptions, value: initial.speakersOutput, label: canPickOutput() ? "스피커 출력 장치" : "출력 장치 — 이 브라우저는 선택 불가" },
      master: { value: s0.master, min: 0, max: 1, step: 0.01, label: "음량" },
      barSec: { value: s0.barSec, min: 1, max: 4, step: 0.1, label: "한 마디 길이 (s)" },
      octavesDown: { value: s0.octavesDown, min: 0, max: 4, step: 1, label: "모티프를 내리는 옥타브" },
      cutoff: { value: s0.cutoff, min: 80, max: 4000, step: 10, label: "전체 저역통과 (Hz)" },
      hall: { value: s0.hall, min: 0, max: 1, step: 0.01, label: "홀 (8 s)" },
      perVoice: { value: s0.perVoice, min: 0, max: 0.5, step: 0.005, label: "한 사람의 목소리 크기 (모두 합산됨)" },
      tickLevel: { value: s0.tickLevel, min: 0, max: 1, step: 0.01, label: "한 사람의 리듬 흔적 크기" },
      spread: { value: s0.spread, min: 0, max: 1, step: 0.01, label: "뭉침의 좌우 폭 (건물·사람 위치)" },
      drive: { value: s0.drive, min: 1, max: 8, step: 0.1, label: "뭉개짐 (새추레이션)" },
      windowSec: { value: s0.windowSec, min: 30, max: 1200, step: 30, label: "존재로 세는 창 (s)" },
    },
    { order: 4, collapsed: true },
    [outputOptions],
  ) as unknown as GlobalParams & { speakersOn: boolean; speakersOutput: string };

  // the desk from the controls, written and posted on every change (throttled to 10 a second)
  const desk = useMemo<DeskState>(() => {
    const { on, output, ncPatch, sealRadius, ...head } = hd;
    const { speakersOn, speakersOutput, ...speakers } = sp;
    return {
      headset: { ...DEFAULT_SOUND, ...head, ...a, ...b, ...r },
      on,
      output,
      ncPatch,
      sealRadius,
      speakers: { ...DEFAULT_GLOBAL, ...speakers },
      speakersOn,
      speakersOutput,
      overrides: initial.overrides,
      at: 0, // stamped when written
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hd, a, b, r, sp]);
  const bus = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    bus.current = openBus();
    return () => bus.current?.close();
  }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // the controls started from the desk: nothing to write yet
      onChange({ ...desk, overrides: readDesk().overrides, at: Date.now() });
      return;
    }
    const id = setTimeout(() => {
      const full = { ...desk, overrides: readDesk().overrides, at: Date.now() };
      writeDesk(full);
      const msg: BusDesk = { type: "desk", desk: full };
      bus.current?.postMessage(msg);
      onChange(full);
    }, 100);
    return () => clearTimeout(id);
  }, [desk, onChange]);

  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[10px] text-white/50">
        <span>이 벤치의 엔진에만 적용 (자동 저장) — 작품의 값은 코드</span>
        <button
          onClick={() => {
            const blob = new Blob([exportDesk(readDesk())], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const el = document.createElement("a");
            el.href = url;
            el.download = `parliament-sound-desk-${new Date().toISOString().slice(0, 10)}.json`;
            el.click();
            URL.revokeObjectURL(url);
          }}
          className="ml-auto rounded border border-white/20 px-1.5 py-0.5 text-white/60"
        >
          JSON 내보내기
        </button>
        <button onClick={() => fileInput.current?.click()} className="rounded border border-white/20 px-1.5 py-0.5 text-white/60">
          불러오기
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then((t) => {
              const d = parseDeskFile(t);
              if (d) applyDesk(d);
            });
            e.target.value = "";
          }}
        />
      </div>
      <Leva fill flat titleBar={false} hideCopyButton theme={{ sizes: { controlWidth: "120px", rowHeight: "22px" }, fontSizes: { root: "10px" } }} />
      <p className="text-[10px] text-white/35">{DEFAULT_SIGNALS.sealRadius === initial.sealRadius ? "" : ""}출력 장치는 이 PC의 장치 목록입니다 — 플레이어·스피커 창이 같은 PC에서 열려 있을 때 그대로 적용됩니다.</p>
    </div>
  );
}
