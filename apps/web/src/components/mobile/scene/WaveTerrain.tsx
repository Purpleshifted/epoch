"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SolarWindState } from "@/lib/world/useSolarWind";

// ─── FBM 높이 (world coordinates) ──────────────────────
export function getWaveHeight(
  wx: number, wz: number, t: number, sw: SolarWindState,
  octaves = 4, ampScale = 1.0, freqScale = 1.0
): number {
  const { waveAmplitude, waveSpeed, stormLevel } = sw;
  const baseAmp  = waveAmplitude * ampScale;
  const baseFreq = 0.18 * freqScale;
  const ts       = waveSpeed * 1.2;
  let val = 0, amp = baseAmp, freq = baseFreq, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    const ph = t * ts * (1 - i * 0.15);
    val += Math.sin(wx * freq + wz * freq * 0.7 + ph) * amp
         + Math.cos(wz * freq * 0.9 - wx * freq * 0.5 + ph * 0.8) * amp * 0.6;
    maxAmp += amp * 1.6;
    amp *= 0.52; freq *= 1.97;
  }
  const norm  = val / maxAmp;
  const storm = stormLevel > 0.25
    ? Math.sin(wx * 1.8 + wz * 1.3 + t * 5.5) * stormLevel * baseAmp * 0.6 : 0;
  return norm * baseAmp * 2.2 + storm;
}

// ─── 셰이더 ────────────────────────────────────────────
const VS = /* glsl */`
  varying vec3 vWorldPos;
  varying float vElevation;
  varying vec3 vNormal;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos  = worldPos.xyz;
    vElevation = position.y;
    vNormal    = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FS = /* glsl */`
  uniform vec3  uDeepColor;
  uniform vec3  uCrestColor;
  uniform vec3  uFresnelColor;
  uniform float uStormLevel;
  uniform float uAmplitude;
  uniform float uTime;
  uniform vec3  uFogColor;
  uniform float uFogDensity;

  varying vec3  vWorldPos;
  varying float vElevation;
  varying vec3  vNormal;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // 높이 기반 색상
    float h = clamp((vElevation / max(uAmplitude * 2.2, 0.1) + 0.5), 0.0, 1.0);
    vec3 color = mix(uDeepColor, uCrestColor, pow(h, 2.0));

    // 프레넬 (시선각 기반)
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 4.0);

    // 반사 방향 → 별빛 반사 근사
    vec3 R = reflect(-viewDir, vNormal);
    float starReflect = pow(max(0.0, R.y), 3.0); // 위를 향한 반사만
    color += uFresnelColor * (fresnel * 0.5 + starReflect * 0.25);

    // 파도 마루 반짝임 (애니메이션)
    float crestNorm = max(0.0, vNormal.y);
    float sparkle   = pow(crestNorm, 6.0)
      * (0.4 + 0.6 * sin(uTime * 4.0 + vWorldPos.x * 7.0)
                   * cos(uTime * 3.1 + vWorldPos.z * 6.3));
    color += vec3(0.5, 0.75, 1.0) * max(0.0, sparkle) * 0.4;

    // 디퓨즈
    float diffuse = max(0.0, dot(vNormal, normalize(vec3(0.4, 1.0, 0.3)))) * 0.45;
    color *= (0.4 + diffuse);

    // 폭풍 틴트
    color = mix(color, color * vec3(1.6, 0.65, 0.55), uStormLevel * 0.4);

    // 지수 포그
    float dist      = length(vWorldPos - cameraPosition);
    float fogFactor = exp(-uFogDensity * dist);
    color = mix(uFogColor, color, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, 0.93);
  }
`;

// ─── 컴포넌트 ───────────────────────────────────────────
interface Props {
  solarWind: SolarWindState;
  timeRef: React.MutableRefObject<number>;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  octaves: number; amplitudeScale: number; freqScale: number;
  wireframe: boolean; opacity: number;
}

const GRID = 96, SIZE = 44;

export function WaveTerrain({
  solarWind, timeRef, playerPosRef,
  octaves, amplitudeScale, freqScale, wireframe, opacity,
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, GRID, GRID);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const uniforms = useRef({
    uDeepColor:    { value: new THREE.Color("#010a18") },
    uCrestColor:   { value: new THREE.Color("#0d2a4a") },
    uFresnelColor: { value: new THREE.Color("#3d88bb") },
    uStormLevel:   { value: 0 },
    uAmplitude:    { value: 0.5 },
    uTime:         { value: 0 },
    uFogColor:     { value: new THREE.Color("#01020a") },
    uFogDensity:   { value: 0.038 },
  });

  useFrame(() => {
    const t  = timeRef.current;
    const px = playerPosRef.current.x;
    const pz = playerPosRef.current.z;
    const sw = solarWind;

    if (meshRef.current) {
      meshRef.current.position.x = px;
      meshRef.current.position.z = pz;
    }

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, getWaveHeight(
        px + pos.getX(i), pz + pos.getZ(i),
        t, sw, octaves, amplitudeScale, freqScale
      ));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    const u = uniforms.current;
    u.uTime.value       = t;
    u.uStormLevel.value = sw.stormLevel;
    u.uAmplitude.value  = sw.waveAmplitude * amplitudeScale;

    const s = sw.stormLevel;
    u.uDeepColor.value.setRGB(
      0.004 + s * 0.04, 0.035 + (1-s) * 0.01, 0.07 + (1-s) * 0.04
    );
    u.uCrestColor.value.setRGB(
      0.025 + s * 0.1, 0.1 + (1-s) * 0.06, 0.22 + (1-s) * 0.12
    );
    u.uFresnelColor.value.setRGB(
      0.2 + s * 0.3, 0.45 + (1-s)*0.2, 0.7 + (1-s)*0.15
    );
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={uniforms.current}
        transparent opacity={opacity}
        wireframe={wireframe}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
