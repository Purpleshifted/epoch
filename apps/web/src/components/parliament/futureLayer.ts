/**
 * THE FUTURE ON A LAYER OF ITS OWN (the artist, 2026-11-27: "미래랑 현재는 거리 따라 lod/흐림/뭉침 적용하는 정도 따로
 * 조절 가능하게"): the scan's residue (FutureResidue.tsx) is drawn on FUTURE_LAYER. Under the photograph (InkPaper.tsx)
 * that layer is left out of the scene the photograph softens by depth and drawn over the composed frame instead — its
 * thinning, growing and softening by distance are its own, in its shader — hidden where the present stands nearer (the
 * scene's depth, handed over in `presentDepth` for that pass only). Without the photograph the camera sees the layer
 * with the rest, in one pass, and the depth test does the hiding.
 */

import * as THREE from "three";

/** (2 is InkPaper's EXPOSURE_LAYER, 5 the pictograms' PICTO_LAYER) */
export const FUTURE_LAYER = 6;

/** While InkPaper draws FUTURE_LAYER: the present's depth (the scene's, as the photograph saw it), the drawing buffer's
 *  size, and uOcclude 1 — the residue's shaders drop what lies behind it. 0 at every other time. Shared by reference
 *  with the residue's materials. */
export const presentDepth = {
  uPresentDepth: { value: null as THREE.Texture | null },
  uPresentRes: { value: new THREE.Vector2(1, 1) },
  uOcclude: { value: 0 },
};

/** THE FUTURE SOFTENED AS THE PRESENT IS (the artist, 2026-11-27: "'현재' 점의 거리 효과랑은 너무 다르게 적용되는 것
 *  같아서", "이것봐, 너무 또렷하잖아"): InkPaper draws the layer into a frame of its own and softens it by its own depth
 *  with the photograph's rule — a narrow blur everywhere, a wide one by distance — at the future's own radii (px; 0 and
 *  0 = drawn straight over the frame, sharp). Set each frame by FutureResidue while it runs (`active`). */
export const futureInk = { active: false, narrow: 1.2, wide: 6 };

/** The GLSL half of it (a fragment shader's): the uniforms, and the test, first thing in main(). */
export const PRESENT_DEPTH_GLSL = /* glsl */ `
uniform sampler2D uPresentDepth;
uniform vec2 uPresentRes;
uniform float uOcclude;
bool behindPresent() {
  return uOcclude > 0.5 && texture2D(uPresentDepth, gl_FragCoord.xy / uPresentRes).r < gl_FragCoord.z - 0.000002;
}`;
