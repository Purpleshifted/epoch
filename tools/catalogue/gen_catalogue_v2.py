"""Build docs/catalogue-v2.md, docs/data/catalogue-v2.json and
apps/web/src/lib/stratum/items.data.ts from the full JRC table.

Run from anywhere:  python3 tools/catalogue/gen_catalogue_v2.py

Layer A  = JRC 2016 Annex II Table A1 (all non-zero rows), grouped into sprite items (measured).
Layer B  = electronics (authored weights, EST.)  -- the JRC beach data has ~0 electronics.
Layer C  = anthropogenic organics: food, bones, shells, charcoal (authored weights, EST.)
Layer N  = natural stock, not scattered; shrinks as visitors walk (authored, EST.)

`parse_a1.py` (same folder) extracts docs/data/jrc-2016-table-a1.json from the JRC PDF text.
"""
import json, re, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs"
(OUT / "data").mkdir(parents=True, exist_ok=True)

rows = json.load(open(OUT / "data" / "jrc-2016-table-a1.json"))

# ---------------------------------------------------------------- layer A groups
# gid: (label, material, [first-code numbers or x_ codes])
G = {
 "frag_small":   ("plastic pieces 0–2.5 cm", "plastic_fragment", ["G75"]),
 "frag_mid":     ("plastic pieces 2.5–50 cm", "plastic_fragment", ["G76"]),
 "frag_large":   ("plastic pieces > 50 cm", "plastic_fragment", ["G77"]),
 "foam_pieces":  ("foam / polystyrene pieces and packaging", "plastic_foam", ["G74","G38","G58","x_p","x_n","x_o"]),
 "foam_sponge":  ("foam sponge", "plastic_foam", ["G73"]),
 "plastic_other":("other identifiable plastic item", "plastic_rigid", ["G124"]),
 "string":       ("string and cord (< 1 cm)", "plastic_cordage", ["G50"]),
 "rope":         ("rope (> 1 cm)", "plastic_cordage", ["G49","G48"]),
 "net_pieces":   ("nets, net pieces, tangled nets", "plastic_cordage", ["G53","G54","G52","G51","G56","G45"]),
 "fishing_line": ("fishing line / monofilament", "plastic_cordage", ["G59","G55"]),
 "strapping":    ("strapping bands", "plastic_cordage", ["G66"]),
 "cable_tie":    ("cable ties", "plastic_rigid", ["G93"]),
 "six_pack":     ("six-pack rings / yokes", "plastic_film", ["G1"]),
 "cap_plastic":  ("plastic caps, lids, rings", "plastic_rigid", ["G20"]),
 "cap_metal":    ("metal bottle caps, lids, pull tabs", "metal_can", ["G178"]),
 "cotton_bud":   ("cotton bud sticks (incl. sanitary mix)", "plastic_rigid", ["G95"]),
 "cutlery":      ("cutlery, trays", "plastic_rigid", ["G34"]),
 "straw":        ("straws, stirrers", "plastic_rigid", ["G35"]),
 "lighter":      ("cigarette lighters", "plastic_rigid", ["G26"]),
 "pen":          ("pens and pen lids", "plastic_rigid", ["G28"]),
 "comb_glasses": ("combs, hair brushes, sunglasses", "plastic_rigid", ["G29"]),
 "toy":          ("toys, party poppers", "plastic_rigid", ["G32"]),
 "cup":          ("cups and cup lids", "plastic_rigid", ["G33"]),
 "food_box":     ("food containers incl. fast food", "plastic_rigid", ["G10"]),
 "shotgun":      ("shotgun cartridges", "plastic_rigid", ["G70"]),
 "light_stick":  ("light sticks (tubes with fluid)", "plastic_rigid", ["G60"]),
 "tobacco_pack": ("tobacco pouches / plastic cigarette packaging", "plastic_film", ["G25"]),
 "syringe":      ("syringes, needles", "plastic_rigid", ["G99"]),
 "med_container":("medical / pharmaceutical containers, tubes", "plastic_rigid", ["G100"]),
 "bottle_drink": ("plastic beverage bottles", "plastic_rigid", ["G6","G7","G8"]),
 "bottle_clean": ("cleaner bottles and containers", "plastic_rigid", ["G9"]),
 "bottle_cosm":  ("cosmetic / sunscreen bottles", "plastic_rigid", ["G11","G12"]),
 "bottle_other": ("other bottles, oil bottles, jerry cans, injection-gun tubes", "plastic_rigid", ["G13","G14","G15","G16","G17"]),
 "bucket":       ("buckets", "plastic_rigid", ["G65"]),
 "crate":        ("plastic crates, baskets", "plastic_rigid", ["G18"]),
 "bag":          ("plastic bags", "plastic_film", ["G2","G3","G4","G5"]),
 "wrapper":      ("crisp packets, sweet wrappers", "plastic_film", ["G30"]),
 "lolly_stick":  ("lolly sticks", "plastic_rigid", ["G31"]),
 "sheet":        ("sheets, industrial packaging, sheeting", "plastic_film", ["G67","G47"]),
 "mesh_bag":     ("mesh vegetable bags", "plastic_film", ["G37"]),
 "feed_bag":     ("fertiliser / animal-feed bags", "plastic_film", ["G36"]),
 "dog_bag":      ("dog-faeces bags", "plastic_film", ["G101"]),
 "tape":         ("masking tape", "plastic_film", ["G87"]),
 "glove":        ("gloves", "plastic_film", ["G40","G41","G39"]),
 "towel":        ("sanitary towels, liners", "composite_misc", ["G96"]),
 "tampon":       ("tampons and applicators", "textile", ["G144"]),
 "diaper":       ("diapers, nappies", "composite_misc", ["G98"]),
 "hygiene_misc": ("other hygiene (tissue, razors)", "composite_misc", ["x_a"]),
 "fresheners":   ("toilet fresheners", "plastic_rigid", ["G97"]),
 "medical_other":("other medical items (swabs, plasters)", "composite_misc", ["G211"]),
 "shoe_plastic": ("plastic shoes, sandals, flip-flops", "plastic_rigid", ["G71","G102"]),
 "helmet":       ("hard hats", "plastic_rigid", ["G69"]),
 "float_buoy":   ("floats, buoys", "plastic_rigid", ["G62","G63"]),
 "fishing_gear": ("plastic fishing gear (pots, tags, trays, holders)", "plastic_rigid", ["G42","G43","G44","G46","G57","G61","G91","G92"]),
 "car_part":     ("car parts", "plastic_rigid", ["G19"]),
 "fibreglass":   ("fibreglass fragments", "plastic_fragment", ["G68"]),
 "cone":         ("traffic cones", "plastic_rigid", ["G72"]),
 "flower_pot":   ("plastic flower pots", "plastic_rigid", ["G90"]),
 "plastic_constr":("plastic construction waste", "plastic_rigid", ["G89"]),
 "acetate_butt": ("cigarette butts and filters", "acetate_filter", ["G27"]),
 "wax":          ("paraffin / wax", "wax", ["G213","x_b"]),
 "balloon":      ("balloons and balloon sticks", "rubber", ["G125"]),
 "ball":         ("balls", "rubber", ["G126"]),
 "rubber_piece": ("rubber pieces, inner tubes, wheels", "rubber", ["G134","G129","G130","G132"]),
 "tyre":         ("tyres and belts", "rubber", ["G128"]),
 "rubber_boot":  ("rubber boots", "rubber", ["G127"]),
 "condom":       ("condoms", "rubber", ["G133"]),
 "rubber_band":  ("rubber bands", "rubber", ["G131"]),
 "paper_misc":   ("other paper items, paper fragments", "paper", ["G158","G146","G156","G157"]),
 "cig_pack":     ("cigarette packets", "paper", ["G152"]),
 "paper_cup":    ("paper cups, trays, wrappers, packaging", "paper", ["G153","G149"]),
 "carton":       ("cartons / tetrapack", "paper", ["G151","G150"]),
 "cardboard":    ("cardboard boxes and fragments", "paper", ["G148"]),
 "newspaper":    ("newspapers, magazines, firework tubes", "paper", ["G154","G155"]),
 "paper_bag":    ("paper bags", "paper", ["G147"]),
 "wood_piece":   ("worked wood pieces", "wood_worked", ["G171","G172","G170","G173"]),
 "wood_stick":   ("ice-cream sticks, chopsticks, toothpicks", "wood_worked", ["G165"]),
 "cork":         ("corks", "wood_worked", ["G159"]),
 "pallet":       ("pallets, crates, boards, timber", "wood_worked", ["G160","G161","G162","G163","G164","G168","G169"]),
 "brush":        ("paint brushes", "wood_worked", ["G166"]),
 "match":        ("matches, fireworks", "wood_worked", ["G167"]),
 "clothing":     ("clothing, rags, hats, towels", "textile", ["G135","G136","G137","G145"]),
 "shoe_textile": ("shoes and sandals (leather, cloth)", "textile", ["G138"]),
 "carpet":       ("carpet, furnishing", "textile", ["G141"]),
 "sacking":      ("sacking, canvas, sails", "textile", ["G140","G143"]),
 "textile_bag":  ("backpacks and bags", "textile", ["G139"]),
 "textile_rope": ("textile rope, string, nets", "textile", ["G142"]),
 "glass_bottle": ("glass / ceramic bottles incl. pieces", "glass", ["G200"]),
 "glass_jar":    ("jars incl. pieces", "glass", ["G201"]),
 "glass_frag":   ("glass or ceramic fragments", "glass", ["G208"]),
 "glass_other":  ("other glass items, large glass objects", "glass", ["G210","G209"]),
 "tableware":    ("tableware (plates, cups)", "glass", ["G203"]),
 "glass_buoy":   ("glass buoys, octopus pots", "glass", ["G206","G207"]),
 "construction": ("construction material (brick, cement, pipes)", "ceramic_construction", ["G204"]),
 "can_drink":    ("beverage cans", "metal_can", ["G175"]),
 "can_food":     ("food cans, pint tins, other cans", "metal_can", ["G176","G190","G188"]),
 "foil":         ("foil wrappers, aluminium foil", "metal_foil", ["G177"]),
 "aerosol":      ("aerosol / spray cans", "metal_can", ["G174"]),
 "drum":         ("gas bottles, drums, containers", "metal_can", ["G189","G187","G185"]),
 "wire":         ("wire, mesh, barbed wire", "metal_foil", ["G191"]),
 "metal_piece":  ("other metal pieces, scrap", "metal_foil", ["G186","G197","G198","G199","x_q"]),
 "fishing_metal":("metal fishing gear (sinkers, hooks, pots)", "metal_foil", ["G182","G183","G184"]),
 "bbq":          ("disposable BBQs", "metal_foil", ["G179"]),
 "metal_table":  ("metal tableware", "metal_foil", ["G181"]),
 "battery":      ("household batteries", "battery", ["G195","G193"]),
 "food_waste":   ("food waste", "soft_organic", ["x_t","G215"]),
 "faeces":       ("faeces", "soft_organic", ["x_s","x_k","x_l"]),
 "snus":         ("snuff / snus", "soft_organic", ["x_r"]),
 "misc_other":   ("other / unidentified", "composite_misc", ["x_u","x_c","G216","G217","G212"]),
}
# JRC organic rows are anthropogenic organic residues; handled in layer C instead (kept out of A).
ORGANIC_GIDS = {"food_waste", "faeces", "snus"}
# electronics-ish JRC rows are kept for reference, moved out of A into B
ELEC_CODES = {"G88": "phone", "G84": "cd", "G194": "cable", "G180": "appliance", "G202": "bulb", "G205": "tube"}

