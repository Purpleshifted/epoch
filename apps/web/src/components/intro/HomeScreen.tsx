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
        <Link
          href="/mobile"
          className="rounded-lg border border-white bg-transparent px-6 py-4 text-sm font-normal text-white transition-all duration-300 hover:border-white/80 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
        >
          Parliament of Things
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">player · worker first</span>
        </Link>
        <Link
          href="/global/top"
          className="rounded-lg border border-white/50 bg-transparent px-6 py-3 text-xs font-normal text-white/80 transition-all duration-300 hover:border-white hover:bg-white/10 active:scale-[0.98] vintage-serif w-full"
        >
          Top view (future)
        </Link>
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
