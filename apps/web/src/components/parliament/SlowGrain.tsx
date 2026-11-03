"use client";
/**
 * SlowGrain — film grain that need not change every frame. The stock grain draws new noise each frame in proportion to
 * the pixel's brightness, which can read as bright pixels flashing where the picture has thin lines and tiny points (the
 * artist, 2026-11-02). Here `rate` says how many times a second it changes: 0 = a still grain, 60 = about as before.
 */

import { useEffect, useMemo } from "react";
import { BlendFunction, Effect } from "postprocessing";
import { Uniform, type WebGLRenderer, type WebGLRenderTarget } from "three";

/** How many of the buffer's pixels one grain takes: 1, but for a picture larger than the screen (LandscapeShot). */
export const GRAIN_CELL = new Uniform(1);

const FRAGMENT = /* glsl */ `
uniform float seed;
uniform float cell;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float n = fract(sin(dot(floor(uv * resolution / cell), vec2(12.9898, 78.233)) + seed) * 43758.5453);
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

export function SlowGrain({ opacity, rate }: { opacity: number; rate: number }) {
  const effect = useMemo(() => new SlowGrainEffect(), []);
  useEffect(() => {
    effect.rate = rate;
    effect.blendMode.opacity.value = opacity;
  }, [effect, opacity, rate]);
  return <primitive object={effect} dispose={null} />;
}