code2gid = {}
for gid, (_, _, codes) in G.items():
    for c in codes:
        assert c not in code2gid, c
        code2gid[c] = gid

def first_code(code):
    m = re.search(r"G\d+|x_[a-z]", code)
    return m.group(0) if m else None

# name-based overrides (first code misleading)
def gid_of(r):
    n = r["name"].lower()
    fc = first_code(r["code"])
    if fc in ELEC_CODES:
        return "ELEC:" + ELEC_CODES[fc]
    if n.startswith("plastic pieces") or n.startswith("plastic/polystyrene pieces") and fc == "G74":
        return "frag_mid"
    if fc == "G74" and "foam pieces" in n:
        return "foam_pieces"
    if fc == "G74" and n.startswith("plastic pieces"):
        return "frag_mid"
    if fc == "G95" and n.startswith("sanitary"):
        return "cotton_bud"
    if fc in ("G6",) and "bottles" in n and "<" in n:
        return "bottle_drink"
    return code2gid.get(fc)

agg = collections.OrderedDict((g, dict(rows=[], count=0)) for g in G)
elec_ref = collections.defaultdict(lambda: dict(rows=[], count=0))
unmatched = []
for r in rows:
    if r["count"] == 0:
        continue
    g = gid_of(r)
    if g is None:
        unmatched.append(r)
        continue
    if g.startswith("ELEC:"):
        e = elec_ref[g[5:]]
        e["rows"].append(r["rank"]); e["count"] += r["count"]
        continue
    agg[g]["rows"].append(r["rank"]); agg[g]["count"] += r["count"]

