/**
 * THE PLANTS' COLOURS, LIVELIER (the artist, 2026-11-17: "나무랑 식생 다채로웠으면 좋겠어서", "지금 식생 색도
 * 죽어있어서;;"). Every point of the layer above the column that is a plant goes through `tone`: its colour made more
 * saturated (`vivid`), a little brighter (`light`), and turned along the hue a way of its own (`hue`, by a number of
 * the point's own) — so a stand of plants is not one flat green. The knobs are the folder 미래 마을 층 — 땅 아래's
 * (FutureUnder.tsx); FutureVillage draws the inferred plants with it too. Nature only: never applied to what people
 * left (buildings, ways, mounds, earth, stones stay achromatic).
 */
import * as THREE from "three";

export const plantTone = { vivid: 1, light: 1, hue: 0, version: 0 };

const hsl = { h: 0, s: 0, l: 0 };

/** Writes into `c` the colour (r, g, b) as the knobs make it, for a point whose own number is `own` (0 … 1). */
export function tone(c: THREE.Color, r: number, g: number, b: number, own: number): THREE.Color {
  c.setRGB(r, g, b);
  if (plantTone.vivid === 1 && plantTone.light === 1 && plantTone.hue === 0) return c;
  c.getHSL(hsl);
  const o = ((own % 1) + 1) % 1;
  hsl.h = (((hsl.h + (o - 0.5) * plantTone.hue * 0.25) % 1) + 1) % 1;
  hsl.s = Math.min(1, hsl.s * plantTone.vivid);
  hsl.l = Math.min(0.95, hsl.l * plantTone.light);
  return c.setHSL(hsl.h, hsl.s, hsl.l);
}
