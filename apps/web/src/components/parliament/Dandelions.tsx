"use client";
/**
 * Dandelions — what the answers left (lib/parliament/dandelion.ts), drawn alike in the player's frame and on the wall:
 * a thin stem, white spokes, and the seeds as points, some on the head, some in the air, some landed. Nothing here has a
 * surface: it stays out of the way of whatever stands around it, and the wall's masses hide it when they cover it.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SEEDS_PER_HEAD, dandelionShape, type Dandelion } from "@/lib/parliament";

const MAX_HEADS = 160;
const REFRESH = 0.1;

function geomOf(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

export function Dandelions({
  getHeads,
  ageOf,
  footOf,
  size = 1,
  dot = 0.1,
}: {
  getHeads: () => readonly Dandelion[];
  /** How old a head is now (s). */
  ageOf: (d: Dandelion) => number;
  /** Where its foot stands (world), for this view: the wall puts it at its time, the player at the nearest image. */
  footOf: (d: Dandelion) => [number, number, number];
  size?: number;
  /** World size of a seed. */
  dot?: number;
}) {
  const lineGeom = useMemo(() => geomOf(MAX_HEADS * (SEEDS_PER_HEAD + 1) * 2), []);
  const dotGeom = useMemo(() => geomOf(MAX_HEADS * SEEDS_PER_HEAD), []);
  const timer = useRef(10);
  useEffect(
    () => () => {
      lineGeom.dispose();
      dotGeom.dispose();
    },
    [lineGeom, dotGeom],
  );
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const heads = getHeads();
    const lines: number[] = [];
    const dots: number[] = [];
    // the newest first when there are too many
    for (let i = heads.length - 1; i >= Math.max(0, heads.length - MAX_HEADS); i--) {
      const d = heads[i];
      const [x, y, z] = footOf(d);
      dandelionShape(d.id, ageOf(d), x, y, z, size, lines, dots);
    }
    const lp = lineGeom.getAttribute("position") as THREE.BufferAttribute;
    const dp = dotGeom.getAttribute("position") as THREE.BufferAttribute;
    (lp.array as Float32Array).set(lines);
    (dp.array as Float32Array).set(dots);
    lineGeom.setDrawRange(0, lines.length / 3);
    dotGeom.setDrawRange(0, dots.length / 3);
    lp.needsUpdate = true;
    dp.needsUpdate = true;
  });
  return (
    <>
      <lineSegments geometry={lineGeom} frustumCulled={false}>
        <lineBasicMaterial color="#ffffff" fog={false} />
      </lineSegments>
      <points geometry={dotGeom} frustumCulled={false}>
        <pointsMaterial color="#ffffff" size={dot} sizeAttenuation fog={false} />
      </points>
    </>
  );
}
