"use client";
/**
 * RecordingQr — after a life, once its recording is up (useLifeRecording `url`), a QR of `/rec/<id>` in the corner of
 * the end screen, so a phone can take the life's sound away. A stand-in until the specimen card carries the QR itself
 * (that card is another session's; this sits beside it, not in its markup). Taps go through (pointer-events none).
 */

import { useMemo } from "react";
import { qrModules, qrSvgPath } from "@/lib/qr";
import { useLifeRecordingState } from "./useLifeRecording";

export function RecordingQr({ show }: { show: boolean }) {
  const rec = useLifeRecordingState();
  const url = show ? rec.url : undefined;
  const path = useMemo(() => {
    if (!url) return null;
    const m = qrModules(url, "M");
    return m ? qrSvgPath(m, 4) : null;
  }, [url]);
  if (!url || !path) return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-20 select-none font-mono text-[11px] text-white/70">
      <svg viewBox={`0 0 ${path.n} ${path.n}`} className="block h-[132px] w-[132px] bg-white" shapeRendering="crispEdges" aria-label={url}>
        <path d={path.d} fill="#000" />
      </svg>
      <div className="mt-1 w-[132px] text-center">이 삶의 소리</div>
    </div>
  );
}