if unmatched:
    print("UNMATCHED:")
    for r in unmatched:
        print(" ", r["rank"], r["material"], r["name"], r["code"], r["count"])

total_all = sum(r["count"] for r in rows)
# layer A excludes organic residues and electronics rows
A = {g: v for g, v in agg.items() if g not in ORGANIC_GIDS and v["count"] > 0}
A_total = sum(v["count"] for v in A.values())
organic_ref = sum(agg[g]["count"] for g in ORGANIC_GIDS)

def variants_A(share):
    return 4 if share >= 5 else 3 if share >= 1 else 2 if share >= 0.2 else 1

# ---------------------------------------------------------------- layer B (authored)
B = [
 # id, label, WEEE category, material (new or existing), weight
 ("smartphone","smartphone","Small IT & telecom","ewaste_device",8),
 ("feature_phone","feature phone","Small IT & telecom","ewaste_device",3),
 ("earbuds","earphones / earbuds","Small IT & telecom","ewaste_device",7),
 ("headphones","headphones","Small IT & telecom","ewaste_device",3),
 ("charger","phone charger / adapter","Small IT & telecom","ewaste_device",6),
 ("usb_cable","USB / charging cable","Small IT & telecom","plastic_cordage",9),
 ("usb_stick","USB stick, memory card","Small IT & telecom","ewaste_board",3),
 ("hdd","hard-disk drive","Small IT & telecom","ewaste_device",2),
 ("router","router / modem","Small IT & telecom","ewaste_device",2),
 ("pcb","bare circuit board","Small IT & telecom","ewaste_board",2),
 ("laptop","laptop / tablet","Screens & monitors","ewaste_device",2),
 ("screen","broken screen, monitor, TV","Screens & monitors","ewaste_device",3),
 ("led_bulb","LED bulb","Lamps","ewaste_device",4),
 ("tube_lamp","fluorescent tube","Lamps","glass",2),
 ("bulb","incandescent bulb","Lamps","glass",2),
 ("remote","remote control","Small equipment","ewaste_device",5),
 ("vape","disposable e-cigarette","Small equipment","ewaste_device",7),
 ("powerbank","power bank","Small equipment","ewaste_device",3),
 ("toothbrush","electric toothbrush","Small equipment","ewaste_device",2),
 ("shaver","shaver, hair dryer","Small equipment","ewaste_device",3),
 ("calculator","calculator","Small equipment","ewaste_device",2),
 ("controller","game controller","Small equipment","ewaste_device",2),
 ("keyboard","keyboard, mouse","Small equipment","ewaste_device",3),
 ("camera","camera","Small equipment","ewaste_device",1),
 ("toy_elec","electronic toy","Small equipment","ewaste_device",3),
 ("detector","smoke detector","Small equipment","ewaste_device",1),
 ("kitchen_elec","kettle, toaster","Small equipment","ewaste_device",2),
 ("battery_aa","AA / AAA battery","Batteries","battery",4),
 ("battery_coin","coin cell","Batteries","battery",2),
 ("battery_li","lithium battery pack","Batteries","battery",2),
 ("appliance","appliance fragment (drum, panel)","Large equipment","metal_foil",1),
 ("compressor","fridge / compressor part","Temperature exchange","metal_foil",1),
]
B_total = sum(b[4] for b in B)
def variants_w(w, tot):
    s = w / tot * 100
    return 3 if s >= 5 else 2 if s >= 2 else 1

