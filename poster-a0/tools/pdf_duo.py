#!/usr/bin/env python3
"""Every image in the PDF as a two-ink CMYK duotone: pdf_duo.py <in.pdf> <out.pdf> [cyanShare]
K = 1 − luminance, C = cyanShare × K, M = Y = 0 — so an image black is exactly the vector ground's C·K100 and the two
never show a seam; mid-greys lean the same cool way as the ground. Alpha is kept."""
import sys, fitz, numpy as np
src, out = sys.argv[1], sys.argv[2]
share = float(sys.argv[3]) if len(sys.argv) > 3 else 0.35

def strip_icc(d):
    """PyMuPDF tags inserted images with an ICC profile; Illustrator would colour-manage that back into four inks.
    Relabel each image to the plain Device space of its channel count so the numbers are kept as they are."""
    import re
    for page in d:
        for info in page.get_images(full=True):
            xref = info[0]
            kind, val = d.xref_get_key(xref, "ColorSpace")
            text = val
            m = re.match(r"\s*(\d+) 0 R\s*$", val)
            if m: text = d.xref_object(int(m.group(1)))
            if "ICCBased" not in text: continue
            mm = re.search(r"ICCBased\s+(\d+) 0 R", text)
            n = d.xref_get_key(int(mm.group(1)), "N")[1] if mm else "3"
            d.xref_set_key(xref, "ColorSpace", {"1": "/DeviceGray", "3": "/DeviceRGB", "4": "/DeviceCMYK"}.get(n, "/DeviceRGB"))

d = fitz.open(src)
for page in d:
    for info in page.get_images(full=True):
        xref = info[0]
        pm = fitz.Pixmap(d, xref)
        if info[1]: pm = fitz.Pixmap(pm, fitz.Pixmap(d, info[1]))   # carry the soft mask along as alpha
        a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)
        n = pm.n - pm.alpha
        L = a[..., :n].astype(np.float32).mean(axis=2) if n != 4 else 255 - a[..., 3].astype(np.float32)
        K = 255 - L
        C = np.clip(K * share + .5, 0, 255)
        cmyk = np.zeros((pm.height, pm.width, 4 + pm.alpha), np.uint8)
        cmyk[..., 0] = C.astype(np.uint8); cmyk[..., 3] = (K + .5).astype(np.uint8)
        if pm.alpha: cmyk[..., 4] = a[..., n]
        newpm = fitz.Pixmap(fitz.csCMYK, pm.width, pm.height, cmyk.tobytes(), bool(pm.alpha))
        page.replace_image(xref, pixmap=newpm)
        print("duotone", xref, pm.width, "x", pm.height, "alpha", pm.alpha)
strip_icc(d)
d.save(out, garbage=3, deflate=True)
for info in fitz.open(out)[0].get_images(full=True): print("now:", info[2], "x", info[3], info[5])
