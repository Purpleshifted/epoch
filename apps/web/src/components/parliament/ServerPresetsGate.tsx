"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WALL_PAGE, pullPresets, showNote } from "./levaSave";
import { serverWorldName, startServerWorld, stopServerWorld } from "@/lib/parliament/serverWorld";

/** The page whose saved Leva values this path reads (the lab tunes the shared view's — see /v2/global/lab). */
function levaPageOf(pathname: string): string {
  return pathname === "/v2/global/lab" ? "/v2/global/space" : pathname;
}

/**
 * Holds a page back until the server's newest Leva saves are in this browser (at most 4 s, nothing when offline),
 * because Leva reads its saved values synchronously at mount. Wrapped around every /v2 page by the v2 layout, so the
 * exhibition wall and the audience page start from the latest rehearsal save.
 *
 * A slower server's answer is kept for the next load, and in this tab: the unattended wall (ui=0) reloads once, since
 * nobody would, and a page nobody is holding loses nothing — otherwise it would run on old values, or on the code's
 * defaults (bots off), until someone restarts it. It cannot loop: the reload finds those saves already here. The audience
 * page (ui=0) does not reload, it may be mid-session; a rehearsal page says so in a note, it may hold unsaved sliders.
 */
export default function ServerPresetsGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => () => stopServerWorld(), []); // leaving /v2: the rest of the site is not in the shared world
  useEffect(() => {
    let alive = true;
    const page = levaPageOf(pathname ?? "/");
    const presets = pullPresets(page, (changed) => {
      if (!alive || !changed.length) return;
      const unattended = new URLSearchParams(window.location.search).get("ui") === "0";
      if (!unattended) showNote("서버의 새 값이 늦게 도착함 · 새로고침하면 적용", true);
      else if (page === "/v2/global/space") window.location.reload();
    });
    // the audience's page in the shared world goes by the wall's building rule (lib/parliament/wallRule.ts)
    const wallRule = page === "/v2/mobile" && serverWorldName() ? pullPresets(WALL_PAGE) : null;
    // the shared world's epoch and clock too (at most 2.5 s, nothing when it is off): the page mounts in the right world
    Promise.allSettled([presets, wallRule, startServerWorld()]).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);
  if (!ready) return null;
  return <>{children}</>;
}
