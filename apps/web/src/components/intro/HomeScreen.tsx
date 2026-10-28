"use client";

import Link from "next/link";

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

interface Entry {
  href: string;
  name: string;
  sub: string;
  main?: boolean;
}

/** A group of entries under a small heading. */
function Group({ title, note, entries, dim }: { title: string; note: string; entries: Entry[]; dim?: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="text-left">
        <span className={`font-mono text-[11px] tracking-[0.25em] ${dim ? "text-white/35" : "text-white/70"}`}>{title}</span>
        <span className="ml-3 font-mono text-[10px] tracking-wider text-white/30">{note}</span>
      </div>
      {entries.map((e) => (
        <Link
          key={e.href}
          href={e.href}
          className={`${btn} ${
            dim ? "border-white/25 py-3 text-xs text-white/60 hover:border-white/50" : e.main ? "border-white text-white hover:border-white/80" : "border-white/50 text-white/80 hover:border-white"
          }`}
        >
          {e.name}
          <span className="block pt-1 font-mono text-[10px] tracking-wider text-white/40">{e.sub}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Entry page (the artist, 2026-10-18): EXHIBITION = the V2 global and personal views without any panel (?ui=0),
 * TEST = the same with Leva plus the sound bench, OLD = V1 and the version before the parliament build.
 * "Global" is the 3D timespace (the artist, 2026-10-19); top and side views are reached from the TEST subtitle.
 */
export default function HomeScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center text-white">
      <h1 className="vintage-serif text-4xl font-bold leading-tight tracking-wide sm:text-5xl md:text-6xl">Stratum of the Anthropocene</h1>
      <div className="flex w-[300px] flex-col gap-8">
        <Group
          title="EXHIBITION"
          note="no panel"
          entries={[
            { href: "/v2/global/space?ui=0", name: "Global", sub: "3D timespace · the strata", main: true },
            { href: "/v2/mobile?ui=0", name: "Personal", sub: "player · a life in the parliament", main: true },
          ]}
        />
        <Group
          title="TEST"
          note="with Leva"
          entries={[
            { href: "/v2/global/space", name: "Global", sub: "3D timespace · top ↗ /v2/global/top · side ↗ /v2/global/side" },
            { href: "/v2/global/lab", name: "Lab", sub: "3D timespace · a world of its own, paused, for tuning the strata" },
            { href: "/v2/mobile", name: "Personal", sub: "player · worker by default during the sound tests" },
            { href: "/v2/sound", name: "Sound", sub: "NoiseCraft bench · patches · knob registration" },
          ]}
        />
        <div className="border-t border-white/10 pt-6">
          <Group
            title="OLD"
            note="kept as they were"
            dim
            entries={[
              { href: "/v1", name: "V1", sub: "parliament of things · 2026-10-10" },
              { href: "/legacy", name: "Legacy", sub: "before the parliament build" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
