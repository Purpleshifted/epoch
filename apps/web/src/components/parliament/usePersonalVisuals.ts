"use client";
/**
 * usePersonalVisuals — the Leva folder "개인뷰 비주얼" (V2): what the player view adds on top of the ground so the
 * visitor's effect on it lands — switchable, so the artist compares versions (docs/session-logic.md §12).
 *   footprint   the end screen's footprint map (FootprintMap)
 * (stage 4 adds the grass reaction A1–A3 and the stakes B1–B3 here.)
 */

import { useControls } from "leva";
import { savable } from "./levaSave";
import { useParliamentVersion } from "./version";

export interface PersonalVisuals {
  footprint: boolean;
}

const ROOT = "개인뷰 비주얼";

export function usePersonalVisuals(): PersonalVisuals {
  const isV2 = useParliamentVersion() === "v2";
  const c = useControls(
    ROOT,
    savable(ROOT, {
      footprint: { value: true, label: "퇴장 화면 발자국 지도", render: () => isV2 },
    }),
    { collapsed: false, order: 1 },
  );
  return { footprint: c.footprint };
}
