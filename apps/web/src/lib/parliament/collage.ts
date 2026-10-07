/**
 * parliament/collage.ts
 *
 * The PHOTO version of the architecture collage: instead of drawing procedural planes, the slab clusters are
 * dressed with cut-out pictures of concrete architecture (generated greyscale fragments, see
 * tools/fragments/build_fragments.py). Pure and seeded, like shards.ts: the same log gives the same collage.
 *
 *   side  a fragment stands over each cell, scaled to the cell's height, slightly rotated, at a random depth
 *   top   a plan fragment lies over each cell, bigger where the slab is taller
 *
 * Every placement has a random `life`; it is drawn while life < intact (cluster's mean h/raw), so wear makes
 * pictures fall away one by one.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2 } from "./nature";
import { clusters } from "./shards";
import type { Slab } from "./types";

export interface CollageConfig {
  /** Multiplies how many pictures each cell gets. */
  density: number;
  /** Multiplies the size of the pictures. */
  scale: number;
}

export const DEFAULT_COLLAGE: CollageConfig = { density: 1, scale: 1 };

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

  for (const cl of clusters(slabs)) {
    const cells = cl.cells;
    const [mcx, mcz] = cells[0].key.split(",").map(Number);
    const r = rng(Math.floor(hash2(mcx, mcz, view === "side" ? 21 : 22) * 1e9));
    const intact = cells.reduce((a, s) => a + (s.raw > 0 ? s.h / s.raw : 0), 0) / cells.length;
    let order = 0;

    for (const s of cells) {
      // sizes follow the UNWORN height, so surviving pictures keep their size while others fall away
      const H = s.raw * heightUnit;
      const countR = r();
      const count = Math.max(1, Math.round(cfg.density * (view === "side" ? (s.raw >= 3 ? 1.6 : 1) : 0.6 + countR * 0.5)));
      for (let k = 0; k < count; k++) {
        // all randomness first, so wear never shifts the other pictures
        const frag = Math.floor(r() * n) % n;
        const life = r();
        const jx = (r() - 0.5) * C * 1.4;
        const jz = (r() - 0.5) * C * 1.4;
        const sz = 0.85 + r() * 0.7;
        const rotJit = (r() - 0.5) * 0.16;
        const flip = r() < 0.5;
        const liftP = r();
        const liftA = r();
        const lift = liftP < 0.22 ? liftA * heightUnit * 1.6 : 0;
        const depth = (r() - 0.5) * 2.4;
        order++;
        if (life >= intact) continue;
        const a = aspects[frag];
        if (view === "side") {
          const h = Math.max(heightUnit * 0.9, H) * sz * cfg.scale;
          const w = h * a;
          out.push({ frag, x: s.x + jx, y: lift + h / 2, z: depth + order * 0.002, w, h, rot: rotJit, flip });
        } else {
          const long = C * (1.4 + Math.min(3, s.raw * 0.35)) * sz * cfg.scale;
          const w = a >= 1 ? long : long * a;
          const h = a >= 1 ? long / a : long;
          out.push({ frag, x: s.x + jx * 0.6, y: 0.02 + s.raw * 0.04 + order * 0.003, z: s.z + jz * 0.6, w, h, rot: rotJit, flip: false });
        }
      }
    }
  }
  return out;
}
