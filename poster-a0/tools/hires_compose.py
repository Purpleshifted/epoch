#!/usr/bin/env python3
"""Full-resolution dissolve from a 3000-px run: hires_compose.py <source.png> <dump_cells.png> <dump_K.png> <W> <out.png>
The cells and the mask are blocky, so a NEAREST upscale is exact; the smooth render comes from the source at W. Memory-lean (uint8 only)."""
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, cells, K, W, out = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
im = Image.open(src).convert("RGBA")
im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
c = Image.open(cells).convert("RGBA").resize(im.size, Image.NEAREST)
k = Image.open(K).convert("L").resize(im.size, Image.NEAREST)
Image.composite(im, c, k).save(out, optimize=True)
print(out, im.size)
