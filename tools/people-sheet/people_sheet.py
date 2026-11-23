"""
people_sheet.py — real people's movement as one sprite sheet for the personal view's "2D 사람" and the lab's frames
study (bot-present, 2026-11-23).

The artist finds clips (Pexels, Vecteezy, generated: people on a green screen or a plain backdrop, silhouettes welcome)
and drops them in visual_reference_images/people_clips/ (gitignored). A clip may hold MANY people (a grid of walkers):
each is cut out on their own ("여러명 있는 건 한명씩 잘라서 써"). The name may end with a view (_back / _front /
_side / _stand); without one the view is guessed (front) — the lab's knobs set each row's state, view and mirror.

Two passes, so 4K clips fit in memory:
  1. low resolution, 30 fps: key the backdrop (frames whose backdrop is dark are skipped — a white matte on black is no
     silhouette on white paper), find the people (blobs), follow each through the frames, keep a small normalised mask
     of each person a frame; find each one's loop (a stride by the legs' rhythm, else the whole body's — a dance);
  2. full resolution: only the 16 frames a person needs, cut out in a window round them (the body nearest the window's
     middle kept, the rim tightened and coloured from inside, green spill gone), feet at the bottom.

    python3 -I tools/people-sheet/people_sheet.py <clips dir> <out dir: apps/web/public/people> [max people a clip = 16]

writes clips/<row>.png (a strip a person: 16 frames of CELL_W × CELL_H) and people.json (id, file, view guess, loop
seconds, source); the page packs the strips it uses into one texture.
Needs ffmpeg, numpy, opencv-python. Run it from a directory of its own (the clips are downloaded files).
"""

import glob
import json
import os
import re
import subprocess
import sys

import cv2
import numpy as np

COLS, CELL_W, CELL_H = 16, 128, 256
FPS = 30
LOW_H = 540


def probe(path: str) -> tuple:
    """(width, height, has an alpha channel — a ProRes 4444 / RGBA clip carries its own matte)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    line = next((l for l in out.splitlines() if "Video:" in l), "")
    m = re.search(r"(\d{2,5})x(\d{2,5})", line)
    alpha = bool(re.search(r"yuva|rgba|argb|bgra|gbrap", line))
    return int(m.group(1)), int(m.group(2)), alpha


# frames of a clip with its own matte come with that matte (the 4th channel); the backdrop then is white
MATTE = {}


def frames(path: str, h: int):
    """Decoded frames (RGB float 0 … 1; RGBA when the clip has a matte) at height h (even width), FPS a second."""
    W, H, alpha = probe(path)
    w = int(round(W * h / H / 2)) * 2
    ch = 4 if alpha else 3
    p = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-vf", f"fps={FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgba" if alpha else "rgb24", "-"], stdout=subprocess.PIPE)
    n = w * h * ch
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, ch).astype(np.float32) / 255.0
    p.wait()


def split_rgba(im: np.ndarray) -> tuple:
    """(rgb, matte or None)."""
    if im.shape[2] == 4:
        return im[..., :3], im[..., 3]
    return im, None


def backdrop(im: np.ndarray) -> np.ndarray:
    b = np.concatenate([im[:8].reshape(-1, 3), im[-8:].reshape(-1, 3), im[:, :8].reshape(-1, 3), im[:, -8:].reshape(-1, 3)])
    return np.median(b, 0)


def is_green(bg: np.ndarray) -> bool:
    return bool(bg[1] > bg[0] + 0.08 and bg[1] > bg[2] + 0.08)


def usable(bg: np.ndarray) -> bool:
    """A light or green backdrop (a dark one holds a white matte — no silhouette on white paper)."""
    return is_green(bg) or float(bg.mean()) > 0.45


def key(im: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """The body's coverage 0 … 1: far from the backdrop's colour; a green screen by green's dominance."""
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if is_green(bg):
        dom = g - np.maximum(r, b)
        return np.clip(1.0 - (dom - 0.04) / 0.10, 0, 1)
    d = np.linalg.norm(im - bg[None, None, :], axis=-1)
    return np.clip((d - 0.07) / 0.10, 0, 1)


