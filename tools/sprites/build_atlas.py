#!/usr/bin/env python3
"""Build the 16-colour pixel-sprite atlas for the technofossil stratum installation.

Reads   tools/sprites/mapping.json   (itemId -> [{src, source, license, author, url, ...}])
Writes  apps/web/public/sprites/atlas.png               24x24 cells, 16 columns, RGBA
        apps/web/src/lib/stratum/sprites.data.ts         itemId -> cell indices
        docs/data/sprites-credits.json  +  CREDITS.md     attribution
        docs/img/sprite-sheet-preview.png / sprite-sheet-labeled.png

Pipeline per sprite (no anti-aliasing, no dithering):
  rasterise (SVG -> 256 px RGBA via resvg) -> trim to alpha bbox -> pad to square
  -> BOX/area resize to 20x20 (premultiplied) -> hard 1-bit alpha at 50 %
  -> saturation x1.2 + luminance auto-contrast -> nearest TempleOS/VGA colour
  (CIELAB distance, palette index 0 / black is never used for body pixels)
  -> optional 1 px outline in palette index 8 (555555) if the sprite is mostly dark.

Usage:  PYTHONPATH=<dir with Pillow, numpy, resvg_py> python3 tools/sprites/build_atlas.py
Env:    SPRITE_SRC_ASSETS = directory holding the shallow clones referenced by mapping.json `src`.
"""
from __future__ import annotations

import colorsys
import json
import math
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC_ASSETS = Path(os.environ.get(
    "SPRITE_SRC_ASSETS",
    "/Users/hesse/.gemini/antigravity/brain/7ac981a7-b6d4-4f8d-82b0-aad446dc5a57/scratch/src_assets",
))
MAPPING = ROOT / "tools/sprites/mapping.json"
OUT_ATLAS = ROOT / "apps/web/public/sprites/atlas.png"
OUT_TS = ROOT / "apps/web/src/lib/stratum/sprites.data.ts"
OUT_CREDITS_JSON = ROOT / "docs/data/sprites-credits.json"
OUT_CREDITS_MD = ROOT / "CREDITS.md"
OUT_PREVIEW = ROOT / "docs/img/sprite-sheet-preview.png"
OUT_LABELED = ROOT / "docs/img/sprite-sheet-labeled.png"

CELL = 24
COLS = 16
INNER = 20          # sprite size inside the cell (2 px margin all round)
RENDER = 256        # SVG rasterisation size
PREVIEW_SCALE = 6
PREVIEW_BG = (0x05, 0x06, 0x0A, 255)
SAT = 1.2

PALETTE_HEX = ["000000", "0000aa", "00aa00", "00aaaa", "aa0000", "aa00aa", "aa5500", "aaaaaa",
               "555555", "5555ff", "55ff55", "55ffff", "ff5555", "ff55ff", "ffff55", "ffffff"]
PALETTE = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in PALETTE_HEX]
OUTLINE_IDX = 8
USABLE = list(range(1, 16))  # never map body pixels to pure black (scene background)


