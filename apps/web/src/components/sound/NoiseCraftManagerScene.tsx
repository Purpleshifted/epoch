"use client";
/**
 * NoiseCraftManagerScene — the sound workspace (/v2/sound), umwelt's NoiseCraft Manager brought over
 * (docs/sound-logic.md §8b):
 *   patch list  →  editor: the patch in NoiseCraft's full editor (auto-saved) + the INSPECTOR on the right.
 * What drives the patch here is the same brain as in the player tab: a headless SoundEngine fed by the bus
 * (the player tab's live signals, when a player tab is open in the split view) or by the SIMULATOR sliders.
 * The mapping is code (noisecraftMap.ts); the inspector shows every knob rule with its live value.
 * While this page plays it holds the solo, so the player tab's own instrument stays quiet.
 *
 * For working on the music without walking: SCENARIOS (timelines of simulated signals — a path walked and left,
 * a building approached and entered, two people staying and building …), LAYER MUTES (melody / harmony), and the
 * BAR LOG (the last bars: harmony state, my notes, the anchor, the line) with a copy button, to paste into a chat.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { SoundEngine, DEFAULT_SOUND } from "@/lib/sound/engine";
import { getNoiseCraftBridge } from "@/lib/sound/NoiseCraftBridge";
import { NoiseCraftDriver, type DriverStatus } from "@/lib/sound/noisecraftDriver";
import { harmonyLabel } from "@/lib/sound/harmonyState";
import { PULSES_PER_BAR, PULSES_PER_STEP, knobParams, mapFor, modeOf, roughOf } from "@/lib/sound/noisecraftMap";
import { openBus, type BusMessage, type BusState } from "@/lib/sound/bus";
import { readSolo, setSolo } from "@/lib/sound/output";
import { KEY_NAMES, chordName } from "@/lib/sound/harmony";
import type { BarPlan } from "@/lib/sound/sequencer";
import type { PersonalSignals } from "@/lib/sound/signals";
import NoiseCraftPatchManager from "./NoiseCraftPatchManager";

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
}

const BUS_STALE_MS = 3000;

export default function NoiseCraftManagerScene() {
  const [patch, setPatch] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [master, setMaster] = useState(0.6);
  const [sim, setSim] = useState<Sim>(SIM0);
  const simRef = useRef(sim);
  const [scenario, setScenario] = useState<string | null>(null);
  const scenarioStart = useRef(0);
  const [mute, setMute] = useState({ melody: false, harmony: false });
  const muteRef = useRef(mute);
  const [bars, setBars] = useState<BarRow[]>([]);
  const barsRef = useRef<BarRow[]>([]);
  const [view, setView] = useState<View>({ sig: null, source: "sim", status: null, plan: null });
  const container = useRef<HTMLDivElement>(null);
  const engine = useMemo(() => new SoundEngine(), []); // headless: never started, only plans
  const live = useRef<{ bus: BusState | null; sig: PersonalSignals | null }>({ bus: null, sig: null });
  const driver = useRef<NoiseCraftDriver | null>(null);
  const playingRef = useRef(false);
  const masterRef = useRef(0.6);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    masterRef.current = master;
  }, [master]);
  useEffect(() => {
    muteRef.current = mute;
  }, [mute]);
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

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

  // the bus: the player tab's state, when one is talking
  useEffect(() => {
    const bus = openBus();
    if (!bus) return;
    bus.onmessage = (e: MessageEvent<BusMessage>) => {
      if (e.data?.type === "state") live.current.bus = e.data;
    };
    return () => bus.close();
  }, []);

  // feed the headless engine twice a second: bus if fresh, else the simulator; mirror what the panels show
  useEffect(() => {
    const id = setInterval(() => {
      const b = live.current.bus;
      const fresh = !!b && Date.now() - b.at < BUS_STALE_MS;
      let sig: PersonalSignals;
      let source: View["source"];
      const melody = muteRef.current.melody ? 0 : masterRef.current;
      if (fresh && b) {
        source = "bus";
        sig = b.sig;
        engine.update(b.myId, b.sig, { ...b.params, master: melody }, b.yaw, b.epochMs);
      } else {
        source = "sim";
        sig = simSignals(simRef.current);
        engine.update("v_manager", sig, { ...DEFAULT_SOUND, master: melody }, 0, 1700000000000);
      }
      live.current.sig = sig;
      const d = driver.current;
      const plan = d ? d.plan : null;
      if (plan && (barsRef.current.length === 0 || barsRef.current[barsRef.current.length - 1].bar !== plan.bar)) {
        barsRef.current = [...barsRef.current.slice(-63), rowOf(plan)];
        setBars(barsRef.current);
      }
      setView({ sig, source, status: d ? d.status : null, plan });
    }, 500);
    return () => clearInterval(id);
  }, [engine]); // the simulator is read through a ref: re-creating this interval on every slider move starved it

  // the editor + driver for the selected patch
  useEffect(() => {
    if (!patch || !container.current) return;
    const d = new NoiseCraftDriver(
      {
        signals: () => live.current.sig,
        planFor: (bar) => engine.planFor(bar),
        running: () => playingRef.current,
        master: () => (muteRef.current.harmony ? 0 : masterRef.current),
        barSec: () => engine.params.barSec,
        layer: () => (engine.params.instrument === "noisecraft" ? "all" : "harmony"),
        onBar: (bar, wallMs) => engine.setGridAnchor(bar, wallMs),
      },
      patch,
    );
    driver.current = d;
    d.mount(container.current, patch, true);
    return () => {
      d.dispose();
      driver.current = null;
    };
  }, [patch, engine]);

  // the solo: while this page plays, the player tab's instrument is quiet; in the hybrid this page's own engine
  // plays the melody (Web Audio, started from the PLAY gesture) while the patch plays the harmony
  useEffect(() => {
    if (playing) {
      setSolo("manager");
      if (engine.params.instrument !== "noisecraft") engine.start().catch(() => {});
    } else {
      if (readSolo() === "manager") setSolo(null);
      engine.stop();
    }
    // leaving the page (tab closed, a navigation) must release the solo too — React's cleanup does not run on a
    // full navigation, and a solo left behind mutes the player tab's instrument silently
    const release = () => {
      if (readSolo() === "manager") setSolo(null);
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [playing, engine]);

  const { sig, source, status, plan } = view;
  const map = mapFor(patch ?? "nc_noise_patch.ncft");
  const knobs = sig ? knobParams(map, { sig, mode: modeOf(sig), plan, master, barSec: engine.params.barSec }) : [];

  return (
    <div className="flex h-screen w-screen flex-col bg-[#020205] text-white" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {patch ? (
        <>
          <div className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-[#1a1a2e] px-4 py-2 text-xs">
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
              편집 중: <strong className="text-white/80">{patch}</strong> · 자동 저장
            </span>
            <button onClick={() => setPlaying((p) => !p)} className={`rounded border px-3 py-1 ${playing ? "border-red-400/50 text-red-300" : "border-[#4ecdc4]/50 text-[#4ecdc4]"}`}>
              {playing ? "■ STOP" : "▶ PLAY (이 창이 솔로)"}
            </button>
            <label className="flex items-center gap-2 text-white/60">
              음량 <input type="range" min={0} max={1} step={0.01} value={master} onChange={(e) => setMaster(+e.target.value)} />
            </label>
            <span className="flex items-center gap-1 text-white/60">
              듣기:
              <button onClick={() => setMute((m) => ({ ...m, melody: !m.melody }))} className={`rounded border px-2 py-0.5 ${mute.melody ? "border-white/20 text-white/30 line-through" : "border-[#4ecdc4]/50 text-[#4ecdc4]"}`}>
                멜로디 (Web Audio)
              </button>
              <button onClick={() => setMute((m) => ({ ...m, harmony: !m.harmony }))} className={`rounded border px-2 py-0.5 ${mute.harmony ? "border-white/20 text-white/30 line-through" : "border-[#ff6b9d]/50 text-[#ff6b9d]"}`}>
                화성 (패치)
              </button>
            </span>
            <span className="ml-auto font-mono text-[10px] text-white/40">
              {status ? `${status.audio} · ${status.clocked ? `클록 ${(status.pulseHz / PULSES_PER_STEP).toFixed(1)} 스텝/s (마디 ${status.pulseHz > 0 ? (PULSES_PER_BAR / status.pulseHz).toFixed(1) : "–"} s)` : "ClockOut 없음 (벽시계 마디)"} · bar ${status.bar} · ${status.mode}` : ""} · 입력: {source === "bus" ? "플레이어 탭 (bus)" : "시뮬레이터"}
            </span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div ref={container} className="relative min-h-0 flex-1" />
            <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#0a0a14] p-3 text-[11px]">
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">신호 {source === "sim" ? "(시뮬레이터)" : "(플레이어 탭)"}</h3>
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
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-white/70">
                    {(
                      [
                        ["speed", sig.speed],
                        ["stay", sig.stay],
                        ["pathP", sig.pathP],
                        ["sealed", sig.sealed],
                        ["grass", sig.grass],
                        ["near", sig.neighbours.length],
                        ["rough", roughOf(sig)],
                      ] as [string, number][]
                    ).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-white/40">{k}</span>
                        <span className="text-[#4ecdc4]">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
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
                      const text = barsRef.current.map(rowText).join("\n");
                      navigator.clipboard?.writeText(text).catch(() => {});
                    }}
                    className="rounded border border-white/20 px-1.5 py-0.5 normal-case tracking-normal text-white/60"
                  >
                    복사 ({bars.length}마디)
                  </button>
                </h3>
                <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[10px] text-white/60">
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
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">매핑 (코드: lib/sound/noisecraftMap.ts)</h3>
                <table className="w-full font-mono text-[10px]">
                  <tbody>
                    {map.knobs.map((r) => {
                      const v = knobs.find((k) => k.nodeId === r.nodeId)?.value;
                      return (
                        <tr key={r.nodeId} className="border-b border-white/5">
                          <td className="py-0.5 pr-2 text-white/40">{r.nodeId}</td>
                          <td className="py-0.5 pr-2 text-white/70">{r.label}</td>
                          <td className="py-0.5 text-right text-[#4ecdc4]">{v != null ? v.toFixed(3) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-white/40">수신 모듈: {map.modules.join(", ")} — 패치의 AI_Seq / AI_Poly 노드 드롭다운에서 고릅니다. hybrid: parliament voice 0 = 베이스, 1–3 = 코드 음; harmony = 4성 보이싱; GateSeq 이름 traces = 리듬 흔적.</p>
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
