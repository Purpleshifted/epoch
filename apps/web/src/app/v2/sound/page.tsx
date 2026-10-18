"use client";
/**
 * /v2/sound — the NoiseCraft bench (v4 A2; unlisted). The artist's patch with its editor, driven by a staged
 * scenario through the same driver the player uses: what each voice receives, the music clock the patch follows,
 * a log of the bars. Edits made in the editor save into apps/web/noisecraft/examples (this app's folder).
 *
 * KNOB REGISTRATION (v4 A5f, the artist, the umwelt way without streams): the right panel's "노브 등록" box — click
 * the blank row to arm it, then press a Knob node in the editor and its number, name, range and value are written
 * in; note what it should contribute to; "복사" gives the list as text to paste into the sound chat, where the
 * mapping row is written (lib/sound/noisecraftKnobs.ts). Nothing here moves a knob.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { KEY_NAMES, chordName, worldKey } from "@/lib/sound/harmony";
import { makeMotif } from "@/lib/sound/motif";
import { NoiseCraftDriver, type DriverStatus } from "@/lib/sound/noisecraftDriver";
import { KNOB_MAPS } from "@/lib/sound/noisecraftKnobs";
import { loadPatchChoice, savePatchChoice } from "@/lib/sound/patchChoice";
import { PULSES_PER_BAR, PULSES_PER_STEP, modeOfPlan, planToSequences } from "@/lib/sound/noisecraftMap";
import { planBar, type BarPlan } from "@/lib/sound/sequencer";
import type { BuildingSignal, Neighbour, PersonalSignals } from "@/lib/sound/signals";
import { bestKey, keyName, zoneChord, zoneOf } from "@/lib/sound/tonality";


const sig = (over: Partial<PersonalSignals>): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 0, neighbours: [], pathP: 0, sealed: 0, grass: 0.5, ...over });
const bots: Neighbour[] = [
  { o: "bot1", dist: 2, angle: 0.3, bot: true },
  { o: "bot2", dist: 3, angle: 2.1, bot: true },
];
/** A building the two bots and the staged visitor built, at (4, 4), mass 24 → zone radius ≈ 8. */
const house = (dist: number): BuildingSignal => ({ id: "3,3", x: 4, z: 4, dist, radius: 6 + 0.4 * Math.sqrt(24), mass: 24, who: [{ o: "bot1", amount: 12 }, { o: "bot2", amount: 9 }, { o: "v_bench", amount: 3 }] });

/** Where the staged visitor is at bar `bar`. */
const SCENARIOS: Record<string, (bar: number) => PersonalSignals> = {
  "열린 땅, 홀로 머묾": () => sig({ x: 1, z: 1, stay: 1 }),
  "열린 땅, 천천히 걷기": (bar) => sig({ x: (bar * 1.5) % 30, z: 2, speed: 1.5 }),
  "길 위, 걷기 (띠를 건넘)": (bar) => sig({ x: (bar * 4) % 60 - 30, z: 6, speed: 4, pathP: 0.85 }),
  "길 위, 뛰기": (bar) => sig({ x: (bar * 8) % 60 - 30, z: 6, speed: 7.5, pathP: 0.9 }),
  "함께 짓기 (둘과 머묾)": () => sig({ x: 4, z: 4, stay: 1, neighbours: bots, building: house(0) }),
  "접근 → 함께 짓기 → 떠남 (8마디 주기)": (bar) => {
    const k = bar % 8;
    if (k < 3) return sig({ x: 18 - k * 4, z: 4, speed: 3, pathP: 0.5, building: house(14 - k * 4) });
    if (k < 6) return sig({ x: 4, z: 4, stay: 1, neighbours: bots, building: house(0) });
    return sig({ x: 4 + (k - 5) * 5, z: 4, speed: 3, building: house((k - 5) * 5) });
  },
};

/** A knob the artist registered from the editor (bench only; localStorage). */
interface KnobSlot {
  nodeId: string;
  type: string;
  name: string;
  min?: number;
  max?: number;
  value?: number;
  /** What it should contribute to (the artist's words). */
  note: string;
}
const SLOTS_KEY = "anthropocene:sound:knob-slots:v1";
const loadSlots = (): KnobSlot[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SLOTS_KEY);
    return raw ? (JSON.parse(raw) as KnobSlot[]) : [];
  } catch {
    return [];
  }
};
const fmt = (n?: number) => (n == null ? "?" : +n.toFixed(3) + "");
/** The registered knobs as text for the sound chat. */
export const slotsAsText = (slots: readonly KnobSlot[]): string =>
  slots.map((k) => `노브 ${k.nodeId} (${k.name}, ${fmt(k.min)}–${fmt(k.max)}, 지금 ${fmt(k.value)})${k.note ? ` → ${k.note}` : ""}`).join("\n");

