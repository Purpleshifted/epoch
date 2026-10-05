/**
 * stratum/catalogue.ts
 *
 * The single hub: every item type the visitor can scatter, tied to a material and
 * to its real-world frequency.
 *
 * SOURCE (frequencies): Addamo, Laroche & Hanke (2017), "Top Marine Beach Litter
 * Items in Europe", JRC Technical Report EUR 29249 EN, doi:10.2760/496717,
 * Annex II, Table A1 (European beach litter, 2016; 355,671 items, 679 surveys,
 * 276 beaches). Reuse authorised with acknowledgement (Decision 2011/833/EU).
 *
 * Caveats:
 *  - Beach litter over-represents buoyant items; dense items (glass, metal,
 *    ceramic, e-waste) are under-represented relative to landfill / sediment.
 *  - The report's text says the top ten are "ca. 63 %" but its own table sums to
 *    68.1 %. The per-item table values are used here.
 *  - Ranks 1–50 sum to ~93 % of all items; weights are renormalised.
 *  - `material` is OUR mapping of the JRC categories onto ./materials.
 */

import type { MaterialId } from "./materials";

export interface CatalogueEntry {
  /** MSFD Master List code(s), as printed in the JRC table. */
  code: string;
  name: string;
  material: MaterialId;
  /** JRC rank (1 = most abundant) and share of all items, percent. */
  rank: number;
  percent: number;
}

const e = (rank: number, code: string, name: string, material: MaterialId, percent: number): CatalogueEntry =>
  ({ rank, code, name, material, percent });

export const CATALOGUE: readonly CatalogueEntry[] = [
  e(1,  "G76+G79+G82",       "plastic/polystyrene pieces 2.5-50 cm", "plastic_fragment", 14.90),
  e(2,  "G75+G78+G81",       "plastic/polystyrene pieces 0-2.5 cm",  "plastic_fragment", 13.83),
  e(3,  "G50",               "string and cord (<1 cm)",              "plastic_cordage",  13.75),
  e(4,  "G27",               "cigarette butts and filters",          "acetate_filter",    6.14),
  e(5,  "G20+G21+G22+G23+G24","plastic caps, lids, bottle-cap rings", "plastic_rigid",     5.27),
  e(6,  "G95",               "cotton bud sticks",                    "plastic_rigid",     3.82),
  e(7,  "G213",              "paraffin / wax",                       "wax",               2.90),
  e(8,  "G30",               "crisp packets / sweet wrappers",       "plastic_film",      2.89),
  e(9,  "G124",              "other plastic items (identifiable)",   "plastic_rigid",     2.85),
  e(10, "G2+G3+G4+G5",       "plastic bags",                         "plastic_film",      1.74),
  e(11, "G211",              "other medical items",                  "composite_misc",    1.64),
  e(12, "x_a",               "other (diapers, tissue, razors)",      "composite_misc",    1.43),
  e(13, "G73",               "foam sponge",                          "plastic_foam",      1.17),
  e(14, "G77+G80+G83",       "plastic/polystyrene pieces >50 cm",    "plastic_fragment",  1.17),
  e(15, "G200",              "glass/ceramic bottles incl. pieces",   "glass",             1.07),
  e(16, "G6-G8",             "plastic beverage bottles",             "plastic_rigid",     1.06),
  e(17, "G34-G35",           "cutlery, straws, stirrers",            "plastic_rigid",     1.03),
  e(18, "G54",               "nets and pieces of net >50 cm",        "plastic_cordage",   0.98),
  e(19, "G96",               "sanitary towels / liners",             "composite_misc",    0.81),
  e(20, "G49",               "rope (>1 cm)",                         "plastic_cordage",   0.79),
  e(21, "G125",              "balloons and balloon sticks",          "rubber",            0.71),
  e(22, "G171",              "other worked wood <50 cm",             "wood_worked",       0.69),
  e(23, "G158",              "other paper items",                    "paper",             0.68),
  e(24, "G134",              "other rubber pieces",                  "rubber",            0.67),
  e(25, "G175",              "beverage cans",                        "metal_can",         0.67),
  e(26, "G10",               "food containers incl. fast food",      "plastic_rigid",     0.66),
  e(27, "G70",               "shotgun cartridges",                   "plastic_rigid",     0.64),
  e(28, "G66",               "strapping bands",                      "plastic_cordage",   0.63),
  e(29, "G56",               "tangled nets / cord",                  "plastic_cordage",   0.59),
  e(30, "G33",               "cups and cup lids",                    "plastic_rigid",     0.56),
  e(31, "G178",              "bottle caps, lids, pull tabs (metal)", "metal_can",         0.56),
  e(32, "G152",              "cigarette packets",                    "paper",             0.55),
  e(33, "G53",               "nets and pieces of net <50 cm",        "plastic_cordage",   0.52),
  e(34, "G210",              "other glass items",                    "glass",             0.48),
  e(35, "G204",              "construction material (brick, cement, pipes)", "ceramic_construction", 0.46),
  e(36, "G67",               "sheets, industrial packaging",         "plastic_film",      0.41),
  e(37, "G177",              "foil wrappers, aluminium foil",        "metal_foil",        0.40),
  e(38, "G59",               "fishing line / monofilament",          "plastic_cordage",   0.38),
  e(39, "G137",              "clothing / rags",                      "textile",           0.35),
  e(40, "G32",               "toys and party poppers",               "plastic_rigid",     0.35),
  e(41, "G7",                "drink bottles <=0.5 l",                "plastic_rigid",     0.33),
  e(42, "G9",                "cleaner bottles and containers",       "plastic_rigid",     0.32),
  e(43, "G45",               "mussel / oyster nets",                 "plastic_cordage",   0.32),
  e(44, "G195",              "household batteries",                  "battery",           0.32),
  e(45, "G8",                "drink bottles >0.5 l",                 "plastic_rigid",     0.32),
  e(46, "G145",              "other textiles (incl. rags)",          "textile",           0.29),
  e(47, "G153",              "paper cups, food trays, wrappers",     "paper",             0.27),
  e(48, "G165",              "ice-cream sticks, chopsticks, toothpicks", "wood_worked",   0.24),
  e(49, "G26",               "cigarette lighters",                   "plastic_rigid",     0.22),
  e(50, "G144",              "tampons and applicators",              "composite_misc",    0.22),
];

export const CATALOGUE_TOTAL_PERCENT = CATALOGUE.reduce((s, c) => s + c.percent, 0);
