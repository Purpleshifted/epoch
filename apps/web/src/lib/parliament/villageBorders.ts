/**
 * parliament/villageBorders.ts — THE BORDERS BETWEEN VILLAGES (the artist, 2026-11-16: "마을간의 길이나 식생배치에
 * 따른 물길 같은 게 권역 나눔으로 안 느껴지는데" → "권역 나누기 만들기").
 *
 * The villages alive at one time divide the ground as the cells of their Voronoi diagram: every point belongs to the
 * nearest village. Two villages are NEIGHBOURS when their cells share an edge; that edge is their BORDER — a segment
 * of the line halfway between them, clipped by every other village's half-plane and by the ground (a disc round the
 * origin). The water runs along the borders (water.ts), the vegetation stands in belts on them (ParliamentSpace
 * Vegetation), and the roads cross them at a gate (lifecycle.ts planWay). As villages come and go in the block, their
 * borders move with them.
 *
 * Plain coordinates: the villages lie well inside the world's edge (originR), so nothing wraps. Pure.
 */

export interface BorderSite {
  /** The site's index (lifecycle.ts villageSites). */
  i: number;
  x: number;
  z: number;
}

export interface Border {
  /** The two villages it lies between (i < j). */
  i: number;
  j: number;
  /** Its two ends. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Shortest border kept (world): two villages touching at a point are not neighbours. */
const MIN_LEN = 1;

/** The borders between `sites` within the disc of radius `R` round the origin (every pair of neighbours once). */
export function villageBorders(sites: readonly BorderSite[], R: number): Border[] {
  const out: Border[] = [];
  for (let p = 0; p < sites.length; p++)
    for (let q = p + 1; q < sites.length; q++) {
      const A = sites[p], B = sites[q];
      const ex = B.x - A.x, ez = B.z - A.z, L = Math.hypot(ex, ez);
      if (L < 1e-6) continue;
      // the line halfway between them: M + t D
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, dx = -ez / L, dz = ex / L;
      // the ground: |M + t D| ≤ R
      const md = mx * dx + mz * dz, disc = md * md - (mx * mx + mz * mz - R * R);
      if (disc <= 0) continue;
      let lo = -md - Math.sqrt(disc), hi = -md + Math.sqrt(disc);
      // every other village: nearer to A (and so to B) than to it — 2 P·(C − A) ≤ |C|² − |A|²
      for (let r = 0; r < sites.length && lo < hi; r++) {
        if (r === p || r === q) continue;
        const C = sites[r];
        const cx = C.x - A.x, cz = C.z - A.z;
        const g = 2 * (dx * cx + dz * cz);
        const h = C.x * C.x + C.z * C.z - (A.x * A.x + A.z * A.z) - 2 * (mx * cx + mz * cz);
        if (Math.abs(g) < 1e-9) {
          if (h < 0) hi = lo;
        } else if (g > 0) hi = Math.min(hi, h / g);
        else lo = Math.max(lo, h / g);
      }
      if (hi - lo < MIN_LEN) continue;
      const [i, j] = A.i < B.i ? [A.i, B.i] : [B.i, A.i];
      out.push({ i, j, ax: mx + dx * lo, az: mz + dz * lo, bx: mx + dx * hi, bz: mz + dz * hi });
    }
  return out;
}

/** The point of border `b` nearest to (x, z), and its distance. */
export function nearestOnBorder(b: Border, x: number, z: number): { x: number; z: number; d: number } {
  const ex = b.bx - b.ax, ez = b.bz - b.az, L2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - b.ax) * ex + (z - b.az) * ez) / L2));
  const px = b.ax + ex * t, pz = b.az + ez * t;
  return { x: px, z: pz, d: Math.hypot(px - x, pz - z) };
}

/**
 * The GATE of a border: where a road between its two villages crosses it — the point of the border on the line between
 * the two villages (or the end nearest it), moved along the border by `shift` (−1 … 1) of its half length.
 */
export function gateOf(b: Border, x1: number, z1: number, x2: number, z2: number, shift: number): [number, number] {
  const ex = b.bx - b.ax, ez = b.bz - b.az, L2 = ex * ex + ez * ez || 1e-9;
  // where the line between the villages meets the border's line (the middle between them lies on it)
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const t0 = ((mx - b.ax) * ex + (mz - b.az) * ez) / L2;
  const t = Math.max(0.05, Math.min(0.95, t0 + shift * 0.5));
  return [b.ax + ex * t, b.az + ez * t];
}
