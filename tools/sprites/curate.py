#!/usr/bin/env python3
"""Curated item -> source-icon table. Generates tools/sprites/mapping.json.

Spec syntax (one string per sprite variant):
    tw:1f6ac              jdecked/twemoji      assets/svg/<cp>.svg            (CC BY 4.0)
    no:1f6ac              googlefonts/noto-emoji 2D/svg/emoji_u<cp>.svg      (Apache-2.0)
    fl:Cigarette          microsoft/fluentui-emoji assets/<Name>/Color        (MIT)
    gi:delapouite/bottle-cap@aaaaaa   game-icons/icons <author>/<name>.svg tinted (CC BY 3.0; viscious-speed = CC0)
    dc:item/food/apple    crawl/tiles Nov-2015/<path>.png                     (CC0)
  options after '|': sat=1.3  bright=1.2  outline=0|1  autocontrast=0
Files that do not exist are reported and skipped.
"""
import json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(os.environ.get("SPRITE_SRC_ASSETS",
           "/Users/hesse/.gemini/antigravity/brain/7ac981a7-b6d4-4f8d-82b0-aad446dc5a57/scratch/src_assets"))

GI_AUTHORS = {"lorc": "Lorc", "delapouite": "Delapouite", "skoll": "Skoll", "sbed": "sbed",
              "caro-asercion": "Caro Asercion", "guard13007": "Guard13007", "priorblue": "PriorBlue",
              "faithtoken": "Faithtoken", "seregacthtuf": "Seregacthtuf", "john-redman": "John Redman",
              "viscious-speed": "Viscious Speed", "quoting": "Quoting", "badges": "Badges"}

