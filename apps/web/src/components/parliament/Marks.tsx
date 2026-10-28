"use client";
/**
 * Marks — what stands in the player's frame besides the grass (lib/parliament/marks.ts; the artist's direction,
 * 2026-10-28; Leva 개인뷰 비주얼 › 표식). Each thing has a shape of its own, tall enough to fill the view; greys only
 * (human traces). The lists are renewed with the fold (RoleField, 0.5 s); the heights that follow the eye are set
 * every frame from the camera.
 *   OtherBoxes     a shaded box at eye height for every being within the view
 *   ConcreteLines  a vertical line from the ground up through the frame on every sealed slab cell
 *   PathCurves     the paths as smooth horizontal curves floating a little below eye height
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Chain, ConcreteLine, OtherMark } from "@/lib/parliament";

export interface MarksData {
  others: OtherMark[];
  concrete: ConcreteLine[];
  chains: Chain[];
}

const MAX_OTHERS = 128;
const MAX_CONCRETE = 6000;
const MAX_CURVE_VERTS = 60000;
const REFRESH = 0.5;

function lineGeom(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

/** A box at eye height for every other being (lit, so its faces read as volume). */
export function OtherBoxes({ getMarks, size = 0.6, eyeOffset = 0, bright = 0.8 }: { getMarks: () => MarksData | null; size?: number; eyeOffset?: number; bright?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }), []);
  const timer = useRef(10);
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
    // the boxes float at the eye: the camera's height, offset by the knob
    if (group.current) group.current.position.y = state.camera.position.y + eyeOffset;
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const list = getMarks()?.others ?? [];
    const n = Math.min(MAX_OTHERS, list.length);
    for (let i = 0; i < n; i++) {
      const o = list[i];
      m4.makeScale(size, size * 1.4, size);
      m4.setPosition(o.x, 0, o.z);
      im.setMatrixAt(i, m4);
      col.setScalar(bright * (0.35 + 0.65 * o.bright));
      im.setColorAt(i, col);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geom, mat, MAX_OTHERS]} count={0} frustumCulled={false} />
    </group>
  );
}

/** A vertical line from the ground up through the frame on every sealed slab cell. */
export function ConcreteLines({ getMarks, height = 40, bright = 0.6 }: { getMarks: () => MarksData | null; height?: number; bright?: number }) {
  const geom = useMemo(() => lineGeom(MAX_CONCRETE * 2), []);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const list = getMarks()?.concrete ?? [];
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, C = col.array as Float32Array;
    let v = 0;
    for (const c of list) {
      if (v + 2 > MAX_CONCRETE * 2) break;
      const shade = bright * (0.45 + 0.55 * Math.min(1, c.h / 3));
      for (const y of [0.02, height]) {
        P[v * 3] = c.x;
        P[v * 3 + 1] = y;
        P[v * 3 + 2] = c.z;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
        v++;
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

/** The paths as smooth horizontal curves, a little below eye height. */
export function PathCurves({ getMarks, drop = 1.2, bright = 0.9 }: { getMarks: () => MarksData | null; drop?: number; bright?: number }) {
  const geom = useMemo(() => lineGeom(MAX_CURVE_VERTS), []);
  const group = useRef<THREE.Group>(null);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((state, dt) => {
    if (group.current) group.current.position.y = state.camera.position.y - drop;
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const chains = getMarks()?.chains ?? [];
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, C = col.array as Float32Array;
    let v = 0;
    outer: for (const ch of chains) {
      const shade = bright * (0.4 + 0.6 * Math.min(1, ch.p));
      for (let i = 1; i < ch.pts.length; i++) {
        if (v + 2 > MAX_CURVE_VERTS) break outer;
        for (const q of [ch.pts[i - 1], ch.pts[i]]) {
          P[v * 3] = q[0];
          P[v * 3 + 1] = 0;
          P[v * 3 + 2] = q[1];
          C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
          v++;
        }
      }
    }
    geom.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <lineSegments geometry={geom} frustumCulled={false}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
    </group>
  );
}
