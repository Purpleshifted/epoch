#!/usr/bin/env python3
"""Pixel above, organic below: pixelfossil.py <render.jpg> <alpha.png> <out.jpg> <paperHex> [cell px] [seed]
The present (top) is recorded on a pixel grid, the glyphs' grid; going down, cells give way to the smooth render,
cell by cell on a Bayer dither, until the fossil band is all organic. The edges crumble as square cells of paper."""
import sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, alpha_f, out, paper = sys.argv[1:5]
cell = int(sys.argv[5]) if len(sys.argv) > 5 else 22
seed = int(sys.argv[6]) if len(sys.argv) > 6 else 7
rng = np.random.default_rng(seed)
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
a = np.asarray(Image.open(alpha_f).getchannel("A")).astype(np.float32) / 255
H, W = a.shape
pap = np.array([int(paper[i:i+2], 16) for i in (1, 3, 5)], np.float32) / 255
# flat paper off the structure, a touch of contrast on it
im = np.clip((im - 0.5) * 1.08 + 0.5, 0, 1)
im = im * a[..., None] + pap * (1 - a[..., None])
# cell grid
ch, cw = H // cell, W // cell
small = np.asarray(Image.fromarray((im * 255).astype(np.uint8)).resize((cw, ch), Image.BOX)).astype(np.float32) / 255
asmall = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((cw, ch), Image.BOX)).astype(np.float32) / 255
# tones in the pixel zone: six steps
q = np.round(small * 5) / 5
# how pixel each row is: 1 at the top (the present), 0 by the fossil band
y = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
p = np.clip((0.64 - y) / 0.36, 0, 1) ** 1.3
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16
B = np.tile(bayer, (ch // 4 + 1, cw // 4 + 1))[:ch, :cw]
pixcell = (B < p)  # this cell is drawn as a pixel
# the crumbling edge, on the same grid: paper cells where the noise + the edge bias pass the threshold
x = np.linspace(0, 1, cw, dtype=np.float32)[None, :]
n = rng.random((ch, cw)).astype(np.float32)
for s in (2, 4, 8):
    n += np.asarray(Image.fromarray(rng.random((ch // s + 2, cw // s + 2)).astype(np.float32)).resize((cw, ch), Image.BICUBIC)) * (0.6 / s * 2)
n -= n.min(); n /= n.max()
bias = np.clip(1.1 - 2.4 * x, 0, 1) * 0.5 + np.clip(0.16 - y, 0, 1) * 2.4 + np.clip(y - 0.88, 0, 1) * 3.5 + np.clip(x - 0.86, 0, 1) * 2.5
bite = (n + bias) > 0.84
# inside the structure the bite leaves paper; outside it is paper anyway
cells = np.where(pixcell[..., None], q, small)
cells = np.where(bite[..., None], pap, cells)
up = np.asarray(Image.fromarray((cells * 255 + .5).astype(np.uint8)).resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
full = np.empty_like(im); full[:] = pap
full[: ch * cell, : cw * cell] = up
# where the cell is not a pixel and not bitten, the smooth render shows through
keep = np.asarray(Image.fromarray(((~pixcell) & (~bite)).astype(np.uint8) * 255).resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
k = np.zeros((H, W), np.float32); k[: ch * cell, : cw * cell] = keep
outim = full * (1 - k[..., None]) + im * k[..., None]
Image.fromarray((outim * 255 + .5).astype(np.uint8)).save(out, quality=93, subsampling=0)
# alpha after the bite (for the overlap check)
bit = np.asarray(Image.fromarray((bite.astype(np.uint8) * 255)).resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
ab = a.copy(); ab[: ch * cell, : cw * cell] *= 1 - bit
Image.fromarray((ab * 255 + .5).astype(np.uint8)).save(out.replace(".jpg", "_alpha.png"))
print(out, f"pixel cells {float(pixcell.mean()):.2f} bitten {float(bite.mean()):.2f}")