ITEMS = {
    # ---------------- layer A (20 most frequent + extras)
    "frag_mid":      ["tw:1f9e9", "no:1f9e9", "fl:Puzzle piece", "gi:lorc/rock@55ffff"],
    "frag_small":    ["tw:1f539", "tw:1f538", "tw:1f53a", "tw:1f4a0", "tw:1f53b"],
    "frag_large":    ["tw:1f536", "tw:1f537", "gi:lorc/broken-bone@ff5555", "no:1f9e9"],
    "string":        ["tw:1f9f5", "no:1f9f5", "fl:Thread", "tw:1faa2"],
    "acetate_butt":  ["tw:1f6ac", "no:1f6ac", "fl:Cigarette", "gi:delapouite/cigarette@ffff55"],
    "cap_plastic":   ["tw:1f518", "tw:1f534", "tw:1f535", "tw:26aa"],
    "cotton_bud":    ["gi:delapouite/wood-stick@ffffff", "tw:1f962", "gi:delapouite/wood-stick@aaaaaa"],
    "wrapper":       ["gi:delapouite/chips-bag@ffff55", "tw:1f36c", "fl:Candy", "tw:1f36b"],
    "wax":           ["tw:1f56f", "no:1f56f", "fl:Candle", "gi:lorc/candle-holder@ffff55"],
    "plastic_other": ["tw:1f9f4", "tw:1f964", "tw:1faa3", "no:1f9f4"],
    "net_pieces":    ["gi:lorc/fishing-net@55ffff", "tw:1f945", "no:1f945", "tw:1f578"],
    "bottle_drink":  ["gi:caro-asercion/soda-bottle@55ffff", "tw:1f37c", "no:1f37c", "tw:1f9c3"],
    "bag":           ["gi:delapouite/shopping-bag@ffffff", "tw:1f6cd", "no:1f6cd", "fl:Shopping bags"],
    "medical_other": ["tw:1fa79", "no:1fa79", "fl:Adhesive bandage", "tw:1f48a", "tw:1f489"],
    "hygiene_misc":  ["tw:1f9fb", "no:1f9fb", "tw:1fa92", "tw:1f9fc"],
    "cutlery":       ["tw:1f374", "no:1f374", "fl:Fork and knife", "tw:1f944"],
    "foam_sponge":   ["tw:1f9fd", "no:1f9fd", "fl:Sponge"],
    "glass_bottle":  ["tw:1f37e", "no:1f37e", "gi:lorc/broken-bottle@55ff55", "tw:1fad9"],
    "rope":          ["tw:1faa2", "tw:1f9f6", "no:1f9f6"],
    "wood_piece":    ["tw:1fab5", "no:1fab5", "fl:Wood", "gi:delapouite/wood-stick@aa5500"],
    "food_box":      ["tw:1f961", "no:1f961", "tw:1f354", "tw:1f35f"],
    "balloon":       ["tw:1f388", "no:1f388", "fl:Balloon", "gi:delapouite/air-balloon@ff5555"],
    "can_drink":     ["gi:guard13007/soda-can@ff5555", "gi:guard13007/soda-can@aaaaaa", "tw:1f96b", "no:1f96b"],
    "clothing":      ["tw:1f455", "tw:1f9e6", "tw:1f9e2", "gi:delapouite/t-shirt@5555ff"],
    "cup":           ["tw:2615", "no:2615", "gi:lorc/coffee-mug@ffffff", "tw:1f964"],
    "cap_metal":     ["tw:1fa99", "no:1fa99", "tw:1f4bf"],
    "cig_pack":      ["tw:1f6ac|", "gi:delapouite/cigarette@ffffff"],

    # ---------------- layer B (electronics, 8+)
    "usb_cable":     ["tw:1f50c", "no:1f50c", "fl:Electric plug", "gi:delapouite/jack-plug@aaaaaa"],
    "smartphone":    ["tw:1f4f1", "no:1f4f1", "fl:Mobile phone"],
    "earbuds":       ["tw:1f3a7", "no:1f3a7", "fl:Headphone"],
    "vape":          ["tw:1f58a", "tw:1fa88", "no:1f58a"],
    "charger":       ["tw:1f50c", "gi:delapouite/plug@ffffff", "gi:delapouite/spark-plug@aaaaaa"],
    "remote":        ["gi:delapouite/tv-remote@aaaaaa", "tw:1f3ae", "gi:delapouite/tv-remote@ff5555"],
    "led_bulb":      ["tw:1f4a1", "no:1f4a1", "fl:Light bulb", "gi:lorc/light-bulb@ffff55"],
    "battery_aa":    ["tw:1f50b", "no:1f50b", "fl:Battery", "gi:sbed/battery-pack@55ff55"],
    "feature_phone": ["tw:260e", "no:260e", "tw:1f4de", "tw:1f4df"],
    "headphones":    ["tw:1f3a7", "no:1f3a7", "fl:Headphone"],
    "usb_stick":     ["gi:delapouite/usb-key@5555ff", "tw:1f4be", "no:1f4be", "tw:1f4bf"],
    "screen":        ["tw:1f4fa", "no:1f4fa", "tw:1f5a5", "tw:1f4bb"],

    # ---------------- layer C (all 10)
    "food_waste":    ["tw:1f356", "no:1f356", "dc:item/food/chunk", "tw:1f96b", "dc:item/food/meat_ration"],
    "fruit_scrap":   ["tw:1f34c", "tw:1f34e", "tw:1f35e", "dc:item/food/apple", "gi:delapouite/apple-core@55ff55"],
    "faeces":        ["tw:1f4a9", "no:1f4a9", "fl:Pile of poo"],
    "snus":          ["tw:1fad9", "no:1fad9", "tw:1f9c2"],
    "chicken_bone":  ["tw:1f357", "no:1f357", "gi:lorc/chicken-leg@ffffff", "fl:Poultry leg"],
    "livestock_bone":["tw:1f9b4", "no:1f9b4", "fl:Bone", "gi:skoll/ham-shank@ffffff"],
    "fish_bone":     ["gi:lorc/fishbone@ffffff", "gi:lorc/fishbone@55ffff", "tw:1f41f"],
    "eggshell":      ["tw:1f95a", "no:1f95a", "fl:Egg", "tw:1f423"],
    "shellfish":     ["tw:1f9aa", "no:1f9aa", "fl:Oyster", "gi:delapouite/mussel@55ffff"],
    "charcoal":      ["tw:1faa8", "no:1faa8", "gi:delapouite/coal-pile@555555"],

    # ---------------- natural layer N
    "leaf":          ["tw:1f343", "tw:1f342", "no:1f341", "fl:Fallen leaf", "gi:lorc/falling-leaf@55ff55"],
    "petal":         ["tw:1f338", "no:1f33c", "fl:Cherry blossom", "tw:1f940"],
    "mushroom":      ["tw:1f344", "no:1f344", "gi:lorc/spotted-mushroom@ff5555"],
    "seed":          ["fl:Chestnut", "tw:1f95c", "no:1f331", "gi:lorc/apple-seeds@aa5500"],
    "grass":         ["tw:1f33e", "no:1f33f", "gi:lorc/wheat@ffff55"],
    "twig":          ["gi:lorc/tree-branch@aa5500", "tw:1fab5", "gi:lorc/branch-arrow@aa5500"],
    "bark":          ["tw:1fab5", "no:1fab5", "tw:1f332"],
    "insect":        ["tw:1fab2", "tw:1f41e", "no:1fab3", "gi:lorc/scarab-beetle@55ffff"],
    "small_fish":    ["tw:1f41f", "no:1f41f", "fl:Fish", "tw:1f420"],
    "feather":       ["tw:1fab6", "no:1fab6", "gi:lorc/feather@ffffff", "fl:Feather"],
    "fur":           ["tw:1f43e", "no:1f9f6"],
    "bird_bone":     ["tw:1f9b4", "gi:lorc/broken-bone@ffffff"],
    "wild_bone":     ["gi:lorc/crossed-bones@ffffff", "gi:lorc/ribcage@ffffff", "no:1f9b4", "gi:lorc/jawbone@ffffff"],
    "tooth":         ["tw:1f9b7", "no:1f9b7", "gi:lorc/tooth@ffffff", "fl:Tooth"],
    "snail":         ["tw:1f40c", "no:1f40c", "gi:lorc/spiral-shell@ffff55", "fl:Snail"],
    "crab":          ["tw:1f980", "no:1f980", "fl:Crab", "gi:lorc/crab@ff5555"],
    "urchin":        ["tw:2b50", "tw:1fab8", "fl:Star"],
    "coral":         ["tw:1fab8", "no:1fab8", "fl:Coral"],
}


