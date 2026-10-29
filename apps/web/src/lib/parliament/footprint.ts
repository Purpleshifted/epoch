/**
 * parliament/footprint.ts — the FOOTPRINT MAP of one life (the end screen): the ledger's cells and the trail laid out
 * as a small top-down picture, north up, fitted to a square of `px` pixels. The first time the visitor sees their own
 * trace from above — in greys only (a human trace), the way the wall draws it.
 *
 *   press  cells my stress pressed (alpha = how much of their grass went)
 *   tread  cells I trod (alpha = my trodden-ness)
 *   path   trodden cells that are paths now (alpha = the path's strength)
 *   slab   cells with my weight in their concrete
 *   trail  where I was at every reading; `end` where the life ended
 *
 * The world wraps (world.ts): everything is unwrapped around the trail's first point, so a life that crossed the
 * edge stays one picture. Pure.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_LEDGER, type Ledger, type LedgerConfig } from "./ledger";
import { nearestImage } from "./world";

export type FootprintKind = "press" | "tread" | "path" | "slab";

export interface FootprintCell {
  /** Top-left corner and side, in pixels. */
  x: number;
  y: number;
  w: number;
  kind: FootprintKind;
  /** 0 … 1 (see the header). */
  a: number;
}

export interface FootprintLayout {
  px: number;
  /** In drawing order: press, tread, path, slab. */
  cells: FootprintCell[];
  /** The trail in pixels, oldest first. */
  trail: [number, number][];
  end: [number, number] | null;
  /** Pixels per cell. */
  cellPx: number;
}

/** Lay the ledger out in a `px` square with `pad` pixels of margin; null when there is nothing to draw. */
export function footprintLayout(l: Ledger, px = 160, pad = 2, cfg: LedgerConfig = DEFAULT_LEDGER, minCells = 8): FootprintLayout | null {
  const cells = [...l.cells.values()].filter((c) => c.sPeak >= cfg.pressS || c.trodT !== null || c.slab);
  if (!cells.length && l.trail.length < 2) return null;
  const ox = l.trail[0]?.x ?? (cells[0].cx + 0.5) * CELL_SIZE;
  const oz = l.trail[0]?.z ?? (cells[0].cz + 0.5) * CELL_SIZE;
  // everything in cell units, unwrapped around the trail's start
  const ux = (x: number) => nearestImage(x, ox) / CELL_SIZE;
  const uz = (z: number) => nearestImage(z, oz) / CELL_SIZE;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  const cellAt = cells.map((c) => {
    const x = ux((c.cx + 0.5) * CELL_SIZE), z = uz((c.cz + 0.5) * CELL_SIZE);
    grow(x - 0.5, z - 0.5);
    grow(x + 0.5, z + 0.5);
    return { c, x, z };
  });
  const trailAt = l.trail.map((p) => {
    const x = ux(p.x), z = uz(p.z);
    grow(x, z);
    return [x, z] as [number, number];
  });
  // at least minCells across, centred
  const w = Math.max(minCells, maxX - minX), h = Math.max(minCells, maxZ - minZ);
  const cx0 = (minX + maxX) / 2 - w / 2, cz0 = (minZ + maxZ) / 2 - h / 2;
  const cellPx = (px - 2 * pad) / Math.max(w, h);
  // north (+z) up
  const toX = (x: number) => pad + (x - cx0) * cellPx + ((px - 2 * pad) - w * cellPx) / 2;
  const toY = (z: number) => pad + (cz0 + h - z) * cellPx - ((px - 2 * pad) - h * cellPx) / 2 + ((px - 2 * pad) - h * cellPx);
  const out: FootprintCell[] = [];
  const kinds: FootprintKind[] = ["press", "tread", "path", "slab"];
  for (const kind of kinds) {
    for (const { c, x, z } of cellAt) {
      let a = 0;
      if (kind === "press" && c.sPeak >= cfg.pressS) a = c.grass > 0 ? Math.min(1, c.pressPeak / c.grass) : 1;
      else if (kind === "tread" && c.trodT !== null) a = Math.min(1, c.g / 3);
      else if (kind === "path" && c.trodT !== null && c.pathP >= cfg.pathP) a = c.pathP;
      else if (kind === "slab" && c.slab) a = 1;
      if (a <= 0) continue;
      out.push({ x: toX(x - 0.5), y: toY(z + 0.5), w: cellPx, kind, a });
    }
  }
  const trail = trailAt.map(([x, z]) => [toX(x), toY(z)] as [number, number]);
  return { px, cells: out, trail, end: trail.length ? trail[trail.length - 1] : null, cellPx };
}
