"use client";

import dynamic from "next/dynamic";

const SideView = dynamic(
  () => import("@/components/global/SideView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-black text-white/40 text-xs tracking-widest">
        STRATIGRAPHY LOADING...
      </div>
    ),
  }
);

export default function SidePage() {
  return (
    <div className="h-screen w-full bg-black">
      <SideView />
    </div>
  );
}