interface LogRow {
  bar: number;
  chord: string;
  mode: string;
  place: string;
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
  // the patch (A5l): any .ncft of noisecraft/examples; the choice is shared with the player
  const [patch, setPatch] = useState<string>(loadPatchChoice);
  const [patches, setPatches] = useState<string[]>([]);
  const [fileMsg, setFileMsg] = useState("");
  const patchRef = useRef(patch);
  const driverRef = useRef<NoiseCraftDriver | null>(null);
  const refreshPatches = () =>
    fetch("/noisecraft/list-patches")
      .then((r) => r.json())
      .then((j: { patches?: { filename: string }[] }) => setPatches((j.patches ?? []).map((x) => x.filename).sort()))
      .catch(() => setPatches([]));
  useEffect(() => {
    void refreshPatches();
  }, []);
  const ncft = (name: string) => (name.trim().endsWith(".ncft") ? name.trim() : `${name.trim()}.ncft`);
  /** 저장: the editor's state into the current file, now (auto-save already follows every edit). */
  const savePatch = () => {
    setFileMsg("저장 중…");
    driverRef.current?.bridge.saveProject(patch);
  };
  /** 복제: the current file under a new name, then switch to it. */
  const duplicatePatch = async () => {
    const name = window.prompt("복제할 새 이름 (.ncft)", patch.replace(/\.ncft$/, "") + "_copy");
    if (!name) return;
    const r = await fetch("/noisecraft/duplicate-patch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceFile: patch, newName: ncft(name) }) });
    const j = (await r.json()) as { success?: boolean; filename?: string; error?: string };
    if (!r.ok || !j.filename) return setFileMsg(`복제 실패: ${j.error ?? r.status}`);
    await refreshPatches();
    setPatch(j.filename);
    setFileMsg(`복제됨 → ${j.filename}`);
  };
  /** 이름: rename the current file, then follow it. */
  const renamePatch = async () => {
    const name = window.prompt("새 이름 (.ncft)", patch.replace(/\.ncft$/, ""));
    if (!name || ncft(name) === patch) return;
    const r = await fetch("/noisecraft/rename-patch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oldFilename: patch, newFilename: ncft(name) }) });
    const j = (await r.json()) as { success?: boolean; filename?: string; error?: string };
    if (!r.ok || !j.filename) return setFileMsg(`이름 바꾸기 실패: ${j.error ?? r.status}`);
    await refreshPatches();
    setPatch(j.filename);
    setFileMsg(`이름 바꿈 → ${j.filename}`);
  };
  useEffect(() => {
    savePatchChoice(patch);
    if (patchRef.current !== patch) {
      patchRef.current = patch;
      driverRef.current?.bridge.loadPatch(patch);
      setLog([]);
    }
  }, [patch]);
  // knob registration (A5f)
  const [slots, setSlots] = useState<KnobSlot[]>(loadSlots);
  const [armed, setArmed] = useState<number | null>(null); // the row waiting for a knob (slots.length = the blank row)
  const [flash, setFlash] = useState("");
  const armedRef = useRef<number | null>(null);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
    } catch {
      /* ignore */
    }
  }, [slots]);
  const key = useMemo(() => worldKey("bench"), []);
  const me = useMemo(() => makeMotif("v_bench"), []);
  const others = useMemo(() => new Map([["bot1", makeMotif("bot1")], ["bot2", makeMotif("bot2")]]), []);
  const live = useRef({ scenario, barSec, playing });
  const zoneKey = useRef<ReturnType<typeof bestKey>>(null);
  useEffect(() => {
    live.current = { scenario, barSec, playing };
  }, [scenario, barSec, playing]);

  const placeOf = useRef(new Map<number, string>());
  useEffect(() => {
    if (!host.current) return;
    const plans = new Map<number, BarPlan>();
    const driver = new NoiseCraftDriver({
      planFor: (bar) => {
        const cached = plans.get(bar);
        if (cached) return cached;
        const s = SCENARIOS[live.current.scenario](bar);
        // the building's tonality where the staged visitor stands (as the engine does it)
        const zone = s.building ? zoneOf(s.building.dist, s.building.radius, 4) : null;
        const zk = s.building && zone ? bestKey(s.building.who, zoneKey.current, 0.15) : null;
        zoneKey.current = zk;
        const place = zk && zone ? { key: zk, chord: zoneChord(zk, zone), zone } : null;
        const plan = planBar({ bar, sig: s, key, me, others, closeness: new Map(), phrase: null, place, params: { barSec: live.current.barSec, speedMax: 7, bassFrom: 0.25 } });
        placeOf.current.set(bar, place ? `${keyName(place.key)} · ${place.zone}` : "–");
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
        const row: LogRow = { bar, chord: chordName(key, plan.chord), mode: modeOfPlan(plan), place: placeOf.current.get(bar) ?? "–", v, harm: q.harmony.gates[0][0] ? q.harmony.pitches[0].join(" ") : "–" };
        setLog((l) => [row, ...l].slice(0, 10));
      },
    });
    // a node pressed in the editor while a row is armed: a Knob fills the row (anything else is named and refused)
    driver.bridge.onNodeClicked = (nodeId) => {
      const at = armedRef.current;
      if (at == null) return;
      const info = driver.bridge.nodeInfo(nodeId);
      if (!info) return;
      if (info.type !== "Knob") {
        setFlash(`#${nodeId}는 ${info.type} — 노브(Knob)를 눌러 주세요`);
        return;
      }
      const slot: KnobSlot = { nodeId, type: info.type, name: info.name, min: info.min, max: info.max, value: info.value, note: "" };
      setSlots((prev) => {
        const next = prev.slice();
        if (at < next.length) next[at] = { ...slot, note: next[at].note };
        else next.push(slot);
        return next;
      });
      setArmed(null);
      setFlash(`노브 ${nodeId} (${info.name}) 등록`);
    };
    driver.bridge.onSaveStatus = (st) => setFileMsg(st.status === "saved" ? `${st.manual ? "저장됨" : "자동저장"} ${st.filename.replace(/\.ncft$/, "")}${st.size ? ` (${Math.round(st.size / 1024)} KB)` : ""}` : `저장 실패 ${st.filename}: ${st.error ?? ""}`);
    driverRef.current = driver;
    driver.mount(host.current, patchRef.current, true);
    const id = setInterval(() => setStatus(driver.status), 500);
    return () => {
      clearInterval(id);
      driver.bridge.onNodeClicked = undefined;
      driver.bridge.onSaveStatus = undefined;
      driverRef.current = null;
      driver.dispose();
    };
  }, [key, me, others]);

  const copySlots = async () => {
    const text = slotsAsText(slots);
    try {
      await navigator.clipboard.writeText(text);
      setFlash("복사됨 — 소리 챗에 붙여 넣으세요");
    } catch {
      setFlash("클립보드 불가 — 아래 글상자에서 복사하세요");
    }
  };

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
          패치{" "}
          <select className="bg-black/40 px-1" value={patch} onChange={(e) => setPatch(e.target.value)}>
            {(patches.includes(patch) ? patches : [patch, ...patches]).map((f) => (
              <option key={f} value={f}>
                {f.replace(/\.ncft$/, "")}
              </option>
            ))}
          </select>
        </label>
        <button className="border border-white/30 px-2" title="편집기의 지금 상태를 이 파일에 저장 (자동저장도 켜져 있음)" onClick={savePatch}>
          저장
        </button>
        <button className="border border-white/30 px-2" title="이 패치를 새 이름으로 복제하고 그쪽으로 전환" onClick={() => void duplicatePatch()}>
          복제…
        </button>
        <button className="border border-white/30 px-2" title="이 패치 파일의 이름 바꾸기" onClick={() => void renamePatch()}>
          이름…
        </button>
        {fileMsg && <span className="text-amber-200/80">{fileMsg}</span>}
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
        <div className="flex w-[400px] flex-col border-l border-white/10">
          <div className="max-h-[55%] overflow-auto border-b border-white/10 p-2">
            <div className="mb-1 flex items-center gap-2 text-white/40">
              <span>노브 등록</span>
              <span className="text-white/25">빈 칸을 누르고 → 편집기에서 노브를 누르면 번호가 적힘</span>
              <button className="ml-auto border border-white/30 px-2 text-white/70" onClick={copySlots} disabled={!slots.length}>
                복사
              </button>
            </div>
            {slots.map((k, i) => {
              const mapped = KNOB_MAPS.find((m) => m.nodeId === k.nodeId);
              return (
                <div key={`${k.nodeId}-${i}`} className="mb-1 flex items-center gap-1 whitespace-nowrap">
                  <button
                    className={`border px-1 ${armed === i ? "border-amber-300 text-amber-200" : "border-white/20 text-white/80"}`}
                    title="누르면 이 칸이 다음 노브를 기다림"
                    onClick={() => setArmed(armed === i ? null : i)}
                  >
                    #{k.nodeId}
                  </button>
                  <span className="text-white/60">
                    {k.name} · {fmt(k.min)}–{fmt(k.max)} · 지금 {fmt(k.value)}
                  </span>
                  {mapped && <span className="text-emerald-300/80">← {mapped.source}</span>}
                  <input
                    className="min-w-0 flex-1 bg-black/40 px-1 text-white/80"
                    placeholder="→ 어디에 기여할지"
                    value={k.note}
                    onChange={(e) => setSlots((prev) => prev.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                  />
                  <button className="text-white/40" title="지우기" onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              );
            })}
            <button
              className={`w-full border border-dashed px-1 py-1 text-left ${armed === slots.length ? "border-amber-300 text-amber-200" : "border-white/20 text-white/40"}`}
              onClick={() => setArmed(armed === slots.length ? null : slots.length)}
            >
              {armed === slots.length ? "편집기에서 노브를 누르세요…" : "+ 빈 칸"}
            </button>
            {flash && <div className="mt-1 text-amber-200/80">{flash}</div>}
            {slots.length > 0 && <textarea readOnly className="mt-1 h-16 w-full bg-black/40 p-1 text-white/60" value={slotsAsText(slots)} />}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-1 text-white/40">마디 · 코드 · 상황 · 건물 조성 · parliament v0 v1 v2 v3 (게이트) · harmony</div>
          {log.map((r) => (
            <div key={r.bar} className="whitespace-nowrap">
              {r.bar} · {r.chord} · {r.mode} · {r.place} · {r.v} · {r.harm}
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
