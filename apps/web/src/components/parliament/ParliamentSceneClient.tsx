"use client";

import dynamic from "next/dynamic";

const ParliamentScene = dynamic(() => import("./ParliamentScene"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[#02030a] flex items-center justify-center">
      <span className="text-white/30 text-xs font-mono tracking-widest">initializing...</span>
    </div>
  ),
});

export default function ParliamentSceneClient() {
  return <ParliamentScene />;
}
