"use client";

import Link from "next/link";

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

export interface Entry {
  href: string;
  name: string;
  sub: string;
  main?: boolean;
  /** Open in a window of its own (not a tab), e.g. the wall that is dragged onto the second display. */
  window?: boolean;
}

/** Opens `href` in a new browser window (a popup has no tab strip, so it can be dragged to a display and made full screen). */
function openWindow(href: string) {
  window.open(href, `anthropocene${href.replace(/\W+/g, "-")}`, "popup=yes,width=1280,height=800");
}

/** A group of entries under a small heading. */
export function EntryGroup({ title, note, entries, dim }: { title: string; note: string; entries: Entry[]; dim?: boolean }) {
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
          onClick={
            e.window
              ? (ev) => {
                  ev.preventDefault();
                  openWindow(e.href);
                }
              : undefined
          }
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
