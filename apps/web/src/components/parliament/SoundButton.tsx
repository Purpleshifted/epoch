"use client";
/**
 * SoundButton — the player window's own sound switch (sound wiring; docs/sound-logic.md §13): a visible mute /
 * un-mute next to the Leva switch and the ESC key. With a session it shows only while LIVE, in the top-right corner
 * (the HUD owns the bottom); without one, bottom centre.
 */

import type { SoundSetup } from "./useSound";

export default function SoundButton({ sound, corner = "bottom" }: { sound: SoundSetup; corner?: "bottom" | "top-right" }) {
  const why = sound.status.split(" · ")[1] ?? "";
  const playing = sound.engine.running && !sound.muted;
  const place = corner === "top-right" ? "fixed right-4 top-4" : "fixed bottom-4 left-1/2 -translate-x-1/2";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        sound.toggleMute();
      }}
      className={`${place} z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] select-none backdrop-blur ${playing ? "border-[#4ecdc4]/60 bg-black/40 text-[#4ecdc4]" : "border-white/25 bg-black/50 text-white/60"}`}
      title="이 창의 소리"
    >
      <span className="text-sm">{playing ? "♪" : "♪̸"}</span>
      {playing ? "소리 켜짐 — 끄기" : sound.muted ? "음소거 — 켜기" : why || "클릭하면 시작"}
    </button>
  );
}
