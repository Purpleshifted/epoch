#!/usr/bin/env python3
"""Concept figure for the 'two views' slide: what stays visible in Top/Side as time compresses.
Bar length = ORDER only (concept diagram, not numbers).

Run: env PYTHONPATH=<scratch/pylib> python3 tools/deck/make_trace_figures.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/img/deck"
OUT.mkdir(parents=True, exist_ok=True)

BG = (11, 12, 18)
TXT = (235, 236, 242)
DIM = (150, 152, 170)
GREEN = (85, 200, 85)
OCHRE = (200, 160, 90)
CYAN = (85, 255, 255)
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=6 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def fig_visibility():
    W, H = 1500, 860
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((40, 20), "Top·Side에서 오래 보이는 순서 (개념도)", font=font(38, True), fill=TXT)
    d.text((40, 72), "초록 = 먼저 사라지는 것 · 황토색 = 남는 것 · 하늘색 = 끝내 남는 것", font=font(25), fill=DIM)
    left, right, top, bottom = 400, W - 70, 150, H - 130
    # (label, end fraction 0..1, color, never ends)
    rows = [
        ("자연 (풀·동물·물)", 0.12, GREEN, False),
        ("내 발자국", 0.08, GREEN, False),
        ("길", 0.34, OCHRE, False),
        ("기초 (콘크리트)", 0.62, OCHRE, False),
        ("시추공", 0.80, OCHRE, False),
        ("크레이터", 0.92, OCHRE, False),
        ("Pu 지층선", 1.0, CYAN, True),
    ]
    n = len(rows)
    rh = (bottom - top) / n
    for i, (lab, end, col, never) in enumerate(rows):
        y0 = top + i * rh + rh * 0.22
        y1 = top + (i + 1) * rh - rh * 0.22
        x1 = left + end * (right - left)
        d.rectangle([left, y0, x1, y1], fill=col)
        d.text((left - 18, (y0 + y1) / 2), lab, font=font(30), fill=TXT, anchor="rm")
        if never:
            cy = (y0 + y1) / 2
            d.polygon([(x1 + 4, cy - 18), (x1 + 34, cy), (x1 + 4, cy + 18)], fill=col)
    d.line([left, bottom + 10, right, bottom + 10], fill=(90, 92, 120), width=3)
    d.text((left, bottom + 28), "지금", font=font(28), fill=DIM)
    d.text((right, bottom + 28), "시간이 압축된 뒤", font=font(28), fill=DIM, anchor="ra")
    d.text((W // 2, H - 52), "모바일에서는 전부 보인다 · Top·Side에서는 시간이 지나며 위에서부터 사라진다", font=font(26), fill=DIM, anchor="ma")
    im.save(OUT / "fig_visibility.png")


if __name__ == "__main__":
    fig_visibility()
    print("ok")
