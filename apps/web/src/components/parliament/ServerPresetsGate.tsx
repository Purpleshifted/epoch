"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { pullPresets, showNote } from "./levaSave";
import { MOBILE_LAB_PAGE } from "./mobileLab";

/** The page whose saved Leva values this path reads (the lab tunes the shared view's — see /v2/global/lab). */
function levaPageOf(pathname: string): string {
  if (pathname !== "/v2/global/lab") return pathname;
  // (the lab under another set of values, ?values=<name>: that set's own page — it was saved to the server under it
  // and never read back from there)
  const set = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("values");
  return set && /^[a-z0-9-]{1,24}$/.test(set) ? `/v2/global/lab-${set}` : "/v2/global/space";
}

/** The personal view and the mobile view lab also read the lab's asset groups (mobileLab.ts — stored under their own page). */
const readsMobileLab = (pathname: string) => pathname === "/v2/mobile" || pathname.startsWith("/v2/lab/mobile");

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
  useEffect(() => {
    let alive = true;
    const page = levaPageOf(pathname ?? "/");
    const onLate = (changed: string[]) => {
      if (!alive || !changed.length) return;
      const unattended = new URLSearchParams(window.location.search).get("ui") === "0";
      if (!unattended) showNote("서버의 새 값이 늦게 도착함 · 새로고침하면 적용", true);
      else if (page === "/v2/global/space") window.location.reload();
    };
    const pulls = [pullPresets(page, onLate)];
    if (readsMobileLab(pathname ?? "/")) pulls.push(pullPresets(MOBILE_LAB_PAGE, onLate));
    void Promise.all(pulls).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);
  if (!ready) return null;
  return <>{children}</>;
}
