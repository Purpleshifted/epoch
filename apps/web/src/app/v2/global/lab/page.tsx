"use client";

/**
 * /v2/global/lab (/rehearsal/lab) — the VISUAL LAB: the wall's own component on the wall's world TAKEN ONCE when the
 * lab opens (useLabWorld.ts: no bots here, nothing built after; this tab only, the shared world is never written),
 * its own clock (standing still at first), and the same Leva as the shared global view — saved values are shared with
 * /v2/global/space, so what is tuned here is what the exhibition view loads.
 */
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { setLevaPage } from "@/components/parliament/levaSave";

const ParliamentSpace = dynamic(() => import("@/components/parliament/ParliamentSpace"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#0a0b0d]" />,
});

export default function LabPage() {
  // the lab tunes the shared global view's settings: its Leva reads and saves under that page's key
  // (?values=<name>: ANOTHER SET of saved values, kept apart under its own key — to look at the wall under values
  // brought from elsewhere, e.g. the exhibition's, without touching the shared ones. The artist, 2026-11-20: "전시장에서
  // 지금 쓰고 있는 값들 그대로 옮겨오면 어떻게 보이는지 랩화면에서 확인해봐")
  const set = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("values");
  const page = set && /^[a-z0-9-]{1,24}$/.test(set) ? `/v2/global/lab-${set}` : "/v2/global/space";
  setLevaPage(page);
  // (…and only while the lab is open: the override is the page's, and a page reached from here without a reload —
  // the home screen's links — would have read and saved its own folders under the wall's key)
  useEffect(() => {
    setLevaPage(page);
    return () => setLevaPage(null);
  }, [page]);
  return (
    <div className="h-screen w-full bg-[#0a0b0d]">
      <ParliamentSpace lab />
    </div>
  );
}
