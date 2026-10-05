# Scatter catalogue — what is being scattered right now

_Generated from `apps/web/src/lib/stratum/{catalogue,materials,palette}.ts`. Regenerate if those change._

Visitors do not choose what they scatter. Each item is drawn at random with the frequency of the **JRC 2016 European beach-litter survey** (Addamo, Laroche & Hanke 2017, EUR 29249 EN, Annex II Table A1; 355,671 items). The top 50 items cover 93.05 % of all items; shares below are renormalised to 100 %.

> **Status:** every item is currently drawn as a flat, same-shaped square in the colour of its material (placeholder). Real per-item sprites are planned. Persistence years and fossil potential are design parameters (**EST.**), not measurements; only their rank order is literature-based.

## 1. By material

| Material | Colour on screen (placeholder) | Items in catalogue | Share | Persistence on surface, years (EST.) | Fossil potential if buried (EST.) |
|---|---|---|---|---|---|
| plastic fragment (`plastic_fragment`) | light blue #5555FF | 3: plastic/polystyrene pieces 2.5-50 cm, plastic/polystyrene pieces 0-2.5 cm, plastic/polystyrene pieces >50 cm | 32.1 % | 50 – 1,000 | 65 % |
| string / rope / net (`plastic_cordage`) | light green #55FF55 | 8: string and cord (<1 cm), nets and pieces of net >50 cm, rope (>1 cm), strapping bands, tangled nets / cord, nets and pieces of net <50 cm, fishing line / monofilament, mussel / oyster nets | 19.3 % | 50 – 800 | 55 % |
| rigid plastic (`plastic_rigid`) | light red #FF5555 | 13: plastic caps, lids, bottle-cap rings, cotton bud sticks, other plastic items (identifiable), plastic beverage bottles, cutlery, straws, stirrers, food containers incl. fast food, shotgun cartridges, cups and cup lids, toys and party poppers, drink bottles <=0.5 l, cleaner bottles and containers, drink bottles >0.5 l, cigarette lighters | 18.7 % | 100 – 1,200 | 65 % |
| cigarette filter (`acetate_filter`) | yellow #FFFF55 | 1: cigarette butts and filters | 6.6 % | 2 – 20 | 30 % |
| plastic film / bag (`plastic_film`) | light cyan #55FFFF | 3: crisp packets / sweet wrappers, plastic bags, sheets, industrial packaging | 5.4 % | 10 – 300 | 50 % |
| mixed / composite (`composite_misc`) | light purple #FF55FF | 4: other medical items, other (diapers, tissue, razors), sanitary towels / liners, tampons and applicators | 4.4 % | 5 – 200 | 20 % |
| paraffin / wax (`wax`) | yellow #FFFF55 | 1: paraffin / wax | 3.1 % | 5 – 100 | 10 % |
| glass (`glass`) | light cyan #55FFFF | 2: glass/ceramic bottles incl. pieces, other glass items | 1.7 % | 1,000 – 1,000,000 | 85 % |
| paper / cardboard (`paper`) | light gray #AAAAAA | 3: other paper items, cigarette packets, paper cups, food trays, wrappers | 1.6 % | 0.1 – 2 | 2 % |
| rubber (`rubber`) | dark gray #555555 | 2: balloons and balloon sticks, other rubber pieces | 1.5 % | 30 – 500 | 40 % |
| metal can / cap (`metal_can`) | cyan #00AAAA | 2: beverage cans, bottle caps, lids, pull tabs (metal) | 1.3 % | 50 – 600 | 50 % |
| foam / EPS (`plastic_foam`) | white #FFFFFF | 1: foam sponge | 1.3 % | 30 – 600 | 50 % |
| worked wood (`wood_worked`) | brown #AA5500 | 2: other worked wood <50 cm, ice-cream sticks, chopsticks, toothpicks | 1.0 % | 1 – 60 | 5 % |
| textile / rags (`textile`) | brown #AA5500 | 2: clothing / rags, other textiles (incl. rags) | 0.7 % | 1 – 30 | 5 % |
| ceramic / brick / cement (`ceramic_construction`) | red #AA0000 | 1: construction material (brick, cement, pipes) | 0.5 % | 1,000 – 1,000,000 | 90 % |
| metal foil (`metal_foil`) | light gray #AAAAAA | 1: foil wrappers, aluminium foil | 0.4 % | 20 – 300 | 35 % |
| battery (`battery`) | green #00AA00 | 1: household batteries | 0.3 % | 20 – 300 | 30 % |

## 2. All 50 items

