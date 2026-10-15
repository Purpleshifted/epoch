"use client";
/**
 * /v2/sound — the NoiseCraft bench (v4 A2; unlisted). The artist's patch with its editor, driven by a staged
 * scenario through the same driver the player uses: what each voice receives, the music clock the patch follows,
 * a log of the bars. Edits made in the editor save into apps/web/noisecraft/examples (this app's folder).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { KEY_NAMES, chordName, worldKey } from "@/lib/sound/harmony";
import { makeMotif } from "@/lib/sound/motif";
import { NoiseCraftDriver, type DriverStatus } from "@/lib/sound/noisecraftDriver";
import { PULSES_PER_BAR, PULSES_PER_STEP, modeOfPlan, planToSequences } from "@/lib/sound/noisecraftMap";
import { planBar, type BarPlan } from "@/lib/sound/sequencer";
import type { Neighbour, PersonalSignals } from "@/lib/sound/signals";

const PATCH = "nc_noise_patch.ncft";

const sig = (over: Partial<PersonalSignals>): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, grass: 0.5, ...over });
const bots: Neighbour[] = [
  { o: "bot1", dist: 2, angle: 0.3, bot: true },
  { o: "bot2", dist: 3, angle: 2.1, bot: true },
];

/** Where the staged visitor is at bar `bar`. */
const SCENARIOS: Record<string, (bar: number) => PersonalSignals> = {
  "열린 땅, 홀로 머묾": () => sig({ x: 1, z: 1, stay: 1 }),
  "열린 땅, 천천히 걷기": (bar) => sig({ x: (bar * 1.5) % 30, z: 2, speed: 1.5 }),
  "길 위, 걷기 (띠를 건넘)": (bar) => sig({ x: (bar * 4) % 60 - 30, z: 6, speed: 4, pathP: 0.85 }),
  "길 위, 뛰기": (bar) => sig({ x: (bar * 8) % 60 - 30, z: 6, speed: 7.5, pathP: 0.9 }),
  "함께 짓기 (둘과 머묾)": () => sig({ x: 4, z: 4, stay: 1, neighbours: bots }),
  "접근 → 함께 짓기 → 떠남 (8마디 주기)": (bar) => {
    const k = bar % 8;
    if (k < 3) return sig({ x: 12 - k * 3, z: 4, speed: 3, pathP: 0.5 });
    if (k < 6) return sig({ x: 4, z: 4, stay: 1, neighbours: bots });
    return sig({ x: 4 + (k - 5) * 4, z: 4, speed: 3 });
  },
};

interface LogRow {
  bar: number;
  chord: string;
  mode: string;
  v: string;
  harm: string;
}

export default function SoundBench() {
  const host = useRef<HTMLDivElement>(null);
  const [scenario, setScenario] = useState<keyof typeof SCENARIOS>("접근 → 함께 짓기 → 떠남 (8마디 주기)");
  const [barSec, setBarSec] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const key = useMemo(() => worldKey("bench"), []);
  const me = useMemo(() => makeMotif("v_bench"), []);
  const others = useMemo(() => new Map([["bot1", makeMotif("bot1")], ["bot2", makeMotif("bot2")]]), []);
  const live = useRef({ scenario, barSec, playing });
  useEffect(() => {
    live.current = { scenario, barSec, playing };
  }, [scenario, barSec, playing]);

  useEffect(() => {
    if (!host.current) return;
    const plans = new Map<number, BarPlan>();
    const driver = new NoiseCraftDriver({
      planFor: (bar) => {
        const cached = plans.get(bar);
        if (cached) return cached;
        const s = SCENARIOS[live.current.scenario](bar);
        const plan = planBar({ bar, sig: s, key, me, others, closeness: new Map(), phrase: null, params: { barSec: live.current.barSec, speedMax: 7, bassFrom: 0.25 } });
        plans.set(bar, plan);
        for (const k of plans.keys()) if (k < bar - 4) plans.delete(k);
        return plan;
      },
      running: () => live.current.playing,
      barSec: () => live.current.barSec,
      onBar: (bar) => {
        const plan = plans.get(bar);
        if (!plan) return;
        const q = planToSequences(plan, plans.get(bar - 1) ?? null);
        const v = q.parliament.pitches[0].map((p, i) => `${p}${q.parliament.gates[0][i] ? `(${q.parliament.gates[0][i]})` : ""}`).join(" ");
        const row: LogRow = { bar, chord: chordName(key, plan.chord), mode: modeOfPlan(plan), v, harm: q.harmony.gates[0][0] ? q.harmony.pitches[0].join(" ") : "–" };
        setLog((l) => [row, ...l].slice(0, 10));
      },
    });
    driver.mount(host.current, PATCH, true);
    const id = setInterval(() => setStatus(driver.status), 500);
    return () => {
      clearInterval(id);
      driver.dispose();
    };
  }, [key, me, others]);

  const clock = status?.clocked ? `${(status.pulseHz / PULSES_PER_STEP).toFixed(1)} steps/s · bar ${status.pulseHz > 0 ? (PULSES_PER_BAR / status.pulseHz).toFixed(2) : "–"} s` : "no ClockOut";
  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0c10] font-mono text-[11px] text-white/80">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-3 py-2">
        <span className="text-white/40">NoiseCraft 벤치 (A2)</span>
        <span>{KEY_NAMES[key.root]} {key.mode.name}</span>
        <label>
          상황{" "}
          <select className="bg-black/40 px-1" value={scenario} onChange={(e) => setScenario(e.target.value as keyof typeof SCENARIOS)}>
            {Object.keys(SCENARIOS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          마디 {barSec.toFixed(1)} s <input type="range" min={1} max={4} step={0.1} value={barSec} onChange={(e) => setBarSec(Number(e.target.value))} />
        </label>
        <button className="border border-white/30 px-2" onClick={() => setPlaying((p) => !p)}>
          {playing ? "정지" : "재생"}
        </button>
        <span className="text-white/50">
          {status ? `${status.audio} · ${clock} · 보낸 마디 ${status.barSecSent.toFixed(2)} s · bar ${status.bar} · ${status.mode}` : "…"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={host} className="min-w-0 flex-1" />
        <div className="w-[380px] overflow-auto border-l border-white/10 p-2">
          <div className="mb-1 text-white/40">마디 · 코드 · 상황 · parliament v0 v1 v2 v3 (게이트) · harmony</div>
          {log.map((r) => (
            <div key={r.bar} className="whitespace-nowrap">
              {r.bar} · {r.chord} · {r.mode} · {r.v} · {r.harm}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
