"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface RippleData {
  id: number;
  x: number;
  z: number;
  startTime: number;
}

// 개별 Ripple 링
function RippleRing({ ripple }: { ripple: RippleData }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const mesh2Ref = useRef<THREE.Mesh>(null);
  const DURATION = 2.5; // 초

  useFrame(() => {
    const age = (Date.now() - ripple.startTime) / 1000;
    if (age > DURATION) return;
    const t = age / DURATION;
    // 외곽 링
    if (meshRef.current) {
      const scale = 0.3 + t * 6;
      meshRef.current.scale.setScalar(scale);
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - t) * 0.55;
    }
    // 내부 보조 링 (약간 딜레이)
    if (mesh2Ref.current) {
      const t2 = Math.max(0, t - 0.1);
      const scale2 = 0.3 + t2 * 4;
      mesh2Ref.current.scale.setScalar(scale2);
      (mesh2Ref.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - t2) * 0.3;
    }
  });

  return (
    <group position={[ripple.x, 0.05, ripple.z]}>
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.0, 48]} />
        <meshBasicMaterial
          color="#7ec8f0"
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={mesh2Ref} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 0.95, 48]} />
        <meshBasicMaterial
          color="#aaddff"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function RippleSystem({ ripples }: { ripples: RippleData[] }) {
  // 오래된 ripple은 이미 부모에서 정리됨
  return (
    <>
      {ripples.map((r) => (
        <RippleRing key={r.id} ripple={r} />
      ))}
    </>
  );
}

export type { RippleData };
