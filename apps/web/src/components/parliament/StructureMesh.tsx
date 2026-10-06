"use client";
/**
 * StructureMesh: draws a parliament Snapshot as instanced flat-coloured boxes.
 * One box per ground cell (slab, height = worn height, a low plate where only the footprint is
 * left) and small boxes for cigarette filters. Colours are palette greys/brown (no lighting
 * model needed in `unlit` mode, used by the top view where height would not show anyway).
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import type { Snapshot } from "@/lib/parliament";

const MAX_SLABS = 2500;
const MAX_FILTERS = 800;
const OUTLINE = 0x555555; // palette 8: only the buried footprint is left
const LOW = 0xaaaaaa; // palette 7
const HIGH = 0xffffff; // palette 15
const FILTER = 0xaa5500; // palette 6
const FILTER_SIZE = 0.24;

export function slabColor(h: number): number {
  if (h < 0.15) return OUTLINE;
  if (h < 2.5) return LOW;
  return HIGH;
}

export function StructureMesh({
  getSnapshot,
  heightUnit = 0.5,
  unlit = false,
  every = 0.25,
}: {
  getSnapshot: () => Snapshot | null;
  /** World units per height unit. */
  heightUnit?: number;
  unlit?: boolean;
  /** Seconds between redraws. */
  every?: number;
}) {
  const slabRef = useRef<THREE.InstancedMesh>(null);
  const filterRef = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const timer = useRef(10);

  useEffect(() => {
    for (const [m, max] of [[slabRef.current, MAX_SLABS], [filterRef.current, MAX_FILTERS]] as const) {
      if (!m) continue;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.count = 0;
    }
  }, []);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < every) return;
    timer.current = 0;
    const snap = getSnapshot();
    const sm = slabRef.current;
    const fm = filterRef.current;
    if (!sm || !fm) return;
    if (!snap) {
      sm.count = 0;
      fm.count = 0;
      return;
    }

    let n = 0;
    for (const s of snap.slabs) {
      if (n >= MAX_SLABS) break;
      const hv = Math.max(0.05, s.h * heightUnit);
      tmp.position.set(s.x, hv / 2, s.z);
      tmp.scale.set(CELL_SIZE * 0.96, hv, CELL_SIZE * 0.96);
      tmp.updateMatrix();
      sm.setMatrixAt(n, tmp.matrix);
      sm.setColorAt(n, col.setHex(slabColor(s.h)));
      n++;
    }
    sm.count = n;
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;

    let f = 0;
    for (const t of snap.filters) {
      if (f >= MAX_FILTERS) break;
      const sz = FILTER_SIZE * (0.4 + 0.6 * t.alpha);
      tmp.position.set(t.x, sz / 2, t.z);
      tmp.scale.set(sz, sz, sz);
      tmp.updateMatrix();
      fm.setMatrixAt(f, tmp.matrix);
      fm.setColorAt(f, col.setHex(FILTER));
      f++;
    }
    fm.count = f;
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  });

  const material = unlit ? <meshBasicMaterial /> : <meshLambertMaterial emissive="#303030" />;
  return (
    <>
      <instancedMesh ref={slabRef} args={[undefined, undefined, MAX_SLABS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {material}
      </instancedMesh>
      <instancedMesh ref={filterRef} args={[undefined, undefined, MAX_FILTERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {material}
      </instancedMesh>
    </>
  );
}
