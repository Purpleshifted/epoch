"use client";
/**
 * NoiseCraftManagerScene — the sound WORKSPACE (/v2/sound), umwelt's NoiseCraft Manager brought over and grown
 * into the work's mixing desk (docs/sound-logic.md §8b, §9):
 *   patch list  →  editor: the patch in NoiseCraft's full editor (auto-saved) + the INSPECTOR on the right.
 * What drives the patch here is the same brain as in the player tab: a SoundEngine fed by the bus (the player
 * tab's live signals, when a player tab is open — the link) or by the SIMULATOR (sliders and SCENARIOS). The
 * controls (SoundControls.tsx → the DESK, lib/sound/desk.ts) drive THIS page's engine only: the work's values are
 * code (DEFAULT_DESK), which the artist asked to be tuned by hand in the repo (2026-10-15) — this page is the
 * BENCH where a value is tried before it goes into the code. It is not linked from the home. The mapping is code
 * (noisecraftMap.ts); the inspector shows every knob rule with its live value, and a knob clicked in the editor
 * shows its rule and can be HELD by hand (umwelt's auto-fill, turned into an override — here only).
 *
 * Borrowed from umwelt: the manager page itself; GlobalDashboard's stream monitor (sparklines of the signals);
 * ControlPanel's spectral meter (two track meters here); NodeMappingPanel's node click; the autosave / export /
 * import of the mapping store (the desk). The listening choice ("듣기") decides which window plays: this one
 * (the player's walk rendered here, solo), the player's, the speakers', or all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundEngine } from "@/lib/sound/engine";
import { getNoiseCraftBridge } from "@/lib/sound/NoiseCraftBridge";
import { NoiseCraftDriver, type DriverStatus } from "@/lib/sound/noisecraftDriver";
import { harmonyLabel } from "@/lib/sound/harmonyState";
import { PULSES_PER_BAR, PULSES_PER_STEP, knobParams, mapFor, modeOf, roughOf } from "@/lib/sound/noisecraftMap";
import { openBus, type BusMessage, type BusState } from "@/lib/sound/bus";
import { readSolo, setSolo, type SoundView } from "@/lib/sound/output";
import { DEFAULT_DESK, type DeskState } from "@/lib/sound/desk";
import { KEY_NAMES, chordName } from "@/lib/sound/harmony";
import type { BarPlan } from "@/lib/sound/sequencer";
import type { PersonalSignals } from "@/lib/sound/signals";
import NoiseCraftPatchManager from "./NoiseCraftPatchManager";
import SoundControls from "./SoundControls";

interface Sim {
  speed: number;
  stay: number;
  pathP: number;
  sealed: number;
  grass: number;
  neighbours: number;
}

const SIM0: Sim = { speed: 0, stay: 1, pathP: 0, sealed: 0, grass: 0.5, neighbours: 0 };

/** A scenario: simulated signals over time, looping. */
interface Scenario {
  name: string;
  steps: { sec: number; sim: Partial<Sim> }[];
}

