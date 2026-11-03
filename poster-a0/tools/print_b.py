#!/usr/bin/env python3
"""Turns the canvas's board B into a print page: print_b.py <Swap.dc.html> <assets.json> <out.html> [structure.png]
Sheet 851×1199 mm (trim + 5 mm bleed), the sky and the ground run to the sheet's edge, the template's own header, footer
and KAIST mark are dropped (the template .ai supplies them as vectors), the structure is the clean full-resolution render
unless a png is given, and every /_blob asset becomes a file:// path from assets.json."""
import sys, re, json
src, assets, out = sys.argv[1], sys.argv[2], sys.argv[3]
struct = sys.argv[4] if len(sys.argv) > 4 else None
s = open(src).read()
m = json.load(open(assets))
for k, v in m.items(): s = s.replace('/_blob/' + k, 'file://' + v)
if struct: s = re.sub(r'(<img class="struct" src=")[^"]+', r'\1file://' + struct, s)
s = s.replace('<script src="./support.js"></script>', '').replace('<x-dc>', '<x-dc style="display:block">').replace('<helmet>', '<helmet style="display:none">')
# the template's header, footer and mark come from the .ai
s = re.sub(r'<div style="position: absolute; left: 58.4px; top: 52px;[^>]*>2026 ID40009 Graduation Design Studio</div>', '', s)
s = re.sub(r'<img src="[^"]*" alt="KAIST"[^>]*>', '', s)
s = re.sub(r'<div style="position: absolute; left: 58.4px; top: 2290px;.*?</div>\n</div>', '', s, flags=re.S)
# bleed: a 1702×2398 sheet, the trim box 10 px in; sky and ground extended to the edge
root = re.search(r'<div style="position: relative; width: 1682px; height: 2378px; overflow: hidden; background: ([^;]+);', s)
sky = root.group(1)
s = s.replace(root.group(0), '<div style="position: relative; width: 1702px; height: 2398px; overflow: hidden; background: ' + sky + ';"><div style="position: absolute; left: 10px; top: 10px; width: 1682px; height: 2378px; overflow: visible; background: ' + sky + ';')
s = s.replace('<div class="ground" style="position: absolute; left: 0px; top: 375.8px; width: 1682px;', '<div class="ground" style="position: absolute; left: -10px; top: 375.8px; width: 1702px;')
# the ground's staircase polygon was drawn for x from 0; shift its points right by 10 px and let it run 10 px past the bottom
def shift(mm):
    pts = mm.group(1)
    def fix(p):
        x, y = p.strip().split(' ')
        return f'{float(x[:-2]) + 10:.1f}px {y}'
    return 'clip-path: polygon(' + ', '.join(fix(p) for p in pts.split(',')) + ')'
s = re.sub(r'clip-path: polygon\(([^)]+)\)', shift, s, count=1)
s = s.replace('height: 2002.2px; overflow: hidden; background: linear-gradient(180deg, #17181a 0%, #0a0a0b 100%)', 'height: 2012.2px; overflow: hidden; background: linear-gradient(180deg, #17181a 0%, #0a0a0b 100%)')
# close the extra wrapper before </x-dc>
s = s.replace('</div>\n<helmet', '</div></div>\n<helmet', 1)
open(out, 'w').write(s)
print(out, 'sky', sky, 'struct', struct or '(canvas asset)')
