#!/usr/bin/env python3
"""The structure dissolving upward into pixels: pixeltop3.py <rgba.png> <out.png> <outWidth> [seed]
From 32 % of the height upward the smooth render turns into crisp cells (8 px, then 16, then 24 px as they rise);
the higher a cell, the likelier it is missing and the more translucent it is, so the top thins to nothing against
whatever is behind it. Nothing is a solid mosaic."""
import sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
rng = np.random.default_rng(int(sys.argv[4]) if len(sys.argv) > 4 else 3)
im = Image.open(src).convert("RGBA")
im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
H = a.shape[0]
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16
TOP, FULL, END = 0.02, 0.17, 0.32   # above TOP nothing; FULL = densest cells; by END the smooth render has taken over
def fade(y):  # 0 at TOP → 1 at FULL (how present a cell is), kept at 1 below
    return np.clip((y - TOP) / (FULL - TOP), 0, 1)

def layer(cell, lo, hi, keep):
    ch, cw = H // cell, W // cell
    small = np.asarray(im.resize((cw, ch), Image.BOX)).astype(np.float32) / 255
    tone = np.round(small[..., :3].mean(axis=2) * 6) / 6
    solid = small[..., 3] > 0.3
    y = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
    share = np.clip(1 - np.abs(y - (lo + hi) / 2) / ((hi - lo) / 2), 0, 1) * (y >= lo) * (y <= hi)
    B = np.tile(bayer, (ch // 4 + 1, cw // 4 + 1))[:ch, :cw]
    f = fade(y)
    on = (B < share) & solid & (rng.random((ch, cw)) < keep * (0.15 + 0.85 * f))
    alpha = on * (0.25 + 0.75 * f) * np.ones((ch, cw), np.float32)
    rgba = np.dstack([tone, tone, tone, alpha])
    big = np.asarray(Image.fromarray((rgba * 255 + .5).astype(np.uint8), "RGBA").resize((cw * cell, ch * cell), Image.NEAREST)).astype(np.float32) / 255
    full = np.zeros_like(a); full[: ch * cell, : cw * cell] = big
    return full

# the smooth render stays only below END, dithering in from FULL (8 px grain)
ch, cw = H // 8, W // 8
y8 = np.linspace(0, 1, ch, dtype=np.float32)[:, None]
B8 = np.tile(bayer, (ch // 4 + 1, cw // 4 + 1))[:ch, :cw]
keep_smooth = B8 < np.clip((y8 - FULL) / (END - FULL), 0, 1)
ks = np.asarray(Image.fromarray(keep_smooth.astype(np.uint8) * 255).resize((cw * 8, ch * 8), Image.NEAREST)).astype(np.float32) / 255
K = np.zeros((H, W), np.float32); K[: ch * 8, : cw * 8] = ks
outim = a * K[..., None]
for full in [layer(8, 0.12, 0.34, 1.0), layer(16, 0.05, 0.22, 0.9), layer(24, 0.0, 0.13, 0.75)]:
    al = full[..., 3:4]
    outim = outim * (1 - al) + full * al
Image.fromarray((outim * 255 + .5).astype(np.uint8), "RGBA").save(out, optimize=True)
print(out, (W, H))
