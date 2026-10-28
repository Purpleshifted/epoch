"use client";
/**
 * Stakes — thin markers stuck in the ground around the walker (lib/parliament/stakes.ts): the others, the path
 * junctions, the buildings' centres. One instanced mesh of thin boxes, greys only (a human trace); refreshed from
 * `getStakes` every half second with the fold, the moving others blinking per frame. Leva 개인뷰 비주얼 › 막대.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Stake } from "@/lib/parliament";

const MAX = 128;

export function Stakes({ getStakes, width = 0.04, blinkHz = 2 }: { getStakes: () => Stake[] | null; width?: number; blinkHz?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);
  const timer = useRef(10);
  const list = useRef<Stake[]>([]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat],
  );

  useFrame((state, dt) => {
    const im = mesh.current;
    if (!im) return;
    timer.current += dt;
    if (timer.current >= 0.5) {
      timer.current = 0;
      list.current = getStakes() ?? [];
      const n = Math.min(MAX, list.current.length);
      for (let i = 0; i < n; i++) {
        const s = list.current[i];
        m4.makeScale(width, s.h, width);
        m4.setPosition(s.x, s.h / 2, s.z);
        im.setMatrixAt(i, m4);
        col.setScalar(s.bright);
        im.setColorAt(i, col);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    // the moving others blink
    const on = Math.floor(state.clock.elapsedTime * blinkHz * 2) % 2 === 0;
    let changed = false;
    const n = Math.min(MAX, list.current.length);
    for (let i = 0; i < n; i++) {
      const s = list.current[i];
      if (!s.moving) continue;
      col.setScalar(on ? s.bright : s.bright * 0.25);
      im.setColorAt(i, col);
      changed = true;
    }
    if (changed && im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geom, mat, MAX]} count={0} frustumCulled={false} />;
}
