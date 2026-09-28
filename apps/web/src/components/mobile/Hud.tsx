"use client";

import type { GameState } from "@/types/game";

const Hud = ({ state }: { state: GameState }) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-6 text-sm uppercase tracking-wide text-white/80">
      <div className="flex flex-col">
        <span className="text-white/60">Mode</span>
        <strong className="text-white">{state.mode}</strong>
      </div>
      <div className="flex flex-col text-right">
        <span className="text-white/60">Display Name</span>
        <strong className="text-white">{state.ui.displayName || "-"}</strong>
      </div>
    </div>
  );
};

export default Hud;
