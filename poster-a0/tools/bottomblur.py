#!/usr/bin/env python3
"""A blur that comes on gradually toward the bottom of an RGBA image: bottomblur.py <in.png> <out.png> [startFrac] [endFrac] [maxRadius]
From startFrac of the height the blur radius rises linearly to maxRadius at endFrac (and stays there below). Alpha is
premultiplied before blurring so transparent surroundings never bleed dark fringes into the shapes. Works in row chunks,
so a 6000-px image needs well under a gigabyte."""
import sys
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
start = float(sys.argv[3]) if len(sys.argv) > 3 else 0.60
end = float(sys.argv[4]) if len(sys.argv) > 4 else 0.95
rmax = float(sys.argv[5]) if len(sys.argv) > 5 else 26
im = Image.open(src).convert("RGBA")
W, H = im.size
# premultiply (uint8 maths through PIL)
# PIL has no premultiply; do it with numpy in chunks
arr = np.asarray(im)
prem = np.empty_like(arr)
for y0 in range(0, H, 512):
    ch = arr[y0:y0 + 512].astype(np.uint16)
    al = ch[..., 3:4]
    prem[y0:y0 + 512, :, :3] = ((ch[..., :3] * al + 127) // 255).astype(np.uint8)
    prem[y0:y0 + 512, :, 3] = al[..., 0].astype(np.uint8)
pre_im = Image.fromarray(prem, "RGBA"); del arr, prem
radii = [0, rmax * 0.25, rmax * 0.5, rmax * 0.75, rmax]
levels = [pre_im.filter(ImageFilter.GaussianBlur(rd)) if rd else pre_im for rd in radii]
res = np.empty((H, W, 4), np.uint8)
for y0 in range(0, H, 256):
    y1 = min(H, y0 + 256)
    y = np.arange(y0, y1, dtype=np.float32)[:, None, None]
    t = np.clip((y / H - start) / (end - start), 0, 1) * (len(radii) - 1)
    lo = np.floor(t).astype(int); hi = np.minimum(lo + 1, len(radii) - 1); f = t - lo
    acc = np.zeros((y1 - y0, W, 4), np.float32)
    for i in range(len(radii)):
        w = np.where(lo == i, 1 - f, 0) + np.where(hi == i, f, 0)
        if w.any():
            acc += np.asarray(levels[i].crop((0, y0, W, y1))).astype(np.float32) * w
    alpha = acc[..., 3:4]
    rgb = np.where(alpha > 0.5, acc[..., :3] / np.maximum(alpha, 1e-3) * 255, 0)
    res[y0:y1, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    res[y0:y1, :, 3] = np.clip(alpha[..., 0], 0, 255).astype(np.uint8)
Image.fromarray(res, "RGBA").save(out, optimize=True)
print(out, (W, H), "blur", start, "→", end, "r", rmax)
