"use client";

import Link from "next/link";
import { EntryGroup } from "./EntryGroup";
import SettingsTransfer from "./SettingsTransfer";

/**
 * /rehearsal/management (the artist, 2026-10-29): the tools around the work, kept off the home page — added here like
 * plug-ins as they come (the database for the shared world is the next one).
 */
export default function ManagementScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center text-white">
      <h1 className="vintage-serif text-3xl font-bold leading-tight tracking-wide sm:text-4xl">Management</h1>
      <div className="flex w-[300px] flex-col gap-8">
        <EntryGroup
          title="TOOLS"
          note="around the work"
          entries={[
            { href: "/v2/sound", name: "Sound", sub: "NoiseCraft bench · patches · knob registration" },
            { href: "/v2/global/lab", name: "Lab", sub: "3D timespace · a world of its own, paused, for tuning the strata" },
          ]}
        />
        <EntryGroup
          title="VIEWS"
          note="other angles of the wall"
          entries={[
            { href: "/v2/global/top", name: "Top", sub: "the ground from above" },
            { href: "/v2/global/side", name: "Side", sub: "the strata in section" },
          ]}
        />
        <div className="border-t border-white/10 pt-6">
          <SettingsTransfer />
        </div>
        <div className="border-t border-white/10 pt-6">
          <EntryGroup
            title="OLD"
            note="kept as they were"
            dim
            entries={[
              { href: "/v1", name: "V1", sub: "parliament of things · 2026-10-10" },
              { href: "/legacy", name: "Legacy", sub: "before the parliament build" },
            ]}
          />
        </div>
        <Link href="/" className="font-mono text-[10px] tracking-wider text-white/40 hover:text-white/70">
          ← home
        </Link>
      </div>
    </div>
  );
}
