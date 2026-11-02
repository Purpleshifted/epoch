#!/usr/bin/env python3
"""The structure on paper, eaten into by the paper: erode.py <render.jpg> <alpha.png> <out.jpg> <paperHex> [seed]
Paper patches (fractal noise, thresholded) bite into the structure, more towards its left edge and the top and bottom;
then film grain and a touch of contrast so the render reads as a print, not a CG frame."""
import sys
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
src, alpha_f, out, paper = sys.argv[1:5]
seed = int(sys.argv[5]) if len(sys.argv) > 5 else 7
rng = np.random.default_rng(seed)
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
H, W = im.shape[:2]
pap = np.array([int(paper[i:i+2], 16) for i in (1, 3, 5)], np.float32) / 255

def fractal(h, w, cells=((340, 375), (170, 188), (85, 94), (42, 47), (21, 23)), weights=(1, .6, .35, .2, .12)):
    # strata-like: the noise cells are five times wider than tall, so the paper bites in as horizontal streaks
    acc = np.zeros((h, w), np.float32)
    for (ch, cw), wt in zip(cells, weights):
        small = rng.random((ch + 2, cw + 2)).astype(np.float32)
        up = np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC))
        acc += wt * up
    acc -= acc.min(); acc /= acc.max()
    return acc

n = fractal(H, W)
# where the paper bites: a left-to-right ramp (the text side erodes most) plus the top and bottom
x = np.linspace(0, 1, W, dtype=np.float32)[None, :]
y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
bias = np.clip(1.15 - 2.6 * x, 0, 1) * 0.55 + np.clip(0.18 - y, 0, 1) * 2.2 + np.clip(y - 0.88, 0, 1) * 3.5 + np.clip(x - 0.86, 0, 1) * 2.5
bite = (n + bias) > 0.86
# ragged, slightly feathered edge
m = Image.fromarray((bite * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
m = np.asarray(m).astype(np.float32) / 255
a0 = np.asarray(Image.open(alpha_f).getchannel("A")).astype(np.float32) / 255
flat = np.clip(1 - a0 * 1.0, 0, 1)[..., None]  # outside the structure → paper
im = im * (1 - flat) + pap[None, None, :] * flat
out_im = im * (1 - m[..., None]) + pap[None, None, :] * m[..., None]
# contrast and grain
g = out_im.mean(axis=2, keepdims=True)
out_im = np.clip((out_im - 0.5) * 1.08 + 0.5 + (g - out_im) * 0.35, 0, 1)

Image.fromarray((out_im * 255 + .5).astype(np.uint8)).save(out, quality=93, subsampling=0)
# the alpha after the bite, for the overlap check
a = np.asarray(Image.open(alpha_f).getchannel("A")).astype(np.float32) / 255
a = a * (1 - m)
Image.fromarray((a * 255 + .5).astype(np.uint8)).save(out.replace(".jpg", "_alpha.png"))
print(out, f"bitten {float(m.mean()):.2f}")
