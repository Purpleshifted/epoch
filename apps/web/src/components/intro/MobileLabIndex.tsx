"use client";

import Link from "next/link";
import { EntryGroup } from "./EntryGroup";
import { LAB_ASSETS, LAB_INFO } from "@/components/parliament/mobileLab";

/**
 * THE MOBILE VIEW LAB'S BUTTONS (the artist, 2026-11-23): the personal view's four assets, each on a page of its own
 * with its Leva group and the references beside it — scan (future), scan (present), bot (present), bot (future) —
 * and the action preview that runs the whole personal view on what was saved there, like a rehearsal. Saved values go
 * to the database, so every machine and the personal view itself read the same set (components/parliament/mobileLab.ts).
 */
export default function MobileLabIndex() {
  const href = (page: string) => `/lab/mobile/${page}`;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center text-white">
      <h1 className="vintage-serif text-3xl font-bold leading-tight tracking-wide sm:text-4xl">Mobile view lab</h1>
      <div className="flex w-[300px] flex-col gap-8">
        <EntryGroup
          title="ASSETS"
          note="one page each · its own Leva"
          entries={LAB_ASSETS.map((a) => ({ href: href(a), name: LAB_INFO[a].name, sub: LAB_INFO[a].sub }))}
        />
        <EntryGroup
          title="RUN"
          note="no detail Leva"
          entries={[{ href: href("preview"), name: LAB_INFO.preview.name, sub: LAB_INFO.preview.sub, main: true }]}
        />
      </div>
      <Link href="/" className="font-mono text-[10px] tracking-wider text-white/40 hover:text-white/70">
        ← home
      </Link>
    </div>
  );
}