# ---------------------------------------------------------------- layer C (authored): ANTHROPOGENIC organics
# What people eat, burn, excrete and throw away. Scattered by visitors like A and B.
# (id, label, material, weight, jrc_group or None)  weights are EST.; the three JRC rows are
# shown with their beach counts for reference only (349 items is far too few to use as weights).
C = [
 ("food_waste","food waste","soft_organic",20,"food_waste"),
 ("fruit_scrap","fruit peel, bread, kitchen scrap","soft_organic",12,None),
 ("faeces","faeces","soft_organic",6,"faeces"),
 ("snus","snuff / snus","soft_organic",4,"snus"),
 ("chicken_bone","chicken bone (broiler)","bone",14,None),
 ("livestock_bone","beef / pork bone","bone",8,None),
 ("fish_bone","fish bone","bone",6,None),
 ("eggshell","eggshell","shell",8,None),
 ("shellfish","oyster / mussel shell (eaten)","shell",8,None),
 ("charcoal","charcoal / coal lump","charcoal",6,None),
]
C_total = sum(c[3] for c in C)

# ---------------------------------------------------------------- layer N (authored): NATURAL STOCK
# Not scattered. It is the ground the visitors walk onto, and it shrinks as they walk.
# (id, label, group, material, weight, resist, variants)
#   resist = relative resistance to trampling within the group (1 = group median). EST.,
#   only the *shape* (fast first loss, wide spread between plant types) follows Cole 1995.
N = [
 ("leaf","leaf","flora","soft_organic",22,0.8,3),
 ("petal","petal / flower","flora","soft_organic",6,0.4,2),
 ("mushroom","mushroom","flora","soft_organic",2,0.4,1),
 ("seed","seed, nut","flora","soft_organic",6,1.5,2),
 ("grass","grass, straw","flora","soft_organic",12,3.0,2),
 ("twig","twig, branch","flora","wood_natural",10,1.5,3),
 ("bark","bark, pine cone","flora","wood_natural",4,2.0,2),
 ("insect","insect (beetle)","fauna","soft_organic",5,0.5,2),
 ("small_fish","dead small fish","fauna","soft_organic",1,0.5,1),
 ("feather","feather","fauna","feather_hair",7,0.7,3),
 ("fur","fur tuft","fauna","feather_hair",2,0.7,1),
 ("bird_bone","bird bone","fauna","bone",1,1.5,1),
 ("wild_bone","wild mammal bone","fauna","bone",2,1.5,1),
 ("tooth","tooth","fauna","tooth",1,2.0,1),
 ("snail","snail shell","fauna","shell",3,1.5,2),
 ("crab","crab / crustacean shell","fauna","shell",2,1.5,1),
 ("urchin","sea urchin, starfish","fauna","shell",1,1.5,1),
 ("coral","coral fragment","fauna","shell",1,2.0,1),
]
N_total = sum(n[4] for n in N)

