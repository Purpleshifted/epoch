/**
 * stratum/materials.ts
 *
 * Material classes and their taphonomic parameters.
 *
 * !! DESIGN PARAMETERS, NOT MEASUREMENTS. !!
 * Persistence ranges are editorial estimates (label them "EST." wherever they are
 * shown). What is grounded in the literature is the *rank order*:
 *   paper < textile < wood < acetate filter < film < foam < cordage/rubber
 *         < rigid plastic < metal < glass < ceramic/construction
 * Sources for the ranking: Zalasiewicz et al. 2016 (plastics as stratigraphic
 * marker), Chamas et al. 2020 (HDPE half-lives 58–1,200 y), Geyer et al. 2017
 * ("none of the mass-produced plastics biodegrade in any meaningful sense"),
 * Behrensmeyer 1978 (weathering stages). Widely repeated single numbers
 * (e.g. "PET bottle 450 y") are weakly sourced and deliberately not used.
 */

export type MaterialId =
  | "paper"
  | "textile"
  | "wood_worked"
  | "wax"
  | "acetate_filter"
  | "plastic_film"
  | "plastic_foam"
  | "plastic_fragment"
  | "plastic_cordage"
  | "plastic_rigid"
  | "composite_misc"
  | "rubber"
  | "metal_foil"
  | "metal_can"
  | "battery"
  | "glass"
  | "ceramic_construction"
  // catalogue v2 (EST.): electronics and organic matter
  | "ewaste_device"
  | "ewaste_board"
  | "soft_organic"
  | "wood_natural"
  | "feather_hair"
  | "bone"
  | "tooth"
  | "shell"
  | "charcoal";

export interface MaterialParams {
  id: MaterialId;
  label: string;
  /** Exposed (surface) persistence range, years. EST. Item lifetime is log-uniform within it. */
  persistenceYears: readonly [number, number];
  /**
   * Chance that an item of this material becomes permanent (fossil / technofossil)
   * once it has been buried long enough. EST.
   */
  fossilPotential: number;
  /** Natural vs synthetic matter, used later for palette mapping. */
  origin: "natural" | "synthetic";
}

export const MATERIALS: Readonly<Record<MaterialId, MaterialParams>> = {
  paper:                { id: "paper",                label: "paper / cardboard",        persistenceYears: [0.1, 2],     fossilPotential: 0.02, origin: "natural" },
  textile:              { id: "textile",              label: "textile / rags",            persistenceYears: [1, 30],      fossilPotential: 0.05, origin: "natural" },
  wood_worked:          { id: "wood_worked",          label: "worked wood",               persistenceYears: [1, 60],      fossilPotential: 0.05, origin: "natural" },
  wax:                  { id: "wax",                  label: "paraffin / wax",            persistenceYears: [5, 100],     fossilPotential: 0.1,  origin: "synthetic" },
  acetate_filter:       { id: "acetate_filter",       label: "cigarette filter",          persistenceYears: [2, 20],      fossilPotential: 0.3,  origin: "synthetic" },
  plastic_film:         { id: "plastic_film",         label: "plastic film / bag",        persistenceYears: [10, 300],    fossilPotential: 0.5,  origin: "synthetic" },
  plastic_foam:         { id: "plastic_foam",         label: "foam / EPS",                persistenceYears: [30, 600],    fossilPotential: 0.5,  origin: "synthetic" },
  plastic_fragment:     { id: "plastic_fragment",     label: "plastic fragment",          persistenceYears: [50, 1000],   fossilPotential: 0.65, origin: "synthetic" },
  plastic_cordage:      { id: "plastic_cordage",      label: "string / rope / net",       persistenceYears: [50, 800],    fossilPotential: 0.55, origin: "synthetic" },
  plastic_rigid:        { id: "plastic_rigid",        label: "rigid plastic",             persistenceYears: [100, 1200],  fossilPotential: 0.65, origin: "synthetic" },
  composite_misc:       { id: "composite_misc",       label: "mixed / composite",         persistenceYears: [5, 200],     fossilPotential: 0.2,  origin: "synthetic" },
  rubber:               { id: "rubber",               label: "rubber",                    persistenceYears: [30, 500],    fossilPotential: 0.4,  origin: "synthetic" },
  metal_foil:           { id: "metal_foil",           label: "metal foil",                persistenceYears: [20, 300],    fossilPotential: 0.35, origin: "synthetic" },
  metal_can:            { id: "metal_can",            label: "metal can / cap",           persistenceYears: [50, 600],    fossilPotential: 0.5,  origin: "synthetic" },
  battery:              { id: "battery",              label: "battery",                   persistenceYears: [20, 300],    fossilPotential: 0.3,  origin: "synthetic" },
  glass:                { id: "glass",                label: "glass",                     persistenceYears: [1e3, 1e6],   fossilPotential: 0.85, origin: "synthetic" },
  ceramic_construction: { id: "ceramic_construction", label: "ceramic / brick / cement",  persistenceYears: [1e3, 1e6],   fossilPotential: 0.9,  origin: "synthetic" },
  // catalogue v2 (all EST.; see docs/catalogue-v2.md §6)
  ewaste_device:        { id: "ewaste_device",        label: "electronic device",         persistenceYears: [20, 500],    fossilPotential: 0.2,  origin: "synthetic" },
  ewaste_board:         { id: "ewaste_board",         label: "circuit board / chip",      persistenceYears: [100, 5000],  fossilPotential: 0.6,  origin: "synthetic" },
  soft_organic:         { id: "soft_organic",         label: "soft organic matter",       persistenceYears: [0.005, 1],   fossilPotential: 0.01, origin: "natural" },
  wood_natural:         { id: "wood_natural",         label: "twig / bark",               persistenceYears: [1, 100],     fossilPotential: 0.08, origin: "natural" },
  feather_hair:         { id: "feather_hair",         label: "feather / fur",             persistenceYears: [0.3, 10],    fossilPotential: 0.03, origin: "natural" },
  bone:                 { id: "bone",                 label: "bone",                      persistenceYears: [20, 5000],   fossilPotential: 0.35, origin: "natural" },
  tooth:                { id: "tooth",                label: "tooth",                     persistenceYears: [500, 1e6],   fossilPotential: 0.65, origin: "natural" },
  shell:                { id: "shell",                label: "shell / coral",             persistenceYears: [100, 1e5],   fossilPotential: 0.6,  origin: "natural" },
  charcoal:             { id: "charcoal",             label: "charcoal / coal",           persistenceYears: [100, 1e4],   fossilPotential: 0.4,  origin: "natural" },
};

/** Decay runs this much slower once an item is buried (low oxygen, no UV, no abrasion). EST. */
export const BURIED_DECAY_FACTOR = 0.02;

/** Buried this many (simulated) years before mineralisation / compression can finish. EST. */
export const MINERALISE_YEARS = 50;
