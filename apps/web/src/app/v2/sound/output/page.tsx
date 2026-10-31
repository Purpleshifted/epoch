"use client";
/** /v2/sound/output — choose the headset's and the speakers' audio outputs (client only: devices and localStorage). */

import dynamic from "next/dynamic";

const SoundOutputs = dynamic(() => import("@/components/sound/SoundOutputs"), { ssr: false, loading: () => <div className="min-h-screen w-screen bg-[#0b0c10]" /> });

export default function SoundOutputPage() {
  return <SoundOutputs />;
}
