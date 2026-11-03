#!/usr/bin/env python3
"""A blur that comes on gradually toward the bottom of an RGBA image: bottomblur.py <in.png> <out.png> [startFrac] [endFrac] [maxRadius]
From startFrac of the height the blur radius rises linearly to maxRadius at endFrac (and stays there below). Alpha is
premultiplied before blurring so transparent surroundings never bleed dark fringes into the shapes."""
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
a = np.asarray(im).astype(np.float32)
al = a[..., 3:4] / 255
pre = np.dstack([a[..., :3] * al, a[..., 3:4]])          # premultiplied RGB + alpha
pre_im = Image.fromarray(np.clip(pre, 0, 255).astype(np.uint8), "RGBA")
radii = [0, rmax * 0.25, rmax * 0.5, rmax * 0.75, rmax]
levels = [np.asarray(pre_im.filter(ImageFilter.GaussianBlur(r)) if r else pre_im).astype(np.float32) for r in radii]
y = np.arange(H, dtype=np.float32)[:, None, None]
t = np.clip((y / H - start) / (end - start), 0, 1) * (len(radii) - 1)   # 0..4, which blur level each row sits at
lo = np.floor(t).astype(int); hi = np.minimum(lo + 1, len(radii) - 1); f = t - lo
outp = np.zeros_like(levels[0])
for i in range(len(radii)):
    w = np.where(lo == i, 1 - f, 0) + np.where(hi == i, f, 0)
    outp += levels[i] * w
alpha = outp[..., 3:4]
rgb = np.where(alpha > 0.5, outp[..., :3] / np.maximum(alpha, 1e-3) * 255, 0)   # unpremultiply
res = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
Image.fromarray(res, "RGBA").save(out, optimize=True)
print(out, (W, H), "blur", start, "→", end, "r", rmax)
