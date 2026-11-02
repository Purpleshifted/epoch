#!/usr/bin/env python3
"""The structure under the ground: underground.py <alpha_rgba.png> <out.jpg> <widthMm> <heightMm> <structHmm> <structTopMm> <structCxMm> [seed]
Dark layered earth the size of the page's underground zone, lit from the surface; the keyed structure composited so its
present (world y 88) sits `structTopMm` below the surface, its top sinking INTO the soil (the first centimetres are
veiled by earth, then it clears), the bottom dimming with depth. 7 px per mm."""
import sys
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
src, out, wmm, hmm, shmm, stop, scx = sys.argv[1:8]
seed = int(sys.argv[8]) if len(sys.argv) > 8 else 3
PX = 7
W, H = int(float(wmm) * PX), int(float(hmm) * PX)
rng = np.random.default_rng(seed)
y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
x = np.linspace(0, 1, W, dtype=np.float32)[None, :]
def noise(ch, cw, w=1.0):
    return w * np.asarray(Image.fromarray(rng.random((ch + 2, cw + 2)).astype(np.float32)).resize((W, H), Image.BICUBIC))
# earth: fibres, strata bands that undulate, a warm-grey surface glow fading down, cracks
fib = noise(H // 3, W // 70) + noise(H // 10, W // 220, .6) + noise(H // 30, W // 600, .4)
fib -= fib.mean()
warp = noise(5, 3, 1.0)
bands = (np.sin((y + warp * 0.08) * 46 * np.pi) * 0.5 + 0.5) ** 6 * 0.05
glow = np.exp(-y * 9) * 0.16
base = 0.10 - 0.045 * y + glow
earth = np.clip(base + fib * 0.04 + bands, 0, 1)
# cracks: thin bright-dark lines from thresholded ridge noise
cr = noise(H // 14, W // 14) + noise(H // 40, W // 40, .7)
cr = np.abs(cr - np.median(cr))
cracks = np.clip((0.012 - cr) / 0.012, 0, 1) * 0.08
earth = np.clip(earth - cracks, 0, 1)
earth = np.repeat(earth[..., None], 3, axis=2) * np.array([1.0, 0.995, 0.98], np.float32)
# structure
st = Image.open(src).convert("RGBA")
sh = int(float(shmm) * PX); sw = int(st.width * sh / st.height)
st = st.resize((sw, sh), Image.LANCZOS)
sa = np.asarray(st).astype(np.float32) / 255
rgb, a = sa[..., :3], sa[..., 3]
FRAC = float(__import__("os").environ.get("PRESENT_FRAC", str((88 - 82.2) / 83.4)))
top_px = int(float(stop) * PX - sh * FRAC)
left_px = int(float(scx) * PX - sw / 2)
canvas = earth.copy()
y0, y1 = max(0, top_px), min(H, top_px + sh)
x0, x1 = max(0, left_px), min(W, left_px + sw)
sy0, sx0 = y0 - top_px, x0 - left_px
r = rgb[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
al = a[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
# sinking in: in the first 70 mm below the surface the earth veils the structure with its own fibre noise
yy = np.arange(y0, y1, dtype=np.float32)[:, None] / PX  # mm below the zone's top
veil = np.clip(1 - yy / 70, 0, 1) ** 1.6
soil = (fib[y0:y1, x0:x1] * 2.2 + 0.5)
veil = np.clip(veil * np.clip(soil, 0, 1.4), 0, 1)
al = al * (1 - veil)
depth = yy / (H / PX)
r = r * (1 - 0.30 * depth[..., None])
canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1] * (1 - al[..., None]) + r * al[..., None]
# light: the structure throws a faint glow into the soil around it
glowm = np.zeros((H, W), np.float32); glowm[y0:y1, x0:x1] = al
gl = np.asarray(Image.fromarray((glowm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(60))).astype(np.float32) / 255
canvas = np.clip(canvas + gl[..., None] * 0.09, 0, 1)
canvas = np.clip(canvas + rng.normal(0, 0.016, (H, W, 1)).astype(np.float32), 0, 1)
Image.fromarray((canvas * 255 + .5).astype(np.uint8)).save(out, quality=93, subsampling=0)
A = np.zeros((H, W), np.float32); A[y0:y1, x0:x1] = al
Image.fromarray((A * 255 + .5).astype(np.uint8)).save(out.replace(".jpg", "_alpha.png"))
print(out, (W, H), "struct", (sw, sh), "at", (left_px, top_px))
