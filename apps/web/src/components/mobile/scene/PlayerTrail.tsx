"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface TrailPoint {
  x: number;
  z: number;
  t: number; // timestamp
  y: number; // terrain height at that point
}

interface PlayerTrailProps {
  trail: TrailPoint[];
  color: string;
}

const MAX_AGE_MS = 12000;

export function PlayerTrail({ trail, color }: PlayerTrailProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, opacities } = useMemo(() => {
    const now = Date.now();
    const pos: number[] = [];
    const ops: number[] = [];

    trail.forEach((p) => {
      const age = now - p.t;
      if (age > MAX_AGE_MS) return;
      const life = 1 - age / MAX_AGE_MS;
      pos.push(p.x, p.y + 0.05, p.z);
      ops.push(life);
    });

    return {
      positions: new Float32Array(pos),
      opacities: new Float32Array(ops),
    };
  }, [trail]);

  if (positions.length === 0) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.12}
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// 플레이어 자신을 나타내는 파티클 구
export function PlayerOrb({
  position,
  color,
  depth,
}: {
  position: [number, number, number];
  color: string;
  depth: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  const particlePositions = useMemo(() => {
    const count = 220;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // 가장자리에 점 몰림
      const r = 0.25 + Math.pow(Math.random(), 0.3) * 0.12;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    return pos;
  }, []);

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (groupRef.current) {
      const pulse = 1 + 0.06 * Math.sin(timeRef.current * 3.5);
      groupRef.current.scale.setScalar(pulse * (1 + depth * 0.25));
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* 내부 코어 글로우 */}
      <mesh>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.2}
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* 외곽 광채 */}
      <mesh>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.3}
          transparent
          opacity={0.15}
        />
      </mesh>
      {/* 파티클 껍질 */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={0.035}
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}

