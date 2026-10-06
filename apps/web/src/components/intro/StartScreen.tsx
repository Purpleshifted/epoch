"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameContext } from "@/context/GameContext";
import type { Mode } from "@/types/game";

const StartScreen = () => {
  const router = useRouter();
  const { setMode, setDisplayName } = useGameContext();
  const [name, setName] = useState("");

  const handleEnter = (mode: Mode) => {
    setMode(mode);
    setDisplayName(name.trim());
    router.push(mode === "personal" ? "/mobile" : "/global");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-12 text-white text-center">
      <div className="space-y-6">
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl md:text-6xl vintage-serif tracking-wide">
          Stratum of the Anthropocene
        </h1>
      </div>

      <div className="flex flex-col gap-4 w-[280px]">
        <button
          className="rounded-lg border border-white bg-transparent px-6 py-4 text-sm font-normal text-white transition-all duration-300 hover:border-white/80 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
          onClick={() => handleEnter("personal")}
        >
          1st Person View (Mobile)
        </button>
        
        <button
          className="rounded-lg border border-white/50 bg-transparent px-6 py-4 text-sm font-normal text-white/80 transition-all duration-300 hover:border-white hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
          onClick={() => {
            setMode("global");
            router.push("/global/top");
          }}
        >
          Top View (Projector)
        </button>

        <button
          className="rounded-lg border border-white/50 bg-transparent px-6 py-4 text-sm font-normal text-white/80 transition-all duration-300 hover:border-white hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
          onClick={() => {
            setMode("global");
            router.push("/global/side");
          }}
        >
          Side View (Projector)
        </button>

        <div className="border-t border-white/10 pt-4">
          <button
            className="rounded-lg border border-white/25 bg-transparent px-6 py-3 text-xs font-normal text-white/50 transition-all duration-300 hover:border-white/50 hover:bg-white/5 hover:text-white/70 active:scale-[0.98] font-mono w-full tracking-wider"
            onClick={() => router.push("/timespace")}
          >
            ⬡ Spacetime Block (Live)
          </button>
          <button
            className="mt-3 rounded-lg border border-white/25 bg-transparent px-6 py-3 text-xs font-normal text-white/50 transition-all duration-300 hover:border-white/50 hover:bg-white/5 hover:text-white/70 active:scale-[0.98] font-mono w-full tracking-wider"
            onClick={() => router.push("/sprites")}
          >
            ▦ Sprite Lab (Live)
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartScreen;