import math
TAU_FLORA = 50 / math.log(2)                       # passes; Cole 1995 [S]: ~50 passes -> ~50 % cover lost
TAU_FAUNA = TAU_FLORA * math.log(2) / math.log(6)  # Bar-On 2018: wild mammals /6 vs plants /2 at the same load
PASSES_PER_CROSSING = 10
PASSES_PER_DEPOSIT = 5

LAYER_W = {"A": 0.70, "B": 0.10, "C": 0.20}

NEW_MATS = [
 # id, label, life range (EST.), fossil potential (EST.), note
 ("ewaste_device","electronic device (housing + board + cell)","20 – 500","20 %","composite: short plastic shell, long-lived board inside"),
 ("ewaste_board","circuit board / chip / memory","100 – 5,000","60 %","glass-fibre epoxy, ceramics, metals"),
 ("soft_organic","leaf, petal, fruit, food waste, insect, faeces","0.005 – 1","1 %","decays in days to a year"),
 ("wood_natural","twig, bark, cone","1 – 100","8 %","lignin; coal / amber only exceptionally"),
 ("feather_hair","feather, fur","0.3 – 10","3 %","keratin"),
 ("bone","bone","20 – 5,000","35 %","hard part; chicken bone is a proposed Anthropocene marker"),
 ("tooth","tooth (enamel)","500 – 1,000,000","65 %","most resistant hard part"),
 ("shell","shell, eggshell, coral","100 – 100,000","60 %","calcium carbonate; mineralises easily when buried"),
 ("charcoal","charcoal, coal","100 – 10,000","40 %","carbon; chemically inert but fragile; EST."),
]

# ---------------------------------------------------------------- write data files
json.dump(rows, open(OUT / "data" / "jrc-2016-table-a1.json", "w"), indent=1, ensure_ascii=False)
cat = {"layers": LAYER_W, "A": [], "B": [], "C": [], "N": [],
       "natural": {"tauFlora": round(TAU_FLORA, 2), "tauFauna": round(TAU_FAUNA, 2),
                   "passesPerCrossing": PASSES_PER_CROSSING, "passesPerDeposit": PASSES_PER_DEPOSIT}}
for g, v in A.items():
    share = v["count"] / A_total * 100
    cat["A"].append(dict(id=g, label=G[g][0], material=G[g][1], share=round(share, 4), variants=variants_A(share), jrcRanks=v["rows"], jrcCount=v["count"]))
for (i, l, cat_, m, w) in B:
    cat["B"].append(dict(id=i, label=l, weeeCategory=cat_, material=m, weight=w, share=round(w / B_total * 100, 3), variants=variants_w(w, B_total)))
for (i, l, m, w, jg) in C:
    row = dict(id=i, label=l, material=m, weight=w, share=round(w / C_total * 100, 3), variants=variants_w(w, C_total))
    if jg:
        row["jrcCount"] = agg[jg]["count"]
    cat["C"].append(row)
for (i, l, grp, m, w, rs, vv) in N:
    cat["N"].append(dict(id=i, label=l, group=grp, material=m, weight=w, share=round(w / N_total * 100, 3), resist=rs, variants=vv))
json.dump(cat, open(OUT / "data" / "catalogue-v2.json", "w"), indent=1, ensure_ascii=False)

# TypeScript data for lib/stratum (generated; do not edit by hand)
TS = ROOT / "apps" / "web" / "src" / "lib" / "stratum" / "items.data.ts"
def rows_ts(layer, extra=()):
    out = []
    for x in cat[layer]:
        d = {"id": x["id"], "label": x["label"], "material": x["material"], "share": x["share"], "variants": x["variants"]}
        for k in extra:
            d[k] = x[k]
        out.append(d)
    return json.dumps(out, ensure_ascii=False, indent=1)
