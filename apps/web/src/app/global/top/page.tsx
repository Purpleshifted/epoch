"use client";

import dynamic from "next/dynamic";

const TopView = dynamic(
  () => import("@/components/global/TopView"),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-full bg-black flex items-center justify-center text-white/20 text-sm tracking-widest">
        Loading galaxy map…
      </div>
    ),
  }
);

export default function TopPage() {
  return (
    <div className="h-screen w-full bg-black">
      <TopView />
    </div>
  );
}
