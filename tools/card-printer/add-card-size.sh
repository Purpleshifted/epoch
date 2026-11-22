#!/bin/sh
# Adds the specimen card's paper, 54 × 86 mm, to the NIIMBOT B21 Pro's paper sizes, so the browser's print dialog lists
# it ("54mmx86mm") — the way 출력하기 prints when the print helper (server.mjs) is not running. The card's page is always
# 54 × 86: a landscape card is stood up on it (SpecimenCard printInBrowser), as the helper does. Run once on the
# machine with the printer (it changes the printer's description, so it needs the admin password):
#   sudo sh tools/card-printer/add-card-size.sh            (PRINTER=<queue> for another queue; DEFAULT=1 also makes it the default)
# The printer's description before the change is kept beside it (<queue>.ppd.before-card). Again: says it is there.
set -e
P="${PRINTER:-NIIMBOT_B21_Pro}"
SRC="/etc/cups/ppd/$P.ppd"
[ -f "$SRC" ] || { echo "no printer description at $SRC"; exit 1; }
if grep -q "w153h244" "$SRC"; then echo "54mmx86mm is already there"; else
  TMP=$(mktemp /tmp/card-ppd.XXXXXX)
  # each list gets the card's size after its last entry (54 mm = 153 pt, 86 mm = 244 pt)
  awk '
    function after(kind) { last[kind] = NR }
    { line[NR] = $0 }
    /^\*PageSize w[0-9]+h[0-9]+\//       { after("PageSize") }
    /^\*PageRegion w[0-9]+h[0-9]+\//     { after("PageRegion") }
    /^\*ImageableArea w[0-9]+h[0-9]+\//  { after("ImageableArea") }
    /^\*PaperDimension w[0-9]+h[0-9]+\// { after("PaperDimension") }
    END {
      for (i = 1; i <= NR; i++) {
        print line[i]
        if (i == last["PageSize"])       print "*PageSize w153h244/54mmx86mm: \"<</PageSize[153 244]/ImagingBBox null>>setpagedevice\""
        if (i == last["PageRegion"])     print "*PageRegion w153h244/54mmx86mm: \"<</PageSize[153 244]/ImagingBBox null>>setpagedevice\""
        if (i == last["ImageableArea"])  print "*ImageableArea w153h244/54mmx86mm: \"0 0 153 244\""
        if (i == last["PaperDimension"]) print "*PaperDimension w153h244/54mmx86mm: \"153 244\""
      }
    }' "$SRC" > "$TMP"
  n=$(grep -c "w153h244" "$TMP" || true)
  [ "$n" -eq 4 ] || { echo "could not place the size ($n of 4 lists) — nothing changed"; rm -f "$TMP"; exit 1; }
  cp "$SRC" "$SRC.before-card"
  lpadmin -p "$P" -P "$TMP"
  rm -f "$TMP"
  echo "added 54mmx86mm to $P"
fi
if [ -n "$DEFAULT" ]; then lpadmin -p "$P" -o PageSize=w153h244 && echo "54mmx86mm is now $P's default"; fi
lpoptions -p "$P" -l | grep -i "^PageSize" | tr ' ' '\n' | grep -i "w153h244" >/dev/null && echo "the printer lists it: choose 54mmx86mm in the print dialog (margins none, scale default)"
