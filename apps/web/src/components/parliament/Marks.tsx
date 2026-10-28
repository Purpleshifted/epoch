"use client";
/**
 * Marks — what stands in the player's frame besides the grass (lib/parliament/marks.ts; the artist's direction,
 * 2026-10-28; Leva 개인뷰 비주얼 › 표식). Each thing has a shape of its own, tall enough to fill the view; greys only
 * (human traces). The lists are renewed with the fold (RoleField, 0.5 s); the heights that follow the eye are set
 * every frame from the camera.
 *   OtherDots      a glowing point (core + halo, additive) at eye height for every being within the view
 *   ConcreteLines  a vertical line from the ground up through the frame on every sealed slab cell
 * (the paths as floating curves / ribbons were dropped by the artist on 2026-10-28; they stay on the ground)
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ConcreteLine, OtherMark } from "@/lib/parliament";

export interface MarksData {
  others: OtherMark[];
  concrete: ConcreteLine[];
}

const MAX_OTHERS = 128;
const MAX_CONCRETE = 6000;
const REFRESH = 0.5;

function lineGeom(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

/** A soft radial sprite: bright centre, falling off to nothing at the edge (for the glow). */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A GLOWING point at eye height for every other being: two additive soft sprites — a core and a wide faint halo —
 * so the light bleeds without a bloom pass. The scene's fog takes them with distance (knob: or not, so the far
 * ones stay as a faint light in the haze); an optional pulse breathes the size.
 */
export function OtherDots({
  getMarks,
  size = 0.5,
  eyeOffset = 0,
  bright = 0.8,
  halo = 4,
  haloStrength = 0.35,
  fog = true,
  pulseHz = 0,
}: {
  getMarks: () => MarksData | null;
  size?: number;
  eyeOffset?: number;
  bright?: number;
  /** Halo size as a multiple of the core; 0 = core only. */
  halo?: number;
  /** Halo brightness relative to the core. */
  haloStrength?: number;
  /** Whether the scene's fog dims them with distance. */
  fog?: boolean;
  /** Breathing of the size (Hz); 0 = still. */
  pulseHz?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.PointsMaterial>(null);
  const haloMat = useRef<THREE.PointsMaterial>(null);
  const tex = useMemo(() => glowTexture(), []);
  const geom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const haloGeom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const timer = useRef(10);
  useEffect(
    () => () => {
      geom.dispose();
      haloGeom.dispose();
      tex.dispose();
    },
    [geom, haloGeom, tex],
  );
  useFrame((state, dt) => {
    // the lights float at the eye: the camera's height, offset by the knob
    if (group.current) group.current.position.y = state.camera.position.y + eyeOffset;
    // the breath
    const k = pulseHz > 0 ? 1 + 0.25 * Math.sin(state.clock.elapsedTime * pulseHz * Math.PI * 2) : 1;
    if (coreMat.current) coreMat.current.size = size * k;
    if (haloMat.current) haloMat.current.size = size * halo * k;
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const list = getMarks()?.others ?? [];
    const n = Math.min(MAX_OTHERS, list.length);
    for (const [g, gain] of [
      [geom, 1],
      [haloGeom, haloStrength],
    ] as [THREE.BufferGeometry, number][]) {
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const col = g.getAttribute("color") as THREE.BufferAttribute;
      const P = pos.array as Float32Array, C = col.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const o = list[i];
        P[i * 3] = o.x;
        P[i * 3 + 1] = 0;
        P[i * 3 + 2] = o.z;
        C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = gain * bright * (0.35 + 0.65 * o.bright);
      }
      g.setDrawRange(0, n);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  });
  return (
    <group ref={group}>
      <points geometry={geom} frustumCulled={false}>
        <pointsMaterial ref={coreMat} size={size} sizeAttenuation vertexColors map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={fog} />
      </points>
      {halo > 0 && (
        <points geometry={haloGeom} frustumCulled={false}>
          <pointsMaterial ref={haloMat} size={size * halo} sizeAttenuation vertexColors map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={fog} />
        </points>
      )}
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