const SCENARIOS: Scenario[] = [
  { name: "열린 땅 산책", steps: [{ sec: 12, sim: { speed: 3, stay: 0, pathP: 0, sealed: 0, grass: 0.6, neighbours: 0 } }, { sec: 8, sim: { speed: 0, stay: 1 } }] },
  {
    name: "길 걷기 → 멈춤 → 벗어남",
    steps: [
      { sec: 14, sim: { speed: 3, stay: 0, pathP: 1, sealed: 0, grass: 0.1, neighbours: 0 } },
      { sec: 8, sim: { speed: 0, stay: 1, pathP: 1 } },
      { sec: 8, sim: { speed: 3, stay: 0, pathP: 1 } },
      { sec: 10, sim: { speed: 3, stay: 0, pathP: 0, grass: 0.7 } },
    ],
  },
  {
    name: "건물 접근 → 진입 → 떠남",
    steps: [
      { sec: 8, sim: { speed: 2, stay: 0, pathP: 0.5, sealed: 0, grass: 0.3, neighbours: 1 } },
      { sec: 6, sim: { speed: 1.5, sealed: 0.15 } },
      { sec: 12, sim: { speed: 0, stay: 1, sealed: 0.8 } },
      { sec: 10, sim: { speed: 2, stay: 0, sealed: 0, pathP: 0.2 } },
    ],
  },
  {
    name: "둘이 머묾 → 짓기",
    steps: [
      { sec: 8, sim: { speed: 2, stay: 0, pathP: 0.3, sealed: 0, grass: 0.3, neighbours: 1 } },
      { sec: 14, sim: { speed: 0, stay: 1, neighbours: 2 } },
      { sec: 14, sim: { speed: 0, stay: 1, neighbours: 2, sealed: 0.7 } },
    ],
  },
  { name: "뛰어 가로지르기", steps: [{ sec: 10, sim: { speed: 7, stay: 0, pathP: 0, sealed: 0, grass: 1, neighbours: 0 } }, { sec: 6, sim: { speed: 0, stay: 1 } }] },
];

/** One row of the bar log. */
interface BarRow {
  bar: number;
  harmony: string;
  me: string;
  anchor: number;
  line: string;
  density: number;
  answer: boolean;
}

const noteName = (midi: number) => KEY_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const rowOf = (plan: BarPlan): BarRow => ({
  bar: plan.bar,
  harmony: plan.harmony ? harmonyLabel(plan.harmony) : `${chordName(plan.chord)} (deg ${plan.chord.degree})`,
  me: plan.me.map((n) => noteName(n.pitch) + (n.locked ? "*" : "")).join(" "),
  anchor: plan.anchor,
  line: plan.line.map((n) => noteName(n.pitch)).join(" "),
  density: plan.density,
  answer: plan.answer,
});
const rowText = (r: BarRow) => `bar ${r.bar} · ${r.harmony} · me [${r.me}]${r.anchor ? ` anchor ${r.anchor > 0 ? "+" : ""}${r.anchor}` : ""} ×${r.density}${r.answer ? " answer" : ""}${r.line ? ` · line [${r.line}]` : ""}`;

function simSignals(s: Sim): PersonalSignals {
  const neighbours = Array.from({ length: Math.round(s.neighbours) }, (_, i) => ({ o: `bot${i}`, dist: 2 + i * 2.5, angle: (i * 2.1) % (Math.PI * 2), bot: true }));
  const who = s.sealed >= 0.3 ? [{ o: "v_manager", amount: 10 }, ...neighbours.map((n, i) => ({ o: n.o, amount: 8 - i * 2 }))] : [];
  return { x: 0, z: 0, speed: s.speed, stay: s.stay, neighbours, pathP: s.pathP, sealed: s.sealed, building: s.sealed >= 0.3 ? { id: "sim", dist: 0.5, who } : null, grass: s.grass };
}

interface View {
  sig: PersonalSignals | null;
  source: "bus" | "sim";
  status: DriverStatus | null;
  plan: BarPlan | null;
  /** The player tab on the bus: who, and how long ago it spoke (ms); null when none. */
  link: { myId: string; ago: number } | null;
  meters: { a: number; b: number };
}

const BUS_STALE_MS = 3000;

/** Who plays while this page is on: this page (the player's walk rendered here), the player's own window, the speakers, or everybody. */
type Listen = SoundView | "none";
const LISTEN: { id: Listen; label: string }[] = [
  { id: "manager", label: "이 작업실에서 (플레이어의 걸음을 여기서 연주 · 솔로)" },
  { id: "mobile", label: "플레이어 창에서 (헤드셋) — 여기선 조정만" },
  { id: "global", label: "스피커 창에서 — 여기선 조정만" },
  { id: "none", label: "모든 창 각자" },
];

