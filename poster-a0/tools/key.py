#!/usr/bin/env python3
"""Stitched tiles on a magenta ground → RGBA cutout: key.py <dir> <out.png> [maxW]
A pixel at an edge is a·F + (1−a)·magenta; with F near grey, red (or blue) minus green is 1−a."""
import json, sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
d, out = sys.argv[1:3]
m = json.load(open(f"{d}/meta.json"))
full = Image.new("RGB", (m["fullW"], m["fullH"]))
p = m["pad"]
for r in range(m["rows"]):
    for c in range(m["cols"]):
        t = Image.open(f"{d}/tile_{c}_{r}.png").convert("RGB")
        left = 0 if c == 0 else p
        top = 0 if r == 0 else p
        right = t.width if c == m["cols"] - 1 else t.width - p
        bottom = t.height if r == m["rows"] - 1 else t.height - p
        full.paste(t.crop((left, top, right, bottom)), (c * m["stepW"] + left, r * m["stepH"] + top))
a = np.asarray(full).astype(np.float32) / 255
key = np.clip(np.minimum(a[..., 0], a[..., 2]) - a[..., 1], 0, 1)
alpha = np.clip((1 - key - 0.02) / 0.96, 0, 1)
fg = a.copy()
fg[..., 0] = a[..., 0] - key
fg[..., 2] = a[..., 2] - key
safe = np.maximum(alpha, 1e-3)[..., None]
fg = np.clip(fg / safe, 0, 1)
rgba = np.dstack([fg, alpha])
im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")
if len(sys.argv) > 3:
    w = int(sys.argv[3])
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(out, optimize=False, compress_level=4)
print(out, im.size, f"opaque {float((alpha > 0.5).mean()):.3f}")
