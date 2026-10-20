"use client";
/** /v2/sound — the NoiseCraft patch list (client only: it reads the player's patch choice from localStorage). */

import dynamic from "next/dynamic";

const SoundPatchList = dynamic(() => import("@/components/sound/SoundPatchList"), { ssr: false, loading: () => <div className="min-h-screen w-screen bg-[#0b0c10]" /> });

export default function SoundPage() {
  return <SoundPatchList />;
}
