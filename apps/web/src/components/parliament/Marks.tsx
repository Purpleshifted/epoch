"use client";
/**
 * Marks — what stands in the player's frame besides the grass (lib/parliament/marks.ts; the artist's direction,
 * 2026-10-28; Leva 개인뷰 비주얼 › 표식). Each thing has a shape of its own, tall enough to fill the view; greys only
 * (human traces). The lists are renewed with the fold (RoleField, 0.5 s); the heights that follow the eye are set
 * every frame from the camera.
 *   OtherDots      a square dot at eye height for every being within the view
 *   ConcreteLines  a vertical line from the ground up through the frame on every sealed slab cell
 *   PathCurves     the paths as smooth horizontal RIBBONS floating a little below eye height — flat strips with a
 *                  width, translucent, so they do not read as lines on the ground
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ribbonEdges, type Chain, type ConcreteLine, type OtherMark } from "@/lib/parliament";

export interface MarksData {
  others: OtherMark[];
  concrete: ConcreteLine[];
  chains: Chain[];
}

const MAX_OTHERS = 128;
const MAX_CONCRETE = 6000;
const MAX_RIBBON_VERTS = 60000;
const REFRESH = 0.5;

function lineGeom(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

/** A square dot at eye height for every other being (a flat point facing the screen, not a solid). */
export function OtherDots({ getMarks, size = 0.5, eyeOffset = 0, bright = 0.8 }: { getMarks: () => MarksData | null; size?: number; eyeOffset?: number; bright?: number }) {
  const group = useRef<THREE.Group>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_OTHERS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_OTHERS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((state, dt) => {
    // the dots float at the eye: the camera's height, offset by the knob
    if (group.current) group.current.position.y = state.camera.position.y + eyeOffset;
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const list = getMarks()?.others ?? [];
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, C = col.array as Float32Array;
    const n = Math.min(MAX_OTHERS, list.length);
    for (let i = 0; i < n; i++) {
      const o = list[i];
      P[i * 3] = o.x;
      P[i * 3 + 1] = 0;
      P[i * 3 + 2] = o.z;
      C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = bright * (0.35 + 0.65 * o.bright);
    }
    geom.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <points geometry={geom} frustumCulled={false}>
        {/* no texture: a plain square point, attenuated with distance */}
        <pointsMaterial size={size} sizeAttenuation vertexColors depthWrite={false} />
      </points>
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

/**
 * The paths as smooth horizontal RIBBONS a little below eye height: a flat strip of `width` along each chain
 * (marks.ts ribbonEdges), translucent grey by the path's strength — a body of its own, unlike the ground's lines.
 */
export function PathCurves({ getMarks, drop = 1.2, bright = 0.9, width = 0.35, opacity = 0.6 }: { getMarks: () => MarksData | null; drop?: number; bright?: number; width?: number; opacity?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_RIBBON_VERTS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_RIBBON_VERTS * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(MAX_RIBBON_VERTS * 3), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
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
    const idx = geom.getIndex()!;
    const P = pos.array as Float32Array, C = col.array as Float32Array, I = idx.array as Uint32Array;
    let v = 0, t = 0;
    outer: for (const ch of chains) {
      const { left, right } = ribbonEdges(ch.pts, width);
      const n = left.length;
      if (n < 2) continue;
      if (v + 2 * n > MAX_RIBBON_VERTS || t + 6 * (n - 1) > MAX_RIBBON_VERTS * 3) break outer;
      const shade = bright * (0.45 + 0.55 * Math.min(1, ch.p));
      const base = v;
      for (let i = 0; i < n; i++) {
        for (const q of [left[i], right[i]]) {
          P[v * 3] = q[0];
          P[v * 3 + 1] = 0;
          P[v * 3 + 2] = q[1];
          C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
          v++;
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + 2 * i;
        I[t++] = a;
        I[t++] = a + 1;
        I[t++] = a + 2;
        I[t++] = a + 1;
        I[t++] = a + 3;
        I[t++] = a + 2;
      }
    }
    geom.setDrawRange(0, t);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    idx.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <mesh geometry={geom} frustumCulled={false}>
        <meshBasicMaterial vertexColors transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
