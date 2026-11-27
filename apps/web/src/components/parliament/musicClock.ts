/**
 * musicClock — WHERE THE MUSIC IS, FOR WHAT IS DRAWN (the artist, 2026-11-27: "비주얼 효과를 멜로디랑 좀 리듬감을 같이
 * 가져가도록"). The sound's own bar (lib/sound/engine.ts musicStep: 8 steps a bar, the bar's length pulled by what the
 * visitor does) when it runs — read from the engine the page already holds (useSound.ts) — else the screen's fixed bar
 * (glyph.ts: 8 steps, 2 s). What beats on the screen (the pictograms' heads, the tracking boxes) asks here, so it lands
 * on the notes that are heard.
 */

import { stepAt, STEP_MS } from "@/lib/parliament";

export interface MusicNow {
  /** The step of the bar, 0 … 7, and how far into it, 0 … 1. */
  step: number;
  into: number;
  /** From the sound itself (false: the screen's own bar, no sound running). */
  synced: boolean;
}

/**
 * HOW HIGH A VOICE'S HEAD IS IN ITS HOP NOW (the artist, 2026-11-27: "나한테 말 거는 애 머리 통통 튀게 + 거기 맞춰서 블롭
 * 창도 같이 커졌다 작아졌다"): 0 … 1 on each note that voice SINGS as heard — the asker's call, whom I answer, an
 * ensemble's part (lib/sound/engine.ts hopOf, sound-logic §13d–e); 0 between its notes and for anyone not singing to
 * me. null when no sound runs: the picture keeps its own bar then (rhythmOf on musicNow).
 */
export function voiceHop(id: string): number | null {
  if (typeof window === "undefined" || !id) return null;
  const e = (window as unknown as { __soundEngine?: { hopOf?: (id: string) => number | null } | null }).__soundEngine;
  return e?.hopOf ? e.hopOf(id) : null;
}

/** Where the bar is now (cheap: read every frame). */
export function musicNow(): MusicNow {
  if (typeof window !== "undefined") {
    const m = (window as unknown as { __soundEngine?: { musicStep: { step: number; into: number } | null } | null }).__soundEngine?.musicStep;
    if (m) return { step: m.step, into: m.into, synced: true };
  }
  const ms = typeof performance !== "undefined" ? performance.now() : 0;
  return { step: stepAt(ms), into: (ms % STEP_MS) / STEP_MS, synced: false };
}
