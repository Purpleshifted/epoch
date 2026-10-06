#!/usr/bin/env python3
"""Figures for the artwork-explanation slides (deck). Output: docs/img/deck/*.png

Run: env PYTHONPATH=<scratch/pylib> python3 tools/deck/make_figures.py
Numbers come from the code, not from memory:
  - clock          apps/web/src/lib/stratum/geoClock.ts   years = (1+t)^a - 1,  a = log10(1+1e6)/log10(1+28800)
  - persistence    apps/web/src/lib/stratum/materials.ts  (EST. ranges)
  - sprite cells   apps/web/src/lib/stratum/sprites.data.ts + apps/web/public/sprites/atlas.png
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/img/deck"
OUT.mkdir(parents=True, exist_ok=True)

BG = (11, 12, 18)
PANEL = (28, 29, 44)
TXT = (235, 236, 242)
DIM = (150, 152, 170)
CYAN = (85, 255, 255)
GREEN = (85, 255, 85)
YELLOW = (255, 255, 85)
RED = (255, 85, 85)
PAL = ["000000", "0000aa", "00aa00", "00aaaa", "aa0000", "aa00aa", "aa5500", "aaaaaa",
       "555555", "5555ff", "55ff55", "55ffff", "ff5555", "ff55ff", "ffff55", "ffffff"]
PAL = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in PAL]

FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=6 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


A = math.log10(1 + 1e6) / math.log10(1 + 28800)


def seconds_for_years(y):
    return (1 + y) ** (1 / A) - 1


# ───────────────────────── Fig A: how long until it vanishes ─────────────────────────
MATS = [  # (label, years lo, years hi, natural?)
    ("종이·판지", 0.1, 2, True),
    ("연한 유기물 (음식)", 0.005, 1, True),
    ("담배 필터", 2, 20, False),
    ("비닐 (필름·봉지)", 10, 300, False),
    ("단단한 플라스틱", 100, 1200, False),
    ("금속 캔·뚜껑", 50, 600, False),
    ("뼈", 20, 5000, True),
    ("조개껍데기", 100, 1e5, True),
    ("이빨", 500, 1e6, True),
    ("유리·도자기", 1e3, 1e6, False),
]


def fig_lifespan():
    W, H = 1760, 700
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    left, right, top, bottom = 330, W - 40, 70, H - 90
    lo, hi = math.log10(0.003), math.log10(28800 * 1.4)

    def X(sec):
        return left + (math.log10(sec) - lo) / (hi - lo) * (right - left)

    # visitor lifespan band
    d.rectangle([X(10), top, X(180), bottom], fill=(30, 40, 60))
    d.text((X(10) + 8, top + 6), "방문자 수명(계획) 10초–3분", font=font(24, True), fill=CYAN)
    # grid + ticks
    ticks = [(0.01, "0.01초"), (0.1, "0.1초"), (1, "1초"), (10, "10초"), (60, "1분"),
             (3600, "1시간"), (28800, "8시간")]
    for s, lab in ticks:
        x = X(s)
        d.line([x, top, x, bottom], fill=(55, 57, 78), width=2)
        d.text((x, bottom + 10), lab, font=font(24), fill=DIM, anchor=("ra" if s == 28800 else "ma"))
    n = len(MATS)
    rowh = (bottom - top) / n
    for i, (lab, ylo, yhi, nat) in enumerate(MATS):
        y0 = top + i * rowh + rowh * 0.2
        y1 = top + (i + 1) * rowh - rowh * 0.2
        col = GREEN if nat else CYAN
        s_lo, s_hi = seconds_for_years(ylo), seconds_for_years(yhi)
        x0, x1 = X(max(s_lo, 0.003)), X(min(s_hi, 28800))
        d.rectangle([x0, y0, max(x1, x0 + 6), y1], fill=col)
        d.text((left - 14, (y0 + y1) / 2), lab, font=font(27), fill=TXT, anchor="rm")
    d.text((left, 18), "물건이 놓인 뒤 사라질 때까지의 실제 시간 (로그 축)  ·  초록 = 자연 유래, 하늘색 = 인공", font=font(28, True), fill=TXT)
    d.text((W - 40, H - 28), "막대 = 재질별 수명 범위(추정) → 시계로 환산. 같은 재질 안에서도 물건마다 하나로 정해짐", font=font(22), fill=DIM, anchor="rm")
    im.save(OUT / "fig_lifespan.png")


# ───────────────────────── Fig B: stages of one sprite ─────────────────────────
def load_cell(idx):
    atlas = Image.open(ROOT / "apps/web/public/sprites/atlas.png").convert("RGBA")
    cols = 16
    cx, cy = (idx % cols) * 24, (idx // cols) * 24
    return atlas.crop((cx, cy, cx + 24, cy + 24))


def dim_rgb(rgb):
    idx = min(range(16), key=lambda k: sum((a - b) ** 2 for a, b in zip(PAL[k], rgb)))
    if 9 <= idx <= 14:
        n = idx - 8
    elif idx == 15:
        n = 7
    elif idx == 7:
        n = 8
    elif idx == 8:
        n = 0
    else:
        n = 8
    return PAL[n]


def stage(sprite, kind):
    px = sprite.load()
    out = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    po = out.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            c = (r, g, b)
            chk = (x + y) % 2 == 0
            if kind == "fresh":
                po[x, y] = (r, g, b, 255)
            elif kind == "weathered":
                po[x, y] = (*(dim_rgb(c) if chk else c), 255)
            elif kind == "fragmented":
                if not chk:
                    po[x, y] = (*dim_rgb(c), 255)
            elif kind == "buried":
                po[x, y] = (*dim_rgb(c), 255)
            elif kind == "fossil":
                po[x, y] = (r, g, b, 255)
    if kind == "fossil":  # white outline
        base = out.copy()
        bp = base.load()
        for y in range(out.height):
            for x in range(out.width):
                if bp[x, y][3] == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < out.width and 0 <= ny < out.height and bp[nx, ny][3]:
                            po[x, y] = (255, 255, 255, 255)
                            break
    return out


def fig_stages():
    items = [("bottle_drink", 43), ("can_drink", 85), ("smartphone", 104)]
    stages = [("fresh", "신선", "수명의 15% 미만"), ("weathered", "풍화", "15–50%  체커 디더"),
              ("fragmented", "부서짐", "50% 이상  어둡게 + 디더"), ("buried", "매몰", "퇴적물 아래  어둡게"),
              ("fossil", "화석", "50년+ 묻힘 & 확률  흰 외곽선")]
    S = 7
    cellw, cellh = 340, 24 * S + 30
    W, H = 160 + cellw * len(stages), 90 + cellh * len(items) + 80
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    for j, (k, ko, rule) in enumerate(stages):
        x = 160 + j * cellw + cellw // 2
        d.text((x, 14), ko, font=font(34, True), fill=CYAN, anchor="ma")
        d.text((x, 56), rule, font=font(21), fill=DIM, anchor="ma")
    for i, (name, idx) in enumerate(items):
        spr = load_cell(idx)
        y = 100 + i * cellh
        d.text((14, y + 24 * S // 2), name, font=font(24), fill=DIM, anchor="lm")
        for j, (k, _, _) in enumerate(stages):
            st = stage(spr, k).resize((24 * S, 24 * S), Image.NEAREST)
            x = 160 + j * cellw + (cellw - 24 * S) // 2
            d.rectangle([x - 6, y - 6, x + 24 * S + 6, y + 24 * S + 6], fill=(5, 6, 10))
            im.paste(st, (x, y), st)
    d.text((W // 2, H - 52), "사라짐(수명 100% 도달)은 그리지 않는다 · 단계는 같은 스프라이트에 명도와 디더만 바꿔 표현 (모양은 그대로)",
           font=font(24), fill=DIM, anchor="ma")
    im.save(OUT / "fig_stages.png")


# ───────────────────────── Fig C: natural field wear / recovery (concept) ─────────────────────────
def simulate(load_windows, steps=360, memory=True):
    F, M, cum = 0.9, 1.0, 0.0
    r0, eps, s, p50 = 0.035, 0.0015, 0.09, 1.0
    out = []
    for t in range(steps):
        load = 1.0 if any(a <= t < b for a, b in load_windows) else 0.0
        cum += load
        M = 1.0 / (1.0 + cum / 140.0) if memory else 1.0
        P = load * 3.0
        dF = r0 * M * F * (1 - F) * (1.0 if F > 0.12 else 0.15) + eps * M - s * F * P / (P + p50) * load
        F = min(1.0, max(0.0, F + dF))
        out.append(F)
    return out


def fig_wear():
    W, H = 1760, 640
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((40, 16), "자연 필드(예: 거머리말) 밀도 — 같은 땅, 다른 과거", font=font(32, True), fill=TXT)
    d.text((W - 40, 20), "설계 개념도 · 곡선 모양은 설명용 · 수치는 가정 · 아직 구현 전", font=font(23), fill=YELLOW, anchor="ra")
    steps = 360
    panels = [
        ("① 가볍게 지나감", "조금 줄었다가 곧 회복", [(60, 75)], GREEN),
        ("② 오래 머문 뒤 떠남", "많이 줄고, 회복은 느리다", [(60, 150)], YELLOW),
        ("③ 자주 되돌아와 오래 머묾", "과거 부하가 쌓여 회복이 더 늦어짐", [(60, 150), (200, 290)], RED),
    ]
    pw, gap = 540, 50
    for i, (title, sub, win, col) in enumerate(panels):
        left = 60 + i * (pw + gap)
        right, top, bottom = left + pw, 150, H - 90

        def X(t):
            return left + t / (steps - 1) * pw

        def Y(f):
            return bottom - f * (bottom - top)

        d.text((left, 82), title, font=font(30, True), fill=col)
        d.text((left, 118), sub, font=font(23), fill=DIM)
        d.rectangle([left, top, right, bottom], outline=(70, 72, 98), width=2)
        for f in (0, 0.5, 1.0):
            d.line([left, Y(f), right, Y(f)], fill=(40, 42, 60), width=1)
            d.text((left - 8, Y(f)), f"{f:.1f}", font=font(21), fill=DIM, anchor="rm")
        for a, b in win:
            d.rectangle([X(a), top, X(b), bottom], fill=(30, 33, 52))
            d.text(((X(a) + X(b)) / 2, bottom + 12), "밟힘·머묾", font=font(21), fill=DIM, anchor="ma")
        ys = simulate(win, steps, True)
        d.line([(X(t), Y(v)) for t, v in enumerate(ys)], fill=col, width=6)
    d.text((W // 2, H - 34), "회복 속도 = 기본 속도 × 과거 부하 기억 (Carr 외 2010: 해초는 과거 피복에 따라 두 상태로 갈릴 수 있음)", font=font(23), fill=DIM, anchor="ma")
    im.save(OUT / "fig_wear.png")


if __name__ == "__main__":
    fig_lifespan()
    fig_stages()
    fig_wear()
    print("figures:", sorted(p.name for p in OUT.glob("fig_*.png")))