ts = ["// GENERATED by scratch/gen_catalogue_v2.py from docs/data/catalogue-v2.json. Do not edit by hand.",
      "// Layer shares inside a layer are percentages (sum 100). See docs/catalogue-v2.md.",
      "",
      "export interface ItemRow { id: string; label: string; material: string; share: number; variants: number }",
      "export interface NaturalRow extends ItemRow { group: \"flora\" | \"fauna\"; resist: number }",
      "",
      f"export const LAYER_SHARE = {json.dumps(LAYER_W)} as const;",
      f"export const NATURAL_CAL = {json.dumps(cat['natural'])} as const;",
      "",
      f"export const ITEMS_A: ItemRow[] = {rows_ts('A')};",
      "",
      f"export const ITEMS_B: ItemRow[] = {rows_ts('B')};",
      "",
      f"export const ITEMS_C: ItemRow[] = {rows_ts('C')};",
      "",
      f"export const ITEMS_N: NaturalRow[] = {rows_ts('N', ('group', 'resist'))};",
      ""]
TS.write_text("\n".join(ts))

# ---------------------------------------------------------------- markdown
nA = len(cat["A"]); nB = len(cat["B"]); nC = len(cat["C"]); nN = len(cat["N"])
spA = sum(x["variants"] for x in cat["A"]); spB = sum(x["variants"] for x in cat["B"]); spC = sum(x["variants"] for x in cat["C"]); spN = sum(x["variants"] for x in cat["N"])
L = []
L.append("# Scatter catalogue v2 — items, variants, sprites\n")
L.append("_Generated by a script from the JRC table (`docs/data/jrc-2016-table-a1.json`); machine-readable result in `docs/data/catalogue-v2.json`, "
         "TypeScript copy in `apps/web/src/lib/stratum/items.data.ts`. Status: **wired into `lib/stratum` (items, draw, natural stock); sprites not drawn yet.**_\n")
L.append("## 0. What changed from v1\n")
L.append("- v1 used the **top 50** JRC rows → 17 materials. v2 uses the **whole JRC Table A1** (238 ranks, 222 non-zero, "
         f"{total_all:,} items) and groups it into **{nA} sprite items**, so the diversity *inside* a material is kept "
         "(a bottle cap, a cotton bud and a lighter are different sprites, not one “rigid plastic”).")
L.append("- Three more groups: **B electronics**, **C anthropogenic organics** (what people eat, burn and excrete) and **N natural stock** (the ground the visitors walk onto). "
         "B and C have **authored weights (EST.)**; N is not scattered at all (§5).")
L.append("- The inheritance rule (`inheritance-rationale.md`) moves the mix of A+B+C with what survives on the ground.")
L.append("- Deep-time index fossils (trilobite, ammonite, mammoth) are **out of scope**: the strata contain only what visitors leave.")
L.append("- **Provenance:** `docs/data/jrc-2016-table-a1.json` is the full Annex II Table A1 of Addamo, Laroche & Hanke (2017), *Top Marine Beach Litter Items in Europe*, JRC Technical Report EUR 29249 EN, doi:10.2760/496717 (reuse authorised with acknowledgement), extracted from the PDF text by script. Counts were not hand-checked row by row; they sum to 355,672 vs 355,671 stated in the report.\n")

L.append("## 1. Layer mix (the prior of what a visitor scatters)\n")
L.append("| Layer | Prior share | Items | Sprite variants | Basis |")
L.append("|---|---|---|---|---|")
L.append(f"| A. JRC beach-litter items | {LAYER_W['A']*100:.0f} % | {nA} | {spA} | **Measured** frequencies *within* the layer (JRC 2016, Europe) |")
L.append(f"| B. Electronics | {LAYER_W['B']*100:.0f} % | {nB} | {spB} | **Authored** weights (EST.) |")
L.append(f"| C. Anthropogenic organics | {LAYER_W['C']*100:.0f} % | {nC} | {spC} | **Authored** weights (EST.) |")
L.append(f"| **Scattered total** | 100 % | **{nA+nB+nC}** | **{spA+spB+spC}** | |")
L.append(f"| N. Natural stock (not scattered) | — | {nN} | {spN} | **Authored** composition (EST.); depletion anchored on Bar-On 2018 and Cole 1995 (§5) |\n")
L.append("> The layer shares are an **authorial statement**, not data. Beach litter has almost no electronics "
         f"(telephones: {elec_ref['phone']['count']} of {total_all:,} items) and almost no food residue by construction (beach surveys count litter, not leftovers). "
         "A 10 % electronics and 20 % organics share is a deliberate choice to make the other faces of the technosphere visible. Change `LAYER_SHARE` to change the statement.\n")

L.append("## 2. Layer A — JRC items grouped into sprite items\n")
L.append("Share = share of layer A by JRC count after moving the electronics-ish rows to B (reference only) and the organic residue rows (food waste, faeces, snus) to C. "
         "Variants rule: share ≥ 5 % → 4, ≥ 1 % → 3, ≥ 0.2 % → 2, else 1.\n")
