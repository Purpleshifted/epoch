#!/usr/bin/env python3
"""The title's syllables as outlines with exact boxes, so they can be stretched into rows: title_paths.py"""
import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
out = {}
for name, path in {
    "pretendard-black": "~/Library/Fonts/Pretendard-Black.otf",
    "suit-heavy": "~/Library/Fonts/SUIT-Heavy.otf",
}.items():
    f = TTFont(os.path.expanduser(path))
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    rows = []
    for ch in "발견된인류":
        g = gs[cmap[ord(ch)]]
        sp = SVGPathPen(gs)
        g.draw(sp)
        bp = BoundsPen(gs)
        g.draw(bp)
        rows.append({"ch": ch, "d": sp.getCommands(), "box": bp.bounds, "adv": g.width})
    out[name] = {"upm": f["head"].unitsPerEm, "rows": rows}
json.dump(out, open("poster-a0/data/title_paths.json", "w"), ensure_ascii=False)
print({k: [r["box"] for r in v["rows"]][:2] for k, v in out.items()})
