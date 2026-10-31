"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

// V2 global views get the room's speakers (sound only; the views are untouched — docs/sound-logic.md §10b). A client
// layout: next/dynamic with ssr: false is only allowed in client components.
const GlobalSound = dynamic(() => import("@/components/parliament/GlobalSound"), { ssr: false });

export default function GlobalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <GlobalSound />
    </>
  );
}