L.append("| # | Sprite item | Material | JRC count | Share of A | Variants | JRC ranks merged |")
L.append("|---|---|---|---|---|---|---|")
for i, x in enumerate(sorted(cat["A"], key=lambda x: -x["jrcCount"]), 1):
    ranks = ", ".join(str(r) for r in x["jrcRanks"][:8]) + (" …" if len(x["jrcRanks"]) > 8 else "")
    L.append(f"| {i} | {x['label']} | {x['material']} | {x['jrcCount']:,} | {x['share']:.2f} % | {x['variants']} | {ranks} |")
L.append("")
L.append("Merging note: the JRC table contains aggregated rows from different national monitoring schemes (e.g. “Bottles < 2 L G6–G9/G11–G13”). "
         "Each row is assigned to a sprite item by its **first** Master-List code, with a few manual name overrides. "
         "Counts are not double-counted (sum of all 238 rows = 355,672; the report says 355,671).\n")
if unmatched:
    L.append("Rows not assigned to a sprite item (kept out): " + "; ".join(f"#{r['rank']} {r['name']} ({r['count']})" for r in unmatched) + "\n")

L.append("## 3. Layer B — electronics (authored, EST.)\n")
L.append("**Why authored:** Eurostat (`env_waseleeos`) and the Global E-waste Monitor 2024 report e-waste by **mass** in six categories, not by number of "
         "items; a harmonised European item-count dataset for small electronics does not exist (per search-engine summaries; the Eurostat site itself was not opened). "
         "So the categories below are real, the item list is authored, and the weights are "
         "design parameters that follow the rough intuition that small IT, cables and small equipment dominate by count.\n")
L.append("JRC beach data does contain a few electronics-related rows, listed here for reference only (not used as weights): " +
         "; ".join(f"{k} {v['count']}" for k, v in elec_ref.items()) + ".\n")
L.append("| # | Item | WEEE category | Material | Weight | Share of B | Variants |")
L.append("|---|---|---|---|---|---|---|")
for i, x in enumerate(sorted(cat["B"], key=lambda x: -x["weight"]), 1):
    L.append(f"| {i} | {x['label']} | {x['weeeCategory']} | {x['material']} | {x['weight']} | {x['share']:.1f} % | {x['variants']} |")
L.append("")

L.append("## 4. Layer C — anthropogenic organics (scattered; authored, EST.)\n")
L.append("What people eat, burn and excrete. Most of it is soft and vanishes within days to a year; **bone, shell and charcoal** are what the strata keep. "
         "The three JRC rows (food waste, faeces, snus) are included; their beach counts are shown for reference only, because "
         f"{organic_ref} items out of {total_all:,} reflect what beach surveyors record, not what people leave. **Chicken bone** is the broiler chicken proposed as an Anthropocene stratigraphic marker "
         "(Bennett et al. 2018 — not re-verified).\n")
L.append("| # | Item | Material | Weight | Share of C | Variants | JRC beach count (ref.) |")
L.append("|---|---|---|---|---|---|---|")
for i, x in enumerate(sorted(cat["C"], key=lambda x: -x["weight"]), 1):
    L.append(f"| {i} | {x['label']} | {x['material']} | {x['weight']} | {x['share']:.1f} % | {x['variants']} | {x.get('jrcCount', '')} |")
L.append("")

L.append("## 5. Layer N — natural stock (not scattered; it shrinks as visitors walk)\n")
L.append("The ground is **not empty** when the first visitor arrives. Every ground cell holds 0–2 natural things (leaf, grass, feather, snail shell …), chosen by a hash so that every view sees the same ground. "
         "Visitors do not scatter these. **Walking over a cell and scattering on it displaces them**; what is displaced becomes a dead item that follows the same taphonomy as everything else "
         "(leaves vanish in days, bone, tooth and shell stay if buried). Nothing grows back within one exhibition run.\n")
L.append("**Rule.** For each natural item, a fixed random threshold `u ∈ (0.02, 1)` (from its id). Its *load* is `h = 10 · crossings + 5 · deposits` (in “passes”) on its cell. "
         "It is alive while `h < −τ · r · ln u`, i.e. with probability `exp(−h / (τ·r))`. `r` is the item's relative resistance, `τ` the group's scale:\n")
