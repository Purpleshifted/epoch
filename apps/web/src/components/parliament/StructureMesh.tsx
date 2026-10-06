"use client";
/**
 * StructureMesh: draws a parliament Snapshot as flat-coloured boxes (slabs) and small boxes
 * (filters). Used by the player view (lit, perspective) and the Top view (unlit, orthographic).
 *
 * Slab colour is a height code in the VGA palette: dark grey = only the buried footprint is left,
 * light grey = a slab, white = a tall one. The snapshot is polled a few times a second.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import type { Snapshot } from "@/lib/parliament";

const MAX_SLABS = 3000;
const MAX_FILTERS = 600;
const POLL_SEC = 0.25;

const FOOT = 0x555555;
const SLAB = 0xaaaaaa;
const TALL = 0xffffff;
const FILTER = 0xaa5500;

function slabColour(h: number): number {
  if (h < 0.15) return FOOT;
  return h < 2.5 ? SLAB : TALL;
}

export function StructureMesh({
  getSnapshot,
  heightUnit = 0.6,
  unlit = false,
}: {
  getSnapshot: () => Snapshot | null;
  /** World units of height per height unit. */
  heightUnit?: number;
  unlit?: boolean;
}) {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const filters = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const timer = useRef(POLL_SEC);

  useEffect(() => {
    for (const m of [slabs.current, filters.current]) {
      if (!m) continue;
      m.count = 0;
      m.setColorAt(0, col.set(0xffffff)); // allocates instanceColor
    }
  }, [col]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < POLL_SEC) return;
    timer.current = 0;
    const snap = getSnapshot();
    const sm = slabs.current;
    const fm = filters.current;
    if (!snap || !sm || !fm) return;

    let n = 0;
    for (const s of snap.slabs) {
      if (n >= MAX_SLABS) break;
      const hv = Math.max(0.05, s.h * heightUnit);
      tmp.position.set(s.x, hv / 2, s.z);
      tmp.scale.set(CELL_SIZE * 0.97, hv, CELL_SIZE * 0.97);
      tmp.updateMatrix();
      sm.setMatrixAt(n, tmp.matrix);
      sm.setColorAt(n, col.set(slabColour(s.h)));
      n++;
    }
    sm.count = n;
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;

    let k = 0;
    for (const f of snap.filters) {
      if (k >= MAX_FILTERS) break;
      const size = 0.12 + 0.2 * f.alpha;
      tmp.position.set(f.x, size / 2, f.z);
      tmp.scale.set(size, size, size);
      tmp.updateMatrix();
      fm.setMatrixAt(k, tmp.matrix);
      fm.setColorAt(k, col.set(FILTER));
      k++;
    }
    fm.count = k;
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={slabs} args={[undefined, undefined, MAX_SLABS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {unlit ? <meshBasicMaterial /> : <meshLambertMaterial emissive="#303030" />}
      </instancedMesh>
      <instancedMesh ref={filters} args={[undefined, undefined, MAX_FILTERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {unlit ? <meshBasicMaterial /> : <meshLambertMaterial emissive="#301800" />}
      </instancedMesh>
    </>
  );
}
