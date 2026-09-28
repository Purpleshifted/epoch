"use client";
/**
 * RadialBlurEffect — webgpu_postprocessing_radial_blur을 WebGL GLSL로 포팅
 *
 * 아키텍처:
 *  - Effect 인스턴스를 export 함수로 생성 (useMemo 사용)
 *  - EffectComposer 안에는 <primitive object={effect} /> 로 등록
 *  - 속도 기반 업데이트는 EffectComposer 밖의 별도 컴포넌트에서 useFrame으로 처리
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Effect, BlendFunction } from "postprocessing";
import * as THREE from "three";

// ── GLSL ────────────────────────────────────────────────────────────
const FRAG = /* glsl */`
uniform vec2  uCenter;
uniform float uStrength;
uniform float uDecay;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength < 0.001) {
    outputColor = inputColor;
    return;
  }
  vec2  dir  = uv - uCenter;
  vec4  col  = vec4(0.0);
  float wSum = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0;
    float w = 1.0 - t * uDecay;
    col  += texture2D(inputBuffer, uv - dir * uStrength * t) * w;
    wSum += w;
  }
  outputColor = col / wSum;
}
`;

// ── Effect 클래스 ───────────────────────────────────────────────────
export class RadialBlurEffectImpl extends Effect {
  constructor() {
    super("RadialBlurEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform<unknown>>([
        ["uCenter",   new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ["uStrength", new THREE.Uniform(0.0)],
        ["uDecay",    new THREE.Uniform(0.55)],
      ]),
    });
  }
  setStrength(v: number) {
    (this.uniforms.get("uStrength") as THREE.Uniform<number>).value = v;
  }
  setDecay(v: number) {
    (this.uniforms.get("uDecay") as THREE.Uniform<number>).value = v;
  }
}

/**
 * useRadialBlurEffect — Effect 인스턴스를 생성하고 ref를 반환.
 * EffectComposer 내에서: <primitive object={effect} />
 */
export function useRadialBlurEffect() {
  const effectRef = useRef<RadialBlurEffectImpl | null>(null);
  const effect = useMemo(() => {
    const fx = new RadialBlurEffectImpl();
    effectRef.current = fx;
    return fx;
  }, []);
  return { effect, effectRef };
}

/**
 * RadialBlurDriver — EffectComposer 밖에 배치.
 * 매 프레임 speedRef → uniform 업데이트.
 */
export function RadialBlurDriver({
  effectRef,
  speedRef,
  maxStrength = 0.035,
  maxSpeed    = 8.0,
  decay       = 0.55,
}: {
  effectRef:    React.MutableRefObject<RadialBlurEffectImpl | null>;
  speedRef:     React.MutableRefObject<number>;
  maxStrength?: number;
  maxSpeed?:    number;
  decay?:       number;
}) {
  useFrame(() => {
    const fx = effectRef.current;
    if (!fx) return;
    const t = Math.min(speedRef.current / maxSpeed, 1.0);
    fx.setStrength(t * maxStrength);
    fx.setDecay(decay);
  });
  return null;
}
