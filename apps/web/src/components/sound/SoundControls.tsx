"use client";
/**
 * SoundControls — the sound Leva folders inline in the bench (/v2/sound): the same folders the player page shows
 * (useSoundLeva), plus the speakers' for the record, rendered in place (Leva `fill flat`). They drive the bench's
 * own engine only; the work's values are the defaults in code and the player page's own Leva.
 */

import { useEffect } from "react";
import { Leva } from "leva";
import { useSoundLeva } from "@/components/parliament/useSoundLeva";
import type { DeskState } from "@/lib/sound/desk";

export default function SoundControls({ onChange }: { onChange(desk: DeskState): void }) {
  const { desk } = useSoundLeva({ headset: true, speakers: true, solo: false });
  useEffect(() => {
    onChange(desk);
  }, [desk, onChange]);
  return (
    <div className="flex flex-col gap-2">
      <Leva fill flat titleBar={false} hideCopyButton theme={{ sizes: { controlWidth: "120px", rowHeight: "22px" }, fontSizes: { root: "10px" } }} />
    </div>
  );
}
