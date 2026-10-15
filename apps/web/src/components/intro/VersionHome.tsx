"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { openBus, type BusMessage } from "@/lib/sound/bus";

/** sound wiring: whether a player tab is talking on the sound bus right now (the workspace links to it live). */
function useSoundLink(): { myId: string } | null {
  const [link, setLink] = useState<{ myId: string } | null>(null);
  useEffect(() => {
    const bus = openBus();
    if (!bus) return;
    let lastAt = 0;
    let lastId = "";
    bus.onmessage = (e: MessageEvent<BusMessage>) => {
      if (e.data?.type === "state") {
        lastAt = e.data.at;
        lastId = e.data.myId;
      }
    };
    const id = setInterval(() => setLink(Date.now() - lastAt < 3000 ? { myId: lastId } : null), 1000);
    return () => {
      bus.close();
      clearInterval(id);
    };
  }, []);
  return link;
}

const btn =
  "rounded-lg border bg-transparent px-6 py-4 text-sm font-normal transition-all duration-300 hover:bg-white/10 active:scale-[0.98] vintage-serif w-full";

/** The views of one parliament version (/v1, /v2). */
export default function VersionHome({ base, title, note }: { base: string; title: string; note: string }) {
  const link = useSoundLink();
  const views = [
    { href: "/mobile", name: "Player", sub: "parliament of things · pick a role", main: true },
    { href: "/global/top", name: "Top View", sub: "the future" },
    { href: "/global/side", name: "Side View", sub: "the architecture" },
    { href: "/global/space", name: "3D Timespace", sub: "seeds → boxes · y = time" },
    // sound wiring (V2): the workspace — every sound control, the patch editor, linked live to the player tab
    ...(base === "/v2" ? [{ href: "/sound", name: "Sound Workspace", sub: link ? `소리 작업실 · ● 플레이어 ${link.myId} 연결됨` : "소리 작업실 · 플레이어 창을 열면 실시간 연동", sound: true }] : []),
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
              className={`${btn} ${v.main ? "border-white text-white hover:border-white/80" : "sound" in v ? "border-[#4ecdc4]/40 text-[#4ecdc4]/90 hover:border-[#4ecdc4]" : "border-white/50 text-white/80 hover:border-white"}`}
            >
              {v.name}
              <span className={`block pt-1 font-mono text-[10px] tracking-wider ${"sound" in v && link ? "text-[#4ecdc4]/70" : "text-white/40"}`}>{v.sub}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
