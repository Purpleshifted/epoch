"use client";
/**
 * PathLines: the trodden paths of the player's ground as LINES (the artist, v4: "길은 선으로") — flat grey strips
 * between neighbouring path cells, their shade the path's strength; a lone path cell is a small square. Human
 * traces stay achromatic. Laid out every half second around the player, the nearest image of every cell (the world
 * wraps, world.ts).
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { nearestImage, wrapCell, type Snapshot } from "@/lib/parliament";

const MAX_QUADS = 6000;
const MIN_P = 0.08;
const Y = 0.02;

export function PathLines({
  playerPosRef,
  getSnapshot,
  width = 0.3,
  radius = 24,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getSnapshot: () => Snapshot | null;
  /** World width of a strip (0 = none). */
  width?: number;
  radius?: number;
}) {
  const timer = useRef(10);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 6 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 6 * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    let v = 0;
    const snap = getSnapshot();
    const p = playerPosRef.current;
    const quad = (ax: number, az: number, bx: number, bz: number, half: number, shade: number) => {
      if (v + 6 > MAX_QUADS * 6) return;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * half;
      const nz = (dx / len) * half;
      const put = (x: number, z: number) => {
        P[v * 3] = x;
        P[v * 3 + 1] = Y;
        P[v * 3 + 2] = z;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
        v++;
      };
      put(ax + nx, az + nz);
      put(bx + nx, bz + nz);
      put(bx - nx, bz - nz);
      put(ax + nx, az + nz);
      put(bx - nx, bz - nz);
      put(ax - nx, az - nz);
    };
    if (snap && width > 0) {
      const at = new Map<string, number>();
      for (const q of snap.paths) at.set(q.key, q.p);
      const half = width / 2;
      for (const q of snap.paths) {
        if (q.p < MIN_P) continue;
        const ax = nearestImage(q.x, p.x);
        const az = nearestImage(q.z, p.z);
        if (Math.hypot(ax - p.x, az - p.z) > radius) continue;
        const [cx, cz] = q.key.split(",").map(Number);
        let joined = 0;
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const) {
          const pn = at.get(`${wrapCell(cx + dx)},${wrapCell(cz + dz)}`);
          if (pn == null || pn < MIN_P) continue;
          joined++;
          if (dx < 0 || dz < 0) continue; // each pair once
          const s = Math.min(q.p, pn);
          quad(ax, az, ax + dx * CELL_SIZE, az + dz * CELL_SIZE, half, 0.22 + 0.55 * s);
        }
        // a lone cell (a path just beginning): a small square
        if (joined === 0) quad(ax - half, az, ax + half, az, half, 0.22 + 0.55 * q.p);
      }
    }
    geom.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <mesh geometry={geom} frustumCulled={false}>
      <meshBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}