# ---------------------------------------------------------------- colour maths
def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(rgb):
    r, g, b = (_lin(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


PAL_LAB = {i: rgb_to_lab(PALETTE[i]) for i in range(16)}
_cache: dict[tuple, int] = {}


def nearest_palette(rgb) -> int:
    if rgb in _cache:
        return _cache[rgb]
    L, a, b = rgb_to_lab(rgb)
    best, bd = 1, 1e18
    for i in USABLE:
        pl, pa, pb = PAL_LAB[i]
        # chroma weighted up so the EGA palette does not collapse to grey
        d = (0.8 * (L - pl)) ** 2 + (1.25 * (a - pa)) ** 2 + (1.25 * (b - pb)) ** 2
        if d < bd:
            best, bd = i, d
    _cache[rgb] = best
    return best


# ---------------------------------------------------------------- rasterising
def render_svg(path: Path, entry: dict) -> Image.Image:
    import resvg_py  # imported lazily so PNG-only runs work without it

    text = path.read_text(encoding="utf-8")
    if "game-icons" in entry["src"]:
        # game-icons.net SVGs are a white glyph on a black square: drop the square, tint the glyph
        text = text.replace('<path d="M0 0h512v512H0z"/>', "")
        tint = entry.get("tint", "#ffffff")
        text = re.sub(r'fill="#fff"', f'fill="{tint}"', text)
        if 'fill="' not in text:
            text = text.replace("<path ", f'<path fill="{tint}" ', 1)
    png = resvg_py.svg_to_bytes(svg_string=text, width=RENDER, height=RENDER)
    import io
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def load_source(entry: dict) -> Image.Image:
    p = SRC_ASSETS / entry["src"]
    if not p.exists():
        raise FileNotFoundError(p)
    if p.suffix.lower() == ".svg":
        return render_svg(p, entry)
    return Image.open(p).convert("RGBA")


# ---------------------------------------------------------------- sprite pipeline
def trim_square(im: Image.Image) -> Image.Image:
    a = im.getchannel("A").point(lambda v: 255 if v > 16 else 0)
    bbox = a.getbbox()
    if bbox is None:
        raise ValueError("empty sprite")
    im = im.crop(bbox)
    s = max(im.size)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq


def contrast_stretch(px: list, sat: float, stretch: bool = True):
    """px: list of [r,g,b] for opaque pixels. Returns adjusted list."""
    lums = sorted(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px)
    lo = lums[int(len(lums) * 0.02)]
    hi = lums[min(len(lums) - 1, int(len(lums) * 0.98))]
    out = []
    # only stretch when the sprite is low-contrast; never stretch a flat single colour into noise
    if stretch and hi - lo > 24:
        gain = min(2.0, 255.0 / max(hi - lo, 1))
        lo_eff = min(lo, 80)  # don't drag mid-dark sprites to full black
        for r, g, b in px:
            out.append([max(0, min(255, (c - lo_eff) * gain)) for c in (r, g, b)])
    else:
        out = [list(p) for p in px]
    return out


def brown_fix(c):
    """EGA has only one brown/orange (aa5500). Pull mid-tone orange-red hues (wood, leather, chestnut)
    towards its hue so they do not all collapse onto aa0000 red."""
    r, g, b = (v / 255.0 for v in c)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hd = h * 360.0
    if 9 <= hd <= 42 and s > 0.28 and v < 0.92:
        hd = 30 + (hd - 30) * 0.3
        s = max(s, 0.85)
        v = min(v, 0.70)
        r, g, b = colorsys.hsv_to_rgb(hd / 360.0, s, v)
        return [r * 255, g * 255, b * 255]
    return c


def make_sprite(entry: dict) -> list[list[int]]:
    """Returns INNERxINNER grid of palette index or -1 (transparent)."""
    im = trim_square(load_source(entry))
    # premultiplied BOX resize (area average); upscaling falls back to nearest-like replication
    im = im.convert("RGBa").resize((INNER, INNER), Image.BOX).convert("RGBA")
    px = im.load()
    coords, rgbs = [], []
    for y in range(INNER):
        for x in range(INNER):
            r, g, b, a = px[x, y]
            if a >= 128:  # hard 1-bit alpha at 50 %
                coords.append((x, y))
                rgbs.append((r, g, b))
    if not rgbs:
        raise ValueError("sprite vanished after threshold")
    # saturation boost
    sat = entry.get("sat", SAT)
    tmp = Image.new("RGB", (len(rgbs), 1))
    tmp.putdata(rgbs)
    tmp = ImageEnhance.Color(tmp).enhance(sat)
    rgbs = [list(p) for p in tmp.get_flattened_data()] if hasattr(tmp, 'get_flattened_data') else [list(p) for p in tmp.getdata()]
    rgbs = contrast_stretch(rgbs, sat, stretch=entry.get("tint") is None and entry.get("autocontrast", True))
    bright = entry.get("bright", 1.0)
    grid = [[-1] * INNER for _ in range(INNER)]
    for (x, y), c in zip(coords, rgbs):
        if entry.get("tint") is None and entry.get("brownfix", True):
            c = brown_fix(c)
        c = tuple(int(max(0, min(255, v * bright))) for v in c)
        grid[y][x] = nearest_palette(c)
    return grid


def mostly_dark(grid) -> bool:
    vals = [PALETTE[i] for row in grid for i in row if i >= 0]
    lum = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in vals) / len(vals)
    return lum < 95


def add_outline(grid, idx=OUTLINE_IDX):
    n = len(grid)
    out = [row[:] for row in grid]
    for y in range(n):
        for x in range(n):
            if grid[y][x] >= 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < n and 0 <= yy < n and grid[yy][xx] >= 0:
                    out[y][x] = idx
                    break
    return out


def finish_sprite(entry: dict) -> list[list[int]]:
    inner = make_sprite(entry)
    off = (CELL - INNER) // 2
    grid = [[-1] * CELL for _ in range(CELL)]
    for y in range(INNER):
        for x in range(INNER):
            grid[y + off][x + off] = inner[y][x]
    ol = entry.get("outline", "auto")
    if ol is True or (ol == "auto" and mostly_dark(grid)):
        grid = add_outline(grid)
    return grid


# ---------------------------------------------------------------- main
def main() -> int:
    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    unknown = set(
        re.findall(r"^- (\S+\.png)\s*$",
                   (SRC_ASSETS / "dcss/TILES_UNDER_UNKNOWN_LICENSE.md").read_text(), re.M)
    ) if (SRC_ASSETS / "dcss/TILES_UNDER_UNKNOWN_LICENSE.md").exists() else set()

    cells: list[list[list[int]]] = []
    key_to_cell: dict[str, int] = {}
    item_cells: dict[str, list[int]] = {}
    cell_info: list[dict] = []
    skipped = []

    for item, entries in mapping.items():
        for e in entries:
            if os.path.basename(e["src"]) in unknown:
                skipped.append((item, e["src"], "DCSS unknown-licence list"))
                continue
            key = json.dumps({k: e.get(k) for k in ("src", "tint", "sat", "bright", "outline", "autocontrast", "brownfix")}, sort_keys=True)
            if key not in key_to_cell:
                try:
                    grid = finish_sprite(e)
                except Exception as ex:  # keep going, report at the end
                    skipped.append((item, e["src"], str(ex)))
                    continue
                key_to_cell[key] = len(cells)
                cells.append(grid)
                cell_info.append(e)
            idx = key_to_cell[key]
            if idx not in item_cells.setdefault(item, []):
                item_cells[item].append(idx)

    n = len(cells)
    rows = max(1, math.ceil(n / COLS))
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    ap = atlas.load()
    for i, grid in enumerate(cells):
        cx, cy = (i % COLS) * CELL, (i // COLS) * CELL
        for y in range(CELL):
            for x in range(CELL):
                v = grid[y][x]
                if v >= 0:
                    ap[cx + x, cy + y] = PALETTE[v] + (255,)
    OUT_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_ATLAS, optimize=True)

    # ---- verification: only palette colours + full transparency
    chk = Image.open(OUT_ATLAS).convert("RGBA")
    allowed = {p + (255,) for p in PALETTE} | {(0, 0, 0, 0)}
    bad = {c for _, c in chk.getcolors(1 << 20)} - allowed
    # pure-black opaque pixels must not exist either (black = scene background)
    assert not bad, f"non-palette colours in atlas: {sorted(bad)[:5]}"
    assert (0, 0, 0, 255) not in {c for _, c in chk.getcolors(1 << 20)}, "opaque black present"
    print(f"atlas OK: {chk.size}, {n} cells, only palette colours + transparency")

    # ---- TS
    lines = ["// GENERATED by tools/sprites/build_atlas.py. Do not edit by hand.",
             "// Atlas: apps/web/public/sprites/atlas.png, 24x24 cells, 16 colours (TempleOS/VGA palette) + transparency.",
             "// index = row * ATLAS_COLS + col (row-major). Items without an entry fall back to a coloured square.",
             "",
             f"export const SPRITE_CELL = {CELL};",
             f"export const ATLAS_COLS = {COLS};",
             f"export const ATLAS_ROWS = {rows};",
             "export const SPRITE_CELLS: Record<string, number[]> = {"]
    for item, idxs in item_cells.items():
        lines.append(f"  {json.dumps(item)}: [{', '.join(map(str, idxs))}],")
    lines.append("};")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")

    # ---- credits
    used = {}
    for item, idxs in item_cells.items():
        for i in idxs:
            e = cell_info[i]
            k = (e["source"], e["src"])
            u = used.setdefault(k, {"name": os.path.splitext(os.path.basename(e["src"]))[0],
                                    "source": e["source"], "author": e["author"], "license": e["license"],
                                    "url": e["url"], "src": e["src"], "items": [], "cells": []})
            if item not in u["items"]:
                u["items"].append(item)
            if i not in u["cells"]:
                u["cells"].append(i)
    credits = sorted(used.values(), key=lambda u: (u["license"], u["source"], u["author"], u["name"]))
    OUT_CREDITS_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_CREDITS_JSON.write_text(json.dumps({
        "note": "Every sprite in apps/web/public/sprites/atlas.png was converted by tools/sprites/build_atlas.py "
                "into a 16-colour pixel sprite (trimmed, area-downscaled, palette-mapped). Converted derivative works.",
        "sprites": credits}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    md = ["# Credits", "",
          "The sprites in `apps/web/public/sprites/atlas.png` are derived from the third-party icon sets listed below.",
          "Each was **converted to a 16-colour pixel sprite** (trimmed, area-downscaled to 20x20, mapped to the TempleOS/VGA",
          "palette, hard 1-bit alpha, optional 1 px outline) by `tools/sprites/build_atlas.py`. They are modified derivative works;",
          "the original licences apply to the respective source graphics. Machine-readable list: `docs/data/sprites-credits.json`.",
          ""]
    by_lic: dict[str, list] = {}
    for c in credits:
        by_lic.setdefault(c["license"], []).append(c)
    sources = {}
    for c in credits:
        sources.setdefault((c["license"], c["source"]), set()).add(c["author"])
    for lic, lst in by_lic.items():
        md += [f"## {lic}", ""]
        for (l2, src), authors in sorted(sources.items()):
            if l2 == lic:
                md.append(f"- **{src}** ({len(lst and [c for c in lst if c['source'] == src])} sprites) - authors: {', '.join(sorted(authors))}")
        md += ["", "| Sprite | Author | Source | Used for | Link |", "|---|---|---|---|---|"]
        for c in lst:
            md.append(f"| {c['name']} | {c['author']} | {c['source']} | {', '.join(c['items'])} | <{c['url']}> |")
        md.append("")
    md += ["---", "", "Notes:", "- CC BY: attribution required (this file). Converted to 16-colour pixel sprites; changes were made.",
           "- Noto Emoji: only the `2D/svg` artwork is used (Apache-2.0 as shipped in `2D/svg/LICENSE`); the repository root carries OFL-1.1 for the font files.",
           "- DCSS tiles: CC0; tiles listed in `TILES_UNDER_UNKNOWN_LICENSE.md` are excluded programmatically.", ""]
    OUT_CREDITS_MD.write_text("\n".join(md), encoding="utf-8")

    # ---- previews
    S = PREVIEW_SCALE
    cw = CELL * S
    prev = Image.new("RGBA", (COLS * cw, rows * cw), PREVIEW_BG)
    big = atlas.resize((atlas.width * S, atlas.height * S), Image.NEAREST)
    prev.alpha_composite(big)
    OUT_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    prev.convert("RGB").save(OUT_PREVIEW, optimize=True)

    try:
        font = ImageFont.load_default(size=11)
    except TypeError:
        font = ImageFont.load_default()
    lab_h = 26
    lab = Image.new("RGBA", (COLS * cw, rows * (cw + lab_h)), PREVIEW_BG)
    d = ImageDraw.Draw(lab)
    cell_label: dict[int, str] = {}
    for item, idxs in item_cells.items():
        for j, i in enumerate(idxs):
            cell_label.setdefault(i, f"{item}.{j}")
    for i in range(n):
        cx, cy = (i % COLS) * cw, (i // COLS) * (cw + lab_h)
        tile = big.crop(((i % COLS) * cw, (i // COLS) * cw, (i % COLS) * cw + cw, (i // COLS) * cw + cw))
        lab.alpha_composite(tile, (cx, cy))
        d.rectangle((cx, cy, cx + cw - 1, cy + cw + lab_h - 1), outline=(0x22, 0x24, 0x2c, 255))
        txt = cell_label.get(i, "?")
        d.text((cx + 3, cy + cw + 2), txt[:22], fill=(0xaa, 0xaa, 0xaa, 255), font=font)
        d.text((cx + 3, cy + cw + 13), f"#{i}", fill=(0x55, 0x55, 0x55, 255), font=font)
    lab.convert("RGB").save(OUT_LABELED, optimize=True)

    print(f"items with sprites: {len(item_cells)}, variants (item,cell) pairs: {sum(len(v) for v in item_cells.values())}, cells: {n}, rows: {rows}")
    for s in skipped:
        print("SKIPPED", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
