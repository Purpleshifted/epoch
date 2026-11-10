"use client";
/**
 * SlowGrain — film grain that need not change every frame. The stock grain draws new noise each frame in proportion to
 * the pixel's brightness, which can read as bright pixels flashing where the picture has thin lines and tiny points (the
 * artist, 2026-11-02). Here `rate` says how many times a second it changes: 0 = a still grain, 60 = about as before.
 * `kind` (the artist, 2026-11-10: "turned up, the grain shows stripes"): "sin" is the usual sine hash, which bands and
 * streaks at high opacity (its argument grows with the pixel count and the sine loses precision); "hash" is a sine-free
 * hash (Hoskins) with no stripes. `blend` is how it goes onto the picture; `size` is the grain's size in buffer pixels.
 */

import { useEffect, useMemo } from "react";
import { BlendFunction, Effect } from "postprocessing";
import { Uniform, type WebGLRenderer, type WebGLRenderTarget } from "three";

/** How many of the buffer's pixels one grain takes: 1, but for a picture larger than the screen (LandscapeShot). */
export const GRAIN_CELL = new Uniform(1);

export type GrainKind = "sin" | "hash";
export type GrainBlend = "screen" | "overlay" | "softlight" | "add" | "multiply";

const BLENDS: Record<GrainBlend, BlendFunction> = {
  screen: BlendFunction.SCREEN,
  overlay: BlendFunction.OVERLAY,
  softlight: BlendFunction.SOFT_LIGHT,
  add: BlendFunction.ADD,
  multiply: BlendFunction.MULTIPLY,
};

const FRAGMENT = /* glsl */ `
uniform float seed;
uniform float cell;
uniform float grainSize;
uniform float sinHash;
// a hash without a sine (Dave Hoskins): no banding however large the coordinates
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 g = floor(uv * resolution / (cell * grainSize));
  float n = sinHash > 0.5 ? fract(sin(dot(g, vec2(12.9898, 78.233)) + seed) * 43758.5453) : hash12(g + seed);
  outputColor = vec4(min(inputColor.rgb * n, vec3(1.0)), inputColor.a);
}
`;

class SlowGrainEffect extends Effect {
  rate = 0;
  private since = 0;

  constructor() {
    super("SlowGrainEffect", FRAGMENT, {
      blendFunction: BlendFunction.SCREEN,
      uniforms: new Map<string, Uniform>([
        ["seed", new Uniform(0.37)],
        ["cell", GRAIN_CELL],
        ["grainSize", new Uniform(1)],
        ["sinHash", new Uniform(1)],
      ]),
    });
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, deltaTime = 0): void {
    if (this.rate <= 0) return;
    this.since += deltaTime;
    if (this.since < 1 / this.rate) return;
    this.since = 0;
    this.uniforms.get("seed")!.value = Math.random() * 100;
  }
}

export function SlowGrain({ opacity, rate, kind = "sin", blend = "screen", size = 1 }: { opacity: number; rate: number; kind?: GrainKind; blend?: GrainBlend; size?: number }) {
  const effect = useMemo(() => new SlowGrainEffect(), []);
  useEffect(() => {
    effect.rate = rate;
    effect.blendMode.opacity.value = opacity;
    effect.uniforms.get("sinHash")!.value = kind === "sin" ? 1 : 0;
    effect.uniforms.get("grainSize")!.value = Math.max(1, size);
    if (effect.blendMode.blendFunction !== BLENDS[blend]) effect.blendMode.blendFunction = BLENDS[blend];
  }, [effect, opacity, rate, kind, blend, size]);
  return <primitive object={effect} dispose={null} />;
}
