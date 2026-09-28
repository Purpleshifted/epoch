"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SolarWindState } from "@/lib/world/useSolarWind";

// ─── 주변 파티클 필드 (월드 좌표 기반) ─────────────────
// 플레이어 기준이 아닌 월드 좌표 → 플레이어가 이동하면 시야가 달라짐
// 반경 벗어나면 플레이어 근처에 respawn → 무한 필드 효과

const FIELD_P = 5000;
const FIELD_R = 22; // 월드 단위 반경

const VS = /* glsl */`
  attribute float aFade; // 0=엣지(투명), 1=중심(불투명)
  varying float vFade;
  void main() {
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 아주 작은 점 — 1~2px 수준
    gl_PointSize = max(1.0, 0.25 * (30.0 / -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, vFade * uOpacity);
  }
`;

export function AmbientField({
  solarWind,
  playerPosRef,
  color,
  opacity = 0.4,
}: {
  solarWind: SolarWindState;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  color: string;
  opacity?: number;
}) {
  const geoRef = useRef<THREE.BufferGeometry>(null);

  // ── 월드 좌표 파티클 ──────────────────────────────────
  const wx   = useRef(new Float32Array(FIELD_P)); // 월드 X
  const wz   = useRef(new Float32Array(FIELD_P)); // 월드 Z
  const phY  = useRef(new Float32Array(FIELD_P)); // 수직 위상
  const drX  = useRef(new Float32Array(FIELD_P)); // per-particle drift X (개성)
  const drZ  = useRef(new Float32Array(FIELD_P)); // per-particle drift Z

  // ── 버퍼 ─────────────────────────────────────────────
  const posBuf  = useRef(new Float32Array(FIELD_P * 3));
  const fadeBuf = useRef(new Float32Array(FIELD_P));

  // 초기화: 플레이어 0,0 근처에 랜덤 배치
  const initialized = useRef(false);

  const uColor   = useMemo(() => ({ value: new THREE.Color(color) }), [color]);
  const uOpacity = useMemo(() => ({ value: opacity }), [opacity]);

  useFrame((_, delta) => {
    const dt  = Math.min(delta, 0.05);
    const px  = playerPosRef.current.x;
    const pz  = playerPosRef.current.z;
    const sw  = solarWind;
    const t   = performance.now() * 0.001;

    // 최초 초기화
    if (!initialized.current) {
      initialized.current = true;
      for (let i = 0; i < FIELD_P; i++) {
        const r = Math.sqrt(Math.random()) * FIELD_R;
        const a = Math.random() * Math.PI * 2;
        wx.current[i] = px + Math.cos(a) * r;
        wz.current[i] = pz + Math.sin(a) * r;
        phY.current[i]  = Math.random() * Math.PI * 2;
        drX.current[i]  = (Math.random() - 0.5) * 0.15; // 개별 미세 drift
        drZ.current[i]  = (Math.random() - 0.5) * 0.15;
      }
    }

    // 솔라윈드 전체 drift 방향 (느린 흐름)
    const windSpeed  = sw.waveSpeed * 0.3;
    const windDirX   = Math.sin(t * 0.04) * windSpeed;
    const windDirZ   = Math.cos(t * 0.04 + 0.8) * windSpeed;

    uOpacity.value = opacity;

    for (let i = 0; i < FIELD_P; i++) {
      // drift 적용
      wx.current[i] += (windDirX + drX.current[i] * 0.05) * dt;
      wz.current[i] += (windDirZ + drZ.current[i] * 0.05) * dt;

      // 플레이어 거리 계산
      const dx   = wx.current[i] - px;
      const dz   = wz.current[i] - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // 반경 벗어나면 반대쪽에 respawn (무한 필드)
      if (dist > FIELD_R) {
        const r = (0.3 + Math.random() * 0.55) * FIELD_R;
        const a = Math.atan2(-dz, -dx) + (Math.random() - 0.5) * 1.5;
        wx.current[i] = px + Math.cos(a) * r;
        wz.current[i] = pz + Math.sin(a) * r;
      }

      // 수직 부유 (솔라윈드 진폭 기반)
      const y = Math.sin(t * 0.3 + phY.current[i]) * sw.waveAmplitude * 0.3;

      posBuf.current[i*3]   = wx.current[i];
      posBuf.current[i*3+1] = y;
      posBuf.current[i*3+2] = wz.current[i];

      // 가장자리 페이드 (중심=1, 엣지=0)
      fadeBuf.current[i] = 1.0 - Math.min(dist / FIELD_R, 1.0);
    }

    if (geoRef.current) {
      (geoRef.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geoRef.current.attributes.aFade    as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <points>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[posBuf.current,  3]} />
        <bufferAttribute attach="attributes-aFade"    args={[fadeBuf.current, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={{ uColor, uOpacity }}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}
