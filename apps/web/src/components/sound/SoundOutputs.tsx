"use client";
/**
 * SoundOutputs (/v2/sound/output) — the REHEARSAL page for where the sound goes (docs/sound-logic.md §10c): the
 * personal view's headset and the global views' speakers, each to its own audio output (lib/sound/output.ts). The
 * choice is stored per origin, so it is made on the address the show runs on; open tabs follow it at once.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROLE_LABEL, canChooseOutput, listOutputs, loadOutput, resolveOutput, saveOutput, unlockLabels, type OutputRole } from "@/lib/sound/output";

const ROLES: OutputRole[] = ["headset", "speakers"];

/** A short tone on one device, to tell the outputs apart (only when the artist presses 시험음). */
async function testTone(deviceId: string, freq: number): Promise<void> {
  const ctx = new AudioContext() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  try {
    if (ctx.setSinkId) await ctx.setSinkId(deviceId);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    g.gain.setTargetAtTime(0, ctx.currentTime + 0.6, 0.1);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 1.2);
    await new Promise((r) => setTimeout(r, 1300));
  } finally {
    await ctx.close().catch(() => {});
  }
}

export default function SoundOutputs() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [chosen, setChosen] = useState<Record<OutputRole, string>>({ headset: "", speakers: "" });
  const [msg, setMsg] = useState("");
  const supported = canChooseOutput();

  const refresh = async () => {
    const outs = await listOutputs();
    setDevices(outs);
    const next = { headset: "", speakers: "" } as Record<OutputRole, string>;
    for (const r of ROLES) next[r] = await resolveOutput(loadOutput(r));
    setChosen(next);
  };
  useEffect(() => {
    // the first listing once mounted, then whenever a device is plugged in or out
    const h = () => void refresh();
    const first = setTimeout(h, 0);
    navigator.mediaDevices?.addEventListener?.("devicechange", h);
    return () => {
      clearTimeout(first);
      navigator.mediaDevices?.removeEventListener?.("devicechange", h);
    };
  }, []);

  const named = devices.filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
  const hidden = devices.length > 0 && devices.every((d) => !d.label);

  const choose = (role: OutputRole, id: string) => {
    const d = devices.find((x) => x.deviceId === id);
    saveOutput(role, id ? { id, label: d?.label ?? "" } : null);
    setChosen((c) => ({ ...c, [role]: id }));
    setMsg(`${ROLE_LABEL[role]} → ${id ? d?.label || "선택한 장치" : "시스템 기본 출력"} (열려 있는 화면도 바로 따라감)`);
  };

  return (
    <div className="min-h-screen w-screen bg-[#0b0c10] px-6 py-6 font-mono text-[12px] text-white/80">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Link href="/v2/sound" className="text-white/40 hover:text-white/80">
          ← 패치 목록
        </Link>
        <span className="text-white">소리 출력 장치 (리허설)</span>
        {msg && <span className="text-amber-200/80">{msg}</span>}
      </div>
      {!supported && <div className="mb-4 text-red-300/80">이 브라우저는 출력 장치를 고를 수 없습니다 (Chrome 110 이상 필요) — 둘 다 시스템 기본 출력으로 나갑니다.</div>}
      <ol className="mb-5 list-decimal space-y-1 pl-5 text-white/55">
        <li>전시에 쓸 주소(예: 아이맥의 http://localhost:3000)에서 이 페이지를 엽니다 — 선택은 주소마다 따로 저장됩니다.</li>
        <li>장치 이름이 안 보이면 아래 버튼으로 마이크 권한을 한 번 허용합니다(녹음하지 않고 바로 끔; 한 번이면 이 주소에 남음).</li>
        <li>헤드셋과 스피커를 각각 고르고 시험음으로 확인합니다. 퍼스널·글로벌 화면이 열려 있어도 바로 바뀝니다.</li>
      </ol>
      <button className="mb-5 border border-white/30 px-3 py-1" onClick={() => void unlockLabels().then((ok) => (setMsg(ok ? "장치 이름을 불러왔습니다" : "권한이 거부됨 — 브라우저 주소창의 권한에서 마이크를 허용하세요"), refresh()))}>
        장치 이름 보이기 (마이크 권한 한 번){hidden ? " ← 지금 이름이 숨겨져 있음" : ""}
      </button>
      <div className="flex flex-col gap-4">
        {ROLES.map((role, i) => (
          <div key={role} className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <span className="w-[180px] text-white">{ROLE_LABEL[role]}</span>
            <select className="min-w-[320px] bg-black/40 px-1 py-0.5" value={chosen[role]} disabled={!supported} onChange={(e) => choose(role, e.target.value)}>
              <option value="">시스템 기본 출력</option>
              {named.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `(이름 숨김) ${d.deviceId.slice(0, 8)}…`}
                </option>
              ))}
            </select>
            <button className="border border-white/20 px-2 py-0.5 text-white/60" onClick={() => void testTone(chosen[role], i === 0 ? 660 : 220)}>
              시험음
            </button>
          </div>
        ))}
      </div>
      <div className="mt-6 text-white/35">
        두 소리 모두 리미터(−3 dB)를 거쳐 나가므로 같은 장치로 합쳐져도 깨지지 않습니다. 헤드셋과 스피커를 나누려면 아이맥에 출력이 둘 있어야 합니다(내장 스피커/이어폰 단자 + USB 오디오 또는 블루투스 등).
      </div>
    </div>
  );
}
