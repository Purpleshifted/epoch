/**
 * shotMatte.ts — a picture without its background, from the same picture drawn over black and over white. Whatever a pixel
 * lets through shows as the difference between the two, so this holds for everything the wall draws: soft points, blur,
 * resin, grain. The result laid over black or white is exactly what was drawn there.
 */

/** Both are straight RGBA of the same size; the result goes into `black`. */
export function matte(black: Uint8ClampedArray, white: Uint8ClampedArray): void {
  for (let i = 0; i < black.length; i += 4) {
    const through = white[i] - black[i] + (white[i + 1] - black[i + 1]) + (white[i + 2] - black[i + 2]);
    const alpha = Math.min(255, 255 - through / 3);
    if (alpha <= 0) {
      black[i] = black[i + 1] = black[i + 2] = black[i + 3] = 0;
      continue;
    }
    const k = 255 / alpha;
    black[i] *= k;
    black[i + 1] *= k;
    black[i + 2] *= k;
    black[i + 3] = alpha;
  }
}
