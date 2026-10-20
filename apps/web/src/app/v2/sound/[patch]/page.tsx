"use client";
/** /v2/sound/<patch> — the bench for one patch (client only: the editor, localStorage and the audio need the window). */

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const SoundBench = dynamic(() => import("@/components/sound/SoundBench"), { ssr: false, loading: () => <div className="h-screen w-screen bg-[#0b0c10]" /> });

export default function SoundPatchPage() {
  const params = useParams<{ patch: string }>();
  const name = decodeURIComponent(params?.patch ?? "");
  if (!name) return null;
  return <SoundBench patch={name.endsWith(".ncft") ? name : `${name}.ncft`} />;
}
