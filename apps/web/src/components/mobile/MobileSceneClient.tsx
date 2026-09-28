"use client";

import dynamic from "next/dynamic";

const MobileScene = dynamic(
  () => import("./MobileScene"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-[#02030a] flex items-center justify-center">
        <span className="text-white/30 text-xs font-mono tracking-widest">initializing...</span>
      </div>
    ),
  }
);

export default function MobileSceneClient() {
  return <MobileScene />;
}
