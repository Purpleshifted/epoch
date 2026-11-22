/**
 * streetLook — 길거리 (2026-11-22, a trial; docs/street-feel.md): the GROUND's part of the street look. Set by the Leva
 * folder 개인뷰 비주얼 › 길거리 (usePersonalVisuals) and read PER FRAME by the ground components RoleField mounts with props
 * of their own (DitherGround, NatureCloud) — so the trial reaches them without touching RoleField. A plain module value,
 * no React; `on` false = nothing of it runs and the ground is drawn as it was.
 */

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
}

export const streetGround: StreetGroundLook = { on: false, wear: 0.7, wearGrey: 0.42, seam: 0.6, grain: 0.5, wind: 0.5, windSpeed: 1, sway: 0.5 };

export function setStreetGround(v: Partial<StreetGroundLook>): void {
  Object.assign(streetGround, v);
}
