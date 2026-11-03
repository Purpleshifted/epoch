#!/usr/bin/env python3
"""Composite the structure over its real background (white sky above the staircase, black ground below), in sRGB,
and write an OPAQUE grayscale image: bake_bg.py <Swap.dc.html> <struct_rgba.png> <out.png> [fadeStart fadeEnd]
Then no transparency, soft mask or blend happens in the PDF/Illustrator: the print shows exactly what the canvas shows."""
import sys, re
import numpy as np
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
html, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
f0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.60
f1 = float(sys.argv[5]) if len(sys.argv) > 5 else 0.95
h = open(html).read()
m = re.search(r'<img class="struct"[^>]*style="[^"]*left: ([\d.]+)px; top: ([\d.]+)px; width: ([\d.]+)px; height: ([\d.]+)px', h)
L, T, Wc, Hc = map(float, m.groups())
g = re.search(r'class="ground" style="[^"]*top: ([\d.]+)px;[^"]*clip-path: polygon\(([^)]+)\)', h)
gtop = float(g.group(1))
pts = [(float(x[:-2]), float(y[:-2])) for x, y in (p.strip().split(' ') for p in g.group(2).split(','))]
def ext(x, y):   # the staircase's outer points run past the sheet (bleed), its bottom past the page
    if x <= 0: x = -60
    if x >= 1682: x = 1760
    if y >= 2100: y = 2600
    return x, y
pts = [ext(x, y) for x, y in pts]
im = Image.open(src).convert("RGBA")
W, H = im.size
s = W / Wc                                   # image px per canvas px
poly = [((x - L) * s, (y + gtop - T) * s) for x, y in pts]
bg = Image.new("L", (W, H), 255)             # the sky
ImageDraw.Draw(bg).polygon(poly, fill=0)     # the ground: pure black → K100 after conversion, same as the vector ground
a = np.asarray(im).astype(np.float32) / 255
y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
fade = 1 - np.clip((y - f0) / (f1 - f0), 0, 1)   # the canvas's bottom fade, baked into the alpha
al = a[..., 3:4] * fade[..., None]
lum = a[..., :3].mean(axis=2, keepdims=True)
comp = lum * al + (np.asarray(bg).astype(np.float32)[..., None] / 255) * (1 - al)
Image.fromarray((comp[..., 0] * 255 + .5).astype(np.uint8), "L").save(out, optimize=True)
print(out, (W, H), "image at canvas", (L, T, Wc, Hc), "ground top", gtop, "polygon pts", len(poly))
