"use client";

import { EntryGroup } from "./EntryGroup";

/**
 * Entry page (the artist, 2026-10-29): buttons only. EXHIBITION = the wall and the visitor's screen with no panel (the
 * wall opens in a window of its own, for the second display); REHEARSAL = the same two with Leva, and MANAGEMENT for
 * the tools around the work (the sound bench, the lab, the database later). Exhibition and rehearsal land on the same
 * pages, so the Leva values saved while rehearsing are the ones the exhibition loads. "Global" is the 3D timespace.
 */
export default function HomeScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center text-white">
      <h1 className="vintage-serif text-4xl font-bold leading-tight tracking-wide sm:text-5xl md:text-6xl">Stratum of the Anthropocene</h1>
      <div className="flex w-[300px] flex-col gap-8">
        <EntryGroup
          title="EXHIBITION"
          note="no panel"
          entries={[
            { href: "/exhibition/global", name: "Global", sub: "the wall · opens in its own window", main: true, window: true },
            { href: "/exhibition/personal", name: "Personal", sub: "the visitor's screen", main: true },
          ]}
        />
        <EntryGroup
          title="REHEARSAL"
          note="with Leva"
          entries={[
            { href: "/rehearsal/global", name: "Global", sub: "the wall, for tuning" },
            { href: "/rehearsal/personal", name: "Personal", sub: "the visitor's screen, for tuning" },
            { href: "/rehearsal/management", name: "Management", sub: "sound bench · lab · other views" },
          ]}
        />
      </div>
    </div>
  );
}
