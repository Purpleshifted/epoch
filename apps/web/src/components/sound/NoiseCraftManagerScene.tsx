"use client";
/**
 * NoiseCraftManagerScene — the sound workspace (/v2/sound), umwelt's NoiseCraft Manager brought over
 * (docs/sound-logic.md §8b):
 *   patch list  →  editor: the patch in NoiseCraft's full editor (auto-saved) + the INSPECTOR on the right.
 * What drives the patch here is the same brain as in the player tab: a headless SoundEngine fed by the bus
 * (the player tab's live signals, when a player tab is open in the split view) or by the SIMULATOR sliders.
 * The mapping is code (noisecraftMap.ts); the inspector shows every knob rule with its live value.
 * While this page plays it holds the solo, so the player tab's own instrument stays quiet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { SoundEngine, DEFAULT_SOUND } from "@/lib/sound/engine";
import { getNoiseCraftBridge } from "@/lib/sound/NoiseCraftBridge";
import { NoiseCraftDriver, type DriverStatus } from "@/lib/sound/noisecraftDriver";
import { knobParams, mapFor, modeOf, roughOf } from "@/lib/sound/noisecraftMap";
import { openBus, type BusMessage, type BusState } from "@/lib/sound/bus";
import { readSolo, setSolo } from "@/lib/sound/output";
import { chordName } from "@/lib/sound/harmony";
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
      if (fresh && b) {
        source = "bus";
        sig = b.sig;
        engine.update(b.myId, b.sig, { ...b.params, instrument: "noisecraft" }, b.yaw, b.epochMs);
      } else {
        source = "sim";
        sig = simSignals(sim);
        engine.update("v_manager", sig, { ...DEFAULT_SOUND, instrument: "noisecraft" }, 0, 1700000000000);
      }
      live.current.sig = sig;
      const d = driver.current;
      setView({ sig, source, status: d ? d.status : null, plan: d ? d.plan : null });
    }, 500);
    return () => clearInterval(id);
  }, [engine, sim]);

  // the editor + driver for the selected patch
  useEffect(() => {
    if (!patch || !container.current) return;
    const d = new NoiseCraftDriver(
      {
        signals: () => live.current.sig,
        planFor: (bar) => engine.planFor(bar),
        running: () => playingRef.current,
        master: () => masterRef.current,
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

  // the solo: while this page plays, the player tab's instrument is quiet
  useEffect(() => {
    if (playing) setSolo("manager");
    else if (readSolo() === "manager") setSolo(null);
    return () => {
      if (readSolo() === "manager") setSolo(null);
    };
  }, [playing]);

  const { sig, source, status, plan } = view;
  const map = mapFor(patch ?? "nc_noise_patch.ncft");
  const knobs = sig ? knobParams(map, { sig, mode: modeOf(sig), plan, master }) : [];

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
            <span className="ml-auto font-mono text-[10px] text-white/40">
              {status ? `${status.audio} · ${status.clocked ? `클록 ${(status.pulseHz / 6).toFixed(2)} 스텝/s (마디 ${status.pulseHz > 0 ? (48 / status.pulseHz).toFixed(1) : "–"} s)` : "ClockOut 없음 (벽시계 마디)"} · bar ${status.bar} · ${status.mode}` : ""} · 입력: {source === "bus" ? "플레이어 탭 (bus)" : "시뮬레이터"}
            </span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div ref={container} className="relative min-h-0 flex-1" />
            <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#0a0a14] p-3 text-[11px]">
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[#ff6b9d]">신호 {source === "sim" ? "(시뮬레이터)" : "(플레이어 탭)"}</h3>
                {source === "sim" ? (
                  <div className="space-y-1">
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
                  {plan ? ` · bar ${plan.bar} · ${chordName(plan.chord)} (deg ${plan.chord.degree}) · stable ${plan.stable.toFixed(2)} rough ${plan.rough.toFixed(2)}` : ""}
                  {plan ? ` · me ${plan.me.length}n · others ${plan.others.length} · bass ${plan.bass.length} · pad ${plan.pad.level.toFixed(2)}${plan.answer ? " · answer" : ""}` : ""}
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
                <p className="mt-2 text-white/40">수신 모듈: {map.modules.join(", ")} — 패치의 AI_Seq / AI_Poly 노드 드롭다운에서 고릅니다. voice 0 = 나, 1–3 = 이웃.</p>
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
