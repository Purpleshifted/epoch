"use client";

import { useState } from "react";
import { exportSettings, importSettings } from "@/components/parliament/levaSave";

/**
 * /rehearsal/management: the saved Leva settings of this browser as one JSON — copied out on the machine where they
 * were tuned (the Vercel preview in Chrome), pasted in on the exhibition machine, and handed to the sessions for the
 * bundled exhibition preset (src/presets/exhibition.json). The artist, 2026-10-30.
 */
export default function SettingsTransfer() {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const doExport = () => {
    const json = exportSettings();
    setText(json);
    const groups = Object.keys(JSON.parse(json) as object).length;
    navigator.clipboard
      ?.writeText(json)
      .then(() => setNote(`${groups}개 그룹 — 클립보드에 복사됨 (아래에도 있음)`))
      .catch(() => setNote(`${groups}개 그룹 — 아래 글을 전부 선택해 복사`));
  };
  const doImport = () => {
    try {
      const n = importSettings(text);
      setNote(n ? `${n}개 그룹 저장됨 — 벽·개인 화면을 새로고침하면 적용` : "저장할 그룹이 없음 (parliament.leva:… 키가 있어야 함)");
    } catch {
      setNote("JSON이 아님 — 내보내기로 복사한 글 그대로 붙여 넣기");
    }
  };
  return (
    <div className="flex flex-col items-center gap-3 text-left">
      <div className="text-center">
        <div className="font-mono text-[11px] tracking-[0.3em] text-white/50">SETTINGS</div>
        <div className="mt-1 font-mono text-[10px] text-white/30">Leva 저장값을 통째로 옮기기 (맞춘 기기 → 전시 기기)</div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={doExport} className="rounded border border-white/20 px-3 py-1 font-mono text-[11px] text-white/80 hover:border-white/50">
          내보내기 (JSON 복사)
        </button>
        <button type="button" onClick={doImport} className="rounded border border-white/20 px-3 py-1 font-mono text-[11px] text-white/80 hover:border-white/50">
          가져오기 (아래 붙여넣은 JSON 저장)
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder='내보내기를 누르면 여기 나타남 · 다른 기기에서 복사한 JSON을 여기 붙여 넣고 가져오기'
        className="h-40 w-full resize-y rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-4 text-white/70 outline-none focus:border-white/40"
      />
      {note && <div className="font-mono text-[10px] text-white/60">{note}</div>}
    </div>
  );
}
