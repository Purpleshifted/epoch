/**
 * stratum/items.ts
 *
 * Catalogue v2 (docs/catalogue-v2.md): the things a visitor can scatter (layers A, B, C)
 * and the natural stock the ground starts with (layer N).
 *
 *   A  JRC European beach litter 2016, whole Table A1 grouped into sprite items (measured)
 *   B  electronics (authored, EST.)
 *   C  anthropogenic organics: food, bones, shells, charcoal (authored, EST.)
 *   N  natural stock: not scattered, shrinks as visitors walk (authored, EST.)
 *
 * The rows come from items.data.ts, which is generated from docs/data/catalogue-v2.json.
 */

import { ITEMS_A, ITEMS_B, ITEMS_C, ITEMS_N, LAYER_SHARE, NATURAL_CAL, type ItemRow } from "./items.data";
import type { MaterialId } from "./materials";

export type Layer = "A" | "B" | "C";

export interface ItemDef {
  /** Position in ITEMS (stable for a given catalogue build). */
  index: number;
  id: string;
  label: string;
  layer: Layer;
  material: MaterialId;
  /** Number of sprite variants. */
  variants: number;
  /** Prior probability of being drawn (layer share × share within layer). Sums to 1. */
  prior: number;
}

export interface NaturalDef {
  id: string;
  label: string;
  group: "flora" | "fauna";
  material: MaterialId;
  variants: number;
  /** Relative resistance to trampling inside its group (1 = median). EST. */
  resist: number;
  /** Share of the natural stock (0..1). */
  share: number;
}

export { LAYER_SHARE, NATURAL_CAL };

function build(rows: readonly ItemRow[], layer: Layer, out: ItemDef[]) {
  // Shares in items.data.ts are rounded; normalise by the layer's own sum so the layer carries exactly LAYER_SHARE.
  const sum = rows.reduce((s, r) => s + r.share, 0);
  for (const r of rows) {
    out.push({
      index: out.length,
      id: r.id,
      label: r.label,
      layer,
      material: r.material as MaterialId,
      variants: r.variants,
      prior: (LAYER_SHARE[layer] * r.share) / sum,
    });
  }
}

/** Everything a visitor can scatter, A then B then C. */
export const ITEMS: readonly ItemDef[] = (() => {
  const out: ItemDef[] = [];
  build(ITEMS_A, "A", out);
  build(ITEMS_B, "B", out);
  build(ITEMS_C, "C", out);
  return out;
})();

export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export function itemById(id: string): ItemDef {
  const it = ITEM_BY_ID.get(id);
  if (!it) throw new Error(`unknown item id: ${id}`);
  return it;
}

const PRIOR_CUMULATIVE: readonly number[] = (() => {
  let acc = 0;
  const total = ITEMS.reduce((s, i) => s + i.prior, 0);
  return ITEMS.map((i) => (acc += i.prior / total));
})();

/** `u` in [0,1): draw an item from the catalogue prior (layer share × frequency). */
export function sampleItem(u: number): ItemDef {
  const x = Math.min(Math.max(u, 0), 1 - Number.EPSILON);
  let lo = 0;
  let hi = PRIOR_CUMULATIVE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (PRIOR_CUMULATIVE[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return ITEMS[lo];
}

/** The natural stock (layer N). */
export const NATURALS: readonly NaturalDef[] = (() => {
  const total = ITEMS_N.reduce((s, n) => s + n.share, 0);
  return ITEMS_N.map((n) => ({
    id: n.id,
    label: n.label,
    group: n.group,
    material: n.material as MaterialId,
    variants: n.variants,
    resist: n.resist,
    share: n.share / total,
  }));
})();

export const NATURAL_BY_ID: ReadonlyMap<string, NaturalDef> = new Map(NATURALS.map((n) => [n.id, n]));
