"""
steps.py — WHERE BOTH FEET ARE DOWN, A CLIP (bot-present, 2026-11-24; the artist: "클립마다 양 발이 둘 다 땅에 닿았을
때 키프레임을 얼추 파악해서 걸음이랑 이동거리 비례관계를" → "1초 사이에 몇걸음인지 어림해서 그 사이를 움직이는 프레임으로").

For each strip in apps/web/public/people/clips/ (16 frames of one loop), the feet: the body's lowest alpha in the left
half and in the right half of its own columns. Both feet down = the two lowest points level (a lifted or swinging foot
leaves its half's lowest point higher, or lower when it comes at the camera). The frames where they are most level,
one a step (cyclic minima of the difference, apart by at least three frames), are written into people.json as
"ds" (frame numbers 0 … 15) and "steps" (how many a loop); a clip where none stand out gets "steps": 0.

    python3 -I tools/people-sheet/steps.py apps/web/public/people
"""

import json
import os
import sys

import cv2
import numpy as np

COLS = 16


def feet_level(cell: np.ndarray) -> float:
    """How far apart the two feet's lowest points are (px, the cell's height = 256); large when one is lifted."""
    a = cell[..., 3] > 128
    cols = np.where(a.any(0))[0]
    if len(cols) < 4:
        return 1e9
    mid = (cols[0] + cols[-1]) / 2
    low = []
    for part in (a[:, : int(mid)], a[:, int(mid):]):
        rows = np.where(part.any(1))[0]
        low.append(rows[-1] if len(rows) else -1e9)
    return abs(low[0] - low[1])


def main() -> None:
    out = sys.argv[1]
    path = os.path.join(out, "people.json")
    with open(path) as f:
        meta = json.load(f)
    cw = meta["cellW"]
    for r in meta["rows"]:
        img = cv2.imread(os.path.join(out, "clips", r["file"]), cv2.IMREAD_UNCHANGED)
        if img is None:
            continue
        d = np.array([feet_level(img[:, i * cw:(i + 1) * cw]) for i in range(COLS)], dtype=np.float64)
        spread = float(np.percentile(d, 85) - np.percentile(d, 15))
        ds: list[int] = []
        if spread >= 4:
            thr = np.percentile(d, 15) + 0.35 * spread
            for i in range(COLS):
                if d[i] <= thr and d[i] <= d[(i - 1) % COLS] and d[i] <= d[(i + 1) % COLS]:
                    if all(min(abs(i - j), COLS - abs(i - j)) >= 3 for j in ds):
                        ds.append(i)
        r["ds"] = ds
        r["steps"] = len(ds)
        print(f'{r["id"]:28s} steps {len(ds)}  ds {ds}  level {np.round(d).astype(int).tolist()}')
    with open(path, "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    main()
