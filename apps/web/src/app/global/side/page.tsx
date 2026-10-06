"use client";

import dynamic from "next/dynamic";

const ParliamentGlobal = dynamic(
  () => import("@/components/parliament/ParliamentTop").then((m) => ({ default: () => <m.default mode="side" /> })),
  { ssr: false, loading: () => <div className="h-screen w-full bg-[#05060a]" /> },
);

export default function SidePage() {
  return (
    <div className="h-screen w-full bg-[#05060a]">
      <ParliamentGlobal />
    </div>
  );
}
