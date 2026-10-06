"use client";
/**
 * NatureCloud: the player's ground as a POINT CLOUD (not sprites).
 *
 * For every cell around the player, `pointsPerCell` candidate points sit at deterministic
 * hashed positions; candidate i is drawn iff its threshold u_i < density G. So the number of
 * points IS the density, and lowering/raising G adds/removes points without any popping of
 * the others. Colour runs from fresh green to dry brown with stress; desire-path cells get
 * grey-brown dust points whose count follows the path strength.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { grassDensity, hash2, type NatureConfig, type Snapshot } from "@/lib/parliament";

const RADIUS = 22; // world units around the player
const MAX_POINTS = 90000;

const GREEN_FRESH = new THREE.Color(0x58c43c);
const GREEN_DEEP = new THREE.Color(0x1f7a2e);
const DRY = new THREE.Color(0xb59a45);
const DUST = new THREE.Color(0x8a7a62);

function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function NatureCloud({
  playerPosRef,
  getStress,
  getSnapshot,
  cfg,
  pointSize = 0.11,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getStress: () => Map<string, number> | null;
  getSnapshot: () => Snapshot | null;
  cfg: NatureConfig;
  pointSize?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const timer = useRef(10);
  const tex = useMemo(() => dotTexture(), []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useEffect(() => () => { geom.dispose(); tex.dispose(); }, [geom, tex]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.25) return;
    timer.current = 0;
    const stress = getStress();
    const snap = getSnapshot();
    const p = playerPosRef.current;
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Cc = col.array as Float32Array;

    const pathAt = new Map<string, number>();
    const sealed = new Set<string>();
    if (snap) {
      for (const q of snap.paths) pathAt.set(q.key, q.p);
      for (const s of snap.slabs) if (s.h >= 0.15) sealed.add(s.key);
    }

    const cx0 = Math.floor(p.x / CELL_SIZE);
    const cz0 = Math.floor(p.z / CELL_SIZE);
    const n = Math.ceil(RADIUS / CELL_SIZE);
    let k = 0;
    for (let dx = -n; dx <= n && k < MAX_POINTS - 64; dx++) {
      for (let dz = -n; dz <= n && k < MAX_POINTS - 64; dz++) {
        const ix = cx0 + dx;
        const iz = cz0 + dz;
        if (Math.hypot((ix + 0.5) * CELL_SIZE - p.x, (iz + 0.5) * CELL_SIZE - p.z) > RADIUS) continue;
        const key = `${ix},${iz}`;
        const S = stress?.get(key) ?? 0;
        const pp = pathAt.get(key) ?? 0;
        const G = grassDensity(ix, iz, S, pp, sealed.has(key), cfg);
        const worn = 1 - Math.exp(-S); // 0 fresh .. 1 trampled

        for (let i = 0; i < cfg.pointsPerCell; i++) {
          if (hash2(ix, iz, 100 + i) >= G) continue; // candidate i is drawn iff its threshold < G
          const u = hash2(ix, iz, 200 + i);
          const v = hash2(ix, iz, 300 + i);
          const h = hash2(ix, iz, 400 + i);
          const y = 0.02 + h * (0.12 + 0.3 * G) * (1 - 0.6 * worn);
          P[k * 3] = (ix + u) * CELL_SIZE;
          P[k * 3 + 1] = y;
          P[k * 3 + 2] = (iz + v) * CELL_SIZE;
          tmp.copy(GREEN_DEEP).lerp(GREEN_FRESH, h).lerp(DRY, Math.min(1, worn * 1.3 + (1 - G) * 0.25));
          Cc[k * 3] = tmp.r;
          Cc[k * 3 + 1] = tmp.g;
          Cc[k * 3 + 2] = tmp.b;
          k++;
        }
        if (pp > 0.05) {
          const nd = Math.round(14 * pp);
          for (let i = 0; i < nd; i++) {
            P[k * 3] = (ix + hash2(ix, iz, 500 + i)) * CELL_SIZE;
            P[k * 3 + 1] = 0.015 + hash2(ix, iz, 600 + i) * 0.03;
            P[k * 3 + 2] = (iz + hash2(ix, iz, 700 + i)) * CELL_SIZE;
            tmp.copy(DUST).multiplyScalar(0.75 + 0.5 * hash2(ix, iz, 800 + i));
            Cc[k * 3] = tmp.r;
            Cc[k * 3 + 1] = tmp.g;
            Cc[k * 3 + 2] = tmp.b;
            k++;
          }
        }
      }
    }
    geom.setDrawRange(0, k);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geom} frustumCulled={false}>
      <pointsMaterial size={pointSize} sizeAttenuation vertexColors map={tex} alphaTest={0.3} transparent depthWrite />
    </points>
  );
}
