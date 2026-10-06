"use client";

import dynamic from "next/dynamic";

const ParliamentGlobal = dynamic(
  () => import("@/components/parliament/ParliamentTop").then((m) => ({ default: () => <m.default mode="top" /> })),
  { ssr: false, loading: () => <div className="h-screen w-full bg-[#05060a]" /> },
);

export default function TopPage() {
  return (
    <div className="h-screen w-full bg-[#05060a]">
      <ParliamentGlobal />
    </div>
  );
}
