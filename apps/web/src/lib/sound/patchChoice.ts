/**
 * sound/patchChoice.ts — which NoiseCraft patch plays (v4 A5l, the artist: "sound 들어가면 패치 고를 수 있게 — 나중에 롤
 * 별로 따로 패치를 두는 게 나을 수도"). The bench (/v2/sound) offers the .ncft files of apps/web/public/noisecraft/examples;
 * the choice is kept in localStorage and the player (NoiseCraftHost) plays the same one. Client-safe (no fs).
 */

export const DEFAULT_PATCH = "nc_noise_patch.ncft";
export const PATCH_KEY = "anthropocene:sound:patch:v1";

/** The chosen patch file name (the default when nothing was chosen or storage is unavailable). */
export function loadPatchChoice(): string {
  if (typeof window === "undefined") return DEFAULT_PATCH;
  try {
    const v = window.localStorage.getItem(PATCH_KEY);
    return v && v.endsWith(".ncft") ? v : DEFAULT_PATCH;
  } catch {
    return DEFAULT_PATCH;
  }
}

export function savePatchChoice(filename: string): void {
  try {
    window.localStorage.setItem(PATCH_KEY, filename);
  } catch {
    /* ignore */
  }
}