/** The signals the sparklines follow (umwelt's stream monitor). */
const SPARK: { key: string; max: number; color: string }[] = [
  { key: "speed", max: 8, color: "#4ecdc4" },
  { key: "stay", max: 1, color: "#4ecdc4" },
  { key: "pathP", max: 1, color: "#a78bfa" },
  { key: "sealed", max: 1, color: "#a78bfa" },
  { key: "grass", max: 1, color: "#8bd17c" },
  { key: "rough", max: 1, color: "#ff6b9d" },
  { key: "tension", max: 1, color: "#f59e0b" },
];
const SPARK_LEN = 60;

function Sparkline({ hist, max, color }: { hist: number[]; max: number; color: string }) {
  const W = 120, H = 22;
  const pts = hist.map((v, i) => `${(i / (SPARK_LEN - 1)) * W},${H - Math.max(0, Math.min(1, v / max)) * (H - 2) - 1}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-[22px] w-full rounded bg-black/40">
      {hist.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export default function NoiseCraftManagerScene() {
  const [patch, setPatch] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [listen, setListen] = useState<Listen>("manager");
  const listenRef = useRef<Listen>("manager");
  const [sim, setSim] = useState<Sim>(SIM0);
  const simRef = useRef(sim);
  const [scenario, setScenario] = useState<string | null>(null);
  const scenarioStart = useRef(0);
  const [mute, setMute] = useState({ melody: false, harmony: false });
  const muteRef = useRef(mute);
  const [bars, setBars] = useState<BarRow[]>([]);
  const barsRef = useRef<BarRow[]>([]);
  const deskRef = useRef<DeskState>(DEFAULT_DESK);
  const [desk, setDeskState] = useState<DeskState>(DEFAULT_DESK);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);
  const [picked, setPicked] = useState<string | null>(null);
  const spark = useRef<Record<string, number[]>>({});
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [view, setView] = useState<View>({ sig: null, source: "sim", status: null, plan: null, link: null, meters: { a: 0, b: 0 } });
  const container = useRef<HTMLDivElement>(null);
  const engine = useMemo(() => new SoundEngine(), []); // this page's instrument: silent unless it is the one listening
  const live = useRef<{ bus: BusState | null; sig: PersonalSignals | null }>({ bus: null, sig: null });
  const driver = useRef<NoiseCraftDriver | null>(null);
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);
  useEffect(() => {
    muteRef.current = mute;
  }, [mute]);
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

  const onDeskChange = useCallback((d: DeskState) => {
    deskRef.current = d;
    setDeskState(d);
  }, []);

  /** A patch knob held by hand on this bench (null = released). */
  const setOverride = useCallback((nodeId: string, value: number | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value == null) delete next[nodeId];
      else next[nodeId] = value;
      return next;
    });
  }, []);

  // a scenario drives the simulator: the step by the time elapsed, looping
  useEffect(() => {
    if (!scenario) return;
    const sc = SCENARIOS.find((x) => x.name === scenario);
    if (!sc) return;
    scenarioStart.current = Date.now();
    const total = sc.steps.reduce((a, b) => a + b.sec, 0);
    let last = -1;
    const id = setInterval(() => {
      let t = ((Date.now() - scenarioStart.current) / 1000) % total;
      for (let i = 0; i < sc.steps.length; i++) {
        const st = sc.steps[i];
        if (t < st.sec) {
          if (i !== last) {
            last = i;
            setSim((prev) => ({ ...prev, ...st.sim })); // only when the step changes (a new object every tick would re-run effects)
          }
          break;
        }
        t -= st.sec;
      }
    }, 250);
    return () => clearInterval(id);
  }, [scenario]);

  // the bus: the player tab's state, when one is talking (the link)
  useEffect(() => {
    const bus = openBus();
    if (!bus) return;
    bus.onmessage = (e: MessageEvent<BusMessage>) => {
      if (e.data?.type === "state") live.current.bus = e.data;
    };
    return () => bus.close();
  }, []);

  // feed the engine twice a second: bus if fresh, else the simulator; the desk's controls, this page's own
  // levels; mirror what the panels show (signals, link, meters, sparklines, the bar log)
  useEffect(() => {
    const id = setInterval(() => {
      const b = live.current.bus;
      const fresh = !!b && Date.now() - b.at < BUS_STALE_MS;
      const d = deskRef.current;
      const here = listenRef.current === "manager";
      const params = {
        ...d.headset,
        master: here ? d.headset.master : 0,
        ...(muteRef.current.melody ? { melLevel: 0 } : {}),
        ...(muteRef.current.harmony ? { ncLevel: 0 } : {}),
      };
      let sig: PersonalSignals;
      let source: View["source"];
      if (fresh && b) {
        source = "bus";
        sig = b.sig;
        engine.update(b.myId, b.sig, params, b.yaw, b.epochMs);
      } else {
        source = "sim";
        sig = simSignals(simRef.current);
        engine.update("v_manager", sig, params, 0, 1700000000000);
      }
      live.current.sig = sig;
      const dr = driver.current;
      const plan = dr ? dr.plan : null;
      if (plan && (barsRef.current.length === 0 || barsRef.current[barsRef.current.length - 1].bar !== plan.bar)) {
        barsRef.current = [...barsRef.current.slice(-63), rowOf(plan)];
        setBars(barsRef.current);
      }
      const vals: Record<string, number> = { speed: sig.speed, stay: sig.stay, pathP: sig.pathP, sealed: sig.sealed, grass: sig.grass, rough: roughOf(sig), tension: plan?.tension ?? 0 };
      for (const s of SPARK) {
        const h = (spark.current[s.key] ??= []);
        h.push(vals[s.key]);
        if (h.length > SPARK_LEN) h.shift();
      }
      setSparks({ ...spark.current });
      setView({ sig, source, status: dr ? dr.status : null, plan, link: fresh && b ? { myId: b.myId, ago: Date.now() - b.at } : null, meters: engine.meters() });
    }, 500);
    return () => clearInterval(id);
  }, [engine]); // the simulator and the desk are read through refs: re-creating this interval on every change starved it

  // the editor + driver for the selected patch
  useEffect(() => {
    if (!patch || !container.current) return;
    const dr = new NoiseCraftDriver(
      {
        signals: () => live.current.sig,
        planFor: (bar) => engine.planFor(bar),
        running: () => playingRef.current,
        master: () => (muteRef.current.harmony || listenRef.current !== "manager" ? 0 : deskRef.current.headset.master),
        barSec: () => engine.params.barSec,
        layer: () => (engine.params.instrument === "noisecraft" ? "all" : "harmony"),
        octave: () => engine.params.ncOctave,
        onBar: (bar, wallMs) => engine.setGridAnchor(bar, wallMs),
        overrides: () => overridesRef.current,
      },
      patch,
    );
    driver.current = dr;
    dr.bridge.onStream = (s) => engine.attachNoiseCraft(s); // the patch through the engine's bus here too
    dr.bridge.onNodeClicked = (id) => setPicked(id);
    dr.mount(container.current, patch, true);
    return () => {
      dr.bridge.onStream = undefined;
      dr.bridge.onNodeClicked = undefined;
      engine.attachNoiseCraft(null);
      dr.dispose();
      driver.current = null;
    };
  }, [patch, engine]);

  // who plays: the listening choice claims the solo (output.ts) for that window; this page's engine runs only when
  // it is the one (its PLAY gesture starts the audio); leaving the page releases a solo this page holds
  useEffect(() => {
    if (playing) {
      setSolo(listen === "none" ? null : listen);
      engine.start().catch(() => {}); // the engine is the bus for both tracks, whatever the instrument
    } else {
      if (readSolo() === "manager") setSolo(null);
      engine.stop();
    }
    const release = () => {
      if (readSolo() === "manager") setSolo(null);
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [playing, listen, engine]);

  const { sig, source, status, plan, link, meters } = view;
  const map = mapFor(patch ?? "nc_noise_patch.ncft");
  const knobs = sig ? knobParams(map, { sig, mode: modeOf(sig), plan, master: desk.headset.master, barSec: desk.headset.barSec }) : [];
  const pickedRule = picked ? map.knobs.find((k) => k.nodeId === picked) ?? null : null;
  const pickedInfo = picked ? getNoiseCraftBridge().nodeInfo(picked) : null;
  const pickedHeld = picked != null && picked in overrides;
  const pickedMin = pickedRule?.min ?? pickedInfo?.min ?? 0;
  const pickedMax = pickedRule?.max ?? pickedInfo?.max ?? 1;
  const pickedValue = picked ? (overrides[picked] ?? knobs.find((k) => k.nodeId === picked)?.value ?? pickedInfo?.value ?? pickedMin) : 0;

  return (
    <div className="flex h-screen w-screen flex-col bg-[#020205] text-white" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {patch ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 bg-[#1a1a2e] px-4 py-2 text-xs">
            <button
              onClick={() => {
                setPlaying(false);
                setPatch(null);
                getNoiseCraftBridge().dispose();
              }}
              className="text-[#4ecdc4]"
            >
              ← 패치 목록
            </button>
            <span className="text-white/50">
              편집 중: <strong className="text-white/80">{patch}</strong> · 자동 저장 · <span className="text-white/35">벤치: 여기 값은 이 창에만</span>
            </span>
            <button onClick={() => setPlaying((p) => !p)} className={`rounded border px-3 py-1 ${playing ? "border-red-400/50 text-red-300" : "border-[#4ecdc4]/50 text-[#4ecdc4]"}`}>
              {playing ? "■ STOP" : "▶ PLAY"}
            </button>
            <label className="flex items-center gap-1 text-white/60">
              듣기
              <select value={listen} onChange={(e) => setListen(e.target.value as Listen)} className="rounded border border-white/20 bg-black/40 px-1 py-0.5 text-[11px] text-white/80">
                {LISTEN.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {listen === "manager" && (
              <span className="flex items-center gap-1 text-white/60">
                <button onClick={() => setMute((m) => ({ ...m, melody: !m.melody }))} className={`rounded border px-2 py-0.5 ${mute.melody ? "border-white/20 text-white/30 line-through" : "border-[#4ecdc4]/50 text-[#4ecdc4]"}`}>
                  멜로디
                </button>
                <button onClick={() => setMute((m) => ({ ...m, harmony: !m.harmony }))} className={`rounded border px-2 py-0.5 ${mute.harmony ? "border-white/20 text-white/30 line-through" : "border-[#ff6b9d]/50 text-[#ff6b9d]"}`}>
                  화성
                </button>
              </span>
            )}
            <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-white/40">
              <span className={link ? "text-[#4ecdc4]" : "text-white/30"}>{link ? `● 플레이어 연결됨 (${link.myId})` : "○ 플레이어 창 없음 — 시뮬레이터"}</span>
              <span>
                {status ? `${status.audio} · ${status.clocked ? `클록 ${(status.pulseHz / PULSES_PER_STEP).toFixed(1)} 스텝/s (마디 ${status.pulseHz > 0 ? (PULSES_PER_BAR / status.pulseHz).toFixed(1) : "–"} s)` : "ClockOut 없음 (벽시계 마디)"} · bar ${status.bar} · ${status.mode}` : ""}
              </span>
            </span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div ref={container} className="relative min-h-0 flex-1" />
            <div className="flex w-[460px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#0a0a14] p-3 text-[11px]">
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">트랙 미터</h3>
                <div className="space-y-1 font-mono text-[10px]">
                  {(
                    [
                      ["A 멜로디 (Web Audio)", meters.a, "#4ecdc4"],
                      ["B 화성 (패치 → 엔진 버스)", meters.b, "#ff6b9d"],
                    ] as [string, number, string][]
                  ).map(([label, v, color]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-44 text-white/50">{label}</span>
                      <div className="h-2 flex-1 rounded bg-black/40">
                        <div className="h-2 rounded" style={{ width: `${Math.round(v * 100)}%`, background: color, transition: "width 0.2s" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {listen !== "manager" && <p className="mt-1 text-white/35">이 창은 조정만 합니다 — 소리는 {listen === "none" ? "각 창" : listen === "mobile" ? "플레이어 창" : "스피커 창"}에서.</p>}
              </section>
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">신호 {source === "sim" ? "(시뮬레이터)" : `(플레이어 탭 · ${link ? `${(link.ago / 1000).toFixed(1)} s 전` : ""})`}</h3>
                <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {SPARK.map((s) => (
                    <div key={s.key}>
                      <div className="flex justify-between font-mono text-[9px] text-white/50">
                        <span>{s.key}</span>
                        <span style={{ color: s.color }}>{(sparks[s.key]?.[sparks[s.key].length - 1] ?? 0).toFixed(2)}</span>
                      </div>
                      <Sparkline hist={sparks[s.key] ?? []} max={s.max} color={s.color} />
                    </div>
                  ))}
                </div>
                {source === "sim" ? (
                  <div className="space-y-1">
                    <div className="mb-2 flex flex-wrap gap-1">
                      {SCENARIOS.map((sc) => (
                        <button key={sc.name} onClick={() => setScenario(scenario === sc.name ? null : sc.name)} className={`rounded border px-1.5 py-0.5 text-[10px] ${scenario === sc.name ? "border-[#4ecdc4] text-[#4ecdc4]" : "border-white/15 text-white/50"}`}>
                          {sc.name}
                        </button>
                      ))}
                    </div>
                    {(
                      [
                        ["speed", 0, 8],
                        ["stay", 0, 1],
                        ["pathP", 0, 1],
                        ["sealed", 0, 1],
                        ["grass", 0, 1],
                        ["neighbours", 0, 4],
                      ] as [keyof Sim, number, number][]
                    ).map(([k, lo, hi]) => (
                      <label key={k} className="flex items-center gap-2">
                        <span className="w-20 text-white/60">{k}</span>
                        <input type="range" min={lo} max={hi} step={k === "neighbours" ? 1 : 0.01} value={sim[k]} onChange={(e) => setSim({ ...sim, [k]: +e.target.value })} className="flex-1" />
                        <span className="w-10 text-right font-mono text-[#4ecdc4]">{sim[k].toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                ) : sig ? (
                  <div className="font-mono text-[10px] text-white/50">near {sig.neighbours.length} · building {sig.building ? `${sig.building.id} (${sig.building.dist.toFixed(1)})` : "–"}</div>
                ) : null}
              </section>
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">마디</h3>
                <div className="font-mono text-white/70">
                  {sig ? `mode ${modeOf(sig)}` : ""}
                  {plan ? ` · bar ${plan.bar} · ${plan.harmony ? harmonyLabel(plan.harmony) : `${chordName(plan.chord)} (deg ${plan.chord.degree})`} · stable ${plan.stable.toFixed(2)} rough ${plan.rough.toFixed(2)}` : ""}
                  {plan ? ` · me ${plan.me.length}n · others ${plan.others.length} · bass ${plan.bass.length} · pad ${plan.pad.level.toFixed(2)}${plan.answer ? " · answer" : ""}` : ""}
                </div>
              </section>
              <section>
                <h3 className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[#ff6b9d]">
                  <span>마디 로그 (H · 내 음 · 앵커 · 선)</span>
                  <button
                    onClick={() => {
                      const text = bars.map(rowText).join("\n");
                      navigator.clipboard?.writeText(text).catch(() => {});
                    }}
                    className="rounded border border-white/20 px-1.5 py-0.5 normal-case tracking-normal text-white/60"
                  >
                    복사 ({bars.length}마디)
                  </button>
                </h3>
                <div className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px] text-white/60">
                  {bars.slice(-10).map((r) => (
                    <div key={r.bar} className="border-b border-white/5 py-0.5">
                      <span className="text-white/40">{r.bar}</span> <span className="text-[#4ecdc4]">[{r.me}]</span>
                      {r.anchor ? <span className="text-[#ff6b9d]"> {r.anchor > 0 ? "+" : ""}{r.anchor}</span> : null}
                      {r.line ? <span className="text-white/40"> line [{r.line}]</span> : null}
                      <div className="text-white/35">{r.harmony}</div>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">패치 노드 — 편집기에서 노드를 클릭</h3>
                {picked ? (
                  <div className="space-y-1 font-mono text-[10px]">
                    <div className="text-white/70">
                      #{picked} {pickedInfo ? `${pickedInfo.type} "${pickedInfo.name}"` : ""}
                      {pickedRule ? <span className="text-[#4ecdc4]"> ← 규칙: {pickedRule.label}</span> : <span className="text-white/35"> (매핑 규칙 없음 — 패치의 값 그대로)</span>}
                    </div>
                    {pickedInfo?.type === "Knob" || pickedRule ? (
                      <div className="flex items-center gap-2">
                        <span className={pickedHeld ? "text-[#f59e0b]" : "text-white/50"}>{pickedHeld ? "손으로 고정" : "규칙이 돌림"}</span>
                        <input type="range" min={pickedMin} max={pickedMax} step={(pickedMax - pickedMin) / 200} value={pickedValue} onChange={(e) => setOverride(picked, +e.target.value)} className="flex-1" />
                        <span className="w-14 text-right text-[#4ecdc4]">{pickedValue.toFixed(3)}</span>
                        {pickedHeld && (
                          <button onClick={() => setOverride(picked, null)} className="rounded border border-white/20 px-1.5 py-0.5 text-white/60">
                            해제
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-white/35">노브가 아닙니다.</div>
                    )}
                  </div>
                ) : (
                  <p className="text-white/35">노브를 클릭하면 어떤 규칙이 돌리는지 보이고, 슬라이더로 잡으면 그 값에 고정됩니다 (이 벤치에서만). umwelt의 auto-fill을 고정 기능으로.</p>
                )}
                {Object.keys(overrides).length > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-[#f59e0b]">
                    고정: {Object.entries(overrides).map(([id, v]) => `#${id}=${v.toFixed(2)}`).join(" · ")}{" "}
                    <button
                      onClick={() => {
                        for (const id of Object.keys(overrides)) setOverride(id, null);
                      }}
                      className="rounded border border-white/20 px-1 text-white/50"
                    >
                      모두 해제
                    </button>
                  </div>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">매핑 (코드: lib/sound/noisecraftMap.ts)</h3>
                <table className="w-full font-mono text-[10px]">
                  <tbody>
                    {map.knobs.map((r) => {
                      const v = knobs.find((k) => k.nodeId === r.nodeId)?.value;
                      const held = r.nodeId in overrides;
                      return (
                        <tr key={r.nodeId} onClick={() => setPicked(r.nodeId)} className={`cursor-pointer border-b border-white/5 ${picked === r.nodeId ? "bg-white/5" : ""}`}>
                          <td className="py-0.5 pr-2 text-white/40">{r.nodeId}</td>
                          <td className="py-0.5 pr-2 text-white/70">{r.label}</td>
                          <td className={`py-0.5 text-right ${held ? "text-[#f59e0b]" : "text-[#4ecdc4]"}`}>{held ? `${overrides[r.nodeId].toFixed(3)} 고정` : v != null ? v.toFixed(3) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-white/40">수신 모듈: {map.modules.join(", ")} — 패치의 AI_Seq / AI_Poly 노드 드롭다운에서 고릅니다. hybrid: parliament voice 0 = 베이스, 1–3 = 코드 음; harmony = 4성 보이싱; GateSeq 이름 traces = 리듬 흔적.</p>
              </section>
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">컨트롤 — 플레이어 페이지와 같은 Leva (이 벤치의 엔진에만)</h3>
                <SoundControls onChange={onDeskChange} />
              </section>
            </div>
          </div>
        </>
      ) : (
        <NoiseCraftPatchManager onSelectPatch={setPatch} />
      )}
    </div>
  );
}