def clean_edge(a: np.ndarray) -> np.ndarray:
    """A tighter edge (the artist: "테두리가 좀 덜 깔끔함"): the soft rim pulled in, one pixel eroded, a light blur."""
    a = np.clip((a - 0.3) / 0.6, 0, 1)
    a = cv2.erode(a, np.ones((3, 3), np.uint8))
    return cv2.GaussianBlur(a, (0, 0), 0.8)


def edge_colour(im: np.ndarray, a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """The rim's colour taken from inside the body (the backdrop mixed into it is gone), and no green spill anywhere."""
    out = im.copy()
    if is_green(bg):
        out[..., 1] = np.minimum(out[..., 1], np.maximum(out[..., 0], out[..., 2]))
    solid = (a > 0.95).astype(np.float32)
    pre = cv2.GaussianBlur(out * solid[..., None], (0, 0), 3)
    w = cv2.GaussianBlur(solid, (0, 0), 3)[..., None]
    inside = pre / np.maximum(w, 1e-4)
    rim = ((a > 0.002) & (a <= 0.95))[..., None]
    return np.where(rim & (w > 1e-3), inside, out)


def nearest_body(a: np.ndarray) -> np.ndarray:
    """In a window round one person: the blob nearest the window's middle (a neighbour reaching in is dropped)."""
    # (pieces a few pixels apart are one body: a thin ankle broken by the key left the feet behind — the dancer, 2026-11-23)
    solid = cv2.dilate((a > 0.5).astype(np.uint8), np.ones((9, 9), np.uint8))
    n, lab, stats, cents = cv2.connectedComponentsWithStats(solid, 8)
    if n <= 1:
        return a
    h, w = a.shape
    big = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 0.01 * h * w] or list(range(1, n))
    k = min(big, key=lambda i: abs(cents[i][0] - w / 2) + 0.3 * abs(cents[i][1] - h / 2))
    return a * (lab == k)


class Track:
    def __init__(self, f: int, box: tuple):
        self.frames = [f]
        self.boxes = [box]  # x0, y0, x1, y1 (low res)
        self.cuts = []  # (left, right) x where the neighbours begin (low res; ±1e9 = none)
        self.feet = []  # the feet's x (low res)
        self.masks = []

    @property
    def last(self):
        return self.boxes[-1]


