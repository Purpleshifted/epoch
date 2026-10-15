"use client";

import dynamic from "next/dynamic";

// the sound workspace: NoiseCraft patches, the editor, the inspector (umwelt's NoiseCraft Manager brought over)
const NoiseCraftManagerScene = dynamic(() => import("@/components/sound/NoiseCraftManagerScene"), { ssr: false });

export default function SoundPage() {
  return <NoiseCraftManagerScene />;
}
