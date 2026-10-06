/**
 * sprites/pixelize.ts
 *
 * Photo -> 24x24 sprite in the 16-colour VGA palette, the same recipe as the offline atlas
 * (tools/sprites/build_atlas.py): trim to the subject, pad to a square, area-average down to
 * 20x20, hard alpha, a little saturation/contrast so the EGA palette does not collapse to grey,
 * nearest palette colour (no dithering), grey outline for dark sprites.
 *
 * Pure (no canvas): takes RGBA bytes, returns RGBA bytes. The only photo-specific step is the
 * background removal: a flood fill from the border over pixels close to the border colour.
 * That works for product shots on plain backgrounds and fails on busy scenes; then the result
 * is a centre crop and `bgRemoved` is false so the caller can say so.
 */

import { PALETTE_HEX } from "@/lib/stratum/palette";

export const CELL = 24;
export const BODY = 20;

const PAL: [number, number, number][] = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

export interface PixelizeResult {
  /** CELL x CELL RGBA, palette colours only, alpha 0 or 255. */
  rgba: Uint8ClampedArray;
  bgRemoved: boolean;
  /** Share of the source that was kept as subject. */
  foreground: number;
  /** Palette index per cell pixel, -1 where transparent. */
  indices: Int8Array;
}

function colourDist(r: number, g: number, b: number, c: readonly [number, number, number]): number {
  const dr = r - c[0], dg = g - c[1], db = b - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Mask of subject pixels (1) vs background (0); null if the photo has no separable subject. */
function subjectMask(src: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const border: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(src[i]); gs.push(src[i + 1]); bs.push(src[i + 2]);
    border.push(y * w + x);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { push(0, y); push(w - 1, y); }
  const bg: [number, number, number] = [median(rs), median(gs), median(bs)];

  const bd = border.map((p) => colourDist(src[p * 4], src[p * 4 + 1], src[p * 4 + 2], bg)).sort((a, b) => a - b);
  const p90 = bd[Math.floor(bd.length * 0.9)];
  const thr = Math.min(70, Math.max(28, p90 * 1.5 + 18));

  const isBg = new Uint8Array(w * h);
  const stack: number[] = [];
  const near = (p: number) => colourDist(src[p * 4], src[p * 4 + 1], src[p * 4 + 2], bg) < thr;
  for (const p of border) if (!isBg[p] && near(p)) { isBg[p] = 1; stack.push(p); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p - x) / w;
    if (x > 0 && !isBg[p - 1] && near(p - 1)) { isBg[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !isBg[p + 1] && near(p + 1)) { isBg[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !isBg[p - w] && near(p - w)) { isBg[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !isBg[p + w] && near(p + w)) { isBg[p + w] = 1; stack.push(p + w); }
  }

  // keep only the largest connected subject blob (drops specks and far-away clutter)
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 1;
  for (let s = 0; s < w * h; s++) {
    if (isBg[s] || label[s]) continue;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && !isBg[p - 1] && !label[p - 1]) { label[p - 1] = next; stack.push(p - 1); }
      if (x < w - 1 && !isBg[p + 1] && !label[p + 1]) { label[p + 1] = next; stack.push(p + 1); }
      if (y > 0 && !isBg[p - w] && !label[p - w]) { label[p - w] = next; stack.push(p - w); }
      if (y < h - 1 && !isBg[p + w] && !label[p + w]) { label[p + w] = next; stack.push(p + w); }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  const frac = bestSize / (w * h);
  if (frac < 0.02 || frac > 0.9) return null;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = label[p] === best ? 1 : 0;
  return mask;
}

export function pixelizeRGBA(src: Uint8ClampedArray, w: number, h: number): PixelizeResult {
  let mask = subjectMask(src, w, h);
  const bgRemoved = mask !== null;
  if (!mask) {
    // no separable subject: keep the central 80% square, opaque
    mask = new Uint8Array(w * h);
    const side = Math.min(w, h) * 0.8;
    const x0 = (w - side) / 2, y0 = (h - side) / 2;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + side); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + side); x++) mask[y * w + x] = 1;
  }

  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  const foreground = count / (w * h);
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const side = Math.max(bw, bh) * 1.06;
  const sx0 = (minX + maxX + 1) / 2 - side / 2;
  const sy0 = (minY + maxY + 1) / 2 - side / 2;

  // area-average into BODY x BODY (alpha-weighted so the edge colour is the subject's, not the background's)
  const r = new Float32Array(BODY * BODY), g = new Float32Array(BODY * BODY), b = new Float32Array(BODY * BODY), a = new Float32Array(BODY * BODY);
  const step = side / BODY;
  for (let ty = 0; ty < BODY; ty++) {
    for (let tx = 0; tx < BODY; tx++) {
      const xa = Math.max(0, Math.floor(sx0 + tx * step)), xb = Math.min(w, Math.max(xa + 1, Math.ceil(sx0 + (tx + 1) * step)));
      const ya = Math.max(0, Math.floor(sy0 + ty * step)), yb = Math.min(h, Math.max(ya + 1, Math.ceil(sy0 + (ty + 1) * step)));
      let n = 0, on = 0, sr = 0, sg = 0, sb = 0;
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) {
          n++;
          if (!mask[y * w + x]) continue;
          on++;
          const i = (y * w + x) * 4;
          sr += src[i]; sg += src[i + 1]; sb += src[i + 2];
        }
      const o = ty * BODY + tx;
      if (n > 0 && on > 0) { a[o] = on / n; r[o] = sr / on; g[o] = sg / on; b[o] = sb / on; }
    }
  }

  // contrast stretch on luma + saturation boost, over the opaque pixels only
  const lumas: number[] = [];
  for (let o = 0; o < BODY * BODY; o++) if (a[o] >= 0.5) lumas.push(0.299 * r[o] + 0.587 * g[o] + 0.114 * b[o]);
  lumas.sort((x, y) => x - y);
  const lo = lumas.length ? lumas[Math.floor(lumas.length * 0.03)] : 0;
  const hi = lumas.length ? lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * 0.97))] : 255;
  const gain = hi - lo > 20 ? 255 / (hi - lo) : 1;

  const indices = new Int8Array(CELL * CELL).fill(-1);
  const off = (CELL - BODY) / 2;
  let lumSum = 0, lumN = 0;
  for (let ty = 0; ty < BODY; ty++) {
    for (let tx = 0; tx < BODY; tx++) {
      const o = ty * BODY + tx;
      if (a[o] < 0.5) continue;
      let cr = (r[o] - lo) * gain, cg = (g[o] - lo) * gain, cb = (b[o] - lo) * gain;
      const l = 0.299 * cr + 0.587 * cg + 0.114 * cb;
      cr = l + (cr - l) * 1.25; cg = l + (cg - l) * 1.25; cb = l + (cb - l) * 1.25;
      cr = Math.max(0, Math.min(255, cr)); cg = Math.max(0, Math.min(255, cg)); cb = Math.max(0, Math.min(255, cb));
      // nearest palette colour; black is reserved for "nothing", so a body pixel never maps to it
      let bi = 1, bd = Infinity;
      for (let i = 1; i < 16; i++) {
        const d = colourDist(cr, cg, cb, PAL[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      indices[(ty + off) * CELL + (tx + off)] = bi;
      lumSum += 0.299 * PAL[bi][0] + 0.587 * PAL[bi][1] + 0.114 * PAL[bi][2];
      lumN++;
    }
  }

  // dark sprites get a 1px grey outline so they stay readable on the near-black ground
  if (lumN > 0 && lumSum / lumN < 90) {
    const copy = Int8Array.from(indices);
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        if (copy[y * CELL + x] >= 0) continue;
        const nb = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < CELL && yy < CELL && copy[yy * CELL + xx] >= 0;
        if (nb(x - 1, y) || nb(x + 1, y) || nb(x, y - 1) || nb(x, y + 1)) indices[y * CELL + x] = 8;
      }
  }

  const rgba = new Uint8ClampedArray(CELL * CELL * 4);
  for (let i = 0; i < CELL * CELL; i++) {
    const idx = indices[i];
    if (idx < 0) continue;
    rgba[i * 4] = PAL[idx][0];
    rgba[i * 4 + 1] = PAL[idx][1];
    rgba[i * 4 + 2] = PAL[idx][2];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, bgRemoved, foreground, indices };
}
