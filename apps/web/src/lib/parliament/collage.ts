/**
 * parliament/collage.ts
 *
 * The PHOTO version of the architecture collage: instead of drawing procedural planes, the slabs are
 * dressed with cut-out pictures of concrete architecture (generated greyscale fragments, see
 * tools/fragments/build_fragments.py). Pure and seeded, like shards.ts: the same log gives the same collage.
 *
 * RULES (every number is on screen):
 *   side  each cell is a COLUMN of storeys. A cell of raw height R has ceil(R) storeys; storey k is one
 *         picture standing on storey k-1 (so a tall slab is a tall stack of fragments).
 *         growth : lingering workers raise `raw`, a new picture appears on top of the column
 *         wear   : the visible height `h` shrinks, the TOP storeys fall away first (storey k is shown while
 *                  k + 0.6·life_k < h, life_k being that picture's own random 0..1)
 *         Pictures never change size or position because of wear, they only appear/disappear.
 *   top   a plan picture lies over each cell, longer where the slab is taller; shown while life < h/raw,
 *         so pictures of a worn cell fall away one by one.
 * Random numbers are seeded per CELL and drawn before any visibility test, so one cell never disturbs another.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import type { Slab } from "./types";

export interface CollageConfig {
  /** Multiplies how many pictures each cell gets (side: extra pictures beside each storey; top: pictures per cell). */
  density: number;
  /** Multiplies the size of the pictures. */
  scale: number;
}

export const DEFAULT_COLLAGE: CollageConfig = { density: 1, scale: 1 };

/** Cells thinner than this (in height units) are only a buried footprint: nothing to dress. */
const MIN_H = 0.15;

export interface Placement {
  /** Index into the fragment list for the view. */
  frag: number;
  /** Centre of the picture: side → (x, y, z); top → (x, y, z) lying flat (y is the stacking height). */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** In-plane rotation (radians). */
  rot: number;
  flip: boolean;
}

function rng(seed: number): () => number {
  let i = 0;
  return () => hash2(seed | 0, i++, 131);
}

/** `aspects[i]` = width / height of fragment i. */
export function buildCollage(
  slabs: Slab[],
  heightUnit: number,
  view: "side" | "top",
  aspects: number[],
  cfg: CollageConfig = DEFAULT_COLLAGE,
): Placement[] {
  const out: Placement[] = [];
  const n = aspects.length;
  if (n === 0) return out;
  const C = CELL_SIZE;

  for (const s of slabs) {
    if (s.h < MIN_H || s.raw <= 0) continue;
    const [cx, cz] = s.key.split(",").map(Number);
    const r = rng(Math.floor(hash2(cx, cz, view === "side" ? 21 : 22) * 1e9));

    if (view === "side") {
      const stories = Math.ceil(s.raw - 1e-9);
      for (let k = 0; k < stories; k++) {
        // all randomness first, so wear and growth never shift the other pictures
        const frag = Math.floor(r() * n) % n;
        const life = r();
        const jx = (r() - 0.5) * C * 1.4;
        const sz = 0.85 + r() * 0.7;
        const rotJit = (r() - 0.5) * 0.16;
        const flip = r() < 0.5;
        const depth = (r() - 0.5) * 2.4;
        const second = r();
        const frag2 = Math.floor(r() * n) % n;
        const jx2 = (r() - 0.5) * C * 2.2;
        const sz2 = 0.85 + r() * 0.7;
        if (k + 0.6 * life >= s.h) continue; // this storey has worn away
        const extras = (second < 0.4 * cfg.density ? 1 : 0) + (second < 0.4 * (cfg.density - 1) ? 1 : 0);
        const hh = heightUnit * sz * cfg.scale;
        out.push({ frag, x: s.x + jx, y: k * heightUnit + hh / 2, z: depth + (k + 1) * 0.002, w: hh * aspects[frag], h: hh, rot: rotJit, flip });
        for (let e = 0; e < extras; e++) {
          const f = e === 0 ? frag2 : (frag2 + 1) % n;
          const h2 = heightUnit * sz2 * cfg.scale;
          const sgn = e === 0 ? 1 : -1;
          out.push({ frag: f, x: s.x + sgn * jx2, y: k * heightUnit + h2 / 2, z: -depth + (k + 1) * 0.002 + e * 0.01, w: h2 * aspects[f], h: h2, rot: -rotJit, flip: !flip });
        }
      }
    } else {
      const ratio = s.h / s.raw;
      const countR = r();
      const count = Math.max(1, Math.round(cfg.density * (0.6 + countR * 0.5)));
      for (let k = 0; k < count; k++) {
        const frag = Math.floor(r() * n) % n;
        const life = r();
        const jx = (r() - 0.5) * C * 1.4;
        const jz = (r() - 0.5) * C * 1.4;
        const sz = 0.85 + r() * 0.7;
        const rotJit = (r() - 0.5) * 0.16;
        if (life >= ratio) continue;
        const a = aspects[frag];
        const long = C * (1.4 + Math.min(3, s.raw * 0.35)) * sz * cfg.scale;
        const w = a >= 1 ? long : long * a;
        const h = a >= 1 ? long / a : long;
        out.push({ frag, x: s.x + jx * 0.6, y: 0.02 + s.raw * 0.04 + (k + 1) * 0.003, z: s.z + jz * 0.6, w, h, rot: rotJit, flip: false });
      }
    }
  }
  return out;
}
