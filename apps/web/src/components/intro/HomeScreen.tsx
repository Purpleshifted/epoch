"use client";

import Link from "next/link";

/** Entry page: the current build (in progress) and the frozen legacy version. */
export default function HomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-12 text-white text-center">
      <h1 className="text-4xl font-bold leading-tight sm:text-5xl md:text-6xl vintage-serif tracking-wide">
        Stratum of the Anthropocene
      </h1>
      <div className="flex flex-col gap-4 w-[280px]">
        <button
          disabled
          className="rounded-lg border border-white/20 bg-transparent px-6 py-4 text-sm font-normal text-white/30 vintage-serif w-full cursor-not-allowed"
        >
          Parliament of Things
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/25">in progress</span>
        </button>
        <Link
          href="/legacy"
          className="rounded-lg border border-white bg-transparent px-6 py-4 text-sm font-normal text-white transition-all duration-300 hover:border-white/80 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
        >
          Legacy
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">before the parliament build</span>
        </Link>
      </div>
    </div>
  );
}
