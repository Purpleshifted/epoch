"use client";
/**
 * FootprintMap — the end screen's small top-down picture of one life (lib/parliament/footprint.ts): the cells my
 * stress pressed, the cells I trod, the ones that are paths now, the concrete with my weight in it, and the trail,
 * north up, greys only (a human trace), pixel-sharp. Drawn once: the ledger is frozen at the end.
 */

import { useEffect, useRef } from "react";
import { footprintLayout, type Ledger } from "@/lib/parliament";

const SHADE: Record<string, (a: number) => string> = {
  press: (a) => `rgba(255,255,255,${(0.1 + 0.25 * a).toFixed(3)})`,
  tread: () => "rgba(255,255,255,0.3)",
  path: (a) => `rgba(255,255,255,${(0.45 + 0.3 * a).toFixed(3)})`,
  slab: () => "rgb(187,187,187)",
};

export function FootprintMap({ ledger, size = 160 }: { ledger: Ledger; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.clearRect(0, 0, size, size);
    const f = footprintLayout(ledger, size);
    if (!f) return;
    for (const cell of f.cells) {
      g.fillStyle = SHADE[cell.kind](cell.a);
      g.fillRect(cell.x, cell.y, Math.max(1, cell.w), Math.max(1, cell.w));
      if (cell.kind === "slab") {
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 1;
        g.strokeRect(cell.x + 0.5, cell.y + 0.5, Math.max(1, cell.w) - 1, Math.max(1, cell.w) - 1);
      }
    }
    if (f.trail.length > 1) {
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 1;
      g.beginPath();
      f.trail.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    if (f.end) {
      g.fillStyle = "rgb(255,255,255)";
      g.fillRect(Math.round(f.end[0]) - 1, Math.round(f.end[1]) - 1, 3, 3);
    }
  }, [ledger, size]);
  return <canvas ref={ref} width={size} height={size} className="border border-white/15 bg-black" style={{ imageRendering: "pixelated" }} />;
}
