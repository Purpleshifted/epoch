"use client";

import dynamic from "next/dynamic";

const TimespaceView = dynamic(
  () => import("@/components/timespace/TimespaceView"),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-full bg-black flex items-center justify-center text-white/20 text-sm tracking-widest">
        Loading timespace…
      </div>
    ),
  }
);

export default function TimespacePage() {
  return (
    <div className="h-screen w-full bg-black">
      <TimespaceView />
    </div>
  );
}
