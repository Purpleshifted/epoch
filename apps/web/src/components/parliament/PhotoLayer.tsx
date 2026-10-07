"use client";
/**
 * PhotoLayer: the architecture collage built from cut-out pictures of concrete architecture
 * (see lib/parliament/collage.ts). One mesh per picture file; rebuilt only when the slabs change.
 *   side: pictures stand in front of each other, depth-sorted by their own z
 *   top : plan pictures lie flat, stacked by height
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SIDE_FRAGMENTS, TOP_FRAGMENTS, buildCollage, type CollageConfig, type Snapshot } from "@/lib/parliament";

export function PhotoLayer({
  getSnapshot,
  heightUnit,
  cfg,
  view,
  every = 0.5,
}: {
  getSnapshot: () => Snapshot | null;
  heightUnit: number;
  cfg: CollageConfig;
  view: "side" | "top";
  every?: number;
}) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const timer = useRef(10);
  const sig = useRef("");
  const frags = view === "side" ? SIDE_FRAGMENTS : TOP_FRAGMENTS;
  const aspects = useMemo(() => frags.map((f) => f.w / f.h), [frags]);
  // Textures only (plain data objects). Meshes and materials are declared in JSX so that R3F creates them with its own three copy.
  const texs = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return frags.map((f) => {
      const t = loader.load(`/fragments/${f.id}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  }, [frags]);

  useEffect(() => {
    sig.current = "";
  }, [heightUnit, cfg, view]);
  useEffect(
    () => () => {
      for (const t of texs) t.dispose();
    },
    [texs],
  );

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < every) return;
    timer.current = 0;
    const snap = getSnapshot();
    const slabs = snap?.slabs ?? [];
    let h = 0;
    for (const s of slabs) h += s.h * 100 + s.raw;
    const next = `${slabs.length}:${Math.round(h)}`;
    if (next === sig.current) return;
    sig.current = next;

    const placements = buildCollage(slabs, heightUnit, view, aspects, cfg);
    const per: number[][] = frags.map(() => []);
    placements.forEach((p, i) => per[p.frag].push(i));

    per.forEach((list, fi) => {
      const mesh = meshes.current[fi];
      if (!mesh) return;
      mesh.visible = list.length > 0;
      const pos = new Float32Array(list.length * 12);
      const uv = new Float32Array(list.length * 8);
      const idx: number[] = [];
      list.forEach((pi, j) => {
        const p = placements[pi];
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const hw = p.w / 2;
        const hh = p.h / 2;
        const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        corners.forEach(([lx, ly], k) => {
          const u = lx * c - ly * s;
          const v = lx * s + ly * c;
          const o = j * 12 + k * 3;
          if (view === "side") {
            pos[o] = p.x + u;
            pos[o + 1] = Math.max(0, p.y + v - 0); // pictures may rest on, never sink below, the ground line
            pos[o + 2] = p.z;
          } else {
            pos[o] = p.x + u;
            pos[o + 1] = p.y;
            pos[o + 2] = p.z - v; // screen up is −z in the top camera
          }
          const uu = k === 0 || k === 3 ? 0 : 1;
          uv[j * 8 + k * 2] = p.flip ? 1 - uu : uu;
          uv[j * 8 + k * 2 + 1] = k < 2 ? 0 : 1;
        });
        const b = j * 4;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    });
  });

  return (
    <group>
      {frags.map((f, i) => (
        <mesh key={`${view}-${f.id}`} ref={(el) => { meshes.current[i] = el; }} frustumCulled={false} visible={false}>
          <bufferGeometry />
          <meshBasicMaterial map={texs[i]} transparent alphaTest={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
