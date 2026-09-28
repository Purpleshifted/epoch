"use client";
/**
 * TraceSystem — CPU 버전 (안정)
 *
 * GPGPU 버전은 Three.js 0.186.1의 FullScreenQuad.frustumCulled 버그로 임시 보류.
 * 통합 StarFieldSystem 설계 완료 후 대체 예정.
 *
 * 역할: 이동 궤적 파티클 + 화석 인력 (CPU 계산)
 * MAX_P: 8000, LIFETIME: 90s, 인력 age gate: 5s
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FossilRecord } from "./FossilSystem";

// ── 상수 ────────────────────────────────────────────────────────────
const MAX_P = 8000;
const LIFETIME = 90;   // seconds

// ── vertex shader ─────────────────────────────────────────────────
const VS = /* glsl */`
  attribute float aAge;   // 0=fresh, 1=dead
  attribute float aLife;  // total lifetime (seconds)

  uniform float uPointSize;
  varying float vAlpha;

  void main() {
    float normAge = aAge;
    float fade    = pow(max(0.0, 1.0 - normAge), 2.8);
    vAlpha = fade;

    float endFade = 1.0 - smoothstep(0.82, 1.0, normAge);
    gl_PointSize = uPointSize * endFade;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// ── fragment shader ───────────────────────────────────────────────
const FS = /* glsl */`
  uniform vec3  uColor;
  uniform float uAlpha;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float disc = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
    gl_FragColor = vec4(uColor, disc * vAlpha * uAlpha);
  }
`;

// ── 파티클 풀 ─────────────────────────────────────────────────────
interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;       // normalized 0→1
  totalLife: number; // 초
  active: boolean;
}

// ── 컴포넌트 ─────────────────────────────────────────────────────
export function TraceSystem({
  playerPosRef, playerYRef, color,
  spawnRate, lifetime, spread, pointSize, opacity,
  fossilsRef, attractG, attractRadius,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYRef: React.MutableRefObject<number>;
  color: string;
  spawnRate?: number;
  lifetime?: number;  // 배율
  spread?: number;
  pointSize?: number;
  opacity?: number;
  fossilsRef?: React.MutableRefObject<FossilRecord[]>;
  attractG?: number;
  attractRadius?: number;
}) {
  const SR = spawnRate ?? 20;
  const LT = (lifetime ?? 1.0) * LIFETIME;
  const SP = spread ?? 0.5;
  const PSZ = pointSize ?? 1.0;
  const OP = opacity ?? 0.18;
  const G = attractG ?? 0.6;
  const AR = attractRadius ?? 2.5;
  const AR2 = AR * AR;
  const AGE_GATE = 5.0 / LT; // normalized age gate (5초 후 인력 시작)

  // 파티클 풀
  const particles = useRef<Particle[]>(
    Array.from({ length: MAX_P }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      age: 1, totalLife: LT, active: false,
    }))
  );
  const nextSlot = useRef(0);
  const timeSinceSpawn = useRef(0);
  const prevPos = useRef({ x: 0, z: 0 });

  // Three.js buffers
  const posArr = useMemo(() => new Float32Array(MAX_P * 3), []);
  const ageArr = useMemo(() => new Float32Array(MAX_P), []);
  const lifeArr = useMemo(() => new Float32Array(MAX_P), []);

  const geoRef = useRef<THREE.BufferGeometry>(null);
  const colorUni = useMemo(() => ({ value: new THREE.Color(color) }), []);
  const alphaUni = useMemo(() => ({ value: OP }), []);
  const sizeUni = useMemo(() => ({ value: PSZ }), []);
  colorUni.value.set(color);
  alphaUni.value = OP;
  sizeUni.value = PSZ;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const px = playerPosRef.current.x;
    const py = playerYRef.current;
    const pz = playerPosRef.current.z;

    // 이동 감지
    const ddx = px - prevPos.current.x;
    const ddz = pz - prevPos.current.z;
    const spd = Math.sqrt(ddx * ddx + ddz * ddz) / dt;
    prevPos.current = { x: px, z: pz };

    const fs = fossilsRef?.current ?? [];
    const pool = particles.current;

    // Spawn
    if (spd > 0.08) {
      timeSinceSpawn.current += dt;
      const interval = 1.0 / SR;
      while (timeSinceSpawn.current >= interval) {
        timeSinceSpawn.current -= interval;
        const p = pool[nextSlot.current];
        const r = Math.random() * SP * 0.35;
        const a = Math.random() * Math.PI * 2;
        const lf = (0.8 + Math.random() * 0.4) * LT;
        const da = Math.random() * Math.PI * 2;
        const dv = Math.random() * SP * 0.12;
        p.x = px + Math.cos(a) * r;
        p.y = py + (Math.random() - 0.5) * 0.1;
        p.z = pz + Math.sin(a) * r;
        p.vx = Math.cos(da) * dv;
        p.vy = (Math.random() - 0.5) * 0.02;
        p.vz = Math.sin(da) * dv;
        p.age = 0;
        p.totalLife = lf;
        p.active = true;
        nextSlot.current = (nextSlot.current + 1) % MAX_P;
      }
    } else {
      timeSinceSpawn.current = 0;
    }

    // Update + 화석 인력
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (!p.active) {
        ageArr[i] = 1;
        continue;
      }
      p.age += dt / p.totalLife;
      if (p.age >= 1) { p.active = false; ageArr[i] = 1; continue; }

      // 화석 인력 (age gate: 5초 후)
      if (p.age > AGE_GATE && fs.length > 0) {
        for (const f of fs) {
          const dx = f.x - p.x, dy = f.y - p.y, dz = f.z - p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > AR2) continue;
          const dist = Math.sqrt(d2);
          if (dist < 0.07) { p.active = false; break; }
          const str = G / Math.max(dist, 0.4);
          const nx = dx / dist, nz = dz / dist;
          p.vx += nx * str * dt;
          p.vy += dy / dist * str * dt;
          p.vz += nz * str * dt;
          // CCW 소용돌이
          p.vx += (-nz) * str * 0.45 * dt;
          p.vz += (nx) * str * 0.45 * dt;
        }
        if (!p.active) { ageArr[i] = 1; continue; }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      posArr[i * 3] = p.x;
      posArr[i * 3 + 1] = p.y;
      posArr[i * 3 + 2] = p.z;
      ageArr[i] = p.age;
      lifeArr[i] = p.totalLife;
    }

    if (geoRef.current) {
      const geo = geoRef.current;
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aAge") as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" array={posArr} itemSize={3} count={MAX_P} />
        <bufferAttribute attach="attributes-aAge" array={ageArr} itemSize={1} count={MAX_P} />
        <bufferAttribute attach="attributes-aLife" array={lifeArr} itemSize={1} count={MAX_P} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={{ uColor: colorUni, uAlpha: alphaUni, uPointSize: sizeUni }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
