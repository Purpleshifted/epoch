"use client";
/**
 * FilterMesh: the worker's cigarette filters (labour fossils) as small instanced boxes.
 * Slabs and paths live in Architecture.tsx (Top/Side only); in the player view paths are dust
 * points inside NatureCloud.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Snapshot } from "@/lib/parliament";

const MAX_FILTERS = 800;
const FILTER = 0xaa5500; // palette 6
const FILTER_SIZE = 0.24;

export function FilterMesh({
  getSnapshot,
  unlit = false,
  every = 0.25,
}: {
  getSnapshot: () => Snapshot | null;
  unlit?: boolean;
  /** Seconds between redraws. */
  every?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const timer = useRef(10);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FILTERS * 3), 3);
    m.count = 0;
  }, []);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < every) return;
    timer.current = 0;
    const m = ref.current;
    if (!m) return;
    const snap = getSnapshot();
    if (!snap) {
      m.count = 0;
      return;
    }
    let f = 0;
    for (const t of snap.filters) {
      if (f >= MAX_FILTERS) break;
      const sz = FILTER_SIZE * (0.4 + 0.6 * t.alpha);
      tmp.position.set(t.x, sz / 2, t.z);
      tmp.scale.set(sz, sz, sz);
      tmp.updateMatrix();
      m.setMatrixAt(f, tmp.matrix);
      m.setColorAt(f, col.setHex(FILTER));
      f++;
    }
    m.count = f;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_FILTERS]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      {unlit ? <meshBasicMaterial /> : <meshLambertMaterial emissive="#303030" />}
    </instancedMesh>
  );
}
