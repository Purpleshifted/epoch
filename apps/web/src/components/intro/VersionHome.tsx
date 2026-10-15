"use client";

import Link from "next/link";

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

/** The views of one parliament version (/v1, /v2). */
export default function VersionHome({ base, title, note }: { base: string; title: string; note: string }) {
  const views = [
    { href: "/mobile", name: "Player", sub: "parliament of things · pick a role", main: true },
    { href: "/global/top", name: "Top View", sub: "the future" },
    { href: "/global/side", name: "Side View", sub: "the architecture" },
    { href: "/global/space", name: "3D Timespace", sub: "seeds → boxes · y = time" },
  ];
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0a] px-12 py-32 text-white sm:px-24 lg:px-48">
      <Link href="/" className="absolute left-6 top-6 font-mono text-[11px] tracking-wider text-white/30 hover:text-white/70">
        ← home
      </Link>
      <div className="flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-12 text-center">
        <div>
          <h1 className="vintage-serif text-4xl font-bold leading-tight tracking-wide sm:text-5xl">{title}</h1>
          <p className="pt-3 font-mono text-[11px] tracking-wider text-white/40">{note}</p>
        </div>
        <div className="flex w-[280px] flex-col gap-4">
          {views.map((v) => (
            <Link
              key={v.href}
              href={base + v.href}
              className={`${btn} ${v.main ? "border-white text-white hover:border-white/80" : "border-white/50 text-white/80 hover:border-white"}`}
            >
              {v.name}
              <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">{v.sub}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
