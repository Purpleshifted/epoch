"use client";

import dynamic from "next/dynamic";

const ParliamentScene = dynamic(() => import("@/components/parliament/ParliamentScene"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#02030a]" />,
});

export default function MobilePage() {
  return (
    <div className="fixed inset-0 bg-[#02030a]">
      <ParliamentScene />
    </div>
  );
}
