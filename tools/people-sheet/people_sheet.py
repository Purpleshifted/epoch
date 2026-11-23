"""
people_sheet.py — real people's walks as one sprite sheet for the personal view's "2D 사람" (bot-present, 2026-11-23).

The artist finds clips (Pexels and the like: one person, head to foot, on a green screen or a plain backdrop) and drops
them in visual_reference_images/people_clips/ (gitignored). The file name says the view, at its end:
    pexels-31899051_back.mp4    walking away (seen from behind)
    ..._front.mp4               walking towards the camera
    ..._side.mp4                walking across (any way; the app mirrors it)
    ..._stand.mp4               standing, a gesture (looped back and forth)
    ..._back_props.mp4          + "_props": something that never moves stands at the feet (a treadmill) — dropped
Each clip becomes one row of the sheet: the person cut out (the backdrop's colour keyed away, only the largest body
kept, thin bars at the feet opened away), one stride found by the legs' own rhythm (or the clip's span when standing),
16 frames in a common box with the feet at the bottom, colour white where there is no body (the app multiplies the
sheet onto the white ground).

    python3 -I tools/people-sheet/people_sheet.py <clips dir> <out dir: apps/web/public/people>

writes people.png (16 × 96 px wide, 192 px a row) and people.json (rows: id, view, seconds a stride, source). Needs
ffmpeg, numpy, opencv-python. Run it from a directory of its own (the clips are downloaded files).
"""

import glob
import json
import os
import re
import subprocess
import sys
import tempfile

import cv2
import numpy as np

COLS, CELL_W, CELL_H = 16, 160, 320
FPS = 25


def frames_of(path: str, tmp: str) -> list:
    out = os.path.join(tmp, "f%04d.png")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-vf", f"fps={FPS},scale=-2:800", out], check=True)
    return [cv2.imread(f)[:, :, ::-1].astype(np.float32) / 255.0 for f in sorted(glob.glob(os.path.join(tmp, "f*.png")))]


