"use client";
/**
 * ShardLayer: draws the Side view's collage of planar fragments (see lib/parliament/shards.ts).
 * All fragments are merged into one mesh with a procedural board-formed-concrete texture
 * (planar world-space UVs, so the texture runs on across neighbouring fragments), flat-lit.
 */

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildPlanShards, buildShards, type ShardConfig, type ShardKind, type Snapshot } from "@/lib/parliament";

const TEX_WORLD = 3; // world units per texture repeat

/** Board-formed concrete: speckle, board joints, tie holes, rain streaks. Deterministic. */
function concreteTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let seed = 1234567;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = "#a3a7ab";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const dark = rnd() < 0.5;
    g.fillStyle = dark ? `rgba(40,45,50,${0.05 + rnd() * 0.12})` : `rgba(255,255,255,${0.05 + rnd() * 0.12})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 38; i++) {
    const x = rnd() * S;
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, "rgba(30,40,55,0)");
    grad.addColorStop(0.5, `rgba(30,40,55,${0.04 + rnd() * 0.07})`);
    grad.addColorStop(1, "rgba(30,40,55,0)");
    g.fillStyle = grad;
    g.fillRect(x, 0, 1 + rnd() * 3, S);
  }
  for (let y = 0; y < S; y += 64) {
    g.fillStyle = "rgba(35,40,46,0.55)";
    g.fillRect(0, y, S, 2);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(0, y + 2, S, 1);
  }
  g.fillStyle = "rgba(30,34,40,0.6)";
  for (const x of [32, 160]) for (const y of [32, 96, 160, 224]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function ShardLayer({
  getSnapshot,
  heightUnit,
  cfg,
  every = 0.5,
  view = "side",
  showPaths = true,
  only,
}: {
  getSnapshot: () => Snapshot | null;
  heightUnit: number;
  cfg: ShardConfig;
  every?: number;
  /** side = standing fragments seen from the front; top = the same clusters read as a plan. */
  view?: "side" | "top";
  showPaths?: boolean;
  /** Draw only these fragment kinds (pass a stable array). */
  only?: readonly ShardKind[];
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timer = useRef(10);
  const sig = useRef("");
  const [tex, setTex] = useState<THREE.Texture>(() => concreteTexture()); // procedural stand-in until the photographic board-formed concrete has loaded
  useEffect(() => {
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load("/textures/concrete_board.jpg", (t) => {
      if (!alive) { t.dispose(); return; }
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      loaded = t;
      setTex((old) => { old.dispose(); return t; });
    });
    return () => { alive = false; loaded?.dispose(); };
  }, []);
  useEffect(() => { sig.current = ""; }, [heightUnit, cfg, view, showPaths, only]); // force a rebuild when the knobs change

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < every) return;
    timer.current = 0;
    const mesh = meshRef.current;
    if (!mesh) return;
    const snap = getSnapshot();
    const slabs = snap?.slabs ?? [];
    let h = 0;
    for (const s of slabs) h += s.h * 100 + s.raw;
    let ph = 0;
    if (view === "top" && showPaths) for (const p of snap?.paths ?? []) ph += p.p * 10;
    const next = `${slabs.length}:${Math.round(h)}:${Math.round(ph)}`;
    if (next === sig.current) return;
    sig.current = next;

    const built = view === "top" ? buildPlanShards(slabs, showPaths ? snap?.paths ?? [] : [], cfg) : buildShards(slabs, heightUnit, cfg);
    const shards = only ? built.filter((s) => only.includes(s.kind)) : built;
    const pos = new Float32Array(shards.length * 18);
    const uv = new Float32Array(shards.length * 12);
    const col = new Float32Array(shards.length * 18);
    const tri = [0, 1, 2, 0, 2, 3];
    shards.forEach((s, i) => {
      const bluish = s.kind === "panel" || s.kind === "beam" ? 1.07 : s.kind === "plate" || s.kind === "setback" ? 1.04 : 1;
      for (let k = 0; k < 6; k++) {
        const v = tri[k];
        const o = i * 18 + k * 3;
        const x = s.p[v * 3], y = s.p[v * 3 + 1], z = s.p[v * 3 + 2];
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        uv[i * 12 + k * 2] = (x + i * 0.37) / TEX_WORLD;
        uv[i * 12 + k * 2 + 1] = (view === "top" ? z : y) / TEX_WORLD;
        col[o] = Math.min(1, s.tone * 0.97);
        col[o + 1] = Math.min(1, s.tone);
        col[o + 2] = Math.min(1, s.tone * bluish);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    mesh.geometry.dispose();
    mesh.geometry = g;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <bufferGeometry />
      <meshBasicMaterial map={tex} vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}
