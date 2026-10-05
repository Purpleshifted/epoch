import re, json, pathlib

import sys
# usage: python3 tools/catalogue/parse_a1.py <jrc_report_text.txt>   (text extracted from the JRC PDF, EUR 29249 EN)
s = open(sys.argv[1]).read()
a = s.find("Table A1")
a = s.find("Rank Material General Name", a)
b = s.find("2. Total Abundance Europe Seasonal - Winter", a)
sec = s[a:b]
sec = re.sub(r"=====PAGE=====\s*\d+", " ", sec)
sec = re.sub(r"Rank Material General Name Litter\s+Item\s+Master List Code Number\s+of Items\s+%", " ", sec)
sec = re.sub(r"\s+", " ", sec)
sec = sec.replace("G20+G21+G22+G23+G23+G2 4", "G20+G21+G22+G23+G24")

MATS = r"(?:Foamed Plastic|Plastic/Rubber|Plastic/Glass/Cerami c|Plastic/Paper|Plastic|Metal|Glass/Ceramic|Rubber|Cloth/Textile|Paper/Cardboard|Processed/Worked Wood|Organic|Chemicals|Pollutants|Sanitary waste|unidentified)"
# a row starts with " <rank> <Material> "
starts = [m for m in re.finditer(r"(?:(?<=\s)|^)(\d{1,3}) (" + MATS + r") ", sec)]
rows = []
expected = 1
pos = []
for m in starts:
    if int(m.group(1)) == expected:
        pos.append(m)
        expected += 1
print("rows found", len(pos))
for i, m in enumerate(pos):
    end = pos[i + 1].start() if i + 1 < len(pos) else len(sec)
    chunk = sec[m.end():end].strip()
    mm = re.match(r"(.*?)\s+((?:G\d+|x_[a-z])(?:[+\-/]\s?(?:G)?\d+|[+\-/]x_[a-z])*)\s+([\d ]+?)\s+([\d.]+)\s?%\s*$", chunk)
    if not mm:
        # try code with letters like x_a only
        print("UNPARSED", m.group(1), chunk[:120])
        continue
    name, code, cnt, pct = mm.groups()
    rows.append(dict(rank=int(m.group(1)), material=m.group(2), name=name.strip(), code=code, count=int(cnt.replace(" ", "")), pct=float(pct)))

tot = sum(r["count"] for r in rows)
print("parsed", len(rows), "sum count", tot, "sum pct", round(sum(r["pct"] for r in rows), 2))
nz = [r for r in rows if r["count"] > 0]
print("non-zero", len(nz))
json.dump(rows, open(pathlib.Path(__file__).resolve().parents[2] / "docs" / "data" / "jrc-2016-table-a1.json", "w"), indent=1, ensure_ascii=False)
for r in rows[50:]:
    print(r["rank"], r["material"], "|", r["name"], "|", r["code"], r["count"], r["pct"])
