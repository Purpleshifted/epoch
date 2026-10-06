"use client";

import dynamic from "next/dynamic";

const SideView = dynamic(() => import("@/components/side/SideView"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#05060a]" />,
});

export default function LegacySidePage() {
  return (
    <div className="h-screen w-full bg-[#05060a]">
      <SideView />
    </div>
  );
}
