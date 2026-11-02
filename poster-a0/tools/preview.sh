#!/bin/zsh
# Renders poster-a0/out/<name>.html to a small preview JPEG with the layout Chrome on :9334.
#   poster-a0/tools/preview.sh <name> <out.jpg> [widthPx]
HERE=${0:A:h}
name=$1; out=$2; w=${3:-1100}
export CDP_PORT=9334
node $HERE/cdp.mjs nav "file://$HERE/../out/$name.html" >/dev/null
node $HERE/cdp.mjs eval "document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))).then(()=>document.fonts.size)" >/dev/null
node $HERE/cdp.mjs shot "$out.png" >/dev/null
python3 -c "
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
im=Image.open('$out.png').convert('RGB'); print(im.size)
im.thumbnail(($w,$w*2)); im.save('$out',quality=85)
import os; os.remove('$out.png')"
