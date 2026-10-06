"use client";

import dynamic from "next/dynamic";

const ParliamentTop = dynamic(() => import("@/components/parliament/ParliamentTop"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#05060a]" />,
});

export default function TopPage() {
  return (
    <div className="h-screen w-full bg-[#05060a]">
      <ParliamentTop />
    </div>
  );
}
