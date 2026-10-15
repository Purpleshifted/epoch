"use client";
/**
 * SoundButton — the player window's own sound switch (sound wiring; docs/sound-logic.md §8): the artist asked for
 * a visible button next to the Leva switch and the ESC key. It is also the first gesture that unlocks the audio.
 */

import type { SoundSetup } from "./useSound";

export default function SoundButton({ sound }: { sound: SoundSetup }) {
  const why = sound.status.split(" · ")[1] ?? "";
  const playing = sound.engine.running && !sound.muted;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        sound.toggleMute();
      }}
      className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] select-none backdrop-blur ${playing ? "border-[#4ecdc4]/60 bg-black/40 text-[#4ecdc4]" : "border-white/25 bg-black/50 text-white/60"}`}
      title="이 창의 소리 (ESC와 같음)"
    >
      <span className="text-sm">{playing ? "♪" : "♪̸"}</span>
      {playing ? "소리 켜짐 — 끄기" : sound.muted ? "음소거 — 켜기" : why || "클릭하면 시작"}
    </button>
  );
}
