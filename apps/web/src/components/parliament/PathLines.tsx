"use client";
/**
 * PathLines: the trodden paths of the player's ground as LINES — the thin white lines the global views draw (the
 * artist: "글로벌에서 보이는 그런 선, 흰색으로 쨍하게"): one-pixel segments between neighbouring path cells (and
 * across a diagonal where no orthogonal route joins them), white, their brightness the path's strength. Human
 * traces stay achromatic. Laid out every half second around the player, the nearest image of every cell (the world
 * wraps, world.ts).
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { nearestImage, wrapCell, type Snapshot } from "@/lib/parliament";

const MAX_SEGS = 8000;
const MIN_P = 0.08;
const Y = 0.025;

export function PathLines({
  playerPosRef,
  getSnapshot,
  brightness = 1,
  radius = 24,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getSnapshot: () => Snapshot | null;
  /** 0 = no lines; 1 = full white at full strength. */
  brightness?: number;
  radius?: number;
}) {
  const timer = useRef(10);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SEGS * 2 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_SEGS * 2 * 3), 3));
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
    const seg = (ax: number, az: number, bx: number, bz: number, shade: number) => {
      if (v + 2 > MAX_SEGS * 2) return;
      for (const [x, z] of [
        [ax, az],
        [bx, bz],
      ]) {
        P[v * 3] = x;
        P[v * 3 + 1] = Y;
        P[v * 3 + 2] = z;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
        v++;
      }
    };
    if (snap && brightness > 0) {
      const at = new Map<string, number>();
      for (const q of snap.paths) at.set(q.key, q.p);
      const has = (cx: number, cz: number) => (at.get(`${wrapCell(cx)},${wrapCell(cz)}`) ?? 0) >= MIN_P;
      const str = (cx: number, cz: number) => at.get(`${wrapCell(cx)},${wrapCell(cz)}`) ?? 0;
      for (const q of snap.paths) {
        if (q.p < MIN_P) continue;
        const ax = nearestImage(q.x, p.x);
        const az = nearestImage(q.z, p.z);
        if (Math.hypot(ax - p.x, az - p.z) > radius) continue;
        const [cx, cz] = q.key.split(",").map(Number);
        const shadeOf = (s: number) => brightness * (0.55 + 0.45 * Math.min(1, s));
        // the orthogonal neighbours to the right and below (each pair once)
        if (has(cx + 1, cz)) seg(ax, az, ax + CELL_SIZE, az, shadeOf(Math.min(q.p, str(cx + 1, cz))));
        if (has(cx, cz + 1)) seg(ax, az, ax, az + CELL_SIZE, shadeOf(Math.min(q.p, str(cx, cz + 1))));
        // a diagonal where no orthogonal route joins the two cells (so a slanted path is one line, not a stair)
        if (has(cx + 1, cz + 1) && !has(cx + 1, cz) && !has(cx, cz + 1)) seg(ax, az, ax + CELL_SIZE, az + CELL_SIZE, shadeOf(Math.min(q.p, str(cx + 1, cz + 1))));
        if (has(cx - 1, cz + 1) && !has(cx - 1, cz) && !has(cx, cz + 1)) seg(ax, az, ax - CELL_SIZE, az + CELL_SIZE, shadeOf(Math.min(q.p, str(cx - 1, cz + 1))));
      }
    }
    geom.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geom} frustumCulled={false}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
}
