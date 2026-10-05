/**
 * stratum/palette.ts
 *
 * The 16-colour VGA palette as used by TempleOS (verified against the V5.03 source:
 * BLACK, BLUE, GREEN, CYAN, RED, PURPLE, BROWN, LTGRAY, DKGRAY, LTBLUE, LTGREEN,
 * LTCYAN, LTRED, LTPURPLE, YELLOW, WHITE). Only the palette is borrowed.
 */

import type { MaterialId } from "./materials";
import type { Stage } from "./taphonomy";

export const PALETTE_HEX: readonly number[] = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

/**
 * PLACEHOLDER mapping until real sprites exist: one palette index per material.
 * Natural matter takes earth tones, synthetic matter takes the loud colours.
 */
export const MATERIAL_PALETTE_INDEX: Readonly<Record<MaterialId, number>> = {
  paper: 7,
  textile: 6,
  wood_worked: 6,
  wax: 14,
  acetate_filter: 14,
  plastic_film: 11,
  plastic_foam: 15,
  plastic_fragment: 9,
  plastic_cordage: 10,
  plastic_rigid: 12,
  composite_misc: 13,
  rubber: 8,
  metal_foil: 7,
  metal_can: 3,
  battery: 2,
  glass: 11,
  ceramic_construction: 4,
  ewaste_device: 5,
  ewaste_board: 2,
  soft_organic: 10,
  wood_natural: 6,
  feather_hair: 7,
  bone: 15,
  tooth: 15,
  shell: 14,
  charcoal: 8,
};

/** How the stage darkens / marks an item. Palette indices only. */
export function stageTint(stage: Stage): { dim: boolean; dither: boolean; outline: boolean } {
  switch (stage) {
    case "fresh": return { dim: false, dither: false, outline: false };
    case "weathered": return { dim: false, dither: true, outline: false };
    case "fragmented": return { dim: true, dither: true, outline: false };
    case "buried": return { dim: true, dither: false, outline: false };
    case "compressed": return { dim: true, dither: false, outline: false };
    case "fossil": return { dim: false, dither: false, outline: true };
    case "vanished": return { dim: true, dither: true, outline: false };
  }
}

/** The darker neighbour of a palette index (bright -> its dark twin, else dark grey). */
export function dimIndex(i: number): number {
  if (i >= 9 && i <= 14) return i - 8; // light colour -> its dark twin
  if (i === 15) return 7;
  if (i === 7) return 8;
  if (i === 8) return 0;
  return 8;
}
