#!/usr/bin/env python3
"""The structure's top layer melting into the sky: pixeltop4.py <rgba.png> <out.png> <outWidth> [seed] [surfaceFrac]
Only the band around the surface line is touched. Above the line the orthogonal top members turn into cells
(8/16/32 px on one grid) that thin out, go translucent and scatter upward until nothing is left; just below the
line the smooth render dithers back in within a few percent of the height. The rest of the structure is untouched."""
import sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
rng = np.random.default_rng(int(sys.argv[4]) if len(sys.argv) > 4 else 3)
SURF = float(sys.argv[5]) if len(sys.argv) > 5 else 0.1355   # the surface line, as a fraction of the image height
SKY = float(sys.argv[6]) if len(sys.argv) > 6 else None        # sky luminance 0–1: rising cells take on this tone
ASSIM = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0       # >0: cells are assimilated into the sky as soon as they cross the line (steepness)
TOP = SURF - 0.085            # above this nothing is left
END = SURF + 0.02             # below this the smooth render is whole
im = Image.open(src).convert("RGBA")
im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
H = a.shape[0]
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16

def presence(y):  # 0 at TOP → 1 at the surface, 1 below
    return np.clip((y - TOP) / (SURF - TOP), 0, 1)

def layer(cell, lo, hi, keep, scatter):
    ch, cw = H // cell, W // cell
    small = np.asarray(im.resize((cw, ch), Image.BOX)).astype(np.float32) / 255
    tone = np.round(small[..., :3].mean(axis=2) * 6) / 6
    if SKY is not None:  # the higher a cell, the closer its tone to the sky behind it
        g = presence(np.linspace(0, 1, ch, dtype=np.float32)[:, None])
        w = np.exp(-(1 - g) * ASSIM) if ASSIM > 0 else g ** 0.6   # steep: a cell just above the line is already mostly sky
        tone = tone * w + (SKY - 0.05 if ASSIM > 0 else SKY) * (1 - w)
    solid = small[..., 3] > 0.3
    y = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
    share = np.clip(1 - np.abs(y - (lo + hi) / 2) / ((hi - lo) / 2), 0, 1) * (y >= lo) * (y <= hi)
    B = np.tile(bayer, (ch // 4 + 1, cw // 4 + 1))[:ch, :cw]
    f = presence(y)
    on = (B < share) & solid & (rng.random((ch, cw)) < keep * (0.08 + 0.92 * f ** 1.5))
    # scatter: cells above the surface drift upward, the higher the further, and lose opacity on the way
    grid_a = np.zeros((ch, cw), np.float32); grid_t = np.zeros((ch, cw), np.float32)
    ys, xs = np.nonzero(on)
    for yy, xx in zip(ys, xs):
        fy = float(f[yy, 0])
        k = int(rng.poisson(scatter * (1 - fy))) if fy < 1 else 0
        ny = max(0, yy - k)
        al = ((0.3 + 0.7 * float(np.exp(-(1 - fy) * ASSIM))) if ASSIM > 0 else (0.06 + 0.94 * fy)) * (0.75 ** k)
        if al > grid_a[ny, xx]:
            grid_a[ny, xx] = al; grid_t[ny, xx] = tone[yy, xx]
    rgba = np.dstack([grid_t, grid_t, grid_t, grid_a])
    big = np.asarray(Image.fromarray((rgba * 255 + .5).astype(np.uint8), "RGBA").resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
    full = np.zeros_like(a); full[: ch * cell, : cw * cell] = big
    return full

# the cells first; then the smooth render takes over through a speckle (8 px grain, no dot screen) from a little
# above the surface line to END, so below the line nothing is punched into the render
cells = np.zeros_like(a)
for full in [layer(8, SURF - 0.035, END + 0.01, 0.8, 1.0),
             layer(16, TOP + 0.01, SURF + 0.01, 0.9, 2.5),
             layer(32, TOP, SURF - 0.015, 0.45, 2.0)]:
    al = full[..., 3:4]
    cells = cells * (1 - al) + full * al
ch, cw = H // 8, W // 8
y8 = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
keep_smooth = rng.random((ch, cw)) < np.clip((y8 - (SURF - 0.012)) / (END - (SURF - 0.012)), 0, 1) ** 1.3
ks = np.asarray(Image.fromarray(keep_smooth.astype(np.uint8) * 255).resize((cw * 8, ch * 8), Image.NEAREST)).astype(np.float32) / 255
K = np.ones((H, W), np.float32); K[: ch * 8, : cw * 8] = ks
outim = a * K[..., None] + cells * (1 - K[..., None])
Image.fromarray((outim * 255 + .5).astype(np.uint8), "RGBA").save(out, optimize=True)
print(out, (W, H))