L.append(f"- **flora** τ = {TAU_FLORA:.1f} passes (= 50 / ln 2: half the cover lost after 50 passes at median resistance)")
L.append(f"- **fauna** τ = {TAU_FAUNA:.1f} passes (= τ_flora · ln 2 / ln 6: the same load takes the animal share down to 1/6 while flora fall to 1/2)\n")
L.append("**Anchors and their verification.**\n")
L.append("| Anchor | Value used | Source | Verified |")
L.append("|---|---|---|---|")
L.append("| Plant biomass | now ≈ ½ of pre-civilisation | Bar-On, Phillips & Milo 2018, *PNAS* 115(25), “The biomass distribution on Earth” | **full text read** (PMC6016768): “declined approximately twofold” |")
L.append("| Wild mammal biomass | ÷ ≈ 6 (marine 0.02 → 0.004 Gt C; land 0.02 → 0.003 Gt C) | same | **full text read**; authors call the pre-human values “only a crude first step” |")
L.append("| Total mammals | ×≈ 4 (0.04 → 0.17 Gt C), humans 0.06 Gt C | same | **full text read**. The often-quoted “humans + livestock = 96 %” is *not* written in the text; it follows from 0.007 / 0.17 ≈ 4 % wild |")
L.append("| Trampling curve | loss of cover roughly 50 % at ~50 passes; strongest vegetation types ~25–30× more resistant than weakest; some recovery after 1 y | Cole 1995, *J. Applied Ecology* 32(2), “Experimental trampling of vegetation I”, doi:10.2307/2404429 | citation confirmed (Crossref); **numbers from a search summary only (S), abstract not opened** |")
L.append("")
L.append("**Not measured, authored (EST.):** the initial composition (below), the relative resistances, `PASSES_PER_CROSSING = 10`, `PASSES_PER_DEPOSIT = 5`, "
         "and the exhibition scale. The Bar-On end state (plants ½, wild animals 1/6) is reached **only if** the run delivers about "
         f"{TAU_FLORA * math.log(2):.0f} passes per cell (≈ 5 crossings per cell, a few dozen visitors on a small field); with fewer visitors it is partial.\n")
L.append("| # | Item | Group | Material | Weight | Share of N | Resistance r | Variants |")
L.append("|---|---|---|---|---|---|---|---|")
for i, x in enumerate(sorted(cat["N"], key=lambda x: -x["weight"]), 1):
    L.append(f"| {i} | {x['label']} | {x['group']} | {x['material']} | {x['weight']} | {x['share']:.1f} % | {x['resist']} | {x['variants']} |")
L.append("")

L.append("## 6. New materials needed (EST.)\n")
L.append("Persistence = years on the surface; log-uniform inside the range. Fossil potential = chance of becoming permanent once buried long enough. "
         "Rank order is what matters; the numbers are design parameters.\n")
L.append("| Material | Covers | Persistence (y) | Fossil potential | Note |")
L.append("|---|---|---|---|---|")
for m in NEW_MATS:
    L.append(f"| `{m[0]}` | {m[1]} | {m[2]} | {m[3]} | {m[4]} |")
L.append("")

L.append("## 7. Sprite workload\n")
L.append(f"**{spA+spB+spC+spN} sprites** = {spA} (A) + {spB} (B) + {spC} (C) + {spN} (N), for {nA+nB+nC+nN} items. "
         "Sprites are 16×16 (or 24×24) in the 16-colour palette. No single library covers this; the pipeline is a hybrid "
         "(see `technofossil_research.md` §1 for licences: Quick, Draw! CC BY 4.0, Kenney/OpenGameArt CC0, TrashNet MIT, game-icons.net CC BY 3.0, Noto Emoji Apache-2.0, PhyloPic CC0-filtered). "
         "A per-sprite source table with licence will be generated into `CREDITS.md` by the build script.\n")

L.append("## 8. Open decisions\n")
L.append("1. **Layer shares** (A 70 / B 10 / C 20 now). The work's statement about how visible the technosphere's non-plastic faces should be.")
L.append("2. **Natural stock scale**: how many visitors should it take to reach the Bar-On end state (plants ½, wild animals 1/6)? Tune `PASSES_PER_CROSSING` / `PASSES_PER_DEPOSIT`.")
L.append("3. **Re-entry**: does the natural stock reset for each exhibition run (new epoch) or never?")
L.append("4. Whether to merge sprite items further to cut the workload (e.g. all string/rope/net → 3 sprites).")
L.append("5. Whether dead natural items should be counted when a visitor “reads the ground” for the inheritance rule (currently: **no**; only scattered items inherit).")
(OUT / "catalogue-v2.md").write_text("\n".join(L))
print(f"A {nA}/{spA} | B {nB}/{spB} | C {nC}/{spC} | N {nN}/{spN} | scattered items {nA+nB+nC} sprites total {spA+spB+spC+spN}")
print("A_total", A_total, "of", total_all, "organic ref", organic_ref, "elec ref", {k: v['count'] for k, v in elec_ref.items()})
