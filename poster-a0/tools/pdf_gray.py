#!/usr/bin/env python3
"""Make every image in a Chrome PDF a plain DeviceGray image: pdf_gray.py <in.pdf> <out.pdf>
Chrome writes grayscale PNGs as ICC-tagged gray and SVG rasters as RGB; Illustrator turns both into four-ink CMYK, so
a black in the image no longer matches a K100 vector next to it. DeviceGray images stay K-only in a CMYK document."""
import sys, fitz
src, out = sys.argv[1], sys.argv[2]

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
        obj = d.xref_object(xref)
        if "/DeviceGray" in obj:
            continue
        pm = fitz.Pixmap(d, xref)
        if pm.n - pm.alpha == 1:           # already one channel (ICC gray): just relabel the colour space
            d.xref_set_key(xref, "ColorSpace", "/DeviceGray")
            print("relabelled", xref, pm.width, "x", pm.height)
        else:                              # RGB → gray pixels, alpha kept
            g = fitz.Pixmap(fitz.csGRAY, pm)
            page.replace_image(xref, pixmap=g)
            print("converted", xref, pm.width, "x", pm.height, "alpha", pm.alpha)
strip_icc(d)
d.save(out, garbage=3, deflate=True)
d2 = fitz.open(out)
for info in d2[0].get_images(full=True): print("now:", info[2], "x", info[3], info[5])
