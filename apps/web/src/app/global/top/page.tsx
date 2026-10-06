"use client";

import dynamic from "next/dynamic";

const TopView = dynamic(() => import("@/components/top/TopView"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#05060a]" />,
});

export default function TopPage() {
  return (
    <div className="h-screen w-full bg-[#05060a]">
      <TopView />
    </div>
  );
}
