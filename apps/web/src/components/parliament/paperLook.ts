/**
 * paperLook — the WHITE GROUND of the personal view and the long exposure's tone (the artist, 2026-11-22 night: "전체 흰
 * 바탕"; then "장노출 사진이 어쩌다보니 먹처럼 보이는 게 좋은 거지, 억지로 먹 효과 넣는 건 싫어"). SET by the street look (개인뷰 비주얼 ›
 * 길거리, usePersonalVisuals); READ per frame by whatever draws into that view (future-presence's frames, windows, scan).
 * Owned by the street-feel session; others only read it — a byte-identical copy lives on their branches until they meet.
 *
 * The look is not ink: it is TIME ACCUMULATED (longExposure.ts, a feedback buffer) laid on an overexposed photograph's
 * white. A layer that wants the look either stands on EXPOSURE_LAYER (InkPaper exposes it for free) or accumulates its own
 * texture with a LongExposure and shows it through `exposeTone`.
 */

export const paperLook = {
  on: false,
  paper: "#f4f2ec",
  ink: "#141414",
  /** Within this radius (world) a person is drawn by the street look; beyond it the present's scan carries them. */
  near: 8,
};

/** Whatever stands on this three.js layer is exposed through InkPaper's feedback while the white ground is on. */
export const EXPOSURE_LAYER = 2;

/**
 * The GLSL half (paste into a fragment shader; declare nothing else):
 *   exposeOnWhite(base, density, maxDark)  the ground darkened by an accumulated density (0 … 1): base × (1 − density × maxDark)
 *                                          (density a float, or a vec3 — a coloured body's absorption per channel)
 *   exposeOnBlack(base, density, light)    the same on the black ground: base + density × light
 *   exposeTone(col, rolloff)               an overexposed photograph: the highlights roll off softly above a knee of 0.8
 *   filmGrain(frag, t, amount)             a fine living grain (~0.01) plus a dither against banding — add to the colour
 */
export const EXPOSE_GLSL = /* glsl */ `
vec3 exposeOnWhite(vec3 base, float density, float maxDark) { return base * (1.0 - clamp(density, 0.0, 1.0) * maxDark); }
vec3 exposeOnWhite(vec3 base, vec3 density, float maxDark) { return base * (1.0 - clamp(density, 0.0, 1.0) * maxDark); }
vec3 exposeOnBlack(vec3 base, float density, float light) { return base + vec3(clamp(density, 0.0, 1.0) * light); }
vec3 exposeTone(vec3 col, float rolloff) {
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float knee = 0.8;
  float soft = l > knee ? knee + (1.0 - knee) * (1.0 - exp(-(l - knee) / (1.0 - knee) * 1.6)) : l;
  return col * mix(1.0, soft / max(l, 1e-4), rolloff);
}
float filmGrain(vec2 frag, float t, float amount) {
  float g = fract(sin(dot(frag + fract(t * 13.0), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  float d = fract(sin(dot(frag * 1.7 + fract(t * 7.0), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  return g * amount + d / 255.0;
}
`;
