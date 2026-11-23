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
  /** Neutral white since 2026-11-23 (streetLook.ts PAPER, which sets it). */
  paper: "#ffffff",
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
 *   exposeTone(col, rolloff)               an overexposed photograph: above a knee of 0.8 (linear) the highlights are LIFTED
 *                                          and blow out softly into the paper's white (white stays exactly white; rolloff
 *                                          0 … 1 = how much of that lift)
 *   filmGrain(frag, t, amount)             a fine living grain (~0.01) plus a dither against banding — add to the colour
 *   blownGrain(col)                        1 … 0: how much grain a pixel takes — none on the blown white (a clipped
 *                                          highlight is clean), full below it
 *
 * 2026-11-23 (the artist: "깔끔한 화이트가 아니라 누렇게 보임"): the old shoulder 1 − e^(−x·1.6) COMPRESSED the highlights,
 * so the paper itself (l = 1) came out at 0.96 linear — never above ~250 on screen, a dull cap. The shoulder is now
 * g(x) = x + x² − x³: it leaves the knee at slope 1, never darkens, and reaches white at the top with slope 0 (blown).
 */
export const EXPOSE_GLSL = /* glsl */ `
vec3 exposeOnWhite(vec3 base, float density, float maxDark) { return base * (1.0 - clamp(density, 0.0, 1.0) * maxDark); }
vec3 exposeOnWhite(vec3 base, vec3 density, float maxDark) { return base * (1.0 - clamp(density, 0.0, 1.0) * maxDark); }
vec3 exposeOnBlack(vec3 base, float density, float light) { return base + vec3(clamp(density, 0.0, 1.0) * light); }
vec3 exposeTone(vec3 col, float rolloff) {
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float knee = 0.8;
  float x = clamp((l - knee) / (1.0 - knee), 0.0, 1.0);
  float soft = l > knee && l < 1.0 ? knee + (1.0 - knee) * (x + x * x - x * x * x) : l;
  return col * mix(1.0, soft / max(l, 1e-4), rolloff);
}
float filmGrain(vec2 frag, float t, float amount) {
  float g = fract(sin(dot(frag + fract(t * 13.0), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  float d = fract(sin(dot(frag * 1.7 + fract(t * 7.0), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  return g * amount + d / 255.0;
}
float blownGrain(vec3 col) { return 1.0 - smoothstep(0.97, 0.995, dot(col, vec3(0.299, 0.587, 0.114))); }
`;