def parse(spec: str):
    opts = {}
    if "|" in spec:
        spec, o = spec.split("|", 1)
        for kv in filter(None, o.split("|")):
            k, v = kv.split("=")
            opts[k] = {"0": False, "1": True}.get(v, None) if k in ("outline", "autocontrast") else float(v)
    kind, rest = spec.split(":", 1)
    tint = None
    if "@" in rest:
        rest, tint = rest.split("@")
    if kind == "tw":
        e = dict(src=f"twemoji/assets/svg/{rest}.svg", source="jdecked/twemoji", license="CC BY 4.0",
                 author="Twitter, Inc and other contributors (jdecked/twemoji)",
                 url=f"https://github.com/jdecked/twemoji/blob/main/assets/svg/{rest}.svg")
    elif kind == "no":
        e = dict(src=f"noto-emoji/2D/svg/emoji_u{rest}.svg", source="googlefonts/noto-emoji (2D/svg)", license="Apache-2.0",
                 author="Google (Noto Emoji)",
                 url=f"https://github.com/googlefonts/noto-emoji/blob/main/2D/svg/emoji_u{rest}.svg")
    elif kind == "fl":
        fn = rest.lower().replace(" ", "_").replace(":", "").replace(",", "")
        e = dict(src=f"fluent/assets/{rest}/Color/{fn}_color.svg", source="microsoft/fluentui-emoji", license="MIT",
                 author="Microsoft",
                 url=f"https://github.com/microsoft/fluentui-emoji/tree/main/assets/{rest.replace(' ', '%20')}")
    elif kind == "gi":
        auth, name = rest.split("/")
        cc0 = auth == "viscious-speed"
        e = dict(src=f"game-icons/{auth}/{name}.svg", source="game-icons.net", license="CC0 1.0" if cc0 else "CC BY 3.0",
                 author=GI_AUTHORS.get(auth, auth), url=f"https://game-icons.net/1x1/{auth}/{name}.html",
                 tint="#" + (tint or "ffffff"))
    elif kind == "dc":
        e = dict(src=f"dcss/releases/Nov-2015/{rest}.png", source="crawl/tiles (DCSS)", license="CC0 1.0",
                 author="Dungeon Crawl Stone Soup tile artists (see ARTISTS.md)",
                 url=f"https://github.com/crawl/tiles/blob/master/releases/Nov-2015/{rest}.png")
    else:
        raise ValueError(spec)
    for k, v in opts.items():
        if v is not None:
            e[k] = v
    return e


def main():
    out, missing = {}, []
    for item, specs in ITEMS.items():
        lst = []
        for s in specs:
            if s.endswith("|"):
                s = s[:-1]
            e = parse(s)
            if not (SRC / e["src"]).exists():
                missing.append((item, s, e["src"]))
                continue
            lst.append(e)
        if lst:
            out[item] = lst
    p = ROOT / "tools/sprites/mapping.json"
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"mapping.json: {len(out)} items, {sum(len(v) for v in out.values())} entries")
    for m in missing:
        print("MISSING", m)


if __name__ == "__main__":
    main()