| Rank | MSFD code | Item | Material | Share (renormalised) | JRC share of all items |
|---|---|---|---|---|---|
| 1 | G76+G79+G82 | plastic/polystyrene pieces 2.5-50 cm | plastic_fragment | 16.01 % | 14.90 % |
| 2 | G75+G78+G81 | plastic/polystyrene pieces 0-2.5 cm | plastic_fragment | 14.86 % | 13.83 % |
| 3 | G50 | string and cord (<1 cm) | plastic_cordage | 14.78 % | 13.75 % |
| 4 | G27 | cigarette butts and filters | acetate_filter | 6.60 % | 6.14 % |
| 5 | G20+G21+G22+G23+G24 | plastic caps, lids, bottle-cap rings | plastic_rigid | 5.66 % | 5.27 % |
| 6 | G95 | cotton bud sticks | plastic_rigid | 4.11 % | 3.82 % |
| 7 | G213 | paraffin / wax | wax | 3.12 % | 2.90 % |
| 8 | G30 | crisp packets / sweet wrappers | plastic_film | 3.11 % | 2.89 % |
| 9 | G124 | other plastic items (identifiable) | plastic_rigid | 3.06 % | 2.85 % |
| 10 | G2+G3+G4+G5 | plastic bags | plastic_film | 1.87 % | 1.74 % |
| 11 | G211 | other medical items | composite_misc | 1.76 % | 1.64 % |
| 12 | x_a | other (diapers, tissue, razors) | composite_misc | 1.54 % | 1.43 % |
| 13 | G73 | foam sponge | plastic_foam | 1.26 % | 1.17 % |
| 14 | G77+G80+G83 | plastic/polystyrene pieces >50 cm | plastic_fragment | 1.26 % | 1.17 % |
| 15 | G200 | glass/ceramic bottles incl. pieces | glass | 1.15 % | 1.07 % |
| 16 | G6-G8 | plastic beverage bottles | plastic_rigid | 1.14 % | 1.06 % |
| 17 | G34-G35 | cutlery, straws, stirrers | plastic_rigid | 1.11 % | 1.03 % |
| 18 | G54 | nets and pieces of net >50 cm | plastic_cordage | 1.05 % | 0.98 % |
| 19 | G96 | sanitary towels / liners | composite_misc | 0.87 % | 0.81 % |
| 20 | G49 | rope (>1 cm) | plastic_cordage | 0.85 % | 0.79 % |
| 21 | G125 | balloons and balloon sticks | rubber | 0.76 % | 0.71 % |
| 22 | G171 | other worked wood <50 cm | wood_worked | 0.74 % | 0.69 % |
| 23 | G158 | other paper items | paper | 0.73 % | 0.68 % |
| 24 | G134 | other rubber pieces | rubber | 0.72 % | 0.67 % |
| 25 | G175 | beverage cans | metal_can | 0.72 % | 0.67 % |
| 26 | G10 | food containers incl. fast food | plastic_rigid | 0.71 % | 0.66 % |
| 27 | G70 | shotgun cartridges | plastic_rigid | 0.69 % | 0.64 % |
| 28 | G66 | strapping bands | plastic_cordage | 0.68 % | 0.63 % |
| 29 | G56 | tangled nets / cord | plastic_cordage | 0.63 % | 0.59 % |
| 30 | G33 | cups and cup lids | plastic_rigid | 0.60 % | 0.56 % |
| 31 | G178 | bottle caps, lids, pull tabs (metal) | metal_can | 0.60 % | 0.56 % |
| 32 | G152 | cigarette packets | paper | 0.59 % | 0.55 % |
| 33 | G53 | nets and pieces of net <50 cm | plastic_cordage | 0.56 % | 0.52 % |
| 34 | G210 | other glass items | glass | 0.52 % | 0.48 % |
| 35 | G204 | construction material (brick, cement, pipes) | ceramic_construction | 0.49 % | 0.46 % |
| 36 | G67 | sheets, industrial packaging | plastic_film | 0.44 % | 0.41 % |
| 37 | G177 | foil wrappers, aluminium foil | metal_foil | 0.43 % | 0.40 % |
| 38 | G59 | fishing line / monofilament | plastic_cordage | 0.41 % | 0.38 % |
| 39 | G137 | clothing / rags | textile | 0.38 % | 0.35 % |
| 40 | G32 | toys and party poppers | plastic_rigid | 0.38 % | 0.35 % |
| 41 | G7 | drink bottles <=0.5 l | plastic_rigid | 0.35 % | 0.33 % |
| 42 | G9 | cleaner bottles and containers | plastic_rigid | 0.34 % | 0.32 % |
| 43 | G45 | mussel / oyster nets | plastic_cordage | 0.34 % | 0.32 % |
| 44 | G195 | household batteries | battery | 0.34 % | 0.32 % |
| 45 | G8 | drink bottles >0.5 l | plastic_rigid | 0.34 % | 0.32 % |
| 46 | G145 | other textiles (incl. rags) | textile | 0.31 % | 0.29 % |
| 47 | G153 | paper cups, food trays, wrappers | paper | 0.29 % | 0.27 % |
| 48 | G165 | ice-cream sticks, chopsticks, toothpicks | wood_worked | 0.26 % | 0.24 % |
| 49 | G26 | cigarette lighters | plastic_rigid | 0.24 % | 0.22 % |
| 50 | G144 | tampons and applicators | composite_misc | 0.24 % | 0.22 % |

## 3. Known gaps

- Beach litter over-represents buoyant items. Dense items (glass, metal, ceramic) and **electronics are under-represented or absent**.
- **No organic / natural / animal items** yet (bones, shells, seeds, leaves, wood, feathers…).
- Sprite diversity: items inside one material look very different (a bottle cap vs a cotton bud vs a lighter are all “rigid plastic”). Sprites should be per item type, not per material.
- The JRC report's text says the top ten ≈ 63 %, but its own Table A1 sums to 68.1 %; table values are used.
