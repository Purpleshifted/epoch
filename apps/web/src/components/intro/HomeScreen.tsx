"use client";

import Link from "next/link";

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

/** Entry page: the current build (in progress) and the frozen legacy version. */
export default function HomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-12 text-white text-center">
      <h1 className="text-4xl font-bold leading-tight sm:text-5xl md:text-6xl vintage-serif tracking-wide">
        Stratum of the Anthropocene
      </h1>
      <div className="flex flex-col gap-4 w-[280px]">
        <Link href="/mobile" className={`${btn} border-white text-white hover:border-white/80`}>
          Player
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">parliament of things · pick a role</span>
        </Link>
        <Link href="/global/top" className={`${btn} border-white/50 text-white/80 hover:border-white`}>
          Top View
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">the future</span>
        </Link>
        <Link href="/global/side" className={`${btn} border-white/50 text-white/80 hover:border-white`}>
          Side View
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">the architecture</span>
        </Link>
        <Link href="/global/space" className={`${btn} border-white/50 text-white/80 hover:border-white`}>
          3D Timespace
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">seeds → boxes · y = time</span>
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
