/**
 * streetLook — 길거리 (2026-11-22, a trial; docs/street-feel.md): the GROUND's part of the street look. Set by the Leva
 * folder 개인뷰 비주얼 › 길거리 (usePersonalVisuals) and read PER FRAME by the ground components RoleField mounts with props
 * of their own (DitherGround, NatureCloud) — so the trial reaches them without touching RoleField. A plain module value,
 * no React; `on` false = nothing of it runs and the ground is drawn as it was.
 */

import { paperLook } from "./paperLook";

export interface StreetGroundLook {
  on: boolean;
  /** The worn ground where a path has formed: how much of the grass it takes (0 … 1) and its grey (a human trace). */
  wear: number;
  wearGrey: number;
  /** The seam where two cells' wear differs (a kerb's line): its darkness (0 = none). */
  seam: number;
  /** The grain of the worn ground (0 = flat). */
  grain: number;
  /** Wind over the field: the depth of its slow waves of shade (0 = none) and their speed. */
  wind: number;
  windSpeed: number;
  /** The sway of square-point grass in that wind (0 = none). */
  sway: number;
  /** 시야 반경: the concrete's outlines (Marks.tsx, fog-less by design) take the scene's fog too, so nothing shows beyond it. */
  viewFog: boolean;
  /**
   * 흰 바탕 (오가닉) — the artist, 2026-11-22 night, after the 43-image study: the personal view on white PAPER, the lines, grid,
   * outlines and squares given up for the long exposure's smear and the overlap of acetate sheets. Read per frame by every
   * component of the personal view (and by future-presence for its frames): `streetGround.paper`.
   */
  paper: boolean;
  /** Whether the ground plane is drawn on the white ground at all (the artist, 2026-11-22: the floor is read from the vegetation). */
  groundOnPaper: boolean;
  /** How dark a person's blot is (0 … 1), the blur of its edge (px of the sprite sheet), the distance (world) over which
   *  a person pales to nothing, and within which a small label with its number stands by it. */
  ink: number;
  blur: number;
  fadeDist: number;
  labelDist: number;
  /** Within this radius (world) a person is a blot by this look; beyond it the present's scan (future-presence) carries them. */
  blotDist: number;
}

/** The paper's white, and the vegetation's light green on it. */
export const PAPER = "#f4f2ec";

/** Whoever asked me something last, and until when the eye may turn towards them (frame s): set by PointPeople, read by the controller. */
export const streetGaze: { x: number; z: number; until: number; on: boolean } = { x: 0, z: 0, until: 0, on: false };
export const PAPER_GREEN = "#b7d3a4";

export const streetGround: StreetGroundLook = { on: false, wear: 0.7, wearGrey: 0.42, seam: 0.6, grain: 0.5, wind: 0.5, windSpeed: 1, sway: 0.5, viewFog: false, paper: false, groundOnPaper: false, ink: 0.9, blur: 3, fadeDist: 12, labelDist: 4, blotDist: 8 };

export function setStreetGround(v: Partial<StreetGroundLook>): void {
  const was = streetGround.paper;
  Object.assign(streetGround, v);
  // the same flag for the sessions that only read it (paperLook.ts, byte-identical on their branches)
  paperLook.on = streetGround.paper;
  paperLook.paper = PAPER;
  paperLook.ink = "#141414";
  paperLook.near = streetGround.blotDist;
  // the flag's change, for whoever renders from React rather than per frame (future-presence's frames)
  if (streetGround.paper !== was && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("street-look", { detail: { paper: streetGround.paper } }));
}
