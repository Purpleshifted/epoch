#!/usr/bin/env python3
"""The structure's top as pixels: pixeltop.py <rgba.png> <out.png> <outWidth> <cell px> <pixelUntil 0..1> <organicFrom 0..1>
Above `pixelUntil` (fraction of the height) every cell is a flat square (one tone, opaque or empty); between it and
`organicFrom` the cells give way to the smooth render on a Bayer dither; below, the render as it is. Cells are crisp."""
import sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out, W, cell, p0, p1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
im = Image.open(src).convert("RGBA")
im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
H = a.shape[0]
ch, cw = H // cell, W // cell
small = np.asarray(im.resize((cw, ch), Image.BOX)).astype(np.float32) / 255
rgb, al = small[..., :3], small[..., 3]
tone = np.round(rgb.mean(axis=2) * 5) / 5
cells = np.dstack([tone, tone, tone, (al > 0.33).astype(np.float32)])
y = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
p = np.clip((p1 - y) / max(1e-6, p1 - p0), 0, 1)
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16
B = np.tile(bayer, (ch // 4 + 1, cw // 4 + 1))[:ch, :cw]
pix = (B < p)
up = np.asarray(Image.fromarray((cells * 255 + .5).astype(np.uint8), "RGBA").resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
mask = np.asarray(Image.fromarray((pix.astype(np.uint8) * 255)).resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
outim = a.copy()
m = np.zeros((H, W), np.float32); m[: ch * cell, : cw * cell] = mask
u = np.zeros_like(a); u[: ch * cell, : cw * cell] = up
outim = outim * (1 - m[..., None]) + u * m[..., None]
Image.fromarray((outim * 255 + .5).astype(np.uint8), "RGBA").save(out, optimize=True)
print(out, (W, H), "cells", (cw, ch), "pixel cells", int(pix.sum()))
