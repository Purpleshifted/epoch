"use client";

/**
 * /v2/global/lab — the WORK ROOM: the 3D timespace with a world of its own (in this tab only, never the shared one),
 * a test column ready on opening, its own clock (paused at first), and the same Leva as the shared global view —
 * saved values are shared with /v2/global/space, so what is tuned here is what the exhibition view loads.
 */
import dynamic from "next/dynamic";
import { setLevaPage } from "@/components/parliament/levaSave";

const ParliamentSpace = dynamic(() => import("@/components/parliament/ParliamentSpace"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#0a0b0d]" />,
});

export default function LabPage() {
  // the lab tunes the shared global view's settings: its Leva reads and saves under that page's key
  setLevaPage("/v2/global/space");
  return (
    <div className="h-screen w-full bg-[#0a0b0d]">
      <ParliamentSpace lab />
    </div>
  );
}