def follow(path: str) -> tuple:
    """Pass 1: the people of a clip, followed through its usable frames. Returns (tracks, frame count, low size)."""
    tracks: list = []
    size = None
    count = 0
    for f, im4 in enumerate(frames(path, LOW_H)):
        count = f + 1
        im, matte = split_rgba(im4)
        H, W = im.shape[:2]
        size = (W, H)
        if matte is None:
            bg = backdrop(im)
            if not usable(bg):
                continue
            a = key(im, bg)
        else:
            a = matte
        # (pieces a pixel or two apart are one body here too: feet cut off at a thin ankle left the box short of them)
        solid = cv2.dilate((a > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
        n, lab, stats, cents = cv2.connectedComponentsWithStats(solid, 8)
        boxes = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if area < 0.0015 * H * W or h < 0.12 * H:
                continue
            boxes.extend(split_wide((x, y, x + w, y + h), a))
        boxes.sort(key=lambda b: (b[0] + b[2]) / 2)
        live = [t for t in tracks if f - t.frames[-1] <= 10]
        used = set()
        # where each person ends: halfway to the next one along the same band of the frame (people standing close)
        def cut_of(j: int) -> tuple:
            b = boxes[j]
            cx = (b[0] + b[2]) / 2
            same = [(bb[0] + bb[2]) / 2 for bb in boxes if bb is not b and abs(bb[3] - b[3]) < 0.25 * (b[3] - b[1])]
            left = max([c for c in same if c < cx], default=-1e9)
            right = min([c for c in same if c > cx], default=1e9)
            return ((cx + left) / 2 if left > -1e9 else -1e9, (cx + right) / 2 if right < 1e9 else 1e9)
        for j, b in enumerate(boxes):
            # (by the feet — the lowest tenth of the blob — which stay put while arms and a kicking leg swing out)
            cx, cy = feet_x(a, b), b[3]
            best, bd = None, 0.12 * W
            for t in live:
                if id(t) in used:
                    continue
                lb = t.last
                d = abs(t.feet[-1] - cx) + 0.5 * abs(lb[3] - cy)
                if d < bd:
                    best, bd = t, d
            if best is None:
                best = Track(f, b)
                tracks.append(best)
            else:
                best.frames.append(f)
                best.boxes.append(b)
            best.feet.append(cx)
            best.cuts.append(cut_of(j))
            used.add(id(best))
            # a small normalised mask of this person this frame (feet at the bottom), for the loop
            h = b[3] - b[1]
            w = int(h * CELL_W / CELL_H)
            x0 = int((b[0] + b[2]) / 2 - w / 2)
            m = np.zeros((h, w), np.float32)
            cl, cr = best.cuts[-1]
            xs, xe = max(0, x0, int(cl)), min(W, x0 + w, int(cr))
            if xe > xs:
                m[:, xs - x0:xe - x0] = a[b[1]:b[3], xs:xe]
            best.masks.append(cv2.resize(m, (32, 64), interpolation=cv2.INTER_AREA))
    return stitch(tracks, size[0] if size else 1), count, size


def feet_x(a: np.ndarray, b: tuple) -> float:
    """The middle of the blob's lowest tenth (the feet)."""
    x0, y0, x1, y1 = b
    y = max(y0, int(y1 - 0.1 * (y1 - y0)))
    cols = np.where(a[y:y1, x0:x1].max(0) > 0.5)[0]
    return float(x0 + cols.mean()) if len(cols) else (x0 + x1) / 2


def stitch(tracks: list, W: int) -> list:
    """A person lost for a moment (a gesture, a kick, two touching) comes back as a new track: join a track to one that
    begins soon after it ends, near where it ended."""
    tracks = sorted(tracks, key=lambda t: t.frames[0])
    out: list = []
    for t in tracks:
        host = None
        for o in out:
            gap = t.frames[0] - o.frames[-1]
            if 0 < gap <= 20 and abs(o.feet[-1] - t.feet[0]) < 0.15 * W:
                host = o
                break
        if host is None:
            out.append(t)
        else:
            host.frames += t.frames
            host.boxes += t.boxes
            host.cuts += t.cuts
            host.feet += t.feet
            host.masks += t.masks
    # a clip with one person at a time (no two pieces share a frame): all its pieces are that one person — a dancer's
    # kicks throw the feet too far for the stitch above (Johnny, 2026-11-23)
    big = [t for t in out if len(t.frames) >= 10]
    if len(big) > 1:
        seen: set = set()
        overlap = False
        for t in big:
            fs = set(t.frames)
            if seen & fs:
                overlap = True
                break
            seen |= fs
        if not overlap:
            big.sort(key=lambda t: t.frames[0])
            one = big[0]
            for t in big[1:]:
                one.frames += t.frames
                one.boxes += t.boxes
                one.cuts += t.cuts
                one.feet += t.feet
                one.masks += t.masks
            return [one]
    return out


def split_wide(b: tuple, a: np.ndarray) -> list:
    """Two or three people touching make one blob: cut it where its columns thin out (a person is ~0.45 of their height
    wide at most, arms out)."""
    x0, y0, x1, y1 = b
    h, w = y1 - y0, x1 - x0
    if w < 0.62 * h:
        return [b]
    col = a[y0:y1, x0:x1].sum(0)
    col = np.convolve(col, np.ones(9) / 9, mode="same")
    lo, hi = int(0.25 * h * 0.9), w - int(0.25 * h * 0.9)
    if hi <= lo:
        return [b]
    cut = lo + int(np.argmin(col[lo:hi]))
    left = (x0, y0, x0 + cut, y1)
    right = (x0 + cut, y0, x1, y1)
    return split_wide(left, a) + split_wide(right, a)


def loop_of(t: Track) -> tuple:
    """(start, frames a loop, how periodic, walking): a stride by the legs' rhythm when the legs really move (walking,
    running); otherwise the whole body's loop over 1.5 … 4 s (standing, talking, dancing — a short loop of a still body
    matched best and showed nothing, 2026-11-23); a long stretch when nothing repeats."""
    M = np.stack(t.masks)
    n = len(M)

    def search(X: np.ndarray, lo: int, hi: int) -> tuple:
        X = X - X.mean(1, keepdims=True)
        nrm = np.linalg.norm(X, axis=1) + 1e-6
        best = (0, max(1, min(n - 1, hi)), -1.0)
        for L in range(lo, max(lo + 1, hi)):
            if L >= n:
                break
            c = float((np.sum(X[:-L] * X[L:], 1) / (nrm[:-L] * nrm[L:])).mean())
            if c > best[2]:
                sc = [float(np.dot(X[i], X[i + L]) / (nrm[i] * nrm[i + L])) for i in range(0, n - L)]
                best = (int(np.argmax(sc[: max(1, min(len(sc), 3 * FPS))])), L, c)
        return best

    legs = M[:, 34:, :].reshape(n, -1)
    # do the legs move? (a walk swaps them every half stride; a standing body's legs hardly change)
    energy = float(np.mean(np.abs(legs[5:] - legs[:-5]))) / max(1e-4, float(np.mean(legs)))
    # (a walking stride takes 0.6 s or more — a running one ~0.7 s; a talker's weight shift matched at 0.4 s)
    if energy > 0.15:
        s0, L0, c0 = search(legs, int(0.6 * FPS), min(int(2.4 * FPS), n // 2))
        if c0 > 0.8:
            return s0, L0, c0, True
    s1, L1, c1 = search(M.reshape(n, -1), int(1.5 * FPS), min(int(4.0 * FPS), n // 2))
    if c1 > 0.6:
        return s1, L1, c1, False
    return 0, min(n - 1, int(4.0 * FPS)), c1, False


def main() -> None:
    """INCREMENTAL (the artist keeps adding clips): the sheet already in `out` is read; a clip already in it is kept as it
    is, a new clip is cut and added, a clip no longer in the folder is dropped; `--redo=<part of a name>` cuts that clip
    again. Rows stay in the clips' name order."""
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    redo = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--redo=")]
    src, out = args[0], args[1]
    per_clip = int(args[2]) if len(args) > 2 else 16
    os.makedirs(out, exist_ok=True)
    old_rows: dict = {}
    try:
        with open(os.path.join(out, "people.json")) as fi:
            old_meta = json.load(fi)
        if old_meta.get("cellW") == CELL_W and old_meta.get("cellH") == CELL_H:
            # each row from its own strip (clips/<file>.png); an older run's single people.png still read once
            whole = None
            for i, r in enumerate(old_meta["rows"]):
                img = cv2.imread(os.path.join(out, "clips", r["file"]), cv2.IMREAD_UNCHANGED) if r.get("file") else None
                if img is None:
                    if whole is None:
                        whole = cv2.imread(os.path.join(out, "people.png"), cv2.IMREAD_UNCHANGED)
                    if whole is None:
                        continue
                    img = whole[i * CELL_H:(i + 1) * CELL_H]
                rgba = np.dstack([img[..., 2], img[..., 1], img[..., 0], img[..., 3]]).astype(np.float32) / 255.0
                old_rows.setdefault(r["id"].split("#")[0], []).append((r, rgba))
    except (OSError, ValueError, KeyError):
        old_rows = {}
    rows, meta = [], []
    for path in sorted(glob.glob(os.path.join(src, "*.mp4")) + glob.glob(os.path.join(src, "*.mov"))):
        name = os.path.splitext(os.path.basename(path))[0]
        if name in old_rows and not any(r in name for r in redo):
            for r, img in old_rows[name]:
                meta.append(r)
                rows.append(img)
            print(f"{name}: kept ({len(old_rows[name])})")
            continue
        m = re.search(r"_(back|front|side|stand)$", name)
        view = m.group(1) if m else "front"
        tracks, count, (lw, lh) = follow(path)
        usable_frames = max(1, len({f for t in tracks for f in t.frames}))
        people = [t for t in tracks if len(t.frames) >= max(int(1.2 * FPS), 0.3 * usable_frames)]
        if not people and tracks:
            # nobody followed long enough (a dancer breaking into pieces in the same frame — Johnny, 2026-11-23): the
            # largest blob of each frame is the one person
            byf: dict = {}
            for t in tracks:
                for j, fr in enumerate(t.frames):
                    b = t.boxes[j]
                    area = (b[2] - b[0]) * (b[3] - b[1])
                    if fr not in byf or area > byf[fr][0]:
                        byf[fr] = (area, t, j)
            order = sorted(byf)
            if len(order) >= int(1.2 * FPS):
                _, t0, j0 = byf[order[0]]
                one = Track(order[0], t0.boxes[j0])
                one.cuts, one.feet, one.masks = [t0.cuts[j0]], [t0.feet[j0]], [t0.masks[j0]]
                for fr in order[1:]:
                    _, tt, jj = byf[fr]
                    one.frames.append(fr)
                    one.boxes.append(tt.boxes[jj])
                    one.cuts.append(tt.cuts[jj])
                    one.feet.append(tt.feet[jj])
                    one.masks.append(tt.masks[jj])
                people = [one]
        # the people in reading order (rows of the frame, then left to right), as many as asked, spread evenly
        people.sort(key=lambda t: (round(np.median([b[3] for b in t.boxes]) / (0.25 * lh)), np.median([(b[0] + b[2]) / 2 for b in t.boxes])))
        if len(people) > per_clip:
            pick = np.linspace(0, len(people) - 1, per_clip).round().astype(int)
            people = [people[i] for i in pick]
        jobs = []
        for k, t in enumerate(people):
            start, L, score, walking = loop_of(t)
            sel = [start + int(round(i * L / COLS)) for i in range(COLS)]
            idx = [t.frames[j] for j in sel]
            # the window's middle smoothed over a few frames (a kick or a swung arm does not throw the body sideways)
            cxs = np.array([(b[0] + b[2]) / 2 for b in t.boxes], np.float32)
            csm = np.convolve(np.pad(cxs, 3, mode="edge"), np.ones(7) / 7, mode="valid")
            boxes = {t.frames[j]: (t.boxes[j], t.cuts[j], float(csm[j])) for j in sel}
            seg = t.boxes[start:start + L + 1]
            hmax = max(b[3] - b[1] for b in seg)
            # the widest pose fits whole (a dancer's leg or arm out was cut at the window's sides — 2026-11-23): the window
            # is as tall as the body or as the widest pose needs; `fill` = the body's share of it (the app enlarges the
            # card by its inverse, so the body keeps its height)
            wmax = max(max(b[2] - csm[j], csm[j] - b[0]) for j, b in zip(range(start, start + L + 1), seg)) * 2
            win_h = max(hmax * 1.05, wmax * 1.1 * CELL_H / CELL_W)
            fill = hmax * 1.05 / win_h
            jobs.append((k, t, idx, boxes, (win_h, fill), L / FPS, score, walking))
        need = {f for j in jobs for f in j[2]}
        W, H, _ = probe(path)
        s = H / lh
        cells = {j[0]: np.zeros((CELL_H, CELL_W * COLS, 4), np.float32) for j in jobs}
        for f, im4 in enumerate(frames(path, H)):
            if f not in need:
                continue
            im, matte = split_rgba(im4)
            bg = backdrop(im) if matte is None else np.array([1.0, 1.0, 1.0], np.float32)
            for k, t, idx, boxes, (win_h, _), _, _, _ in jobs:
                if f not in boxes:
                    continue
                b, (cl, cr), cmid = boxes[f]
                bh = int(win_h * s)
                bw = int(bh * CELL_W / CELL_H)
                cx, bot = cmid * s, b[3] * s + 0.02 * bh
                x0, y0 = int(cx - bw / 2), int(bot - bh)
                win = np.zeros((bh, bw, 3), np.float32) + bg
                wa = np.zeros((bh, bw), np.float32)
                xs, xe, ys, ye = max(0, x0), min(W, x0 + bw), max(0, y0), min(H, y0 + bh)
                if xe <= xs or ye <= ys:
                    continue
                win[ys - y0:ye - y0, xs - x0:xe - x0] = im[ys:ye, xs:xe]
                if matte is not None:
                    wa[ys - y0:ye - y0, xs - x0:xe - x0] = matte[ys:ye, xs:xe]
                a = wa if matte is not None else key(win, bg)
                # the neighbours begin halfway to them: nothing of theirs is kept
                ax = np.arange(bw)[None, :] + x0
                a = a * ((ax >= cl * s) & (ax <= cr * s))
                a = clean_edge(nearest_body(a))
                rgb = edge_colour(win, a, bg)
                rgba = cv2.resize(np.concatenate([rgb, a[..., None]], -1), (CELL_W, CELL_H), interpolation=cv2.INTER_AREA)
                for i, ff in enumerate(idx):
                    if ff == f:
                        cells[k][:, i * CELL_W:(i + 1) * CELL_W] = rgba
        for k, t, idx, boxes, (win_h, fill), sec, score, walking in jobs:
            row = cells[k]
            al = row[..., 3:4]
            rgb = np.where(al > 0.004, row[..., :3] / np.maximum(al, 1e-3), 0.0).clip(0, 1)
            # the body's colour bled outward into the empty space (a filtered edge then mixes the body with itself, not
            # with white or black — the dark rim the artist saw, 2026-11-23)
            pre = cv2.GaussianBlur(rgb * al, (0, 0), 6)
            wgt = cv2.GaussianBlur(al[..., 0], (0, 0), 6)[..., None]
            bleed = np.where(wgt > 1e-4, pre / np.maximum(wgt, 1e-4), 1.0)
            row[..., :3] = np.where(al > 0.5, rgb, bleed).clip(0, 1)
            rows.append(row)
            rid = name if len(jobs) == 1 else f"{name}#{k + 1}"
            body = al[..., 0] > 0.6
            lum = float((row[..., :3][body] @ np.array([0.299, 0.587, 0.114])).mean()) if body.any() else 0.0
            # walking in profile (the artist: not used — front shots stand square to the way they go): the feet spread wide
            spreads = []
            for i in range(COLS):
                feet = al[int(CELL_H * 0.88):, i * CELL_W:(i + 1) * CELL_W, 0] > 0.5
                xs = np.where(feet.any(0))[0]
                if len(xs):
                    spreads.append((xs.max() - xs.min()) / CELL_H)
            # (only a walk: a dancer's kick or a talker's stance spreads the feet too)
            side = walking and bool(spreads) and float(np.percentile(spreads, 80)) > 0.24
            # which way a profile walker faces (+1 right, -1 left): the feet's middle moves forward between the sheet's
            # frames (16 a stride: the swinging foot outruns the planted one) — checked against the crowd's 8 profile
            # walkers, all facing right (2026-11-23)
            faces = 0
            if side:
                xs = []
                for i in range(COLS):
                    feet = al[int(CELL_H * 0.86):, i * CELL_W:(i + 1) * CELL_W, 0]
                    wsum = float(feet.sum())
                    xs.append(float((feet.sum(0) * np.arange(CELL_W)).sum() / wsum) if wsum > 1 else np.nan)
                dx = np.diff(np.array(xs + xs[:1]))
                dx = dx[~np.isnan(dx)]
                faces = 1 if len(dx) and float(np.median(dx)) > 0 else -1
            meta.append({"id": rid, "view": "side" if side and not m else view, "strideSec": round(sec, 3), "loop": round(score, 2), "lum": round(lum, 2), "walking": walking, "fill": round(float(fill), 3), "faces": faces, "source": name.split("-")[0].lower()})
            print(f"{rid}: {view}, loop {sec:.2f} s (periodic {score:.2f})")
    # ONE STRIP A CLIP (2026-11-23: "폴더에 넣어서 돌리면 많이 무거워지는지" → the page loads only the clips it uses and
    # packs them into one texture that fits the device; a single sheet of every clip outgrew a phone's 4096 px limit)
    os.makedirs(os.path.join(out, "clips"), exist_ok=True)
    files = set()
    for r, img in zip(meta, rows):
        r["file"] = re.sub(r"[^A-Za-z0-9_-]", "_", r["id"]) + ".png"
        files.add(r["file"])
        bgra = np.dstack([img[..., 2], img[..., 1], img[..., 0], img[..., 3]])
        cv2.imwrite(os.path.join(out, "clips", r["file"]), (bgra * 255).round().astype(np.uint8))
    for f in glob.glob(os.path.join(out, "clips", "*.png")):
        if os.path.basename(f) not in files:
            os.remove(f)
    if os.path.exists(os.path.join(out, "people.png")):
        os.remove(os.path.join(out, "people.png"))
    with open(os.path.join(out, "people.json"), "w") as fo:
        json.dump({"cols": COLS, "cellW": CELL_W, "cellH": CELL_H, "rows": meta}, fo, indent=1)
    print("rows", len(rows), "strips in", os.path.join(out, "clips"))


if __name__ == "__main__":
    main()