def key(im: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """The body's coverage 0 … 1: far from the backdrop's colour; a green screen by green's dominance."""
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if bg[1] > bg[0] + 0.08 and bg[1] > bg[2] + 0.08:
        dom = g - np.maximum(r, b)
        return np.clip(1.0 - (dom - 0.04) / 0.10, 0, 1)
    d = np.linalg.norm(im - bg[None, None, :], axis=-1)
    return np.clip((d - 0.07) / 0.10, 0, 1)


def body_only(a: np.ndarray) -> np.ndarray:
    """The largest blob; below the knees thin things (a treadmill's bars, cables) are opened away first."""
    solid = (a > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
    if n <= 1:
        return a
    k = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    blob = (lab == k).astype(np.uint8)
    ys = np.where(blob.any(1))[0]
    y0, y1 = ys.min(), ys.max()
    cut = int(y0 + (y1 - y0) * 0.8)
    low = cv2.morphologyEx(blob[cut:], cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    blob2 = blob.copy()
    blob2[cut:] = low
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(blob2, 8)
    if n2 > 1:
        k2 = 1 + np.argmax(stats2[1:, cv2.CC_STAT_AREA])
        blob2 = (lab2 == k2).astype(np.uint8)
    keep = cv2.dilate(blob2, np.ones((5, 5), np.uint8))
    return a * keep


def clean_edge(a: np.ndarray) -> np.ndarray:
    """A tighter edge (the artist, 2026-11-23: "테두리가 좀 덜 깔끔함"): the soft rim pulled in, one pixel eroded, a light
    blur so the outline is smooth, not stepped."""
    a = np.clip((a - 0.3) / 0.6, 0, 1)
    a = cv2.erode(a, np.ones((3, 3), np.uint8))
    return cv2.GaussianBlur(a, (0, 0), 0.8)


def edge_colour(im: np.ndarray, a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """The rim's colour taken from inside the body (the backdrop mixed into it is gone), and no green spill anywhere."""
    out = im.copy()
    if bg[1] > bg[0] + 0.08 and bg[1] > bg[2] + 0.08:
        out[..., 1] = np.minimum(out[..., 1], np.maximum(out[..., 0], out[..., 2]))
    solid = (a > 0.95).astype(np.float32)
    pre = cv2.GaussianBlur(out * solid[..., None], (0, 0), 3)
    w = cv2.GaussianBlur(solid, (0, 0), 3)[..., None]
    inside = pre / np.maximum(w, 1e-4)
    rim = ((a > 0.002) & (a <= 0.95))[..., None]
    return np.where(rim & (w > 1e-3), inside, out)


def stride(M: np.ndarray) -> tuple:
    """(start, frames a full stride): the legs' silhouette against itself; the best lag in 0.5 … 2.4 s."""
    H = M.shape[1]
    legs = M[:, int(H * 0.55):, :].reshape(len(M), -1)
    legs = legs - legs.mean(1, keepdims=True)
    nrm = np.linalg.norm(legs, axis=1) + 1e-6
    lags = range(int(0.5 * FPS), min(int(2.4 * FPS), len(M) // 2))
    score = []
    for L in lags:
        c = np.sum(legs[:-L] * legs[L:], 1) / (nrm[:-L] * nrm[L:])
        score.append(float(c.mean()))
    P = list(lags)[int(np.argmax(score))]
    # the start: the frame whose stride later matches best
    s = [float(np.dot(legs[i], legs[i + P]) / (nrm[i] * nrm[i + P])) for i in range(0, len(M) - P)]
    return int(np.argmax(s[: max(1, min(len(s), 3 * FPS))])), P


def row_of(path: str, view: str, props: bool) -> tuple:
    with tempfile.TemporaryDirectory() as tmp:
        ims = frames_of(path, tmp)
    border = np.concatenate([ims[0][:12].reshape(-1, 3), ims[0][:, :12].reshape(-1, 3), ims[0][:, -12:].reshape(-1, 3)])
    bg = np.median(border, 0)
    K = [key(im, bg) for im in ims]
    # what never moves near the feet is not the person (a treadmill, a stand, a cable): below 78 % of the body's height,
    # a pixel that stays as the clip's median picture is dropped — the feet and the swinging legs come and go
    # (only for clips tagged _props: a still dark shoe would go too)
    if props:
        med = np.median(np.stack(ims[::3]), 0)
        ys = np.where(np.stack(K).max(0).max(1) > 0.5)[0]
        cut = int(ys.min() + (ys.max() - ys.min()) * 0.78) if len(ys) else len(K[0])
        for im, a in zip(ims, K):
            still = np.linalg.norm(im[cut:] - med[cut:], axis=-1) < 0.08
            a[cut:][still] = 0
    M = np.stack([clean_edge(body_only(a)) for a in K])
    if view == "stand":
        start, P = 0, len(M) - 1
    else:
        start, P = stride(M)
    idx = [start + int(round(i * P / COLS)) for i in range(COLS)]
    ys, xs = np.where(M[start:start + P + 1].max(0) > 0.3)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    bh = y1 - y0 + 8
    bw = bh * CELL_W / CELL_H
    cx = (x0 + x1) / 2
    H, W = M.shape[1:]
    row = np.zeros((CELL_H, CELL_W * COLS, 4), np.float32)
    for i, j in enumerate(idx):
        im = ims[j].copy()
        im = edge_colour(im, M[j], bg)
        rgba = np.concatenate([im, M[j][..., None]], -1)
        pad = np.zeros((H + 800, W + 1600, 4), np.float32)
        pad[400:400 + H, 800:800 + W] = rgba
        ya, xa = int(400 + y0 - 4), int(800 + cx - bw / 2)
        crop = pad[ya:ya + int(bh), xa:xa + int(bw)]
        row[:, i * CELL_W:(i + 1) * CELL_W] = cv2.resize(crop, (CELL_W, CELL_H), interpolation=cv2.INTER_AREA)
    a = row[..., 3:4]
    row[..., :3] = np.where(a > 0.004, row[..., :3] / np.maximum(a, 1e-3), 1.0).clip(0, 1)
    return row, P / FPS


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    rows, meta = [], []
    for path in sorted(glob.glob(os.path.join(src, "*.mp4")) + glob.glob(os.path.join(src, "*.mov"))):
        name = os.path.splitext(os.path.basename(path))[0]
        m = re.search(r"_(back|front|side|stand)(_props)?$", name)
        view = m.group(1) if m else "back"
        row, sec = row_of(path, view, bool(m and m.group(2)))
        rows.append(row)
        # the source is the name's first word (pexels-…, vecteezy-…, gemini-…): Vecteezy's free licence asks for a credit
        meta.append({"id": name, "view": view, "strideSec": round(sec, 3), "source": name.split("-")[0].lower()})
        print(f"{name}: {view}, stride {sec:.2f} s")
    sheet = np.concatenate(rows, 0)
    bgra = np.dstack([sheet[..., 2], sheet[..., 1], sheet[..., 0], sheet[..., 3]])
    cv2.imwrite(os.path.join(out, "people.png"), (bgra * 255).round().astype(np.uint8))
    with open(os.path.join(out, "people.json"), "w") as f:
        json.dump({"cols": COLS, "cellW": CELL_W, "cellH": CELL_H, "rows": meta}, f, indent=1)
    print("rows", len(rows), "sheet", sheet.shape)


if __name__ == "__main__":
    main()
