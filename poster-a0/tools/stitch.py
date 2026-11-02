#!/usr/bin/env python3
"""Joins tile_<col>_<row>.png from capture.mjs, cropping each tile's padding: stitch.py <dir> <out.jpg>"""
import json, sys
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
full.save(out, quality=93, subsampling=0)
print(out, full.size)
