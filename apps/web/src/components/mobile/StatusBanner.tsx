"use client";

import type { GameState } from "@/types/game";

const StatusBanner = ({ state }: { state: GameState }) => {
  if (!state.ui.statusMessage) {
    return null;
  }
  return (
    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/60 px-6 py-2 text-xs text-white/80">
      {state.ui.statusMessage}
    </div>
  );
};

export default StatusBanner;
