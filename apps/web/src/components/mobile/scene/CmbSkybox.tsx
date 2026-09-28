"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// seededRandom: 일관된 분포 (intersection 동일)
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const VS = /* glsl */`
  attribute vec3  aColor;
  attribute float aSize;
  attribute float aPhase;   // per-star twinkle phase
  uniform float   uTime;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 0.5); // w=0.5 trick (drei Stars)
    // 개별 twinkle: sin으로 ±30% 크기 진동, phase로 비동기화
    float twinkle = 1.0 + 0.3 * sin(uTime * 2.0 + aPhase);
    gl_PointSize = aSize * twinkle * (280.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    if (d > 0.5) discard;
    // Sigmoid fade (Solar System demo 기법 — 선명한 disc 엣지)
    float alpha = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
    gl_FragColor = vec4(vColor, alpha * uOpacity);
  }
`;

export interface CmbSkyboxProps {
  particleCount: number;
  opacity: number;
  radius: number;
  rotationSpeed: number;
  brightness: number;
  contrast: number;
  sizeMin: number;
  sizeMax: number;
  useCmbData: boolean;
  haloIntensity: number;  // 0=없음, 1=강함
  colorSaturation: number; // 색상 채도 (1=원본, 0=회색)
}

export function CmbSkybox(props: CmbSkyboxProps) {
  const {
    particleCount, opacity, radius, rotationSpeed,
    brightness, contrast, sizeMin, sizeMax,
    useCmbData, haloIntensity, colorSaturation,
  } = props;

  const pointsRef = useRef<THREE.Points>(null);
  const [cmbData, setCmbData] = useState<ImageData | null>(null);

  // ── CMB PNG 로드 (브라우저 canvas 샘플링) ─────────────
  useEffect(() => {
    if (!useCmbData) { setCmbData(null); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      setCmbData(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => setCmbData(null);
    img.src = "/textures/cmb_planck.png";
  }, [useCmbData]);

  // ── 파티클 데이터 ─────────────────────────────────────
  const { positions, colors, sizes, phases } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    const sz  = new Float32Array(particleCount);
    const ph  = new Float32Array(particleCount); // twinkle phases

    for (let i = 0; i < particleCount; i++) {
      const u1 = seededRandom(i * 17.3);
      const u2 = seededRandom(i * 31.7);

      // 균등 구면 분포
      const theta = u1 * Math.PI * 2;         // 방위각 0~2π
      const phi   = Math.acos(2 * u2 - 1);   // 극각 0~π
      const r     = radius + (seededRandom(i * 7.1) - 0.5) * 14;

      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i*3+2] = r * Math.cos(phi);

      // ── 색상: CMB 실데이터 or Gaussian 폴백 ──
      let cr: number, cg: number, cb: number, lum: number;

      if (useCmbData && cmbData) {
        // 방향 → UV → CMB 픽셀 샘플링
        const u = theta / (Math.PI * 2);
        const v = phi / Math.PI;
        const px = Math.floor(u * cmbData.width)  % cmbData.width;
        const py = Math.floor(v * cmbData.height) % cmbData.height;
        const idx = (py * cmbData.width + px) * 4;

        cr = cmbData.data[idx]   / 255;
        cg = cmbData.data[idx+1] / 255;
        cb = cmbData.data[idx+2] / 255;
        lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;

        // 채도 조절
        cr = lum + (cr - lum) * colorSaturation;
        cg = lum + (cg - lum) * colorSaturation;
        cb = lum + (cb - lum) * colorSaturation;
      } else {
        // Gaussian 폴백
        const g1 = Math.max(1e-6, seededRandom(i * 23.1));
        const g  = Math.sqrt(-2 * Math.log(g1)) * Math.cos(2 * Math.PI * seededRandom(i * 41.7));
        const temp = Math.max(0, Math.min(1, 0.5 + g * 0.18));
        if (temp < 0.5) {
          const t = temp / 0.5;
          cr = 0.25 + t * 0.35; cg = 0.4 + t * 0.3; cb = 0.9 - t * 0.2;
        } else {
          const t = (temp - 0.5) / 0.5;
          cr = 0.6 + t * 0.4; cg = 0.7 - t * 0.5; cb = 0.7 - t * 0.6;
        }
        lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        // 채도
        cr = lum + (cr - lum) * colorSaturation;
        cg = lum + (cg - lum) * colorSaturation;
        cb = lum + (cb - lum) * colorSaturation;
      }

      // 밝기 & contrast
      const bright = seededRandom(i * 53.7);
      const br = Math.pow(bright, 2.5); // 소수 밝은 별

      cr = Math.min(1, Math.pow(Math.max(0, cr * brightness * (0.3 + br * 0.7)), contrast));
      cg = Math.min(1, Math.pow(Math.max(0, cg * brightness * (0.3 + br * 0.7)), contrast));
      cb = Math.min(1, Math.pow(Math.max(0, cb * brightness * (0.3 + br * 0.7)), contrast));

      col[i*3]   = cr;
      col[i*3+1] = cg;
      col[i*3+2] = cb;

      sz[i] = sizeMin + (sizeMax - sizeMin) * br;
      // per-star twinkle phase (0~2π 랜덤)
      ph[i] = seededRandom(i * 61.3) * Math.PI * 2;
    }

    return { positions: pos, colors: col, sizes: sz, phases: ph };
  }, [particleCount, radius, cmbData, useCmbData, brightness, contrast,
      sizeMin, sizeMax, colorSaturation]);

  const uOpacity = useMemo(() => ({ value: opacity }), []);
  uOpacity.value = opacity;
  const uTime    = useMemo(() => ({ value: 0 }), []);

  useFrame(({ camera }, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.position.copy(camera.position);
    pointsRef.current.rotation.y += delta * rotationSpeed;
    pointsRef.current.rotation.x += delta * rotationSpeed * 0.25;
    uTime.value += delta;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aColor"   args={[colors,    3]} />
        <bufferAttribute attach="attributes-aSize"    args={[sizes,     1]} />
        <bufferAttribute attach="attributes-aPhase"   args={[phases,    1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={{ uOpacity, uTime }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
