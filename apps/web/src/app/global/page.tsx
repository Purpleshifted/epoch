"use client";

import dynamic from "next/dynamic";

const GlobalPerspectiveView = dynamic(
  () => import("@/components/global/GlobalPerspectiveView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white/70">
        3D 뷰 로딩 중...
      </div>
    ),
  }
);

export default function GlobalPage() {
  return (
    <div className="h-screen w-full bg-slate-950 text-white">
      <GlobalPerspectiveView showHud={false} showModeToggle />
    </div>
  );
}
