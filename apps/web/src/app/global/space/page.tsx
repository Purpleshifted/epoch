"use client";

import dynamic from "next/dynamic";

const ParliamentSpace = dynamic(() => import("@/components/parliament/ParliamentSpace"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#e9ebee]" />,
});

export default function SpacePage() {
  return (
    <div className="h-screen w-full bg-[#e9ebee]">
      <ParliamentSpace />
    </div>
  );
}
