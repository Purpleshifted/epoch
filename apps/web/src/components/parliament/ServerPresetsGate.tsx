"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { pullPresets } from "./levaSave";
import { startServerWorld, stopServerWorld } from "@/lib/parliament/serverWorld";

/** The page whose saved Leva values this path reads (the lab tunes the shared view's — see /v2/global/lab). */
function levaPageOf(pathname: string): string {
  return pathname === "/v2/global/lab" ? "/v2/global/space" : pathname;
}

/**
 * Holds a page back until the server's newest Leva saves are in this browser (at most ~1.2 s, nothing when there is
 * no server), because Leva reads its saved values synchronously at mount. Wrapped around every /v2 page by the v2
 * layout, so the exhibition wall and the audience page start from the latest rehearsal save.
 */
export default function ServerPresetsGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => () => stopServerWorld(), []); // leaving /v2: the rest of the site is not in the shared world
  useEffect(() => {
    let alive = true;
    // the shared world's epoch and clock too (at most 2.5 s, nothing when it is off): the page mounts in the right world
    Promise.allSettled([pullPresets(levaPageOf(pathname ?? "/")), startServerWorld()]).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);
  if (!ready) return null;
  return <>{children}</>;
}
