"use client";

import Link from "next/link";

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

/** Entry page: the parliament versions (V2 in progress, V1 kept for showing) and the frozen legacy version. */
export default function HomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-12 text-white text-center">
      <h1 className="text-4xl font-bold leading-tight sm:text-5xl md:text-6xl vintage-serif tracking-wide">
        Stratum of the Anthropocene
      </h1>
      <div className="flex flex-col gap-4 w-[280px]">
        <Link href="/v2" className={`${btn} border-white text-white hover:border-white/80`}>
          V2
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">parliament of things · in progress</span>
        </Link>
        <Link href="/v1" className={`${btn} border-white/50 text-white/80 hover:border-white`}>
          V1
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">parliament of things · 2026-10-10</span>
        </Link>
        <div className="border-t border-white/10 pt-4">
          <Link href="/legacy" className={`${btn} block border-white/25 py-3 text-xs text-white/60 hover:border-white/50`}>
            Legacy
            <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/35">before the parliament build</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
