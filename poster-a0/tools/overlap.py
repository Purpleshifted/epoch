#!/usr/bin/env python3
"""Checks that no text touches the image: overlap.py <name> <rects.json> (rects in mm, from the page). Reports opaque image pixels under each block."""
import json, sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
name, rects_file = sys.argv[1:3]
L = json.load(open("poster-a0/out/layout.json"))[name]
_im = Image.open(f"poster-a0/renders/{L['img']}")
a = np.asarray(_im.getchannel("A") if "A" in _im.getbands() else _im.convert("L"))
H, W = a.shape
s = H / L["imgH"]  # px per mm
bad = 0
for r in json.load(open(rects_file)):
    cx = max(r["x"], L.get("clipX", -1e9))  # the image is clipped left of clipX: nothing shows there
    rx = min(r["x"] + r["w"], L.get("clipX2", 1e9))
    x0, x1 = round((cx - L["imgX"]) * s), round((rx - L["imgX"]) * s)
    y0, y1 = round((r["y"] - L["imgY"]) * s), round((r["y"] + r["h"] - L["imgY"]) * s)
    x0, x1, y0, y1 = max(0, x0), min(W, x1), max(0, y0), min(H, y1)
    n = int((a[y0:y1, x0:x1] > 25).sum()) if x1 > x0 and y1 > y0 else 0
    print(f"  {r['c']:<8} y {r['y']:.0f}–{r['y'] + r['h']:.0f} mm  image pixels under it: {n}")
    bad += n
print(name, "OK" if bad == 0 else f"OVERLAP {bad}")
